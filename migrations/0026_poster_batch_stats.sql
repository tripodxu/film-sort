-- 批量解析的 outcome 分布（每请求一行）。
--
-- poster_errors 只有失败行、没有分母：「throttled 占比」这类观测必须有
-- total/found 作分母才成立，否则「维基在变慢」与「流量在变大」从失败行数
-- 分不开。封面链结构性风险的观测项（otherDetail 第一档短路 / ARTIFACT 误杀 /
-- 上游请求量翻倍 / 《2012》年份误伤）都靠这张表做判断，而不是靠线上探测。
-- 幂等可重复应用。
CREATE TABLE IF NOT EXISTS poster_batch_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total INTEGER NOT NULL,
  found INTEGER NOT NULL,
  absent INTEGER NOT NULL,
  throttled INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_poster_batch_stats_created_at
  ON poster_batch_stats(created_at DESC);
