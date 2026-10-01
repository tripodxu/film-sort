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
      work.creator
        ? zh
          ? `创作者:${clean(work.creator, 120)}`
          : `by ${clean(work.creator, 120)}`
        : "",
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
    const meta = [work.year ? String(work.year) : "", work.creator ? clean(work.creator, 120) : ""]
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
  answers?: Record<
    string,
    {
      type?: string;
      noul?: number;
      choice?: string;
      confidence?: number;
      probabilities?: Record<string, number>;
    }
  >;
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
      {
        allowedHosts: ["api.typesafe.ai"],
        maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: 30_000,
        maxRedirects: 2,
      },
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof OutboundError && error.code === "timeout")
      throw new AiError("upstream_error", 504, "Jev upstream timeout");
    throw new AiError("upstream_error", 502, "Jev upstream unreachable");
  }
  if (response.status === 401 || response.status === 403)
    throw new AiError("upstream_auth_failed", 502, "TypeSafe API key rejected");
  if (response.status === 429)
    throw new AiError("upstream_rate_limited", 502, "TypeSafe rate limited");
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

/**
 * 多选一裁决（维基消歧用）：把 Choice 从「二选一」推广到「≤255 选一」。
 *
 * `jevPick` 是本函数的特例（两个候选），保持不动——辅助模式的每对比较很便宜，
 * 而消歧是「一次问清楚到底哪个候选才是用户要的那件」，两者调用频率差一个数量级。
 *
 * **调用铁律**：未配置 key / 调用失败 / 置信度低于调用方阈值时，
 * 一律回落既有规则路径——本函数永不成为主链路的单点（docs/agents/CONVENTIONS.md §3）。
 */
export interface JevChooseInput {
  /** state 里给模型的世界知识，例如「用户清单里写的是《Journey》(2012)」。 */
  question: string;
  /** 候选描述（≤255 项）。key 即模型返回的 choice 值。 */
  options: Array<{ key: string; description: string }>;
  locale?: "zh" | "en";
}

export interface JevChooseResult {
  model: string;
  pick: string;
  confidence: number;
  /** 每个候选的概率（缺失的键不出现）。 */
  probabilities: Record<string, number>;
  inputTokens: number;
}

const CHOICE_OPTION_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 校验并清洗多选一入参：候选 2–255 项（1 项无从「选」），key 必须可回传。 */
export function parseJevChooseBody(body: Record<string, unknown>): JevChooseInput | null {
  if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000)
    return null;
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 255)
    return null;
  if (body.locale !== undefined && body.locale !== "zh" && body.locale !== "en") return null;
  const options: Array<{ key: string; description: string }> = [];
  const seen = new Set<string>();
  for (const raw of body.options) {
    if (typeof raw !== "object" || raw === null) return null;
    const option = raw as Record<string, unknown>;
    if (typeof option.key !== "string" || !CHOICE_OPTION_KEY_RE.test(option.key)) return null;
    if (typeof option.description !== "string") return null;
    const description = option.description.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!description || seen.has(option.key)) return null;
    seen.add(option.key);
    options.push({ key: option.key, description });
  }
  return {
    question: body.question.trim(),
    options,
    ...(body.locale === "en" ? { locale: "en" as const } : {}),
  };
}

/**
 * Choice 多选一：返回带校准置信度的裁决结果。
 * 上游返回的 choice 必须是入参里出现过的 key，否则视为响应畸形（避免把
 * 模型幻觉出来的字符串当成有效裁决）。
 */
export async function jevChoose(
  input: JevChooseInput,
  config: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<JevChooseResult> {
  const zh = (input.locale ?? "zh") === "zh";
  const payload = {
    model: "jev-latest",
    state: input.question,
    questions: {
      which: {
        type: "choice",
        instructions: zh
          ? "以上哪一个才是用户要找的那件作品?判断依据：类型是否吻合、年份是否吻合、条目名是否就是那件作品本身。只依据候选描述判断。"
          : "Which of the above is the work the user is looking for? Judge by: does the kind match, does the year match, is the entry literally that work. Judge only from each candidate's own description.",
        criteria: Object.fromEntries(
          input.options.map((option) => [option.key, option.description]),
        ),
      },
    },
  };
  const body = await callSystemOne(payload, config.apiKey, fetchImpl);
  const answer = body.answers?.which;
  const pick = answer?.choice;
  const known = new Set(input.options.map((option) => option.key));
  if (typeof pick !== "string" || !known.has(pick))
    throw new AiError("upstream_error", 502, "Jev choose malformed");
  const probabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries(answer?.probabilities ?? {})) {
    if (known.has(key) && typeof value === "number" && value >= 0 && value <= 1)
      probabilities[key] = value;
  }
  const chosenProbability = probabilities[pick];
  const confidence =
    typeof answer?.confidence === "number" && answer.confidence >= 0 && answer.confidence <= 1
      ? answer.confidence
      : chosenProbability;
  if (typeof confidence !== "number")
    throw new AiError("upstream_error", 502, "Jev choose missing confidence");
  return {
    model: typeof body.model === "string" ? body.model : "jev",
    pick,
    confidence,
    probabilities,
    inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
  };
}

export interface JevPickInput {
  kind: JevKind;
  left: JevWorkInput;
  right: JevWorkInput;
  profileContext?: string;
  locale?: "zh" | "en";
}

export interface JevPickResult {
  model: string;
  pick: "left" | "right";
  confidence: number;
  probabilities: { left: number; right: number };
  inputTokens: number;
}

const cleanWork = (work: JevWorkInput): string => {
  const meta = [work.year ? String(work.year) : "", work.creator ? clean(work.creator, 120) : ""]
    .filter(Boolean)
    .join(", ");
  return `《${clean(work.title, 160)}》${meta ? `(${meta})` : ""}`;
};

/**
 * 1v1 取舍预测(辅助模式的原子判定):Choice 二选一,返回校准置信度。
 * 置信度由调用方设阈值——低于阈值不代判,交给用户。
 */
export async function jevPick(
  input: JevPickInput,
  config: { apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<JevPickResult> {
  const zh = (input.locale ?? "zh") === "zh";
  const kindLabel = KIND_LABELS[input.kind];
  const lines: string[] = [];
  if (input.profileContext) lines.push(`【用户品味档案】\n${clean(input.profileContext, 4096)}`);
  lines.push(
    zh
      ? `【当前取舍】两件${kindLabel}之间,这位用户只会保留一件。`
      : `【Decision】The user keeps only one of the two ${kindLabel}s.`,
  );
  const payload = {
    model: "jev-latest",
    state: lines.join("\n"),
    questions: {
      pick: {
        type: "choice",
        instructions: zh ? "这位用户会更想保留哪一件?" : "Which one would this user rather keep?",
        criteria: {
          left: cleanWork(input.left),
          right: cleanWork(input.right),
        },
      },
    },
  };
  const body = await callSystemOne(payload, config.apiKey, fetchImpl);
  const answer = body.answers?.pick;
  const pick = answer?.choice;
  if (pick !== "left" && pick !== "right")
    throw new AiError("upstream_error", 502, "Jev pick malformed");
  const rawProbabilities = answer?.probabilities ?? {};
  const probabilityOf = (side: "left" | "right") => {
    const value = rawProbabilities[side];
    return typeof value === "number" && value >= 0 && value <= 1 ? value : undefined;
  };
  const leftProbability = probabilityOf("left");
  const rightProbability = probabilityOf("right");
  // confidence 缺失时回退到「被选中一侧」的概率,而不是任意一侧
  const chosenProbability = pick === "right" ? rightProbability : leftProbability;
  const confidence =
    typeof answer?.confidence === "number" && answer.confidence >= 0 && answer.confidence <= 1
      ? answer.confidence
      : (chosenProbability ?? leftProbability ?? rightProbability);
  if (typeof confidence !== "number")
    throw new AiError("upstream_error", 502, "Jev pick missing confidence");
  return {
    model: typeof body.model === "string" ? body.model : "jev",
    pick,
    confidence,
    probabilities: {
      left: leftProbability ?? (pick === "left" ? 1 : 0),
      right: rightProbability ?? (pick === "right" ? 1 : 0),
    },
    inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : 0,
  };
}

export function parseJevPickBody(body: Record<string, unknown>): JevPickInput | null {
  if (typeof body.kind !== "string" || !(body.kind in KIND_LABELS)) return null;
  const parseWork = (raw: unknown): JevWorkInput | null => {
    if (typeof raw !== "object" || raw === null) return null;
    const work = raw as Record<string, unknown>;
    if (typeof work.title !== "string" || !work.title.trim() || work.title.length > 200)
      return null;
    return {
      title: work.title,
      ...(typeof work.creator === "string" && work.creator
        ? { creator: work.creator.slice(0, 160) }
        : {}),
      ...(typeof work.year === "number" && Number.isFinite(work.year)
        ? { year: Math.trunc(work.year) }
        : {}),
    };
  };
  const left = parseWork(body.left);
  const right = parseWork(body.right);
  if (!left || !right) return null;
  if (
    body.profileContext !== undefined &&
    (typeof body.profileContext !== "string" || body.profileContext.length > 4096)
  )
    return null;
  if (body.locale !== undefined && body.locale !== "zh" && body.locale !== "en") return null;
  return {
    kind: body.kind as JevKind,
    left,
    right,
    ...(typeof body.profileContext === "string" && body.profileContext
      ? { profileContext: body.profileContext }
      : {}),
    ...(body.locale === "en" ? { locale: "en" as const } : {}),
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
    if (typeof work.title !== "string" || !work.title.trim() || work.title.length > 200)
      return null;
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
