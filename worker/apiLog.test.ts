import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ApiLogQueue,
  FLUSH_DELAY_MS,
  FLUSH_THRESHOLD,
  type ApiLogClock,
  type ApiLogEntry,
} from "./apiLog";

const entry: ApiLogEntry = ["/api/health", "GET", 200, 12, "ok", null, "127.0.0.1"];
const anotherEntry: ApiLogEntry = ["/api/plaza/posts", "POST", 201, 8, "ok", null, null];

/** 手动时钟：定时器不自动跑，测试显式 fire()，才能断言「何时落库」。 */
function fakeClock() {
  const tasks = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 0;
  const clock: ApiLogClock & { fire: () => number; count: number } = {
    schedule(fn, ms) {
      const id = ++nextId;
      tasks.set(id, { fn, ms });
      return id;
    },
    cancel(handle) {
      tasks.delete(Number(handle));
    },
    fire() {
      const due = [...tasks.values()];
      tasks.clear();
      for (const task of due) task.fn();
      return due.length;
    },
    get count() {
      return tasks.size;
    },
  };
  return clock;
}

function fakeDb({ fail = false } = {}) {
  const rows: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => ({ args }),
    }),
    batch: async (statements: Array<{ args: unknown[] }>) => {
      if (fail) throw new Error("D1 unavailable");
      rows.push(...statements.map((statement) => statement.args));
      return [];
    },
  } as unknown as D1Database;
  return { db, rows };
}

function fakeCtx() {
  const waits: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  } as unknown as ExecutionContext;
  return { ctx, waits };
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

describe("API 日志队列的 waitUntil 生命周期", () => {
  it("延迟 flush：请求等到的承诺在 D1 写入之后才 resolve", async () => {
    const clock = fakeClock();
    const queue = new ApiLogQueue(clock);
    const { db, rows } = fakeDb();
    const { ctx, waits } = fakeCtx();

    queue.enqueue(ctx, db, entry);
    expect(waits).toHaveLength(1);
    expect(clock.count).toBe(1);

    let settled = false;
    void Promise.resolve(waits[0]).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(rows).toHaveLength(0);

    expect(clock.fire()).toBe(1);
    await Promise.all(waits);
    expect(rows).toEqual([[...entry]]);
    expect(settled).toBe(true);
    expect(clock.count).toBe(0);
  });

  it("多个请求共享同一批：只排一个定时器，且都等到落库", async () => {
    const clock = fakeClock();
    const queue = new ApiLogQueue(clock);
    const { db, rows } = fakeDb();
    const first = fakeCtx();
    const second = fakeCtx();

    queue.enqueue(first.ctx, db, entry);
    queue.enqueue(second.ctx, db, anotherEntry);
    expect(clock.count).toBe(1);
    expect(first.waits[0]).toBe(second.waits[0]);

    clock.fire();
    await Promise.all([...first.waits, ...second.waits]);
    expect(rows).toHaveLength(2);
  });

  it("达到阈值立即 flush，不再留 5 秒定时器", async () => {
    const clock = fakeClock();
    const queue = new ApiLogQueue(clock);
    const { db, rows } = fakeDb();
    const { ctx, waits } = fakeCtx();

    for (let i = 0; i < FLUSH_THRESHOLD; i++) queue.enqueue(ctx, db, entry);
    expect(clock.count).toBe(0);
    await Promise.all(waits);
    expect(rows).toHaveLength(FLUSH_THRESHOLD);
    expect(FLUSH_DELAY_MS).toBeGreaterThan(0);
  });

  it("写入失败不 reject、不阻断请求，承诺照常 resolve", async () => {
    const clock = fakeClock();
    const queue = new ApiLogQueue(clock);
    const { db } = fakeDb({ fail: true });
    const { ctx, waits } = fakeCtx();

    queue.enqueue(ctx, db, entry);
    clock.fire();
    await expect(Promise.all(waits)).resolves.toHaveLength(1);
  });

  it("flush 期间到达的新请求属于下一批，不会等错承诺", async () => {
    const clock = fakeClock();
    const queue = new ApiLogQueue(clock);
    const { db, rows } = fakeDb();
    const first = fakeCtx();
    const second = fakeCtx();

    queue.enqueue(first.ctx, db, entry);
    clock.fire(); // 同步触发 flushNow，此时 write 还没 await 完
    queue.enqueue(second.ctx, db, entry);

    expect(first.waits[0]).not.toBe(second.waits[0]);
    expect(clock.count).toBe(1);
    await Promise.all(first.waits);
    expect(rows).toHaveLength(1);

    clock.fire();
    await Promise.all(second.waits);
    expect(rows).toHaveLength(2);
  });

  it("入口确实把 ctx 交给队列，而不是只 waitUntil 一个入队动作", () => {
    const code = stripComments(readFileSync("worker/index.ts", "utf8"));
    expect(code).toMatch(/apiLogs\.enqueue\(ctx,/);
    expect(code).not.toMatch(/waitUntil\(\s*logApiCall/);
  });
});
