// Round maths (Tools → Rounds): modifiers, RBE, cash and bloon names. Pure, and free of the set files' asset imports,
// so the Worker can use it for the per-round page text too (src/worker/og.ts). Re-exported by rounds.ts.

import { BLOON_TYPES, BLOONS, FLAG, INCOME_SETS, MODE_MODS, type Group, type Round } from "./data/rounds/data.ts";
import { NO_MODS, type RoundMods, type RoundsRoute } from "./routes.ts";

// ─────────────────────────────── modifiers

/** Modifiers in force: none with "Base rounds" on. */
export const activeMods = (r: Pick<RoundsRoute, "mods" | "base">): RoundMods => (r.base ? NO_MODS : r.mods);

/** The mode's own MOAB-health rule from the game model (Double HP MOABs: BloonHealthModel on the "Moabs" tag). */
export function modeMoabHealth(mode: string | undefined): number {
  for (const [cls, d] of (mode && MODE_MODS[mode]) || []) {
    if (cls === "BloonHealthModel" && d.bloonTag === "Moabs" && typeof d.healthMod === "number") return d.healthMod;
  }
  return 1;
}

/**
 * The MOAB-health multiplier the page applies: the event's healthMultipliers.moabs, else the mode's own rule.
 * (When an event sets both, how the game combines them isn't in the data: only the event's value is applied.)
 */
export function moabMult(r: Pick<RoundsRoute, "mods" | "base" | "mode">): number {
  if (r.base) return 1;
  return r.mods.mhp !== 1 ? r.mods.mhp : modeMoabHealth(r.mode);
}

/**
 * A group's flags with the event's all-camo / all-regrow / all-fortified applied, the way the game model allows:
 * only onto a variant the bloon type defines (BLOON_TYPES.variants). A bloon without e.g. a camo variant keeps
 * its flags for that modifier.
 */
export function applyFlags(key: string, flags: number, mods: Pick<RoundMods, "camo" | "regrow" | "fort">): number {
  const want = (mods.camo ? FLAG.camo : 0) | (mods.regrow ? FLAG.regrow : 0) | (mods.fort ? FLAG.fortified : 0);
  const add = want & ~flags;
  if (!add) return flags;
  const variants = BLOON_TYPES[key]?.variants ?? [flags];
  let best = flags;
  let bestBits = 0;
  // Every subset of the requested bits (3 bits → at most 8), keeping the valid one that adds the most.
  for (let sub = add; sub > 0; sub = (sub - 1) & add) {
    const f = flags | sub;
    const bits = popcount(sub);
    if (variants.includes(f) && bits > bestBits) [best, bestBits] = [f, bits];
  }
  return best;
}
const popcount = (n: number) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1);

/** The game's bloon id for a type + flags: <Base>Regrow?Fortified?Camo? (e.g. CeramicRegrowFortifiedCamo). */
export function gameId(key: string, flags: number): string {
  const base = BLOON_TYPES[key]?.id ?? key;
  return base + (flags & FLAG.regrow ? "Regrow" : "") + (flags & FLAG.fortified ? "Fortified" : "") + (flags & FLAG.camo ? "Camo" : "");
}

/** RBE of one bloon (with its children) with a MOAB-health multiplier on its MOAB-class layers; undefined if unknown. */
export function bloonRbe(key: string, flags: number, moab = 1): number | undefined {
  const b = BLOONS[gameId(key, flags)];
  if (!b || b.rbe === undefined) return undefined;
  return b.rbe + (b.rbeMoab ?? 0) * (moab - 1);
}

export interface EffGroup {
  key: string;
  /** flags after the event's modifiers */
  flags: number;
  /** flags in the set file */
  baseFlags: number;
  count: number;
  start: number;
  end: number;
}

export function effGroups(round: Round, mods: RoundMods): EffGroup[] {
  return round.g.map(([key, flags, count, start, end]: Group) => ({ key, flags: applyFlags(key, flags, mods), baseFlags: flags, count, start, end }));
}

/**
 * RBE of a round with the modifiers the data supports: flag changes (fortified layers have more health) and the
 * MOAB-health multiplier (rbeMoab). `moab` = the part from MOAB-class layers. Undefined when a bloon's health
 * tree isn't in the data.
 */
/** Total RBE of rounds `from`..`to` with the modifiers; undefined when a round in it has none. */
export function rbeSum(rounds: readonly Round[], from: number, to: number, mods: RoundMods, moabHp = 1): number | undefined {
  let t = 0;
  for (const x of rounds) {
    if (x.n < from || x.n > to) continue;
    const p = roundRbeParts(x, mods, moabHp);
    if (!p) return undefined;
    t += p.total;
  }
  return t;
}

// ─────────────────────────────── cash
// bloonswiki "List of rounds in BTD6" / "Cash" / "CHIMPS": $1 per layer popped, times the round's cash-per-pop
// multiplier (the set's IncomeSet); from round 81 non-MOAB bloons spawn one child and a Ceramic layer pays $87 (Super
// Ceramic); $100 + the round number at the end of each round. Checked against btd6apiexplorer's per-round income:
// all 100 Default and CHIMPS Bloonarius rounds within $0.50. Not included: modes' cash rules, Monkey Knowledge, farms.

/** Cash-per-pop multiplier of round `n`: a threshold applies up to and including its round. */
export function popMult(n: number, incomeSet = "DefaultIncomeSet"): number {
  const s = INCOME_SETS[incomeSet] ?? INCOME_SETS.DefaultIncomeSet!;
  for (const [th, m] of s.thresholds) if (n <= th) return m;
  return s.final;
}

const popMemo = new Map<string, number | undefined>();
/** Cash for popping game bloon `bid` and everything it spawns, before the multiplier; undefined if not decoded. */
function popCash(bid: string, late: boolean): number | undefined {
  const k = `${bid}|${late ? 1 : 0}`;
  if (popMemo.has(k)) return popMemo.get(k);
  const b = BLOONS[bid];
  let v: number | undefined;
  if (b?.children) {
    v = late && b.base === "Ceramic" ? 87 : 1;
    for (const c of late && !b.moab ? b.children.slice(0, 1) : b.children) {
      const x = popCash(c, late);
      if (x === undefined) {
        v = undefined;
        break;
      }
      v += x;
    }
  }
  popMemo.set(k, v);
  return v;
}

/** A round's cash when everything is popped: pops (with the multiplier) + the end-of-round cash. */
export function roundCash(round: Round, incomeSet?: string): { pops: number; bonus: number } | undefined {
  let pops = 0;
  for (const [k, f, count] of round.g) {
    const c = popCash(gameId(k, f), round.n >= 81);
    if (c === undefined) return undefined;
    pops += count * c;
  }
  return { pops: pops * popMult(round.n, incomeSet), bonus: 100 + round.n };
}

/** Cash of rounds `from`..`to`; undefined when a round in it can't be counted. */
export function cashSum(rounds: readonly Round[], from: number, to: number, incomeSet?: string): number | undefined {
  let t = 0;
  for (const x of rounds) {
    if (x.n < from || x.n > to) continue;
    const c = roundCash(x, incomeSet);
    if (!c) return undefined;
    t += c.pops + c.bonus;
  }
  return t;
}

export function roundRbeParts(round: Round, mods: RoundMods, moabHp = 1): { total: number; moab: number } | undefined {
  const flagged = round.g.some(([k, f]) => applyFlags(k, f, mods) !== f);
  if (!flagged) {
    if (round.rbe === undefined) return undefined;
    const m = round.rbeMoab ?? 0;
    return { total: round.rbe + m * (moabHp - 1), moab: m * moabHp };
  }
  let total = 0;
  let moab = 0;
  for (const [k, f, n] of round.g) {
    const b = BLOONS[gameId(k, applyFlags(k, f, mods))];
    if (!b || b.rbe === undefined) return undefined;
    const m = b.rbeMoab ?? 0;
    total += (b.rbe + m * (moabHp - 1)) * n;
    moab += m * moabHp * n;
  }
  return { total, moab };
}
export const roundRbe = (round: Round, mods: RoundMods, moabHp = 1) => roundRbeParts(round, mods, moabHp)?.total;

export const roundCount = (round: Round) => round.g.reduce((s, g) => s + g[2], 0);
/** The last group's end: "spawns over", never the round's length. */
export const spawnEnd = (round: Round) => round.g.reduce((m, g) => Math.max(m, g[4]), 0);

/** Distinct bloons of a round (type + effective flags), biggest first (single-bloon RBE, then layer health). */
export function distinctBloons(round: Round, mods: RoundMods): { key: string; flags: number; count: number }[] {
  const by = new Map<string, { key: string; flags: number; count: number }>();
  for (const g of effGroups(round, mods)) {
    const id = `${g.key}:${g.flags}`;
    const e = by.get(id);
    if (e) e.count += g.count;
    else by.set(id, { key: g.key, flags: g.flags, count: g.count });
  }
  const size = (k: string, f: number) => {
    const b = BLOONS[gameId(k, f)];
    return [b?.rbe ?? -1, b?.hp ?? -1];
  };
  return [...by.values()].sort((a, b) => {
    const [ar, ah] = size(a.key, a.flags);
    const [br, bh] = size(b.key, b.flags);
    return br - ar || bh - ah || b.flags - a.flags || a.key.localeCompare(b.key);
  });
}

// ─────────────────────────────── names

const FLAG_WORDS: [number, string][] = [
  [FLAG.camo, "camo"],
  [FLAG.regrow, "regrow"],
  [FLAG.fortified, "fortified"],
];
export const flagWords = (flags: number) => FLAG_WORDS.filter(([b]) => flags & b).map(([, w]) => w);

/** "Camo regrow ceramic", "Fortified MOAB", "Red": the game's type name with its variant words. */
export function bloonLabel(key: string, flags: number): string {
  const name = BLOON_TYPES[key]?.name ?? key;
  const typeName = name === name.toUpperCase() ? name : name.toLowerCase();
  const s = [...flagWords(flags), typeName].join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
