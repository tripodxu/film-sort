import { RATE_WINDOW_MS } from "./rateWindow";

/**
 * 跨 isolate 的精确限流计数（敏感桶专用）。
 *
 * 现有的 isolate Map + Edge Cache 是「够用但不精确」的：Map 只看得到本 isolate，
 * Cache 的 match→put 是读改写、并发下会丢计数。这里用单条 UPSERT 把
 * 「过期重置 + 自增 + 返回新值」压成一次原子写，跨 isolate 也能拿到真实计数。
 *
 * 只给低流量、高代价的桶用（管理登录、账号鉴权、AI、分享、导入等）；
 * 海报/图片/events 这类高频读仍走 Map + Cache，避免把 D1 写打满。
 */
export const RATE_LIMIT_UPSERT_SQL = `INSERT INTO rate_limits (key, started_at, count) VALUES (?1, ?2, 1)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN ?2 - started_at > ?3 THEN 1 ELSE count + 1 END,
  started_at = CASE WHEN ?2 - started_at > ?3 THEN ?2 ELSE started_at END
RETURNING count`;

/** 新计数是否仍在预算内（含等于 limit 的最后一次放行）。 */
export function withinSharedLimit(
  row: { count?: number } | null | undefined,
  limit: number,
): boolean {
  return typeof row?.count === "number" && row.count <= limit;
}

/**
 * 原子记一次并回答是否放行。调用方负责兜底：表未迁移 / D1 暂不可用时
 * 应退回 Map + Cache 语义，不能因为限流存储故障把正常请求拒掉。
 *
 * `RETURNING` 没有返回行时同样按「无法判定」放行——真实 D1 不会这样，
 * 但测试替身或异常代理可能返回空，宁可放宽也不误伤。
 */
export async function consumeSharedWindow(
  db: D1Database,
  key: string,
  limit: number,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare(RATE_LIMIT_UPSERT_SQL)
    .bind(key, now, RATE_WINDOW_MS)
    .first<{ count: number }>();
  if (!row || typeof row.count !== "number") return true;
  return withinSharedLimit(row, limit);
}
