-- Add parent_id column to plaza_comments for nested replies
-- 单语句文件：ADD COLUMN 无 IF NOT EXISTS 可用，索引已拆到 0027_comment_replies_index.sql。
-- 原先 ALTER 与 CREATE INDEX 同文件，一旦 ALTER 成功而 INDEX 失败，重放整个文件会 duplicate column 卡死 apply。
ALTER TABLE plaza_comments ADD COLUMN parent_id INTEGER REFERENCES plaza_comments(id);
