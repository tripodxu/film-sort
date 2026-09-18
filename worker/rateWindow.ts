/**
 * isolate 级的限流窗口。
 *
 * 键是 `bucket:ip`，值是一个 10 分钟窗口内的计数。原来的实现在 Map 上
 * **没有任何淘汰路径**：只有同一个键再次出现时才可能重置，于是不同 IP
 * 只增不减——长寿命 isolate 里会随访问者数量单调增长。
 *
 * 这里补上上界与惰性清扫。清扫只在超过上界时触发，所以常规路径依然是一次
 * Map 查找，不引入每次请求的 O(n) 遍历。
 */

export const RATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * 上界取 5000：单条目约 50 字节，即上限约 250KB，远低于 isolate 的内存预算；
 * 同时 5000 个不同 IP 在 10 分钟内已经远超本站在单个 isolate 上的真实流量，
 * 因此正常限流语义不会因淘汰而失效。
 */
export const MAX_RATE_WINDOWS = 5000;

export interface RateWindow {
  startedAt: number;
  count: number;
}

/**
 * 记一次请求并回答「是否放行」。
 *
 * 与旧实现逐字等价的部分：窗口过期即重开并计 1；达到上限时**不再自增**，
 * 返回 false。新增的只有写入后的惰性清扫。
 */
export function consumeIsolateWindow(
  windows: Map<string, RateWindow>,
  key: string,
  limit: number,
  now: number,
): boolean {
  const previous = windows.get(key);
  if (!previous || now - previous.startedAt > RATE_WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    sweepWindows(windows, now);
    return true;
  }
  if (previous.count >= limit) return false;
  previous.count += 1;
  return true;
}

/**
 * 先删已到期的条目（它们本来就不再约束任何人），再按插入顺序淘汰。
 * 淘汰最坏情况下等于把某个 IP 的窗口提前重置——只会放宽、不会收紧，
 * 因此不会误伤正常用户。
 */
function sweepWindows(windows: Map<string, RateWindow>, now: number): void {
  if (windows.size <= MAX_RATE_WINDOWS) return;
  for (const [key, window] of windows) {
    if (now - window.startedAt > RATE_WINDOW_MS) windows.delete(key);
  }
  while (windows.size > MAX_RATE_WINDOWS) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}
