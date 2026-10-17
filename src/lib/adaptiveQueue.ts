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

function thetaOf(model: PreferenceModelState, id: string): number {
  const rating = model.ratings[id];
  return rating ? rating.theta : model.options.initialRating;
}

/** 选下一对。ids 少于 2 件返回 null。 */
export function selectAdaptivePair(input: AdaptiveQueueInput): AdaptivePair | null {
  const options = resolveOptions(input.options);
  const pairKeyOf = input.pairKeyOf ?? adaptivePairKey;
  const ids: string[] = [];
  for (const id of input.ids) {
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length < 2) return null;

  const recentPairs = new Set((input.recentPairKeys ?? []).slice(-options.pairCooldown));
  const recentWorks = new Set((input.recentWorkIds ?? []).slice(-options.workCooldown));
  const counts = input.opponentCounts ?? {};

  const candidates: Candidate[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const aId = ids[i];
      const bId = ids[j];
      const information = expectedInformation(input.model, aId, bId);
      // 任一端未达标就给补偿（取较大缺口），保证孤岛作品优先被接上。
      const coverage = Math.max(
        coverageDeficit(aId, counts, options.minOpponents),
        coverageDeficit(bId, counts, options.minOpponents),
      );
      const [leftId, rightId] = orderPair(aId, bId, input.model);
      candidates.push({
        leftId,
        rightId,
        information,
        coverage,
        score: information + options.coverageWeight * coverage,
        blockedByPair: recentPairs.has(pairKeyOf(aId, bId)),
        blockedByWork: recentWorks.has(aId) || recentWorks.has(bId),
      });
    }
  }

  const tiers: AdaptiveRelaxation[] = ["none", "work-cooldown", "pair-cooldown"];
  for (const relaxed of tiers) {
    const pool = candidates.filter((candidate) => {
      if (relaxed === "none") return !candidate.blockedByPair && !candidate.blockedByWork;
      if (relaxed === "work-cooldown") return !candidate.blockedByPair;
      return true;
    });
    if (pool.length === 0) continue;
    pool.sort(compareCandidates);
    const best = pool[0];
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
  return null;
}

function orderPair(aId: string, bId: string, model: PreferenceModelState): [string, string] {
  const thetaA = thetaOf(model, aId);
  const thetaB = thetaOf(model, bId);
  if (thetaA !== thetaB) return thetaA > thetaB ? [aId, bId] : [bId, aId];
  return aId < bId ? [aId, bId] : [bId, aId];
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.information !== b.information) return b.information - a.information;
  if (a.coverage !== b.coverage) return b.coverage - a.coverage;
  const aKey = a.leftId + "|" + a.rightId;
  const bKey = b.leftId + "|" + b.rightId;
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}
