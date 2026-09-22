// 布局模式：data-layout 挂到 <html>，与 data-theme 正交（主题管视觉、布局管版式）。
// archive（默认）= 现状逐像素不变；applyLayout("archive") 移除属性（同 applyTheme("modern")）。
// 1:1 复刻 theme.ts 机制（PLAN §5.1，最小 JS 面）。

export const LAYOUT_KEY = "art-rank:layout";
export const LAYOUTS = [
  { id: "archive", zh: "档案", en: "Archive" },
  { id: "journey", zh: "胶片盘", en: "Journey" },
  { id: "bento", zh: "档案格", en: "Bento" },
] as const;

export type LayoutId = (typeof LAYOUTS)[number]["id"];

const isLayout = (v: string): v is LayoutId => LAYOUTS.some((l) => l.id === v);

export function readLayout(): LayoutId {
  try {
    const v = localStorage.getItem(LAYOUT_KEY) ?? "";
    return isLayout(v) ? v : "archive";
  } catch {
    return "archive";
  }
}

export function applyLayout(id: LayoutId) {
  try {
    localStorage.setItem(LAYOUT_KEY, id);
  } catch {
    /* 隐私模式 */
  }
  if (id === "archive") document.documentElement.removeAttribute("data-layout");
  else document.documentElement.setAttribute("data-layout", id);
}
