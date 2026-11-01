// Round visualizer logic (Tools → Rounds): which set a route shows, range clamping, event modifiers applied the
// way the data allows, RBE, notable rounds, and the rules panel's "See rounds" link. Pure: no DOM, no store, so
// it runs in the unit tests too. Every number comes from the generated round data (web/src/data/rounds) or the
// event's ChallengeDocument; nothing is estimated.

import type { ChallengeDocument } from "../../src/nk/types.ts";
import {
  BLOON_TYPES,
  BLOONS,
  FLAG,
  resolveRoundSet,
  ROUND_SET_BY_ID,
  ROUND_SETS,
  type Round,
  type RoundSetInfo,
} from "./data/rounds/index.ts";
import { effGroups, gameId, type EffGroup } from "./roundCalc.ts";
import { href, type HasFilter, type RoundMods, type RoundsRoute } from "./routes.ts";

/** Modes whose rounds are random (no fixed set to show). The game model has no RoundSetModModel for them. */
export const RANDOM_MODES = new Set(["Apopalypse"]);

export type SetPick = { kind: "set"; info: RoundSetInfo } | { kind: "random"; mode: string } | { kind: "unknown"; id: string };

/** The set a route shows: `set=` wins; else the mode's set (ABR), random for Apopalypse, else the default set. */
export function pickSet(r: Pick<RoundsRoute, "set" | "mode">): SetPick {
  if (r.set) {
    const info = ROUND_SET_BY_ID[r.set];
    return info ? { kind: "set", info } : { kind: "unknown", id: r.set };
  }
  if (r.mode && RANDOM_MODES.has(r.mode)) return { kind: "random", mode: r.mode };
  return { kind: "set", info: resolveRoundSet(["default"], r.mode) ?? ROUND_SET_BY_ID.default! };
}

/** Store key (hashed asset URL) of the set file a route needs; none for random / unknown sets. */
/** The set file, plus the Default set's for any other set (the round card's "RBE so far" compares with it). */
export function roundSetKeys(r: RoundsRoute): string[] {
  const p = pickSet(r);
  if (p.kind !== "set") return [];
  return p.info.id === "default" ? [p.info.url] : [p.info.url, ROUND_SET_BY_ID.default!.url];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** from/to clamped to the set (swapped if reversed); the open round clamped into the range (none if absent). */
export function bounds(info: Pick<RoundSetInfo, "first" | "last">, r: Pick<RoundsRoute, "from" | "to" | "r">): { from: number; to: number; open?: number } {
  let from = clamp(r.from ?? info.first, info.first, info.last);
  let to = clamp(r.to ?? info.last, info.first, info.last);
  if (from > to) [from, to] = [to, from];
  return { from, to, open: r.r === undefined ? undefined : clamp(r.r, from, to) };
}

/** "Vortex rounds", "Alternate Bloons Rounds", "Default". */
export const setLabel = (s: Pick<RoundSetInfo, "name" | "boss">) => (s.boss ? `${s.name} rounds` : s.name);

/** Hero-trial set id part -> key in the `hero` sprite family. */
const QUEST_HERO: Record<string, string> = {
  adora: "Adora", brickell: "AdmiralBrickell", churchill: "CaptainChurchill", corvus: "Corvus", etienne: "Etienne",
  ezili: "Ezili", geraldo: "Geraldo", gwendolin: "Gwendolin", obyn: "ObynGreenfoot", pat: "PatFusty", psi: "Psi",
  quincy: "Quincy", rosalia: "Rosalia", sauda: "Sauda", silas: "Silas", striker: "StrikerJones",
};

/** Set icon [family, key], as in the rules panel: boss portrait, the ABR mode icon, else the custom-rounds icon. */
export function setIcon(s: Pick<RoundSetInfo, "id" | "boss" | "modes">): [string, string] {
  if (s.boss) return ["boss", s.boss];
  const q = /^quest-([a-z]+)-trial$/.exec(s.id);
  if (q && QUEST_HERO[q[1]!]) return ["hero", QUEST_HERO[q[1]!]!];
  if (s.id.startsWith("quest-mermonkey-")) return ["tower", "Mermonkey"];
  if (s.modes.includes("AlternateBloonsRounds")) return ["ui", "mode:AlternateBloonsRounds"];
  return ["ui", "CustomRounds"];
}

export * from "./roundCalc.ts";

// ─────────────────────────────── filters ("any of")

export interface Filters {
  has: readonly HasFilter[];
  bloon: readonly string[];
}

/** The filters that apply to this set: "changed" only means something on a boss set. */
export function activeFilters(f: Filters, info: Pick<RoundSetInfo, "boss">): Filters {
  return { has: info.boss ? f.has : f.has.filter((h) => h !== "changed"), bloon: f.bloon };
}
export const filtering = (f: Filters) => f.has.length > 0 || f.bloon.length > 0;

/** Does a group (after the event's modifiers) match a filter? MOAB-class = the game model's isMoab. */
export function groupMatches(g: Pick<EffGroup, "key" | "flags">, f: Filters): boolean {
  if (f.bloon.includes(g.key)) return true;
  for (const h of f.has) {
    if (h === "camo" && g.flags & FLAG.camo) return true;
    if (h === "regrow" && g.flags & FLAG.regrow) return true;
    if (h === "fort" && g.flags & FLAG.fortified) return true;
    if (h === "moabs" && BLOON_TYPES[g.key]?.moab) return true;
  }
  return false;
}

/** A round matches when ANY filter matches: a group does, or ("changed") the boss set changed the round. */
export function roundMatches(round: Round, f: Filters, mods: RoundMods): boolean {
  if (f.has.includes("changed") && round.o) return true;
  return effGroups(round, mods).some((g) => groupMatches(g, f));
}

/** Runs of consecutive rounds (within [from, to]) that a boss set changed, as [first, last] pairs. */
export function changedRuns(rounds: Round[], from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (const r of rounds) {
    if (!r.o || r.n < from || r.n > to) continue;
    const last = out[out.length - 1];
    if (last && last[1] === r.n - 1) last[1] = r.n;
    else out.push([r.n, r.n]);
  }
  return out;
}

/** Bloon types used in [from, to] (after modifiers), biggest first, for the "Bloon" filter menu. */
export function typesInRange(rounds: Round[], from: number, to: number): string[] {
  const seen = new Set<string>();
  for (const r of rounds) if (r.n >= from && r.n <= to) for (const g of r.g) seen.add(g[0]);
  const size = (k: string) => BLOONS[gameId(k, 0)]?.rbe ?? BLOONS[gameId(k, 0)]?.hp ?? 0;
  return [...seen].sort((a, b) => size(b) - size(a) || a.localeCompare(b));
}

// ─────────────────────────────── the rules panel's link

/** Round-set link for a ruleset: the set, the event's range and modifiers, and where it came from. */
export type RulesRounds = { kind: "link"; info: RoundSetInfo; href: string; fastTrack: boolean } | { kind: "random" } | { kind: "unknown" };

/** A roundSets value for Fast Track. The game has no Fast Track set: it starts part-way into the normal rounds. */
const FAST_TRACK = /fast/i;

/**
 * Where a ruleset's "Round set" row links: the resolved set (boss value, then mode, then the API value), the
 * event's range, open at its start round, with its modifiers and `src`. Random-round modes get no link; so does a
 * roundSets value the manifest doesn't know (except Fast Track: the default set, from the event's start round).
 */
export function roundsFor(d: Pick<ChallengeDocument, "roundSets" | "mode" | "startRound" | "endRound" | "_bloonModifiers">, src?: string): RulesRounds {
  if (RANDOM_MODES.has(d.mode)) return { kind: "random" };
  const values = d.roundSets ?? [];
  const unknown = values.filter((v) => v !== "default" && !ROUND_SETS.some((s) => s.api.includes(v)));
  const fastTrack = unknown.length > 0 && unknown.every((v) => FAST_TRACK.test(v));
  if (unknown.length && !fastTrack) return { kind: "unknown" };
  const info = fastTrack ? ROUND_SET_BY_ID.default : resolveRoundSet(values, d.mode);
  if (!info) return { kind: "unknown" };
  const m = d._bloonModifiers;
  const h = m?.healthMultipliers;
  const mods: RoundMods = {
    camo: !!m?.allCamo,
    regrow: !!m?.allRegen,
    fort: !!m?.allFortified,
    hp: h?.bloons ?? 1,
    mhp: h?.moabs ?? 1,
    bhp: h?.boss ?? 1,
    spd: m?.speedMultiplier ?? 1,
    mspd: m?.moabSpeedMultiplier ?? 1,
    bspd: m?.bossSpeedMultiplier ?? 1,
    rgr: m?.regrowRateMultiplier ?? 1,
  };
  const [lo, hi] = d.startRound <= d.endRound ? [d.startRound, d.endRound] : [d.endRound, d.startRound];
  return {
    kind: "link",
    info,
    fastTrack,
    href: href.rounds({
      set: info.id,
      from: lo,
      to: hi,
      r: d.startRound,
      view: "round", // arriving from an event: straight to the round it starts at
      ev: [lo, hi],
      mode: d.mode && d.mode !== "Standard" ? d.mode : undefined,
      mods,
      src,
    }),
  };
}
