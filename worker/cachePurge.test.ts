import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import {
  generationOf,
  isCacheScope,
  purgeCaches,
  purgeLocal,
  refreshGenerations,
  registerPurger,
} from "./cachePurge";

// Vitest 内嵌 Vite 不识别 node:sqlite 内置模块，经 createRequire 直连 Node 解析器。
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

function d1FromSqlite(): { d1: D1Database; raw: InstanceType<typeof DatabaseSync> } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE admin_config (key TEXT PRIMARY KEY, value TEXT)");
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

describe("cachePurge 分代清除", () => {
  it("scope 校验只接受四个已知作用域", () => {
    expect(isCacheScope("posters")).toBe(true);
    expect(isCacheScope("intro")).toBe(true);
    expect(isCacheScope("music")).toBe(true);
    expect(isCacheScope("misc")).toBe(true);
    expect(isCacheScope("all")).toBe(false); // all 只属于管理员端语义
    expect(isCacheScope("everything")).toBe(false);
  });

  it("purgeCaches 推进代次写入 D1，generationOf 随之变化", async () => {
    const { d1, raw } = d1FromSqlite();
    const before = generationOf("posters");
    const result = await purgeCaches(d1, "posters");
    const after = generationOf("posters");
    expect(after).not.toBe(before);
    expect(result.generation.posters).toBe(after);
    const stored = raw
      .prepare("SELECT value FROM admin_config WHERE key = 'cache_gen:posters'")
      .get() as {
      value: string;
    };
    expect(stored.value).toBe(after);
  });

  it("purgeCaches(all) 作用于全部作用域", async () => {
    const { d1 } = d1FromSqlite();
    const result = await purgeCaches(d1, "all");
    expect(Object.keys(result.purged).sort()).toEqual(["intro", "misc", "music", "posters"]);
    expect(Object.keys(result.generation).sort()).toEqual(["intro", "misc", "music", "posters"]);
  });

  it("purgeLocal 只执行注册的清除器并返回条目数", () => {
    const store = new Set(["a", "b", "c"]);
    registerPurger("misc", () => {
      const count = store.size;
      store.clear();
      return count;
    });
    const purged = purgeLocal(["misc"]);
    expect(purged.misc).toBe(3);
    expect(store.size).toBe(0);
  });

  it("refreshGenerations 从 D1 读回代次；无 D1 时不抛错", async () => {
    const { d1, raw } = d1FromSqlite();
    raw.prepare("INSERT INTO admin_config (key, value) VALUES ('cache_gen:music', '42')").run();
    // 模块级代次有 60s 节流：用假时钟越过上一个用例刚刷新的时间
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      await refreshGenerations(d1);
      expect(generationOf("music")).toBe("42");
      await refreshGenerations(undefined); // 不抛错即可
    } finally {
      vi.useRealTimers();
    }
  });
});
