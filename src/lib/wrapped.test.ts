// wrapped 纯函数单测（node 环境）。
import { describe, expect, it } from "vitest";
import { buildWrappedStats, draftInsight, readDraftLike, type DraftLike } from "./wrapped";
import type { RankingExport } from "./profile";

const ranking = (kind: RankingExport["kind"], titles: string[]): RankingExport => ({
  version: 1,
  profileId: "p1",
  profileName: "画像",
  kind,
  collectionTitle: `${kind}榜`,
  createdAt: "2026-01-01T00:00:00.000Z",
  items: titles.map((title, i) => ({
    id: `${kind}-${i}`,
    title,
    rank: i + 1,
    ...(kind === "film" ? { year: 2000 + i } : {}),
    ...(kind === "film" ? { creator: `导演${i}` } : {}),
  })),
});

describe("buildWrappedStats", () => {
  it("聚合榜单/作品/创作者/跨度/媒介占比/年代 Top", () => {
    const stats = buildWrappedStats({
      rankings: [ranking("film", ["A", "B", "C"]), ranking("music", ["X", "Y"])],
    });
    expect(stats.lists).toBe(2);
    expect(stats.works).toBe(5);
    expect(stats.creators).toBe(3); // 只有 film 有 creator
    expect(stats.span).toEqual({ earliest: 2000, latest: 2002 });
    expect(stats.mediaShare).toEqual([
      { kind: "film", count: 3, pct: 60 },
      { kind: "music", count: 2, pct: 40 },
    ]);
    expect(stats.topDecades[0]).toEqual({ decade: 2000, count: 3 });
  });
  it("空画像得零值且 mediaShare 为空", () => {
    const stats = buildWrappedStats({ rankings: [] });
    expect(stats.works).toBe(0);
    expect(stats.mediaShare).toEqual([]);
    expect(stats.topDecades).toEqual([]);
  });
});

describe("draftInsight", () => {
  const titleOf = (id: string) => ({ w1: "花样年华", w2: "一一", w3: "牯岭街" })[id];
  it("取 comparisonCount 与 observations 最高的成员对", () => {
    const draft: DraftLike = {
      comparisonCount: 42,
      cycleEvents: [
        { memberIds: ["w1", "w2"], observations: 2 },
        { memberIds: ["w2", "w3"], observations: 3 },
      ],
    };
    const insight = draftInsight(draft, titleOf);
    expect(insight).toEqual({
      comparisons: 42,
      tornPair: { a: "一一", b: "牯岭街", flips: 3 },
    });
  });
  it("单次回环（observations<2）不算纠结", () => {
    const insight = draftInsight(
      { comparisonCount: 5, cycleEvents: [{ memberIds: ["w1", "w2"], observations: 1 }] },
      titleOf,
    );
    expect(insight).toEqual({ comparisons: 5, tornPair: null });
  });
  it("标题解析不到的成员让该回环不可展示", () => {
    const insight = draftInsight(
      { comparisonCount: 5, cycleEvents: [{ memberIds: ["w1", "ghost"], observations: 4 }] },
      titleOf,
    );
    expect(insight?.tornPair).toBeNull();
  });
  it("形状不对返回 null", () => {
    expect(draftInsight({}, titleOf)).toBeNull();
    expect(draftInsight({ comparisonCount: -1 }, titleOf)).toBeNull();
  });
});

describe("readDraftLike", () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  it("解析 art-rank:draft:v2 的嵌套 ranking 串", () => {
    const draft = {
      collection: {},
      ranking: JSON.stringify({ comparisonCount: 7 }),
      profileName: "x",
    };
    const state = readDraftLike(storage(JSON.stringify(draft)));
    expect(state).toMatchObject({ comparisonCount: 7 });
  });
  it("无草稿/坏 JSON 返回 null", () => {
    expect(readDraftLike(storage(null))).toBeNull();
    expect(readDraftLike(storage("not-json"))).toBeNull();
    expect(readDraftLike(storage(JSON.stringify({ ranking: 3 })))).toBeNull();
  });
});
