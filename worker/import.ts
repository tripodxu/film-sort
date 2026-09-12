import type { Env } from "./index";
import { getUserFromToken } from "./account";
import { upstream } from "./media";
import { loadProviderCookie, neteaseUserId, neteaseUserPlaylists } from "./netease";
import { classifyDoubanList, fetchDoubanList } from "./doubanlist";

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

/** 抓取完整豆列（分页，最多 300 条）并转为标准作品 */
export async function fetchDoulist(doulistUrl: string, cookie?: string | null): Promise<ImportedWork[]> {
  const match = doulistUrl.match(/doulist\/(\d+)/);
  if (!match) throw new Error("invalid_doulist");
  const id = match[1];
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < 300 && start <= 11 * 25; start += 25) {
    const items = await doulistPage(`https://www.douban.com/doulist/${id}/?start=${start}&sort=seq`, cookie).catch(() => []);
    if (!items.length) break;
    for (const item of items) {
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
      if (works.length >= 300) return works;
    }
  }
  return works;
}

// ===== 网易云歌单抓取 =====

interface NeteaseTrack { id?: number; name?: string; artists?: Array<{ name?: string }>; album?: { name?: string; picUrl?: string } }

/** 从链接或纯 ID 提取歌单 ID（支持 music.163.com/playlist?id= 与 #/playlist?id= 形式） */
export function neteasePlaylistId(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/playlist\?id=(\d+)/);
  return match ? match[1] : null;
}

/** 调网易云音乐公开接口抓取歌单曲目（带连接 Cookie 时私有歌单也可导入） */
export async function fetchNeteasePlaylist(playlistId: string, cookie?: string | null): Promise<ImportedWork[]> {
  const response = await fetch(`https://music.163.com/api/playlist/detail?id=${encodeURIComponent(playlistId)}`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "referer": "https://music.163.com/",
      ...(cookie ? { cookie } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`netease_http_${response.status}`);
  const data = await response.json() as { code?: number; result?: { tracks?: NeteaseTrack[] } };
  const tracks = data.result?.tracks ?? [];
  return tracks.slice(0, 300).map((track) => ({
    id: `netease-${track.id ?? Math.random().toString(36).slice(2, 10)}`,
    title: track.name ?? "",
    creator: (track.artists ?? []).map((a) => a.name).filter(Boolean).join("/") || track.album?.name || undefined,
    poster_url: track.album?.picUrl,
    type: "music" as const,
  })).filter((work) => work.title);
}

/** 登录用户导入路由：/api/import/doulist?url= 与 /api/import/netease?url= */
export async function importRoute(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const user = await getUserFromToken(request, env.DB);
  if (!user) return json({ error: "authentication_required" }, 401);
  const url = new URL(request.url);

  if (url.pathname === "/api/import/doulist" && request.method === "GET") {
    const target = url.searchParams.get("url")?.trim() ?? "";
    if (!/^https:\/\/(www\.)?douban\.com\/doulist\/\d+\/?/.test(target)) {
      return json({ error: "invalid_doulist_url", msg: "请粘贴豆瓣豆列链接，如 https://www.douban.com/doulist/12345/" }, 400);
    }
    try {
      const works = await fetchDoulist(target, await loadProviderCookie(env, user.id, "douban"));
      if (!works.length) return json({ error: "doulist_empty", msg: "该豆列为空或抓取被拦截，请稍后重试" }, 502);
      return json({ works, total: works.length });
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
      const works = classified.kind === "doulist"
        ? await fetchDoulist(target, cookie)
        : (await fetchDoubanList(classified, cookie)).works;
      if (!works.length) {
        const reason = classified.kind === "mine" && !cookie ? "请先在上方连接豆瓣（扫码或粘贴 Cookie），再导入想看/已看清单" : "该清单为空或抓取被拦截，请稍后重试";
        return json({ error: "list_empty", msg: reason }, 502);
      }
      return json({ works, total: works.length, kind: classified.kind });
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
      const works = await fetchNeteasePlaylist(playlistId, cookie);
      if (!works.length) return json({ error: "playlist_empty", msg: "该歌单为空，请确认链接后重试" }, 502);
      return json({ works, total: works.length });
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
    const playlists = await neteaseUserPlaylists(cookie, uid);
    return json({ playlists });
  }

  return json({ error: "not_found" }, 404);
}
