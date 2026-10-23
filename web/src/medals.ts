// Which event medal a leaderboard placement earns, per leaderboard type.
// Sources (checked 2026-09-25): Blooncyclopedia "Medal" (boss & race) and "Contested Territory (BTD6)" (CT), and
// the game's own medal sprite sets, which contain exactly these tiers per board (see scripts/build_art.py).
// Percent brackets need the board's total entries; without it (co-op boss boards: NK publishes no total) only
// the rank brackets are applied — nothing is guessed.

import { human } from "./format.ts";

export type Board = "boss" | "bossElite" | "race" | "ctPlayer" | "ctTeam" | "ctGroup";

/** [tier, best rank that qualifies | null, top fraction | null], best tier first. */
type Bracket = [tier: string, rank: number | null, pct: number | null];

const BOSS_RACE: Bracket[] = [
  ["BlackDiamond", 1, null],
  ["RedDiamond", 2, null],
  ["BlueDiamond", 3, null],
  ["GoldDiamond", 50, null],
  ["DoubleGold", 100, null],
  ["GoldSilver", null, 0.1],
  ["DoubleSilver", null, 0.25],
  ["Silver", null, 0.5],
  ["Bronze", null, 0.75],
];

const BRACKETS: Record<Board, Bracket[]> = {
  boss: BOSS_RACE,
  bossElite: BOSS_RACE,
  race: BOSS_RACE,
  // CT global players: no Black/Red Diamond
  ctPlayer: [
    ["BlueDiamond", 25, null],
    ["GoldDiamond", 100, null],
    ["DoubleGold", null, 0.01],
    ["GoldSilver", null, 0.1],
    ["DoubleSilver", null, 0.25],
    ["Silver", null, 0.5],
    ["Bronze", null, 0.75],
  ],
  // CT global teams
  ctTeam: [
    ["BlackDiamond", 1, null],
    ["RedDiamond", 2, null],
    ["BlueDiamond", 3, null],
    ["GoldDiamond", 25, null],
    ["DoubleGold", 100, null],
    ["GoldSilver", null, 0.01],
    ["DoubleSilver", null, 0.1],
    ["Silver", null, 0.25],
    ["Bronze", null, 0.75],
  ],
  // a team's CT group (local teams): four medals
  ctGroup: [
    ["BlueDiamond", 1, null],
    ["DoubleGold", 2, null],
    ["Silver", 3, null],
    ["Bronze", 4, null],
  ],
};

/** In-game names of the medal tiers. */
export const MEDAL_NAME: Record<string, string> = {
  BlackDiamond: "Black Diamond",
  RedDiamond: "Red Diamond",
  BlueDiamond: "Blue Diamond",
  GoldDiamond: "Gold Diamond",
  DoubleGold: "Double Gold",
  GoldSilver: "Gold Silver",
  DoubleSilver: "Double Silver",
  Silver: "Silver",
  Bronze: "Bronze",
  Participation: "Participation",
};

/**
 * A tier's name on a board. The CT team and group boards call their Blue Diamond just "Diamond" (as the team
 * page's CT badges do), so every tooltip for the same medal agrees.
 */
export const medalName = (board: Board, tier: string) =>
  tier === "BlueDiamond" && (board === "ctTeam" || board === "ctGroup") ? "Diamond" : (MEDAL_NAME[tier] ?? tier);

/** A CT ranking tier on a profile page (the game's "Diamond" for BlueDiamond; unknown tiers humanised). */
export const ctTierName = (t: string) => (t === "BlueDiamond" ? "Diamond" : (MEDAL_NAME[t] ?? human(t)));

/** eventMedal art prefix per board (bare keys are the race set). */
const ART_PREFIX: Record<Board, string> = {
  boss: "boss:",
  bossElite: "bossElite:",
  race: "",
  ctPlayer: "ctGlobal:",
  ctTeam: "ctTeam:",
  ctGroup: "ctGroup:",
};

/** The medal tier a placement earns, or undefined (outside every bracket, or unknown without a total). */
export function medalTier(board: Board, rank: number, total?: number): string | undefined {
  for (const [tier, r, pct] of BRACKETS[board]) {
    if (r !== null && rank <= r) return tier;
    if (pct !== null && total && total > 0 && rank <= Math.max(1, Math.floor(total * pct))) return tier;
  }
  return undefined;
}

/** The eventMedal sprite key for a board's tier. */
export const medalArt = (board: Board, tier: string) => ART_PREFIX[board] + tier;

/** Human bracket label for tooltips: "1st", "Top 50", "Top 10%". */
export function bracketLabel(board: Board, tier: string): string {
  const b = BRACKETS[board].find(([t]) => t === tier);
  if (!b) return "";
  const [, r, pct] = b;
  if (r !== null) return r === 1 ? "1st" : r === 2 ? "2nd" : r === 3 ? "3rd" : board === "ctGroup" ? `${r}th` : `Top ${r}`;
  return `Top ${Math.round(pct! * 100)}%`;
}

/** Rows per leaderboard page, per board (NK pages; co-op boss boards list one row per teammate). */
export const PAGE_SIZE: Record<Board, number> = { boss: 25, bossElite: 25, race: 50, ctPlayer: 25, ctTeam: 25, ctGroup: 25 };
/** NK publishes at most the top 1000 of every leaderboard. */
export const BOARD_CAP = 1000;

export interface Cutoff {
  tier: string;
  /** The last rank that still earns this medal. */
  rank: number;
  /** "1st", "Top 50", "Top 10%". */
  label: string;
  /**
   * Set when nobody can earn this medal right now: every rank inside its bracket already earns the better medal
   * named here (e.g. Top 25% of 248 = rank ≤ 62, all inside "Top 100"). Shown greyed, with that reason.
   */
  coveredBy?: string;
}

/**
 * The rank boundary of each medal bracket, best tier first: the worst rank that still earns it. Percent brackets
 * need the board's total; without one (co-op boss boards) only rank brackets are returned. A bracket that falls
 * inside a better one on a small board is returned with `coveredBy` (nobody earns it yet), and no boundary is past
 * the last entry.
 */
export function cutoffs(board: Board, total?: number): Cutoff[] {
  const out: Cutoff[] = [];
  for (const [tier, r, pct] of BRACKETS[board]) {
    let rank: number;
    if (r !== null) rank = r;
    else if (pct !== null && total && total > 0) rank = Math.max(1, Math.floor(total * pct));
    else continue;
    if (total && total > 0) rank = Math.min(rank, total);
    const best = out.filter((c) => !c.coveredBy).at(-1);
    if (best && rank <= best.rank) out.push({ tier, rank, label: bracketLabel(board, tier), coveredBy: best.label });
    else out.push({ tier, rank, label: bracketLabel(board, tier) });
  }
  return out;
}
