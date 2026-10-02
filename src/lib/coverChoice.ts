import type { MediaKind } from "../data/media";

/**
 * 「让用户选」消歧出口的纯判定层（PLAN-CHOICE-UI §3.1）。
 *
 * 迭代 2 建好了诊断端点 `/api/other/candidates`，它诚实报告自己有几分把握
 * （band 四档）；迭代 3 又修掉了两个真 bug，但「把选择权交出去」这一步一直空着。
 * 本模块是那个出口的**唯一判定处**——把它从组件里抽出来，是因为
 * 「什么时候该打扰用户」是产品决策，必须能脱离 UI 直接测。
 *
 * 三条硬约束（都来自实测，不是拍脑袋）：
 *  ① exact/strong 绝不出现在这里。线上抽样 6 条 exact（西遊記/异形/病毒/降临/沙丘/Inside）
 *     全部判对，打扰它们是纯负收益。
 *  ② poolSize >= 2 是硬门槛。weak 里有相当一部分是 poolSize === 0
 *     （地心游记/机器猫：zh-wiki 根本没有这些条目），
 *     给这种项弹选择器 = 弹一个空列表，比不弹更糟。
 *  ③ 至少一条候选真的能出图，否则又是一排灰色图标。
 *
 * band 的字面量与 worker/other.ts 的 OtherConfidenceBand 同源；这里独立声明，
 * 因为前端 import worker 模块会把整条维基解析链拖进首包。两端必须同步改。
 */
export type ChoiceBand = "exact" | "strong" | "shaky" | "weak";

/** 判定所需的最小诊断信息（与 /api/other/candidates 的返回结构同形）。 */
export interface ChoiceInput {
  band: ChoiceBand;
  poolSize: number;
  /** 候选里带图的条数；与 poolSize 分开是因为 poolSize 可能含零重合的陪跑项。 */
  coverCount: number;
}

export function shouldOfferChoice(input: ChoiceInput): boolean {
  if (input.band !== "shaky" && input.band !== "weak") return false;
  if (input.poolSize < 2) return false;
  return input.coverCount > 0;
}

/** 只对「其他」维度提供消歧：其余维度的名字没有同名异作问题。 */
export function choiceAppliesToKind(kind: MediaKind): boolean {
  return kind === "other";
}

/**
 * 「问过了吗」的会话内记忆。诊断端点与 /api/other/detail 共用 other 限流桶
 * （20 次 / 10 分钟），而诊断的答案 10 分钟内不会变——每打开一次弹窗就问一次，
 * 20 次弹窗就能把主链路的配额吃光，之后 detail 自己开始 429。
 *
 * 所以两档结果都记：判「不打扰」之后连请求都不发；判「要展示」之后连这一发都不发。
 * 这条限流配额是计划外发现的，写进了 PLAN-CHOICE-UI §3.2 与 §7。
 */
const REPORT_CACHE_KEY = "art-rank:other-choice-report";

/** 缓存里放的东西：判据 + 要展示的候选（形状由调用方自己认）。 */
export interface ReportCacheValue extends ChoiceInput {
  offer: boolean;
  report?: unknown;
}

const CACHE_LIMIT = 200;

function readStore(): Record<string, ReportCacheValue> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(REPORT_CACHE_KEY) ?? "null");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, ReportCacheValue>)
      : {};
  } catch {
    return {};
  }
}

export function reportCacheKey(title: string, year?: number): string {
  return `${title}|${year ?? ""}`;
}

export function readCachedReport(key: string): ReportCacheValue | null {
  const hit = readStore()[key];
  if (!hit || typeof hit !== "object") return null;
  if (typeof hit.offer !== "boolean") return null;
  if (
    hit.band !== "exact" &&
    hit.band !== "strong" &&
    hit.band !== "shaky" &&
    hit.band !== "weak"
  ) {
    return null;
  }
  if (![hit.poolSize, hit.coverCount].every((n) => typeof n === "number" && n >= 0)) return null;
  return hit;
}

export function cacheReport(key: string, value: ReportCacheValue): void {
  try {
    const store = readStore();
    store[key] = value;
    // 与 Poster.tsx 的 sessionStorage 缓存同一条纪律：必须有上界，
    // 否则逛久了会撑爆 storage 配额，连海报缓存也跟着写不进去。
    const keys = Object.keys(store);
    for (const stale of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete store[stale];
    sessionStorage.setItem(REPORT_CACHE_KEY, JSON.stringify(store));
  } catch {
    /* 隐私模式 / 配额满：退化成每次都问，判定结果不受影响 */
  }
}

export function clearCachedReports(): void {
  try {
    sessionStorage.removeItem(REPORT_CACHE_KEY);
  } catch {
    /* 同上 */
  }
}

/**
 * 维基图片域白名单：写端点只接受这两个 host 的地址。
 * 与 allowedImage（worker/media.ts）是**两道独立的闸**——那道管「能不能取图」，
 * 这道管「用户能不能把一个地址塞进全站封面位」。
 */
const WIKI_IMAGE_HOSTS = /^(?:upload|thumb)\.wikimedia\.org$/;

export function isWikiImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const okProtocol = url.protocol === "https:" || url.protocol === "http:";
    return okProtocol && WIKI_IMAGE_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}
