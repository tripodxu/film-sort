import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S5（无障碍纯追加修补）的源码绊线。
 *
 * 规则：只许「给现有元素追加 aria-label / role」与「给一组 role=tab 追加 role=tablist 父容器」，
 * 不许删除节点、不许改布局。逐项都必须配 tol=0 的截图零差异证据（见台账 T-20261017-01）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const occurrence = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("S5 · CompareView 的 ARIA 语义补全", () => {
  const code = stripComments(read("./views/CompareView.tsx"));

  it("比较模式 / 比较深度 两个分组都补上了 tablist 父容器与组名", () => {
    expect(occurrence(code, 'role="tablist"')).toBe(3);
    expect(code).toContain('aria-label={t("比较模式", "Mode")}');
    expect(code).toContain('aria-label={t("比较深度", "Depth")}');
    expect(code).toContain('aria-label={t("比较维度", "Comparison medium")}');
  });

  it("手动模式的两个 checkbox 都有可访问名称（维度 + 清单名）", () => {
    expect(occurrence(code, "aria-label={`${label(entry.kind)} · ${entry.collectionTitle}`}")).toBe(
      2,
    );
    expect(occurrence(code, "checked={manualOwnSelections.has(kindIdx)}")).toBe(1);
    expect(occurrence(code, "checked={manualPeerSelections.has(kindIdx)}")).toBe(1);
  });

  it("每个 role=tab 都仍配着 role=tablist（没有孤儿 tab）", () => {
    const tabs = occurrence(code, 'role="tab"');
    const tablists = occurrence(code, 'role="tablist"');
    expect(tabs).toBeGreaterThanOrEqual(tablists);
    expect(tablists).toBe(3);
  });
});

describe("S5 · PlazaView 的 ARIA 语义补全", () => {
  const code = stripComments(read("./views/PlazaView.tsx"));

  it("维度筛选与排序两组都补上了 tablist，且分别有组名", () => {
    expect(occurrence(code, 'role="tablist"')).toBe(2);
    expect(code).toContain('role="tablist" aria-label={t("榜单维度", "Post medium")}');
    expect(code).toContain('aria-label={t("排序方式", "Sort order")}');
  });

  it("排序分组的包装层用 display:contents，不参与布局（零视觉影响）", () => {
    expect(code).toContain('style={{ display: "contents" }}');
    const wrapper = code.indexOf('aria-label={t("排序方式", "Sort order")}');
    const closer = code.indexOf("</div>", wrapper);
    const search = code.indexOf('className="search-field"');
    expect(wrapper).toBeGreaterThan(-1);
    expect(closer).toBeGreaterThan(wrapper);
    expect(search).toBeGreaterThan(closer);
  });

  it("没有动搜索框自身的可访问名称", () => {
    expect(code).toContain('aria-label={t("搜索榜单或作者", "Search posts or authors")}');
  });
});

/**
 * S5 第二批（S5-2，T-20261024-04）：ProfileView / PlazaPostView / FocusTrap 的
 * 纯追加修补——rename 输入 aria-label、WorkEditor label htmlFor/id 对、rank 菜单
 * Escape、点赞 aria-pressed + 在途防连点、FocusTrap 卸载焦点归还触发元素。
 * 全部为属性追加 / 行为补全，零节点增删、零布局改动。
 */
describe("S5-2 · ProfileView / PlazaPostView / FocusTrap 无障碍补全", () => {
  it("rename 输入有可访问名称", () => {
    const code = read("./views/ProfileView.tsx");
    expect(code).toContain('aria-label={t("重命名榜单", "Rename list")}');
  });

  it("WorkEditor 的手动文本域与搜索输入都有 htmlFor/id 关联", () => {
    const code = read("./views/ProfileView.tsx");
    expect(code).toContain('htmlFor="work-editor-manual"');
    expect(code).toContain('id="work-editor-manual"');
    expect(code).toContain('htmlFor="work-editor-search"');
    expect(code).toContain('id="work-editor-search"');
  });

  it("rank 菜单打开期间 Escape 关闭（document 级监听，挂/卸随 menuOpen）", () => {
    const code = read("./views/ProfileView.tsx");
    expect(code).toMatch(/addEventListener\("keydown"/);
    expect(code).toContain('if (e.key === "Escape") setMenuOpen(false);');
  });

  it("点赞按钮带 aria-pressed 且在途防连点", () => {
    const code = read("./views/PlazaPostView.tsx");
    expect(code).toContain("aria-pressed={liked}");
    expect(code).toContain("disabled={likeBusy}");
    expect(code).toContain("if (likeBusy) return;");
    expect(code).toContain("setLikeBusy(true);");
  });

  it("FocusTrap 卸载时把焦点归还打开弹窗前的触发元素", () => {
    const code = read("./components/FocusTrap.tsx");
    expect(code).toContain("const previouslyFocused = document.activeElement");
    expect(code).toContain("previouslyFocused.isConnected) previouslyFocused.focus();");
  });

  it("死代码清理不回退：plaza-search 死类不再出现，theme-simple 色点与主题 accent 一致", () => {
    const plaza = read("./views/PlazaView.tsx");
    expect(plaza).not.toContain("plaza-search");
    const css = read("./styles.css");
    expect(css).not.toContain(".theme-menu-sep{");
    expect(css).not.toContain(".identity{top:18px}");
    expect(css).toContain(".theme-dot.theme-simple{--dot-a:#f5f7fa;--dot-b:#2b64d8;");
    expect(css).not.toContain("#2f6fed");
  });
});
