/**
 * API 访问日志的批量写入队列。
 *
 * 修复动机（2026-11-05 全量审计 F-01）：旧实现把 flush 排在 5 秒后的裸
 * `setTimeout` 里，而 `worker.fetch` 的 `ctx.waitUntil(logApiCall(...))` 等的
 * 只是一个「同步入队」——响应返回后 isolate 随时可被回收，5 秒后的 D1
 * 批量写没有任何人等它。低流量站点（两次请求间隔常大于 5 秒）反而最
 * 容易整批丢日志，而 `api_logs` 正是排查低流量时段异常的那张表。
 *
 * 这里让每次请求都 `waitUntil` 同一份「本批已落库」的承诺：平台据此把
 * isolate 保活到写入完成，日志失败也照旧不阻断请求。队列仍按 5 秒或
 * 50 条聚合，不增加 D1 写次数。
 *
 * 时钟可注入，便于在 node 单测里证明「承诺在写入之后才 resolve」——
 * 这条时序是修复的全部内容，不能用「waitUntil 被调用过」代替。
 */

export type ApiLogEntry = readonly [
  path: string,
  method: string,
  status: number,
  durationMs: number,
  source: string,
  error: string | null,
  ip: string | null,
];

/** 句柄统一用数字 id：Node 的 setTimeout 返回 Timeout 对象，workerd 返回 number，
 *  直接透传会让两端类型对不上。生产时钟自己做一层 id → 原生句柄的映射。 */
export interface ApiLogClock {
  schedule(fn: () => void, ms: number): number;
  cancel(handle: number): void;
}

export const FLUSH_THRESHOLD = 50;
export const FLUSH_DELAY_MS = 5_000;

const systemClock: ApiLogClock = (() => {
  let nextId = 0;
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    schedule(fn, ms) {
      const id = ++nextId;
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id);
          fn();
        }, ms),
      );
      return id;
    },
    cancel(id) {
      const handle = handles.get(id);
      if (handle !== undefined) clearTimeout(handle);
      handles.delete(id);
    },
  };
})();

export class ApiLogQueue {
  private readonly queue: ApiLogEntry[] = [];
  private db: D1Database | undefined;
  private timer: number | undefined;
  /** 当前这一批「已经落库」的承诺；同批的多个请求共享它。 */
  private pending: Promise<void> | null = null;
  private resolvePending: (() => void) | null = null;

  constructor(private readonly clock: ApiLogClock = systemClock) {}

  /** 入队，并把本批的落库承诺交给请求上下文。 */
  enqueue(ctx: ExecutionContext | undefined, db: D1Database | undefined, entry: ApiLogEntry): void {
    if (db) this.db = db;
    this.queue.push(entry);

    let pending = this.pending;
    if (!pending) {
      pending = new Promise<void>((resolve) => {
        this.resolvePending = resolve;
      });
      this.pending = pending;
    }
    ctx?.waitUntil(pending);

    if (this.queue.length >= FLUSH_THRESHOLD) this.flushNow();
    else if (this.timer === undefined) {
      this.timer = this.clock.schedule(() => this.flushNow(), FLUSH_DELAY_MS);
    }
  }

  private flushNow(): void {
    if (this.timer !== undefined) {
      this.clock.cancel(this.timer);
      this.timer = undefined;
    }
    const batch = this.queue.splice(0);
    // 先摘下承诺再写：写期间到达的新请求属于下一批，不会等到别人那一批。
    const resolve = this.resolvePending;
    this.pending = null;
    this.resolvePending = null;
    void this.write(batch).finally(() => resolve?.());
  }

  private async write(batch: ApiLogEntry[]): Promise<void> {
    if (!batch.length || !this.db) return;
    try {
      const stmt = this.db.prepare(
        "INSERT INTO api_logs (path, method, status, duration_ms, source, error, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      await this.db.batch(
        batch.map(([p, m, s, d, src, e, ip]) => stmt.bind(p, m, s, d, src, e, ip)),
      );
    } catch {
      // 日志失败绝不阻断请求（与旧实现一致）。
    }
  }
}
