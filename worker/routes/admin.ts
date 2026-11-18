import {
  accountRoute,
  hashPasswordStrong,
  needsPasswordUpgrade,
  timingSafeEqual,
  verifyPassword,
} from "../account";
import { promptOverrideKey, readPromptOverride, type AiScene } from "../ai";
import { recordAudit } from "../audit";
import {
  generationOf,
  isCacheScope,
  purgeCaches,
  PURGEABLE_SCOPES,
  refreshGenerations,
  type CacheScope,
} from "../cachePurge";
import { DASHBOARD_HTML, DASHBOARD_JS } from "../dashboardHtml";
import {
  ADMIN_SECURITY_HEADERS,
  adminAuth,
  allowUpstreamRequest,
  cleanOptionalString,
  cleanString,
  csvCell,
  generateToken,
  getAdminToken,
  json,
  readJson,
  withSecurityHeaders,
  type Env,
} from "../http";
import { adminPlazaRoute } from "../plaza";

const STORAGE_CORE_TABLES = [
  "analytics_events",
  "api_logs",
  "user_accounts",
  "user_sessions",
  "user_profiles_v2",
  "challenge_sets",
  "user_collections",
];
const STORAGE_EXTENDED_TABLES = [
  "plaza_posts",
  "plaza_comments",
  "plaza_likes",
  "shared_links",
  "poster_errors",
  "poster_batch_stats",
  "admin_sessions",
  "admin_audit",
  "oauth_exchanges",
  "user_oauth",
];

async function countTables(
  db: D1Database,
  tables: string[],
): Promise<Array<{ tbl: string; cnt: number }>> {
  try {
    const results = await db.batch(
      tables.map((t) => db.prepare(`SELECT COUNT(*) AS cnt FROM ${t}`)),
    );
    return tables.map((t, i) => ({
      tbl: t,
      cnt: Number((results[i]?.results?.[0] as { cnt?: number } | undefined)?.cnt ?? 0),
    }));
  } catch (error) {
    console.error("dashboard query failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

async function getDashboard(env: Env): Promise<Response> {
  if (!env.DB) return json({ available: false }, 200, { "cache-control": "public, max-age=60" });
  try {
    const safe = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch((err) => {
        console.error("dashboard query failed:", err instanceof Error ? err.message : err);
        return fallback;
      });
    const safeAll = (p: Promise<{ results?: unknown[] }>) =>
      p.catch((err) => {
        console.error("dashboard query failed:", err instanceof Error ? err.message : err);
        return { results: [] };
      });

    const [
      overview,
      daily,
      modes,
      recentEvents,
      apiLogs,
      apiErrors,
      accounts,
      storageInfo,
      storageExtended,
      posterErrors,
      posterErrorSummary,
      posterBatchStats,
    ] = await Promise.all([
      safe(
        env.DB.prepare(
          `SELECT
        COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS total_visits,
        COUNT(CASE WHEN event_name = 'visit' AND created_at >= datetime('now', '-7 days') THEN 1 END) AS visits_7d,
        COUNT(CASE WHEN event_name = 'visit' AND created_at >= datetime('now', 'start of day') THEN 1 END) AS visits_today,
        COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS total_completed,
        COUNT(CASE WHEN event_name = 'ranking_completed' AND created_at >= datetime('now', '-7 days') THEN 1 END) AS completed_7d,
        COUNT(CASE WHEN event_name = 'ranking_completed' AND created_at >= datetime('now', 'start of day') THEN 1 END) AS completed_today,
        ROUND(AVG(CASE WHEN event_name = 'ranking_completed' THEN CAST(json_extract(payload, '$.comparison_count') AS REAL) END), 1) AS avg_comparisons,
        ROUND(AVG(CASE WHEN event_name = 'ranking_completed' THEN CAST(json_extract(payload, '$.item_count') AS REAL) END), 1) AS avg_items,
        COUNT(DISTINCT CASE WHEN event_name = 'visit' THEN session_id END) AS unique_sessions
      FROM analytics_events`,
        ).first(),
        null,
      ),
      safeAll(
        env.DB.prepare(
          `SELECT
        strftime('%Y-%m-%d', created_at) AS date,
        COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS visits,
        COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS completions
      FROM analytics_events WHERE created_at >= datetime('now', '-14 days') GROUP BY date ORDER BY date DESC LIMIT 14`,
        ).all(),
      ),
      safeAll(
        env.DB.prepare(
          `SELECT json_extract(payload, '$.mode') AS mode, COUNT(*) AS count
      FROM analytics_events WHERE event_name = 'ranking_completed' AND json_extract(payload, '$.mode') IS NOT NULL GROUP BY mode ORDER BY count DESC`,
        ).all(),
      ),
      safeAll(
        env.DB.prepare(
          `SELECT event_name, json_extract(payload, '$.mode') AS mode, json_extract(payload, '$.item_count') AS item_count, json_extract(payload, '$.comparison_count') AS comparison_count, created_at
      FROM analytics_events ORDER BY created_at DESC LIMIT 20`,
        ).all(),
      ),
      safeAll(
        env.DB.prepare(
          `SELECT id, path, method, status, duration_ms, source, error, created_at FROM api_logs ORDER BY created_at DESC LIMIT 30`,
        ).all(),
      ),
      safeAll(
        env.DB.prepare(
          `SELECT id, path, method, status, duration_ms, source, error, created_at FROM api_logs WHERE status >= 400 ORDER BY created_at DESC LIMIT 20`,
        ).all(),
      ),
      safeAll(
        env.DB.prepare(
          `SELECT id, email, nickname, disabled_at, created_at FROM user_accounts ORDER BY created_at DESC LIMIT 50`,
        ).all(),
      ),
      safe(countTables(env.DB, STORAGE_CORE_TABLES), []),
      safe(countTables(env.DB, STORAGE_EXTENDED_TABLES), []),
      safeAll(
        env.DB.prepare(
          "SELECT id, title, media_type, error, source, created_at FROM poster_errors WHERE created_at >= datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 50",
        ).all(),
      ),
      safeAll(
        env.DB.prepare(
          "SELECT media_type, source, error, COUNT(*) AS count FROM poster_errors WHERE created_at >= datetime('now', '-30 days') GROUP BY media_type, source, error ORDER BY count DESC LIMIT 30",
        ).all(),
      ),
      safe(
        env.DB.prepare(
          `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(found), 0) AS found,
        COALESCE(SUM(absent), 0) AS absent, COALESCE(SUM(throttled), 0) AS throttled
      FROM poster_batch_stats WHERE created_at >= datetime('now', '-7 days')`,
        ).first(),
        null,
      ),
    ]);

    return json(
      {
        available: true,
        timestamp: new Date().toISOString(),
        overview: {
          total_visits: Number((overview as Record<string, unknown>)?.total_visits ?? 0),
          visits_7d: Number((overview as Record<string, unknown>)?.visits_7d ?? 0),
          visits_today: Number((overview as Record<string, unknown>)?.visits_today ?? 0),
          total_completed: Number((overview as Record<string, unknown>)?.total_completed ?? 0),
          completed_7d: Number((overview as Record<string, unknown>)?.completed_7d ?? 0),
          completed_today: Number((overview as Record<string, unknown>)?.completed_today ?? 0),
          avg_comparisons: Number((overview as Record<string, unknown>)?.avg_comparisons ?? 0),
          avg_items: Number((overview as Record<string, unknown>)?.avg_items ?? 0),
          unique_sessions: Number((overview as Record<string, unknown>)?.unique_sessions ?? 0),
          completion_rate:
            Number((overview as Record<string, unknown>)?.total_visits ?? 0) > 0
              ? Math.round(
                  (Number((overview as Record<string, unknown>)?.total_completed ?? 0) /
                    Number((overview as Record<string, unknown>)?.total_visits ?? 0)) *
                    100,
                )
              : 0,
        },
        daily: (daily as { results?: unknown[] }).results ?? [],
        modes: (modes as { results?: unknown[] }).results ?? [],
        recent_events: (recentEvents as { results?: unknown[] }).results ?? [],
        api_logs: (apiLogs as { results?: unknown[] }).results ?? [],
        api_errors: (apiErrors as { results?: unknown[] }).results ?? [],
        accounts: (accounts as { results?: unknown[] }).results ?? [],
        storage: Array.isArray(storageInfo) ? storageInfo : [],
        storage_extended: (storageExtended as { results?: unknown[] })?.results ?? [],
        poster_errors: (posterErrors as { results?: unknown[] }).results ?? [],
        poster_error_summary: (posterErrorSummary as { results?: unknown[] }).results ?? [],
        poster_batch_stats: (posterBatchStats as Record<string, unknown> | null) ?? null,
      },
      200,
      { "cache-control": "private, no-store" },
    );
  } catch (error) {
    console.error("dashboard query failed", error instanceof Error ? error.message : error);
    return json({ available: false, error: "query failed" }, 200, {
      "cache-control": "private, no-store",
    });
  }
}

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD && !env.DB) return json({ error: "auth_unavailable" }, 503);
  const body = await readJson(request);
  const password = cleanString(body.password, "password", 128);

  if (env.ADMIN_PASSWORD) {
    if (!timingSafeEqual(password, env.ADMIN_PASSWORD))
      return json({ error: "invalid_password" }, 401);
  } else {
    if (!env.DB) return json({ error: "auth_unavailable" }, 503);
    const stored = await env.DB.prepare(
      "SELECT value FROM admin_config WHERE key = 'password_hash'",
    ).first<{ value: string }>();
    if (!stored?.value) return json({ error: "no_password_configured" }, 503);
    if (!(await verifyPassword(password, stored.value)))
      return json({ error: "invalid_password" }, 401);
    if (needsPasswordUpgrade(stored.value)) {
      await env.DB.prepare("UPDATE admin_config SET value = ? WHERE key = 'password_hash'")
        .bind(await hashPasswordStrong(password))
        .run()
        .catch(() => undefined);
    }
  }

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
    .bind(token, expires)
    .run();
  await env.DB.prepare(
    "DELETE FROM admin_sessions WHERE julianday(expires_at) < julianday('now')",
  ).run();
  return json({ token, expires });
}

async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  const token = getAdminToken(request);
  if (token && env.DB) {
    await env.DB.prepare("DELETE FROM admin_sessions WHERE token = ?").bind(token).run();
  }
  return json({ ok: true });
}

async function handleAdminCheck(request: Request, env: Env): Promise<Response> {
  const authed = await adminAuth(request, env);
  return json({ authenticated: authed });
}

const RESET_SCOPES: Record<string, { label: string; tables: string[]; statements: string[] }> = {
  analytics: {
    label: "运行数据（分析事件/API日志/海报错误）",
    tables: ["analytics_events", "api_logs", "poster_errors"],
    statements: [
      "DELETE FROM analytics_events",
      "DELETE FROM api_logs",
      "DELETE FROM poster_errors",
    ],
  },
  plaza: {
    label: "广场内容（帖子/点赞/评论/编辑历史）",
    tables: ["plaza_post_edits", "plaza_posts", "plaza_likes", "plaza_comments"],
    statements: [
      "DELETE FROM plaza_post_edits",
      "DELETE FROM plaza_comments",
      "DELETE FROM plaza_likes",
      "DELETE FROM plaza_posts",
    ],
  },
  shares: { label: "分享短链", tables: ["shared_links"], statements: ["DELETE FROM shared_links"] },
  accounts: {
    label: "全部用户账户及用户内容（画像/清单/会话/OAuth/广场/分享）",
    tables: [
      "user_accounts",
      "user_profiles_v2",
      "user_collections",
      "user_sessions",
      "user_oauth",
      "plaza_posts",
      "plaza_likes",
      "plaza_comments",
      "shared_links",
    ],
    statements: [
      "DELETE FROM qr_transactions",
      "DELETE FROM user_sessions",
      "DELETE FROM user_oauth",
      "DELETE FROM user_cookie_vault",
      "DELETE FROM user_profiles_v2",
      "DELETE FROM user_collections",
      "DELETE FROM plaza_post_edits",
      "DELETE FROM plaza_comments",
      "DELETE FROM plaza_likes",
      "DELETE FROM plaza_posts",
      "DELETE FROM shared_links",
      "DELETE FROM user_accounts",
    ],
  },
};

async function reverifyAdminPassword(env: Env, password: string): Promise<boolean> {
  if (env.ADMIN_PASSWORD) return timingSafeEqual(password, env.ADMIN_PASSWORD);
  if (!env.DB) return false;
  const stored = await env.DB.prepare(
    "SELECT value FROM admin_config WHERE key = 'password_hash'",
  ).first<{ value: string }>();
  return stored?.value ? verifyPassword(password, stored.value) : false;
}

async function handleAdminReset(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  if (!(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
  const body = await readJson(request);
  const scope = cleanString(body.scope, "scope", 32);
  const confirm = cleanOptionalString(body.confirm, "confirm", 20) ?? "";
  const password = cleanOptionalString(body.password, "password", 128) ?? "";
  const config = RESET_SCOPES[scope];
  if (!config) return json({ error: "invalid_scope" }, 400);
  if (confirm !== "RESET")
    return json({ error: "confirm_required", msg: "请输入确认短语 RESET" }, 400);
  if (!password || !(await reverifyAdminPassword(env, password)))
    return json({ error: "password_required", msg: "管理员密码验证失败" }, 401);

  const db = env.DB;
  await db.batch(config.statements.map((sql) => db.prepare(sql)));
  await recordAudit(env, `reset:${scope}`, `一键重置 [${scope}] ${config.label}`, request);
  return json({ ok: true, scope, cleared: config.tables });
}

async function handleAdminChangePassword(request: Request, env: Env): Promise<Response> {
  if (env.ADMIN_PASSWORD)
    return json(
      { error: "env_password_immutable", msg: "当前使用环境变量密码，请在 Cloudflare 设置中修改" },
      400,
    );
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const body = await readJson(request);
  const oldPassword = cleanOptionalString(body.old_password, "old_password", 128) ?? "";
  const newPassword = cleanOptionalString(body.new_password, "new_password", 128) ?? "";
  if (!newPassword || newPassword.length < 10)
    return json({ error: "invalid_password", msg: "新密码至少10位" }, 400);
  const stored = await env.DB.prepare(
    "SELECT value FROM admin_config WHERE key = 'password_hash'",
  ).first<{ value: string }>();
  if (!stored?.value) return json({ error: "no_password_configured" }, 503);
  if (!oldPassword || !(await verifyPassword(oldPassword, stored.value)))
    return json({ error: "invalid_credentials", msg: "旧密码错误" }, 401);
  await env.DB.prepare("UPDATE admin_config SET value = ? WHERE key = 'password_hash'")
    .bind(await hashPasswordStrong(newPassword))
    .run();
  const revoked = await env.DB.prepare("DELETE FROM admin_sessions").run();
  await recordAudit(
    env,
    "admin:change_password",
    `修改管理后台密码（吊销 ${revoked.meta?.changes ?? 0} 个管理会话）`,
    request,
  );
  return json({ ok: true });
}

async function handleAdminAuditList(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100));
  const rows = await env.DB.prepare(
    "SELECT id, action, detail, ip, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return json({ entries: rows.results ?? [] });
}

async function handleAdminRevokeSessions(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const result = await env.DB.prepare("DELETE FROM user_sessions").run();
  await recordAudit(
    env,
    "sessions:revoke_all",
    `强制下线全部用户（清除 ${result.meta?.changes ?? 0} 个会话）`,
    request,
  );
  return json({ ok: true, revoked: result.meta?.changes ?? 0 });
}

async function handleAdminCleanExpiredLinks(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const result = await env.DB.prepare(
    "DELETE FROM shared_links WHERE julianday(expires_at) < julianday('now')",
  ).run();
  await recordAudit(
    env,
    "links:clean_expired",
    `清理过期分享链接 ${result.meta?.changes ?? 0} 条`,
    request,
  );
  return json({ ok: true, deleted: result.meta?.changes ?? 0 });
}

export async function handleAdminRoutes(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
    if (!(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    return getDashboard(env);
  }
  if (url.pathname === "/api/admin/cache/status" && request.method === "GET") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    await refreshGenerations(env.DB);
    const generation: Record<string, string> = {};
    for (const s of PURGEABLE_SCOPES) generation[s] = generationOf(s);
    return json({ ok: true, generation });
  }
  if (url.pathname === "/api/admin/cache/clear" && request.method === "POST") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    const body = await readJson(request);
    const rawScope: unknown = body.scope;
    if (rawScope !== "all" && !isCacheScope(rawScope)) return json({ error: "invalid_scope" }, 400);
    const scope: CacheScope = rawScope;
    await refreshGenerations(env.DB);
    const result = await purgeCaches(env.DB, scope);
    return json({ ok: true, scope, ...result });
  }
  if (url.pathname === "/api/admin/login" && request.method === "POST") {
    if (!(await allowUpstreamRequest(request, "auth", 30, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "300" });
    return handleAdminLogin(request, env);
  }
  if (url.pathname === "/api/admin/logout" && request.method === "POST") {
    return handleAdminLogout(request, env);
  }
  if (url.pathname === "/api/admin/check" && request.method === "GET") {
    return handleAdminCheck(request, env);
  }
  if (url.pathname.startsWith("/api/admin/plaza")) {
    return withSecurityHeaders(await adminPlazaRoute(request, env));
  }
  if (url.pathname === "/api/admin/reset" && request.method === "POST") {
    if (!(await allowUpstreamRequest(request, "auth", 30, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "300" });
    return handleAdminReset(request, env);
  }
  if (url.pathname === "/api/admin/audit" && request.method === "GET") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    return handleAdminAuditList(request, env);
  }
  if (url.pathname === "/api/admin/change-password" && request.method === "POST") {
    if (!(await allowUpstreamRequest(request, "auth", 30, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "300" });
    return handleAdminChangePassword(request, env);
  }
  if (url.pathname === "/api/admin/sessions/revoke-all" && request.method === "POST") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    if (!(await allowUpstreamRequest(request, "auth", 30, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "300" });
    return handleAdminRevokeSessions(request, env);
  }
  if (url.pathname === "/api/admin/links/clean-expired" && request.method === "POST") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    return handleAdminCleanExpiredLinks(request, env);
  }
  if (url.pathname === "/api/admin/accounts" || url.pathname.startsWith("/api/admin/accounts/")) {
    return withSecurityHeaders(await accountRoute(request, env));
  }
  if (url.pathname === "/api/admin/poster-errors" && request.method === "GET") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    const days = Number(url.searchParams.get("days") ?? "7");
    if (!Number.isInteger(days) || days < 1 || days > 365)
      return json({ error: "invalid_days" }, 400);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);
    const errors = await env.DB.prepare(
      "SELECT id, title, media_type, error, source, created_at FROM poster_errors WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT ?",
    )
      .bind(`-${days} days`, limit)
      .all();
    return json({ errors: errors.results ?? [] }, 200, { "cache-control": "no-store" });
  }
  if (url.pathname === "/api/admin/ai/prompts" && request.method === "GET") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    const scenes: AiScene[] = ["ranking", "profile", "compare"];
    const prompts: Record<string, { override: boolean; value: string | null }> = {};
    for (const scene of scenes) {
      const value = await readPromptOverride(env.DB, scene);
      prompts[scene] = { override: !!value, value };
    }
    return json({ prompts });
  }
  const aiPromptMatch = url.pathname.match(/^\/api\/admin\/ai\/prompt\/(ranking|profile|compare)$/);
  if (aiPromptMatch) {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    const scene = aiPromptMatch[1] as AiScene;
    if (request.method === "PUT") {
      const body = await readJson(request);
      const system = cleanOptionalString(body.system, "system", 4000);
      if (!system)
        return json({ error: "invalid_system", msg: "提示词不能为空且不超过 4000 字" }, 400);
      await env.DB.prepare(
        "INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
        .bind(promptOverrideKey(scene), system)
        .run();
      await recordAudit(env, "ai:prompt_override", `设置 AI 提示词覆盖：${scene}`, request);
      return json({ ok: true });
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM admin_config WHERE key = ?")
        .bind(promptOverrideKey(scene))
        .run();
      await recordAudit(env, "ai:prompt_override", `清除 AI 提示词覆盖：${scene}`, request);
      return json({ ok: true });
    }
  }
  if (url.pathname === "/api/admin/logs/clean" && request.method === "POST") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    const body = await readJson(request);
    const table = cleanString(body.table, "table", 20);
    const action = cleanString(body.action, "action", 20);
    const tables = table === "all" ? ["api_logs", "analytics_events", "poster_errors"] : [table];
    if (!tables.every((t) => ["api_logs", "analytics_events", "poster_errors"].includes(t)))
      return json({ error: "invalid_table" }, 400);
    const actions: Record<string, { time: string; op: string }> = {
      delete_all: { time: "", op: "" },
      delete_7d: { time: "datetime('now', '-7 days')", op: "<" },
      delete_24h: { time: "datetime('now', '-1 day')", op: ">=" },
      keep_24h: { time: "datetime('now', '-1 day')", op: "<" },
      delete_1h: { time: "datetime('now', '-1 hour')", op: ">=" },
      keep_1h: { time: "datetime('now', '-1 hour')", op: "<" },
    };
    if (!actions[action]) return json({ error: "invalid_action" }, 400);
    let total = 0;
    for (const tbl of tables) {
      const cfg = actions[action];
      const sql =
        action === "delete_all"
          ? `DELETE FROM ${tbl}`
          : `DELETE FROM ${tbl} WHERE created_at ${cfg.op} ${cfg.time}`;
      const result = await env.DB.prepare(sql).run();
      total += result.meta?.changes ?? 0;
    }
    return json({ ok: true, deleted: total });
  }
  if (url.pathname === "/api/admin/poster-errors/export" && request.method === "GET") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    const days = Number(url.searchParams.get("days") ?? "30");
    if (!Number.isInteger(days) || days < 1 || days > 365)
      return json({ error: "invalid_days" }, 400);
    const errors = await env.DB.prepare(
      "SELECT title, media_type, error, source, created_at FROM poster_errors WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT 5000",
    )
      .bind(`-${days} days`)
      .all();
    const rows = errors.results as Array<{
      title: string;
      media_type: string;
      error: string;
      created_at: string;
    }>;
    const csv =
      "\uFEFF" +
      "title,media_type,error,created_at\n" +
      rows
        .map((r) => [r.title, r.media_type, r.error, r.created_at].map(csvCell).join(","))
        .join("\n");
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="poster-errors-${days}d.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  if (url.pathname === "/admin" && request.method === "GET") {
    return new Response(DASHBOARD_HTML, {
      headers: {
        ...ADMIN_SECURITY_HEADERS,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  if (url.pathname === "/admin/app.js" && request.method === "GET") {
    return new Response(DASHBOARD_JS, {
      headers: {
        ...ADMIN_SECURITY_HEADERS,
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  return null;
}
