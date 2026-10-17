-- plaza_comments.parent_id 的索引：从 0014 拆出（0014 必须保持单语句以保证失败重试安全）。
-- 幂等：已存在则跳过。
CREATE INDEX IF NOT EXISTS idx_plaza_comments_parent ON plaza_comments(parent_id);
