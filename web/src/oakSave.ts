// Pure readers of the player's own save (see oak.ts): map medals and Monkey Knowledge. No fetching here.
import type { UserSave } from "../../src/nk/types.ts";

/** Difficulty → [medal key, save mode] in the game's order. "Standard" is the difficulty's own medal; Clicks = CHIMPS. */
export const MEDAL_GRID: [diff: "Easy" | "Medium" | "Hard", modes: [key: string, mode: string][]][] = [
  ["Easy", [["Easy", "Standard"], ["PrimaryOnly", "PrimaryOnly"], ["Deflation", "Deflation"]]],
  ["Medium", [["Medium", "Standard"], ["MilitaryOnly", "MilitaryOnly"], ["Apopalypse", "Apopalypse"], ["Reverse", "Reverse"]]],
  ["Hard", [["Hard", "Standard"], ["MagicOnly", "MagicOnly"], ["DoubleMoabHealth", "DoubleMoabHealth"], ["HalfCash", "HalfCash"], ["AlternateBloonsRounds", "AlternateBloonsRounds"], ["Impoppable", "Impoppable"], ["Clicks", "Clicks"]]],
];

export interface MedalCell {
  /** modeMedal art key (without the coop: prefix) */
  key: string;
  earned: boolean;
  bestRound: number;
  times: number;
}
export interface MapMedals {
  single: { diff: string; cells: MedalCell[] }[];
  coop: { diff: string; cells: MedalCell[] }[];
  /** Solo medals earned / available on this map. */
  earned: number;
  total: number;
}

/** One map's medals from the save, solo and co-op. Black-border / CHIMPS-BLACK are not inferred. */
export function mapMedals(save: UserSave, map: string): MapMedals {
  const p = save.mapProgress?.[map]?.difficulty;
  const side = (s: "single" | "coop") =>
    MEDAL_GRID.map(([diff, modes]) => ({
      diff,
      cells: modes.map(([key, mode]) => {
        const m = p?.[diff]?.[s]?.[mode];
        return { key, earned: !!m?.completed, bestRound: m?.bestRound ?? 0, times: m?.timesCompleted ?? 0 };
      }),
    }));
  const single = side("single");
  const cells = single.flatMap((r) => r.cells);
  return { single, coop: side("coop"), earned: cells.filter((c) => c.earned).length, total: cells.length };
}

export interface MedalRow {
  difficulty: "Easy" | "Medium" | "Hard";
  mode: string;
  /** Key in the `modeMedal` art family ("coop:" + it for co-op). Standard = the difficulty's own medal. */
  medal: string;
  /** Maps completed in this difficulty / mode, solo and co-op. */
  solo: number;
  coop: number;
}

/**
 * Maps completed per medal of MEDAL_GRID (/me summary); medals nobody earned are left out. The save also holds
 * modes outside the grid (Sandbox, SuperChimps, odd ones like Easy Reverse): no medal, not counted.
 */
export function medalCounts(save: UserSave): MedalRow[] {
  const maps = Object.values(save.mapProgress ?? {});
  const done = (d: MedalRow["difficulty"], s: "single" | "coop", mode: string) =>
    maps.filter((mp) => mp.difficulty?.[d]?.[s]?.[mode]?.completed).length;
  return MEDAL_GRID.flatMap(([difficulty, modes]) =>
    modes.map(([medal, mode]) => ({ difficulty, mode, medal, solo: done(difficulty, "single", mode), coop: done(difficulty, "coop", mode) })),
  ).filter((r) => r.solo + r.coop > 0);
}

export interface InstaRow {
  tower: string;
  /** Distinct tier sets owned. */
  sets: number;
  /** Instas in total. */
  total: number;
  /** ["0-3-2", count], sorted by tiers. */
  tiers: [string, number][];
}

/** Insta Monkey collection per tower, most instas first. */
export function instaSummary(save: UserSave): InstaRow[] {
  return Object.entries(save.instaTowers ?? {})
    .map(([tower, t]) => {
      const tiers = Object.entries(t)
        .filter(([, n]) => n > 0)
        .map(([k, n]): [string, number] => [k.split("").join("-"), n])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return { tower, sets: tiers.length, total: tiers.reduce((s, [, n]) => s + n, 0), tiers };
    })
    .filter((r) => r.sets > 0)
    .sort((a, b) => b.total - a.total || (a.tower < b.tower ? -1 : 1));
}

/** Bank planner Monkey Knowledge defaults from the save; a toggle the URL sets (`mk` present) is left alone. */
export function bankKnowledge(save: UserSave | undefined, urlSetsMk: boolean, route: { bb: boolean; mvb: boolean }) {
  const k = save?.acquiredKnowledge;
  return {
    bb: !urlSetsMk && k ? !!k.BiggerBanks : route.bb,
    mvb: !urlSetsMk && k ? !!k.MoreValuableBananas : route.mvb,
    deposits: k ? !!k.BankDeposits : undefined,
  };
}
