import { useEffect, useState } from "react";
import { BookOpen, Film, Library, Music2 } from "lucide-react";
import type { Artwork, MediaKind } from "../data/media";

const requests = new Map<string, Promise<string[]>>();
const reportedFailures = new Set<string>();
const POSTER_CACHE_KEY = "art-rank:poster-cache";
function readPosterCache(key: string): string[] | null {
  try { const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}"); return cache[key] ?? null; } catch { return null; }
}
function writePosterCache(key: string, urls: string[]) {
  try { const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}"); cache[key] = urls; sessionStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(cache)); } catch { /* Quota exceeded — silently skip */ }
}
function resolve(work: Artwork, kind: MediaKind): Promise<string[]> {
  const key = `${kind}|${work.title}|${work.subtitle ?? ""}|${work.year ?? ""}`;
  let request = requests.get(key);
  if (!request) {
    const cached = readPosterCache(key);
    if (cached) { request = Promise.resolve(cached); requests.set(key, request); return request; }
    const type = kind === "book" ? "book" : kind === "music" ? "music" : "movie";
    const params = new URLSearchParams({ q: work.title, en: work.subtitle ?? work.title, type, ...(work.year ? { year: String(work.year) } : {}) });
    request = fetch(`/api/posters?${params}`, { signal: AbortSignal.timeout(20000) })
      .then(async (response) => response.ok ? await response.json() as { poster_urls?: string[] } : {})
      .then((data) => { const urls = data.poster_urls ?? []; if (urls.length) writePosterCache(key, urls); return urls; }).catch(() => []);
    requests.set(key, request);
  }
  return request;
}

function imageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return /^(?:img\d+\.doubanio\.com|m\.media-amazon\.com|ia\.media-imdb\.com|image\.tmdb\.org)$/.test(parsed.hostname)
      ? `/api/image?url=${encodeURIComponent(url)}` : url;
  } catch { return url; }
}

function reportImageFailure(work: Artwork, kind: MediaKind, url: string) {
  const key = `${kind}|${work.title}|${url}`;
  if (reportedFailures.has(key)) return;
  reportedFailures.add(key);
  void fetch("/api/poster-errors/client", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: work.title, type: kind, error: "image_load_failed" }),
    keepalive: true,
  }).catch(() => undefined);
}

export function Poster({ work, kind, large = false }: { work: Artwork; kind: MediaKind; large?: boolean }) {
  const [resolved, setResolved] = useState<string[]>([]);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    setResolved([]); setFailed(new Set());
    if (kind === "film" || kind === "book" || kind === "music") void resolve(work, kind).then((urls) => { if (active) setResolved(urls); });
    return () => { active = false; };
  }, [work.id, work.title, kind, large]);
  const urls = [...new Set([...resolved, ...(work.posterUrls ?? [])])];
  const url = urls.find((candidate) => !failed.has(candidate));
  const Icon = { film: Film, book: BookOpen, music: Music2, other: Library }[kind];
  return <div className={`poster ${large ? "poster-large" : "poster-small"} poster-${kind}`}>
    {url ? <img src={imageUrl(url)} alt={`${work.title} ${kind === "film" ? "海报" : "封面"}`} referrerPolicy="no-referrer" loading={large ? "eager" : "lazy"} onError={() => { reportImageFailure(work, kind, url); setFailed((previous) => new Set([...previous, url])); }} /> :
      <div className="cover-fallback"><Icon size={large ? 36 : 16} />{large && <span>{work.title}</span>}</div>}
  </div>;
}
