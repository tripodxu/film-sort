import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { essenceSimilarity, essenceSlice, type EssenceCandidate } from "./essenceSlice";
import { galleryWorkKey } from "./galleryStats";

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

  it("导入清单的脏字段不击穿最远点采样，也不抛错", () => {
    // 模拟 TXT/JSON 导入后未归一化的真实形状：NaN / Infinity / 字符串年份 /
    // 非字符串创作者 / 缺标题。旧实现要么抛 TypeError，要么让相似度变 NaN，
    // 使采样静默退化成「按顺序取前 N 件」。
    const dirty = [
      { title: "夜巡", creator: "甲", year: 2000 },
      { title: "夜巡 II", creator: "甲", year: Number.NaN },
      { title: "夜巡 III", creator: "甲", year: Number.POSITIVE_INFINITY },
      { title: "完全不同的书", creator: 42, year: "2020" },
      { title: undefined, creator: null, year: Number.NEGATIVE_INFINITY },
    ] as unknown as EssenceCandidate[];

    expect(() => essenceSlice(dirty, 3)).not.toThrow();
    const slice = essenceSlice(dirty, 3);
    expect(slice.picks).toHaveLength(3);
    expect(slice.picks.every((pick) => Number.isFinite(pick.novelty))).toBe(true);
    expect(slice.picks.map((pick) => pick.index)).not.toEqual([0, 1, 2]);
    expect(slice.represented.reduce((sum, value) => sum + value, 0)).toBe(dirty.length);
    expect(slice.coverage).toBeGreaterThanOrEqual(0);
    expect(slice.coverage).toBeLessThanOrEqual(100);
    expect(Number.isFinite(essenceSimilarity(dirty[0], dirty[1]))).toBe(true);
    expect(Number.isFinite(essenceSimilarity(dirty[3], dirty[4]))).toBe(true);
  });

  it("picks[].novelty 是被选中时相对当时已选集合的最小差异，锚点记 1", () => {
    const items = [
      work("夜巡", "甲", 2000),
      work("夜巡 II", "甲", 2001),
      work("夜巡 III", "甲", 2002),
      work("完全不同的书", "乙", 2020),
      work("另一本", "丙", 1988),
    ];
    const result = essenceSlice(items, 3);
    expect(result.picks[0].novelty).toBe(1);
    for (let order = 1; order < result.picks.length; order++) {
      const picked = items[result.picks[order].index];
      const earlier = result.picks.slice(0, order).map((pick) => items[pick.index]);
      const expected = Math.min(...earlier.map((other) => 1 - essenceSimilarity(picked, other)));
      expect(result.picks[order].novelty).toBeCloseTo(expected, 10);
    }
  });
});

describe("galleryWorkKey", () => {
  it("多件无 id 与重复 id 混排时，渲染键仍互不重复", () => {
    const works = [{}, { id: "a" }, {}, { id: "a" }];
    const keys = works.map((item, index) => galleryWorkKey(item, index));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("精华切片与 2-5 名两条轨道都不许再拿可选 id 直接当 key", () => {
    const code = readFileSync("src/components/GalleryBento.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[^\S\n]*\/\/.*$/gm, "");
    expect(code).toContain("key={galleryWorkKey(work, index)}");
    expect(code).toContain("key={galleryWorkKey(work, offset + 1)}");
    expect(code).not.toContain("key={work.id}");
  });
});
