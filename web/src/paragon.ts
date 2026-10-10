// Paragon degree calculator maths on top of web/src/data/paragons.json (generated from the game). Pure functions, no DOM.
import data57 from "./data/paragons.json" with { type: "json" };
import data56 from "./data/paragons-56.json" with { type: "json" };

/**
 * Values not in paragons.json, read from the v56.3 game (GameAssembly code + game_data) by hand. In v57 the
 * ParagonTower method set is unchanged and the only data changes are the three caps (checked 2026-10-07), so
 * they are kept for both versions:
 * totemPower = ParagonSacrificeBonusModel.bonus on the totem (ParagonTower.GetTowerInvestment, uncapped);
 * costMods = GlobalCostModModel multipliers applied in turn (Impoppable = the Hard difficulty plus the
 * Impoppable mode); costRounding = TowerManager.GetTowerUpgradeCost's final round to 5.
 * boostDegrees = Paragon Boost, degrees added to the game's first paragon after the power calculation
 * (Blooncyclopedia, Paragon_Boost page, v56.0).
 */
export const REF = {
  totemPower: 2000,
  costMods: { easy: [0.85], medium: [], hard: [1.08], impoppable: [1.08, 1.1111111640930176] } as Record<Difficulty, number[]>,
  costRounding: 5,
  boostDegrees: 25,
};

/** Game version of the calculation: "57" = current data, "56" = the v56.3 data (before the paragon rework). */
export type GameVer = "57" | "56";
type VerData = { gameVersion: string; paragons: Partial<Record<string, { name: string; cost: number }>>; degreeData: typeof data57.degreeData };
const DATA: Record<GameVer, VerData> = { "57": data57, "56": data56 };

/** Game difficulty (affects the paragon's cost). */
export type Difficulty = "easy" | "medium" | "hard" | "impoppable";
/** Tower id of a paragon's base tower, as in paragons.json. */
export type ParagonTower = keyof typeof data57.paragons;

/** Paragon tower ids of a version, in data order. */
export const paragonTowers = (ver: GameVer) => Object.keys(DATA[ver].paragons) as ParagonTower[];
/** A version's degree data and a paragon's name in it. */
export const degreeData = (ver: GameVer) => DATA[ver].degreeData;
export const paragonName = (t: ParagonTower, ver: GameVer) => DATA[ver].paragons[t]!.name;
/** Game version a version's data was generated from. */
export const gameVersion = (ver: GameVer): string => DATA[ver].gameVersion;

/** Cost of the paragon on a difficulty, as the game prices it: each cost mod adds trunc((m-1)*cost) in
 *  float32, then the total is rounded to the nearest 5 (ties to even). */
export function paragonCost(tower: ParagonTower, diff: Difficulty, ver: GameVer): number {
  let cost = DATA[ver].paragons[tower]!.cost;
  for (const m of REF.costMods[diff]) cost += Math.trunc(Math.fround(Math.fround(Math.fround(m) - 1) * cost));
  const q = cost / REF.costRounding;
  const r = Math.abs(q % 1) === 0.5 ? 2 * Math.round(q / 2) : Math.round(q);
  return r * REF.costRounding;
}

/** Everything the calculator takes. */
export interface ParagonInput {
  tower: ParagonTower;
  diff: Difficulty;
  ver: GameVer;
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
  /** Paragon Boost: +REF.boostDegrees degrees on the game's first paragon. */
  boost: boolean;
}

/** Largest useful value of each input: where its source fills (the cash slider: the game's 315% of the cost). */
export function inputMax(tower: ParagonTower, diff: Difficulty, ver: GameVer): Record<"cash" | "slider" | "pops" | "income" | "tiers" | "extraT5" | "totems", number> {
  const D = DATA[ver].degreeData;
  const cash = (D.maxPowerFromMoneySpent * paragonCost(tower, diff, ver)) / D.moneySpentOverX;
  const pops = D.maxPowerFromPops * D.popsOverX;
  // toFixed: 3 × cost × 1.05 is exact in decimal; float noise must not round it up by one.
  const ceil = (x: number) => Math.ceil(+x.toFixed(6));
  return {
    cash: ceil(cash),
    slider: ceil(cash * (1 + D.paidContributionPenalty)),
    pops,
    income: ceil(pops / D.cashEarnedContributionModifier),
    tiers: ceil(D.maxPowerFromNonTier5Count / D.nonTier5TowersMultByX),
    extraT5: ceil(D.maxPowerFromTier5Count / D.tier5TowersMultByX),
    totems: ceil(D.powerDegreeRequirements[D.powerDegreeRequirements.length - 1] / REF.totemPower),
  };
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
  /** Degree from power alone. */
  base: number;
  /** Final degree: base + Paragon Boost, at most 100. */
  degree: number;
  buckets: Bucket[];
  /** Next final degree, the power it needs and the gap. */
  next: { degree: number; power: number; gap: number } | null;
  /** Next multiple of bonusBossDamagePerDegrees (or 100) in final degrees, and the power gap to it. */
  breakpoint: { degree: number; gap: number } | null;
  boss: { normal: number; elite: number };
}

// ---- Formula block: everything that may need correcting after verification lives here. ----
function rawPowers(i: ParagonInput): Record<Bucket["key"], number> {
  const D = DATA[i.ver].degreeData;
  const unit = paragonCost(i.tower, i.diff, i.ver) / D.moneySpentOverX;
  return {
    // Sacrificed towers' cash is not rounded; the slider's share is rounded up (ParagonTower.StartSacrifice).
    cash: i.cash / unit + Math.ceil(i.slider / unit / (1 + D.paidContributionPenalty)),
    pops: (i.pops + i.income * D.cashEarnedContributionModifier) / D.popsOverX,
    tiers: i.tiers * D.nonTier5TowersMultByX,
    t5: i.extraT5 * D.tier5TowersMultByX,
    totems: i.totems * REF.totemPower,
  };
}
/** Cap of each source; 0 = the source is gone in that version (v57 upgrade tiers). */
const caps = (ver: GameVer): Record<Bucket["key"], number | null> => {
  const D = DATA[ver].degreeData;
  return { cash: D.maxPowerFromMoneySpent, pops: D.maxPowerFromPops, tiers: D.maxPowerFromNonTier5Count, t5: D.maxPowerFromTier5Count, totems: null };
};
const ORDER: Bucket["key"][] = ["cash", "pops", "tiers", "t5", "totems"];
const WAY_ORDER: Bucket["key"][] = ["cash", "totems", "t5", "tiers", "pops"];

/** Highest degree whose requirement a total power meets. */
function degreeFor(power: number, ver: GameVer): number {
  const D = DATA[ver].degreeData;
  let d = 1;
  for (let k = 1; k < D.powerDegreeRequirements.length; k++) if (D.powerDegreeRequirements[k] <= power) d = k + 1;
  return d;
}

/** Power a final degree needs (the boost's degrees come free; 0 when the boost alone reaches it). */
export function powerForDegree(degree: number, boost: boolean, ver: GameVer): number {
  const D = DATA[ver].degreeData;
  const base = Math.max(1, Math.min(D.powerDegreeRequirements.length, degree - (boost ? REF.boostDegrees : 0)));
  return D.powerDegreeRequirements[base - 1];
}

/** Bonus boss damage multipliers for a degree. */
function bossFor(degree: number, ver: GameVer): { normal: number; elite: number } {
  const D = DATA[ver].degreeData;
  const normal = 1 + D.bonusBossDamagePercent * Math.floor(degree / D.bonusBossDamagePerDegrees);
  return { normal, elite: 2 * normal };
}

/** Per-degree stat scaling. */
export function scaling(degree: number, ver: GameVer): { damagePct: number; damageFlat: number; piercePct: number; pierceFlat: number; cooldownPct: number; bossNormal: number; bossElite: number } {
  const D = DATA[ver].degreeData;
  const n = degree - 1;
  const boss = bossFor(degree, ver);
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
  const D = DATA[i.ver].degreeData;
  const CAPS = caps(i.ver);
  const raw = rawPowers(i);
  const buckets: Bucket[] = ORDER.map((key) => {
    const cap = CAPS[key];
    const r = raw[key];
    return { key, power: Math.floor(cap === null ? r : Math.min(r, cap)), raw: r, cap, full: cap !== null && cap > 0 && r >= cap };
  });
  // The game sums the capped sources as floats; requirements are integers, so flooring the total is exact.
  const power = Math.floor(buckets.reduce((s, b) => s + (b.cap === null ? b.raw : Math.min(b.raw, b.cap)), 0));
  const base = degreeFor(power, i.ver);
  const reqs = D.powerDegreeRequirements;
  // The boost is added after the power calculation: the next final degree needs the next base degree.
  const degree = Math.min(reqs.length, base + (i.boost ? REF.boostDegrees : 0));
  const top = degree >= reqs.length;
  const next = top ? null : { degree: degree + 1, power: reqs[base], gap: reqs[base] - power };
  const per = D.bonusBossDamagePerDegrees;
  const bpDeg = Math.min(reqs.length, (Math.floor(degree / per) + 1) * per);
  const bpPower = powerForDegree(bpDeg, i.boost, i.ver);
  const breakpoint = top ? null : { degree: bpDeg, gap: Math.max(0, bpPower - power) };
  return { power, base, degree, buckets, next, breakpoint, boss: bossFor(degree, i.ver) };
}

/** One way to reach a target power: the amount of a single input that alone is enough. */
export interface Way {
  key: Bucket["key"];
  /** Amount of that input to add, in input units. */
  add: number;
}

/** For each single input, the minimum addition that alone reaches the target power; skips full or capped-out buckets (order: cash, totems, t5, tiers, pops), and totems when `noTotems`. */
export function waysTo(i: ParagonInput, target: number, noTotems = false): Way[] {
  const base = evaluate(i);
  if (base.power >= target) return [];
  const ways: Way[] = [];
  for (const key of WAY_ORDER) {
    const b = base.buckets.find((x) => x.key === key)!;
    if (b.full || b.cap === 0 || (noTotems && key === "totems")) continue;
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
