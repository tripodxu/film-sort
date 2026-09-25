const CACHE_NAME = "art-rank-v3";
const STATIC_ASSETS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
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
            caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", clone));
          }
          return response;
        })
        .catch(() => caches.match("/index.html")),
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
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => new Response("", { status: 503 }));
    }),
  );
});
