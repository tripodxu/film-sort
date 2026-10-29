/** 上游链的**总预算**（硬截止）。
 *
 *  为什么需要：维基取图是一条 5 档串行链（otherDetail → resolveOtherCover →
 *  langlinks → 主图直取 → 搜索评分），每一档内部还有「zh/en × 纯标题轮/类型词轮」
 *  多次请求，单次 fetchBounded 超时 8–9s。上游抖动时最坏能串到 60s 以上——
 *  线上实测同一个 `/api/other/detail?name=动物森友会` 冷缓存 45s+ 不返回，
 *  而前端 30s 就放弃，用户看到的是「暂时没有更多资料」，Worker 还在白白烧
 *  subrequest 与 CPU。
 *
 *  这里只做一件事：给整条链一个总预算，超时抛 `DeadlineError`，由调用方决定
 *  降级语义——详情链返 504（不缓存），海报链记账成 `throttled`（15s 负缓存，
 *  刷新即重试），而不是把「超时」混成「确实没有这张图」（24h 负缓存）。
 *
 *  注意：被放弃的 promise 不会被取消（Workers 没有通用的取消语义），但
 *  `Promise.race` 已给它挂上处理器，迟到 reject 不会变成 unhandled rejection。 */

export class DeadlineError extends Error {
  constructor(
    readonly label: string,
    readonly ms: number,
  ) {
    super(`deadline_exceeded: ${label} after ${ms}ms`);
    this.name = "DeadlineError";
  }
}

export async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
