import type { Env } from "./index";
import { loadProviderCookie } from "./netease";
import type { ImportedWork } from "./import";

// ===== 豆瓣「我的 / 清单」导入：三类链接统一入口 =====
// 1) m.douban.com/subject_collection/<ID>  → rexxar JSON（公开，无需登录）
// 2) {movie|book}.douban.com/mine?status=wish|collect → 个人想看/已看，需登录 Cookie
// 3) www.douban.com/doulist/<ID>           → 交由 import.ts 的 fetchDoulist

const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type DoubanListKind = "subject_collection" | "mine" | "doulist" | "unknown";

export interface DoubanListTarget { kind: DoubanListKind; id: string; status?: "wish" | "collect" | "doing"; media?: "movie" | "book" }

/** 识别链接类型并抽取关键参数 */
export function classifyDoubanList(raw: string): DoubanListTarget {
  const trimmed = raw.trim();
  const sc = trimmed.match(/subject_collection\/([A-Za-z0-9]+)/);
  if (sc) return { kind: "subject_collection", id: sc[1] };
  const mine = trimmed.match(/(movie|book)\.douban\.com\/mine/i);
  if (mine) {
    const media = mine[1].toLowerCase() as "movie" | "book";
    const statusMatch = trimmed.match(/status=(\w+)/);
    const status = (statusMatch?.[1] === "collect" ? "collect" : statusMatch?.[1] === "doing" ? "doing" : "wish") as DoubanListTarget["status"];
    return { kind: "mine", id: media, media, status };
  }
  const doulist = trimmed.match(/doulist\/(\d+)/);
  if (doulist) return { kind: "doulist", id: doulist[1] };
  return { kind: "unknown", id: "" };
}

function typeToKind(t: string | undefined): ImportedWork["type"] | undefined {
  if (t === "movie") return "movie";
  if (t === "book") return "book";
  if (t === "music") return "music";
  return undefined;
}

/** 从 rexxar subject_collection_items 的一项映射为作品 */
interface ScItem { id?: string; title?: string; info?: string; card_subtitle?: string; year?: string; type?: string; url?: string; cover?: { large?: string; normal?: string }; pic?: { large?: string } }
function scItemToWork(item: ScItem): ImportedWork | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;
  // info 形如「黄晓丹/上海三联书店/2024-11」或「王家卫 / 2000 / ...」，取首段为创作者
  const infoParts = (item.info || item.card_subtitle || "").split("/").map((s) => s.trim()).filter(Boolean);
  const creator = infoParts[0] || undefined;
  const year = (item.year ?? "").match(/\d{4}/)?.[0] ?? infoParts.find((p) => /^\d{4}/.test(p))?.slice(0, 4);
  const poster = item.cover?.large || item.cover?.normal || item.pic?.large;
  return {
    id: `douban-${item.type ?? "s"}-${item.id}`,
    title,
    ...(creator ? { creator } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(poster ? { poster_url: poster } : {}),
    type: typeToKind(item.type),
  };
}

/** 抓取豆瓣书影音清单（rexxar API，公开） */
export async function fetchSubjectCollection(collectionId: string): Promise<ImportedWork[]> {
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < 500; start += 100) {
    const response = await fetch(`https://m.douban.com/rexxar/api/v2/subject_collection/${encodeURIComponent(collectionId)}/items?type=S&start=${start}&count=100`, {
      headers: { "user-agent": MOBILE_UA, "referer": `https://m.douban.com/subject_collection/${collectionId}`, "accept": "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) break;
    const data = await response.json() as { subject_collection_items?: ScItem[]; total?: number };
    const items = data.subject_collection_items ?? [];
    if (!items.length) break;
    for (const item of items) {
      const work = scItemToWork(item);
      if (work && !seen.has(work.id)) { seen.add(work.id); works.push(work); }
    }
    if (items.length < 100) break;
  }
  return works.slice(0, 300);
}

interface MineItem { title: string; url: string; poster?: string; abstract?: string; rating?: string }

/** 解析「我的」页一页（item-root 卡片结构） */
async function parseMinePage(url: string, cookie: string): Promise<MineItem[]> {
  const response = await fetch(url, {
    headers: { "user-agent": DESKTOP_UA, "accept": "text/html,application/xhtml+xml", "accept-language": "zh-CN,zh;q=0.9", referer: "https://www.douban.com/", cookie },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`douban_mine_http_${response.status}`);
  const items: MineItem[] = [];
  let current: MineItem | null = null;
  const finish = () => {
    if (current && current.title.trim() && current.url) items.push({ ...current, title: current.title.trim() });
    current = null;
  };
  const rewritten = new HTMLRewriter()
    .on("div.item-root", { element() { finish(); current = { title: "", url: "" }; } })
    .on("div.item-root .title a, div.item-root .info a[href*='/subject/']", {
      element(el) { if (current && !current.url) current.url = el.getAttribute("href") ?? ""; },
      text(chunk) { if (current && !current.title) current.title += chunk.text; },
    })
    .on("div.item-root .poster img, div.item-root .nbg img", { element(el) { if (current && !current.poster) current.poster = (el.getAttribute("src") || el.getAttribute("data-src")) ?? undefined; } })
    .on("div.item-root .abstract, div.item-root .desc", { text(chunk) { if (current) current.abstract = (current.abstract ?? "") + chunk.text; } })
    .on("div.item-root", { element(el) { el.onEndTag(finish); } })
    .transform(response);
  await rewritten.text();
  return items;
}

function mineItemToWork(item: MineItem, media: "movie" | "book"): ImportedWork | null {
  const subjectId = item.url.match(/subject\/(\d+)/)?.[1];
  if (!subjectId || !item.title) return null;
  const abstract = item.abstract ?? "";
  const year = abstract.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
  // 电影 abstract：「导演: xxx / 主演: … / 国家 / 年份」；书籍：「作者 / 出版社 / 年份」
  const creatorLine = abstract.split("/").map((s) => s.trim()).find((s) => /导演|作者|主演|著/.test(s) || (s && !/^\d{4}/.test(s)));
  const creator = creatorLine?.replace(/^(导演|作者|主演|著)\s*[:：]\s*/, "").trim().split(/\s/)[0] || undefined;
  return {
    id: `douban-${media === "movie" ? "m" : "b"}-${subjectId}`,
    title: item.title,
    ...(creator ? { creator } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(item.poster ? { poster_url: item.poster } : {}),
    type: media === "movie" ? "movie" : "book",
  };
}

/** 抓取「我的」想看/已看（分页，需登录 Cookie） */
export async function fetchDoubanMine(media: "movie" | "book", status: NonNullable<DoubanListTarget["status"]>, cookie: string): Promise<ImportedWork[]> {
  const host = media === "movie" ? "movie.douban.com" : "book.douban.com";
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < 300; start += 30) {
    const url = `https://${host}/mine?status=${status}&sort=time&tag_status=%E5%85%A8%E9%83%A8&page_limit=30&page_start=${start}`;
    const items = await parseMinePage(url, cookie).catch(() => [] as MineItem[]);
    if (!items.length) break;
    for (const item of items) {
      const work = mineItemToWork(item, media);
      if (work && !seen.has(work.id)) { seen.add(work.id); works.push(work); }
    }
    if (items.length < 30) break;
  }
  return works.slice(0, 300);
}

/** 统一入口：识别类型 → 抓取。doulist 由调用方处理（需要 fetchDoulist）。 */
export async function fetchDoubanList(target: DoubanListTarget, cookie: string | null): Promise<{ works: ImportedWork[]; error?: string }> {
  if (target.kind === "subject_collection") {
    const works = await fetchSubjectCollection(target.id);
    return { works };
  }
  if (target.kind === "mine") {
    if (!cookie) return { works: [], error: "not_connected" };
    const works = await fetchDoubanMine(target.media ?? "movie", target.status ?? "wish", cookie);
    return { works };
  }
  return { works: [], error: "unknown" };
}

/** 供 import.ts 路由使用：读取用户豆瓣连接状态 */
export async function doubanCookieFor(env: Env, userId: number): Promise<string | null> {
  return loadProviderCookie(env, userId, "douban");
}
