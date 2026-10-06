-- The hot cron's working state, split so a run never parses or rewrites the whole ~160 KB bundle
-- (free-plan CPU: 10 ms). `hot_state.meta` is a small index (per key: fetch time, CDN expiry, ETag, and what
-- the cron derives from the body); each body is its own row, written only when NK sends a new one.
-- `hot_state.bundle` is no longer used (written as '').
CREATE TABLE IF NOT EXISTS hot_entries (
  key  TEXT PRIMARY KEY,
  body TEXT NOT NULL               -- NK envelope JSON without `model`
);
ALTER TABLE hot_state ADD COLUMN meta TEXT;
