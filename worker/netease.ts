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
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "referer": "https://music.163.com/",
      "origin": "https://music.163.com",
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

/** 扫码会话 Cookie 罐：unikey → (cookieName → value)。模拟浏览器/urllib 的 Set-Cookie 自动携带。 */
const qrCookieJar = new Map<string, Map<string, string>>();
const JAR_TTL_MS = 5 * 60_000;
const jarTimestamps = new Map<string, number>();

function jarAbsorb(unikey: string, setCookies: string[]) {
  let jar = qrCookieJar.get(unikey);
  if (!jar) { jar = new Map(); qrCookieJar.set(unikey, jar); }
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  jarTimestamps.set(unikey, Date.now());
  // 简单上限：超过 500 个会话时清最旧的
  if (qrCookieJar.size > 500) {
    const oldest = [...jarTimestamps.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
    for (const [k] of oldest) { qrCookieJar.delete(k); jarTimestamps.delete(k); }
  }
}

function jarHeader(unikey: string): string | null {
  const jar = qrCookieJar.get(unikey);
  if (!jar) return null;
  const real = [...jar.entries()].filter(([k]) => k !== "__ch");
  if (!real.length) return null;
  const touched = jarTimestamps.get(unikey) ?? 0;
  if (Date.now() - touched > JAR_TTL_MS) { qrCookieJar.delete(unikey); jarTimestamps.delete(unikey); return null; }
  return real.map(([k, v]) => `${k}=${v}`).join("; ");
}

/** 签发通道记账：unikey → "open" | "weapi"（复用 jar 的 __ch 伪条目，同受 TTL/清理约束） */
function markChannel(unikey: string, channel: "open" | "weapi") {
  let jar = qrCookieJar.get(unikey);
  if (!jar) { jar = new Map(); qrCookieJar.set(unikey, jar); }
  jar.set("__ch", channel);
  jarTimestamps.set(unikey, Date.now());
}
function channelOf(unikey: string): "open" | "weapi" | null {
  return (qrCookieJar.get(unikey)?.get("__ch") as "open" | "weapi" | undefined) ?? null;
}

/** 签发二维码：开放接口优先（官网同族、免 cookie），weapi 加密接口兜底。ttl 供前端倒计时。 */
export async function neteaseQrIssue(): Promise<{ unikey: string; qrValue: string; ttl: number }> {
  try {
    const response = await fetch("https://music.163.com/api/login/qrcode/unikey", {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "referer": "https://music.163.com/",
        "origin": "https://music.163.com",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "type=1",
      signal: AbortSignal.timeout(15000),
    });
    const json = await response.json() as { code?: number; unikey?: string };
    if (json.code === 200 && typeof json.unikey === "string" && json.unikey) {
      markChannel(json.unikey, "open");
      return { unikey: json.unikey, qrValue: `https://music.163.com/login?codekey=${json.unikey}`, ttl: 150 };
    }
  } catch (error) {
    console.error("netease qr open-channel issue failed, falling back to weapi:", error instanceof Error ? error.message : error);
  }
  // 兜底通道：weapi 加密接口（对齐参考项目，含 Cookie 罐）
  const { json, cookies } = await weapiPost("/weapi/login/qrcode/unikey", { type: 1 });
  const unikey = typeof json.unikey === "string" ? json.unikey : null;
  if (!unikey) throw new Error("qr_issue_failed");
  jarAbsorb(unikey, cookies);
  markChannel(unikey, "weapi");
  const qrValue = typeof json.qrurl === "string" && json.qrurl.startsWith("https://music.163.com/") ? json.qrurl : `https://music.163.com/login?codekey=${unikey}`;
  return { unikey, qrValue, ttl: 180 };
}

interface QrPollResult { code: number; cookie?: string | null; nickname?: string; avatarUrl?: string; message?: string }

/** 开放通道轮询：GET 无加密；null = 请求失败（走 weapi 兜底） */
async function openChannelPoll(unikey: string): Promise<QrPollResult | null> {
  try {
    const response = await fetch(`https://music.163.com/api/login/qrcode/client/login?key=${encodeURIComponent(unikey)}&type=1`, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "referer": "https://music.163.com/",
      },
      signal: AbortSignal.timeout(15000),
    });
    const json = await response.json() as Record<string, unknown>;
    const code = Number(json.code);
    if (!Number.isFinite(code)) return null;
    const cookies = typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (response.headers as { getSetCookie: () => string[] }).getSetCookie() : [];
    return {
      code,
      cookie: extractNeteaseLoginCookie(cookies),
      nickname: typeof json.nickname === "string" ? json.nickname : undefined,
      avatarUrl: typeof json.avatarUrl === "string" ? json.avatarUrl : undefined,
      message: typeof json.message === "string" ? json.message : undefined,
    };
  } catch { return null; }
}

/** 扫码状态轮询 + 通道选路。返回 risk 表示风控异常码，由前端做连续容忍。 */
export async function neteaseQrPoll(unikey: string, env: Env, userId: number): Promise<{ state: "waiting" | "scanned" | "confirmed" | "expired" | "risk"; error?: string; nickname?: string; avatarUrl?: string }> {
  const clearJar = () => { qrCookieJar.delete(unikey); jarTimestamps.delete(unikey); };
  const issuedBy = channelOf(unikey);

  // 主通道：开放接口（weapi 签发的 key 跳过，避免跨通道误读）
  if (issuedBy !== "weapi") {
    const open = await openChannelPoll(unikey);
    if (open) {
      if (open.code === 803) {
        if (!open.cookie) { clearJar(); return { state: "expired", error: "登录已确认但未能获取凭证，请重新扫码" }; }
        await saveProviderCookie(env, userId, "netease", open.cookie);
        clearJar();
        return { state: "confirmed", nickname: open.nickname, avatarUrl: open.avatarUrl };
      }
      if (open.code === 802) return { state: "scanned", nickname: open.nickname, avatarUrl: open.avatarUrl };
      if (open.code === 801) return { state: "waiting", nickname: open.nickname };
      if (open.code === 800 && issuedBy === "open") { clearJar(); return { state: "expired" }; }
      // 未知通道签发但 open 报 800/风控：交给 weapi 复核
    }
  }

  // 兜底通道：weapi 轮询（带 Cookie 罐）
  const { json, cookies } = await weapiPost("/weapi/login/qrcode/client/login", { key: unikey, type: 1 }, jarHeader(unikey));
  jarAbsorb(unikey, cookies);
  const code = Number(json.code);
  const nickname = typeof json.nickname === "string" ? json.nickname : undefined;
  const avatarUrl = typeof json.avatarUrl === "string" ? json.avatarUrl : undefined;
  if (code === 803) {
    const cookie = extractNeteaseLoginCookie([typeof json.cookie === "string" ? json.cookie : null, ...cookies]);
    if (!cookie) { clearJar(); return { state: "expired", error: "登录已确认但未能获取凭证，请重新扫码" }; }
    await saveProviderCookie(env, userId, "netease", cookie);
    clearJar();
    return { state: "confirmed", nickname, avatarUrl };
  }
  if (code === 802) return { state: "scanned", nickname, avatarUrl };
  if (code === 800) { clearJar(); return { state: "expired" }; }
  // 风控类异常码（8821/-462 等）：独立 risk 状态交由前端连续容忍，jar 保留以便瞬时误判后恢复
  if (code !== 801) {
    const msg = typeof json.message === "string" ? json.message : "";
    return { state: "risk", error: `网易云暂时拒绝了本次校验（${code}${msg ? `：${msg}` : ""}）。多为本网络环境风控或扫码次数过多` };
  }
  return { state: "waiting" };
}

/** 已连接账号信息（昵称/头像）：10 分钟内存缓存，失败静默返回 null */
const accountInfoCache = new Map<number, { nickname: string | null; avatarUrl: string | null; ts: number }>();
export async function neteaseAccountInfo(env: Env, userId: number): Promise<{ nickname: string | null; avatarUrl: string | null } | null> {
  const hit = accountInfoCache.get(userId);
  if (hit && Date.now() - hit.ts < 10 * 60_000) return hit;
  const cookie = await loadProviderCookie(env, userId, "netease");
  if (!cookie) return null;
  try {
    const { json } = await weapiPost("/weapi/nuser/account/get", {}, cookie);
    const profile = json.profile as { nickname?: string; avatarUrl?: string } | undefined;
    const account = json.account as { id?: number } | undefined;
    if (!profile && !account) return null;
    const info = { nickname: profile?.nickname ?? null, avatarUrl: profile?.avatarUrl ?? null, ts: Date.now() };
    accountInfoCache.set(userId, info);
    return info;
  } catch { return null; }
}

export interface NeteasePlaylistInfo { id: number; name: string; track_count: number; cover?: string; special?: boolean; subscribed?: boolean }

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

/**
 * 获取用户全部歌单（含收藏的），开放接口 GET api/user/playlist?uid=&limit=1000。
 * subscribed=true 表示「我收藏的」（他人歌单）；specialType=5 为「我喜欢的音乐」。
 */
export async function neteaseUserPlaylists(cookie: string, uid: number): Promise<NeteasePlaylistInfo[]> {
  const response = await fetch(`https://music.163.com/api/user/playlist?uid=${encodeURIComponent(uid)}&limit=1000`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "referer": "https://music.163.com/",
      cookie,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("netease_playlist_failed");
  const data = await response.json() as { playlist?: Array<{ id?: number; name?: string; trackCount?: number; coverImgUrl?: string; specialType?: number; subscribed?: boolean }> };
  return (data.playlist ?? []).filter((p) => p.id && p.name).map((p) => ({
    id: p.id as number,
    name: p.name as string,
    track_count: p.trackCount ?? 0,
    cover: p.coverImgUrl,
    special: p.specialType === 5,
    subscribed: p.subscribed === true,
  }));
}
