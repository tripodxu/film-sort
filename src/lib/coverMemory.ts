import { posterKeySegment, posterMediaKey } from "../../shared/posterKey";
import { isWikiImageUrl } from "./coverChoice";

/**
 * 消歧记忆（PLAN-COVER-MEMORY）。
 *
 * 迭代 5 建的「让用户选」把用户的裁决写成了一个 **state 补丁**：
 * `App.tsx` 收到 `onCoverChange` 后只改 `detailWork` 那一个对象，于是弹窗背后
 * 已经渲染过的同名卡片还是旧封面——而 UI 上那句「之后都用你选的这一张」在本次
 * 会话里是假的。根因是**补丁只活在被补丁的对象上**：裁决是一个**事实**，
 * 事实得存在所有渲染方都会经过的那一处。
 *
 * 那一处就是 `Poster.tsx` 构造候选数组的那一行（29 处调用点全部经过它）。
 * 本模块只提供纯函数：读一次记忆、给出优先级里的两档，组件自己拼。
 *
 * 两条记录、一次写入：
 *  - **精确行** = 服务端 media key（与 D1 的 `media_key`、批次响应的 `keys` 同口径）
 *    → 用户对**这一件**亲自裁决过，最高优先。
 *  - **名字行** = 只取标题段 → 同名继承。只填空格（见 Poster.tsx 里的优先级梯子），
 *    因为拿「猜的那部作品」去换掉「这一件已经判对的那张」是净损失。
 *
 * 为什么不拿 `confidence.pickedTitle`（服务端本来就发在 /api/other/candidates 里）
 * 当判据：那要先多发一次请求才知道「这条本来会被判成哪个条目」，而**用户点选
 * 正是要推翻那个判定**——拿被推翻的对象当判据，逻辑上自相矛盾。本模块记的是
 * 用户裁决的**事实**，不是「与服务端判定的差异」。
 *
 * 记忆只活在本次会话（sessionStorage）：跨会话的真相由服务端 `poster_urls` 行
 * 负责，而**跨会话的同名传播等于替未来的用户做决定**。
 */

const COVER_MEMORY_KEY = "art-rank:cover-choice";
/**
 * 条目数上界。一次裁决写两行（精确 + 名字），所以 100 行 ≈ 50 次裁决。
 * 值只有 url + wikiTitle（约 200 B），满额 ≈ 20 KB；配额满时静默跳过。
 * 淘汰策略与 Poster.tsx 的海报缓存一致：满了淘汰最旧的一半。
 */
const COVER_MEMORY_MAX = 100;

interface MemoryRow {
  url: string;
  /** 用户确认这条名字指的是哪个维基条目；可能是空串（裁决有效，条目未知）。 */
  wikiTitle: string;
}

/**
 * 解析结果只做一次：<Poster> 有 29 处调用点、每个实例每次渲染都会读记忆，
 * 每次渲染都 JSON.parse 一遍 sessionStorage 会成为新的首屏成本。
 */
let memo: Record<string, MemoryRow> | null = null;

function parseStore(raw: string | null): Record<string, MemoryRow> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, MemoryRow>)
      : {};
  } catch {
    return {};
  }
}

function store(): Record<string, MemoryRow> {
  if (memo) return memo;
  try {
    memo = parseStore(sessionStorage.getItem(COVER_MEMORY_KEY));
  } catch {
    // 隐私模式：内存副本仍可用，只是不跨刷新。
    memo = {};
  }
  return memo;
}

function persist(next: Record<string, MemoryRow>): void {
  memo = next;
  const keys = Object.keys(next);
  // 先写再淘汰：早退的写法（未触顶就不写）会让整份记忆只活在内存副本里，
  // 刷新即全丢，而页内一切正常——没有任何信号。
  if (keys.length > COVER_MEMORY_MAX) {
    // 与 Poster.tsx 的海报缓存同一策略：满了淘汰最旧的一半，
    // 而不是一条条挤牙膏（挤到最后整份都不写了）。
    for (let i = 0; i < Math.floor(keys.length / 2); i += 1) delete next[keys[i]];
  }
  try {
    sessionStorage.setItem(COVER_MEMORY_KEY, JSON.stringify(next));
  } catch {
    /* 配额满：本次页面仍然生效，刷新后丢失 */
  }
}

/**
 * 精确行的键：与服务端 `posterKeyFor` / 批次响应的 `keys` 同口径，
 * 直接复用 shared 的唯一实现（连带 `other` 维度的代数后缀）。
 * `posterKeyYear` 的 1800–2200 口径也在这里生效：1503 在两端都会被丢掉。
 */
export function coverMemoryKey(title: string, english?: string, year?: number): string {
  return posterMediaKey(title, english ?? title, "other", year);
}

/**
 * 名字行的键。前缀与精确行不可能相撞（`other-name|` vs `other|…|…|…|4`），
 * 所以两行可以共处一张表而互不覆盖。
 */
export function coverNameKey(title: string): string {
  return `other-name|${posterKeySegment(title)}`;
}

function validRow(row: MemoryRow | undefined): MemoryRow | null {
  if (!row || typeof row !== "object") return null;
  const url = row.url;
  if (typeof url !== "string" || !url) return null;
  // 与海报候选同一条闸：只认维基图域的地址。sessionStorage 里的东西
  // 不能假定是可信输入（也可能是别的版本写下来的）。
  if (!isWikiImageUrl(url)) return null;
  return { url, wikiTitle: typeof row.wikiTitle === "string" ? row.wikiTitle : "" };
}

/** 记下**这一件**的裁决。名字行照写，好让后来才挂载的同名作品能继承。 */
function writeRows(exactKey: string, nameKey: string, row: MemoryRow): Record<string, MemoryRow> {
  const rows = { ...store() };
  // 名字行先写、精确行后写：同一件作品被裁决两次时留下的是**最近那一次**。
  rows[nameKey] = row;
  rows[exactKey] = row;
  return rows;
}

export interface CoverChoiceRecall extends MemoryRow {
  /** true = 键完全相同（用户对这一件亲自裁决过）；false = 同名继承。 */
  exact: boolean;
}

/**
 * 记下一次裁决。空地址不入记忆——没有封面就没有可继承的东西。
 * 匿名用户同样会记：记的是**这一页**的真相，不依赖云端。
 */
export function rememberCoverChoice(input: {
  title: string;
  english?: string;
  year?: number;
  url: string;
  wikiTitle?: string;
}): void {
  const row = validRow({ url: input.url, wikiTitle: (input.wikiTitle ?? "").trim() });
  if (!row) return;
  persist(
    writeRows(
      coverMemoryKey(input.title, input.english, input.year),
      coverNameKey(input.title),
      row,
    ),
  );
}

export function recallCoverChoice(key: string, title: string): CoverChoiceRecall | null {
  const rows = store();
  const exact = validRow(rows[key]);
  if (exact) return { ...exact, exact: true };
  const inherited = validRow(rows[coverNameKey(title)]);
  return inherited ? { ...inherited, exact: false } : null;
}

/**
 * 把记忆接进候选优先级（`Poster.tsx` 唯一收口处调用）。
 *
 * 顺序即优先级（`Poster.tsx` 取第一个还没加载失败的候选）：
 *   记忆(精确) → 作品自带的封面 → 解析结果 → 记忆(同名继承)
 *
 * 继承被刻意压在**最后**：一件同名作品若自己已经有封面（它的年份让服务端判对了），
 * 那它就没有问题；只有当它**一个候选都没有**时——`absent` / `throttled`，
 * 也就是迭代 7 那个空格子——用户对同名的裁决才是**目前唯一可用的信息**。
 * 这样继承在结构上不可能把一张对的封面换成错的。
 */
export function mergeCoverRecall(
  urls: readonly string[],
  recalled: CoverChoiceRecall | null,
): string[] {
  if (!recalled) return [...urls];
  if (!recalled.exact) return urls.length ? [...urls] : [recalled.url];
  return [recalled.url, ...urls.filter((url) => url !== recalled.url)];
}

/**
 * 这一件**不用**再问上游了（用户对**它本人**做过裁决）。
 *
 * 只认精确行，不认继承：继承来的那张只保证「这一格不是空的」，
 * 而这一件自己将来仍可能解析出别的封面——为了一个已经有东西显示的格子
 * 白烧一次维基回源不值得。精确行则相反：用户已经亲口回答了这个问题，
 * 再问上游得到的只会是同一个答案的上游版本，把用户的裁决挤到候选第二位。
 */
export function memorySuppliesCover(recalled: CoverChoiceRecall | null): boolean {
  return recalled !== null && recalled.exact;
}

export function clearCoverMemory(): void {
  memo = null;
  try {
    sessionStorage.removeItem(COVER_MEMORY_KEY);
  } catch {
    /* 同上 */
  }
}
