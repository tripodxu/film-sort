// gallery 主题（PLAN-ui-modernization P3）的数据侧纯函数。
// 铁律：只读现有 profile 结构，零数据层改动——雷达/分布/坐标全部从
// ArtisticProfile 现场聚合，不落库、不进任何浏览器存储。
import type { MediaKind } from "../data/media";
import type { ArtisticProfile, RankedArtwork } from "./profile";

/** 雷达图的固定轴序：四种媒介恒全量给出（缺失维度计 0），轴数稳定才能比较。 */
export const GALLERY_KINDS: readonly MediaKind[] = ["film", "book", "music", "other"];

export interface KindCount {
  kind: MediaKind;
  count: number;
}

/** 各媒介作品数（全画像聚合）。 */
export function kindCounts(profile: Pick<ArtisticProfile, "rankings">): KindCount[] {
  const table = new Map<MediaKind, number>(GALLERY_KINDS.map((kind) => [kind, 0]));
  for (const ranking of profile.rankings) {
    const current = table.get(ranking.kind);
    if (current !== undefined) table.set(ranking.kind, current + ranking.items.length);
  }
  return GALLERY_KINDS.map((kind) => ({ kind, count: table.get(kind) ?? 0 }));
}

export interface DecadeSlice {
  /** 十年代起点（1994 → 1990）；无年份的作品归 null 桶，排在最后。 */
  decade: number | null;
  count: number;
}

/** 年代分桶，按年代升序。 */
export function decadeSlices(items: readonly RankedArtwork[]): DecadeSlice[] {
  const table = new Map<number | null, number>();
  for (const item of items) {
    const decade = typeof item.year === "number" ? Math.floor(item.year / 10) * 10 : null;
    table.set(decade, (table.get(decade) ?? 0) + 1);
  }
  return [...table.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    })
    .map(([decade, count]) => ({ decade, count }));
}

export interface DecadeSpan {
  earliest: number | null;
  latest: number | null;
}

/** 作品年份跨度（忽略无年份作品）。 */
export function decadeSpan(items: readonly RankedArtwork[]): DecadeSpan {
  let earliest: number | null = null;
  let latest: number | null = null;
  for (const item of items) {
    if (typeof item.year !== "number") continue;
    if (earliest === null || item.year < earliest) earliest = item.year;
    if (latest === null || item.year > latest) latest = item.year;
  }
  return { earliest, latest };
}

/** 去重创作者数（trim 后大小写不敏感；空创作者不计）。 */
export function creatorCount(items: readonly RankedArtwork[]): number {
  const seen = new Set<string>();
  for (const item of items) {
    const name = item.creator?.trim().toLocaleLowerCase();
    if (name) seen.add(name);
  }
  return seen.size;
}

export interface ProfileStats {
  works: number;
  lists: number;
  creators: number;
  span: DecadeSpan;
}

/** 口味坐标格的四项关键数。 */
export function profileStats(profile: Pick<ArtisticProfile, "rankings">): ProfileStats {
  const items = profile.rankings.flatMap((ranking) => ranking.items);
  return {
    works: items.length,
    lists: profile.rankings.length,
    creators: creatorCount(items),
    span: decadeSpan(items),
  };
}
