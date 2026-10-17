import type { RankInterval } from "../lib/preferenceModel";

export interface RankIntervalBarProps {
  /** 名次区间（null = 尚无估计，不渲染轨道）。 */
  interval: RankInterval | null;
  /** 池子里的作品总数，用于把名次映射到 0-100%。 */
  total: number;
}

/**
 * 名次区间条（S2 新增，纯展示）：把「第 low–high 名」画成轨道上的一段带，
 * 标记点是估计名次。只在 adaptive 模式渲染，旧三模式不引用本组件。
 */
export function RankIntervalBar({ interval, total }: RankIntervalBarProps) {
  if (!interval || total < 2) return null;
  const span = Math.max(1, total - 1);
  const toPercent = (rank: number) => {
    const clamped = Math.min(Math.max(rank, 1), total);
    return ((clamped - 1) / span) * 100;
  };
  const left = toPercent(interval.low);
  const width = Math.max(3, toPercent(interval.high) - left);
  return (
    <div className="rank-interval-bar" aria-hidden="true">
      <span className="rank-interval-band" style={{ left: left + "%", width: width + "%" }} />
      <span
        className="rank-interval-mark"
        style={{ left: toPercent(interval.rankEstimate) + "%" }}
      />
    </div>
  );
}
