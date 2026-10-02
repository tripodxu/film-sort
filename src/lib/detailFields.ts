/**
 * 作品详情弹窗的「后端键 → 界面字段」翻译层（PLAN-DETAIL-DIALOG-A11Y §3.2）。
 *
 * 为什么需要它：旧实现直接 `Object.entries(detail.data)` 渲染，于是**后端返回了
 * 什么就印什么**。2026-10-02 线上实测的后果：
 *
 *   other → id = wiki-zh-%E9%A3%8E%E4%B9%8B%E6%97%85%E4%BA%BA（44 字符内部键）
 *          poster_url = https://upload.wikimedia.org/...（150 字符裸 URL）
 *          detail_url = https://zh.wikipedia.org/wiki/...（66 字符 URL）
 *   book  → author_intro = 389 字符作者生平，挤在一行里和「作者」并列
 *   music → matchedTitle（纯内部字段，对人零价值）
 *   movie → year / type / country / duration / actors 全是英文键名
 *
 * API 是给程序读的：它有内部键、有 URL、有长文本。界面需要的是**人能读懂的
 * 几个字段**。中间这层翻译以前是缺的，`slice(0, 8)` 是在缺口上打的补丁——
 * 用一个数字掩盖「从来没选过」，而且顺序还跟着响应 JSON 的插入序走。
 *
 * 本模块是纯函数：vitest 是 node 环境（无 jsdom），这样才测得了。
 */

/** 一行详情字段。`long` = 长文本，不进 `<dl>`，走块级排版。 */
export interface DetailField {
  /**
   * 后端原始键名，只给 React 的 `key` 用，**不给人看**。
   *
   * 为什么不能拿 `label` 当 key：`book` 的响应里同时有 `author`（译成「作者」）和
   * 原始中文键 `作者`（保底照印），两个字段的 label 撞在一起。React 拿到重复 key
   * 会警告并可能错位复用 DOM——而这正是本次要修的那类「界面细节」问题。
   */
  key: string;
  /** 已经翻译好的标签（走 `t()`）。未知键就是原始键名。 */
  label: string;
  value: string;
  /** 长文本：调用方应当把它渲染成段落而不是表格行。 */
  long?: boolean;
}

/**
 * 内部键：永远不显示。
 *
 * 逐条理由（不是「看着像内部字段」就扔）：
 * - `id`：服务端拼的缓存键，percent-encoded，人读不出任何信息。
 * - `poster_url` / `pic` / `imgs`：海报已经显示在弹窗左侧，重复印 URL 没有价值。
 * - `detail_url`：其它类作品卡上已有「查看来源」入口指向它。
 * - `matchedTitle`：music 兜底链匹配到的标题，是排查用的中间产物。
 * - `title`：弹窗标题就是它，重复印一遍是噪音（旧实现也在 SKIP 里，别弄丢）。
 * - `content_intro` / `content_source`：已由简介段落单独呈现（见调用点）。
 * - `rating`：已由 `.detail-meta` 单独呈现。
 */
const INTERNAL_KEYS = new Set([
  "id",
  "title",
  "pic",
  "imgs",
  "poster_url",
  "detail_url",
  "matchedTitle",
  "content_intro",
  "content_source",
  "rating",
]);

/**
 * 已知键 → 中英文标签。
 *
 * 用数组而不是对象字面量：**顺序 = 界面显示顺序，而显示顺序不该跟着后端
 * 响应里字段的插入序变**（旧实现正是这么不稳的）。
 */
const KNOWN_FIELDS: ReadonlyArray<readonly [key: string, zh: string, en: string]> = [
  ["director", "导演", "Director"],
  ["author", "作者", "Author"],
  ["artist", "演唱", "Artist"],
  ["actors", "主演", "Cast"],
  ["type", "类型", "Genre"],
  ["country", "地区", "Region"],
  ["duration", "片长", "Runtime"],
  ["press", "出版社", "Publisher"],
  ["date", "出版日期", "Published"],
  ["album", "专辑", "Album"],
  ["year", "年份", "Year"],
];

/** 超过这个长度就当长文本，不挤在表格行里（实测 `author_intro` 389 字符）。 */
const LONG_VALUE_CHARS = 80;

/**
 * 值渲染成一行字符串。数组用「、」连接（沿用旧实现的口径）。
 *
 * ⚠️ 连接前先滤掉空元素：`["", null, "徐凯鑫"]` 直接 join 会得到 `、null、徐凯鑫`，
 * 界面上就是一行带字面量 `null` 和前导顿号的文本。整段全空时返回空串，
 * 交给 `isPresent` 的上一步判定（调用方先判空再转）。
 */
function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter(isPresent)
      .map((item) => String(item))
      .join("、");
  }
  return String(value);
}

/**
 * 这个值该不该出现在界面上？
 *
 * ⚠️ 判空**必须在 stringify 之前**。`String(null)` 是 `"null"`、`String(undefined)`
 * 是 `"undefined"`——先转字符串再判 `!text.trim()` 的话，这两种值会以字面量
 * "null" / "undefined" 出现在界面上。这是本模块第一版真实踩到的坑：
 * 我把旧实现的 `.filter(([, value]) => value && …)` 直接翻译成「先 stringify
 * 再 trim 判空」，结果 null 字段全都漏了出来，被测试当场抓住。
 */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some((item) => isPresent(item));
  return true;
}

/**
 * 把后端 `data` 翻译成给人看的字段列表。
 *
 * 契约（三条，按优先级）：
 * 1. 内部键永不出现（`INTERNAL_KEYS`）。
 * 2. 已知键走字典且**按字典顺序**排在前面；未知键保底照印（标签就是原键名），
 *    不丢信息——ROADMAP E1 原文要求的行为，排在已知键之后、保持响应里的相对次序。
 * 3. 空值跳过（沿用旧实现 `.filter(([, value]) => value && …)` 的意思），
 *    但判空在 stringify **之前**做——`String(null)` 是 `"null"`，先转再判会让
 *    null 字段以字面量出现在界面上（第一版真实踩过，见 `isPresent`）。
 *
 * 返回值**已按 long 分组**（短字段在前），但 `splitDetailFields` 仍保留，
 * 因为调用方只想拿其中一拨时不必自己过滤。
 */
export function detailFields(
  data: Record<string, unknown> | null | undefined,
  t: (zh: string, en: string) => string,
): DetailField[] {
  if (!data) return [];

  // 先按响应顺序收集候选（已知 + 未知），值已 stringify，空值已剔除。
  const seen = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    if (INTERNAL_KEYS.has(key)) continue;
    if (!isPresent(value)) continue;
    seen.set(key, stringifyValue(value));
  }

  const rows: DetailField[] = [];
  const blocks: DetailField[] = [];
  const claimed = new Set<string>();

  const push = (field: DetailField) => (field.long ? blocks : rows).push(field);

  // 已知键按字典顺序。
  for (const [key, zh, en] of KNOWN_FIELDS) {
    const text = seen.get(key);
    if (text === undefined) continue;
    claimed.add(key);
    const field: DetailField = { key, label: t(zh, en), value: text };
    if (text.length > LONG_VALUE_CHARS) field.long = true;
    push(field);
  }
  // 未知键保底照印，标签就是原始键名，保持响应里的相对次序。
  for (const [key, text] of seen) {
    if (claimed.has(key)) continue;
    const field: DetailField = { key, label: key, value: text };
    if (text.length > LONG_VALUE_CHARS) field.long = true;
    push(field);
  }
  return [...rows, ...blocks];
}

/** 便捷分类：把字段拆成「表格行」与「块级段落」两拨。 */
export function splitDetailFields(fields: readonly DetailField[]): {
  rows: DetailField[];
  blocks: DetailField[];
} {
  const rows: DetailField[] = [];
  const blocks: DetailField[] = [];
  for (const field of fields) (field.long ? blocks : rows).push(field);
  return { rows, blocks };
}
