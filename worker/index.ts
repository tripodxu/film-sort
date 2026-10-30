import {
  doubanTop250,
  doubanSuggest,
  doubanBookTop250,
  doubanBookSuggest,
  doubanMusicTop250,
  doubanSearch,
  doubanBookDetail,
  doubanMovieDetail,
  fetchContentIntro,
  proxyImage,
  resolvePosters,
  resolvePostersBatch,
  posterMediaKey,
  allowedImage,
  tallyBatchOutcomes,
  type PosterBatchRequest,
} from "./media";
import {
  loadPosterUrls,
  normalizePosterItem,
  normalizeYear,
  posterKeyFor,
  resolveStoredPosterUrls,
  saveResolvedPosters,
} from "./posterStore";
import { buildOgMeta, buildPlazaTags, buildShareTags, injectOg, type OgTags } from "./og";
import { RATE_WINDOW_MS, consumeIsolateWindow, type RateWindow } from "./rateWindow";
import { consumeSharedWindow } from "./rateLimitStore";
import {
  MAX_PAYLOAD_BYTES,
  encodeStoredNotes,
  encodeStoredProfile,
  healStoredProfile,
} from "../shared/storedItem";
import {
  accountRoute,
  hashPasswordStrong,
  needsPasswordUpgrade,
  timingSafeEqual,
  verifyPassword,
} from "./account";
import { getUserFromToken } from "./account";
import { adminPlazaRoute, plazaRoute } from "./plaza";
import { importRoute } from "./import";
import {
  neteaseQrIssue,
  neteaseQrPoll,
  hasProviderCookie,
  deleteProviderCookie,
  saveProviderCookie,
  loadProviderCookie,
  neteaseUserId,
  neteaseAccountInfo,
  neteaseUserPlaylists,
} from "./netease";
import { consumeQrTransaction, getQrTransaction, registerQrTransaction } from "./qrTransactions";
import {
  generationOf,
  isCacheScope,
  purgeCaches,
  PURGEABLE_SCOPES,
  refreshGenerations,
  type CacheScope,
} from "./cachePurge";
import {
  doubanQrIssue,
  doubanQrPoll,
  extractDoubanLoginCookie,
  doubanUserId,
  doubanAccountInfo,
} from "./douban";
import { otherSearch, otherDetail, otherCandidateReport } from "./other";
import { DeadlineError, withDeadline } from "./deadline";
import {
  gdSearch,
  gdPlayUrl,
  gdLyric,
  pickTracks,
  pickTrack,
  stripLrc,
  isCoverTrack,
  lyricNeedsUpstream,
  playNeedsUpstream,
} from "./gdstudio";
import { recordAudit } from "./audit";
import {
  AiError,
  aiErrorPayload,
  aiErrorStatus,
  callAi,
  callModelAuto,
  composePrompt,
  listAiModels,
  promptOverrideKey,
  readPromptOverride,
  resolveEndpoint,
  testAiConnection,
  validateUserConfig,
  type AiProtocol,
  type AiScene,
  type ResolvedAi,
} from "./ai";
import {
  jevChoose,
  jevPick,
  jevRank,
  parseJevChooseBody,
  parseJevPickBody,
  parseJevRankBody,
  testJevConnection,
  validateJevConfig,
} from "./typesafe";

export interface Env {
  DB?: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  AI_API_KEY?: string;
  AI_API_URL?: string;
  AI_MODEL?: string;
  AI_PROTOCOL?: string;
  /** anysearch 搜索服务 key（简介百科传输）；缺省走匿名额度 */
  ANYSEARCH_API_KEY?: string;
  COOKIE_ENC_KEY?: string;
  MUSIC_PROXY_URL?: string;
  MUSIC_PROXY_KEY?: string;
}

type JsonObject = Record<string, unknown>;

const EVENT_NAMES = new Set([
  "visit",
  "list_opened",
  "list_selected",
  "sorting_started",
  "comparison_made",
  "ranking_completed",
  "poster_downloaded",
  "share_copied",
  "result_viewed",
  "qr_viewed",
  "home_content_rendered",
  "experiment_exposed",
  "heavy_config_viewed",
  "default_start_clicked",
  "sorting_scope_reduced",
  "result_share_prompt_clicked",
]);

// Only product metadata may leave the browser. Movie titles, rankings and free text are excluded.
const EVENT_PAYLOAD_KEYS = new Set([
  "app_version",
  "challenge_id",
  "comparison_count",
  "experiment_id",
  "item_count",
  "lang",
  "list_id",
  "mode",
  "source",
  "template_id",
  "top_k",
  "utm_campaign",
  "utm_medium",
  "utm_source",
  "variant_id",
]);

const STRING_PAYLOAD_KEYS = new Set([
  "app_version",
  "challenge_id",
  "experiment_id",
  "lang",
  "list_id",
  "mode",
  "source",
  "template_id",
  "utm_campaign",
  "utm_medium",
  "utm_source",
  "variant_id",
]);

const NUMBER_PAYLOAD_KEYS = new Set(["comparison_count", "item_count", "top_k"]);
const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const CHALLENGE_ID = /^mv-[a-z0-9]{12}$/;
const MAX_REQUEST_BYTES = 48 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 2 * 1024;
const MAX_CHALLENGE_ITEMS = 300;
// 批量海报：一次可提交整份榜单（300 首），独立于 48KB 的通用请求上限。
const MAX_POSTER_BATCH_ITEMS = 300;
const MAX_POSTER_BATCH_BYTES = 128 * 1024;
// AI 点评场景数据：结构化 JSON（榜单/画像/比较指标），独立于 48KB 通用上限。
const MAX_AI_DATA_BYTES = 16 * 1024;
// 维基「其他类」链的总预算（见 worker/deadline.ts）：前端详情请求 30s 放弃，
// 这里留 5s 余量。诊断端点给弹窗用，慢过 15s 已经没有意义，反而拖住交互。
const OTHER_DETAIL_DEADLINE_MS = 25_000;
const OTHER_CANDIDATES_DEADLINE_MS = 15_000;

/** 维基链超时的统一响应：**不缓存**——超时是瞬时故障，缓存 5 分钟等于把
 *  一次上游抖动固化成「这几天都没有资料」。 */
function upstreamTimeout(): Response {
  return json({ status: false, msg: "upstream_timeout", data: null }, 504, {
    "cache-control": "no-store",
  });
}
const upstreamWindows = new Map<string, RateWindow>();

async function allowUpstreamRequest(
  request: Request,
  bucket:
    | "ai"
    | "ai_custom"
    | "ai_test"
    | "ai_models"
    | "ai_jev"
    | "ai_jev_test"
    | "ai_jev_pick"
    | "ai_jev_disambiguate"
    | "music"
    | "music_play"
    | "music_lyric"
    | "auth"
    | "account"
    | "account_auth"
    | "plaza_write"
    | "share"
    | "import"
    | "netease"
    | "douban"
    | "posters"
    | "other"
    | "events"
    | "challenge"
    | "image"
    | "cache",
  limit: number,
  /** 传入 env.DB 时追加 D1 原子计数（敏感桶用，见 rateLimitStore.ts）。 */
  db?: D1Database,
): Promise<boolean> {
  const client = request.headers.get("cf-connecting-ip") ?? "anonymous";
  const key = `${bucket}:${client}`;
  const now = Date.now();
  // isolate 级窗口（带上界与惰性清扫，见 rateWindow.ts）。
  if (!consumeIsolateWindow(upstreamWindows, key, limit, now)) return false;

  // The isolate map is a fast fallback. Edge Cache makes the budget visible
  // across isolates in production without requiring a Durable Object binding.
  try {
    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = new Request(
      `https://rate-limit.art-rank.internal/${encodeURIComponent(bucket)}/${encodeURIComponent(client)}`,
    );
    const hit = await cache.match(cacheKey);
    let next = { startedAt: now, count: 1 };
    if (hit) {
      const stored = (await hit.json()) as { startedAt?: number; count?: number };
      if (
        typeof stored.startedAt === "number" &&
        typeof stored.count === "number" &&
        now - stored.startedAt <= RATE_WINDOW_MS
      ) {
        if (stored.count >= limit) return false;
        next = { startedAt: stored.startedAt, count: stored.count + 1 };
      }
    }
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(next), {
        headers: { "cache-control": "max-age=600", "content-type": "application/json" },
      }),
    );
  } catch {
    /* Cache is best-effort; the in-memory window still protects the isolate. */
  }

  // 敏感桶：D1 单条 UPSERT 原子计数，跨 isolate 拿到真实上限。
  // 表未迁移 / D1 暂不可用时静默退回 Map + Cache 语义（宁可放宽，不可误伤）。
  if (db) {
    try {
      if (!(await consumeSharedWindow(db, key, limit, now))) return false;
    } catch {
      /* best-effort */
    }
  }
  return true;
}
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: https://*.doubanio.com https://m.media-amazon.com https://ia.media-imdb.com https://image.tmdb.org https://*.music.126.net https://*.githubusercontent.com https://upload.wikimedia.org https://thumb.wikimedia.org https://bkimg.cdn.bcebos.com; style-src 'self' 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net https://static.cloudflareinsights.com 'sha256-d+1XxRQUWY8LGwXhdeFvJFpB3nkb5L9UFxsCt9kf/SU='; connect-src 'self' https://cloudflareinsights.com; font-src 'self' data:; media-src 'self' https://*.music.126.net; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

/** 管理后台脚本已外置到 `/admin/app.js`，内联事件改为事件委托，
 * 因此脚本侧可完全禁止内联（`script-src 'self'` + `script-src-attr 'none'`）；
 * 样式仍使用大量内联 style 属性，保留 style-src 的 unsafe-inline。
 * 同时用 no-store 避免后台页面被中间层缓存（安全审计 2026-10-29 P2）。 */
const ADMIN_SECURITY_HEADERS: Record<string, string> = {
  ...SECURITY_HEADERS,
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

import { DASHBOARD_HTML, DASHBOARD_JS } from "./dashboardHtml";

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return withSecurityHeaders(new Response(JSON.stringify(data), { status, headers }));
}

/** CSV 单元格：转义引号，并对公式注入做防护。
 * Excel/Sheets 会把以 = + - @ 或制表/回车开头的单元格当公式执行，
 * 前缀单引号强制按文本处理（安全审计 2026-10-29 P2）。 */
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function withSecurityHeaders(response: Response): Response {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    result.headers.set(key, value);
  }
  return result;
}

// ===== API Logging (batched) =====
const logQueue: Array<[string, string, number, number, string, string | null, string | null]> = [];
let logFlushScheduled = false;
let cachedDB: D1Database | undefined;
function enqueueLog(
  db: D1Database | undefined,
  path: string,
  method: string,
  status: number,
  durationMs: number,
  source: string,
  error?: string,
  ip?: string,
) {
  if (db) cachedDB = db;
  logQueue.push([path, method, status, durationMs, source, error ?? null, ip ?? null]);
  if (logQueue.length >= 50) void flushLogs();
  else if (!logFlushScheduled) {
    logFlushScheduled = true;
    setTimeout(() => void flushLogs(), 5000);
  }
}
async function flushLogs() {
  logFlushScheduled = false;
  const batch = logQueue.splice(0);
  if (!batch.length || !cachedDB) return;
  try {
    const stmt = cachedDB.prepare(
      "INSERT INTO api_logs (path, method, status, duration_ms, source, error, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    await cachedDB.batch(
      batch.map(([p, m, s, d, src, e, ip]) => stmt.bind(p, m, s, d, src, e, ip)),
    );
  } catch {
    /* logging should never break requests */
  }
}
async function logApiCall(
  env: Env | undefined,
  path: string,
  method: string,
  status: number,
  durationMs: number,
  source: string,
  error?: string,
  ip?: string,
) {
  if (!env?.DB) return;
  enqueueLog(env.DB, path, method, status, durationMs, source, error, ip);
}

// ===== Admin Auth =====
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function adminAuth(request: Request, env: Env): Promise<boolean> {
  if (!env.DB) return false;
  const token = getAdminToken(request);
  if (!token || token.length < 32) return false;
  try {
    const session = await env.DB.prepare(
      "SELECT token FROM admin_sessions WHERE token = ? AND julianday(expires_at) > julianday('now')",
    )
      .bind(token)
      .first();
    return !!session;
  } catch {
    return false;
  }
}

function getAdminToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== new URL(request.url).origin) {
      throw new HttpError(403, "cross_origin_forbidden", "Cross-origin writes are not allowed.");
    }
    return;
  }
  // 无 Origin 时必须另有明确的同源信号；两者皆缺（curl/表单跨站等）一律拒绝。
  // 浏览器对同源 fetch 的非 GET 请求总会带 Origin 或 Sec-Fetch-Site: same-origin。
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return;
  throw new HttpError(403, "cross_origin_forbidden", "Cross-origin writes are not allowed.");
}

function parseContentLength(request: Request, maxBytes = MAX_REQUEST_BYTES): void {
  const value = request.headers.get("content-length");
  if (value && Number(value) > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }
}

async function readJson(request: Request): Promise<JsonObject> {
  parseContentLength(request);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "json_required", "Content-Type must be application/json.");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object.");
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 宽松清洗批量海报请求：单条不合法只丢弃该条，不让整批（最多 300 首）失败。
 * 归一化逻辑与 posterStore 共用一份，保证键推导不会漂移。
 */
function sanitizePosterBatch(raw: readonly unknown[]): PosterBatchRequest[] {
  const items: PosterBatchRequest[] = [];
  for (const entry of raw.slice(0, MAX_POSTER_BATCH_ITEMS)) {
    if (!isObject(entry)) continue;
    // 兼容未带 type 的旧客户端：缺省按 movie 处理，而不是丢弃整条。
    const type =
      entry.type === "book" ||
      entry.type === "music" ||
      entry.type === "movie" ||
      entry.type === "other"
        ? entry.type
        : "movie";
    const item = normalizePosterItem({
      title: entry.title,
      english: entry.english,
      year: entry.year,
      type,
    });
    if (item) items.push(item);
  }
  return items;
}

function cleanString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_field", `${field} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new HttpError(400, "invalid_field", `${field} has an invalid length or characters.`);
  }
  return cleaned;
}

function cleanOptionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return cleanString(value, field, maxLength);
}

function cleanOptionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new HttpError(
      400,
      "invalid_field",
      `${field} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return Number(value);
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
        COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS completed_total,
        COUNT(CASE WHEN event_name = 'ranking_completed' AND created_at >= datetime('now', 'start of day') THEN 1 END) AS completed_today,
        ROUND(AVG(CASE
          WHEN event_name = 'ranking_completed'
          THEN CAST(json_extract(payload, '$.comparison_count') AS REAL)
        END), 1) AS average_comparisons
      FROM analytics_events`,
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

/** 逐表行数统计：D1 对复合 SELECT 项数有限制，禁止用大 UNION ALL（经 db.batch 单次往返执行） */
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
      // 扩展表单独一组：迁移未全部应用时不影响核心统计
      safe(countTables(env.DB, STORAGE_EXTENDED_TABLES), []),
      // Poster errors - last 7 days
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
      // 批量解析 outcome 分布（近7天）：poster_errors 没有分母，throttled 占比
      // 只能从这里算（migrations/0026）。表是本轮新增的，查不到时按空兜底。
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

// ===== Admin Login =====
async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD && !env.DB) return json({ error: "auth_unavailable" }, 503);
  const body = await readJson(request);
  const password = cleanString(body.password, "password", 128);

  // Prefer environment variable password
  if (env.ADMIN_PASSWORD) {
    if (!timingSafeEqual(password, env.ADMIN_PASSWORD))
      return json({ error: "invalid_password" }, 401);
  } else {
    // Fallback to DB-stored password
    if (!env.DB) return json({ error: "auth_unavailable" }, 503);
    const stored = await env.DB.prepare(
      "SELECT value FROM admin_config WHERE key = 'password_hash'",
    ).first<{ value: string }>();
    if (!stored?.value) return json({ error: "no_password_configured" }, 503);
    if (!(await verifyPassword(password, stored.value)))
      return json({ error: "invalid_password" }, 401);
    // Transparently upgrade legacy SHA-256 admin hashes to PBKDF2.
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

// ===== Admin: 分级数据重置 / 审计 / 改密 / 会话管理 =====

/** 各重置范围对应的清空语句（ accounts 为最高危：全部账户及用户生成内容） */
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

/** 重置类操作的管理员密码重验：环境变量密码或 DB 密码均可 */
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
  const body = await readJson(request);
  const scope = cleanOptionalString(body.scope, "scope", 20) ?? "";
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
  // 改密即全量吊销管理端会话：旧 token 若已泄露，不能继续用到 7 天自然过期。
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

interface ChallengeRow {
  id: string;
  theme: string;
  mode: string;
  items: string;
  top_k: number | null;
  seed_text: string | null;
  template_id: string | null;
  created_at: string;
}

function validateItems(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_CHALLENGE_ITEMS) {
    throw new HttpError(400, "invalid_items", "items must contain 2 to 300 movie titles.");
  }
  const cleaned = value.map((item, index) => cleanString(item, `items[${index}]`, 120));
  const unique = [...new Set(cleaned)];
  if (unique.length < 2) {
    throw new HttpError(400, "invalid_items", "items must contain at least two unique titles.");
  }
  return unique;
}

function randomChallengeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const suffix = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  return `mv-${suffix}`;
}

async function createChallenge(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  if (!env.DB) {
    return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503, {
      "retry-after": "60",
    });
  }

  const body = await readJson(request);
  const items = validateItems(body.items);
  const theme = cleanString(body.theme, "theme", 80);
  const mode = cleanOptionalString(body.mode, "mode", 40) ?? "shared";
  const topK = cleanOptionalInteger(body.top_k, "top_k", 1, items.length);
  const seedText = cleanOptionalString(body.seed_text, "seed_text", 80);
  const templateId = cleanOptionalString(body.template_id, "template_id", 80);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = randomChallengeId();
    try {
      await env.DB.prepare(
        `INSERT INTO challenge_sets
          (id, theme, mode, items, item_count, top_k, seed_text, template_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, theme, mode, JSON.stringify(items), items.length, topK, seedText, templateId)
        .run();
      return json({ id, path: `/?list=${id}` }, 201);
    } catch (error) {
      if (attempt === 2) {
        console.error("challenge insert failed", error instanceof Error ? error.message : error);
      }
    }
  }

  return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503);
}

async function getChallenge(id: string, env: Env): Promise<Response> {
  if (!CHALLENGE_ID.test(id)) {
    throw new HttpError(400, "invalid_challenge_id", "Invalid challenge id.");
  }
  if (!env.DB) {
    return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503);
  }

  try {
    const row = await env.DB.prepare(
      `SELECT id, theme, mode, items, top_k, seed_text, template_id, created_at
       FROM challenge_sets WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first<ChallengeRow>();
    if (!row) return json({ error: "challenge_not_found" }, 404);

    return json(
      {
        id: row.id,
        theme: row.theme,
        mode: row.mode,
        items: JSON.parse(row.items),
        top_k: row.top_k,
        seed_text: row.seed_text ?? "",
        source: "shared",
        template_id: row.template_id ?? "",
        created_at: row.created_at,
      },
      200,
      { "cache-control": "public, max-age=300" },
    );
  } catch (error) {
    console.error("challenge query failed", error instanceof Error ? error.message : error);
    return json({ error: "challenge_storage_unavailable", fallback: "payload" }, 503);
  }
}

/** 静态资源里「内容哈希文件名」的形态：`index-Cix8RSlz.js` / `three.module-YZZFkaN9.js`。
 *  vite 的 `[hash]` 是 base64url 字母表（大小写、数字、`-`、`_`），长度 8 位起；
 *  这里只认「连字符 + 至少 8 位哈希 + 扩展名」的收尾形态，避免把 `orbit-zoom.png`
 * 之类纯词法文件名误判成不可变资源。 */
const CONTENT_HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]{2,8}$/;

/**
 * 内容哈希产物 = 不可变资源：内容变则文件名变，一年后再取字节完全一样。
 * Workers 静态资源默认给所有响应挂 `max-age=0, must-revalidate`（那是 HTML 该有的语义），
 * 于是每次冷启动都要为 134 KB（br）主包 + 28 KB（br）样式重传一遍并等一趟 RTT。
 * 2026-10-02 线上实测：Hashed 资源 ETag 齐备、边缘 `cf-cache-status: HIT`，
 * 服务端完全具备长期缓存的能力，只是没告诉浏览器可以用。
 *
 * 只按**文件名特征**判，不按目录白名单：`/assets/` 下还有 favicon、字体等无哈希文件，
 * 一刀切会把它们也钉成一年，那才是真的发不出去。
 * `index.html` 必须继续 `must-revalidate` —— 它是部署切换的入口。
 */
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
        `SELECT p.collection_title, p.kind, p.item_count, p.post_type, p.items, u.nickname
         FROM plaza_posts p LEFT JOIN user_accounts u ON p.user_id = u.id
         WHERE p.id = ? AND p.is_public = 1`,
      )
        .bind(Number(plazaMatch[1]))
        .first<{
          collection_title: string;
          kind: string;
          item_count: number;
          post_type: string;
          items: string;
          nickname: string | null;
        }>();
      if (row) {
        // 首位作品:ranking 帖 items[0] 即作品;profile 帖 items[0] 是榜单,取其 items[0]
        let topWork: { title?: unknown; subtitle?: unknown; year?: unknown } | null = null;
        try {
          const parsed = JSON.parse(row.items) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0) {
            const first = parsed[0] as Record<string, unknown>;
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
        tags = buildPlazaTags({ ...row, topPosterUrl }, url.toString(), url.origin);
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
    if (env.DB) {
      try {
        await env.DB.prepare("SELECT 1").first();
        checks.database = "ok";
      } catch {
        checks.database = "error";
      }
    }
    return json({ ok: true, version: "2.0.0", timestamp: new Date().toISOString(), checks }, 200, {
      "cache-control": "no-store",
    });
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
  if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
    if (!(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    return getDashboard(env);
  }
  // GET /api/admin/cache/status —— 各作用域当前缓存代次
  if (url.pathname === "/api/admin/cache/status" && request.method === "GET") {
    if (!env.DB || !(await adminAuth(request, env))) return json({ error: "auth_required" }, 401);
    await refreshGenerations(env.DB);
    const generation: Record<string, string> = {};
    for (const s of PURGEABLE_SCOPES) generation[s] = generationOf(s);
    return json({ ok: true, generation });
  }
  // POST /api/admin/cache/clear —— 管理员清除缓存（scope 可为 all）
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
    // 管理登录与 reset/change-password 共用 auth 桶（30 次/10 分/IP）：管理面可
    // 一键清库，撞库必须被频控拦住（安全审计 2026-10-25 M2）。
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
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "200"), 1000);
    const errors = await env.DB.prepare(
      "SELECT id, title, media_type, error, source, created_at FROM poster_errors WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC LIMIT ?",
    )
      .bind(`-${days} days`, limit)
      .all();
    return json({ errors: errors.results ?? [] }, 200, { "cache-control": "no-store" });
  }
  // AI 提示词在线覆盖（docs/archive/PLAN-ai-insights.md §6.3）：管理端读/写/清，全部写审计。
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
  if (url.pathname === "/api/douban/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250)
      return json({ error: "invalid_limit" }, 400);
    try {
      const works = await doubanTop250(limit);
      return json({ source: "douban", total: works.length, works }, 200, {
        "cache-control": "public, max-age=900",
      });
    } catch {
      return json({ error: "douban_unavailable" }, 502);
    }
  }
  if (url.pathname === "/api/douban/books/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250)
      return json({ error: "invalid_limit" }, 400);
    try {
      const works = await doubanBookTop250(limit);
      return json({ source: "douban", total: works.length, works }, 200, {
        "cache-control": "public, max-age=900",
      });
    } catch {
      return json({ error: "douban_unavailable" }, 502);
    }
  }
  if (url.pathname === "/api/douban/music/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250)
      return json({ error: "invalid_limit" }, 400);
    try {
      const works = await doubanMusicTop250(limit);
      return json({ source: "douban", total: works.length, works }, 200, {
        "cache-control": "public, max-age=900",
      });
    } catch {
      return json({ error: "douban_unavailable" }, 502);
    }
  }
  if (url.pathname === "/api/douban/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try {
      return json({ works: await doubanSuggest(query) }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return json({ error: "douban_unavailable", works: [] }, 502);
    }
  }
  if (url.pathname === "/api/douban/books/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try {
      return json({ works: await doubanBookSuggest(query) }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return json({ error: "douban_unavailable", works: [] }, 502);
    }
  }
  if (url.pathname === "/api/posters" && request.method === "GET") {
    const title = url.searchParams.get("q")?.trim();
    const english = url.searchParams.get("en")?.trim() ?? "";
    const year = Number(url.searchParams.get("year")) || undefined;
    const type = url.searchParams.get("type") as "movie" | "book" | "music" | undefined;
    if (
      !title ||
      title.length > 160 ||
      english.length > 160 ||
      (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 2200))
    )
      return json({ error: "invalid_query" }, 400);
    // Phase 1：先查库。已落库的条目直接返回，不再回源。
    const cacheKey = posterMediaKey(title, english, type, year);
    const stored = env.DB ? (await loadPosterUrls(env.DB, [cacheKey])).get(cacheKey) : undefined;
    const poster_urls = stored?.length
      ? stored
      : await resolvePosters(title, english, year, type, env);
    if (!stored?.length && poster_urls.length)
      await saveResolvedPosters(env.DB, [{ key: cacheKey, urls: poster_urls }]);
    if (!stored?.length && poster_urls.length === 0 && env.DB) {
      void env.DB.prepare(
        "INSERT INTO poster_errors (title, media_type, error, source) VALUES (?, ?, ?, ?)",
      )
        .bind(title, type ?? "movie", "no_poster_found", "single")
        .run()
        .catch(() => {});
    }
    return json({ poster_urls }, 200, {
      "cache-control": `public, max-age=${poster_urls.length ? 86400 : 300}`,
    });
  }
  if (url.pathname === "/api/posters/batch" && request.method === "POST") {
    // 独立限流桶：批量解析的上游开销远大于单条查询，不该和试听共享 music 配额。
    if (!(await allowUpstreamRequest(request, "posters", 60, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_POSTER_BATCH_BYTES)
      return json({ error: "payload_too_large" }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!isObject(parsed) || !Array.isArray((parsed as { items?: unknown }).items))
      return json({ error: "invalid_json" }, 400);
    const items = sanitizePosterBatch((parsed as { items: unknown[] }).items);
    if (items.length === 0)
      return json({ results: {}, keys: [] }, 200, { "cache-control": "public, max-age=300" });
    // Phase 1：先算出这一批的键，再一次性查库，命中项短路掉上游。
    const batchKeys = items.map((item) =>
      posterMediaKey(item.title, item.english ?? "", item.type, item.year),
    );
    const known = env.DB ? await loadPosterUrls(env.DB, batchKeys) : undefined;
    // 客户端在每次页面加载的首次批量带 retry：绕过「被限流」的负缓存，
    // 让「刷新 = 真重试」是确定的（正缓存与「确实没有」的负缓存仍然生效）。
    const retry = (parsed as { retry?: unknown }).retry === true;
    const { results, keys, outcomes } = await resolvePostersBatch(items, env, 8, known, { retry });
    // 写穿：只把**新解析到**的地址落库（已知命中项不必重写）。
    await saveResolvedPosters(
      env.DB,
      keys
        .filter((key) => !known?.get(key)?.length)
        .map((key) => ({ key, urls: results[key] ?? [] })),
    );
    // 批量失败原先在后台完全不可见——这里落一条 poster_errors(source=batch)，
    // 且严格限量（每请求最多 10 条），避免把 D1 写成热点。
    if (env.DB) {
      const failures = keys
        .map((key, index) => ({ key, item: items[index] }))
        .filter(({ key }) => !results[key]?.length)
        .slice(0, 10);
      if (failures.length) {
        const statement = env.DB.prepare(
          "INSERT INTO poster_errors (title, media_type, error, source) VALUES (?, ?, ?, ?)",
        );
        void env.DB.batch(
          failures.map(({ key, item }) =>
            statement.bind(
              (item?.title ?? key).slice(0, 160),
              item?.type ?? "movie",
              outcomes[key] === "throttled" ? "throttled" : "no_poster_found",
              "batch",
            ),
          ),
        ).catch(() => undefined);
      }
      // 每批一行 outcome 分布：poster_errors 只有失败行、没有分母，throttled 占比
      // 必须有 total/found 才算得出来（migrations/0026）。单行/请求，火后不管。
      // found 从 results 有无数据推导（tallyBatchOutcomes），不按 outcome 标签 else
      // 归入——未知状态永不虚增 found（A4 / T-20261014-07）。
      const tally = tallyBatchOutcomes(keys, results, outcomes);
      void env.DB.prepare(
        "INSERT INTO poster_batch_stats (total, found, absent, throttled) VALUES (?, ?, ?, ?)",
      )
        .bind(keys.length, tally.found, tally.absent, tally.throttled)
        .run()
        .catch(() => undefined);
    }
    // 真正的 1 天缓存发生在服务端（L1 isolate + L2 Edge Cache）；
    // 这里只是顺带声明新鲜度，浏览器通常不缓存 POST 响应。
    // outcomes 一并发出：found / absent / throttled 是本文件上一段算出来的，
    // 不发出去的话前端只能把「维基没这个条目」和「维基现在取不到」渲染成同一个空格子。
    return json({ results, keys, outcomes }, 200, { "cache-control": "private, max-age=86400" });
  }
  if (url.pathname === "/api/image" && request.method === "GET") {
    // 匿名图片代理必须有频控（白名单已收窄 SSRF 面，这里补带宽面）。
    // 额度从 120 提到 300（收口 2026-10-28）：一个 3 榜单 × 30 条的画像页就要 ~90 次，
    // 紧接着导出 PNG 会再逐张走一遍代理（exportPng 的解码池只控并发、不控总数），
    // 120 在正常「看画像 → 导出 → 逛广场」连招里就会撞线。撞线后 Poster 只是静默
    // 降级成占位方块（不报错、不白屏），用户只会觉得「图没了」，极难归因。
    // 300 次/10 分（≈30 张/分钟）仍足以拦住单 IP 的批量抓图。
    if (!(await allowUpstreamRequest(request, "image", 300)))
      return withSecurityHeaders(json({ error: "rate_limited" }, 429, { "retry-after": "600" }));
    return withSecurityHeaders(await proxyImage(url.searchParams.get("url") ?? ""));
  }

  // Search list APIs
  if (url.pathname === "/api/book/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80)
      return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("book", key, page), 200, {
      "cache-control": "public, max-age=3600",
    });
  }
  if (url.pathname === "/api/movie/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80)
      return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("movie", key, page), 200, {
      "cache-control": "public, max-age=3600",
    });
  }
  if (url.pathname === "/api/music/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim();
    const page = Number(url.searchParams.get("page") ?? "1");
    if (!key || key.length > 80)
      return json({ status: false, msg: "缺少参数 key", data: null }, 400);
    if (!Number.isInteger(page) || page < 1 || page > 100)
      return json({ status: false, msg: "page 参数无效", data: null }, 400);
    return json(await doubanSearch("music", key, page), 200, {
      "cache-control": "public, max-age=3600",
    });
  }

  // Detail APIs
  if (url.pathname === "/api/book/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    const title = url.searchParams.get("name")?.trim() || url.searchParams.get("title")?.trim();
    if (!detailUrl && !title)
      return json({ status: false, msg: "缺少参数 url 或 name", data: null }, 400);

    let bookTitle = title ?? "";
    const data: Record<string, unknown> = {};
    let subjectUrl = detailUrl ?? "";

    // Step 1: Get basic info from search.douban.com
    if (bookTitle || detailUrl) {
      const bookId = detailUrl?.match(/subject\/(\d+)/)?.[1];
      try {
        const search = await doubanSearch("book", bookTitle || bookId!, 1);
        const wantCreator = url.searchParams.get("creator")?.trim() ?? "";
        const scoreHit = (i: (typeof search.data)[number]) => {
          let sc = 0;
          const hay = `${i.title ?? ""} ${i.author ?? ""}`;
          if (wantCreator && hay.includes(wantCreator)) sc += 4;
          if ((i.title ?? "").startsWith(bookTitle)) sc += 1;
          return sc;
        };
        const found = bookId
          ? (search.data.find((i) => i.cover_link?.includes(`/subject/${bookId}/`)) ??
            search.data[0])
          : wantCreator
            ? [...search.data].sort((a, b) => scoreHit(b) - scoreHit(a))[0]
            : search.data[0];
        if (found) {
          bookTitle = found.title || bookTitle;
          data.title = found.title;
          data.pic = found.cover;
          data.rating = String(found.rating ?? "");
          data.author = found.author ?? "";
          data.press = found.press ?? "";
          data.date = found.date ?? "";
          if (!subjectUrl && typeof found.cover_link === "string") subjectUrl = found.cover_link;
        }
      } catch {}
    }

    // Step 2: 豆瓣官方详情页简介优先（零歧义；失败静默降级维基）
    if (subjectUrl.includes("book.douban.com/subject/")) {
      try {
        const detail = await doubanBookDetail(subjectUrl);
        if (detail.status && detail.data) {
          if (detail.data.content_intro) {
            data.content_intro = detail.data.content_intro;
            data.content_source = "douban";
          }
          if (detail.data.author_intro) data.author_intro = detail.data.author_intro;
          if (detail.data.tags) data.tags = detail.data.tags;
          for (const [k, v] of Object.entries(detail.data)) {
            if (v && !data[k]) data[k] = v;
          }
        }
      } catch {}
    }

    // Step 3: 维基兜底
    if (!data.content_intro && bookTitle) {
      const wikiTitle = title && bookTitle.includes(title) ? title : bookTitle;
      const intro = await fetchContentIntro(
        wikiTitle,
        "book",
        typeof data.author === "string" ? data.author.split("/")[0] : undefined,
        data.date,
        env,
      );
      if (intro) {
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    // Step 4: douban 搜索完全失败时，用维基搜索兜底获取标题和简介
    if (!data.title && title) {
      const intro = await fetchContentIntro(title, "book", undefined, undefined, env);
      if (intro) {
        data.title = title;
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    if (data.title) {
      return json({ status: true, msg: "ok", time: "0s", data }, 200, {
        "cache-control": "public, max-age=86400",
      });
    }
    return json({ status: false, msg: "未找到书籍信息", data: null }, 404, {
      "cache-control": "public, max-age=60",
    });
  }
  if (url.pathname === "/api/movie/detail" && request.method === "GET") {
    const detailUrl = url.searchParams.get("url")?.trim();
    const title = url.searchParams.get("name")?.trim() || url.searchParams.get("title")?.trim();
    if (!detailUrl && !title)
      return json({ status: false, msg: "Missing url or name", data: null }, 400);

    const movieId = detailUrl?.match(/subject\/(\d+)/)?.[1];
    let movieTitle = title ?? "";
    const data: Record<string, unknown> = {};
    let subjectUrl = detailUrl ?? "";

    // Step 1: Get basic info from search.douban.com
    if (movieTitle || movieId) {
      try {
        const search = await doubanSearch("movie", movieTitle || movieId!, 1);
        const wantCreator = url.searchParams.get("creator")?.trim() ?? "";
        const scoreHit = (i: (typeof search.data)[number]) => {
          let sc = 0;
          const hay = `${i.title ?? ""} ${String(Array.isArray(i.actors) ? i.actors.join(" ") : "")}`;
          if (wantCreator && hay.includes(wantCreator)) sc += 4;
          if ((i.title ?? "").startsWith(movieTitle)) sc += 1;
          return sc;
        };
        const found = movieId
          ? (search.data.find((i) => i.cover_link?.includes(`/subject/${movieId}/`)) ??
            search.data[0])
          : wantCreator
            ? [...search.data].sort((a, b) => scoreHit(b) - scoreHit(a))[0]
            : search.data[0];
        if (found) {
          movieTitle = found.title || movieTitle;
          data.title = found.title;
          data.pic = found.cover;
          data.rating = String(found.rating ?? "");
          data.year = found.year ?? "";
          data.type = Array.isArray(found.type) ? found.type.join("/") : "";
          data.country = found.country ?? "";
          data.duration = found.duration ?? "";
          data.actors = Array.isArray(found.actors) ? found.actors.join("/") : "";
          if (!subjectUrl && typeof found.cover_link === "string") subjectUrl = found.cover_link;
        }
      } catch {}
    }

    // Step 2: 豆瓣官方详情页简介优先（v:summary，零歧义；失败静默降级维基）
    if (subjectUrl.includes("movie.douban.com/subject/")) {
      try {
        const detail = await doubanMovieDetail(subjectUrl);
        if (detail.status && detail.data) {
          if (detail.data.content_intro) {
            data.content_intro = detail.data.content_intro;
            data.content_source = "douban";
          }
          for (const [k, v] of Object.entries(detail.data)) {
            if (v && !data[k]) data[k] = v;
          }
        }
      } catch {}
    }

    // Step 3: 维基兜底（豆瓣详情未取到简介时）
    if (!data.content_intro && movieTitle) {
      const wikiTitle = title && movieTitle.includes(title) ? title : movieTitle;
      const intro = await fetchContentIntro(
        wikiTitle,
        "movie",
        typeof data.actors === "string" ? data.actors.split("/")[0] : undefined,
        data.year,
        env,
      );
      if (intro) {
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    // Step 4: douban 搜索完全失败时，用维基搜索兜底获取标题和简介
    if (!data.title && title) {
      const intro = await fetchContentIntro(title, "movie", undefined, undefined, env);
      if (intro) {
        data.title = title;
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
    }

    if (data.title) {
      return json({ status: true, msg: "ok", time: "0s", data }, 200, {
        "cache-control": "public, max-age=86400",
      });
    }
    return json({ status: false, msg: "not found", data: null }, 404, {
      "cache-control": "public, max-age=60",
    });
  }
  if (url.pathname === "/api/music/detail" && request.method === "GET") {
    const startedAt = Date.now();
    const title = url.searchParams.get("name")?.trim() || url.searchParams.get("title")?.trim();
    if (!title) return json({ status: false, msg: "缺少参数 name", data: null }, 400);
    if (title.length > 120) return json({ status: false, msg: "invalid_title", data: null }, 400);
    const creator = url.searchParams.get("creator")?.trim() ?? "";
    const year = url.searchParams.get("year")?.trim() ?? "";

    const data: Record<string, unknown> = { title };

    // 两步并行（互不依赖）：Step 1 歌曲导向元数据——gdstudio 搜索按歌名+歌手
    // 匹配单曲/歌曲条目，不做专辑联想（豆瓣音乐详情已移除：专辑导向且反爬不稳）；
    // Step 2 简介——中文歌名百度百科优先 → 维基消歧打分，均在 fetchContentIntro 内。
    const [track, intro] = await Promise.all([
      gdSearch(title, 10, env)
        .then(({ tracks }) => pickTrack(tracks, title, creator || undefined))
        .catch(() => null),
      fetchContentIntro(title, "music", creator || undefined, year || undefined, env),
    ]);
    if (track) {
      if (track.name) data.matchedTitle = track.name;
      const artist = Array.isArray(track.artist)
        ? track.artist.join(" / ")
        : String(track.artist ?? "");
      if (artist) data.artist = artist;
      if (track.album) data.album = track.album;
    }
    if (intro) {
      data.content_intro = intro.intro;
      data.content_source = intro.source;
    }

    return json(
      {
        status: true,
        msg: "ok",
        time: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        data,
      },
      200,
      { "cache-control": "public, max-age=3600" },
    );
  }
  if (url.pathname === "/api/artwork/detail" && request.method === "GET") {
    const kind = url.searchParams.get("kind");
    const title = url.searchParams.get("q")?.trim();
    if (
      !title ||
      title.length > 120 ||
      (kind !== "film" && kind !== "book" && kind !== "music" && kind !== "other")
    ) {
      return json({ status: false, msg: "invalid_query", data: null }, 400);
    }
    // 同 /api/other/detail：年份是消歧最硬信号（清单格式「标题 - 游戏 (年)」）
    const detailYear = normalizeYear(
      url.searchParams.get("year") ?? url.searchParams.get("release_date"),
    );
    if (kind === "other") {
      try {
        const work = await withDeadline(
          otherDetail(title, detailYear),
          OTHER_DETAIL_DEADLINE_MS,
          "artwork-detail-other",
        );
        if (!work)
          return json({ status: false, msg: "not_found", data: null }, 404, {
            "cache-control": "public, max-age=300",
          });
        return json({ status: true, msg: "ok", data: work }, 200, {
          "cache-control": "public, max-age=3600",
        });
      } catch (error) {
        if (error instanceof DeadlineError) return upstreamTimeout();
        return json({ status: false, msg: "wiki_unavailable", data: null }, 502, {
          "cache-control": "public, max-age=300",
        });
      }
    }
    // 歌曲导向（去豆瓣）：gdstudio 单曲元数据 + 维基/百科简介
    if (kind === "music") {
      const data: Record<string, unknown> = { title };
      try {
        const { tracks } = await gdSearch(title, 10, env);
        const track = pickTrack(tracks, title, undefined);
        if (track) {
          if (track.name) data.matchedTitle = track.name;
          const artist = Array.isArray(track.artist)
            ? track.artist.join(" / ")
            : String(track.artist ?? "");
          if (artist) data.artist = artist;
          if (track.album) data.album = track.album;
        }
      } catch {}
      // creator 透传（复审 #6）：启用泛义词条防线，且缓存键与 music/detail 分开
      const intro = await fetchContentIntro(
        title,
        "music",
        data.artist as string | undefined,
        undefined,
        env,
      );
      if (intro) {
        data.content_intro = intro.intro;
        data.content_source = intro.source;
      }
      return json({ status: true, msg: "ok", data }, 200, {
        "cache-control": "public, max-age=3600",
      });
    }
    const type = kind === "film" ? "movie" : kind;
    try {
      const search = await doubanSearch(type, title, 1);
      const subject = search.data.find(
        (item) =>
          typeof item.cover_link === "string" && item.cover_link.includes("douban.com/subject/"),
      );
      if (!subject?.cover_link)
        return json({ status: false, msg: "not_found", data: null }, 404, {
          "cache-control": "public, max-age=300",
        });
      // music 已在上方早返回；此处只剩 film/book
      const detail =
        kind === "film"
          ? await doubanMovieDetail(subject.cover_link)
          : await doubanBookDetail(subject.cover_link);
      return json({ ...detail, source_url: subject.cover_link }, detail.status ? 200 : 502, {
        "cache-control": detail.status ? "public, max-age=86400" : "public, max-age=300",
      });
    } catch {
      return json({ status: false, msg: "douban_unavailable", data: null }, 502, {
        "cache-control": "public, max-age=300",
      });
    }
  }
  if (url.pathname === "/api/other/list" && request.method === "GET") {
    const key = url.searchParams.get("key")?.trim() ?? "";
    if (!key || key.length > 80) return json({ status: false, msg: "invalid_key", data: [] }, 400);
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    try {
      const works = await otherSearch(key);
      return json({ status: true, msg: "ok", data: works }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return json({ status: false, msg: "wiki_unavailable", data: [] }, 502);
    }
  }
  if (url.pathname === "/api/other/detail" && request.method === "GET") {
    const name = (url.searchParams.get("name") ?? url.searchParams.get("title"))?.trim() ?? "";
    if (!name || name.length > 120)
      return json({ status: false, msg: "invalid_name", data: null }, 400);
    // 用户条目的年份是消歧最硬信号（清单格式「标题 - 游戏 (年)」）：精确页是
    // 系列页/同名概念页时按年份重新择优（动物森友会→2001 首作 vs 2020 正作）
    const year = normalizeYear(
      url.searchParams.get("year") ?? url.searchParams.get("release_date"),
    );
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    try {
      const work = await withDeadline(
        otherDetail(name, year),
        OTHER_DETAIL_DEADLINE_MS,
        "other-detail",
      );
      if (!work)
        return json({ status: false, msg: "not_found", data: null }, 404, {
          "cache-control": "public, max-age=300",
        });
      return json({ status: true, msg: "ok", data: work }, 200, {
        "cache-control": "public, max-age=3600",
      });
    } catch (error) {
      if (error instanceof DeadlineError) return upstreamTimeout();
      return json({ status: false, msg: "wiki_unavailable", data: null }, 502, {
        "cache-control": "public, max-age=300",
      });
    }
  }
  if (url.pathname === "/api/ai/test" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_test", 5, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateUserConfig(body.config);
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "API 配置不合法（检查地址/密钥/模型名）" },
        400,
      );
    try {
      return json(await testAiConnection(config));
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/other/candidates" && request.method === "GET") {
    const name = (url.searchParams.get("name") ?? url.searchParams.get("title"))?.trim() ?? "";
    const english = (url.searchParams.get("english") ?? "").trim();
    if (!name || name.length > 120)
      return json({ status: false, msg: "invalid_name", data: null }, 400);
    // 与 name 同口径的上限：english 原样进上游查询 URL，当前前端虽不发这个
    // 参数，也别留一个无界的口子在这。
    if (english.length > 120)
      return json({ status: false, msg: "invalid_english", data: null }, 400);
    const year = normalizeYear(
      url.searchParams.get("year") ?? url.searchParams.get("release_date"),
    );
    // 与 /api/other/detail 共享「other」限流桶：诊断端点不能变成绕过配额的旁路。
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    try {
      const report = await withDeadline(
        otherCandidateReport(name, english, year),
        OTHER_CANDIDATES_DEADLINE_MS,
        "other-candidates",
      );
      return json({ status: true, msg: "ok", data: report }, 200, {
        "cache-control": "public, max-age=300",
      });
    } catch (error) {
      if (error instanceof DeadlineError) return upstreamTimeout();
      return json({ status: false, msg: "wiki_unavailable", data: null }, 502, {
        "cache-control": "public, max-age=60",
      });
    }
  }
  if (url.pathname === "/api/other/cover-choice" && request.method === "POST") {
    // 用户的封面选择写进 poster_urls —— 不新增表、不加列，直接 UPSERT 同一张表，
    // 于是前端 <Poster> 零改动就能吃到它（PLAN-CHOICE-UI §3.3）。
    //
    // 三道闸门，缺一不可：
    //  ① assertSameOrigin —— 挡跨站表单/跨源脚本写入。
    //  ② getUserFromToken —— 必须登录：这是**全站封面位**的写入口，匿名可写等于
    //     任何人都能改别人看到的封面。/api/poster-errors/client 那类匿名写端点
    //     只写 poster_errors 错误日志，不碰展示数据，性质不同。
    //  ③ allowedImage + 维基域白名单 —— allowedImage 管「能不能取图」，
    //     白名单管「能不能把一个地址塞进封面位」：只收 upload/thumb.wikimedia.org。
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "other", 20)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "auth_required" }, 401);
    const body = await readJson(request);
    const title = cleanString(body.title, "title", 160);
    // english 缺省回落到标题：Poster.tsx 的 batchKey 就是这个口径（subtitle ?? title），
    // 少了这个回落就会算出一个前端永远取不到的键。
    const english = cleanOptionalString(body.english, "english", 160) ?? title;
    const wikiTitle = cleanString(body.wikiTitle, "wiki_title", 160);
    const rawUrl = cleanString(body.url, "url", 1200);
    const parsed = allowedImage(rawUrl);
    // 维基之外一律拒绝：这条写入会直接变成用户看到的封面位。
    if (!parsed || !/^(?:upload|thumb)\.wikimedia\.org$/.test(parsed.hostname))
      return json({ error: "invalid_url" }, 400);
    const key = posterKeyFor({ title, english, year: body.year, type: "other" });
    if (!key) return json({ error: "invalid_title" }, 400);
    const storedUrl = parsed.href;
    await saveResolvedPosters(env.DB, [{ key, urls: [storedUrl] }]);
    // 回读确认：poster_urls 无 TTL，一次写错就是永久的一行。
    // 注意这只能证明「写进去又读得回来」，证明不了「键与前端要的那把一致」——
    // 那条不变量由 worker/coverChoice.test.ts 用前端公式 posterMediaKey 钉住。
    const stored = await loadPosterUrls(env.DB, [key]);
    const urls = stored.get(key) ?? [];
    if (!urls.includes(storedUrl)) return json({ error: "write_verify_failed" }, 500);
    // 审计留痕：任何登录用户都能改全站封面位（注释已声明的产品取舍），
    // 这笔写必须可追溯——与管理操作同表（admin_audit，看板渲染已过 esc）。
    await recordAudit(
      env,
      "cover_choice",
      JSON.stringify({ title, wikiTitle, url: storedUrl, userId: user.id, email: user.email }),
      request,
    );
    return json({ ok: true, key, url: storedUrl, wikiTitle }, 200);
  }
  if (url.pathname === "/api/ai/jev/test" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev_test", 5, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateJevConfig(body.config);
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "TypeSafe API Key 不合法（长度 8-256）" },
        400,
      );
    try {
      return json(await testJevConnection(config));
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev-rank" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev", 10, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateJevConfig(body.config);
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "TypeSafe API Key 不合法（长度 8-256）" },
        400,
      );
    const parsed = parseJevRankBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "作品数据不合法" }, 400);
    try {
      const result = await jevRank(parsed, config);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev-disambiguate" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_jev_disambiguate", 20, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    // 未配置 key 一律 400：调用方据此回落规则路径，主链路永不依赖本端点
    // （docs/agents/CONVENTIONS.md §3「主链路永不依赖外部决策服务」）。
    const config = validateJevConfig(body.config);
    if (!config)
      return json(
        {
          ok: false,
          error: "invalid_config",
          msg: "未配置 TypeSafe API Key，请回落到规则解析",
        },
        400,
      );
    const parsed = parseJevChooseBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "候选数据不合法" }, 400);
    try {
      const result = await jevChoose(parsed, config);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error), fallback: "rules" }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/jev-pick" && request.method === "POST") {
    assertSameOrigin(request);
    // 辅助模式每对作品一次预测,高频但单次极廉价(输入 token 为主);桶放宽到 60
    if (!(await allowUpstreamRequest(request, "ai_jev_pick", 60, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    const config = validateJevConfig(body.config);
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "TypeSafe API Key 不合法（长度 8-256）" },
        400,
      );
    const parsed = parseJevPickBody(body);
    if (!parsed) return json({ ok: false, error: "invalid_data", msg: "作品数据不合法" }, 400);
    try {
      const result = await jevPick(parsed, config);
      return json({ ok: true, ...result }, 200, { "cache-control": "no-store" });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/ai/models" && request.method === "POST") {
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "ai_models", 10, env.DB)))
      return json({ ok: false, error: "rate_limited", msg: "操作太频繁，请稍后再试" }, 429, {
        "retry-after": "600",
      });
    const body = await readJson(request);
    // 模型列表不依赖 model：留空时补占位符，让「先取列表、再填 Model」的顺序可行
    const raw = (body.config ?? {}) as Record<string, unknown>;
    const config = validateUserConfig({
      ...raw,
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : "list",
    });
    if (!config)
      return json(
        { ok: false, error: "invalid_config", msg: "API 配置不合法（检查地址/密钥）" },
        400,
      );
    try {
      const result = await listAiModels(config);
      return json({ ok: true, ...result });
    } catch (error) {
      return json({ ok: false, ...aiErrorPayload(error) }, aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/insights" && request.method === "POST") {
    assertSameOrigin(request);
    const body = await readJson(request);
    const scene = cleanOptionalString(body.scene, "scene", 10);
    if (scene !== "ranking" && scene !== "profile" && scene !== "compare")
      return json({ error: "invalid_scene" }, 400);
    const data = body.data;
    if (!isObject(data)) return json({ error: "invalid_data", msg: "数据格式不正确" }, 400);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_AI_DATA_BYTES)
      return json({ error: "data_too_large", msg: "数据过大" }, 413);
    const locale = body.locale === "en" ? "en" : "zh";
    const length = body.length === "brief" || body.length === "deep" ? body.length : "standard";
    // 推理模型（mimo 等）的 reasoning 段与正文共享 max_tokens 预算：max_tokens 过小
    // 会在长推理时把正文拦腰截断（finish_reason=length）。按档位放宽；输出字符兜底
    // 截断同步按档位放宽（历史 2000 字符硬顶会把 deep 档三段点评斩半）。
    const maxTokens = length === "deep" ? 6000 : length === "standard" ? 3500 : 2000;
    const maxOutputChars = length === "deep" ? 9000 : length === "standard" ? 5000 : 2500;
    // 通道选择：带合法 config 走自定义（独立限流），否则内置 env（未配置即 503）。
    const custom = body.config !== undefined ? validateUserConfig(body.config) : null;
    if (body.config !== undefined && !custom)
      return json({ error: "invalid_config", msg: "API 配置不合法（检查地址/密钥/模型名）" }, 400);
    let source: "builtin" | "custom";
    let resolved: ResolvedAi | null = null;
    if (custom) {
      if (!(await allowUpstreamRequest(request, "ai_custom", 15, env.DB)))
        return json({ error: "rate_limited", msg: "操作太频繁，请 10 分钟后再试" }, 429, {
          "retry-after": "600",
        });
      source = "custom";
    } else {
      if (!env.AI_API_KEY)
        return json(
          { error: "ai_not_configured", msg: "服务端未配置 AI，可在设置里填入自己的 API" },
          503,
        );
      // 内置通道烧的是服务端额度：先限流，再要求登录（自填 config 不受此限）。
      if (!(await allowUpstreamRequest(request, "ai", 8, env.DB)))
        return json({ error: "rate_limited", msg: "操作太频繁，请 10 分钟后再试" }, 429, {
          "retry-after": "600",
        });
      const aiUser = env.DB ? await getUserFromToken(request, env.DB) : null;
      if (!aiUser)
        return json(
          {
            error: "authentication_required",
            msg: "内置 AI 仅对登录用户开放，也可在设置里填入自己的 API",
          },
          401,
        );
      const model = env.AI_MODEL?.trim() || "claude-3-5-haiku-latest";
      // 内置通道协议：缺省 anthropic（保持历史行为，AI_API_URL 原样直发）；
      // 配成 chat/responses/gemini 时按端点归一规则补路径。
      const protocol: AiProtocol =
        env.AI_PROTOCOL === "chat" ||
        env.AI_PROTOCOL === "responses" ||
        env.AI_PROTOCOL === "gemini"
          ? env.AI_PROTOCOL
          : "anthropic";
      const base = (
        env.AI_API_URL?.trim() || "https://token-plan-cn.xiaomimimo.com/anthropic"
      ).replace(/\/+$/, "");
      resolved = {
        endpoint: protocol === "anthropic" ? base : resolveEndpoint(base, protocol, model),
        apiKey: env.AI_API_KEY,
        model,
        protocol,
      };
      source = "builtin";
    }
    // 管理端在线覆盖优先（§6.3）；数据块始终由服务端渲染。
    const overrideSystem = await readPromptOverride(env.DB, scene);
    const spec = composePrompt(scene as AiScene, data, locale, { length, overrideSystem });
    if (!spec) return json({ error: "invalid_data", msg: "数据格式不正确" }, 400);
    try {
      if (custom) {
        const outcome = await callModelAuto(custom, spec);
        return json(
          {
            insight: outcome.text,
            source,
            model: outcome.model,
            protocol: outcome.protocol,
            promptVersion: spec.version,
          },
          200,
          { "cache-control": "no-store" },
        );
      }
      const outcome = resolved as ResolvedAi; // custom 为 null 时上面分支必然已赋值
      return json(
        {
          insight: await callAi(outcome, spec, { maxTokens, maxOutputChars }),
          source,
          model: outcome.model,
          protocol: outcome.protocol,
          promptVersion: spec.version,
        },
        200,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      if (error instanceof AiError) console.warn(`ai insights failed: ${error.code}`);
      return json(aiErrorPayload(error), aiErrorStatus(error));
    }
  }
  if (url.pathname === "/api/music/play" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    const artist = url.searchParams.get("artist")?.trim() ?? "";
    if (!query || query.length > 80 || artist.length > 80)
      return json({ error: "invalid_query" }, 400);
    // 试听与歌词**各自独立**的配额（各 12 次/10 分钟）：一个入口不再吃掉另一个的额度。
    // 命中缓存（同一首歌重听）时零上游调用，就不记账；只有真会打上游的请求才占额度。
    // 限流窗口是 10 分钟，retry-after 必须与之一致，否则客户端按 60 秒重试仍会被拦。
    if (
      playNeedsUpstream(query, artist) &&
      !(await allowUpstreamRequest(request, "music_play", 12))
    ) {
      return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
    }
    try {
      const { tracks, blocked } = await gdSearch(query, 10, env);
      if (blocked)
        return json({ error: "music_upstream_limited" }, 429, {
          "retry-after": "300",
          msg: "音乐服务暂时限流，稍后再试",
        });
      if (!tracks.length)
        return json({ error: "music_search_failed", msg: "音乐搜索暂不可用，请稍后重试" }, 502, {
          "cache-control": "public, max-age=60",
        });
      let track = null;
      let playUrl = "";
      for (const candidate of pickTracks(tracks, query, artist, 3)) {
        const candidateUrl = await gdPlayUrl(String(candidate.id), env);
        if (candidateUrl) {
          track = candidate;
          playUrl = candidateUrl;
          break;
        }
      }
      if (!track)
        return json({ error: "music_not_found" }, 404, { "cache-control": "public, max-age=300" });
      const isCover = isCoverTrack(track, query, artist);
      return json({ track, playUrl, lyricId: String(track.lyric_id || track.id), isCover }, 200, {
        "cache-control": "no-store",
      });
    } catch {
      return json({ error: "music_unavailable" }, 502);
    }
  }
  // 歌词：按歌曲名（+可选歌手）解析曲目后返回 LRC 剥离时间轴的纯文本
  if (url.pathname === "/api/music/lyric" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    const artist = url.searchParams.get("artist")?.trim() ?? "";
    if (!query || query.length > 80 || artist.length > 80)
      return json({ error: "invalid_query" }, 400);
    if (
      lyricNeedsUpstream(query, artist) &&
      !(await allowUpstreamRequest(request, "music_lyric", 12))
    ) {
      return json({ error: "rate_limited" }, 429, { "retry-after": "600" });
    }
    try {
      const { tracks, blocked } = await gdSearch(query, 10, env);
      if (blocked)
        return json({ error: "music_upstream_limited" }, 429, {
          "retry-after": "300",
          msg: "歌词服务暂时限流，稍后再试",
        });
      if (!tracks.length)
        return json({ error: "music_search_failed", msg: "歌词搜索暂不可用，请稍后重试" }, 502, {
          "cache-control": "public, max-age=60",
        });
      const track = pickTrack(tracks, query, artist);
      if (!track)
        return json({ error: "music_not_found" }, 404, { "cache-control": "public, max-age=300" });
      const result = await gdLyric(String(track.lyric_id || track.id), env);
      if (!result)
        return json({ error: "lyric_not_found" }, 404, { "cache-control": "public, max-age=3600" });
      const lyric = stripLrc(result.lyric);
      const tlyric = stripLrc(result.tlyric);
      return json(
        {
          title: track.name,
          artist: Array.isArray(track.artist)
            ? track.artist.join(" / ")
            : String(track.artist ?? ""),
          lyric,
          ...(tlyric ? { tlyric } : {}),
        },
        200,
        { "cache-control": "public, max-age=86400" },
      );
    } catch {
      return json({ error: "lyric_unavailable" }, 502);
    }
  }

  // POST /api/cache/clear —— 登录用户清除服务端缓存（海报/文字/歌曲/其他）
  // 缓存代次是全局的：不登录即可清空等于给了匿名者反复把压力打回上游的开关。
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
  // 网易云扫码登录（weapi 协议）与连接状态管理
  if (url.pathname.startsWith("/api/netease/")) {
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    // 先限流再查会话：未登录请求不能靠伪造/缺失 token 绕过频控去刷 D1。
    if (!(await allowUpstreamRequest(request, "netease", 120)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    try {
      if (url.pathname === "/api/netease/qr/issue" && request.method === "GET") {
        const { unikey, qrValue, ttl } = await neteaseQrIssue();
        // 所有权绑定（SEC-03）：key 只属于发起账户，轮询确认时才能把凭证写入自己的 vault。
        await registerQrTransaction(env.DB, "netease", unikey, user.id, ttl * 1000);
        return json({ unikey, qr_value: qrValue, ttl });
      }
      if (url.pathname === "/api/netease/qr/poll" && request.method === "GET") {
        const unikey = url.searchParams.get("unikey")?.trim() ?? "";
        if (!unikey || unikey.length > 64) return json({ error: "invalid_key" }, 400);
        const tx = await getQrTransaction(env.DB, "netease", unikey, user.id);
        if (!tx) return json({ state: "expired", error: "qr_expired_or_invalid" });
        const result = await neteaseQrPoll(unikey, env, user.id);
        // 终态一次性消费事务；waiting/scanned 保留供后续轮询。
        if (result.state === "confirmed" || result.state === "expired" || result.state === "risk")
          await consumeQrTransaction(env.DB, "netease", unikey, user.id);
        return json(result);
      }
      if (url.pathname === "/api/netease/status" && request.method === "GET") {
        const connected = await hasProviderCookie(env, user.id, "netease");
        const account = connected ? await neteaseAccountInfo(env, user.id) : null;
        return json({ connected, account });
      }
      // 按 UID 浏览任意用户的公开歌单（含收藏）。开放接口优先、weapi 兜底；
      // 两层都拿不到时 blocked=true（网易云对本出口 IP 匿名风控），前端引导连接账号。
      if (url.pathname === "/api/netease/user-playlists" && request.method === "GET") {
        const uid = Number(url.searchParams.get("uid")?.trim());
        if (!Number.isInteger(uid) || uid <= 0 || uid > 1e12)
          return json(
            { error: "invalid_uid", msg: "请输入正确的网易云用户 ID（个人主页 URL 里的纯数字）" },
            400,
          );
        const cookie = await loadProviderCookie(env, user.id, "netease");
        const { playlists, blocked } = await neteaseUserPlaylists(cookie, uid);
        return json({
          playlists,
          total: playlists.length,
          blocked,
          msg:
            blocked && !cookie
              ? "网易云暂时限制了服务器匿名访问。展开下方「连接我的网易云账号」后重试即可。"
              : undefined,
        });
      }
      // 手动粘贴 Cookie 连接（扫码被风控时的替代入口）：校验 MUSIC_U 真实可用后才入保险库
      if (url.pathname === "/api/netease/cookie" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { cookie?: unknown } | null;
        const raw = typeof body?.cookie === "string" ? body.cookie.trim() : "";
        if (!raw || raw.length > 4096)
          return json(
            { error: "invalid_cookie", msg: "请粘贴包含 MUSIC_U 的完整 Cookie（或纯 MUSIC_U 值）" },
            400,
          );
        const musicU = raw.match(/MUSIC_U=([^;,\s]+)/)?.[1];
        if (!musicU)
          return json(
            {
              error: "missing_music_u",
              msg: "粘贴的内容里没有 MUSIC_U，请确认已登录 music.163.com",
            },
            400,
          );
        const csrf = raw.match(/__csrf=([^;,\s]+)/)?.[1];
        const normalized = csrf ? `MUSIC_U=${musicU}; __csrf=${csrf}` : `MUSIC_U=${musicU}`;
        const uid = await neteaseUserId(normalized);
        if (!uid)
          return json(
            {
              error: "cookie_invalid",
              msg: "该 Cookie 无法通过网易云校验（可能已失效），请重新复制",
            },
            400,
          );
        await saveProviderCookie(env, user.id, "netease", normalized);
        await recordAudit(
          env,
          "netease:cookie",
          `用户 #${user.id} 手动连接网易云 (uid=${uid})`,
          request,
        );
        return json({ ok: true, nickname: null });
      }
      if (url.pathname === "/api/netease/disconnect" && request.method === "POST") {
        await deleteProviderCookie(env, user.id, "netease");
        await recordAudit(env, "netease:disconnect", `用户 #${user.id} 断开网易云连接`, request);
        return json({ ok: true });
      }
    } catch (error) {
      console.error("netease qr failed:", error instanceof Error ? error.message : error);
      return json({ error: "netease_unavailable", msg: "网易云接口暂时不可用，请稍后重试" }, 502);
    }
    return json({ error: "not_found" }, 404);
  }
  if (url.pathname.startsWith("/api/douban/")) {
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    // 先限流再查会话（同上）。
    if (!(await allowUpstreamRequest(request, "douban", 120)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    try {
      if (url.pathname === "/api/douban/qr/issue" && request.method === "GET") {
        const { code, qrImage, ttl } = await doubanQrIssue();
        await registerQrTransaction(env.DB, "douban", code, user.id, ttl * 1000);
        return json({ code, qr_image: qrImage, ttl });
      }
      if (url.pathname === "/api/douban/qr/poll" && request.method === "GET") {
        const code = url.searchParams.get("code")?.trim() ?? "";
        if (!code || code.length > 128) return json({ error: "invalid_key" }, 400);
        const tx = await getQrTransaction(env.DB, "douban", code, user.id);
        if (!tx) return json({ state: "expired", error: "qr_expired_or_invalid" });
        const result = await doubanQrPoll(code, env, user.id);
        if (result.state === "confirmed" || result.state === "expired" || result.state === "risk")
          await consumeQrTransaction(env.DB, "douban", code, user.id);
        return json(result);
      }
      if (url.pathname === "/api/douban/status" && request.method === "GET") {
        const connected = await hasProviderCookie(env, user.id, "douban");
        const account = connected ? await doubanAccountInfo(env, user.id) : null;
        return json({ connected, account });
      }
      // 手动粘贴 Cookie 连接：校验 dbcl2 真实可用后才入保险库
      if (url.pathname === "/api/douban/cookie" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { cookie?: unknown } | null;
        const raw = typeof body?.cookie === "string" ? body.cookie.trim() : "";
        if (!raw || raw.length > 4096)
          return json(
            { error: "invalid_cookie", msg: "请粘贴包含 dbcl2 的完整 Cookie（或纯 dbcl2 值）" },
            400,
          );
        const normalized = extractDoubanLoginCookie(raw);
        if (!normalized)
          return json(
            { error: "missing_dbcl2", msg: "粘贴的内容里没有 dbcl2，请确认已登录 douban.com" },
            400,
          );
        const uid = await doubanUserId(normalized);
        if (!uid)
          return json(
            {
              error: "cookie_invalid",
              msg: "该 Cookie 无法通过豆瓣校验（可能已失效），请重新复制",
            },
            400,
          );
        await saveProviderCookie(env, user.id, "douban", normalized);
        await recordAudit(
          env,
          "douban:cookie",
          `用户 #${user.id} 手动连接豆瓣 (uid=${uid})`,
          request,
        );
        return json({ ok: true });
      }
      if (url.pathname === "/api/douban/disconnect" && request.method === "POST") {
        await deleteProviderCookie(env, user.id, "douban");
        await recordAudit(env, "douban:disconnect", `用户 #${user.id} 断开豆瓣连接`, request);
        return json({ ok: true });
      }
    } catch (error) {
      console.error("douban qr failed:", error instanceof Error ? error.message : error);
      return json({ error: "douban_unavailable", msg: "豆瓣接口暂时不可用，请稍后重试" }, 502);
    }
    return json({ error: "not_found" }, 404);
  }
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
      // posts 创建/编辑的 body 携带完整清单，与 handler 的 MAX_PAYLOAD_BYTES（512KB）对齐；
      // 其余写接口（点赞/评论/可见性）都是小 body，保持 48KB。
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
      // profile 保存 / collections 创建携带完整清单（与 handler 的 MAX_PAYLOAD_BYTES 对齐）；
      // 登录/注册/昵称等小 body 保持 48KB。
      const bulkWrite =
        (url.pathname === "/api/account/profile" && request.method === "PUT") ||
        (url.pathname === "/api/account/collections" && request.method === "POST");
      parseContentLength(request, bulkWrite ? MAX_PAYLOAD_BYTES : MAX_REQUEST_BYTES);
      // 注册/登录/换票更严，其余账号写操作用宽松桶。
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
  // Short-link sharing
  if (url.pathname === "/api/share" && request.method === "POST") {
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    assertSameOrigin(request);
    if (!(await allowUpstreamRequest(request, "share", 30, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES)
      return json({ error: "profile_too_large" }, 413);
    let body: JsonObject;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isObject(parsed)) throw new Error("not an object");
      body = parsed;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!isObject(body.profile)) return json({ error: "invalid_profile" }, 400);
    // 有效期白名单（天），默认 30；不提供永久档（链接含完整排名，过期即失效）
    const SHARE_EXPIRY_DAYS = [7, 30, 90, 365];
    const expiresDays =
      typeof body.expires_days === "number" &&
      (SHARE_EXPIRY_DAYS as number[]).includes(body.expires_days)
        ? body.expires_days
        : 30;
    // 唯一编码出口：白名单投影剔除 posterUrls 与任何未知字段（共享链接同样会进库）。
    const encoded = encodeStoredProfile(body.profile);
    if (!encoded.ok) {
      return encoded.error === "payload_too_large"
        ? json({ error: "profile_too_large" }, 413)
        : json({ error: "invalid_profile" }, 400);
    }
    const profileStr = encoded.json;
    // 批注走白名单编码出口，禁止任意 JSON 整包入库。
    const notesEncoded = encodeStoredNotes(body.notes);
    if (!notesEncoded.ok) return json({ error: "notes_too_large" }, 413);
    const notesJson = notesEncoded.json;
    const expires = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
    let code = "";
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
      code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      try {
        await env.DB.prepare(
          "INSERT INTO shared_links (code, profile, notes, expires_at) VALUES (?, ?, ?, ?)",
        )
          .bind(code, profileStr, notesJson, expires)
          .run();
        inserted = true;
      } catch {
        /* Retry a short-code collision. */
      }
    }
    if (!inserted) return json({ error: "link_create_failed" }, 503);
    const origin = new URL(request.url).origin;
    return json({
      code,
      url: `${origin}/share/${code}`,
      compareUrl: `${origin}/encounter?payload=${code}`,
      expires_days: expiresDays,
      expires_at: expires,
    });
  }
  if (url.pathname.startsWith("/api/share/") && request.method === "GET") {
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    const code = url.pathname.slice("/api/share/".length);
    if (!code || code.length > 20) return json({ error: "invalid_code" }, 400);
    const row = await env.DB.prepare(
      "SELECT profile, notes, expires_at FROM shared_links WHERE code = ? AND julianday(expires_at) > julianday('now')",
    )
      .bind(code)
      .first<{ profile: string; notes: string | null; expires_at: string }>();
    if (!row) return json({ error: "link_expired_or_not_found" }, 404);
    // 读取端自愈：旧链接里的画像可能残留 posterUrls（见 shared/storedItem.ts）。
    const result: Record<string, unknown> = {
      profile: healStoredProfile(JSON.parse(row.profile)),
      expires_at: row.expires_at,
    };
    if (row.notes) {
      try {
        result.notes = JSON.parse(row.notes);
      } catch {
        /* ignore */
      }
    }
    return json(result, 200, { "cache-control": "public, max-age=3600" });
  }
  if (url.pathname === "/api/challenges" && request.method === "POST") {
    if (!(await allowUpstreamRequest(request, "challenge", 30, env.DB)))
      return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
    return createChallenge(request, env);
  }
  if (url.pathname.startsWith("/api/challenges/") && request.method === "GET") {
    return getChallenge(decodeURIComponent(url.pathname.slice("/api/challenges/".length)), env);
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
    // 每分钟每 isolate 刷新一次缓存代次（refreshGenerations 自带 60s 节流）：
    // 否则服务型 isolate 的 generationOf 恒为旧值，清缓存的跨节点失效是空话（复审 #4）
    if (env.DB && request.method === "GET") {
      ctx.waitUntil(refreshGenerations(env.DB).catch(() => undefined));
    }
    const t0 = Date.now();
    let response: Response;
    let error: string | undefined;

    try {
      const cacheable =
        request.method === "GET" &&
        ["/api/douban/top250", "/api/douban/suggest", "/api/posters", "/api/image"].includes(path);
      // 键带「其他」代次：清缓存推进代次后，旧边缘条目自然孤儿化
      const edgeKey = cacheable
        ? new Request(
            `https://route-cache.art-rank.internal/${generationOf("misc")}${url.pathname}${url.search}`,
          )
        : null;
      if (cacheable && edgeKey) {
        const edgeCache = (caches as unknown as { default: Cache }).default;
        const hit = await edgeCache.match(edgeKey);
        if (hit) {
          if (isApi)
            ctx.waitUntil(
              logApiCall(env, path, request.method, hit.status, Date.now() - t0, "cache"),
            );
          return hit;
        }
      }
      response = await route(request, env);
      if (cacheable && edgeKey && response.ok)
        ctx.waitUntil(
          (caches as unknown as { default: Cache }).default.put(edgeKey, response.clone()),
        );
    } catch (err) {
      if (err instanceof HttpError) {
        response = json({ error: err.code, message: err.message }, err.status);
        error = err.message;
      } else {
        console.error("unhandled worker error", err instanceof Error ? err.stack : err);
        // 不把内部错误信息回传给客户端：堆栈/驱动细节只进服务端日志与 api_logs
        // （安全审计 2026-10-29 P2）。
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
      ctx.waitUntil(
        logApiCall(
          env,
          path,
          request.method,
          response.status,
          duration,
          response.status >= 400 ? "error" : "ok",
          error,
          ip,
        ),
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
        // 跨 isolate 限流窗口：过期条目不再约束任何人，直接清掉避免长期累积。
        env.DB.prepare("DELETE FROM rate_limits WHERE started_at < ?").bind(
          Date.now() - RATE_WINDOW_MS,
        ),
      ]);
    } catch (error) {
      console.error("scheduled cleanup failed", error instanceof Error ? error.message : error);
    }
  },
} satisfies ExportedHandler<Env>;
