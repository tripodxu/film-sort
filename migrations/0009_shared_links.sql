CREATE TABLE IF NOT EXISTS shared_links (
  code TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shared_links_expires ON shared_links(expires_at);
