import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { getUserFromToken } from "./account";

// Vitest 内嵌 Vite 不识别 node:sqlite 内置模块，经 createRequire 直连 Node 解析器。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

function d1FromSqlite(): { d1: D1Database; raw: InstanceType<typeof DatabaseSync> } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(
    "CREATE TABLE user_accounts (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT NOT NULL, disabled_at TEXT)",
  );
  raw.exec("CREATE TABLE user_sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires_at TEXT)");
  raw
    .prepare(
      "INSERT INTO user_accounts (id, email, password_hash) VALUES (1, 'u@example.com', 'x')",
    )
    .run();
  raw
    .prepare(
      "INSERT INTO user_accounts (id, email, password_hash, disabled_at) VALUES (2, 'd@example.com', 'x', datetime('now'))",
    )
    .run();

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

function requestFor(token: string): Request {
  return new Request("https://sort.logicc.top/api/account/me", {
    headers: { authorization: `Bearer ${token}` },
  });
}

const TOKEN_ISO_ALIVE = "a".repeat(64);
const TOKEN_ISO_EXPIRED = "b".repeat(64);
const TOKEN_SQL_ALIVE = "c".repeat(64);
const TOKEN_SQL_EXPIRED = "d".repeat(64);
const TOKEN_DISABLED = "e".repeat(64);

describe("getUserFromToken（会话过期的真实 SQL 语义）", () => {
  it("ISO 与 SQL 两种时间格式都按时间点比较，且禁用账号一律拒绝", async () => {
    const { d1, raw } = d1FromSqlite();
    const insert = raw.prepare(
      "INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
    );
    const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
    const insertSqlTime = raw.prepare(
      "INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, 1, datetime('now', ?))",
    );
    insert.run(TOKEN_ISO_ALIVE, 1, iso(24 * 60 * 60 * 1000));
    insert.run(TOKEN_ISO_EXPIRED, 1, iso(-1000));
    insertSqlTime.run(TOKEN_SQL_ALIVE, "+1 day");
    insertSqlTime.run(TOKEN_SQL_EXPIRED, "-1 second");
    insert.run(TOKEN_DISABLED, 2, iso(24 * 60 * 60 * 1000));

    await expect(getUserFromToken(requestFor(TOKEN_ISO_ALIVE), d1)).resolves.toMatchObject({
      id: 1,
      email: "u@example.com",
    });
    await expect(getUserFromToken(requestFor(TOKEN_SQL_ALIVE), d1)).resolves.toMatchObject({
      id: 1,
    });
    // 回归：ISO 过期时间曾被字符串比较拖到「次日才过期」。
    await expect(getUserFromToken(requestFor(TOKEN_ISO_EXPIRED), d1)).resolves.toBeNull();
    await expect(getUserFromToken(requestFor(TOKEN_SQL_EXPIRED), d1)).resolves.toBeNull();
    await expect(getUserFromToken(requestFor(TOKEN_DISABLED), d1)).resolves.toBeNull();
  });
});
