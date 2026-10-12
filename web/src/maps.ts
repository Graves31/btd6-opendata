// Maps explorer + map pages: which boss events and races were played on each map. Pure logic (no JSX).
// A map is known from an event's metadata (ChallengeDocument.map), so the keys to load come from the lists.

import type { Boss, ChallengeDocument, Race } from "../../src/nk/types.ts";
import { BOSS_HISTORY, type OldBoss } from "./data/bossHistory.ts";
import { RACE_HISTORY } from "./data/raceHistory.ts";
import { bossNum } from "./format.ts";
import { bossMetaKey, historyKey, LIST_KEY, raceMetaKey } from "./routes.ts";

type Get = <T>(key: string) => T | undefined;

export const DIFF_LABEL = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;
export const DIFF_ICON = ["MapBeginner", "MapIntermediate", "MapAdvanced", "MapExpert"] as const;

export type MapEvent =
  | { kind: "boss"; id?: string; type: string; n: number; note?: OldBoss[5]; start: number; end: number }
  | { kind: "race"; id?: string; name: string; start: number; end: number };
/** A MapEvent, its map unknown while the archive row's metadata is still loading. Wiki rows have no id. */
export type HistEvent = MapEvent & { map?: string };

/** Archive + live list of one kind, one entry per id (the live list wins). */
function events<T extends { id: string }>(get: Get, kind: "boss" | "race"): T[] {
  const seen = new Map<string, T>();
  for (const e of [...(get<T[]>(historyKey(kind)) ?? []), ...(get<T[]>(LIST_KEY[kind]) ?? [])]) seen.set(e.id, e);
  return [...seen.values()];
}

/** Metadata keys (boss standard, race) of every known event: where their maps are read from. */
export function mapMetaKeys(get: Get): string[] {
  return [...events<Boss>(get, "boss").map((e) => bossMetaKey(e.id, "standard")), ...events<Race>(get, "race").map((e) => raceMetaKey(e.id))];
}

/** Every boss and race event, wiki rows the archive doesn't cover included; `map` is undefined until the metadata is loaded. */
function all(get: Get): HistEvent[] {
  const out: HistEvent[] = [];
  const bosses = events<Boss>(get, "boss");
  // Per boss type the archive wins from its oldest archived number on (unnumbered wiki rows: by date), as in bossstats.
  const oldest = new Map<string, number>();
  const first = new Map<string, number>();
  for (const e of bosses) {
    const n = +bossNum(e.name);
    if (n > 0) oldest.set(e.bossType, Math.min(oldest.get(e.bossType) ?? Infinity, n));
    first.set(e.bossType, Math.min(first.get(e.bossType) ?? Infinity, e.start));
    out.push({ kind: "boss", id: e.id, type: e.bossType, n, start: e.start, end: e.end, map: get<ChallengeDocument>(bossMetaKey(e.id, "standard"))?.map });
  }
  for (const [type, n, map, a, b, note] of BOSS_HISTORY) {
    if (n ? n >= (oldest.get(type) ?? Infinity) : Date.parse(a) >= (first.get(type) ?? Infinity) - 864e5) continue;
    out.push({ kind: "boss", type, n, note, start: Date.parse(a), end: Date.parse(b), map });
  }
  const races = events<Race>(get, "race");
  let firstRace = Infinity;
  for (const e of races) {
    firstRace = Math.min(firstRace, e.start);
    out.push({ kind: "race", id: e.id, name: e.name, start: e.start, end: e.end, map: get<ChallengeDocument>(raceMetaKey(e.id))?.map });
  }
  // Wiki races carry unreliable numbers: only name and dates are kept. The archive wins from its oldest race on.
  for (const [, name, map, a, b] of RACE_HISTORY) {
    if (Date.parse(a) >= firstRace - 864e5) continue;
    out.push({ kind: "race", name, start: Date.parse(a), end: Date.parse(b), map });
  }
  return out;
}

/** Boss events and races played on one map, newest first. */
export function mapEvents(mapId: string, get: Get): MapEvent[] {
  return all(get)
    .filter((e) => e.map === mapId)
    .sort((a, b) => b.start - a.start);
}

/** Every event of one kind (archive, live and wiki rows), newest first; archive rows may lack a map for now. */
export function eventHistory(kind: "boss" | "race", get: Get): HistEvent[] {
  return all(get)
    .filter((e) => e.kind === kind)
    .sort((a, b) => b.start - a.start);
}

/** The stretch no list covers, between the newest wiki row and the oldest archive row of a kind (null when under 14 days). */
export function eventGap(kind: "boss" | "race", get: Get): { from: number; to: number } | null {
  const rows = eventHistory(kind, get);
  const wiki = rows.filter((e) => !e.id);
  const live = rows.filter((e) => e.id);
  if (!wiki.length || !live.length) return null;
  const from = Math.max(...wiki.map((e) => e.end));
  const to = Math.min(...live.map((e) => e.start));
  return to - from > 14 * 864e5 ? { from, to } : null;
}

/** Boss event and race counts per map id, for the explorer tiles and the "most boss events" sort. */
export function mapCounts(get: Get): { boss: Map<string, number>; race: Map<string, number> } {
  const c = { boss: new Map<string, number>(), race: new Map<string, number>() };
  for (const e of all(get)) if (e.map) c[e.kind].set(e.map, (c[e.kind].get(e.map) ?? 0) + 1);
  return c;
}
