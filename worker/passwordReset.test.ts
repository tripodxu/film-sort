import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetPasswordWithCode } from "./account";
import { sha256Hex } from "./verification";

// Vitest 内嵌 Vite 不识别 node:sqlite 内置模块，经 createRequire 直连 Node 解析器。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

const EMAIL = "reset@example.com";
const OLD_HASH = "pbkdf2$100000$aa$bb";
const NEW_HASH = "pbkdf2$100000$cc$dd";

function d1FromSqlite(): { d1: D1Database; raw: InstanceType<typeof DatabaseSync> } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(
    "CREATE TABLE user_accounts (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT NOT NULL)",
  );
  raw.exec("CREATE TABLE user_sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires_at TEXT)");
  raw.exec(
    readFileSync(
      join(import.meta.dirname, "..", "migrations", "0023_verification_codes.sql"),
      "utf-8",
    ),
  );
  raw
    .prepare("INSERT INTO user_accounts (id, email, password_hash) VALUES (1, ?, ?)")
    .run(EMAIL, OLD_HASH);

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
    // 与 D1 一致：batch 顺序执行并包在事务里（任一语句抛错则整体回滚）。
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { d1, raw };
}

async function seedCode(
  raw: InstanceType<typeof DatabaseSync>,
  code: string,
  expires = "+10 minutes",
) {
  raw
    .prepare(
      "INSERT INTO verification_codes (email, purpose, code_hash, expires_at) VALUES (?, 'reset', ?, datetime('now', ?))",
    )
    .run(EMAIL, await sha256Hex(code), expires);
}

function seedSessions(raw: InstanceType<typeof DatabaseSync>) {
  raw
    .prepare(
      "INSERT INTO user_sessions (token, user_id, expires_at) VALUES ('s1', 1, datetime('now', '+1 day')), ('s2', 1, datetime('now', '+1 day'))",
    )
    .run();
}

function meta(raw: InstanceType<typeof DatabaseSync>) {
  const account = raw.prepare("SELECT password_hash FROM user_accounts WHERE id = 1").get() as {
    password_hash: string;
  };
  const codes = raw.prepare("SELECT COUNT(*) AS n FROM verification_codes").get() as { n: number };
  const sessions = raw.prepare("SELECT COUNT(*) AS n FROM user_sessions").get() as { n: number };
  return { hash: account.password_hash, codes: codes.n, sessions: sessions.n };
}

describe("resetPasswordWithCode（改密 + 验证码一次性消费 + 会话吊销）", () => {
  it("对码时改密、删码、吊销会话，且同一验证码不能再用第二次", async () => {
    const { d1, raw } = d1FromSqlite();
    seedSessions(raw);
    await seedCode(raw, "123456");

    await expect(
      resetPasswordWithCode(d1, 1, EMAIL, await sha256Hex("123456"), NEW_HASH),
    ).resolves.toBe(true);
    expect(meta(raw)).toEqual({ hash: NEW_HASH, codes: 0, sessions: 0 });

    // 重放同一个验证码：守卫已无对应行，返回 false 且不再改动任何状态。
    await expect(
      resetPasswordWithCode(d1, 1, EMAIL, await sha256Hex("123456"), "pbkdf2$100000$ee$ff"),
    ).resolves.toBe(false);
    expect(meta(raw)).toEqual({ hash: NEW_HASH, codes: 0, sessions: 0 });
  });

  it("错码时不动密码、不删验证码、也不把用户踢下线", async () => {
    const { d1, raw } = d1FromSqlite();
    seedSessions(raw);
    await seedCode(raw, "123456");

    await expect(
      resetPasswordWithCode(d1, 1, EMAIL, await sha256Hex("000000"), NEW_HASH),
    ).resolves.toBe(false);
    expect(meta(raw)).toEqual({ hash: OLD_HASH, codes: 1, sessions: 2 });

    // 错码之后正确码仍然可用。
    await expect(
      resetPasswordWithCode(d1, 1, EMAIL, await sha256Hex("123456"), NEW_HASH),
    ).resolves.toBe(true);
    expect(meta(raw)).toEqual({ hash: NEW_HASH, codes: 0, sessions: 0 });
  });

  it("过期验证码不生效", async () => {
    const { d1, raw } = d1FromSqlite();
    seedSessions(raw);
    await seedCode(raw, "123456", "-1 second");

    await expect(
      resetPasswordWithCode(d1, 1, EMAIL, await sha256Hex("123456"), NEW_HASH),
    ).resolves.toBe(false);
    expect(meta(raw)).toEqual({ hash: OLD_HASH, codes: 1, sessions: 2 });
  });
});
