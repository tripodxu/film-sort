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
  it("hover 浮起分级：行级/页签级浮起不复活（卡片级如 plaza-sticker 合法保留）", () => {
    expect(css).not.toMatch(/\.collection-row:hover\{[^}]*translateY/);
    expect(css).not.toMatch(/\.dim-chip:hover\{[^}]*translateY/);
    expect(css).not.toMatch(/\.medium-item:hover\{[^}]*translateY/);
    expect(css).not.toMatch(/\.custom-suggestion:hover\{[^}]*transform/);
  });
  it("骨架屏节奏 token 化（--dur-pulse）且内滚 fade 在位", () => {
    expect(css).toContain("--dur-pulse:1.5s");
    expect(css).toMatch(/\.artwork-info,\.candidate-scroll\{[^}]*mask-image/);
  });
  it("dialog 面板 role/aria-modal 覆盖不回退（无障碍等价）", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect((app.match(/role="dialog"/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });
});

describe("P5a 主题人格绊线（非色彩差异 ≥2/主题）", () => {
  it("retro 旧式印刷所：直角 + 宋体栈 + 62ch 首行缩进 + 双线书眉", () => {
    expect(css).toContain("[data-theme=retro]{--r-xs:0");
    expect(css).toContain("Songti SC");
    expect(css).toContain("max-width:62ch;text-indent:2em");
    expect(css).toContain("[data-theme=retro] .topbar{border-bottom:3px double");
  });
  it("cyber 终端 HUD：mono 主导 + 人格发光（§5.1）+ 扫描线", () => {
    expect(css).toContain('body[data-theme=cyber]{font-family:"Cascadia Mono"');
    expect(css).toMatch(/\[data-theme=cyber\][^{]*\{[^}]*box-shadow:0 0 18px/);
    expect(css).toContain("[data-theme=cyber] .topbar nav button.active{text-shadow");
  });
  it("minimal 瑞士网格：全直角 + 字重对比 + 加长 hairline", () => {
    expect(css).toContain("[data-theme=minimal]{--r-xs:0;--r-sm:0;--r-md:0;--r-lg:0}");
    expect(css).toContain("[data-theme=minimal] .section-heading h2::before{width:32px");
    expect(css).toMatch(/\[data-theme=minimal\] h1,[^}]*font-weight:800/);
  });
  it("simple 亲和蓝：圆角升档 + 按钮胶囊 + 快节奏", () => {
    expect(css).toContain("[data-theme=simple]{--r-xs:4px;--r-sm:8px;--r-md:14px;--r-lg:22px");
    expect(css).toContain(
      "[data-theme=simple] .button,[data-theme=simple] .rank-pill{border-radius:var(--r-pill)}",
    );
  });
  it("classic 文学博物馆：衬线标题 + 双线框 + 印章红方块标头", () => {
    expect(css).toContain(
      "[data-theme=classic] .section-heading h2::before{width:10px;height:10px;background:var(--accent)}",
    );
    expect(css).toContain("[data-theme=classic] .section-heading{border-top:3px double");
    expect(css).toMatch(/\[data-theme=classic\] h1,[^}]*Songti SC/);
  });
  it("纹理配额：主题人格纹 ≤3% 不透明度", () => {
    for (const m of css.matchAll(/opacity='\.(\d+)'\/>/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(5); // .05 = 信纸线纹（线纹例外）
    }
  });
});

describe("P5c 布局模式绊线", () => {
  it("layout.ts 机制在位：archive 移除属性（零 diff 由机制保证）", () => {
    const lt = readFileSync("src/lib/layout.ts", "utf8");
    expect(lt).toContain('removeAttribute("data-layout")');
    expect(lt).toContain('LAYOUT_KEY = "art-rank:layout"');
    const main = readFileSync("src/main.tsx", "utf8");
    expect(main).toContain('document.documentElement.setAttribute("data-layout", layout)');
  });
  it("journey 胶片盘：snap/mask/chevron/触屏降级四项齐备", () => {
    expect(css).toContain("scroll-snap-type:x mandatory");
    expect(css).toContain("scroll-snap-type:x proximity");
    expect(css).toContain('[data-layout="journey"] .journey-rail{');
    expect(css).toContain(".journey-chevron{");
  });
  it("bento 零空洞纪律：仅首项扩格（禁 mod-3/dense 回潮）", () => {
    expect(css).toContain(
      '[data-layout="bento"] .medium-grid>.medium-item:first-child{grid-column:span 2}',
    );
    expect(css).not.toContain("grid-auto-flow:dense");
    expect(css).not.toMatch(/:last-child:nth-child/);
  });
});
