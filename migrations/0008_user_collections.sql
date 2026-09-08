CREATE TABLE IF NOT EXISTS user_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('film', 'book', 'music', 'other')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL CHECK (json_valid(items) AND length(items) <= 524288),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 2 AND 300),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_user_collections_user_updated ON user_collections(user_id, updated_at DESC);

ALTER TABLE user_accounts ADD COLUMN disabled_at TEXT;
ALTER TABLE poster_errors ADD COLUMN source TEXT NOT NULL DEFAULT 'resolver';
