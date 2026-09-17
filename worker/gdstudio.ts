/**
 * gdstudio 聚合音乐接口（music-api.gdstudio.xyz/api.php）。
 * 官方声明：稳定源 netease/joox/bilibili；上游限额 5 分钟内 ≤50 次。
 * Worker 出口是 CF 共享 IP，最可能先撞上的是上游限额而非本站用户，
 * 故所有调用统一过本模块：isolate 全局令牌预算 + 结果缓存 + 超时。
 */
const API_BASE = "https://music-api.gdstudio.xyz/api.php";
const SOURCE = "netease";
const CACHE_MAX = 200;
const BUDGET_WINDOW_MS = 5 * 60 * 1000;
const BUDGET_MAX = 40;

export interface GdProxyEnv {
  MUSIC_PROXY_URL?: string;
  MUSIC_PROXY_KEY?: string;
}

// 连续失败计数：仅当 gdstudio 上游返回错误（非超时）时累加，达到阈值后暂缓请求
let consecutiveFailures = 0;
let cooldownUntil = 0;
let budget = { startedAt: 0, count: 0 };
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;

function isCoolingDown(): boolean {
  if (Date.now() < cooldownUntil) return true;
  if (cooldownUntil && Date.now() >= cooldownUntil) { cooldownUntil = 0; consecutiveFailures = 0; }
  return false;
}

function budgetLeft(): boolean {
  const now = Date.now();
  if (now - budget.startedAt > BUDGET_WINDOW_MS) budget = { startedAt: now, count: 0 };
  if (budget.count >= BUDGET_MAX) return false;
  budget.count += 1;
  return true;
}

function buildApiRequest(params: Record<string, string>, env?: GdProxyEnv): { url: URL; headers: Record<string, string> } {
  const url = new URL(env?.MUSIC_PROXY_URL?.trim() || API_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url, headers: env?.MUSIC_PROXY_KEY ? { "x-proxy-key": env.MUSIC_PROXY_KEY } : {} };
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

/** 带重试的搜索：首次失败自动重试一次，仅在连续失败达阈值时标记 blocked。 */
async function gdApiWithRetry(params: Record<string, string>, env?: GdProxyEnv): Promise<{ result: unknown | null; blocked: boolean }> {
  if (isCoolingDown()) return { result: null, blocked: true };
  if (!budgetLeft()) return { result: null, blocked: true };
  const request = buildApiRequest(params, env);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        consecutiveFailures = 0; cooldownUntil = 0;
        return { result: await response.json(), blocked: false };
      }
    } catch { /* timeout or network error */ }
    if (attempt === 0) await new Promise(r => setTimeout(r, 500));
  }
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) cooldownUntil = Date.now() + COOLDOWN_MS;
  return { result: null, blocked: consecutiveFailures >= FAILURE_THRESHOLD };
}

/** 单次 API 调用（播放链接/歌词/封面，无需重试）。 */
async function gdApi(params: Record<string, string>, env?: GdProxyEnv): Promise<unknown | null> {
  if (isCoolingDown() || !budgetLeft()) return null;
  const request = buildApiRequest(params, env);
  try {
    const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(10000) });
    if (response.ok) { consecutiveFailures = 0; cooldownUntil = 0; return await response.json(); }
  } catch { /* */ }
  return null;
}

/** 搜索曲目。count≤30；失败返回 []（预算耗尽时 blocked=true，网络失败 blocked=false）。 */
export async function gdSearch(name: string, count = 10, env?: GdProxyEnv): Promise<{ tracks: GdTrack[]; blocked: boolean }> {
  const key = `${name}|${count}`;
  const hit = searchCache.get(key);
  if (hit) return hit as { tracks: GdTrack[]; blocked: boolean };
  const { result: raw, blocked } = await gdApiWithRetry({ types: "search", source: SOURCE, name, count: String(count), pages: "1" }, env);
  const tracks = Array.isArray(raw) ? (raw as GdTrack[]).filter((t) => t && typeof t.id === "string" && typeof t.name === "string") : [];
  const outcome = { tracks, blocked: blocked && tracks.length === 0 };
  if (tracks.length || raw !== null) searchCache.set(key, outcome);
  return outcome;
}

/** 从搜索命中里按歌手/歌名匹配度排序，保留若干候选供播放链逐个尝试。 */
export function pickTracks(tracks: GdTrack[], title: string, artist?: string, limit = 3): GdTrack[] {
  if (!tracks.length) return [];
  const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s·．.、,，/()（）'’\-—_]/g, "");
  const wantTitle = norm(title);
  const wantArtist = artist ? norm(artist.split("/")[0].trim()) : "";
  const artistOf = (t: GdTrack) => norm(Array.isArray(t.artist) ? t.artist.join(" ") : String(t.artist ?? ""));
  const scored = tracks.map((track, index) => {
    let score = 0;
    const tName = norm(track.name);
    if (tName === wantTitle) score += 4;
    else if (tName.includes(wantTitle) || wantTitle.includes(tName)) score += 2;
    if (wantArtist && (artistOf(track).includes(wantArtist) || wantArtist.includes(artistOf(track)))) score += 3;
    return { track, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const matched = scored.filter((entry) => entry.score > 0).map((entry) => entry.track);
  return (matched.length ? matched : tracks).slice(0, Math.max(1, limit));
}

export function pickTrack(tracks: GdTrack[], title: string, artist?: string): GdTrack | null {
  return pickTracks(tracks, title, artist, 1)[0] ?? null;
}

/** 判断搜索匹配到的曲目是否为翻唱/改编版而非原版。 */
export function isCoverTrack(track: GdTrack, title: string, artist?: string): boolean {
  const name = track.name;
  const coverHints = /翻唱|cover|女声版|男声版|dj版|live|钢琴版|纯音乐|吉他版|深情版|翻弹|remix|伴奏|钢琴曲|古筝版|小提琴版|acoustic|instrumental|demo|试听版|雨下整夜版|纯净甜美版|压抑/i;
  if (coverHints.test(name)) return true;
  const bracket = name.match(/[（(]([^)）]+)[)）]/);
  if (bracket && coverHints.test(bracket[1])) return true;
  // 歌名中括号内容（如"七里香 (女声版)"）
  if (artist) {
    const wantArtist = artist.split("/")[0].trim();
    const trackArtists = Array.isArray(track.artist) ? track.artist.join(" ") : String(track.artist ?? "");
    const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s/g, "");
    if (wantArtist && !norm(trackArtists).includes(norm(wantArtist)) && !norm(wantArtist).includes(norm(trackArtists))) {
      // 仅当搜索结果中没有任何匹配原唱时才标记为翻唱
      // （由调用方在所有 tracks 层面判断，此处仅做单条判断）
      return true;
    }
  }
  return false;
}

/** 签名播放链（br 缺省 320）。 */
export async function gdPlayUrl(trackId: string, env?: GdProxyEnv): Promise<string> {
  const hit = playCache.get(trackId);
  if (hit) return hit as string;
  const raw = await gdApi({ types: "url", source: SOURCE, id: trackId, br: "320" }, env);
  const url = raw && typeof (raw as { url?: unknown }).url === "string" ? (raw as { url: string }).url : "";
  if (url) playCache.set(trackId, url);
  return url;
}

/** 签名封面链（size=500）。 */
export async function gdPicUrl(picId: string, env?: GdProxyEnv): Promise<string> {
  const hit = picCache.get(picId);
  if (hit) return hit as string;
  const raw = await gdApi({ types: "pic", source: SOURCE, id: picId, size: "500" }, env);
  const url = raw && typeof (raw as { url?: unknown }).url === "string" ? (raw as { url: string }).url : "";
  if (url) picCache.set(picId, url);
  return url;
}

/** LRC 歌词（原语 + 可选译文）。lyric_id 通常等于曲目 id。 */
export async function gdLyric(lyricId: string, env?: GdProxyEnv): Promise<{ lyric: string; tlyric: string } | null> {
  const hit = lyricCache.get(lyricId);
  if (hit) return hit as { lyric: string; tlyric: string };
  const raw = await gdApi({ types: "lyric", source: SOURCE, id: lyricId }, env);
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
