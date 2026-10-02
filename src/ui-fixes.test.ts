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
  it("editorial 刊物画廊（PLAN-ui-modernization P1）：pill 按钮 + 序号导航 + 直角弹窗 + 页码进度", () => {
    expect(css).toMatch(/\[data-theme=editorial\]\{\s*--bg:#F4F1EA/);
    expect(css).toMatch(/\[data-theme=editorial-dark\]\{\s*--bg:#1A1A18/);
    expect(css).toMatch(
      /\[data-theme=editorial\] \.topbar nav button:before[^{]*\{content:"0" counter/,
    );
    expect(css).toMatch(/\[data-theme=editorial\] \.button,[^{]*\{border-radius:999px/);
    expect(css).toContain(".ed-round-mark{");
    expect(css).toMatch(/\[data-theme=editorial\] \.progress-track,[^{]*\{[^}]*height:2px/);
    // 进度尺规刻度（::after 覆盖层）与 mobile 轮播定位纪律
    expect(css).toMatch(
      /\[data-theme=editorial\] \.progress-track::after[^{]*\{[^}]*repeating-linear-gradient/,
    );
    expect(css).toContain("scroll-snap-type:x mandatory");
    // 移动端轮播归位纪律：桌面 .ed-stack-item:nth-child(N) 的 left/top/rotate
    // 特异性 (0,2,0) 高于同名类移动端覆写 (0,1,0)，必须用后代前缀+nth-child
    // 抬到 (0,3,0) 覆写，否则卡片按桌面绝对定位渲染（倾斜/推右/错位）。
    expect(css).toContain(
      ".ed-hero-inner .ed-stack-item:nth-child(n){left:auto;top:auto;transform:none}",
    );
    expect(css).toContain(
      ".ed-hero-inner .ed-stack:hover .ed-stack-item:nth-child(n){transform:none}",
    );
    // 移动端单列网格纪律：基座 .orb-hero-inner 的 grid-template-columns 位于本媒体查询
    // 之后（styles.css L846），同名类 (0,1,0) 后来者胜——.ed-hero-inner 单类覆写是死代码，
    // mobile 实际跑双轨 + 48px column-gap（实测轮播容器 438 = 486-48）。必须双类抬到 (0,2,0)。
    expect(css).toContain(".ed-hero-inner.ed-hero-inner{grid-template-columns:minmax(0,1fr)}");
  });
  it("editorial L3 分支：刊物家族才渲染海报堆叠与回合水印，classic 路径不变", () => {
    const home = readFileSync("src/views/HomeView.tsx", "utf8");
    expect(home).toContain('family === "editorial"');
    expect(home).toContain("ed-stack");
    const sv = readFileSync("src/views/SortingView.tsx", "utf8");
    expect(sv).toContain("ed-round-mark");
    expect(sv).toContain('useThemeFamily() === "editorial"');
  });
  it("纹理配额：主题人格纹 ≤3% 不透明度", () => {
    for (const m of css.matchAll(/opacity='\.(\d+)'\/>/g)) {
      expect(Number(m[1])).toBeLessThanOrEqual(5); // .05 = 信纸线纹（线纹例外）
    }
  });
});

describe("P2 aurora 极光主题绊线（PLAN-ui-modernization）", () => {
  const auroraBlock = css.slice(
    css.indexOf("[data-theme=aurora]{"),
    css.indexOf("}", css.indexOf("[data-theme=aurora]{")),
  );
  it("变量块在位：深夜蓝底 + 极光薄荷青/紫罗兰（对比度 AA 已过 ui-contrast）", () => {
    expect(css).toMatch(/\[data-theme=aurora\]\{\s*--bg:#070B16/);
    expect(css).toMatch(/\[data-theme=aurora\][^{]*\{[^}]*--accent:#45E3B0/);
    expect(auroraBlock).toContain("--accent-2:#8B7CFF");
    expect(auroraBlock).toContain("--scrim:rgba(4,6,18,.82)");
    // 卡角加大到 --r-lg（20px）：duel 卡辉光脉冲的配套
    expect(auroraBlock).toContain("--r-lg:20px");
  });
  it("--ev-1/2/3 全局就位（P4 重立基线，PITFALLS 4.20 清偿）：:root 三级公式，主题只覆写 --shadow-tint", () => {
    // 历史：2026-09-22 起 ~20 处引用但 :root 从未定义（=none），P1-P3 的 zero-diff
    // 基线均产出于该状态；P4 按计划全局补定义并重立基线——旧主题自此带景深阴影，
    // 此前各批 zero-diff 证据以各自 commit 为界。主题只许覆写 tint 色相，不改公式。
    const root = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
    expect(root).toContain("--ev-1:0 1px 0");
    expect(root).toContain("--ev-2:0 16px 45px");
    expect(root).toContain("--ev-3:0 28px 80px");
    expect(root).toContain("--shadow-tint:#000");
    expect(css.match(/--ev-1:/g)?.length).toBe(1);
    expect(css.match(/--ev-2:/g)?.length).toBe(1);
    expect(css.match(/--ev-3:/g)?.length).toBe(1);
  });
  it("玻璃 2.0 三层表面（ev 底 + 1px 内高光 + 外柔光晕）", () => {
    expect(css).toMatch(
      /\[data-theme=aurora\] \.identity\.glass-capsule,\s*\[data-theme=aurora\] \.home-actions\.glass-capsule,\s*\[data-theme=aurora\] \.segmented\{\s*box-shadow:var\(--ev-2\),inset 0 1px 0/,
    );
    // 弹窗/菜单 ev-3 更深景深
    expect(css).toMatch(
      /\[data-theme=aurora\] :is\(\.account-dialog[^{]*\{\s*box-shadow:var\(--ev-3\)/,
    );
  });
  it("topbar 悬浮胶囊：sticky + 脱离子页面顶线 + 滚动态 class（App.tsx 挂监听）", () => {
    expect(css).toMatch(/\[data-theme=aurora\] \.topbar\{\s*position:sticky;top:0/);
    expect(css).toContain("[data-theme=aurora] .topbar.scrolled nav{");
    expect(css).toContain("[data-theme=aurora] .topbar nav button.active:after{display:none}");
    // 移动端降级：四导航项会胀破胶囊（PITFALLS 4.7），≤540px 去底板
    expect(css).toMatch(
      /@media\(max-width:540px\)\{[^@]*\[data-theme=aurora\] \.topbar nav\{[^}]*background:transparent/,
    );
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('classList.toggle("scrolled", window.scrollY > 8)');
  });
  it("duel 卡：--r-lg 卡角 + 胜出辉光脉冲（reduced-motion 由全局 animation 禁令兜底）", () => {
    expect(css).toContain("[data-theme=aurora] .artwork-main{border-radius:var(--r-lg)");
    expect(css).toContain("@keyframes au-win-pulse");
    expect(css).toContain(
      "[data-theme=aurora] .artwork-card .artwork-main:active{animation:au-win-pulse",
    );
  });
  it("按钮 conic 渐变描边：@property 注册角度 + hover 流转 + quiet 不参与", () => {
    expect(css).toContain(
      '@property --au-angle{syntax:"<angle>";inherits:false;initial-value:0deg}',
    );
    expect(css).toContain("@keyframes au-border-flow");
    expect(css).toContain("conic-gradient(from var(--au-angle)");
    expect(css).toContain("[data-theme=aurora] .button:not(.quiet){");
    expect(css).toContain("[data-theme=aurora] .button.primary{");
  });
  it("进度条流光填充：渐变条 + 扫光头部 + reduced-motion 退化纯色", () => {
    expect(css).toContain("@keyframes au-flow");
    expect(css).toMatch(
      /\[data-theme=aurora\] \.progress-track>span\{\s*position:relative;border-radius:999px;overflow:hidden/,
    );
    expect(css).toMatch(
      /@media\(prefers-reduced-motion:reduce\)\{[^@]*\[data-theme=aurora\] \.progress-track>span\{background:var\(--accent\)/,
    );
  });
  it("主题菜单 dot 与 THEMES 注册（id 一经发布不改）", () => {
    expect(css).toContain(".theme-dot.theme-aurora{");
    const theme = readFileSync("src/lib/theme.ts", "utf8");
    expect(theme).toContain('{ id: "aurora", zh: "极光", en: "Aurora" }');
  });
  it("orb 推荐默认：无持久化时 aurora→ribbon（registry 单测覆盖），宿主按推荐重挂", () => {
    const orbScene = readFileSync("src/components/OrbScene.tsx", "utf8");
    expect(orbScene).toContain("if (next !== currentEffectId)");
    const registry = readFileSync("src/lib/orbEffects/registry.ts", "utf8");
    expect(registry).toContain(
      'const RECOMMENDED_BY_THEME: Record<string, string> = { aurora: "ribbon" }',
    );
    const switcher = readFileSync("src/components/ThemeSwitcher.tsx", "utf8");
    // 切主题后菜单勾选跟随推荐（否则打开菜单看到过期的勾）
    expect(switcher).toContain("setOrbEffect(readOrbEffectId())");
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
  it("bento 零空洞纪律：仅首项扩格（禁 mod-3/dense 回潮）+ 自带 display:grid（.medium-grid{display:block} 会使其失效）", () => {
    expect(css).toContain(
      '[data-layout="bento"] .medium-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}',
    );
    expect(css).toContain(
      '[data-layout="bento"] .medium-grid>.medium-item:first-child{grid-column:span 2}',
    );
    expect(css).not.toContain("grid-auto-flow:dense");
    expect(css).not.toMatch(/:last-child:nth-child/);
  });
  it("journey 滚动尊重 prefers-reduced-motion（JS 行为层，CSS 豁免覆盖不到）", () => {
    const home = readFileSync("src/views/HomeView.tsx", "utf8");
    expect(home).toContain('matches ? "auto" : "smooth"');
  });
  it("journey 键盘专项：chevron 为原生 button（Tab 可达）且带 aria-label", () => {
    const home = readFileSync("src/views/HomeView.tsx", "utf8");
    expect((home.match(/className="journey-chevron/g) ?? []).length).toBe(2);
    expect(home).toContain('<button\n            className="journey-chevron journey-prev"');
    expect(home).toContain('<button\n            className="journey-chevron journey-next"');
    expect((home.match(/aria-label=\{t\("向(左|右)滚动"/g) ?? []).length).toBe(2);
  });
});

describe("P3 gallery 画廊主题绊线（PLAN-ui-modernization）", () => {
  const galleryStart = css.indexOf("[data-theme=gallery]{");
  const galleryBlock = css.slice(galleryStart, css.indexOf("}", galleryStart));
  it("变量块在位：冷白展厅 + 克莱因蓝 + 大圆角档（对比度 AA 由 ui-contrast 验收）", () => {
    expect(css).toMatch(/\[data-theme=gallery\]\{\s*--bg:#F7F7F4/);
    expect(galleryBlock).toContain("--accent:#1D4ED8");
    expect(galleryBlock).toContain("--accent-ink:#FFFFFF");
    expect(galleryBlock).toContain("--r-lg:24px");
  });
  it("不定义 --ev-*（PITFALLS 4.20：全站「被引用未定义=none」基线不可破坏；阴影显式书写）", () => {
    expect(galleryBlock).not.toContain("--ev-");
    // 阴影确实存在（用 --shadow-tint 显式 color-mix，而非 var(--ev-2)）
    expect(css).toMatch(
      /\[data-theme=gallery\] :is\(\.account-dialog[^{]*\{\s*border:0;border-radius:var\(--r-lg\)/,
    );
    expect(css).toContain("color-mix(in srgb,var(--shadow-tint) 26%,transparent)");
  });
  it("L3 Bento：显式 display:grid + grid-area 编排 + Top1 占 2×2 + 移动端单列重排", () => {
    expect(css).toMatch(
      /\.gl-bento\{\s*display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
    );
    expect(css).toMatch(/\.gl-cell-hero\{grid-area:hero\}/);
    expect(css).toMatch(/\.gl-bento\{[^}]*"hero hero radar"/);
    expect(css).toMatch(
      /@media\(max-width:800px\)\{\s*\.gl-bento\{grid-template-columns:minmax\(0,1fr\)/,
    );
  });
  it("L3 卡片墙：preserve-3d 翻转 + hover 用 media(hover:hover) 包裹（触屏粘滞）+ reduced-motion 平铺", () => {
    expect(css).toMatch(/\.gl-card-inner\{[^}]*transform-style:preserve-3d/);
    expect(css).toContain(
      "@media(hover:hover){.gl-card:hover .gl-card-inner{transform:rotateY(180deg)}}",
    );
    expect(css).toMatch(
      /@media\(prefers-reduced-motion:reduce\)\{[^@]*\.gl-card-inner\{height:auto;transform:none!important/,
    );
  });
  it("重排行守卫：gallery 的行式 grid 声明必须把 P6 的 flex 覆盖要回来（PITFALLS 4.19）", () => {
    expect(css).toContain(
      "[data-theme=gallery] .ranking-list.reorder-list>li{display:flex;gap:16px}",
    );
  });
  it("L3 分支：ProfileView/ShareView 仅 gallery 家族渲染 Bento 与卡片墙，classic 路径 DOM 不变", () => {
    const profile = readFileSync("src/views/ProfileView.tsx", "utf8");
    expect(profile).toContain('useThemeFamily() === "gallery"');
    expect(profile).toContain("<GalleryBento");
    expect(profile).toContain("<GalleryWall");
    // 铁律：classic 默认路径的维度页签行与行式榜单仍在
    expect(profile).toContain('className="profile-dimensions"');
    expect(profile).toContain('<ol className="ranking-list">');
    const share = readFileSync("src/views/ShareView.tsx", "utf8");
    expect(share).toContain('useThemeFamily() === "gallery"');
    expect(share).toContain("<GalleryBento");
  });
  it("数据侧：galleryStats 只读 profile 聚合（雷达/年代/坐标零数据层改动）", () => {
    const stats = readFileSync("src/lib/galleryStats.ts", "utf8");
    expect(stats).not.toMatch(/localStorage|fetch\(|sessionStorage/);
  });
  it("主题菜单 dot 与 THEMES 注册（id 一经发布不改）", () => {
    expect(css).toContain(".theme-dot.theme-gallery{");
    const theme = readFileSync("src/lib/theme.ts", "utf8");
    expect(theme).toContain('{ id: "gallery", zh: "画廊", en: "Gallery" }');
  });
});

describe("P4 收尾绊线（PLAN-ui-modernization）", () => {
  it("主题菜单分「经典 / 新系列」两组（11 个平铺太长）；内置主题共 11 套", () => {
    const sw = readFileSync("src/components/ThemeSwitcher.tsx", "utf8");
    expect(sw).toContain("NEW_SERIES: ReadonlySet<string>");
    expect(sw).toContain('t("经典", "Classic")');
    expect(sw).toContain('t("新系列", "New Series")');
    const theme = readFileSync("src/lib/theme.ts", "utf8");
    expect((theme.match(/id: "/g) ?? []).length).toBe(11);
  });
});

/**
 * 首屏关键路径体积绊线（PLAN-BUNDLE-SPLIT.md）。
 *
 * Three.js 曾整块躺在主包里：`ThemeSwitcher` → `registry.ts` → 四个特效模块 → `three`，
 * 把首包从 440KB 顶到 963KB。`DeferredOrb` 的 `lazy()` + `requestIdleCallback`
 * 只推迟了渲染，没把 three 摘出关键路径 —— 这类"看起来已经优化过"的假象最容易复发，
 * 所以用源码扫描锁死依赖图：主包可达模块一律不得静态 import 特效模块或 three。
 */
describe("首屏依赖图绊线（PLAN-BUNDLE-SPLIT）", () => {
  const EFFECT_MODULES = ["plasma", "halo", "blackhole", "ribbon"] as const;

  it("registry.ts 只做纯数据：零 three、零特效模块的静态 import", () => {
    const registry = readFileSync("src/lib/orbEffects/registry.ts", "utf8");
    expect(registry).not.toMatch(/from\s+["']three["']/);
    for (const name of EFFECT_MODULES) {
      expect(registry).not.toMatch(new RegExp(`from\\s+["']\\./${name}["']`));
    }
    // 构造函数必须走动态 import
    expect(registry).toContain('await import("./orbEffectLoaders")');
  });

  it("主包可达模块不得静态 import 特效模块（否则 three 被拖回首包）", () => {
    // ThemeSwitcher 是首屏常驻组件，是这条依赖链的入口；锁它连带锁住整条链。
    const switcher = readFileSync("src/components/ThemeSwitcher.tsx", "utf8");
    for (const name of EFFECT_MODULES) {
      expect(switcher).not.toMatch(new RegExp(`orbEffects/${name}`));
    }
    // 只允许从注册表取元数据
    expect(switcher).toMatch(/from\s+["']\.\.\/lib\/orbEffects\/registry["']/);
  });

  it("loader 表逐个用字面量动态 import（vite 依赖分析入口，间接写会拆不出 chunk）", () => {
    const loaders = readFileSync("src/lib/orbEffects/orbEffectLoaders.ts", "utf8");
    for (const name of EFFECT_MODULES) {
      expect(loaders).toContain(`await import("./${name}")`);
    }
    expect(loaders).toMatch(/await loadOrbEffect|const factory = await loader\(\)/);
  });

  it("DeferredOrb 的省流/空闲短路仍在（推迟加载不该被当成摘出关键路径）", () => {
    const deferred = readFileSync("src/components/DeferredOrb.tsx", "utf8");
    expect(deferred).toContain("prefersLiteMode");
    expect(deferred).toContain("requestIdleCallback");
  });

  it("OrbScene 的挂载走 async + token 守卫（createOrbEffectById 已变异 async）", () => {
    const scene = readFileSync("src/components/OrbScene.tsx", "utf8");
    expect(scene).toContain("mountToken");
    expect(scene).toMatch(/const mountInstance = async \(\)/);
    expect(scene).toContain("if (token !== mountToken)");
  });
});

/**
 * 首屏依赖图绊线 第二批（PLAN-ROUTE-EAGER.md）。
 *
 * 迭代 1 把 three 摘出主包后定下的规矩是「非首屏的不进 index chunk」，但只被执行了一次：
 * `App.tsx` 里六个同步 import 的视图/弹窗一直没被复查，于是它们连同各自的 lucide 图标
 * 一直占着首包。这类"扫过一次就不再回看"的债务最容易复发，所以逐条锁死。
 */
describe("首屏依赖图绊线（PLAN-ROUTE-EAGER）", () => {
  // 必须 lazy 的六个：都是「用户先点一下才会挂载」的模块。
  const MUST_BE_LAZY = [
    ["./components/AiConfigDialog", "AiConfigDialog"],
    ["./components/RankingDetail", "RankingDetail"],
    ["./components/SettingsMenu", "SettingsMenu"],
    ["./views/SetupView", "SetupView"],
    ["./views/PlazaView", "PlazaView"],
  ] as const;
  // 必须保持同步的：落地视图 / 排序主流程 / 首屏立刻要用（PLAN-ROUTE-EAGER §3.2）。
  const MUST_STAY_EAGER = [
    ["./views/HomeView", "HomeView"],
    ["./views/SortingView", "SortingView"],
  ] as const;

  const app = readFileSync("src/App.tsx", "utf8");
  // 剥掉注释后再扫描：解释性注释里会提到模块路径，按代码判定会误伤。
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

  it("六个非首屏模块不得回到同步 import", () => {
    for (const [specifier, name] of MUST_BE_LAZY) {
      expect(code, `${name} 同步 import 会把它拖回首包`).not.toMatch(
        new RegExp(`^import[^;\\n]*from\\s+["']${specifier.replace(/[./]/g, "\\$&")}["']`, "m"),
      );
      expect(code, `${name} 必须走 lazy(() => import(...))`).toContain(
        `lazy(() =>\n  import("${specifier}")`,
      );
      expect(code).toContain(`default: module.${name}`);
    }
  });

  it("落地视图与排序主流程保持同步渲染（lazy 化会换来首屏一次闪烁，不划算）", () => {
    for (const [specifier, name] of MUST_STAY_EAGER) {
      expect(code).toMatch(
        new RegExp(
          `^import[^;\\n]*\\b${name}\\b[^;\\n]*from\\s+["']${specifier.replace(/[./]/g, "\\$&")}["']`,
          "m",
        ),
      );
      expect(code).not.toContain(`import("${specifier}")`);
    }
  });

  it("整棵路由树仍在同一个 Suspense 里（兜底不许被删）", () => {
    expect(app).toContain(
      '<Suspense fallback={<div className="route-loading" aria-label="Loading" />}>',
    );
    // ErrorBoundary 必须还在 Suspense 外层兜住懒加载失败
    expect(app).toContain('import { ErrorBoundary } from "./components/ErrorBoundary";');
  });

  it("挂载在 Suspense 之外的懒弹窗自带 fallback（首次点击不许白屏）", () => {
    // SettingsMenu 在顶栏、AiConfigDialog 与 RankingDetail 在弹层，三者都在 content 之外。
    expect(code).toContain("function LazySpot()");
    expect(code).toContain('return <div className="route-loading" aria-label="Loading" />;');
    expect(code.match(/<Suspense fallback=\{<LazySpot \/>\}>/g) ?? []).toHaveLength(2);
    // 顶栏那个不能露出布局空洞，用 null 兜底
    expect(code).toContain("<Suspense fallback={null}>");
  });
});

/**
 * 消歧出口 UI 绊线（PLAN-CHOICE-UI）。
 *
 * 迭代 2 建好了诊断端点但没人消费，迭代 5 补上消费方。这个 UI 最有价值的性质
 * 不是「长什么样」，而是**它知道什么时候不该出现**——线上抽样里 exact/strong 全判对、
 * weak 里有相当一部分 poolSize=0（zh-wiki 根本没这个条目）。一旦触发条件被放松，
 * 用户就会在最不该被打扰的地方被打扰，而且这种退化没有任何报错。
 */
describe("静态资源缓存策略绊线（PLAN-ASSET-CACHE）", () => {
  const source = readFileSync("worker/index.ts", "utf8");
  // 剥掉注释再扫：解释性注释里会原样引用这些字面量。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

  it("哈希产物的判定靠文件名形态，且不按目录一刀切", () => {
    expect(code).toContain("max-age=31536000, immutable");
    expect(code).toMatch(/const CONTENT_HASHED_ASSET = \/-\[A-Za-z0-9_-\]\{8,\}/);
    expect(code).toContain(
      'pathname.startsWith("/assets/") && CONTENT_HASHED_ASSET.test(pathname)',
    );
  });

  it("非哈希分支保留 must-revalidate：index.html 是部署切换的入口", () => {
    expect(code).toContain('"public, max-age=0, must-revalidate"');
    expect(code).toMatch(
      /immutable \? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"/,
    );
  });

  it("withSecurityHeaders 里绝不能出现 cache-control", () => {
    // 一旦把缓存头塞进安全头表，所有 json() 响应都会被钉成一年 —— API 数据会冻住。
    const start = code.indexOf("function withSecurityHeaders");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf("}", code.indexOf("return result;", start)));
    expect(body).not.toContain("cache-control");
    expect(body).toContain("SECURITY_HEADERS");
  });
});

describe("消歧出口 UI（PLAN-CHOICE-UI）", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const detail = readFileSync("src/components/ArtworkDetail.tsx", "utf8");
  const choice = readFileSync("src/components/CoverChoice.tsx", "utf8");
  const cssSource = readFileSync("src/styles.css", "utf8");

  it("触发条件里 poolSize>=2 与 coverCount>0 都在（weak+pool=0 不许弹空列表）", () => {
    const lib = readFileSync("src/lib/coverChoice.ts", "utf8");
    expect(lib).toContain("export function shouldOfferChoice");
    expect(lib).toMatch(/poolSize < 2/);
    expect(lib).toMatch(/coverCount > 0/);
    // exact/strong 必须在第一道就被挡掉，不能靠后面的计数兜。
    const body = lib.slice(lib.indexOf("export function shouldOfferChoice"));
    expect(body).toMatch(/band !== "shaky" && input\.band !== "weak"/);
  });

  it("只挂在「其他」维度上（其余媒介没有同名异作问题）", () => {
    expect(detail).toContain("choiceAppliesToKind(detail.kind)");
    // 判定放在弹窗里而不是组件里：组件被别的维度复用时会顺手带上打扰。
    expect(detail).toMatch(/\{choiceAppliesToKind\(detail\.kind\) && onCoverChange && \(/);
    expect(choice).not.toContain("choiceAppliesToKind");
  });

  it("点击即生效：选择先落到弹窗的 work 上，写端点只是补一条云端记录", () => {
    // 视觉生效不依赖服务端——否则用户点了却要等一次网络往返才看到变化。
    expect(choice.indexOf("onPicked(")).toBeLessThan(choice.indexOf('cover-choice"'));
    expect(choice).toContain('method: "POST"');
    expect(choice).toContain('"/api/other/cover-choice"');
    // 匿名也必须能用：只是不落库。
    expect(choice).toContain("art-rank:account-token");
    expect(choice).toMatch(/if \(!token\)/);
    expect(app).toContain("onCoverChange={(url) =>");
  });

  it("缩略图地址仍走维基白名单，CSS 类名全部有定义", () => {
    expect(choice).toContain("isWikiImageUrl(url)");
    const classes = [...choice.matchAll(/className="(cover-choice[^"]*)"/g)].map((m) => m[1]);
    const alsoClasses = [...choice.matchAll(/className=\{`cover-choice\$\{[^}]*`\}/g)].map(
      () => "cover-choice is-active",
    );
    for (const name of [...classes, ...alsoClasses]) {
      expect(cssSource, `${name} 没有 CSS 定义`).toContain(`.${name.split(" ")[0]}`);
    }
    // 取图失败的候选不许被点：disabled 绑在「有没有拿到地址」上。
    expect(choice).toContain("disabled={!url ||");
  });
});

/**
 * 消歧记忆（PLAN-COVER-MEMORY）。
 *
 * 这份断言守的是一次「一次裁决只作用于一个对象」的回归：迭代 5 的
 * `onCoverChange` 只 patch `detailWork` 一个 React state，而「处处生效」
 * 意味着几十个各自持有 `work` 拷贝的对象。修复方式不是去改那几十处，
 * 而是把裁决记成一个**事实**，存在 `Poster.tsx` 构造候选数组的唯一收口处读。
 */
describe("消歧记忆绊线（PLAN-COVER-MEMORY）", () => {
  const poster = readFileSync("src/components/Poster.tsx", "utf8");
  const choice = readFileSync("src/components/CoverChoice.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
  const posterCode = stripComments(poster);
  const choiceCode = stripComments(choice);

  it("事实存在唯一收口处：29 处 <Poster> 一行不改就全都生效", () => {
    // 判据必须在构造 urls 的那一行读记忆，而不是在 useState 初值里
    // （初值只在首帧跑一次，翻页后新挂载的实例读不到）。
    expect(posterCode).toMatch(/const urls = mergeCoverRecall\(/);
    expect(posterCode).toMatch(
      /const urls = mergeCoverRecall\(\s*\[\.\.\.new Set\(\[\.\.\.\(work\.posterUrls \?\? \[\]\)/,
    );
    // 记忆只接 other：其余三个维度的名字没有同名异作问题。
    expect(posterCode).toContain('if (mediaTypeForKind(kind) !== "other") return null;');
  });

  it("记事实先于视觉生效，且写入点只有一个", () => {
    // 记忆必须由**持有 work 对象**的那一层写（ArtworkDetail → Poster 的
    // rememberPickedCover），否则它拿不到与服务端同源的那个键。
    expect(readFileSync("src/components/ArtworkDetail.tsx", "utf8")).toMatch(
      /rememberPickedCover\(detail\.work, detail\.kind, url, wikiTitle\);\s*\n\s*onCoverChange\(url\);/,
    );
    // onPicked 把 wikiTitle 一并交出去：它是「这个名字指哪部作品」的一半。
    expect(choiceCode).toContain("onPicked(choice.url, choice.title)");
    // 视觉那条路不许被删掉：它是网络往返之前的第一枪。
    expect(app).toContain("onCoverChange={(url) =>");
    // 记忆不许被写进作品数据：它会跟着榜单导出 / profile 同步带去别处。
    expect(choice).not.toContain("rememberCoverChoice");
  });

  it("文案不许再承诺比机制更多的事（原句在页内是假话）", () => {
    // 原句「之后都用你选的这一张」在本页其实不成立（其余同名卡片不更新）。
    expect(choiceCode).not.toContain("之后都用你选的这一张");
    expect(choiceCode).toContain("这一页里所有《${title}》都用这一张");
    expect(choiceCode).toContain("on this page now uses this cover");
  });

  it("被裁决过的那一件不必再问上游（省一次维基回源）", () => {
    // 缺这一段时用户选的那张会被上游返回的同一答案挤到候选第二位：
    // 图还是对的，但白烧一次配额，而 other 桶只有 20 次 / 10min。
    expect(posterCode).toContain("const userDecided = memorySuppliesCover(recalled)");
    expect(posterCode).toMatch(/!hasStoredPosters &&\s*!userDecided &&/);
    // 依赖数组必须跟着变，否则 userDecided 翻转后 effect 不会重跑。
    expect(posterCode).toMatch(
      /\}, \[work\.id, work\.title, kind, large, hasStoredPosters, userDecided\]\)/,
    );
  });

  it("纪律：非破坏闸与安全阀不许被摘掉", () => {
    const lib = readFileSync("src/lib/coverMemory.ts", "utf8");
    // 继承只填空格（urls 非空时原样返回）——不许改成无条件覆盖。
    expect(lib).toMatch(/return urls\.length \? \[\.\.\.urls\] : \[recalled\.url\]/);
    // 安全阀仍是迭代 5 那道：exact/strong 根本不会产生记忆。
    expect(readFileSync("src/lib/coverChoice.ts", "utf8")).toMatch(
      /band !== "shaky" && input\.band !== "weak"/,
    );
    // 记忆地址仍走维基白名单：sessionStorage 不是可信输入。
    expect(lib).toContain("isWikiImageUrl(url)");
  });
});

/**
 * 空封面三态（PLAN-EMPTY-COVER-STATE）。
 *
 * 这份断言守的是一次「信息在服务端算好、却在最后半米被丢掉」的回归：
 * `/api/posters/batch` 一直返回 outcomes（found/absent/throttled），
 * 路由却只发 results + keys，前端于是把「确实没有」和「暂时取不到」
 * 渲染成同一个静默图标。这三处一旦回退，用户就永远卡在空格子。
 */
describe("空封面三态绊线（PLAN-EMPTY-COVER-STATE）", () => {
  const workerIndex = readFileSync("worker/index.ts", "utf8");
  const poster = readFileSync("src/components/Poster.tsx", "utf8");
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
  // Poster 的三态断言一律扫**剥掉注释后**的源码：否则我写的解释性注释
  // 本身就会把断言喂绿（PITFALLS：断言被注释喂绿 = 假绿）。
  const posterCode = stripComments(poster);
  const batchRoute = stripComments(workerIndex).slice(
    stripComments(workerIndex).indexOf("/api/posters/batch"),
  );

  it("批次响应必须带上服务端算好的 outcomes（不发出去就没有三态）", () => {
    expect(batchRoute).toMatch(/json\(\s*\{\s*results,\s*keys,\s*outcomes\s*\}/);
    // 反向断言：老形状 json({ results, keys }) 不许悄悄回来。
    expect(batchRoute).not.toMatch(/json\(\s*\{\s*results,\s*keys\s*\}/);
  });

  it("前端真的接住了分类，并且只对 throttled 给重试", () => {
    expect(posterCode).toContain("outcomes?: Record<string, PosterOutcome>");
    expect(posterCode).toContain("outcomes[key]");
    // 判据集中在纯函数里，组件不得自己再写一套三态判断。
    expect(posterCode).toMatch(/emptyPosterState\(\s*urls\.filter/);
    expect(posterCode).toContain('const retryable = emptyState === "degraded"');
  });

  it("重试入口必须可访问：用真 button、带可访问名、点击不外泄", () => {
    expect(posterCode).toContain('className="cover-retry"');
    expect(posterCode).toContain("aria-label={readRetryLabel()}");
    // .collection-row 的整卡是 <button>，冒泡出去会把「重试」变成「打开详情」。
    expect(posterCode).toContain("event.stopPropagation()");
    // 触控目标不小于 44px。
    expect(css).toMatch(/\.cover-retry\{[^}]*min-height:44px/);
    // 光秃秃一个按钮是「只有视觉变化」——必须有一行能解释「为什么是空的」，
    // 且它得能被读屏播报（ui-ux-pro-max：错误消息不许只靠视觉）。
    expect(posterCode).toMatch(/<p className="cover-retry-hint" role="status">/);
    expect(posterCode).toContain("{retryable && large && (");
    expect(css).toMatch(/\.poster-small \.cover-retry-hint\{display:none\}/);
  });

  it("重试按钮在小格子与贴纸卡里不渲染（44px 塞不进去也不该塞）", () => {
    expect(css).toMatch(/\.poster-small \.cover-retry\{display:none\}/);
    expect(css).toMatch(/\.collection-row \.cover-retry\{display:none\}/);
  });

  it("「重试」必须真的重试：forceRetry 要走到 dispatchBatch 的 retry 判定", () => {
    // 这是本轮最容易做假的一处：dispatchBatch 只在**本次加载的第一批**带 retry，
    // 所以按钮若只调 resolve()，服务端会用 15 秒负缓存原样回上一轮的结果，
    // 用户点多少次看到的都是同一个空格子——按钮存在但没有作用。
    expect(posterCode).toContain("const retry = retryForced || !firstBatchDispatched");
    expect(posterCode).toContain("void resolve(work, kind, { retry: true })");
    expect(posterCode).toContain("retryForced = true");
  });

  it("空态判据喂的是过滤掉加载失败之后的候选（拿到地址但没画出来 ≠ 上游没有）", () => {
    // 一张加载失败的图若被算进「有图」，emptyPosterState 就返回 null，
    // 这一格永远不会有重试入口——而它恰恰最需要重试。
    expect(posterCode).toMatch(
      /emptyPosterState\(\s*urls\.filter\(\(candidate\) => !failed\.has\(candidate\)\)/,
    );
  });

  it("文案跟随 <html lang>，不为两句提示给 29 处调用点加 t", () => {
    // <Poster> 有 29 处调用点，一处都没传 t；语言真相在 document.documentElement.lang。
    expect(posterCode).toContain('document.documentElement.lang === "en"');
    // 反向断言：别把 <Poster> 又挂回需要 t 的形状。
    expect(posterCode).not.toMatch(/t:\s*\(zh:\s*string,\s*en:\s*string\)\s*=>\s*string/);
  });
});
