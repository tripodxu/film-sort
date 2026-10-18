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
    const search = code.indexOf('className="search-field plaza-search"');
    expect(wrapper).toBeGreaterThan(-1);
    expect(closer).toBeGreaterThan(wrapper);
    expect(search).toBeGreaterThan(closer);
  });

  it("没有动搜索框自身的可访问名称", () => {
    expect(code).toContain('aria-label={t("搜索榜单或作者", "Search posts or authors")}');
  });
});
