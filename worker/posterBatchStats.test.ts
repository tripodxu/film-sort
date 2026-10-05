import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

/**
 * POST /api/posters/batch 的 outcome 分布落库（migrations/0026 poster_batch_stats）。
 *
 * poster_errors 只有失败行、没有分母——「throttled 占比」这类封面链观测必须
 * 有 total/found 才算得出来。这里钉三条不变量：
 *  ① 每个批量请求恰好落**一行**统计（不是每 key 一行，D1 不能被写成热点）；
 *  ② total 等于 keys 数；
 *  ③ 上游全挂时 found=0 且 absent/throttled 记满（具体哪档取决于上游失败
 *     是不是 ThrottledError，不在这里钉死——那是 computePosters 的职责）。
 *
 * 上游 fetch 全部 stub 成 reject：node 环境不碰真实豆瓣/维基（离线纪律）。
 * fake D1 只按 SQL 前缀应答，同 coverChoice.test.ts 的做法。
 */

const batchRows: Array<unknown[]> = [];

function fakeDb(): D1Database {
  const db = {
    prepare(sql: string) {
      const bound = {
        first: async () => null,
        run: async () => {
          if (/INSERT INTO poster_batch_stats/.test(sql)) batchRows.push([...boundArgs]);
          return { success: true, meta: {} };
        },
        all: async () => {
          if (/FROM poster_urls WHERE media_key IN/.test(sql)) return { results: [] };
          return { results: [] };
        },
      };
      let boundArgs: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundArgs = args;
          return bound;
        },
      };
    },
    batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  };
  return db as unknown as D1Database;
}

afterEach(() => {
  batchRows.length = 0;
  vi.unstubAllGlobals();
});

describe("POST /api/posters/batch · outcome 分布落库", () => {
  // 上游全挂时批量链会走满豆瓣节奏延迟与指数退避（1s+2s+3s…），单条数秒——
  // 给足超时，别因为默认 5s 把「全挂」路径误判成卡死。
  it("每请求恰好一行统计，total=keys 数，上游全挂时 found=0", { timeout: 45_000 }, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline (test stub)");
      }),
    );
    const env: Env = { ASSETS: {} as Fetcher, DB: fakeDb() };
    const request = new Request("https://sort.logicc.top/api/posters/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { title: "日常幻想", type: "movie" },
          { title: "故事FM", type: "movie" },
        ],
      }),
    });
    const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { outcomes?: Record<string, string> };
    const outcomes = Object.values(payload.outcomes ?? {});
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome !== "found")).toBe(true);
    // 统计行是火后不管的插入：让微任务排空再断言。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(batchRows).toHaveLength(1);
    const [total, found, absent, throttled] = batchRows[0] as number[];
    expect(total).toBe(2);
    expect(found).toBe(0);
    expect(absent + throttled).toBe(2);
  });

  it("已知命中短路后统计照记（found 进分母）", { timeout: 45_000 }, async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline (test stub)");
      }),
    );
    const env: Env = { ASSETS: {} as Fetcher, DB: fakeDb() };
    const request = new Request("https://sort.logicc.top/api/posters/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ title: "蒙娜丽莎", type: "movie" }] }),
    });
    const ctx = { waitUntil: () => undefined } as unknown as ExecutionContext;
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // 上游全挂时已知缓存也不存在 ⇒ 仍不是 found；本用例只钉「一行且 total=1」。
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0]?.[0]).toBe(1);
  });
});
