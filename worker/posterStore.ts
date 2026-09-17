import { posterMediaKey } from "./media";

/**
 * 海报地址持久化。
 *
 * 背景：榜单（尤其网易云导入的 150 首歌单）原本每次浏览都由前端分批现解析海报，
 * 而豆瓣对批量查询会回 418，结果大部分条目拿不到海报、只能显示占位图标。
 * 把解析结果按 `type|title|english|year` 落库后，同一榜单只有第一次需要回源。
 */
export type PosterMediaType = "movie" | "book" | "music";

/** 与前端 Poster.tsx 的 TYPE_BY_KIND 保持一致（other 不解析海报）。 */
export function mediaTypeForKind(kind: unknown): PosterMediaType | null {
  if (kind === "film") return "movie";
  if (kind === "book") return "book";
  if (kind === "music") return "music";
  return null;
}

export interface NormalizedPosterItem {
  title: string;
  english: string;
  year?: number;
  type: PosterMediaType;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || CONTROL_CHARS.test(trimmed)) return undefined;
  return trimmed;
}

/** year 兼容字符串数字（广场帖子的 JSON 里可能是字符串），归一化为 1800–2200。 */
export function normalizeYear(value: unknown): number | undefined {
  const asNumber = typeof value === "number" ? value
    : typeof value === "string" && /^\d{4}$/.test(value.trim()) ? Number(value.trim())
    : undefined;
  return asNumber !== undefined && Number.isInteger(asNumber) && asNumber >= 1800 && asNumber <= 2200 ? asNumber : undefined;
}

/**
 * 归一化一条待解析的海报条目；返回 null 表示该条不合法，调用方应丢弃。
 * 唯一实现：单条查询、批量查询、读取时挂载 posterUrls 三处共用，
 * 避免键推导漂移导致「存了但取不到」。
 */
export function normalizePosterItem(raw: { title?: unknown; english?: unknown; year?: unknown; type?: unknown }): NormalizedPosterItem | null {
  const title = cleanText(raw.title, 160);
  if (!title) return null;
  const type = raw.type === "book" || raw.type === "music" || raw.type === "movie" ? raw.type : null;
  if (!type) return null;
  return { title, english: cleanText(raw.english, 160) ?? "", type, year: normalizeYear(raw.year) };
}

/** 一条作品的持久化键；不合法或无需解析的条目返回 null。 */
export function posterKeyFor(raw: { title?: unknown; english?: unknown; year?: unknown; type?: unknown }): string | null {
  const item = normalizePosterItem(raw);
  return item ? posterMediaKey(item.title, item.english, item.type, item.year) : null;
}

function parseUrls(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((url) => typeof url === "string")
      ? parsed as string[]
      : null;
  } catch { return null; }
}

/**
 * 写穿：把解析到的海报地址落库。
 * 空结果刻意不落库——上游恢复后不应因为一条空记录而长期显示无海报。
 */
export async function saveResolvedPosters(
  db: D1Database | undefined,
  records: Array<{ key: string; urls: string[] }>,
): Promise<void> {
  if (!db) return;
  const deduped = new Map<string, string[]>();
  for (const record of records) {
    if (record.key && record.urls.length) deduped.set(record.key, record.urls);
  }
  if (!deduped.size) return;
  try {
    await db.batch([...deduped].map(([key, urls]) => db.prepare(
      "INSERT INTO poster_urls (media_key, urls, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) " +
      "ON CONFLICT(media_key) DO UPDATE SET urls = excluded.urls, updated_at = excluded.updated_at",
    ).bind(key, JSON.stringify(urls))));
  } catch (error) {
    // 迁移尚未应用到某个环境时不要让主流程 500。
    console.error("saveResolvedPosters failed:", error instanceof Error ? error.message : error);
  }
}

async function loadPosterUrls(db: D1Database, keys: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  const unique = [...new Set(keys)];
  const CHUNK = 90; // 保守：低于 SQLite 的绑定变量上限
  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    try {
      const rows = await db.prepare(
        `SELECT media_key, urls FROM poster_urls WHERE media_key IN (${slice.map(() => "?").join(", ")})`,
      ).bind(...slice).all<{ media_key: string; urls: string }>();
      for (const row of rows.results ?? []) {
        const urls = parseUrls(row.urls);
        if (urls) found.set(row.media_key, urls);
      }
    } catch (error) {
      console.error("loadPosterUrls failed:", error instanceof Error ? error.message : error);
      break;
    }
  }
  return found;
}

/**
 * 给一批作品挂上已持久化的海报地址；命中后前端不必再调 /api/posters/batch。
 * 本身已带 posterUrls 的条目原样保留。
 */
export async function attachStoredPosterUrls(
  db: D1Database | undefined,
  kind: unknown,
  items: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (!db || !items.length) return items;
  const type = mediaTypeForKind(kind);
  if (!type) return items;
  const keyByIndex = new Map<number, string>();
  items.forEach((item, index) => {
    // 前端发送的 english 是 `subtitle ?? title`，这里必须完全一致。
    const key = posterKeyFor({ title: item.title, english: item.subtitle ?? item.title, type, year: item.year });
    if (key) keyByIndex.set(index, key);
  });
  if (!keyByIndex.size) return items;
  const stored = await loadPosterUrls(db, [...keyByIndex.values()]);
  if (!stored.size) return items;
  return items.map((item, index) => {
    const existing = Array.isArray(item.posterUrls) ? item.posterUrls : [];
    if (existing.length) return item;
    const urls = stored.get(keyByIndex.get(index) ?? "");
    return urls ? { ...item, posterUrls: urls } : item;
  });
}
