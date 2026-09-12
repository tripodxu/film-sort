import { mediaLabels, type Artwork, type MediaKind } from "../data/media";

export interface RankedArtwork extends Artwork { rank: number }
export interface RankingExport {
  version: 1;
  profileId: string;
  profileName: string;
  kind: MediaKind;
  collectionTitle: string;
  createdAt: string;
  items: RankedArtwork[];
}
export interface ArtisticProfile {
  version: 2;
  profileId: string;
  profileName: string;
  updatedAt: string;
  rankings: RankingExport[];
}

export const LIBRARY_KEY = "art-rank:library:v2";
export const MAX_PROFILE_BYTES = 512 * 1024;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 160): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export const normalizeTitle = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const validDate = (value: unknown): value is string => typeof value === "string" && value.length < 40 && Number.isFinite(Date.parse(value));
const validUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
};

function parseRanking(value: unknown): RankingExport {
  if (!record(value) || value.version !== 1 || !text(value.profileId) || !text(value.profileName, 80) ||
    !text(value.collectionTitle) || !Object.hasOwn(mediaLabels, String(value.kind)) || !validDate(value.createdAt) ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 300) throw new Error("Invalid ranking");
  const ids = new Set<string>();
  const titles = new Set<string>();
  const ranks = new Set<number>();
  const items = value.items.map((item): RankedArtwork => {
    if (!record(item) || !text(item.id) || !text(item.title) || !Number.isInteger(item.rank) ||
      Number(item.rank) < 1 || Number(item.rank) > (value.items as unknown[]).length || ids.has(item.id) || ranks.has(Number(item.rank)) ||
      (item.creator !== undefined && !text(item.creator)) || (item.year !== undefined && (!Number.isInteger(item.year) || Number(item.year) < 1 || Number(item.year) > 2200))) throw new Error("Invalid artwork");
    const identity = `${normalizeTitle(item.title)}|${item.year ?? ""}|${normalizeTitle(String(item.creator ?? ""))}`;
    if (titles.has(identity)) throw new Error("Duplicate artwork");
    ids.add(item.id); titles.add(identity); ranks.add(Number(item.rank));
    return {
      id: item.id, title: item.title.trim(), rank: Number(item.rank),
      ...(item.creator ? { creator: String(item.creator) } : {}),
      ...(item.year ? { year: Number(item.year) } : {}),
      ...(text(item.subtitle) ? { subtitle: item.subtitle } : {}),
      ...(Array.isArray(item.posterUrls) ? { posterUrls: item.posterUrls.filter(validUrl).slice(0, 8) } : {}),
    };
  }).sort((a, b) => a.rank - b.rank);
  if (items.some((item, index) => item.rank !== index + 1)) throw new Error("Ranks must be contiguous");
  return { version: 1, profileId: value.profileId, profileName: value.profileName, kind: value.kind as MediaKind, collectionTitle: value.collectionTitle, createdAt: value.createdAt, items };
}

export function parseProfile(value: unknown): ArtisticProfile {
  if (!record(value)) throw new Error("Invalid profile");
  if (value.version === 1) {
    const ranking = parseRanking(value);
    return { version: 2, profileId: ranking.profileId, profileName: ranking.profileName, updatedAt: ranking.createdAt, rankings: [ranking] };
  }
  if (value.version !== 2 || !text(value.profileId) || !text(value.profileName, 80) || !validDate(value.updatedAt) ||
    !Array.isArray(value.rankings) || value.rankings.length < 1 || value.rankings.length > 20) throw new Error("Invalid profile");
  const rankings = value.rankings.map(parseRanking);
  return { version: 2, profileId: value.profileId, profileName: value.profileName, updatedAt: value.updatedAt, rankings };
}

export function readProfile(storage: Storage): ArtisticProfile | null {
  try {
    const stored = storage.getItem(LIBRARY_KEY);
    if (stored) return parseProfile(JSON.parse(stored));
    // Migrate earlier single-medium exports by timestamp, never by storage key order.
    const legacy: RankingExport[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith("art-rank:profile:")) continue;
      try { legacy.push(...parseProfile(JSON.parse(storage.getItem(key) ?? "")).rankings); } catch { /* Ignore unrelated name preferences. */ }
    }
    return legacy.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).reduce<ArtisticProfile | null>((profile, ranking) => mergeRanking(profile, ranking), null);
  } catch { return null; }
}

export function mergeRanking(profile: ArtisticProfile | null, ranking: RankingExport): ArtisticProfile {
  const existing = profile?.rankings ?? [];
  // Replace if same collectionTitle+kind exists, otherwise append
  const key = (r: RankingExport) => `${r.kind}|${r.collectionTitle}`;
  const rankingKey = key(ranking);
  const filtered = existing.filter((entry) => key(entry) !== rankingKey);
  return {
    version: 2, profileId: profile?.profileId ?? crypto.randomUUID(), profileName: ranking.profileName,
    updatedAt: ranking.createdAt,
    rankings: [...filtered, ranking].sort((a, b) => Object.keys(mediaLabels).indexOf(a.kind) - Object.keys(mediaLabels).indexOf(b.kind)),
  };
}

export function reorderRanking(profile: ArtisticProfile, rankingIdx: number, newOrder: string[]): ArtisticProfile {
  const ranking = profile.rankings[rankingIdx];
  if (!ranking) return profile;
  const byId = new Map(ranking.items.map((item) => [item.id, item]));
  const reordered = newOrder.map((id, index) => {
    const item = byId.get(id);
    if (!item) return null;
    return { ...item, rank: index + 1 };
  }).filter(Boolean) as RankedArtwork[];
  if (reordered.length !== ranking.items.length) return profile;
  const rankings = [...profile.rankings];
  rankings[rankingIdx] = { ...ranking, items: reordered };
  return { ...profile, rankings, updatedAt: new Date().toISOString() };
}

export function renameRanking(profile: ArtisticProfile, index: number, newTitle: string): ArtisticProfile {
  const rankings = [...profile.rankings];
  if (index < 0 || index >= rankings.length) return profile;
  rankings[index] = { ...rankings[index], collectionTitle: newTitle };
  return { ...profile, rankings, updatedAt: new Date().toISOString() };
}

export function deleteRanking(profile: ArtisticProfile, index: number): ArtisticProfile | null {
  const rankings = profile.rankings.filter((_, i) => i !== index);
  if (rankings.length === 0) return null;
  return { ...profile, rankings, updatedAt: new Date().toISOString() };
}

export function mergeProfiles(cloud: ArtisticProfile, local: ArtisticProfile): ArtisticProfile {
  const key = (r: RankingExport) => `${r.kind}|${normalizeTitle(r.collectionTitle)}`;
  const existingKeys = new Set(cloud.rankings.map(key));
  const existingTitles = new Set(cloud.rankings.map((r) => r.collectionTitle));
  const appended: RankingExport[] = [];
  for (const ranking of local.rankings) {
    if (existingKeys.has(key(ranking))) {
      // Same kind+title exists — disambiguate with suffix
      let suffix = 2;
      let candidate = `${ranking.collectionTitle}（${suffix}）`;
      while (existingTitles.has(candidate)) { suffix += 1; candidate = `${ranking.collectionTitle}（${suffix}）`; }
      existingTitles.add(candidate);
      appended.push({ ...ranking, collectionTitle: candidate });
    } else {
      appended.push(ranking);
      existingTitles.add(ranking.collectionTitle);
    }
  }
  return {
    ...cloud,
    updatedAt: new Date().toISOString(),
    rankings: [...cloud.rankings, ...appended],
  };
}

// ========== 合并维度：同一维度下多个榜单合并，同作品取最高名次 ==========

export interface MergedItem {
  title: string;
  bestRank: number;
  creator?: string;
  year?: number;
  id?: string;           // 外部 ID（最强匹配依据）
  sources: Array<{ collectionTitle: string; rank: number }>;
  representative: RankedArtwork;
}

export interface MergedDimension {
  kind: MediaKind;
  items: MergedItem[];
  sourceRankings: string[];  // 合并了哪些榜单
}

export function mergeDimensionRankings(rankings: RankingExport[]): MergedDimension | null {
  if (rankings.length === 0) return null;
  const kind = rankings[0].kind;
  const byKey = new Map<string, MergedItem>();

  for (const ranking of rankings) {
    for (const item of ranking.items) {
      const key = normalizeTitle(item.title) + "|" + (item.year ?? "") + "|" + normalizeTitle(item.creator ?? "");
      const existing = byKey.get(key);
      if (existing) {
        existing.sources.push({ collectionTitle: ranking.collectionTitle, rank: item.rank });
        if (item.rank < existing.bestRank) {
          existing.bestRank = item.rank;
          existing.representative = item;
        }
      } else {
        byKey.set(key, {
          title: item.title, bestRank: item.rank,
          creator: item.creator, year: item.year, id: item.id,
          sources: [{ collectionTitle: ranking.collectionTitle, rank: item.rank }],
          representative: item,
        });
      }
    }
  }

  const items = [...byKey.values()].sort((a, b) => a.bestRank - b.bestRank);
  return { kind, items, sourceRankings: rankings.map((r) => r.collectionTitle) };
}

// ========== 匹配评分 ==========

function matchScore(a: MergedItem, b: MergedItem): number {
  const titleA = normalizeTitle(a.title);
  const titleB = normalizeTitle(b.title);
  if (titleA !== titleB) return 0;

  const yearA = a.year, yearB = b.year;
  const creatorA = a.creator ? normalizeTitle(a.creator) : undefined;
  const creatorB = b.creator ? normalizeTitle(b.creator) : undefined;

  const yearBoth = yearA !== undefined && yearB !== undefined;
  const creatorBoth = creatorA !== undefined && creatorB !== undefined;

  // 双方信息明确但冲突 → 不匹配
  if (yearBoth && yearA !== yearB) return 0;
  if (creatorBoth && creatorA !== creatorB) return 0;

  // 双方信息一致
  if (yearBoth && creatorBoth) return 90;
  if (yearBoth || creatorBoth) return 80;

  // 一方有信息另一方缺失 → 可匹配但低优先级
  if (yearA !== undefined || yearB !== undefined) return 75;
  if (creatorA !== undefined || creatorB !== undefined) return 75;

  // 仅标题匹配
  return 70;
}

// ========== 贪心匹配 ==========

export interface MatchedItem {
  title: string;
  ownRank: number;
  peerRank: number;
  difference: number;
  matchScore: number;
  ownSources: MergedItem["sources"];
  peerSources: MergedItem["sources"];
  ownItem?: RankedArtwork;
  peerItem?: RankedArtwork;
}

export interface DimensionComparison {
  shared: MatchedItem[];
  onlyOwn: MergedItem[];
  onlyPeer: MergedItem[];
  // 指标
  overlap: number;
  orderAgreement: number | null;
  top5Overlap: number;
  disagreements: MatchedItem[];
  sharedCount: number;
  coverage: number;
  weightedTopAgreement: number;
  rankDistance: number;
  spearmanLikeAgreement: number | null;
  championAgreement: boolean | null;
  top3Agreement: number;
  commonPreference: string;
  divergence: string;
}

function greedyMatch(ownItems: MergedItem[], peerItems: MergedItem[]): MatchedItem[] {
  // 生成所有候选对及其评分
  const candidates: Array<{ oi: number; pi: number; score: number; rankDiff: number }> = [];
  for (let oi = 0; oi < ownItems.length; oi++) {
    for (let pi = 0; pi < peerItems.length; pi++) {
      const score = matchScore(ownItems[oi], peerItems[pi]);
      if (score >= 70) {
        candidates.push({ oi, pi, score, rankDiff: Math.abs(ownItems[oi].bestRank - peerItems[pi].bestRank) });
      }
    }
  }

  // 按评分降序、排名差升序排列
  candidates.sort((a, b) => b.score - a.score || a.rankDiff - b.rankDiff);

  const usedOwn = new Set<number>();
  const usedPeer = new Set<number>();
  const matched: MatchedItem[] = [];

  for (const c of candidates) {
    if (usedOwn.has(c.oi) || usedPeer.has(c.pi)) continue;
    usedOwn.add(c.oi);
    usedPeer.add(c.pi);
    const o = ownItems[c.oi], p = peerItems[c.pi];
    matched.push({
      title: o.title, ownRank: o.bestRank, peerRank: p.bestRank,
      difference: Math.abs(o.bestRank - p.bestRank), matchScore: c.score,
      ownSources: o.sources, peerSources: p.sources,
      ownItem: o.representative, peerItem: p.representative,
    });
  }

  return matched.sort((a, b) => a.ownRank - b.ownRank);
}

// ========== 单维度比较 ==========

export function compareDimensions(own: MergedDimension, peer: MergedDimension): DimensionComparison {
  const shared = greedyMatch(own.items, peer.items);
  const matchedOwn = new Set(shared.map((s) => s.ownRank));
  const matchedPeer = new Set(shared.map((s) => s.peerRank));
  const onlyOwn = own.items.filter((item) => !matchedOwn.has(item.bestRank));
  const onlyPeer = peer.items.filter((item) => !matchedPeer.has(item.bestRank));

  // 序对一致率：多榜单合并取最优名次会产生并列（同为第1等），
  // 含并列的序对无法判定先后，剔除后再计算（否则相同画像会得到 <100% 的一致率）
  let agreements = 0, pairs = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const rankDiffOwn = shared[i].ownRank - shared[j].ownRank;
      const rankDiffPeer = shared[i].peerRank - shared[j].peerRank;
      if (rankDiffOwn === 0 || rankDiffPeer === 0) continue;
      pairs++;
      if (rankDiffOwn * rankDiffPeer > 0) agreements++;
    }
  }

  const unionCount = own.items.length + peer.items.length - shared.length;
  const maxRank = Math.max(own.items.length, peer.items.length, 1);
  const rankDistance = shared.length
    ? Math.round(100 * shared.reduce((s, m) => s + m.difference, 0) / (shared.length * maxRank))
    : 0;

  const weightedTotal = shared.reduce((s, m) => s + 1 / m.ownRank + 1 / m.peerRank, 0);
  const weightedAgreement = shared.length
    ? shared.reduce((s, m) => s + Math.min(1 / m.ownRank, 1 / m.peerRank), 0) / (weightedTotal / 2 || 1)
    : 0;

  const n = shared.length;
  const squaredDistance = shared.reduce((s, m) => s + (m.ownRank - m.peerRank) ** 2, 0);
  const spearmanLikeAgreement = n < 2 ? null : Math.max(0, Math.round(100 * (1 - (6 * squaredDistance) / (n * (n * n - 1)))));
  const top3Overlap = shared.filter((m) => m.ownRank <= 3 && m.peerRank <= 3).length;
  const closest = [...shared].sort((a, b) => a.difference - b.difference).slice(0, 3).map((m) => m.title).join("、");
  const biggest = [...shared].sort((a, b) => b.difference - a.difference)[0]?.title ?? "暂无共同作品";

  return {
    shared, onlyOwn, onlyPeer,
    overlap: unionCount ? Math.round(100 * shared.length / unionCount) : 0,
    orderAgreement: pairs ? Math.round(100 * agreements / pairs) : null,
    top5Overlap: shared.filter((m) => m.ownRank <= 5 && m.peerRank <= 5).length,
    disagreements: shared.filter((m) => m.difference > 0).sort((a, b) => b.difference - a.difference).slice(0, 5),
    sharedCount: shared.length,
    coverage: Math.min(100, Math.round(100 * shared.length / Math.max(1, Math.min(own.items.length, peer.items.length)))),
    weightedTopAgreement: Math.round(weightedAgreement * 100),
    rankDistance, spearmanLikeAgreement,
    championAgreement: shared.length ? shared.some((m) => m.ownRank === 1 && m.peerRank === 1) : null,
    top3Agreement: top3Overlap,
    commonPreference: closest || "暂无共同作品",
    divergence: biggest,
  };
}

// ========== 兼容旧接口：单榜单比较 ==========

export type RankingComparisonItem = MatchedItem;
export type RankingComparison = DimensionComparison;

export function compareRankings(own: RankingExport, peer: RankingExport): DimensionComparison {
  const ownMerged = mergeDimensionRankings([own])!;
  const peerMerged = mergeDimensionRankings([peer])!;
  return compareDimensions(ownMerged, peerMerged);
}

// ========== 跨维度比较 ==========

export interface ProfileComparison {
  sharedKinds: MediaKind[];
  comparisons: Array<{ kind: MediaKind; result: DimensionComparison }>;
  mediumCoverage: number;
  sharedWorks: number;
  crossMediumAgreement: number | null;
  overlap: number;
}

export function compareProfiles(own: ArtisticProfile, peer: ArtisticProfile): ProfileComparison {
  const allKinds = Object.keys(mediaLabels) as MediaKind[];
  const sharedKinds = allKinds.filter((kind) =>
    own.rankings.some((r) => r.kind === kind) && peer.rankings.some((r) => r.kind === kind),
  );

  const comparisons = sharedKinds.map((kind) => {
    const ownRankings = own.rankings.filter((r) => r.kind === kind);
    const peerRankings = peer.rankings.filter((r) => r.kind === kind);
    const ownMerged = mergeDimensionRankings(ownRankings)!;
    const peerMerged = mergeDimensionRankings(peerRankings)!;
    return { kind, result: compareDimensions(ownMerged, peerMerged) };
  });

  const sharedWorks = comparisons.reduce((sum, e) => sum + e.result.sharedCount, 0);
  const totalWorks = Math.max(1,
    own.rankings.reduce((s, r) => s + r.items.length, 0) +
    peer.rankings.reduce((s, r) => s + r.items.length, 0),
  );

  return {
    sharedKinds, comparisons,
    mediumCoverage: Math.round(100 * sharedKinds.length / Math.max(1, Math.max(own.rankings.length, peer.rankings.length))),
    sharedWorks,
    crossMediumAgreement: comparisons.length
      ? Math.round(comparisons.reduce((s, e) => s + e.result.weightedTopAgreement, 0) / comparisons.length)
      : null,
    overlap: Math.round(100 * sharedWorks / totalWorks),
  };
}

export function profileText(profile: ArtisticProfile, format: "txt" | "md" | "csv", notes?: Record<string, string>): string {
  const noteFor = (kind: string, workId: string) => notes?.[`work:${kind}:${workId}`]?.trim();
  if (format === "csv") {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    return "\uFEFF" + [["medium", "rank", "title", "creator", "year", "note"], ...profile.rankings.flatMap((ranking) => ranking.items.map((item) => [ranking.kind, item.rank, item.title, item.creator, item.year, noteFor(ranking.kind, item.id) ?? ""]))].map((row) => row.map(cell).join(",")).join("\r\n");
  }
  return `${format === "md" ? "# " : ""}${profile.profileName}\n\n` + profile.rankings.map((ranking) => `${format === "md" ? "## " : ""}${mediaLabels[ranking.kind].label} / ${ranking.collectionTitle}\n\n${ranking.items.map((item) => { const line = `${item.rank}. ${item.title}${item.creator ? ` / ${item.creator}` : ""}`; const note = noteFor(ranking.kind, item.id); return note ? `${line}\n   ${format === "md" ? "> " : "  "}${note}` : line; }).join("\n")}`).join("\n\n");
}
