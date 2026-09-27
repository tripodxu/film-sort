/**
 * TypeSafe AI(Jev,System One 决策模型)客户端。
 *
 * 只做「决策」不做生成:把用户品味上下文 + 清单作品组装成一次 systemone
 * 调用(每件作品一个 Noul 问题,模型并行评估、互不污染),返回带 0–1
 * 校准概率的排序。上游地址固定 api.typesafe.ai(非用户可控 URL,允许走
 * fetchBounded 精确白名单);用户的 apiKey 由前端透传,本模块不落盘。
 */
import { AiError } from "./ai";
import { OutboundError, fetchBounded, readBoundedJson } from "./outbound";

const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CONTROL_RE = /[\u0000-\u001f\u007f]/; // 与 ai.ts validateUserConfig 同口径

export type JevKind = "film" | "book" | "music" | "other";
const KIND_LABELS: Record<JevKind, string> = {
  film: "电影",
  book: "书籍",
  music: "音乐",
  other: "其他",
};

export interface JevWorkInput {
  title: string;
  creator?: string;
  year?: number;
}
export interface JevRankInput {
  kind: JevKind;
  collectionTitle: string;
  works: JevWorkInput[];
  profileContext?: string;
  locale?: "zh" | "en";
}
export interface JevRankResult {
  model: string;
  order: number[];
  scores: number[];
  inputTokens: number;
}

export function validateJevConfig(raw: unknown): { apiKey: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.apiKey !== "string") return null;
  const apiKey = cfg.apiKey;
  if (apiKey.length < 8 || apiKey.length > 256 || CONTROL_RE.test(apiKey)) return null;
  return { apiKey };
}

const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

export function buildJevState(input: JevRankInput): string {
  const zh = (input.locale ?? "zh") === "zh";
  const label = KIND_LABELS[input.kind];
  const lines: string[] = [];
  if (input.profileContext) lines.push(`【用户品味档案】\n${clean(input.profileContext, 4096)}`);
  lines.push(
    zh
      ? `【当前清单】「${clean(input.collectionTitle, 160)}」(${label},共 ${input.works.length} 件)`
      : `【List】"${clean(input.collectionTitle, 160)}" (${label}, ${input.works.length} works)`,
    zh ? "清单内全部作品如下(与顺序无关):" : "All works in this list (order is irrelevant):",
  );
  input.works.forEach((work, index) => {
    const title = clean(work.title, 160);
    const meta = [
      work.year ? String(work.year) : "",
      work.creator ? (zh ? `创作者:${clean(work.creator, 120)}` : `by ${clean(work.creator, 120)}`) : "",
    ]
      .filter(Boolean)
      .join(zh ? "," : ", ");
    const item = zh
      ? `${index + 1}. 《${title}》${meta ? `(${meta})` : ""}`
      : `${index + 1}. "${title}"${meta ? ` (${meta})` : ""}`;
    lines.push(item);
  });
  return lines.join("\n");
}

export function buildJevQuestions(
  input: JevRankInput,
): Record<string, { type: "noul"; instructions: string }> {
  const zh = (input.locale ?? "zh") === "zh";
  const kindLabel = KIND_LABELS[input.kind];
  const questions: Record<string, { type: "noul"; instructions: string }> = {};
  input.works.forEach((work, index) => {
    const title = clean(work.title, 160);
    const meta = [
      work.year ? String(work.year) : "",
      work.creator ? clean(work.creator, 120) : "",
    ]
      .filter(Boolean)
      .join(", ");
    questions[`w${index}`] = {
      type: "noul",
      instructions: zh
        ? `这位用户会有多喜欢这部${kindLabel}(0 = 完全不会保留,1 = 一定会排在最前)?《${title}》${meta ? `(${meta})` : ""}`
        : `How much would this user enjoy this work (0 = would not keep it, 1 = would rank it at the very top)? "${title}"${meta ? ` (${meta})` : ""}`,
    };
  });
  return questions;
}

interface SystemOneResponse {
  model?: string;
  answers?: Record<string, { type?: string; noul?: number }>;
  usage?: { input_tokens?: number };
}

async function callSystemOne(
  payload: unknown,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<SystemOneResponse> {
  let response: Response;
  try {
    response = await fetchBounded(
      SYSTEMONE_URL,
      {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      // 上游域名固定、非用户可控:精确白名单 + 30s 超时 + 1MB 响应上限。
      { allowedHosts: ["api.typesafe.ai"], maxBytes: MAX_RESPONSE_BYTES, timeoutMs: 30_000, maxRedirects: 2 },
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof OutboundError && error.code === "timeout")
      throw new AiError("upstream_error", 504, "Jev upstream timeout");
    throw new AiError("upstream_error", 502, "Jev upstream unreachable");
  }
  if (response.status === 401 || response.status === 403)
    throw new AiError("upstream_auth_failed", 502, "TypeSafe API key rejected");
  if (response.status === 429) throw new AiError("upstream_rate_limited", 502, "TypeSafe rate limited");
  if (!response.ok) throw new AiError("upstream_error", 502, `Jev upstream ${response.status}`);
  return (await readBoundedJson(response, MAX_RESPONSE_BYTES)) as SystemOneResponse;
}

export async function jevRank(
  input: JevRankInput,
  config: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<JevRankResult> {
  if (!Array.isArray(input.works) || input.works.length < 1 || input.works.length > 255)
    throw new AiError("invalid_data", 400, "works must contain 1-255 items");
  const payload = {
    model: "jev-latest",
    state: buildJevState(input),
    questions: buildJevQuestions(input),
  };
  const body = await callSystemOne(payload, config.apiKey, fetchImpl);
  const answers = body.answers ?? {};
  // 缺答案按 0 分垫底(而不是整单失败):单作品评估互不影响,个别缺失
  // 不应否定其余作品的排序。
  const scored = input.works.map((_, index) => {
    const score = answers[`w${index}`]?.noul;
    return { index, score: typeof score === "number" && score >= 0 && score <= 1 ? score : 0 };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    model: typeof body.model === "string" ? body.model : "jev",
    order: scored.map((entry) => entry.index),
    scores: scored.map((entry) => entry.score),
    inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
  };
}

export async function testJevConnection(
  config: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; model: string }> {
  const body = await callSystemOne(
    {
      model: "jev-latest",
      state: "This is a connectivity test.",
      questions: { ping: { type: "noul", instructions: "Is this text a connectivity test?" } },
    },
    config.apiKey,
    fetchImpl,
  );
  if (typeof body.answers?.ping?.noul !== "number")
    throw new AiError("upstream_error", 502, "Jev response malformed");
  return { ok: true, model: typeof body.model === "string" ? body.model : "jev" };
}

export function parseJevRankBody(body: Record<string, unknown>): JevRankInput | null {
  if (typeof body.kind !== "string" || !(body.kind in KIND_LABELS)) return null;
  if (
    typeof body.collectionTitle !== "string" ||
    !body.collectionTitle.trim() ||
    body.collectionTitle.length > 160
  )
    return null;
  if (!Array.isArray(body.works) || body.works.length < 1 || body.works.length > 255) return null;
  const works: JevWorkInput[] = [];
  for (const raw of body.works) {
    if (typeof raw !== "object" || raw === null) return null;
    const work = raw as Record<string, unknown>;
    if (typeof work.title !== "string" || !work.title.trim() || work.title.length > 200) return null;
    works.push({
      title: work.title,
      ...(typeof work.creator === "string" && work.creator
        ? { creator: work.creator.slice(0, 160) }
        : {}),
      ...(typeof work.year === "number" && Number.isFinite(work.year)
        ? { year: Math.trunc(work.year) }
        : {}),
    });
  }
  if (
    body.profileContext !== undefined &&
    (typeof body.profileContext !== "string" || body.profileContext.length > 4096)
  )
    return null;
  if (body.locale !== undefined && body.locale !== "zh" && body.locale !== "en") return null;
  return {
    kind: body.kind as JevKind,
    collectionTitle: body.collectionTitle,
    works,
    ...(typeof body.profileContext === "string" && body.profileContext
      ? { profileContext: body.profileContext }
      : {}),
    ...(body.locale === "en" ? { locale: "en" as const } : {}),
  };
}
