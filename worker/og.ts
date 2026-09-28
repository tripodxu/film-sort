/**
 * 分享页与广场帖的 OG 元数据注入。
 *
 * 爬虫(Telegram/Discord/iMessage/Twitter)不发 JS,拿到的 SPA 空壳在聊天
 * 预览里只是一条裸链接。这里在 worker 端对 /share/:code 与 /plaza/:id 的
 * HTML 请求注入 og:/twitter: 标签:标题、描述、首位作品海报。
 *
 * 安全:标题/作者/作品名全部是用户可控内容,进 meta 前必须经 escapeHtml;
 * 注入点固定在 </head> 之前,找不到注入点时原样返回(降级为无 OG 的 SPA)。
 */

export interface OgTags {
  title: string;
  description: string;
  image?: string;
  url?: string;
}

const ENTITY: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ENTITY[ch] ?? ch);
}

/** 用户可控文本的统一护栏:压平空白 + 截断 + 转义。 */
export function ogText(value: string, max = 120): string {
  return escapeHtml(value.replace(/\s+/g, " ").trim().slice(0, max));
}

export function buildOgMeta(tags: OgTags): string {
  const lines = [
    `<meta property="og:title" content="${tags.title}" />`,
    `<meta property="og:description" content="${tags.description}" />`,
    `<meta property="og:type" content="website" />`,
  ];
  if (tags.image) lines.push(`<meta property="og:image" content="${tags.image}" />`);
  if (tags.url) lines.push(`<meta property="og:url" content="${tags.url}" />`);
  // Twitter 不读 og:description 之外的卡型声明,补 summary_large_image 提升预览
  lines.push(
    `<meta name="twitter:card" content="${tags.image ? "summary_large_image" : "summary"}" />`,
  );
  return lines.join("");
}

/** 在 </head> 前插入;找不到结构锚点时原样返回(降级为无 OG)。 */
export function injectOg(html: string, meta: string): string {
  const index = html.toLowerCase().indexOf("</head>");
  if (index < 0) return html;
  return `${html.slice(0, index)}${meta}${html.slice(index)}`;
}

interface ShareProfileShape {
  profileName?: string;
  rankings?: Array<{
    collectionTitle?: string;
    kind?: string;
    items?: Array<{ title?: string }>;
  }>;
}

export function buildShareTags(rawProfile: string, url: string): OgTags | null {
  let profile: ShareProfileShape;
  try {
    profile = JSON.parse(rawProfile) as ShareProfileShape;
  } catch {
    return null;
  }
  const rankings = Array.isArray(profile.rankings) ? profile.rankings : [];
  const first = rankings[0];
  if (!first || !Array.isArray(first.items) || first.items.length === 0) return null;
  const name = ogText(profile.profileName ?? "", 60) || "一位用户";
  const listTitle = ogText(first.collectionTitle ?? "", 80);
  const count = first.items.length;
  const top = first.items[0]?.title ? ogText(first.items[0].title, 80) : "";
  const more =
    rankings.length > 1 ? `${rankings.length} 份榜单` : `${listTitle || "榜单"} · Top ${count}`;
  return {
    title: `${name} 的艺术人格`,
    description: top ? `${more} · No.1《${top}》` : more,
    url,
  };
}

export interface PlazaOgRow {
  collection_title: string;
  kind: string;
  item_count: number;
  nickname: string | null;
  items: string;
  topPosterUrl?: string | null;
}

export function buildPlazaTags(row: PlazaOgRow, url: string, origin: string): OgTags | null {
  const listTitle = ogText(row.collection_title ?? "", 80);
  if (!listTitle) return null;
  const author = ogText(row.nickname ?? "", 40) || "一位用户";
  let top = "";
  try {
    const items = JSON.parse(row.items) as Array<{ title?: string }>;
    top = items[0]?.title ? ogText(items[0].title, 80) : "";
  } catch {
    /* items 畸形时只降级描述,不失败 */
  }
  const kindText: Record<string, string> = {
    film: "电影",
    book: "书籍",
    music: "音乐",
    other: "作品",
  };
  const kind = kindText[row.kind] ?? "作品";
  return {
    title: `${listTitle} · 文化广场`,
    description: `${author} 的${kind}榜单 · ${row.item_count} 件作品${top ? ` · No.1《${top}》` : ""}`,
    image: row.topPosterUrl ? absolutizePoster(row.topPosterUrl, origin) : undefined,
    url,
  };
}

/** 海报地址转爬虫可用的绝对 URL:豆瓣系必须走图片代理(无 referer 会被 418)。 */
export function absolutizePoster(posterUrl: string, origin: string): string | undefined {
  try {
    const parsed = new URL(posterUrl);
    if (/^img\d+\.doubanio\.com$/.test(parsed.hostname))
      return `${origin}/api/image?url=${encodeURIComponent(posterUrl)}`;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
