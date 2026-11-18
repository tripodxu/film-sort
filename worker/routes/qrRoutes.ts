import { getUserFromToken } from "../account";
import { recordAudit } from "../audit";
import {
  doubanAccountInfo,
  doubanQrIssue,
  doubanQrPoll,
  doubanUserId,
  extractDoubanLoginCookie,
} from "../douban";
import { allowUpstreamRequest, json, type Env } from "../http";
import {
  deleteProviderCookie,
  hasProviderCookie,
  loadProviderCookie,
  neteaseAccountInfo,
  neteaseQrIssue,
  neteaseQrPoll,
  neteaseUserId,
  neteaseUserPlaylists,
  saveProviderCookie,
} from "../netease";
import { consumeQrTransaction, getQrTransaction, registerQrTransaction } from "../qrTransactions";

export async function handleQrRoutes(
  url: URL,
  request: Request,
  env: Env,
): Promise<Response | null> {
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
  return null;
}
