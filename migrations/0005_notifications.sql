-- Notification outbox (src/worker/notify.ts): one row per message to send, keyed so a notification is
-- queued at most once. sent_at NULL = not delivered yet; attempts counts delivery tries (given up at 5).
CREATE TABLE IF NOT EXISTS notifications (
  key        TEXT PRIMARY KEY,
  rule       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at    INTEGER,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
