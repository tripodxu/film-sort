// L3 条件渲染能力（PLAN-ui-modernization v3）：TSX 按主题分支渲染。
// 铁律：分支的默认路径必须保持现有 DOM —— 旧主题渲染结果一字节不变，
// 由 ui-shot/ui-diff 的旧主题 zero-diff 兜底。
//
// themeFamily 是纯函数（node 环境单测覆盖）；useTheme 是薄 hook，
// DOM 行为在部署后的浏览器 smoke 中验收（同 themeRegistry 的测试边界约定）。

import { useEffect, useState } from "react";
import { readTheme } from "./theme";

/** 主题家族：TSX 分支判断只认家族，不认具体 id —— editorial/editorial-dark 共享同一套结构分支。 */
export type ThemeFamily = "editorial" | "aurora" | "gallery" | "classic";

const FAMILY_BY_ID: Record<string, Exclude<ThemeFamily, "classic">> = {
  editorial: "editorial",
  "editorial-dark": "editorial",
  aurora: "aurora",
  gallery: "gallery",
};

/** id → 家族。旧 7 主题与自定义主题包一律 classic（= 现有渲染路径）。 */
export function themeFamily(id: string): ThemeFamily {
  return FAMILY_BY_ID[id] ?? "classic";
}

/** 当前主题家族，跟随「主题」菜单切换即时重渲染。 */
export function useThemeFamily(): ThemeFamily {
  const [family, setFamily] = useState<ThemeFamily>(() => themeFamily(readTheme()));
  useEffect(() => {
    const onChange = () => setFamily(themeFamily(readTheme()));
    window.addEventListener("art-rank:theme-changed", onChange);
    return () => window.removeEventListener("art-rank:theme-changed", onChange);
  }, []);
  return family;
}
