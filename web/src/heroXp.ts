// Hero XP planner maths (Tools → /tools/hero-xp). Pure functions, no DOM.
//
// Game code v57 (Cpp2IL): at the end of round R the game computes GetXpForRound(R - 1), scales it by the map
// difficulty (trackDifficultyXpScale), splits it between the heroes on the map (DistributeXpToHeroes), runs it
// through the hero's tower XP transforms (Monkey Education, Self Taught Heroes: xp *= 1 + m, one after the other),
// and Hero.AddXp multiplies by the hero's xpBonus (1 + Monkeys Together Strong per hero placed). XP is a float
// that carries over: each level-up subtracts that level's cost. Buying the next level costs $1 per missing XP
// (HeroModel.costPerXpToLevel = 1, no difficulty factor).
import data from "./data/heroes.json" with { type: "json" };

/**
 * Sources. GAME = v57 code/data (heroes.json: level costs, MK values). WIKI = bloonswiki:
 * Energizer (+50% end-of-round XP for heroes in its range) and the CT relic Hero Boost (+20%; map + store relic
 * multiply). Both are applied as one more multiplier on the round's XP.
 */
export const XP = {
  map: [1, 1.1, 1.2, 1.3],
  energizer: 0.5,
  heroBoost: 0.2,
  mk: data.mk,
};
export const HEROES = data.heroes as Record<string, { xp: number[]; text: string[] }>;
export const GAME_VERSION = data.gameVersion;
export const MAX_LEVEL = 20;
export const MAX_ROUND = 200;

export type MapDiff = 0 | 1 | 2 | 3;
export type XpInput = {
  hero: string;
  /** Round the hero is placed in (before or during it): it earns from the end of that round. */
  place: number;
  map: MapDiff;
  edu: boolean; // Monkey Education
  taught: boolean; // Self Taught Heroes
  mts: boolean; // Monkeys Together Strong
  empowered: boolean; // Empowered Heroes: placed at level 1 + levels
  boost: 0 | 1 | 2; // CT relic Hero Boost (map, store)
  /** Energizer covers the hero from the end of this round on (0 = no Energizer). */
  energizer: number;
  /** Heroes on the map (co-op): the round's XP is split between them. */
  heroes: number;
};

const f = Math.fround;

/** GetXpForRound for the round just completed (1-based). */
export function roundXp(round: number): number {
  const c = round - 1;
  return 20 * (c + 2 + Math.max(c - 19, 0)) + 50 * Math.max(c - 49, 0);
}

/** XP the hero gets at the end of `round`. */
export function gain(i: XpInput, round: number): number {
  let x = f(roundXp(round) * XP.map[i.map]);
  x = f(x / i.heroes);
  for (let k = 0; k < i.boost; k++) x = f(x * (1 + XP.heroBoost));
  if (i.energizer && round >= i.energizer) x = f(x * (1 + XP.energizer));
  if (i.edu) x = f(x * f(1 + XP.mk.monkeyEducation));
  if (i.taught) x = f(x * f(1 + XP.mk.selfTaughtHeroes));
  return f(x * f(1 + (i.mts ? XP.mk.monkeysTogetherStrong * i.heroes : 0)));
}

export type Step = { round: number; level: number; xp: number };

/**
 * Level and XP into that level at the START of each round, from i.place (as placed) to `last`.
 * levels[L] = first round the hero plays at level L (undefined = not reached by `last`).
 */
export function timeline(i: XpInput, last = MAX_ROUND): { steps: Step[]; levels: (number | undefined)[] } {
  const cost = HEROES[i.hero].xp;
  let level = 1 + (i.empowered ? XP.mk.empoweredHeroesLevels : 0);
  let xp = 0;
  const steps: Step[] = [{ round: i.place, level, xp }];
  const levels: (number | undefined)[] = [];
  for (let l = 1; l <= level; l++) levels[l] = i.place;
  for (let r = i.place; r < last; r++) {
    xp = f(xp + gain(i, r));
    while (level < MAX_LEVEL && xp >= cost[level - 1]) {
      xp = f(xp - cost[level - 1]);
      levels[++level] = r + 1;
    }
    if (level === MAX_LEVEL) xp = 0;
    steps.push({ round: r + 1, level, xp });
  }
  return { steps, levels };
}

/** XP still missing at the start of `round` to reach `level` (0 when already there) = the cash to buy it. */
export function shortfall(i: XpInput, level: number, round: number): number {
  const s = timeline(i, round).steps.at(-1)!;
  if (s.level >= level) return 0;
  const cost = HEROES[i.hero].xp;
  let need = -s.xp;
  for (let l = s.level; l < level; l++) need += cost[l - 1];
  return Math.ceil(need);
}

export type Plan = {
  /** Latest round to place the hero and still play `round` at `level` (undefined: not even from `first`). */
  latest?: number;
  /** Placement round → first round played at `level`, around `latest`. */
  window: { place: number; at?: number }[];
  /** Cash to buy the rest at the start of `round` when placed one round after `latest` (or on `first`). */
  buy?: { place: number; cash: number };
};

/** When to place the hero so it plays round `round` at level `level`; placement from round `first` on. */
export function plan(i: XpInput, level: number, round: number, first = 1): Plan {
  const at = (place: number) => timeline({ ...i, place }, round + 40).levels[level];
  let latest: number | undefined;
  for (let p = round; p >= first; p--) {
    const a = at(p);
    if (a !== undefined && a <= round) {
      latest = p;
      break;
    }
  }
  const mid = latest ?? first;
  const window = [];
  for (let p = Math.max(first, mid - 2); p <= Math.min(round, mid + 2); p++) window.push({ place: p, at: at(p) });
  const later = latest === undefined ? first : latest + 1;
  const buy = later <= round ? { place: later, cash: shortfall({ ...i, place: later }, level, round) } : undefined;
  return { latest, window, buy };
}
