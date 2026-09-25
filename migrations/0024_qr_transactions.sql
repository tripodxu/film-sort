-- QR 登录事务所有权绑定：外部平台（网易云/豆瓣）签发的二维码 key 必须登记发起账户，
-- 轮询确认时只有 owner 能把上游凭证写入自己的 cookie vault（findings SEC-03）。
-- 向后兼容：新表 + 索引，不改任何既有表；无破坏性清理。
CREATE TABLE IF NOT EXISTS qr_transactions (
  provider TEXT NOT NULL CHECK (provider IN ('netease', 'douban')),
  transaction_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, transaction_key)
);
CREATE INDEX IF NOT EXISTS idx_qr_transactions_expires ON qr_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_transactions_user ON qr_transactions(user_id, provider);
