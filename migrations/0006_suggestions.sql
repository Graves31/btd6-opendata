-- Suggestions box (src/worker/suggest.ts): one row per accepted suggestion. No IP or other visitor identity
-- is stored; discord is the optional name the visitor typed. created_at is epoch ms.
CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind       TEXT,
  text       TEXT NOT NULL,
  page       TEXT,
  page_url   TEXT,
  discord    TEXT,
  width      INTEGER,
  version    TEXT
);
CREATE INDEX IF NOT EXISTS suggestions_created ON suggestions (created_at);
