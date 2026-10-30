// Pure readers of the player's own save (see oak.ts): map medals and Monkey Knowledge. No fetching here.
import type { UserSave } from "../../src/nk/types.ts";
import { MAP_LIST } from "./data/names.ts";

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
  /** Built-in maps in the game (every one has every medal). */
  total: number;
  /** Map ids still missing this medal, in the game's map order. */
  soloMissing: string[];
  coopMissing: string[];
}

/**
 * Maps completed per medal of MEDAL_GRID (/me summary), with the maps still missing. The save also holds
 * modes outside the grid (Sandbox, SuperChimps, odd ones like Easy Reverse): no medal, not counted.
 */
export function medalCounts(save: UserSave): MedalRow[] {
  const maps = MAP_LIST.map(([id]) => id);
  const missing = (d: MedalRow["difficulty"], s: "single" | "coop", mode: string) =>
    maps.filter((id) => !save.mapProgress?.[id]?.difficulty?.[d]?.[s]?.[mode]?.completed);
  return MEDAL_GRID.flatMap(([difficulty, modes]) =>
    modes.map(([medal, mode]) => {
      const soloMissing = missing(difficulty, "single", mode);
      const coopMissing = missing(difficulty, "coop", mode);
      return { difficulty, mode, medal, total: maps.length, soloMissing, coopMissing, solo: maps.length - soloMissing.length, coop: maps.length - coopMissing.length };
    }),
  );
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

/** Every tier set an Insta Monkey can come in, "000".."520": paths 0–5, at most two upgraded, at most one above 2. */
export function instaPossible(): string[] {
  const out: string[] = [];
  for (let a = 0; a <= 5; a++)
    for (let b = 0; b <= 5; b++)
      for (let c = 0; c <= 5; c++) {
        const t = [a, b, c];
        if (t.filter((x) => x > 0).length <= 2 && t.filter((x) => x > 2).length <= 1) out.push(`${a}${b}${c}`);
      }
  return out;
}

/** What the game has (web/src/data/progress.json, from the install). Upgrades per tower, or flat under "_". */
export interface Progress {
  towers: string[];
  heroes: string[];
  upgrades: Record<string, string[]>;
  knowledge: { id: string; tree: string }[];
  /** Skin (the save's key) -> its hero and in-game name. */
  skins?: Record<string, { hero: string; name: string }>;
  achievements?: string[];
  /** Pro power upgrades per power id. */
  powerUpgrades?: Record<string, string[]>;
}

export interface Part {
  owned: number;
  total: number;
  /** Ids not owned, in the game's order. */
  missing: string[];
}
const part = (all: string[], has: (id: string) => boolean): Part => {
  const missing = all.filter((id) => !has(id));
  return { owned: all.length - missing.length, total: all.length, missing };
};

export const heroParts = (s: UserSave, p: Progress) => part(p.heroes, (h) => !!s.unlockedHeroes?.[h]);
export const towerParts = (s: UserSave, p: Progress) => part(p.towers, (t) => !!s.unlockedTowers?.[t]);
/** Skins only when the game list is known. */
export const skinParts = (s: UserSave, p: Progress) => (p.skins ? part(Object.keys(p.skins),(k) => !!s.unlockedSkins?.[k]) : null);
/** Achievements only when the game list is known. */
export const achievementParts = (s: UserSave, p: Progress) => {
  const got = new Set(s.achievementsClaimed);
  return p.achievements ? part(p.achievements, (a) => got.has(a)) : null;
};

/** Monkey Knowledge per tree, in the game's order. */
export function knowledgeParts(s: UserSave, p: Progress): (Part & { tree: string })[] {
  const trees = [...new Set(p.knowledge.map((k) => k.tree))];
  return trees.map((tree) => ({ tree, ...part(p.knowledge.filter((k) => k.tree === tree).map((k) => k.id), (id) => !!s.acquiredKnowledge?.[id]) }));
}

/** Upgrades overall and per tower (or "_" when flat). */
export function upgradeParts(s: UserSave, p: Progress) {
  const by = Object.entries(p.upgrades).map(([tower, ids]) => ({ tower, ...part(ids, (u) => !!s.acquiredUpgrades?.[u]) }));
  const sum = (f: (x: Part) => number) => by.reduce((n, x) => n + f(x), 0);
  return { owned: sum((x) => x.owned), total: sum((x) => x.total), by };
}

/** Pro power upgrades; null when the game list is unknown. Same shape as upgradeParts. */
export function powerUpgradeParts(s: UserSave, p: Progress) {
  if (!p.powerUpgrades) return null;
  const by = Object.entries(p.powerUpgrades).map(([power, ids]) => ({ power, ...part(ids, (u) => !!s.acquiredUpgrades?.[u]) }));
  const sum = (f: (x: Part) => number) => by.reduce((n, x) => n + f(x), 0);
  return { owned: sum((x) => x.owned), total: sum((x) => x.total), by };
}

export interface InstaPart extends Part {
  tower: string;
}
/** Tier sets owned out of all possible, per tower of the game ("0-3-2" labels in `missing`). */
export function instaParts(s: UserSave, p: Progress): InstaPart[] {
  const all = instaPossible();
  return p.towers.map((tower) => {
    const r = part(all, (k) => (s.instaTowers?.[tower]?.[k] ?? 0) > 0);
    return { tower, ...r, missing: r.missing.map((k) => k.split("").join("-")) };
  });
}

export interface Ring {
  id: string;
  label: string;
  owned: number;
  total: number;
}
/** The completion summary rings; `overall` = mean of their percentages. */
export function completion(s: UserSave, p: Progress) {
  const med = medalCounts(s);
  const sk = skinParts(s, p);
  const ac = achievementParts(s, p);
  const ins = instaParts(s, p);
  const sum = (xs: { owned: number; total: number }[]) => ({ owned: xs.reduce((n, x) => n + x.owned, 0), total: xs.reduce((n, x) => n + x.total, 0) });
  const rings: Ring[] = [
    { id: "medals", label: "Medals", ...sum(med.map((r) => ({ owned: r.solo, total: r.total }))) },
    { id: "heroes", label: "Heroes", ...heroParts(s, p) },
    { id: "towers", label: "Towers", ...towerParts(s, p) },
    { id: "mk", label: "Knowledge", ...sum(knowledgeParts(s, p)) },
    { id: "upgrades", label: "Upgrades", ...upgradeParts(s, p) },
    { id: "instas", label: "Instas", ...sum(ins) },
  ];
  const pw = powerUpgradeParts(s, p);
  if (pw) rings.push({ id: "powerups", label: "Pro powers", owned: pw.owned, total: pw.total });
  if (sk) rings.push({ id: "skins", label: "Skins", owned: sk.owned, total: sk.total });
  if (ac) rings.push({ id: "achievements", label: "Achievements", owned: ac.owned, total: ac.total });
  const live = rings.filter((r) => r.total > 0);
  const overall = live.length ? live.reduce((n, r) => n + r.owned / r.total, 0) / live.length : 0;
  return { rings, overall };
}

/** Hero XP planner Monkey Knowledge defaults from the save; a toggle set (`mk` in the URL) is left alone. */
export function heroKnowledge(save: UserSave | undefined, urlSetsMk: boolean, route: { edu: boolean; taught: boolean; mts: boolean; emp: boolean }) {
  const k = save?.acquiredKnowledge;
  const pick = (id: string, cur: boolean) => (!urlSetsMk && k ? !!k[id] : cur);
  return {
    edu: pick("MonkeyEducation", route.edu),
    taught: pick("SelfTaughtHeroes", route.taught),
    mts: pick("MonkeysTogetherStrong", route.mts),
    emp: pick("EmpoweredHeroes", route.emp),
  };
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
