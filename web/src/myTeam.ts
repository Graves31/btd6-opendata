// The CT team this browser follows (set on a team page, shown on /ct). localStorage only, never sent anywhere.
const KEY = "ct-team";

export interface MyTeam {
  /** guild id (the team page id) */
  id: string;
  name: string;
}

export function myTeam(): MyTeam | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as MyTeam | null;
    return v && typeof v.id === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

export function setMyTeam(t: MyTeam | null): void {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify({ id: t.id, name: t.name }));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

// ─────────────────────────────── change signal + pure helpers (tested in test/ctOverview.test.ts)

const subs = new Set<() => void>();
/** Call `fn` whenever the followed team changes (this tab or another). Returns the unsubscribe. */
export function onMyTeam(fn: () => void): () => void {
  subs.add(fn);
  const st = (e: StorageEvent) => e.key === KEY && fn();
  if (typeof addEventListener === "function") addEventListener("storage", st);
  return () => {
    subs.delete(fn);
    if (typeof removeEventListener === "function") removeEventListener("storage", st);
  };
}
export function followTeam(t: MyTeam | null): void {
  setMyTeam(t);
  subs.forEach((f) => f());
}

export interface TeamHistoryEntry {
  ct: string;
  start: number;
  end: number;
  rank: number | null;
  total: number | null;
  score: number | null;
  group: { rank: number | null; of: number | null } | null;
}

/** Newest first. */
export const byRecent = (e: TeamHistoryEntry[]) => [...e].sort((a, b) => b.start - a.start);

/** Best and most recent global rank among the entries (optionally leaving one CT out). */
export function placings(entries: TeamHistoryEntry[], skipCt?: string): { best: number; last: number } | undefined {
  const ranked = byRecent(entries).filter((e) => e.rank !== null && e.ct !== skipCt);
  if (!ranked.length) return undefined;
  return { best: Math.min(...ranked.map((e) => e.rank!)), last: ranked[0].rank! };
}

/**
 * The next medal a team at `rank` can still reach: the nearest cut-off above it. `snap` is a cut-off snapshot
 * (rank -> score); the gap is only known when it holds that exact rank.
 */
export function nextMedal(
  cuts: { rank: number; label: string; coveredBy?: string }[],
  rank: number,
  score: number,
  snap?: Record<string, number>,
): { label: string; rank: number; gap?: number } | undefined {
  const above = cuts.filter((c) => !c.coveredBy && c.rank < rank).sort((a, b) => b.rank - a.rank)[0];
  if (!above) return undefined;
  const at = snap?.[String(above.rank)];
  return { label: above.label, rank: above.rank, gap: typeof at === "number" ? Math.max(0, at - score) : undefined };
}
