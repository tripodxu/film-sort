import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODE_MAX_ATTEMPTS,
  consumeOAuthExchange,
  consumeVerificationCode,
  parseGoogleUser,
  sha256Hex,
} from "./verification";

// Vitest 内嵌 Vite 不识别 node:sqlite 内置模块，经 createRequire 直连 Node 解析器。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

function d1FromSqlite(): { d1: D1Database; raw: InstanceType<typeof DatabaseSync> } {
  const raw = new DatabaseSync(":memory:");
  const migrationsDir = join(import.meta.dirname, "..", "migrations");
  // 0015/0023 是被测表的真实来源；0025 只加索引，一并演练（其引用的其余表补最小壳）。
  raw.exec("CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, user_id INTEGER)");
  raw.exec("CREATE TABLE user_oauth (id INTEGER PRIMARY KEY, user_id INTEGER)");
  raw.exec("CREATE TABLE plaza_likes (id INTEGER PRIMARY KEY, user_id INTEGER, post_id INTEGER)");
  raw.exec(
    "CREATE TABLE plaza_comments (id INTEGER PRIMARY KEY, user_id INTEGER, post_id INTEGER)",
  );
  for (const file of [
    "0015_oauth_exchange.sql",
    "0023_verification_codes.sql",
    "0025_runtime_indexes.sql",
  ])
    raw.exec(readFileSync(join(migrationsDir, file), "utf-8"));
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
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
  return { d1, raw };
}

async function issueCode(
  raw: InstanceType<typeof DatabaseSync>,
  email: string,
  purpose: "register" | "reset",
  code: string,
  expiresInSeconds = 600,
) {
  raw.prepare("DELETE FROM verification_codes WHERE email = ? AND purpose = ?").run(email, purpose);
  raw
    .prepare(
      "INSERT INTO verification_codes (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, datetime('now', (? || ' seconds')))",
    )
    .run(email, purpose, await sha256Hex(code), expiresInSeconds);
}

describe("consumeVerificationCode（条件一次性消费，DATA-05）", () => {
  it("consumes a valid code exactly once", async () => {
    const { d1, raw } = d1FromSqlite();
    await issueCode(raw, "a@example.com", "register", "123456");
    await expect(
      consumeVerificationCode(d1, "a@example.com", "register", "123456"),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeVerificationCode(d1, "a@example.com", "register", "123456"),
    ).resolves.toMatchObject({
      ok: false,
      error: "code_not_requested",
    });
  });

  it("a wrong code increments attempts without deleting the row", async () => {
    const { d1, raw } = d1FromSqlite();
    await issueCode(raw, "a@example.com", "reset", "123456");
    await expect(
      consumeVerificationCode(d1, "a@example.com", "reset", "000000"),
    ).resolves.toMatchObject({
      ok: false,
      error: "invalid_code",
    });
    const row = raw
      .prepare("SELECT attempts FROM verification_codes WHERE email = ? AND purpose = ?")
      .get("a@example.com", "reset") as { attempts: number };
    expect(row.attempts).toBe(1);
    // 正确的码在错码之后仍然可以消费。
    await expect(
      consumeVerificationCode(d1, "a@example.com", "reset", "123456"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("locks the code after the configured attempt budget", async () => {
    const { d1, raw } = d1FromSqlite();
    await issueCode(raw, "a@example.com", "register", "123456");
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i += 1)
      await expect(
        consumeVerificationCode(d1, "a@example.com", "register", `bad-${i}`),
      ).resolves.toMatchObject({
        ok: false,
        error: "invalid_code",
      });
    await expect(
      consumeVerificationCode(d1, "a@example.com", "register", "123456"),
    ).resolves.toMatchObject({
      ok: false,
      error: "code_locked",
    });
  });

  it("rejects an expired code without consuming it", async () => {
    const { d1, raw } = d1FromSqlite();
    await issueCode(raw, "a@example.com", "reset", "123456", -1);
    await expect(
      consumeVerificationCode(d1, "a@example.com", "reset", "123456"),
    ).resolves.toMatchObject({
      ok: false,
      error: "code_expired",
    });
    const count = raw.prepare("SELECT COUNT(*) AS n FROM verification_codes").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("reports a missing request instead of consuming", async () => {
    const { d1 } = d1FromSqlite();
    await expect(
      consumeVerificationCode(d1, "nobody@example.com", "register", "123456"),
    ).resolves.toMatchObject({
      ok: false,
      error: "code_not_requested",
    });
  });
});

describe("consumeOAuthExchange（一次性并发语义，DATA-05）", () => {
  it("returns the exchange to only one caller", async () => {
    const { d1, raw } = d1FromSqlite();
    raw
      .prepare(
        "INSERT INTO oauth_exchanges (code, token, email, nickname, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+300 seconds'))",
      )
      .run("code-1", "token-1", "a@example.com", "nick");
    await expect(consumeOAuthExchange(d1, "code-1")).resolves.toMatchObject({
      ok: true,
      token: "token-1",
    });
    await expect(consumeOAuthExchange(d1, "code-1")).resolves.toMatchObject({ ok: false });
  });

  it("rejects an expired exchange", async () => {
    const { d1, raw } = d1FromSqlite();
    raw
      .prepare(
        "INSERT INTO oauth_exchanges (code, token, email, nickname, expires_at) VALUES (?, ?, ?, NULL, datetime('now', '-1 second'))",
      )
      .run("code-2", "token-2", "a@example.com");
    await expect(consumeOAuthExchange(d1, "code-2")).resolves.toMatchObject({ ok: false });
  });
});

describe("parseGoogleUser（严格 email_verified，DATA-05）", () => {
  it("accepts only email_verified === true", () => {
    expect(
      parseGoogleUser({ id: "g1", email: "a@example.com", email_verified: true }),
    ).toMatchObject({
      id: "g1",
      email: "a@example.com",
    });
  });

  it("rejects a missing or false email_verified field", () => {
    expect(parseGoogleUser({ id: "g1", email: "a@example.com" })).toBeNull();
    expect(parseGoogleUser({ id: "g1", email: "a@example.com", email_verified: false })).toBeNull();
  });
});
