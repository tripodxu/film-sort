/**
 * AI 点评通道：四协议适配 + 模块化提示词 + 配置校验 + 模型列表。
 *
 * 设计要点（详见 docs/PLAN-ai-insights.md）：
 *  - 内置通道走 Cloudflare 环境变量（AI_API_URL/KEY/MODEL/PROTOCOL），不配 AI_PROTOCOL
 *    时保持 anthropic 直发原端点的历史行为，零迁移；
 *  - 自定义通道的三参数（baseUrl/apiKey/model）由用户在网页端配置，经 Worker 转发，
 *    key 不落任何日志；validateUserConfig 的 SSRF 规则是唯一入口；
 *  - 提示词由 ROLE/TASK/CONSTRAINT/OUTPUT 四个指令模块 + dataBlock 数据块拼装，
 *    数据只进数据块，用户侧没有自由文本注入面；管理端可在线覆盖 system（§6.3）。
 */

import { OutboundError, fetchBounded, readBoundedJson, type OutboundPolicy } from "./outbound";
import { registerPurger } from "./cachePurge";

// 上游响应字节预算：模型列表/生成文本远小于此；防恶意 endpoint 返回超大 body 耗尽 Worker 内存。
const MAX_AI_RESPONSE_BYTES = 1024 * 1024;

export type AiScene = "ranking" | "profile" | "compare";
export type AiLocale = "zh" | "en";
export type AiLength = "brief" | "standard" | "deep";
export type AiProtocol = "chat" | "responses" | "anthropic" | "gemini";
export type AiProtocolChoice = AiProtocol | "auto";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: AiProtocolChoice;
}

export interface ResolvedAi {
  endpoint: string;
  apiKey: string;
  model: string;
  protocol: AiProtocol;
}

/** 提示词规格：version 为模块组合版本号；管理端覆盖时记 "override"。 */
export interface PromptSpec {
  version: number | "override";
  system: string;
  user: string;
}

export type AiErrorCode =
  | "ai_not_configured"
  | "invalid_config"
  | "invalid_data"
  | "data_too_large"
  | "rate_limited"
  | "upstream_auth_failed"
  | "upstream_not_found"
  | "upstream_rate_limited"
  | "upstream_error";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** 指令模块改动（措辞/结构/长度映射）时递增，响应里随 promptVersion 回显。 */
export const PROMPT_VERSION = 1;

const MAX_OVERRIDE_SYSTEM_CHARS = 4000;
const MAX_USER_CHARS = 16000;
const MAX_MODELS = 100;

// ===== 提示词模块（§6.1）=====

export const ROLE_BLOCK: Record<AiLocale, string> = {
  zh: "你是一位艺术品味点评助手，为用户的榜单、画像或比较结果撰写点评。你不做心理诊断，不下绝对结论，不评判品味高低。",
  en: "You are an artistic-taste commentary assistant writing about a user's rankings, profile, or comparison results. You never diagnose, never state absolute verdicts, and never judge taste as good or bad.",
};

export const TASK_BLOCK: Record<AiScene, Record<AiLocale, string>> = {
  ranking: {
    zh: "基于下面这份榜单的数据，点评这位用户的品味。",
    en: "Based on the ranking data below, comment on this user's taste.",
  },
  profile: {
    zh: "基于下面这份跨媒介画像的数据，评价这位用户整体的艺术人格。",
    en: "Based on the cross-media profile data below, assess this user's overall artistic personality.",
  },
  compare: {
    zh: "基于下面两位用户的榜单与比较指标，解读两人的共同品味与分歧。",
    en: "Based on the two users' rankings and comparison metrics below, interpret their shared tastes and divergences.",
  },
};

export function constraintBlock(locale: AiLocale): string {
  return locale === "zh"
    ? "要求：用中文写作；客观中性、具体到作品；禁止逐条复述榜单；只依据给出的数据，不编造未出现的作品或事实。"
    : "Requirements: write in English; be objective and specific to the works; never recite the list item by item; rely only on the given data and never invent works or facts.";
}

const SEGMENTS: Record<AiScene, Record<AiLocale, string[]>> = {
  ranking: {
    zh: ["总体印象", "品味亮点", "可以留意的盲区"],
    en: ["Overall impression", "Taste highlights", "Blind spots to note"],
  },
  profile: {
    zh: ["总体印象", "跨媒介亮点", "可以留意的盲区"],
    en: ["Overall impression", "Cross-media highlights", "Blind spots to note"],
  },
  compare: {
    zh: ["共同品味", "主要分歧", "给两人的建议"],
    en: ["Shared taste", "Main divergence", "A note for both"],
  },
};

const LENGTH_SPEC: Record<AiLength, Record<AiLocale, string>> = {
  brief: {
    zh: "总共不超过 120 字，每段一两句话",
    en: "at most 120 words in total, one or two sentences per segment",
  },
  standard: { zh: "总共不超过 250 字", en: "at most 250 words in total" },
  deep: {
    zh: "总共不超过 500 字，可以更具体地展开",
    en: "at most 500 words in total, more detail is welcome",
  },
};

export function outputBlock(scene: AiScene, length: AiLength, locale: AiLocale): string {
  const segs = SEGMENTS[scene][locale].join(locale === "zh" ? "、" : ", ");
  return locale === "zh"
    ? `输出：依次输出${segs}三段，用序号标明；${LENGTH_SPEC[length][locale]}。`
    : `Output: exactly three numbered segments — ${segs}; ${LENGTH_SPEC[length][locale]}.`;
}

// ===== 数据块：唯一允许接触作品数据的地方 =====

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const asInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const KIND_LABELS: Record<string, Record<AiLocale, string>> = {
  film: { zh: "电影", en: "Films" },
  book: { zh: "书籍", en: "Books" },
  music: { zh: "音乐", en: "Music" },
  other: { zh: "其他", en: "Other" },
};

function workLine(entry: JsonObject, fallbackRank: number, locale: AiLocale): string | null {
  const title = asString(entry.title);
  if (!title) return null;
  const parts = [title];
  const creator = asString(entry.creator);
  if (creator) parts.push(creator);
  const year = asInt(entry.year);
  const rank = asInt(entry.rank) ?? fallbackRank;
  return `${rank}. ${parts.join(locale === "zh" ? " / " : " / ")}${year ? ` (${year})` : ""}`;
}

function dataBlockRanking(data: JsonObject, locale: AiLocale): string | null {
  const worksRaw = data.works;
  if (!Array.isArray(worksRaw) || worksRaw.length === 0) return null;
  const works = worksRaw.slice(0, 150).filter(isObject);
  const lines: string[] = [];
  const profileName = asString(data.profileName);
  if (profileName) lines.push(`${locale === "zh" ? "用户" : "User"}: ${profileName}`);
  const collectionTitle =
    asString(data.collectionTitle) ?? (locale === "zh" ? "未命名榜单" : "Untitled list");
  const itemCount = asInt(data.itemCount) ?? works.length;
  const kindKey = asString(data.kind) ?? "";
  const kindLabel = KIND_LABELS[kindKey]?.[locale] ?? kindKey;
  const shownNote =
    works.length < itemCount
      ? locale === "zh"
        ? `，展示前 ${works.length} 件`
        : `, showing first ${works.length}`
      : "";
  lines.push(
    locale === "zh"
      ? `榜单：${collectionTitle}（${kindLabel}，共 ${itemCount} 件${shownNote}）`
      : `List: ${collectionTitle} (${kindLabel}, ${itemCount} works${shownNote})`,
  );
  works.forEach((entry, index) => {
    const line = workLine(entry, index + 1, locale);
    if (line) lines.push(line);
  });
  return lines.join("\n");
}

function dataBlockProfile(data: JsonObject, locale: AiLocale): string | null {
  const rankingsRaw = data.rankings;
  if (!Array.isArray(rankingsRaw) || rankingsRaw.length === 0) return null;
  const lines: string[] = [];
  const profileName = asString(data.profileName);
  if (profileName) lines.push(`${locale === "zh" ? "用户" : "User"}: ${profileName}`);
  const stats = isObject(data.stats) ? data.stats : {};
  const totalWorks = asInt(stats.totalWorks);
  const kindsCount = asInt(stats.kindsCount);
  if (totalWorks !== null && kindsCount !== null)
    lines.push(
      locale === "zh"
        ? `画像共 ${totalWorks} 件作品，覆盖 ${kindsCount} 个媒介`
        : `Profile totals ${totalWorks} works across ${kindsCount} media`,
    );
  const creatorsRaw = Array.isArray(stats.topCreators) ? stats.topCreators : [];
  const creators = creatorsRaw
    .filter(isObject)
    .map((entry) => ({ name: asString(entry.name), count: asInt(entry.count) ?? 0 }))
    .filter((entry) => entry.name)
    .slice(0, 8);
  if (creators.length)
    lines.push(
      (locale === "zh" ? "高频创作者：" : "Frequent creators: ") +
        creators
          .map((entry) => `${entry.name}(${entry.count})`)
          .join(locale === "zh" ? "、" : ", "),
    );
  for (const entry of rankingsRaw.slice(0, 20)) {
    if (!isObject(entry)) continue;
    const topRaw = entry.top;
    if (!Array.isArray(topRaw) || topRaw.length === 0) continue;
    const top = topRaw.slice(0, 15).filter(isObject);
    const kindKey = asString(entry.kind) ?? "";
    const kindLabel = KIND_LABELS[kindKey]?.[locale] ?? kindKey;
    const collectionTitle = asString(entry.collectionTitle) ?? "";
    const itemCount = asInt(entry.itemCount) ?? top.length;
    const shownNote =
      top.length < itemCount
        ? locale === "zh"
          ? `，展示前 ${top.length}`
          : `, showing first ${top.length}`
        : "";
    lines.push(
      locale === "zh"
        ? `[${kindLabel}] ${collectionTitle}（共 ${itemCount} 件${shownNote}）：`
        : `[${kindLabel}] ${collectionTitle} (${itemCount} works${shownNote}):`,
    );
    top.forEach((item, index) => {
      const line = workLine(item, index + 1, locale);
      if (line) lines.push(line);
    });
  }
  return lines.length ? lines.join("\n") : null;
}

function dataBlockCompare(data: JsonObject, locale: AiLocale): string | null {
  const mediaRaw = data.media;
  if (!Array.isArray(mediaRaw)) return null;
  const ownName = asString(data.ownName) ?? (locale === "zh" ? "甲方" : "User A");
  const peerName = asString(data.peerName) ?? (locale === "zh" ? "乙方" : "User B");
  const lines: string[] = [
    `${locale === "zh" ? "甲方" : "A"}: ${ownName}`,
    `${locale === "zh" ? "乙方" : "B"}: ${peerName}`,
  ];
  if (!mediaRaw.length) {
    lines.push(
      locale === "zh" ? "两位用户没有共同的媒介维度。" : "The two users share no media dimension.",
    );
    return lines.join("\n");
  }
  for (const entry of mediaRaw.slice(0, 10)) {
    if (!isObject(entry)) continue;
    const kindKey = asString(entry.kind) ?? "";
    const kindLabel = KIND_LABELS[kindKey]?.[locale] ?? kindKey;
    lines.push(`[${kindLabel}]`);
    const pct = (value: unknown, suffix = "%") =>
      typeof value === "number" ? `${value}${suffix}` : "-";
    lines.push(
      `${locale === "zh" ? "重合度" : "Overlap"} ${pct(entry.overlap)} · ${locale === "zh" ? "顺序一致率" : "Order agreement"} ${pct(entry.orderAgreement)} · ${locale === "zh" ? "共识评分" : "Consensus"} ${pct(entry.consensusScore, "")} · Kendall τ ${pct(entry.kendallTau, "")}`,
    );
    const sharedTop = (Array.isArray(entry.sharedTop) ? entry.sharedTop : [])
      .map(asString)
      .filter((title): title is string => !!title)
      .slice(0, 5);
    if (sharedTop.length)
      lines.push(
        (locale === "zh" ? "双方共同偏好的作品：" : "Shared favorites: ") +
          sharedTop.join(locale === "zh" ? "、" : ", "),
      );
    const onlyOwn = asInt(entry.onlyOwnCount);
    const onlyPeer = asInt(entry.onlyPeerCount);
    if (onlyOwn !== null && onlyPeer !== null)
      lines.push(
        locale === "zh"
          ? `仅甲方有 ${onlyOwn} 件，仅乙方有 ${onlyPeer} 件`
          : `${onlyOwn} works only on A, ${onlyPeer} only on B`,
      );
    const gap = isObject(entry.biggestGap) ? entry.biggestGap : null;
    const gapTitle = gap ? asString(gap.title) : null;
    if (gap && gapTitle)
      lines.push(
        locale === "zh"
          ? `最大分歧：${gapTitle}（甲方 #${asInt(gap.ownRank) ?? "?"} / 乙方 #${asInt(gap.peerRank) ?? "?"}）`
          : `Biggest gap: ${gapTitle} (A #${asInt(gap.ownRank) ?? "?"} / B #${asInt(gap.peerRank) ?? "?"})`,
      );
  }
  const crossAgreement = asInt(data.crossAgreement);
  if (crossAgreement !== null)
    lines.push(
      locale === "zh"
        ? `跨媒介加权共识：${crossAgreement}`
        : `Cross-media weighted agreement: ${crossAgreement}`,
    );
  return lines.join("\n");
}

function dataBlock(scene: AiScene, data: JsonObject, locale: AiLocale): string | null {
  if (scene === "ranking") return dataBlockRanking(data, locale);
  if (scene === "profile") return dataBlockProfile(data, locale);
  return dataBlockCompare(data, locale);
}

// ===== 拼装出口 =====

export function composePrompt(
  scene: AiScene,
  data: unknown,
  locale: AiLocale = "zh",
  opts: { length?: AiLength; overrideSystem?: string | null } = {},
): PromptSpec | null {
  if (!isObject(data)) return null;
  const user = dataBlock(scene, data, locale);
  if (!user || user.length > MAX_USER_CHARS) return null;
  const override =
    typeof opts.overrideSystem === "string" && opts.overrideSystem.trim()
      ? opts.overrideSystem.trim().slice(0, MAX_OVERRIDE_SYSTEM_CHARS)
      : null;
  const length = opts.length ?? "standard";
  const system =
    override ??
    [
      ROLE_BLOCK[locale],
      TASK_BLOCK[scene][locale],
      constraintBlock(locale),
      outputBlock(scene, length, locale),
    ].join("\n\n");
  return { version: override ? "override" : PROMPT_VERSION, system, user };
}

// ===== 管理端在线覆盖（§6.3）=====

export const PROMPT_OVERRIDE_PREFIX = "ai_prompt_system_";

export function promptOverrideKey(scene: AiScene): string {
  return `${PROMPT_OVERRIDE_PREFIX}${scene}`;
}

export async function readPromptOverride(
  db: D1Database | undefined,
  scene: AiScene,
): Promise<string | null> {
  if (!db) return null;
  try {
    const row = await db
      .prepare("SELECT value FROM admin_config WHERE key = ?")
      .bind(promptOverrideKey(scene))
      .first<{ value: string }>();
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

// ===== 配置校验（§4.4，自定义通道的 SSRF 唯一入口）=====

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function validateUserConfig(raw: unknown): AiConfig | null {
  if (!isObject(raw)) return null;
  const baseUrl = asString(raw.baseUrl);
  const apiKey = asString(raw.apiKey);
  const model = asString(raw.model);
  if (!baseUrl || !apiKey || !model) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (baseUrl.length > 2083) return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443" && url.port !== "80") return null;
  const host = url.hostname.toLowerCase();
  // 字面 IP（含 v6 方括号形式）一律拒绝：杜绝内网直扫与云元数据端点
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (host.endsWith(".internal") || host === "metadata.cloudflare.com") return null;
  if (host.split(".").length < 2) return null;
  if (apiKey.length < 8 || apiKey.length > 256 || CONTROL_RE.test(apiKey)) return null;
  if (model.length > 100 || !MODEL_RE.test(model)) return null;
  const protocolRaw = raw.protocol;
  if (
    protocolRaw !== undefined &&
    protocolRaw !== "auto" &&
    protocolRaw !== "chat" &&
    protocolRaw !== "responses" &&
    protocolRaw !== "anthropic" &&
    protocolRaw !== "gemini"
  )
    return null;
  const protocol = (protocolRaw as AiProtocolChoice | undefined) ?? "auto";
  return { baseUrl, apiKey, model, protocol };
}

// ===== 端点归一（§4.1 表）=====

export function resolveEndpoint(baseUrl: string, protocol: AiProtocol, model: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (protocol === "chat") {
    if (base.endsWith("/chat/completions")) return base;
    return `${base}/chat/completions`;
  }
  if (protocol === "responses") {
    if (base.endsWith("/responses")) return base;
    return `${base}/responses`;
  }
  if (protocol === "anthropic") {
    if (base.endsWith("/messages")) return base;
    if (base.endsWith("/v1")) return `${base}/messages`;
    return `${base}/v1/messages`;
  }
  // gemini：端点内嵌模型名。模型名按单个 path segment 编码——MODEL_RE 允许 `/` 和 `:`，
  // 不编码会被解析成路径层级，构造出意外 endpoint（findings SEC-02）。
  if (base.includes(":generateContent")) return base;
  const encodedModel = encodeURIComponent(model);
  if (base.endsWith("/v1beta") || base.endsWith("/v1"))
    return `${base}/models/${encodedModel}:generateContent`;
  return `${base}/v1beta/models/${encodedModel}:generateContent`;
}

function resolveModelsEndpoint(baseUrl: string, protocol: AiProtocol): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (protocol === "gemini") {
    if (base.endsWith("/models")) return base;
    if (base.endsWith("/v1beta") || base.endsWith("/v1")) return `${base}/models`;
    return `${base}/v1beta/models`;
  }
  if (base.endsWith("/models")) return base;
  if (protocol === "anthropic") {
    if (base.endsWith("/v1")) return `${base}/models`;
    return `${base}/v1/models`;
  }
  return `${base}/models`;
}

// ===== 四协议请求/响应适配 =====

interface CallOptions {
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

function buildRequest(
  cfg: ResolvedAi,
  spec: PromptSpec,
  maxTokens: number,
): { url: string; init: RequestInit } {
  if (cfg.protocol === "anthropic") {
    return {
      url: cfg.endpoint,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          system: spec.system,
          messages: [{ role: "user", content: spec.user }],
        }),
      },
    };
  }
  if (cfg.protocol === "gemini") {
    return {
      url: cfg.endpoint,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": cfg.apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: spec.system }] },
          contents: [{ role: "user", parts: [{ text: spec.user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }),
      },
    };
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${cfg.apiKey}`,
  };
  if (cfg.protocol === "chat") {
    return {
      url: cfg.endpoint,
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: spec.system },
            { role: "user", content: spec.user },
          ],
        }),
      },
    };
  }
  return {
    url: cfg.endpoint,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        max_output_tokens: maxTokens,
        input: [
          { role: "system", content: [{ type: "input_text", text: spec.system }] },
          { role: "user", content: [{ type: "input_text", text: spec.user }] },
        ],
      }),
    },
  };
}

function extractText(protocol: AiProtocol, raw: unknown): string | null {
  if (!isObject(raw)) return null;
  if (protocol === "chat") {
    const choices = raw.choices;
    if (!Array.isArray(choices) || !choices.length) return null;
    const message = isObject(choices[0]) ? choices[0].message : null;
    const content = message && isObject(message) ? message.content : null;
    return typeof content === "string" && content.trim() ? content : null;
  }
  if (protocol === "responses") {
    const output = raw.output;
    if (!Array.isArray(output)) return null;
    const text = output
      .filter(isObject)
      .filter((entry) => entry.type === "message")
      .flatMap((entry) => (Array.isArray(entry.content) ? entry.content : []))
      .filter(isObject)
      .filter((entry) => entry.type === "output_text")
      .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
      .join("")
      .trim();
    return text || null;
  }
  if (protocol === "anthropic") {
    const content = raw.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter(isObject)
      .filter((entry) => entry.type === "text" && typeof entry.text === "string")
      .map((entry) => entry.text as string)
      .join("")
      .trim();
    return text || null;
  }
  const candidates = raw.candidates;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const first = isObject(candidates[0]) ? candidates[0] : null;
  const parts =
    first && isObject(first.content) && Array.isArray(first.content.parts)
      ? first.content.parts
      : [];
  const text = parts
    .filter(isObject)
    .map((entry) => (typeof entry.text === "string" ? entry.text : ""))
    .join("")
    .trim();
  return text || null;
}

const MAX_OUTPUT_CHARS = 2000;

/** 按具体协议调用一次模型；协议必须是具体值（auto 的探测在上层）。失败抛 AiError。 */
export async function callAi(
  cfg: ResolvedAi,
  spec: PromptSpec,
  opts: CallOptions = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxTokens = opts.maxTokens ?? 1000;
  const { url, init } = buildRequest(cfg, spec, maxTokens);
  let response: Response;
  const timeoutMs = opts.timeoutMs ?? 60000;
  try {
    response = await Promise.race([
      fetchImpl(url, {
        ...init,
        // 不跟随 3xx：自定义 baseUrl 可用跳转绕过 SSRF 字面量校验。
        redirect: "manual",
        // 推理型模型（如 mimo）生成 250 字点评实测 ~15-30s：默认超时给足 60s，
        // 否则 AbortSignal 会在上游仍在推理时掐断，表现为 upstream_error。
        signal: AbortSignal.timeout(timeoutMs),
      } as RequestInit),
      // 兜底竞速：本地 miniflare 的 outbound fetch 会偶发挂死且 signal 不生效，
      // 生产 workerd 上该分支永不触发（signal 先到），双保险不改变正常路径。
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("fetch race timeout")), timeoutMs + 5000),
      ),
    ]);
  } catch {
    throw new AiError("upstream_error", 502, "AI upstream unreachable");
  }
  if (response.status >= 300 && response.status < 400)
    throw new AiError("invalid_config", 400, "AI baseUrl redirects are not allowed");
  if (response.status === 401 || response.status === 403)
    throw new AiError("upstream_auth_failed", 502, "AI upstream rejected credentials");
  if (response.status === 404 || response.status === 405)
    throw new AiError("upstream_not_found", 502, "AI upstream endpoint not found");
  if (response.status === 429)
    throw new AiError(
      "upstream_rate_limited",
      502,
      "AI upstream rate limited",
      Number(response.headers.get("retry-after")) || 0,
    );
  if (!response.ok)
    throw new AiError("upstream_error", 502, `AI upstream returned ${response.status}`);
  let raw: unknown;
  try {
    raw = await readBoundedJson(response, MAX_AI_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof OutboundError)
      throw new AiError("upstream_error", 502, `AI upstream response rejected: ${error.code}`);
    throw new AiError("upstream_error", 502, "AI upstream returned malformed JSON");
  }
  const text = extractText(cfg.protocol, raw);
  if (!text) throw new AiError("upstream_error", 502, "AI upstream returned no text");
  return text.slice(0, MAX_OUTPUT_CHARS);
}

// ===== 协议自动探测（仅 404/405 降档；结论按 baseUrl 缓存）=====

const PROTOCOL_CACHE_MAX = 200;
const protocolCache = new Map<string, AiProtocol>();

export function clearProtocolCache(): void {
  protocolCache.clear();
}

// 「其他」作用域：协议探测缓存随清缓存入口一并失效。
registerPurger("misc", () => {
  const count = protocolCache.size;
  clearProtocolCache();
  return count;
});

function rememberProtocol(baseUrl: string, protocol: AiProtocol): void {
  if (protocolCache.size >= PROTOCOL_CACHE_MAX) {
    const oldest = protocolCache.keys().next();
    if (!oldest.done) protocolCache.delete(oldest.value);
  }
  protocolCache.set(baseUrl, protocol);
}

export interface AutoCallResult {
  text: string;
  protocol: AiProtocol;
  model: string;
}

/** AiConfig + 具体协议 → 可请求的 ResolvedAi（端点在此刻归一）。 */
function toResolved(cfg: AiConfig, protocol: AiProtocol): ResolvedAi {
  return {
    endpoint: resolveEndpoint(cfg.baseUrl, protocol, cfg.model),
    apiKey: cfg.apiKey,
    model: cfg.model,
    protocol,
  };
}

/** auto 协议下按 chat → responses → anthropic → gemini 探测；401/403/429/5xx 视为命中，原样抛出。 */
export async function callModelAuto(
  cfg: AiConfig,
  spec: PromptSpec,
  opts: CallOptions = {},
): Promise<AutoCallResult> {
  const cached = protocolCache.get(cfg.baseUrl);
  if (cached) {
    const text = await callAi(toResolved(cfg, cached), spec, opts);
    return { text, protocol: cached, model: cfg.model };
  }
  let lastNotFound: AiError | null = null;
  for (const protocol of ["chat", "responses", "anthropic", "gemini"] as const) {
    try {
      const text = await callAi(toResolved(cfg, protocol), spec, opts);
      rememberProtocol(cfg.baseUrl, protocol);
      return { text, protocol, model: cfg.model };
    } catch (error) {
      if (error instanceof AiError && error.code === "upstream_not_found") {
        lastNotFound = error;
        continue;
      }
      throw error;
    }
  }
  throw (
    lastNotFound ??
    new AiError(
      "upstream_not_found",
      502,
      "AI endpoint not found — check the base URL, protocol and model name",
    )
  );
}

// ===== 模型列表（§4.3 /api/ai/models）=====

export interface AiModelsResult {
  protocol: AiProtocol;
  models: string[];
  truncated: boolean;
}

function parseModels(protocol: AiProtocol, raw: unknown): string[] {
  if (!isObject(raw)) return [];
  if (protocol === "gemini") {
    const models = Array.isArray(raw.models) ? raw.models : [];
    return models
      .filter(isObject)
      .map((entry) => asString(entry.name))
      .filter((name): name is string => !!name)
      .map((name) => name.replace(/^models\//, ""))
      .filter(Boolean)
      .slice(0, MAX_MODELS);
  }
  const data = Array.isArray(raw.data) ? raw.data : [];
  return data
    .filter(isObject)
    .map((entry) => asString(entry.id))
    .filter((id): id is string => !!id)
    .filter(Boolean)
    .slice(0, MAX_MODELS);
}

async function listModelsForProtocol(
  cfg: AiConfig,
  protocol: AiProtocol,
  fetchImpl: typeof fetch,
): Promise<AiModelsResult> {
  const url = resolveModelsEndpoint(cfg.baseUrl, protocol);
  const headers: Record<string, string> = { accept: "application/json" };
  if (protocol === "anthropic") {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (protocol === "gemini") {
    headers["x-goog-api-key"] = cfg.apiKey;
  } else {
    headers.authorization = `Bearer ${cfg.apiKey}`;
  }
  // 与生成请求同规则的出站策略：manual redirect 逐跳同 host 复核（key 不出白名单 host）、
  // 15s 超时、响应字节上限。旧实现用默认 fetch 跟随 redirect 且无字节预算（findings SEC-02/OPS-01）。
  const policy: OutboundPolicy = {
    allowedHosts: [new URL(cfg.baseUrl).hostname.toLowerCase()],
    maxBytes: MAX_AI_RESPONSE_BYTES,
    timeoutMs: 15_000,
    maxRedirects: 2,
  };
  let response: Response;
  try {
    response = await fetchBounded(
      url,
      { method: "GET", headers, redirect: "manual" },
      policy,
      fetchImpl,
    );
  } catch (error) {
    if (
      error instanceof OutboundError &&
      (error.code === "timeout" || error.code === "network_error")
    )
      throw new AiError("upstream_error", 502, "AI upstream unreachable");
    if (error instanceof OutboundError)
      throw new AiError("upstream_error", 502, `AI upstream request rejected: ${error.code}`);
    throw new AiError("upstream_error", 502, "AI upstream unreachable");
  }
  if (response.status === 401 || response.status === 403)
    throw new AiError("upstream_auth_failed", 502, "AI upstream rejected credentials");
  if (response.status === 404 || response.status === 405)
    throw new AiError("upstream_not_found", 502, "AI upstream endpoint not found");
  if (response.status === 429)
    throw new AiError("upstream_rate_limited", 502, "AI upstream rate limited");
  if (!response.ok)
    throw new AiError("upstream_error", 502, `AI upstream returned ${response.status}`);
  let raw: unknown;
  try {
    raw = await readBoundedJson(response, MAX_AI_RESPONSE_BYTES);
  } catch (error) {
    if (error instanceof OutboundError)
      throw new AiError("upstream_error", 502, `AI upstream response rejected: ${error.code}`);
    throw new AiError("upstream_error", 502, "AI upstream returned malformed JSON");
  }
  const models = parseModels(protocol, raw);
  if (!models.length) throw new AiError("upstream_error", 502, "AI upstream returned no models");
  return { protocol, models, truncated: models.length >= MAX_MODELS };
}

/** 列出模型；auto 时按 chat → responses → anthropic → gemini 探测列表端点，结论同样入缓存。 */
export async function listAiModels(
  cfg: AiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<AiModelsResult> {
  const cached = protocolCache.get(cfg.baseUrl);
  if (cached) return listModelsForProtocol(cfg, cached, fetchImpl);
  let lastNotFound: AiError | null = null;
  for (const protocol of ["chat", "responses", "anthropic", "gemini"] as const) {
    try {
      const result = await listModelsForProtocol(cfg, protocol, fetchImpl);
      rememberProtocol(cfg.baseUrl, protocol);
      return result;
    } catch (error) {
      if (error instanceof AiError && error.code === "upstream_not_found") {
        lastNotFound = error;
        continue;
      }
      throw error;
    }
  }
  throw (
    lastNotFound ??
    new AiError(
      "upstream_not_found",
      502,
      "AI endpoint not found — check the base URL and protocol",
    )
  );
}

// ===== 测试连接（§4.3 /api/ai/test）=====

export async function testAiConnection(
  cfg: AiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; model: string; protocol: AiProtocol }> {
  const spec: PromptSpec = {
    version: PROMPT_VERSION,
    system: "You are a health check. Reply with the single word: pong.",
    user: "ping",
  };
  // max_tokens 不能给太小：推理型模型（o1 系 / mimo 系）会把少量配额全部耗在
  // 推理段上，content 为空会被误判成 upstream_error，让「测试连接」对能用的
  // 配置报失败。256 足够推理 + 一个词的输出，探活成本仍可忽略。
  const result = await callModelAuto(cfg, spec, { maxTokens: 256, fetchImpl });
  return { ok: true, model: result.model, protocol: result.protocol };
}

// ===== 错误 → HTTP 映射 =====

export function aiErrorStatus(error: unknown): number {
  return error instanceof AiError ? error.status : 502;
}

export function aiErrorPayload(error: unknown): { error: AiErrorCode; msg: string } {
  if (!(error instanceof AiError)) return { error: "upstream_error", msg: "AI 服务暂不可用" };
  const messages: Record<AiErrorCode, string> = {
    ai_not_configured: "服务端未配置 AI，可在设置里填入自己的 API",
    invalid_config: "API 配置不合法（检查地址/密钥/模型名）",
    invalid_data: "数据格式不正确",
    data_too_large: "数据过大",
    rate_limited: "操作太频繁，请 10 分钟后再试",
    upstream_auth_failed: "API Key 无效或无权限",
    upstream_not_found:
      "接口地址不正确，或协议不匹配（试试切换 Chat / Responses / Anthropic / Gemini），也请检查模型名",
    upstream_rate_limited: "AI 服务限流，请稍后再试",
    upstream_error: "AI 服务暂不可用",
  };
  return { error: error.code, msg: messages[error.code] };
}
