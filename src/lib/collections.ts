import { mediaLabels, type Artwork, type MediaCollection, type MediaKind } from "../data/media";
import { normalizeTitle } from "./profile";

export function importCollection(kind: MediaKind, text: string): MediaCollection {
  if (text.length > 512 * 1024) throw new Error("List too large");
  let entries: unknown[];
  if (text.trim().startsWith("[") || text.trim().startsWith("{")) {
    const data: unknown = JSON.parse(text);
    entries = Array.isArray(data) ? data : typeof data === "object" && data !== null && "works" in data && Array.isArray(data.works) ? data.works : [];
  } else entries = text.split(/[\n,，、;；|｜]+/).map((title) => title.trim()).filter(Boolean);
  const seen = new Set<string>();
  const works: Artwork[] = [];
  for (const entry of entries) {
    const item = typeof entry === "string" ? { title: entry } : entry as Record<string, unknown>;
    if (!item || typeof item.title !== "string" || !item.title.trim() || item.title.length > 160) throw new Error("Invalid title");
    const title = item.title.trim();
    const year = Number(item.year) || undefined;
    if (year && (!Number.isInteger(year) || year < 1 || year > 2200)) throw new Error("Invalid year");
    const creator = typeof item.creator === "string" ? item.creator.trim().slice(0, 160) : undefined;
    const identity = `${normalizeTitle(title)}|${year ?? ""}|${normalizeTitle(creator ?? "")}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const urls = Array.isArray(item.posterUrls) ? item.posterUrls : item.poster_url ? [item.poster_url] : [];
    works.push({ id: `custom-${works.length}`, title, year, creator,
      ...(typeof item.subtitle === "string" ? { subtitle: item.subtitle.slice(0, 160) } : {}),
      posterUrls: urls.filter((url): url is string => { try { return typeof url === "string" && new URL(url).protocol === "https:"; } catch { return false; } }).slice(0, 8),
    });
  }
  if (works.length < 2 || works.length > 300) throw new Error("List must have 2 to 300 works");
  return { id: `custom-${kind}-${crypto.randomUUID()}`, kind, source: "custom", title: `我的${mediaLabels[kind].label}清单`, description: "", topN: Math.min(10, works.length), works };
}
