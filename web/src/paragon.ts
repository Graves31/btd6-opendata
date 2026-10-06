// Paragon degree calculator maths on top of web/src/data/paragons.json (generated from the game). Pure functions, no DOM.
import data from "./data/paragons.json" with { type: "json" };

/** Values that are not in the game data. */
export const REF = {
  totemPower: 2000, // provisional: reference source, pending verification
  difficultyMult: { easy: 0.85, medium: 1, hard: 1.08, impoppable: 1.2 }, // provisional: reference source, pending verification
  costRounding: 5, // provisional: reference source, pending verification
};

const D = data.degreeData;

/** Game difficulty (affects the paragon's cost). */
export type Difficulty = "easy" | "medium" | "hard" | "impoppable";
/** Tower id of a paragon's base tower, as in paragons.json. */
export type ParagonTower = keyof typeof data.paragons;

/** Paragon tower ids, in data order. */
export const PARAGON_TOWERS = Object.keys(data.paragons) as ParagonTower[];
/** Game version the data was generated from. */
export const GAME_VERSION: string = data.gameVersion;

/** Cost of the paragon on a difficulty (medium cost from the data, scaled and rounded). */
export function paragonCost(tower: ParagonTower, diff: Difficulty): number {
  return Math.round((data.paragons[tower].cost * REF.difficultyMult[diff]) / REF.costRounding) * REF.costRounding;
}

/** Everything the calculator takes. */
export interface ParagonInput {
  tower: ParagonTower;
  diff: Difficulty;
  /** Co-op: accepted but no effect yet (pending verification). */
  coop: boolean;
  /** Cash spent on sacrificed non-tier-5 towers. */
  cash: number;
  /** Cash put in through the paragon's contribution slider. */
  slider: number;
  pops: number;
  /** Cash earned by the sacrificed towers. */
  income: number;
  /** Sacrificed non-tier-5 towers. */
  tiers: number;
  /** Extra sacrificed tier-5 towers. */
  extraT5: number;
  totems: number;
}

/** One power source: its floored power, uncapped raw power, cap and whether it is at the cap. */
export interface Bucket {
  key: "cash" | "pops" | "tiers" | "t5" | "totems";
  power: number;
  /** Before cap. */
  raw: number;
  cap: number | null;
  full: boolean;
}

/** Result of evaluate(). */
export interface ParagonResult {
  power: number;
  degree: number;
  buckets: Bucket[];
  next: { degree: number; power: number; gap: number } | null;
  /** Next multiple of bonusBossDamagePerDegrees, or 100. */
  breakpoint: { degree: number; gap: number } | null;
  boss: { normal: number; elite: number };
}

// ---- Formula block: everything that may need correcting after verification lives here. ----
function rawPowers(i: ParagonInput): Record<Bucket["key"], number> {
  const unit = paragonCost(i.tower, i.diff) / D.moneySpentOverX;
  return {
    cash: i.cash / unit + i.slider / (unit * (1 + D.paidContributionPenalty)),
    pops: (i.pops + i.income * D.cashEarnedContributionModifier) / D.popsOverX,
    tiers: i.tiers * D.nonTier5TowersMultByX,
    t5: i.extraT5 * D.tier5TowersMultByX,
    totems: i.totems * REF.totemPower,
  };
}
const CAPS: Record<Bucket["key"], number | null> = {
  cash: D.maxPowerFromMoneySpent,
  pops: D.maxPowerFromPops,
  tiers: D.maxPowerFromNonTier5Count,
  t5: D.maxPowerFromTier5Count,
  totems: null,
};
const ORDER: Bucket["key"][] = ["cash", "pops", "tiers", "t5", "totems"];
const WAY_ORDER: Bucket["key"][] = ["cash", "totems", "t5", "tiers", "pops"];

/** Highest degree whose requirement a total power meets. */
function degreeFor(power: number): number {
  let d = 1;
  for (let k = 1; k < D.powerDegreeRequirements.length; k++) if (D.powerDegreeRequirements[k] <= power) d = k + 1;
  return d;
}

/** Bonus boss damage multipliers for a degree. */
function bossFor(degree: number): { normal: number; elite: number } {
  const normal = 1 + D.bonusBossDamagePercent * Math.floor(degree / D.bonusBossDamagePerDegrees);
  return { normal, elite: 2 * normal };
}

/** Per-degree stat scaling. */
export function scaling(degree: number): { damagePct: number; damageFlat: number; piercePct: number; pierceFlat: number; cooldownPct: number; bossNormal: number; bossElite: number } {
  const n = degree - 1;
  const boss = bossFor(degree);
  return {
    damagePct: D.damagePercentPerDegree * n,
    damageFlat: D.damageIncreasePerDegree * Math.floor(n / D.damageIncreaseForDegrees),
    piercePct: D.piercePercentPerDegree * n,
    pierceFlat: D.pierceIncreasePerDegree * n,
    cooldownPct: Math.round(Math.sqrt(D.attackCooldownReductionX * n) * 10) / 10,
    bossNormal: boss.normal,
    bossElite: boss.elite,
  };
}
// ---- end formula block ----

/** Power, degree, per-source breakdown, next degree and boss breakpoint for an input. */
export function evaluate(i: ParagonInput): ParagonResult {
  const raw = rawPowers(i);
  const buckets: Bucket[] = ORDER.map((key) => {
    const cap = CAPS[key];
    const r = raw[key];
    return { key, power: Math.floor(cap === null ? r : Math.min(r, cap)), raw: r, cap, full: cap !== null && r >= cap };
  });
  const power = buckets.reduce((s, b) => s + b.power, 0);
  const degree = degreeFor(power);
  const reqs = D.powerDegreeRequirements;
  const next = degree >= reqs.length ? null : { degree: degree + 1, power: reqs[degree], gap: reqs[degree] - power };
  const per = D.bonusBossDamagePerDegrees;
  const bpDeg = Math.min(reqs.length, (Math.floor(degree / per) + 1) * per);
  const breakpoint = degree >= reqs.length ? null : { degree: bpDeg, gap: reqs[bpDeg - 1] - power };
  return { power, degree, buckets, next, breakpoint, boss: bossFor(degree) };
}

/** One way to reach a target power: the amount of a single input that alone is enough. */
export interface Way {
  key: Bucket["key"];
  /** Amount of that input to add, in input units. */
  add: number;
}

/** For each single input, the minimum addition that alone reaches the target power; skips full or capped-out buckets (order: cash, totems, t5, tiers, pops). */
export function waysTo(i: ParagonInput, target: number): Way[] {
  const base = evaluate(i);
  if (base.power >= target) return [];
  const ways: Way[] = [];
  for (const key of WAY_ORDER) {
    const b = base.buckets.find((x) => x.key === key)!;
    if (b.full) continue;
    const need = target - (base.power - b.power); // power this bucket must supply
    if (b.cap !== null && need > b.cap) continue;
    const apply = (add: number): ParagonInput => {
      const f: ParagonInput = { ...i };
      if (key === "cash") f.cash += add;
      else if (key === "pops") f.pops += add;
      else if (key === "tiers") f.tiers += add;
      else if (key === "t5") f.extraT5 += add;
      else f.totems += add;
      return f;
    };
    // Estimate in input units from the per-unit power, then adjust until the floored total just reaches the target.
    const one = rawPowers(apply(1))[key] - rawPowers(i)[key];
    let add = Math.max(1, Math.floor((need - b.raw) / one));
    while (evaluate(apply(add)).power < target && add < 1e12) add++;
    while (add > 1 && evaluate(apply(add - 1)).power >= target) add--;
    if (evaluate(apply(add)).power >= target) ways.push({ key, add });
  }
  return ways;
}
