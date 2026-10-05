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

    // Focus first focusable element —— 只在挂载时取一次焦点，之后不抢用户的焦点
    const firstFocusable = el.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return <div ref={ref}>{children}</div>;
}
