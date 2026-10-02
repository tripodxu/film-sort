/**
 * 空封面的三态判定（PLAN-EMPTY-COVER-STATE）。
 *
 * 为什么要有这个文件：服务端 `/api/posters/batch` 的 `outcomes` 早就算好了
 * `found / absent / throttled` 三档，但历史上只把 `results` 和 `keys` 发出去，
 * 于是「维基真没这个条目的封面」与「维基此刻取不到」在前端是同一个空格子。
 * 把三态判据抽成纯函数，是因为组件没法在 node 环境里渲染测试
 * （见 vitest.config.ts：只 include .ts，且没有 testing-library）。
 *
 * 三档对应三种**用户该做的事**：
 *  - found    → 有图，渲染封面，不进本模块的分支
 *  - absent   → 上游干净地回答「没有」。24 小时负缓存，重试没有意义，
 *               所以只渲染静默图标，不打扰用户
 *  - degraded → 上游 429/超时/连接重置。只有 15 秒负缓存，
 *               「点一下重试」真的能重试成功，所以这才是唯一该给动作的一档
 *  - unknown  → 没有 outcomes 字段（服务端回退/灰度/代理剥字段）。
 *               退化到今天的行为：静默图标 + 标题，零视觉变化
 */
export type PosterOutcome = "found" | "absent" | "throttled";

/** 传给 UI 的三态；`none` 是「确实没有」，`degraded` 是「暂时取不到」，`unknown` 是「不知道」。 */
export type EmptyPosterState = "none" | "degraded" | "unknown";

/**
 * 一格海报的最终状态。
 * 注意 `urls` 非空时**永远是 null** —— 调用方据此决定「根本不进空态分支」。
 */
export function emptyPosterState(
  urls: readonly string[] | undefined,
  outcome: PosterOutcome | undefined,
): EmptyPosterState | null {
  if (urls?.length) return null;
  // 没给分类，或者给了不认识的值，一律按 unknown 处理，绝不猜成 absent：
  // 猜错的后果是「该给重试按钮时不给」，用户就永远卡在空格子。
  return outcome === "throttled" ? "degraded" : outcome === "absent" ? "none" : "unknown";
}

/**
 * 三态 → 文案 key。
 * 单独抽出来是为了让「文案与状态一一对应」这条不变量能被单测锁住：
 * 新增一档状态时，这里必须同步补，否则 TS 会因为穷尽性检查而报错。
 */
export function emptyPosterMessageKey(state: EmptyPosterState): "none" | "degraded" | "unknown" {
  return state;
}
