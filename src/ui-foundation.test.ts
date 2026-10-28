import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 前端统一设计语言层（§Z）与原语组件的回归绊线（T-20261028-UI）。
 *
 * 上一次全站焕新留下的问题是「每一处修正都是孤立的」：三套卡片外壳、四处 ellipsis、
 * 十七处空状态、两套骨架屏动画，各自有一份标准答案。这批改动把它们收敛成一套
 * token + 一组工具类 + 两个原语组件；这份断言守的是「收敛之后不许再散开」。
 *
 * 与 ui-fixes.test.ts 的分工：那边守历史批次的事实，这边守本层的存在与作用边界。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const css = read("./styles.css");
const zLayer = css.slice(css.indexOf("§Z 统一设计语言层"));

describe("§Z 统一设计语言层", () => {
  it("层级就位且位于 S3 追加标记之后（工具类靠靠后位置赢得同级层叠）", () => {
    expect(zLayer.length).toBeGreaterThan(500);
    expect(css.indexOf("§Z 统一设计语言层")).toBeGreaterThan(css.indexOf("Depth Compare（S3 新增"));
  });

  it("不重复声明 --ev-1/2/3 与 --t-micro（既有绊线在 :root，这里守住不得新增第二份）", () => {
    expect(css.match(/--ev-1:/g)?.length).toBe(1);
    expect(css.match(/--ev-2:/g)?.length).toBe(1);
    expect(css.match(/--ev-3:/g)?.length).toBe(1);
    expect(css.match(/--t-micro:/g)?.length).toBe(1);
  });

  it("工具类一律单类，且取值全部来自 var(--*)（杜绝新的魔法像素）", () => {
    for (const name of [
      "u-row",
      "u-row-tight",
      "u-row-between",
      "u-col",
      "u-spacer",
      "u-mb",
      "u-my",
      "u-divider",
      "u-ellipsis",
      "u-meta",
      "u-meta-sm",
    ]) {
      const rule = new RegExp(`\\.${name}\\{([^}]*)\\}`).exec(css);
      expect(rule, `.${name} 必须有定义`).not.toBeNull();
      // 这两个类不含尺寸属性：flex:1 是比例，ellipsis 三件套是溢出行为
      if (name === "u-spacer" || name === "u-ellipsis") continue;
      const body = rule![1];
      // 1px 是发丝线的唯一合法写法；其余带单位尺寸必须引用 token
      for (const px of body.match(/\b(?!1px)\d+px\b/g) ?? []) {
        throw new Error(`.${name} 出现硬编码像素 ${px}：工具类只允许引用 var(--*)`);
      }
      expect(body).toContain("var(--");
    }
  });

  it("§Z 层不引入裸 hex、不使用 !important（S3 之后的统一规矩）", () => {
    expect(zLayer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(zLayer).not.toContain("!important");
  });

  it("触控目标尺寸 token 存在且与 <44px 控件的补偿机制成对出现", () => {
    expect(css).toContain("--tap-min:44px");
    expect(css).toContain("--tap-icon:28px");
    expect(css).toContain(".icon-button-sm{width:var(--tap-icon)");
    // 降尺必须配透明命中区，否则 28px 视觉 = 28px 命中，远低于 WCAG 2.5.5
    expect(css).toContain('.hit-expand::after{content:"";position:absolute;inset:-4px}');
  });

  it("尊重系统偏好：增强对比度提档 + 减少动态效果由全局规则熔断", () => {
    expect(css).toMatch(/@media\(prefers-contrast:more\)\{/);
    expect(css).toContain(
      "@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;animation:none!important;",
    );
  });
});

describe("并列原语：EmptyState / Skeleton", () => {
  it("空状态外壳由组件承担，且同步支持 error 语气与读屏播报", () => {
    const source = read("./components/ui/EmptyState.tsx");
    expect(source).toContain("export function EmptyState");
    expect(source).toContain("empty-state-pad");
    expect(source).toContain("empty-state-error");
    expect(source).toContain('role: "status"');
    expect(source).not.toMatch(/padding:\s*\d+/);
  });

  it("骨架屏统一走 --dur-pulse，且对读屏隐藏（只闪块不说块）", () => {
    const source = read("./components/ui/Skeleton.tsx");
    expect(source).toContain("export function Skeleton");
    expect(source).toContain("aria-hidden");
    expect(css).toContain("animation:skeleton-pulse var(--dur-pulse)");
    // 旧的 plaza-pulse 双分支已收编：调用方不再手写内联 animation
    expect(read("./components/AiInsightCard.tsx")).not.toContain("plaza-pulse");
  });

  it("广场已经不再手写 plaza-skeleton-* 占位（交给 Skeleton 原语）", () => {
    const plaza = read("./views/PlazaView.tsx");
    expect(plaza).not.toContain("plaza-skeleton");
    expect(plaza).toContain("<Skeleton");
    expect(plaza).toContain("<EmptyState");
  });
});

describe("内联 Layout 下沉：不再由 JSX 执政响应式", () => {
  it("首页「品味年轮」走 data-layout + class（旧实现用内联 minWidth:200，窄屏必溢出）", () => {
    const home = read("./views/HomeView.tsx");
    expect(home).toContain('className="coordinate-grid" data-layout={ringsLayout}');
    expect(home).toContain('className="coordinate-col"');
    expect(home).toContain('className="coordinate-kind"');
    expect(home).toContain('className="coordinate-rail"');
    expect(home).not.toMatch(/minWidth:\s*ringsLayout/);
    expect(css).toMatch(/\.coordinate-col\{flex:1 1 var\(--card-min\);min-width:0\}/);
    expect(css).toContain("@media(max-width:720px){");
  });

  it("清单源宫格列数经 --collection-cols 传值，降级规则回到 CSS", () => {
    const source = read("./views/SourceView.tsx");
    expect(source).toContain('"--collection-cols": colCount');
    expect(source).not.toMatch(/gridTemplateColumns:\s*`repeat\(\$\{colCount\}/);
    expect(css).toContain("--collection-cols:2");
    expect(css).toContain("grid-template-columns:repeat(var(--collection-cols,2)");
  });

  it("二维码尺寸下沉为 --qr-size（原 300×300 硬编码在 360px 视口下溢出容器）", () => {
    const source = read("./views/SourceView.tsx");
    expect(source).toContain('className="qr-image"');
    // 布局侧不许再有内联尺寸（生成分辨率的 { width: 300, margin: 1 } 不算布局）
    expect(source).not.toMatch(/className="qr-image"[\s\S]{0,80}width:/);
    expect(source).not.toMatch(/height:\s*300/);
    expect(css).toContain("--qr-size:min(300px,100%)");
  });
});

describe("死代码清理：已确认无引用的规则族不再回潮", () => {
  it("被 plaza-sticker 取代的旧广场卡-/合一族零残留", () => {
    for (const dead of ["plaza-card-", "plaza-filters", "plaza-filter-kinds", "plaza-cards"]) {
      expect(css, dead).not.toContain(dead);
    }
  });

  it("guide-help-btn 引导浮钮（已迁 topbar）零残留", () => {
    expect(css).not.toContain(".guide-help-btn");
  });

  it("profile-skeleton / note-textarea / 单数 profile-dimension 零残留", () => {
    expect(css).not.toContain(".profile-skeleton");
    expect(css).not.toContain(".note-textarea");
    // 复数 .profile-dimensions 仍是画像页维度页签的活容器，必须还在
    expect(css).not.toMatch(/\.profile-dimension[,{:>]/);
    expect(css).toContain(".profile-dimensions");
  });
});
