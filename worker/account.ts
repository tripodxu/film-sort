import type { Env } from "./index";
import { recordAudit } from "./audit";
import {
  MAX_PAYLOAD_BYTES,
  encodeStoredNotes,
  encodeStoredProfile,
  encodeStoredWorks,
  healStoredProfile,
} from "../shared/storedItem";

const encoder = new TextEncoder();
import { pbkdf2Sync } from "node:crypto";
import { sendVerificationCode, type MailerEnv } from "./mailer";
import {
  CODE_MAX_ATTEMPTS,
  consumeOAuthExchange,
  consumeVerificationCode,
  parseGoogleUser,
  sha256Hex,
} from "./verification";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const redirect = (url: string) => new Response(null, { status: 302, headers: { location: url } });

export async function adminAuthLocal(request: Request, db: D1Database): Promise<boolean> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || token.length < 32) return false;
  const session = await db
    .prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first();
  return !!session;
}

// ===== Password hashing =====
// Current scheme: PBKDF2-SHA256 with per-user salt, stored as pbkdf2$<iterations>$<salt>$<hash>.
// Legacy unsalted SHA-256 hashes are still verified and transparently upgraded on successful login.
// 轮数取平台上限：workerd（含 nodejs_compat 的 node:crypto）PBKDF2 硬限 100,000 轮，
// 600k（OWASP 2023 HMAC-SHA256 建议量级）在 CF 侧直接抛错——散列格式自带 iterations 字段，
// 未来迁离 Cloudflare 可对新散列无痛调回更高轮数（存量按存储值验证）。
const PBKDF2_ITERATIONS = 100_000;

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return toHex(hash);
}

export async function hashPasswordStrong(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  // workerd 的 crypto.subtle PBKDF2 有 100k 轮硬上限（600k 直接抛错）；
  // node:crypto（nodejs_compat）走 OpenSSL 实现无此限制。PBKDF2 为标准构造，
  // 同参数同输出——存量 pbkdf2$ 散列与 subtle 实现产物互验互通，轮数保持 OWASP 600k。
  return toHex(pbkdf2Sync(password, salt, iterations, 32, "sha256"));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    const [, iterationText, saltHex, hashHex] = stored.split("$");
    const iterations = Number(iterationText);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2_000_000) return false;
    if (!/^[0-9a-f]+$/.test(saltHex) || saltHex.length % 2 !== 0 || !/^[0-9a-f]{64}$/.test(hashHex))
      return false;
    const salt = Uint8Array.from({ length: saltHex.length / 2 }, (_, i) =>
      Number.parseInt(saltHex.slice(i * 2, i * 2 + 2), 16),
    );
    return timingSafeEqual(await pbkdf2(password, salt, iterations), hashHex);
  }
  return timingSafeEqual(await hashPassword(password), stored);
}

export function needsPasswordUpgrade(stored: string | null | undefined): boolean {
  return !!stored && !stored.startsWith("pbkdf2$");
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return !cleaned || cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned) ? null : cleaned;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 邮箱统一规范化（小写）：SQLite `=` 大小写敏感，大小写不一致会"查无此码/查无此人"。
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateCollectionBody(body: Record<string, unknown> | null): {
  kind: "film" | "book" | "music" | "other";
  title: string;
  description: string;
  items: unknown[];
} | null {
  const kind = body?.kind;
  const title = cleanString(body?.title, 160);
  const description = cleanString(body?.description, 500) ?? "";
  const items = body?.items;
  if (
    (kind !== "film" && kind !== "book" && kind !== "music" && kind !== "other") ||
    !title ||
    !Array.isArray(items) ||
    items.length < 2 ||
    items.length > 1000
  )
    return null;
  if (
    items.some(
      (item) =>
        typeof item !== "object" ||
        item === null ||
        typeof (item as Record<string, unknown>).title !== "string" ||
        String((item as Record<string, unknown>).title).trim().length === 0 ||
        String((item as Record<string, unknown>).title).length > 160,
    )
  )
    return null;
  return { kind, title, description, items };
}

export async function getUserFromToken(
  request: Request,
  db: D1Database,
): Promise<{ id: number; email: string } | null> {
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || token.length < 32) return null;
  return (
    (await db
      .prepare(
        "SELECT u.id, u.email FROM user_sessions s JOIN user_accounts u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now') AND u.disabled_at IS NULL",
      )
      .bind(token)
      .first<{ id: number; email: string }>()) ?? null
  );
}

async function createSession(
  db: D1Database,
  userId: number,
): Promise<{ token: string; expires: string }> {
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expires)
    .run();
  await db.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();
  return { token, expires };
}

async function findOrCreateOAuthUser(
  db: D1Database,
  provider: string,
  providerId: string,
  email: string | null,
  emailVerified: boolean,
  nickname?: string,
): Promise<number> {
  // Check if this OAuth account already exists
  const existing = await db
    .prepare("SELECT user_id FROM user_oauth WHERE provider = ? AND provider_id = ?")
    .bind(provider, providerId)
    .first<{ user_id: number }>();
  if (existing) {
    // Update nickname if provided
    if (nickname)
      await db
        .prepare(
          "UPDATE user_accounts SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname = '')",
        )
        .bind(nickname, existing.user_id)
        .run();
    return existing.user_id;
  }

  // 仅当 provider 声明邮箱已验证时才允许按邮箱并号；否则合成不可与真实邮箱碰撞的
  // 占位地址，杜绝「未验证 OAuth 邮箱 → 接管同邮箱密码账号」。
  const canMergeByEmail = Boolean(email && emailVerified);
  const accountEmail = canMergeByEmail
    ? (email as string)
    : `oauth.${provider}.${providerId}@users.invalid`;

  // Check if email already exists (verified OAuth only)
  let userId: number;
  if (canMergeByEmail) {
    const user = await db
      .prepare("SELECT id FROM user_accounts WHERE email = ?")
      .bind(accountEmail)
      .first<{ id: number }>();
    if (user) {
      userId = user.id;
      if (nickname)
        await db
          .prepare(
            "UPDATE user_accounts SET nickname = ? WHERE id = ? AND (nickname IS NULL OR nickname = '')",
          )
          .bind(nickname, userId)
          .run();
    } else {
      const result = await db
        .prepare("INSERT INTO user_accounts (email, password_hash, nickname) VALUES (?, '', ?)")
        .bind(accountEmail, nickname ?? null)
        .run();
      userId = result.meta.last_row_id as number;
    }
  } else {
    const result = await db
      .prepare("INSERT INTO user_accounts (email, password_hash, nickname) VALUES (?, '', ?)")
      .bind(accountEmail, nickname ?? null)
      .run();
    userId = result.meta.last_row_id as number;
  }

  // Link OAuth account
  await db
    .prepare("INSERT OR IGNORE INTO user_oauth (user_id, provider, provider_id) VALUES (?, ?, ?)")
    .bind(userId, provider, providerId)
    .run();
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
  parseUser(data: unknown): { id: string; email: string | null; emailVerified: boolean } | null;
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
    parseUser: parseGoogleUser,
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
      const d = data as { id?: number; email?: string; verified_email?: boolean };
      if (!d.id) return null;
      // 禁止合成可并号的邮箱（旧 `${login}@github.local` 会撞真实本地域）。
      // 无邮箱或未验证时只按 provider_id 建号，不参与邮箱并号。
      return {
        id: String(d.id),
        email: d.email ?? null,
        emailVerified: Boolean(d.email && d.verified_email),
      };
    },
  },
};

// ===== Route Handler =====
/** 与 index.readJson 同口径的 body 读取：限长 + 必须是 JSON 对象。 */
const MAX_REQUEST_BYTES = 48 * 1024;

async function readJsonObject(
  request: Request,
  maxBytes = MAX_REQUEST_BYTES,
): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function issueVerificationCode(
  db: D1Database,
  env: Env,
  email: string,
  purpose: "register" | "reset",
): Promise<{ ok: true; dev_code?: string } | { error: string; msg: string; detail?: string }> {
  const recent = await db
    .prepare(
      "SELECT id FROM verification_codes WHERE email = ? AND purpose = ? AND created_at > datetime('now','-60 seconds') LIMIT 1",
    )
    .bind(email, purpose)
    .first();
  if (recent) return { error: "code_cooldown", msg: "发送太频繁，请 60 秒后再试" };
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const code = String(buf[0] % 1000000).padStart(6, "0");
  // 删旧 + 写新放进同一个 batch：D1 batch 是事务性的，避免删完没写成功的空窗。
  await db.batch([
    db
      .prepare("DELETE FROM verification_codes WHERE email = ? AND purpose = ?")
      .bind(email, purpose),
    db
      .prepare(
        "INSERT INTO verification_codes (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, datetime('now','+10 minutes'))",
      )
      .bind(email, purpose, await sha256Hex(code)),
  ]);
  let sent: { ok: boolean; reason?: string };
  try {
    sent = await sendVerificationCode(env as unknown as MailerEnv, email, code, purpose);
  } catch (e) {
    return {
      error: "mail_failed",
      msg: "邮件发送失败，请稍后再试",
      detail: `exception:${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!sent.ok)
    return { error: "mail_failed", msg: "邮件发送失败，请稍后再试", detail: sent.reason };
  // 开发兜底（mailer 仅在 ENVIRONMENT=development/test 时返回 "dev"）把验证码放进响应，
  // 取代旧的"OTP 写日志"通道；生产 fail-closed 后该分支不可达。
  return sent.reason === "dev" ? { ok: true, dev_code: code } : { ok: true };
}

export async function accountRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const url = new URL(request.url);
  const path = url.pathname;

  // POST /api/account/register
  if (path === "/api/account/register" && request.method === "POST") {
    const body = await readJsonObject(request);
    const email = cleanString(body?.email, 160)?.toLowerCase() ?? null;
    const password = cleanString(body?.password, 128);
    const nickname = cleanString(body?.nickname, 40);
    const code = cleanString(body?.code, 12);
    if (!email || !isValidEmail(email)) return json({ error: "invalid_email" }, 400);
    if (!password || password.length < 6)
      return json({ error: "invalid_password", msg: "密码至少6位" }, 400);
    if (!nickname || nickname.length < 1)
      return json({ error: "invalid_nickname", msg: "昵称必填" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM user_accounts WHERE email = ?")
      .bind(email)
      .first();
    if (existing) return json({ error: "email_exists" }, 409);
    if (!code) return json({ error: "invalid_code", msg: "请输入邮箱验证码" }, 400);
    // 先建号后消费验证码（消费本身是条件一次性语句）：用户表写入失败不再吞掉验证码；
    // 消费失败则补偿删除刚建的账号，验证码保留可重试（findings DATA-05）。
    const hash = await hashPasswordStrong(password);
    const result = await env.DB.prepare(
      "INSERT INTO user_accounts (email, password_hash, nickname) VALUES (?, ?, ?)",
    )
      .bind(email, hash, nickname)
      .run();
    const userId = result.meta.last_row_id as number;
    const consumed = await consumeVerificationCode(env.DB, email, "register", code);
    if (!consumed.ok) {
      await env.DB.prepare("DELETE FROM user_accounts WHERE id = ?")
        .bind(userId)
        .run()
        .catch(() => undefined);
      return json({ error: consumed.error, msg: consumed.msg }, 400);
    }
    const session = await createSession(env.DB, userId);
    return json({ ...session, email, nickname });
  }

  // POST /api/account/login
  if (path === "/api/account/login" && request.method === "POST") {
    const body = await readJsonObject(request);
    const email = cleanString(body?.email, 160)?.toLowerCase() ?? null;
    const password = cleanString(body?.password, 128);
    if (!email || !password) return json({ error: "missing_fields" }, 400);
    const user = await env.DB.prepare(
      "SELECT id, password_hash, nickname, disabled_at FROM user_accounts WHERE email = ?",
    )
      .bind(email)
      .first<{
        id: number;
        password_hash: string;
        nickname: string | null;
        disabled_at: string | null;
      }>();
    if (user?.disabled_at) return json({ error: "account_disabled" }, 403);
    if (!user || !(await verifyPassword(password, user.password_hash)))
      return json({ error: "invalid_credentials" }, 401);
    if (needsPasswordUpgrade(user.password_hash)) {
      await env.DB.prepare("UPDATE user_accounts SET password_hash = ? WHERE id = ?")
        .bind(await hashPasswordStrong(password), user.id)
        .run()
        .catch(() => undefined);
    }
    const session = await createSession(env.DB, user.id);
    return json({ ...session, email, nickname: user.nickname ?? email.split("@")[0] });
  }

  // POST /api/account/send-code —— 注册/修改密码共用的邮箱验证码下发（luckycola customMail 通道）
  if (path === "/api/account/send-code" && request.method === "POST") {
    const body = await readJsonObject(request);
    const email = cleanString(body?.email, 160)?.toLowerCase() ?? null;
    const purpose = cleanString(body?.purpose, 16);
    if (!email || !isValidEmail(email)) return json({ error: "invalid_email" }, 400);
    if (purpose !== "register" && purpose !== "reset")
      return json({ error: "invalid_purpose" }, 400);
    const existing = await env.DB.prepare("SELECT id FROM user_accounts WHERE email = ?")
      .bind(email)
      .first();
    if (purpose === "register" && existing)
      return json({ error: "email_exists", msg: "该邮箱已注册" }, 409);
    if (purpose === "reset" && !existing)
      return json({ error: "email_notfound", msg: "该邮箱未注册" }, 404);
    const issued = await issueVerificationCode(env.DB, env, email, purpose);
    if ("error" in issued) {
      const status = issued.error === "code_cooldown" ? 429 : 502;
      return json({ error: issued.error, msg: issued.msg, detail: issued.detail }, status);
    }
    return json({ ok: true, ...(issued.dev_code ? { dev_code: issued.dev_code } : {}) });
  }

  // POST /api/account/change-password —— 修改密码（邮箱验证码核验身份，免旧密码；改密吊销全部旧会话）
  if (path === "/api/account/change-password" && request.method === "POST") {
    const body = await readJsonObject(request);
    const email = cleanString(body?.email, 160)?.toLowerCase() ?? null;
    const code = cleanString(body?.code, 12);
    const password = cleanString(body?.password, 128);
    if (!email || !isValidEmail(email)) return json({ error: "invalid_email" }, 400);
    if (!password || password.length < 6)
      return json({ error: "invalid_password", msg: "密码至少6位" }, 400);
    if (!code) return json({ error: "invalid_code", msg: "请输入邮箱验证码" }, 400);
    const user = await env.DB.prepare(
      "SELECT id, password_hash, disabled_at FROM user_accounts WHERE email = ?",
    )
      .bind(email)
      .first<{ id: number; password_hash: string; disabled_at: string | null }>();
    if (!user) return json({ error: "email_notfound" }, 404);
    if (user.disabled_at) return json({ error: "account_disabled" }, 403);
    // 与注册同序：先改密后消费，消费失败补偿回滚旧口令，验证码可重试（findings DATA-05）。
    const previousHash = user.password_hash;
    await env.DB.prepare("UPDATE user_accounts SET password_hash = ? WHERE id = ?")
      .bind(await hashPasswordStrong(password), user.id)
      .run();
    const consumed = await consumeVerificationCode(env.DB, email, "reset", code);
    if (!consumed.ok) {
      await env.DB.prepare("UPDATE user_accounts SET password_hash = ? WHERE id = ?")
        .bind(previousHash, user.id)
        .run()
        .catch(() => undefined);
      return json({ error: consumed.error, msg: consumed.msg }, 400);
    }
    await env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
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

  // POST /api/account/oauth/exchange — trade a one-time code (from the OAuth redirect) for the session token
  if (path === "/api/account/oauth/exchange" && request.method === "POST") {
    if (!env.DB) return json({ error: "database_unavailable" }, 503);
    const body = await readJsonObject(request);
    const exchangeCode = cleanString(body?.code, 80);
    if (!exchangeCode) return json({ error: "invalid_code" }, 400);
    // 一次性消费：条件 DELETE 报告 changes===1 的调用方独占 token，
    // 并发重放同一个 code 只有一个能拿到会话（findings DATA-05）。
    const consumed = await consumeOAuthExchange(env.DB, exchangeCode);
    if (!consumed.ok) return json({ error: "invalid_code" }, 404);
    return json({
      token: consumed.token,
      email: consumed.email,
      nickname: consumed.nickname ?? undefined,
    });
  }

  // GET /api/account/oauth/callback — OAuth callback (must be before provider route)
  if (path === "/api/account/oauth/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = request.headers.get("cookie")?.match(/(?:^|;\s*)oauth_state=([^;]*)/)?.[1];

    // The state must match the HttpOnly cookie set when the flow started (CSRF protection).
    if (!code || !state || !cookieState || cookieState !== state) {
      return redirect(`/?account=error&msg=${encodeURIComponent("Invalid OAuth state")}`);
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
          accept: "application/json",
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
      const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
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
      const providerNickname = (providerKey === "google" ? raw.name : raw.login) as
        string | undefined;
      const emailLocal = parsed.email?.split("@")[0] || `user-${parsed.id}`;
      const nickname =
        providerNickname && providerNickname.length > 0 ? providerNickname : emailLocal;

      // Find or create user（仅已验证邮箱才允许并号）
      const userId = await findOrCreateOAuthUser(
        env.DB,
        providerKey,
        parsed.id,
        parsed.email,
        parsed.emailVerified,
        nickname,
      );
      const session = await createSession(env.DB, userId);

      // Hand the session to the frontend via a one-time exchange code so the token never lands in the URL.
      const exchangeCode = generateToken();
      await env.DB.prepare(
        "INSERT INTO oauth_exchanges (code, token, email, nickname, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          exchangeCode,
          session.token,
          parsed.email ?? `oauth.${providerKey}.${parsed.id}@users.invalid`,
          nickname,
          new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        )
        .run();
      // 成功后清掉 oauth_state cookie（Path 与下发时一致），避免残留可重放的 state。
      return new Response(null, {
        status: 302,
        headers: {
          location: `/?oauth_code=${exchangeCode}`,
          "set-cookie":
            "oauth_state=; Path=/api/account; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        },
      });
    } catch (error) {
      console.error(`OAuth ${providerKey} failed:`, error);
      return redirect(
        `/?account=error&msg=${encodeURIComponent(error instanceof Error ? error.message : "OAuth failed")}`,
      );
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
    response.headers.set(
      "set-cookie",
      `oauth_state=${providerKey}:${state}; Path=/api/account; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    );
    return response;
  }

  // GET /api/account/profile
  if (path === "/api/account/profile" && request.method === "GET") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const account = await env.DB.prepare("SELECT nickname FROM user_accounts WHERE id = ?")
      .bind(user.id)
      .first<{ nickname: string | null }>();
    const row = await env.DB.prepare(
      "SELECT profile, notes, updated_at FROM user_profiles_v2 WHERE user_id = ? LIMIT 1",
    )
      .bind(user.id)
      .first<{ profile: string; notes: string | null; updated_at: string }>();
    let notes: Record<string, string> = {};
    if (row?.notes) {
      try {
        notes = JSON.parse(row.notes);
      } catch {
        /* ignore */
      }
    }
    let profileData: unknown = null;
    if (row?.profile) {
      // 读取端自愈：旧行可能残留 posterUrls，过一遍白名单即干净；形状不认识时原样透传。
      try {
        profileData = healStoredProfile(JSON.parse(row.profile));
      } catch {
        profileData = null;
      }
    }
    return json({
      email: user.email,
      nickname: account?.nickname ?? user.email.split("@")[0],
      profile: profileData,
      notes,
      updatedAt: row?.updated_at ?? null,
    });
  }

  // PUT /api/account/profile
  if (path === "/api/account/profile" && request.method === "PUT") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const raw = await request.text();
    if (encoder.encode(raw).byteLength > MAX_PAYLOAD_BYTES)
      return json({ error: "payload_too_large" }, 413);
    let profile: unknown;
    let notesProvided = false;
    let notes: unknown = null;
    try {
      const body = JSON.parse(raw);
      profile = body.profile;
      // 「未提供」与「显式空」是两种语义（findings DATA-03）：
      //   缺失        → 保留云端旧批注（旧客户端/不改批注的路径）
      //   存在（含 {}）→ 整体替换，{} 即清空
      notesProvided = Object.hasOwn(body, "notes");
      notes = notesProvided ? body.notes : null;
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    if (!profile || typeof profile !== "object" || Array.isArray(profile))
      return json({ error: "invalid_profile" }, 400);
    // 唯一编码出口：白名单投影会顺带剔除 posterUrls 与任何未知字段
    // （见 shared/storedItem.ts）。不要再在这里写 delete item.posterUrls——
    // 漏掉一处没有任何信号，这正是补丁反复出现的原因。
    const encoded = encodeStoredProfile(profile);
    if (!encoded.ok) {
      return encoded.error === "payload_too_large"
        ? json({ error: "profile_too_large", msg: "画像数据过大，请减少作品数量。" }, 413)
        : json({ error: "invalid_profile" }, 400);
    }
    let notesJson: string | null = null;
    if (notesProvided) {
      if (notes === null || typeof notes !== "object" || Array.isArray(notes))
        return json({ error: "invalid_notes" }, 400);
      // 批注走唯一白名单编码出口（与 share/plaza 同口径），禁止任意 JSON 整包入库。
      // 空对象在这里编码为 null（列写入 NULL = 清空），与「字段缺失=保留」区分开。
      const notesEncoded = encodeStoredNotes(notes);
      if (!notesEncoded.ok) return json({ error: "notes_too_large" }, 413);
      notesJson = notesEncoded.json;
    }
    const sql = notesProvided
      ? "INSERT INTO user_profiles_v2 (user_id, profile, notes) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile, notes = excluded.notes, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
      : "INSERT INTO user_profiles_v2 (user_id, profile, notes) VALUES (?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    await env.DB.prepare(sql)
      .bind(...(notesProvided ? [user.id, encoded.json, notesJson] : [user.id, encoded.json]))
      .run();
    return json({ stored: true });
  }

  // PUT /api/account/nickname
  if (path === "/api/account/nickname" && request.method === "PUT") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const body = await readJsonObject(request);
    const nickname = cleanString(body?.nickname, 40);
    if (!nickname || nickname.length < 1)
      return json({ error: "invalid_nickname", msg: "昵称必填" }, 400);
    await env.DB.prepare("UPDATE user_accounts SET nickname = ? WHERE id = ?")
      .bind(nickname, user.id)
      .run();
    return json({ ok: true, nickname });
  }

  // Personal collections are private to the authenticated account.
  if (path === "/api/account/collections" && request.method === "GET") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    const rows = await env.DB.prepare(
      "SELECT id, kind, title, description, item_count, items, created_at, updated_at FROM user_collections WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100",
    )
      .bind(user.id)
      .all();
    return json({
      collections: (rows.results ?? []).map((row) => ({
        ...row,
        items: JSON.parse(String((row as Record<string, unknown>).items ?? "[]")),
      })),
    });
  }

  if (path === "/api/account/collections" && request.method === "POST") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    // 收藏清单可达 512KB（与 encodeStoredWorks 上限一致），不能沿用小 body 的 48KB。
    const body = await readJsonObject(request, MAX_PAYLOAD_BYTES);
    const collection = validateCollectionBody(body);
    if (!collection) return json({ error: "invalid_collection" }, 400);
    // 唯一编码出口：收藏清单是「无 rank 的作品数组」，白名单同样只留可落库字段。
    const encoded = encodeStoredWorks(collection.items);
    if (!encoded.ok) {
      return encoded.error === "payload_too_large"
        ? json({ error: "payload_too_large" }, 413)
        : json({ error: "invalid_collection" }, 400);
    }
    const result = await env.DB.prepare(
      "INSERT INTO user_collections (user_id, kind, title, description, items, item_count) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        user.id,
        collection.kind,
        collection.title,
        collection.description,
        encoded.json,
        encoded.count,
      )
      .run();
    return json({ id: result.meta.last_row_id, stored: true }, 201);
  }

  const collectionMatch = path.match(/^\/api\/account\/collections\/(\d+)$/);
  if (collectionMatch && request.method === "DELETE") {
    const user = await getUserFromToken(request, env.DB);
    if (!user) return json({ error: "authentication_required" }, 401);
    await env.DB.prepare("DELETE FROM user_collections WHERE id = ? AND user_id = ?")
      .bind(Number(collectionMatch[1]), user.id)
      .run();
    return json({ ok: true });
  }

  // GET /api/admin/accounts/:id/detail — 用户完整数据（画像/批注/清单/会话/OAuth），供后台画像查看
  const detailMatch = path.match(/^\/api\/admin\/accounts\/(\d+)\/detail$/);
  if (detailMatch && request.method === "GET") {
    if (!env.DB || !(await adminAuthLocal(request, env.DB)))
      return json({ error: "auth_required" }, 401);
    const userId = Number(detailMatch[1]);
    const account = await env.DB.prepare(
      "SELECT id, email, nickname, disabled_at, created_at FROM user_accounts WHERE id = ?",
    )
      .bind(userId)
      .first<{
        id: number;
        email: string;
        nickname: string | null;
        disabled_at: string | null;
        created_at: string;
      }>();
    if (!account) return json({ error: "account_not_found" }, 404);
    const [sessions, oauth, profileRow, collections, plazaCount] = await Promise.all([
      env.DB.prepare(
        "SELECT COUNT(*) AS c FROM user_sessions WHERE user_id = ? AND expires_at > datetime('now')",
      )
        .bind(userId)
        .first<{ c: number }>(),
      env.DB.prepare("SELECT provider FROM user_oauth WHERE user_id = ?").bind(userId).all(),
      env.DB.prepare("SELECT profile, notes, updated_at FROM user_profiles_v2 WHERE user_id = ?")
        .bind(userId)
        .first<{ profile: string; notes: string | null; updated_at: string }>(),
      env.DB.prepare(
        "SELECT id, kind, title, description, item_count, created_at, updated_at FROM user_collections WHERE user_id = ? ORDER BY updated_at DESC",
      )
        .bind(userId)
        .all(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM plaza_posts WHERE user_id = ?")
        .bind(userId)
        .first<{ c: number }>(),
    ]);
    let profile: unknown = null;
    if (profileRow?.profile) {
      try {
        profile = JSON.parse(profileRow.profile);
      } catch {
        profile = null;
      }
    }
    let notes: Record<string, string> = {};
    if (profileRow?.notes) {
      try {
        notes = JSON.parse(profileRow.notes) ?? {};
      } catch {
        notes = {};
      }
    }
    return json({
      account,
      active_sessions: sessions?.c ?? 0,
      oauth_providers: (oauth.results ?? []).map((r) => (r as { provider: string }).provider),
      profile,
      profile_updated_at: profileRow?.updated_at ?? null,
      notes,
      collections: collections.results ?? [],
      plaza_post_count: plazaCount?.c ?? 0,
    });
  }

  // GET /api/admin/accounts — list all accounts (admin only)
  if (path === "/api/admin/accounts" && request.method === "GET") {
    if (!env.DB || !(await adminAuthLocal(request, env.DB)))
      return json({ error: "auth_required" }, 401);
    const accounts = await env.DB.prepare(
      "SELECT id, email, nickname, disabled_at, created_at FROM user_accounts ORDER BY created_at DESC LIMIT 100",
    ).all();
    return json({ accounts: accounts.results ?? [] });
  }

  // DELETE /api/admin/accounts/:id — delete account (admin only)
  const deleteMatch = path.match(/^\/api\/admin\/accounts\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    if (!env.DB || !(await adminAuthLocal(request, env.DB)))
      return json({ error: "auth_required" }, 401);
    const userId = Number(deleteMatch[1]);
    await env.DB.batch([
      // 广场内容引用 user_accounts(id)：须先清该用户的帖子/历史/评论/点赞，再删账户
      env.DB.prepare(
        "DELETE FROM plaza_post_edits WHERE post_id IN (SELECT id FROM plaza_posts WHERE user_id = ?)",
      ).bind(userId),
      env.DB.prepare(
        "DELETE FROM plaza_likes WHERE user_id = ? OR post_id IN (SELECT id FROM plaza_posts WHERE user_id = ?)",
      ).bind(userId, userId),
      env.DB.prepare(
        "DELETE FROM plaza_comments WHERE user_id = ? OR post_id IN (SELECT id FROM plaza_posts WHERE user_id = ?)",
      ).bind(userId, userId),
      env.DB.prepare("DELETE FROM plaza_posts WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM user_cookie_vault WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM user_oauth WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM user_profiles_v2 WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM user_collections WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM user_accounts WHERE id = ?").bind(userId),
    ]);
    await recordAudit(env, "account:delete", `删除账户 #${userId}`, request);
    return json({ ok: true });
  }

  const disableMatch = path.match(/^\/api\/admin\/accounts\/(\d+)\/(disable|restore)$/);
  if (disableMatch && request.method === "POST") {
    if (!env.DB || !(await adminAuthLocal(request, env.DB)))
      return json({ error: "auth_required" }, 401);
    const userId = Number(disableMatch[1]);
    if (disableMatch[2] === "disable") {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE user_accounts SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        ).bind(userId),
        env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId),
      ]);
    } else {
      await env.DB.prepare("UPDATE user_accounts SET disabled_at = NULL WHERE id = ?")
        .bind(userId)
        .run();
    }
    await recordAudit(
      env,
      `account:${disableMatch[2]}`,
      `${disableMatch[2] === "disable" ? "禁用" : "恢复"}账户 #${userId}`,
      request,
    );
    return json({ ok: true, disabled: disableMatch[2] === "disable" });
  }

  const profileDeleteMatch = path.match(/^\/api\/admin\/accounts\/(\d+)\/(profile|collections)$/);
  if (profileDeleteMatch && request.method === "DELETE") {
    if (!env.DB || !(await adminAuthLocal(request, env.DB)))
      return json({ error: "auth_required" }, 401);
    const userId = Number(profileDeleteMatch[1]);
    const table = profileDeleteMatch[2] === "profile" ? "user_profiles_v2" : "user_collections";
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId).run();
    await recordAudit(
      env,
      `account:delete_${profileDeleteMatch[2]}`,
      `删除账户 #${userId} 的${profileDeleteMatch[2] === "profile" ? "画像" : "云端清单"}`,
      request,
    );
    return json({ ok: true });
  }

  // POST /api/admin/accounts/:id/reset-password — reset password (admin only)
  const resetMatch = path.match(/^\/api\/admin\/accounts\/(\d+)\/reset-password$/);
  if (resetMatch && request.method === "POST") {
    if (!env.DB || !(await adminAuthLocal(request, env.DB)))
      return json({ error: "auth_required" }, 401);
    const userId = Number(resetMatch[1]);
    const body = await readJsonObject(request);
    const newPassword = cleanString(body?.password, 128);
    if (!newPassword || newPassword.length < 6)
      return json({ error: "invalid_password", msg: "密码至少6位" }, 400);
    const hash = await hashPasswordStrong(newPassword);
    await env.DB.batch([
      env.DB.prepare("UPDATE user_accounts SET password_hash = ? WHERE id = ?").bind(hash, userId),
      env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(userId),
    ]);
    await recordAudit(
      env,
      "account:reset_password",
      `重置账户 #${userId} 的密码并强制下线`,
      request,
    );
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}
