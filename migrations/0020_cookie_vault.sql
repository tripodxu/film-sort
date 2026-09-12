-- 外部平台连接凭证保险库：扫码登录获得的 Cookie 经 AES-GCM 加密后存储（不存明文）
CREATE TABLE user_cookie_vault (
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  provider TEXT NOT NULL,
  data_encrypted TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, provider)
);
