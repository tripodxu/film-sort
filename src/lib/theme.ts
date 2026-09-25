// 主题系统：data-theme 挂到 <html>，选择持久化到 localStorage。
// modern（默认）= 现行深色玻璃霓虹；其余内置主题仅是 :root 变量覆写块（见 styles.css）。
// 自定义主题（themeRegistry 导入的变量包）与内置主题共用 data-theme 管道：
// listThemes() 合并枚举，applyTheme 对未注册（已删除）的 id 回退 modern。

import { isCustomTheme } from "./themeRegistry";

export const THEME_KEY = "art-rank:theme";
export const THEMES = [
  { id: "modern", zh: "现代", en: "Modern" },
  { id: "retro", zh: "复古纸感", en: "Retro Paper" },
  { id: "minimal", zh: "极简", en: "Minimal" },
  { id: "simple", zh: "简约", en: "Simple" },
  { id: "classic", zh: "古典", en: "Classic" },
  { id: "cyber", zh: "赛博朋克", en: "Cyberpunk" },
  { id: "paper", zh: "纸上擂台", en: "Paper Arena" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const isTheme = (v: string): v is ThemeId => THEMES.some((t) => t.id === v);

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
  if (id === "modern") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", id);
  // theme-color meta 跟随 --bg 实际渲染色
  const probe = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (probe) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", probe);
  // 通知订阅者（如开场光球 applyPalette）；同步派发，DOM 属性已就位
  window.dispatchEvent(new CustomEvent("art-rank:theme-changed"));
}
