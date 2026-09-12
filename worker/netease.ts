import type { Env } from "./index";

// ===== 网易云音乐 weapi 协议（公开的社区已知算法）与扫码登录 =====
// 仅使用用户本人扫码授权产生的 Cookie，AES-GCM 加密存储于 user_cookie_vault，绝不存明文。

const WEAPI_PRESET_KEY = "0CoJUm6Qyw8W8jud";
const WEAPI_IV = "0102030405060708";
// 网易 weapi RSA「noop」公钥（社区公开常量，用于加密随机 secretKey）
const WEAPI_RSA_E = "010001";
const WEAPI_RSA_N = "e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";

const BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const encoder = new TextEncoder();

function randomSecretKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => BASE62[b % 62]).join("");
}

async function aesCbcEncrypt(text: string, key: string, iv: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "AES-CBC" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-CBC", iv: encoder.encode(iv) }, cryptoKey, encoder.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

/** 原生 RSA（无填充）：NetEase weapi 的 secretKey 采用手动补位 + BigInt 模幂 */
function rsaNoop(text: string): string {
  const reversed = [...text].reverse().join("");
  const hex = Array.from(encoder.encode(reversed), (b) => b.toString(16).padStart(2, "0")).join("").padStart(256, "0");
  const modulus = BigInt("0x" + WEAPI_RSA_N);
  const message = BigInt("0x" + hex);
  const exponent = BigInt("0x" + WEAPI_RSA_E);
  let result = 1n;
  let base = message % modulus;
  let exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % modulus;
    base = (base * base) % modulus;
    exp >>= 1n;
  }
  return result.toString(16).padStart(256, "0");
}

export async function weapiPayload(text: string): Promise<{ params: string; encSecKey: string }> {
  const secretKey = randomSecretKey();
  const inner = await aesCbcEncrypt(text, WEAPI_PRESET_KEY, WEAPI_IV);
  const params = await aesCbcEncrypt(inner, secretKey, WEAPI_IV);
  const encSecKey = rsaNoop(secretKey);
  return { params, encSecKey };
}

export async function weapiPost(path: string, data: Record<string, unknown>, cookie?: string | null): Promise<{ json: Record<string, unknown>; cookies: string[] }> {
  const { params, encSecKey } = await weapiPayload(JSON.stringify(data));
  const response = await fetch(`https://music.163.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "referer": "https://music.163.com/",
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams({ params, encSecKey }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { throw new Error("netease_bad_json"); }
  const cookies = typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (response.headers as { getSetCookie: () => string[] }).getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  return { json, cookies: cookies.filter(Boolean) };
}

/** 从 803 响应的 JSON cookie 字段与全部 Set-Cookie 头里提取登录凭证；网易通常只经 Set-Cookie 下发。 */
export function extractNeteaseLoginCookie(sources: Array<string | null | undefined>): string | null {
  const musicU = sources.map((s) => s?.match(/MUSIC_U=([^;,\s]+)/)?.[1]).find(Boolean);
  if (!musicU) return null;
  const csrf = sources.map((s) => s?.match(/__csrf=([^;,\s]+)/)?.[1]).find(Boolean);
  return csrf ? `MUSIC_U=${musicU}; __csrf=${csrf}` : `MUSIC_U=${musicU}`;
}

// ===== Cookie 保险库（AES-GCM 加密，密钥存 admin_config，首次自动生成） =====

async function vaultKey(env: Env): Promise<CryptoKey | null> {
  if (!env.DB) return null;
  const db = env.DB;
  const stored = await db.prepare("SELECT value FROM admin_config WHERE key = 'cookie_enc_key'").first<{ value: string }>();
  let rawKey: Uint8Array;
  if (stored?.value) {
    rawKey = Uint8Array.from({ length: stored.value.length / 2 }, (_, i) => Number.parseInt(stored.value.slice(i * 2, i * 2 + 2), 16));
  } else {
    rawKey = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(rawKey, (b) => b.toString(16).padStart(2, "0")).join("");
    await db.prepare("INSERT OR IGNORE INTO admin_config (key, value) VALUES ('cookie_enc_key', ?)").bind(hex).run();
  }
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function saveProviderCookie(env: Env, userId: number, provider: string, cookie: string): Promise<void> {
  const key = await vaultKey(env);
  if (!key || !env.DB) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(cookie));
  const hex = Array.from(new Uint8Array(encrypted), (b) => b.toString(16).padStart(2, "0")).join("") + "|" + Array.from(iv, (b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    "INSERT INTO user_cookie_vault (user_id, provider, data_encrypted, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(user_id, provider) DO UPDATE SET data_encrypted = excluded.data_encrypted, updated_at = excluded.updated_at"
  ).bind(userId, provider, hex).run();
}

export async function loadProviderCookie(env: Env, userId: number, provider: string): Promise<string | null> {
  const key = await vaultKey(env);
  if (!key || !env.DB) return null;
  const row = await env.DB.prepare("SELECT data_encrypted FROM user_cookie_vault WHERE user_id = ? AND provider = ?").bind(userId, provider).first<{ data_encrypted: string }>();
  if (!row) return null;
  const [hex, ivHex] = row.data_encrypted.split("|");
  if (!hex || !ivHex) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from({ length: ivHex.length / 2 }, (_, i) => Number.parseInt(ivHex.slice(i * 2, i * 2 + 2), 16)) },
      key,
      Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)),
    );
    return new TextDecoder().decode(decrypted);
  } catch { return null; }
}

export async function deleteProviderCookie(env: Env, userId: number, provider: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM user_cookie_vault WHERE user_id = ? AND provider = ?").bind(userId, provider).run();
}

export async function hasProviderCookie(env: Env, userId: number, provider: string): Promise<boolean> {
  if (!env.DB) return false;
  const row = await env.DB.prepare("SELECT user_id FROM user_cookie_vault WHERE user_id = ? AND provider = ?").bind(userId, provider).first();
  return !!row;
}

// ===== 扫码登录三接口与「我的歌单」 =====

export async function neteaseQrIssue(): Promise<{ unikey: string }> {
  const { json } = await weapiPost("/weapi/login/qrcode/unikey", { type: 1 });
  const unikey = typeof json.unikey === "string" ? json.unikey : null;
  if (!unikey) throw new Error("qr_issue_failed");
  return { unikey };
}

export async function neteaseQrPoll(unikey: string, env: Env, userId: number): Promise<{ state: "waiting" | "scanned" | "confirmed" | "expired"; error?: string }> {
  const { json, cookies } = await weapiPost("/weapi/login/qrcode/client/login", { key: unikey });
  const code = Number(json.code);
  if (code === 803) {
    const cookie = extractNeteaseLoginCookie([typeof json.cookie === "string" ? json.cookie : null, ...cookies]);
    if (!cookie) {
      console.error("netease qr confirmed but no MUSIC_U in response (json.cookie absent, set-cookie had none)");
      return { state: "expired", error: "登录已确认但未能获取凭证，请重新扫码" };
    }
    await saveProviderCookie(env, userId, "netease", cookie);
    return { state: "confirmed" };
  }
  if (code === 802) return { state: "scanned" };
  if (code === 800) return { state: "expired" };
  return { state: "waiting" };
}

export interface NeteasePlaylistInfo { id: number; name: string; track_count: number; cover?: string; special?: boolean }

export async function neteaseUserId(cookie: string): Promise<number | null> {
  try {
    const { json } = await weapiPost("/weapi/nuser/account/get", {}, cookie);
    const data = json as { profile?: { userId?: number }; account?: { id?: number } };
    return data.profile?.userId ?? data.account?.id ?? null;
  } catch (error) {
    console.error("netease user id failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function neteaseUserPlaylists(cookie: string, uid: number): Promise<NeteasePlaylistInfo[]> {
  const { json } = await weapiPost("/weapi/user/playlist", { offset: 0, limit: 100, total: true, uid }, cookie);
  const list = (json.playlist ?? []) as Array<{ id?: number; name?: string; trackCount?: number; coverImgUrl?: string; specialType?: number }>;
  return list.filter((p) => p.id && p.name).map((p) => ({
    id: p.id as number,
    name: p.name as string,
    track_count: p.trackCount ?? 0,
    cover: p.coverImgUrl,
    // specialType 5 = 我喜欢的音乐
    special: p.specialType === 5,
  }));
}
