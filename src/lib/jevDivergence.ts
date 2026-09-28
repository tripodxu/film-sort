// 相遇页「预测分歧」洞察（优化冲刺 Phase 6）的数据侧纯函数。
// 语义：用「我的」品味档案让 Jev 预测「我」会如何排对方的榜单（predictedRank），
// 与对方的真实排名（actualRank）求偏差——偏差最大的作品即「对方最出乎你意料的作品」。
// 预测请求本身走既有 /api/ai/jev-rank（profileContext=我的档案，works=对方榜单），
// 本模块只做「预测序 → 偏差 Top N」的纯换算，零网络零存储。

export interface DivergenceEntry<T> {
  item: T;
  /** 对方榜单里的真实名次（1 = 第一）。 */
  actualRank: number;
  /** 按我的品味预测的名次（1 = 我会排第一）。 */
  predictedRank: number;
  /** predictedRank − actualRank：> 0 = 对方排得比我预测的更高（惊喜上位）；< 0 = 更低（冷遇）。 */
  shift: number;
}

/**
 * 由 Jev 返回的 order（works 下标按预测偏好降序）求每个下标的预测名次（1-based）。
 * itemCount 用于过滤越界下标；order 中重复下标取首个、缺失则无该下标条目
 * （正常情况下 order 是 works 的全排列）。
 */
export function predictedPositions(
  order: readonly number[],
  itemCount: number,
): Map<number, number> {
  const positions = new Map<number, number>();
  order.forEach((index, position) => {
    if (Number.isInteger(index) && index >= 0 && index < itemCount && !positions.has(index))
      positions.set(index, position + 1);
  });
  return positions;
}

/**
 * 偏差 Top N：只收 shift ≠ 0 的作品（预测与真实一致毫无「出乎意料」可言），
 * 按 |shift| 降序，同分时对方真实名次靠前者优先（更醒目的惊喜）。
 * items 与传给 Jev 的 works 必须同序（actualRank 取数组位次 +1，而非 item.rank——
 * 合并榜单经 median 重排后 rank 可能有空洞/并列，展示名次以合并序为准）。
 */
export function topDivergences<T>(
  items: readonly T[],
  order: readonly number[],
  limit = 3,
): Array<DivergenceEntry<T>> {
  const positions = predictedPositions(order, items.length);
  const entries: Array<DivergenceEntry<T>> = [];
  items.forEach((item, index) => {
    const predictedRank = positions.get(index);
    if (predictedRank === undefined) return;
    const actualRank = index + 1;
    const shift = predictedRank - actualRank;
    if (shift === 0) return;
    entries.push({ item, actualRank, predictedRank, shift });
  });
  return entries
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift) || a.actualRank - b.actualRank)
    .slice(0, limit);
}
