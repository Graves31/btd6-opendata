-- Per-team CT results, for GET /api/history/team/:guildId (src/worker/teams.ts). Derived only from CT team
-- leaderboards and group pages already stored in `responses`; written when a frozen team-board page or a
-- post-event group page is stored (≤ 1,000 rows per CT, plus a group's teams when a group page is stored).
CREATE TABLE IF NOT EXISTS ct_teams (
  guild_id   TEXT    NOT NULL,           -- 48-hex guild ID (last segment of the row's `profile` URL)
  ct_id      TEXT    NOT NULL,
  rank       INTEGER,                    -- position on the global team board (NULL: not in the top 1,000 / unknown)
  score      INTEGER,
  group_id   TEXT,
  group_rank INTEGER,                    -- position in its CT group (NULL: group page never stored)
  group_size INTEGER,
  PRIMARY KEY (guild_id, ct_id)
) WITHOUT ROWID;

-- Backfill from what the archive already holds: frozen team-board pages…
INSERT INTO ct_teams (guild_id, ct_id, rank, score, group_id)
SELECT
  substr(json_extract(j.value, '$.profile'), -48),
  substr(r.key, 10, instr(substr(r.key, 10), '/') - 1),
  (CASE WHEN instr(r.key, '?page=') > 0 THEN CAST(substr(r.key, instr(r.key, '?page=') + 6) AS INTEGER) ELSE 1 END - 1) * 25 + j.key + 1,
  json_extract(j.value, '$.score'),
  replace(json_extract(j.value, '$.group'), rtrim(json_extract(j.value, '$.group'), '0123456789abcdef'), '')
FROM responses r, json_each(r.body, '$.body') j
WHERE r.key LIKE '/btd6/ct/%/leaderboard/team%' AND r.ok = 1 AND r.frozen = 1
  AND json_type(r.body, '$.body') = 'array'
  AND json_extract(j.value, '$.profile') LIKE '%/btd6/guild/%'
-- Best (lowest) rank wins if a team appears twice (same rule as src/worker/teams.ts BEST_RANK).
ON CONFLICT (guild_id, ct_id) DO UPDATE SET
  score = CASE WHEN ct_teams.rank IS NULL OR excluded.rank < ct_teams.rank THEN excluded.score ELSE ct_teams.score END,
  group_id = CASE WHEN ct_teams.rank IS NULL OR excluded.rank < ct_teams.rank THEN excluded.group_id ELSE ct_teams.group_id END,
  rank = MIN(COALESCE(ct_teams.rank, excluded.rank), excluded.rank);

-- …then every stored group page (group rank; the score too when the team isn't on the global board).
INSERT INTO ct_teams (guild_id, ct_id, score, group_id, group_rank, group_size)
SELECT
  substr(json_extract(j.value, '$.profile'), -48),
  substr(r.key, 10, instr(substr(r.key, 10), '/') - 1),
  json_extract(j.value, '$.score'),
  substr(r.key, instr(r.key, '/group/') + 7),
  j.key + 1,
  json_array_length(r.body, '$.body')
FROM responses r, json_each(r.body, '$.body') j
WHERE r.key LIKE '/btd6/ct/%/leaderboard/group/%' AND r.ok = 1
  AND json_type(r.body, '$.body') = 'array'
  AND json_extract(j.value, '$.profile') LIKE '%/btd6/guild/%'
ON CONFLICT (guild_id, ct_id) DO UPDATE SET
  group_id = excluded.group_id, group_rank = excluded.group_rank, group_size = excluded.group_size,
  score = CASE WHEN ct_teams.rank IS NULL THEN excluded.score ELSE ct_teams.score END;
