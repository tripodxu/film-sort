/**
 * AI 点评的前端调用层：配置存取、三场景数据组装、请求与失败分类。
 *
 * 与 `lib/gdMusic.ts` 同一原则：保留失败原因，不折叠成 null——
 * 界面要能说清「是限流、没配置，还是 key 错了」。
 * 配置（三参数 + 可选协议）只存本浏览器 localStorage；不配置时走服务端内置通道。
 */

import type { MediaKind } from "../data/media";
import type { ArtisticProfile, DimensionComparison, RankingExport } from "./profile";

export type AiScene = "ranking" | "profile" | "compare";
export type AiLocale = "zh" | "en";
export type AiLength = "brief" | "standard" | "deep";
export type AiProtocol = "auto" | "chat" | "responses" | "anthropic" | "gemini";

export type AiErrorCode =
  | "ai_not_configured"
  | "invalid_config"
  | "invalid_data"
  | "data_too_large"
  | "rate_limited"
  | "upstream_auth_failed"
  | "upstream_not_found"
  | "upstream_rate_limited"
  | "upstream_error"
  | "unavailable";

export interface AiUserConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: AiProtocol;
}

export interface AiInsightSuccess {
  ok: true;
  insight: string;
  source: "builtin" | "custom";
  model: string;
  promptVersion: number | "override";
}

export interface AiInsightFailure {
  ok: false;
  error: AiErrorCode;
  msg?: string;
  retryAfter?: number;
}

export type AiInsightResult = AiInsightSuccess | AiInsightFailure;

const CONFIG_KEY = "art-rank:ai-config";
const LENGTH_KEY = "art-rank:ai-length";
const PROTOCOLS: AiProtocol[] = ["auto", "chat", "responses", "anthropic", "gemini"];

// ===== 配置存取（隐私模式下静默降级）=====

export function readAiConfig(): AiUserConfig | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const cfg = raw as Record<string, unknown>;
    if (
      typeof cfg.baseUrl !== "string" ||
      typeof cfg.apiKey !== "string" ||
      typeof cfg.model !== "string" ||
      !cfg.baseUrl ||
      !cfg.apiKey ||
      !cfg.model
    )
      return null;
    const protocol = cfg.protocol as AiProtocol | undefined;
    return {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      ...(protocol && PROTOCOLS.includes(protocol) ? { protocol } : {}),
    };
  } catch {
    return null;
  }
}

/** 返回 false 表示浏览器存储不可用（隐私模式），调用方应提示「仅本次会话有效」。 */
export function writeAiConfig(config: AiUserConfig): boolean {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

export function clearAiConfig(): void {
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* 隐私模式 */
  }
}

export function readAiLength(): AiLength {
  try {
    const value = localStorage.getItem(LENGTH_KEY);
    return value === "brief" || value === "deep" ? value : "standard";
  } catch {
    return "standard";
  }
}

export function writeAiLength(length: AiLength): void {
  try {
    localStorage.setItem(LENGTH_KEY, length);
  } catch {
    /* 隐私模式 */
  }
}

// ===== 三场景数据组装（截断规则与 docs/PLAN-ai-insights.md §6.5 一致）=====

export interface AiRankingData {
  profileName: string;
  kind: MediaKind;
  collectionTitle: string;
  itemCount: number;
  works: Array<{ rank: number; title: string; creator?: string; year?: number }>;
}

export function buildRankingData(ranking: RankingExport, profileName: string): AiRankingData {
  return {
    profileName,
    kind: ranking.kind,
    collectionTitle: ranking.collectionTitle,
    itemCount: ranking.items.length,
    works: ranking.items.slice(0, 150).map((item) => ({
      rank: item.rank,
      title: item.title,
      ...(item.creator ? { creator: item.creator } : {}),
      ...(item.year ? { year: item.year } : {}),
    })),
  };
}

export interface AiProfileData {
  profileName: string;
  rankings: Array<{
    kind: MediaKind;
    collectionTitle: string;
    itemCount: number;
    top: Array<{ rank: number; title: string; creator?: string; year?: number }>;
  }>;
  stats: {
    totalWorks: number;
    kindsCount: number;
    topCreators: Array<{ name: string; count: number }>;
  };
}

export function buildProfileData(profile: ArtisticProfile): AiProfileData {
  const creatorCount = new Map<string, number>();
  let totalWorks = 0;
  const kinds = new Set<string>();
  for (const ranking of profile.rankings) {
    totalWorks += ranking.items.length;
    kinds.add(ranking.kind);
    for (const item of ranking.items) {
      const creator = (item.creator ?? "").split("/")[0].trim();
      if (!creator) continue;
      creatorCount.set(creator, (creatorCount.get(creator) ?? 0) + 1);
    }
  }
  return {
    profileName: profile.profileName,
    rankings: profile.rankings.slice(0, 20).map((ranking) => ({
      kind: ranking.kind,
      collectionTitle: ranking.collectionTitle,
      itemCount: ranking.items.length,
      top: ranking.items.slice(0, 15).map((item) => ({
        rank: item.rank,
        title: item.title,
        ...(item.creator ? { creator: item.creator } : {}),
        ...(item.year ? { year: item.year } : {}),
      })),
    })),
    stats: {
      totalWorks,
      kindsCount: kinds.size,
      topCreators: [...creatorCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count })),
    },
  };
}

export interface AiCompareData {
  ownName: string;
  peerName: string;
  crossAgreement: number | null;
  media: Array<{
    kind: MediaKind;
    overlap: number;
    orderAgreement: number | null;
    consensusScore: number;
    kendallTau: number | null;
    sharedTop: string[];
    onlyOwnCount: number;
    onlyPeerCount: number;
    biggestGap: { title: string; ownRank: number; peerRank: number } | null;
  }>;
}

export function buildCompareData(own: {
  ownName: string;
  peerName: string;
  kind: MediaKind;
  result: DimensionComparison;
  crossAgreement: number | null;
}): AiCompareData {
  const { ownName, peerName, kind, result, crossAgreement } = own;
  const biggest = result.disagreements[0];
  return {
    ownName,
    peerName,
    crossAgreement,
    media: [
      {
        kind,
        overlap: result.overlap,
        orderAgreement: result.orderAgreement,
        consensusScore: result.consensusScore,
        kendallTau: result.kendallTau,
        sharedTop: result.shared.slice(0, 5).map((item) => item.title),
        onlyOwnCount: result.onlyOwn.length,
        onlyPeerCount: result.onlyPeer.length,
        biggestGap: biggest
          ? { title: biggest.title, ownRank: biggest.ownRank, peerRank: biggest.peerRank }
          : null,
      },
    ],
  };
}

// ===== 请求与会话内缓存 =====

const insightCache = new Map<string, AiInsightSuccess>();

export function clearInsightCache(): void {
  insightCache.clear();
}

/** 缓存键（内容签名）：data 用 JSON 序列化，引用变化但内容相同不产生新键。 */
export function cacheKeyOf(
  scene: AiScene,
  data: unknown,
  locale: AiLocale,
  length: AiLength,
): string {
  return `${scene}|${locale}|${length}|${JSON.stringify(data)}`;
}

/** 按完整缓存键直查——供组件以稳定 key 订阅缓存而不必把 data 放进 effect 依赖。 */
export function peekInsight(fullKey: string): AiInsightSuccess | null {
  return insightCache.get(fullKey) ?? null;
}

export function getCachedInsight(
  scene: AiScene,
  data: unknown,
  locale: AiLocale,
  length: AiLength,
): AiInsightSuccess | null {
  return insightCache.get(cacheKeyOf(scene, data, locale, length)) ?? null;
}

export async function requestInsight(
  scene: AiScene,
  data: unknown,
  opts: { locale: AiLocale; length: AiLength; config?: AiUserConfig | null; force?: boolean },
): Promise<AiInsightResult> {
  const { locale, length, config, force } = opts;
  const key = cacheKeyOf(scene, data, locale, length);
  if (!force) {
    const cached = insightCache.get(key);
    if (cached) return cached;
  }
  try {
    const response = await fetch("/api/insights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scene,
        data,
        locale,
        length,
        ...(config ? { config } : {}),
      }),
      // 服务端默认 60s（推理模型），前端留 10s 余量。
      signal: AbortSignal.timeout(70000),
    });
    if (response.ok) {
      const body = (await response.json()) as {
        insight?: unknown;
        source?: unknown;
        model?: unknown;
        promptVersion?: unknown;
      };
      if (typeof body.insight !== "string" || !body.insight)
        return { ok: false, error: "upstream_error" };
      const result: AiInsightSuccess = {
        ok: true,
        insight: body.insight,
        source: body.source === "custom" ? "custom" : "builtin",
        model: typeof body.model === "string" ? body.model : "",
        promptVersion:
          body.promptVersion === "override" || typeof body.promptVersion === "number"
            ? body.promptVersion
            : "override",
      };
      insightCache.set(key, result);
      return result;
    }
    const retryAfter = Number(response.headers.get("retry-after")) || 0;
    if (response.status === 429) return { ok: false, error: "rate_limited", retryAfter };
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      msg?: unknown;
    } | null;
    const code =
      typeof body?.error === "string" && body.error !== "invalid_scene"
        ? (body.error as AiErrorCode)
        : "unavailable";
    return {
      ok: false,
      error: code,
      ...(typeof body?.msg === "string" ? { msg: body.msg } : {}),
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function testAiConfig(
  config: AiUserConfig,
): Promise<{ ok: true; model: string; protocol: string } | AiInsightFailure> {
  try {
    const response = await fetch("/api/ai/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && body?.ok === true)
      return {
        ok: true,
        model: typeof body.model === "string" ? body.model : "",
        protocol: typeof body.protocol === "string" ? body.protocol : "",
      };
    return failureFrom(response.status, body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export async function fetchAiModels(
  config: AiUserConfig,
): Promise<
  { ok: true; protocol: string; models: string[]; truncated: boolean } | AiInsightFailure
> {
  try {
    const response = await fetch("/api/ai/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.ok && body?.ok === true && Array.isArray(body.models))
      return {
        ok: true,
        protocol: typeof body.protocol === "string" ? body.protocol : "",
        models: body.models.filter((m): m is string => typeof m === "string"),
        truncated: body.truncated === true,
      };
    return failureFrom(response.status, body);
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

function failureFrom(status: number, body: Record<string, unknown> | null): AiInsightFailure {
  if (status === 429) return { ok: false, error: "rate_limited" };
  const code = typeof body?.error === "string" ? (body.error as AiErrorCode) : "unavailable";
  return {
    ok: false,
    error: code,
    ...(typeof body?.msg === "string" ? { msg: body.msg } : {}),
  };
}
