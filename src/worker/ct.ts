// CT read endpoints (D1 only, never NK) and the cut-off snapshot step of the hot cron.
//
//   GET /api/ct/:id/cutoffs  -> { id, team: Snap[], player: Snap[] }  score at each medal cut-off rank, per day
//   GET /api/ct/relics       -> { cts: [{ id, start, end, relics, banners, games }] }  archived CTs, newest first
//
// Snapshots (migrations/0007): per board and UTC day, one NK page per cron run, only the pages that hold a
// cut-off rank. About 5 team + 3 player pages a day while live, about 10 D1 row writes per board and day.

import { ORIGIN_MAX_AGE_MS } from "../nk/routes.ts";
import type { D1Like, Deps } from "./deps.ts";
import { originCooldownS } from "./limit.ts";
import { mem } from "./store.ts";
import { fetchUpstream } from "./upstream.ts";

const DAY = 86_400_000;
const PAGE = 25;
const BOARD_CAP = 1000;
const RETRY_MS = 10 * 60_000;
export type CtBoard = "team" | "player";

// Mirrors BRACKETS ctTeam / ctPlayer in web/src/medals.ts (fixed ranks, top fractions). Keep in sync.
const BRACKETS: Record<CtBoard, [rank: number | null, pct: number | null][]> = {
  player: [[25, null], [100, null], [null, 0.01], [null, 0.1], [null, 0.25], [null, 0.5], [null, 0.75]],
  team: [[1, null], [2, null], [3, null], [25, null], [100, null], [null, 0.01], [null, 0.1], [null, 0.25], [null, 0.75]],
};

/** The cut-off ranks of a board (<= 1000, ascending, unique) for `total` entries (unknown/0: fixed ranks only). */
export function cutoffRanks(board: CtBoard, total: number): number[] {
  const set = new Set<number>();
  for (const [r, pct] of BRACKETS[board]) {
    let rank = r ?? (pct !== null && total > 0 ? Math.max(1, Math.floor(total * pct)) : 0);
    if (total > 0) rank = Math.min(rank, total);
    if (rank >= 1 && rank <= BOARD_CAP) set.add(rank);
  }
  return [...set].sort((a, b) => a - b);
}

const boardKey = (ct: string, board: CtBoard, page: number) => `/btd6/ct/${ct}/leaderboard/${board}${page > 1 ? `?page=${page}` : ""}`;

/** Next page to read: the lowest page that still holds a missing rank (ranks sorted ascending), or null. */
export function nextPage(ranks: number[], done: Set<number>): number | null {
  const r = ranks.find((x) => !done.has(x));
  return r === undefined ? null : Math.ceil(r / PAGE);
}

/** Snapshots finished (ct:day), and failed ones to leave alone until a time: both skip the D1 lookups. */
const finished = new Set<string>();
const backoff = new Map<string, number>();
export function resetCtState(): void {
  finished.clear();
  backoff.clear();
  relicsMemo = null;
}

/**
 * One step of the snapshot job: at most ONE NK page. `day` = UTC day number, or 0 for the final snapshot.
 * Pages already in memory since `since` (the hot page 1, a visitor's page) cost no request. A failure is
 * logged and retried after 10 min. Never throws. Returns the NK requests made (0 or 1).
 */
export async function ctCutoffStep(deps: Deps, ctId: string, day: number, since: number): Promise<number> {
  const tag = `${ctId}:${day}`;
  const now = deps.now();
  if (finished.has(tag) || now < (backoff.get(tag) ?? 0)) return 0;
  try {
    const t = await deps.db
      .prepare("SELECT json_extract(data,'$.totalScores_team') AS team, json_extract(data,'$.totalScores_player') AS player FROM events WHERE kind = 'ct' AND id = ?")
      .bind(ctId)
      .first<{ team: number | null; player: number | null }>();
    const { results } = await deps.db
      .prepare("SELECT board, rank FROM ct_cutoffs WHERE ct_id = ? AND day = ?")
      .bind(ctId, day)
      .all<{ board: CtBoard; rank: number }>();
    for (const board of ["team", "player"] as const) {
      const ranks = cutoffRanks(board, Number(t?.[board] ?? 0));
      const done = new Set(results.filter((r) => r.board === board).map((r) => r.rank));
      for (let page = nextPage(ranks, done); page !== null; page = nextPage(ranks, done)) {
        const key = boardKey(ctId, board, page);
        let body: string;
        let at: number;
        let requests = 0;
        const m = mem.get(key);
        if (m && m.ok && m.fetchedAt >= since) {
          ({ body, fetchedAt: at } = m);
        } else {
          if (originCooldownS(deps.now())) return 0;
          const e = await fetchUpstream(deps, key, null);
          requests = 1;
          if (!e.ok) throw new Error(`no ${board} page ${page}`);
          mem.set({ ...e, frozen: false });
          ({ body, fetchedAt: at } = e);
        }
        const rows = (JSON.parse(body) as { body?: { score?: unknown }[] }).body ?? [];
        const stmts = [];
        for (const rank of ranks) {
          if (done.has(rank) || Math.ceil(rank / PAGE) !== page) continue;
          done.add(rank); // a rank past the end of a short board is skipped
          const score = rows[(rank - 1) % PAGE]?.score;
          if (typeof score === "number") {
            stmts.push(
              deps.db
                .prepare("INSERT OR REPLACE INTO ct_cutoffs (ct_id, board, day, rank, score, at) VALUES (?, ?, ?, ?, ?, ?)")
                .bind(ctId, board, day, rank, score, at),
            );
          }
        }
        if (stmts.length) await deps.db.batch(stmts);
        if (requests) return 1; // pages from memory were free; the first NK page ends the step
      }
    }
    finished.add(tag);
  } catch (err) {
    backoff.set(tag, now + RETRY_MS);
    console.warn("ct cutoffs: step failed", ctId, String(err).slice(0, 120));
  }
  return 0;
}

/** Hot-cron hook for the featured CT: live -> today's snapshot; ended -> the final one once NK's copy is final. */
export async function ctCutoffTick(deps: Deps, ct: { id: string; live: boolean; end: number }, now: number): Promise<number> {
  if (ct.live) return ctCutoffStep(deps, ct.id, Math.floor(now / DAY), Math.floor(now / DAY) * DAY);
  if (now >= ct.end + ORIGIN_MAX_AGE_MS) return ctCutoffStep(deps, ct.id, 0, ct.end + ORIGIN_MAX_AGE_MS);
  return 0;
}

// ─────────────────────────────── reads

export interface Snap {
  at: number;
  ranks: Record<string, number>;
}

/** Oldest first (the final snapshot, day 0, last). Unknown id: empty arrays. */
export async function ctCutoffs(db: D1Like, id: string): Promise<{ id: string; team: Snap[]; player: Snap[] }> {
  const { results } = await db
    .prepare("SELECT board, day, rank, score, at FROM ct_cutoffs WHERE ct_id = ? ORDER BY (day = 0), day, rank")
    .bind(id)
    .all<{ board: CtBoard; day: number; rank: number; score: number; at: number }>();
  const out = { id, team: [] as Snap[], player: [] as Snap[] };
  const snaps = new Map<string, Snap>();
  for (const r of results) {
    const k = `${r.board}:${r.day}`;
    let s = snaps.get(k);
    if (!s) {
      s = { at: r.at, ranks: {} };
      snaps.set(k, s);
      out[r.board].push(s);
    }
    s.ranks[r.rank] = r.score;
    s.at = Math.max(s.at, r.at);
  }
  return out;
}

export interface CtRelics {
  id: string;
  start: number;
  end: number;
  relics: string[];
  banners: number;
  games: Record<string, number>;
}

let relicsMemo: { at: number; json: string } | null = null;
const RELICS_TTL_MS = 10 * 60_000;

const TILES_FROM = "FROM responses r JOIN events e ON e.kind = 'ct' AND r.key = '/btd6/ct/' || e.id || '/tiles'";
const TILES_OK = "r.frozen = 1 AND r.ok = 1";

/** Archived CTs' relic tiles, newest first, aggregated by D1 (json_each) so the Worker parses little. Memoised 10 min. */
export async function ctRelicsJson(db: D1Like, now: number): Promise<string> {
  if (relicsMemo && now - relicsMemo.at < RELICS_TTL_MS) return relicsMemo.json;
  const [a, b] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.start_at AS start, e.end_at AS end,
           (SELECT json_group_array(substr(json_extract(j.value,'$.type'), 9)) FROM json_each(r.body,'$.body.tiles') j
             WHERE json_extract(j.value,'$.type') LIKE 'Relic - %') AS relics,
           (SELECT COUNT(*) FROM json_each(r.body,'$.body.tiles') j WHERE json_extract(j.value,'$.type') = 'Banner') AS banners
         ${TILES_FROM} WHERE ${TILES_OK} ORDER BY e.start_at DESC`,
      )
      .all<{ id: string; start: number; end: number; relics: string; banners: number }>(),
    db
      .prepare(
        `SELECT e.id, json_extract(j.value,'$.gameType') AS g, COUNT(*) AS n
         ${TILES_FROM}, json_each(r.body,'$.body.tiles') j
         WHERE ${TILES_OK} AND json_extract(j.value,'$.gameType') IS NOT NULL AND json_extract(j.value,'$.gameType') <> 'TeamStart'
         GROUP BY e.id, g`,
      )
      .all<{ id: string; g: string; n: number }>(),
  ]);
  const games = new Map<string, Record<string, number>>();
  for (const r of b.results) {
    if (!games.has(r.id)) games.set(r.id, {});
    games.get(r.id)![r.g] = r.n;
  }
  const cts: CtRelics[] = a.results.map((r) => ({
    id: r.id,
    start: r.start,
    end: r.end,
    relics: JSON.parse(r.relics) as string[],
    banners: r.banners,
    games: games.get(r.id) ?? {},
  }));
  const json = JSON.stringify({ cts });
  relicsMemo = { at: now, json };
  return json;
}

// ─────────────────────────────── routing (shared by /api and /api/batch)

export const CT_API = /^\/api\/ct\/(?:relics|([A-Za-z0-9_-]{4,64})\/cutoffs)$/;

/** null = not a CT API path. maxAgeS: short while a CT is live, long once it ended. status 503 on a D1 failure. */
export async function ctApi(deps: Deps, path: string): Promise<{ status: number; body: string; maxAgeS: number } | null> {
  const m = CT_API.exec(path);
  if (!m) return null;
  try {
    if (!m[1]) return { status: 200, body: await ctRelicsJson(deps.db, deps.now()), maxAgeS: 3600 };
    const row = await deps.db.prepare("SELECT end_at FROM events WHERE kind = 'ct' AND id = ?").bind(m[1]).first<{ end_at: number }>();
    const ended = !!row && row.end_at + ORIGIN_MAX_AGE_MS < deps.now();
    return { status: 200, body: JSON.stringify(await ctCutoffs(deps.db, m[1])), maxAgeS: ended ? 86_400 : 300 };
  } catch (err) {
    console.warn("ct api: D1 read failed", String(err));
    return { status: 503, body: "", maxAgeS: 0 };
  }
}
