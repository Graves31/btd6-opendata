// Route table for the BTD6 Open Data API: matching, local validation, cache classification.
// This is the executable form of docs/api/README.md §6. Pure (no Worker APIs), so it runs anywhere.

import type { RouteName } from "./types.ts";

export type CacheClass =
  | "static"
  | "list"
  | "feed"
  | "event-doc"
  | "leaderboard"
  | "ugc-doc"
  | "profile"
  | "image"
  | "private";

/** Which list endpoint holds the start/end timing for an event-scoped route. */
export type EventKind = "race" | "boss" | "ct" | "odyssey";

export interface RouteDef {
  name: RouteName;
  pattern: RegExp;
  /** Named groups of `pattern`, in order. */
  params: readonly string[];
  cache: CacheClass;
  /** Set when the route belongs to a timed event; the `id` param names which path param holds its ID. */
  event?: { kind: EventKind; idParam: string };
  /** Paginated routes: page size and the hard page cap (null = unbounded feed). */
  paging?: { size: number; maxPages: number | null };
}

const HEX48 = "[0-9a-f]{48}";
/**
 * Event IDs (race, boss, CT, odyssey) are validated by shape only, never by naming: NK has used
 * "Vortex47_mu62cmt5", bare "msi6n2qi" (Dreadbloon #37) and hyphenated "Regene-race_mtjapaiu". Unknown IDs
 * that pass are negative-cached for an hour (errorTtlMs), so a loose pattern costs NK nothing extra.
 */
export const EVENT_ID = "[A-Za-z0-9_-]{4,64}";
/** CT group IDs: 44 hex observed during events, 8 hex (placeholder) after NK dropped the groups. */
const GROUP_ID = "[0-9a-f]{8,64}";
/** Player codes (7 chars) and daily ids: rot<N><date> standard, adv<N><date> advanced, coop<…> co-op. Shape only. */
const CHALLENGE_ID = "[A-Za-z0-9]{4,64}";
const MAP_ID = "[A-Z0-9]{7}";

const r = (s: string) => new RegExp(`^${s}$`);

export const ROUTES: readonly RouteDef[] = [
  // races
  { name: "races", pattern: r("/btd6/races"), params: [], cache: "list" },
  { name: "race.leaderboard", pattern: r(`/btd6/races/(${EVENT_ID})/leaderboard`), params: ["raceID"],
    cache: "leaderboard", event: { kind: "race", idParam: "raceID" }, paging: { size: 50, maxPages: 20 } },
  { name: "race.metadata", pattern: r(`/btd6/races/(${EVENT_ID})/metadata`), params: ["raceID"],
    cache: "event-doc", event: { kind: "race", idParam: "raceID" } },
  // bosses
  { name: "bosses", pattern: r("/btd6/bosses"), params: [], cache: "list" },
  { name: "boss.leaderboard", pattern: r(`/btd6/bosses/(${EVENT_ID})/leaderboard/(standard|elite)/([1-4])`),
    params: ["bossID", "type", "teamSize"], cache: "leaderboard",
    event: { kind: "boss", idParam: "bossID" }, paging: { size: 25, maxPages: 40 } },
  { name: "boss.metadata", pattern: r(`/btd6/bosses/(${EVENT_ID})/metadata/(standard|elite)`),
    params: ["bossID", "difficulty"], cache: "event-doc", event: { kind: "boss", idParam: "bossID" } },
  // users & guilds — only the 48-hex encrypted ID form; anything else may be an OAK → private
  { name: "user", pattern: r(`/btd6/users/(${HEX48})`), params: ["userID"], cache: "profile" },
  { name: "guild", pattern: r(`/btd6/guild/(${HEX48})`), params: ["guildID"], cache: "profile" },
  // challenges
  { name: "challenges", pattern: r("/btd6/challenges"), params: [], cache: "static" },
  { name: "challenges.filter", pattern: r("/btd6/challenges/filter/(newest|trending|daily)"),
    params: ["challengeFilter"], cache: "feed", paging: { size: 25, maxPages: null } },
  { name: "challenge", pattern: r(`/btd6/challenges/challenge/(${CHALLENGE_ID})`), params: ["challengeID"],
    cache: "ugc-doc" },
  // CT
  { name: "ct", pattern: r("/btd6/ct"), params: [], cache: "list" },
  { name: "ct.tiles", pattern: r(`/btd6/ct/(${EVENT_ID})/tiles`), params: ["ctID"], cache: "event-doc",
    event: { kind: "ct", idParam: "ctID" } },
  { name: "ct.leaderboard.player", pattern: r(`/btd6/ct/(${EVENT_ID})/leaderboard/player`), params: ["ctID"],
    cache: "leaderboard", event: { kind: "ct", idParam: "ctID" }, paging: { size: 25, maxPages: 40 } },
  { name: "ct.leaderboard.team", pattern: r(`/btd6/ct/(${EVENT_ID})/leaderboard/team`), params: ["ctID"],
    cache: "leaderboard", event: { kind: "ct", idParam: "ctID" }, paging: { size: 25, maxPages: 40 } },
  { name: "ct.leaderboard.group", pattern: r(`/btd6/ct/(${EVENT_ID})/leaderboard/group/(${GROUP_ID})`),
    params: ["ctID", "groupID"], cache: "leaderboard", event: { kind: "ct", idParam: "ctID" } },
  // odyssey
  { name: "odyssey", pattern: r("/btd6/odyssey"), params: [], cache: "list" },
  { name: "odyssey.metadata", pattern: r(`/btd6/odyssey/(${EVENT_ID})/(easy|medium|hard)`),
    params: ["odysseyID", "difficulty"], cache: "event-doc", event: { kind: "odyssey", idParam: "odysseyID" } },
  { name: "odyssey.maps", pattern: r(`/btd6/odyssey/(${EVENT_ID})/(easy|medium|hard)/maps`),
    params: ["odysseyID", "difficulty"], cache: "event-doc", event: { kind: "odyssey", idParam: "odysseyID" } },
  // maps
  { name: "maps", pattern: r("/btd6/maps"), params: [], cache: "static" },
  { name: "maps.filter", pattern: r("/btd6/maps/filter/(newest|trending|mostLiked)"), params: ["mapFilter"],
    cache: "feed", paging: { size: 25, maxPages: null } },
  { name: "map", pattern: r(`/btd6/maps/map/(${MAP_ID})`), params: ["mapID"], cache: "ugc-doc" },
  { name: "map.preview", pattern: r(`/btd6/maps/map/(${MAP_ID})/preview`), params: ["mapID"], cache: "image" },
  // events
  { name: "events", pattern: r("/btd6/events"), params: [], cache: "list" },
];

export type MatchResult =
  | { ok: true; route: RouteDef; params: Record<string, string>; page: number; cacheKey: string }
  | { ok: false; status: 400 | 403 | 404; code: "bad_request" | "private" | "not_found"; reason: string };

/**
 * Match an upstream-style path (e.g. "/btd6/bosses/X/leaderboard/elite/1") plus its query string.
 * Rejects locally anything NK would reject, so invalid requests never reach the origin.
 */
export function matchRoute(pathname: string, search = ""): MatchResult {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (/^\/btd6\/save\//.test(path) || /^\/btd6\/users\/(?![0-9a-f]{48}$)[^/]+$/.test(path)) {
    return { ok: false, status: 403, code: "private", reason: "OAK requests must go browser → data.ninjakiwi.com directly" };
  }
  for (const route of ROUTES) {
    const m = route.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.params.forEach((p, i) => (params[p] = m[i + 1]));

    let page = 1;
    const raw = new URLSearchParams(search).get("page");
    if (raw !== null && route.paging) {
      const n = Number(raw);
      if (!Number.isInteger(n)) return { ok: false, status: 400, code: "bad_request", reason: "page must be an integer" };
      page = Math.max(1, n); // page=0 upstream quirk → treat as 1
      const cap = route.paging.maxPages;
      if (cap !== null && page > cap) return { ok: false, status: 404, code: "not_found", reason: `page > maxPages (${cap})` };
    }
    // Canonical key: path + page (≥2 only). Every other query param (pretty, id, junk) is dropped.
    const cacheKey = page > 1 ? `${path}?page=${page}` : path;
    return { ok: true, route, params, page, cacheKey };
  }
  return { ok: false, status: 404, code: "not_found", reason: "no such BTD6 route (or invalid parameter value)" };
}

// ─────────────────────────────── cache policy

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** NK's own CDN holds every object for 300 s; refreshing faster than this cannot return newer data. */
export const ORIGIN_MAX_AGE_MS = 5 * MIN;
/** Leaderboards are re-snapshotted once after this grace period, then frozen (assumption: cheater cleanup). */
export const LEADERBOARD_FREEZE_GRACE_MS = DAY;
/** Negative-cache TTL for "no such ID" errors. */
export const NOT_FOUND_TTL_MS = HOUR;

export interface EventTiming { start: number; end: number }

export interface CachePolicy {
  /** Serve without revalidating while age < freshMs. */
  freshMs: number;
  /** After fresh, serve stale + revalidate in background while age < freshMs + staleMs. */
  staleMs: number;
  /** Immutable: archive permanently, serve with `max-age=31536000, immutable`. */
  frozen: boolean;
  /** Event hasn't started: answer "No Scores Available" locally until `start`, don't hit the origin. */
  notStartedUntil?: number;
  /**
   * A cached copy fetched before this time is outdated whatever its age (it predates the event's end or
   * the freeze): it's refetched in the foreground (the old copy is still served if that fails). Without
   * this, a copy fetched while the event was live would be served as final, even frozen as immutable.
   */
  validFrom?: number;
}

const BASE: Record<CacheClass, CachePolicy> = {
  static:        { freshMs: 7 * DAY, staleMs: 365 * DAY, frozen: false },
  list:          { freshMs: ORIGIN_MAX_AGE_MS, staleMs: 30 * DAY, frozen: false },
  feed:          { freshMs: ORIGIN_MAX_AGE_MS, staleMs: 7 * DAY, frozen: false },
  "event-doc":   { freshMs: HOUR, staleMs: 30 * DAY, frozen: false },
  leaderboard:   { freshMs: ORIGIN_MAX_AGE_MS, staleMs: DAY, frozen: false },
  "ugc-doc":     { freshMs: HOUR, staleMs: 30 * DAY, frozen: false },
  profile:       { freshMs: 15 * MIN, staleMs: 30 * DAY, frozen: false },
  image:         { freshMs: 30 * DAY, staleMs: 365 * DAY, frozen: false },
  private:       { freshMs: 0, staleMs: 0, frozen: false },
};

const FROZEN: CachePolicy = { freshMs: 365 * DAY, staleMs: 0, frozen: true };
/** Live leaderboards: fresh for NK's CDN lifetime, then stale-while-revalidate for one more. */
export const LIVE_LEADERBOARD: CachePolicy = { freshMs: ORIGIN_MAX_AGE_MS, staleMs: ORIGIN_MAX_AGE_MS, frozen: false };

/**
 * Cache policy for a route at time `now`. Event-scoped routes need the event's timing (from the cached
 * list endpoints, or the archive for events that have aged out of the lists); without it they fall back
 * to the class default, which is always safe.
 */
export function policyFor(route: RouteDef, timing: EventTiming | undefined, now: number): CachePolicy {
  const base = BASE[route.cache];
  if (!route.event || !timing) return base;

  if (route.cache === "event-doc") {
    // Event documents never change after publication; freeze once the event is over.
    return now >= timing.end ? FROZEN : base;
  }
  if (route.cache === "leaderboard") {
    if (now < timing.start) return { ...base, notStartedUntil: timing.start };
    // Frozen: the one re-snapshot must be taken after the grace period (cheater cleanup).
    if (now >= timing.end + LEADERBOARD_FREEZE_GRACE_MS) return { ...FROZEN, validFrom: timing.end + LEADERBOARD_FREEZE_GRACE_MS };
    // Grace period: final scores, but only from copies fetched after the end (+ NK's own CDN lifetime).
    if (now >= timing.end) return { freshMs: HOUR, staleMs: DAY, frozen: false, validFrom: timing.end + ORIGIN_MAX_AGE_MS };
    // Live: scores move all the time. Serve stale-while-revalidate only briefly, so a board nobody opened
    // for hours (e.g. a CT group page) isn't shown hours behind the boards the cron keeps current. Same
    // number of origin fetches either way (one per stale view); only the first view after a gap waits.
    return LIVE_LEADERBOARD;
  }
  return base;
}

/** Browser-facing Cache-Control for a response with the given policy and current age. */
export function browserCacheControl(p: CachePolicy, ageMs = 0): string {
  if (p.frozen) return "public, max-age=31536000, immutable";
  if (p.freshMs === 0) return "no-store";
  const maxAge = Math.max(0, Math.floor((p.freshMs - ageMs) / 1000));
  return `public, max-age=${maxAge}, stale-while-revalidate=${Math.floor(p.staleMs / 1000)}`;
}

/** Negative-cache TTL for an upstream error envelope, or 0 to not cache it. */
export function errorTtlMs(error: string, p: CachePolicy, now: number): number {
  if (error === "No Scores Available") {
    return p.notStartedUntil ? Math.max(0, p.notStartedUntil - now) : ORIGIN_MAX_AGE_MS;
  }
  if (/^No .* with that ID exists$|^Invalid user ID|^Invalid map ID$|^No Group Available$/.test(error)) return NOT_FOUND_TTL_MS;
  return 0;
}
