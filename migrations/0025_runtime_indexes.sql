-- 运行时高频查询索引（向后兼容：只加索引，不改表）。
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_oauth_user ON user_oauth(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_plaza_likes_user ON plaza_likes(user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_plaza_comments_user ON plaza_comments(user_id, post_id);
