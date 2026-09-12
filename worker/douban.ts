import type { Env } from "./index";
import { saveProviderCookie, loadProviderCookie } from "./netease";

// ===== 豆瓣扫码登录（协议参考 github.com/ZegWe/douban-cli 实测验证）=====
// accounts.douban.com/j/mobile/login/qrlogin_code   GET → payload{code, img, login_url}
// accounts.douban.com/j/mobile/login/qrlogin_status GET → payload{login_status: pending|scan|login|expired}
// 登录凭证为 dbcl2 Cookie（扫码确认时经 Set-Cookie 下发），AES-GCM 加密存入 user_cookie_vault(provider=douban)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const QR_CODE_URL = "https://accounts.douban.com/j/mobile/login/qrlogin_code";
const QR_STATUS_URL = "https://accounts.douban.com/j/mobile/login/qrlogin_status";
const LOGIN_REFERER = "https://accounts.douban.com/passport/login";

function browserHeaders(cookie?: string | null): Record<string, string> {
  return {
    "user-agent": UA,
    "accept": "application/json, text/javascript, */*; q=0.01",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "referer": LOGIN_REFERER,
    "x-requested-with": "XMLHttpRequest",
    ...(cookie ? { cookie } : {}),
  };
}

// ===== 会话 Cookie 罐（模拟浏览器自动携带；code 为键） =====
const qrJar = new Map<string, Map<string, string>>();
const jarTouched = new Map<string, number>();
const JAR_TTL_MS = 5 * 60_000;

function jarAbsorb(code: string, setCookies: string[]) {
  let jar = qrJar.get(code);
  if (!jar) { jar = new Map(); qrJar.set(code, jar); }
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  jarTouched.set(code, Date.now());
  if (qrJar.size > 500) {
    const oldest = [...jarTouched.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
    for (const [k] of oldest) { qrJar.delete(k); jarTouched.delete(k); }
  }
}

function jarHeader(code: string): string | null {
  const jar = qrJar.get(code);
  if (!jar || !jar.size) return null;
  const touched = jarTouched.get(code) ?? 0;
  if (Date.now() - touched > JAR_TTL_MS) { qrJar.delete(code); jarTouched.delete(code); return null; }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function jarDrop(code: string) { qrJar.delete(code); jarTouched.delete(code); }

function setCookieList(response: Response): string[] {
  return typeof (response.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (response.headers as { getSetCookie: () => string[] }).getSetCookie() : [];
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export interface DoubanQrIssue { code: string; qrImage: string; ttl: number }

/** 签发豆瓣登录二维码：服务端代理下载二维码图片，转 data URL 返回（前端免跨域） */
export async function doubanQrIssue(): Promise<DoubanQrIssue> {
  const response = await fetch(QR_CODE_URL, { headers: browserHeaders(), signal: AbortSignal.timeout(15000) });
  const data = await response.json() as { status?: string; payload?: { code?: string; img?: string } };
  const code = data.payload?.code;
  const imgRaw = data.payload?.img;
  if (data.status !== "success" || !code || !imgRaw) throw new Error("douban_qr_issue_failed");
  jarAbsorb(code, setCookieList(response));
  const imageUrl = imgRaw.split("\\/").join("/");
  const image = await fetch(imageUrl, { headers: { ...browserHeaders(jarHeader(code)), "accept": "image/png,image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(15000) });
  const imageBuffer = await image.arrayBuffer();
  if (!image.ok || !imageBuffer.byteLength) throw new Error("douban_qr_image_failed");
  const mime = image.headers.get("content-type") ?? "image/png";
  return { code, qrImage: `data:${mime};base64,${toBase64(imageBuffer)}`, ttl: 120 };
}

export interface DoubanQrPollResult { state: "waiting" | "scanned" | "confirmed" | "expired" | "risk"; error?: string }

/** 轮询扫码状态；login 时从 Cookie 罐提取 dbcl2 入库 */
export async function doubanQrPoll(code: string, env: Env, userId: number): Promise<DoubanQrPollResult> {
  const url = `${QR_STATUS_URL}?code=${encodeURIComponent(code)}`;
  const response = await fetch(url, { headers: browserHeaders(jarHeader(code)), signal: AbortSignal.timeout(15000) });
  if (!response.ok) return { state: "waiting" };
  jarAbsorb(code, setCookieList(response));
  let data: { status?: string; payload?: { login_status?: string } };
  try { data = await response.json() as typeof data; } catch { return { state: "waiting" }; }
  const loginStatus = data.payload?.login_status ?? "";
  if (loginStatus === "login") {
    const jar = qrJar.get(code);
    const dbcl2 = jar?.get("dbcl2");
    if (!dbcl2) { jarDrop(code); return { state: "expired", error: "登录已确认但未能获取凭证（dbcl2），请重新扫码" }; }
    const ck = jar?.get("ck");
    const normalized = ck ? `dbcl2=${dbcl2}; ck=${ck}` : `dbcl2=${dbcl2}`;
    await saveProviderCookie(env, userId, "douban", normalized);
    jarDrop(code);
    return { state: "confirmed" };
  }
  if (loginStatus === "scan") return { state: "scanned" };
  if (loginStatus === "pending") return { state: "waiting" };
  if (loginStatus === "expired") { jarDrop(code); return { state: "expired" }; }
  jarDrop(code);
  return { state: "risk", error: `豆瓣返回了未知状态（${loginStatus || data.status || "empty"}），请重新扫码` };
}

/** 从用户粘贴的浏览器 Cookie 里提取豆瓣登录凭证 */
export function extractDoubanLoginCookie(raw: string): string | null {
  const dbcl2 = raw.match(/dbcl2=([^;,\s]+)/)?.[1];
  if (!dbcl2) return null;
  const ck = raw.match(/ck=([^;,\s]+)/)?.[1];
  return ck ? `dbcl2=${dbcl2}; ck=${ck}` : `dbcl2=${dbcl2}`;
}

/** 用 Cookie 访问 /mine/：302 到 /people/<uid>/ 即有效，返回 uid */
export async function doubanUserId(cookie: string): Promise<string | null> {
  try {
    const response = await fetch("https://www.douban.com/mine/", {
      headers: { "user-agent": UA, "referer": "https://www.douban.com/", cookie },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const match = new URL(response.url).pathname.match(/\/people\/([^/]+)\/?/);
    return match ? match[1] : null;
  } catch { return null; }
}

/** 已连接豆瓣账号信息（昵称）：10 分钟内存缓存 */
const infoCache = new Map<number, { nickname: string | null; avatarUrl: string | null; ts: number }>();
export async function doubanAccountInfo(env: Env, userId: number): Promise<{ nickname: string | null; avatarUrl: string | null } | null> {
  const hit = infoCache.get(userId);
  if (hit && Date.now() - hit.ts < 10 * 60_000) return hit;
  const cookie = await loadProviderCookie(env, userId, "douban");
  if (!cookie) return null;
  try {
    const response = await fetch("https://www.douban.com/mine/", {
      headers: { "user-agent": UA, "accept": "text/html", "referer": "https://www.douban.com/", cookie },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    const nickname = title.split(/[的\-–|]/)[0].trim() || null;
    const avatar = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ?? null;
    if (!nickname) return null;
    const info = { nickname, avatarUrl: avatar, ts: Date.now() };
    infoCache.set(userId, info);
    return info;
  } catch { return null; }
}
