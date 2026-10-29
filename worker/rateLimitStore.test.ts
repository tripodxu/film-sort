import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RATE_WINDOW_MS } from "./rateWindow";
import { RATE_LIMIT_UPSERT_SQL, consumeSharedWindow, withinSharedLimit } from "./rateLimitStore";

describe("跨 isolate 限流（D1 原子计数）", () => {
  it("withinSharedLimit：等于 limit 放行，超过即拒绝", () => {
    expect(withinSharedLimit({ count: 1 }, 30)).toBe(true);
    expect(withinSharedLimit({ count: 30 }, 30)).toBe(true);
    expect(withinSharedLimit({ count: 31 }, 30)).toBe(false);
    expect(withinSharedLimit(null, 30)).toBe(false);
    expect(withinSharedLimit(undefined, 30)).toBe(false);
    expect(withinSharedLimit({}, 30)).toBe(false);
  });

  it("SQL 把过期重置 + 自增 + 返回新值压成一次原子 UPSERT", () => {
    expect(RATE_LIMIT_UPSERT_SQL).toContain("ON CONFLICT(key) DO UPDATE");
    expect(RATE_LIMIT_UPSERT_SQL).toContain("RETURNING count");
    expect(RATE_LIMIT_UPSERT_SQL).toMatch(/CASE WHEN \?2 - started_at > \?3 THEN 1/);
  });

  it("consumeSharedWindow 绑定 key/now/窗口长度并返回新计数判定", async () => {
    const calls: unknown[][] = [];
    const row = { count: 30 };
    const db = {
      prepare(sql: string) {
        expect(sql).toBe(RATE_LIMIT_UPSERT_SQL);
        return {
          bind(...args: unknown[]) {
            calls.push(args);
            return {
              async first() {
                return row;
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const now = 1_760_000_000_000;
    await expect(consumeSharedWindow(db, "auth:1.2.3.4", 30, now)).resolves.toBe(true);
    expect(calls).toEqual([["auth:1.2.3.4", now, RATE_WINDOW_MS]]);

    row.count = 31;
    await expect(consumeSharedWindow(db, "auth:1.2.3.4", 30, now)).resolves.toBe(false);
  });

  it("RETURNING 无行时按无法判定放行（不误伤正常请求）", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    await expect(consumeSharedWindow(db, "auth:1.2.3.4", 1, Date.now())).resolves.toBe(true);
  });

  it("敏感桶接 D1，高频读桶不接（避免写放大）", () => {
    const idx = readFileSync("worker/index.ts", "utf8");
    expect(idx).toContain("consumeSharedWindow");
    for (const call of [
      'allowUpstreamRequest(request, "auth", 30, env.DB)',
      "allowUpstreamRequest(request, bucket, limit, env.DB)",
      'allowUpstreamRequest(request, "ai", 8, env.DB)',
      'allowUpstreamRequest(request, "ai_jev", 10, env.DB)',
      'allowUpstreamRequest(request, "share", 30, env.DB)',
      'allowUpstreamRequest(request, "import", 8, env.DB)',
      'allowUpstreamRequest(request, "challenge", 30, env.DB)',
    ]) {
      expect(idx).toContain(call);
    }
    expect(idx).toContain('allowUpstreamRequest(request, "image", 300)');
    expect(idx).toContain('allowUpstreamRequest(request, "events", 120)');
  });
});
