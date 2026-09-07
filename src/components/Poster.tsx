import { useEffect, useState } from "react";
import { BookOpen, Film, Library, Music2 } from "lucide-react";
import type { Artwork, MediaKind } from "../data/media";

const requests = new Map<string, Promise<string[]>>();
function resolve(work: Artwork): Promise<string[]> {
  const key = `${work.title}|${work.subtitle ?? ""}|${work.year ?? ""}`;
  let request = requests.get(key);
  if (!request) {
    const params = new URLSearchParams({ q: work.title, en: work.subtitle ?? work.title, ...(work.year ? { year: String(work.year) } : {}) });
    request = fetch(`/api/posters?${params}`, { signal: AbortSignal.timeout(20000) })
      .then(async (response) => response.ok ? await response.json() as { poster_urls?: string[] } : {})
      .then((data) => data.poster_urls ?? []).catch(() => []);
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

export function Poster({ work, kind, large = false }: { work: Artwork; kind: MediaKind; large?: boolean }) {
  const [resolved, setResolved] = useState<string[]>([]);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    setResolved([]); setFailed(new Set());
    if (kind === "film") void resolve(work).then((urls) => { if (active) setResolved(urls); });
    return () => { active = false; };
  }, [work.id, work.title, kind, large]);
  const urls = [...new Set([...resolved, ...(work.posterUrls ?? [])])];
  const url = urls.find((candidate) => !failed.has(candidate));
  const Icon = { film: Film, book: BookOpen, music: Music2, other: Library }[kind];
  return <div className={`poster ${large ? "poster-large" : "poster-small"} poster-${kind}`}>
    {url ? <img src={imageUrl(url)} alt={`${work.title} ${kind === "film" ? "海报" : "封面"}`} referrerPolicy="no-referrer" loading={large ? "eager" : "lazy"} onError={() => setFailed((previous) => new Set([...previous, url]))} /> :
      <div className="cover-fallback"><Icon size={large ? 36 : 16} />{large && <span>{work.title}</span>}</div>}
  </div>;
}
