import { useEffect, useState } from "react";
import { BookOpen, Film, Library, Music2, RotateCcw } from "lucide-react";
import type { Artwork, MediaKind } from "../data/media";
import { mediaTypeForKind, posterMediaKey } from "../../shared/posterKey";
import { emptyPosterState, type PosterOutcome } from "../lib/posterOutcome";

// ===== 并发闸门 =====
// 单次 flush 只发一个请求，但多份榜单可能同时触发；把在途请求限制在 8 个以内。
const MAX_CONCURRENT_REQUESTS = 8;
let activeRequests = 0;
const waitQueue: Array<() => void> = [];
function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
}
function releaseSlot(): void {
  const next = waitQueue.shift();
  // 有等待者就把名额直接移交，避免 activeRequests 抖动。
  if (next) next();
  else activeRequests -= 1;
}

// ===== 批量取海报 =====
// resolve() 只负责入队；短暂聚合后一次 POST /api/posters/batch。
// 上限刻意压到 30（而不是服务端允许的 300）：豆瓣侧是限流上游，一次请求里
// 塞太多首会把它打成 418，反而整批拿不到海报；配合榜单的分页懒加载，
// 正常情况一页就是一次请求。
const FLUSH_DELAY_MS = 50;
const MAX_BATCH_SIZE = 30;
const BATCH_TIMEOUT_MS = 60000;

// 「其他」维度走服务端 wiki 取图管线（posterStore/media 的 type=other 分支）；
// kind→type 与兜底键都从 shared/posterKey.ts 取唯一实现（服务端同一份），
// 维基图域已在 allowedImage/CSP 放行。
const TYPE_BY_KIND = (kind: MediaKind): string => mediaTypeForKind(kind) ?? "movie";

interface BatchEntry {
  work: Artwork;
  kind: MediaKind;
  resolveBatch: (urls: string[], outcome: PosterOutcome | undefined) => void;
  /** 本键的服务端分类（found / absent / throttled）。空格子靠它分三态。 */
  outcome?: PosterOutcome;
}

let batchTimer: ReturnType<typeof setTimeout> | null = null;
const batchQueue: BatchEntry[] = [];
/** 本次页面加载是否已经发过第一批请求（决定是否带 retry）。 */
let firstBatchDispatched = false;
/** 用户点了「重试」：这一批必须带 retry=true，无论它是不是本次加载的第一批。 */
let retryForced = false;

/**
 * 服务端缓存键的本地等价物，仅在服务端未回显 keys 时作为兜底。
 * 直接复用 shared/posterKey.ts 的唯一实现（含 `other` 维度的代数后缀），
 * 不再手抄一份——两端漂移的后果是「存了但取不到」，且没有任何报错信号。
 */
function batchKey(work: Artwork, kind: MediaKind): string {
  return posterMediaKey(work.title, work.subtitle ?? work.title, TYPE_BY_KIND(kind), work.year);
}

function flushBatch(): void {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
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
    type: TYPE_BY_KIND(entry.kind),
  }));

  // 每次页面加载的**首次**批量带 retry：服务端据此绕过「被上游限流」的负缓存
  // （正缓存与「确实没有海报」的负缓存仍然生效）。这样「刷新 = 真重试」是确定的，
  // 不必碰运气等满 15 秒的短冷却窗口。
  // 用户在界面上点了「重试」时同样必须带 retry——否则按钮只是「再问一次」，
  // 而服务端会用 15 秒负缓存原样回上一轮的 throttled，点多少次都是一样的空。
  const retry = retryForced || !firstBatchDispatched;
  firstBatchDispatched = true;
  retryForced = false;

  let results: Record<string, string[]> = {};
  let keys: string[] | null = null;
  let outcomes: Record<string, PosterOutcome> = {};
  try {
    await acquireSlot();
    try {
      const response = await fetch("/api/posters/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(retry ? { items, retry: true } : { items }),
        signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          results?: Record<string, string[]>;
          keys?: string[];
          outcomes?: Record<string, PosterOutcome>;
        };
        results = data.results ?? {};
        outcomes = data.outcomes ?? {};
        // 服务端回显与入参等长的 keys，按位置对齐可完全规避两端键推导不一致。
        keys = Array.isArray(data.keys) && data.keys.length === batch.length ? data.keys : null;
      }
    } finally {
      releaseSlot();
    }
  } catch {
    results = {};
    keys = null;
    outcomes = {};
  }

  batch.forEach((entry, index) => {
    const key = keys?.[index] ?? batchKey(entry.work, entry.kind);
    entry.resolveBatch(results[key] ?? [], outcomes[key]);
  });
}

const requests = new Map<string, Promise<string[]>>();
// 已解析结果的内存副本：让首帧同步拿到海报，不必等 Promise 的微任务。
const resolvedPosters = new Map<string, string[]>();
/** 空封面的三态（none / degraded / unknown）记忆表：空格子不算「已解析」，所以不在 resolvedPosters 里。 */
const emptyStates = new Map<string, PosterOutcome>();

const reportedFailures = new Set<string>();
const POSTER_CACHE_KEY = "art-rank:poster-cache";
function readPosterCache(key: string): string[] | null {
  try {
    const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}");
    return cache[key] ?? null;
  } catch {
    return null;
  }
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
  } catch {
    /* Quota exceeded — silently skip */
  }
}
function posterKey(work: Artwork, kind: MediaKind): string {
  return `${kind}|${work.title}|${work.subtitle ?? ""}|${work.year ?? ""}`;
}

function resolveSync(work: Artwork, kind: MediaKind): string[] | null {
  const key = posterKey(work, kind);
  return resolvedPosters.get(key) ?? readPosterCache(key);
}

function resolve(work: Artwork, kind: MediaKind, opts?: { retry?: boolean }): Promise<string[]> {
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
  // 服务端分类经这条旁路回传：Promise 的 resolve 只收一个值，而空格子需要
  // 「没拿到图」之外的第二个事实（这次到底是确实没有，还是暂时取不到）。
  let outcome: PosterOutcome | undefined;
  const request = new Promise<string[]>((resolveBatch) => {
    batchQueue.push({
      work,
      kind,
      resolveBatch: (urls, batchOutcome) => {
        outcome = batchOutcome;
        resolveBatch(urls);
      },
    });
    // 用户点了「重试」：空结果本来不进 resolvedPosters，所以这里一定走不到
    // 命中缓存的短路分支，标记会一路带到 dispatchBatch 的 retry 判定。
    if (opts?.retry === true) retryForced = true;
    if (batchTimer === null) batchTimer = setTimeout(flushBatch, FLUSH_DELAY_MS);
  }).then((urls) => {
    // 失败不再被页面会话记住：空结果不写内存副本、也不写 sessionStorage，
    // 下一次挂载（翻页/刷新）会重新请求。原先空数组同样写进 resolvedPosters，
    // 于是「这次没解析到」在整页生命周期内等于永久缺图。
    if (urls.length) {
      resolvedPosters.set(key, urls);
      emptyStates.delete(key);
      writePosterCache(key, urls);
    } else {
      requests.delete(key);
      // 分类同样不跨会话保留：15 秒后上游很可能已恢复，记住 throttled 只会
      // 让「刷新就好」失效。只在本页生命周期内给这一格标个状态。
      if (outcome) emptyStates.set(key, outcome);
    }
    return urls;
  });
  requests.set(key, request);
  return request;
}
export function prefetchPosters(items: Array<{ work: Artwork; kind: MediaKind }>): void {
  for (const { work, kind } of items) {
    if (kind === "film" || kind === "book" || kind === "music" || kind === "other")
      void resolve(work, kind);
  }
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
  try {
    return PROXY_REQUIRED_HOSTS.test(new URL(url).hostname) ? proxiedImageUrl(url) : url;
  } catch {
    return url;
  }
}

/**
 * 文案的语言跟随 <html lang>。
 * <Poster> 有 29 处调用点，没有一处传 t；为两句提示把 t 一路穿过 29 个调用点
 * 不划算（且每处都得改）。App.tsx 的 useEffect 已经把 locale 写进
 * document.documentElement.lang，这里读同一份真相，切换语言自动跟随。
 */
function readEnglish(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.lang === "en";
}
function readRetryText(): string {
  return readEnglish() ? "Retry" : "重试";
}
function readRetryLabel(): string {
  return readEnglish() ? "Retry loading this cover" : "重新加载这张封面";
}
/** 空格子里的那行说明：只说「暂时取不到」，不承诺时间，也不怪罪用户。 */
function readRetryHint(): string {
  return readEnglish()
    ? "The cover service is temporarily unavailable."
    : "封面服务暂时取不到，稍后可重试。";
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

export function Poster({
  work,
  kind: rawKind,
  large = false,
}: {
  work: Artwork;
  kind: MediaKind;
  large?: boolean;
}) {
  // 未知/空媒介（如画像帖整体卡）一律按 other 兜底：图标查表不会得到 undefined
  const kind =
    rawKind === "film" || rawKind === "book" || rawKind === "music" || rawKind === "other"
      ? rawKind
      : "other";
  const [resolved, setResolved] = useState<string[]>(() => {
    if (kind !== "film" && kind !== "book" && kind !== "music" && kind !== "other") return [];
    return resolveSync(work, kind) ?? [...(work.posterUrls ?? [])];
  });
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // 空封面的三态。服务端早就在算 found/absent/throttled，历史上没发出来，
  // 于是「确实没有」和「暂时取不到」都渲染成同一个静默图标（PLAN-EMPTY-COVER-STATE）。
  const [outcome, setOutcome] = useState<PosterOutcome | undefined>(() =>
    emptyStates.get(posterKey(work, kind)),
  );
  const [retrying, setRetrying] = useState(false);
  // 直连失败后改为走代理重试同一张图，再失败才换下一个候选。
  const [proxyRetry, setProxyRetry] = useState<Set<string>>(() => new Set());
  const [imgLoaded, setImgLoaded] = useState(false);
  // 服务端已持久化海报地址的条目不再发起解析请求——这正是「每次浏览都现解析」的根治。
  const hasStoredPosters = (work.posterUrls?.length ?? 0) > 0;
  useEffect(() => {
    let active = true;
    if (
      !hasStoredPosters &&
      (kind === "film" || kind === "book" || kind === "music" || kind === "other")
    ) {
      void resolve(work, kind).then((urls) => {
        if (active && urls.length) setResolved(urls);
        if (active) setOutcome(emptyStates.get(posterKey(work, kind)));
      });
    }
    return () => {
      active = false;
    };
  }, [work.id, work.title, kind, large, hasStoredPosters]);
  // 候选顺序 = 尝试顺序。**作品自带的封面排在前面**：导入网易云时拿到的是
  // `p*.music.126.net`（CSP 已放行、浏览器直连、不经 Worker、不占豆瓣抓取配额），
  // 比"解析出来的"豆瓣封面（必须走 /api/image 补 Referer，否则 418）更快也更稳；
  // 自带封面加载失败时，后面解析来的候选会依次顶上。
  const urls = [...new Set([...(work.posterUrls ?? []), ...resolved])];
  const url = urls.find((candidate) => !failed.has(candidate));
  const src =
    url === undefined ? undefined : proxyRetry.has(url) ? proxiedImageUrl(url) : imageUrl(url);
  const Icon = { film: Film, book: BookOpen, music: Music2, other: Library }[kind];
  // 判据必须喂**过滤掉加载失败之后**的候选：一张拿到过地址但加载失败的图，
  // 是「有图但没画出来」，不是「上游没有」。喂全量 urls 会把它误判成 absent，
  // 于是永远不提供重试 —— 而这一格恰恰最需要重试。
  const emptyState = emptyPosterState(
    urls.filter((candidate) => !failed.has(candidate)),
    outcome,
  );
  // 只在 degraded（上游暂时取不到）这一档给重试：absent 是 24 小时负缓存，
  // 再问一次也只是再被记一次「没有」；unknown 没资格断言任何事。
  const retryable = emptyState === "degraded";
  return (
    <div className={`poster ${large ? "poster-large" : "poster-small"} poster-${kind}`}>
      {url && src ? (
        <>
          <img
            src={src}
            alt={`${work.title}${work.creator ? ` - ${work.creator}` : ""}${work.year ? ` (${work.year})` : ""}`}
            referrerPolicy="no-referrer"
            loading={large ? "eager" : "lazy"}
            onLoad={() => setImgLoaded(true)}
            onError={() => {
              reportImageFailure(work, kind, url);
              // 直连失败：先用 worker 代理重试同一张图；代理也失败才换下一个候选。
              if (imageUrl(url) === url && !proxyRetry.has(url)) {
                setProxyRetry((previous) => new Set([...previous, url]));
                return;
              }
              setFailed((previous) => new Set([...previous, url]));
            }}
            style={imgLoaded ? undefined : { opacity: 0 }}
          />
          {!imgLoaded && (
            <div className="poster-loading">
              <Icon size={large ? 24 : 12} />
            </div>
          )}
        </>
      ) : (
        <div className={`cover-fallback${retryable ? " cover-fallback-retry" : ""}`}>
          <Icon size={large ? 36 : 16} />
          {large ? (
            <span>{work.title}</span>
          ) : (
            <span
              style={{
                fontSize: 9,
                opacity: 0.7,
                lineHeight: 1.3,
                textAlign: "center",
                padding: "0 2px",
              }}
            >
              {work.title}
            </span>
          )}
          {/* 只在 large（弹窗/对照大图）里给一行说明：26px 的小格塞不下文字，
              贴纸卡整卡是 <button> 也不能塞。role="status" 让「为什么是空的」对读屏
              也成立——只有按钮出现的视觉变化是不够的（PLAN-EMPTY-COVER-STATE §A8）。 */}
          {retryable && large && (
            <p className="cover-retry-hint" role="status">
              {readRetryHint()}
            </p>
          )}
          {retryable && (
            <button
              type="button"
              className="cover-retry"
              aria-label={readRetryLabel()}
              disabled={retrying}
              onClick={(event) => {
                // 兜底：某些父元素（如 .collection-row 的整卡 <button>）会把点击吃掉，
                // 这里显式截断冒泡，免得「重试」变成「打开详情」。
                event.stopPropagation();
                event.preventDefault();
                if (retrying) return;
                setRetrying(true);
                emptyStates.delete(posterKey(work, kind));
                setOutcome(undefined);
                setFailed(new Set());
                // retry: true 让服务端绕过 throttled 的 15 秒负缓存；与 dispatchBatch 首批
                // 同一条语义，不新增端点。
                void resolve(work, kind, { retry: true }).then((next) => {
                  setRetrying(false);
                  if (next.length) {
                    setResolved(next);
                    setOutcome(undefined);
                  } else {
                    setOutcome(emptyStates.get(posterKey(work, kind)) ?? "throttled");
                  }
                });
              }}
            >
              <RotateCcw size={13} aria-hidden />
              <span>{readRetryText()}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
