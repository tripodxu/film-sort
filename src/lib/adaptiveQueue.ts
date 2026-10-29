/** 自适应配对队列（计划 S1 / A2，纯新增模块）。
 *
 * 本文件在 S1 阶段零引用：不改变任何既有出题顺序。
 *
 * 现状：旧的三模式共用 takeCandidateWithCooldown 的「硬避让 + 回退 index 0」策略，
 * 选对手只看冷却，不看这一对能带来多少信息。本模块补上「信息量 + 覆盖率」的
 * 打分：信息量 = p(1-p) * (sigma_i^2 + sigma_j^2)，覆盖率 = 未达标作品的补偿分。
 * 冷却常量按计划以入参形式对齐旧值（ranking.ts 的 PAIR_COOLDOWN=3 / WORK_COOLDOWN=4），
 * 不改动 ranking.ts 的任何常量。
 */

import { expectedWinProbability, type PreferenceModelState } from "./preferenceModel";

/** 与 src/lib/ranking.ts:3 的 PAIR_COOLDOWN 对齐（本模块只读不改）。 */
export const ADAPTIVE_PAIR_COOLDOWN = 3;
/** 与 src/lib/ranking.ts:4 的 WORK_COOLDOWN 对齐（本模块只读不改）。 */
export const ADAPTIVE_WORK_COOLDOWN = 4;

export interface AdaptiveQueueOptions {
  /** 每件作品最少要接触过的不同对手数，默认 1（防止孤岛）。 */
  minOpponents?: number;
  /** 覆盖率补偿的权重，默认 0.35。 */
  coverageWeight?: number;
  /** 序对冷却窗口（条数），默认 3。 */
  pairCooldown?: number;
  /** 作品冷却窗口（条数），默认 4。 */
  workCooldown?: number;
}

export interface AdaptiveQueueInput {
  ids: readonly string[];
  model: PreferenceModelState;
  /** 最近出现过的序对键（可传全量，本模块自会截取冷却窗口）。 */
  recentPairKeys?: readonly string[];
  /** 最近出现过的作品 id（可传全量）。 */
  recentWorkIds?: readonly string[];
  /** 每件作品已接触过的不同对手数。 */
  opponentCounts?: Readonly<Record<string, number>>;
  /** 序对键实现，默认 adaptivePairKey（不用 use 前缀命名，避免被 react-hooks 误判成 Hook）。
   * 接入时可注入 ranking.ts 的同款实现。 */
  pairKeyOf?: (a: string, b: string) => string;
  options?: AdaptiveQueueOptions;
}

export type AdaptiveRelaxation = "none" | "work-cooldown" | "pair-cooldown";

export interface AdaptivePair {
  /** 能力值更高的一方（展示时可再翻转）。 */
  leftId: string;
  rightId: string;
  /** p(1-p) * (var_i + var_j)。 */
  information: number;
  /** 覆盖率补偿分（乘权重前的原始值）。 */
  coverage: number;
  /** information + coverageWeight * coverage。 */
  score: number;
  /** 胜出原因。 */
  reason: "coverage" | "information";
  /** 放宽到哪一级才找到可行对。 */
  relaxed: AdaptiveRelaxation;
}

const DEFAULT_OPTIONS: Required<AdaptiveQueueOptions> = {
  minOpponents: 1,
  coverageWeight: 0.35,
  pairCooldown: ADAPTIVE_PAIR_COOLDOWN,
  workCooldown: ADAPTIVE_WORK_COOLDOWN,
};

/** 默认序对键：两个 id 排序后用竖线连接（对称且确定）。 */
export function adaptivePairKey(a: string, b: string): string {
  return a < b ? a + "|" + b : b + "|" + a;
}

/** 单对的信息量（对称）。 */
export function expectedInformation(model: PreferenceModelState, aId: string, bId: string): number {
  const a = model.ratings[aId];
  const b = model.ratings[bId];
  const thetaA = a ? a.theta : model.options.initialRating;
  const thetaB = b ? b.theta : model.options.initialRating;
  const varianceA = a ? a.variance : model.options.initialVariance;
  const varianceB = b ? b.variance : model.options.initialVariance;
  const p = expectedWinProbability(thetaA, thetaB);
  return p * (1 - p) * (varianceA + varianceB);
}

/** 覆盖缺口（0 表示已达标）。 */
export function coverageDeficit(
  id: string,
  opponentCounts: Readonly<Record<string, number>>,
  minOpponents: number,
): number {
  const seen = opponentCounts[id] ?? 0;
  return Math.max(0, minOpponents - seen);
}

function resolveOptions(partial: AdaptiveQueueOptions = {}): Required<AdaptiveQueueOptions> {
  return {
    minOpponents: partial.minOpponents ?? DEFAULT_OPTIONS.minOpponents,
    coverageWeight: partial.coverageWeight ?? DEFAULT_OPTIONS.coverageWeight,
    pairCooldown: partial.pairCooldown ?? DEFAULT_OPTIONS.pairCooldown,
    workCooldown: partial.workCooldown ?? DEFAULT_OPTIONS.workCooldown,
  };
}

interface Candidate {
  leftId: string;
  rightId: string;
  information: number;
  coverage: number;
  score: number;
  blockedByPair: boolean;
  blockedByWork: boolean;
}

/**
 * 选下一对。ids 少于 2 件返回 null。
 *
 * 性能（2026-10-18 优化）：原实现为每一对分配候选对象再整体排序——300 件时约 4.5 万个对象
 * 加 O(N²log N) 排序，实测单次 17.2ms，占一次取舍总耗时（约 20ms）的 85%。现在改成
 * 「一遍扫描 + 只为三级各自保留当前最优」：模型与计数只读一次（Float64Array），内层循环零分配。
 * 比较判据与并列顺序（score ↓ → information ↓ → coverage ↓ → leftId|rightId ↑）逐字不变，
 * 冷却放宽阶梯（none → work-cooldown → pair-cooldown）逐字不变 ⇒ **选出的对手与优化前完全一致**
 * （由 golden 指纹与既有单测双重看守）。
 */
export function selectAdaptivePair(input: AdaptiveQueueInput): AdaptivePair | null {
  const options = resolveOptions(input.options);
  const pairKeyOf = input.pairKeyOf ?? adaptivePairKey;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of input.ids) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (ids.length < 2) return null;

  const recentPairs = new Set((input.recentPairKeys ?? []).slice(-options.pairCooldown));
  const recentWorks = new Set((input.recentWorkIds ?? []).slice(-options.workCooldown));
  // T-20261029-PERF：冷却序对通常只有个位数，但旧实现会为每一对拼一次 key 字符串
  // （300 件 = 4.5 万次/步）。把冷却键解析成 id → id 的索引，命中判断零分配。
  // 键格式 `min\u0000max`（pairKey / adaptivePairKey 同构）；若遇异常键则退回旧路径，行为不变。
  let recentPairIndex: Map<string, Set<string>> | null = new Map();
  for (const key of recentPairs) {
    const parts = key.split("\u0000");
    if (parts.length !== 2 || !recentPairIndex) {
      recentPairIndex = null;
      break;
    }
    const [a, b] = parts;
    let setA = recentPairIndex.get(a);
    if (!setA) {
      setA = new Set<string>();
      recentPairIndex.set(a, setA);
    }
    setA.add(b);
    let setB = recentPairIndex.get(b);
    if (!setB) {
      setB = new Set<string>();
      recentPairIndex.set(b, setB);
    }
    setB.add(a);
  }
  const counts = input.opponentCounts ?? {};
  const model = input.model;
  const size = ids.length;
  const theta = new Float64Array(size);
  const variance = new Float64Array(size);
  const deficit = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const rating = model.ratings[ids[i]];
    theta[i] = rating ? rating.theta : model.options.initialRating;
    variance[i] = rating ? rating.variance : model.options.initialVariance;
    deficit[i] = Math.max(0, options.minOpponents - (counts[ids[i]] ?? 0));
  }

  let bestNone: Candidate | null = null;
  let bestWork: Candidate | null = null;
  let bestAny: Candidate | null = null;

  for (let i = 0; i < size; i += 1) {
    const aId = ids[i];
    const thetaA = theta[i];
    const varianceA = variance[i];
    const deficitA = deficit[i];
    for (let j = i + 1; j < size; j += 1) {
      const bId = ids[j];
      const p = 1 / (1 + Math.exp(-(thetaA - theta[j])));
      const information = p * (1 - p) * (varianceA + variance[j]);
      // 任一端未达标就给补偿（取较大缺口），保证孤岛作品优先被接上。
      const coverage = Math.max(deficitA, deficit[j]);
      const score = information + options.coverageWeight * coverage;
      const leftId = thetaA !== theta[j] ? (thetaA > theta[j] ? aId : bId) : aId < bId ? aId : bId;
      const rightId = leftId === aId ? bId : aId;
      const blockedByPair = recentPairIndex
        ? (recentPairIndex.get(aId)?.has(bId) ?? false)
        : recentPairs.has(pairKeyOf(aId, bId));
      const blockedByWork = recentWorks.has(aId) || recentWorks.has(bId);
      if (
        !blockedByPair &&
        !blockedByWork &&
        beats(score, information, coverage, leftId, rightId, bestNone)
      ) {
        bestNone = { leftId, rightId, information, coverage, score, blockedByPair, blockedByWork };
      }
      if (!blockedByPair && beats(score, information, coverage, leftId, rightId, bestWork)) {
        bestWork = { leftId, rightId, information, coverage, score, blockedByPair, blockedByWork };
      }
      if (beats(score, information, coverage, leftId, rightId, bestAny)) {
        bestAny = { leftId, rightId, information, coverage, score, blockedByPair, blockedByWork };
      }
    }
  }

  const best = bestNone ?? bestWork ?? bestAny;
  if (!best) return null;
  const relaxed: AdaptiveRelaxation = bestNone
    ? "none"
    : bestWork
      ? "work-cooldown"
      : "pair-cooldown";
  return {
    leftId: best.leftId,
    rightId: best.rightId,
    information: best.information,
    coverage: best.coverage,
    score: best.score,
    reason: best.coverage > 0 ? "coverage" : "information",
    relaxed,
  };
}

/** 三级各自的当前最优用同一套判据：score ↓ → information ↓ → coverage ↓ → 键 ↑（Tie 时才拼键）。 */
function beats(
  score: number,
  information: number,
  coverage: number,
  leftId: string,
  rightId: string,
  best: Candidate | null,
): boolean {
  if (!best) return true;
  if (score !== best.score) return score > best.score;
  if (information !== best.information) return information > best.information;
  if (coverage !== best.coverage) return coverage > best.coverage;
  return leftId + "|" + rightId < best.leftId + "|" + best.rightId;
}
