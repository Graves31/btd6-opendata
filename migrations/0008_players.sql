-- Player name → public 48-hex ID, for GET /api/players?name= (src/worker/players.ts): lets /me find the key
-- owner's public profile by display name. Filled from frozen race, boss and CT player leaderboard pages as
-- they are stored (one INSERT OR IGNORE per page, rows already known cost no write). Names aren't unique
-- and change over time: a name can list several IDs, the browser checks each against the key's own profile.
CREATE TABLE IF NOT EXISTS players (
  name TEXT NOT NULL,                    -- displayName exactly as on the board
  id   TEXT NOT NULL,                    -- last segment of the row's `profile` URL
  PRIMARY KEY (name, id)
) WITHOUT ROWID;

-- Backfill from what the archive already holds (same boards and rows as players.ts).
INSERT OR IGNORE INTO players (name, id)
SELECT json_extract(j.value, '$.displayName'), substr(json_extract(j.value, '$.profile'), -48)
FROM responses r, json_each(r.body, '$.body') j
WHERE (r.key LIKE '/btd6/races/%/leaderboard%' OR r.key LIKE '/btd6/bosses/%/leaderboard/%' OR r.key LIKE '/btd6/ct/%/leaderboard/player%')
  AND r.ok = 1 AND r.frozen = 1
  AND json_type(r.body, '$.body') = 'array'
  AND json_type(j.value, '$.displayName') = 'text'
  AND json_extract(j.value, '$.profile') LIKE '%/btd6/users/%';
