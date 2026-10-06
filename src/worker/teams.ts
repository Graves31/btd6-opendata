// Per-team CT history: GET /api/history/team/:guildId.
//
// Built only from CT data already stored in D1, never from new NK requests. Scanning archived boards per
// request (≤ 40 pages × every CT) would blow the 10 ms CPU budget, so rows are indexed into `ct_teams`
// (migrations/0003) as the data is stored:
//   - a frozen team-board page (archive cron, or the proxy freezing a page a visitor opened) → rank + score
//   - a group page stored after the event ended (final scores) → group rank / size
// Cost: ≤ 1,000 row writes per CT for the boards, plus a group's teams per stored group page.

import { matchRoute } from "../nk/routes.ts";
import type { D1Like, D1StatementLike } from "./deps.ts";

/** Page size of the CT team board (routes.ts paging). */
const TEAM_PAGE = 25;
const MAX_ENTRIES = 200;

export const GUILD_ID = /^[0-9a-f]{48}$/;

export interface TeamHistory {
  team: string;
  entries: {
    ct: string;
    start: number;
    end: number;
    rank: number | null;
    total: number | null;
    score: number | null;
    group: { rank: number | null; of: number | null } | null;
  }[];
}

type Row = { displayName?: unknown; score?: unknown; profile?: unknown; group?: unknown };

const lastSeg = (u: unknown) => (typeof u === "string" ? (u.split("?")[0].split("/").pop() ?? "") : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Which CT team data a cache key holds (null: not a CT team board / group page). */
export function teamKeyKind(key: string): "team" | "group" | null {
  if (!key.startsWith("/btd6/ct/")) return null;
  const q = key.indexOf("?");
  const m = matchRoute(q < 0 ? key : key.slice(0, q), q < 0 ? "" : key.slice(q));
  if (!m.ok) return null;
  return m.route.name === "ct.leaderboard.team" ? "team" : m.route.name === "ct.leaderboard.group" ? "group" : null;
}

/**
 * Upserts into `ct_teams` for a stored CT team-board page or group page (`body`: the NK envelope text).
 * Returns [] for any other key or an unusable body. Callers decide whether the data is final.
 */
export function teamIndexStmts(db: D1Like, key: string, body: string): D1StatementLike[] {
  const q = key.indexOf("?");
  const m = matchRoute(q < 0 ? key : key.slice(0, q), q < 0 ? "" : key.slice(q));
  if (!m.ok || (m.route.name !== "ct.leaderboard.team" && m.route.name !== "ct.leaderboard.group")) return [];
  let rows: Row[];
  try {
    const env = JSON.parse(body) as { success?: boolean; body?: unknown };
    if (!env.success || !Array.isArray(env.body)) return [];
    rows = env.body as Row[];
  } catch {
    return [];
  }
  const ct = m.params.ctID;
  const out: D1StatementLike[] = [];
  if (m.route.name === "ct.leaderboard.team") {
    const base = (m.page - 1) * TEAM_PAGE;
    rows.forEach((r, i) => {
      const guild = lastSeg(r.profile);
      if (!GUILD_ID.test(guild)) return;
      const group = lastSeg(r.group) || null;
      out.push(
        db
          .prepare(
            `INSERT INTO ct_teams (guild_id, ct_id, rank, score, group_id) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (guild_id, ct_id) DO UPDATE SET ${BEST_RANK}`,
          )
          .bind(guild, ct, base + i + 1, num(r.score), group),
      );
    });
  } else {
    const gid = m.params.groupID;
    rows.forEach((r, i) => {
      const guild = lastSeg(r.profile);
      if (!GUILD_ID.test(guild)) return;
      out.push(
        db
          .prepare(
            `INSERT INTO ct_teams (guild_id, ct_id, score, group_id, group_rank, group_size) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (guild_id, ct_id) DO UPDATE SET group_id = excluded.group_id,
               group_rank = excluded.group_rank, group_size = excluded.group_size,
               score = CASE WHEN ct_teams.rank IS NULL THEN excluded.score ELSE ct_teams.score END`,
          )
          .bind(guild, ct, num(r.score), gid, i + 1, rows.length),
      );
    });
  }
  return out;
}

/**
 * Team-board upsert: keep the best (lowest) rank seen and its score, so a duplicate row (e.g. a team moving
 * between pages while pages were fetched at different times) can't make the result depend on write order.
 * Mirrored in migrations/0003_ct_teams.sql.
 */
const BEST_RANK = `score = CASE WHEN ct_teams.rank IS NULL OR excluded.rank < ct_teams.rank THEN excluded.score ELSE ct_teams.score END,
  group_id = CASE WHEN ct_teams.rank IS NULL OR excluded.rank < ct_teams.rank THEN excluded.group_id ELSE ct_teams.group_id END,
  rank = MIN(COALESCE(ct_teams.rank, excluded.rank), excluded.rank)`;

/** A team's CT results, newest CT first. Unknown team → empty entries. One indexed D1 query. */
export async function teamHistory(db: D1Like, guildId: string): Promise<TeamHistory> {
  const { results } = await db
    .prepare(
      `SELECT t.ct_id AS ct, e.start_at AS startAt, e.end_at AS endAt, t.rank AS rank, t.score AS score,
              t.group_rank AS groupRank, t.group_size AS groupSize,
              json_extract(e.data, '$.totalScores_team') AS total
       FROM ct_teams t JOIN events e ON e.kind = 'ct' AND e.id = t.ct_id
       WHERE t.guild_id = ? ORDER BY e.start_at DESC LIMIT ?`,
    )
    .bind(guildId, MAX_ENTRIES)
    .all<{ ct: string; startAt: number; endAt: number; rank: number | null; score: number | null; groupRank: number | null; groupSize: number | null; total: unknown }>();
  return {
    team: guildId,
    entries: results.map((r) => ({
      ct: r.ct,
      start: r.startAt,
      end: r.endAt,
      rank: r.rank ?? null,
      total: num(r.total),
      score: r.score ?? null,
      group: r.groupRank == null && r.groupSize == null ? null : { rank: r.groupRank ?? null, of: r.groupSize ?? null },
    })),
  };
}
