import { describe, expect, it } from "vitest";

import { DEFAULT_FAILURE_REPORT_LIMIT, rememberFailure } from "./failureReport";

describe("rememberFailure 有界去重", () => {
  it("首次见到返回 true，重复键既不增长也不再上报", () => {
    const store = new Set<string>();
    expect(rememberFailure(store, "film|A|https://x/1.jpg")).toBe(true);
    expect(rememberFailure(store, "film|A|https://x/1.jpg")).toBe(false);
    expect(store.size).toBe(1);
  });

  it("超过上界后集合大小不越界，且最新写入的键仍在", () => {
    const store = new Set<string>();
    const max = 10;
    for (let i = 0; i < max * 3; i += 1) {
      expect(rememberFailure(store, `key-${i}`, max)).toBe(true);
      expect(store.size).toBeLessThanOrEqual(max);
    }
    expect(store.has(`key-${max * 3 - 1}`)).toBe(true);
  });

  it("触顶时淘汰的是最旧的一半", () => {
    const store = new Set<string>();
    for (let i = 0; i < 10; i += 1) rememberFailure(store, `key-${i}`, 10);
    rememberFailure(store, "key-10", 10);
    expect(store.has("key-0")).toBe(false); // 最旧的被淘汰
    expect(store.has("key-9")).toBe(true);
    expect(store.has("key-10")).toBe(true);
  });

  it("上限为 1 的边界不产生死循环或空集合", () => {
    const store = new Set<string>();
    expect(rememberFailure(store, "a", 1)).toBe(true);
    expect(rememberFailure(store, "b", 1)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.has("b")).toBe(true);
  });

  it("默认上界是正数，且比 1 大（否则等于没有去重窗口）", () => {
    expect(DEFAULT_FAILURE_REPORT_LIMIT).toBeGreaterThan(1);
  });
});
