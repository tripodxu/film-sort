import { describe, expect, it } from "vitest";
import type { Env } from "./index";
import { plazaRoute } from "./plaza";

/**
 * 端到端钉住 512KB 故障的复发链（docs/PLAN-poster-pipeline.md §4.3）：
 *
 *   attachStoredPosterUrls 注回 post.items
 *     → PlazaPostView 展开 post.items 进编辑态
 *     → PUT /api/plaza/posts/:id 把海报地址写回库
 *
 * 两侧都要有护栏，缺一不可：
 *   GET  只把海报地址放进**旁路数组**，且库里残留的旧 posterUrls 读出来即干净；
 *   PUT  白名单编码器让 posterUrls 即使被提交上来也进不了库。
 * 这两条断言就是「结构性保证」的验收条件。
 */

const LEGACY_URL = "https://img9.doubanio.com/view/photo/l/public/p1.webp";

interface FakeDbOptions {
  post?: Record<string, unknown> | null;
  user?: { id: number; email: string } | null;
  posterRows?: Array<{ media_key: string; urls: string }>;
  writes?: Array<{ sql: string; args: unknown[] }>;
}

function fakeDb(options: FakeDbOptions): D1Database {
  const writes = options.writes ?? [];
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (/FROM user_sessions/.test(sql)) return options.user ?? null;
              if (/SELECT user_id, post_type FROM plaza_posts/.test(sql)) {
                return options.post
                  ? { user_id: options.post.user_id, post_type: options.post.post_type }
                  : null;
              }
              if (/FROM plaza_posts p/.test(sql)) return options.post ?? null;
              return null;
            },
            all: async () => {
              if (/FROM poster_urls/.test(sql)) return { results: options.posterRows ?? [] };
              return { results: [] };
            },
            run: async () => {
              writes.push({ sql, args });
              return { success: true, meta: { last_row_id: 1 } };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
}

const env = (db: D1Database): Env => ({ DB: db }) as unknown as Env;

describe("GET /api/plaza/posts/:id —— 海报地址走旁路，不再注入 items", () => {
  it("条目的 posterUrls 不会出现在 post.items 里", async () => {
    const post = {
      id: 32,
      user_id: 1,
      post_type: "ranking",
      kind: "music",
      is_public: 1,
      items: JSON.stringify([{ id: "a", title: "童话", rank: 1 }]),
    };
    const db = fakeDb({
      post,
      posterRows: [{ media_key: "music|童话|童话|", urls: JSON.stringify([LEGACY_URL]) }],
    });
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts/32"),
      env(db),
    );
    const body = (await response.json()) as {
      post: { items: Array<Record<string, unknown>> };
      posterUrls: Array<string[] | null>;
    };

    expect(body.post.items).toEqual([{ id: "a", title: "童话", rank: 1 }]);
    expect(body.post.items[0]).not.toHaveProperty("posterUrls");
    // 已落库的地址仍然能到达前端，只是走旁路数组。
    expect(body.posterUrls).toEqual([[LEGACY_URL]]);
  });

  it("库里残留 posterUrls 的旧行读出来即干净（读取端自愈，无需迁移脚本）", async () => {
    const post = {
      id: 32,
      user_id: 1,
      post_type: "ranking",
      kind: "music",
      is_public: 1,
      items: JSON.stringify([
        { id: "a", title: "童话", rank: 1, posterUrls: [LEGACY_URL], cacheKey: "本地字段" },
      ]),
    };
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts/32"),
      env(fakeDb({ post })),
    );
    const body = (await response.json()) as { post: { items: Array<Record<string, unknown>> } };

    expect(body.post.items).toEqual([{ id: "a", title: "童话", rank: 1 }]);
    expect(JSON.stringify(body.post)).not.toContain("posterUrls");
    expect(JSON.stringify(body.post)).not.toContain("cacheKey");
  });

  it("profile 帖的 items 是榜单数组，按榜单白名单收敛", async () => {
    const post = {
      id: 7,
      user_id: 1,
      post_type: "profile",
      kind: null,
      is_public: 1,
      items: JSON.stringify([
        {
          version: 1,
          kind: "film",
          collectionTitle: "c",
          createdAt: "2024-01-01T00:00:00Z",
          items: [{ id: "a", title: "A", rank: 1, posterUrls: [LEGACY_URL] }],
        },
      ]),
    };
    const response = await plazaRoute(
      new Request("https://example.com/api/plaza/posts/7"),
      env(fakeDb({ post })),
    );
    const body = (await response.json()) as {
      post: { items: Array<{ items: Array<Record<string, unknown>> }> };
      posterUrls: unknown[];
    };

    expect(body.post.items[0].items).toEqual([{ id: "a", title: "A", rank: 1 }]);
    expect(body.posterUrls).toEqual([]);
  });
});

describe("PUT /api/plaza/posts/:id —— 编辑帖子不可能把海报地址写回库", () => {
  const token = "t".repeat(40);

  it("body.items 里夹带 posterUrls 也会被白名单剔除", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = fakeDb({
      user: { id: 1, email: "a@b.c" },
      post: { user_id: 1, post_type: "ranking" },
      writes,
    });
    const request = new Request("https://example.com/api/plaza/posts/32", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        items: [
          { id: "a", title: "童话", rank: 1, posterUrls: [LEGACY_URL], cacheKey: "本地字段" },
          { id: "b", title: "此情可待", rank: 2, posterUrls: [LEGACY_URL] },
        ],
      }),
    });
    const response = await plazaRoute(request, env(db));
    expect(response.status).toBe(200);

    const update = writes.find((write) => /UPDATE plaza_posts/.test(write.sql));
    expect(update).toBeDefined();
    // 绑定顺序：post_type, kind, collection_title, description, items, notes, item_count, is_public, id
    const itemsJson = String(update!.args[4]);
    expect(itemsJson).not.toContain("posterUrls");
    expect(itemsJson).not.toContain("cacheKey");
    expect(JSON.parse(itemsJson)).toEqual([
      { id: "a", title: "童话", rank: 1 },
      { id: "b", title: "此情可待", rank: 2 },
    ]);
    expect(update!.args[6]).toBe(2);
  });

  it("全部条目非法时返回 400，而不是把 items 写成空数组", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = fakeDb({
      user: { id: 1, email: "a@b.c" },
      post: { user_id: 1, post_type: "ranking" },
      writes,
    });
    const request = new Request("https://example.com/api/plaza/posts/32", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ items: [{ posterUrls: [LEGACY_URL] }] }),
    });
    const response = await plazaRoute(request, env(db));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_items" });
    expect(writes.some((write) => /UPDATE plaza_posts/.test(write.sql))).toBe(false);
  });

  it("POST /api/plaza/posts 的 ranking / profile 两种形状都不会漏掉海报地址", async () => {
    for (const [postType, items] of [
      ["ranking", [{ id: "a", title: "A", rank: 1, posterUrls: [LEGACY_URL] }]],
      [
        "profile",
        [
          {
            version: 1,
            kind: "film",
            collectionTitle: "c",
            items: [{ id: "a", title: "A", rank: 1, posterUrls: [LEGACY_URL] }],
          },
        ],
      ],
    ] as const) {
      const writes: Array<{ sql: string; args: unknown[] }> = [];
      const db = fakeDb({ user: { id: 1, email: "a@b.c" }, writes });
      const request = new Request("https://example.com/api/plaza/posts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          post_type: postType,
          kind: postType === "profile" ? null : "music",
          collection_title: "c",
          items,
        }),
      });
      const response = await plazaRoute(request, env(db));
      expect(response.status, `${postType} 应当被接受`).toBe(201);
      const insert = writes.find((write) => /INSERT INTO plaza_posts/.test(write.sql));
      expect(insert).toBeDefined();
      // 绑定顺序：user_id, post_type, kind, collection_title, description, items, notes, item_count, is_public
      expect(String(insert!.args[5])).not.toContain("posterUrls");
      expect(insert!.args[7]).toBe(1);
    }
  });
});
