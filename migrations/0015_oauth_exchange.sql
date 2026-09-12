-- One-time exchange codes for OAuth login: the session token never appears in the redirect URL.
CREATE TABLE IF NOT EXISTS oauth_exchanges (
  code TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  email TEXT NOT NULL,
  nickname TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_exchanges_expires ON oauth_exchanges(expires_at);
