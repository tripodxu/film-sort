-- 云端清单「同名即同一份」：同一用户在同一媒介下的清单标题唯一。
--
-- 背景：POST /api/account/collections 过去是纯 INSERT，前端每次「保存清单」都发一次，
-- 于是每点一次就多一条同名副本（云端列表被堆满、还反复计入 100 条上限）。
-- 修复需要一条唯一约束才能做原子 UPSERT；D1 不支持带 WHERE 的部分唯一索引，
-- 因此先去重历史副本再建全局唯一索引。
--
-- 幂等：失败重试安全（只有 IF [NOT] EXISTS 与可重复执行的 DELETE）。
-- 顺序很重要：唯一索引必须在去重**之后**创建，否则历史重复行会让它直接失败。

-- 普通过滤索引（0008 / 0021 已建）；显式重建保证本文件重放时也成立。
CREATE INDEX IF NOT EXISTS idx_user_collections_user_updated
  ON user_collections(user_id, updated_at DESC);

-- 历史去重：按 (user_id, kind, title) 只保留 id 最大的一行（=最近保存的那份）。
-- id 是 AUTOINCREMENT（单调递增），与旧「按 id DESC 排序」的用户可见顺序一致。
DELETE FROM user_collections
WHERE id NOT IN (
  SELECT MAX(id) FROM user_collections GROUP BY user_id, kind, title
);

DROP INDEX IF EXISTS idx_user_collections_user_kind_title;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collections_user_kind_title
  ON user_collections(user_id, kind, title);
