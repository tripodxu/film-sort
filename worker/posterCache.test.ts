import { describe, expect, it } from "vitest";
import { knownPosterHit, posterCacheTtlMs, posterMediaKey, resolvePostersBatch } from "./media";

/**
 * 海报解析的两条服务端不变量：
 *  1. 瞬时失败（被限流）与永久缺失（上游回答没有）必须有不同的负缓存 TTL，
 *     否则「刷新也补不回来」和「反复打上游」会同时发生；
 *  2. 已经落库的结果必须能短路掉上游（Phase 1 先查库）。
 */

describe("posterCacheTtlMs", () => {
  it("瞬时失败 TTL 远短于永久缺失（相差三个数量级）", () => {
    expect(posterCacheTtlMs("throttled")).toBe(15 * 1000);
    expect(posterCacheTtlMs("absent")).toBe(24 * 60 * 60 * 1000);
    expect(posterCacheTtlMs("throttled")).toBeLessThan(posterCacheTtlMs("absent"));
  });

  it("命中结果缓存一天", () => {
    expect(posterCacheTtlMs("found")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("knownPosterHit", () => {
  const urls = ["https://img1.doubanio.com/view/photo/l/public/p1.webp"];

  it("命中返回地址", () => {
    expect(knownPosterHit(new Map([["k", urls]]), "k")).toEqual(urls);
  });

  it("空数组按未命中处理（空结果本来就不落库）", () => {
    expect(knownPosterHit(new Map([["k", []]]), "k")).toBeNull();
  });

  it("缺键 / 无 known 都返回 null", () => {
    expect(knownPosterHit(new Map(), "k")).toBeNull();
    expect(knownPosterHit(undefined, "k")).toBeNull();
  });
});

describe("resolvePostersBatch", () => {
  const urls = ["https://img1.doubanio.com/view/photo/l/public/p1.webp"];

  it("已知命中即短路：keys 仍与入参等长对齐，且不会触发上游", async () => {
    // 全部命中 → pending 为空 → 一个上游请求都不会发出（测试环境无网络也能过）。
    const key = posterMediaKey("童话", "", "music", undefined);
    const requests = [
      { title: "童话", type: "music" as const },
      { title: "童话", type: "music" as const },
    ];
    const { results, keys, outcomes } = await resolvePostersBatch(requests, undefined, 8, new Map([[key, urls]]));
    expect(keys).toEqual([key, key]);
    expect(results[key]).toEqual(urls);
    expect(outcomes[key]).toBe("found");
  });
});
