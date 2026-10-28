import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Jev 代判 effect 的依赖契约（全仓审查 2026-10-27 · P0-2）。
 *
 * 事故形态：deps 里含 `t` / `act` / `worksById`，三者每次渲染都是新引用
 * （`t` 是 App 里内联箭头函数、`act` 是 useSorting 里的普通函数、`worksById` 每次重建 Map）。
 * 请求飞行期间任意一次重渲染（notice 弹出、草稿落盘、主题切换、进度保存）都会触发
 * cleanup 把 `stale` 置真 → 响应被丢弃；而 effect 重跑时
 * `if (assistKeyRef.current === key) return` 命中早退分支，**这一对永不重试**。
 * 现象是「AI 代判随机失灵」，且 busy 已复位，用户无从判断发生了什么。
 *
 * 契约：deps 只许是「当前对」三元组；不稳定引用走 ref 兜最新值。
 * 换对才该重发请求；`kind` / `locale` / `tasteContext` 只影响下一次请求的入参。
 */
function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}
/** 剥注释再扫：解释性注释里写了 `t,` 之类不该把断言喂绿，也不该把它弄红。 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

describe("Jev 代判 effect 依赖（P0-2）", () => {
  const code = strip(read("./views/SortingView.tsx"));

  it("代判 effect 的依赖数组只有「当前对」三元组", () => {
    expect(code).toContain("}, [comparison.leftId, comparison.rightId, comparison.phase]);");
  });

  it("依赖数组里不许再出现每次渲染都换引用的 t / act / worksById", () => {
    // 找出所有 effect 的依赖数组，锁定「含 comparison.leftId 的那一个」——
    // 不靠行号也不靠格式，只认语义。
    const all = code.match(/\}, \[[^\]]*\]\);/g) ?? [];
    const assist = all.find((item) => item.includes("comparison.leftId")) ?? "";
    expect(assist).not.toBe("");
    for (const unstable of [" t,", "act,", "worksById,", "tasteContext,"]) {
      expect(assist).not.toContain(unstable);
    }
  });

  it("不稳定引用经 ref 兜最新值，且该 ref 每次 commit 都刷新", () => {
    expect(code).toContain(
      "const latestAssist = useRef({ t, act, worksById, kind, locale, tasteContext });",
    );
    // 无依赖数组的 effect：每次 commit 都跑，且声明在主 effect 之前，
    // 所以主 effect 读到的必然是本次渲染的值。
    expect(code).toMatch(
      /useEffect\(\(\) => \{\s*latestAssist\.current = \{ t, act, worksById, kind, locale, tasteContext \};\s*\}\);/,
    );
    expect(code).toContain(
      "const { t, act, worksById, kind, locale, tasteContext } = latestAssist.current;",
    );
  });
});
