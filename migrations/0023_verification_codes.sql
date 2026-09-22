-- 邮箱验证码（注册 / 修改密码）：SHA-256 存散列，10 分钟过期，5 次尝试上限，同邮箱同用途 60s 重发冷却
CREATE TABLE verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_verification_codes_lookup ON verification_codes (email, purpose);
