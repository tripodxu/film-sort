CREATE TABLE IF NOT EXISTS user_oauth (
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  PRIMARY KEY (provider, provider_id)
);
