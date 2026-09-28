import type { Env } from "./index";

// ===== "其他" 类别数据：维基百科（简介 + 图片）为主，百度百科兜底 =====
// 游戏/艺术/建筑等非影书音作品没有豆瓣条目，走维基多语言 + pageimages 取图。

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface OtherWork {
  id: string;
  title: string;
  subtitle?: string;
  year?: number;
  poster_url?: string;
  content_intro?: string;
  content_source?: string;
  detail_url?: string;
}

interface WikiPage {
  title?: string;
  extract?: string;
  missing?: boolean;
  thumbnail?: { source?: string };
  original?: { source?: string };
  description?: string;
  url?: string;
}

async function wikiJson(
  lang: "zh" | "en",
  params: URLSearchParams,
  timeoutMs: number,
): Promise<Record<string, WikiPage> | null> {
  try {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { query?: { pages?: Record<string, WikiPage> } };
    return d.query?.pages ?? null;
  } catch {
    return null;
  }
}

function toWork(page: WikiPage, lang: "zh" | "en"): OtherWork | null {
  const title = (page.title ?? "").trim();
  const extract = (page.extract ?? "").trim();
  if (!title || !extract || page.missing || extract.length < 20) return null;
  const year = extract.match(/\b(?:1[5-9]|20)\d{2}\b/)?.[0];
  const poster = page.original?.source ?? page.thumbnail?.source;
  return {
    id: `wiki-${lang}-${encodeURIComponent(title)}`,
    title,
    ...(page.description ? { subtitle: page.description } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(poster ? { poster_url: poster } : {}),
    content_intro: extract,
    content_source: `${lang}wiki`,
    detail_url:
      page.url ??
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  };
}

/** 其他类作品搜索：维基 opensearch 候选 + 摘要/图片批量拉取 */
export async function otherSearch(query: string): Promise<OtherWork[]> {
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return [];
  // 1) opensearch 拿候选标题
  let titles: string[] = [trimmed];
  try {
    const params = new URLSearchParams({
      action: "opensearch",
      search: trimmed,
      limit: "6",
      namespace: "0",
      format: "json",
    });
    const r = await fetch(`https://zh.wikipedia.org/w/api.php?${params}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const arr = (await r.json()) as [string, string[]];
      if (Array.isArray(arr?.[1]) && arr[1].length) titles = arr[1].slice(0, 6);
    }
  } catch {
    /* 直接用原标题 */
  }
  const full = () =>
    new URLSearchParams({
      action: "query",
      titles: titles.join("|"),
      prop: "extracts|pageimages|info",
      exintro: "true",
      explaintext: "true",
      pithumbsize: "600",
      inprop: "url",
      redirects: "1",
      format: "json",
    });
  // 2) 中文批量取摘要+图片，落空则英文
  const zhPages = await wikiJson("zh", full(), 9000);
  const zhWorks = zhPages
    ? Object.values(zhPages)
        .map((p) => toWork(p, "zh"))
        .filter((w): w is OtherWork => !!w)
    : [];
  if (zhWorks.length) return zhWorks;
  const enPages = await wikiJson("en", full(), 7000);
  return enPages
    ? Object.values(enPages)
        .map((p) => toWork(p, "en"))
        .filter((w): w is OtherWork => !!w)
    : [];
}

/** zh 条目的英文对应标题（langlinks）：en wiki 的 pageimages 覆盖面与 zh 不同，
 *  且 enwiki 对部分非自由封面（游戏/书）会返回主图——zh 查不到图时的第二机会。 */
export async function wikiEnTitle(title: string): Promise<string | null> {
  const q = new URLSearchParams({
    action: "query",
    titles: title.trim().slice(0, 120),
    prop: "langlinks",
    lllang: "en",
    lllimit: "1",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const pages = await wikiJson("zh", q, 7000);
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const langlinks = page as WikiPage & { langlinks?: Array<{ "*": string }> };
    const en = langlinks.langlinks?.[0]?.["*"];
    if (en) return en;
  }
  return null;
}

/** 其他类作品详情：精确标题直查（中/英）。
 *  注：曾有百度百科 openapi 兜底，2026-09-28 实测已废弃（恒返回 errno 6），
 *  纯拖 8s 超时——已移除；简介与图均以维基为准。 */
export async function otherDetail(name: string): Promise<OtherWork | null> {
  const title = name.trim().slice(0, 120);
  if (!title) return null;
  const q = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts|pageimages|info",
    exintro: "true",
    explaintext: "true",
    pithumbsize: "600",
    inprop: "url",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const zhPages = await wikiJson("zh", q, 9000);
  const zhWork = zhPages
    ? Object.values(zhPages)
        .map((p) => toWork(p, "zh"))
        .find(Boolean)
    : null;
  if (zhWork) return zhWork;
  const enPages = await wikiJson("en", q, 7000);
  const enWork = enPages
    ? Object.values(enPages)
        .map((p) => toWork(p, "en"))
        .find(Boolean)
    : null;
  return enWork ?? null;
}
