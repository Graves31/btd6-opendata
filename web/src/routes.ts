// URL ⇄ Route, and the data keys each route needs. `needs()` is what makes generic prefetching possible:
// any link can compute exactly which keys its target page will read, before the user clicks it.

import type { Ben, Path, Tier } from "./bank.ts";
import { HEROES } from "./heroXp.ts";
import { MAP_LIST } from "./data/names.ts";
import { myTeam } from "./myTeam.ts";
import { paragonTowers, type Difficulty, type GameVer, type ParagonTower } from "./paragon.ts";

const MAP_IDS = new Set(MAP_LIST.map((m) => m[0]));

export type EventKind = "boss" | "race" | "ct" | "odyssey";
export type BossDiff = "standard" | "elite";
export type OdyDiff = "easy" | "medium" | "hard";
/** `tiles` is the old name of `map`: parse() never returns it, it only keeps old callers compiling. */
export type CTTab = "players" | "teams" | "map";
export const CHALLENGE_FILTERS = ["daily", "newest", "trending"] as const;
export type ChallengeFilter = (typeof CHALLENGE_FILTERS)[number];
export const CHALLENGE_LABEL: Record<ChallengeFilter, string> = { daily: "Daily", newest: "Newest", trending: "Trending" };

/** A public player / team id (48 hex). Anything else may be a private OAK and is never put in a key or request. */
export const isPublicId = (id: string) => /^[0-9a-f]{48}$/.test(id);

export type Route =
  | { name: "home" }
  | { name: "events"; kind: EventKind }
  | { name: "boss"; id: string; d: BossDiff; n: number; p: number }
  | BossStatsRoute
  | { name: "race"; id: string; p: number }
  | { name: "ct"; id: string; tab: CTTab; p: number }
  | { name: "ctgroup"; id: string; gid: string }
  | { name: "odyssey"; id: string; d: OdyDiff }
  | { name: "player"; id: string }
  | { name: "team"; id: string }
  | { name: "challenge"; id: string }
  | { name: "challenges"; filter: ChallengeFilter; p: number }
  | RoundsRoute
  | { name: "tools" }
  | ParagonRoute
  | { name: "farming"; r?: number }
  | BankRoute
  | HeroXpRoute
  | { name: "pgscaling"; d?: number; to?: number }
  | { name: "stats" }
  | { name: "suggest" }
  | { name: "me" }
  | MapsRoute
  | { name: "map"; id: string }
  | { name: "notfound" };

/** Bank & IMF Loan planner (/tools/bank-planner). Defaults (Collect, 1-3-0, round 30, both MK, no extras) stay out of the URL. */
export interface BankRoute {
  name: "bankPlanner";
  dep: boolean;
  tier: Tier;
  path: Path;
  /** round bought before / next round to play */
  r: number;
  /** balance now; Collect: undefined = just bought, a number = already has cash */
  b?: number;
  bb: boolean;
  mvb: boolean;
  ben: Ben;
  city: boolean;
  oc: boolean;
  half: boolean;
  /** game ends after this round */
  end?: number;
  /** selected deposit rung (1 = fastest) */
  k: number;
}
export const BANK_DEFAULT = { dep: false, tier: 3, path: 1, r: 30, bb: true, mvb: true, ben: 0, city: false, oc: false, half: false, k: 1 } as const;
export const BANK_RUNGS = 6;

function parseBank(q: URLSearchParams): BankRoute {
  const bank = /^([012])([345])0$/.exec(q.get("bank") ?? "");
  const dep = q.get("m") === "dep";
  const mk = q.get("mk");
  const x = list(q.get("x"));
  const ben = q.get("ben");
  const b = q.get("b");
  const end = int(q.get("end"), 0, 1, 999);
  return {
    name: "bankPlanner",
    dep,
    tier: (dep ? Math.max(4, Number(bank?.[2] ?? 4)) : Number(bank?.[2] ?? 3)) as Tier,
    path: Number(bank?.[1] ?? 1) as Path,
    r: int(q.get("r"), BANK_DEFAULT.r, 1, 999),
    b: b !== null && /^\d{1,6}$/.test(b) ? Number(b) : undefined,
    bb: mk === null || mk === "bb",
    mvb: mk === null || mk === "mvb",
    ben: ben === "5" ? 5 : ben === "9" ? 9 : 0,
    city: x.includes("city"),
    oc: x.includes("oc"),
    half: x.includes("half"),
    end: end || undefined,
    k: int(q.get("k"), 1, 1, BANK_RUNGS),
  };
}

/** Hero XP planner (/tools/hero-xp). Defaults (Geraldo, level 20 by round 100, Beginner, all four MK, no boost/Energizer, solo, from round 1) stay out of the URL. */
export interface HeroXpRoute {
  name: "heroXp";
  /** goal = when to place for a level by a round; placed = the timeline from round `at` */
  mode: "goal" | "placed";
  hero: string;
  /** goal: this level at the start of round `round` */
  level: number;
  round: number;
  /** map difficulty 0..3 */
  map: 0 | 1 | 2 | 3;
  edu: boolean;
  taught: boolean;
  mts: boolean;
  emp: boolean;
  boost: 0 | 1 | 2;
  /** Energizer from this round on (0 = none) */
  en: number;
  /** heroes on the map */
  n: number;
  /** first round the hero can be placed */
  first: number;
  /** placement round the timeline shows (undefined = the plan's latest, or `first` when placed) */
  at?: number;
}
export const HERO_XP_DEFAULT = { mode: "goal", hero: "Geraldo", level: 20, round: 100, map: 0, edu: true, taught: true, mts: true, emp: true, boost: 0, en: 0, n: 1, first: 1 } as const;
const HERO_MK = ["edu", "taught", "mts", "emp"] as const;

function parseHeroXp(q: URLSearchParams): HeroXpRoute {
  const mk = q.has("mk") ? list(q.get("mk")) : undefined;
  const at = int(q.get("at"), 0, 1, 999);
  const hero = q.get("h") ?? "";
  return {
    name: "heroXp",
    mode: q.get("mode") === "placed" ? "placed" : "goal",
    hero: hero in HEROES ? hero : HERO_XP_DEFAULT.hero,
    level: int(q.get("lv"), 20, 2, 20),
    round: int(q.get("r"), 100, 1, 200),
    map: int(q.get("d"), 0, 0, 3) as HeroXpRoute["map"],
    edu: !mk || mk.includes("edu"),
    taught: !mk || mk.includes("taught"),
    mts: !mk || mk.includes("mts"),
    emp: !mk || mk.includes("emp"),
    boost: int(q.get("boost"), 0, 0, 2) as 0 | 1 | 2,
    en: int(q.get("en"), 0, 1, 200),
    n: int(q.get("n"), 1, 1, 4),
    first: int(q.get("from"), 1, 1, 200),
    at: at || undefined,
  };
}

export type MapSort = "game" | "az" | "bosses" | "races" | "recent" | "bossgap" | "racegap";
/** Maps explorer (/maps): name search, difficulty (0..3) and water filters, sort. Defaults are left out of the URL. */
export interface MapsRoute {
  name: "maps";
  q: string;
  /** difficulty filter, canonical (sorted, unique, 0..3); empty = all */
  d: number[];
  water: boolean;
  /** only maps with no boss event / no race on record */
  noBoss: boolean;
  noRace: boolean;
  sort: MapSort;
}
const MAP_SORTS = ["game", "az", "bosses", "races", "recent", "bossgap", "racegap"] as const;
const normMapQ = (v: string) => v.trim().slice(0, 40).trim();
const normMapDiff = (v: readonly number[]): number[] => [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0 && n <= 3))].sort();

/** Boss types with a stats page (/bosses/<type>), in display order (the same list as rules.tsx). */
export const BOSS_TYPES = ["bloonarius", "lych", "vortex", "dreadbloon", "phayze", "blastapopoulos", "diamondback"] as const;

/** Boss stats page (/bosses/<type>): difficulty, selected tier, the event whose modifiers apply, modifiers on/off. */
export interface BossStatsRoute {
  name: "bossstats";
  type: string;
  d: BossDiff;
  /** selected tier 1..5 */
  t: number;
  /** boss event the reader came from: its ruleset's boss health/speed multipliers apply */
  ev?: string;
  /** false (`mod=0`): base values */
  mod: boolean;
}

/**
 * Event modifiers the round visualizer shows (URL params camo/regrow/fort, hp/mhp/bhp, spd/mspd/bspd/rgr): the
 * event's `_bloonModifiers`. Defaults (false / 1) are left out of the URL.
 */
export interface RoundMods {
  camo: boolean;
  regrow: boolean;
  fort: boolean;
  /** healthMultipliers.bloons / .moabs / .boss */
  hp: number;
  mhp: number;
  bhp: number;
  /** speedMultiplier / moabSpeedMultiplier / bossSpeedMultiplier / regrowRateMultiplier */
  spd: number;
  mspd: number;
  bspd: number;
  rgr: number;
}
export const NO_MODS: RoundMods = { camo: false, regrow: false, fort: false, hp: 1, mhp: 1, bhp: 1, spd: 1, mspd: 1, bspd: 1, rgr: 1 };
const MOD_FLAGS = ["camo", "regrow", "fort"] as const;
/** Filter chips (URL `has=`), in display order. */
export const HAS_FILTERS = ["changed", "camo", "regrow", "fort", "moabs"] as const;
export type HasFilter = (typeof HAS_FILTERS)[number];
const BLOON_KEY = /^[a-z0-9-]{1,32}$/;
const list = (v: string | null) => (v ?? "").split(",").filter(Boolean);
/** Canonical filter lists: known values only, no duplicates, fixed order (so equal views have equal URLs). */
export const normHas = (v: readonly string[]): HasFilter[] => HAS_FILTERS.filter((h) => v.includes(h));
export const normBloon = (v: readonly string[]): string[] => [...new Set(v.filter((b) => BLOON_KEY.test(b)))].sort().slice(0, 30);
const MOD_MULTS = ["hp", "mhp", "bhp", "spd", "mspd", "bspd", "rgr"] as const;

/**
 * Tools → round visualizer (/tools, canonical /tools/rounds). The URL is the whole view: which set, the round
 * range, the open round, the event's modifiers and where the reader came from. Range values are kept as given
 * (the page clamps them to the set, whose bounds only the round manifest knows).
 */
export interface RoundsRoute {
  name: "rounds";
  /** round-set id from the manifest (web/src/data/rounds); absent = resolved from `mode`, else "default" */
  set?: string;
  from?: number;
  to?: number;
  /** open round */
  r?: number;
  /** the event's own range ("Event" preset), written by the rules panel's link */
  ev?: [number, number];
  /** ChallengeDocument.mode */
  mode?: string;
  mods: RoundMods;
  /** "Base rounds": every modifier off (still in the URL) */
  base: boolean;
  /** focused round view (`view=round`): one round, full width */
  view?: "round";
  /** list filters, matched as "any of": variant flags, MOAB-class, rounds a boss set changed */
  has: HasFilter[];
  /** list filter by bloon type (BLOON_TYPES keys), also "any of" with `has` */
  bloon: string[];
  /** site path of the page that linked here (back link); only a path that parses to a known page */
  src?: string;
}

/**
 * Tools → Paragon degree calculator (/tools/paragon). The URL is the whole state (short keys, defaults left out):
 * p tower slug, d e/m/h/i, c cash, s slider, po pops, in income, t tiers, x extra tier 5s, to totems,
 * gv=56 the old (v56.3) calculation (default v57, not written), tg target degree, b=1 Paragon Boost, nt=1 never suggest totems (no Geraldo). Invalid values are ignored, too-large ones clamped (the page clamps further).
 * adv=1 (the old Advanced fold) is still parsed for old links but never written; co=1 (the old co-op toggle) is ignored.
 */
export interface ParagonRoute {
  name: "paragon";
  tower: ParagonTower;
  diff: Difficulty;
  ver: GameVer;
  cash: number;
  slider: number;
  pops: number;
  income: number;
  tiers: number;
  extraT5: number;
  totems: number;
  /** target degree 2..100; absent = the next boss breakpoint */
  target?: number;
  /** Paragon Boost (+25 degrees on the game's first paragon) */
  boost: boolean;
  /** never suggest power totems (the player has no Geraldo) */
  noTotems: boolean;
  /** old links: the Advanced fold was open (no longer used or written) */
  adv: boolean;
  /** the URL named a tower or difficulty (else the page may preselect the last one used) */
  picked: boolean;
}

/** Short URL slug of each paragon's tower (the full id is accepted too). */
export const PARAGON_SLUG: Record<ParagonTower, string> = {
  BombShooter: "bomb",
  BoomerangMonkey: "boomerang",
  DartMonkey: "dart",
  Druid: "druid",
  EngineerMonkey: "engineer",
  IceMonkey: "ice",
  MonkeyAce: "ace",
  MonkeyBuccaneer: "buccaneer",
  MonkeySub: "sub",
  SniperMonkey: "sniper",
  NinjaMonkey: "ninja",
  SpikeFactory: "spike",
  TackShooter: "tack",
  WizardMonkey: "wizard",
};
const DIFF_KEY: Record<Difficulty, string> = { easy: "e", medium: "m", hard: "h", impoppable: "i" };
export const PG_DIFFS = ["easy", "medium", "hard", "impoppable"] as const;
/** Largest value the URL accepts for each paragon input (the page clamps further, to where each source fills). */
export const PG_MAX = { cash: 10_000_000_000, slider: 10_000_000_000, pops: 1_000_000_000, income: 10_000_000_000, tiers: 1000, extraT5: 100, totems: 1000 };
export const PG_DEFAULT: { tower: ParagonTower; diff: Difficulty } = { tower: "DartMonkey", diff: "medium" };

export const LIST_KEY: Record<EventKind, string> = {
  boss: "/btd6/bosses",
  race: "/btd6/races",
  ct: "/btd6/ct",
  odyssey: "/btd6/odyssey",
};
const LIST_PATH: Record<EventKind, string> = { boss: "/bosses", race: "/races", ct: "/ct", odyssey: "/odyssey" };

export const historyKey = (kind: EventKind) => `/api/history/${kind}?limit=50`;

const page = (p: number) => (p > 1 ? `?page=${p}` : "");
export const bossBoardKey = (id: string, d: BossDiff, n: number, p = 1) => `/btd6/bosses/${id}/leaderboard/${d}/${n}${page(p)}`;
export const bossMetaKey = (id: string, d: BossDiff) => `/btd6/bosses/${id}/metadata/${d}`;
export const raceBoardKey = (id: string, p = 1) => `/btd6/races/${id}/leaderboard${page(p)}`;
export const raceMetaKey = (id: string) => `/btd6/races/${id}/metadata`;
export const ctKey = (id: string, tab: CTTab, p = 1) =>
  tab === "map" ? `/btd6/ct/${id}/tiles` : `/btd6/ct/${id}/leaderboard/${tab === "players" ? "player" : "team"}${page(p)}`;
/** Medal cut-off scores per day (Worker, D1 only) and the relics of every archived CT. */
export const ctCutoffsKey = (id: string) => `/api/ct/${id}/cutoffs`;
export const CT_RELICS_KEY = "/api/ct/relics";
export const ctGroupKey = (id: string, gid: string) => `/btd6/ct/${id}/leaderboard/group/${gid}`;
export const odyMetaKey = (id: string, d: OdyDiff) => `/btd6/odyssey/${id}/${d}`;
export const odyMapsKey = (id: string, d: OdyDiff) => `/btd6/odyssey/${id}/${d}/maps`;
export const userKey = (id: string) => `/btd6/users/${id}`;
export const guildKey = (id: string) => `/btd6/guild/${id}`;
export const challengeKey = (id: string) => `/btd6/challenges/challenge/${id}`;
/** A team's CT placements archived by the server (no NK requests): `{ team, entries }`, see docs/batch-1-19.md. */
export const teamHistoryKey = (guildId: string) => `/api/history/team/${guildId}`;
export const challengeListKey = (f: ChallengeFilter, p = 1) => `/btd6/challenges/filter/${f}${page(p)}`;
export const EVENTS_KEY = "/btd6/events";
export const DAILY_KEY = "/btd6/challenges/filter/daily";

export const HOME_LISTS = [LIST_KEY.boss, LIST_KEY.race, LIST_KEY.ct, LIST_KEY.odyssey, EVENTS_KEY, DAILY_KEY];

/**
 * The home page also renders data that depends on the lists (featured boss map + top 3, the race's map, the
 * odyssey's islands, the CT leader, the daily challenge). Which keys those are is only known from the lists,
 * so the browser registers a resolver over its store (nav.ts). Without one (tests) home needs only the lists.
 */
let homeExtras: () => string[] = () => [];
export function setHomeExtras(fn: () => string[]): void {
  homeExtras = fn;
}

/**
 * The round visualizer's data is a static, content-hashed set file (web/src/data/rounds, imported with ?url). The
 * browser registers how a route maps to that file's URL (nav.ts), so that module's asset imports stay out of here.
 */
let roundKeys: (r: RoundsRoute) => string[] = () => [];
export function setRoundKeys(fn: (r: RoundsRoute) => string[]): void {
  roundKeys = fn;
}

/** The boss stats file (bosses.json, a content-hashed static asset); registered by nav.ts like the round sets. */
let bossStatsUrl = "";
export function setBossStatsUrl(u: string): void {
  bossStatsUrl = u;
}

/** Maps pages read every boss / race event's map from its metadata; registered by nav.ts like the home extras. */
let mapExtras: () => string[] = () => [];
export function setMapExtras(fn: () => string[]): void {
  mapExtras = fn;
}

/**
 * CT pages also read data that depends on boards already in memory (the top teams' emblems, each group member's
 * history, every listed CT's tiles). Like the home extras, the browser registers a resolver over its store (nav.ts).
 */
let ctExtras: (r: Route) => string[] = () => [];
export function setCtExtras(fn: (r: Route) => string[]): void {
  ctExtras = fn;
}

/** What `needs()` adds for CT routes, given a way to read a loaded key's body. Pure: nav.ts passes the store. */
export function ctExtraKeys(peek: <T>(k: string) => T | undefined, r: Route): string[] {
  const guild = (rows?: { profile: string }[], n = 3) => (rows ?? []).slice(0, n).map((x) => guildKey(idFromUrl(x.profile)));
  if (r.name === "ct") return guild(peek<{ profile: string }[]>(ctKey(r.id, "teams")));
  if (r.name === "ctgroup") {
    const rows = peek<{ profile: string }[]>(ctGroupKey(r.id, r.gid));
    return [...(rows ?? []).map((x) => teamHistoryKey(idFromUrl(x.profile))), ...guild(rows, 1)];
  }
  if (r.name === "events" && r.kind === "ct") {
    // /ct: every listed CT's mini map and board, its winner's emblem (top 3 for the live one), and the followed
    // team's emblem + the live cut-off trend for its My team card.
    const now = Date.now();
    const list = peek<{ id: string; start: number; end: number }[]>(LIST_KEY.ct) ?? [];
    const live = list.find((c) => c.start <= now && now < c.end);
    const my = myTeam();
    return [
      ...list.flatMap((c) => [ctKey(c.id, "map"), ctKey(c.id, "teams"), ...guild(peek(ctKey(c.id, "teams")), c === live ? 3 : 1)]),
      ...(my ? [guildKey(my.id), ...(live ? [ctCutoffsKey(live.id)] : [])] : []),
    ];
  }
  return [];
}

/** The data a route renders. Links prefetch exactly this. */
export function needs(r: Route): string[] {
  switch (r.name) {
    case "home":
      return [...new Set([...HOME_LISTS, ...homeExtras()])];
    case "events":
      return [LIST_KEY[r.kind], historyKey(r.kind), ...(r.kind === "ct" ? [CT_RELICS_KEY, ...(myTeam() ? [teamHistoryKey(myTeam()!.id)] : []), ...ctExtras(r)] : [])];
    case "boss":
      return [LIST_KEY.boss, bossMetaKey(r.id, r.d), bossBoardKey(r.id, r.d, r.n, r.p)];
    case "bossstats":
      // The past-events plate reads the lists; an event's modifiers come from its ruleset (the d tab's metadata).
      return [...(bossStatsUrl ? [bossStatsUrl] : []), LIST_KEY.boss, historyKey("boss"), ...(r.ev ? [bossMetaKey(r.ev, r.d)] : [])];
    case "race":
      return [LIST_KEY.race, raceMetaKey(r.id), raceBoardKey(r.id, r.p)];
    case "ct":
      // Every tab reads the tiles (header, hero map), the relic history and the cut-off trend; ctExtras adds the top teams' emblems.
      return [...new Set([LIST_KEY.ct, historyKey("ct"), ctKey(r.id, r.tab, r.p), ctKey(r.id, "map"), ctKey(r.id, "teams"), CT_RELICS_KEY, ctCutoffsKey(r.id), ...ctExtras(r)])];
    case "ctgroup":
      return [LIST_KEY.ct, ctGroupKey(r.id, r.gid), ...ctExtras(r)];
    case "odyssey":
      return [LIST_KEY.odyssey, odyMetaKey(r.id, r.d), odyMapsKey(r.id, r.d)];
    case "player":
      return isPublicId(r.id) ? [userKey(r.id)] : [];
    case "team":
      return isPublicId(r.id) ? [guildKey(r.id), teamHistoryKey(r.id)] : [];
    case "challenge":
      return [challengeKey(r.id), DAILY_KEY]; // prev/next + author need the daily feed
    case "challenges":
      return r.filter === "daily" ? [challengeListKey(r.filter, r.p)] : [challengeListKey(r.filter, r.p), DAILY_KEY]; // search jumps to a daily number
    case "rounds":
      return roundKeys(r);
    case "bankPlanner":
    case "heroXp":
      return []; // pure client maths
    case "tools":
    case "farming":
      return roundKeys(parseRounds(new URLSearchParams())); // the default round set (round lengths)
    case "maps":
    case "map":
      return [...new Set([LIST_KEY.boss, historyKey("boss"), LIST_KEY.race, historyKey("race"), ...mapExtras()])];
    case "paragon":
    case "pgscaling":
      return []; // static pages: no NK data
    case "stats":
    case "suggest":
    case "me": // the save is read in the browser from NK (oak.ts), not from the store
    case "notfound":
      return []; // /stats fetches its own data (hidden page, reached only by URL)
  }
}

// ─────────────────────────────── URL → Route

const int = (v: string | null, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};
/** Any event id NK uses: "Vortex47_mu62cmt5", bare "msi6n2qi" (Dreadbloon #37), "Regene-race_mtjapaiu". */
export const EVENT_ID = /^[A-Za-z0-9_-]{4,64}$/;
/** CT group ids: 44 hex during an event; NK's post-event placeholder is 8 hex (`c7fa4bd7`). Same shape as the Worker's. */
export const CT_GROUP_ID = /^[0-9a-f]{8,64}$/;
/** The group every team links to once NK has dropped a CT's groups; its page answers "No Group Available". */
export const CT_GROUP_PLACEHOLDER = "c7fa4bd7";
const oneOf = <T extends string>(v: string | null, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);

export function parse(url: URL): Route {
  const seg = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const q = url.searchParams;
  const [a, b, c, d] = seg;
  if (!a) return { name: "home" };
  if (seg.length === 1) {
    const kind = (Object.keys(LIST_PATH) as EventKind[]).find((k) => LIST_PATH[k] === `/${a}`);
    if (kind) return { name: "events", kind };
  }
  // Event pages: a malformed id is a 404 page, never a request upstream.
  if (a === "bosses" && b && !c) {
    if (!(BOSS_TYPES as readonly string[]).includes(b)) return { name: "notfound" };
    const ev = q.get("ev");
    const r: BossStatsRoute = { name: "bossstats", type: b, d: oneOf(q.get("d"), ["standard", "elite"] as const, "standard"), t: int(q.get("t"), 5, 1, 5), mod: q.get("mod") !== "0" };
    if (ev && EVENT_ID.test(ev)) r.ev = ev;
    return r;
  }
  if ((a === "boss" || a === "race" || a === "ct" || a === "odyssey") && b && !EVENT_ID.test(b)) return { name: "notfound" };
  if (a === "boss" && b && !c) {
    return { name: "boss", id: b, d: oneOf(q.get("d"), ["standard", "elite"] as const, "standard"), n: int(q.get("n"), 1, 1, 4), p: int(q.get("p"), 1, 1, 40) };
  }
  if (a === "race" && b && !c) return { name: "race", id: b, p: int(q.get("p"), 1, 1, 20) };
  if (a === "ct" && b && !c) {
    return { name: "ct", id: b, tab: q.get("tab") === "tiles" ? "map" : oneOf(q.get("tab"), ["players", "teams", "map"] as const, "teams"), p: int(q.get("p"), 1, 1, 40) };
  }
  if (a === "ct" && b && c === "group" && d && CT_GROUP_ID.test(d)) return { name: "ctgroup", id: b, gid: d };
  if (a === "odyssey" && b && !c) return { name: "odyssey", id: b, d: oneOf(q.get("d"), ["easy", "medium", "hard"] as const, "easy") };
  if (a === "player" && b) return { name: "player", id: b };
  if (a === "team" && b) return { name: "team", id: b };
  if (a === "challenge" && b) return { name: "challenge", id: b };
  if (a === "stats" && !b) return { name: "stats" };
  if (a === "suggest" && !b) return { name: "suggest" };
  if (a === "me" && !b) return { name: "me" };
  if (a === "maps" && !b) {
    return { name: "maps", q: normMapQ(q.get("q") ?? ""), d: normMapDiff(list(q.get("d")).map(Number)), water: q.get("water") === "1", noBoss: q.get("noboss") === "1", noRace: q.get("norace") === "1", sort: oneOf(q.get("sort"), MAP_SORTS, "game") };
  }
  if (a === "maps" && b && !c && MAP_IDS.has(b)) return { name: "map", id: b }; // other ids: a real 404 (og.ts)
  if (a === "tools" && !b) return ROUNDS_PARAMS.some((k) => q.has(k)) ? parseRounds(q) : { name: "tools" }; // old shared /tools?… links
  if (a === "tools" && b === "rounds" && !c) return parseRounds(q);
  if (a === "tools" && b === "paragon" && !c) return parseParagon(q);
  if (a === "tools" && b === "farming" && !c) {
    const r = Number(q.get("r"));
    return { name: "farming", r: Number.isInteger(r) && r >= 1 && r <= 1000 ? r : undefined };
  }
  if (a === "tools" && b === "bank-planner" && !c) return parseBank(q);
  if (a === "tools" && b === "hero-xp" && !c) return parseHeroXp(q);
  if (a === "tools" && b === "paragon-scaling" && !c) {
    const deg = (k: string) => {
      const n = Number(q.get(k));
      return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined;
    };
    return { name: "pgscaling", d: deg("d"), to: deg("to") };
  }
  if (a === "challenges" && !c && (!b || (CHALLENGE_FILTERS as readonly string[]).includes(b))) {
    const filter = oneOf(b ?? null, CHALLENGE_FILTERS, "daily");
    return { name: "challenges", filter, p: filter === "daily" ? 1 : int(q.get("p"), 1, 1, 50) };
  }
  return { name: "notfound" };
}

/** Query keys that make a bare /tools the round visualizer (the page it was before the hub existed). */
const ROUNDS_PARAMS = ["set", "from", "to", "r", "ev", "mode", "camo", "regrow", "fort", ...MOD_MULTS, "base", "has", "bloon", "view", "src", "notable"];

const ROUND_NO = (v: string | null) => (v !== null && /^\d{1,4}$/.test(v) ? Math.max(1, Number(v)) : undefined);
const mult = (v: string | null) => {
  const n = v === null || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 1;
};

/** A site-relative path to a known page, or undefined (never an open redirect: no scheme, host or "//"). */
export function safeSrc(v: string | null | undefined): string | undefined {
  if (!v || v.length > 300 || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return undefined;
  let u: URL;
  try {
    u = new URL(v, "https://x.invalid");
  } catch {
    return undefined;
  }
  if (u.origin !== "https://x.invalid") return undefined;
  const r = parse(u);
  return r.name === "notfound" || r.name === "rounds" ? undefined : u.pathname + u.search;
}

/** A non-negative integer; unparsable → def, above max → max. */
const clampInt = (v: string | null, max: number) => {
  const n = v === null || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(max, Math.floor(n)) : 0;
};

function parseParagon(q: URLSearchParams): ParagonRoute {
  const p = (q.get("p") ?? "").toLowerCase();
  const ver: GameVer = q.get("gv") === "56" ? "56" : "57";
  const tower = paragonTowers(ver).find((t) => PARAGON_SLUG[t] === p || t.toLowerCase() === p);
  const dk = q.get("d");
  const diff = PG_DIFFS.find((x) => DIFF_KEY[x] === dk);
  const tg = Number(q.get("tg"));
  const r: ParagonRoute = {
    name: "paragon",
    tower: tower ?? PG_DEFAULT.tower,
    diff: diff ?? PG_DEFAULT.diff,
    ver,
    cash: clampInt(q.get("c"), PG_MAX.cash),
    slider: clampInt(q.get("s"), PG_MAX.slider),
    pops: clampInt(q.get("po"), PG_MAX.pops),
    income: clampInt(q.get("in"), PG_MAX.income),
    tiers: clampInt(q.get("t"), PG_MAX.tiers),
    extraT5: clampInt(q.get("x"), PG_MAX.extraT5),
    totems: clampInt(q.get("to"), PG_MAX.totems),
    boost: q.get("b") === "1",
    noTotems: q.get("nt") === "1",
    adv: q.get("adv") === "1",
    picked: !!tower || !!diff,
  };
  if (Number.isInteger(tg) && tg >= 2 && tg <= 100) r.target = tg;
  return r;
}

function parseRounds(q: URLSearchParams): RoundsRoute {
  const set = q.get("set");
  const mode = q.get("mode");
  const ev = /^(\d{1,4})-(\d{1,4})$/.exec(q.get("ev") ?? "");
  const mods = { ...NO_MODS };
  for (const k of MOD_FLAGS) mods[k] = q.get(k) === "1";
  for (const k of MOD_MULTS) mods[k] = mult(q.get(k));
  // `notable=1` (the first version's "Notable only") now means the boss-set filter; sets without one ignore it.
  const has = normHas([...list(q.get("has")), ...(q.get("notable") === "1" ? ["changed"] : [])]);
  const r: RoundsRoute = { name: "rounds", mods, base: q.get("base") === "1", has, bloon: normBloon(list(q.get("bloon"))) };
  if (q.get("view") === "round") r.view = "round";
  if (set && /^[a-z0-9-]{1,64}$/.test(set)) r.set = set;
  const from = ROUND_NO(q.get("from"));
  const to = ROUND_NO(q.get("to"));
  const open = ROUND_NO(q.get("r"));
  if (from !== undefined) r.from = from;
  if (to !== undefined) r.to = to;
  if (open !== undefined) r.r = open;
  if (ev) r.ev = [Math.max(1, Number(ev[1])), Math.max(1, Number(ev[2]))];
  if (mode && /^[A-Za-z0-9-]{1,40}$/.test(mode)) r.mode = mode;
  const src = safeSrc(q.get("src"));
  if (src) r.src = src;
  return r;
}

// ─────────────────────────────── Route → URL

const qs = (o: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : "";
};

export const href = {
  home: () => "/",
  events: (kind: EventKind) => LIST_PATH[kind],
  boss: (id: string, d: BossDiff = "standard", n = 1, p = 1) =>
    `/boss/${id}${qs({ d: d === "standard" ? undefined : d, n: n === 1 ? undefined : n, p: p === 1 ? undefined : p })}`,
  /** Boss stats page; only non-default values are written. */
  bossstats: (type: string, o: { d?: BossDiff; t?: number; ev?: string; mod?: boolean } = {}) =>
    `/bosses/${type}${qs({ d: o.d === "elite" ? "elite" : undefined, t: o.t !== undefined && o.t !== 5 ? o.t : undefined, ev: o.ev, mod: o.mod === false ? 0 : undefined })}`,
  race: (id: string, p = 1) => `/race/${id}${qs({ p: p === 1 ? undefined : p })}`,
  /** No tab → the CT's default (Teams); an explicit tab is always spelled out, so tab links are distinguishable. */
  ct: (id: string, tab?: CTTab, p = 1) => `/ct/${id}${qs({ tab, p: p === 1 ? undefined : p })}`,
  ctgroup: (id: string, gid: string) => `/ct/${id}/group/${gid}`,
  odyssey: (id: string, d: OdyDiff = "easy") => `/odyssey/${id}${qs({ d: d === "easy" ? undefined : d })}`,
  player: (id: string) => `/player/${id}`,
  team: (id: string) => `/team/${id}`,
  challenge: (id: string) => `/challenge/${id}`,
  challenges: (f: ChallengeFilter = "daily", p = 1) => `/challenges${f === "daily" ? "" : `/${f}`}${f !== "daily" && p > 1 ? `?p=${p}` : ""}`,
  /** The round visualizer; only non-default values are written. */
  rounds: (p: Partial<RoundsRoute> = {}) => {
    const m = { ...NO_MODS, ...p.mods };
    const o: Record<string, string | number | undefined> = {
      set: p.set,
      from: p.from,
      to: p.to,
      r: p.r,
      ev: p.ev ? `${p.ev[0]}-${p.ev[1]}` : undefined,
      mode: p.mode,
    };
    for (const k of MOD_FLAGS) o[k] = m[k] ? 1 : undefined;
    for (const k of MOD_MULTS) o[k] = m[k] !== 1 ? +m[k].toFixed(4) : undefined;
    o.base = p.base ? 1 : undefined;
    const has = normHas(p.has ?? []);
    const bloon = normBloon(p.bloon ?? []);
    o.has = has.length ? has.join(",") : undefined;
    o.bloon = bloon.length ? bloon.join(",") : undefined;
    o.view = p.view === "round" ? "round" : undefined;
    o.src = p.src;
    return `/tools/rounds${qs(o).replace(/%2C/g, ",")}`;
  },
  /** The maps explorer; only non-default values are written. */
  maps: (p: Partial<Omit<MapsRoute, "name">> = {}) => {
    const d = normMapDiff(p.d ?? []);
    return `/maps${qs({ q: normMapQ(p.q ?? "") || undefined, d: d.length ? d.join(",") : undefined, water: p.water ? 1 : undefined, noboss: p.noBoss ? 1 : undefined, norace: p.noRace ? 1 : undefined, sort: p.sort && p.sort !== "game" ? p.sort : undefined }).replace(/%2C/g, ",")}`;
  },
  map: (id: string) => `/maps/${encodeURIComponent(id)}`,
  tools: () => "/tools",
  /** Farming resources; `r` = the round whose length the banana chart is drawn in. */
  farming: (r?: number) => `/tools/farming${qs({ r })}`,
  /** The bank planner; only non-default values are written. */
  bankPlanner: (p: Partial<Omit<BankRoute, "name">> = {}) => {
    const d = { ...BANK_DEFAULT, ...p };
    const mk = d.bb && d.mvb ? undefined : d.bb ? "bb" : d.mvb ? "mvb" : "0";
    const x = (["city", "oc", "half"] as const).filter((k) => d[k]).join(",");
    return `/tools/bank-planner${qs({
      m: d.dep ? "dep" : undefined,
      bank: d.tier !== BANK_DEFAULT.tier || d.path !== BANK_DEFAULT.path ? `${d.path}${d.tier}0` : undefined,
      r: d.r !== BANK_DEFAULT.r ? d.r : undefined,
      b: p.b !== undefined && (!d.dep || p.b > 0) ? p.b : undefined,
      mk,
      ben: d.ben || undefined,
      x: x || undefined,
      end: p.end,
      k: d.dep && d.k > 1 ? d.k : undefined,
    }).replace(/%2C/g, ",")}`;
  },
  /** The hero XP planner; only non-default values are written. */
  heroXp: (p: Partial<Omit<HeroXpRoute, "name">> = {}) => {
    const d = { ...HERO_XP_DEFAULT, ...p };
    const on = HERO_MK.filter((k) => d[k]);
    return `/tools/hero-xp${qs({
      mode: d.mode !== "goal" ? d.mode : undefined,
      h: d.hero !== HERO_XP_DEFAULT.hero ? d.hero : undefined,
      lv: d.level !== 20 ? d.level : undefined,
      r: d.round !== 100 ? d.round : undefined,
      d: d.map || undefined,
      mk: on.length === 4 ? undefined : on.join(",") || "0",
      boost: d.boost || undefined,
      en: d.en || undefined,
      n: d.n > 1 ? d.n : undefined,
      from: d.first > 1 ? d.first : undefined,
      at: p.at,
    }).replace(/%2C/g, ",")}`;
  },
  /** Paragon scaling charts; `d` = a degree to mark. */
  paragonScaling: (d?: number, to?: number) => `/tools/paragon-scaling${qs({ d, to })}`,
  /** The paragon calculator; only non-default values are written (`pin`: tower and difficulty always, so a link keeps them). */
  paragon: (s: Partial<Omit<ParagonRoute, "name" | "picked">> = {}, pin = false) =>
    `/tools/paragon${qs({
      p: pin || (s.tower && s.tower !== PG_DEFAULT.tower) ? PARAGON_SLUG[s.tower ?? PG_DEFAULT.tower] : undefined,
      d: pin || (s.diff && s.diff !== PG_DEFAULT.diff) ? DIFF_KEY[s.diff ?? PG_DEFAULT.diff] : undefined,
      gv: s.ver === "56" ? 56 : undefined,
      c: s.cash || undefined,
      s: s.slider || undefined,
      po: s.pops || undefined,
      in: s.income || undefined,
      t: s.tiers || undefined,
      x: s.extraT5 || undefined,
      to: s.totems || undefined,
      tg: s.target,
      b: s.boost ? 1 : undefined,
      nt: s.noTotems ? 1 : undefined,
    })}`,
};

/** Last path segment of an NK URL (profile, creator, owner, guild links). */
export const idFromUrl = (u: string | null | undefined) => (u ? (u.split("?")[0].split("/").pop() ?? "") : "");

export function needsForHref(h: string): string[] {
  return needs(parse(new URL(h, "https://x.invalid")));
}
