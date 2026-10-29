/** 在线 Bradley-Terry 能力模型（计划 S1 / A1，纯新增模块）。
 *
 * 本文件在 S1 阶段零引用：不改变任何既有排序行为，只有显式 import 才生效。
 *
 * 为什么需要它：旧的二分插入只输出一个确定名次，无法表达「第 4 名还是第 7 名」。
 * 这里用在线 BT（logistic 配对比较模型）+ 一步 Newton 更新，同时维护能力值 theta
 * 与方差 sigma^2，从而派生出名次区间而非单点名次。
 *
 * 关键取舍：
 * - 不可变更新：recordObservation 返回新 state，绝不改写入参（贴合既有纯函数风格，
 *   便于接入 RankingState 的草稿与快照）。
 * - 完全确定性：无随机数、无外部依赖，同一输入重复调用得到同一输出。
 * - L2 收缩 shrinkage 作为固定先验精度 N(0, 1/shrinkage)，防止极小样本下 theta 失控。
 * - 学习率 learningRate 只阻尼 theta 的步长；方差始终取精确后验（收缩单调且安全）。
 *
 * 已知且有意的行为（分离情形）：同一对反复出现同一边倒结果时，极大似然解不存在
 * （separation），此时 MAP 解由先验定界，|theta| 上界约为 1/shrinkage（默认 20），
 * 名次区间会收窄到确定的单一名次——这是「连胜 12 轮」这类证据应有的自信度，
 * 不是 bug；需要更保守的表达时把 shrinkage 调大或给 RankIntervalOptions.inflation 加系数。
 * 同一对反复出现时胜者 theta 会先升后回落（单对实测第 7 轮见顶 0.62 后缓慢回到 0）：
 * 对手塌陷后这场胜利不再带来信息，先验把它拉回 0，而两者的名次差始终单调拉大，
 * 排名结论不受影响。
 */

export interface PreferenceObservation {
  winnerId: string;
  loserId: string;
}

export interface PreferenceModelOptions {
  /** 初始能力值 theta，默认 0。 */
  initialRating?: number;
  /** 初始方差，默认 1。 */
  initialVariance?: number;
  /** 步长阻尼，默认 1（完整 Newton 步）。 */
  learningRate?: number;
  /** L2 收缩强度（固定先验精度），默认 0.05。 */
  shrinkage?: number;
  /** 方差下限，防数值塌陷，默认 1e-4。 */
  minVariance?: number;
  /** 方差上限，默认 4。 */
  maxVariance?: number;
}

export interface PreferenceRating {
  id: string;
  /** 能力值。 */
  theta: number;
  /** 方差 sigma^2。 */
  variance: number;
  /** 标准差 sigma。 */
  sigma: number;
  wins: number;
  losses: number;
}

export interface PreferenceModelState {
  ratings: Record<string, PreferenceRating>;
  /** 插入顺序（确定性遍历用）。 */
  order: readonly string[];
  comparisons: number;
  options: Required<PreferenceModelOptions>;
}

export interface RankIntervalOptions {
  /** 置信水平，默认 0.9。 */
  level?: number;
  /** 区间膨胀系数（乘在名次标准差上），默认 1。 */
  inflation?: number;
}

export interface RankInterval {
  id: string;
  theta: number;
  sigma: number;
  /** 点估计名次，1 基，取整后夹在 [1, n]。 */
  rank: number;
  /** 未取整的期望名次。 */
  rankEstimate: number;
  /** 区间下界（更好的名次）。 */
  low: number;
  /** 区间上界。 */
  high: number;
  /** high - low。 */
  width: number;
  level: number;
}

export const DEFAULT_PREFERENCE_OPTIONS: Readonly<Required<PreferenceModelOptions>> = Object.freeze(
  {
    initialRating: 0,
    initialVariance: 1,
    learningRate: 1,
    shrinkage: 0.05,
    minVariance: 1e-4,
    maxVariance: 4,
  },
);

function resolveOptions(partial: PreferenceModelOptions = {}): Required<PreferenceModelOptions> {
  return {
    initialRating: partial.initialRating ?? DEFAULT_PREFERENCE_OPTIONS.initialRating,
    initialVariance: partial.initialVariance ?? DEFAULT_PREFERENCE_OPTIONS.initialVariance,
    learningRate: partial.learningRate ?? DEFAULT_PREFERENCE_OPTIONS.learningRate,
    shrinkage: partial.shrinkage ?? DEFAULT_PREFERENCE_OPTIONS.shrinkage,
    minVariance: partial.minVariance ?? DEFAULT_PREFERENCE_OPTIONS.minVariance,
    maxVariance: partial.maxVariance ?? DEFAULT_PREFERENCE_OPTIONS.maxVariance,
  };
}

function clampVariance(variance: number, options: Required<PreferenceModelOptions>): number {
  if (!Number.isFinite(variance)) return options.maxVariance;
  return Math.min(options.maxVariance, Math.max(options.minVariance, variance));
}

function makeRating(
  id: string,
  options: Required<PreferenceModelOptions>,
  seed: { wins: number; losses: number } = { wins: 0, losses: 0 },
): PreferenceRating {
  const variance = clampVariance(options.initialVariance, options);
  return {
    id,
    theta: options.initialRating,
    variance,
    sigma: Math.sqrt(variance),
    wins: seed.wins,
    losses: seed.losses,
  };
}

/** 用给定 id 列表建模型（重复 id 只保留第一次出现的）。 */
export function createPreferenceModel(
  ids: readonly string[] = [],
  options: PreferenceModelOptions = {},
): PreferenceModelState {
  const resolved = resolveOptions(options);
  const order: string[] = [];
  const ratings: Record<string, PreferenceRating> = {};
  for (const id of ids) {
    if (ratings[id]) continue;
    ratings[id] = makeRating(id, resolved);
    order.push(id);
  }
  return { ratings, order, comparisons: 0, options: resolved };
}

export function getPreferenceRating(
  state: PreferenceModelState,
  id: string,
): PreferenceRating | null {
  return state.ratings[id] ?? null;
}

/** 标准 logistic：P(A 胜 B) = 1 / (1 + exp(-(thetaA - thetaB)))。 */
export function expectedWinProbability(thetaA: number, thetaB: number): number {
  return 1 / (1 + Math.exp(-(thetaA - thetaB)));
}

/** 用当前模型预测 A 胜 B 的概率。 */
export function predictPairProbability(
  state: PreferenceModelState,
  aId: string,
  bId: string,
): number {
  const a = state.ratings[aId];
  const b = state.ratings[bId];
  const thetaA = a ? a.theta : state.options.initialRating;
  const thetaB = b ? b.theta : state.options.initialRating;
  return expectedWinProbability(thetaA, thetaB);
}

/** 记录一次取舍，返回新 state（不修改入参）。同 id 自比直接原样返回。 */
export function recordObservation(
  state: PreferenceModelState,
  winnerId: string,
  loserId: string,
): PreferenceModelState {
  if (winnerId === loserId) return state;
  const options = state.options;
  const winner = state.ratings[winnerId] ?? makeRating(winnerId, options);
  const loser = state.ratings[loserId] ?? makeRating(loserId, options);

  // MAP 一步 Newton：先验 N(0, 1/shrinkage) 的曲率与梯度都必须进公式。
  // 少了梯度项 -shrinkage * theta，败者会随连败无界漂移（实测 12 轮跑到 -9、40 轮 -21），
  // 名次区间随之虚假收窄——曲率与梯度必须成对出现，这是本模块唯一的对称项。
  const precisionWinner = 1 / winner.variance;
  const precisionLoser = 1 / loser.variance;
  const p = expectedWinProbability(winner.theta, loser.theta);
  const fisher = p * (1 - p);
  const curvature = options.shrinkage;
  const hessianWinner = precisionWinner + fisher + curvature;
  const hessianLoser = precisionLoser + fisher + curvature;
  const det = hessianWinner * hessianLoser - fisher * fisher;
  const safeDet = det > 0 ? det : Number.EPSILON;

  const gradientWinner = 1 - p - curvature * winner.theta;
  const gradientLoser = -p - curvature * loser.theta;
  const deltaWinner = (hessianLoser * gradientWinner + fisher * gradientLoser) / safeDet;
  const deltaLoser = (fisher * gradientWinner + hessianWinner * gradientLoser) / safeDet;

  const winnerVariance = clampVariance(hessianLoser / safeDet, options);
  const loserVariance = clampVariance(hessianWinner / safeDet, options);

  const nextWinner: PreferenceRating = {
    id: winnerId,
    theta: winner.theta + options.learningRate * deltaWinner,
    variance: winnerVariance,
    sigma: Math.sqrt(winnerVariance),
    wins: winner.wins + 1,
    losses: winner.losses,
  };
  const nextLoser: PreferenceRating = {
    id: loserId,
    theta: loser.theta + options.learningRate * deltaLoser,
    variance: loserVariance,
    sigma: Math.sqrt(loserVariance),
    wins: loser.wins,
    losses: loser.losses + 1,
  };

  const order = state.order.slice();
  if (!state.ratings[winnerId]) order.push(winnerId);
  if (!state.ratings[loserId]) order.push(loserId);

  return {
    ratings: { ...state.ratings, [winnerId]: nextWinner, [loserId]: nextLoser },
    order,
    comparisons: state.comparisons + 1,
    options,
  };
}

/** 批量记录（按顺序逐条应用）。 */
export function recordObservations(
  state: PreferenceModelState,
  observations: readonly PreferenceObservation[],
): PreferenceModelState {
  let next = state;
  for (const observation of observations) {
    next = recordObservation(next, observation.winnerId, observation.loserId);
  }
  return next;
}

/**
 * 全量批量拟合（坐标上升 MAP）。
 *
 * 与逐条 recordObservation 的区别（这是 adaptive 模式必须用它的原因）：
 * - 逐条更新是路径依赖的：早期观测先动了 theta，方差又被每次观测乘性收窄，
 *   后面再多证据也拉不动（实测 12 件清单 50 次比较只命中 3/5，而二分插入 26 次就 5/5）。
 * - 批量拟合与观测顺序无关，方差取最终对角 Laplace = 1/(Σ p(1-p) + prior)，
 *   区间宽度反映总证据量，而不是「被更新了多少次」。
 * 代价是 O(passes · N · D) 的纯算术，不做矩阵分解（对角近似，与 getRankInterval 同源）。
 */
export interface PreferenceFitOptions {
  /** 坐标上升轮数上限，默认 6。 */
  passes?: number;
  /** 收敛阈值：单轮最大 |Δtheta| 小于它就提前停，默认 1e-4。 */
  tolerance?: number;
  /** 先验精度（曲率），默认取 options.shrinkage，即 N(0, 1/shrinkage)。 */
  priorPrecision?: number;
}

export function fitPreferenceModel(
  ids: readonly string[],
  observations: readonly PreferenceObservation[],
  options: PreferenceModelOptions = {},
  fitOptions: PreferenceFitOptions = {},
): PreferenceModelState {
  const resolved = resolveOptions(options);
  const base = createPreferenceModel(ids, resolved);
  const prior = fitOptions.priorPrecision ?? resolved.shrinkage;
  const passes = Math.max(1, Math.floor(fitOptions.passes ?? 6));
  const tolerance = fitOptions.tolerance ?? 1e-4;
  const wins: Record<string, number> = {};
  const losses: Record<string, number> = {};
  const usable: PreferenceObservation[] = [];
  // T-20261029-PERF：按 id 预聚合边表，避免每个坐标都全量扫一遍观测。
  // 每条边上仍按原观测顺序追加，逐 id 的累加顺序与旧实现逐字相同（浮点结果不变）。
  const edges: Record<string, { opponentId: string; win: boolean }[]> = {};
  for (const observation of observations) {
    const { winnerId, loserId } = observation;
    if (winnerId === loserId) continue;
    if (!base.ratings[winnerId] || !base.ratings[loserId]) continue;
    usable.push({ winnerId, loserId });
    wins[winnerId] = (wins[winnerId] ?? 0) + 1;
    losses[loserId] = (losses[loserId] ?? 0) + 1;
    (edges[winnerId] ??= []).push({ opponentId: loserId, win: true });
    (edges[loserId] ??= []).push({ opponentId: winnerId, win: false });
  }

  const theta: Record<string, number> = {};
  for (const id of base.order) theta[id] = resolved.initialRating;

  for (let pass = 0; pass < passes; pass += 1) {
    let maxDelta = 0;
    for (const id of base.order) {
      // 一维牛顿：固定其他坐标，求 theta_i 的一维 MAP 解。
      let gradient = -prior * (theta[id] - resolved.initialRating);
      let curvature = prior;
      for (const { opponentId, win } of edges[id] ?? []) {
        const p = win
          ? expectedWinProbability(theta[id], theta[opponentId])
          : expectedWinProbability(theta[opponentId], theta[id]);
        gradient += win ? 1 - p : -(1 - p);
        curvature += p * (1 - p);
      }
      const delta = (resolved.learningRate * gradient) / Math.max(curvature, Number.EPSILON);
      theta[id] += delta;
      const magnitude = Math.abs(delta);
      if (magnitude > maxDelta) maxDelta = magnitude;
    }
    if (maxDelta < tolerance) break;
  }

  // 方差 = 对角 Laplace 近似（固定其他坐标的曲率倒数），与 theta 用同一批观测。
  const ratings: Record<string, PreferenceRating> = {};
  for (const id of base.order) {
    let curvature = prior;
    for (const { opponentId, win } of edges[id] ?? []) {
      const p = win
        ? expectedWinProbability(theta[id], theta[opponentId])
        : expectedWinProbability(theta[opponentId], theta[id]);
      curvature += p * (1 - p);
    }
    const variance = clampVariance(1 / Math.max(curvature, Number.EPSILON), resolved);
    ratings[id] = {
      id,
      theta: theta[id],
      variance,
      sigma: Math.sqrt(variance),
      wins: wins[id] ?? 0,
      losses: losses[id] ?? 0,
    };
  }

  return { ratings, order: base.order.slice(), comparisons: usable.length, options: resolved };
}

/** 按 theta 降序（同分按 id 升序）的作品 id 顺序。 */
export function getPreferenceOrder(state: PreferenceModelState): string[] {
  return state.order.slice().sort((aId, bId) => {
    const a = state.ratings[aId];
    const b = state.ratings[bId];
    const thetaA = a ? a.theta : 0;
    const thetaB = b ? b.theta : 0;
    if (thetaA !== thetaB) return thetaB - thetaA;
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });
}

/** Acklam 逆正态分位数近似（|误差| < 1.15e-9），避免引入依赖。 */
export function normalQuantile(probability: number): number {
  if (probability <= 0) return Number.NEGATIVE_INFINITY;
  if (probability >= 1) return Number.POSITIVE_INFINITY;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (probability < pLow) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** 单件作品的名次区间：解析近似（序对间视为独立，已在文档与 UI 注明为近似）。 */
export function getRankInterval(
  state: PreferenceModelState,
  id: string,
  options: RankIntervalOptions = {},
): RankInterval | null {
  if (!state.ratings[id]) return null;
  const rows = getRankIntervals(state, options);
  return rows.find((row) => row.id === id) ?? null;
}

/** 全部作品的名次区间，按期望名次升序（同分按 id 升序）。 */
export function getRankIntervals(
  state: PreferenceModelState,
  options: RankIntervalOptions = {},
): RankInterval[] {
  const ids = state.order;
  const n = ids.length;
  if (n === 0) return [];
  const level = options.level ?? 0.9;
  const inflation = options.inflation ?? 1;
  const z = normalQuantile(1 - (1 - level) / 2);

  const rows = ids.map((id) => {
    const rating = state.ratings[id];
    const theta = rating ? rating.theta : state.options.initialRating;
    const variance = rating ? rating.variance : state.options.initialVariance;
    let sumAbove = 0;
    let rankVariance = 0;
    for (const otherId of ids) {
      if (otherId === id) continue;
      const other = state.ratings[otherId];
      const otherTheta = other ? other.theta : state.options.initialRating;
      const otherVariance = other ? other.variance : state.options.initialVariance;
      const scale = Math.sqrt(variance + otherVariance);
      const diff = otherTheta - theta;
      const probability = scale > 0 ? expectedWinProbability(diff / scale, 0) : diff > 0 ? 1 : 0;
      sumAbove += probability;
      rankVariance += probability * (1 - probability);
    }
    const rankEstimate = 1 + sumAbove;
    const spread = z * Math.sqrt(rankVariance) * inflation;
    const clampRank = (value: number) => Math.min(n, Math.max(1, Math.round(value)));
    const rank = clampRank(rankEstimate);
    const low = clampRank(rankEstimate - spread);
    const high = clampRank(rankEstimate + spread);
    return {
      id,
      theta,
      sigma: Math.sqrt(variance),
      rank,
      rankEstimate,
      low: Math.min(low, rank),
      high: Math.max(high, rank),
      width: 0,
      level,
    };
  });

  for (const row of rows) row.width = row.high - row.low;
  rows.sort((a, b) => {
    if (a.rankEstimate !== b.rankEstimate) return a.rankEstimate - b.rankEstimate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return rows;
}
