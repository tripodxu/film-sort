/**
 * Jev(TypeSafe)前端调用层:配置存取 + AI 快排请求。
 *
 * 与 aiInsight.ts 同一原则:配置只存本浏览器 localStorage;请求经同源
 * Worker 转发(Worker 不落盘 key);保留失败原因,不折叠成 null——
 * 界面要能说清「是限流、没配置,还是 key 错了」。
 */

export type JevErrorCode =
  | "invalid_config"
  | "invalid_data"
  | "rate_limited"
  | "upstream_auth_failed"
  | "upstream_rate_limited"
  | "upstream_error"
  | "unavailable";

export interface JevUserConfig {
  apiKey: string;
}

const CONFIG_KEY = "art-rank:typesafe-config";

export function readTypesafeConfig(): JevUserConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const cfg = raw as Record<string, unknown>;
    return typeof cfg.apiKey === "string" && cfg.apiKey ? { apiKey: cfg.apiKey } : null;
  } catch {
    return null;
  }
}

/** 返回 false 表示浏览器存储不可用(隐私模式),调用方应提示「仅本次会话有效」。 */
export function writeTypesafeConfig(config: JevUserConfig): boolean {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function clearTypesafeConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* 隐私模式 */
  }
}

/** 把已有榜单压成紧凑品味档案:每榜单一行 `[kind] 标题: 前二十名 > 分隔`,总长截断。 */
export function buildTasteContext(
  rankings: Array<{ kind: string; collectionTitle: string; items: Array<{ title: string }> }>,
  max = 4096,
): string {
  const lines = rankings.map(
    (ranking) =>
      `[${ranking.kind}] ${ranking.collectionTitle}: ${ranking.items
        .slice(0, 20)
        .map((item) => item.title)
        .join(" > ")}`,
  );
  return lines.join("\n").slice(0, max);
}

export interface JevRankInput {
  kind: string;
  collectionTitle: string;
  works: Array<{ id: string; title: string; creator?: string; year?: number }>;
  profileContext?: string;
  locale: "zh" | "en";
}

export interface JevRankSuccess {
  ok: true;
  model: string;
  /** works 数组的下标,按预测分降序;前端自行映射回作品 id。 */
  order: number[];
  scores: number[];
  inputTokens: number;
}
export interface JevFailure {
  ok: false;
  error: JevErrorCode;
  msg?: string;
}
export type JevRankResult = JevRankSuccess | JevFailure;

function failureFrom(
  response: Response,
  body: { error?: unknown; msg?: unknown } | null,
): JevFailure {
  const code = typeof body?.error === "string" ? (body.error as JevErrorCode) : "unavailable";
  return { ok: false, error: code, ...(typeof body?.msg === "string" ? { msg: body.msg } : {}) };
}

export async function testJevConfig(
  config: JevUserConfig,
): Promise<{ ok: true; model: string } | JevFailure> {
  try {
    const response = await fetch("/api/ai/jev/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(40000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && typeof body?.model === "string") return { ok: true, model: body.model };
    return failureFrom(response, body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function requestJevRanking(
  input: JevRankInput,
  config: JevUserConfig,
): Promise<JevRankResult> {
  try {
    const response = await fetch("/api/ai/jev-rank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, config }),
      signal: AbortSignal.timeout(40000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      response.ok &&
      body?.ok === true &&
      Array.isArray(body.order) &&
      Array.isArray(body.scores)
    ) {
      return {
        ok: true,
        model: typeof body.model === "string" ? body.model : "jev",
        order: (body.order as unknown[]).filter((n): n is number => typeof n === "number"),
        scores: (body.scores as unknown[]).filter((n): n is number => typeof n === "number"),
        inputTokens: typeof body.inputTokens === "number" ? body.inputTokens : 0,
      };
    }
    return failureFrom(response, body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

const FAILURE_MESSAGES: Record<JevErrorCode, [string, string]> = {
  invalid_config: [
    "TypeSafe API Key 不合法,请到「AI 服务」重新配置",
    "Invalid TypeSafe API key — reconfigure in AI services",
  ],
  invalid_data: ["作品数据不合法", "Invalid work data"],
  rate_limited: ["操作太频繁,请几分钟后再试", "Too many attempts — retry in a few minutes"],
  upstream_auth_failed: [
    "TypeSafe API Key 被拒绝,请检查 key",
    "TypeSafe API key rejected — check the key",
  ],
  upstream_rate_limited: ["Jev 服务限流,请稍后再试", "Jev is rate-limited — retry later"],
  upstream_error: ["Jev 服务暂时不可用,请稍后再试", "Jev is temporarily unavailable"],
  unavailable: ["AI 快排暂时不可用,请稍后再试", "AI quick rank is unavailable right now"],
};

export function jevFailureText(failure: JevFailure, t: (zh: string, en: string) => string): string {
  if (failure.msg) return failure.msg;
  const [zh, en] = FAILURE_MESSAGES[failure.error] ?? FAILURE_MESSAGES.unavailable;
  return t(zh, en);
}
