import { ABILITY_NAMES, MAP_NAMES } from "./data/names.ts";
import type { ScorePart } from "../../src/nk/types.ts";

const nf = new Intl.NumberFormat("en-US");
export const fmtInt = (n: number | null | undefined) => (typeof n === "number" ? nf.format(n) : "–");
const cf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** 373667729 → "373.7M" */
export const fmtCompact = (n: number | null | undefined) => (typeof n === "number" ? cf.format(n) : "–");
export const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** 1905200 → "31:45.200"; 4000000 → "1:06:40.000" */
export function fmtMs(ms: number): string {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${neg ? "-" : ""}${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}

/**
 * Boss leaderboard score parts with their real meaning. NK labels them by slot, not by content: on Fastest Time
 * (GameTime) events the part named "Least Cash" holds the run's game time (ms) and "Game Time" holds the
 * submission time counted from the event start; Least Tiers boards call their parts "Tier Count" and
 * "Submission Time". Checked against live data (Lych61, Bloonarius69, Vortex47) and the community explorer at
 * github.com/HalfHydra/BTD6-API-Explorer, which reads them the same way. Least Cash boards are labelled correctly.
 */
export function fixParts(parts: ScorePart[], scoring?: string): ScorePart[] {
  return parts.map((p) => {
    let name = p.name;
    if (scoring === "GameTime" && name === "Least Cash") name = "Game Time";
    else if (scoring === "GameTime" && name === "Game Time") name = "Time after event start";
    else if (name === "Submission Time") name = "Time after event start";
    else if (name === "Tier Count") name = "Least Tiers";
    return name === p.name ? p : { ...p, name };
  });
}

/** A score part with its unit: "$189,920", "31:45.200", "Tier 5", "38 tiers", "+3d 17h". */
export function fmtPart(p: ScorePart): string {
  if (p.name === "Time after event start") return `+${fmtSpan(p.score)}`;
  if (p.type === "time") return fmtMs(p.score);
  if (/cash/i.test(p.name)) return `$${fmtInt(p.score)}`;
  if (p.name === "Boss Tier") return `T${p.score}`;
  if (/tiers/i.test(p.name)) return `${fmtInt(p.score)} tiers`;
  return fmtInt(p.score);
}

/** Column header for a score part. */
export const partLabel = (name: string) => (name === "Time after event start" ? "Submitted" : name === "Least Cash" ? "Cash spent" : name === "Least Tiers" ? "Tiers" : name === "Boss Tier" ? "Tier" : name);

/** Plain-words scoring rule for a boss event's scoring type. */
export const SCORING: Record<string, { short: string; long: string }> = {
  LeastCash: { short: "Least Cash", long: "Beat the boss spending as little cash as possible." },
  GameTime: { short: "Fastest Time", long: "Beat the boss in the shortest in-game time." },
  LeastTiers: { short: "Least Tiers", long: "Beat the boss buying as few upgrade tiers as possible." },
};
export const scoringShort = (t: string | undefined) => (t ? (SCORING[t]?.short ?? human(t)) : "");

const dtf = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtDate = (ms: number) => dtf.format(ms);
export const dayMonUtc = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** Wiki calendar days ("2021-07-26", or its UTC-midnight ms) → "26 Jul – 29 Jul 2021" (the year once, or on both ends across New Year). */
export function oldDates(a: string | number, b: string | number): string {
  const [x, y] = [new Date(a), new Date(b)];
  const [ya, yb] = [x.getUTCFullYear(), y.getUTCFullYear()];
  return `${dayMonUtc.format(x)}${ya !== yb ? ` ${ya}` : ""} – ${dayMonUtc.format(y)} ${yb}`;
}
const dayf = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
export const fmtDay = (ms: number) => dayf.format(ms);
const whenf = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** "Fri, Sep 19, 04:00" in the viewer's time zone. */
export const fmtWhen = (ms: number) => whenf.format(ms);
/**
 * The viewer's zone label for a given instant ("CEST" in summer, "CET" in winter), so a date is labelled with the
 * offset it actually has. `opts` pins the zone/locale (tests).
 */
export function tzLabel(ms: number, opts: { timeZone?: string; locale?: string } = {}): string {
  try {
    const f = new Intl.DateTimeFormat(opts.locale, { timeZoneName: "short", timeZone: opts.timeZone });
    return f.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function fmtSpan(ms: number): string {
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** A round range: "1–60", or "63 only" when it is a single round (never "63–63"). */
export const fmtRounds = (start: number, end: number) => (start === end ? `${start} only` : `${start}–${end}`);

/** Countdown clock: "4d 07:12:09", "07:12:09". */
export function fmtClock(ms: number): string {
  const abs = Math.max(0, ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d ? `${d}d ` : ""}${p(h)}:${p(m)}:${p(s)}`;
}

export type Status = "live" | "upcoming" | "ended";
export function status(start: number, end: number, now = Date.now()): { s: Status; label: string } {
  if (now < start) return { s: "upcoming", label: `starts in ${fmtSpan(start - now)}` };
  if (now < end) return { s: "live", label: `ends in ${fmtSpan(end - now)}` };
  return { s: "ended", label: `ended ${fmtSpan(now - end)} ago` };
}

/** "DartMonkey" → "Dart Monkey", "LeastCash" → "Least Cash", "Ultimate3" → "Ultimate 3", "CHIMPS-BLACK" stays. */
export const human = (id: string) =>
  id.includes("-") || id === id.toUpperCase()
    ? id
    : id
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z])([0-9])/g, "$1 $2");

/** Tower/hero IDs with their in-game names where the ID differs. */
const NAMES: Record<string, string> = {
  DanDMonke: "D&D Monke",
  ObynGreenfoot: "Obyn",
  CaptainChurchill: "Churchill",
  AdmiralBrickell: "Brickell",
  StrikerJones: "Striker Jones",
  PatFusty: "Pat Fusty",
  ChosenPrimaryHero: "Your hero",
  MonkeyAce: "Monkey Ace",
  HeliPilot: "Heli Pilot",
};
export const unitName = (id: string) => NAMES[id] ?? human(id);

/** Boss types (the API's lowercase `bossType`) → in-game names. */
const BOSS_NAMES: Record<string, string> = {
  bloonarius: "Bloonarius",
  lych: "Lych",
  vortex: "Vortex",
  dreadbloon: "Dreadbloon",
  phayze: "Phayze",
  blastapopoulos: "Blastapopoulos",
  diamondback: "Diamondback",
};

/**
 * A boss's in-game name from its `bossType` or from the letters of NK's event name, which can be misspelled
 * ("Blastapopolous", "BLASTAPOPOLOUS"): matched on the first five letters. Unknown types are capitalised.
 */
export function bossName(type: string): string {
  const k = type.toLowerCase();
  if (BOSS_NAMES[k]) return BOSS_NAMES[k];
  const near = k.length >= 5 ? Object.keys(BOSS_NAMES).find((b) => b.slice(0, 5) === k.slice(0, 5) && Math.abs(b.length - k.length) <= 2) : undefined;
  if (near) return BOSS_NAMES[near];
  return type === type.toUpperCase() ? cap(k) : cap(type);
}

/** The event number at the end of NK's boss event name ("Dreadbloon37" → "37"), "" when there is none. */
export const bossNum = (name: string | undefined) => /(\d+)$/.exec(name ?? "")?.[1] ?? "";

/**
 * Boss event title. Preferred: `bossTitle(bossType, n)` → "Dreadbloon #37", "Blastapopoulos #12" (never from
 * NK's `name`, which can be misspelled; bare event ids like "msi6n2qi" carry no name at all).
 * Also accepts a single "Vortex47"-style name (older callers) → "Vortex #47".
 */
export function bossTitle(bossType: string, n?: number | string): string {
  if (n !== undefined && n !== "") return `${bossName(bossType)} #${n}`;
  const m = /^([A-Za-z]+)(\d+)$/.exec(bossType);
  if (m) return `${bossName(m[1])} #${m[2]}`;
  if (/^[A-Za-z]+$/.test(bossType)) return bossName(bossType);
  return bossType;
}

/** "Vortex47" → ["Vortex", "47"], "Blastapopolous19" → ["Blastapopoulos", "19"] */
export const bossParts = (name: string): [string, string] => {
  const m = /^([A-Za-z]+)(\d+)$/.exec(name);
  return m ? [bossName(m[1]), m[2]] : [name, ""];
};

/** Built-in map id → in-game name (game data), else the humanised id ("AdorasTemple" → "Adoras Temple"). */
export const mapName = (id: string | null | undefined) => (!id ? "" : id === "CustomMap" ? "Custom map" : (MAP_NAMES[id] ?? human(id)));

/** Ability key from profile stats ("TakeAim2", "RocketStormMAD") → in-game name, else humanised. */
export const abilityName = (k: string) => ABILITY_NAMES[k] ?? ABILITY_NAMES[k.trim()] ?? human(k.trim().replace(/_/g, " "));

// ─────────────────────────────── daily challenges

/**
 * Daily challenge ids: "rot<N><YYYYMMDD>" (standard), "adv<N><YYYYMMDD>" (advanced); co-op dailies have opaque
 * ids ("coopmtr86jby"). N goes up by one a day, so neighbours can be computed from the id alone.
 */
export interface DailyInfo {
  kind: "standard" | "advanced" | "coop";
  n: number | null;
  /** UTC midnight of the challenge's date (ms), when the id carries it. */
  day: number | null;
}
export function dailyInfo(id: string): DailyInfo | null {
  const m = /^(rot|adv)(\d+)(\d{4})(\d{2})(\d{2})$/.exec(id);
  if (m) {
    const day = Date.UTC(Number(m[3]), Number(m[4]) - 1, Number(m[5]));
    return { kind: m[1] === "rot" ? "standard" : "advanced", n: Number(m[2]), day: Number.isFinite(day) ? day : null };
  }
  if (/^coop[a-z0-9]+$/i.test(id)) return { kind: "coop", n: null, day: null };
  return null;
}

/** Hour (UTC) the game switches to a numbered daily on its date: 10:00 CEST, seen in game by the owner (2026-10-07). */
export const DAILY_START_H = 8;

/** When a numbered daily goes live in game (ms), or null (co-op, player challenges). */
export function dailyStart(id: string): number | null {
  const d = dailyInfo(id)?.day;
  return d == null ? null : d + DAILY_START_H * 3_600_000;
}

/**
 * NK lists the next day's dailies in the feed before they start (e.g. rot…20260927 on the 26th, with ~1 test
 * play). A numbered daily counts as out from its start; co-op ids carry no date (always out).
 */
export function dailyIsOut(id: string, now: number): boolean {
  const s = dailyStart(id);
  return s === null || s <= now;
}

/** "Daily #2966", "Advanced daily #2953", "Co-op daily"; null for player challenges. */
export function dailyTitle(id: string): string | null {
  const d = dailyInfo(id);
  if (!d) return null;
  if (d.kind === "coop") return "Co-op daily";
  return `${d.kind === "advanced" ? "Advanced daily" : "Daily"} #${d.n}`;
}

/** The daily `delta` days away (same series), or null when the id has no number/date. */
export function dailyNeighbour(id: string, delta: number): string | null {
  const d = dailyInfo(id);
  if (!d || d.n === null || d.day === null) return null;
  const t = new Date(d.day + delta * 86_400_000);
  const ymd = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
  return `${id.slice(0, 3)}${d.n + delta}${ymd}`;
}

/**
 * The player named in a daily's title: "Standard 2966: BrightGiraffe84's Challenge" → "BrightGiraffe84".
 * NK gives no id for them (creator is null), so this is text only. null when the name doesn't follow the pattern.
 */
export function dailyAuthor(name: string | null | undefined): string | null {
  const bare = (name ?? "").replace(/^(?:\w+ \d+: |coop - )/i, "");
  const m = /^(.+?)'?s\s+Chal\w*$/i.exec(bare.trim());
  return m ? m[1] : null;
}

/** Lower-case without diacritics, for search ("Café" matches "cafe"). */
export const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Odyssey rewards: "MonkeyMoney:100" → "100 Monkey Money", "Power:SuperMonkeyStorm" → "Super Monkey Storm (power)". */
export function fmtReward(r: string): string {
  const [kind, value = ""] = r.split(":");
  if (/^\d+$/.test(value)) return `${fmtInt(Number(value))} ${human(kind)}`;
  if (kind === "Power") return `${human(value)} power`;
  if (kind === "InstaMonkey") return `${human(value.split(",")[0])} insta`;
  return value ? `${human(value)} (${human(kind).toLowerCase()})` : human(kind);
}
