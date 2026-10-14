import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import worker, { type Env } from "./index";
import { tallyBatchOutcomes } from "./media";

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

describe("tallyBatchOutcomes（A4 / T-20261014-07）", () => {
  it("found 从 results 有无数据推导，未知 outcome 标签永不虚增 found", () => {
    const tally = tallyBatchOutcomes(
      ["a", "b", "c", "d"],
      { a: ["https://img/x.jpg"], b: [], c: [], d: [] },
      {
        a: "found",
        b: "throttled",
        c: "absent",
        // 将来新增的 outcome 字符串：无数据 ⇒ absent，绝不能 else 进 found。
        d: "stale",
      } as unknown as Record<string, "found" | "absent" | "throttled">,
    );
    expect(tally).toEqual({ found: 1, absent: 2, throttled: 1 });
  });

  it("有数据的 key 即使标签缺失也计 found（标签是解释，数据是事实）", () => {
    const tally = tallyBatchOutcomes(["a"], { a: ["https://img/x.jpg"] }, {});
    expect(tally).toEqual({ found: 1, absent: 0, throttled: 0 });
  });
});

describe("批量 outcome 无共享状态（A4 / T-20261014-07 tripwire）", () => {
  const media = readFileSync(new URL("./media.ts", import.meta.url), "utf8");
  const other = readFileSync(new URL("./other.ts", import.meta.url), "utf8");

  it("resolvePostersBatch 每次调用新建 results/outcomes（并发批次互不可见）", () => {
    expect(media).toMatch(/const results: PosterBatchResult = \{\};/);
    expect(media).toMatch(/const outcomes: Record<string, PosterOutcome> = \{\};/);
  });

  it("media.ts/other.ts 无模块级未命名判决状态（wikiDegraded 类缺陷不许回来）", () => {
    // 允许的模块级可变状态只有：UA 轮转计数、懒索引初始化守卫、按 key 索引的
    // 缓存/节流/熔断 Map（键控，无跨条目染色）。裸的判决布尔/字符串一律不许出现。
    for (const [name, code] of [
      ["media.ts", media],
      ["other.ts", other],
    ] as const) {
      const bad = code
        .split("\n")
        .filter((line) => /^let\s+\w*(outcome|verdict|degraded|throttled)\w*\b/i.test(line));
      expect(bad, `${name} 出现模块级判决状态：${bad.join(" | ")}`).toEqual([]);
    }
  });
});
