const BUILD_ID = /*__BUILD_ID__*/ "dev";
const CACHE_NAME = "art-rank-v4";
// 每次构建的缓存桶带 BUILD_ID：产物换代后激活阶段整桶丢弃，
// 不会再出现「旧 chunk 与新 index.html 混用」的半新半旧状态。
const RUNTIME_CACHE = `${CACHE_NAME}-${BUILD_ID}`;
const STATIC_ASSETS = ["/", "/index.html"];
// 构建时由 scripts/pwa-precache.mjs 注入带 hash 的产物清单（含懒加载路由 chunk）。
// 不预缓存这些，离线打开未访问过的路由会因动态 import 失败而落到 ErrorBoundary。
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/ [];

// 这些 URL 不带内容 hash，或由 Worker 动态生成并标记 no-store。
// cache-first 会把它们钉在 RUNTIME_CACHE 里：BUILD_ID 只在前端构建时变，
// 只改 Worker 脚本时桶名不变，后台就会一直跑旧版 /admin/app.js。
// 统一走 network-first，离线时仍回退已缓存的那一份。
const NETWORK_FIRST_PATHS = ["/admin/app.js", "/vendor/chart.umd.js", "/manifest.json", "/sw.js"];

/** 只缓存「不可变且服务端允许」的成功响应。 */
function cacheableResponse(response) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  const directive = response.headers.get("cache-control") ?? "";
  return !/(?:no-store|no-cache|private)/i.test(directive);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      // 单条失败不拖垮整个安装；带 hash 产物走默认缓存模式复用刚下载的 HTTP 缓存，避免双倍流量。
      await Promise.allSettled([
        ...STATIC_ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))),
        ...PRECACHE_ASSETS.map((url) => cache.add(url)),
      ]);
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("art-rank-") && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only handle GET requests for same-origin resources
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;
  // Skip API calls
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/")) return;
  // 页面导航请求 network-first：部署新版本后立即生效，离线时回退到缓存的 index.html
  // 只有 SPA 壳本身的响应才写进 "/index.html" 缓存键：/admin（服务端看板）、/share/* 等
  // 非壳页若也写进同一键，网络失败回退时会互相顶替（离线开看板得到 App、离线开 App 得到看板）。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            (pathname === "/" || pathname === "/index.html") &&
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const clone = response.clone();
            event.waitUntil(
              caches
                .open(RUNTIME_CACHE)
                .then((cache) => cache.put("/index.html", clone))
                .catch(() => {}),
            );
          }
          return response;
        })
        .catch(async () =>
          pathname.startsWith("/admin")
            ? Response.error()
            : ((await caches.match("/index.html")) ?? Response.error()),
        ),
    );
    return;
  }
  if (NETWORK_FIRST_PATHS.includes(pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (cacheableResponse(response)) {
            const clone = response.clone();
            event.waitUntil(
              caches
                .open(RUNTIME_CACHE)
                .then((cache) => cache.put(request, clone))
                .catch(() => {}),
            );
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? Response.error()),
    );
    return;
  }
  // 静态资源 cache-first（构建产物文件名带 hash，内容不可变）
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!cacheableResponse(response)) return response;
          const clone = response.clone();
          event.waitUntil(
            caches
              .open(RUNTIME_CACHE)
              .then((cache) => cache.put(request, clone))
              .catch(() => {}),
          );
          return response;
        })
        .catch(() => new Response("", { status: 503 }));
    }),
  );
});
