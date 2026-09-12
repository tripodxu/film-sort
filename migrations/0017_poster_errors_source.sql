-- poster_errors 补充 source 列的索引。
-- 注意：ADD COLUMN 无法写成幂等语句——部分环境（远程库）在建表后已手工补过 source 列，
-- 因此本迁移只负责索引；source 列本身已并入 0007 的建表语句（全新环境直接带列），
-- 旧环境若仍缺列，请手工执行：ALTER TABLE poster_errors ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS idx_poster_errors_source ON poster_errors(source, created_at DESC);
