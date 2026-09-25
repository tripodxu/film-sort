// 用户端清缓存的本地协同：
//  - markCachePurged() 在用户点击「清缓存」后记录代次；
//  - epochQuery() 让此后的详情/试听等 GET 请求带上 _ce 参数——URL 变了，
//    浏览器 HTTP 缓存与服务端边缘缓存键同时失效，立即回源拿新数据。
const KEY = "art-rank:cache-epoch";

export function markCachePurged(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* 私密模式禁用存储时静默：本次会话不带 _ce 参数 */
  }
}

export function cacheEpoch(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** separator 传 "&" 或 "?"（视 URL 已有参数而定）；无代次时返回空串。 */
export function epochQuery(separator: string): string {
  const epoch = cacheEpoch();
  return epoch ? `${separator}_ce=${epoch}` : "";
}
