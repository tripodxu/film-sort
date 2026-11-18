import { THEME_KEY } from "./storageKeys";

export { THEME_KEY };

export const THEMES = [
  { id: "modern", zh: "现代", en: "Modern" },
  { id: "retro", zh: "复古纸感", en: "Retro Paper" },
  { id: "minimal", zh: "极简", en: "Minimal" },
  { id: "simple", zh: "简约", en: "Simple" },
  { id: "classic", zh: "古典", en: "Classic" },
  { id: "cyber", zh: "赛博朋克", en: "Cyberpunk" },
  { id: "paper", zh: "纸上擂台", en: "Paper Arena" },
  { id: "editorial", zh: "刊物", en: "Editorial" },
  { id: "editorial-dark", zh: "刊物暗色", en: "Editorial Dark" },
  { id: "aurora", zh: "极光", en: "Aurora" },
  { id: "gallery", zh: "画廊", en: "Gallery" },
  { id: "atlas", zh: "图册", en: "Atlas" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const isTheme = (v: string): v is ThemeId => THEMES.some((t) => t.id === v);
