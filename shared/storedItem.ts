/**
 * 「可落库形状」的唯一实现 —— 客户端（src/）与 Worker（worker/）共用同一份代码。
 *
 * 背景：512KB 事件之后仓库里留下了三套各写各的「可落库形状」：
 *   - `src/lib/profile.ts` 的白名单（保留 posterUrls）
 *   - `src/lib/useSorting.ts` 手写的同样 6 个字段
 *   - `worker/account.ts` 的 `delete item.posterUrls`
 * 而真正能写进 `items` 的路径有 5 条、只有 1 条带护栏，于是补丁反复出现——
 * 漏掉一处没有任何信号。
 *
 * 本模块把语义收敛为唯一实现，并给出两条结构性保证：
 *
 * 1. **白名单式投影，而不是 `delete`**。`posterUrls` 之所以进不去库，是因为它
 *    压根不在白名单里；以后任何新增的本地渲染字段（cacheKey / thumbnail /
 *    loading …）默认同样进不去，不需要记得加护栏。
 * 2. **编码出口唯一**。只有 `encode*` 能产出可落库字符串，并且统一用
 *    `TextEncoder` 的**字节**口径判定体积（原先 plaza 用 `raw.length`
 *    的 UTF-16 码元口径，对中文实际放行到约 3 倍）。
 */

/** 载荷的字节上限。所有落库路径共用同一个数字，避免口径漂移。 */
export const MAX_PAYLOAD_BYTES = 512 * 1024;

/**
 * 可落库作品的全部字段。
 *
 * `id` / `rank` 刻意是可选的：榜单作品（`RankingExport.items`）两者都有，
 * 而「我的清单」（`user_collections.items`）从来只有 `id` 没有 `rank`。
 * 若照搬 `parseRanking` 把 `rank` 定为必填，收藏路径会把整批作品判为非法而清空
 * —— 这是「统一形状」最容易踩的回归。这里只把两侧共同的部分设为必填（`title`）。
 */
export interface StoredWork {
  id?: string;
  title: string;
  rank?: number;
  creator?: string;
  year?: number;
  subtitle?: string;
}

/**
 * 白名单字段表。新增本地渲染字段时**不要**往这里加——
 * 它一旦出现，就同时意味着「可以进库」。
 */
export const STORED_WORK_FIELDS = ["id", "title", "rank", "creator", "year", "subtitle"] as const;

/** 榜单元数据白名单，与 `RankingExport` 逐字对应（不做增删）。 */
export const RANKING_META_FIELDS = [
  "version",
  "profileId",
  "profileName",
  "kind",
  "collectionTitle",
  "createdAt",
] as const;

/** 画像元数据白名单，与 `ArtisticProfile` 逐字对应（不做增删）。 */
export const PROFILE_META_FIELDS = ["version", "profileId", "profileName", "updatedAt"] as const;

/**
 * 注意用 type 而不是 interface：只有类型别名才带隐式索引签名，
 * 从而能与 `Record<string, unknown>` 互相转换（白名单是靠动态键拼出来的）。
 */
export type StoredRanking = {
  version?: unknown;
  profileId?: unknown;
  profileName?: unknown;
  kind?: unknown;
  collectionTitle?: unknown;
  createdAt?: unknown;
  items: StoredWork[];
};

/** v2 画像：元数据 + `rankings[]`。 */
export type StoredRankingsContainer = {
  version?: unknown;
  profileId?: unknown;
  profileName?: unknown;
  updatedAt?: unknown;
  rankings: StoredRanking[];
};

/**
 * 可落库画像：v2 容器**或** v1 画像。
 * v1 本身就是一份榜单（`parseProfile` 至今兼容它），两者必须都认得——
 * 否则读一行旧数据就会因为「没有 rankings 字段」而丢掉整份榜单。
 */
export type StoredProfile = StoredRankingsContainer | StoredRanking;

const MAX_TITLE = 160;
const MAX_ID = 200;
const MAX_YEAR = 2200;
const MAX_RANK = 100000;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 与 `profile.ts` 既有的 `text()` 谓词逐字一致：**不做**控制字符检查，
 * 也不 trim 返回值。保持语义不变是「统一实现」不产生回归的前提。
 */
const text = (value: unknown, max = MAX_TITLE): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

/**
 * 把任意值投影成可落库作品；`title` 不合法时返回 null（调用方丢弃该条）。
 *
 * 非法可选项（越界年份、非整数 rank、超长 creator…）按「字段级丢弃」处理，
 * 而不是让整条作品消失 —— 与 `parseRanking` 的宽松程度保持一致，避免
 * 因为一个脏字段把用户整条榜单打回。
 */
export function toStoredWork(value: unknown): StoredWork | null {
  if (!record(value) || !text(value.title)) return null;
  // 先断言再逐字段填充：插入顺序与 parseRanking 原有的字面量顺序一致
  // （id → title → rank → …），避免 JSON 字节数出现无谓变化。
  const work = {} as StoredWork;
  if (text(value.id, MAX_ID)) work.id = value.id;
  work.title = value.title.trim();
  if (
    Number.isInteger(value.rank) &&
    (value.rank as number) >= 1 &&
    (value.rank as number) <= MAX_RANK
  )
    work.rank = value.rank as number;
  if (text(value.creator)) work.creator = value.creator;
  if (
    Number.isInteger(value.year) &&
    (value.year as number) >= 1 &&
    (value.year as number) <= MAX_YEAR
  )
    work.year = value.year as number;
  if (text(value.subtitle)) work.subtitle = value.subtitle;
  return work;
}

/** 投影一组作品；非数组返回空数组。 */
export function toStoredWorks(value: unknown): StoredWork[] {
  if (!Array.isArray(value)) return [];
  const works: StoredWork[] = [];
  for (const entry of value) {
    const work = toStoredWork(entry);
    if (work) works.push(work);
  }
  return works;
}

/** 投影一个榜单：元数据按白名单保留，`items` 逐层走 `toStoredWorks`。 */
export function toStoredRanking(value: unknown): StoredRanking | null {
  if (!record(value) || !Array.isArray(value.items)) return null;
  const ranking: Record<string, unknown> = {};
  for (const field of RANKING_META_FIELDS) {
    if (value[field] !== undefined) ranking[field] = value[field];
  }
  ranking.items = toStoredWorks(value.items);
  return ranking as StoredRanking;
}

/** 投影一组榜单（广场 `profile` 帖的 `items` 就是这个形状）。 */
export function toStoredRankings(value: unknown): StoredRanking[] {
  if (!Array.isArray(value)) return [];
  const rankings: StoredRanking[] = [];
  for (const entry of value) {
    const ranking = toStoredRanking(entry);
    if (ranking) rankings.push(ranking);
  }
  return rankings;
}

/**
 * 投影一份画像：顶层元数据走白名单，`rankings[].items[]`（或 v1 的 `items[]`）逐层收敛。
 * 形状认不出来时返回 null，由调用方决定返回 400 还是原样透传。
 */
export function toStoredProfile(value: unknown): StoredProfile | null {
  if (!record(value)) return null;
  // v1 画像本身就是一份榜单。必须保留 kind/collectionTitle/createdAt/items，
  // 否则读一行旧数据就会把整份榜单变成空对象。
  if (value.version === 1 && Array.isArray(value.items)) return toStoredRanking(value);
  if (!Array.isArray(value.rankings)) return null;
  const profile: Record<string, unknown> = {};
  for (const field of PROFILE_META_FIELDS) {
    if (value[field] !== undefined) profile[field] = value[field];
  }
  profile.rankings = toStoredRankings(value.rankings);
  return profile as StoredRankingsContainer;
}

/**
 * 读取端自愈：库里残留 posterUrls 的旧行读出来即干净，客户端下一次保存就自动瘦身，
 * 不需要数据迁移脚本。**形状认不出来时原样返回**——读取路径宁可透传，
 * 也不能因为一次规范化把用户数据读没了。
 */
export function healStoredProfile(value: unknown): unknown {
  return toStoredProfile(value) ?? value;
}

/** 榜单集合里作品总数（广场帖的 `item_count` 用它，而不是榜单个数）。 */
export function countStoredWorks(rankings: readonly StoredRanking[]): number {
  return rankings.reduce((sum, ranking) => sum + ranking.items.length, 0);
}

/** 画像 / v1 榜单里的作品总数。 */
export function countStoredProfileWorks(profile: StoredProfile): number {
  return "rankings" in profile ? countStoredWorks(profile.rankings) : profile.items.length;
}

export type StoredEncodeResult =
  | { ok: true; json: string; count: number }
  | { ok: false; error: "payload_too_large" | "empty_payload" };

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

function encode(value: unknown, count: number, limit: number): StoredEncodeResult {
  // count 为 0 时说明白名单把所有条目都判为非法。此时**不能**默默写入空数组
  // （用户数据会凭空消失且没有任何信号），交给调用方返回 400。
  if (count === 0) return { ok: false, error: "empty_payload" };
  const json = JSON.stringify(value);
  if (byteLength(json) > limit) return { ok: false, error: "payload_too_large" };
  return { ok: true, json, count };
}

/** 唯一能产出「可落库作品数组」字符串的出口。 */
export function encodeStoredWorks(value: unknown, limit = MAX_PAYLOAD_BYTES): StoredEncodeResult {
  const works = toStoredWorks(value);
  return encode(works, works.length, limit);
}

/** 唯一能产出「可落库榜单数组」字符串的出口。 */
export function encodeStoredRankings(
  value: unknown,
  limit = MAX_PAYLOAD_BYTES,
): StoredEncodeResult {
  const rankings = toStoredRankings(value);
  return encode(rankings, countStoredWorks(rankings), limit);
}

/** 唯一能产出「可落库画像」字符串的出口（v1 / v2 都走这里）。 */
export function encodeStoredProfile(value: unknown, limit = MAX_PAYLOAD_BYTES): StoredEncodeResult {
  const profile = toStoredProfile(value);
  if (!profile) return { ok: false, error: "empty_payload" };
  return encode(profile, countStoredProfileWorks(profile), limit);
}
