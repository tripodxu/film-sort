/**
 * 指标名旁的「?」：悬停或键盘聚焦时浮出释义。
 *
 * 抽取前 CompareView 把同一个 `<i>`（差别只在 `data-tip`）抄了 10 遍。重复本身便宜，
 * 贵的是**漏项**：这个控件有三条必须同时成立的要求——`.metric-help` 给外观、
 * `tabIndex` 让键盘能聚焦、`hit-expand` 把 16px 的小方块补出可点的命中区。
 * 抄第 11 遍时最容易丢的正是后两条，而丢掉之后它在界面上看起来完全正常。
 */
export function MetricHelp({ tip }: { tip: string }) {
  return (
    <i className="metric-help hit-expand" tabIndex={0} data-tip={tip}>
      ?
    </i>
  );
}
