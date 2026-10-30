import { useEffect, useRef, type ReactNode } from "react";

export function FocusTrap({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // onEscape 走 ref 桥接：调用方（App）传的多是内联箭头，每次渲染换新身份。
  // 若把它放进监听 effect 的依赖，弹窗内容每次更新（详情数据到达是确定性的
  // 一次）都会重建监听并把焦点重新抢回第一个控件——用户焦点被弹回关闭按钮。
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 焦点归还（ROADMAP A / S5-2）：挂载时记下触发元素，卸载时归还——
    // 读屏/键盘用户关弹窗后焦点不再落回 body。元素已从文档移除则跳过。
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function handleKeyDown(e: KeyboardEvent) {
      // 监听挂 document 而非 el：焦点落在 trap 外（如点击了非按钮区域后
      // activeElement=body）时，挂在 el 上的监听收不到 keydown，圈就漏了。
      if (e.key === "Escape" && onEscapeRef.current) {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = el!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!document.activeElement || !el!.contains(document.activeElement)) {
        // 焦点在 trap 外：把它圈回来
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      // 焦点停在对话框容器上（挂载时的初始位置）。容器既不是 first 也不是 last，
      // 若不管，Shift+Tab 会从容器走到 trap 之外的文档前序节点——圈就漏了。
      if (document.activeElement === el!.querySelector('[role="dialog"]')) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    // 焦点优先给对话框容器本身（Modal 会带 tabIndex=-1），而不是第一个可聚焦元素。
    // 原因：长内容弹窗（使用说明 / 技术说明）的首个可聚焦元素在页脚，focus() 会把
    // 这个 overflow 容器直接滚到底部——用户一打开就从第 4 步开始看，前几步永远错过。
    // 聚焦容器还让读屏立刻念出 aria-labelledby 指向的标题。
    const dialog = el.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog && dialog.tabIndex === -1) {
      dialog.focus();
      dialog.scrollTop = 0;
    } else {
      const firstFocusable = el.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);

  return <div ref={ref}>{children}</div>;
}
