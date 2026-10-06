-- Long-tail response cache + permanent archive of frozen (ended) event data.
-- One row per canonical cache key (routes.ts matchRoute().cacheKey), e.g. "/btd6/races/X/leaderboard?page=2".
CREATE TABLE IF NOT EXISTS responses (
  key        TEXT PRIMARY KEY,
  body       TEXT    NOT NULL,           -- NK envelope with `model` stripped (success or error envelope)
  ok         INTEGER NOT NULL,           -- 1 = success envelope, 0 = error envelope
  etag       TEXT,                       -- upstream ETag, for conditional refresh
  fetched_at INTEGER NOT NULL,           -- epoch ms of last successful upstream contact (200 or 304)
  frozen     INTEGER NOT NULL DEFAULT 0  -- 1 = immutable forever (ended event), never refreshed
);

-- Every event ever seen in the list endpoints. NK's lists only keep ~2–3 months; this keeps everything.
-- archive_state: 0 = not archived, 1 = pages queued, 2 = fully archived.
CREATE TABLE IF NOT EXISTS events (
  kind          TEXT    NOT NULL,        -- race | boss | ct | odyssey
  id            TEXT    NOT NULL,
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  data          TEXT    NOT NULL,        -- the list item JSON (Race | Boss | CT | Odyssey)
  archive_state INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS events_by_start ON events (kind, start_at DESC);
CREATE INDEX IF NOT EXISTS events_pending ON events (archive_state, end_at);

-- Upstream paths still to be fetched and frozen by the archiver.
CREATE TABLE IF NOT EXISTS archive_queue (
  key      TEXT PRIMARY KEY,
  kind     TEXT    NOT NULL,
  event_id TEXT    NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS archive_queue_by_event ON archive_queue (kind, event_id);
