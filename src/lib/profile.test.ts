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
  readProfile,
  toRankedItems,
  LIBRARY_KEY,
  RECOVERY_KEY,
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

  it("合并重复作品，而不是让整份画像失效", () => {
    const ranking = makeRanking({
      items: [
        { id: "a", title: "Same", rank: 1 },
        { id: "b", title: "Same", rank: 2 },
        { id: "c", title: "Other", rank: 3 },
      ],
    });
    const profile = { version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(), rankings: [ranking] };
    // 同名同作者且都无年份 = 同一 identity：保留首次出现，rank 重排为 1..n。
    // 旧版本在这里抛 Duplicate artwork，读取方随即删掉用户整份画像——
    // 这正是「保存成功、刷新后榜单消失」的成因。
    const parsed = parseProfile(profile);
    expect(parsed.rankings[0].items).toEqual([
      { id: "a", title: "Same", rank: 1 },
      { id: "c", title: "Other", rank: 2 },
    ]);
  });

  it("单条作品损坏只丢那一条，rank 自动补齐到 1..n", () => {
    const ranking = makeRanking({
      // 故意混入真实世界里会出现的脏数据，因此断言成 items 形状。
      items: [
        { id: "a", title: "A", rank: 1 },
        { id: "b", title: "", rank: 2 },                 // 标题为空
        { id: "c", title: "C", rank: 3, year: 9999 },    // 年份越界
        "不是对象",
        { id: "e", title: "E", rank: 5 },
      ] as unknown as RankingExport["items"],
    });
    const parsed = parseProfile({ version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(), rankings: [ranking] });
    expect(parsed.rankings[0].items).toEqual([
      { id: "a", title: "A", rank: 1 },
      { id: "e", title: "E", rank: 2 },
    ]);
  });

  it("同一 id 只保留首次出现", () => {
    const ranking = makeRanking({ items: [{ id: "dup", title: "A", rank: 1 }, { id: "dup", title: "B", rank: 2 }] });
    const parsed = parseProfile({ version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(), rankings: [ranking] });
    expect(parsed.rankings[0].items).toHaveLength(1);
  });

  it("一份榜单坏掉不连坐其它榜单", () => {
    const good = makeRanking({ collectionTitle: "好的" });
    const profile = {
      version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(),
      rankings: [{ version: 1 }, good],
    };
    const parsed = parseProfile(profile);
    expect(parsed.rankings).toHaveLength(1);
    expect(parsed.rankings[0].collectionTitle).toBe("好的");
  });

  it("所有榜单都不可用时才抛错", () => {
    const profile = { version: 2, profileId: "x", profileName: "y", updatedAt: new Date().toISOString(), rankings: [{ version: 1 }] };
    expect(() => parseProfile(profile)).toThrow();
  });
});

describe("toRankedItems（唯一写入端入口）", () => {
  it("去重 + 重排 rank + 补齐缺失的 id", () => {
    const items = toRankedItems([
      { id: "a", title: "A", rank: 7 },
      { id: "b", title: "A", rank: 9 },       // 与上一条 identity 相同 → 合并
      { title: "B", rank: 3 },                // 没有 id → 补齐
      { title: "C", rank: 4, year: 2001 },
      { title: "C", rank: 5, year: 2002 },    // 年份不同 → 保留
    ]);
    expect(items).toEqual([
      { id: "a", title: "A", rank: 1 },
      { id: "auto-2", title: "B", rank: 2 },
      { id: "auto-3", title: "C", year: 2001, rank: 3 },
      { id: "auto-4", title: "C", year: 2002, rank: 4 },
    ]);
  });

  it("写入端产物一定可被读取端接受：150 首真实重复数据往返", () => {
    // 逐字取自线上 GET /api/plaza/posts/32（该账号那份 150 首网易云歌单）里相撞的曲目：
    // 同名同歌手、都没有年份，identity 完全相同。旧代码会把它们原样写进画像，
    // 于是刷新时 parseRanking 抛 Duplicate artwork，readProfile 删掉整份数据。
    const real = [
      { id: "netease-85580", title: "童话", rank: 4, creator: "光良" },
      { id: "netease-85491", title: "童话", rank: 32, creator: "光良" },
      { id: "netease-5238221", title: "水手", rank: 12, creator: "郑智化" },
      { id: "netease-190381", title: "水手", rank: 44, creator: "郑智化" },
      { id: "netease-2083785152", title: "唯一", rank: 9, creator: "G.E.M.邓紫棋" },
      { id: "netease-27483167", title: "唯一", rank: 64, creator: "王力宏" },
    ];
    const items = toRankedItems(real);
    // 三对同名，其中两对同作者 → 合并 2 条；「唯一」作者不同 → 两条都留。
    expect(items.map((item) => `${item.title}/${item.creator}`)).toEqual([
      "童话/光良", "水手/郑智化", "唯一/G.E.M.邓紫棋", "唯一/王力宏",
    ]);
    expect(real.length - items.length).toBe(2);
    // 关键断言：写入端的产物可以被读取端完整解析，往返无损（除被合并的重复项）。
    const profile = { version: 2, profileId: "p", profileName: "n", updatedAt: new Date().toISOString(), rankings: [makeRanking({ kind: "music", items })] };
    const parsed = parseProfile(profile);
    expect(parsed.rankings[0].items).toEqual(items);
  });

  it("posterUrls 与未知字段仍然进不去库", () => {
    expect(toRankedItems([{ id: "a", title: "A", rank: 1, posterUrls: ["https://x/1.jpg"], cacheKey: "k" }]))
      .toEqual([{ id: "a", title: "A", rank: 1 }]);
  });
});

/** readProfile 用的最小 Storage 替身。 */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
  } as Storage;
}

describe("readProfile 绝不删除用户数据", () => {
  const broken = "{ 这不是 JSON";

  it("解析失败时保留原值，只额外留一份备份", () => {
    const storage = memoryStorage({ [LIBRARY_KEY]: broken });
    expect(readProfile(storage)).toBeNull();
    expect(storage.getItem(LIBRARY_KEY)).toBe(broken);   // 旧版本会在这里 removeItem
    expect(storage.getItem(RECOVERY_KEY)).toBe(broken);
  });

  it("主键缺失时从备份恢复，并把主键写回", () => {
    const profile = { version: 2, profileId: "p", profileName: "n", updatedAt: new Date().toISOString(), rankings: [makeRanking()] };
    const storage = memoryStorage({ [RECOVERY_KEY]: JSON.stringify(profile) });
    const restored = readProfile(storage);
    expect(restored?.rankings).toHaveLength(1);
    expect(storage.getItem(LIBRARY_KEY)).toBe(JSON.stringify(profile));
  });

  it("备份也读不回来时安静返回，不抛错、不改动存储", () => {
    const storage = memoryStorage({ [RECOVERY_KEY]: broken });
    expect(readProfile(storage)).toBeNull();
    expect(storage.getItem(RECOVERY_KEY)).toBe(broken);
  });

  it("坏主键不会覆盖已有的好备份", () => {
    const profile = { version: 2, profileId: "p", profileName: "n", updatedAt: new Date().toISOString(), rankings: [makeRanking()] };
    const goodBackup = JSON.stringify(profile);
    const storage = memoryStorage({ [LIBRARY_KEY]: broken, [RECOVERY_KEY]: goodBackup });
    // 主键读不回来 → 用备份兜底；坏主键原地保留，也不会把好备份顶掉。
    expect(readProfile(storage)?.rankings).toHaveLength(1);
    expect(storage.getItem(RECOVERY_KEY)).toBe(goodBackup);
    expect(storage.getItem(LIBRARY_KEY)).toBe(broken);
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

  it("gives 100% order agreement for identical multi-list profiles with merged rank ties", () => {
    // 两个榜单合并后会出现并列最优名次（两件作品同为第1），
    // 相同画像的顺序一致率必须仍是 100%（并列序对剔除）
    const build = () => [
      makeRanking({ collectionTitle: "榜A", items: [
        { id: "a", title: "作品A", rank: 1 },
        { id: "b", title: "作品B", rank: 2 },
        { id: "c", title: "作品C", rank: 3 },
      ] }),
      makeRanking({ collectionTitle: "榜B", items: [
        { id: "d", title: "作品D", rank: 1 },
        { id: "e", title: "作品E", rank: 2 },
      ] }),
    ];
    const ownMerged = mergeDimensionRankings(build())!;
    const peerMerged = mergeDimensionRankings(build())!;
    const result = compareDimensions(ownMerged, peerMerged);
    expect(result.orderAgreement).toBe(100);
  });

  it("keeps distinct tied works in onlyOwn instead of deduping by rank", () => {
    const own = mergeDimensionRankings([
      makeRanking({ collectionTitle: "榜A", items: [
        { id: "a", title: "作品A", rank: 1 },
        { id: "x", title: "作品X", rank: 2 },
      ] }),
      makeRanking({ collectionTitle: "榜B", items: [
        { id: "b", title: "作品B", rank: 1 },
        { id: "y", title: "作品Y", rank: 2 },
      ] }),
    ])!;
    const peer = mergeDimensionRankings([
      makeRanking({ collectionTitle: "对方榜", items: [{ id: "a-peer", title: "作品A", rank: 1 }] }),
    ])!;
    const result = compareDimensions(own, peer);
    expect(result.shared.map((item) => item.title)).toEqual(["作品A"]);
    expect(result.onlyOwn.map((item) => item.title).sort()).toEqual(["作品B", "作品X", "作品Y"]);
  });

  it("identical rankings score high on all new metrics", () => {
    const own = makeRanking();
    const result = compareRankings(own, makeRanking());
    expect(result.kendallTau).toBe(100);
    expect(result.topJaccard).toBe(100);
    expect(result.consensusScore).toBeGreaterThan(90);
  });

  it("reversed shared order yields low kendall tau", () => {
    const own = makeRanking({ items: [
      { id: "a", title: "A", rank: 1 },
      { id: "b", title: "B", rank: 2 },
      { id: "c", title: "C", rank: 3 },
    ] });
    const peer = makeRanking({ items: [
      { id: "x", title: "C", rank: 1 },
      { id: "y", title: "B", rank: 2 },
      { id: "z", title: "A", rank: 3 },
    ] });
    const result = compareRankings(own, peer);
    expect(result.kendallTau).toBe(0);
    expect(result.consensusScore).toBeLessThan(60);
  });

  it("era affinity reflects year gap", () => {
    const own = makeRanking({ items: [
      { id: "a", title: "A", rank: 1, year: 1994 },
      { id: "b", title: "B", rank: 2, year: 1994 },
    ] });
    const peerSame = makeRanking({ items: [
      { id: "x", title: "A", rank: 1, year: 1994 },
      { id: "y", title: "B", rank: 2, year: 1994 },
    ] });
    expect(compareRankings(own, peerSame).eraAffinity).toBe(100);
    const peerFar = makeRanking({ items: [
      { id: "x", title: "A", rank: 1, year: 2024 },
      { id: "y", title: "B", rank: 2, year: 2024 },
    ] });
    expect(compareRankings(own, peerFar).eraAffinity!).toBeLessThan(100);
    // 无年份 → null
    const noYear = makeRanking({ items: [{ id: "a", title: "A", rank: 1 }, { id: "b", title: "B", rank: 2 }] });
    expect(compareRankings(noYear, makeRanking({ items: [{ id: "x", title: "A", rank: 1 }, { id: "y", title: "B", rank: 2 }] })).eraAffinity).toBeNull();
  });

  it("zero overlap: kendall null, consensus 0", () => {
    const own = makeRanking({ items: [{ id: "a", title: "独有A", rank: 1 }, { id: "b", title: "独有B", rank: 2 }] });
    const peer = makeRanking({ items: [{ id: "x", title: "独有X", rank: 1 }, { id: "y", title: "独有Y", rank: 2 }] });
    const result = compareRankings(own, peer);
    expect(result.kendallTau).toBeNull();
    expect(result.consensusScore).toBe(0);
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
