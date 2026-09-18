import type { Env } from "./index";
import { loadProviderCookie } from "./netease";
import type { ImportedWork } from "./import";

// ===== 豆瓣「我的 / 清单」导入：三类链接统一入口 =====
// 1) m.douban.com/subject_collection/<ID>  → rexxar JSON（公开，无需登录）
// 2) {movie|book}.douban.com/mine?status=wish|collect → 个人想看/已看，需登录 Cookie
// 3) www.douban.com/doulist/<ID>           → 交由 import.ts 的 fetchDoulist

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type DoubanListKind = "subject_collection" | "mine" | "doulist" | "unknown";

export interface DoubanListTarget {
  kind: DoubanListKind;
  id: string;
  status?: "wish" | "collect" | "doing";
  media?: "movie" | "book";
}

/** 识别链接类型并抽取关键参数 */
export function classifyDoubanList(raw: string): DoubanListTarget {
  const trimmed = raw.trim();
  const sc = trimmed.match(/subject_collection\/([A-Za-z0-9]+)/);
  if (sc) return { kind: "subject_collection", id: sc[1] };
  const mine = trimmed.match(/(movie|book)\.douban\.com\/mine/i);
  if (mine) {
    const media = mine[1].toLowerCase() as "movie" | "book";
    const statusMatch = trimmed.match(/status=(\w+)/);
    const status = (
      statusMatch?.[1] === "collect" ? "collect" : statusMatch?.[1] === "doing" ? "doing" : "wish"
    ) as DoubanListTarget["status"];
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
interface ScItem {
  id?: string;
  title?: string;
  info?: string;
  card_subtitle?: string;
  year?: string;
  type?: string;
  url?: string;
  cover?: { large?: string; normal?: string };
  pic?: { large?: string };
}
function scItemToWork(item: ScItem): ImportedWork | null {
  const title = (item.title ?? "").trim();
  if (!title) return null;
  // info 形如「黄晓丹/上海三联书店/2024-11」或「王家卫 / 2000 / ...」，取首段为创作者
  const infoParts = (item.info || item.card_subtitle || "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  const creator = infoParts[0] || undefined;
  const year =
    (item.year ?? "").match(/\d{4}/)?.[0] ?? infoParts.find((p) => /^\d{4}/.test(p))?.slice(0, 4);
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

/** 分页抓取统一返回：本页 works + 清单总数 total（未知为 null）+ 是否还有更多 + 下一批的绝对游标 */
export interface PagedImport {
  works: ImportedWork[];
  total: number | null;
  hasMore: boolean;
  nextOffset: number;
}

/** 抓取豆瓣书影音清单（rexxar API，公开）。支持 offset/limit 窗口，pos 游标按绝对位置推进。 */
export async function fetchSubjectCollection(
  collectionId: string,
  offset = 0,
  limit = 100,
): Promise<PagedImport> {
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  limit = Math.min(limit, 300);
  let pos = offset;
  for (let guard = 0; works.length < limit && guard < 10; guard++) {
    const response = await fetch(
      `https://m.douban.com/rexxar/api/v2/subject_collection/${encodeURIComponent(collectionId)}/items?type=S&start=${pos}&count=100`,
      {
        headers: {
          "user-agent": MOBILE_UA,
          referer: `https://m.douban.com/subject_collection/${collectionId}`,
          accept: "application/json",
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) break;
    const data = (await response.json()) as { subject_collection_items?: ScItem[]; total?: number };
    if (typeof data.total === "number") total = data.total;
    const items = data.subject_collection_items ?? [];
    if (!items.length) break;
    let consumed = 0;
    for (let i = 0; i < items.length && works.length < limit; i++) {
      consumed = i + 1;
      const work = scItemToWork(items[i]);
      if (work && !seen.has(work.id)) {
        seen.add(work.id);
        works.push(work);
      }
    }
    pos += consumed;
    if (consumed < items.length || items.length < 100) break;
  }
  const hasMore = total != null ? pos < total : works.length >= limit;
  return { works, total, hasMore, nextOffset: pos };
}

interface MineItem {
  title: string;
  url: string;
  poster?: string;
  meta?: string;
  titleAttr?: string;
}

/**
 * 解析「我的」页一页。2026 版豆瓣结构（旧 div.item-root 已不存在）：
 * - 电影 movie.douban.com/mine：div.item.comment-item → li.title a（em 中文名 / 英文名 / 别名…）、
 *   .pic a[href*=subject] + .pic img、li.intro（上映日期/演员/国家… 斜杠串，无导演标签）
 * - 书籍 book.douban.com/mine：li.subject-item → h2 a[title=书名]、.pic a + img、
 *   .pub（作者 / 出版社 / 年份 / 定价）
 * 同时从 <title>「我想看的影视(816)」解析清单总数。
 */
async function parseMinePage(
  url: string,
  cookie: string,
  media: "movie" | "book",
): Promise<{ items: MineItem[]; total: number | null }> {
  const response = await fetch(url, {
    headers: {
      "user-agent": DESKTOP_UA,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: "https://www.douban.com/",
      cookie,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`douban_mine_http_${response.status}`);
  const itemSel = media === "movie" ? "div.item.comment-item" : "li.subject-item";
  const titleSel = media === "movie" ? "div.item.comment-item li.title a" : "li.subject-item h2 a";
  const metaSel = media === "movie" ? "div.item.comment-item li.intro" : "li.subject-item .pub";
  const items: MineItem[] = [];
  let current: MineItem | null = null;
  let total: number | null = null;
  let titleText = "";
  const finish = () => {
    if (current && current.title.trim() && current.url)
      items.push({ ...current, title: current.title.trim() });
    current = null;
  };
  const rewritten = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        titleText += chunk.text;
      },
    })
    .on(itemSel, {
      element(el) {
        finish();
        current = { title: "", url: "" };
        el.onEndTag(finish);
      },
    })
    .on(`${itemSel} .pic a[href*='/subject/']`, {
      element(el) {
        if (current && !current.url) current.url = el.getAttribute("href") ?? "";
      },
    })
    .on(`${itemSel} .pic img`, {
      element(el) {
        if (current && !current.poster)
          current.poster = (el.getAttribute("src") || el.getAttribute("data-src")) ?? undefined;
      },
    })
    .on(titleSel, {
      element(el) {
        if (!current) return;
        if (!current.url) current.url = el.getAttribute("href") ?? "";
        if (!current.titleAttr) current.titleAttr = el.getAttribute("title") ?? "";
      },
      text(chunk) {
        if (current) current.title += chunk.text;
      },
    })
    .on(metaSel, {
      text(chunk) {
        if (current) current.meta = (current.meta ?? "") + chunk.text;
      },
    })
    .transform(response);
  await rewritten.text();
  const totalMatch = titleText.match(/[（(]\s*(\d+)\s*[)）]/);
  if (totalMatch) total = Number(totalMatch[1]);
  return { items, total };
}

function mineItemToWork(item: MineItem, media: "movie" | "book"): ImportedWork | null {
  const subjectId = item.url.match(/subject\/(\d+)/)?.[1];
  if (!subjectId) return null;
  const flatTitle = item.title.replace(/\s+/g, " ").trim();
  const meta = (item.meta ?? "").replace(/\s+/g, " ").trim();
  const metaParts = meta
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (media === "book") {
    // h2 a 的 title 属性是干净书名；兜底取正文 " : " 前段
    const title = (item.titleAttr || "").trim() || flatTitle.split(" : ")[0].trim();
    if (!title) return null;
    const author = metaParts.find((p) => !/^\d{4}/.test(p) && !/元$/.test(p));
    const year = meta.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[0];
    return {
      id: `douban-b-${subjectId}`,
      title,
      ...(author ? { creator: author } : {}),
      ...(year ? { year: Number(year) } : {}),
      ...(item.poster ? { poster_url: item.poster } : {}),
      type: "book",
    };
  }
  // 电影：中文名取 " / " 首段；intro 无导演标签，不强造 creator；年份取首个日期
  const title = flatTitle.split(" / ")[0].trim();
  if (!title) return null;
  const year = meta.match(/\b(1[89]\d{2}|20\d{2})\b/)?.[0];
  return {
    id: `douban-m-${subjectId}`,
    title,
    ...(year ? { year: Number(year) } : {}),
    ...(item.poster ? { poster_url: item.poster } : {}),
    type: "movie",
  };
}

/** 抓取「我的」想看/已看（需登录 Cookie）。分页参数是 start（page_start 被服务端忽略），每页 15 条；
 * offset/limit 窗口抓取，单请求最多翻 20 页（300 条），更大的量由前端分批请求。 */
export async function fetchDoubanMine(
  media: "movie" | "book",
  status: NonNullable<DoubanListTarget["status"]>,
  cookie: string,
  offset = 0,
  limit = 300,
): Promise<PagedImport> {
  const host = media === "movie" ? "movie.douban.com" : "book.douban.com";
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  limit = Math.min(limit, 300);
  let start = offset;
  for (let pages = 0; works.length < limit && pages < 20; pages++) {
    const url = `https://${host}/mine?status=${status}&sort=time&tag_status=%E5%85%A8%E9%83%A8&start=${start}`;
    const page = await parseMinePage(url, cookie, media).catch(() => ({
      items: [] as MineItem[],
      total: null,
    }));
    if (page.total != null) total = page.total;
    if (!page.items.length) break;
    let added = 0;
    for (const item of page.items) {
      if (works.length >= limit) break;
      const work = mineItemToWork(item, media);
      if (work && !seen.has(work.id)) {
        seen.add(work.id);
        works.push(work);
        added++;
      }
    }
    // 游标按本页实际条目数推进（绝对位置，解析失败的条目也计入，避免翻页漂移）
    start += page.items.length;
    if (added === 0) break;
  }
  const hasMore = total != null ? start < total : works.length >= limit;
  return { works, total, hasMore, nextOffset: start };
}

/** 统一入口：识别类型 → 抓取一页（带 offset/limit 窗口）。doulist 由调用方处理（需要 fetchDoulist）。 */
export async function fetchDoubanList(
  target: DoubanListTarget,
  cookie: string | null,
  offset = 0,
  limit = 300,
): Promise<PagedImport & { error?: string }> {
  if (target.kind === "subject_collection")
    return await fetchSubjectCollection(target.id, offset, limit);
  if (target.kind === "mine") {
    if (!cookie)
      return { works: [], total: null, hasMore: false, nextOffset: offset, error: "not_connected" };
    return await fetchDoubanMine(
      target.media ?? "movie",
      target.status ?? "wish",
      cookie,
      offset,
      limit,
    );
  }
  return { works: [], total: null, hasMore: false, nextOffset: offset, error: "unknown" };
}

/** 供 import.ts 路由使用：读取用户豆瓣连接状态 */
export async function doubanCookieFor(env: Env, userId: number): Promise<string | null> {
  return loadProviderCookie(env, userId, "douban");
}
