/** Plackett-Luce 似然品味距离（T-20261024-05 批四，纯新增模块）。
 *
 * 与 τ 族指标互补的「有原理的综合相似度」：用一份完整排序拟合品味模型 θ
 * （Plackett-Luce，坐标上升一维 Newton MAP，与 preferenceModel.fitPreferenceModel
 * 同构——先验 N(0, shrinkage)、梯度含先验回收项），再算另一份排序在该模型下的
 * **平均选择概率**（逐步几何平均，映射 0-100）。它一步回答「我们的品味有多像」，
 * 不再需要拍脑袋的权重合成；名次差距的大小（错得有多远）与模型置信度都进入结论。
 *
 * 输入刻意做成最小耦合：只吃「每对作品的双方名次」，不 import profile 类型。
 * 并列名次按下标稳定破序（确定性）；少于两件不计算（返回 null）。
 */

export interface TasteDistanceOptions {
  /** 坐标上升轮数上限，默认 12（PL 每轮全量 Newton，排序型数据 12 轮内收敛）。 */
  passes?: number;
  /** 早停阈值（相邻两轮最大 |Δθ|），默认 1e-4。 */
  tolerance?: number;
  /** 先验精度（与 preferenceModel 的 shrinkage 同语义），默认 0.05。 */
  shrinkage?: number;
}

export interface TasteDistanceResult {
  /** 对方排序在己方品味模型下的平均选择概率（0-100）。 */
  peerUnderMine: number;
  /** 己方排序在对方品味模型下的平均选择概率（0-100）。 */
  mineUnderPeer: number;
  /** 双向几何平均（0-100）。 */
  symmetric: number;
  /** 参与计算的作品对数。 */
  pairCount: number;
}

const DEFAULTS = { passes: 12, tolerance: 1e-4, shrinkage: 0.05 } as const;
/** θ 的安全边界：先验精度 0.05 下 |θ| 自然上界 ≈ 1/0.05 = 20，钳制只挡 Newton 过冲。 */
const THETA_LIMIT = 25;

type FitOptions = Required<TasteDistanceOptions>;

/** 从完整排序（先 = 最好）拟合 PL θ。order[p] = 位置 p 上的作品下标。 */
function fitPlackettLuce(order: readonly number[], options: FitOptions): number[] {
  const n = order.length;
  const theta = new Array<number>(n).fill(0);
  for (let pass = 0; pass < options.passes; pass += 1) {
    let maxDelta = 0;
    for (let position = 0; position < n; position += 1) {
      const id = order[position];
      const weight = Math.exp(theta[id]);
      // step k 的剩余集 = order[k..n-1]；id 只出现在 k ≤ position 的剩余集里。
      // 从 k = position 起把后面的 e^θ 累成后缀和，再逐步回加前面位置的贡献。
      let suffix = weight;
      for (let k = position + 1; k < n; k += 1) suffix += Math.exp(theta[order[k]]);
      let gradient = 1 - options.shrinkage * theta[id];
      let curvature = options.shrinkage;
      for (let k = position; k >= 0; k -= 1) {
        if (k < position) suffix += Math.exp(theta[order[k]]);
        const probability = weight / suffix;
        gradient -= probability;
        curvature += probability * (1 - probability);
      }
      if (curvature <= 0) continue;
      const delta = Math.max(-5, Math.min(5, gradient / curvature));
      theta[id] = Math.max(-THETA_LIMIT, Math.min(THETA_LIMIT, theta[id] + delta));
      const magnitude = Math.abs(delta);
      if (magnitude > maxDelta) maxDelta = magnitude;
    }
    if (maxDelta < options.tolerance) break;
  }
  return theta;
}

/** 在 θ 模型下，order 每一步选中当前首件的概率的几何平均（×100）。
 * 后缀 exp 和先从尾到头算一遍，逐步累 log 概率；|θ| ≤ 25 时 double 求和无溢出。 */
function geometricMeanPickProbability(order: readonly number[], theta: readonly number[]): number {
  const n = order.length;
  const suffix = new Array<number>(n + 1).fill(0);
  for (let k = n - 1; k >= 0; k -= 1) suffix[k] = suffix[k + 1] + Math.exp(theta[order[k]]);
  let logProbabilitySum = 0;
  for (let k = 0; k < n; k += 1) logProbabilitySum += theta[order[k]] - Math.log(suffix[k]);
  return 100 * Math.exp(logProbabilitySum / n);
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 双向拟合 + 互评：少于两件返回 null。
 * 分数为**似然比**：对方排序在己方模型下的平均选择概率 ÷ 己方自身排序在同一模型
 * 下的平均选择概率 ×100。两个分子分母同含 (n!)^{-1/n} 的长尾衰减，相除后与共同
 * 件数无关（未归一化的几何平均随 n 系统性走低，n=120 完全一致也只有 ~13 分，
 * 不可跨维度比较——归一后完全一致恒为 100）。 */
export function computeTasteDistance(
  pairs: ReadonlyArray<{ ownRank: number; peerRank: number }>,
  options: TasteDistanceOptions = {},
): TasteDistanceResult | null {
  const n = pairs.length;
  if (n < 2) return null;
  const opts: FitOptions = { ...DEFAULTS, ...options };
  const mineOrder = pairs
    .map((pair, index) => ({ rank: pair.ownRank, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.index);
  const peerOrder = pairs
    .map((pair, index) => ({ rank: pair.peerRank, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.index);
  const mineTheta = fitPlackettLuce(mineOrder, opts);
  const peerTheta = fitPlackettLuce(peerOrder, opts);
  const ratioUnder = (
    candidate: readonly number[],
    reference: readonly number[],
    theta: readonly number[],
  ) =>
    geometricMeanPickProbability(candidate, theta) / geometricMeanPickProbability(reference, theta);
  const peerUnderMine = round1(Math.min(100, 100 * ratioUnder(peerOrder, mineOrder, mineTheta)));
  const mineUnderPeer = round1(Math.min(100, 100 * ratioUnder(mineOrder, peerOrder, peerTheta)));
  const symmetric = round1(Math.min(100, Math.sqrt(peerUnderMine * mineUnderPeer)));
  return { peerUnderMine, mineUnderPeer, symmetric, pairCount: n };
}
