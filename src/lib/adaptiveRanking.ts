/** 自适应排序接入层（计划 S2 / A1+A2，纯新增模块）。
 *
 * 这一层把 S1 的两个纯函数模块接进 src/lib/ranking.ts 的状态机：BT 能力模型
 * （preferenceModel）+ 信息增益配对（adaptiveQueue）→ 第四种排序模式 adaptive。
 *
 * 三条设计约束（与 docs/archive/PLAN-ADDITIVE-UPGRADE.md §3 铁律 R1/R2/R3 一致）：
 * 1. 旧三模式（quick/classic/precise）的任何一行执行路径都不经过本文件；
 *    ranking.ts 只在 mode === "adaptive" 时前置早退到本模块。
 * 2. 不往 RankingState 增加任何持久化字段：能力模型与名次区间都由 decisionLog
 *    重新推导（O(决策数)），所以旧草稿/云快照零迁移，撤销=重放自动成立。
 * 3. 冷却常量沿用 ranking.ts 的语义（序对 3 / 作品 4），只作入参传给 adaptiveQueue，
 *    不改动 ranking.ts 的任何常量。
 *
 * 与旧模式的差异（有意为之，写进 §10 执行记录）：
 * - 排序对象是「模型名次」而不是「二分插入位置」：每次取舍只更新能力值，
 *   rankedIds 是当前模型排序（topN 截断），所以中途的榜单会随证据重排，
 *   这正是「给出名次区间」的前提。
 * - 首批配对在零证据时按 sourceIds 顺序取相邻对（θ 全为 0，排序 tie-break 为 id 升序），
 *   相当于用相邻比较给模型播种；之后完全由信息量 + 覆盖率决定。
 * - 预算 = clamp(n*4, n-1, n(n-1)/2)，用完后交给既有复测流程（startVerification）。
 */

import {
  ADAPTIVE_PAIR_COOLDOWN,
  ADAPTIVE_WORK_COOLDOWN,
  expectedInformation,
  selectAdaptivePair,
} from "./adaptiveQueue";
import {
  fitPreferenceModel,
  getPreferenceOrder,
  getRankIntervals,
  type PreferenceModelState,
  type PreferenceObservation,
  type RankInterval,
} from "./preferenceModel";
import type { RankingState } from "./ranking";

/** 每件作品的目标比较次数（ranking 阶段预算的斜率）。 */
export const ADAPTIVE_COMPARISONS_PER_ITEM = 4;
/** 每件作品至少接触的不同对手数：低于此值优先补覆盖（防孤岛）。 */
export const ADAPTIVE_MIN_OPPONENTS = 2;
/** 名次区间的置信水平（90%，与 preferenceModel 默认一致，这里显式写死便于 UI 文案）。 */
export const ADAPTIVE_INTERVAL_LEVEL = 0.9;
/** 实测可靠上限（PLAN-ADDITIVE-UPGRADE §9 未决 5，2026-10-24）：固定 4n 预算 +
 * 全一致回答下，n ≤ 20 Top N 全对、n ≥ 30（30/50/100 三组实测）会排错——
 * 信息量公式中未比较对的先验 σ²≈40 主导调度，边界序对信息不足。SetupView
 * 据此提示大清单改用 quick/classic；根治需「大清单标定」（等线上真实数据回放）。 */
export const ADAPTIVE_RELIABLE_ITEM_LIMIT = 20;

/** ranking 阶段比较预算：clamp(n*4, n-1, 全部序对数)。n < 2 时为 0（无可比）。 */
export function adaptiveComparisonBudget(itemCount: number): number {
  if (itemCount < 2) return 0;
  const allPairs = (itemCount * (itemCount - 1)) / 2;
  return Math.max(
    itemCount - 1,
    Math.min(Math.ceil(itemCount * ADAPTIVE_COMPARISONS_PER_ITEM), allPairs),
  );
}

/** 与 src/lib/ranking.ts 的 pairKey 同款（\u0000 分隔）：状态里 recentPairKeys
 * 与 preferenceEdges 的键都由那边写入，自适应侧必须用同一套键才能命中冷却。 */
export function adaptivePairKey(leftId: string, rightId: string): string {
  return leftId < rightId ? leftId + "\u0000" + rightId : rightId + "\u0000" + leftId;
}

/** 参与排序的作品池：sourceIds 去掉用户已略过的。 */
export function adaptivePoolIds(state: RankingState): string[] {
  const skipped = new Set(state.skippedIds);
  return state.sourceIds.filter((id) => !skipped.has(id));
}

/** 从决策日志还原观测序列（双方都还在池内的 choose；ranking 与 verification
 * 阶段都计入——T-20261024-05 批二起复测结论也更新模型，最终榜单在全部复测
 * 结束后重同步。排序进行期间日志里不存在 verification 条目（复测队列只在
 * 排序预算耗尽后才开始排干），因此去掉阶段过滤不改变调度期行为，golden 可证）。 */
export function adaptiveObservations(state: RankingState): PreferenceObservation[] {
  const pool = new Set(adaptivePoolIds(state));
  const observations: PreferenceObservation[] = [];
  for (const decision of state.decisionLog) {
    if (decision.kind !== "choose" || !decision.preferredId) continue;
    const otherId =
      decision.preferredId === decision.candidateId ? decision.opponentId : decision.candidateId;
    if (!pool.has(decision.preferredId) || !pool.has(otherId)) continue;
    observations.push({ winnerId: decision.preferredId, loserId: otherId });
  }
  return observations;
}

/**
 * 用决策日志重建 BT 能力模型（纯函数，撤销/重放时结果一致）。
 *
 * 用全量批量拟合而不是逐条 recordObservations：逐条更新是路径依赖的，
 * 早期观测先把方差收窄，后面证据再多也拉不动（实测 top-5 只命中 3/5）。
 * 批量拟合与观测顺序无关，方差反映总证据量（见 preferenceModel.fitPreferenceModel）。
 */
export function buildAdaptiveModel(state: RankingState): PreferenceModelState {
  const ids = adaptivePoolIds(state);
  return fitPreferenceModel(ids, adaptiveObservations(state));
}

/** 每件作品接触过的不同对手数（覆盖率补偿的输入）。 */
export function adaptiveOpponentCounts(state: RankingState): Record<string, number> {
  const contacts: Record<string, Set<string>> = {};
  const add = (id: string, opponentId: string) => {
    const seen = contacts[id] ?? new Set<string>();
    seen.add(opponentId);
    contacts[id] = seen;
  };
  for (const decision of state.decisionLog) {
    if (decision.phase !== "ranking") continue;
    add(decision.candidateId, decision.opponentId);
    add(decision.opponentId, decision.candidateId);
  }
  const counts: Record<string, number> = {};
  for (const id of Object.keys(contacts)) counts[id] = contacts[id].size;
  return counts;
}

/** 冷却输入：序对键取「状态里的 recentPairKeys ∪ 最近 3 条决策」，与 ranking.ts 同语义。 */
function recentPairKeysForCooldown(state: RankingState): string[] {
  const keys = [...state.recentPairKeys];
  for (const decision of state.decisionLog.slice(-ADAPTIVE_PAIR_COOLDOWN))
    keys.push(adaptivePairKey(decision.candidateId, decision.opponentId));
  return [...new Set(keys)];
}

/** 冷却输入：最近 4 条决策涉及的作品 id（含被暂放的），与 ranking.ts 同语义。 */
function recentWorkIdsForCooldown(state: RankingState): string[] {
  const ids: string[] = [];
  for (const decision of state.decisionLog.slice(-ADAPTIVE_WORK_COOLDOWN)) {
    ids.push(decision.candidateId, decision.opponentId);
    if (decision.kind === "defer" && decision.targetId) ids.push(decision.targetId);
  }
  return [...new Set(ids)];
}

/** 最近被「暂放」的作品：本轮选对时先避开，过几轮后自然回到池中。 */
function recentlyDeferredIds(state: RankingState): Set<string> {
  const deferred = new Set<string>();
  for (const decision of state.decisionLog.slice(-ADAPTIVE_WORK_COOLDOWN))
    if (decision.kind === "defer" && decision.targetId) deferred.add(decision.targetId);
  return deferred;
}

/** 把模型名次同步回 RankingState：rankedIds=topN、outsideTopIds=其余、pendingIds=未达标者。 */
export function syncAdaptiveRanking(state: RankingState): RankingState {
  const pool = adaptivePoolIds(state);
  const order = getPreferenceOrder(buildAdaptiveModel(state));
  const compared = new Set<string>();
  for (const observation of adaptiveObservations(state)) {
    compared.add(observation.winnerId);
    compared.add(observation.loserId);
  }
  const contacts = adaptiveOpponentCounts(state);
  const topN = Math.max(0, state.topN);
  return {
    ...state,
    rankedIds: order.slice(0, topN),
    outsideTopIds: order.slice(topN),
    pendingIds: pool.filter((id) => (contacts[id] ?? 0) < ADAPTIVE_MIN_OPPONENTS),
    deferredIds: state.deferredIds.filter((id) => pool.includes(id)),
    processedCount: Math.max(state.processedCount, compared.size),
  };
}

export interface AdaptiveScheduleResult {
  state: RankingState;
  /** true = ranking 阶段结束（预算用完或池不足两件），调用方应转入既有复测流程。 */
  done: boolean;
}

/** 选下一对：信息量 + 覆盖率打分，冷却沿用旧语义；预算用完返回 done。 */
export function scheduleAdaptiveCandidate(state: RankingState): AdaptiveScheduleResult {
  // T-20261024-05 性能：此前本函数经 syncAdaptiveRanking 与 selectAdaptivePair
  // 各算一遍模型/对手计数/日志扫描（两次批量拟合）。三者的输入只依赖
  // decisionLog/sourceIds/skippedIds——与 sync 产出的差异字段无关，两次结果
  // 逐字等价——故在此合并为一次计算，同步字段照旧内联生成（golden 指纹锁定等价）。
  const pool = adaptivePoolIds(state);
  const observations = adaptiveObservations(state);
  const model = fitPreferenceModel(pool, observations);
  const order = getPreferenceOrder(model);
  const compared = new Set<string>();
  for (const observation of observations) {
    compared.add(observation.winnerId);
    compared.add(observation.loserId);
  }
  const contacts = adaptiveOpponentCounts(state);
  const topN = Math.max(0, state.topN);
  const synced: RankingState = {
    ...state,
    rankedIds: order.slice(0, topN),
    outsideTopIds: order.slice(topN),
    pendingIds: pool.filter((id) => (contacts[id] ?? 0) < ADAPTIVE_MIN_OPPONENTS),
    deferredIds: state.deferredIds.filter((id) => pool.includes(id)),
    processedCount: Math.max(state.processedCount, compared.size),
  };
  if (
    pool.length < 2 ||
    synced.comparisonCount >= adaptiveComparisonBudget(synced.sourceIds.length)
  )
    return { state: synced, done: true };
  const deferred = recentlyDeferredIds(synced);
  const selectable = pool.filter((id) => !deferred.has(id));
  const recentPairs = recentPairKeysForCooldown(synced);
  const recentWorks = recentWorkIdsForCooldown(synced);
  const pair = selectAdaptivePair({
    ids: selectable.length >= 2 ? selectable : pool,
    model,
    recentPairKeys: recentPairs,
    recentWorkIds: recentWorks,
    opponentCounts: contacts,
    pairKeyOf: adaptivePairKey,
    options: {
      minOpponents: ADAPTIVE_MIN_OPPONENTS,
      // 传进来的是「已经取好的冷却集合」，所以窗口取集合长度，避免被二次截断。
      pairCooldown: Math.max(ADAPTIVE_PAIR_COOLDOWN, recentPairs.length),
      workCooldown: Math.max(ADAPTIVE_WORK_COOLDOWN, recentWorks.length),
    },
  });
  if (!pair) return { state: synced, done: true };
  return {
    state: {
      ...synced,
      activeInsertion: {
        candidateId: pair.leftId,
        opponentId: pair.rightId,
        low: 0,
        high: Math.max(1, synced.rankedIds.length),
        presentationIndex: synced.nextPresentationIndex,
        stage: "bisect",
      },
      nextPresentationIndex: synced.nextPresentationIndex + 1,
      completed: false,
    },
    done: false,
  };
}

/** 略过/暂放某件作品：自适应没有二分区间可收缩，直接移出当前选择集（略过=出池）。 */
export function removeAdaptiveWork(
  state: RankingState,
  workId: string,
  kind: "skip" | "defer",
): RankingState {
  const skippedIds =
    kind === "skip" && !state.skippedIds.includes(workId)
      ? [...state.skippedIds, workId]
      : state.skippedIds;
  const deferredIds =
    kind === "defer" && !state.deferredIds.includes(workId)
      ? [...state.deferredIds, workId]
      : state.deferredIds;
  return {
    ...state,
    skippedIds,
    deferredIds,
    rankedIds: state.rankedIds.filter((id) => id !== workId),
    pendingIds: state.pendingIds.filter((id) => id !== workId),
    activeInsertion: null,
  };
}

export interface AdaptivePairInsight {
  /** 左侧作品的名次区间（90% 置信，近似）。 */
  left: RankInterval | null;
  right: RankInterval | null;
  /** 这一对的信息量 p(1-p)(σ²+σ²)，用于 UI 的「信息量」提示。 */
  information: number;
  /** ranking 阶段预计还需的取舍次数。 */
  remaining: number;
  /** 该对是否为高信息量（> 0.05，用于文案与视觉强调）。 */
  informative: boolean;
}

/** 当前这一对的名次区间与信息量（只算一次 O(n²)，UI 每回合调用一次）。 */
export function getAdaptivePairInsight(
  state: RankingState,
  leftId: string,
  rightId: string,
): AdaptivePairInsight {
  const model = buildAdaptiveModel(state);
  const rows = getRankIntervals(model, { level: ADAPTIVE_INTERVAL_LEVEL });
  const find = (id: string) => rows.find((row) => row.id === id) ?? null;
  const information = expectedInformation(model, leftId, rightId);
  return {
    left: find(leftId),
    right: find(rightId),
    information,
    remaining: Math.max(
      0,
      adaptiveComparisonBudget(state.sourceIds.length) - state.comparisonCount,
    ),
    informative: information > 0.05,
  };
}

/** 当前模型名次（未截断，含 Top N 之外的作品）：结果页/榜单展示用。 */
export function getAdaptiveOrder(state: RankingState): string[] {
  return getPreferenceOrder(buildAdaptiveModel(state));
}
