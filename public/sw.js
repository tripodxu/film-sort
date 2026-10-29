const BUILD_ID = /*__BUILD_ID__*/ "dev";
const CACHE_NAME = "art-rank-v4";
// 每次构建的缓存桶带 BUILD_ID：产物换代后激活阶段整桶丢弃，
// 不会再出现「旧 chunk 与新 index.html 混用」的半新半旧状态。
const RUNTIME_CACHE = `${CACHE_NAME}-${BUILD_ID}`;
const STATIC_ASSETS = ["/", "/index.html"];
// 构建时由 scripts/pwa-precache.mjs 注入带 hash 的产物清单（含懒加载路由 chunk）。
// 不预缓存这些，离线打开未访问过的路由会因动态 import 失败而落到 ErrorBoundary。
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/ [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      // 单条失败不拖垮整个安装：预缓存是增强，缺一张图不该让 SW 装不上。
      await Promise.allSettled(
        [...STATIC_ASSETS, ...PRECACHE_ASSETS].map((url) =>
          cache.add(new Request(url, { cache: "reload" })),
        ),
      );
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
  if (request.url.includes("/api/")) return;
  // 页面导航请求 network-first：部署新版本后立即生效，离线时回退到缓存的 index.html
  // 只有 SPA 壳本身的响应才写进 "/index.html" 缓存键：/admin（服务端看板）、/share/* 等
  // 非壳页若也写进同一键，网络失败回退时会互相顶替（离线开看板得到 App、离线开 App 得到看板）。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const pathname = new URL(request.url).pathname;
          if (
            (pathname === "/" || pathname === "/index.html") &&
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put("/index.html", clone));
          }
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) ?? Response.error()),
    );
    return;
  }
  // 静态资源 cache-first（构建产物文件名带 hash，内容不可变）
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") return response;
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => new Response("", { status: 503 }));
    }),
  );
});
