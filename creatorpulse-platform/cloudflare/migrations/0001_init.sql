-- Public, non-authorized YouTube Data API samples are not retained beyond 29 days.
CREATE TABLE IF NOT EXISTS tracked_videos (
  video_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL DEFAULT 'normal' CHECK (tier IN ('high','normal')),
  last_checked_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_tracked_refresh ON tracked_videos(tier,last_checked_at);
CREATE TABLE IF NOT EXISTS public_video_snapshots (
  video_id TEXT NOT NULL,
  collected_at INTEGER NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  source TEXT NOT NULL DEFAULT 'youtube_data_api_batchGetStats',
  method TEXT NOT NULL DEFAULT 'videos.batchGetStats',
  PRIMARY KEY(video_id,collected_at)
);
CREATE INDEX IF NOT EXISTS idx_snapshot_video ON public_video_snapshots(video_id,collected_at DESC);
CREATE TABLE IF NOT EXISTS public_search_snapshots (
  fingerprint TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  region TEXT NOT NULL,
  language TEXT NOT NULL,
  collected_at INTEGER NOT NULL,
  results_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'youtube_data_api_search_list'
);
CREATE INDEX IF NOT EXISTS idx_search_expiry ON public_search_snapshots(collected_at);
CREATE TABLE IF NOT EXISTS quota_usage (
  quota_date TEXT NOT NULL,
  bucket TEXT NOT NULL CHECK(bucket IN ('batch','search','other')),
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(quota_date,bucket)
);

CREATE TABLE IF NOT EXISTS public_rate_limits (
  hashed_visitor TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(hashed_visitor,window_start)
);
