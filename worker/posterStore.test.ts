import { describe, expect, it } from "vitest";
import { loadPosterUrls, mediaTypeForKind, normalizePosterItem, normalizeYear, posterKeyFor, resolveStoredPosterUrls, saveResolvedPosters } from "./posterStore";

/**
 * 这些测试钉住的是一类具体的回归：同一条作品的海报地址，在「单条查询」
 * 「批量查询」「读取时挂载」三处必须推导出**同一个键**。本轮线上事故
 * （150 首歌单大部分无海报）正是这类不一致的后果，所以键的等价性要能自动验证。
 */

describe("mediaTypeForKind", () => {
  it("把前端 kind 映射成上游 type", () => {
    expect(mediaTypeForKind("film")).toBe("movie");
    expect(mediaTypeForKind("book")).toBe("book");
    expect(mediaTypeForKind("music")).toBe("music");
  });

  it("other / 未知媒介不解析海报", () => {
    expect(mediaTypeForKind("other")).toBeNull();
    expect(mediaTypeForKind(undefined)).toBeNull();
    expect(mediaTypeForKind("tv")).toBeNull();
  });
});

describe("normalizeYear", () => {
  it("接受数字与四位字符串", () => {
    expect(normalizeYear(1994)).toBe(1994);
    expect(normalizeYear("1994")).toBe(1994);
    expect(normalizeYear(" 2003 ")).toBe(2003);
  });

  it("拒绝越界与非年份", () => {
    expect(normalizeYear(1799)).toBeUndefined();
    expect(normalizeYear(2201)).toBeUndefined();
    expect(normalizeYear("19")).toBeUndefined();
    expect(normalizeYear("2019-2020")).toBeUndefined();
    expect(normalizeYear(null)).toBeUndefined();
    expect(normalizeYear(1994.5)).toBeUndefined();
  });
});

describe("normalizePosterItem", () => {
  it("丢弃脏数据而不是让整批失败", () => {
    expect(normalizePosterItem({ title: "", type: "music" })).toBeNull();
    expect(normalizePosterItem({ title: "   ", type: "music" })).toBeNull();
    expect(normalizePosterItem({ title: "x".repeat(161), type: "music" })).toBeNull();
    expect(normalizePosterItem({ title: "bad\u0000name", type: "music" })).toBeNull();
    expect(normalizePosterItem({ title: "ok", type: "tv" })).toBeNull();
    expect(normalizePosterItem({ title: "ok" })).toBeNull();
  });

  it("保留合法条目", () => {
    expect(normalizePosterItem({ title: " 童话 ", english: " Fairy Tale ", year: "2005", type: "music" }))
      .toEqual({ title: "童话", english: "Fairy Tale", type: "music", year: 2005 });
  });
});

describe("posterKeyFor 的键等价性", () => {
  it("数字年份与字符串年份推出同一个键", () => {
    const numeric = posterKeyFor({ title: "T", english: "T", type: "movie", year: 1994 });
    const textual = posterKeyFor({ title: "T", english: "T", type: "movie", year: "1994" });
    expect(numeric).toBe(textual);
    expect(numeric).toBe("movie|t|t|1994");
  });

  it("大小写与全角差异被 NFKC/小写抹平", () => {
    expect(posterKeyFor({ title: "Ｌéon", english: "LÉON", type: "movie" }))
      .toBe(posterKeyFor({ title: "Léon", english: "léon", type: "movie" }));
  });

  it("缺年份的键尾为空", () => {
    expect(posterKeyFor({ title: "童话", english: "童话", type: "music" })).toBe("music|童话|童话|");
  });

  it("不合法条目没有键", () => {
    expect(posterKeyFor({ title: "", type: "music" })).toBeNull();
    expect(posterKeyFor({ title: "ok", type: "tv" })).toBeNull();
  });
});

// 前端 Poster.tsx 发送的批量条目形状：english = subtitle ?? title。
function clientBatchItem(item: { title: string; subtitle?: string; year?: number | string }, kind: string) {
  const type = mediaTypeForKind(kind);
  return { title: item.title, english: item.subtitle ?? item.title, year: item.year, type };
}

describe("写入键与读取键一致", () => {
  it("读取时按 subtitle ?? title 推导的键，与前端发送的条目一致", () => {
    const cases = [
      { kind: "music", item: { title: "童话", year: 2005 } },
      { kind: "music", item: { title: "Right Here Waiting", subtitle: "此情可待", year: "1989" } },
      { kind: "film", item: { title: "这个杀手不太冷", subtitle: "Léon", year: 1994 } },
      { kind: "book", item: { title: "活着", year: 1993 } },
    ];
    for (const { kind, item } of cases) {
      const type = mediaTypeForKind(kind)!;
      const readKey = posterKeyFor({ title: item.title, english: item.subtitle ?? item.title, type, year: item.year });
      const sent = clientBatchItem(item, kind);
      const sentKey = posterKeyFor({ title: sent.title, english: sent.english, type: sent.type, year: sent.year });
      expect(readKey).not.toBeNull();
      expect(readKey).toBe(sentKey);
    }
  });

  it("空串 subtitle 按空串参与键（?? 不拦空串），读写两侧用的是同一个表达式", () => {
    const subtitle = "";
    // 前端 Poster.tsx 与 resolveStoredPosterUrls 都写作 `subtitle ?? title`
    const english = subtitle ?? "童话";
    expect(english).toBe("");
    expect(posterKeyFor({ title: "童话", english, type: "music" })).toBe("music|童话||");
  });
});

// 极简 D1 替身：只实现 posterStore 用到的那条链路。
function fakeDb(rows: Array<{ media_key: string; urls: string }>, onWrite?: (sql: string, args: unknown[]) => void): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            all: async () => ({ results: rows.filter((row) => args.includes(row.media_key)) }),
            run: async () => { onWrite?.(sql, args); return { success: true }; },
          };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

describe("resolveStoredPosterUrls（旁路数组，按位置对齐）", () => {
  const urls = ["https://img9.doubanio.com/view/photo/l/public/p1.webp"];
  const key = "music|童话|童话|";
  const db = fakeDb([{ media_key: key, urls: JSON.stringify(urls) }]);

  it("命中时给出地址，未命中给 null，且长度与入参等长", async () => {
    const items = [{ title: "童话" }, { title: "没存过的歌" }];
    const resolved = await resolveStoredPosterUrls(db, "music", items);
    expect(resolved).toHaveLength(items.length);
    expect(resolved[0]).toEqual(urls);
    expect(resolved[1]).toBeNull();
  });

  it("**不**注入条目对象——这是 512KB 故障复发的结构性入口", async () => {
    const items = [{ title: "童话" }];
    await resolveStoredPosterUrls(db, "music", items);
    expect(items[0]).not.toHaveProperty("posterUrls");
  });

  it("条目自带的 posterUrls 不参与判定（读取端已不再关心它）", async () => {
    const resolved = await resolveStoredPosterUrls(db, "music", [{ title: "童话" }]);
    expect(resolved[0]).toEqual(urls);
  });

  it("other 媒介与无 DB 时返回等长的全 null 数组", async () => {
    const items = [{ title: "童话" }];
    expect(await resolveStoredPosterUrls(db, "other", items)).toEqual([null]);
    expect(await resolveStoredPosterUrls(undefined, "music", items)).toEqual([null]);
  });

  it("空入参返回空数组", async () => {
    expect(await resolveStoredPosterUrls(db, "music", [])).toEqual([]);
  });

  it("坏 JSON 行被忽略而不是抛错", async () => {
    const broken = fakeDb([{ media_key: key, urls: "{not json" }]);
    expect(await resolveStoredPosterUrls(broken, "music", [{ title: "童话" }])).toEqual([null]);
  });
});

describe("loadPosterUrls（Phase 1 先查库用）", () => {
  const db = fakeDb([
    { media_key: "music|a|a|", urls: JSON.stringify(["https://x/1.webp"]) },
    { media_key: "music|b|b|", urls: JSON.stringify(["https://x/2.webp"]) },
  ]);

  it("只返回命中的键", async () => {
    const found = await loadPosterUrls(db, ["music|a|a|", "music|c|c|"]);
    expect([...found.keys()]).toEqual(["music|a|a|"]);
  });

  it("缺表/无 DB 时返回空 map 而不是抛错（退化为旧行为）", async () => {
    const failing = { prepare() { throw new Error("no such table: poster_urls"); } } as unknown as D1Database;
    await expect(loadPosterUrls(failing, ["music|a|a|"])).resolves.toEqual(new Map());
  });
});

describe("saveResolvedPosters", () => {
  it("空结果不落库，且同键去重", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = fakeDb([], (sql, args) => writes.push({ sql, args }));
    await saveResolvedPosters(db, [
      { key: "music|a|a|", urls: [] },
      { key: "music|b|b|", urls: ["https://x/1.webp"] },
      { key: "music|b|b|", urls: ["https://x/2.webp"] },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0].args[0]).toBe("music|b|b|");
    // 去重时后写的胜出
    expect(writes[0].args[1]).toBe(JSON.stringify(["https://x/2.webp"]));
  });

  it("缺表/无 DB 时不抛错，不影响主流程", async () => {
    await expect(saveResolvedPosters(undefined, [{ key: "k", urls: ["u"] }])).resolves.toBeUndefined();
    const failing = { prepare() { throw new Error("no such table: poster_urls"); } } as unknown as D1Database;
    await expect(saveResolvedPosters(failing, [{ key: "k", urls: ["u"] }])).resolves.toBeUndefined();
  });
});
