import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./index";
import { importRoute, seedImportedPosterUrls, type ImportedWork } from "./import";
import { posterKeyFor } from "./posterStore";

/**
 * 导入时把封面顺带写进 `poster_urls` 侧表。
 *
 * 为什么值得钉住：导入是唯一「封面地址免费到手」的时刻（地址随列表一起返回，不需回源）。
 * 落库后同一件作品出现在榜单 / 广场 / 分享 / 单条查询里都会先命中侧表 → 零回源、
 * 封面稳定、跨用户共享。而**键必须与客户端之后发来的批量请求逐字一致**，否则
 * 写进去的行永远取不到（这正是过去"存了但取不到"那类事故的形态），所以这里
 * 直接对着 `posterKeyFor`（服务端唯一键推导）断言。
 */

const captures: Array<{ sql: string; args: unknown[] }> = [];

/**
 * 极简 D1 替身。注意 `prepare()` 之后**不 bind 也能 first()**：
 * vaultKeys() 就是这么读 admin_config 的。
 */
function statement(
  sql: string,
  options: { user?: { id: number; email: string } | null },
  args: unknown[],
) {
  return {
    first: async () => {
      if (/FROM user_sessions/.test(sql)) return options.user ?? null;
      return null; // admin_config / user_cookie_vault 都没有行
    },
    all: async () => ({ results: [] }),
    run: async () => {
      captures.push({ sql, args });
      return { success: true, meta: {} };
    },
    bind: (...bound: unknown[]) => statement(sql, options, bound),
  };
}

function fakeDb(options: { user?: { id: number; email: string } | null } = {}): D1Database {
  return {
    prepare: (sql: string) => statement(sql, options, []),
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((entry) => entry.run()));
    },
  } as unknown as D1Database;
}

const env = (db: D1Database): Env => ({ DB: db }) as unknown as Env;

/** 取出写进 poster_urls 的行。 */
function seededRows(): Array<{ key: string; urls: string[] }> {
  return captures
    .filter(({ sql }) => /INSERT INTO poster_urls/.test(sql))
    .map(({ args }) => ({ key: String(args[0]), urls: JSON.parse(String(args[1])) as string[] }));
}

const TOKEN = "t".repeat(40);
const auth = { authorization: `Bearer ${TOKEN}` };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  captures.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("seedImportedPosterUrls（共用实现）", () => {
  it("音乐：网易云封面按 type|title|title| 落库", async () => {
    await seedImportedPosterUrls(env(fakeDb()), [
      {
        id: "netease-1",
        title: "童话",
        creator: "光良",
        type: "music",
        poster_url: "https://p2.music.126.net/abc==/1.jpg",
      },
    ]);
    expect(seededRows()).toEqual([
      { key: "music|童话|童话|", urls: ["https://p2.music.126.net/abc==/1.jpg"] },
    ]);
  });

  it("电影 / 书籍：键里带上年份，与客户端发送的键一致", async () => {
    const works: ImportedWork[] = [
      {
        id: "d1",
        title: "霸王别姬",
        year: 1993,
        type: "movie",
        poster_url: "https://img1.doubanio.com/view/subject/m/public/s1.jpg",
      },
      {
        id: "d2",
        title: "活着",
        year: 1993,
        type: "book",
        poster_url: "https://img3.doubanio.com/view/subject/m/public/s2.jpg",
      },
    ];
    await seedImportedPosterUrls(env(fakeDb()), works);
    expect(seededRows().map((row) => row.key)).toEqual([
      posterKeyFor({ title: "霸王别姬", english: "霸王别姬", type: "movie", year: 1993 }),
      posterKeyFor({ title: "活着", english: "活着", type: "book", year: 1993 }),
    ]);
  });

  it("http 封面统一升级为 https（与解析路径、代理白名单同一口径）", async () => {
    await seedImportedPosterUrls(env(fakeDb()), [
      { id: "n1", title: "后来", type: "music", poster_url: "http://p1.music.126.net/xyz==/2.jpg" },
    ]);
    expect(seededRows()[0].urls[0]).toBe("https://p1.music.126.net/xyz==/2.jpg");
  });

  it("丢弃不可用地址：非白名单主机、空值、豆瓣静态占位图", async () => {
    await seedImportedPosterUrls(env(fakeDb()), [
      { id: "a", title: "A", type: "movie", poster_url: "https://evil.example.com/a.jpg" },
      { id: "b", title: "B", type: "movie", poster_url: "" },
      { id: "c", title: "C", type: "movie", poster_url: undefined },
      // 豆瓣"没有封面"时用的站内占位图：写进去会让所有用户看到假封面
      {
        id: "d",
        title: "D",
        type: "movie",
        poster_url: "https://img1.doubanio.com/f/shire/abc.jpg",
      },
      {
        id: "e",
        title: "E",
        type: "movie",
        poster_url: "https://img1.doubanio.com/view/subject/m/public/ok.jpg",
      },
    ]);
    expect(seededRows()).toHaveLength(1);
    expect(seededRows()[0].key).toBe("movie|e|e|");
  });

  it("缺 type 时用清单媒介兜底；仍然缺 type 就跳过（避免写下永远取不到的键）", async () => {
    await seedImportedPosterUrls(
      env(fakeDb()),
      [
        {
          id: "a",
          title: "无类型",
          poster_url: "https://img1.doubanio.com/view/subject/m/public/a.jpg",
        },
      ],
      "book",
    );
    expect(seededRows().map((row) => row.key)).toEqual(["book|无类型|无类型|"]);

    captures.length = 0;
    await seedImportedPosterUrls(env(fakeDb()), [
      {
        id: "b",
        title: "无类型也没兜底",
        poster_url: "https://img1.doubanio.com/view/subject/m/public/b.jpg",
      },
    ]);
    expect(seededRows()).toHaveLength(0);
  });

  it("无 DB / 空清单时安静返回", async () => {
    await expect(
      seedImportedPosterUrls(env(undefined as unknown as D1Database), []),
    ).resolves.toBeUndefined();
    await expect(seedImportedPosterUrls(env(fakeDb()), [])).resolves.toBeUndefined();
    expect(seededRows()).toHaveLength(0);
  });
});

describe("三条导入路径都接上了种子化", () => {
  it("网易云歌单（音乐）", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "music.163.com" && url.pathname.includes("playlist/detail")) {
        return json({ playlist: { trackIds: [{ id: 111 }], tracks: [], trackCount: 1 } });
      }
      if (url.hostname === "music.163.com" && url.pathname.includes("song/detail")) {
        return json({
          songs: [
            {
              id: 111,
              name: "童话",
              ar: [{ name: "光良" }],
              al: { picUrl: "https://p2.music.126.net/x==/3.jpg" },
            },
          ],
        });
      }
      return json({}, 502);
    });

    const response = await importRoute(
      new Request("https://example.com/api/import/netease?url=123456", { headers: auth }),
      env(fakeDb({ user: { id: 1, email: "a@b.c" } })),
    );
    expect(response.status).toBe(200);
    expect(seededRows()).toEqual([
      { key: "music|童话|童话|", urls: ["https://p2.music.126.net/x==/3.jpg"] },
    ]);
  });

  it("豆瓣书影音清单（电影/书籍，rexxar JSON 接口）", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "m.douban.com") {
        return json({
          total: 1,
          subject_collection_items: [
            {
              id: "1291546",
              title: "霸王别姬",
              year: "1993",
              type: "movie",
              info: "陈凯歌 / 1993",
              cover: { large: "https://img1.doubanio.com/view/subject/l/public/s1.jpg" },
            },
            {
              id: "1084336",
              title: "活着",
              year: "1993",
              type: "book",
              info: "余华 / 1993",
              cover: { large: "https://img3.doubanio.com/view/subject/l/public/s2.jpg" },
            },
          ],
        });
      }
      return json({}, 502);
    });

    const response = await importRoute(
      new Request(
        "https://example.com/api/import/douban-list?url=https%3A%2F%2Fm.douban.com%2Fsubject_collection%2Fmovie_top250%2F",
        { headers: auth },
      ),
      env(fakeDb({ user: { id: 1, email: "a@b.c" } })),
    );
    expect(response.status).toBe(200);
    expect(seededRows().map((row) => row.key)).toEqual([
      "movie|霸王别姬|霸王别姬|1993",
      "book|活着|活着|1993",
    ]);
  });

  it("响应体形状不变：种子化不改变客户端看到的 works", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname === "m.douban.com") {
        return json({
          total: 1,
          subject_collection_items: [
            {
              id: "1",
              title: "霸王别姬",
              year: "1993",
              type: "movie",
              cover: { large: "https://img1.doubanio.com/view/subject/l/public/s1.jpg" },
            },
          ],
        });
      }
      return json({}, 502);
    });

    const response = await importRoute(
      new Request(
        "https://example.com/api/import/douban-list?url=https%3A%2F%2Fm.douban.com%2Fsubject_collection%2Fmovie_top250%2F",
        { headers: auth },
      ),
      env(fakeDb({ user: { id: 1, email: "a@b.c" } })),
    );
    const body = (await response.json()) as { works: Array<Record<string, unknown>> };
    expect(body.works[0]).toMatchObject({
      title: "霸王别姬",
      poster_url: "https://img1.doubanio.com/view/subject/l/public/s1.jpg",
      type: "movie",
    });
    // 返回给客户端的仍是原始 poster_url（前端照旧内嵌展示），侧表只是额外收益。
    expect(body.works[0]).not.toHaveProperty("posterUrls");
  });
});
