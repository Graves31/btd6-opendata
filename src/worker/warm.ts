// Profile warmer (runs inside the per-minute hot cron).
//
// Leaderboard pages link to up to 25 player/team profiles, and the frontend prefetches the ones on screen.
// Fetching them all from NK at once trips NK's (undocumented) rate limit, so the cron warms the profiles of
// the featured events' page-1 boards a few per minute instead, best ranks first. The most-viewed profiles
// are then already in D1 when anyone opens or prefetches them.

import type { Deps } from "./deps.ts";
import { originCooldownS } from "./limit.ts";
import { d1PutStmt, mem, type HotMetaEntry } from "./store.ts";
import { fetchUpstream, UpstreamError } from "./upstream.ts";

/** Profiles fetched per cron run (≤ 5,760/day; hot cron + this stays far below 50 subrequests). */
export const WARM_PER_RUN = 4;
/** A warmed profile is re-warmed after this long. */
export const WARM_REFRESH_MS = 6 * 60 * 60_000;

/**
 * Profile keys linked from the hot set's page-1 leaderboards, best rank first across all boards. The cron
 * derives each board's profile list when the board arrives (hot.ts derive), so no board is parsed here.
 */
export function profileKeysOf(entries: Record<string, HotMetaEntry>): string[] {
  const ranked: { rank: number; key: string }[] = [];
  for (const e of Object.values(entries)) {
    if (!e.ok) continue;
    e.d?.p?.forEach((key, i) => ranked.push({ rank: i, key }));
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return [...new Set(ranked.map((r) => r.key))];
}

/**
 * Warm up to `max` stale profiles among `keys`. `idleUntil`: every profile was already fresh, so nothing is
 * due before this time (the cron then skips the lookup until it, unless the board's profiles change).
 */
export async function warmProfiles(
  deps: Deps,
  keys: string[],
  now: number,
  max = WARM_PER_RUN,
): Promise<{ warmed: number; idleUntil: number | null }> {
  if (originCooldownS(now) || !keys.length) return { warmed: 0, idleUntil: null };

  // One query for all keys (passed as a JSON array: D1 allows only 100 bound parameters).
  const fresh = new Map<string, number>();
  const { results } = await deps.db
    .prepare("SELECT key, fetched_at FROM responses WHERE fetched_at > ? AND key IN (SELECT value FROM json_each(?))")
    .bind(now - WARM_REFRESH_MS, JSON.stringify(keys))
    .all<{ key: string; fetched_at: number }>();
  for (const r of results) fresh.set(r.key, r.fetched_at);
  if (fresh.size >= new Set(keys).size) {
    return { warmed: 0, idleUntil: Math.min(...fresh.values()) + WARM_REFRESH_MS };
  }

  let warmed = 0;
  // One at a time: spreading requests is the point.
  for (const key of keys) {
    if (warmed >= max) break;
    if (fresh.has(key)) continue;
    try {
      const e = await fetchUpstream(deps, key, null);
      mem.set(e);
      if (e.ok) await d1PutStmt(deps.db, e).run();
      warmed++;
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 429) break; // NK says slow down: cooldown is set
      warmed++; // count failures against the budget too
    }
  }
  return { warmed, idleUntil: null };
}
