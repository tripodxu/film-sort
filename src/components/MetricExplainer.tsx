import { useState, type ReactNode } from "react";

export interface MetricExplainerProps {
  /** 折叠条标题（调用方负责 i18n）。 */
  title: string;
  /** 展开后的说明正文。 */
  children: ReactNode;
  /** 是否默认展开；默认收起，避免新页首屏被说明文字淹没。 */
  defaultOpen?: boolean;
}

/**
 * 指标说明折叠条（S3 新增，纯展示 + 一个本地开关）：
 * 新指标名字本身不自明（头部加权 τ / 收缩共识分），但把解释全部铺在页面上又太吵，
 * 所以统一收进「+ 怎么读」。用 aria-expanded 标注开关状态，键盘可直接操作。
 */
export function MetricExplainer({ title, children, defaultOpen = false }: MetricExplainerProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"metric-explainer" + (open ? " is-open" : "")}>
      <button
        type="button"
        className="metric-explainer-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="metric-explainer-caret" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
        {title}
      </button>
      {open && <div className="metric-explainer-body">{children}</div>}
    </div>
  );
}
