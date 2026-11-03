// 「精华切片」：用最远点采样（farthest-point sampling）从一份榜单里挑出
// 最有代表性的 N 件作品。
//
// 直觉：按名次取前 N 件只会得到「同一类东西」，而最远点采样每次都挑
// 「与已选集合最不相似」的那件，让切片覆盖创作者、年代与标题语义上的
// 不同角落。算法是确定性的（无随机数），同一榜单永远得到同一组切片；
// 并列时排名靠前者优先，保证结果可解释、可测试。
//
// 这是纯函数模块：零网络、零存储、不改变任何既有排序行为。

export interface EssenceCandidate {
  id?: string;
  title: string;
  creator?: string;
  year?: number;
}

export interface EssencePick {
  /** 在入参数组中的下标。 */
  index: number;
  /** 该件与已选集合的最小相似度（越低越「新」）。 */
  novelty: number;
}

export interface EssenceResult {
  /** 按选择顺序排列。 */
  picks: EssencePick[];
  /** 与 picks 等长：每件切片「代表」的清单作品数（含自身），合计为清单总数。 */
  represented: number[];
  /** 清单被切片覆盖的比例（0–100）：至少与一件切片相似度 ≥ 阈值的作品占比。 */
  coverage: number;
}

const COVERAGE_THRESHOLD = 0.5;
const YEAR_WINDOW = 30;

/** 归一化标题：保留字母、数字、CJK；其余一律折叠为空格。 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** 标题 token 集合：CJK 单字 + 拉丁词 + 全串 bigram，兼顾中英文。 */
function titleTokens(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const tokens = new Set<string>();
  if (!normalized) return tokens;
  const compact = normalized.replace(/\s+/g, "");
  for (let i = 0; i < compact.length; i++) {
    tokens.add(compact[i]);
    if (i + 1 < compact.length) tokens.add(compact.slice(i, i + 2));
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function creatorKey(creator: string | undefined): string {
  return creator?.trim().toLocaleLowerCase() ?? "";
}

/** 预计算后的特征：分词只做一次，避免最远点采样里每对比较都重新分词。 */
interface PreparedCandidate {
  tokens: Set<string>;
  creator: string;
  year?: number;
}

function prepareCandidate(candidate: EssenceCandidate): PreparedCandidate {
  return {
    tokens: titleTokens(candidate.title),
    creator: creatorKey(candidate.creator),
    year: typeof candidate.year === "number" ? candidate.year : undefined,
  };
}

function preparedSimilarity(a: PreparedCandidate, b: PreparedCandidate): number {
  const title = jaccard(a.tokens, b.tokens);
  const creator = a.creator && a.creator === b.creator ? 1 : 0;
  const year =
    typeof a.year === "number" && typeof b.year === "number"
      ? Math.max(0, 1 - Math.abs(a.year - b.year) / YEAR_WINDOW)
      : 0;
  return title * 0.4 + creator * 0.35 + year * 0.25;
}

/**
 * 两件作品的相似度（0–1）：标题语义 40% + 创作者 35% + 年代 25%。
 * 缺年份/创作者时该维度按 0 处理——「未知」不应被当成「相同」。
 */
export function essenceSimilarity(a: EssenceCandidate, b: EssenceCandidate): number {
  return preparedSimilarity(prepareCandidate(a), prepareCandidate(b));
}

/**
 * 最远点采样：首件固定为排名第一（锚点），之后每步选择
 * 「与已选集合的最小相似度」最大的作品；同分取下标更小者。
 * count ≤ 0 返回空；count ≥ 长度返回全部（保持原顺序）。
 */
export function essenceSlice(items: readonly EssenceCandidate[], count: number): EssenceResult {
  const total = items.length;
  if (total === 0 || count <= 0) return { picks: [], represented: [], coverage: 0 };
  if (count >= total) {
    return {
      picks: items.map((_, index) => ({ index, novelty: 0 })),
      represented: items.map(() => 1),
      coverage: 100,
    };
  }

  const prepared = items.map(prepareCandidate);
  const selected: number[] = [0];
  const novelty = new Array<number>(total).fill(0);
  for (let i = 0; i < total; i++) novelty[i] = 1 - preparedSimilarity(prepared[0], prepared[i]);
  novelty[0] = -1;

  while (selected.length < count) {
    let best = -1;
    for (let i = 0; i < total; i++) {
      if (novelty[i] < 0) continue;
      if (best === -1 || novelty[i] > novelty[best]) best = i;
    }
    if (best === -1) break;
    selected.push(best);
    novelty[best] = -1;
    for (let i = 0; i < total; i++) {
      if (novelty[i] < 0) continue;
      const similarity = preparedSimilarity(prepared[best], prepared[i]);
      novelty[i] = Math.min(novelty[i], 1 - similarity);
    }
  }

  const picks: EssencePick[] = selected.map((index, order) => {
    // 首件没有「与已选集合」的概念，记它与其余切片的差异；其余取最小距离。
    let nearest = 1;
    for (const other of selected) {
      if (other === index) continue;
      nearest = Math.min(nearest, 1 - preparedSimilarity(prepared[index], prepared[other]));
    }
    return { index, novelty: order === 0 ? nearest : nearest };
  });

  const covered = items.filter((_, itemIndex) =>
    selected.some(
      (index) => preparedSimilarity(prepared[index], prepared[itemIndex]) >= COVERAGE_THRESHOLD,
    ),
  ).length;

  // 每件作品归入「最相似的那件切片」；并列时归入先选出的切片。
  // 这样「代表 N 件」之和恒等于清单总数，可与作品数互相校验。
  const represented = selected.map(() => 0);
  for (let itemIndex = 0; itemIndex < total; itemIndex++) {
    let bestOrder = 0;
    let bestSimilarity = -1;
    selected.forEach((pickIndex, order) => {
      const similarity = preparedSimilarity(prepared[pickIndex], prepared[itemIndex]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestOrder = order;
      }
    });
    represented[bestOrder] += 1;
  }

  return { picks, represented, coverage: Math.round((covered / total) * 100) };
}
