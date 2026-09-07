CREATE TABLE IF NOT EXISTS poster_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'movie',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_poster_errors_created_at ON poster_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poster_errors_type ON poster_errors(media_type, created_at DESC);
