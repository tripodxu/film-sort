/**
 * 「使用说明」与「技术说明」的内容与打开行为绊线。
 *
 * 这两块文案的真实历史：只在 UI 重构时被顺手扫过（外壳从 9 份手写收成 <Modal>
 * 时正文一字未动），于是内容停在 2026-10 上旬——技术说明只讲经典模式、引导只写
 * 三种来源、AI 点评与 Jev 完全缺席。功能早就上线，用户却从弹窗里读不到。
 *
 * 所以这里把「必须提到什么」锁成断言：功能再来一次大改，忘同步就会红。
 * 末尾一组锁「打开在顶部」——内容变长会把这个缺陷从不可见变成显形。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("使用说明（引导）：只讲怎么用，但要覆盖全部入口", () => {
  it("四种排序模式点名，并给出各自适用场景", () => {
    for (const mode of ["简易最快", "经典是默认", "精确会在经典之上", "自适应按信息量"]) {
      expect(app).toContain(mode);
    }
  });

  it("Jev 代判写清开启入口、阈值档位与代判标注", () => {
    expect(app).toContain("Jev 代判");
    expect(app).toContain("50–90% 五档");
    expect(app).toContain("上一对由 Jev 代判");
    // 撤销与「不达标交还用户」是这项能力的两个关键承诺，不能只写「自动帮你选」。
    expect(app).toContain("随时可撤销");
    expect(app).toContain("没达标的仍交给你自己");
  });

  it("AI 点评与 AI 快排写明入口与件数上限", () => {
    expect(app).toContain("AI 点评默认走服务端内置模型");
    expect(app).toContain("AI 快排");
    expect(app).toContain("255 件");
  });

  it("作品来源覆盖即搜即加与网易云（音乐主路径）", () => {
    expect(app).toContain("即搜即加");
    expect(app).toContain("网易云");
  });

  it("导出的五种格式都在", () => {
    for (const format of ["JSON", "TXT", "Markdown", "CSV", "PNG"]) {
      expect(app).toContain(format);
    }
  });
});

describe("技术说明：只讲原理，但要跟得上算法现状", () => {
  it("四模式都有算法名，自适应点明 Bradley-Terry", () => {
    for (const slug of ["（quick）", "（classic", "（precise）", "（adaptive）"]) {
      expect(app).toContain(slug);
    }
    expect(app).toContain("Bradley-Terry");
  });

  it("验证阶段限定在经典与精确，不把简易模式也写进去", () => {
    expect(app).toContain("简易模式没有这一阶段");
  });

  it("比较指标含深度页的新指标（似然一致度与 bootstrap 区间）", () => {
    expect(app).toContain("Plackett-Luce");
    expect(app).toContain("bootstrap");
    expect(app).toContain("序对账本");
  });

  it("有独立的 AI 能力块，覆盖点评 / 快排 / 代判三条通道", () => {
    expect(app).toContain('t("AI 能力", "AI Capabilities")');
    expect(app).toContain("Jev decides");
  });

  it("AI 的工程约束写明 Key 只存本地、迟到响应不覆盖用户选择", () => {
    expect(app).toContain("Keys live only in localStorage");
    expect(app).toContain("late responses are dropped");
  });
});

describe("两块弹窗的分工", () => {
  it("引导指路技术说明，技术说明指回引导", () => {
    expect(app).toContain("想看算法怎么算，点底部「技术说明」");
    expect(app).toContain("回到「使用说明」");
  });
});

/**
 * 打开位置绊线（2026-10-30）。
 *
 * 内容变长到 9 步后暴露的既有缺陷：FocusTrap 挂载时把焦点给「第一个可聚焦元素」，
 * 而这两个弹窗的首个可聚焦元素在页脚，focus() 会把它滚进视口 ⇒ overflow 容器
 * 直接停在底部，用户一打开就从第 4 步开始。这条缺陷在 5 步时不显形。
 *
 * 测试环境是 node（无 jsdom），所以按仓里惯例做源码扫描断言。判据不是「实现了
 * 某种写法」，而是三件缺一不可的事实：焦点给容器、滚动归零、圈禁没被打破。
 */
describe("弹窗打开位置：焦点给容器并归零滚动", () => {
  const trap = readFileSync(new URL("./components/FocusTrap.tsx", import.meta.url), "utf8");
  const modal = readFileSync(new URL("./components/Modal.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  it("优先聚焦 [role=dialog] 容器，而不是首个可聚焦元素", () => {
    expect(trap).toContain(`el.querySelector<HTMLElement>('[role="dialog"]')`);
    expect(trap).toContain("dialog.focus()");
    // 容器不可聚焦时才回退到首个可聚焦元素：长弹窗与短弹窗共用一份逻辑。
    expect(trap).toContain("firstFocusable?.focus()");
  });

  it("聚焦后把容器滚动位置归零（否则长弹窗打开即滚到底）", () => {
    expect(trap).toContain("dialog.scrollTop = 0");
  });

  it("焦点停在容器上时 Shift+Tab 仍圈回首尾，不逃出 trap", () => {
    expect(trap).toContain(`document.activeElement === el!.querySelector('[role="dialog"]')`);
    expect(trap).toContain("(e.shiftKey ? last : first).focus()");
  });

  it("Modal 的 section 可被聚焦且不套焦点环", () => {
    expect(modal).toContain("tabIndex={-1}");
    expect(css).toContain('[role="dialog"]:focus,[role="dialog"]:focus-visible{outline:none}');
  });
});
