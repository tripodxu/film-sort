/**
 * gdstudio 音乐 API 代理 — Deno Deploy
 * 解决的唯一问题是 Cloudflare Worker 出口被 gdstudio 返回 520。
 *
 * 生产环境可设置 MUSIC_PROXY_KEY；设置后只接受 Worker 使用
 * x-proxy-key 请求头发起的调用，避免公网直接消耗上游额度。
 */

const TARGET = "https://music-api.gdstudio.xyz/api.php";
const ALLOWED_TYPES = new Set(["search", "url", "lyric", "pic"]);
const PROXY_KEY = Deno.env.get("MUSIC_PROXY_KEY");

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({ ok: true, ts: new Date().toISOString() });
  }

  if (req.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  if (PROXY_KEY && req.headers.get("x-proxy-key") !== PROXY_KEY) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const type = url.searchParams.get("types") ?? "";
  if (!ALLOWED_TYPES.has(type)) {
    return Response.json({ error: "invalid_type" }, { status: 400 });
  }

  const target = new URL(TARGET);
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    return Response.json({ error: "upstream_unavailable", detail: String(e) }, { status: 502 });
  }
});
