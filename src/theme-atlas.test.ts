import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEMES } from "./lib/theme";

/**
 * S4（第 12 套主题 atlas）的源码绊线。
 *
 * 本批次只证明一件事：新主题是**纯新增**——
 * 旧 11 套主题的 id 与顺序一个没动、主样式表没有被写进任何 atlas 内容、
 * atlas.css 的每条选择器都带 [data-theme=atlas]（或主题菜单色点的 .theme-dot 前缀），
 * 因此它在结构上不可能影响其它主题。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stripCssComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const ATLAS = read("./styles/atlas.css");
const ATLAS_RULES = stripCssComments(ATLAS);
const MAIN = read("./main.tsx");
const SWITCHER_CODE = read("./components/ThemeSwitcher.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const CSS = read("./styles.css");
const SHOTS = JSON.parse(read("../scripts/ui-shots-themes.json")) as Array<{
  name: string;
  path: string;
  /** 缺省 = modern（默认主题不写 data-theme，清单里也就不写 theme 字段）。 */
  theme?: string;
}>;

const LEGACY_IDS = [
  "modern",
  "retro",
  "minimal",
  "simple",
  "classic",
  "cyber",
  "paper",
  "editorial",
  "editorial-dark",
  "aurora",
  "gallery",
];

/** themeRegistry 要求的 21 个必需变量：新主题必须全部覆写，否则半主题会渲染错乱。 */
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
];

describe("S4 主题注册表：第 12 套 atlas 追加在末位", () => {
  it("THEMES 数量 12、atlas 在末位、旧 11 套 id 与顺序一字未动", () => {
    expect(THEMES).toHaveLength(12);
    expect(THEMES.map((item) => item.id)).toEqual([...LEGACY_IDS, "atlas"]);
  });

  it("atlas 有中英双语文案且 id 唯一", () => {
    const atlas = THEMES.find((item) => item.id === "atlas");
    expect(atlas).toBeDefined();
    expect(atlas!.zh.length).toBeGreaterThan(0);
    expect(atlas!.en.length).toBeGreaterThan(0);
    expect(new Set(THEMES.map((item) => item.id)).size).toBe(THEMES.length);
  });

  it("主题菜单把 atlas 归入「新系列」组", () => {
    expect(SWITCHER_CODE).toMatch(/NEW_SERIES[\s\S]*?"atlas"/);
    expect(SWITCHER_CODE).toContain('"atlas"');
  });
});

describe("S4 样式：新主题独立成文件，结构上不可能影响旧主题", () => {
  it("atlas.css 存在且规模非平凡", () => {
    expect(ATLAS_RULES.length).toBeGreaterThan(400);
    expect(ATLAS_RULES).toMatch(/\[data-theme=atlas\]\{/);
  });

  it("每条选择器都带 [data-theme=atlas] 或 .theme-dot.theme-atlas 前缀", () => {
    const selectors = [...ATLAS_RULES.matchAll(/(?:^|\})\s*([^{}]+)\{/g)].map((match) =>
      match[1].trim(),
    );
    expect(selectors.length).toBeGreaterThanOrEqual(4);
    for (const selector of selectors) {
      expect(
        selector.startsWith("[data-theme=atlas]") || selector.startsWith(".theme-dot.theme-atlas"),
        "未收敛的选择器：" + selector,
      ).toBe(true);
    }
  });

  it("没有 @layer、没有 !important（未分层旧 CSS 会整体压过分层规则）", () => {
    expect(ATLAS_RULES).not.toContain("@layer");
    expect(ATLAS_RULES).not.toContain("!important");
  });

  it("覆写 themeRegistry 要求的 21 个必需变量", () => {
    for (const name of REQUIRED_VARS) {
      expect(ATLAS_RULES, "缺少必需变量：" + name).toContain(name + ":");
    }
  });

  it("只覆写既有令牌，不新造令牌名（每个 --x: 都能在 styles.css 里找到）", () => {
    const defined = [...ATLAS_RULES.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
    expect(defined.length).toBeGreaterThan(15);
    const novel = [...new Set(defined)].filter((name) => !CSS.includes(name + ":"));
    expect(novel).toEqual([]);
  });

  it("主样式表里没有任何 atlas 内容（主题不写进 styles.css）", () => {
    expect(CSS).not.toContain("atlas");
    expect(CSS).not.toContain("atlas.css");
  });

  it("main.tsx 在 styles.css 之后引入 atlas.css", () => {
    const base = MAIN.indexOf('"./styles.css"');
    const atlas = MAIN.indexOf('"./styles/atlas.css"');
    expect(base).toBeGreaterThan(-1);
    expect(atlas).toBeGreaterThan(base);
  });

  it("主题菜单色点有 .theme-dot.theme-atlas 规则", () => {
    expect(ATLAS_RULES).toContain(".theme-dot.theme-atlas{");
  });
});

describe("S4 截图清单：新增两格 atlas，旧 22 格不动", () => {
  it("清单共 24 格，每套内置主题恰好 2 格", () => {
    expect(SHOTS).toHaveLength(24);
    const byTheme = new Map<string, number>();
    for (const shot of SHOTS) {
      const theme = shot.theme ?? "modern";
      byTheme.set(theme, (byTheme.get(theme) ?? 0) + 1);
      expect(LEGACY_IDS.concat("atlas")).toContain(theme);
    }
    for (const id of LEGACY_IDS.concat("atlas")) {
      expect(byTheme.get(id), id + " 的截图格数").toBe(2);
    }
  });

  it("atlas 两格是首页与我的文化索引", () => {
    const atlasShots = SHOTS.filter((shot) => (shot.theme ?? "modern") === "atlas").map(
      (shot) => shot.path,
    );
    expect(atlasShots.sort()).toEqual(["/", "/myself"]);
  });
});
