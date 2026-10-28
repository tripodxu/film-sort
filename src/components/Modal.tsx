/**
 * 模态外壳（App 里 9 个弹窗共用）。
 *
 * 抽取前：App.tsx 有 9 份手写弹窗外壳，每份都重复同一段样板——焦点圈、半透背景层、
 * 面板上的 <section> 及其三条 ARIA 声明、事件冒泡拦截、Esc 分支，再加一组标题栏。
 * 重复本身没问题，问题是这四件事各自都可能被单独改错：
 *   ① 使用说明弹窗把 FocusTrap 写到了 backdrop **内层**（背景层不在 focus trap 里）；
 *   ② 标题栏有两种 DOM 结构（有无 eyebrow 差一层 div），改的时候容易顺手统一掉。
 *
 * 这里收成一份，差异走 props。**焦点归还、Esc、Tab 循环仍由 FocusTrap 承担**——
 * 本组件只负责把「声明 + 背景点击 + 事件冒泡」这三件的接线锁成唯一正解。
 */
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { FocusTrap } from "./FocusTrap";
import { IconButton } from "../views/IconButton";

export interface ModalProps {
  t: (zh: string, en: string) => string;
  /** 标题元素 id。`aria-labelledby` 指向它，必须在渲染树里真实存在，
   *  否则读屏读到一个没有名字的 dialog。 */
  headingId: string;
  /** 关闭回调：背景点击 / Esc / 标题栏关闭按钮三处共用，不可能出现「只有一个能关」。 */
  onClose: () => void;
  /** 面板 class。默认是标准对话外形。 */
  panelClassName?: string;
  /** 背景层 class（整串覆写，如 `"modal-backdrop note-backdrop"`）。 */
  backdropClassName?: string;
  /** 眉标。传了它，标题会被包进一层 `<div>` —— 两种标题栏 DOM 结构由 CSS 分别对待，
   *  这里是唯一知道这件事的地方。 */
  eyebrow?: ReactNode;
  /** 传了它渲染标准标题栏（标题 + 关闭按钮）；不传则由 children 自带头部
   *  （note-reader 的背景图头、guide/tech 的竖排 Eyebrow 都是这种）。 */
  title?: ReactNode;
  children?: ReactNode;
}

export function Modal({
  t,
  headingId,
  onClose,
  panelClassName = "account-dialog",
  backdropClassName = "modal-backdrop",
  eyebrow,
  title,
  children,
}: ModalProps) {
  return (
    <FocusTrap onEscape={onClose}>
      <div className={backdropClassName} onClick={onClose}>
        <section
          className={panelClassName}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        >
          {title != null && (
            <div className="section-heading">
              {eyebrow != null ? (
                <div>
                  <span className="eyebrow">{eyebrow}</span>
                  <h2 id={headingId}>{title}</h2>
                </div>
              ) : (
                <h2 id={headingId}>{title}</h2>
              )}
              <IconButton title={t("关闭", "Close")} onClick={onClose}>
                <X size={18} />
              </IconButton>
            </div>
          )}
          {children}
        </section>
      </div>
    </FocusTrap>
  );
}
