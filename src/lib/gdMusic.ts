/**
 * gdstudio 音乐 API 前端调用（通过 Deno Deploy 代理）。
 * gdstudio 不支持 CORS，CF Worker 出口被封（520），Deno 走 GCP 出口可达。
 *
 * TODO: 部署 gd-proxy/main.ts 到 Deno Deploy 后，把下面的 URL 改为实际地址。
 */
const PROXY = "https://round-budgie-3427.tripodxu.deno.net";
const SOURCE = "netease";

interface GdTrack { id: string; name: string; artist: string[] | string; album?: string; lyric_id?: string }

async function gdFetch(params: Record<string, string>): Promise<unknown | null> {
  const qs = new URLSearchParams({ ...params, source: SOURCE });
  try {
    const r = await fetch(`${PROXY}?${qs}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[\s·．.、,，/()（）''\-—_]/g, "");
}

function pickTrack(tracks: GdTrack[], title: string, artist?: string): GdTrack | null {
  if (!tracks.length) return null;
  const wantTitle = norm(title);
  const wantArtist = artist ? norm(artist.split("/")[0].trim()) : "";
  const artistOf = (t: GdTrack) => norm(Array.isArray(t.artist) ? t.artist.join(" ") : String(t.artist ?? ""));
  let best: GdTrack | null = null;
  let bestScore = -1;
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

function checkCover(track: GdTrack, title: string, artist?: string): boolean {
  const coverHints = /翻唱|cover|女声版|男声版|dj版|live|钢琴版|纯音乐|吉他版|深情版|翻弹|remix|伴奏|钢琴曲|古筝版|小提琴版|acoustic|instrumental|demo|试听版|雨下整夜版|纯净甜美版|压抑/i;
  if (coverHints.test(track.name)) return true;
  const bracket = track.name.match(/[（(]([^)）]+)[)）]/);
  if (bracket && coverHints.test(bracket[1])) return true;
  if (artist) {
    const wantArtist = artist.split("/")[0].trim();
    const trackArtists = Array.isArray(track.artist) ? track.artist.join(" ") : String(track.artist ?? "");
    if (wantArtist && !norm(trackArtists).includes(norm(wantArtist)) && !norm(wantArtist).includes(norm(trackArtists))) return true;
  }
  return false;
}

function stripLrc(lrc: string): string {
  const lines: string[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    if (!lines.length || lines[lines.length - 1] !== text) lines.push(text);
  }
  return lines.join("\n");
}

export type PlayResult = { trackId: string; trackName: string; artistName: string; playUrl: string; isCover: boolean } | null;

export async function gdPlay(title: string, artist?: string): Promise<PlayResult> {
  const raw = await gdFetch({ types: "search", name: title, count: "10", pages: "1" });
  if (!Array.isArray(raw) || !raw.length) return null;
  const tracks = (raw as GdTrack[]).filter((t) => t && typeof t.id === "string" && typeof t.name === "string");
  if (!tracks.length) return null;
  const track = pickTrack(tracks, title, artist);
  if (!track) return null;
  const urlRaw = await gdFetch({ types: "url", id: track.id, br: "320" });
  const playUrl = urlRaw && typeof (urlRaw as { url?: unknown }).url === "string" ? (urlRaw as { url: string }).url : "";
  if (!playUrl) return null;
  return { trackId: track.id, trackName: track.name, artistName: Array.isArray(track.artist) ? track.artist.join(" / ") : String(track.artist ?? ""), playUrl, isCover: checkCover(track, title, artist) };
}

export type LyricResult = { title: string; artist: string; lyric: string; tlyric: string } | null;

export async function gdLyric(title: string, artist?: string): Promise<LyricResult> {
  const raw = await gdFetch({ types: "search", name: title, count: "10", pages: "1" });
  if (!Array.isArray(raw) || !raw.length) return null;
  const tracks = (raw as GdTrack[]).filter((t) => t && typeof t.id === "string" && typeof t.name === "string");
  if (!tracks.length) return null;
  const track = pickTrack(tracks, title, artist);
  if (!track) return null;
  const lyricId = track.lyric_id || track.id;
  const lyricRaw = await gdFetch({ types: "lyric", id: lyricId });
  if (!lyricRaw || typeof lyricRaw !== "object") return null;
  const data = lyricRaw as { lyric?: unknown; tlyric?: unknown };
  if (typeof data.lyric !== "string") return null;
  return { title: track.name, artist: Array.isArray(track.artist) ? track.artist.join(" / ") : String(track.artist ?? ""), lyric: stripLrc(data.lyric), tlyric: typeof data.tlyric === "string" ? stripLrc(data.tlyric) : "" };
}
