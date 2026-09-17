import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_BYTES,
  STORED_WORK_FIELDS,
  countStoredWorks,
  encodeStoredProfile,
  encodeStoredRankings,
  encodeStoredWorks,
  healStoredProfile,
  toStoredProfile,
  toStoredRanking,
  toStoredRankings,
  toStoredWork,
  toStoredWorks,
} from "./storedItem";

/**
 * 这些测试钉住的是 512KB 故障的**结构性**防线：
 * posterUrls 之所以进不了库，是因为它不在白名单里，而不是因为某处记得 delete。
 * 因此最关键的一条断言是「白名单里没有 posterUrls」以及「未知字段一律丢弃」——
 * 以后新增任何本地渲染字段都不会打破它。
 */

describe("白名单字段集", () => {
  it("posterUrls 永远不在字段集里（唯一的硬约束）", () => {
    expect(STORED_WORK_FIELDS).not.toContain("posterUrls");
    expect(STORED_WORK_FIELDS).not.toContain("poster_url");
    expect(toStoredWork({ title: "T", posterUrls: ["https://x/1.jpg"] })).toEqual({ title: "T" });
  });

  it("未知的本地渲染字段默认进不了库（不需要记得加护栏）", () => {
    const stored = toStoredWork({
      id: "a", title: "T", rank: 1,
      cacheKey: "k", thumbnail: "t", loading: true, posterUrls: ["https://x/1.jpg"], tags: ["x"],
    });
    expect(stored).toEqual({ id: "a", title: "T", rank: 1 });
  });
});

describe("toStoredWork", () => {
  it("保留全部合法字段，顺序与 parseRanking 原有字面量一致", () => {
    const stored = toStoredWork({ id: "i", title: " 活着 ", rank: 3, creator: "余华", year: 1993, subtitle: "To Live" });
    expect(Object.keys(stored!)).toEqual(["id", "title", "rank", "creator", "year", "subtitle"]);
    expect(stored).toEqual({ id: "i", title: "活着", rank: 3, creator: "余华", year: 1993, subtitle: "To Live" });
  });

  it("title 是唯一必填项：缺失/空/超长都返回 null", () => {
    expect(toStoredWork({})).toBeNull();
    expect(toStoredWork({ title: "" })).toBeNull();
    expect(toStoredWork({ title: "   " })).toBeNull();
    expect(toStoredWork({ title: "x".repeat(161) })).toBeNull();
    expect(toStoredWork(null)).toBeNull();
    expect(toStoredWork("字符串不是作品")).toBeNull();
    expect(toStoredWork(["数组不是作品"])).toBeNull();
  });

  it("rank 可选——「我的清单」的收藏项从来没有 rank", () => {
    expect(toStoredWork({ id: "custom-0", title: "A", year: 2000 })).toEqual({ id: "custom-0", title: "A", year: 2000 });
    expect(toStoredWork({ id: "a", title: "A", rank: 2 })).toEqual({ id: "a", title: "A", rank: 2 });
  });

  it("脏可选项按字段丢弃，而不是把整条作品打回", () => {
    expect(toStoredWork({ title: "A", year: 0 })).toEqual({ title: "A" });
    expect(toStoredWork({ title: "A", year: 2201 })).toEqual({ title: "A" });
    expect(toStoredWork({ title: "A", year: 1994.5 })).toEqual({ title: "A" });
    expect(toStoredWork({ title: "A", rank: 0 })).toEqual({ title: "A" });
    expect(toStoredWork({ title: "A", rank: 1.5 })).toEqual({ title: "A" });
    expect(toStoredWork({ title: "A", creator: "" })).toEqual({ title: "A" });
    expect(toStoredWork({ title: "A", id: "" })).toEqual({ title: "A" });
  });

  it("toStoredWorks 丢弃非法条目而不是让整批失败", () => {
    expect(toStoredWorks([{ title: "A" }, null, { title: "" }, "x", { title: "B", posterUrls: ["u"] }]))
      .toEqual([{ title: "A" }, { title: "B" }]);
    expect(toStoredWorks("不是数组")).toEqual([]);
  });
});

describe("toStoredRankings / toStoredProfile", () => {
  it("榜单元数据按白名单保留，items 逐层收敛", () => {
    const ranking = toStoredRanking({
      version: 1, profileId: "p", profileName: "n", kind: "film", collectionTitle: "c", createdAt: "2024-01-01T00:00:00Z",
      topN: 8, description: "本地字段",
      items: [{ id: "a", title: "A", rank: 1, posterUrls: ["https://x/1.jpg"] }],
    });
    expect(ranking).not.toBeNull();
    expect(Object.keys(ranking!)).toEqual(["version", "profileId", "profileName", "kind", "collectionTitle", "createdAt", "items"]);
    expect(ranking!.items).toEqual([{ id: "a", title: "A", rank: 1 }]);
  });

  it("没有 items 数组的榜单被判为非法并丢弃", () => {
    expect(toStoredRanking({ kind: "film" })).toBeNull();
    expect(toStoredRankings([{ kind: "film" }, { kind: "book", items: [{ title: "B", rank: 1 }] }]))
      .toEqual([{ kind: "book", items: [{ title: "B", rank: 1 }] }]);
  });

  it("画像顶层元数据走白名单，rankings[].items[] 逐层收敛", () => {
    const profile = toStoredProfile({
      version: 2, profileId: "p", profileName: "n", updatedAt: "2024-01-01T00:00:00Z",
      draft: { local: true },
      rankings: [{ version: 1, kind: "music", items: [{ id: "a", title: "A", rank: 1, posterUrls: ["u"] }] }],
    });
    expect(profile).not.toBeNull();
    expect(Object.keys(profile!)).toEqual(["version", "profileId", "profileName", "updatedAt", "rankings"]);
    expect(JSON.stringify(profile)).not.toContain("posterUrls");
  });

  it("v1 画像（本身就是一份榜单）不会被当成 v2 而丢掉整份榜单", () => {
    const v1 = {
      version: 1, profileId: "p", profileName: "n", kind: "music", collectionTitle: "c", createdAt: "2024-01-01T00:00:00Z",
      items: [{ id: "a", title: "A", rank: 1, posterUrls: ["u"] }],
    };
    const stored = toStoredProfile(v1);
    expect(stored).not.toBeNull();
    expect(Object.keys(stored!)).toEqual(["version", "profileId", "profileName", "kind", "collectionTitle", "createdAt", "items"]);
    expect((stored as { items: unknown[] }).items).toEqual([{ id: "a", title: "A", rank: 1 }]);
    expect(JSON.stringify(stored)).not.toContain("posterUrls");
  });

  it("非对象 / 认不出的形状返回 null", () => {
    expect(toStoredProfile(null)).toBeNull();
    expect(toStoredProfile("x")).toBeNull();
    expect(toStoredProfile({ version: 2, profileId: "p" })).toBeNull();
  });
});

describe("healStoredProfile（读取端自愈）", () => {
  it("清除旧行里残留的 posterUrls", () => {
    const healed = healStoredProfile({
      version: 2, profileId: "p", profileName: "n", updatedAt: "2024-01-01T00:00:00Z",
      rankings: [{ version: 1, kind: "film", items: [{ id: "a", title: "A", rank: 1, posterUrls: ["u"] }] }],
    });
    expect(JSON.stringify(healed)).not.toContain("posterUrls");
  });

  it("形状认不出来时原样透传——读取路径不能把用户数据读没了", () => {
    const weird = { 自定义: "结构" };
    expect(healStoredProfile(weird)).toBe(weird);
    expect(healStoredProfile(null)).toBeNull();
  });
});

describe("编码出口", () => {
  it("encodeStoredWorks 只在有内容时成功", () => {
    const ok = encodeStoredWorks([{ title: "A", posterUrls: ["u"] }, { title: "B", rank: 2 }]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.count).toBe(2);
    expect(JSON.parse(ok.json)).toEqual([{ title: "A" }, { title: "B", rank: 2 }]);
    expect(ok.json).not.toContain("posterUrls");
  });

  it("全部条目非法时返回 empty_payload，而不是默默写入空数组", () => {
    // 静默写入空数组意味着用户数据凭空消失且没有任何信号——必须让调用方返回 400。
    expect(encodeStoredWorks([])).toEqual({ ok: false, error: "empty_payload" });
    expect(encodeStoredWorks([{ posterUrls: ["u"] }, "x", null])).toEqual({ ok: false, error: "empty_payload" });
    expect(encodeStoredRankings([{ kind: "film" }])).toEqual({ ok: false, error: "empty_payload" });
  });

  it("超限返回 payload_too_large", () => {
    const works = Array.from({ length: 40 }, (_, i) => ({ id: `id-${i}`, title: "标题".repeat(20), rank: i + 1 }));
    expect(encodeStoredWorks(works, 256)).toEqual({ ok: false, error: "payload_too_large" });
    expect(encodeStoredWorks(works, MAX_PAYLOAD_BYTES).ok).toBe(true);
  });

  it("体积按 UTF-8 **字节**判定，中文不会被低估 3 倍", () => {
    // 单条中文标题 JSON 的码元长度远小于字节长度；用 raw.length 判定的实现会在这里放过。
    const works = [{ title: "中".repeat(100) }];
    const json = JSON.stringify(works);
    expect(json.length).toBeLessThan(new TextEncoder().encode(json).byteLength);
    const limit = new TextEncoder().encode(json).byteLength - 1;
    expect(encodeStoredWorks(works, limit)).toEqual({ ok: false, error: "payload_too_large" });
    expect(encodeStoredWorks(works, limit + 1).ok).toBe(true);
  });

  it("count 是作品总数：profile 帖的 item_count 不能用榜单个数", () => {
    const rankings = [
      { kind: "film", items: [{ title: "A", rank: 1 }, { title: "B", rank: 2 }] },
      { kind: "book", items: [{ title: "C", rank: 1 }] },
    ];
    const encoded = encodeStoredRankings(rankings);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.count).toBe(3);
    expect(countStoredWorks(rankings.map((r) => toStoredRanking(r)!))).toBe(3);

    const profile = encodeStoredProfile({ version: 2, profileId: "p", profileName: "n", updatedAt: "2024-01-01T00:00:00Z", rankings });
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;
    expect(profile.count).toBe(3);
  });
});
