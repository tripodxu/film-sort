import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePosterEntry } from "./media";

/**
 * 「其他类」五档兜底的**运行时**记账用例（台账 P1：迭代 8 遗留）。
 *
 * 此前只有源码形状断言 + `wikiProbeVerdict({ok:1,failed:5})` 的纯函数断言，
 * 没人真的把整条 `computePosters` 链跑起来看它最后记成什么。这里用 fetch 桩
 * 让 zh 维基正常答复、en 维基挂掉，走完真实链路，断言：
 *   - 有成功答复 + 有失败 ⇒ `absent`（24h 缺图缓存，可接受）
 *   - 一次都没问到 ⇒ `throttled`（15s 负缓存，刷新即重试）
 * 判错方向的后果是把一次上游抖动固化成「一整天没有封面」。
 */

const EMPTY_PAGE = JSON.stringify({ query: { pages: {} } });

function stubWiki(options: { zh: "ok" | "down"; en: "ok" | "down" }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const host = url.includes("en.wikipedia.org") ? "en" : "zh";
      if (options[host] === "down") throw new Error(`${host} wiki unreachable`);
      return new Response(EMPTY_PAGE, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("「其他类」海报链运行时的 absent / throttled 记账", () => {
  it("zh 有答复、en 全挂（前几档成功、后几档超时）⇒ absent，不是 throttled", async () => {
    const calls = stubWiki({ zh: "ok", en: "down" });
    const entry = await resolvePosterEntry("运行时记账-前四档成功", "", 2014, "other");
    expect(entry.urls).toEqual([]);
    // 真的走了多条链（而不是提前 return）：至少 zh 与 en 都被问过。
    expect(calls.some((url) => url.includes("zh.wikipedia.org"))).toBe(true);
    expect(calls.some((url) => url.includes("en.wikipedia.org"))).toBe(true);
    expect(entry.outcome).toBe("absent");
  });

  it("zh / en 全部上游故障（一次都没问到）⇒ throttled，刷新可重试", async () => {
    stubWiki({ zh: "down", en: "down" });
    const entry = await resolvePosterEntry("运行时记账-全挂", "", 2014, "other");
    expect(entry.urls).toEqual([]);
    expect(entry.outcome).toBe("throttled");
  });
});
