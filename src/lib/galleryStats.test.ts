// galleryStats 纯函数单测（node 环境，与 profile.test.ts 同法）。
import { describe, expect, it } from "vitest";
import type { RankedArtwork, RankingExport } from "./profile";
import { creatorCount, decadeSlices, decadeSpan, kindCounts, profileStats } from "./galleryStats";

const work = (id: string, year?: number, creator?: string): RankedArtwork => ({
  id,
  title: `作品 ${id}`,
  rank: 1,
  ...(year !== undefined ? { year } : {}),
  ...(creator ? { creator } : {}),
});

const ranking = (kind: RankingExport["kind"], items: RankedArtwork[]): RankingExport => ({
  version: 1,
  profileId: "p1",
  profileName: "测试画像",
  kind,
  collectionTitle: `${kind} 榜单`,
  createdAt: "2026-01-01T00:00:00.000Z",
  items,
});

describe("kindCounts", () => {
  it("四种媒介恒全量给出，缺失维度计 0（雷达轴数稳定）", () => {
    const counts = kindCounts({ rankings: [ranking("film", [work("a"), work("b")])] });
    expect(counts.map((c) => c.kind)).toEqual(["film", "book", "music", "other"]);
    expect(counts.map((c) => c.count)).toEqual([2, 0, 0, 0]);
  });
  it("同媒介多榜单聚合求和", () => {
    const counts = kindCounts({
      rankings: [ranking("film", [work("a")]), ranking("film", [work("b"), work("c")])],
    });
    expect(counts.find((c) => c.kind === "film")?.count).toBe(3);
  });
});

describe("decadeSlices", () => {
  it("按年代起点分桶并升序", () => {
    const slices = decadeSlices([
      work("a", 1994),
      work("b", 1999),
      work("c", 2001),
      work("d", 1972),
    ]);
    expect(slices).toEqual([
      { decade: 1970, count: 1 },
      { decade: 1990, count: 2 },
      { decade: 2000, count: 1 },
    ]);
  });
  it("无年份作品归 null 桶且排在最后", () => {
    const slices = decadeSlices([work("a"), work("b", 2010), work("c")]);
    expect(slices).toEqual([
      { decade: 2010, count: 1 },
      { decade: null, count: 2 },
    ]);
  });
  it("空列表得空数组", () => {
    expect(decadeSlices([])).toEqual([]);
  });
});

describe("decadeSpan", () => {
  it("返回最早/最晚年份，忽略无年份作品", () => {
    expect(decadeSpan([work("a", 1988), work("b", 2024), work("c")])).toEqual({
      earliest: 1988,
      latest: 2024,
    });
  });
  it("全无年份时两侧为 null", () => {
    expect(decadeSpan([work("a"), work("b")])).toEqual({ earliest: null, latest: null });
  });
});

describe("creatorCount", () => {
  it("去重且大小写不敏感，空创作者不计", () => {
    expect(
      creatorCount([
        work("a", undefined, "王家卫"),
        work("b", undefined, " 王家卫 "),
        work("c", undefined, "WONG Kar-wai"),
        work("d"),
        work("e", undefined, "  "),
      ]),
    ).toBe(2);
  });
});

describe("profileStats", () => {
  it("聚合作品数/榜单数/创作者数/年代跨度", () => {
    const stats = profileStats({
      rankings: [
        ranking("film", [work("a", 1994, "A"), work("b", 2020)]),
        ranking("book", [work("c", 1988, "b")]),
      ],
    });
    expect(stats).toEqual({
      works: 3,
      lists: 2,
      creators: 2,
      span: { earliest: 1988, latest: 2020 },
    });
  });
});
