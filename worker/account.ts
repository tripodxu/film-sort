import type { Env } from "./index";

const encoder = new TextEncoder();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function hashPassword(password: string): Promise<string> {
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  return cleaned;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getUserFromToken(request: Request, db: D1Database): Promise<{ id: number; email: string } | null> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32) return null;
  const session = await db.prepare(
    "SELECT u.id, u.email FROM user_sessions s JOIN user_accounts u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')"
  ).bind(token).first<{ id: number; email: string }>();
  return session ?? null;
}

export async function accountRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const path = new URL(request.url).pathname;

  // POST /api/account/register
  if (path === "/api/account/register" && request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = cleanString(body?.email, 160);
    const password = cleanString(body?.password, 128);
    if (!email || !isValidEmail(email)) return json({ error: "invalid_email" }, 400);
    if (!password || password.length < 6) return json({ error: "invalid_password", msg: "密码至少6位" }, 400);

    const existing = await env.DB.prepare("SELECT id FROM user_accounts WHERE email = ?").bind(email).first();
    if (existing) return json({ error: "email_exists" }, 409);

    const hash = await hashPassword(password);
    const result = await env.DB.prepare("INSERT INTO user_accounts (email, password_hash) VALUES (?, ?)").bind(email, hash).run();
    const userId = result.meta.last_row_id;

    const token = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expires).run();

    return json({ token, email, expires });
  }

  // POST /api/account/login
  if (path === "/api/account/login" && request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = cleanString(body?.email, 160);
    const password = cleanString(body?.password, 128);
    if (!email || !password) return json({ error: "missing_fields" }, 400);

    const user = await env.DB.prepare("SELECT id, password_hash FROM user_accounts WHERE email = ?").bind(email).first<{ id: number; password_hash: string }>();
    if (!user) return json({ error: "invalid_credentials" }, 401);

    const hash = await hashPassword(password);
    if (user.password_hash !== hash) return json({ error: "invalid_credentials" }, 401);

    const token = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, user.id, expires).run();
    await env.DB.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();

    return json({ token, email, expires });
  }

  // POST /api/account/logout
  if (path === "/api/account/logout" && request.method === "POST") {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token) await env.DB.prepare("DELETE FROM user_sessions WHERE token = ?").bind(token).run();
    return json({ ok: true });
  }

  // GET /api/account/profile
  if (path === "/api/account/profile" && request.method === "GET") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const row = await env.DB.prepare("SELECT profile, updated_at FROM user_profiles_v2 WHERE user_id = ? LIMIT 1").bind(user.id).first<{ profile: string; updated_at: string }>();
    return json({ email: user.email, profile: row ? JSON.parse(row.profile) : null, updatedAt: row?.updated_at ?? null });
  }

  // PUT /api/account/profile
  if (path === "/api/account/profile" && request.method === "PUT") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const raw = await request.text();
    if (encoder.encode(raw).byteLength > 512 * 1024) return json({ error: "payload_too_large" }, 413);
    let profile: unknown;
    try { profile = JSON.parse(raw).profile; } catch { return json({ error: "invalid_json" }, 400); }
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return json({ error: "invalid_profile" }, 400);
    await env.DB.prepare("INSERT INTO user_profiles_v2 (user_id, profile) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
      .bind(user.id, JSON.stringify(profile)).run();
    return json({ stored: true });
  }

  return json({ error: "not_found" }, 404);
}
