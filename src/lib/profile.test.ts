import { describe, it, expect } from "vitest";
import {
  parseProfile,
  mergeRanking,
  renameRanking,
  deleteRanking,
  mergeProfiles,
  compareRankings,
  compareDimensions,
  mergeDimensionRankings,
  normalizeTitle,
  profileText,
  type ArtisticProfile,
  type RankingExport,
} from "./profile";

function makeRanking(overrides: Partial<RankingExport> = {}): RankingExport {
  return {
    version: 1,
    profileId: crypto.randomUUID(),
    profileName: "测试画像",
    kind: "film",
    collectionTitle: "测试榜单",
    createdAt: new Date().toISOString(),
    items: [
      { id: "a", title: "作品A", rank: 1, creator: "导演A", year: 2000 },
      { id: "b", title: "作品B", rank: 2, creator: "导演B", year: 2010 },
      { id: "c", title: "作品C", rank: 3 },
    ],
    ...overrides,
  };
}

describe("normalizeTitle", () => {
  it("lowercases and trims", () => {
    expect(normalizeTitle("  Hello World  ")).toBe("hello world");
  });

  it("normalizes unicode", () => {
    expect(normalizeTitle("ＡＢＣ")).toBe("abc");
  });

  it("collapses whitespace", () => {
    expect(normalizeTitle("hello   world")).toBe("hello world");
  });
});

describe("parseProfile", () => {
  it("parses a valid v2 profile", () => {
    const profile: ArtisticProfile = {
      version: 2,
      profileId: crypto.randomUUID(),
      profileName: "我的画像",
      updatedAt: new Date().toISOString(),
      rankings: [makeRanking()],
    };
    const parsed = parseProfile(profile);
    expect(parsed.version).toBe(2);
    expect(parsed.rankings).toHaveLength(1);
    expect(parsed.rankings[0].items).toHaveLength(3);
  });

  it("migrates v1 profile to v2", () => {
    const v1 = makeRanking();
    const parsed = parseProfile(v1);
    expect(parsed.version).toBe(2);
    expect(parsed.rankings).toHaveLength(1);
  });

  it("rejects invalid profile", () => {
    expect(() => parseProfile(null)).toThrow();
    expect(() => parseProfile({})).toThrow();
    expect(() => parseProfile({ version: 3 })).toThrow();
  });

  it("rejects profile with empty rankings", () => {
    expect(() => parseProfile({ version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(), rankings: [] })).toThrow();
  });

  it("rejects duplicate artwork", () => {
    const ranking = makeRanking({
      items: [
        { id: "a", title: "Same", rank: 1 },
        { id: "b", title: "Same", rank: 2 },
      ],
    });
    const profile = { version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(), rankings: [ranking] };
    // Same title + no year/creator = duplicate identity
    expect(() => parseProfile(profile)).toThrow();
  });
});

describe("mergeRanking", () => {
  it("creates profile from null", () => {
    const ranking = makeRanking();
    const profile = mergeRanking(null, ranking);
    expect(profile.rankings).toHaveLength(1);
    expect(profile.profileName).toBe("测试画像");
  });

  it("replaces same kind+title ranking", () => {
    const ranking1 = makeRanking({ collectionTitle: "榜单A" });
    const ranking2 = makeRanking({ collectionTitle: "榜单A", items: [
      { id: "x", title: "X", rank: 1 },
      { id: "y", title: "Y", rank: 2 },
    ] });
    let profile = mergeRanking(null, ranking1);
    profile = mergeRanking(profile, ranking2);
    expect(profile.rankings).toHaveLength(1);
    expect(profile.rankings[0].items[0].title).toBe("X");
  });

  it("appends different kind ranking", () => {
    const film = makeRanking({ kind: "film" });
    const book = makeRanking({ kind: "book", collectionTitle: "书单" });
    let profile = mergeRanking(null, film);
    profile = mergeRanking(profile, book);
    expect(profile.rankings).toHaveLength(2);
  });
});

describe("renameRanking", () => {
  it("renames a ranking", () => {
    const profile = mergeRanking(null, makeRanking());
    const renamed = renameRanking(profile, 0, "新名字");
    expect(renamed.rankings[0].collectionTitle).toBe("新名字");
  });

  it("ignores invalid index", () => {
    const profile = mergeRanking(null, makeRanking());
    const result = renameRanking(profile, 99, "新名字");
    expect(result).toBe(profile);
  });
});

describe("deleteRanking", () => {
  it("deletes a ranking", () => {
    const profile = mergeRanking(null, makeRanking());
    const result = deleteRanking(profile, 0);
    expect(result).toBeNull();
  });

  it("returns profile with remaining rankings", () => {
    let profile = mergeRanking(null, makeRanking({ kind: "film" }));
    profile = mergeRanking(profile, makeRanking({ kind: "book", collectionTitle: "书" }));
    const result = deleteRanking(profile, 0);
    expect(result).not.toBeNull();
    expect(result!.rankings).toHaveLength(1);
  });
});

describe("mergeProfiles", () => {
  it("merges non-overlapping profiles", () => {
    const cloud = mergeRanking(null, makeRanking({ kind: "film", collectionTitle: "云电影" }));
    const local = mergeRanking(null, makeRanking({ kind: "book", collectionTitle: "本书" }));
    const merged = mergeProfiles(cloud, local);
    expect(merged.rankings).toHaveLength(2);
  });

  it("disambiguates duplicate titles with suffix", () => {
    const cloud = mergeRanking(null, makeRanking({ collectionTitle: "同名" }));
    const local = mergeRanking(null, makeRanking({ collectionTitle: "同名", items: [
      { id: "x", title: "X", rank: 1 },
      { id: "y", title: "Y", rank: 2 },
    ] }));
    const merged = mergeProfiles(cloud, local);
    expect(merged.rankings).toHaveLength(2);
    expect(merged.rankings[1].collectionTitle).toContain("（2）");
  });
});

describe("compareRankings", () => {
  it("computes overlap between identical rankings", () => {
    const own = makeRanking();
    const peer = makeRanking();
    const result = compareRankings(own, peer);
    expect(result.overlap).toBe(100);
    expect(result.sharedCount).toBe(3);
    expect(result.orderAgreement).toBe(100);
  });

  it("computes partial overlap", () => {
    const own = makeRanking({ items: [
      { id: "a", title: "A", rank: 1 },
      { id: "b", title: "B", rank: 2 },
      { id: "c", title: "C", rank: 3 },
    ] });
    const peer = makeRanking({ items: [
      { id: "x", title: "B", rank: 1 },
      { id: "y", title: "A", rank: 2 },
      { id: "z", title: "D", rank: 3 },
    ] });
    const result = compareRankings(own, peer);
    expect(result.sharedCount).toBe(2);
    expect(result.overlap).toBeLessThan(100);
  });

  it("handles zero overlap", () => {
    const own = makeRanking({ items: [
      { id: "a", title: "独有A", rank: 1 },
      { id: "b", title: "独有B", rank: 2 },
    ] });
    const peer = makeRanking({ items: [
      { id: "x", title: "独有X", rank: 1 },
      { id: "y", title: "独有Y", rank: 2 },
    ] });
    const result = compareRankings(own, peer);
    expect(result.sharedCount).toBe(0);
    expect(result.overlap).toBe(0);
  });
});

describe("mergeDimensionRankings", () => {
  it("merges multiple rankings, best rank wins", () => {
    const r1 = makeRanking({ items: [
      { id: "a", title: "A", rank: 1 },
      { id: "b", title: "B", rank: 2 },
    ] });
    const r2 = makeRanking({ items: [
      { id: "x", title: "B", rank: 1 },
      { id: "y", title: "A", rank: 2 },
    ] });
    const merged = mergeDimensionRankings([r1, r2]);
    expect(merged).not.toBeNull();
    expect(merged!.items).toHaveLength(2);
    // B should have best rank 1 (from r2), A should have best rank 1 (from r1)
    const itemA = merged!.items.find((i) => i.title === "A");
    const itemB = merged!.items.find((i) => i.title === "B");
    expect(itemA!.bestRank).toBe(1);
    expect(itemB!.bestRank).toBe(1);
    expect(itemA!.sources).toHaveLength(2);
  });

  it("returns null for empty input", () => {
    expect(mergeDimensionRankings([])).toBeNull();
  });
});

describe("profileText", () => {
  it("generates TXT format", () => {
    const profile = mergeRanking(null, makeRanking());
    const text = profileText(profile, "txt");
    expect(text).toContain("测试画像");
    expect(text).toContain("作品A");
  });

  it("generates MD format with headings", () => {
    const profile = mergeRanking(null, makeRanking());
    const text = profileText(profile, "md");
    expect(text).toContain("# 测试画像");
    expect(text).toContain("## ");
  });

  it("generates CSV format with BOM", () => {
    const profile = mergeRanking(null, makeRanking());
    const text = profileText(profile, "csv");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("medium");
    expect(text).toContain("rank");
  });
});
