-- 跨 isolate 的精确限流窗口。
--
-- Edge Cache 的 match→put 是读改写，并发下非原子；isolate 内存 Map 又只覆盖单个
-- isolate。敏感桶（管理登录、账号鉴权、AI、分享、导入等）在此用 D1 原子 UPSERT
-- 计数，保证跨 isolate / 跨边缘节点的真实上限。
--
-- 幂等：失败重试安全（仅 IF NOT EXISTS）。
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_started ON rate_limits(started_at);
