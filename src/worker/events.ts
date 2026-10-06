// Event timing (start/end) — drives freezing and "not started yet" answers — plus the local event archive.

import type { EventKind, EventTiming } from "../nk/routes.ts";
import type { D1Like, Deps } from "./deps.ts";
import { getHot, hotPayload } from "./store.ts";

/** List endpoint for each event kind. */
export const LIST_PATH: Record<EventKind, string> = {
  race: "/btd6/races",
  boss: "/btd6/bosses",
  ct: "/btd6/ct",
  odyssey: "/btd6/odyssey",
};

/** Every document and page-1 leaderboard key of an event (further pages come from `maxPages`). */
export function eventKeys(kind: EventKind, id: string): string[] {
  switch (kind) {
    case "boss": {
      const keys = [`/btd6/bosses/${id}/metadata/standard`, `/btd6/bosses/${id}/metadata/elite`];
      for (const type of ["standard", "elite"]) {
        for (let size = 1; size <= 4; size++) keys.push(`/btd6/bosses/${id}/leaderboard/${type}/${size}`);
      }
      return keys;
    }
    case "race":
      return [`/btd6/races/${id}/metadata`, `/btd6/races/${id}/leaderboard`];
    case "ct":
      return [`/btd6/ct/${id}/tiles`, `/btd6/ct/${id}/leaderboard/player`, `/btd6/ct/${id}/leaderboard/team`];
    case "odyssey":
      return ["easy", "medium", "hard"].flatMap((d) => [`/btd6/odyssey/${id}/${d}`, `/btd6/odyssey/${id}/${d}/maps`]);
  }
}

export interface ListItem {
  id: string;
  start: number;
  end: number;
  [k: string]: unknown;
}

/** Timings never change once known; keep them for the isolate's lifetime. */
const timingMemo = new Map<string, EventTiming>();

export async function getTiming(deps: Deps, kind: EventKind, id: string): Promise<EventTiming | undefined> {
  const memoKey = `${kind}:${id}`;
  const memo = timingMemo.get(memoKey);
  if (memo) return memo;

  const hot = await getHot(deps);
  const list = hot ? hotPayload(hot, LIST_PATH[kind]) : undefined;
  let found: EventTiming | undefined;
  if (Array.isArray(list)) {
    const item = (list as ListItem[]).find((x) => x.id === id);
    if (item) found = { start: item.start, end: item.end };
  }
  if (!found) {
    try {
      const row = await deps.db
        .prepare("SELECT start_at, end_at FROM events WHERE kind = ? AND id = ?")
        .bind(kind, id)
        .first<{ start_at: number; end_at: number }>();
      if (row) found = { start: row.start_at, end: row.end_at };
    } catch (err) {
      // D1 unavailable: fall back to the class default policy (always safe); not memoised, retried next time.
      console.warn("timing: D1 read failed", String(err));
    }
  }
  if (found) timingMemo.set(memoKey, found);
  return found;
}

export function resetTimingMemo(): void {
  timingMemo.clear();
}

/**
 * Upsert list items into the permanent `events` table. Rows are only rewritten when their JSON changed
 * (totalScores moves during an event), which keeps D1 row writes low.
 */
export function upsertEventStmts(db: D1Like, kind: EventKind, items: ListItem[]) {
  return items.map((it) =>
    db
      .prepare(
        `INSERT INTO events (kind, id, start_at, end_at, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET start_at = excluded.start_at, end_at = excluded.end_at, data = excluded.data
         WHERE events.data <> excluded.data`,
      )
      .bind(kind, it.id, it.start, it.end, JSON.stringify(it)),
  );
}

/**
 * Archived event list for a kind, newest first — history beyond NK's ~2–3 month window — as a JSON array
 * text of the list items plus `archived`. `data` is our own JSON.stringify of an object, so the flag is
 * spliced in as text instead of parsing and re-serialising every row.
 */
export async function listHistoryJson(db: D1Like, kind: EventKind, before: number, limit: number): Promise<string> {
  const { results } = await db
    .prepare(
      "SELECT data, archive_state FROM events WHERE kind = ? AND start_at < ? ORDER BY start_at DESC LIMIT ?",
    )
    .bind(kind, before, limit)
    .all<{ data: string; archive_state: number }>();
  const items = results.map((r) => {
    const flag = `"archived":${r.archive_state === 2}}`;
    return r.data === "{}" ? `{${flag}` : `${r.data.slice(0, -1)},${flag}`;
  });
  return `[${items.join(",")}]`;
}
