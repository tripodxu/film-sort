// 自定义主题注册表：导入（解析+校验）→ 注入 → 持久化 → 枚举。
//
// 安全模型（重建式，非注入式）：用户提交的 CSS 文本**永远不会原样进入 DOM**。
// 解析器只从中抽取「变量名在白名单内、值通过字符白名单」的声明，再由本模块
// 用受控模板重新拼装 <style> 内容。任何逃逸尝试（} ; @import url( ...）都会
// 在解析阶段被拒绝，而不是被过滤后放过。

import { THEMES } from "./theme";

export const CUSTOM_THEME_KEY = "art-rank:custom-themes";
/** 单包上限与总配额：单主题 ~2KB 足够；64KB 防 localStorage 膨胀。 */
export const THEME_PACKAGE_LIMIT = 16 * 1024;
export const CUSTOM_THEMES_QUOTA = 64 * 1024;

/** 必需变量集：缺失任何一个都拒绝——半主题的渲染错乱比导入失败更糟。 */
const REQUIRED_VARS = [
  "--bg",
  "--text",
  "--text-2",
  "--text-3",
  "--muted",
  "--accent",
  "--accent-2",
  "--accent-ink",
  "--line",
  "--border-2",
  "--surface",
  "--surface-2",
  "--surface-3",
  "--surface-hover",
  "--film",
  "--book",
  "--music",
  "--other",
  "--scrim",
  "--toast-bg",
  "--toast-ink",
] as const;

/** 变量名白名单 = :root 全集（77 个）。未知 --x 一律拒绝。 */
const KNOWN_VARS = new Set<string>([
  "--accent",
  "--accent-2",
  "--accent-ink",
  "--bg",
  "--book",
  "--border-2",
  "--danger",
  "--danger-2",
  "--dur-1",
  "--dur-2",
  "--dur-3",
  "--ease-out",
  "--film",
  "--font-body",
  "--font-display",
  "--font-mono",
  "--font-serif",
  "--glass",
  "--glass-2",
  "--green",
  "--indigo",
  "--line",
  "--ls-mid",
  "--ls-wide",
  "--mask-opaque",
  "--music",
  "--muted",
  "--ok",
  "--other",
  "--pink",
  "--r-lg",
  "--r-md",
  "--r-pill",
  "--r-sm",
  "--r-xs",
  "--reader-dim",
  "--reader-poster-opacity",
  "--red",
  "--scrim",
  "--shade-deep",
  "--shade-soft",
  "--sp-1",
  "--sp-2",
  "--sp-3",
  "--sp-4",
  "--sp-5",
  "--sp-6",
  "--sp-7",
  "--sp-8",
  "--status-danger",
  "--status-ok",
  "--status-warn",
  "--surface",
  "--surface-2",
  "--surface-3",
  "--surface-4",
  "--surface-glow",
  "--surface-hover",
  "--t-body",
  "--t-display",
  "--t-h1",
  "--t-h2",
  "--t-h3",
  "--t-meta",
  "--t-micro",
  "--t-small",
  "--text",
  "--text-2",
  "--text-3",
  "--text-4",
  "--text-hi",
  "--toast-bg",
  "--toast-bg-2",
  "--toast-border",
  "--toast-ink",
  "--warn",
  "--yellow",
]);

/** 值的字符白名单：颜色/字体栈/圆角/时长的合法字符集。没有 ; { } @ < > \ 和 url。 */
const VALUE_ALLOWED = /^[a-zA-Z0-9 ,.%()'"#/+-]*$/;

export interface CustomThemeMeta {
  id: string;
  name: { zh: string; en: string };
  /** 菜单 dot 的双色（十六进制），预览用。 */
  dot: [string, string];
}

export interface CustomTheme extends CustomThemeMeta {
  /** 重建后的 CSS：[data-theme="id"]{...}，只含白名单声明。 */
  css: string;
}

export type ThemeImportError =
  | "empty"
  | "too_large"
  | "meta_missing"
  | "meta_invalid"
  | "id_conflict"
  | "block_missing"
  | "var_unknown"
  | "var_required_missing"
  | "value_invalid"
  | "quota_exceeded";

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const ID_RE = /^[a-z][a-z0-9-]{1,20}$/;

function fail(error: ThemeImportError): { ok: false; error: ThemeImportError } {
  return { ok: false, error };
}

/** 元数据注释：/*! art-rank-theme {"id":...} *​/ —— 取第一个匹配。 */
function parseMeta(
  source: string,
): { ok: true; meta: CustomThemeMeta } | { ok: false; error: ThemeImportError } {
  const m = source.match(/\/\*!\s*art-rank-theme\s*(\{[\s\S]*?\})\s*\*\//);
  if (!m) return fail("meta_missing");
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return fail("meta_invalid");
  }
  if (typeof raw !== "object" || raw === null) return fail("meta_invalid");
  const meta = raw as Record<string, unknown>;
  const { id, name, dot } = meta;
  if (typeof id !== "string" || !ID_RE.test(id)) return fail("meta_invalid");
  if ((THEMES as readonly { id: string }[]).some((t) => t.id === id)) return fail("id_conflict");
  if (
    typeof name !== "object" ||
    name === null ||
    typeof (name as Record<string, unknown>).zh !== "string" ||
    typeof (name as Record<string, unknown>).en !== "string" ||
    (name as { zh: string }).zh.length > 20 ||
    (name as { en: string }).en.length > 30
  )
    return fail("meta_invalid");
  if (
    !Array.isArray(dot) ||
    dot.length !== 2 ||
    !dot.every((c) => typeof c === "string" && HEX.test(c))
  )
    return fail("meta_invalid");
  return {
    ok: true,
    meta: {
      id,
      name: { zh: (name as { zh: string }).zh, en: (name as { en: string }).en },
      dot: [dot[0] as string, dot[1] as string],
    },
  };
}

/** 括号感知的声明分割：color-mix(...) 内部的字符不参与顶层判断。 */
function splitDeclarations(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

export type ParseResult =
  | { ok: true; theme: CustomTheme; declared: number }
  | { ok: false; error: ThemeImportError; detail?: string };

/**
 * 解析并校验一个主题包（元数据注释 + 变量声明块）。
 * 返回的 theme.css 是**重建**的受控 CSS，不是用户原文。
 */
export function parseThemePackage(source: string): ParseResult {
  if (!source.trim()) return fail("empty");
  if (source.length > THEME_PACKAGE_LIMIT) return fail("too_large");

  const meta = parseMeta(source);
  if (!meta.ok) return meta;
  const { id } = meta.meta;

  // 定位该 id 的声明块（容忍单/双引号或无引号）。
  const blockRe = new RegExp(
    `\\[data-theme=["']?${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\]\\s*\\{`,
  );
  const blockStart = source.search(blockRe);
  if (blockStart === -1) return fail("block_missing");
  const bodyStart = source.indexOf("{", blockStart) + 1;
  let depth = 1;
  let bodyEnd = bodyStart;
  while (bodyEnd < source.length && depth > 0) {
    const ch = source[bodyEnd];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    bodyEnd += 1;
  }
  if (depth !== 0) return fail("block_missing");
  const body = source.slice(bodyStart, bodyEnd - 1);

  const declarations: string[] = [];
  const seen = new Set<string>();
  for (const raw of splitDeclarations(body)) {
    const entry = raw.trim();
    if (!entry) continue;
    const colon = entry.indexOf(":");
    if (colon === -1) return { ok: false, error: "value_invalid", detail: entry.slice(0, 40) };
    const name = entry.slice(0, colon).trim().toLowerCase();
    const value = entry.slice(colon + 1).trim();
    if (!KNOWN_VARS.has(name))
      return { ok: false, error: "var_unknown", detail: name.slice(0, 40) };
    if (seen.has(name)) return { ok: false, error: "value_invalid", detail: `duplicate ${name}` };
    seen.add(name);
    if (!value || value.length > 300 || !VALUE_ALLOWED.test(value) || /url\s*\(/i.test(value))
      return { ok: false, error: "value_invalid", detail: `${name}: ${value.slice(0, 40)}` };
    const opens = (value.match(/\(/g) ?? []).length;
    const closes = (value.match(/\)/g) ?? []).length;
    if (opens !== closes)
      return { ok: false, error: "value_invalid", detail: `${name}: unbalanced parens` };
    declarations.push(`${name}:${value}`);
  }

  const missing = REQUIRED_VARS.filter((v) => !seen.has(v));
  if (missing.length)
    return { ok: false, error: "var_required_missing", detail: missing.join(",") };

  return {
    ok: true,
    declared: declarations.length,
    theme: {
      ...meta.meta,
      css: `[data-theme="${id}"]{${declarations.join(";")}}`,
    },
  };
}

// ===== 存储与注入 =====

interface StoredTheme {
  id: string;
  meta: CustomThemeMeta;
  /** 原始包文本（重建式注入在恢复时重新执行，保证校验规则升级后仍安全）。 */
  source: string;
}

function readStore(): StoredTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredTheme =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as StoredTheme).id === "string" &&
        typeof (entry as StoredTheme).source === "string",
    );
  } catch {
    return [];
  }
}

function writeStore(entries: StoredTheme[]): boolean {
  try {
    const serialized = JSON.stringify(entries);
    if (serialized.length > CUSTOM_THEMES_QUOTA) return false;
    localStorage.setItem(CUSTOM_THEME_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

/** 把一个自定义主题的 CSS 挂载为 <style>；重复 id 覆盖。 */
export function injectCustomTheme(theme: CustomTheme): void {
  let style = document.querySelector<HTMLStyleElement>(`style[data-custom-theme="${theme.id}"]`);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-custom-theme", theme.id);
    document.head.appendChild(style);
  }
  style.textContent = theme.css;
}

export function removeCustomThemeStyle(id: string): void {
  // id 已由 ID_RE（[a-z][a-z0-9-]{1,20}）约束，无需 CSS.escape
  document.querySelector(`style[data-custom-theme="${id}"]`)?.remove();
}

/** 启动恢复：重建全部自定义主题的 <style>（在首帧渲染前调用）。 */
export function restoreCustomThemes(): void {
  for (const entry of readStore()) {
    const parsed = parseThemePackage(entry.source);
    if (parsed.ok) injectCustomTheme(parsed.theme);
    else removeCustomThemeStyle(entry.id); // 校验规则升级后不合规的旧包静默移除
  }
}

export function listCustomThemes(): CustomThemeMeta[] {
  return readStore()
    .map((entry) => {
      const parsed = parseThemePackage(entry.source);
      return parsed.ok ? parsed.theme : null;
    })
    .filter((t): t is CustomTheme => t !== null)
    .map(({ id, name, dot }) => ({ id, name, dot }));
}

export function isCustomTheme(id: string): boolean {
  return readStore().some((entry) => entry.id === id);
}

/** 导入：解析 + 校验 + 落库 + 立即注入。同 id 覆盖更新。 */
export function importThemePackage(
  source: string,
): { ok: true; theme: CustomTheme } | { ok: false; error: ThemeImportError; detail?: string } {
  const parsed = parseThemePackage(source);
  if (!parsed.ok) return parsed;
  const entries = readStore().filter((entry) => entry.id !== parsed.theme.id);
  const { id, name, dot } = parsed.theme;
  entries.push({ id, meta: { id, name, dot }, source });
  if (!writeStore(entries)) return fail("quota_exceeded");
  injectCustomTheme(parsed.theme);
  return { ok: true, theme: parsed.theme };
}

/** 删除：落库 + 摘除 style。返回被删主题是否存在；若当前正用它由调用方负责回退。 */
export function deleteCustomTheme(id: string): boolean {
  const entries = readStore();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return false;
  writeStore(next);
  removeCustomThemeStyle(id);
  return true;
}
