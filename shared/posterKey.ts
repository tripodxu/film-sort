/**
 * 海报持久化键的唯一实现 —— 客户端（`src/components/Poster.tsx` 的兜底键）与
 * Worker（`worker/media.ts` 再导出给单条 route / 批量 route / 读取挂载三处）
 * 共用同一份代码。
 *
 * 为什么值一个 shared 模块：键一旦两端各写各，「存了但取不到」不会有任何
 * 报错信号，只会表现成海报时有时无；复审报告把这条列为必须共享的函数。
 *
 * 为什么 `other` 维度多一段代数：D1 `poster_urls` 行**无 TTL、永不过期**，
 * 而读侧不许删数据。2026-09-30「其他」（维基）解析器修完四轮消歧 bug 后，
 * 旧解析器写下的错图行仍在短路新代码——大角鸮当《动物森友会》封面、
 * 2012 道奇 Journey 当《风之旅人》封面、Stray 游戏封面当《蒙娜丽莎》封面。
 * 唯一的作废手段就是**换键**：给 `other` 键带代数后缀，旧键从此取不到
 * （孤儿化，像 cachePurge 的代次失效一样），新解析结果写到新键上。
 *
 * movie/book/music 三个维度历史上没有「错图永久短路」事故，刻意保持裸键：
 * 一次推平常意味着全站海报重新回源，豆瓣侧大概率回 418，代价远大于收益。
 */

/** 键段归一化：NFKC + 去首尾空白 + 小写。 */
export function posterKeySegment(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/** 海报条目的媒体类型。`other` = 维基系（走 wiki 取图管线）。 */
export type PosterMediaType = "movie" | "book" | "music" | "other";

/**
 * 前端 MediaKind → 海报媒体类型。客户端 `TYPE_BY_KIND` 与服务端
 * `mediaTypeForKind` 共用本函数——两边一旦漂移，同类条目会落到两个键上，
 * 表现成「海报时有时无」且没有任何报错。
 */
export function mediaTypeForKind(kind: unknown): PosterMediaType | null {
  if (kind === "film") return "movie";
  if (kind === "book") return "book";
  if (kind === "music") return "music";
  if (kind === "other") return "other";
  return null;
}

/**
 * 「其他」维度的解析器代数。解析逻辑（选页/消歧）升级后 +1。
 *
 * gen3（2026-10-02）：标题吻合闸门。旧算法里条目名只要**蹭到**用户标题的
 * 任一查询词就能靠「有 infobox 封面 / 摘要够长 / 命中类型词」这些弱信号堆分
 * 夺冠，线上因此留下三张错图——日常幻想→日常幻想指南一文里的曾俊贤签名照、
 *  故事FM→萧煌奇《我們的故事》专辑、看理想→《勇者斗恶龙》游戏封面。
 *  gen2 的 15 行缓存里就固化了这些错图，key 不换就永远是那张签名照。
 *
 * gen4（2026-10-02，迭代 3/20）：**缩略图桶宽**。这暴露了「其他维度」的
 * 代数还有一个更广的用途——它不只是解析算法的版本号，还是**缓存产物格式的
 * 版本号**。维基桶宽是**烧进 URL 字符串**的（`.../960px-....jpg`），所以任何
 * 尺寸策略改动都会让全部已缓存行变成过期行：线上蒙娜丽莎改完仍返回 960px，
 * 因为 D1 里那一行在解析之前就把结果短路了。代数 +1 即让 6 行自然失效，
 * 不需要写 DELETE 脚本——这正是 gen2→gen3 当初用来清 gen1 孤儿的手法。
 *
 * 服务端 `normalizeYear` 与前端都可能产出越界年份（《蒙娜丽莎》1503 在 API
 * 层就被丢掉），这里以同一口径兜一次，保证两端键一致。
 */
export const OTHER_POSTER_GENERATION = "4";

/** 与 posterStore.normalizeYear 同一口径（1800–2200 的整数）。 */
export function posterKeyYear(year?: number): number | undefined {
  return typeof year === "number" && Number.isInteger(year) && year >= 1800 && year <= 2200
    ? year
    : undefined;
}

/**
 * 海报条目的规范键：`type|title|english|year`，`other` 维度尾部多一段代数
 * （`other|title|english|year|<代数>`，代数值以 OTHER_POSTER_GENERATION 为准）。
 *
 * type 缺省按 `movie` 处理（与 sanitizePosterBatch 的兜底一致）。
 */
export function posterMediaKey(
  title: string,
  english: string,
  type?: string,
  year?: number,
): string {
  const base =
    (type ?? "movie") +
    "|" +
    posterKeySegment(title) +
    "|" +
    posterKeySegment(english) +
    "|" +
    (posterKeyYear(year) ?? "");
  // 只有「其他」维度带代数：见文件头关于 D1 无 TTL 的说明。
  return type === "other" ? base + "|" + OTHER_POSTER_GENERATION : base;
}
