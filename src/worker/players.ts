// Player name → public IDs: GET /api/players?name=<displayName>.
//
// /me only knows the key owner's display name (NK's profile and save carry no player ID), so it looks the name
// up here and checks each ID against the key's own profile in the browser. Built from frozen player boards
// only (races, bosses, CT players: top 1,000 each), indexed into `players` (migrations/0008) as pages are
// stored. The insert reads the page with SQLite's json_each, so the Worker never parses it.

import { matchRoute } from "../nk/routes.ts";
import type { D1Like, D1StatementLike } from "./deps.ts";

const BOARDS = new Set(["race.leaderboard", "boss.leaderboard", "ct.leaderboard.player"]);
/** More than any real name has; a cap so a junk lookup stays one small read. */
const MAX_IDS = 20;
export const MAX_NAME = 64;

/** One INSERT OR IGNORE for a stored player-board page (`body`: the NK envelope text); [] for any other key. */
export function playerIndexStmts(db: D1Like, key: string, body: string): D1StatementLike[] {
  const q = key.indexOf("?");
  const m = matchRoute(q < 0 ? key : key.slice(0, q), q < 0 ? "" : key.slice(q));
  if (!m.ok || !BOARDS.has(m.route.name)) return [];
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO players (name, id)
         SELECT json_extract(j.value, '$.displayName'), substr(json_extract(j.value, '$.profile'), -48)
         FROM json_each(CASE WHEN json_valid(?1) AND json_type(?1, '$.body') = 'array' THEN ?1 ELSE '{}' END, '$.body') j
         WHERE json_type(j.value, '$.displayName') = 'text'
           AND json_extract(j.value, '$.profile') LIKE '%/btd6/users/%'`,
      )
      .bind(body),
  ];
}

export async function playerIds(db: D1Like, name: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT id FROM players WHERE name = ? LIMIT ?").bind(name, MAX_IDS).all<{ id: string }>();
  return results.map((r) => r.id);
}
