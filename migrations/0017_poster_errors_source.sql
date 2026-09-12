-- 补齐 poster_errors.source 列：客户端海报失败上报与后台聚合查询均引用该列，
-- 但 0007 建表时从未创建（存量缺陷：上报 INSERT 与看板查询一直失败）
ALTER TABLE poster_errors ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS idx_poster_errors_source ON poster_errors(source, created_at DESC);
