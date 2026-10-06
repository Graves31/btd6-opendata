-- Authoritative state of the per-minute hot cron. D1 is strongly consistent and allows 100k row writes/day,
-- so the cron keeps its working bundle here every minute and publishes to KV (1k writes/day) at most every
-- 2 minutes. KV is only the edge-cached distribution copy.
CREATE TABLE IF NOT EXISTS hot_state (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  bundle       TEXT    NOT NULL,          -- HotBundle JSON (entries carry upstream expiry times)
  published_at INTEGER NOT NULL,          -- epoch ms of the last KV write
  dirty        INTEGER NOT NULL DEFAULT 0 -- 1 = bundle changed since the last KV write
);
