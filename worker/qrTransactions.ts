// QR 登录事务仓库（findings SEC-03）：外部平台二维码 key 与发起账户的所有权绑定。
// D1 是唯一事实来源——isolate 内存里的 Cookie 罐只是短期凭证缓存，不能承担 ownership。
// 过期比较全部在 SQLite 侧（datetime('now')），与应用服务器时钟漂移无关。

const QR_PROVIDERS = ["netease", "douban"] as const;
export type QrProvider = (typeof QR_PROVIDERS)[number];

export function isQrProvider(value: string): value is QrProvider {
  return (QR_PROVIDERS as readonly string[]).includes(value);
}

export interface QrTransaction {
  provider: QrProvider;
  transaction_key: string;
  user_id: number;
  expires_at: string;
}

interface D1Row {
  user_id: number;
  expires_at: string;
}

/** 登记（或重签）一条 QR 事务：同一 provider+key 重发时改绑到新 owner。 */
export async function registerQrTransaction(
  db: D1Database,
  provider: QrProvider,
  key: string,
  userId: number,
  ttlMs: number,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
  await db
    .prepare(
      "INSERT OR REPLACE INTO qr_transactions (provider, transaction_key, user_id, expires_at) VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'))",
    )
    .bind(provider, key, userId, ttlSeconds)
    .run();
}

/** 查询未过期且属于 userId 的事务；缺失/过期/他人 key 一律返回 null（调用方 fail-closed）。 */
export async function getQrTransaction(
  db: D1Database,
  provider: QrProvider,
  key: string,
  userId: number,
): Promise<QrTransaction | null> {
  const row = await db
    .prepare(
      "SELECT user_id, expires_at FROM qr_transactions WHERE provider = ? AND transaction_key = ? AND user_id = ? AND expires_at > datetime('now') LIMIT 1",
    )
    .bind(provider, key, userId)
    .first<D1Row>();
  return row
    ? { provider, transaction_key: key, user_id: row.user_id, expires_at: row.expires_at }
    : null;
}

/**
 * 终态一次性消费：只有未过期且属于 userId 的行会被删除，返回是否真正删除。
 * 并发轮询同一 key 时条件 DELETE 保证恰好一个请求拿到 true。
 */
export async function consumeQrTransaction(
  db: D1Database,
  provider: QrProvider,
  key: string,
  userId: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      "DELETE FROM qr_transactions WHERE provider = ? AND transaction_key = ? AND user_id = ? AND expires_at > datetime('now')",
    )
    .bind(provider, key, userId)
    .run();
  return result.meta.changes === 1;
}

/** 清理过期行；幂等，适合挂在 scheduled handler。 */
export async function cleanupExpiredQrTransactions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM qr_transactions WHERE expires_at <= datetime('now')").run();
}
