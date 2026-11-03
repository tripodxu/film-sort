/**
 * 现代主题二次打磨的回归绊线——把这次修复的三类事实固定下来：
 * 1) HeroBackdrop 的指针监听必须挂在 hero 宿主上（装饰层是 pointer-events:none，
 *    收不到事件）；rAF 必须收敛即停，并尊重 prefers-reduced-motion。
 * 2) 维度卡入场动画只能用 opacity/translate/scale，不能用 transform 填充，
 *    否则会按住 HomeView 写入的内联 3D tilt。
 * 3) hover / focus-visible 规则必须限定在 `:root:not([data-theme])` 内。
 * 4) View Transition 只在现代主题启用，且回调里要 flushSync 同步提交。
 *
 * 纯字符串断言，node 环境即可跑（与 ui-fixes.test.ts 同法）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const backdrop = readFileSync("src/components/HeroBackdrop.tsx", "utf8");
const router = readFileSync("src/lib/useRouter.ts", "utf8");

describe("HeroBackdrop 指针与停机", () => {
  it("监听包裹 hero 的宿主，而不是 pointer-events:none 的装饰层", () => {
    expect(backdrop).toContain('root.closest<HTMLElement>(".orb-hero") ?? root');
    expect(backdrop).toContain('host.addEventListener("pointermove"');
  });

  it("尊重 prefers-reduced-motion，且 rAF 收敛即停", () => {
    expect(backdrop).toContain('matchMedia?.("(prefers-reduced-motion: reduce)")');
    expect(backdrop).toContain("if (cx !== tx || cy !== ty) raf = requestAnimationFrame(tick)");
  });
});

describe("维度卡入场不覆盖 3D tilt", () => {
  it("入场动画只动 opacity/translate/scale，且不使用 transform 填充", () => {
    expect(css).toContain(
      "@keyframes md-card-in{from{opacity:0;translate:0 10px;scale:.97}to{opacity:1;translate:0 0;scale:1}}",
    );
    expect(css).toContain("animation:md-card-in .5s var(--ease-out) backwards");
    expect(css).not.toContain("animation:cardAppear .5s var(--ease-out) both");
  });

  it("hover / focus-visible 规则都限定在现代主题内", () => {
    expect(css).not.toMatch(/(^|,)\s*\.medium-section \.medium-item:focus-visible/m);
    expect(css).toContain(":root:not([data-theme]) .medium-section .medium-item:focus-visible{");
  });
});

describe("View Transition 只在现代主题启用并同步提交", () => {
  it("先判断 data-theme，且回调里 flushSync", () => {
    expect(router).toContain('document.documentElement.hasAttribute("data-theme")');
    expect(router).toContain("flushSync(render)");
  });
});
