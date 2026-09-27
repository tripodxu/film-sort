// 验证码 / OAuth exchange 的一次性消费语义（findings DATA-05）。
// 消费一律是条件语句（WHERE 携带 hash、尝试上限、有效期），以 meta.changes 判定归属——
// 「先 SELECT 再无条件 DELETE」的两步式在并发下会把同一个 token 或验证码发给两个请求。
// 迁移 0025 的说明：token-at-rest 哈希需要重建表，本阶段明确不做（见设计文档 §3.4）。

export const CODE_MAX_ATTEMPTS = 5;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type CodeConsumptionFailure = {
  ok: false;
  error: "code_not_requested" | "code_expired" | "code_locked" | "invalid_code";
  msg: string;
};

/**
 * 验证码 EXISTS 守卫片段：把它放进变更语句的 WHERE 子句，「验证码有效」与
 * 「数据变更」就成为**同一条 SQL 语句**（语句级原子）——不存在先变更、后消费
 * 的窗口（findings 复审 #1/#2：先改密/先建号后消费的顺序有接管/未验证账号风险）。
 * 绑定顺序：email, purpose, codeHash, CODE_MAX_ATTEMPTS。
 */
export function buildCodeGuardSql(): string {
  return "EXISTS (SELECT 1 FROM verification_codes WHERE email = ? AND purpose = ? AND code_hash = ? AND attempts < ? AND expires_at > datetime('now'))";
}

/** 消费/守卫失败时的错误归类（错码递增计数）。email 须已规范化。 */
export async function classifyCodeFailure(
  db: D1Database,
  email: string,
  purpose: "register" | "reset",
  codeHash: string,
): Promise<CodeConsumptionFailure> {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await db
    .prepare(
      "SELECT id, code_hash, attempts, expires_at > datetime('now') AS alive FROM verification_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(normalizedEmail, purpose)
    .first<{ id: number; code_hash: string; attempts: number; alive: number }>();
  if (!row) return { ok: false, error: "code_not_requested", msg: "请先获取验证码" };
  if (!row.alive) return { ok: false, error: "code_expired", msg: "验证码已过期，请重新获取" };
  if (row.attempts >= CODE_MAX_ATTEMPTS)
    return { ok: false, error: "code_locked", msg: "尝试次数过多，请重新获取验证码" };
  if (codeHash !== row.code_hash) {
    await db
      .prepare("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(row.id)
      .run();
    const left = Math.max(0, CODE_MAX_ATTEMPTS - row.attempts - 1);
    return { ok: false, error: "invalid_code", msg: `验证码错误，还可尝试 ${left} 次` };
  }
  // 对码、行存活、守卫却未生效：并发消费窗口的保守归类
  return { ok: false, error: "code_locked", msg: "验证码状态已变化，请重新获取" };
}

export type CodeConsumption =
  | { ok: true }
  | {
      ok: false;
      error: "code_not_requested" | "code_expired" | "code_locked" | "invalid_code";
      msg: string;
    };

/**
 * 条件消费一个邮箱验证码。错误归类来自消费前的一次读取；真正的消费由
 * 带 code_hash/attempts/expiry 的条件 DELETE 完成，并发下恰好一个请求成功。
 */
export async function consumeVerificationCode(
  db: D1Database,
  email: string,
  purpose: "register" | "reset",
  code: string,
): Promise<CodeConsumption> {
  const normalizedEmail = email.trim().toLowerCase();
  // 码值去空白：复制粘贴/字距产生的空白不再把对码打成错码。
  const codeHash = await sha256Hex(code.replace(/\s+/g, ""));
  const row = await db
    .prepare(
      "SELECT id, code_hash, attempts, expires_at > datetime('now') AS alive FROM verification_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1",
    )
    .bind(normalizedEmail, purpose)
    .first<{ id: number; code_hash: string; attempts: number; alive: number }>();
  if (!row) return { ok: false, error: "code_not_requested", msg: "请先获取验证码" };
  if (!row.alive) return { ok: false, error: "code_expired", msg: "验证码已过期，请重新获取" };
  if (row.attempts >= CODE_MAX_ATTEMPTS)
    return { ok: false, error: "code_locked", msg: "尝试次数过多，请重新获取验证码" };
  const del = await db
    .prepare(
      "DELETE FROM verification_codes WHERE id = ? AND code_hash = ? AND attempts < ? AND expires_at > datetime('now')",
    )
    .bind(row.id, codeHash, CODE_MAX_ATTEMPTS)
    .run();
  if (del.meta.changes === 1) return { ok: true };
  if (codeHash !== row.code_hash) {
    // 错码：按 id 递增尝试计数；行若刚被并发删掉，这次 UPDATE 空转也无害。
    await db
      .prepare("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(row.id)
      .run();
    const left = Math.max(0, CODE_MAX_ATTEMPTS - row.attempts - 1);
    return { ok: false, error: "invalid_code", msg: `验证码错误，还可尝试 ${left} 次` };
  }
  // 对码但条件删除失败 = 另一并发请求刚刚消费/锁定/过期了这一行：有界回读归类。
  const after = await db
    .prepare(
      "SELECT attempts, expires_at > datetime('now') AS alive FROM verification_codes WHERE id = ?",
    )
    .bind(row.id)
    .first<{ attempts: number; alive: number }>();
  if (!after) return { ok: false, error: "code_not_requested", msg: "请先获取验证码" };
  if (!after.alive) return { ok: false, error: "code_expired", msg: "验证码已过期，请重新获取" };
  return { ok: false, error: "code_locked", msg: "尝试次数过多，请重新获取验证码" };
}

export type ExchangeConsumption =
  { ok: true; token: string; email: string; nickname: string | null } | { ok: false };

/** 一次性消费 OAuth exchange：条件 DELETE 报告 changes===1 的调用方独占 token。 */
export async function consumeOAuthExchange(
  db: D1Database,
  code: string,
): Promise<ExchangeConsumption> {
  const row = await db
    .prepare(
      "SELECT token, email, nickname FROM oauth_exchanges WHERE code = ? AND expires_at > datetime('now')",
    )
    .bind(code)
    .first<{ token: string; email: string; nickname: string | null }>();
  if (!row) return { ok: false };
  const del = await db
    .prepare("DELETE FROM oauth_exchanges WHERE code = ? AND expires_at > datetime('now')")
    .bind(code)
    .run();
  if (del.meta.changes !== 1) return { ok: false };
  return { ok: true, token: row.token, email: row.email, nickname: row.nickname };
}

export interface OAuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Google userinfo 解析：`email_verified === true` 是官方「该邮箱已验证」的唯一表达，
 * 字段缺失不再视为已验证（防异常 provider 响应把未验证邮箱并号到已有账号）。
 */
export function parseGoogleUser(data: unknown): OAuthUser | null {
  const d = data as { id?: string; email?: string; email_verified?: boolean };
  if (!d.id || !d.email || d.email_verified !== true) return null;
  return { id: d.id, email: d.email, emailVerified: true };
}
