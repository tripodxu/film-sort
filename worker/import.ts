import type { Env } from "./index";
import { getUserFromToken } from "./account";
import { upstream } from "./media";

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

/** 解析豆列一页（25条）。豆列条目链接指向 movie/book/music.douban.com/subject/<id> */
async function doulistPage(url: string): Promise<DoulistItem[]> {
  const response = await upstream(url);
  const items: DoulistItem[] = [];
  let current: DoulistItem | null = null;
  const rewritten = new HTMLRewriter()
    .on("table.olt tr.item", { element() { current = { title: "", url: "" }; } })
    .on("table.olt tr.item .pl2 a", {
      element(el) { if (current) current.url = el.getAttribute("href") ?? ""; },
      text(chunk) { if (current) current.title += chunk.text; },
    })
    .on("table.olt tr.item td:nth-child(2) img", { element(el) { if (current) current.poster = el.getAttribute("src") ?? undefined; } })
    .on("table.olt tr.item td:nth-child(3)", { text(chunk) { if (current) current.pub = (current.pub ?? "") + chunk.text; } })
    .on("table.olt tr.item .rating_nums", { text(chunk) { if (current) current.rating = (current.rating ?? "") + chunk.text; } })
    .on("table.olt tr.item", { element(el) {
      el.onEndTag(() => {
        if (!current) return;
        const title = current.title.trim();
        if (title && current.url) items.push({ ...current, title });
        current = null;
      });
    } })
    .transform(response);
  await rewritten.text();
  return items;
}

function subjectType(url: string): ImportedWork["type"] | undefined {
  if (/movie\.douban\.com\/subject/.test(url)) return "movie";
  if (/book\.douban\.com\/subject/.test(url)) return "book";
  if (/music\.douban\.com\/subject/.test(url)) return "music";
  return undefined;
}

/** 抓取完整豆列（分页，最多 300 条）并转为标准作品 */
export async function fetchDoulist(doulistUrl: string): Promise<ImportedWork[]> {
  const match = doulistUrl.match(/doulist\/(\d+)/);
  if (!match) throw new Error("invalid_doulist");
  const id = match[1];
  const works: ImportedWork[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < 300 && start <= 11 * 25; start += 25) {
    const items = await doulistPage(`https://www.douban.com/doulist/${id}/?start=${start}&sort=seq`).catch(() => []);
    if (!items.length) break;
    for (const item of items) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const subjectId = item.url.match(/subject\/(\d+)/)?.[1];
      if (!subjectId) continue;
      const year = item.pub?.match(/\b(?:18|19|20)\d{2}\b/)?.[0];
      // 豆列条目发布行形如「[作者] / 出版社 / 2000-1」或「导演 / 1994」：取首个「/」前为创作者
      const pubParts = (item.pub ?? "").split("/").map((s) => s.trim()).filter(Boolean);
      works.push({
        id: `doulist-${subjectId}`,
        title: item.title,
        creator: pubParts.length > 0 ? pubParts[0] : undefined,
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

/** 调网易云音乐公开接口抓取歌单曲目（公开歌单无需登录 Cookie） */
export async function fetchNeteasePlaylist(playlistId: string): Promise<ImportedWork[]> {
  const response = await fetch(`https://music.163.com/api/playlist/detail?id=${encodeURIComponent(playlistId)}`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "referer": "https://music.163.com/",
      "accept": "application/json",
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
      const works = await fetchDoulist(target);
      if (!works.length) return json({ error: "doulist_empty", msg: "该豆列为空或抓取被拦截，请稍后重试" }, 502);
      return json({ works, total: works.length });
    } catch (error) {
      console.error("doulist import failed:", error instanceof Error ? error.message : error);
      return json({ error: "doulist_unavailable", msg: "豆列抓取失败，豆瓣可能限流，请稍后重试" }, 502);
    }
  }

  if (url.pathname === "/api/import/netease" && request.method === "GET") {
    const target = url.searchParams.get("url")?.trim() ?? "";
    const playlistId = neteasePlaylistId(target);
    if (!playlistId) {
      return json({ error: "invalid_playlist_url", msg: "请粘贴网易云歌单链接（含 playlist?id=）或纯歌单 ID" }, 400);
    }
    try {
      const works = await fetchNeteasePlaylist(playlistId);
      if (!works.length) return json({ error: "playlist_empty", msg: "该歌单为空或为私有歌单，请确认链接后重试" }, 502);
      return json({ works, total: works.length });
    } catch (error) {
      console.error("netease import failed:", error instanceof Error ? error.message : error);
      return json({ error: "netease_unavailable", msg: "歌单抓取失败，网易接口可能限流，请稍后重试" }, 502);
    }
  }

  return json({ error: "not_found" }, 404);
}
