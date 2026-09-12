import type { Env } from "./index";

/** 记录一条管理操作审计日志。审计失败绝不阻断操作本身。 */
export async function recordAudit(env: Env, action: string, detail: string, request: Request): Promise<void> {
  if (!env.DB) return;
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    await env.DB.prepare("INSERT INTO admin_audit (action, detail, ip) VALUES (?, ?, ?)")
      .bind(action.slice(0, 80), detail.slice(0, 500) || null, ip)
      .run();
  } catch { /* audit must never break the operation */ }
}
