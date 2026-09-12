-- 广场规模化索引：媒介筛选 + 最新排序、最热排序、按作者查帖
CREATE INDEX IF NOT EXISTS idx_plaza_posts_kind_created ON plaza_posts(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plaza_posts_like ON plaza_posts(like_count DESC);
