CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 160),
  profile TEXT NOT NULL CHECK (json_valid(profile) AND length(profile) <= 524288),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
