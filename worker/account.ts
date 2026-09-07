import type { Env } from "./index";

const encoder = new TextEncoder();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const redirect = (url: string) => new Response(null, { status: 302, headers: { location: url } });

async function adminAuthLocal(request: Request, db: D1Database): Promise<boolean> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32) return false;
  const session = await db.prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')").bind(token).first();
  return !!session;
}

async function hashPassword(password: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return (!cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned)) ? null : cleaned;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getUserFromToken(request: Request, db: D1Database): Promise<{ id: number; email: string } | null> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32) return null;
  return await db.prepare(
    "SELECT u.id, u.email FROM user_sessions s JOIN user_accounts u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')"
  ).bind(token).first<{ id: number; email: string }>() ?? null;
}

async function createSession(db: D1Database, userId: number): Promise<{ token: string; expires: string }> {
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").bind(token, userId, expires).run();
  await db.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();
  return { token, expires };
}

async function findOrCreateOAuthUser(db: D1Database, provider: string, providerId: string, email: string, nickname?: string): Promise<number> {
  // Check if this OAuth account already exists
  const existing = await db.prepare("SELECT user_id FROM user_oauth WHERE provider = ? AND provider_id = ?").bind(provider, providerId).first<{ user_id: number }>();
  if (existing) {
    // Update nickname if provided
    if (nickname) await db.prepare("UPDATE user_accounts SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname = '')").bind(nickname, existing.user_id).run();
    return existing.user_id;
  }

  // Check if email already exists
  const user = await db.prepare("SELECT id FROM user_accounts WHERE email = ?").bind(email).first<{ id: number }>();
  let userId: number;
  if (user) {
    userId = user.id;
    if (nickname) await db.prepare("UPDATE user_accounts SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname = '')").bind(nickname, userId).run();
  } else {
    const result = await db.prepare("INSERT INTO user_accounts (email, password_hash, nickname) VALUES (?, '', ?)").bind(email, nickname ?? null).run();
    userId = result.meta.last_row_id as number;
  }

  // Link OAuth account
  await db.prepare("INSERT OR IGNORE INTO user_oauth (user_id, provider, provider_id) VALUES (?, ?, ?)").bind(userId, provider, providerId).run();
  return userId;
}

// ===== OAuth Providers =====
interface OAuthProvider {
  name: string;
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  clientId(env: Env): string | undefined;
  clientSecret(env: Env): string | undefined;
  parseUser(data: unknown): { id: string; email: string } | null;
}

const oauthProviders: Record<string, OAuthProvider> = {
  google: {
    name: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email",
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    parseUser(data) {
      const d = data as { id?: string; email?: string };
      return d.id && d.email ? { id: d.id, email: d.email } : null;
    },
  },
  github: {
    name: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scope: "user:email",
    clientId: (env) => env.GITHUB_CLIENT_ID,
    clientSecret: (env) => env.GITHUB_CLIENT_SECRET,
    parseUser(data) {
      const d = data as { id?: number; email?: string; login?: string };
      if (!d.id) return null;
      const email = d.email ?? `${d.login}@github.local`;
      return { id: String(d.id), email };
    },
  },
};

// ===== Route Handler =====
export async function accountRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const url = new URL(request.url);
  const path = url.pathname;

  // POST /api/account/register
  if (path === "/api/account/register" && request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = cleanString(body?.email, 160);
    const password = cleanString(body?.password, 128);
    const nickname = cleanString(body?.nickname, 40);
    if (!email || !isValidEmail(email)) return json({ error: "invalid_email" }, 400);
    if (!password || password.length < 6) return json({ error: "invalid_password", msg: "密码至少6位" }, 400);
    if (!nickname || nickname.length < 1) return json({ error: "invalid_nickname", msg: "昵称必填" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM user_accounts WHERE email = ?").bind(email).first();
    if (existing) return json({ error: "email_exists" }, 409);
    const hash = await hashPassword(password);
    const result = await env.DB.prepare("INSERT INTO user_accounts (email, password_hash, nickname) VALUES (?, ?, ?)").bind(email, hash, nickname).run();
    const session = await createSession(env.DB, result.meta.last_row_id as number);
    return json({ ...session, email, nickname });
  }

  // POST /api/account/login
  if (path === "/api/account/login" && request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = cleanString(body?.email, 160);
    const password = cleanString(body?.password, 128);
    if (!email || !password) return json({ error: "missing_fields" }, 400);
    const user = await env.DB.prepare("SELECT id, password_hash, nickname FROM user_accounts WHERE email = ?").bind(email).first<{ id: number; password_hash: string; nickname: string | null }>();
    if (!user || !user.password_hash || user.password_hash !== await hashPassword(password)) return json({ error: "invalid_credentials" }, 401);
    const session = await createSession(env.DB, user.id);
    return json({ ...session, email, nickname: user.nickname ?? email.split("@")[0] });
  }

  // POST /api/account/logout
  if (path === "/api/account/logout" && request.method === "POST") {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token) await env.DB.prepare("DELETE FROM user_sessions WHERE token = ?").bind(token).run();
    return json({ ok: true });
  }

  // GET /api/account/providers — list available OAuth providers
  if (path === "/api/account/providers" && request.method === "GET") {
    const providers = Object.entries(oauthProviders)
      .filter(([, p]) => p.clientId(env))
      .map(([key, p]) => ({ id: key, name: p.name }));
    return json({ providers });
  }

  // GET /api/account/oauth/callback — OAuth callback (must be before provider route)
  if (path === "/api/account/oauth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return redirect(`/?account=error&msg=${encodeURIComponent("Missing OAuth parameters")}`);
    }

    const [providerKey] = state.split(":");
    const provider = oauthProviders[providerKey];
    if (!provider) return redirect("/?account=error&msg=Unknown+provider");

    const clientId = provider.clientId(env);
    const clientSecret = provider.clientSecret(env);
    if (!clientId || !clientSecret) return redirect("/?account=error&msg=Provider+not+configured");

    try {
      // Exchange code for access token
      const tokenResponse = await fetch(provider.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "accept": "application/json",
          ...(providerKey === "github" ? { "user-agent": "film-sort" } : {}),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${url.origin}/api/account/oauth/callback`,
        }),
      });
      const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
      if (!tokenData.access_token) throw new Error(tokenData.error ?? "No access token");

      // Fetch user info
      const userResponse = await fetch(provider.userUrl, {
        headers: {
          authorization: `Bearer ${tokenData.access_token}`,
          accept: "application/json",
          ...(providerKey === "github" ? { "user-agent": "film-sort" } : {}),
        },
      });
      const userData = await userResponse.json();
      const parsed = provider.parseUser(userData);
      if (!parsed) throw new Error("Failed to parse user info");

      // Get nickname from provider data
      const raw = userData as Record<string, unknown>;
      const providerNickname = (providerKey === "google" ? raw.name : raw.login) as string | undefined;
      const nickname = providerNickname && providerNickname.length > 0 ? providerNickname : parsed.email.split("@")[0];

      // Find or create user
      const userId = await findOrCreateOAuthUser(env.DB, providerKey, parsed.id, parsed.email, nickname);
      const session = await createSession(env.DB, userId);

      // Redirect back to frontend with token
      return redirect(`/?oauth_token=${session.token}&oauth_email=${encodeURIComponent(parsed.email)}&oauth_name=${encodeURIComponent(nickname)}`);
    } catch (error) {
      console.error(`OAuth ${providerKey} failed:`, error);
      return redirect(`/?account=error&msg=${encodeURIComponent(error instanceof Error ? error.message : "OAuth failed")}`);
    }
  }

  // GET /api/account/oauth/:provider — initiate OAuth flow
  const oauthMatch = path.match(/^\/api\/account\/oauth\/(\w+)$/);
  if (oauthMatch && request.method === "GET") {
    const providerKey = oauthMatch[1];
    const provider = oauthProviders[providerKey];
    if (!provider) return json({ error: "unknown_provider" }, 404);
    const clientId = provider.clientId(env);
    const clientSecret = provider.clientSecret(env);
    if (!clientId || !clientSecret) return json({ error: "provider_not_configured" }, 503);

    const redirectUri = `${url.origin}/api/account/oauth/callback`;
    const state = generateToken().slice(0, 16);
    const authUrl = new URL(provider.authUrl);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", provider.scope);
    authUrl.searchParams.set("state", `${providerKey}:${state}`);
    authUrl.searchParams.set("response_type", "code");
    if (providerKey === "google") authUrl.searchParams.set("access_type", "offline");

    const response = redirect(authUrl.toString());
    response.headers.set("set-cookie", `oauth_state=${providerKey}:${state}; Path=/api/account; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return response;
  }

  // GET /api/account/profile
  if (path === "/api/account/profile" && request.method === "GET") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const account = await env.DB.prepare("SELECT nickname FROM user_accounts WHERE id = ?").bind(user.id).first<{ nickname: string | null }>();
    const row = await env.DB.prepare("SELECT profile, updated_at FROM user_profiles_v2 WHERE user_id = ? LIMIT 1").bind(user.id).first<{ profile: string; updated_at: string }>();
    return json({ email: user.email, nickname: account?.nickname ?? user.email.split("@")[0], profile: row ? JSON.parse(row.profile) : null, updatedAt: row?.updated_at ?? null });
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

  // PUT /api/account/nickname
  if (path === "/api/account/nickname" && request.method === "PUT") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const nickname = cleanString(body?.nickname, 40);
    if (!nickname || nickname.length < 1) return json({ error: "invalid_nickname", msg: "昵称必填" }, 400);
    await env.DB.prepare("UPDATE user_accounts SET nickname = ? WHERE id = ?").bind(nickname, user.id).run();
    return json({ ok: true, nickname });
  }

  // GET /api/admin/accounts — list all accounts (admin only)
  if (path === "/api/admin/accounts" && request.method === "GET") {
    if (!env.DB || !await adminAuthLocal(request, env.DB)) return json({ error: "auth_required" }, 401);
    const accounts = await env.DB.prepare("SELECT id, email, nickname, created_at FROM user_accounts ORDER BY created_at DESC LIMIT 100").all();
    return json({ accounts: accounts.results ?? [] });
  }

  // DELETE /api/admin/accounts/:id — delete account (admin only)
  const deleteMatch = path.match(/^\/api\/admin\/accounts\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    if (!env.DB || !await adminAuthLocal(request, env.DB)) return json({ error: "auth_required" }, 401);
    const userId = Number(deleteMatch[1]);
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM user_oauth WHERE user_id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM user_profiles_v2 WHERE user_id = ?").bind(userId).run();
    await env.DB.prepare("DELETE FROM user_accounts WHERE id = ?").bind(userId).run();
    return json({ ok: true });
  }

  // POST /api/admin/accounts/:id/reset-password — reset password (admin only)
  const resetMatch = path.match(/^\/api\/admin\/accounts\/(\d+)\/reset-password$/);
  if (resetMatch && request.method === "POST") {
    if (!env.DB || !await adminAuthLocal(request, env.DB)) return json({ error: "auth_required" }, 401);
    const userId = Number(resetMatch[1]);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const newPassword = cleanString(body?.password, 128);
    if (!newPassword || newPassword.length < 6) return json({ error: "invalid_password", msg: "密码至少6位" }, 400);
    const hash = await hashPassword(newPassword);
    await env.DB.prepare("UPDATE user_accounts SET password_hash = ? WHERE id = ?").bind(hash, userId).run();
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}
