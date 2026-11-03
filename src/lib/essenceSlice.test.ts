import { describe, expect, it } from "vitest";

import { essenceSimilarity, essenceSlice } from "./essenceSlice";

const work = (title: string, creator: string, year: number) => ({ title, creator, year });

describe("essenceSlice", () => {
  it("空清单 / 非正数量返回空切片", () => {
    expect(essenceSlice([], 5)).toEqual({ picks: [], represented: [], coverage: 0 });
    expect(essenceSlice([work("A", "甲", 2000)], 0)).toEqual({
      picks: [],
      represented: [],
      coverage: 0,
    });
  });

  it("数量不小于长度时返回全部并保持原顺序", () => {
    const items = [work("A", "甲", 2000), work("B", "乙", 2010)];
    const result = essenceSlice(items, 5);
    expect(result.picks.map((pick) => pick.index)).toEqual([0, 1]);
    expect(result.represented).toEqual([1, 1]);
    expect(result.coverage).toBe(100);
  });

  it("优先选择与锚点差异最大的作品，而不是机械取前 N 名", () => {
    const items = [
      work("夜巡", "甲", 2000),
      work("夜巡 II", "甲", 2001),
      work("夜巡 III", "甲", 2002),
      work("完全不同的书", "乙", 2020),
    ];
    const result = essenceSlice(items, 2);
    expect(result.picks.map((pick) => pick.index)).toEqual([0, 3]);
  });

  it("同分时优先排名靠前的作品，结果确定", () => {
    const items = [
      work("甲作品", "甲", 2000),
      work("乙作品", "乙", 2000),
      work("丙作品", "丙", 2000),
    ];
    const first = essenceSlice(items, 2);
    const second = essenceSlice(items, 2);
    expect(first.picks.map((pick) => pick.index)).toEqual([0, 1]);
    expect(second).toEqual(first);
  });

  it("覆盖率是 0–100 的整数，且不超过全量", () => {
    const items = Array.from({ length: 20 }, (_, index) =>
      work(`作品 ${index}`, `作者 ${index % 3}`, 1990 + index),
    );
    const result = essenceSlice(items, 5);
    expect(result.picks).toHaveLength(5);
    expect(result.represented).toHaveLength(5);
    expect(result.represented.reduce((sum, value) => sum + value, 0)).toBe(items.length);
    expect(result.represented.every((value) => value >= 1)).toBe(true);
    expect(result.coverage).toBeGreaterThanOrEqual(0);
    expect(result.coverage).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.coverage)).toBe(true);
  });

  it("相似度对标题、创作者、年代分别有响应", () => {
    const base = work("Night Watch", "甲", 2000);
    expect(essenceSimilarity(base, base)).toBe(1);
    expect(essenceSimilarity(base, work("Night Watch", "乙", 2000))).toBeLessThan(1);
    expect(essenceSimilarity(base, work("完全不同", "乙", 2000))).toBeLessThan(1);
    expect(essenceSimilarity(base, work("Night Watch", "甲", 2040))).toBeLessThan(1);
  });
});
