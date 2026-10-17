/** 榜单比较的新增指标（计划 S1 / C1，纯新增模块）。
 *
 * 本文件在 S1 阶段零引用：src/lib/profile.ts 的 compareDimensions 一行不改，
 * 旧字段 kendallTau / orderAgreement / spearmanLikeAgreement / consensusScore 全部保留。
 *
 * 补上的三件事：
 * 1. 头部加权 Kendall tau：名次越靠前权重越大（w = 1 / position^rankDecay），
 *    让「谁是第一」比「谁在第 40」更影响结论。
 * 2. 位置折扣一致度：按更靠前那件的展示位置做指数折扣（discount^min(i, j)）。
 * 3. bootstrap 置信区间 + 样本量收缩共识分：把「3 件共同作品的 100% 一致」
 *    和「60 件共同作品的 92% 一致」区分开。
 *
 * 口径：与旧一致率一致，剔除任一侧并列（rank 差为 0）的序对；因此本模块的 tau
 * 是 tau-a 口径，与 profile.ts 里含并列修正的 tau-b 不重合，两者并存不互相取代。
 */

import type { MatchedItem } from "./profile";

export interface CompareMetricOptions {
  /** 头部权重衰减指数，默认 1（即 w = 1 / position）。0 表示等权。 */
  rankDecay?: number;
  /** 位置折扣系数，默认 0.85。 */
  positionDiscount?: number;
  /** bootstrap 轮数，默认 200。 */
  bootstrapRounds?: number;
  /** bootstrap 种子，默认 20261017（保证可复现）。 */
  seed?: number;
  /** 置信水平，默认 0.9。 */
  level?: number;
  /** 原始共识分（一般传 profile.ts 的 consensusScore），提供时才输出收缩值。 */
  rawConsensus?: number;
  /** 收缩先验值，默认 50。 */
  prior?: number;
  /** 收缩先验权重（等价样本量），默认 6。 */
  priorWeight?: number;
}

export interface OrderStats {
  totalPairs: number;
  nonTiedPairs: number;
  /** 任一侧并列而被剔除的序对。 */
  tiedPairs: number;
  concordant: number;
  discordant: number;
  /** -1..1，无有效序对时为 null。 */
  tau: number | null;
}

export interface CompareMetricInterval {
  low: number;
  high: number;
  level: number;
  rounds: number;
}

export interface CompareMetrics {
  sharedCount: number;
  totalPairs: number;
  nonTiedPairs: number;
  tiedPairs: number;
  concordant: number;
  discordant: number;
  tau: number | null;
  /** 头部加权 tau，映射到 0-100。 */
  weightedTau: number | null;
  /** 位置折扣一致度，0-100。 */
  decayedAgreement: number | null;
  /** bootstrap 分位置信区间（0-100）。 */
  tauCI: CompareMetricInterval | null;
  /** 样本量收缩后的共识分，未传 rawConsensus 时为 null。 */
  consensusShrunk: number | null;
  rankDecay: number;
  positionDiscount: number;
}

export const DEFAULT_COMPARE_METRIC_OPTIONS: Readonly<Required<CompareMetricOptions>> =
  Object.freeze({
    rankDecay: 1,
    positionDiscount: 0.85,
    bootstrapRounds: 200,
    seed: 20261017,
    level: 0.9,
    rawConsensus: 0,
    prior: 50,
    priorWeight: 6,
  });

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function toPercent(tau: number): number {
  return round1(clampPercent(((tau + 1) / 2) * 100));
}

/** 单遍历序对统计（旧 compareDimensions 的双循环保持原样，不动）。 */
export function orderStats(shared: readonly MatchedItem[]): OrderStats {
  let totalPairs = 0;
  let tiedPairs = 0;
  let concordant = 0;
  let discordant = 0;
  const n = shared.length;
  for (let i = 0; i < n; i += 1) {
    const a = shared[i];
    for (let j = i + 1; j < n; j += 1) {
      const b = shared[j];
      totalPairs += 1;
      const diffOwn = a.ownRank - b.ownRank;
      const diffPeer = a.peerRank - b.peerRank;
      if (diffOwn === 0 || diffPeer === 0) {
        tiedPairs += 1;
        continue;
      }
      if (diffOwn * diffPeer > 0) concordant += 1;
      else discordant += 1;
    }
  }
  const nonTiedPairs = concordant + discordant;
  const tau = nonTiedPairs === 0 ? null : (concordant - discordant) / nonTiedPairs;
  return { totalPairs, nonTiedPairs, tiedPairs, concordant, discordant, tau };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[index];
}

/** bootstrap 分位置信区间（0-100）。样本太少或有效轮数不足时返回 null。 */
export function bootstrapTau(
  shared: readonly MatchedItem[],
  options: CompareMetricOptions = {},
): CompareMetricInterval | null {
  const n = shared.length;
  const rounds = options.bootstrapRounds ?? DEFAULT_COMPARE_METRIC_OPTIONS.bootstrapRounds;
  const seed = options.seed ?? DEFAULT_COMPARE_METRIC_OPTIONS.seed;
  const level = options.level ?? DEFAULT_COMPARE_METRIC_OPTIONS.level;
  if (n < 4 || rounds < 20) return null;

  const random = mulberry32(seed);
  const buffer: MatchedItem[] = new Array(n);
  const values: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let i = 0; i < n; i += 1) {
      buffer[i] = shared[Math.floor(random() * n)];
    }
    const stats = orderStats(buffer);
    if (stats.tau !== null && Number.isFinite(stats.tau)) values.push(stats.tau);
  }
  if (values.length < 20) return null;
  values.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  return {
    low: toPercent(percentile(values, alpha)),
    high: toPercent(percentile(values, 1 - alpha)),
    level,
    rounds: values.length,
  };
}

/** 样本量收缩：consensus' = (n * raw + m * prior) / (n + m)。 */
export function shrinkConsensus(
  raw: number,
  sharedCount: number,
  options: CompareMetricOptions = {},
): number {
  const prior = options.prior ?? DEFAULT_COMPARE_METRIC_OPTIONS.prior;
  const priorWeight = options.priorWeight ?? DEFAULT_COMPARE_METRIC_OPTIONS.priorWeight;
  const n = Math.max(0, sharedCount);
  const value = (n * raw + priorWeight * prior) / (n + priorWeight);
  return round1(clampPercent(value));
}

/** 一次性算出全部新增指标。旧字段一律不删、不改。 */
export function computeCompareMetrics(
  shared: readonly MatchedItem[],
  options: CompareMetricOptions = {},
): CompareMetrics {
  const stats = orderStats(shared);
  const rankDecay = options.rankDecay ?? DEFAULT_COMPARE_METRIC_OPTIONS.rankDecay;
  const positionDiscount =
    options.positionDiscount ?? DEFAULT_COMPARE_METRIC_OPTIONS.positionDiscount;

  let weightSum = 0;
  let weightAccumulator = 0;
  let decaySum = 0;
  let decayAccumulator = 0;
  const n = shared.length;
  for (let i = 0; i < n; i += 1) {
    const a = shared[i];
    for (let j = i + 1; j < n; j += 1) {
      const b = shared[j];
      const diffOwn = a.ownRank - b.ownRank;
      const diffPeer = a.peerRank - b.peerRank;
      if (diffOwn === 0 || diffPeer === 0) continue;
      const consistent = diffOwn * diffPeer > 0 ? 1 : 0;
      const weight = (1 / Math.pow(i + 1, rankDecay) + 1 / Math.pow(j + 1, rankDecay)) / 2;
      weightSum += weight;
      weightAccumulator += weight * consistent;
      const decay = Math.pow(positionDiscount, Math.min(i, j));
      decaySum += decay;
      decayAccumulator += decay * consistent;
    }
  }

  const weightedTau =
    weightSum > 0 ? round1(clampPercent((weightAccumulator / weightSum) * 100)) : null;
  const decayedAgreement =
    decaySum > 0 ? round1(clampPercent((decayAccumulator / decaySum) * 100)) : null;

  return {
    sharedCount: n,
    totalPairs: stats.totalPairs,
    nonTiedPairs: stats.nonTiedPairs,
    tiedPairs: stats.tiedPairs,
    concordant: stats.concordant,
    discordant: stats.discordant,
    tau: stats.tau,
    weightedTau,
    decayedAgreement,
    tauCI: bootstrapTau(shared, options),
    consensusShrunk:
      options.rawConsensus === undefined ? null : shrinkConsensus(options.rawConsensus, n, options),
    rankDecay,
    positionDiscount,
  };
}
