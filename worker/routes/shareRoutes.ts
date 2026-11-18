import {
  MAX_PAYLOAD_BYTES,
  encodeStoredNotes,
  encodeStoredProfile,
  healStoredProfile,
} from "../../shared/storedItem";
import {
  HttpError,
  allowUpstreamRequest,
  assertSameOrigin,
  cleanOptionalInteger,
  cleanOptionalString,
  cleanString,
  isObject,
  json,
  readJson,
  type Env,
  type JsonObject,
} from "../http";

const CHALLENGE_ID = /^mv-[a-z0-9]{12}$/;
const MAX_CHALLENGE_ITEMS = 300;

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

export async function handleShareRoutes(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response | null> {
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
    const SHARE_EXPIRY_DAYS = [7, 30, 90, 365];
    const expiresDays =
      typeof body.expires_days === "number" &&
      (SHARE_EXPIRY_DAYS as number[]).includes(body.expires_days)
        ? body.expires_days
        : 30;
    const encoded = encodeStoredProfile(body.profile);
    if (!encoded.ok) {
      return encoded.error === "payload_too_large"
        ? json({ error: "profile_too_large" }, 413)
        : json({ error: "invalid_profile" }, 400);
    }
    const profileStr = encoded.json;
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
    let profile: unknown = null;
    try {
      profile = healStoredProfile(JSON.parse(row.profile));
    } catch {
      profile = null;
    }
    const result: Record<string, unknown> = {
      profile,
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
    let id: string;
    try {
      id = decodeURIComponent(url.pathname.slice("/api/challenges/".length));
    } catch {
      return json({ error: "invalid_challenge_id" }, 400);
    }
    return getChallenge(id, env);
  }
  return null;
}
