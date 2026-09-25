import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consumeQrTransaction, getQrTransaction, registerQrTransaction } from "./qrTransactions";

// Vitest 内嵌 Vite 不识别 node:sqlite 内置模块，经 createRequire 直连 Node 解析器。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

// 真 SQLite 内存库做 D1 替身：过期比较（datetime('now')）和 meta.changes 语义与 D1 一致，
// 手写 Map 假实现无法证明这两条。
function d1FromSqlite(): { d1: D1Database; raw: InstanceType<typeof DatabaseSync> } {
  const raw = new DatabaseSync(":memory:");
  // migration 0024 的 FK 引用 user_accounts（D1 里由 0001 建表）；测试库补最小父表与用例行。
  raw.exec("CREATE TABLE user_accounts (id INTEGER PRIMARY KEY)");
  raw.prepare("INSERT INTO user_accounts (id) VALUES (10), (11), (20)").run();
  const migration = readFileSync(
    join(import.meta.dirname, "..", "migrations", "0024_qr_transactions.sql"),
    "utf-8",
  );
  raw.exec(migration);
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

describe("qr owner binding", () => {
  it("rejects a poll whose user differs from the issue owner", async () => {
    const { d1: db } = d1FromSqlite();
    await registerQrTransaction(db, "netease", "key-a", 10, 120_000);
    await expect(getQrTransaction(db, "netease", "key-a", 11)).resolves.toBeNull();
    await expect(getQrTransaction(db, "netease", "key-a", 10)).resolves.toMatchObject({
      user_id: 10,
    });
  });

  it("consumes a transaction exactly once at terminal cleanup", async () => {
    const { d1: db } = d1FromSqlite();
    await registerQrTransaction(db, "douban", "code-a", 10, 120_000);
    await expect(consumeQrTransaction(db, "douban", "code-a", 10)).resolves.toBe(true);
    await expect(getQrTransaction(db, "douban", "code-a", 10)).resolves.toBeNull();
    await expect(consumeQrTransaction(db, "douban", "code-a", 10)).resolves.toBe(false);
  });

  it("rejects expired transactions for both lookup and consumption", async () => {
    const { d1: db, raw } = d1FromSqlite();
    await registerQrTransaction(db, "netease", "key-old", 10, 120_000);
    // 仓库层对 ttl 有 min 1s 钳制（防误用）；直接把行置旧以验证过期读取/消费语义。
    raw.prepare("UPDATE qr_transactions SET expires_at = datetime('now', '-1 second')").run();
    await expect(getQrTransaction(db, "netease", "key-old", 10)).resolves.toBeNull();
    await expect(consumeQrTransaction(db, "netease", "key-old", 10)).resolves.toBe(false);
  });

  it("isolates transactions by provider and key", async () => {
    const { d1: db } = d1FromSqlite();
    await registerQrTransaction(db, "netease", "shared-key", 10, 120_000);
    await registerQrTransaction(db, "douban", "shared-key", 20, 120_000);
    await expect(getQrTransaction(db, "netease", "shared-key", 20)).resolves.toBeNull();
    await expect(getQrTransaction(db, "douban", "shared-key", 10)).resolves.toBeNull();
    await expect(getQrTransaction(db, "netease", "shared-key", 10)).resolves.toMatchObject({
      user_id: 10,
    });
    await expect(getQrTransaction(db, "douban", "shared-key", 20)).resolves.toMatchObject({
      user_id: 20,
    });
  });

  it("re-issuing the same provider key rebinds the owner (INSERT OR REPLACE)", async () => {
    const { d1: db } = d1FromSqlite();
    await registerQrTransaction(db, "netease", "key-b", 10, 120_000);
    await registerQrTransaction(db, "netease", "key-b", 11, 120_000);
    await expect(getQrTransaction(db, "netease", "key-b", 10)).resolves.toBeNull();
    await expect(getQrTransaction(db, "netease", "key-b", 11)).resolves.toMatchObject({
      user_id: 11,
    });
  });
});
