// Cron (hourly): permanently archive events once they freeze.
//
// When an event is past `end + LEADERBOARD_FREEZE_GRACE_MS`, every document and every leaderboard page
// (≤ 1000 rows per board) is fetched once and stored in D1 with frozen = 1. Work is queued in
// `archive_queue` and drained ≤ ARCHIVE_BUDGET upstream requests per run (≤ 1,080/day). A boss event
// (≤ 320 pages) completes within a few hours; meanwhile the proxy already serves and freezes any page a
// visitor asks for, so the archiver only has to fill in what nobody requested.

import { LEADERBOARD_FREEZE_GRACE_MS, matchRoute, type EventKind } from "../nk/routes.ts";
import type { Deps } from "./deps.ts";
import { eventKeys } from "./events.ts";
import { d1FreezeStmt, d1Get, d1PutStmt, mem } from "./store.ts";
import { originCooldownS } from "./limit.ts";
import { teamIndexStmts } from "./teams.ts";
import { fetchUpstream, mapLimit } from "./upstream.ts";

/** Upstream requests per run (free plan: 50 subrequests per invocation). */
export const ARCHIVE_BUDGET = 45;
/** Events expanded into the queue per run. */
const EVENTS_PER_RUN = 3;

export interface ArchiveResult {
  expanded: string[];
  fetched: number;
  failed: number;
  completed: number;
  queued: number;
  /** D1 failed (e.g. daily write quota): the run stopped early; unfinished jobs stay queued. */
  error?: string;
}

export async function runArchive(deps: Deps, budget = ARCHIVE_BUDGET): Promise<ArchiveResult> {
  const result: ArchiveResult = { expanded: [], fetched: 0, failed: 0, completed: 0, queued: 0 };
  try {
    await archiveRun(deps, budget, result);
  } catch (err) {
    // Every step is idempotent (queue rows are only deleted together with their frozen write), so the
    // next hourly run simply resumes.
    result.error = String(err);
  }
  return result;
}

async function archiveRun(deps: Deps, budget: number, result: ArchiveResult): Promise<void> {
  const now = deps.now();
  const db = deps.db;

  // 1. Expand newly frozen events into queue entries.
  const { results: due } = await db
    .prepare("SELECT kind, id FROM events WHERE archive_state = 0 AND end_at + ? <= ? ORDER BY end_at LIMIT ?")
    .bind(LEADERBOARD_FREEZE_GRACE_MS, now, EVENTS_PER_RUN)
    .all<{ kind: EventKind; id: string }>();
  if (due.length) {
    const stmts = [];
    for (const ev of due) {
      for (const key of eventKeys(ev.kind, ev.id)) stmts.push(enqueue(deps, key, ev.kind, ev.id, now));
      stmts.push(db.prepare("UPDATE events SET archive_state = 1 WHERE kind = ? AND id = ?").bind(ev.kind, ev.id));
      result.expanded.push(`${ev.kind}:${ev.id}`);
    }
    await db.batch(stmts);
  }

  // 2. Drain the queue. After the first D1 failure no further upstream request is made: its result
  //    couldn't be stored (and would be fetched again next run).
  const { results: jobs } = await db
    .prepare("SELECT key, kind, event_id FROM archive_queue ORDER BY added_at, key LIMIT ?")
    .bind(budget)
    .all<{ key: string; kind: EventKind; event_id: string }>();

  let d1Error: unknown = null;
  // Two at a time: NK rate-limits bursts (see limit.ts), and the archive is never in a hurry.
  await mapLimit(jobs, 2, async (job) => {
    if (d1Error || originCooldownS(deps.now())) return; // cooldown: stays queued for the next run
    try {
      const prev = await d1Get(db, job.key);
      const writes = [];
      if (!prev?.frozen) {
        let got;
        try {
          got = await fetchUpstream(deps, job.key, null);
          result.fetched++;
        } catch {
          result.failed++;
          return; // stays queued; retried next run
        }
        if (d1Error) return;
        if (!got.ok && prev?.ok) {
          // NK no longer has it, but we do: freeze our copy rather than the error.
          writes.push(d1FreezeStmt(db, job.key));
          writes.push(...teamIndexStmts(db, job.key, prev.body));
        } else {
          const entry = { ...got, frozen: true };
          writes.push(d1PutStmt(db, entry));
          writes.push(...expandPages(deps, job.key, entry.body, job.kind, job.event_id, now));
          if (entry.ok) writes.push(...teamIndexStmts(db, job.key, entry.body)); // CT team boards → ct_teams
          mem.set(entry);
        }
      }
      writes.push(db.prepare("DELETE FROM archive_queue WHERE key = ?").bind(job.key));
      await db.batch(writes);
    } catch (err) {
      d1Error ??= err;
    }
  });
  if (d1Error) throw d1Error;

  // 3. Events whose queue is empty are fully archived.
  const done = await db
    .prepare(
      `UPDATE events SET archive_state = 2 WHERE archive_state = 1 AND NOT EXISTS
         (SELECT 1 FROM archive_queue q WHERE q.kind = events.kind AND q.event_id = events.id)`,
    )
    .run();
  result.completed = changesOf(done);
  const left = await db.prepare("SELECT COUNT(*) AS n FROM archive_queue").first<{ n: number }>();
  result.queued = left?.n ?? 0;
}

function enqueue(deps: Deps, key: string, kind: EventKind, eventId: string, now: number) {
  return deps.db
    .prepare("INSERT OR IGNORE INTO archive_queue (key, kind, event_id, added_at) VALUES (?, ?, ?, ?)")
    .bind(key, kind, eventId, now);
}

/** After fetching page 1 of a leaderboard, queue pages 2..maxPages. */
function expandPages(deps: Deps, key: string, body: string, kind: EventKind, eventId: string, now: number) {
  if (key.includes("?page=")) return [];
  const m = matchRoute(key);
  if (!m.ok || !m.route.paging) return [];
  let maxPages = 0;
  try {
    maxPages = Number((JSON.parse(body) as { maxPages?: number }).maxPages ?? 0);
  } catch {
    return [];
  }
  const cap = Math.min(maxPages, m.route.paging.maxPages ?? maxPages);
  const stmts = [];
  for (let p = 2; p <= cap; p++) stmts.push(enqueue(deps, `${key}?page=${p}`, kind, eventId, now));
  return stmts;
}

function changesOf(res: unknown): number {
  const meta = (res as { meta?: { changes?: number }; changes?: number }) ?? {};
  return Number(meta.meta?.changes ?? meta.changes ?? 0);
}
