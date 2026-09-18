import { mediaLabels, type Artwork, type MediaKind } from "../data/media";
import {
  MAX_PAYLOAD_BYTES,
  toStoredWork,
  toStoredWorks,
  type StoredWork,
} from "../../shared/storedItem";

export interface RankedArtwork extends Artwork {
  rank: number;
}
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
/**
 * 解析失败时的备份键。
 * 旧版本在解析失败时会**删除主键**并把原文丢到这里，于是"刷新后榜单消失"；
 * 现在主键永不删除，读取端还会在解析放宽后从这个备份把画像恢复回来。
 */
export const RECOVERY_KEY = `${LIBRARY_KEY}:recovery`;
/** 与 Worker 端共用同一个字节上限，避免两侧口径漂移。 */
export const MAX_PROFILE_BYTES = MAX_PAYLOAD_BYTES;
/** 单份榜单的作品上限；超出时截断并告警，而不是让整份画像失效。 */
const MAX_RANKING_ITEMS = 1000;
/** 画像里的榜单上限（产品限制），超出时保留前 N 份而不是整体作废。 */
const MAX_RANKINGS = 20;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 160): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
export const normalizeTitle = (value: string) =>
  value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const validDate = (value: unknown): value is string =>
  typeof value === "string" && value.length < 40 && Number.isFinite(Date.parse(value));

/**
 * 作品身份（**全仓唯一的去重口径**）：`标题|年份|作者` 的规范化形式。
 *
 * 读取端（parseRanking）、写入端（toRankedItems）、批量导入、云端清单
 * 必须共用它。两侧口径漂移正是「保存成功、刷新后整份画像消失」的根因：
 * 网易云导入不带年份，同名同歌手的曲目 identity 必然相撞，而写侧放行、读侧致命。
 */
export const workIdentity = (title: string, year?: unknown, creator?: unknown): string =>
  `${normalizeTitle(title)}|${year ?? ""}|${normalizeTitle(String(creator ?? ""))}`;

/** 按 identity 去重，保留首次出现；返回新数组，不修改入参。 */
export function dedupeByTitle<T extends { title: string; year?: unknown; creator?: unknown }>(
  works: readonly T[],
): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const work of works) {
    const identity = workIdentity(work.title, work.year, work.creator);
    if (seen.has(identity)) continue;
    seen.add(identity);
    kept.push(work);
  }
  return kept;
}

/**
 * 作品数组 → 可落库榜单条目：白名单投影 → 按 identity 去重 → 补齐 id → 重排 rank。
 *
 * 这是**写入端唯一入口**。返回值保证满足 `parseRanking` 的全部约束
 * （字段合法、rank 连续、无重复身份、id 存在），因此「写进去的一定读得出来」。
 * 以前这里只做字段投影，重复曲目会原样落库，然后在下次读取时把整份画像带崩。
 */
export function toRankedItems(works: unknown): RankedArtwork[] {
  const kept = dedupeByTitle(toStoredWorks(works));
  // 断言只是因为 RankedArtwork 把 id/rank 标成必填；两者在这里都已补齐。
  return kept.map((work, index) => ({
    ...work,
    id: work.id ?? `auto-${index + 1}`,
    rank: index + 1,
  })) as RankedArtwork[];
}

/**
 * 解析一份榜单。
 *
 * **宽容原则**：单条作品的问题只丢弃那一条，绝不让整份画像失效。
 * 旧版本在这里抛 "Duplicate artwork" / "Ranks must be contiguous"，而读取方
 * （readProfile）把任何异常都当成「本地数据损坏」并删掉用户的整份画像——
 * 于是 150 首网易云歌单里几对同名同歌手（都无年份）的曲目会让刷新后的 /myself 清空。
 */
function parseRanking(value: unknown): RankingExport {
  if (
    !record(value) ||
    value.version !== 1 ||
    !text(value.profileId) ||
    !text(value.profileName, 80) ||
    !text(value.collectionTitle) ||
    !Object.hasOwn(mediaLabels, String(value.kind)) ||
    !validDate(value.createdAt) ||
    !Array.isArray(value.items) ||
    value.items.length < 1
  )
    throw new Error("Invalid ranking");
  const ids = new Set<string>();
  const identities = new Set<string>();
  const ranked: Array<{ work: StoredWork; rank: number }> = [];
  let skipped = 0;
  for (const item of value.items.slice(0, MAX_RANKING_ITEMS) as unknown[]) {
    const reject = () => {
      skipped += 1;
    };
    if (
      !record(item) ||
      !text(item.id) ||
      !text(item.title) ||
      !Number.isInteger(item.rank) ||
      Number(item.rank) < 1 ||
      ids.has(item.id) ||
      (item.creator !== undefined && !text(item.creator)) ||
      (item.year !== undefined &&
        (!Number.isInteger(item.year) || Number(item.year) < 1 || Number(item.year) > 2200))
    ) {
      reject();
      continue;
    }
    const identity = workIdentity(item.title, item.year, item.creator);
    // 重复曲目：**合并**（保留首次出现），而不是作废整份榜单。
    if (identities.has(identity)) {
      reject();
      continue;
    }
    const stored = toStoredWork(item);
    if (!stored) {
      reject();
      continue;
    }
    ids.add(item.id);
    identities.add(identity);
    ranked.push({ work: stored, rank: Number(item.rank) });
  }
  // 一条都没剩说明这份榜单确实不可用；此时跳过它比删掉整份画像更安全。
  if (!ranked.length) throw new Error("Invalid ranking");
  // 跳过/合并之后 rank 必然出现空档：按原 rank 排序后重排为 1..n，
  // 让「读取结果」永远满足 rank 连续这一不变量。
  ranked.sort((a, b) => a.rank - b.rank);
  const items = ranked.map((entry, index) => ({
    ...entry.work,
    rank: index + 1,
  })) as RankedArtwork[];
  if (skipped || value.items.length > MAX_RANKING_ITEMS) {
    console.warn(
      `[parseRanking] ${String(value.collectionTitle)}: merged or dropped ${skipped} item(s)` +
        (value.items.length > MAX_RANKING_ITEMS ? `, truncated to ${MAX_RANKING_ITEMS}` : ""),
    );
  }
  return {
    version: 1,
    profileId: value.profileId,
    profileName: value.profileName,
    kind: value.kind as MediaKind,
    collectionTitle: value.collectionTitle,
    createdAt: value.createdAt,
    items,
  };
}

export function parseProfile(value: unknown): ArtisticProfile {
  if (!record(value)) throw new Error("Invalid profile");
  if (value.version === 1) {
    const ranking = parseRanking(value);
    return {
      version: 2,
      profileId: ranking.profileId,
      profileName: ranking.profileName,
      updatedAt: ranking.createdAt,
      rankings: [ranking],
    };
  }
  if (
    value.version !== 2 ||
    !text(value.profileId) ||
    !text(value.profileName, 80) ||
    !validDate(value.updatedAt) ||
    !Array.isArray(value.rankings) ||
    value.rankings.length < 1
  )
    throw new Error("Invalid profile");
  const rankings: RankingExport[] = [];
  let skipped = Math.max(0, value.rankings.length - MAX_RANKINGS);
  // 一份榜单坏掉不再连坐整份画像：能救回来的榜单全部保留。
  for (const entry of value.rankings.slice(0, MAX_RANKINGS)) {
    try {
      rankings.push(parseRanking(entry));
    } catch {
      skipped += 1;
    }
  }
  if (!rankings.length) throw new Error("Invalid profile");
  if (skipped) console.warn(`[parseProfile] skipped ${skipped} unusable ranking(s)`);
  return {
    version: 2,
    profileId: value.profileId,
    profileName: value.profileName,
    updatedAt: value.updatedAt,
    rankings,
  };
}

export function readProfile(storage: Storage): ArtisticProfile | null {
  try {
    const stored = storage.getItem(LIBRARY_KEY);
    if (stored) {
      try {
        return parseProfile(JSON.parse(stored));
      } catch (e) {
        // **绝不删除用户数据**。旧版本在这里 removeItem(LIBRARY_KEY)：任何一次解析
        // 异常都会把整份画像从浏览器里抹掉（"刷新后榜单又消失了"就是它）。
        // 现在原值原地保留，而且只用它填补**空着的**备份位，绝不覆盖已有的好备份。
        console.error("[readProfile] stored profile could not be parsed; keeping it in place:", e);
        if (!storage.getItem(RECOVERY_KEY)) {
          try {
            storage.setItem(RECOVERY_KEY, stored);
          } catch {
            /* 备份失败不影响主流程。 */
          }
        }
      }
    }
    // 主键不可用（不存在或读不回来）时用备份兜底：旧版本正是「解析失败 → 删主键 →
    // 留备份」，所以被它误删的画像在这里还能救回来。
    const backup = storage.getItem(RECOVERY_KEY);
    if (backup) {
      try {
        const restored = parseProfile(JSON.parse(backup));
        if (!stored) {
          // 主键是真的没了：把备份写回去，让后续 persist 有落点。
          try {
            storage.setItem(LIBRARY_KEY, backup);
          } catch {
            /* 写回失败不影响本次使用。 */
          }
          console.warn("[readProfile] recovered profile from the recovery backup");
        }
        return restored;
      } catch {
        /* 备份也读不回来：保持原样，继续走旧 key 迁移。 */
      }
    }
    // Migrate earlier single-medium exports by timestamp, never by storage key order.
    const legacy: RankingExport[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith("art-rank:profile:")) continue;
      try {
        legacy.push(...parseProfile(JSON.parse(storage.getItem(key) ?? "")).rankings);
      } catch {
        /* Ignore unrelated name preferences. */
      }
    }
    return legacy
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .reduce<ArtisticProfile | null>((profile, ranking) => mergeRanking(profile, ranking), null);
  } catch {
    return null;
  }
}

export function mergeRanking(
  profile: ArtisticProfile | null,
  ranking: RankingExport,
): ArtisticProfile {
  const existing = profile?.rankings ?? [];
  // Replace if same collectionTitle+kind exists, otherwise append
  const key = (r: RankingExport) => `${r.kind}|${r.collectionTitle}`;
  const rankingKey = key(ranking);
  const filtered = existing.filter((entry) => key(entry) !== rankingKey);
  return {
    version: 2,
    profileId: profile?.profileId ?? crypto.randomUUID(),
    profileName: ranking.profileName,
    updatedAt: ranking.createdAt,
    rankings: [...filtered, ranking].sort(
      (a, b) => Object.keys(mediaLabels).indexOf(a.kind) - Object.keys(mediaLabels).indexOf(b.kind),
    ),
  };
}

export function reorderRanking(
  profile: ArtisticProfile,
  rankingIdx: number,
  newOrder: string[],
): ArtisticProfile {
  const ranking = profile.rankings[rankingIdx];
  if (!ranking) return profile;
  const byId = new Map(ranking.items.map((item) => [item.id, item]));
  const reordered = newOrder
    .map((id, index) => {
      const item = byId.get(id);
      if (!item) return null;
      return { ...item, rank: index + 1 };
    })
    .filter(Boolean) as RankedArtwork[];
  if (reordered.length !== ranking.items.length) return profile;
  const rankings = [...profile.rankings];
  rankings[rankingIdx] = { ...ranking, items: reordered };
  return { ...profile, rankings, updatedAt: new Date().toISOString() };
}

export function renameRanking(
  profile: ArtisticProfile,
  index: number,
  newTitle: string,
): ArtisticProfile {
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
      while (existingTitles.has(candidate)) {
        suffix += 1;
        candidate = `${ranking.collectionTitle}（${suffix}）`;
      }
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
  key: string;
  title: string;
  bestRank: number;
  creator?: string;
  year?: number;
  id?: string; // 外部 ID（最强匹配依据）
  sources: Array<{ collectionTitle: string; rank: number }>;
  representative: RankedArtwork;
}

export interface MergedDimension {
  kind: MediaKind;
  items: MergedItem[];
  sourceRankings: string[]; // 合并了哪些榜单
}

export function mergeDimensionRankings(rankings: RankingExport[]): MergedDimension | null {
  if (rankings.length === 0) return null;
  const kind = rankings[0].kind;
  const byKey = new Map<string, MergedItem>();

  for (const ranking of rankings) {
    for (const item of ranking.items) {
      const key =
        normalizeTitle(item.title) +
        "|" +
        (item.year ?? "") +
        "|" +
        normalizeTitle(item.creator ?? "");
      const existing = byKey.get(key);
      if (existing) {
        existing.sources.push({ collectionTitle: ranking.collectionTitle, rank: item.rank });
        if (item.rank < existing.bestRank) {
          existing.bestRank = item.rank;
          existing.representative = item;
        }
      } else {
        byKey.set(key, {
          key,
          title: item.title,
          bestRank: item.rank,
          creator: item.creator,
          year: item.year,
          id: item.id,
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

  const yearA = a.year,
    yearB = b.year;
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
  ownKey: string;
  peerKey: string;
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
  // 新增指标
  kendallTau: number | null; // Kendall τ-b（含并列），0-100
  topJaccard: number; // Top-5 集合 Jaccard 相似度 0-100
  eraAffinity: number | null; // 年代偏好一致度 0-100（任一方无年份则 null）
  consensusScore: number; // 综合共识评分 0-100
}

// 中位数（升序数值数组）
function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function greedyMatch(ownItems: MergedItem[], peerItems: MergedItem[]): MatchedItem[] {
  // 生成所有候选对及其评分
  const candidates: Array<{ oi: number; pi: number; score: number; rankDiff: number }> = [];
  const peerByTitle = new Map<string, number[]>();
  peerItems.forEach((item, index) => {
    const title = normalizeTitle(item.title);
    const indexes = peerByTitle.get(title);
    if (indexes) indexes.push(index);
    else peerByTitle.set(title, [index]);
  });
  for (let oi = 0; oi < ownItems.length; oi++) {
    for (const pi of peerByTitle.get(normalizeTitle(ownItems[oi].title)) ?? []) {
      const score = matchScore(ownItems[oi], peerItems[pi]);
      if (score >= 70) {
        candidates.push({
          oi,
          pi,
          score,
          rankDiff: Math.abs(ownItems[oi].bestRank - peerItems[pi].bestRank),
        });
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
    const o = ownItems[c.oi],
      p = peerItems[c.pi];
    matched.push({
      ownKey: o.key,
      peerKey: p.key,
      title: o.title,
      ownRank: o.bestRank,
      peerRank: p.bestRank,
      difference: Math.abs(o.bestRank - p.bestRank),
      matchScore: c.score,
      ownSources: o.sources,
      peerSources: p.sources,
      ownItem: o.representative,
      peerItem: p.representative,
    });
  }

  return matched.sort((a, b) => a.ownRank - b.ownRank);
}

// ========== 单维度比较 ==========

export function compareDimensions(
  own: MergedDimension,
  peer: MergedDimension,
): DimensionComparison {
  const shared = greedyMatch(own.items, peer.items);
  const matchedOwn = new Set(shared.map((s) => s.ownKey));
  const matchedPeer = new Set(shared.map((s) => s.peerKey));
  const onlyOwn = own.items.filter((item) => !matchedOwn.has(item.key));
  const onlyPeer = peer.items.filter((item) => !matchedPeer.has(item.key));

  // 序对一致率：多榜单合并取最优名次会产生并列（同为第1等），
  // 含并列的序对无法判定先后，剔除后再计算（否则相同画像会得到 <100% 的一致率）
  let agreements = 0,
    pairs = 0;
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
    ? Math.round((100 * shared.reduce((s, m) => s + m.difference, 0)) / (shared.length * maxRank))
    : 0;

  const weightedTotal = shared.reduce((s, m) => s + 1 / m.ownRank + 1 / m.peerRank, 0);
  const weightedAgreement = shared.length
    ? shared.reduce((s, m) => s + Math.min(1 / m.ownRank, 1 / m.peerRank), 0) /
      (weightedTotal / 2 || 1)
    : 0;

  const n = shared.length;
  const squaredDistance = shared.reduce((s, m) => s + (m.ownRank - m.peerRank) ** 2, 0);
  const spearmanLikeAgreement =
    n < 2 ? null : Math.max(0, Math.round(100 * (1 - (6 * squaredDistance) / (n * (n * n - 1)))));
  const top3Overlap = shared.filter((m) => m.ownRank <= 3 && m.peerRank <= 3).length;
  const closest = [...shared]
    .sort((a, b) => a.difference - b.difference)
    .slice(0, 3)
    .map((m) => m.title)
    .join("、");
  const biggest =
    [...shared].sort((a, b) => b.difference - a.difference)[0]?.title ?? "暂无共同作品";

  // Kendall τ-b：统计一致/不一致/仅一方并列的序对，τ = (C - D) / sqrt((C+D+Ty)(C+D+Tx))
  const overlap = unionCount ? Math.round((100 * shared.length) / unionCount) : 0;
  const orderAgreement = pairs ? Math.round((100 * agreements) / pairs) : null;
  const weightedTopAgreement = Math.round(weightedAgreement * 100);
  let concordant = 0,
    discordant = 0,
    tieOwn = 0,
    tiePeer = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = shared[i],
        b = shared[j];
      const dOwn = a.ownRank - b.ownRank,
        dPeer = a.peerRank - b.peerRank;
      if (dOwn === 0 && dPeer === 0) continue;
      if (dOwn === 0) {
        tieOwn++;
        continue;
      }
      if (dPeer === 0) {
        tiePeer++;
        continue;
      }
      if (dOwn * dPeer > 0) concordant++;
      else discordant++;
    }
  }
  const kendallDenom = Math.sqrt(
    (concordant + discordant + tieOwn) * (concordant + discordant + tiePeer),
  );
  // τ-b ∈ [-1,1]，线性映射到 0-100（50=无关，100=完全一致）
  const kendallTau =
    n < 2 || !kendallDenom ? null : Math.round(((concordant - discordant) / kendallDenom + 1) * 50);

  // Top-5 集合 Jaccard（双方前五名的共同比例）
  const ownTop = new Set(own.items.filter((m) => m.bestRank <= 5).map((m) => m.key));
  const peerTop = new Set(peer.items.filter((m) => m.bestRank <= 5).map((m) => m.key));
  const topInter = [...ownTop].filter((t) => peerTop.has(t)).length;
  const topUnion = new Set([...ownTop, ...peerTop]).size;
  const topJaccard = topUnion ? Math.round((100 * topInter) / topUnion) : 0;

  // 年代偏好：比较双方完整榜单的年代中位数（匹配规则下共同作品年份必相同，故取全量分布）
  const ownYears = own.items
    .map((m) => m.representative.year)
    .filter((y): y is number => typeof y === "number");
  const peerYears = peer.items
    .map((m) => m.representative.year)
    .filter((y): y is number => typeof y === "number");
  const ownMed = median(ownYears);
  const peerMed = median(peerYears);
  const eraAffinity =
    ownMed === null || peerMed === null
      ? null
      : Math.max(0, Math.round(100 - Math.abs(ownMed - peerMed) * 6));

  // 综合共识评分：加权合成（顺序一致 30% + 重合 20% + 加权偏好 20% + 名次距离 15% + 年代 15%）
  const orderPart = orderAgreement ?? kendallTau ?? 0;
  const eraPart = eraAffinity ?? 70;
  const consensusScore = shared.length
    ? Math.round(
        orderPart * 0.3 +
          overlap * 0.2 +
          weightedTopAgreement * 0.2 +
          (100 - rankDistance) * 0.15 +
          eraPart * 0.15,
      )
    : 0;

  return {
    shared,
    onlyOwn,
    onlyPeer,
    overlap,
    orderAgreement,
    top5Overlap: shared.filter((m) => m.ownRank <= 5 && m.peerRank <= 5).length,
    disagreements: shared
      .filter((m) => m.difference > 0)
      .sort((a, b) => b.difference - a.difference)
      .slice(0, 5),
    sharedCount: shared.length,
    coverage: Math.min(
      100,
      Math.round(
        (100 * shared.length) / Math.max(1, Math.min(own.items.length, peer.items.length)),
      ),
    ),
    weightedTopAgreement,
    rankDistance,
    spearmanLikeAgreement,
    championAgreement: shared.length
      ? shared.some((m) => m.ownRank === 1 && m.peerRank === 1)
      : null,
    top3Agreement: top3Overlap,
    commonPreference: closest || "暂无共同作品",
    divergence: biggest,
    kendallTau,
    topJaccard,
    eraAffinity,
    consensusScore,
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
  const sharedKinds = allKinds.filter(
    (kind) =>
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
  const totalWorks = Math.max(
    1,
    own.rankings.reduce((s, r) => s + r.items.length, 0) +
      peer.rankings.reduce((s, r) => s + r.items.length, 0),
  );

  return {
    sharedKinds,
    comparisons,
    mediumCoverage: Math.round(
      (100 * sharedKinds.length) / Math.max(1, Math.max(own.rankings.length, peer.rankings.length)),
    ),
    sharedWorks,
    crossMediumAgreement: comparisons.length
      ? Math.round(
          comparisons.reduce((s, e) => s + e.result.weightedTopAgreement, 0) / comparisons.length,
        )
      : null,
    overlap: Math.round((100 * sharedWorks) / totalWorks),
  };
}

export function profileText(
  profile: ArtisticProfile,
  format: "txt" | "md" | "csv",
  notes?: Record<string, string>,
): string {
  const noteFor = (kind: string, workId: string) => notes?.[`work:${kind}:${workId}`]?.trim();
  if (format === "csv") {
    const cell = (value: unknown) =>
      `"${String(value ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replace(/"/g, '""')}"`;
    return (
      "\uFEFF" +
      [
        ["medium", "rank", "title", "creator", "year", "note"],
        ...profile.rankings.flatMap((ranking) =>
          ranking.items.map((item) => [
            ranking.kind,
            item.rank,
            item.title,
            item.creator,
            item.year,
            noteFor(ranking.kind, item.id) ?? "",
          ]),
        ),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n")
    );
  }
  return (
    `${format === "md" ? "# " : ""}${profile.profileName}\n\n` +
    profile.rankings
      .map(
        (ranking) =>
          `${format === "md" ? "## " : ""}${mediaLabels[ranking.kind].label} / ${ranking.collectionTitle}\n\n${ranking.items
            .map((item) => {
              const line = `${item.rank}. ${item.title}${item.creator ? ` / ${item.creator}` : ""}`;
              const note = noteFor(ranking.kind, item.id);
              return note ? `${line}\n   ${format === "md" ? "> " : "  "}${note}` : line;
            })
            .join("\n")}`,
      )
      .join("\n\n")
  );
}
