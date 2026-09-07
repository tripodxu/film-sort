import { doubanTop250, doubanSuggest, doubanBookTop250, doubanBookSuggest, doubanMusicTop250, proxyImage, resolvePosters } from "./media";
import { accountRoute } from "./account";

export interface Env {
  DB?: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
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
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
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

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return withSecurityHeaders(new Response(JSON.stringify(data), { status, headers }));
}

function withSecurityHeaders(response: Response): Response {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    result.headers.set(key, value);
  }
  return result;
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "cross_origin_forbidden", "Cross-origin writes are not allowed.");
  }
}

function parseContentLength(request: Request): void {
  const value = request.headers.get("content-length");
  if (value && Number(value) > MAX_REQUEST_BYTES) {
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
    throw new HttpError(400, "invalid_field", `${field} must be an integer from ${minimum} to ${maximum}.`);
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
    throw new HttpError(400, "invalid_session_id", "session_id must be an anonymous random identifier.");
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
    return json(
      { error: "challenge_storage_unavailable", fallback: "payload" },
      503,
      { "retry-after": "60" },
    );
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

async function serveAssets(request: Request, env: Env): Promise<Response> {
  let response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === "GET") {
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      const indexUrl = new URL("/", request.url);
      response = await env.ASSETS.fetch(new Request(indexUrl, request));
    }
  }
  return withSecurityHeaders(response);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return json({ error: "cross_origin_forbidden" }, 405, { allow: "GET, POST" });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, storage: env.DB ? "d1" : "disabled" });
  }
  if (url.pathname === "/api/events" && request.method === "POST") {
    return createEvent(request, env);
  }
  if (url.pathname === "/api/stats" && request.method === "GET") {
    return getStats(env);
  }
  if (url.pathname === "/api/douban/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250) return json({ error: "invalid_limit" }, 400);
    try { const works = await doubanTop250(limit); return json({ source: "douban", total: works.length, works }, 200, { "cache-control": "public, max-age=900" }); }
    catch { return json({ error: "douban_unavailable" }, 502); }
  }
  if (url.pathname === "/api/douban/books/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250) return json({ error: "invalid_limit" }, 400);
    try { const works = await doubanBookTop250(limit); return json({ source: "douban", total: works.length, works }, 200, { "cache-control": "public, max-age=900" }); }
    catch { return json({ error: "douban_unavailable" }, 502); }
  }
  if (url.pathname === "/api/douban/music/top250" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 2 || limit > 250) return json({ error: "invalid_limit" }, 400);
    try { const works = await doubanMusicTop250(limit); return json({ source: "douban", total: works.length, works }, 200, { "cache-control": "public, max-age=900" }); }
    catch { return json({ error: "douban_unavailable" }, 502); }
  }
  if (url.pathname === "/api/douban/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try { return json({ works: await doubanSuggest(query) }, 200, { "cache-control": "public, max-age=3600" }); }
    catch { return json({ error: "douban_unavailable", works: [] }, 502); }
  }
  if (url.pathname === "/api/douban/books/suggest" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    if (!query || query.length > 80) return json({ error: "invalid_query" }, 400);
    try { return json({ works: await doubanBookSuggest(query) }, 200, { "cache-control": "public, max-age=3600" }); }
    catch { return json({ error: "douban_unavailable", works: [] }, 502); }
  }
  if (url.pathname === "/api/posters" && request.method === "GET") {
    const title = url.searchParams.get("q")?.trim();
    const english = url.searchParams.get("en")?.trim() ?? "";
    const year = Number(url.searchParams.get("year")) || undefined;
    const type = url.searchParams.get("type") as "movie" | "book" | undefined;
    if (!title || title.length > 160 || english.length > 160 || (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 2200))) return json({ error: "invalid_query" }, 400);
    const poster_urls = await resolvePosters(title, english, year, type);
    return json({ poster_urls }, 200, { "cache-control": `public, max-age=${poster_urls.length ? 86400 : 300}` });
  }
  if (url.pathname === "/api/image" && request.method === "GET") return withSecurityHeaders(await proxyImage(url.searchParams.get("url") ?? ""));
  if (url.pathname === "/api/auth/config") return json({ enabled: Boolean(env.DB && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) });
  if (url.pathname === "/api/account/login" && request.method === "GET") {
    return Response.redirect(`${url.origin}/cdn-cgi/access/login?redirect_url=${encodeURIComponent(url.origin)}`, 302);
  }
  if (url.pathname.startsWith("/api/account/")) {
    if (request.method !== "GET") assertSameOrigin(request);
    return withSecurityHeaders(await accountRoute(request, env));
  }
  if (url.pathname === "/api/challenges" && request.method === "POST") {
    return createChallenge(request, env);
  }
  if (url.pathname.startsWith("/api/challenges/") && request.method === "GET") {
    return getChallenge(decodeURIComponent(url.pathname.slice("/api/challenges/".length)), env);
  }
  if (url.pathname.startsWith("/api/")) {
    return json({ error: "not_found" }, 404);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, 405);
  }
  return serveAssets(request, env);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      const cacheable = request.method === "GET" && ["/api/douban/top250", "/api/douban/suggest", "/api/posters", "/api/image"].includes(path);
      if (cacheable) {
        const edgeCache = (caches as unknown as { default: Cache }).default;
        const hit = await edgeCache.match(request);
        if (hit) return hit;
      }
      const response = await route(request, env);
      if (cacheable && response.ok) ctx.waitUntil((caches as unknown as { default: Cache }).default.put(request, response.clone()));
      return response;
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.code, message: error.message }, error.status);
      }
      console.error("unhandled worker error", error instanceof Error ? error.stack : error);
      return json({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
