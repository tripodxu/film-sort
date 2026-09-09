CREATE TABLE plaza_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  post_type TEXT NOT NULL,
  kind TEXT,
  collection_title TEXT NOT NULL,
  items TEXT NOT NULL,
  notes TEXT,
  item_count INTEGER,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  is_public INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE plaza_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id)
);

CREATE TABLE plaza_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES plaza_posts(id),
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_plaza_posts_created ON plaza_posts(created_at DESC);
CREATE INDEX idx_plaza_posts_user ON plaza_posts(user_id);
CREATE INDEX idx_plaza_likes_post ON plaza_likes(post_id);
CREATE INDEX idx_plaza_comments_post ON plaza_comments(post_id);
