// 主题系统：data-theme 挂到 <html>，选择持久化到 localStorage。
// modern（默认）= 现行深色玻璃霓虹；其余内置主题仅是 :root 变量覆写块（见 styles.css）。
// 自定义主题（themeRegistry 导入的变量包）与内置主题共用 data-theme 管道：
// listThemes() 合并枚举，applyTheme 对未注册（已删除）的 id 回退 modern。

import { isCustomTheme } from "./themeRegistry";
import { THEME_KEY, THEMES, isTheme, type ThemeId } from "./themeConstants";

export { THEME_KEY, THEMES, type ThemeId };

export function readTheme(): string {
  try {
    const v = localStorage.getItem(THEME_KEY) ?? "";
    // 内置 id 直接认；非内置 id 只有在自定义注册表里仍存在才认（已删除则回退）。
    if (isTheme(v) || isCustomTheme(v)) return v;
    return "modern";
  } catch {
    return "modern";
  }
}

export function applyTheme(id: string) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    /* 隐私模式 */
  }
  // 当前主题已被删除（style 已摘除）时回退 modern，避免挂着一个无定义的属性。
  if (!isTheme(id) && !isCustomTheme(id)) {
    id = "modern";
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {}
  }
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (id === "modern") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", id);
  // 强制同步重排，确保同一帧内所有变量原子切换，不产生过渡闪烁
  void root.offsetHeight;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  } else {
    root.classList.remove("theme-switching");
  }
  // theme-color meta 跟随 --bg 实际渲染色
  const probe = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (probe) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", probe);
  // 通知订阅者（如开场光球 applyPalette）；同步派发，DOM 属性已就位
  window.dispatchEvent(new CustomEvent("art-rank:theme-changed"));
}
