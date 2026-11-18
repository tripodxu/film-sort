import { type PosterBatchRequest } from "./media";
import { normalizePosterItem } from "./posterStore";
import { RATE_WINDOW_MS, consumeIsolateWindow, type RateWindow } from "./rateWindow";
import { consumeSharedWindow } from "./rateLimitStore";

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
  /** 站主内置 Jev 免费通道 key（Secret：wrangler secret put JEV_API_KEY）；缺省=免费通道关闭 */
  JEV_API_KEY?: string;
  COOKIE_ENC_KEY?: string;
  MUSIC_PROXY_URL?: string;
  MUSIC_PROXY_KEY?: string;
}

export type JsonObject = Record<string, unknown>;

export const MAX_REQUEST_BYTES = 48 * 1024;
export const MAX_POSTER_BATCH_ITEMS = 300;
export const MAX_POSTER_BATCH_BYTES = 128 * 1024;

export function upstreamTimeout(): Response {
  return json({ error: "upstream_timeout" }, 504, { "cache-control": "no-store" });
}

const upstreamWindows = new Map<string, RateWindow>();

export async function allowUpstreamRequest(
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
  if (!consumeIsolateWindow(upstreamWindows, key, limit, now)) return false;

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

  if (db) {
    try {
      if (!(await consumeSharedWindow(db, key, limit, now))) return false;
    } catch {
      /* best-effort */
    }
  }
  return true;
}

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export const SECURITY_HEADERS: Record<string, string> = {
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
export const ADMIN_SECURITY_HEADERS: Record<string, string> = {
  ...SECURITY_HEADERS,
  "content-security-policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; script-src-attr 'none'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getAdminToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

export async function adminAuth(request: Request, env: Env): Promise<boolean> {
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

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== new URL(request.url).origin) {
      throw new HttpError(403, "cross_origin_forbidden", "Cross-origin writes are not allowed.");
    }
    return;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin") return;
  throw new HttpError(403, "cross_origin_forbidden", "Cross-origin writes are not allowed.");
}

export function parseContentLength(request: Request, maxBytes = MAX_REQUEST_BYTES): void {
  const value = request.headers.get("content-length");
  if (value && Number(value) > maxBytes) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }
}

export async function readJson(request: Request): Promise<JsonObject> {
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

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizePosterBatch(raw: readonly unknown[]): PosterBatchRequest[] {
  const items: PosterBatchRequest[] = [];
  for (const entry of raw.slice(0, MAX_POSTER_BATCH_ITEMS)) {
    if (!isObject(entry)) continue;
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

export function cleanString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_field", `${field} must be a string.`);
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\u0000-\u001f\u007f]/.test(cleaned)) {
    throw new HttpError(400, "invalid_field", `${field} has an invalid length or characters.`);
  }
  return cleaned;
}

export function cleanOptionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  return cleanString(value, field, maxLength);
}

export function cleanOptionalInteger(
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
