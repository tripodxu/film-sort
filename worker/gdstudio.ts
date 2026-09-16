/**
 * gdstudio 聚合音乐接口（music-api.gdstudio.xyz/api.php）。
 * 官方声明：稳定源 netease/joox/bilibili；上游限额 5 分钟内 ≤50 次。
 * Worker 出口是 CF 共享 IP，最可能先撞上的是上游限额而非本站用户，
 * 故所有调用统一过本模块：isolate 全局令牌预算 + 结果缓存 + 超时。
 */
const API_BASE = "https://music-api.gdstudio.xyz/api.php";
const SOURCE = "netease";
const BUDGET_WINDOW_MS = 5 * 60 * 1000;
const BUDGET_MAX = 40; // 上游 50 次/5min，留 10 次余量给重试与部署冷启动
const CACHE_MAX = 200;

// isolate 级共享预算（所有请求、所有客户端合计）
let budget = { startedAt: 0, count: 0 };
function budgetLeft(): boolean {
  const now = Date.now();
  if (now - budget.startedAt > BUDGET_WINDOW_MS) { budget = { startedAt: now, count: 0 }; return true; }
  if (budget.count >= BUDGET_MAX) return false;
  budget.count += 1;
  return true;
}

interface CacheEntry { value: unknown; expires: number }
function makeCache(ttlMs: number) {
  const store = new Map<string, CacheEntry>();
  return {
    get(key: string): unknown | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() > hit.expires) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key: string, value: unknown) {
      if (store.size >= CACHE_MAX) { const oldest = store.keys().next().value as string | undefined; if (oldest !== undefined) store.delete(oldest); }
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}
const searchCache = makeCache(10 * 60 * 1000);      // 搜索结果 10 分钟
const playCache = makeCache(30 * 60 * 1000);        // 签名播放链约 1 小时过期，缓存 30 分钟
const picCache = makeCache(50 * 60 * 1000);         // 签名封面链同理，留余量
const lyricCache = makeCache(24 * 60 * 60 * 1000);  // 歌词几乎不变

export interface GdTrack { id: string; name: string; artist: string[] | string; album?: string; pic_id?: string; lyric_id?: string }

async function gdApi(params: Record<string, string>): Promise<unknown | null> {
  if (!budgetLeft()) return null;
  try {
    const url = new URL(API_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

/** 搜索曲目。count≤30；失败返回 []（预算耗尽也返回 []，由调用方区分时可读 msg）。 */
export async function gdSearch(name: string, count = 10): Promise<{ tracks: GdTrack[]; blocked: boolean }> {
  const key = `${name}|${count}`;
  const hit = searchCache.get(key);
  if (hit) return hit as { tracks: GdTrack[]; blocked: boolean };
  const raw = await gdApi({ types: "search", source: SOURCE, name, count: String(count), pages: "1" });
  const tracks = Array.isArray(raw) ? (raw as GdTrack[]).filter((t) => t && typeof t.id === "string" && typeof t.name === "string") : [];
  const outcome = { tracks, blocked: tracks.length === 0 && raw === null };
  if (tracks.length || raw !== null) searchCache.set(key, outcome);
  return outcome;
}

/** 从搜索命中里挑最贴合歌手的曲目：歌名全等 + 艺人包含优先，其次歌名包含，最后第一条。 */
export function pickTrack(tracks: GdTrack[], title: string, artist?: string): GdTrack | null {
  if (!tracks.length) return null;
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s·．.、,，/()（）'’\-—_]/g, "");
  const wantTitle = norm(title);
  const wantArtist = artist ? norm(artist.split("/")[0].trim()) : "";
  const artistOf = (t: GdTrack) => norm(Array.isArray(t.artist) ? t.artist.join(" ") : String(t.artist ?? ""));
  let best: GdTrack | null = null; let bestScore = -1;
  for (const t of tracks) {
    let score = 0;
    const tName = norm(t.name);
    if (tName === wantTitle) score += 4;
    else if (tName.includes(wantTitle) || wantTitle.includes(tName)) score += 2;
    if (wantArtist && (artistOf(t).includes(wantArtist) || wantArtist.includes(artistOf(t)))) score += 3;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return bestScore > 0 ? best : tracks[0];
}

/** 签名播放链（br 缺省 320）。 */
export async function gdPlayUrl(trackId: string): Promise<string> {
  const hit = playCache.get(trackId);
  if (hit) return hit as string;
  const raw = await gdApi({ types: "url", source: SOURCE, id: trackId, br: "320" });
  const url = raw && typeof (raw as { url?: unknown }).url === "string" ? (raw as { url: string }).url : "";
  if (url) playCache.set(trackId, url);
  return url;
}

/** 签名封面链（size=500）。 */
export async function gdPicUrl(picId: string): Promise<string> {
  const hit = picCache.get(picId);
  if (hit) return hit as string;
  const raw = await gdApi({ types: "pic", source: SOURCE, id: picId, size: "500" });
  const url = raw && typeof (raw as { url?: unknown }).url === "string" ? (raw as { url: string }).url : "";
  if (url) picCache.set(picId, url);
  return url;
}

/** LRC 歌词（原语 + 可选译文）。lyric_id 通常等于曲目 id。 */
export async function gdLyric(lyricId: string): Promise<{ lyric: string; tlyric: string } | null> {
  const hit = lyricCache.get(lyricId);
  if (hit) return hit as { lyric: string; tlyric: string };
  const raw = await gdApi({ types: "lyric", source: SOURCE, id: lyricId });
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { lyric?: unknown; tlyric?: unknown };
  if (typeof data.lyric !== "string") return null;
  const outcome = { lyric: data.lyric, tlyric: typeof data.tlyric === "string" ? data.tlyric : "" };
  lyricCache.set(lyricId, outcome);
  return outcome;
}

/** 剥掉 LRC 时间标签，返回纯文本行（去空行、去元数据行）。 */
export function stripLrc(lrc: string): string {
  const lines: string[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    if (!lines.length || lines[lines.length - 1] !== text) lines.push(text);
  }
  return lines.join("\n");
}
