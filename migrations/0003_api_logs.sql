CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'internal',
  error TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_path ON api_logs(path, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_status ON api_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_errors ON api_logs(created_at DESC) WHERE status >= 400;

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO admin_config (key, value) VALUES ('password_hash', '');
