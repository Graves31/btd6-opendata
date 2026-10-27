-- CT cut-off trend, for GET /api/ct/:id/cutoffs (src/worker/ct.ts). While a CT is live the hot cron records,
-- at most once per UTC day and board, the score at each medal cut-off rank (~10 rows per board per day).
-- day = UTC day number (epoch ms / 86,400,000); 0 = the final snapshot taken after the CT ended.
CREATE TABLE IF NOT EXISTS ct_cutoffs (
  ct_id TEXT    NOT NULL,
  board TEXT    NOT NULL,                -- 'team' | 'player'
  day   INTEGER NOT NULL,
  rank  INTEGER NOT NULL,
  score INTEGER NOT NULL,
  at    INTEGER NOT NULL,                -- epoch ms the page was fetched
  PRIMARY KEY (ct_id, board, day, rank)
) WITHOUT ROWID;
