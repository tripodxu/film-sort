/**
 * 「同源失败只上报一次」的有界去重集合。
 *
 * 海报失败上报的键含完整 URL，长会话里每换一批图就往 Set 里加一个，
 * 旧实现只 add 不淘汰，集合随浏览量单调增长且强引用整串 URL。
 * 这里在触顶时丢掉最旧的一半（Set 迭代顺序 = 插入顺序），
 * 既保住「同一 URL 不重复上报」的语义，又给内存一个明确上界。
 */

export const DEFAULT_FAILURE_REPORT_LIMIT = 500;

/** 返回 true 表示这是首次见到该键，调用方应发上报；false 表示应跳过。 */
export function rememberFailure(
  store: Set<string>,
  key: string,
  max: number = DEFAULT_FAILURE_REPORT_LIMIT,
): boolean {
  if (store.has(key)) return false;
  if (max > 0 && store.size >= max) {
    const drop = Math.max(1, Math.floor(max / 2));
    let removed = 0;
    for (const oldest of store) {
      store.delete(oldest);
      removed += 1;
      if (removed >= drop) break;
    }
  }
  store.add(key);
  return true;
}
