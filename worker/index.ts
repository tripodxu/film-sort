import { buildOgMeta, buildPlazaTags, buildShareTags, injectOg, type OgTags } from "./og";
import { RATE_WINDOW_MS } from "./rateWindow";
import { MAX_PAYLOAD_BYTES } from "../shared/storedItem";
import { accountRoute, getUserFromToken } from "./account";
import { plazaRoute } from "./plaza";
import { importRoute } from "./import";
import { generationOf, isCacheScope, purgeCaches, refreshGenerations } from "./cachePurge";
import { ApiLogQueue } from "./apiLog";
import { resolveStoredPosterUrls } from "./posterStore";
import {
  HttpError,
  MAX_REQUEST_BYTES,
  allowUpstreamRequest,
  assertSameOrigin,
  cleanOptionalInteger,
  cleanString,
  csvCell,
  isObject,
  json,
  parseContentLength,
  readJson,
  withSecurityHeaders,
  type Env,
  type JsonObject,
} from "./http";
import { handleAdminRoutes } from "./routes/admin";
import { handleAiRoutes } from "./routes/aiRoutes";
import { handleMediaRoutes } from "./routes/mediaRoutes";
import { handleQrRoutes } from "./routes/qrRoutes";
import { handleShareRoutes } from "./routes/shareRoutes";

export { csvCell, type Env };

// Analytics event whitelist — only product interaction metrics, never personal movie data.
const EVENT_NAMES = new Set([
  "ranking_started",
  "ranking_completed",
  "comparison_made",
  "import_started",
  "import_completed",
  "share_exported",
  "share_opened",
  "compare_opened",
  "ai_insight_generated",
  "profile_exported",
]);

const EVENT_PAYLOAD_KEYS = new Set([
  "mode",
  "category",
  "source",
  "comparison_count",
  "item_count",
  "top_k",
  "format",
  "provider",
  "tab",
]);

const STRING_PAYLOAD_KEYS = new Set(["mode", "category", "source", "format", "provider", "tab"]);
const NUMBER_PAYLOAD_KEYS = new Set(["comparison_count", "item_count", "top_k"]);
const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_EVENT_PAYLOAD_BYTES = 2 * 1024;

// ===== API Logging (batched) =====
// 日志队列独立于路由：flush 的承诺必须能交给每个请求的 ctx.waitUntil，
// 否则 5 秒后的 D1 写入没人等它（worker/apiLog.ts 的修复说明）。
const apiLogs = new ApiLogQueue();

function logApiCall(
  ctx: ExecutionContext,
  env: Env | undefined,
  path: string,
  method: string,
  status: number,
  durationMs: number,
  source: string,
  error?: string,
  ip?: string,
): void {
  if (!env?.DB) return;
  apiLogs.enqueue(ctx, env.DB, [
    path,
    method,
    status,
    durationMs,
    source,
    error ?? null,
    ip ?? null,
  ]);
}

function validateEventPayload(value: unknown): JsonObject {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) {
    throw new HttpError(400, "invalid_payload", "payload must be an object.");
  }

  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (!EVENT_PAYLOAD_KEYS.has(key)) {
      throw new HttpError(400, "private_payload_field", `payload.${key} is not collected.`);
    }
    if (STRING_PAYLOAD_KEYS.has(key)) {
      output[key] = cleanString(item, `payload.${key}`, 100);
    } else if (NUMBER_PAYLOAD_KEYS.has(key)) {
      output[key] = cleanOptionalInteger(item, `payload.${key}`, 0, 10000);
    }
  }

  const encoded = JSON.stringify(output);
  if (new TextEncoder().encode(encoded).byteLength > MAX_EVENT_PAYLOAD_BYTES) {
    throw new HttpError(413, "payload_too_large", "Event payload is too large.");
  }
  return output;
}

async function createEvent(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const body = await readJson(request);
  const eventName = cleanString(body.event_name, "event_name", 64);
  const sessionId = cleanString(body.session_id, "session_id", 64);

  if (!EVENT_NAMES.has(eventName)) {
    throw new HttpError(400, "event_not_allowed", "Unknown analytics event.");
  }
  if (!SESSION_ID.test(sessionId)) {
    throw new HttpError(
      400,
      "invalid_session_id",
      "session_id must be an anonymous random identifier.",
    );
  }

  const payload = validateEventPayload(body.payload);
  if (!env.DB) {
    return json({ accepted: false, stored: false, reason: "analytics_unavailable" }, 202);
  }

  try {
    await env.DB.prepare(
      "INSERT INTO analytics_events (event_name, session_id, payload) VALUES (?, ?, ?)",
    )
      .bind(eventName, sessionId, JSON.stringify(payload))
      .run();
    return json({ accepted: true, stored: true }, 202);
  } catch (error) {
    console.error("analytics insert failed", error instanceof Error ? error.message : error);
    return json({ accepted: false, stored: false, reason: "analytics_unavailable" }, 202);
  }
}

interface StatsRow {
  completed_total: number | string | null;
  completed_today: number | string | null;
  average_comparisons: number | string | null;
}

async function getStats(env: Env): Promise<Response> {
  const emptyStats = {
    available: false,
    completed_total: 0,
    completed_today: 0,
    average_comparisons: 0,
  };
  if (!env.DB) return json(emptyStats, 200, { "cache-control": "public, max-age=60" });

  try {
    const row = await env.DB.prepare(
      `SELECT
        COUNT(*) AS completed_total,
        COUNT(CASE WHEN created_at >= datetime('now', 'start of day') THEN 1 END) AS completed_today,
        ROUND(AVG(CAST(json_extract(payload, '$.comparison_count') AS REAL)), 1) AS average_comparisons
      FROM analytics_events
      WHERE event_name = 'ranking_completed'`,
    ).first<StatsRow>();

    return json(
      {
        available: true,
        completed_total: Number(row?.completed_total ?? 0),
        completed_today: Number(row?.completed_today ?? 0),
        average_comparisons: Number(row?.average_comparisons ?? 0),
      },
      200,
      { "cache-control": "public, max-age=60" },
    );
  } catch (error) {
    console.error("stats query failed", error instanceof Error ? error.message : error);
    return json(emptyStats, 200, { "cache-control": "public, max-age=30" });
  }
}

const CONTENT_HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]{2,8}$/;

function withAssetCachePolicy(response: Response, request: Request): Response {
  if (response.status !== 200 && response.status !== 304) return response;
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return response;
  }
  const immutable = pathname.startsWith("/assets/") && CONTENT_HASHED_ASSET.test(pathname);
  const next = new Response(response.body, response);
  next.headers.set(
    "cache-control",
    immutable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
  );
  return next;
}

async function serveAssets(request: Request, env: Env): Promise<Response> {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === "GET") {
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      const indexUrl = new URL("/", request.url);
      response = await env.ASSETS.fetch(new Request(indexUrl, request));
    }
  }
  return withSecurityHeaders(withAssetCachePolicy(response, request));
}

/**
 * 分享页(/share/:code)与广场帖(/plaza/:id)的 OG 卡片:爬虫不发 JS,给
 * HTML 请求注入 og:/twitter: 元数据,聊天预览从裸链接变卡片。任何 DB/解析
 * 异常都降级为无 OG 的普通 SPA——OG 是增强,永不阻塞页面本身。
 */
async function serveOgHtml(request: Request, env: Env): Promise<Response | null> {
  if (!env.DB || request.method !== "GET") return null;
  const url = new URL(request.url);
  const shareMatch = url.pathname.match(/^\/share\/([A-Za-z0-9]{1,20})$/);
  const plazaMatch = url.pathname.match(/^\/plaza\/(\d+)$/);
  if (!shareMatch && !plazaMatch) return null;
  let tags: OgTags | null = null;
  try {
    if (shareMatch) {
      const row = await env.DB.prepare(
        "SELECT profile FROM shared_links WHERE code = ? AND julianday(expires_at) > julianday('now')",
      )
        .bind(shareMatch[1])
        .first<{ profile: string }>();
      if (row) tags = buildShareTags(row.profile, url.toString());
    } else if (plazaMatch) {
      const row = await env.DB.prepare(
        `SELECT p.collection_title, p.kind, p.item_count, p.post_type, json_extract(p.items, '$[0]') AS first_item, u.nickname
         FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id
         WHERE p.id = ? AND p.is_public = 1`,
      )
        .bind(Number(plazaMatch[1]))
        .first<{
          collection_title: string;
          kind: string;
          item_count: number;
          post_type: string;
          first_item: string | null;
          nickname: string | null;
        }>();
      if (row) {
        let topWork: { title?: unknown; subtitle?: unknown; year?: unknown } | null = null;
        try {
          if (row.first_item) {
            const first = JSON.parse(row.first_item) as Record<string, unknown>;
            topWork =
              row.post_type === "profile" && Array.isArray(first.items)
                ? ((first.items as Array<Record<string, unknown>>)[0] ?? null)
                : first;
          }
        } catch {
          /* items 畸形 → 无海报降级 */
        }
        let topPosterUrl: string | null = null;
        if (topWork) {
          try {
            const resolved = await resolveStoredPosterUrls(env.DB, row.kind, [topWork]);
            topPosterUrl = resolved[0]?.[0] ?? null;
          } catch {
            /* 海报解析失败只影响图片 */
          }
        }
        tags = buildPlazaTags(
          { ...row, items: row.first_item ? `[${row.first_item}]` : "[]", topPosterUrl },
          url.toString(),
          url.origin,
        );
      }
    }
  } catch {
    return null;
  }
  if (!tags) return null;
  tags.url = url.toString();
  let page: Response;
  try {
    page = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    if (!page.ok) return null;
  } catch {
    return null;
  }
  const html = injectOg(await page.text(), buildOgMeta(tags));
  return withSecurityHeaders(
    new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    }),
  );
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return json({ error: "cross_origin_forbidden" }, 405, { allow: "GET, POST" });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    const checks: Record<string, string> = { storage: env.DB ? "d1" : "disabled" };
    let healthy = true;
    if (env.DB) {
      try {
        await env.DB.prepare("SELECT 1").first();
        checks.database = "ok";
      } catch {
        checks.database = "error";
        healthy = false;
      }
    }
    return json(
      { ok: healthy, version: "2.0.0", timestamp: new Date().toISOString(), checks },
      healthy ? 200 : 503,
      { "cache-control": "no-store" },
    );
  }
  if (url.pathname === "/api/events" && request.method === "POST") {
    if (!(await allowUpstreamRequest(request, "events", 120)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    return createEvent(request, env);
  }
  if (url.pathname === "/api/stats" && request.method === "GET") {
    return getStats(env);
  }
  if (url.pathname === "/api/poster-errors/client" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "other", 120)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    if (!env.DB) return json({ stored: false }, 202);
    const body = await readJson(request);
    const title = cleanString(body.title, "title", 160);
    const type = cleanString(body.type, "type", 16);
    const error = cleanString(body.error, "error", 80);
    if (!["film", "book", "music", "other"].includes(type))
      return json({ error: "invalid_type" }, 400);
    await env.DB.prepare(
      "INSERT INTO poster_errors (title, media_type, error, source) VALUES (?, ?, ?, ?)",
    )
      .bind(title, type === "film" ? "movie" : type, error, "client")
      .run();
    return json({ stored: true }, 202);
  }

  const adminResponse = await handleAdminRoutes(url, request, env);
  if (adminResponse) return adminResponse;

  // NOTE: handleMediaRoutes MUST run before handleQrRoutes so /api/douban/top250,
  // /api/douban/books/*, /api/douban/music/*, and /api/douban/suggest match before
  // the /api/douban/* QR/cookie prefix handler.
  const mediaResponse = await handleMediaRoutes(url, request, env);
  if (mediaResponse) return mediaResponse;

  const aiResponse = await handleAiRoutes(url, request, env);
  if (aiResponse) return aiResponse;

  if (url.pathname === "/api/cache/clear" && request.method === "POST") {
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "cache", 5)))
      return json({ error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const cacheUser = await getUserFromToken(request, env.DB);
    if (!cacheUser)
      return json({ error: "authentication_required", msg: "登录后才能清除服务端缓存" }, 401);
    const body = await readJson(request);
    if (!isCacheScope(body.scope)) return json({ error: "invalid_scope" }, 400);
    await refreshGenerations(env.DB);
    const result = await purgeCaches(env.DB, body.scope);
    return json({ ok: true, scope: body.scope, ...result });
  }
  if (url.pathname === "/api/auth/config") return json({ enabled: Boolean(env.DB) });

  const qrResponse = await handleQrRoutes(url, request, env);
  if (qrResponse) return qrResponse;

  if (url.pathname.startsWith("/api/import/")) {
    if (!(await allowUpstreamRequest(request, "import", 8, env.DB)))
      return json({ error: "rate_limited", msg: "导入过于频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    return withSecurityHeaders(await importRoute(request, env));
  }
  if (url.pathname.startsWith("/api/plaza/") || url.pathname.startsWith("/api/comments/")) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      assertSameOrigin(request);
      const bulkWrite =
        (url.pathname === "/api/plaza/posts" && request.method === "POST") ||
        (url.pathname.startsWith("/api/plaza/posts/") && request.method === "PUT");
      parseContentLength(request, bulkWrite ? MAX_PAYLOAD_BYTES : MAX_REQUEST_BYTES);
      if (!(await allowUpstreamRequest(request, "plaza_write", 30, env.DB)))
        return withSecurityHeaders(json({ error: "rate_limited" }, 429, { "retry-after": "600" }));
    }
    return withSecurityHeaders(await plazaRoute(request, env));
  }
  if (url.pathname.startsWith("/api/account/")) {
    if (request.method !== "GET") {
      assertSameOrigin(request);
      const bulkWrite =
        (url.pathname === "/api/account/profile" && request.method === "PUT") ||
        (url.pathname === "/api/account/collections" && request.method === "POST");
      parseContentLength(request, bulkWrite ? MAX_PAYLOAD_BYTES : MAX_REQUEST_BYTES);
      const authWrite =
        url.pathname === "/api/account/register" ||
        url.pathname === "/api/account/login" ||
        url.pathname === "/api/account/oauth/exchange" ||
        url.pathname === "/api/account/send-code" ||
        url.pathname === "/api/account/change-password";
      const bucket = authWrite ? "account_auth" : "account";
      const limit = authWrite ? 8 : 30;
      if (!(await allowUpstreamRequest(request, bucket, limit, env.DB)))
        return withSecurityHeaders(json({ error: "rate_limited" }, 429, { "retry-after": "600" }));
    }
    return withSecurityHeaders(await accountRoute(request, env));
  }

  const shareResponse = await handleShareRoutes(url, request, env);
  if (shareResponse) return shareResponse;

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "not_found" }, 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const ogResponse = await serveOgHtml(request, env);
  if (ogResponse) return ogResponse;
  return serveAssets(request, env);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const isApi = path.startsWith("/api/") && !path.startsWith("/api/admin/");
    if (env.DB && request.method === "GET") {
      ctx.waitUntil(refreshGenerations(env.DB).catch(() => undefined));
    }
    const t0 = Date.now();
    let response: Response;
    let error: string | undefined;

    try {
      const posterRoutes = ["/api/posters", "/api/image"];
      const miscRoutes = [
        "/api/douban/top250",
        "/api/douban/books/top250",
        "/api/douban/music/top250",
        "/api/douban/suggest",
        "/api/douban/books/suggest",
      ];
      const isPosterCacheRoute = request.method === "GET" && posterRoutes.includes(path);
      const isMiscCacheRoute = request.method === "GET" && miscRoutes.includes(path);
      const cacheable = isPosterCacheRoute || isMiscCacheRoute;
      const cacheScope = isPosterCacheRoute ? "posters" : "misc";
      const edgeKey = cacheable
        ? new Request(
            `https://route-cache.art-rank.internal/${generationOf(cacheScope)}${url.pathname}${url.search}`,
          )
        : null;
      const edgeCache =
        cacheable && edgeKey && typeof caches !== "undefined"
          ? (caches as unknown as { default: Cache }).default
          : null;
      if (edgeCache && edgeKey) {
        const hit = await edgeCache.match(edgeKey);
        if (hit) {
          if (isApi)
            logApiCall(ctx, env, path, request.method, hit.status, Date.now() - t0, "cache");
          return hit;
        }
      }
      response = await route(request, env);
      if (edgeCache && edgeKey && response.ok)
        ctx.waitUntil(edgeCache.put(edgeKey, response.clone()));
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ error: err.code, message: err.message }, err.status);
        error = err.message;
      } else {
        console.error("unhandled worker error", err instanceof Error ? err.stack : err);
        response = json({ error: "internal_error" }, 500);
        error = err instanceof Error ? err.message : "unknown";
      }
    }

    if (isApi) {
      const duration = Date.now() - t0;
      const ip =
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "";
      logApiCall(
        ctx,
        env,
        path,
        request.method,
        response.status,
        duration,
        response.status >= 400 ? "error" : "ok",
        error,
        ip,
      );
    }

    return response;
  },

  async scheduled(_event, env) {
    if (!env.DB) return;
    try {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM analytics_events WHERE created_at < datetime('now', '-90 days')",
        ),
        env.DB.prepare("DELETE FROM api_logs WHERE created_at < datetime('now', '-90 days')"),
        env.DB.prepare("DELETE FROM poster_errors WHERE created_at < datetime('now', '-180 days')"),
        env.DB.prepare("DELETE FROM admin_sessions WHERE julianday(expires_at) < julianday('now')"),
        env.DB.prepare("DELETE FROM user_sessions WHERE julianday(expires_at) < julianday('now')"),
        env.DB.prepare(
          "DELETE FROM oauth_exchanges WHERE julianday(expires_at) < julianday('now')",
        ),
        env.DB.prepare(
          "DELETE FROM qr_transactions WHERE julianday(expires_at) <= julianday('now')",
        ),
        env.DB.prepare("DELETE FROM shared_links WHERE julianday(expires_at) < julianday('now')"),
        env.DB.prepare(
          "DELETE FROM verification_codes WHERE created_at < datetime('now', '-1 day')",
        ),
        env.DB.prepare(
          "DELETE FROM poster_batch_stats WHERE created_at < datetime('now', '-90 days')",
        ),
        env.DB.prepare("DELETE FROM rate_limits WHERE started_at < ?").bind(
          Date.now() - RATE_WINDOW_MS,
        ),
      ]);
    } catch (error) {
      console.error("scheduled cleanup failed", error instanceof Error ? error.message : error);
    }
  },
} satisfies ExportedHandler<Env>;
