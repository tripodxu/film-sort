import curatedPosters from "./imdb-posters.json";

export interface DoubanWork { id: string; title: string; year?: number; poster_url?: string; type?: "movie" | "book" | "music" }

// Rotate User-Agent to avoid rate limiting - simulate Edge browser
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
];
let uaIndex = 0;
function nextUA(): string { return USER_AGENTS[uaIndex++ % USER_AGENTS.length]; }

// Rate limiting: track cooldown per domain
const lastRequestTime = new Map<string, number>();
const MIN_DELAY_MS = 800;
const cooldownMap = new Map<string, number>();

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function throttle(domain: string): Promise<void> {
  const now = Date.now();
  // Per-domain cooldown
  const cooldown = cooldownMap.get(domain) ?? 0;
  if (now < cooldown) {
    await new Promise(r => setTimeout(r, cooldown - now));
  }
  // Per-domain delay
  const last = lastRequestTime.get(domain) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_DELAY_MS) {
    await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  }
  lastRequestTime.set(domain, Date.now());
}

// Request headers per domain type
function buildHeaders(url: string, isImage: boolean): Record<string, string> {
  const ua = nextUA();
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isBook = host.startsWith("book.douban") || url.includes("book.douban");
  const isMusic = host.startsWith("music.douban") || url.includes("music.douban");
  const referer = isBook ? "https://book.douban.com/" : isMusic ? "https://music.douban.com/" : "https://movie.douban.com/";
  return {
    "user-agent": ua,
    "referer": referer,
    "accept": isImage ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,image/svg+xml,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "accept-encoding": "gzip, deflate, br, zstd",
    "connection": "keep-alive",
    "cache-control": "max-age=0",
    "sec-ch-ua": `"Chromium";v="126", "Microsoft Edge";v="126", "Not-A.Brand";v="8"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    "sec-fetch-dest": isImage ? "image" : "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "cookie": `bid=${Math.random().toString(36).slice(2, 13)}`,
  };
}

async function upstream(url: string, retries = 2): Promise<Response> {
  const domain = getDomain(url);
  const isDouban = domain.endsWith("douban.com") || domain.endsWith("doubanio.com");
  const isImage = /\.(jpg|jpeg|png|webp|avif)$/i.test(new URL(url).pathname);
  const requestHeaders = isDouban ? buildHeaders(url, isImage) : { "user-agent": nextUA(), "accept": "*/*" };

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (isDouban) await throttle(domain);
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
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
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
      .on("tr.item", { element() { current = { id: "", title: "", metadata: "" }; titleSeen = false; } })
      .on("tr.item td:first-child a", { element(element) { current.id = element.getAttribute("href")?.match(/subject\/(\d+)/)?.[1] ?? ""; } })
      .on("tr.item td:first-child img", { element(element) { current.poster_url = element.getAttribute("src") ?? undefined; } })
      .on("tr.item div.pl2 a", { element() { if (current.title) titleSeen = true; }, text(chunk) { if (!titleSeen) current.title += chunk.text; } })
      .on("tr.item p.pl", { text(chunk) { current.metadata += chunk.text; } })
      .on("tr.item", { element(element) { element.onEndTag(() => {
        const title = current.title.trim().split("\n")[0].trim();
        const year = current.metadata.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
        if (title && current.id) {
          const work = { id: `douban-book-${current.id}`, title, type: "book" as const, ...(year ? { year: Number(year) } : {}), ...(current.poster_url ? { poster_url: current.poster_url } : {}) };
          works.push(work);
          if (work.poster_url) bookPosterIndex.set(key(title), work.poster_url);
        }
      }); } }).transform(response);
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
  const works = pages.flatMap((page) => page.status === "fulfilled" ? page.value : []);
  if (works.length < 2) throw new Error("Douban returned no usable entries");
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

export async function doubanBookSuggest(query: string): Promise<DoubanWork[]> {
  try {
    const response = await upstream(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`);
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
          ? { year: Number(item.year) } : {}),
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
    bookIndexPromise = doubanBookTop250(250).then(() => undefined).catch(() => undefined);
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
      .on("tr.item", { element() { current = { id: "", title: "", metadata: "" }; titleSeen = false; } })
      .on("tr.item td:first-child a", { element(element) { current.id = element.getAttribute("href")?.match(/subject\/(\d+)/)?.[1] ?? ""; } })
      .on("tr.item td:first-child img", { element(element) { current.poster_url = element.getAttribute("src") ?? undefined; } })
      .on("tr.item div.pl2 a", { element(element) {
        if (current.title) titleSeen = true;
        // Use title attribute if available (format: "artist - album")
        const titleAttr = element.getAttribute("title");
        if (titleAttr && !current.title) {
          // Extract album name from "artist - album" format
          const parts = titleAttr.split(" - ");
          current.title = parts.length > 1 ? parts.slice(1).join(" - ").trim() : titleAttr.trim();
          titleSeen = true;
        }
      }, text(chunk) { if (!titleSeen) current.title += chunk.text; } })
      .on("tr.item p.pl", { text(chunk) { current.metadata += chunk.text; } })
      .on("tr.item", { element(element) { element.onEndTag(() => {
        const title = current.title.trim().split("\n")[0].trim();
        if (title && current.id) {
          const work = { id: `douban-music-${current.id}`, title, type: "music" as const, ...(current.poster_url ? { poster_url: current.poster_url } : {}) };
          works.push(work);
          if (work.poster_url) musicPosterIndex.set(key(title), work.poster_url);
        }
      }); } }).transform(response);
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
  const works = pages.flatMap((page) => page.status === "fulfilled" ? page.value : []);
  if (works.length < 2) throw new Error("Douban returned no usable entries");
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

async function ensureMusicIndex() {
  if (!musicIndexPromise || Date.now() > musicIndexExpires) {
    musicIndexExpires = Date.now() + 15 * 60 * 1000;
    musicIndexPromise = doubanMusicTop250(250).then(() => undefined).catch(() => undefined);
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
      .on("div.item", { element() { current = { id: "", title: "", metadata: "" }; titleSeen = false; } })
      .on("div.item .hd a", { element(element) { current.id = element.getAttribute("href")?.match(/subject\/(\d+)/)?.[1] ?? ""; } })
      .on("div.item .title", { element() { if (current.title) titleSeen = true; }, text(chunk) { if (!titleSeen) current.title += chunk.text; } })
      .on("div.item .pic img", { element(element) { current.poster_url = element.getAttribute("src") ?? element.getAttribute("data-src") ?? undefined; } })
      .on("div.item .bd p", { text(chunk) { current.metadata += chunk.text; } })
      .on("div.item", { element(element) { element.onEndTag(() => {
        const title = current.title.trim();
        const year = current.metadata.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
        if (title && current.id) {
          const work = { id: `douban-${current.id}`, title, ...(year ? { year: Number(year) } : {}), ...(current.poster_url ? { poster_url: current.poster_url } : {}) };
          works.push(work);
          if (work.poster_url) posterIndex.set(key(title), work.poster_url);
        }
      }); } }).transform(response);
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
  const works = pages.flatMap((page) => page.status === "fulfilled" ? page.value : []);
  if (works.length < 2) throw new Error("Douban returned no usable entries");
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

// ===== Wikipedia & Baidu Baike for content_intro =====

const TYPE_HINTS: Record<string, string[]> = {
  movie: ["电影", "film", "影片"],
  book: ["小说", "novel", "书籍"],
  music: ["专辑", "album", "音乐专辑"],
};

// 从 titles 列表取摘要，返回第一个有效结果
async function fetchExtracts(titles: string[], lang: "zh" | "en", timeoutMs: number): Promise<{ intro: string; source: string } | null> {
  const params = new URLSearchParams({
    action: "query", titles: titles.join("|"),
    prop: "extracts", exintro: "true", explaintext: "true", exlimit: "5", redirects: "1", format: "json",
  });
  const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
    headers: { "user-agent": USER_AGENTS[0], "accept": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) return null;
  const d = await r.json() as { query?: { pages?: Record<string, { extract?: string; missing?: boolean }> } };
  if (!d.query?.pages) return null;
  for (const p of Object.values(d.query.pages)) {
    if (p.extract && !p.missing && p.extract.length > 30) return { intro: p.extract, source: `${lang}wiki` };
  }
  return null;
}

async function fetchWikipedia(titles: string[], lang: "zh" | "en" = "zh", timeoutMs = 8000, mediaType?: "movie" | "book" | "music", direct = false): Promise<{ intro: string; source: string } | null> {
  try {
    const hint = mediaType ? TYPE_HINTS[mediaType]?.[0] : undefined;

    if (!direct) {
      // Phase 1: titles 直查（消歧义页无摘要时跳过）
      const r1 = await fetchExtracts(titles, lang, timeoutMs);
      if (r1) return r1;

      // Phase 2: "标题 类型" 搜索（如 "龙猫 电影"、"三体 小说"）
      if (hint) {
        const qualified = titles[0] + " " + hint;
        const params = new URLSearchParams({
          action: "query", list: "search", srsearch: qualified,
          srnamespace: "0", srlimit: "5", redirects: "1", format: "json",
        });
        const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
          headers: { "user-agent": USER_AGENTS[0], "accept": "application/json" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (r.ok) {
          const d = await r.json() as { query?: { search?: { title: string }[] } };
          const st = d.query?.search?.map((s) => s.title).filter(Boolean) ?? [];
          if (st.length > 0) {
            const result = await fetchExtracts(st, lang, timeoutMs);
            if (result) return result;
          }
        }
      }
    }

    // Phase 3: generator=search + prop=extracts 一步到位
    const searchQuery = titles[0];
    const searchWords = searchQuery.split(/\s+/).filter(Boolean);
    const params3 = new URLSearchParams({
      action: "query", generator: "search", gsrsearch: searchQuery,
      gsrnamespace: "0", gsrlimit: "5", redirects: "1",
      prop: "extracts", exintro: "true", explaintext: "true", exlimit: "5", format: "json",
    });
    const r3 = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params3}`, {
      headers: { "user-agent": USER_AGENTS[0], "accept": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r3.ok) {
      const d3 = await r3.json() as { query?: { pages?: Record<string, { title?: string; extract?: string; missing?: boolean }> } };
      if (d3.query?.pages) {
        const pages = Object.values(d3.query.pages).filter((p) => !p.missing && p.extract && p.extract.length > 30);
        // 多词搜索时，验证摘要包含所有搜索词
        const valid = searchWords.length > 1
          ? pages.filter((p) => {
              const text = ((p.title ?? "") + " " + p.extract!).toLowerCase();
              return searchWords.every((w) => text.includes(w.toLowerCase()));
            })
          : pages;
        if (valid.length > 0) return { intro: valid[0].extract!, source: `${lang}wiki` };
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchBaiduBaike(query: string): Promise<{ intro: string; source: string } | null> {
  try {
    const url = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379029&bk_key=${encodeURIComponent(query)}&bk_length=600`;
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENTS[0], "accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { abstract?: string };
    if (data.abstract && data.abstract.length > 30) {
      return { intro: data.abstract, source: "baike" };
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchContentIntro(title: string, mediaType?: "movie" | "book" | "music", creator?: string): Promise<{ intro: string; source: string } | null> {
  // 构建候选标题列表（含消歧义提示）
  const candidates = [title];
  if (mediaType === "book") candidates.push(`${title} (小说)`, `${title} (书籍)`);
  if (mediaType === "music") candidates.push(`${title} (专辑)`, `${title} (专辑名)`);

  // 并行请求中英文维基，传入类型限定词减少歧义
  const [zhResult, enResult] = await Promise.allSettled([
    fetchWikipedia(candidates, "zh", 8000, mediaType),
    fetchWikipedia(candidates, "en", 6000, mediaType),
  ]);

  const zh = zhResult.status === "fulfilled" ? zhResult.value : null;
  const en = enResult.status === "fulfilled" ? enResult.value : null;

  // 优先中文
  if (zh) return zh;
  if (en) return en;

  // 创作者 + 标题组合搜索（如 "三体 刘慈欣"、"范特西 周杰伦"）
  if (creator) {
    const creatorCandidates = [`${title} ${creator}`];
    const [zh2, en2] = await Promise.allSettled([
      fetchWikipedia(creatorCandidates, "zh", 8000, mediaType, true),
      fetchWikipedia(creatorCandidates, "en", 6000, mediaType, true),
    ]);
    const zhR = zh2.status === "fulfilled" ? zh2.value : null;
    const enR = en2.status === "fulfilled" ? en2.value : null;
    if (zhR) return zhR;
    if (enR) return enR;
  }

  // 百度百科兜底
  try {
    const baike = await fetchBaiduBaike(title);
    if (baike) return baike;
  } catch (e) {
    console.error(`baike failed for "${title}":`, e instanceof Error ? e.message : e);
  }
  return null;
}

export async function doubanSuggest(query: string): Promise<DoubanWork[]> {
  try {
    const response = await upstream(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`);
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
    }
    if (!Array.isArray(data)) throw new Error("Invalid upstream response");
    return data
      .filter((item) => item && typeof item === "object" && 
        (item.type === "movie" || item.type === undefined) && 
        typeof item.title === "string")
      .slice(0, 8)
      .map((item) => ({
        id: `douban-${item.id}`,
        title: item.title,
        ...(Number.isInteger(Number(item.year)) && Number(item.year) > 0 
          ? { year: Number(item.year) } : {}),
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
    indexPromise = doubanTop250(250).then(() => undefined).catch(() => undefined);
  }
  await indexPromise;
}

function doubanVariants(url: string): string[] {
  try {
    const parsed = new URL(url);
    if (!/^img\d+\.doubanio\.com$/.test(parsed.hostname)) return [];
    parsed.protocol = "https:";
    const original = parsed.href.replace(/\/s_ratio_poster\//, "/l/");
    return [...new Set([original, parsed.href, ...[1, 2, 3, 9].map((host) => original.replace(/img\d+\.doubanio/, `img${host}.doubanio`))])];
  } catch { return []; }
}

async function imdbPoster(title: string, english: string, year?: number): Promise<string | undefined> {
  try {
    const known = (curatedPosters as Record<string, { query: string; id: string }>)[title];
    const query = known?.query ?? english.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!query) return;
    const response = await upstream(`https://v3.sg.media-imdb.com/suggestion/${query[0]}/${encodeURIComponent(query)}.json`);
    const data = await response.json() as { d?: Array<{ id?: string; l?: string; y?: number; i?: { imageUrl?: string } }> };
    const item = data.d?.find((entry) => known 
      ? entry.id === known.id 
      : entry.id?.startsWith("tt") && key(entry.l ?? "") === key(english) && (!year || entry.y === year));
    return item?.i?.imageUrl;
  } catch (error) {
    console.error("imdbPoster failed:", error);
    return undefined;
  }
}

async function searchCover(query: string, type: "movie" | "book" | "music"): Promise<string | undefined> {
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
      cooldownMap.set("search.douban.com", Date.now() + 10000);
      console.warn(`searchCover rate limited (${response.status})`);
      return undefined;
    }
    if (!response.ok) return undefined;
    const html = await response.text();
    const startMarker = 'window.__DATA__ = ';
    const startIdx = html.indexOf(startMarker);
    if (startIdx === -1) return undefined;
    const jsonStart = startIdx + startMarker.length;
    const jsonMatch = html.substring(jsonStart).match(/^\{[\s\S]*?\}(?=\s*;\s*(?:window|<\/script))/);
    if (!jsonMatch) return undefined;
    const data = JSON.parse(jsonMatch[0]) as { items?: Array<{ title?: string; cover_url?: string }> };
    if (!data.items?.length) return undefined;
    const queryKey = key(query);
    const item = data.items.find((entry) => entry.cover_url && entry.title && key(entry.title).includes(queryKey));
    return item?.cover_url;
  } catch (error) {
    console.error(`searchCover(${query}, ${type}) failed:`, error);
    return undefined;
  }
}

export async function resolvePosters(title: string, english: string, year?: number, type?: "movie" | "book" | "music") {
  if (type === "book") {
    const [suggestion, search] = await Promise.allSettled([doubanBookSuggest(title), searchCover(title, "book")]);
    const suggested = suggestion.status === "fulfilled" ? suggestion.value.find((item) => key(item.title) === key(title))?.poster_url : undefined;
    const searched = search.status === "fulfilled" ? search.value : undefined;
    if (!suggested && !searched && !bookPosterIndex.has(key(title))) await ensureBookIndex();
    return [...new Set([
      ...(suggested ? doubanVariants(suggested) : []),
      ...(searched ? doubanVariants(searched) : []),
      ...(bookPosterIndex.has(key(title)) ? doubanVariants(bookPosterIndex.get(key(title))!) : []),
    ])];
  }
  if (type === "music") {
    const [search] = await Promise.allSettled([searchCover(title, "music")]);
    const searched = search.status === "fulfilled" ? search.value : undefined;
    if (!searched && !musicPosterIndex.has(key(title))) await ensureMusicIndex();
    return [...new Set([
      ...(searched ? doubanVariants(searched) : []),
      ...(musicPosterIndex.has(key(title)) ? doubanVariants(musicPosterIndex.get(key(title))!) : []),
    ])];
  }
  const [suggestion, imdb, search] = await Promise.allSettled([doubanSuggest(title), imdbPoster(title, english, year), searchCover(title, "movie")]);
  const suggested = suggestion.status === "fulfilled" ? suggestion.value.find((item) => key(item.title) === key(title) && (!year || !item.year || item.year === year))?.poster_url : undefined;
  const searched = search.status === "fulfilled" ? search.value : undefined;
  if (!suggested && !searched && !posterIndex.has(key(title)) && !(imdb.status === "fulfilled" && imdb.value)) await ensureIndex();
  return [...new Set([
    ...(suggested ? doubanVariants(suggested) : []),
    ...(searched ? doubanVariants(searched) : []),
    ...(posterIndex.has(key(title)) ? doubanVariants(posterIndex.get(key(title))!) : []),
    ...(imdb.status === "fulfilled" && imdb.value ? [imdb.value] : []),
  ])];
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

async function fetchSearchList(type: "movie" | "book" | "music", query: string, page: number): Promise<SearchResult[]> {
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
  const startMarker = 'window.__DATA__ = ';
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return [];
  const jsonStart = startIdx + startMarker.length;
  // Match JSON object ending with }; before next window or </script>
  const jsonMatch = html.substring(jsonStart).match(/^\{[\s\S]*?\}(?=\s*;\s*(?:window|<\/script))/);
  if (!jsonMatch) return [];
  const data = JSON.parse(jsonMatch[0]) as { items?: SearchItem[] };
  if (!data.items?.length) return [];
  return data.items.filter(item => item.title && item.cover_url).map(item => parseSearchItem(type, item));
}

function parseSearchItem(type: "movie" | "book" | "music", item: SearchItem): SearchResult {
  const ratingObj = item.rating;
  const ratingValue = typeof ratingObj === "object" && ratingObj !== null ? String((ratingObj as Record<string, unknown>).value ?? "") : String(ratingObj ?? "");
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
  const parts = abstract.split("/").map(s => s.trim());
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
  const parts = abstract.split("/").map(s => s.trim());
  if (parts.length >= 3) {
    base.country = parts.shift();
    base.duration = parts.pop();
    base.type = parts;
  }
  const abstract2 = item.abstract_2 ?? "";
  if (abstract2) {
    base.actors = abstract2.split("/").map(s => s.trim()).filter(Boolean);
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
  const parts = abstract.split("/").map(s => s.trim());
  if (parts.length >= 2) {
    base.artist = parts[0];
    base.date = parts[1];
    if (parts[2]) base.album = parts[2];
    if (parts[3]) base.medium = parts[3];
    if (parts[4]) base.schools = parts[4];
  }
  return base;
}

export async function doubanSearch(type: "movie" | "book" | "music", query: string, page = 1): Promise<{ status: boolean; msg: string; time: string; data: SearchResult[] }> {
  const t0 = Date.now();
  try {
    // Check per-domain cooldown for search.douban.com
    const searchCooldown = cooldownMap.get("search.douban.com") ?? 0;
    if (Date.now() < searchCooldown) {
      return { status: false, msg: `豆瓣限流中，请${Math.ceil((searchCooldown - Date.now()) / 1000)}秒后重试`, time: "0s", data: [] };
    }
    const data = await fetchSearchList(type, query, page);
    return { status: true, msg: "获取成功", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data };
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

async function fetchDetailPage(url: string): Promise<{ html: string; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = { url, steps: [] as string[] };
  const steps = debug.steps as string[];
  const domain = new URL(url).hostname;
  await throttle(domain);
  steps.push(`throttle_done for ${domain}`);
  
  const headers = buildHeaders(url, false);
  steps.push(`headers built: UA=${headers["user-agent"]?.slice(0,40)}...`);
  
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  
  debug.http_status = response.status;
  debug.response_url = response.url;
  debug.content_type = response.headers.get("content-type");
  steps.push(`fetch done: status=${response.status}, url=${response.url?.slice(0,80)}`);
  
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
  
  // Check if we got redirected to anti-bot page
  if (response.url?.includes("sec.douban.com")) {
    steps.push("redirected to sec.douban.com (anti-bot)");
    debug.blocked = true;
  }
  
  return { html, debug };
}

function extractText(html: string, startMarker: string, endMarker: string): string {
  const idx = html.indexOf(startMarker);
  if (idx === -1) return "";
  const start = idx + startMarker.length;
  const end = html.indexOf(endMarker, start);
  if (end === -1) return html.substring(start, start + 500);
  return html.substring(start, end);
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
  return text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();
}

export async function doubanBookDetail(url: string): Promise<{ status: boolean; msg: string; time: string; data: BookDetail | null }> {
  const t0 = Date.now();
  try {
    if (!url.includes("book.douban.com/subject/")) throw new Error("Invalid book URL");
    const bookCooldown = cooldownMap.get("book.douban.com") ?? 0;
    if (Date.now() < bookCooldown) return { status: false, msg: `豆瓣限流中，请${Math.ceil((bookCooldown - Date.now()) / 1000)}秒后重试`, time: "0s", data: null };
    const { html } = await fetchDetailPage(url);
    const detail: BookDetail = { title: "", pic: "", rating: "" };
    // Title
    const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([^<]+)<\/span>/);
    detail.title = titleMatch ? cleanHtml(titleMatch[1]) : extractBetween(html, "<title>", "</title>").split("(")[0].trim();
    // Pic
    const picMatch = html.match(/<div\s+id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/);
    detail.pic = picMatch ? picMatch[1] : "";
    // Rating
    const ratingMatch = html.match(/<strong[^>]+property="v:average"[^>]*>([^<]+)<\/strong>/);
    detail.rating = ratingMatch ? ratingMatch[1].trim() : "";
    // Info block
    const infoHtml = extractBetween(html, '<div id="info"', '</div>');
    const infoLines = infoHtml.split(/<br\s*\/?>/).map(l => cleanHtml(l)).filter(Boolean);
    for (const line of infoLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.substring(0, colonIdx).trim().replace(/^.*>\s*/, "");
      const value = line.substring(colonIdx + 1).trim();
      if (field && value && !field.includes("class=")) detail[field] = value;
    }
    // Content intro
    const introMatch = html.match(/<div\s+class="intro"[^>]*>([\s\S]*?)<\/div>/);
    if (introMatch) detail.content_intro = cleanHtml(introMatch[1]);
    // Author intro
    const authorIntroMatch = html.match(/<div\s+class="indent"[^>]*id="link-report"[\s\S]*?<div\s+class="intro"[^>]*>([\s\S]*?)<\/div>/);
    if (authorIntroMatch) detail.author_intro = cleanHtml(authorIntroMatch[1]);
    // Tags
    const tagMatches = html.match(/<a\s+href="[^"]*tag[^"]*"[^>]*>([^<]+)<\/a>/g);
    if (tagMatches) detail.tags = tagMatches.map(m => cleanHtml(m)).filter(Boolean);
    // Directories
    const dirMatch = html.match(/<div\s+class="indent"[^>]*id="dir_[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (dirMatch) {
      const dirText = cleanHtml(dirMatch[1]);
      detail.dirs = dirText.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    }
    return { status: true, msg: "获取成功", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: detail };
  } catch (error) {
    console.error(`doubanBookDetail failed:`, error);
    return { status: false, msg: "获取失败", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: null };
  }
}

export async function doubanMovieDetail(url: string): Promise<{ status: boolean; msg: string; time: string; data: MovieDetail | null; debug?: Record<string, unknown> }> {
  const t0 = Date.now();
  try {
    if (!url.includes("movie.douban.com/subject/")) throw new Error("Invalid movie URL");
    const movieCooldown = cooldownMap.get("movie.douban.com") ?? 0;
    if (Date.now() < movieCooldown) return { status: false, msg: `豆瓣限流中，请${Math.ceil((movieCooldown - Date.now()) / 1000)}秒后重试`, time: "0s", data: null };
    const { html, debug } = await fetchDetailPage(url);
    const detail: MovieDetail = { title: "", pic: "", rating: "" };
    const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([^<]+)<\/span>/);
    detail.title = titleMatch ? cleanHtml(titleMatch[1]) : extractBetween(html, "<title>", "</title>").split("(")[0].trim();
    debug.found_title = !!titleMatch;
    const picMatch = html.match(/<div\s+id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/);
    detail.pic = picMatch ? picMatch[1] : "";
    debug.found_pic = !!picMatch;
    const ratingMatch = html.match(/<strong[^>]+property="v:average"[^>]*>([^<]+)<\/strong>/);
    detail.rating = ratingMatch ? ratingMatch[1].trim() : "";
    debug.found_rating = !!ratingMatch;
    const infoHtml = extractBetween(html, '<div id="info"', '</div>');
    const infoLines = infoHtml.split(/<br\s*\/?>/).map(l => cleanHtml(l)).filter(Boolean);
    for (const line of infoLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.substring(0, colonIdx).trim().replace(/^.*>\s*/, "");
      const value = line.substring(colonIdx + 1).trim();
      if (field && value && !field.includes("class=")) detail[field] = value;
    }
    debug.found_info = infoLines.length > 0;
    const introMatch = html.match(/<span\s+property="v:summary"[^>]*>([\s\S]*?)<\/span>/);
    if (introMatch) detail.content_intro = cleanHtml(introMatch[1]);
    debug.found_intro = !!introMatch;
    const actorMatches = html.match(/<a\s+href="[^"]*celebrity[^"]*"[^>]*>([^<]+)<\/a>/g);
    if (actorMatches) detail.acting_staff = actorMatches.slice(0, 10).map(m => cleanHtml(m)).filter(Boolean);
    const imgMatches = html.match(/<img[^>]+src="(https:\/\/img\d+\.doubanio\.com\/view\/photo\/[^"]+)"/g);
    if (imgMatches) detail.imgs = [...new Set(imgMatches.map(m => m.match(/src="([^"]+)"/)?.[1] ?? "").filter(Boolean))].slice(0, 6);
    return { status: true, msg: "获取成功", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: detail, debug };
  } catch (error) {
    return { status: false, msg: error instanceof Error ? error.message : "获取失败", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: null };
  }
}

export async function doubanMusicDetail(url: string): Promise<{ status: boolean; msg: string; time: string; data: MusicDetail | null }> {
  const t0 = Date.now();
  try {
    if (!url.includes("music.douban.com/subject/")) throw new Error("Invalid music URL");
    const musicCooldown = cooldownMap.get("music.douban.com") ?? 0;
    if (Date.now() < musicCooldown) return { status: false, msg: `豆瓣限流中，请${Math.ceil((musicCooldown - Date.now()) / 1000)}秒后重试`, time: "0s", data: null };
    const { html } = await fetchDetailPage(url);
    const detail: MusicDetail = { title: "", pic: "", rating: "" };
    const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([^<]+)<\/span>/);
    detail.title = titleMatch ? cleanHtml(titleMatch[1]) : extractBetween(html, "<title>", "</title>").split("(")[0].trim();
    const picMatch = html.match(/<div\s+id="mainpic"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/);
    detail.pic = picMatch ? picMatch[1] : "";
    const ratingMatch = html.match(/<strong[^>]+property="v:average"[^>]*>([^<]+)<\/strong>/);
    detail.rating = ratingMatch ? ratingMatch[1].trim() : "";
    // Info block
    const infoHtml = extractBetween(html, '<div id="info"', '</div>');
    const infoLines = infoHtml.split(/<br\s*\/?>/).map(l => cleanHtml(l)).filter(Boolean);
    for (const line of infoLines) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const field = line.substring(0, colonIdx).trim().replace(/^.*>\s*/, "");
      const value = line.substring(colonIdx + 1).trim();
      if (field && value && !field.includes("class=")) detail[field] = value;
    }
    // Content intro
    const introMatch = html.match(/<span\s+property="v:summary"[^>]*>([\s\S]*?)<\/span>/) ??
      html.match(/<span\s+class="all"[^>]*>([\s\S]*?)<\/span>/) ??
      html.match(/<div\s+class="intro"[^>]*>([\s\S]*?)<\/div>/);
    if (introMatch) detail.content_intro = cleanHtml(introMatch[1]);
    const songMatches = html.match(/<div\s+class="song-items-wrapper"[\s\S]*?<\/div>/);
    if (songMatches) {
      const songNames = songMatches[0].match(/<span\s+class="song-name"[^>]*>([^<]+)<\/span>/g);
      if (songNames) detail.songs = songNames.map(m => cleanHtml(m)).filter(Boolean);
    }
    return { status: true, msg: "获取成功", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: detail };
  } catch (error) {
    return { status: false, msg: error instanceof Error ? error.message : "获取失败", time: `${((Date.now() - t0) / 1000).toFixed(3)}s`, data: null };
  }
}

export function allowedImage(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return /^(?:img\d+\.doubanio\.com|m\.media-amazon\.com|ia\.media-imdb\.com|image\.tmdb\.org)$/.test(url.hostname) ? url : null;
  } catch { return null; }
}

export async function proxyImage(raw: string): Promise<Response> {
  const url = allowedImage(raw);
  if (!url) return new Response(null, { status: 400 });
  try {
    const response = await upstream(url.href);
    const type = response.headers.get("content-type") ?? "";
    if (!/^image\/(jpeg|png|webp|avif)(;|$)/i.test(type)) return new Response(null, { status: 415 });
    return new Response(response.body, { headers: { "content-type": type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  } catch { return new Response(null, { status: 502 }); }
}
