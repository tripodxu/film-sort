import type { CSSProperties } from "react";

/**
 * `style` 允许 CSS 自定义属性（`--x`）。
 * 直接用 `as any` 会绕过整个 style 对象的类型检查；这个别名只放开 `--*` 键，
 * 其余属性仍按 `CSSProperties` 校验。
 */
export type CssVars = CSSProperties & Record<`--${string}`, string | number>;
