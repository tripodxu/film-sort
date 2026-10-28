import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** 主文案。调用方负责 i18n。 */
  title?: ReactNode;
  /** 补充说明正文。 */
  description?: ReactNode;
  /** 动作区（按钮、上传入口等），统一居中并自带行间距。 */
  children?: ReactNode;
  /** 深链路由（/catalog/setup、/depth 等）直开时用：让空态在视口内居中，
   *  否则文案贴顶、下方留一屏空白。 */
  standalone?: boolean;
  /** 卡片内嵌的小空态用紧凑留白。 */
  compact?: boolean;
  /** 异步失败/加载态：挂 role=status 让读屏播报，否则用户看不到任何反馈。 */
  live?: boolean;
  /** error 档把主文案染成语义红（此前由调用方各自内联 `color:var(--red)`）。 */
  tone?: "default" | "error";
  /** 追加类名，给调用方的 scoped 钩子（如 `.depth-view .empty-state`）。 */
  className?: string;
}

/**
 * 空状态（改前：17 处各自手写 `<div className="empty-state">` 并内联留白，
 * 出现 40 / 60 / 无三档不一致，错误态还没有 role=status 导致读屏无反馈）。
 *
 * 组件本身零业务判断，只把「标题 / 说明 / 动作」三段结构与留白档位收敛到一处，
 * 视觉改动自此只需改 CSS 不再逐个视图搜 inline padding。
 */
export function EmptyState({
  title,
  description,
  children,
  standalone = false,
  compact = false,
  live = false,
  tone = "default",
  className,
}: EmptyStateProps) {
  const names = [
    "empty-state",
    standalone ? "empty-state-standalone" : "",
    compact ? "empty-state-pad-sm" : "empty-state-pad",
    tone === "error" ? "empty-state-error" : "",
    className ?? "",
  ].filter(Boolean);
  return (
    <div className={names.join(" ")} {...(live ? { role: "status" } : {})}>
      {title ? <p className="empty-state-title">{title}</p> : null}
      {description ? <p>{description}</p> : null}
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  );
}
