import { useEffect, useState } from "react";
import { BookOpen, Film, Library, Music2 } from "lucide-react";
import type { Artwork, MediaKind } from "../data/media";

// ===== 并发闸门 =====
// 单次 flush 只发一个请求，但多份榜单可能同时触发；把在途请求限制在 8 个以内。
const MAX_CONCURRENT_REQUESTS = 8;
let activeRequests = 0;
const waitQueue: Array<() => void> = [];
function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) { activeRequests += 1; return Promise.resolve(); }
  return new Promise<void>((resolve) => { waitQueue.push(resolve); });
}
function releaseSlot(): void {
  const next = waitQueue.shift();
  // 有等待者就把名额直接移交，避免 activeRequests 抖动。
  if (next) next();
  else activeRequests -= 1;
}

// ===== 批量取海报 =====
// resolve() 只负责入队；短暂聚合后一次 POST /api/posters/batch。
// 整份 150 首的榜单因此只需 1 次往返（逐条请求时是 6n 次）。
const FLUSH_DELAY_MS = 50;
const MAX_BATCH_SIZE = 300; // 与服务端 MAX_POSTER_BATCH_ITEMS 对齐
const BATCH_TIMEOUT_MS = 30000;

const TYPE_BY_KIND: Record<string, string> = { film: "movie", book: "book", music: "music", other: "movie" };

interface BatchEntry {
  work: Artwork;
  kind: MediaKind;
  resolveBatch: (urls: string[]) => void;
}

let batchTimer: ReturnType<typeof setTimeout> | null = null;
const batchQueue: BatchEntry[] = [];

function normalizeKey(value: string): string { return value.normalize("NFKC").trim().toLowerCase(); }

/** 服务端缓存键的本地等价物，仅在服务端未回显 keys 时作为兜底。 */
function batchKey(work: Artwork, kind: MediaKind): string {
  return [TYPE_BY_KIND[kind] ?? "movie", normalizeKey(work.title), normalizeKey(work.subtitle ?? work.title), work.year ?? ""].join("|");
}

function flushBatch(): void {
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  if (!batchQueue.length) return;
  const batch = batchQueue.splice(0, MAX_BATCH_SIZE);
  // 超出单批上限的剩余项安排到下一轮，而不是丢给同一次请求。
  if (batchQueue.length) batchTimer = setTimeout(flushBatch, 0);
  void dispatchBatch(batch);
}

async function dispatchBatch(batch: BatchEntry[]): Promise<void> {
  const items = batch.map((entry) => ({
    title: entry.work.title,
    english: entry.work.subtitle ?? entry.work.title,
    year: entry.work.year,
    type: TYPE_BY_KIND[entry.kind] ?? "movie",
  }));

  let results: Record<string, string[]> = {};
  let keys: string[] | null = null;
  try {
    await acquireSlot();
    try {
      const response = await fetch("/api/posters/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
      });
      if (response.ok) {
        const data = await response.json() as { results?: Record<string, string[]>; keys?: string[] };
        results = data.results ?? {};
        // 服务端回显与入参等长的 keys，按位置对齐可完全规避两端键推导不一致。
        keys = Array.isArray(data.keys) && data.keys.length === batch.length ? data.keys : null;
      }
    } finally { releaseSlot(); }
  } catch {
    results = {};
    keys = null;
  }

  batch.forEach((entry, index) => {
    const key = keys?.[index] ?? batchKey(entry.work, entry.kind);
    entry.resolveBatch(results[key] ?? []);
  });
}

const requests = new Map<string, Promise<string[]>>();
// 已解析结果的内存副本：让首帧同步拿到海报，不必等 Promise 的微任务。
const resolvedPosters = new Map<string, string[]>();

const reportedFailures = new Set<string>();
const POSTER_CACHE_KEY = "art-rank:poster-cache";
function readPosterCache(key: string): string[] | null {
  try { const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}"); return cache[key] ?? null; } catch { return null; }
}
const POSTER_CACHE_MAX = 500;
function writePosterCache(key: string, urls: string[]) {
  try {
    const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}");
    const keys = Object.keys(cache);
    if (keys.length >= POSTER_CACHE_MAX) {
      // Evict oldest half
      for (let i = 0; i < Math.floor(keys.length / 2); i++) delete cache[keys[i]];
    }
    cache[key] = urls;
    sessionStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(cache));
  } catch { /* Quota exceeded — silently skip */ }
}
function posterKey(work: Artwork, kind: MediaKind): string {
  return `${kind}|${work.title}|${work.subtitle ?? ""}|${work.year ?? ""}`;
}

function resolveSync(work: Artwork, kind: MediaKind): string[] | null {
  const key = posterKey(work, kind);
  return resolvedPosters.get(key) ?? readPosterCache(key);
}

function resolve(work: Artwork, kind: MediaKind): Promise<string[]> {
  const key = posterKey(work, kind);
  const existing = requests.get(key);
  if (existing) return existing;
  const cached = readPosterCache(key);
  if (cached) {
    const done = Promise.resolve(cached);
    requests.set(key, done);
    resolvedPosters.set(key, cached);
    return done;
  }
  const request = new Promise<string[]>((resolveBatch) => {
    batchQueue.push({ work, kind, resolveBatch });
    if (batchTimer === null) batchTimer = setTimeout(flushBatch, FLUSH_DELAY_MS);
  }).then((urls) => {
    resolvedPosters.set(key, urls);
    if (urls.length) writePosterCache(key, urls);
    return urls;
  });
  requests.set(key, request);
  return request;
}
export function prefetchPosters(items: Array<{ work: Artwork; kind: MediaKind }>): void {
  for (const { work, kind } of items) { if (kind === "film" || kind === "book" || kind === "music") void resolve(work, kind); }
}

// 豆瓣 CDN 对「无 Referer」的请求一律返回 418（响应体是 `cdn error 001`），
// 而浏览器 <img> 无法伪造 Referer（本组件还显式设了 referrerPolicy="no-referrer"），
// 所以豆瓣系图片必须走 worker 代理——worker/media.ts 的 buildHeaders() 会补上
// `referer: https://movie.douban.com/`。其余 CDN 实测直连可用（Amazon 直连与代理
// 返回字节数完全一致），保留直连以省掉一次跳转。
const PROXY_REQUIRED_HOSTS = /^img\d+\.doubanio\.com$/;
function proxiedImageUrl(url: string): string {
  return `/api/image?url=${encodeURIComponent(url)}`;
}
function imageUrl(url: string): string {
  try { return PROXY_REQUIRED_HOSTS.test(new URL(url).hostname) ? proxiedImageUrl(url) : url; }
  catch { return url; }
}

function reportImageFailure(work: Artwork, kind: MediaKind, url: string) {
  const key = `${kind}|${work.title}|${url}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  void fetch("/api/poster-errors/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: work.title, type: kind, error: "image_load_failed" }),
    keepalive: true,
  }).catch(() => undefined);
}

export function Poster({ work, kind: rawKind, large = false }: { work: Artwork; kind: MediaKind; large?: boolean }) {
  // 未知/空媒介（如画像帖整体卡）一律按 other 兜底：图标查表不会得到 undefined
  const kind = rawKind === "film" || rawKind === "book" || rawKind === "music" ? rawKind : "other";
  const [resolved, setResolved] = useState<string[]>(() => {
    if (kind !== "film" && kind !== "book" && kind !== "music") return [];
    return resolveSync(work, kind) ?? [...(work.posterUrls ?? [])];
  });
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // 直连失败后改为走代理重试同一张图，再失败才换下一个候选。
  const [proxyRetry, setProxyRetry] = useState<Set<string>>(() => new Set());
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    if (kind === "film" || kind === "book" || kind === "music") {
      void resolve(work, kind).then((urls) => { if (active && urls.length) setResolved(urls); });
    }
    return () => { active = false; };
  }, [work.id, work.title, kind, large]);
  const urls = [...new Set([...resolved, ...(work.posterUrls ?? [])])];
  const url = urls.find((candidate) => !failed.has(candidate));
  const src = url === undefined ? undefined : proxyRetry.has(url) ? proxiedImageUrl(url) : imageUrl(url);
  const Icon = { film: Film, book: BookOpen, music: Music2, other: Library }[kind];
  return <div className={`poster ${large ? "poster-large" : "poster-small"} poster-${kind}`}>
    {url && src ? <><img src={src} alt={`${work.title}${work.creator ? ` - ${work.creator}` : ""}${work.year ? ` (${work.year})` : ""}`} referrerPolicy="no-referrer" loading={large ? "eager" : "lazy"} onLoad={() => setImgLoaded(true)} onError={() => {
      reportImageFailure(work, kind, url);
      // 直连失败：先用 worker 代理重试同一张图；代理也失败才换下一个候选。
      if (imageUrl(url) === url && !proxyRetry.has(url)) {
        setProxyRetry((previous) => new Set([...previous, url]));
        return;
      }
      setFailed((previous) => new Set([...previous, url]));
    }} style={imgLoaded ? undefined : { opacity: 0 }} />{!imgLoaded && <div className="poster-loading"><Icon size={large ? 24 : 12} /></div>}</> :
      <div className="cover-fallback"><Icon size={large ? 36 : 16} />{large ? <span>{work.title}</span> : <span style={{ fontSize: 9, opacity: 0.7, lineHeight: 1.3, textAlign: "center", padding: "0 2px" }}>{work.title}</span>}</div>}
  </div>;
}
