import curatedPosters from "./imdb-posters.json";

export interface DoubanWork { id: string; title: string; year?: number; poster_url?: string }
const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", referer: "https://movie.douban.com/" };
const posterIndex = new Map<string, string>();
let indexPromise: Promise<void> | undefined;
let indexExpires = 0;
const key = (value: string) => value.normalize("NFKC").trim().toLowerCase();

async function upstream(url: string): Promise<Response> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return response;
}

async function topPage(start: number): Promise<DoubanWork[]> {
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
}

export async function doubanTop250(limit: number): Promise<DoubanWork[]> {
  const works: DoubanWork[] = [];
  for (let start = 0; start < limit; start += 25) works.push(...await topPage(start));
  return [...new Map(works.map((work) => [work.id, work])).values()].slice(0, limit);
}

export async function doubanSuggest(query: string): Promise<DoubanWork[]> {
  const response = await upstream(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid upstream response");
  return data.filter((item) => item && typeof item === "object" && (item.type === "movie" || item.type === undefined) && typeof item.title === "string")
    .slice(0, 8).map((item) => ({ id: `douban-${item.id}`, title: item.title, ...(Number.isInteger(Number(item.year)) && Number(item.year) > 0 ? { year: Number(item.year) } : {}), ...(typeof item.img === "string" ? { poster_url: item.img } : {}) }));
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
  const known = (curatedPosters as Record<string, { query: string; id: string }>)[title];
  const query = known?.query ?? english.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!query) return;
  const response = await upstream(`https://v3.sg.media-imdb.com/suggestion/${query[0]}/${encodeURIComponent(query)}.json`);
  const data = await response.json() as { d?: Array<{ id?: string; l?: string; y?: number; i?: { imageUrl?: string } }> };
  const item = data.d?.find((entry) => known ? entry.id === known.id : entry.id?.startsWith("tt") && key(entry.l ?? "") === key(english) && (!year || entry.y === year));
  return item?.i?.imageUrl;
}

export async function resolvePosters(title: string, english: string, year?: number) {
  const [suggestion, imdb] = await Promise.allSettled([doubanSuggest(title), imdbPoster(title, english, year)]);
  const suggested = suggestion.status === "fulfilled" ? suggestion.value.find((item) => key(item.title) === key(title) && (!year || !item.year || item.year === year))?.poster_url : undefined;
  if (!suggested && !posterIndex.has(key(title))) await ensureIndex();
  return [...new Set([
    ...(suggested ? doubanVariants(suggested) : []),
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
