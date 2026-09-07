import curatedPosters from "./imdb-posters.json";

export interface DoubanWork { id: string; title: string; year?: number; poster_url?: string; type?: "movie" | "book" | "music" }
const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", referer: "https://movie.douban.com/" };
const bookHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", referer: "https://book.douban.com/" };
const musicHeaders = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", referer: "https://music.douban.com/" };
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

async function upstream(url: string): Promise<Response> {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const isDouban = host.endsWith("douban.com") || host.endsWith("doubanio.com");
  const isBook = host.startsWith("book.douban") || url.includes("book.douban");
  const isMusic = host.startsWith("music.douban") || url.includes("music.douban");
  const isImage = /\.(jpg|jpeg|png|webp|avif)$/i.test(parsed.pathname);
  const requestHeaders: Record<string, string> = isDouban
    ? { ...(isBook ? bookHeaders : isMusic ? musicHeaders : headers), "Accept": isImage ? "image/webp,image/apng,image/*,*/*;q=0.8" : "application/json, text/plain, */*" }
    : { "user-agent": headers["user-agent"], "accept": "*/*" };
  const response = await fetch(url, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(10000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return response;
}

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
    const referer = type === "movie" ? "https://movie.douban.com/" : type === "book" ? "https://book.douban.com/" : "https://music.douban.com/";
    const response = await fetch(`https://search.douban.com/${type}/subject_search?search_text=${encodeURIComponent(query)}&cat=${cat}`, {
      headers: { "user-agent": headers["user-agent"], referer, "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });
    if (!response.ok) return undefined;
    const html = await response.text();
    const match = html.match(/window\.__DATA__\s*=\s*(\{.+?\})\s*;/);
    if (!match) return;
    const data = JSON.parse(match[1]) as { items?: Array<{ title?: string; cover_url?: string }> };
    const item = data.items?.find((entry) => entry.cover_url && entry.title && key(entry.title).includes(key(query)));
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
