export type ConfidenceTone = "low" | "medium" | "high";

export interface ConfidenceBadgeProps {
  /** 0-100 的置信度；口径由调用方决定（本组件不做任何业务判断）。 */
  level: number;
  /** 徽章文案（调用方负责 i18n）。 */
  label: string;
  /** 悬停提示：说明这个置信度是怎么算出来的。 */
  hint?: string;
}

const HIGH_THRESHOLD = 80;
const MEDIUM_THRESHOLD = 50;

export function confidenceTone(level: number): ConfidenceTone {
  if (level >= HIGH_THRESHOLD) return "high";
  if (level >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

/**
 * 置信度徽章（S3 新增，纯展示）：比较页的样本量往往很小，只给一个分数会被误读，
 * 所以每个新指标旁边挂一枚按样本量/区间宽度算出来的置信度。组件只负责把 0-100
 * 映射到三档样式，颜色全部走 --confidence-* 令牌，不写裸色值。
 */
export function ConfidenceBadge({ level, label, hint }: ConfidenceBadgeProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(level)));
  return (
    <span className={"confidence-badge is-" + confidenceTone(clamped)} title={hint}>
      <span className="confidence-badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
