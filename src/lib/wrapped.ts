// 文化年度报告（优化冲刺 Phase 7）的数据侧纯函数。
// 数据边界（设计前已确认）：decisionLog / cycleEvents 只存在于进行中排序草稿
// （art-rank:draft:v2 的全量 RankingState 序列化），完成的画像里没有——
// 年鉴卡主体用画像统计（复用 galleryStats），取舍与张力从草稿条件性附加。
import type { MediaKind } from "../data/media";
import type { ArtisticProfile } from "./profile";
import { decadeSlices, kindCounts, profileStats } from "./galleryStats";

export interface WrappedMediaShare {
  kind: MediaKind;
  count: number;
  /** 占作品总数的百分比（四舍五入；各媒介之和可能 ±1，展示层不做强制归一）。 */
  pct: number;
}

export interface WrappedTornPair {
  a: string;
  b: string;
  /** 该对被观测到的偏好反转次数（越多 = 越纠结）。 */
  flips: number;
}

export interface WrappedDraftInsight {
  /** 本次排序的真实取舍次数（RankingState.comparisonCount）。 */
  comparisons: number;
  tornPair: WrappedTornPair | null;
}

/** 草稿解析所需的最小字段集——防御式读取，形状不对一律返回 null。 */
export interface DraftLike {
  comparisonCount?: unknown;
  cycleEvents?: unknown;
}

export interface WrappedStats {
  lists: number;
  works: number;
  creators: number;
  span: { earliest: number | null; latest: number | null };
  /** 按作品数降序；count=0 的媒介不出现。 */
  mediaShare: WrappedMediaShare[];
  /** 按件数降序的前若干年代（decade=null 的「无年份」桶不占榜）。 */
  topDecades: Array<{ decade: number; count: number }>;
}

export function buildWrappedStats(profile: Pick<ArtisticProfile, "rankings">): WrappedStats {
  const stats = profileStats(profile);
  const total = stats.works;
  const mediaShare = kindCounts(profile)
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      kind: entry.kind,
      count: entry.count,
      pct: total > 0 ? Math.round((entry.count / total) * 100) : 0,
    }));
  const topDecades = decadeSlices(profile.rankings.flatMap((r) => r.items))
    .filter((slice): slice is { decade: number; count: number } => slice.decade !== null)
    .sort((a, b) => b.count - a.count || (a.decade ?? 0) - (b.decade ?? 0))
    .slice(0, 6);
  return {
    lists: stats.lists,
    works: stats.works,
    creators: stats.creators,
    span: stats.span,
    mediaShare,
    topDecades,
  };
}

/**
 * 从草稿状态提取「取舍次数 + 最纠结一对」。
 * 最纠结 = cycleEvents 里 observations 最高的成员对（反转越多越纠结）；
 * observations < 2 的单次回环不算「纠结」。titleOf 负责把作品 id 解析成标题，
 * 解析不到的成员让该回环不可展示（宁缺毋错）。
 */
export function draftInsight(
  draft: DraftLike,
  titleOf: (id: string) => string | undefined,
): WrappedDraftInsight | null {
  if (typeof draft.comparisonCount !== "number" || draft.comparisonCount < 0) return null;
  const events = Array.isArray(draft.cycleEvents) ? draft.cycleEvents : [];
  let best: WrappedTornPair | null = null;
  for (const event of events) {
    if (typeof event !== "object" || event === null) continue;
    const e = event as { memberIds?: unknown; observations?: unknown };
    if (!Array.isArray(e.memberIds) || e.memberIds.length < 2) continue;
    const observations = typeof e.observations === "number" ? e.observations : 0;
    if (observations < 2) continue;
    const a = titleOf(String(e.memberIds[0]));
    const b = titleOf(String(e.memberIds[1]));
    if (!a || !b) continue;
    if (!best || observations > best.flips) best = { a, b, flips: observations };
  }
  return { comparisons: draft.comparisonCount, tornPair: best };
}

/**
 * 读取进行中草稿（art-rank:draft:v2 → { collection, ranking, profileName }），
 * ranking 是 RankingState 的 JSON 串；最小字段防御解析，无草稿/形状不对返回 null。
 */
export function readDraftLike(storage: Pick<Storage, "getItem">): DraftLike | null {
  try {
    const raw = storage.getItem("art-rank:draft:v2");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ranking?: unknown };
    const state =
      typeof parsed.ranking === "string" ? (JSON.parse(parsed.ranking) as unknown) : parsed.ranking;
    if (typeof state !== "object" || state === null) return null;
    return state as DraftLike;
  } catch {
    return null;
  }
}

export type { MediaKind };
