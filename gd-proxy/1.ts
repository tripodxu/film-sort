/**
 * gdstudio 音乐 API 代理 — Deno Deploy
 * 解决 CF Worker 出口被 gdstudio 封锁（HTTP 520）的问题。
 *
 * 部署：粘贴到 https://dash.deno.com/new 即可，零配置。
 */

const TARGET = "https://music-api.gdstudio.xyz/api.php";

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 健康检查
  if (url.pathname === "/health") {
    return Response.json({ ok: true, ts: new Date().toISOString() });
  }

  // 透传所有 query params 到 gdstudio
  const target = new URL(TARGET);
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (e) {
    return Response.json(
      { error: "upstream_unavailable", detail: String(e) },
      { status: 502, headers: { "access-control-allow-origin": "*" } },
    );
  }
});
