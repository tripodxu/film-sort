// ===== "其他" 类别数据：维基百科（简介 + 图）为主 =====
// 游戏/艺术/建筑等非影书音作品没有豆瓣条目，走维基多语言。
//
// 2026-09-30 迭代，三条链路一起改造（实测 sort.logicc.top 复现的错配）：
// ① 取图主链从 pageimages（对非自由封面**恒空**）切到 pageprops.page_image
//    （infobox 封面文件名，非自由文件也有值，需再打一次 imageinfo 换 URL），
//    保留 images→imageinfo 直取做补充；
// ② 消歧页用 pageprops.disambiguation **机械剔除**，替代正则猜「可以指」；
// ③ 详情/搜索从「opensearch 首条直进」改为「标题分隔符变体 + gsrsearch 评分
//    择优」：年份硬过滤（用户给了年份就优先摘述带该年份的条目）→ 限定词/
//    类型词/封面/深度打分消歧（修「动物森友会」命中系列页、「Inside」命中
//    消歧页、「Journey」命中乐团这类错配）。

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
  description?: string;
  missing?: boolean;
  /** pageprops：page_image = infobox 封面文件名（非自由封面也有值）；
   *  disambiguation = 消歧页权威标记（值为空串）。 */
  pageprops?: Record<string, string>;
  /** pageprops.page_image 换出的 URL（fillPageImageUrls 填入） */
  fileUrl?: string;
  thumbnail?: { source?: string };
  original?: { source?: string };
  url?: string;
}

/** 「其他」类作品类型词（游戏/影视/绘画/建筑…）：只判断「像不像一件作品」，
 *  具体类型细分交给 declareType + TYPE_WORDS；消歧由年份/限定词/评分承担。 */
export const OTHER_TYPE_WORDS =
  /(电子游戏|電子遊戲|电子游艺|電子遊藝|電動遊戲|视频游戏|視頻遊戲|游戏|遊戲|电玩|電玩|游戏机|遊戲機|电影|電影|影片|剧情片|劇情片|动画片|動畫片|电视剧|電視劇|纪录片|紀錄片|小说|小說|长篇|長篇|短篇|专辑|專輯|唱片|歌曲|单曲|單曲|画作|畫作|绘画|繪畫|油画|油畫|素描|建築|建筑|雕塑|漫畫|漫画|歌剧|歌劇|动漫|動漫|摄影|攝影)/i;

/** gsrsearch 类型后缀：「其他」维度九成是游戏，先用游戏词收窄；
 *  艺术/建筑条目靠「纯标题轮」兜住（见 resolveOtherPages）。 */
export const OTHER_HINT: Record<"zh" | "en", string> = { zh: "电子游戏", en: "video game" };

const YEAR_RE = /\b(?:1[5-9]|20)\d{2}\b/;

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

/** 标题分隔符变体：用户写「底特律 变人」而条目名是「底特律：变人」。
 *  实测只有「空格」是维基 redirect，半角冒号与「空格+全角」组合都不是，
 *  必须自己拼变体一并发给 titles 一起解析。 */
function titleVariants(base: string): string[] {
  return [
    ...new Set([
      base,
      base.replace(/\s+/g, "："),
      base.replace(/\s+/g, ":"),
      base.replace(/\s+/g, ""),
    ]),
  ].slice(0, 4);
}

/** 压缩标题去分隔符/括号/标点：用于标题互相包含判定。
 *  注意**不做简繁转换**——简繁失配交给搜索结果本身（用户简体词可搜到
 *  繁体条目页）与 extract 匹配，标题比较只做静态兜底。 */
function compactTitle(value: string): string {
  return value.replace(/[\s：:·・、，,。.．!！?？"'“”‘’()（）[\]【】{}_-]/g, "").toLowerCase();
}

function isDisambiguation(page: WikiPage): boolean {
  return (page.pageprops ?? {}).disambiguation !== undefined;
}

/** pageprops.page_image 是文件名（无 File: 前缀），imageinfo 才能换 URL */
function normFile(value: string): string {
  return value
    .replace(/^File:/i, "")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

/** 批量把 pageprops.page_image 换成 URL（一次 imageinfo 顶 50 个文件），
 *  结果写回 page.fileUrl。media.ts 的维基评分链也要用，故导出。 */
export async function wikiFileThumbUrls(
  lang: "zh" | "en",
  files: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!files.length) return out;
  const asked = new Map<string, string>();
  const titles: string[] = [];
  for (const raw of files) {
    const name = raw.trim();
    if (!name) continue;
    const title = name.startsWith("File:") ? name : `File:${name}`;
    asked.set(normFile(name), name);
    titles.push(title);
  }
  for (let index = 0; index < titles.length; index += 50) {
    const q = new URLSearchParams({
      action: "query",
      titles: titles.slice(index, index + 50).join("|"),
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "600",
      format: "json",
    });
    const pages = await wikiJson(lang, q, 8000);
    for (const page of Object.values(pages ?? {})) {
      const infos = (page as WikiPage & { imageinfo?: Array<{ url?: string; thumburl?: string }> })
        .imageinfo;
      const url = infos?.[0]?.thumburl ?? infos?.[0]?.url;
      const title = (page.title ?? "").trim();
      const original = title ? asked.get(normFile(title)) : undefined;
      if (url && original) out.set(original, url.replace(/^http:/, "https:"));
    }
  }
  return out;
}

/** 单个封面文件名换 URL（wikiPageImageAny 用） */
async function wikiFileThumbUrl(lang: "zh" | "en", file: string): Promise<string | null> {
  const map = await wikiFileThumbUrls(lang, [file]);
  return map.get(file) ?? null;
}

/** 给候选页批量补 pageprops.page_image 的 URL（一次 imageinfo，不逐个打） */
async function fillPageImageUrls(lang: "zh" | "en", pages: WikiPage[]): Promise<void> {
  const files = pages
    .map((page) => page.pageprops?.page_image ?? "")
    .filter((value): value is string => !!value.trim());
  if (!files.length) return;
  const map = await wikiFileThumbUrls(lang, files);
  for (const page of pages) {
    const file = page.pageprops?.page_image ?? "";
    const url = file ? map.get(file) : undefined;
    if (url) page.fileUrl = url;
  }
}

/** 候选页评分（详情与封面共用）：
 *  +3 页标题含用户标题（或反向）+3 条目名带作品限定词（(游戏)/(video game)）
 *  +2 摘要命中作品类型词 +1.5 有 infobox 封面文件 +1 有 pageimages 缩略图
 *  +1 摘要够长（内容深度） -3 系列页/消歧语式（命中同类条目时压下去）
 *  消歧页（pageprops.disambiguation）直接淘汰。 */
function scoreOtherPage(page: WikiPage, compactBase: string, year?: string): number {
  const title = (page.title ?? "").trim();
  if (!title || page.missing || isDisambiguation(page)) return -Infinity;
  const extract = page.extract ?? "";
  const compact = compactTitle(title);
  const text = `${extract} ${page.description ?? ""}`.trim();
  let score = 0;
  if (
    compact &&
    (compact.includes(compactBase) || (compactBase.length > 1 && compactBase.includes(compact)))
  )
    score += 3;
  if (/[（(【\[]/.test(title) && OTHER_TYPE_WORDS.test(title)) score += 3;
  if (text && OTHER_TYPE_WORDS.test(text)) score += 2;
  if ((page.pageprops ?? {}).page_image) score += 1.5;
  if (page.thumbnail?.source ?? page.original?.source) score += 1;
  if (extract.length >= 80) score += 1;
  if (/(系列|以下条目|可以指|可指|消歧义|消歧義)/.test(`${title} ${extract}`)) score -= 3;
  if (year && text.includes(year)) score += 2;
  // 条目自身的首个年份 ≠ 用户年份时降权（「摘要里提到 2012」的同名异作，
  // 典型：西遊記 extract 带 2012，条目本体是 1996 电视剧）
  if (year) {
    const own = (extract.match(YEAR_RE) ?? [])[0];
    if (own && own !== year) score -= 2;
  }
  return score;
}

/** gsrsearch 候选 + pageprops 摘要/图片（generator=search 会顺带回
 *  系列页与消歧页，必须靠评分把作品条目顶上来） */
async function wikiSearchOnce(lang: "zh" | "en", query: string): Promise<WikiPage[]> {
  const q = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "6",
    prop: "extracts|pageimages|pageprops|info",
    piprop: "original|thumbnail",
    pithumbsize: "600",
    exintro: "true",
    explaintext: "true",
    exlimit: "20",
    inprop: "url",
    redirects: "1",
    format: "json",
  });
  const pages = await wikiJson(lang, q, 9000);
  return pages ? Object.values(pages) : [];
}

/** 评分择优：每个查询词跑「纯标题轮 + 作品类型词轮」，同页去重后按分排序。
 *  两轮都必须跑：纯标题轮常被同名异作占据（线上实测 zh gsrsearch("Journey")
 *  首位是《西遊記》且带封面），若因「已见到封面」就跳过类型词轮，正确的
 *  「风之旅人」永远进不了候选集（2026-09-30 线上复测的教训）。 */
async function resolveOtherPages(
  lang: "zh" | "en",
  baseTitle: string,
  queries: readonly string[],
  year?: string,
): Promise<Array<{ page: WikiPage; score: number }>> {
  const compactBase = compactTitle(baseTitle);
  const seen = new Set<string>();
  const scored: Array<{ page: WikiPage; score: number }> = [];
  for (const query of queries) {
    for (const search of [query, `${query} ${OTHER_HINT[lang]}`]) {
      for (const page of await wikiSearchOnce(lang, search)) {
        const title = (page.title ?? "").trim();
        if (!title || seen.has(title)) continue;
        seen.add(title);
        const score = scoreOtherPage(page, compactBase, year);
        if (score > -Infinity) scored.push({ page, score });
      }
    }
  }
  return scored.sort((a, b) => b.score - a.score);
}

/** 从候选页里挑最优：给了年份就优先摘述命中该年份的条目（用户清单格式是
 *  「标题 - 游戏 (年)」，年份是消歧的最硬信号——动物森友会实测：系列页/
 *  2001 首作都不带 2020，2020 正作带），没有年份命中的候选才放宽。
 *  分三档：条目自身年份 == 用户年份 > 摘要提到用户年份 > 全体第一。 */
function pickBest(
  candidates: Array<{ page: WikiPage; score: number }>,
  year?: string,
): { page: WikiPage; score: number } | null {
  if (!candidates.length) return null;
  if (!year) return candidates[0];
  const mentions = candidates.filter((entry) => {
    const text = `${entry.page.extract ?? ""} ${entry.page.description ?? ""}`;
    return text.includes(year);
  });
  const exact = mentions.filter((entry) => (entry.page.extract ?? "").match(YEAR_RE)?.[0] === year);
  return (exact.length ? exact : mentions.length ? mentions : candidates)[0];
}

async function toWork(page: WikiPage, lang: "zh" | "en"): Promise<OtherWork | null> {
  const title = (page.title ?? "").trim();
  const extract = (page.extract ?? "").trim();
  if (!title || !extract || page.missing || extract.length < 20) return null;
  // 消歧页（「X 可以指：…」）不是作品介绍，机械剔除
  if (isDisambiguation(page)) return null;
  const year = extract.match(YEAR_RE)?.[0];
  const poster = (page.original?.source ?? page.thumbnail?.source ?? page.fileUrl)?.replace(
    /^http:/,
    "https:",
  );
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

/** 标题精确查询（含分隔符变体）拿候选页 */
async function wikiTitlePages(
  lang: "zh" | "en",
  titles: readonly string[],
): Promise<WikiPage[] | null> {
  const q = new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    prop: "extracts|pageimages|pageprops|info",
    exintro: "true",
    explaintext: "true",
    pithumbsize: "600",
    exlimit: "20",
    inprop: "url",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const pages = await wikiJson(lang, q, 9000);
  return pages ? Object.values(pages) : null;
}

/** 其他类作品搜索：gsrsearch 评分择优（替代 opensearch——实测 opensearch
 *  对「动物森友会」只回 6 个简体错页，且会把 Journey(EP專輯) 这类同名
 *  音乐页排到游戏页前面）。 */
export async function otherSearch(query: string): Promise<OtherWork[]> {
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return [];
  for (const lang of ["zh", "en"] as const) {
    const scored = await resolveOtherPages(lang, trimmed, [trimmed]);
    if (!scored.length) continue;
    const pages = scored.slice(0, 6).map((entry) => entry.page);
    await fillPageImageUrls(lang, pages);
    const works = (await Promise.all(pages.map((page) => toWork(page, lang)))).filter(
      (work): work is OtherWork => !!work,
    );
    if (works.length) return works;
  }
  return [];
}

/** zh 条目的英文对应标题（langlinks）：en wiki 的封面链与 zh 不同，
 *  zh 查不到图时的第二机会。 */
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

/** 条目主图直取（含非自由封面）：pageprops.page_image（infobox 封面）优先，
 *  其次 images→imageinfo 直取（游戏封面在 pageimages 里恒空）。
 *  文件名优先匹配用户标题/英文标题关键词——文章内相关画作按文件名字母序
 *  会抢在主图前（蒙娜丽莎实测命中拉斐尔《巴尔达萨雷·卡斯蒂廖内》），
 *  没有命中关键词就宁可返回 null，交给上层兜底（早期 files[0] 兜底把
 *  动物森友会命中成大角鸮照片）。 */
export async function wikiPageImageAny(
  lang: "zh" | "en",
  title: string,
  /** 文件名匹配的优先关键词（用户标题 + 英文标题——zh 简繁变体会让标题评分
   *  失败落到这里，而条目内文件名常是英文，如 Mona Lisa）。 */
  preferTitles: readonly string[] = [],
): Promise<string | null> {
  const base = title.trim().slice(0, 120);
  if (!base) return null;
  const variants = titleVariants(base);
  const list = new URLSearchParams({
    action: "query",
    titles: variants.join("|"),
    prop: "images|pageprops",
    imlimit: "12",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const pages = await wikiJson(lang, list, 8000);
  if (!pages) return null;
  const compactBase = compactTitle(base);
  const candidates = Object.values(pages).filter(
    (page) => !page.missing && (page.title ?? "").trim() && !isDisambiguation(page),
  );
  // 优先选「页标题含原题全部字词」的条目（游戏条目而非同名城市/概念）。
  // 比较时把页标题里的分隔符（空格/全角冒号/中点）一并剥掉——否则
  // 「底特律：变人」永远不 includes「底特律变人」。
  const page =
    candidates.find((page) => compactTitle(page.title ?? "").includes(compactBase)) ??
    candidates[0];
  if (!page) return null;
  await fillPageImageUrls(lang, [page]);
  if (page.fileUrl) return page.fileUrl;
  const images = (page as WikiPage & { images?: Array<{ title?: string }> }).images ?? [];
  const SKIP = /icon|logo|edit|commons|symbol|flag|question|placeholder|disambig/i;
  // 文件名含标题字词者优先：文章内相关画作按字母序会抢在主图前
  const prefers = [compactBase, ...preferTitles]
    .map((value) => value.replace(/[\s：:·・（）()]/g, "").toLowerCase())
    .filter(Boolean);
  const file = images
    .map((image) => image.title ?? "")
    .filter((name) => name.startsWith("File:") && /\.(jpe?g|png)$/i.test(name) && !SKIP.test(name))
    .find((name) => {
      const compact = name.slice(5).replace(/[\s_]/g, "").toLowerCase();
      return prefers.some((prefer) => prefer && compact.includes(prefer));
    });
  if (!file) return null;
  return wikiFileThumbUrl(lang, file);
}

/** 其他类作品封面：gsrsearch 评分择优 + infobox 封面文件（pageprops.page_image）。
 *  覆盖「精确标题是系列页/消歧页/同名概念页」的场景——动物森友会实测 zh 精确
 *  标题落到「動物森友會系列」，而 2020 正作「集合啦！動物森友會」要靠搜索
 *  + 年份才能顶上来。 */
export async function resolveOtherCover(
  title: string,
  english: string,
  year?: number,
): Promise<string | null> {
  const base = title.trim().slice(0, 120);
  if (!base) return null;
  const yearText = year && year >= 1500 && year <= 2100 ? String(year) : undefined;
  for (const lang of ["zh", "en"] as const) {
    const queries = (lang === "zh" ? [base, english] : [english, base])
      .map((value) => (value ?? "").trim())
      .filter(Boolean);
    if (!queries.length) continue;
    const ranked = await resolveOtherPages(lang, base, queries, yearText);
    const best = pickBest(ranked, yearText);
    if (!best) continue;
    const top = [best, ...ranked.slice(ranked.indexOf(best) + 1, ranked.indexOf(best) + 3)];
    await fillPageImageUrls(
      lang,
      top.map((entry) => entry.page),
    );
    // 先按评分取前 3 名要 infobox 封面文件，都没有才退回 pageimages 缩略图
    for (const entry of top) {
      const file = entry.page.pageprops?.page_image ?? "";
      if (file && entry.page.fileUrl) return entry.page.fileUrl;
    }
    for (const entry of top) {
      const url = entry.page.thumbnail?.source ?? entry.page.original?.source;
      if (url) return url.replace(/^http:/, "https:");
    }
  }
  return null;
}

/** 其他类作品详情：标题变体精确直查 + 评分择优兜底。
 *  注：曾有百度百科 openapi 兜底，2026-09-28 实测已废弃（恒返回 errno 6），
 *  纯拖 8s 超时——已移除；简介与图均以维基为准。
 *  @param year 用户条目带的年份（清单格式「标题 - 游戏 (年)」）：消歧用，
 *    精确页不是该年份作品时按搜索/年份重择优。 */
export async function otherDetail(name: string, year?: number): Promise<OtherWork | null> {
  const base = name.trim().slice(0, 120);
  if (!base) return null;
  const yearText = year && year >= 1500 && year <= 2100 ? String(year) : undefined;
  for (const lang of ["zh", "en"] as const) {
    // ① 精确标题（含分隔符变体）直查
    const exactPages = await wikiTitlePages(lang, titleVariants(base));
    let exactScore = -Infinity;
    let exactWork: OtherWork | null = null;
    if (exactPages?.length) {
      const scored = exactPages
        .map((page) => ({ page, score: scoreOtherPage(page, compactTitle(base), yearText) }))
        .filter((entry) => entry.score > -Infinity)
        .sort((a, b) => b.score - a.score);
      const best = pickBest(scored, yearText);
      if (best) {
        exactScore = best.score;
        await fillPageImageUrls(lang, [best.page]);
        exactWork = await toWork(best.page, lang);
      }
    }
    // 够好就直接返回：有类型词/限定词/封面这类作品特征；给了年份时还要求
    // 条目本身就说的是那一年（否则按「系列页/同类条目」继续往下择优）
    const exactText = exactWork
      ? `${exactWork.content_intro ?? ""} ${exactWork.subtitle ?? ""}`
      : "";
    if (exactWork && exactScore >= 6 && (!yearText || exactText.includes(yearText)))
      return exactWork;
    // ② 精确页是系列页/同名概念页/无封面（评分不够）时，gsrsearch 评分择优
    const searched = await resolveOtherPages(lang, base, [base], yearText);
    const searchBest = pickBest(searched, yearText);
    if (searchBest) {
      await fillPageImageUrls(lang, [searchBest.page]);
      const searchWork = await toWork(searchBest.page, lang);
      if (searchWork && searchBest.score > (exactWork ? exactScore : -Infinity)) return searchWork;
    }
    if (exactWork) return exactWork;
  }
  return null;
}
