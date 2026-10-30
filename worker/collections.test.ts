import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { accountRoute } from "./account";
import type { Env } from "./index";

/**
 * 云端清单「同名即同一份」（P0 修复的回归绊线）。
 *
 * 过去 POST /api/account/collections 是纯 INSERT，前端每次「保存清单」都发一次，
 * 于是每点一次就多一条同名副本。修复靠 0029 的唯一索引 + UPSERT，本文件用真实
 * node:sqlite 锁死三件事：
 *   1. 同 (user_id, kind, title) 再保存是覆盖（同 id、条数更新），不是新增；
 *   2. 不同标题仍各自成行；
 *   3. 0029 迁移能把历史重复行收敛成最新一条，并真的建出唯一约束。
 */

// Vitest 内嵌 Vite 不识别 node:sqlite 内置模块，经 createRequire 直连 Node 解析器。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

type Raw = InstanceType<typeof DatabaseSync>;

const MIGRATION_0029 = new URL(
  "../migrations/0029_user_collections_title_unique.sql",
  import.meta.url,
);

/** 0029 迁移前的表结构（0008 建表 + 0021 放宽上限），刻意不带唯一索引。 */
function legacySchema(raw: Raw): void {
  raw.exec(`
    CREATE TABLE user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      disabled_at TEXT
    );
    CREATE TABLE user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES user_accounts(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE user_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES user_accounts(id),
      kind TEXT NOT NULL CHECK (kind IN ('film', 'book', 'music', 'other')),
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
      description TEXT NOT NULL DEFAULT '',
      items TEXT NOT NULL CHECK (json_valid(items) AND length(items) <= 524288),
      item_count INTEGER NOT NULL CHECK (item_count BETWEEN 2 AND 1000),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE INDEX idx_user_collections_user_updated
      ON user_collections(user_id, updated_at DESC);
  `);
}

function d1FromSqlite(): { d1: D1Database; raw: Raw } {
  const raw = new DatabaseSync(":memory:");
  legacySchema(raw);
  // 路由测试跑的是「迁移已应用」的生产形状：UPSERT 依赖 0029 的唯一索引。
  raw.exec(readFileSync(MIGRATION_0029, "utf8"));

  const runStatement = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    return {
      first: async () => stmt.get(...(args as never[])) ?? null,
      all: async () => ({ results: stmt.all(...(args as never[])) }),
      run: async () => {
        const info = stmt.run(...(args as never[]));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    };
  };
  const d1 = {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => runStatement(sql, args),
        first: async () => runStatement(sql, []).first(),
        all: async () => runStatement(sql, []).all(),
        run: async () => runStatement(sql, []).run(),
      };
    },
  } as unknown as D1Database;
  return { d1, raw };
}

const TOKEN = "t".repeat(64);

function seedUser(raw: Raw): number {
  raw
    .prepare("INSERT INTO user_accounts (email, password_hash) VALUES ('u@example.com', 'x')")
    .run();
  const userId = Number(
    (
      raw.prepare("SELECT id FROM user_accounts WHERE email = 'u@example.com'").get() as {
        id: number;
      }
    ).id,
  );
  raw
    .prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .run(TOKEN, userId, new Date(Date.now() + 3_600_000).toISOString());
  return userId;
}

function saveRequest(body: unknown): Request {
  return new Request("https://sort.logicc.top/api/account/collections", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const works = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: `作品 ${i + 1}`, year: 2000 + i }));

describe("POST /api/account/collections —— 同名覆盖而非新增", () => {
  it("同一 (kind, title) 再保存返回同一 id，并更新条数", async () => {
    const { d1, raw } = d1FromSqlite();
    seedUser(raw);
    const env = { DB: d1 } as unknown as Env;

    const first = await accountRoute(
      saveRequest({ kind: "film", title: "我的电影清单", description: "", items: works(2) }),
      env,
    );
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: number; created: boolean };
    expect(created.created).toBe(true);

    const second = await accountRoute(
      saveRequest({ kind: "film", title: "我的电影清单", description: "", items: works(5) }),
      env,
    );
    expect(second.status).toBe(200);
    const overwritten = (await second.json()) as { id: number; created: boolean };
    expect(overwritten.created).toBe(false);
    expect(overwritten.id).toBe(created.id);

    const rows = raw
      .prepare("SELECT id, item_count FROM user_collections WHERE user_id = 1")
      .all() as Array<{ id: number; item_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: created.id, item_count: 5 });
  });

  it("不同标题 / 不同媒介各自成行", async () => {
    const { d1, raw } = d1FromSqlite();
    seedUser(raw);
    const env = { DB: d1 } as unknown as Env;

    await accountRoute(saveRequest({ kind: "film", title: "A", items: works(2) }), env);
    await accountRoute(saveRequest({ kind: "film", title: "B", items: works(2) }), env);
    await accountRoute(saveRequest({ kind: "book", title: "A", items: works(2) }), env);

    const count = raw.prepare("SELECT COUNT(*) AS c FROM user_collections").get() as { c: number };
    expect(count.c).toBe(3);
  });

  it("1 件作品的清单被拒（与服务端下限、DB CHECK 同口径）", async () => {
    const { d1, raw } = d1FromSqlite();
    seedUser(raw);
    const env = { DB: d1 } as unknown as Env;

    const response = await accountRoute(
      saveRequest({ kind: "film", title: "只有一件", items: works(1) }),
      env,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_collection");
    const count = raw.prepare("SELECT COUNT(*) AS c FROM user_collections").get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe("migration 0029 —— 历史去重 + 唯一索引", () => {
  it("保留 id 最大的一条，重放安全，唯一约束生效", () => {
    const raw = new DatabaseSync(":memory:");
    legacySchema(raw);
    const userId = seedUser(raw);
    const insert = raw.prepare(
      "INSERT INTO user_collections (user_id, kind, title, items, item_count) VALUES (?, 'film', '同名', ?, 2)",
    );
    const items = JSON.stringify(works(2));
    insert.run(userId, items);
    insert.run(userId, items);
    insert.run(userId, items);
    const before = raw.prepare("SELECT id FROM user_collections ORDER BY id").all() as Array<{
      id: number;
    }>;
    expect(before).toHaveLength(3);

    const sql = readFileSync(MIGRATION_0029, "utf8");
    raw.exec(sql);
    // 重放（失败重试会重放整个文件）：必须不抛错，且结果不变。
    raw.exec(sql);

    const after = raw.prepare("SELECT id FROM user_collections").all() as Array<{ id: number }>;
    expect(after).toEqual([{ id: before[before.length - 1].id }]);

    expect(() =>
      raw
        .prepare(
          "INSERT INTO user_collections (user_id, kind, title, items, item_count) VALUES (?, 'film', '同名', ?, 2)",
        )
        .run(userId, items),
    ).toThrow(/UNIQUE/i);
  });
});
