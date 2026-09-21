import curatedPosters from "./imdb-posters.json";
import { gdPicUrl, gdSearch, pickTracks, type GdProxyEnv } from "./gdstudio";

export interface DoubanWork {
  id: string;
  title: string;
  year?: number;
  poster_url?: string;
  type?: "movie" | "book" | "music";
}

// Rotate User-Agent to avoid rate limiting - simulate Edge browser
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
];
let uaIndex = 0;
function nextUA(): string {
  return USER_AGENTS[uaIndex++ % USER_AGENTS.length];
}

// Rate limiting: track cooldown per domain
const lastRequestTime = new Map<string, number>();
const MIN_DELAY_MS = 800;
const cooldownMap = new Map<string, number>();
// ===== 服务端海报缓存（两级）=====
// L1 是 isolate 内的 Map（快、有界），L2 是 Edge Cache（跨 isolate/机房共享，
// 且能在 isolate 回收后存活）。命中热门榜单时刷新页面仍能直接拿到结果，
// 不必再走 Douban/Wiki/网易云。
const POSTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 失败必须分两类，不能一刀切：
//   throttled —— 上游瞬时限流（豆瓣 418/403）：刷新就该重试，所以 TTL 极短；
//   absent    —— 上游干净地回答「没有这张图」：反复打上游没有意义，TTL 放长。
// 原先两者共用 10 分钟：瞬时失败要等满 10 分钟才可能恢复，而真正没有海报的条目
// 又每 10 分钟被重新问一遍上游——两头都错。
const POSTER_THROTTLED_TTL_MS = 15 * 1000;
const POSTER_MISS_TTL_MS = 24 * 60 * 60 * 1000;
const POSTER_CACHE_MAX_ENTRIES = 2000;
const POSTER_EDGE_ORIGIN = "https://poster-cache.art-rank.internal";

/** 一次解析的结果分类（决定负缓存 TTL，也用于把失败写进 poster_errors）。 */
export type PosterOutcome = "found" | "absent" | "throttled";

/**
 * 上游瞬时限流。必须与「上游回答没有」区分开——两者的负缓存 TTL 相差
 * 三个数量级（15 秒 vs 24 小时），混为一谈会让瞬时失败变成长时间缺图。
 */
export class ThrottledError extends Error {
  constructor(message = "upstream_throttled") {
    super(message);
    this.name = "ThrottledError";
  }
}

/** outcome → 缓存 TTL。抽成纯函数，便于单测把两条分支钉住。 */
export function posterCacheTtlMs(outcome: PosterOutcome): number {
  if (outcome === "found") return POSTER_CACHE_TTL_MS;
  if (outcome === "throttled") return POSTER_THROTTLED_TTL_MS;
  return POSTER_MISS_TTL_MS;
}

interface PosterCacheEntry {
  urls: string[];
  outcome: PosterOutcome;
}
const posterCache = new Map<string, PosterCacheEntry & { expiresAt: number }>();

/**
 * 海报条目的规范键：`type|title|english|year`（NFKC/去空白/小写）。
 * 单条 route、批量 route、以及读取时挂载 posterUrls 三处必须共用本函数——
 * 任何一处漂移都会变成「存了但取不到」。
 */
export function posterMediaKey(
  title: string,
  english: string,
  type?: string,
  year?: number,
): string {
  return (type ?? "movie") + "|" + key(title) + "|" + key(english) + "|" + (year ?? "");
}

/**
 * Edge Cache 的键：对 `type|title|english|year` 取稳定摘要。
 * WebCrypto 没有 MD5，用截断的 SHA-256（128 bit）等效替代，碰撞概率可忽略。
 */
async function posterDigest(cacheKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(cacheKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readIsolatePosterCache(cacheKey: string): PosterCacheEntry | null {
  const entry = posterCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    posterCache.delete(cacheKey);
    return null;
  }
  // 重新插入以刷新 LRU 顺序，让真正冷门的 key 先被淘汰。
  posterCache.delete(cacheKey);
  posterCache.set(cacheKey, entry);
  return { urls: entry.urls, outcome: entry.outcome };
}

function writeIsolatePosterCache(cacheKey: string, entry: PosterCacheEntry): void {
  posterCache.delete(cacheKey);
  posterCache.set(cacheKey, { ...entry, expiresAt: Date.now() + posterCacheTtlMs(entry.outcome) });
  while (posterCache.size > POSTER_CACHE_MAX_ENTRIES) {
    const oldest = posterCache.keys().next();
    if (oldest.done) break;
    posterCache.delete(oldest.value);
  }
}

/** Edge Cache 只在 Worker 运行时存在；测试/其他环境下降级为 null。 */
function edgeCacheOrNull(): Cache | null {
  try {
    return (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
}

async function readEdgePosterCache(cacheKey: string): Promise<PosterCacheEntry | null> {
  const cache = edgeCacheOrNull();
  if (!cache) return null;
  try {
    const hit = await cache.match(`${POSTER_EDGE_ORIGIN}/${await posterDigest(cacheKey)}`);
    if (!hit) return null;
    const raw: unknown = await hit.json();
    // 兼容上一版写入的「裸数组」格式：按长度推断 outcome，与旧语义完全一致，
    // 已存在的边缘缓存不会因为改格式而失效。
    if (Array.isArray(raw)) return parseEdgeEntry({ urls: raw });
    return parseEdgeEntry(raw);
  } catch {
    return null;
  }
}

function parseEdgeEntry(raw: unknown): PosterCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as { urls?: unknown; outcome?: unknown };
  if (!Array.isArray(entry.urls) || !entry.urls.every((url) => typeof url === "string"))
    return null;
  const urls = entry.urls as string[];
  const outcome: PosterOutcome =
    entry.outcome === "found" || entry.outcome === "throttled" || entry.outcome === "absent"
      ? entry.outcome
      : urls.length
        ? "found"
        : "absent";
  return { urls, outcome };
}

async function writeEdgePosterCache(cacheKey: string, entry: PosterCacheEntry): Promise<void> {
  const cache = edgeCacheOrNull();
  if (!cache) return;
  try {
    const maxAge = posterCacheTtlMs(entry.outcome) / 1000;
    await cache.put(
      `${POSTER_EDGE_ORIGIN}/${await posterDigest(cacheKey)}`,
      new Response(JSON.stringify(entry), {
        headers: { "content-type": "application/json", "cache-control": `max-age=${maxAge}` },
      }),
    );
  } catch {
    /* Edge Cache 是尽力而为，L1 仍然生效。 */
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// 每个域一条串行链。原先的写法是 TOCTOU 竞态：N 个并发调用者都读到同一个
// lastRequestTime，于是都只等同样一小会儿就同时发出去，节流实际上只对
// 「顺序调用」生效——这正是并发批量被上游 418 打回、而单条查询永远成功的原因。
const domainChains = new Map<string, Promise<void>>();

// subject_search 是轻量 JSON 接口（实测 8 并发全部 200），不必按抓 HTML 页面的
// 节奏（800ms）排队；其余豆瓣域维持原间隔以避开风控。
const DOMAIN_MIN_DELAY_MS: Record<string, number> = { "search.douban.com": 200 };

function throttle(domain: string): Promise<void> {
  const previous = domainChains.get(domain) ?? Promise.resolve();
  const next = previous.then(async () => {
    const cooldown = cooldownMap.get(domain) ?? 0;
    const now = Date.now();
    if (now < cooldown) await new Promise((r) => setTimeout(r, cooldown - now));
    const minDelay = DOMAIN_MIN_DELAY_MS[domain] ?? MIN_DELAY_MS;
    const elapsed = Date.now() - (lastRequestTime.get(domain) ?? 0);
    if (elapsed < minDelay) await new Promise((r) => setTimeout(r, minDelay - elapsed));
    lastRequestTime.set(domain, Date.now());
  });
  // 链节内部只 await sleep，不会 reject；仍兜一层，避免万一污染后续调用者。
  domainChains.set(
    domain,
    next.catch(() => undefined),
  );
  return next;
}

// Request headers per domain type
function buildHeaders(
  url: string,
  isImage: boolean,
  cookie?: string | null,
): Record<string, string> {
  const ua = nextUA();
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isBook = host.startsWith("book.douban") || url.includes("book.douban");
  const isMusic = host.startsWith("music.douban") || url.includes("music.douban");
  const referer = isBook
    ? "https://book.douban.com/"
    : isMusic
      ? "https://music.douban.com/"
      : "https://movie.douban.com/";
  return {
    "user-agent": ua,
    referer: referer,
    accept: isImage
      ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/svg+xml,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "accept-encoding": "gzip, deflate, br, zstd",
    connection: "keep-alive",
    "cache-control": "max-age=0",
    "sec-ch-ua": `"Chromium";v="126", "Microsoft Edge";v="126", "Not-A.Brand";v="8"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    "sec-fetch-dest": isImage ? "image" : "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    cookie: cookie && cookie.trim() ? cookie : `bid=${Math.random().toString(36).slice(2, 13)}`,
  };
}

export async function upstream(
  url: string,
  retries = 2,
  cookie?: string | null,
): Promise<Response> {
  const domain = getDomain(url);
  const isDouban = domain.endsWith("douban.com") || domain.endsWith("doubanio.com");
  const isImage = /\.(jpg|jpeg|png|webp|avif)$/i.test(new URL(url).pathname);
  const requestHeaders = isDouban
    ? buildHeaders(url, isImage, cookie)
    : { "user-agent": nextUA(), accept: "*/*" };

  for (let attempt = 0; attempt <= retries; attempt++) {
    // 图片是 CDN 资源：真实浏览器本就并发拉取几十张，实测 12 张并发 169ms 全部 200。
    // 节流只为避免抓取 HTML/API 时被豆瓣限流，用在图片上只会把画廊拖成每张 800ms。
    if (isDouban && !isImage) await throttle(domain);
    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (response.status === 403 || response.status === 418) {
        // Rate limited - activate per-domain cooldown
        cooldownMap.set(domain, Date.now() + (attempt + 1) * 5000);
        console.warn(`Rate limited (${response.status}) on ${domain}`);
        if (attempt < retries) continue;
        throw new Error(`Rate limited after ${retries + 1} attempts`);
      }
      if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
      return response;
    } catch (error) {
      if (attempt === retries) throw error;
      // Exponential backoff
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

const posterIndex = new Map<string, string>();
const bookPosterIndex = new Map<string, string>();
const musicPosterIndex = new Map<string, string>();
let indexPromise: Promise<void> | undefined;
let bookIndexPromise: Promise<void> | undefined;
let musicIndexPromise: Promise<void> | undefined;
let indexExpires = 0;
let bookIndexExpires = 0;
let musicIndexExpires = 0;
const key = (value: string) => value.normalize("NFKC").trim().toLowerCase();

async function bookTopPage(start: number): Promise<DoubanWork[]> {
  try {
    const response = await upstream(`https://book.douban.com/top250?start=${start}`);
    const works: DoubanWork[] = [];
    let current: { id: string; title: string; metadata: string; poster_url?: string };
    let titleSeen = false;
    const rewritten = new HTMLRewriter()
      .on("tr.item", {
        element() {
          current = { id: "", title: "", metadata: "" };
          titleSeen = false;
        },
      })
      .on("tr.item td:first-child a", {
        element(element) {
          current.id = element.getAttribute("href")?.match(/subject\/(\d+)/)?.[1] ?? "";
        },
      })
      .on("tr.item td:first-child img", {
        element(element) {
          current.poster_url = element.getAttribute("src") ?? undefined;
        },
      })
      .on("tr.item div.pl2 a", {
        element() {
          if (current.title) titleSeen = true;
        },
        text(chunk) {
          if (!titleSeen) current.title += chunk.text;
        },
      })
      .on("tr.item p.pl", {
        text(chunk) {
          current.metadata += chunk.text;
        },
      })
      .on("tr.item", {
        element(element) {
          element.onEndTag(() => {
            const title = current.title.trim().split("\n")[0].trim();
            const year = current.metadata.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
            if (title && current.id) {
              const work = {
                id: `douban-book-${current.id}`,
                title,
                type: "book" as const,
                ...(year ? { year: Number(year) } : {}),
                ...(current.poster_url ? { poster_url: current.poster_url } : {}),
              };
              works.push(work);
              if (work.poster_url) bookPosterIndex.set(key(title), work.poster_url);
            }
          });
        },
      })
      .transform(response);
    await rewritten.text();
    if (works.length < 2) throw new Error("No entries: upstream may require verification");
    return works;
  } catch (error) {
    console.error(`bookTopPage(${start}) failed:`, error);
    return [];
  }
}

export async function doubanBookTop250(limit: number): Promise<DoubanWork[]> {
  const starts = Array.from({ length: Math.ceil(limit / 25) }, (_, index) => index * 25);
  const pages = await Promise.allSettled(starts.map(bookTopPage));
  const works = pages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
  if (works.length < 2) throw new Error("Douban returned no usable entries");
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

export async function doubanBookSuggest(query: string): Promise<DoubanWork[]> {
  try {
    const response = await upstream(
      `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`,
    );
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
    }
    if (!Array.isArray(data)) throw new Error("Invalid upstream response");
    return data
      .filter((item) => item && typeof item === "object" && typeof item.title === "string")
      .slice(0, 8)
      .map((item) => ({
        id: `douban-book-${item.id}`,
        title: item.title,
        type: "book" as const,
        ...(Number.isInteger(Number(item.year)) && Number(item.year) > 0
          ? { year: Number(item.year) }
          : {}),
        ...(typeof item.pic === "string" ? { poster_url: item.pic } : {}),
      }));
  } catch (error) {
    console.error("doubanBookSuggest failed:", error);
    return [];
  }
}

async function ensureBookIndex() {
  if (!bookIndexPromise || Date.now() > bookIndexExpires) {
    bookIndexExpires = Date.now() + 15 * 60 * 1000;
    bookIndexPromise = doubanBookTop250(250)
      .then(() => undefined)
      .catch(() => undefined);
  }
  await bookIndexPromise;
}

async function musicTopPage(start: number): Promise<DoubanWork[]> {
  try {
    const response = await upstream(`https://music.douban.com/top250?start=${start}`);
    const works: DoubanWork[] = [];
    let current: { id: string; title: string; metadata: string; poster_url?: string };
    let titleSeen = false;
    const rewritten = new HTMLRewriter()
      .on("tr.item", {
        element() {
          current = { id: "", title: "", metadata: "" };
          titleSeen = false;
        },
      })
      .on("tr.item td:first-child a", {
        element(element) {
          current.id = element.getAttribute("href")?.match(/subject\/(\d+)/)?.[1] ?? "";
        },
      })
      .on("tr.item td:first-child img", {
        element(element) {
          current.poster_url = element.getAttribute("src") ?? undefined;
        },
      })
      .on("tr.item div.pl2 a", {
        element(element) {
          if (current.title) titleSeen = true;
          // Use title attribute if available (format: "artist - album")
          const titleAttr = element.getAttribute("title");
          if (titleAttr && !current.title) {
            // Extract album name from "artist - album" format
            const parts = titleAttr.split(" - ");
            current.title = parts.length > 1 ? parts.slice(1).join(" - ").trim() : titleAttr.trim();
            titleSeen = true;
          }
        },
        text(chunk) {
          if (!titleSeen) current.title += chunk.text;
        },
      })
      .on("tr.item p.pl", {
        text(chunk) {
          current.metadata += chunk.text;
        },
      })
      .on("tr.item", {
        element(element) {
          element.onEndTag(() => {
            const title = current.title.trim().split("\n")[0].trim();
            if (title && current.id) {
              const work = {
                id: `douban-music-${current.id}`,
                title,
                type: "music" as const,
                ...(current.poster_url ? { poster_url: current.poster_url } : {}),
              };
              works.push(work);
              if (work.poster_url) musicPosterIndex.set(key(title), work.poster_url);
            }
          });
        },
      })
      .transform(response);
    await rewritten.text();
    if (works.length < 2) throw new Error("No entries: upstream may require verification");
    return works;
  } catch (error) {
    console.error(`musicTopPage(${start}) failed:`, error);
    return [];
  }
}

export async function doubanMusicTop250(limit: number): Promise<DoubanWork[]> {
  const starts = Array.from({ length: Math.ceil(limit / 25) }, (_, index) => index * 25);
  const pages = await Promise.allSettled(starts.map(musicTopPage));
  const works = pages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
  if (works.length < 2) throw new Error("Douban returned no usable entries");
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

async function ensureMusicIndex() {
  if (!musicIndexPromise || Date.now() > musicIndexExpires) {
    musicIndexExpires = Date.now() + 15 * 60 * 1000;
    musicIndexPromise = doubanMusicTop250(250)
      .then(() => undefined)
      .catch(() => undefined);
  }
  await musicIndexPromise;
}

async function topPage(start: number): Promise<DoubanWork[]> {
  try {
    const response = await upstream(`https://movie.douban.com/top250?start=${start}&filter=`);
    const works: DoubanWork[] = [];
    let current: { id: string; title: string; metadata: string; poster_url?: string };
    let titleSeen = false;
    // HTMLRewriter decodes entities and tolerates attribute order and whitespace changes.
    const rewritten = new HTMLRewriter()
      .on("div.item", {
        element() {
          current = { id: "", title: "", metadata: "" };
          titleSeen = false;
        },
      })
      .on("div.item .hd a", {
        element(element) {
          current.id = element.getAttribute("href")?.match(/subject\/(\d+)/)?.[1] ?? "";
        },
      })
      .on("div.item .title", {
        element() {
          if (current.title) titleSeen = true;
        },
        text(chunk) {
          if (!titleSeen) current.title += chunk.text;
        },
      })
      .on("div.item .pic img", {
        element(element) {
          current.poster_url =
            element.getAttribute("src") ?? element.getAttribute("data-src") ?? undefined;
        },
      })
      .on("div.item .bd p", {
        text(chunk) {
          current.metadata += chunk.text;
        },
      })
      .on("div.item", {
        element(element) {
          element.onEndTag(() => {
            const title = current.title.trim();
            const year = current.metadata.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
            if (title && current.id) {
              const work = {
                id: `douban-${current.id}`,
                title,
                ...(year ? { year: Number(year) } : {}),
                ...(current.poster_url ? { poster_url: current.poster_url } : {}),
              };
              works.push(work);
              if (work.poster_url) posterIndex.set(key(title), work.poster_url);
            }
          });
        },
      })
      .transform(response);
    await rewritten.text();
    if (works.length < 2) throw new Error("No entries: upstream may require verification");
    return works;
  } catch (error) {
    console.error(`topPage(${start}) failed:`, error);
    return [];
  }
}

export async function doubanTop250(limit: number): Promise<DoubanWork[]> {
  const starts = Array.from({ length: Math.ceil(limit / 25) }, (_, index) => index * 25);
  const pages = await Promise.allSettled(starts.map(topPage));
  const works = pages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
  if (works.length < 2) throw new Error("Douban returned no usable entries");
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

// ===== Wikipedia & Baidu Baike for content_intro =====

const TYPE_HINTS: Record<string, { zh: string[]; en: string[] }> = {
  movie: { zh: ["电影"], en: ["film"] },
  book: { zh: ["小说"], en: ["novel"] },
  music: { zh: ["歌曲", "单曲", "专辑"], en: ["song", "single", "album"] },
};

// 消歧义页特征：「也可以指 / 可指以下 / 是以下条目」等枚举句式，这类摘要不是作品介绍
const DISAMBIG_RE =
  /(也可以指|也可指|可以指|可指[：:]|可指以下|是以下|為以下|为以下|指以下|以下.*同名|消歧义|消歧義)/;
// 类型词：命中则加分（不硬拒，避免误杀正确条目）
const TYPE_WORDS: Record<string, RegExp> = {
  movie: /(电影|影片|剧情片|纪录片|动画片|导演|制片|上映|票房|film|movie|directed)/i,
  book: /(小说|长篇|短篇|出版|作者|著者|书籍|novel|author|published)/i,
  music: /(专辑|唱片|歌曲|乐队|歌手|发行|录音|album|song|record|band|singer)/i,
};

interface Scored {
  intro: string;
  source: string;
  score: number;
}

// 首句声明检测：「是一部…电影/小说/专辑」式开头直接暴露条目真实类型
function declareType(text: string): "movie" | "book" | "music" | null {
  const head = text.slice(0, 160);
  if (
    /(电影|影片|剧情片|纪录片|动画片|驚悚片|惊悚片|喜剧片|爱情片|科幻片|恐怖片|悬疑片|电视剧)/.test(
      head,
    ) ||
    /片[，。、]/.test(head)
  )
    return "movie";
  if (/(小说|长篇|中篇|短篇)/.test(head)) return "book";
  if (/(歌曲|单曲|专辑|唱片|录音室)/.test(head)) return "music";
  return null;
}

// 打分：消歧义页 = -1（剔除）；首句类型声明 对+3/错-3；类型词 +2；年份 +2；标题含主标题 +1；限定标题 +3；
// 标题不含主标题且非限定条目 -3（排除「美国偶像」这类内容擦边命中）
function scoreCandidate(
  pageTitle: string,
  extract: string,
  opts: {
    mediaType?: "movie" | "book" | "music";
    year?: string;
    baseTitle?: string;
    qualified?: boolean;
    exact?: boolean;
  },
): number {
  if (DISAMBIG_RE.test(extract)) return -1;
  let score = 0;
  const title = pageTitle ?? "";
  const declared = declareType(extract);
  if (declared && opts.mediaType) score += declared === opts.mediaType ? 3 : -3;
  if (
    opts.mediaType &&
    (TYPE_WORDS[opts.mediaType]?.test(extract) || TYPE_WORDS[opts.mediaType]?.test(title))
  )
    score += 2;
  if (opts.year && (title.includes(opts.year) || extract.includes(opts.year))) score += 2;
  if (opts.baseTitle) {
    const base = opts.baseTitle.toLowerCase();
    const t = title.toLowerCase();
    if (t.includes(base)) score += 1;
    // 相关性惩罚仅针对搜索噪声；精确标题查询命中（含简繁重定向，如 龙猫→龍貓）豁免并加分
    else if (!opts.qualified && !opts.exact && !/(^|\s)[a-z]/i.test(base)) score -= 3;
  }
  if (opts.exact) score += 3;
  if (opts.qualified) score += 6;
  return score;
}

// 收集 titles 精确查询的候选（含 redirect 解析）
async function collectExtracts(
  titles: string[],
  lang: "zh" | "en",
  timeoutMs: number,
  opts: { mediaType?: "movie" | "book" | "music"; year?: string; baseTitle?: string },
): Promise<Scored[]> {
  if (!titles.length) return [];
  const exlimit = String(Math.min(20, Math.max(5, titles.length)));
  const params = new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    prop: "extracts",
    exintro: "true",
    explaintext: "true",
    exlimit,
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  try {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { "user-agent": USER_AGENTS[0], accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as {
      query?: {
        pages?: Record<string, { title?: string; extract?: string; missing?: boolean }>;
        redirects?: Array<{ from?: string; to?: string }>;
      };
    };
    const pages = d.query?.pages;
    if (!pages) return [];
    const resolve = new Map<string, string>();
    for (const rg of d.query?.redirects ?? [])
      if (rg.from && rg.to) resolve.set(rg.from.toLowerCase(), rg.to.toLowerCase());
    // converttitles：请求标题(简) → 转换后标题(繁)，补进解析表，使 pages 按原始请求标题可查
    for (const cv of (d.query as { converted?: Array<{ from?: string; to?: string }> })
      ?.converted ?? [])
      if (cv.from && cv.to) resolve.set(cv.from.toLowerCase(), cv.to.toLowerCase());
    const qualifiedSet = new Set(
      titles
        .filter((t) => t.includes("(") || t.includes("（"))
        .map((t) => resolve.get(t.toLowerCase()) ?? t.toLowerCase()),
    );
    const out: Scored[] = [];
    for (const p of Object.values(pages)) {
      if (!p.title || p.missing || !p.extract || p.extract.length <= 30) continue;
      const isQualified =
        qualifiedSet.has(p.title.toLowerCase()) &&
        p.title.toLowerCase() !== (opts.baseTitle ?? "").toLowerCase();
      const score = scoreCandidate(p.title, p.extract, {
        ...opts,
        qualified: isQualified,
        exact: true,
      });
      if (score >= 0) out.push({ intro: p.extract, source: `${lang}wiki`, score });
    }
    return out;
  } catch {
    return [];
  }
}

// 收集搜索结果的候选
async function collectSearch(
  query: string,
  lang: "zh" | "en",
  timeoutMs: number,
  opts: { mediaType?: "movie" | "book" | "music"; year?: string; baseTitle?: string },
): Promise<Scored[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "5",
    redirects: "1",
    prop: "extracts",
    exintro: "true",
    explaintext: "true",
    exlimit: "5",
    format: "json",
  });
  try {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { "user-agent": USER_AGENTS[0], accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as {
      query?: { pages?: Record<string, { title?: string; extract?: string; missing?: boolean }> };
    };
    const out: Scored[] = [];
    for (const p of Object.values(d.query?.pages ?? {})) {
      if (!p.extract || p.missing || p.extract.length <= 30) continue;
      const title = p.title ?? "";
      // 相关性门槛：标题含主标题，或首句声明与目标类型一致；否则视为搜索噪声
      const relevant =
        (opts.baseTitle && title.toLowerCase().includes(opts.baseTitle.toLowerCase())) ||
        (opts.mediaType && declareType(p.extract) === opts.mediaType);
      if (!relevant) continue;
      const score = scoreCandidate(title, p.extract, opts);
      if (score >= 0) out.push({ intro: p.extract, source: `${lang}wiki`, score });
    }
    return out;
  } catch {
    return [];
  }
}

function bestOf(cands: Scored[]): Scored | null {
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.score > a.score ? b : a));
}

async function fetchBaiduBaike(query: string): Promise<{ intro: string; source: string } | null> {
  try {
    const url = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379029&bk_key=${encodeURIComponent(query)}&bk_length=600`;
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENTS[0], accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { abstract?: string };
    if (data.abstract && data.abstract.length > 30) {
      return { intro: data.abstract, source: "baike" };
    }
    return null;
  } catch {
    return null;
  }
}

/** 从 "2017-06"、"2008-1"、"1997" 之类的出版/上映信息提取 4 位年份 */
function extractYear(raw: unknown): string | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  return String(raw).match(/\b(19|20)\d{2}\b/)?.[0];
}

/**
 * 消歧核心：优先命中「标题 (年份+媒介限定词)」形式的维基条目
 * （如 泰坦尼克号 (1997年电影) / Joker (2019 film)），避免落到
 * 裸标题的重定向目标（法国市镇、物理学家、Joker 词条等）。
 */
function qualifiedTitles(
  title: string,
  mediaType: "movie" | "book" | "music" | undefined,
  year: string | undefined,
  lang: "zh" | "en",
): string[] {
  if (!mediaType) return [];
  const hints = TYPE_HINTS[mediaType]?.[lang] ?? [];
  const out: string[] = [];
  const push = (inner: string) => {
    out.push(`${title} (${inner})`);
    if (lang === "zh") out.push(`${title}（${inner}）`);
  };
  for (const hint of hints) {
    if (year) push(lang === "zh" ? `${year}年${hint}` : `${year} ${hint}`);
    push(hint);
  }
  if (mediaType === "music") push(lang === "zh" ? "歌曲名" : "song name");
  if (mediaType === "book") push(lang === "zh" ? "长篇小说" : "novel");
  return out;
}

export async function fetchContentIntro(
  title: string,
  mediaType?: "movie" | "book" | "music",
  creator?: string,
  yearRaw?: unknown,
): Promise<{ intro: string; source: string } | null> {
  const year = extractYear(yearRaw);
  // 年份仅用于「精确限定标题」猜测（不存在的标题自然落空，安全）；不进入打分/搜索（避免 2023 等噪声命中无关页面）
  const opts = { mediaType, baseTitle: title };
  const hint = mediaType ? TYPE_HINTS[mediaType]?.zh[0] : undefined;

  const zhQualified = qualifiedTitles(title, mediaType, year, "zh");
  const enQualified = qualifiedTitles(title, mediaType, year, "en");
  const searchQueries = [
    hint ? `${title} ${hint}` : null,
    title,
    creator ? `${title} ${creator.replace(/^\[[^\]]*\]\s*/, "").trim()}` : null,
  ].filter((q): q is string => !!q);

  // 音乐：中文歌名优先百度百科——对华语流行单曲的覆盖远好于维基
  //（词条名通常就是歌名本身）；未命中再走维基多路消歧，末尾百科兜底对
  // music 换歌曲提示词二次尝试。英文等非中文歌名仍走维基。
  if (mediaType === "music" && /[一-鿿]/.test(title)) {
    const baikeFirst = await fetchBaiduBaike(title);
    if (baikeFirst) return baikeFirst;
  }

  const groups = await Promise.all([
    collectExtracts(zhQualified, "zh", 8000, opts),
    collectExtracts(enQualified, "en", 6000, opts),
    collectExtracts(
      [title, ...qualifiedTitles(title, mediaType, undefined, "zh").slice(0, 2)],
      "zh",
      8000,
      opts,
    ),
    collectExtracts(
      [title, ...qualifiedTitles(title, mediaType, undefined, "en").slice(0, 2)],
      "en",
      6000,
      opts,
    ),
    ...searchQueries.flatMap((q) => [
      collectSearch(q, "zh", 8000, opts),
      collectSearch(q, "en", 6000, opts),
    ]),
  ]);
  // 精确限定标题命中（qualified）优先于其它候选；其余按分数择优
  const all = groups.flat();
  const qualifiedHit = all.find((c) => c.score >= 6);
  const best = qualifiedHit ?? bestOf(all);
  if (best) return { intro: best.intro, source: best.source };

  // 百度百科兜底
  try {
    const baike = await fetchBaiduBaike(hint ? `${title} ${hint}` : title);
    if (baike) return baike;
  } catch (e) {
    console.error(`baike failed for "${title}":`, e instanceof Error ? e.message : e);
  }
  return null;
}

export async function doubanSuggest(query: string): Promise<DoubanWork[]> {
  try {
    const response = await upstream(
      `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`,
    );
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
    }
    if (!Array.isArray(data)) throw new Error("Invalid upstream response");
    return data
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (item.type === "movie" || item.type === undefined) &&
          typeof item.title === "string",
      )
      .slice(0, 8)
      .map((item) => ({
        id: `douban-${item.id}`,
        title: item.title,
        ...(Number.isInteger(Number(item.year)) && Number(item.year) > 0
          ? { year: Number(item.year) }
          : {}),
        ...(typeof item.img === "string" ? { poster_url: item.img } : {}),
      }));
  } catch (error) {
    console.error("doubanSuggest failed:", error);
    return [];
  }
}

async function ensureIndex() {
  if (!indexPromise || Date.now() > indexExpires) {
    indexExpires = Date.now() + 15 * 60 * 1000;
    indexPromise = doubanTop250(250)
      .then(() => undefined)
      .catch(() => undefined);
  }
  await indexPromise;
}

function doubanVariants(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (!/^img\d+\.doubanio\.com$/.test(parsed.hostname)) return [];
    parsed.protocol = "https:";
    const original = parsed.href.replace(/\/s_ratio_poster\//, "/l/");
    return [
      ...new Set([
        original,
        parsed.href,
        ...[1, 2, 3, 9].map((host) => original.replace(/img\d+\.doubanio/, `img${host}.doubanio`)),
      ]),
    ];
  } catch {
    return [];
  }
}

async function imdbPoster(
  title: string,
  english: string,
  year?: number,
): Promise<string | undefined> {
  try {
    const known = (curatedPosters as Record<string, { query: string; id: string }>)[title];
    const query =
      known?.query ??
      english
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
    if (!query) return;
    const response = await upstream(
      `https://v3.sg.media-imdb.com/suggestion/${query[0]}/${encodeURIComponent(query)}.json`,
    );
    const data = (await response.json()) as {
      d?: Array<{ id?: string; l?: string; y?: number; i?: { imageUrl?: string } }>;
    };
    const item = data.d?.find((entry) =>
      known
        ? entry.id === known.id
        : entry.id?.startsWith("tt") &&
          key(entry.l ?? "") === key(english) &&
          (!year || entry.y === year),
    );
    return item?.i?.imageUrl;
  } catch (error) {
    console.error("imdbPoster failed:", error);
    return undefined;
  }
}

async function searchCover(
  query: string,
  type: "movie" | "book" | "music",
  attempt = 0,
): Promise<string | undefined> {
  try {
    const cat = type === "movie" ? "1002" : type === "book" ? "1001" : "1003";
    const url = `https://search.douban.com/${type}/subject_search?search_text=${encodeURIComponent(query)}&cat=${cat}`;
    await throttle("search.douban.com");
    const response = await fetch(url, {
      headers: buildHeaders(url, false),
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (response.status === 403 || response.status === 418) {
      // 只做短冷却并重试一次。原先给整个域名设 10s 冷却：一首歌触发 418，
      // 同一批次里剩下的全部被迫排队等冷却，等于连坐。
      cooldownMap.set("search.douban.com", Date.now() + 1200);
      console.warn(`searchCover rate limited (${response.status})`);
      if (attempt === 0) return searchCover(query, type, 1);
      // 重试后仍被限流：抛出而不是返回 undefined。调用方据此把这次结果标成
      // `throttled`（15 秒负缓存），而不是当作「上游没有这张图」（24 小时负缓存）。
      // 返回 undefined 会让瞬时失败被记成永久缺失，这正是「刷新也补不回来」的成因。
      throw new ThrottledError(`searchCover rate limited (${response.status})`);
    }
    if (!response.ok) return undefined;
    const html = await response.text();
    const startMarker = "window.__DATA__ = ";
    const startIdx = html.indexOf(startMarker);
    if (startIdx === -1) return undefined;
    const jsonStart = startIdx + startMarker.length;
    const jsonMatch = html
      .substring(jsonStart)
      .match(/^\{[\s\S]*?\}(?=\s*;\s*(?:window|<\/script))/);
    if (!jsonMatch) return undefined;
    const data = JSON.parse(jsonMatch[0]) as {
      items?: Array<{ title?: string; cover_url?: string }>;
    };
    if (!data.items?.length) return undefined;
    const queryKey = key(query);
    const item = data.items.find(
      (entry) => entry.cover_url && entry.title && key(entry.title).includes(queryKey),
    );
    return item?.cover_url;
  } catch (error) {
    console.error(`searchCover(${query}, ${type}) failed:`, error);
    return undefined;
  }
}

interface WikiImagePage {
  title?: string;
  extract?: string;
  description?: string;
  missing?: boolean;
  original?: { source?: string };
  thumbnail?: { source?: string };
}

function wikiImageUrl(page: WikiImagePage): string | undefined {
  const raw = page.original?.source ?? page.thumbnail?.source;
  return raw ? raw.replace(/^http:/, "https:") : undefined;
}

function scoreWikiImage(
  page: WikiImagePage,
  title: string,
  english: string,
  type?: "movie" | "book" | "music",
  year?: string,
): number {
  const pageTitle = key(page.title ?? "");
  const base = key(title);
  const englishKey = key(english);
  if (!pageTitle) return -1;
  const text = `${page.extract ?? ""} ${page.description ?? ""}`.trim();
  const declared = text ? declareType(text) : null;
  const hasTypeWord = !!type && !!text && !!TYPE_WORDS[type]?.test(text);
  let score = 0;
  if (pageTitle === base || pageTitle === englishKey) score += 4;
  else if (pageTitle.includes(base) || base.includes(pageTitle)) score += 2;
  else if (englishKey && (pageTitle.includes(englishKey) || englishKey.includes(pageTitle)))
    score += 1;
  else return -1;
  if (type) {
    if (declared && declared !== type) return -1;
    if (declared === type) score += 8;
    else if (hasTypeWord) score += 3;
    else score -= 6;
  }
  if (year && text.includes(year)) score += 2;
  return score;
}

async function queryWikiImages(
  lang: "zh" | "en",
  params: URLSearchParams,
  title: string,
  english: string,
  type?: "movie" | "book" | "music",
  year?: string,
): Promise<string[]> {
  try {
    const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { "user-agent": USER_AGENTS[0], accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { query?: { pages?: Record<string, WikiImagePage> } };
    return Object.values(data.query?.pages ?? {})
      .map((page) => ({ page, score: scoreWikiImage(page, title, english, type, year) }))
      .filter((entry) => entry.score >= 0 && !!wikiImageUrl(entry.page))
      .sort((a, b) => b.score - a.score)
      .map((entry) => wikiImageUrl(entry.page)!)
      .filter((url, index, urls) => urls.indexOf(url) === index)
      .slice(0, 4);
  } catch {
    return [];
  }
}

async function searchWikiPoster(
  title: string,
  english: string,
  type?: "movie" | "book" | "music",
  year?: number,
): Promise<string[]> {
  const queries = [title, english].map((value) => value.trim()).filter(Boolean);
  for (const lang of ["zh", "en"] as const) {
    const typeHint = type ? TYPE_HINTS[type]?.[lang]?.[0] : undefined;
    const exactTitles = [
      ...new Set(
        queries.flatMap((value) =>
          typeHint ? [value, `${value} (${typeHint})`, `${value}（${typeHint}）`] : [value],
        ),
      ),
    ];
    const exactParams = new URLSearchParams({
      action: "query",
      titles: exactTitles.join("|"),
      prop: "pageimages|info|extracts",
      piprop: "original|thumbnail",
      pithumbsize: "1200",
      exintro: "true",
      explaintext: "true",
      exlimit: "20",
      redirects: "1",
      converttitles: "1",
      format: "json",
      origin: "*",
    });
    const exact = await queryWikiImages(
      lang,
      exactParams,
      title,
      english,
      type,
      year ? String(year) : undefined,
    );
    if (exact.length) return exact;

    for (const query of queries) {
      const searchParams = new URLSearchParams({
        action: "query",
        generator: "search",
        gsrsearch: typeHint ? `${query} ${typeHint}` : query,
        gsrnamespace: "0",
        gsrlimit: "5",
        prop: "pageimages|info|extracts",
        piprop: "original|thumbnail",
        pithumbsize: "1200",
        exintro: "true",
        explaintext: "true",
        exlimit: "5",
        redirects: "1",
        format: "json",
        origin: "*",
      });
      const found = await queryWikiImages(
        lang,
        searchParams,
        title,
        english,
        type,
        year ? String(year) : undefined,
      );
      if (found.length) return found;
    }
  }
  return [];
}

async function searchNeteasePoster(title: string, env?: GdProxyEnv): Promise<string[]> {
  // Priority 2: NetEase's public search returns album images without requiring
  // a user cookie and is usually more accurate than a generic music search.
  try {
    const params = new URLSearchParams({
      s: title,
      type: "100",
      offset: "0",
      total: "true",
      limit: "10",
    });
    const response = await fetch("https://music.163.com/api/search/get/web?" + params.toString(), {
      headers: {
        "user-agent": USER_AGENTS[0],
        referer: "https://music.163.com/",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        result?: { songs?: Array<{ name?: string; album?: { picUrl?: string } }> };
      };
      const want = key(title);
      const song = (data.result?.songs ?? []).find(
        (entry) =>
          entry.album?.picUrl &&
          entry.name &&
          (key(entry.name) === want ||
            key(entry.name).includes(want) ||
            want.includes(key(entry.name))),
      );
      if (song?.album?.picUrl) return [song.album.picUrl.replace(/^http:/, "https:")];
    }
  } catch {
    /* Fall through to gd-proxy/gdstudio. */
  }

  // Priority 3: gd-proxy/gdstudio fallback.
  const { tracks } = await gdSearch(title, 10, env);
  for (const track of pickTracks(tracks, title, undefined, 5)) {
    if (!track.pic_id) continue;
    const url = await gdPicUrl(track.pic_id, env);
    if (url) return [url.replace(/^http:/, "https:")];
  }
  return [];
}

/**
 * 已缓存的查询直接返回；否则计算并写入两级缓存。
 * 缓存键为 `type|title|english|year` 的规范化形式。
 *
 * `opts.retry`：绕过**被限流**的负缓存（正缓存与「确实没有」的负缓存仍生效）。
 * 前端在每次页面加载的首次批量带上它，让「刷新 = 真重试」是确定的，
 * 而不是碰运气等满 15 秒窗口；同时不会让真正不存在海报的条目每次被重问一遍。
 */
export async function resolvePosters(
  title: string,
  english: string,
  year?: number,
  type?: "movie" | "book" | "music",
  env?: GdProxyEnv,
  opts?: { retry?: boolean },
): Promise<string[]> {
  return (await resolvePosterEntry(title, english, year, type, env, opts)).urls;
}

async function resolvePosterEntry(
  title: string,
  english: string,
  year?: number,
  type?: "movie" | "book" | "music",
  env?: GdProxyEnv,
  opts?: { retry?: boolean },
): Promise<PosterCacheEntry> {
  const cacheKey = posterMediaKey(title, english, type, year);
  const isolateHit = readIsolatePosterCache(cacheKey);
  const cached = isolateHit ?? (await readEdgePosterCache(cacheKey));
  if (cached && !(opts?.retry === true && cached.outcome === "throttled")) {
    // 只把 Edge Cache 的结果回填 L1（与旧行为一致）。命中 L1 时**不**重写：
    // 否则每次浏览都会把负缓存的 TTL 顺延，等于让「确实没有海报」永久缓存下去。
    if (!isolateHit) writeIsolatePosterCache(cacheKey, cached);
    return cached;
  }
  const entry = await computePosters(title, english, year, type, env);
  writeIsolatePosterCache(cacheKey, entry);
  await writeEdgePosterCache(cacheKey, entry);
  return entry;
}

/**
 * 实际的多级回退解析，不含缓存。
 *
 * 取图优先级：**能直连的 CDN 优先，需要代理的豆瓣垫后**。
 *  - 音乐：网易云 CDN（`p*.music.126.net`，直连）→ 豆瓣 → 维基
 *  - 电影/书籍：豆瓣（准确度优先）→ 维基 → 网易云/gd-proxy
 * 理由见 music 分支内的注释；返回数组的顺序就是前端尝试顺序。
 */
async function computePosters(
  title: string,
  english: string,
  year?: number,
  type?: "movie" | "book" | "music",
  env?: GdProxyEnv,
): Promise<PosterCacheEntry> {
  let primary: string[] = [];
  // 只有回退链彻底没结果时，这个标记才决定「记成瞬时失败还是永久缺失」。
  let throttled = false;
  const noteThrottle = (...settled: Array<PromiseSettledResult<unknown>>) => {
    for (const result of settled)
      if (result.status === "rejected" && result.reason instanceof ThrottledError) throttled = true;
  };
  if (type === "book") {
    const [suggestion, search] = await Promise.allSettled([
      doubanBookSuggest(title),
      searchCover(title, "book"),
    ]);
    noteThrottle(suggestion, search);
    const suggested =
      suggestion.status === "fulfilled"
        ? suggestion.value.find((item) => key(item.title) === key(title))?.poster_url
        : undefined;
    const searched = search.status === "fulfilled" ? search.value : undefined;
    if (!suggested && !searched && !bookPosterIndex.has(key(title))) await ensureBookIndex();
    primary = [
      ...new Set([
        ...(suggested ? doubanVariants(suggested) : []),
        ...(searched ? doubanVariants(searched) : []),
        ...(bookPosterIndex.has(key(title))
          ? doubanVariants(bookPosterIndex.get(key(title))!)
          : []),
      ]),
    ];
  } else if (type === "music") {
    // 取图优先级（音乐）：**网易云 CDN 直出 → 豆瓣（需 /api/image 代理）**。
    //
    // 网易云封面是 `p*.music.126.net`：CSP 已放行、浏览器可直连、不占豆瓣的抓取配额，
    // 也不受豆瓣 418 风控影响；豆瓣封面必须由 Worker 带 Referer 代理，且在并发批量下
    // 会被 418 打回。两者**并行**取（不增加豆瓣请求数——原来音乐就是每次都查豆瓣，
    // 现在只是把网易云从"最后一档兜底"提到"第一张候选"），返回数组顺序即展示顺序，
    // 第一张加载失败时 Poster 组件会自然降级到下一张（豆瓣/维基）。
    const [netease, search] = await Promise.allSettled([
      searchNeteasePoster(title, env),
      searchCover(title, "music"),
    ]);
    noteThrottle(search);
    const searched = search.status === "fulfilled" ? search.value : undefined;
    if (!searched && !musicPosterIndex.has(key(title))) await ensureMusicIndex();
    const direct = netease.status === "fulfilled" ? netease.value : [];
    const proxied = [
      ...(searched ? doubanVariants(searched) : []),
      ...(musicPosterIndex.has(key(title))
        ? doubanVariants(musicPosterIndex.get(key(title))!)
        : []),
    ];
    primary = [...new Set([...direct, ...proxied])];
  } else {
    const [suggestion, imdb, search] = await Promise.allSettled([
      doubanSuggest(title),
      imdbPoster(title, english, year),
      searchCover(title, "movie"),
    ]);
    noteThrottle(suggestion, imdb, search);
    const suggested =
      suggestion.status === "fulfilled"
        ? suggestion.value.find(
            (item) => key(item.title) === key(title) && (!year || !item.year || item.year === year),
          )?.poster_url
        : undefined;
    const searched = search.status === "fulfilled" ? search.value : undefined;
    if (
      !suggested &&
      !searched &&
      !posterIndex.has(key(title)) &&
      !(imdb.status === "fulfilled" && imdb.value)
    )
      await ensureIndex();
    primary = [
      ...new Set([
        ...(suggested ? doubanVariants(suggested) : []),
        ...(searched ? doubanVariants(searched) : []),
        ...(posterIndex.has(key(title)) ? doubanVariants(posterIndex.get(key(title))!) : []),
        ...(imdb.status === "fulfilled" && imdb.value ? [imdb.value] : []),
      ]),
    ];
  }
  if (primary.length) return { urls: primary, outcome: "found" };

  // 当前源无结果时按 Wiki → 网易云/gd-proxy 逐级降级（对所有类型生效，避免特定类型漏掉降级）。
  const wiki = await searchWikiPoster(title, english, type, year);
  if (wiki.length) return { urls: wiki, outcome: "found" };
  // music 的网易云档已经在上面并行取过（且是第一候选），这里不再重复请求。
  if (type !== "music") {
    const netease = await searchNeteasePoster(title, env);
    if (netease.length) return { urls: netease, outcome: "found" };
  }
  return { urls: [], outcome: throttled ? "throttled" : "absent" };
}

/**
 * 批量解析：以受限并发并行调用 resolvePosters，同一请求内重复的 key 只查一次。
 * 返回值同时给出 map（`results`）与和入参等长的 key 序列（`keys`），
 * 便于调用方按位置对齐，避免两端重新推导键时的规范化差异。
 */
export interface PosterBatchRequest {
  title: string;
  english?: string;
  year?: number;
  type?: "movie" | "book" | "music";
}
export interface PosterBatchResult {
  [cacheKey: string]: string[];
}
export interface PosterBatchResponse {
  results: PosterBatchResult;
  keys: string[];
  /** 每个 key 的结果分类；路由据此把批量失败写进 poster_errors（原先批量失败完全不可见）。 */
  outcomes: Record<string, PosterOutcome>;
}
/**
 * 已知结果能否用于短路。
 * **空数组按未命中处理**——空结果本来就不落库（见 posterStore.saveResolvedPosters），
 * 上游恢复后不应因为一条空记录而长期显示无海报。
 */
export function knownPosterHit(
  known: ReadonlyMap<string, string[]> | undefined,
  key: string,
): string[] | null {
  const stored = known?.get(key);
  return stored?.length ? stored : null;
}

/**
 * @param known 已知的持久化结果（来自 `poster_urls` 侧表）。命中即短路，不再回源。
 * @param opts.retry 见 resolvePosters。
 */
export async function resolvePostersBatch(
  requests: PosterBatchRequest[],
  env?: GdProxyEnv,
  concurrency: number = 8,
  known?: ReadonlyMap<string, string[]>,
  opts?: { retry?: boolean },
): Promise<PosterBatchResponse> {
  const results: PosterBatchResult = {};
  const outcomes: Record<string, PosterOutcome> = {};
  const keys: string[] = [];
  const pending = new Map<string, PosterBatchRequest>();
  for (const request of requests) {
    const ck = posterMediaKey(request.title, request.english ?? "", request.type, request.year);
    keys.push(ck);
    if (ck in results || pending.has(ck)) continue;
    const stored = knownPosterHit(known, ck);
    if (stored) {
      results[ck] = stored;
      outcomes[ck] = "found";
      continue;
    }
    pending.set(ck, request);
  }

  const queue = [...pending];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const [ck, request] = queue[cursor++];
      try {
        const entry = await resolvePosterEntry(
          request.title,
          request.english ?? "",
          request.year,
          request.type,
          env,
          opts,
        );
        results[ck] = entry.urls;
        outcomes[ck] = entry.outcome;
      } catch {
        // 未预期的异常（网络/解析）按瞬时失败处理：短 TTL，下次刷新会重试。
        results[ck] = [];
        outcomes[ck] = "throttled";
      }
    }
  }
  const workers = Math.min(Math.max(1, concurrency), queue.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  // 同一请求内重复但被折叠的 key 也要在 map 里出现，调用方按 keys 取值才不会落空。
  for (const ck of keys) {
    if (!(ck in results)) {
      results[ck] = [];
      outcomes[ck] = "absent";
    }
  }
  return { results, keys, outcomes };
}

// ===== Search List API =====

export interface SearchResult {
  cover_link: string;
  cover: string;
  rating: string;
  title: string;
  [key: string]: unknown;
}

interface SearchItem {
  title?: string;
  cover_url?: string;
  url?: string;
  rating?: string | number;
  abstract?: string;
  abstract_2?: string;
  labels?: Array<{ text?: string }>;
  [key: string]: unknown;
}

async function fetchSearchList(
  type: "movie" | "book" | "music",
  query: string,
  page: number,
): Promise<SearchResult[]> {
  const cat = type === "movie" ? "1002" : type === "book" ? "1001" : "1003";
  const start = (page - 1) * 15;
  const url = `https://search.douban.com/${type}/subject_search?search_text=${encodeURIComponent(query)}&cat=${cat}&start=${start}`;
  await throttle("search.douban.com");
  const response = await fetch(url, {
    headers: buildHeaders(url, false),
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (response.status === 403 || response.status === 418) {
    cooldownMap.set("search.douban.com", Date.now() + 10000);
    throw new Error(`Rate limited: ${response.status}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const startMarker = "window.__DATA__ = ";
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return [];
  const jsonStart = startIdx + startMarker.length;
  // Match JSON object ending with }; before next window or </script>
  const jsonMatch = html.substring(jsonStart).match(/^\{[\s\S]*?\}(?=\s*;\s*(?:window|<\/script))/);
  if (!jsonMatch) return [];
  const data = JSON.parse(jsonMatch[0]) as { items?: SearchItem[] };
  if (!data.items?.length) return [];
  return data.items
    .filter((item) => item.title && item.cover_url)
    .map((item) => parseSearchItem(type, item));
}

function parseSearchItem(type: "movie" | "book" | "music", item: SearchItem): SearchResult {
  const ratingObj = item.rating;
  const ratingValue =
    typeof ratingObj === "object" && ratingObj !== null
      ? String((ratingObj as Record<string, unknown>).value ?? "")
      : String(ratingObj ?? "");
  const base: SearchResult = {
    cover_link: item.url ?? "",
    cover: item.cover_url ?? "",
    rating: ratingValue,
    title: (item.title ?? "").trim(),
  };
  if (type === "book") return parseBookSearchItem(item, base);
  if (type === "movie") return parseMovieSearchItem(item, base);
  return parseMusicSearchItem(item, base);
}

function parseBookSearchItem(item: SearchItem, base: SearchResult): SearchResult {
  const abstract = item.abstract ?? "";
  const parts = abstract.split("/").map((s) => s.trim());
  if (parts.length >= 4) {
    base.price = parts.pop();
    base.date = parts.pop();
    base.press = parts.pop();
    base.author = parts.join("/");
  } else if (parts.length >= 1) {
    base.author = parts[0];
  }
  return base;
}

function parseMovieSearchItem(item: SearchItem, base: SearchResult): SearchResult {
  const titleMatch = base.title.match(/^(.*?)(?:\s*‎?\s*\((\d{4})\))?\s*$/);
  if (titleMatch) {
    base.title = (titleMatch[1] ?? base.title).trim();
    if (titleMatch[2]) base.year = titleMatch[2];
  }
  const abstract = item.abstract ?? "";
  const parts = abstract.split("/").map((s) => s.trim());
  if (parts.length >= 3) {
    base.country = parts.shift();
    base.duration = parts.pop();
    base.type = parts;
  }
  const abstract2 = item.abstract_2 ?? "";
  if (abstract2) {
    base.actors = abstract2
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return base;
}

function parseMusicSearchItem(item: SearchItem, base: SearchResult): SearchResult {
  const titleText = base.title;
  const slashIdx = titleText.indexOf(" / ");
  if (slashIdx !== -1) {
    base.title = titleText.substring(0, slashIdx).trim();
    base.subtitle = titleText.substring(slashIdx + 3).trim();
  }
  const abstract = item.abstract ?? "";
  const parts = abstract.split("/").map((s) => s.trim());
  if (parts.length >= 2) {
    base.artist = parts[0];
    base.date = parts[1];
    if (parts[2]) base.album = parts[2];
    if (parts[3]) base.medium = parts[3];
    if (parts[4]) base.schools = parts[4];
  }
  return base;
}

export async function doubanSearch(
  type: "movie" | "book" | "music",
  query: string,
  page = 1,
): Promise<{ status: boolean; msg: string; time: string; data: SearchResult[] }> {
  const t0 = Date.now();
  try {
    // Check per-domain cooldown for search.douban.com
    const searchCooldown = cooldownMap.get("search.douban.com") ?? 0;
    if (Date.now() < searchCooldown) {
      return {
        status: false,
        msg: `豆瓣限流中，请${Math.ceil((searchCooldown - Date.now()) / 1000)}秒后重试`,
        time: "0s",
        data: [],
      };
    }
    const data = await fetchSearchList(type, query, page);
    return {
      status: true,
      msg: "获取成功",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`doubanSearch(${type}, ${query}) failed:`, errMsg);
    const msg = errMsg.includes("Rate limited") ? "豆瓣限流，请稍后重试" : "获取失败";
    return { status: false, msg, time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: [] };
  }
}

// ===== Detail API =====

export interface BookDetail {
  title: string;
  pic: string;
  rating: string;
  作者?: string;
  出版社?: string;
  出版年?: string;
  页数?: string;
  定价?: string;
  装帧?: string;
  丛书?: string;
  ISBN?: string;
  content_intro?: string;
  author_intro?: string;
  dirs?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export interface MovieDetail {
  title: string;
  pic: string;
  rating: string;
  导演?: string;
  编剧?: string;
  主演?: string;
  类型?: string;
  "制片国家/地区"?: string;
  语言?: string;
  上映日期?: string;
  片长?: string;
  又名?: string;
  IMDb链接?: string;
  content_intro?: string;
  acting_staff?: string[];
  imgs?: string[];
  [key: string]: unknown;
}

export interface MusicDetail {
  title: string;
  pic: string;
  rating: string;
  又名?: string;
  表演者?: string;
  流派?: string;
  专辑类型?: string;
  介质?: string;
  发行时间?: string;
  出版者?: string;
  唱片数?: string;
  条形码?: string;
  content_intro?: string;
  songs?: string[];
  [key: string]: unknown;
}

async function fetchDetailPage(
  url: string,
): Promise<{ html: string; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { url, steps: [] as string[] };
  const steps = debug.steps as string[];
  const domain = new URL(url).hostname;
  await throttle(domain);
  steps.push(`throttle_done for ${domain}`);

  const headers = buildHeaders(url, false);
  steps.push(`headers built: UA=${headers["user-agent"]?.slice(0, 40)}...`);

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });

  debug.http_status = response.status;
  debug.response_url = response.url;
  debug.content_type = response.headers.get("content-type");
  steps.push(`fetch done: status=${response.status}, url=${response.url?.slice(0, 80)}`);

  if (response.status === 403 || response.status === 418) {
    cooldownMap.set(domain, Date.now() + 10000);
    steps.push(`rate limited on ${domain}, cooldown set`);
    throw new Error(`Rate limited: ${response.status}`);
  }
  if (!response.ok) {
    steps.push(`HTTP error: ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();
  debug.html_length = html.length;
  debug.html_preview = html.slice(0, 300);
  steps.push(`html received: ${html.length} chars`);

  // Check if we got redirected to anti-bot page — must throw so callers
  // fall through to their catch block (enables Wikipedia/Baike fallback).
  if (response.url?.includes("sec.douban.com")) {
    steps.push("redirected to sec.douban.com (anti-bot)");
    debug.blocked = true;
    throw new Error("Anti-bot redirect to sec.douban.com");
  }

  return { html, debug };
}

function extractBetween(html: string, after: string, before: string, from = 0): string {
  const a = html.indexOf(after, from);
  if (a === -1) return "";
  const s = a + after.length;
  const b = html.indexOf(before, s);
  if (b === -1) return html.substring(s, s + 200);
  return html.substring(s, b);
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function doubanBookDetail(
  url: string,
): Promise<{ status: boolean; msg: string; time: string; data: BookDetail | null }> {
  const t0 = Date.now();
  try {
    if (!url.includes("book.douban.com/subject/")) throw new Error("Invalid book URL");
    const bookCooldown = cooldownMap.get("book.douban.com") ?? 0;
    if (Date.now() < bookCooldown)
      return {
        status: false,
        msg: `豆瓣限流中，请${Math.ceil((bookCooldown - Date.now()) / 1000)}秒后重试`,
        time: "0s",
        data: null,
      };
    const { html } = await fetchDetailPage(url);
    const detail: BookDetail = { title: "", pic: "", rating: "" };
    // Title
    const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([^<]+)<\/span>/);
    detail.title = titleMatch
      ? cleanHtml(titleMatch[1])
      : extractBetween(html, "<title>", "</title>").split("(")[0].trim();
    // Pic
    const picMatch = html.match(/<div\s+id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/);
    detail.pic = picMatch ? picMatch[1] : "";
    // Rating
    const ratingMatch = html.match(/<strong[^>]+property="v:average"[^>]*>([^<]+)<\/strong>/);
    detail.rating = ratingMatch ? ratingMatch[1].trim() : "";
    // Info block
    const infoHtml = extractBetween(html, '<div id="info"', "</div>");
    const infoLines = infoHtml
      .split(/<br\s*\/?>/)
      .map((l) => cleanHtml(l))
      .filter(Boolean);
    for (const line of infoLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line
        .substring(0, colonIdx)
        .trim()
        .replace(/^.*>\s*/, "");
      const value = line.substring(colonIdx + 1).trim();
      if (field && value && !field.includes("class=")) detail[field] = value;
    }
    // Content intro
    const introMatch = html.match(/<div\s+class="intro"[^>]*>([\s\S]*?)<\/div>/);
    if (introMatch) detail.content_intro = cleanHtml(introMatch[1]);
    // Author intro
    const authorIntroMatch = html.match(
      /<div\s+class="indent"[^>]*id="link-report"[\s\S]*?<div\s+class="intro"[^>]*>([\s\S]*?)<\/div>/,
    );
    if (authorIntroMatch) detail.author_intro = cleanHtml(authorIntroMatch[1]);
    // Tags
    const tagMatches = html.match(/<a\s+href="[^"]*tag[^"]*"[^>]*>([^<]+)<\/a>/g);
    if (tagMatches) detail.tags = tagMatches.map((m) => cleanHtml(m)).filter(Boolean);
    // Directories
    const dirMatch = html.match(/<div\s+class="indent"[^>]*id="dir_[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (dirMatch) {
      const dirText = cleanHtml(dirMatch[1]);
      detail.dirs = dirText
        .split(/\s{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (!detail.title && !detail.rating) throw new Error("Detail page produced no usable content");
    return {
      status: true,
      msg: "获取成功",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data: detail,
    };
  } catch (error) {
    console.error(`doubanBookDetail failed:`, error);
    return {
      status: false,
      msg: "获取失败",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data: null,
    };
  }
}

export async function doubanMovieDetail(url: string): Promise<{
  status: boolean;
  msg: string;
  time: string;
  data: MovieDetail | null;
  debug?: Record<string, unknown>;
}> {
  const t0 = Date.now();
  try {
    if (!url.includes("movie.douban.com/subject/")) throw new Error("Invalid movie URL");
    const movieCooldown = cooldownMap.get("movie.douban.com") ?? 0;
    if (Date.now() < movieCooldown)
      return {
        status: false,
        msg: `豆瓣限流中，请${Math.ceil((movieCooldown - Date.now()) / 1000)}秒后重试`,
        time: "0s",
        data: null,
      };
    const { html, debug } = await fetchDetailPage(url);
    const detail: MovieDetail = { title: "", pic: "", rating: "" };
    const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([^<]+)<\/span>/);
    detail.title = titleMatch
      ? cleanHtml(titleMatch[1])
      : extractBetween(html, "<title>", "</title>").split("(")[0].trim();
    debug.found_title = !!titleMatch;
    const picMatch = html.match(/<div\s+id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/);
    detail.pic = picMatch ? picMatch[1] : "";
    debug.found_pic = !!picMatch;
    const ratingMatch = html.match(/<strong[^>]+property="v:average"[^>]*>([^<]+)<\/strong>/);
    detail.rating = ratingMatch ? ratingMatch[1].trim() : "";
    debug.found_rating = !!ratingMatch;
    const infoHtml = extractBetween(html, '<div id="info"', "</div>");
    const infoLines = infoHtml
      .split(/<br\s*\/?>/)
      .map((l) => cleanHtml(l))
      .filter(Boolean);
    for (const line of infoLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line
        .substring(0, colonIdx)
        .trim()
        .replace(/^.*>\s*/, "");
      const value = line.substring(colonIdx + 1).trim();
      if (field && value && !field.includes("class=")) detail[field] = value;
    }
    debug.found_info = infoLines.length > 0;
    const introMatch = html.match(/<span\s+property="v:summary"[^>]*>([\s\S]*?)<\/span>/);
    if (introMatch) detail.content_intro = cleanHtml(introMatch[1]);
    debug.found_intro = !!introMatch;
    const actorMatches = html.match(/<a\s+href="[^"]*celebrity[^"]*"[^>]*>([^<]+)<\/a>/g);
    if (actorMatches)
      detail.acting_staff = actorMatches
        .slice(0, 10)
        .map((m) => cleanHtml(m))
        .filter(Boolean);
    const imgMatches = html.match(
      /<img[^>]+src="(https:\/\/img\d+\.doubanio\.com\/view\/photo\/[^"]+)"/g,
    );
    if (imgMatches)
      detail.imgs = [
        ...new Set(imgMatches.map((m) => m.match(/src="([^"]+)"/)?.[1] ?? "").filter(Boolean)),
      ].slice(0, 6);
    // Sanity check: if the page produced no title and no rating, the HTML was
    // likely garbage (anti-bot page, empty response, etc.) — treat as failure
    // so the caller's Wikipedia fallback can kick in.
    if (!detail.title && !detail.rating) throw new Error("Detail page produced no usable content");
    return {
      status: true,
      msg: "获取成功",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data: detail,
      debug,
    };
  } catch (error) {
    return {
      status: false,
      msg: error instanceof Error ? error.message : "获取失败",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data: null,
    };
  }
}

export async function doubanMusicDetail(
  url: string,
): Promise<{ status: boolean; msg: string; time: string; data: MusicDetail | null }> {
  const t0 = Date.now();
  try {
    if (!url.includes("music.douban.com/subject/")) throw new Error("Invalid music URL");
    const musicCooldown = cooldownMap.get("music.douban.com") ?? 0;
    if (Date.now() < musicCooldown)
      return {
        status: false,
        msg: `豆瓣限流中，请${Math.ceil((musicCooldown - Date.now()) / 1000)}秒后重试`,
        time: "0s",
        data: null,
      };
    const { html } = await fetchDetailPage(url);
    const detail: MusicDetail = { title: "", pic: "", rating: "" };
    const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([^<]+)<\/span>/);
    detail.title = titleMatch
      ? cleanHtml(titleMatch[1])
      : extractBetween(html, "<title>", "</title>").split("(")[0].trim();
    const picMatch = html.match(/<div\s+id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/);
    detail.pic = picMatch ? picMatch[1] : "";
    const ratingMatch = html.match(/<strong[^>]+property="v:average"[^>]*>([^<]+)<\/strong>/);
    detail.rating = ratingMatch ? ratingMatch[1].trim() : "";
    // Info block
    const infoHtml = extractBetween(html, '<div id="info"', "</div>");
    const infoLines = infoHtml
      .split(/<br\s*\/?>/)
      .map((l) => cleanHtml(l))
      .filter(Boolean);
    for (const line of infoLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line
        .substring(0, colonIdx)
        .trim()
        .replace(/^.*>\s*/, "");
      const value = line.substring(colonIdx + 1).trim();
      if (field && value && !field.includes("class=")) detail[field] = value;
    }
    // Content intro
    const introMatch =
      html.match(/<span\s+property="v:summary"[^>]*>([\s\S]*?)<\/span>/) ??
      html.match(/<span\s+class="all"[^>]*>([\s\S]*?)<\/span>/) ??
      html.match(/<div\s+class="intro"[^>]*>([\s\S]*?)<\/div>/);
    if (introMatch) detail.content_intro = cleanHtml(introMatch[1]);
    const songMatches = html.match(/<div\s+class="song-items-wrapper"[\s\S]*?<\/div>/);
    if (songMatches) {
      const songNames = songMatches[0].match(/<span\s+class="song-name"[^>]*>([^<]+)<\/span>/g);
      if (songNames) detail.songs = songNames.map((m) => cleanHtml(m)).filter(Boolean);
    }
    if (!detail.title && !detail.rating) throw new Error("Detail page produced no usable content");
    return {
      status: true,
      msg: "获取成功",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data: detail,
    };
  } catch (error) {
    return {
      status: false,
      msg: error instanceof Error ? error.message : "获取失败",
      time: `${((Date.now() - t0) / 1000).toFixed(3)}s`,
      data: null,
    };
  }
}

export function allowedImage(raw: string): URL | null {
  try {
    const url = new URL(raw);
    // 网易云 API 返回的封面常是 http://，白名单主机统一升级到 https 再取
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443" && url.port !== "80")
    )
      return null;
    if (
      !/^(?:img\d+\.doubanio\.com|m\.media-amazon\.com|ia\.media-imdb\.com|image\.tmdb\.org|[\w-]+\.music\.126\.net|(?:upload|thumb)\.wikimedia\.org|bkimg\.cdn\.bcebos\.com)$/.test(
        url.hostname,
      )
    )
      return null;
    url.protocol = "https:";
    return url;
  } catch {
    return null;
  }
}

export async function proxyImage(raw: string): Promise<Response> {
  const url = allowedImage(raw);
  if (!url) return new Response(null, { status: 400 });
  try {
    const response = await upstream(url.href);
    const type = response.headers.get("content-type") ?? "";
    // 网易云 126.net 返回非标准的 image/jpg
    if (!/^image\/(jpe?g|png|webp|avif)(;|$)/i.test(type))
      return new Response(null, { status: 415 });
    return new Response(response.body, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
