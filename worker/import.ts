import type { Env } from "./index";
import { getUserFromToken } from "./account";
import { upstream } from "./media";
import { loadProviderCookie, neteaseUserId, neteaseUserPlaylists, weapiPost } from "./netease";
import { classifyDoubanList, fetchDoubanList, type PagedImport } from "./doubanlist";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export interface ImportedWork {
  id: string;
  title: string;
  creator?: string;
  year?: number;
  rating?: string;
  poster_url?: string;
  type?: "movie" | "book" | "music";
}

// ===== 豆瓣豆列抓取 =====

interface DoulistItem { title: string; url: string; poster?: string; pub?: string; rating?: string }

/**
 * 解析豆列一页（25条）。豆瓣现行版式为 div.doulist-item（title/post/rating/abstract 子块），
 * 同时保留旧版 table.olt 解析以防个别页面仍是老模板。
 */
async function doulistPage(url: string, cookie?: string | null): Promise<DoulistItem[]> {
  const response = await upstream(url, 2, cookie);
  const items: DoulistItem[] = [];
  let current: DoulistItem | null = null;
  const finish = () => {
    if (!current) return;
    const title = current.title.trim();
    const link = current.url.trim();
    if (title && link) items.push({ ...current, title, url: link });
    current = null;
  };
  const rewritten = new HTMLRewriter()
    // ===== 新版式 =====
    .on("div.doulist-item", { element() { finish(); current = { title: "", url: "" }; } })
    .on("div.doulist-item .title a", {
      element(el) { if (current && !current.url) current.url = el.getAttribute("href") ?? ""; },
      text(chunk) { if (current) current.title += chunk.text; },
    })
    .on("div.doulist-item .post img", {
      element(el) { if (current && !current.poster) current.poster = (el.getAttribute("src") || el.getAttribute("data-src")) ?? undefined; },
    })
    .on("div.doulist-item .abstract", { text(chunk) { if (current) current.pub = (current.pub ?? "") + chunk.text; } })
    .on("div.doulist-item .abstract br", { element() { if (current) current.pub = (current.pub ?? "") + "\n"; } })
    .on("div.doulist-item .rating_nums", { text(chunk) { if (current) current.rating = (current.rating ?? "") + chunk.text; } })
    // ===== 旧版式（兜底） =====
    .on("table.olt tr.item", { element() { finish(); current = { title: "", url: "" }; } })
    .on("table.olt tr.item .pl2 a", {
      element(el) { if (current && !current.url) current.url = el.getAttribute("href") ?? ""; },
      text(chunk) { if (current) current.title += chunk.text; },
    })
    .on("table.olt tr.item td:nth-child(2) img", { element(el) { if (current && !current.poster) current.poster = el.getAttribute("src") ?? undefined; } })
    .on("table.olt tr.item td:nth-child(3)", { text(chunk) { if (current) current.pub = (current.pub ?? "") + chunk.text; } })
    .on("table.olt tr.item .rating_nums", { text(chunk) { if (current) current.rating = (current.rating ?? "") + chunk.text; } })
    .on("div.doulist-item", { element(el) { el.onEndTag(finish); } })
    .on("table.olt tr.item", { element(el) { el.onEndTag(finish); } })
    .transform(response);
  await rewritten.text();
  return items;
}

/** 从 abstract 多行文本提取创作者：取第一个「作者:/导演:/歌手:」等标签行的值 */
function doulistCreator(pub: string): string | undefined {
  const lines = pub.split(/[\n/]/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(?:作者|原著|原作|著者|译者|导演|编剧|歌手|演员|主演|演唱者|艺术家|艺人|乐队|组合|作曲家)\s*[:：]\s*(.+)$/);
    if (match && match[1].trim()) return match[1].trim();
  }
  return undefined;
}

function subjectType(url: string): ImportedWork["type"] | undefined {
  if (/movie\.douban\.com\/subject/.test(url)) return "movie";
  if (/book\.douban\.com\/subject/.test(url)) return "book";
  if (/music\.douban\.com\/subject/.test(url)) return "music";
  return undefined;
}

/** 抓取豆列窗口 [offset, offset+limit)（每页 25 条，绝对游标 pos 推进，去重/解析失败不漂移） */
export async function fetchDoulist(doulistUrl: string, cookie?: string | null, offset = 0, limit = 300): Promise<PagedImport> {
  const match = doulistUrl.match(/doulist\/(\d+)/);
  if (!match) throw new Error("invalid_doulist");
  const id = match[1];
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  limit = Math.min(limit, 300);
  const total: number | null = null;
  let pos = offset; // 下一个待处理的绝对索引
  for (let pageStart = Math.floor(offset / 25) * 25; works.length < limit && pageStart < offset + limit + 25; pageStart += 25) {
    const items = await doulistPage(`https://www.douban.com/doulist/${id}/?start=${pageStart}&sort=seq`, cookie).catch(() => []);
    if (!items.length) break;
    for (let idx = 0; idx < items.length; idx++) {
      const abs = pageStart + idx;
      if (abs >= offset + limit) break; // 窗口右界
      if (abs < offset) { pos = abs + 1; continue; } // 窗口左界之前，仅推进游标
      pos = abs + 1;
      const item = items[idx];
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const subjectId = item.url.match(/subject\/(\d+)/)?.[1];
      if (!subjectId) continue;
      const year = item.pub?.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
      // 先按「作者: X」「导演: X」等标签行提取创作者；旧版式无标签时退回首段
      const creator = doulistCreator(item.pub ?? "") ?? (() => {
        const pubParts = (item.pub ?? "").split("/").map((s) => s.trim()).filter(Boolean);
        return pubParts.length > 0 ? pubParts[0] : undefined;
      })();
      works.push({
        id: `doulist-${subjectId}`,
        title: item.title,
        creator,
        year: year ? Number(year) : undefined,
        rating: item.rating?.trim() || undefined,
        poster_url: item.poster,
        type: subjectType(item.url),
      });
      if (works.length >= limit) break;
    }
    if (items.length < 25) break;
  }
  const hasMore = works.length >= limit;
  return { works, total, hasMore, nextOffset: pos };
}

// ===== 网易云歌单抓取 =====

interface NeteaseTrack { id?: number; name?: string; artists?: Array<{ name?: string }>; album?: { name?: string; picUrl?: string } }
/** v3/song/detail 的 c= 格式返回的简化曲结构 */
interface NeteaseSong { id?: number; name?: string; ar?: Array<{ name?: string }>; al?: { name?: string; picUrl?: string } }

const NETEASE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 从链接或纯 ID 提取歌单 ID（支持 music.163.com/playlist?id= 与 #/playlist?id= 形式） */
export function neteasePlaylistId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/playlist\?id=(\d+)/);
  return match ? match[1] : null;
}

/**
 * 抓取歌单曲目。旧接口 api/playlist/detail 已要求登录（返回 code 20001）。
 * 分层策略（Cloudflare 海外出口常被网易云匿名风控，开放接口静默返回空、weapi 单发可通但连发限流）：
 * 1. 开放接口 GET api/v6/playlist/detail → trackIds 全量 ID + tracks 前若干首
 * 2. 空结果降级 weapi /weapi/v6/playlist/detail/（失败退避重试 2 次）
 * 3. 曲目批量：POST api/v3/song/detail (c=[{id},...])，空则降级 weapi（同样退避）；分片间 700ms 节流
 * 带 Cookie 时私有歌单也可导入。
 */
const neteaseSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 依次尝试多个取数器，返回首个非空结果；每次失败后退避（网易云对 CF 出口连发限流） */
async function firstNonEmpty<T>(attempts: Array<() => Promise<T[]>>): Promise<T[]> {
  for (const attempt of attempts) {
    try {
      const got = await attempt();
      if (got.length) return got;
    } catch { /* try next */ }
    await neteaseSleep(900);
  }
  return [];
}

/** 抓取歌单曲目窗口 [offset, offset+limit)。trackIds 一次拿全（≤1000），song/detail 只请求窗口内的分片。 */
export async function fetchNeteasePlaylist(playlistId: string, cookie?: string | null, offset = 0, limit = 300): Promise<PagedImport> {
  const headers: Record<string, string> = { "user-agent": NETEASE_UA, "referer": "https://music.163.com/" };
  if (cookie) headers.cookie = cookie;
  interface DetailShape { trackCount?: number; trackIds?: Array<{ id?: number }>; tracks?: NeteaseTrack[] }
  let allIds: number[] = [];
  let fallbackTracks: NeteaseTrack[] = [];
  let total: number | null = null;
  const collect = (pl: DetailShape | undefined) => {
    if (!pl) return;
    allIds = (pl.trackIds ?? []).map((t) => t.id).filter((id): id is number => typeof id === "number").slice(0, 1000);
    if (typeof pl.trackCount === "number") total = pl.trackCount;
    if (!fallbackTracks.length) fallbackTracks = pl.tracks ?? [];
  };
  const detailAttempts: Array<() => Promise<DetailShape | undefined>> = [
    async () => {
      const response = await fetch(`https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(playlistId)}&n=1000&s=0`, { headers, signal: AbortSignal.timeout(15000) });
      if (!response.ok) return undefined;
      return ((await response.json()) as { playlist?: DetailShape }).playlist;
    },
    async () => ((await weapiPost("/weapi/v6/playlist/detail/", { id: playlistId, n: 1000, s: 0 }, cookie ?? null)).json.playlist as DetailShape | undefined),
    async () => ((await weapiPost("/weapi/v6/playlist/detail/", { id: playlistId, n: 1000, s: 0 }, cookie ?? null)).json.playlist as DetailShape | undefined),
  ];
  for (const attempt of detailAttempts) {
    try {
      collect(await attempt());
      if (allIds.length) break;
    } catch { /* next attempt */ }
    await neteaseSleep(900);
  }
  if (!allIds.length && !fallbackTracks.length) throw new Error("netease_playlist_not_found");
  // 批量补全曲目（v6 的 tracks 只带前 ~10 首）：开放 v3 → weapi v3 ×2。
  // 每批最多 300 首，只请求窗口 [offset, offset+limit) 内的分片，最小化连发次数以规避 CF 出口限流。
  const windowIds = allIds.slice(offset, offset + limit);
  const songs: NeteaseSong[] = [];
  for (let start = 0; start < windowIds.length; start += 300) {
    if (start > 0) await neteaseSleep(700);
    const chunk = windowIds.slice(start, start + 300);
    const cJson = "[" + chunk.map((id) => `{"id":${id}}`).join(",") + "]";
    const idsJson = "[" + chunk.join(",") + "]";
    const got = await firstNonEmpty<NeteaseSong>([
      async () => {
        const response = await fetch("https://music.163.com/api/v3/song/detail", {
          method: "POST",
          headers: { ...headers, "content-type": "application/x-www-form-urlencoded" },
          body: "c=" + encodeURIComponent(cJson),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) return [];
        return ((await response.json()) as { songs?: NeteaseSong[] }).songs ?? [];
      },
      async () => ((await weapiPost("/weapi/v3/song/detail/", { c: cJson, ids: idsJson }, cookie ?? null)).json.songs as NeteaseSong[] | undefined) ?? [],
      async () => ((await weapiPost("/weapi/v3/song/detail/", { c: cJson, ids: idsJson }, cookie ?? null)).json.songs as NeteaseSong[] | undefined) ?? [],
    ]);
    songs.push(...got);
  }
  const fromSongs = songs.map((song) => ({
    id: `netease-${song.id ?? Math.random().toString(36).slice(2, 10)}`,
    title: song.name ?? "",
    creator: (song.ar ?? []).map((a) => a.name).filter(Boolean).join("/") || song.al?.name || undefined,
    poster_url: song.al?.picUrl,
    type: "music" as const,
  })).filter((work) => work.title);
  // 如果上游只返回了窗口中的一部分歌曲，下一次从第一个缺失曲目重试，
  // 不能直接按窗口长度跳过；否则这些歌曲会被永久遗漏。
  const requestedIds = new Set(windowIds);
  const receivedIds = new Set(songs.map((song) => song.id).filter((id): id is number => typeof id === "number" && requestedIds.has(id)));
  const firstMissingIndex = windowIds.findIndex((id) => !receivedIds.has(id));
  const nextOffset = firstMissingIndex >= 0 ? offset + firstMissingIndex : offset + windowIds.length;
  const hasMore = firstMissingIndex >= 0 || (total != null ? nextOffset < total : nextOffset < allIds.length);
  if (fromSongs.length) return { works: fromSongs, total: total ?? (allIds.length || null), hasMore, nextOffset };
  // 全部失败时回退 detail 自带的部分 tracks（至少能拿到前几首）
  const fallback = fallbackTracks.slice(offset, offset + limit).map((track) => ({
    id: `netease-${track.id ?? Math.random().toString(36).slice(2, 10)}`,
    title: track.name ?? "",
    creator: (track.artists ?? []).map((a) => a.name).filter(Boolean).join("/") || track.album?.name || undefined,
    poster_url: track.album?.picUrl,
    type: "music" as const,
  })).filter((work) => work.title);
  return { works: fallback, total: total ?? (allIds.length || null), hasMore: false, nextOffset };
}

/** 登录用户导入路由：/api/import/doulist?url= 与 /api/import/netease?url= */
export async function importRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const user = await getUserFromToken(request, env.DB);
  if (!user) return json({ error: "authentication_required" }, 401);
  const url = new URL(request.url);
  // 分批导入窗口参数：offset=起点，limit=本批条数（≤300）
  const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get("offset") || 0) || 0));
  const limit = Math.max(1, Math.min(300, Number(url.searchParams.get("limit") || 300) || 300));

  if (url.pathname === "/api/import/doulist" && request.method === "GET") {
    const target = url.searchParams.get("url")?.trim() ?? "";
    if (!/^https:\/\/(www\.)?douban\.com\/doulist\/\d+\/?/.test(target)) {
      return json({ error: "invalid_doulist_url", msg: "请粘贴豆瓣豆列链接，如 https://www.douban.com/doulist/12345/" }, 400);
    }
    try {
      const page = await fetchDoulist(target, await loadProviderCookie(env, user.id, "douban"), offset, limit);
      if (!page.works.length) return json({ error: "doulist_empty", msg: "该豆列为空或抓取被拦截，请稍后重试" }, 502);
      return json({ works: page.works, total: page.works.length, listTotal: page.total, hasMore: page.hasMore, nextOffset: page.nextOffset });
    } catch (error) {
      console.error("doulist import failed:", error instanceof Error ? error.message : error);
      return json({ error: "doulist_unavailable", msg: "豆列抓取失败，豆瓣可能限流，请稍后重试" }, 502);
    }
  }

  if (url.pathname === "/api/import/douban-list" && request.method === "GET") {
    const target = url.searchParams.get("url")?.trim() ?? "";
    const classified = classifyDoubanList(target);
    if (classified.kind === "unknown") {
      return json({ error: "invalid_url", msg: "请粘贴豆瓣豆列（doulist/123）、我的书影音（mine?status=wish/collect）或清单（subject_collection/XXX）链接" }, 400);
    }
    try {
      const cookie = await loadProviderCookie(env, user.id, "douban");
      const page: PagedImport & { error?: string } = classified.kind === "doulist"
        ? await fetchDoulist(target, cookie, offset, limit)
        : await fetchDoubanList(classified, cookie, offset, limit);
      if (page.error === "not_connected") return json({ error: "not_connected", msg: "请先在上方连接豆瓣（扫码或粘贴 Cookie），再导入想看/已看清单" }, 400);
      if (!page.works.length) {
        return json({ error: "list_empty", msg: "该清单为空或抓取被拦截，请稍后重试" }, 502);
      }
      return json({ works: page.works, total: page.works.length, listTotal: page.total, hasMore: page.hasMore, nextOffset: page.nextOffset, kind: classified.kind });
    } catch (error) {
      console.error("douban-list import failed:", error instanceof Error ? error.message : error);
      return json({ error: "douban_list_unavailable", msg: "豆瓣清单抓取失败，可能限流，请稍后重试" }, 502);
    }
  }

  if (url.pathname === "/api/import/netease" && request.method === "GET") {
    const target = url.searchParams.get("url")?.trim() ?? "";
    const playlistId = neteasePlaylistId(target);
    if (!playlistId) {
      return json({ error: "invalid_playlist_url", msg: "请粘贴网易云歌单链接（含 playlist?id=）或纯歌单 ID" }, 400);
    }
    try {
      const cookie = await loadProviderCookie(env, user.id, "netease");
      const page = await fetchNeteasePlaylist(playlistId, cookie, offset, limit);
      if (!page.works.length) return json({ error: "playlist_empty", msg: "该歌单为空，请确认链接后重试" }, 502);
      return json({ works: page.works, total: page.works.length, listTotal: page.total, hasMore: page.hasMore, nextOffset: page.nextOffset });
    } catch (error) {
      console.error("netease import failed:", error instanceof Error ? error.message : error);
      return json({ error: "netease_unavailable", msg: "歌单抓取失败，网易接口可能限流，请稍后重试" }, 502);
    }
  }

  // 我的网易云歌单列表（需已扫码连接）：用于一键导入
  if (url.pathname === "/api/import/netease/mine" && request.method === "GET") {
    const cookie = await loadProviderCookie(env, user.id, "netease");
    if (!cookie) return json({ error: "not_connected", msg: "尚未连接网易云账号，请先扫码登录" }, 400);
    const uid = await neteaseUserId(cookie);
    if (!uid) return json({ error: "connection_expired", msg: "网易云连接已过期，请重新扫码登录" }, 401);
    const { playlists, blocked } = await neteaseUserPlaylists(cookie, uid);
    return json({ playlists, blocked, uid });
  }

  return json({ error: "not_found" }, 404);
}
