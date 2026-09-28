/**
 * 广场品味相似度:把「我的榜单」与「他人榜单/帖子作品」按 workIdentity 匹配,
 * 给出一个可展示的重合度。与比较页的 DimensionComparison 同源不同用途——
 * 这里只求轻量(卡片徽章场景,纯同步计算),不做加权/年代等完整画像。
 *
 * 匹配必须走 profile.ts 的 workIdentity(两侧口径共用的既定事实),否则
 * 网易云无年份曲目、大小写标题等会匹配不上。
 */

import { workIdentity } from "./profile";

export interface SimilarityInput {
  title: string;
  year?: unknown;
  creator?: unknown;
}

export interface SimilarityResult {
  /** 双方都出现的作品数 */
  sharedCount: number;
  /** Jaccard 重合度 0-100(共同键 / 全体键);任一侧为空 → null */
  jaccard: number | null;
  /** 共同作品的两两顺序一致度 0-100;共同 <2 件 → null */
  orderAgreement: number | null;
  /** 综合展示分 0-100:重合 60% + 顺序 40%(无顺序时只用重合);无共同 → null */
  score: number | null;
}

export function rankingSimilarity(
  mine: readonly SimilarityInput[],
  theirs: readonly SimilarityInput[],
): SimilarityResult {
  const myKeys = mine.map((work) => workIdentity(work.title, work.year, work.creator));
  const theirKeys = theirs.map((work) => workIdentity(work.title, work.year, work.creator));
  const myRank = new Map<string, number>();
  myKeys.forEach((key, index) => {
    if (!myRank.has(key)) myRank.set(key, index + 1);
  });
  const shared: Array<{ mine: number; theirs: number }> = [];
  const theirSet = new Set<string>();
  theirKeys.forEach((key, index) => {
    theirSet.add(key);
    const rank = myRank.get(key);
    if (rank !== undefined) shared.push({ mine: rank, theirs: index + 1 });
  });
  const sharedCount = shared.length;
  if (sharedCount === 0 || myKeys.length === 0) {
    return { sharedCount: 0, jaccard: null, orderAgreement: null, score: null };
  }
  const union = new Set([...myKeys, ...theirKeys]).size;
  const jaccard = Math.round((100 * sharedCount) / union);
  let orderAgreement: number | null = null;
  if (sharedCount >= 2) {
    let agreements = 0;
    let pairs = 0;
    for (let i = 0; i < shared.length; i++) {
      for (let j = i + 1; j < shared.length; j++) {
        pairs++;
        if (
          (shared[i].mine - shared[j].mine) * (shared[i].theirs - shared[j].theirs) >
          0
        )
          agreements++;
      }
    }
    orderAgreement = Math.round((100 * agreements) / pairs);
  }
  const score =
    orderAgreement === null ? jaccard : Math.round(jaccard * 0.6 + orderAgreement * 0.4);
  return { sharedCount, jaccard, orderAgreement, score };
}
