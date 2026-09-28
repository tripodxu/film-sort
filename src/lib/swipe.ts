/**
 * 对战页滑动手势的纯判定逻辑。
 *
 * 语义与键盘一致:往哪边甩就选哪边(←/A = 左)。只有「水平意图占优且位移
 * 达到阈值」才算选择——垂直滚动(artwork-info 内滚、页面滚动)必须不受扰,
 * 所以 |dy| ≥ |dx| 时一律判 null。
 */

export type SwipeDecision = "left" | "right" | null;

/** 触发选择所需的最小水平位移(px)。 */
export const SWIPE_THRESHOLD = 56;

/**
 * 判定一次拖动手势是否构成有效选择。
 * @param dx 相对起点累计水平位移(向左为负)
 * @param dy 相对起点累计垂直位移(向下为正)
 */
export function decideSwipe(
  dx: number,
  dy: number,
  threshold: number = SWIPE_THRESHOLD,
): SwipeDecision {
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dy) >= Math.abs(dx)) return null;
  return dx < 0 ? "left" : "right";
}
