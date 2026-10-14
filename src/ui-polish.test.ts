import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** T-20261014-10 打磨绊线：11 主题真机对比度审计的结论 + hero/图标动效。
 *
 * 对比度（Chromium 实测，WCAG 4.5 线）：
 *  - simple 激活导航 accent #2f6fed 在浅底只有 4.24 → 加深到 #2b64d8（5.00，
 *    主按钮白字同步 4.55→5.36）；--film 同步（同色相角色）。
 *  - paper --text-3/--muted #8B8175 在纸面只有 3.28 → #6B5F50（5.33）。
 *  - aurora 主按钮 1.18 是审计脚本只读 backgroundColor 的 artifact（实际是
 *    accent 渐变 + 深色字），源码级排除，不改。
 * 其余 9 主题全部 ≥4.5，无需动。 */

function css(): string {
  return readFileSync(new URL("./styles.css", import.meta.url), "utf8");
}

describe("ui polish（T-20261014-10）", () => {
  it("simple accent 加深到 #2b64d8（激活导航对比度 4.24→5.00）", () => {
    const code = css();
    expect(code).toContain("--accent:#2b64d8;");
    expect(code).not.toContain("--accent:#2f6fed;");
  });

  it("paper 次级文字加深到 #6B5F50（纸面对比度 3.28→5.33）", () => {
    const code = css();
    expect(code).toContain("--text-3:#6B5F50;--muted:#6B5F50;");
    expect(code).not.toContain("--text-3:#8B8175;");
  });

  it("orb 降级有主题氛围（无 WebGL 时 hero 右侧不是死灰平板）", () => {
    const code = css();
    expect(code).toMatch(/\.orb-scene-fallback\{[^}]*radial-gradient/);
    expect(code).toMatch(/var\(--accent\) 13%/);
  });

  it("图标按钮有过渡 + 按压缩放（与 .button 按压语言一致）", () => {
    const code = css();
    expect(code).toMatch(/\.icon-button\{[^}]*transition:[^}]*transform/);
    expect(code).toContain(".icon-button:active:not(:disabled){transform:scale(.9)}");
  });

  it("hero 入场三段 stagger（reduced-motion 下由全局规则清零）", () => {
    const code = css();
    expect(code).toContain("@keyframes home-rise");
    expect(code).toMatch(/\.home-heading p\{animation-delay:calc\(var\(--dur-stagger\) \* 2\)\}/);
    // 全局 reduced-motion 熔断必须存在，否则入场动画在该偏好下无法静止。
    expect(code).toContain(
      "@media(prefers-reduced-motion:reduce){*,*:before,*:after{transition:none!important;animation:none!important;",
    );
  });
});
