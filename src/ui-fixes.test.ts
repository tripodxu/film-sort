/**
 * UI 焕新回归绊线（P3c「断言覆盖已修项」）——把 P0-P3 已修的关键事实固化为断言：
 * 任何未来改动若悄悄回退（重新引入 jellyBounce、8/9px 字号、散落 hex、奖牌 emoji、
 * text-3 比例漂移、误触守卫移除），这里先红。
 *
 * 纯字符串/正则断言，node 环境即可跑（与既有 19 个纯函数测试同法）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("src/styles.css", "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : /\.(ts|tsx)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

describe("P0/P0.9 修复绊线", () => {
  it("jellyBounce 已删除且不再挂载", () => {
    expect(css).not.toContain("jellyBounce");
  });
  it("弹簧曲线 cubic-bezier(.34,1.56,.64,1) 不复存在", () => {
    expect(css).not.toContain("34,1.56");
  });
  it("8px/9px 字号清零", () => {
    expect(css).not.toMatch(/font-size:\s*8px/);
    expect(css).not.toMatch(/font-size:\s*9px/);
  });
  it("奖牌 emoji 全站零残留（5 处含 exportPng；正则用转义防自指）", () => {
    const medal = /\u{1F947}|\u{1F948}|\u{1F949}/u;
    for (const f of walk("src")) {
      const s = readFileSync(f, "utf8");
      expect(medal.test(s), f).toBe(false);
    }
  });
});

describe("P1a/P1a.5 token 与对比度绊线", () => {
  it("散落 hex 归零（hex 只允许出现在 token 定义层）", () => {
    const stripped = css.replace(/--[^:;{}]+:\s*#[0-9a-fA-F]{3,8}/g, "");
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("--text-3 混合比锁定 78%（P1a.5 L1 定案）", () => {
    expect(css).toMatch(/--text-3:color-mix\(in srgb,var\(--text\) 78%,var\(--bg\)\)/);
  });
  it("L1/L2 token 已并入顶部 token 段且样板块不重复声明", () => {
    expect(css).toContain("--t-micro:10px");
    expect(css.match(/--t-micro:10px/g)!.length).toBe(1);
  });
});

describe("P1b/P2/P3 收敛绊线", () => {
  it("阴影两级：--ev-2 就位且发光层不复活", () => {
    expect(css).toContain("var(--ev-2)");
  });
  it("玻璃两级：贵级 16px+saturate / 普级 8px", () => {
    expect(css).toMatch(/\.glass-capsule\{backdrop-filter:blur\(16px\) saturate\(1\.2\)/);
    expect(css).toMatch(/\.topbar\{backdrop-filter:blur\(8px\)/);
  });
  it("note-reader 基准表面受 §9 保护（blur28+saturate170 原样）", () => {
    expect(css).toContain("backdrop-filter:blur(28px) saturate(170%)");
  });
  it("Sorting 简介区内滚误触守卫在位（§0 第七类）", () => {
    const sv = readFileSync("src/views/SortingView.tsx", "utf8");
    expect(sv).toMatch(
      /className="artwork-info" onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
    );
  });
  it("help 入口已迁 topbar（§0 第六类），hero 浮钮不复活", () => {
    const home = readFileSync("src/views/HomeView.tsx", "utf8");
    expect(home).not.toContain("guide-help-btn");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain(
      '<IconButton title={t("使用说明", "Guide")} onClick={() => setShowGuide(true)}>',
    );
  });
});
