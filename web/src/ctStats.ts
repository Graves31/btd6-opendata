// Pure CT helpers for the event page (no DOM): counts from the tiles, cut-off trend, relic history.
import type { CTTile } from "../../src/nk/types.ts";

/** One daily cut-off snapshot from /api/ct/:id/cutoffs (`ranks`: rank → score). */
export interface Snap {
  at: number;
  ranks: Record<string, number>;
}
export interface CTCutoffs {
  id: string;
  team: Snap[];
  player: Snap[];
}
/** One archived CT from /api/ct/relics. */
export interface RelicCT {
  id: string;
  start: number;
  end: number;
  relics: string[];
  banners: number;
  games: Record<string, number>;
}

export const relicOf = (t: CTTile): string | undefined => (t.type.startsWith("Relic - ") ? t.type.slice(8) : undefined);

/** Counts shown in the header of a CT that hasn't started (the tiles are already published). */
export function tileStats(tiles: CTTile[]) {
  const games: Record<string, number> = {};
  let relics = 0;
  let banners = 0;
  let starts = 0;
  for (const t of tiles) {
    games[t.gameType] = (games[t.gameType] ?? 0) + 1;
    if (relicOf(t)) relics++;
    if (t.type === "Banner") banners++;
    if (t.type === "TeamStart") starts++;
  }
  return { tiles: tiles.length, relics, banners, starts, games };
}

/**
 * Score gained at `rank` between the last two snapshots, and when the earlier one was taken. undefined = no earlier
 * snapshot, or the rank is missing from one of them.
 */
export function cutoffTrend(snaps: Snap[] | undefined, rank: number): { delta: number; since: number; at: number } | undefined {
  if (!snaps || snaps.length < 2) return;
  const a = snaps[snaps.length - 2];
  const b = snaps[snaps.length - 1];
  const x = a.ranks[rank];
  const y = b.ranks[rank];
  return typeof x === "number" && typeof y === "number" ? { delta: y - x, since: a.at, at: b.at } : undefined;
}

/** How one relic of this CT did in the other archived CTs (this CT itself excluded). */
export function relicHistory(thisId: string, relic: string, cts: RelicCT[] | undefined) {
  const prev = (cts ?? []).filter((c) => c.id !== thisId);
  const hit = prev.filter((c) => c.relics.includes(relic));
  return { seen: hit.length, of: prev.length, last: hit.reduce((m, c) => Math.max(m, c.end), 0) || undefined };
}

/** This CT's game-type counts against the average of the previous CTs (rounded); undefined without previous CTs. */
export function gameMix(thisId: string, games: Record<string, number>, cts: RelicCT[] | undefined) {
  const prev = (cts ?? []).filter((c) => c.id !== thisId && Object.keys(c.games ?? {}).length);
  if (!prev.length) return;
  const out: Record<string, { now: number; avg: number }> = {};
  for (const k of Object.keys(games)) {
    out[k] = { now: games[k], avg: Math.round(prev.reduce((s, c) => s + (c.games[k] ?? 0), 0) / prev.length) };
  }
  return { of: prev.length, by: out };
}
