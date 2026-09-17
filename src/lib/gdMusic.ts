/**
 * 音乐 API 前端调用：统一经由同源 Worker 端点。
 * Worker 内部可从 MUSIC_PROXY_URL 选择 Deno 出口，避免浏览器直接暴露上游代理。
 */

async function jsonFetch(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams(params);
  try {
    const response = await fetch(`${path}?${qs}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}

export type PlayResult = { trackId: string; trackName: string; artistName: string; playUrl: string; isCover: boolean } | null;

export async function gdPlay(title: string, artist?: string): Promise<PlayResult> {
  const data = await jsonFetch("/api/music/play", { q: title, ...(artist ? { artist: artist.split("/")[0].trim() } : {}) });
  if (!data || typeof data.playUrl !== "string" || !data.playUrl) return null;
  const track = data.track && typeof data.track === "object" ? data.track as Record<string, unknown> : null;
  if (!track || typeof track.id !== "string" || typeof track.name !== "string") return null;
  const trackArtist = Array.isArray(track.artist) ? track.artist.join(" / ") : String(track.artist ?? "");
  return { trackId: track.id, trackName: track.name, artistName: trackArtist, playUrl: data.playUrl, isCover: !!data.isCover };
}

export type LyricResult = { title: string; artist: string; lyric: string; tlyric: string } | null;

export async function gdLyric(title: string, artist?: string): Promise<LyricResult> {
  const data = await jsonFetch("/api/music/lyric", { q: title, ...(artist ? { artist: artist.split("/")[0].trim() } : {}) });
  if (!data || typeof data.lyric !== "string" || !data.lyric) return null;
  return {
    title: typeof data.title === "string" ? data.title : title,
    artist: typeof data.artist === "string" ? data.artist : "",
    lyric: data.lyric,
    tlyric: typeof data.tlyric === "string" ? data.tlyric : "",
  };
}
