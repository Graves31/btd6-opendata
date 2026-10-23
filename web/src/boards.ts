// Pure leaderboard logic shared by the event views. No DOM, no store: unit-tested in test/events.test.ts.

import type { ScorePart } from "../../src/nk/types.ts";
import { fixParts, fmtInt } from "./format.ts";

/** Score part holding when the run was submitted (after fixParts), counted from the event start. */
export const SUBMITTED = "Time after event start";

/**
 * What a co-op team shares: its score parts minus submission time. Each teammate's row carries its own
 * submission time, so grouping on the raw parts split one team into several rows.
 */
export function teamSig(r: { score: number; scoreParts: ScorePart[] }, scoring?: string): string {
  const parts = fixParts(r.scoreParts, scoring).filter((p) => p.name !== SUBMITTED);
  return JSON.stringify([r.score, parts.map((p) => [p.name, p.score])]);
}

export interface RankedRow<T> {
  r: T;
  /** Set on a team's first row (every row when solo); null on the teammates under it. */
  rank: number | null;
  /** Co-op rank estimated without the earlier pages (teams can be short, so rows ≠ teams × size). */
  approx?: boolean;
}

/**
 * Rank one page of a boss board. Solo: one rank per row. Co-op (n > 1): consecutive rows with the same team
 * score form one team (at most n rows, so two tied teams stay apart; a team may also have fewer than n players).
 * NK pages hold 25 rows, not 25 teams, so a co-op rank on page p is only exact when every earlier page is known:
 * pass their rows, in order, as `before`. Without them the first rank is estimated from full teams and every rank
 * on the page is marked `approx`.
 */
export function rankBossRows<T extends { score: number; scoreParts: ScorePart[] }>(
  rows: T[],
  opts: { n: number; page: number; scoring?: string; perPage?: number; before?: T[] },
): RankedRow<T>[] {
  const per = opts.perPage ?? 25;
  if (opts.n <= 1) return rows.map((r, i) => ({ r, rank: (opts.page - 1) * per + i + 1 }));
  const exact = opts.page === 1 || opts.before !== undefined;
  const lead = opts.page === 1 ? [] : (opts.before ?? []);
  const all = group([...lead, ...rows], opts.n, opts.scoring);
  if (exact) return all.slice(lead.length);
  // Estimate: the teams before this page were full.
  const offset = Math.floor(((opts.page - 1) * per) / opts.n);
  return all.map((x) => ({ r: x.r, rank: x.rank === null ? null : x.rank + offset, approx: true }));
}

function group<T extends { score: number; scoreParts: ScorePart[] }>(rows: T[], n: number, scoring?: string): RankedRow<T>[] {
  const out: RankedRow<T>[] = [];
  let rank = 0;
  let sig = "";
  let start = 0;
  rows.forEach((r, i) => {
    const s = teamSig(r, scoring);
    const first = i === 0 || s !== sig || i - start >= n;
    if (first) {
      start = i;
      rank++;
    }
    sig = s;
    out.push({ r, rank: first ? rank : null });
  });
  return out;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function agoText(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * The freshness line's parts: "Final" for an ended event, else "Updated N min ago" (server fetch time), then
 * "Showing top 1,000 of 13,546" when the board shows only part of its entries.
 */
export function freshParts(p: { fetchedAt?: number | null; now: number; ended?: boolean; shown?: number; total?: number }): string[] {
  const out: string[] = [];
  if (p.ended) out.push("Final");
  else if (p.fetchedAt) out.push(`Updated ${agoText(p.now - p.fetchedAt)}`);
  if (p.total && p.total > 0 && p.shown !== undefined) {
    const shown = Math.min(p.shown, p.total);
    out.push(shown < p.total ? `Showing top ${fmtInt(shown)} of ${fmtInt(p.total)}` : `All ${fmtInt(p.total)} entries`);
  }
  return out;
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}
