-- 海报地址持久化：把解析结果落库，避免每次浏览榜单都向上游（豆瓣/维基/网易云）
-- 重新解析。此前 posterUrls 因画像 JSON 的 512KB 上限被剥掉，导致网易云导入的
-- 150 首歌单每次打开都要现解析 150 次，几乎必然被豆瓣 418 打回、大部分条目无海报。
-- media_key 与 worker/media.ts 的 posterMediaKey() 一致：type|title|english|year。
CREATE TABLE IF NOT EXISTS poster_urls (
  media_key  TEXT PRIMARY KEY,
  urls       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_poster_urls_updated_at ON poster_urls(updated_at DESC);
