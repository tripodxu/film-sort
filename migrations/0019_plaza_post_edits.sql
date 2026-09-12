-- 广场帖子编辑历史：记录作者每次编辑操作（改序/增删/元信息/同步）与时间戳
CREATE TABLE plaza_post_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_plaza_post_edits_post ON plaza_post_edits(post_id, created_at DESC);
