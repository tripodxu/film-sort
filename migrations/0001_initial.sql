PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL CHECK (event_name IN (
    'visit', 'list_opened', 'list_selected', 'sorting_started',
    'comparison_made', 'ranking_completed', 'poster_downloaded',
    'share_copied', 'result_viewed', 'qr_viewed',
    'home_content_rendered', 'experiment_exposed', 'heavy_config_viewed',
    'default_start_clicked', 'sorting_scope_reduced',
    'result_share_prompt_clicked'
  )),
  session_id TEXT NOT NULL CHECK (
    length(session_id) BETWEEN 16 AND 64
    AND session_id NOT GLOB '*[^A-Za-z0-9_-]*'
  ),
  payload TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created
  ON analytics_events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session
  ON analytics_events(session_id);

CREATE TABLE IF NOT EXISTS challenge_sets (
  id TEXT PRIMARY KEY CHECK (
    length(id) = 15
    AND substr(id, 1, 3) = 'mv-'
    AND substr(id, 4) NOT GLOB '*[^a-z0-9]*'
  ),
  theme TEXT NOT NULL CHECK (length(theme) BETWEEN 1 AND 80),
  mode TEXT NOT NULL DEFAULT 'shared' CHECK (length(mode) BETWEEN 1 AND 40),
  items TEXT NOT NULL CHECK (
    json_valid(items)
    AND json_type(items) = 'array'
    AND json_array_length(items) BETWEEN 2 AND 300
  ),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 2 AND 300),
  top_k INTEGER CHECK (top_k IS NULL OR top_k BETWEEN 1 AND item_count),
  seed_text TEXT CHECK (seed_text IS NULL OR length(seed_text) <= 80),
  template_id TEXT CHECK (template_id IS NULL OR length(template_id) <= 80),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_challenge_sets_created_at
  ON challenge_sets(created_at DESC);
