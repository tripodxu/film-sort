import type { CSSProperties } from "react";

export type SkeletonVariant = "line" | "line-sm" | "block";

export interface SkeletonProps {
  /** 形状：line=14px 文本条，line-sm=10px 次要文本条，block=卡片/封面块。 */
  variant?: SkeletonVariant;
  /** 宽度。不定宽时给百分比即可让它在容器里自然留白。 */
  width?: number | string;
  /** 高度；不传则由 variant 决定。 */
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}

const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  line: "skeleton-line",
  "line-sm": "skeleton-line-sm",
  block: "skeleton-block",
};

/**
 * 骨架屏（统一 before：`plaza-pulse 1.5s` 手写一处、`--dur-pulse` token 另有一份、
 * ProfileView / SourceView 干脆只有「加载中…」四个字没有任何占位）。
 *
 * 动画时长统一走 --dur-pulse，减少动态效果由全局 @media 规则熔断。骨架屏是纯装饰，
 * 一律 aria-hidden —— 读屏只需要「加载中」的语义，不需要知道有几个方块在闪。
 */
export function Skeleton({ variant = "line", width, height, className, style }: SkeletonProps) {
  const names = ["skeleton", VARIANT_CLASS[variant], className ?? ""].filter(Boolean);
  return <div className={names.join(" ")} aria-hidden="true" style={{ width, height, ...style }} />;
}

export interface SkeletonRowsProps {
  /** 行数，默认 3。 */
  rows?: number;
  /** 每行宽度；不给则末行自动收短到 60%，让占位看起来更像真实文本。 */
  widths?: (number | string)[];
  className?: string;
}

/** 一组文本行占位：列表/卡片主体加载态的通用形。 */
export function SkeletonRows({ rows = 3, widths, className }: SkeletonRowsProps) {
  return (
    <div className={["u-col", className ?? ""].filter(Boolean).join(" ")} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={widths?.[i] ?? (i === rows - 1 ? "60%" : "100%")} />
      ))}
    </div>
  );
}
