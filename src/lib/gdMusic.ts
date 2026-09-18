/**
 * 音乐 API 前端调用：统一经由同源 Worker 端点。
 * Worker 内部可从 MUSIC_PROXY_URL 选择 Deno 出口，避免浏览器直接暴露上游代理。
 *
 * 这里刻意保留**失败原因**：Worker 会区分「本机触发限流（429 rate_limited）」
 * 「上游限流（429 music_upstream_limited）」「没这首歌（404）」与「服务不可用（502）」。
 * 旧实现把这些一律折叠成 null，界面就只能显示"未找到可试听的版本"——
 * 用户连点几首就会撞上限流（12 次/10 分钟），却被告知"这首歌没有"，看起来就是功能坏了。
 */

export type GdFailure = "rate_limited" | "upstream_limited" | "not_found" | "unavailable";

export interface GdErrorInfo {
  reason: GdFailure;
  /** 服务端给出的建议重试秒数（0 表示未提供）。 */
  retryAfter: number;
}

export type MusicResult<T> = { ok: true; value: T } | { ok: false; error: GdErrorInfo };

const fail = (reason: GdFailure, retryAfter = 0): { ok: false; error: GdErrorInfo } => ({ ok: false, error: { reason, retryAfter } });

function classify(code: string, status: number): GdFailure {
  if (code === "rate_limited") return "rate_limited";
  if (code === "music_upstream_limited" || code === "lyric_upstream_limited") return "upstream_limited";
  if (code === "music_not_found" || code === "lyric_not_found" || code === "lyric_not_found") return "not_found";
  if (status === 404) return "not_found";
  return "unavailable";
}

async function jsonFetch(path: string, params: Record<string, string>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: GdErrorInfo }> {
  const qs = new URLSearchParams(params);
  try {
    const response = await fetch(`${path}?${qs}`, { signal: AbortSignal.timeout(20000) });
    const retryAfter = Number(response.headers.get("retry-after")) || 0;
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      const code = typeof body?.error === "string" ? body.error : "";
      return fail(classify(code, response.status), retryAfter);
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) return fail("unavailable");
    return { ok: true, data: data as Record<string, unknown> };
  } catch { return fail("unavailable"); }
}

export type PlayResult = { trackId: string; trackName: string; artistName: string; playUrl: string; isCover: boolean };

export async function gdPlay(title: string, artist?: string): Promise<MusicResult<PlayResult>> {
  const response = await jsonFetch("/api/music/play", { q: title, ...(artist ? { artist: artist.split("/")[0].trim() } : {}) });
  if (!response.ok) return response;
  const data = response.data;
  if (typeof data.playUrl !== "string" || !data.playUrl) return fail("not_found");
  const track = data.track && typeof data.track === "object" ? data.track as Record<string, unknown> : null;
  if (!track || typeof track.id !== "string" || typeof track.name !== "string") return fail("not_found");
  const trackArtist = Array.isArray(track.artist) ? track.artist.join(" / ") : String(track.artist ?? "");
  return { ok: true, value: { trackId: track.id, trackName: track.name, artistName: trackArtist, playUrl: data.playUrl, isCover: !!data.isCover } };
}

export type LyricResult = { title: string; artist: string; lyric: string; tlyric: string };

export async function gdLyric(title: string, artist?: string): Promise<MusicResult<LyricResult>> {
  const response = await jsonFetch("/api/music/lyric", { q: title, ...(artist ? { artist: artist.split("/")[0].trim() } : {}) });
  if (!response.ok) return response;
  const data = response.data;
  if (typeof data.lyric !== "string" || !data.lyric) return fail("not_found");
  return {
    ok: true,
    value: {
      title: typeof data.title === "string" ? data.title : title,
      artist: typeof data.artist === "string" ? data.artist : "",
      lyric: data.lyric,
      tlyric: typeof data.tlyric === "string" ? data.tlyric : "",
    },
  };
}
