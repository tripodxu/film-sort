-- 导入体系支持单榜单最多 1000 件作品后，同步放宽云端清单约束。
-- SQLite 不能直接修改 CHECK 约束，因此重建表并保留现有数据。
CREATE TABLE IF NOT EXISTS user_collections_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('film', 'book', 'music', 'other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL CHECK (json_valid(items) AND length(items) <= 524288),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 2 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO user_collections_v2
  (id, user_id, kind, title, description, items, item_count, created_at, updated_at)
SELECT id, user_id, kind, title, description, items, item_count, created_at, updated_at
FROM user_collections;

DROP TABLE user_collections;
ALTER TABLE user_collections_v2 RENAME TO user_collections;
CREATE INDEX IF NOT EXISTS idx_user_collections_user_updated
  ON user_collections(user_id, updated_at DESC);
