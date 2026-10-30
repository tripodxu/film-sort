-- 云端清单「同名即同一份」：同一用户在同一媒介下的清单标题唯一。
--
-- 背景：POST /api/account/collections 过去是纯 INSERT，前端每次「保存清单」都发一次，
-- 于是每点一次就多一条同名副本（云端列表被堆满、还反复计入 100 条上限）。
-- 修复需要一条唯一约束才能做原子 UPSERT；D1 不支持带 WHERE 的部分唯一索引，
-- 因此先处理历史副本再建全局唯一索引。
--
-- 历史副本的处理原则：**不物理删除用户数据**。每组保留最近一份（id 最大）原标题，
-- 作为后续 UPSERT 的落点；其余副本追加 ` #<id>` 后缀，仍留在用户的云端清单里可自行删除。
-- 后缀带 id 保证组内不重名：清单标题都是客户端按模板生成的定值
-- （`我的<媒介>清单` / `豆瓣 Top <n>` 等），用户无法输入自由标题，不会与既有标题撞车。
-- 早期草案用 DELETE 收敛，会静默丢掉用户的旧快照，已废弃——别改回去。
--
-- 幂等：失败重试安全。改名后各组只剩一行，重放时子查询命中空集，UPDATE 为 no-op；
-- 索引全部 IF [NOT] EXISTS。顺序很重要：唯一索引必须在改名**之后**创建，
-- 否则历史重复行会让 CREATE UNIQUE INDEX 直接失败，而失败会整文件重放。

-- 普通过滤索引（0008 / 0021 已建）；显式重建保证本文件重放时也成立。
CREATE INDEX IF NOT EXISTS idx_user_collections_user_updated
  ON user_collections(user_id, updated_at DESC);

-- 非最大 id 的行 = 同一 (user_id, kind, title) 组内的历史副本。
-- 截到 160 - 2 - length(id) 个字符，保证拼上 " #<id>" 后仍满足 title 的 CHECK（1..160）。
UPDATE user_collections
SET title = substr(title, 1, 160 - 2 - length(CAST(id AS TEXT))) || ' #' || CAST(id AS TEXT)
WHERE id NOT IN (
  SELECT MAX(id) FROM user_collections GROUP BY user_id, kind, title
);

DROP INDEX IF EXISTS idx_user_collections_user_kind_title;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_collections_user_kind_title
  ON user_collections(user_id, kind, title);
