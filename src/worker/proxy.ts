// The cached mirror of data.ninjakiwi.com.
//
//   GET /api/nk/<btd6 path>[?page=N]      one key
//   GET /api/batch?k=<key>&k=<key>…      up to MAX_BATCH keys in ONE Worker invocation, streamed as NDJSON
//                                        in completion order (cache hits first, origin misses as they land)
//
// Lookup order: isolate memory → KV hot bundle → D1 → origin. Anything found is served immediately;
// stale-but-usable entries are refreshed in the background (stale-while-revalidate); frozen entries are
// immutable. If the origin fails (or the client's origin budget is spent, limit.ts), any cached copy is
// served (stale-if-error).
//
// Degradation: KV and D1 failures (daily quota exhausted, transient errors) never fail a request. A failed
// read is treated as a miss, a failed write is skipped; the origin still answers.

import {
  browserCacheControl,
  errorTtlMs,
  matchRoute,
  policyFor,
  type CachePolicy,
} from "../nk/routes.ts";
import type { Deps } from "./deps.ts";
import { errorBody } from "./errors.ts";
import { CT_API, ctApi } from "./ct.ts";
import { getTiming } from "./events.ts";
import { OriginGate, originCooldownS, RateLimited } from "./limit.ts";
import { d1FreezeStmt, d1Get, d1PutStmt, getHot, hotEntry, mem } from "./store.ts";
import { GUILD_ID, teamHistory, teamIndexStmts, teamKeyKind } from "./teams.ts";
import { fetchUpstream, mapLimit, UpstreamError, type Entry } from "./upstream.ts";

type Source = "MEM" | "HOT" | "D1" | "ORIGIN";
type Found = { entry: Entry; source: Source } | null;
interface Lookup {
  found: Map<string, Found>;
  /** D1 couldn't be read: a miss may be a false miss (the row may exist, possibly frozen). */
  degraded: boolean;
}

/** Hot-bundle entries are refreshed by the per-minute cron; the proxy only steps in if the cron stalls. */
const HOT_STALL_MS = 15 * 60_000;
/** Cap on the max-age of a synthetic "not started yet" answer, in case NK reschedules. */
const NOT_STARTED_MAX_AGE_MS = 60 * 60_000;
/** Keys per batch: each key costs at most one origin fetch, well under the 50-subrequest cap. */
export const MAX_BATCH = 20;
/** Longest accepted batch key (the longest real key, a CT group leaderboard page, is < 100 chars). */
export const MAX_KEY_LENGTH = 256;
const YEAR_S = 31_536_000;

const NO_SCORES = JSON.stringify({ error: "No Scores Available", success: false });

const inflight = new Map<string, Promise<Entry>>();

/** Everything needed to answer one key, as a single response or as one batch line. */
export interface Resolved {
  status: number;
  body: string;
  cacheControl: string;
  /** Seconds the client may treat this as fresh (0 = revalidate soon). For a 429: seconds to wait. */
  maxAgeS: number;
  frozen: boolean;
  cache: string;
  entry?: Entry;
  retryAfterS?: number;
}

export async function resolveKey(
  deps: Deps,
  gate: OriginGate,
  upstreamPath: string,
  search: string,
  pre?: Lookup,
): Promise<Resolved> {
  const m = matchRoute(upstreamPath, search);
  if (!m.ok) return plain(m.status, errorBody(m.code), 3600, "REJECTED");

  const { route, params, cacheKey } = m;
  const now = deps.now();
  const timing = route.event ? await getTiming(deps, route.event.kind, params[route.event.idParam]) : undefined;
  const policy = policyFor(route, timing, now, params);

  // Upcoming event: the leaderboard is known to be empty until `start`; don't ask the origin.
  if (policy.notStartedUntil) {
    const maxAge = Math.floor(Math.min(policy.notStartedUntil - now, NOT_STARTED_MAX_AGE_MS) / 1000);
    return plain(200, NO_SCORES, maxAge, "SYNTHETIC");
  }

  const looked = pre?.found.has(cacheKey) ? pre : await lookupMany(deps, [cacheKey]);
  const found = looked.found.get(cacheKey) ?? null;
  if (found) {
    const { entry, source } = found;
    const age = now - entry.fetchedAt;
    const eff = effectivePolicy(entry, policy, source, now);
    // Fetched before the event's end / freeze point: outdated whatever its age (routes.ts validFrom).
    const outdated = !entry.frozen && policy.validFrom !== undefined && entry.fetchedAt < policy.validFrom;
    if (entry.frozen || (!outdated && age < eff.freshMs)) return fromEntry(entry, eff, source, age);
    if (!outdated && age < eff.freshMs + eff.staleMs) {
      if (gate.admitBackground()) deps.waitUntil(revalidate(deps, cacheKey, entry, source, policy).catch(() => {}));
      return fromEntry(entry, eff, source, age, "STALE");
    }
    // Too old to serve blindly: try the origin, fall back to the old copy on failure or when refused.
    try {
      const fresh = await refresh(deps, cacheKey, entry, policy, false, () => gate.admit());
      return fromEntry(fresh, effectivePolicy(fresh, policy, "ORIGIN", now), "ORIGIN", 0);
    } catch {
      return fromEntry(entry, eff, source, age, "STALE-IF-ERROR");
    }
  }

  try {
    const fresh = await refresh(deps, cacheKey, null, policy, looked.degraded, () => gate.admit());
    return fromEntry(fresh, effectivePolicy(fresh, policy, "ORIGIN", now), "ORIGIN", 0);
  } catch (err) {
    if (err instanceof RateLimited) return limited(err.retryAfterS);
    if (err instanceof UpstreamError && err.status === 429) return limited(Math.max(1, originCooldownS(deps.now())));
    const status = err instanceof UpstreamError ? err.status : 502;
    return { ...plain(status, errorBody("upstream"), 0, "ERROR"), cacheControl: "no-store" };
  }
}

// ─────────────────────────────── single key

export async function handleNk(
  deps: Deps,
  gate: OriginGate,
  upstreamPath: string,
  search: string,
  request: Request,
): Promise<Response> {
  const m = matchRoute(upstreamPath, search);
  if (m.ok && m.route.cache === "image") {
    return passthroughImage(deps, gate, m.cacheKey, policyFor(m.route, undefined, deps.now()));
  }
  const r = await resolveKey(deps, gate, upstreamPath, search);
  const headers: Record<string, string> = { "X-Cache": r.cache };
  if (r.retryAfterS) headers["Retry-After"] = String(r.retryAfterS);
  if (r.entry) {
    const etag = r.entry.etag ?? `W/"${r.entry.fetchedAt.toString(36)}-${r.entry.body.length.toString(36)}"`;
    headers.ETag = etag;
    headers["X-Fetched-At"] = new Date(r.entry.fetchedAt).toISOString();
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ...headers, "Cache-Control": r.cacheControl } });
    }
  }
  if (r.frozen) headers["X-Frozen"] = "1";
  return jsonResponse(r.body, r.status, r.cacheControl, headers);
}

// ─────────────────────────────── batch

/** Parse and validate the `k` parameters: 1–MAX_BATCH distinct keys, each an upstream `/btd6/…` path. */
export function parseBatchKeys(url: URL): string[] | string {
  const requested = [...new Set(url.searchParams.getAll("k"))];
  if (requested.length === 0 || requested.length > MAX_BATCH) return `pass 1–${MAX_BATCH} distinct k= parameters`;
  return requested;
}

/**
 * One NDJSON line per requested key, in completion order:
 *   {"k":<key as requested>,"s":<status>,"a":<fresh seconds>,"f":<0|1 frozen>,"t":<fetchedAt|null>,"c":<cache>,"b":<body>}
 * `b` is the (model-stripped) NK envelope, spliced in as raw JSON text: no re-serialisation.
 * A key refused by the origin budget gets s=429, c="LIMITED" and `a` = seconds to wait before retrying.
 */
/** Team CT history keys ride in batches too (D1 only, never NK): one Worker request per page, not per team row. */
const TEAM_HISTORY = /^\/api\/history\/team\/([^/?]+)$/;

async function teamHistoryLine(deps: Deps, guildId: string): Promise<Resolved> {
  if (!GUILD_ID.test(guildId)) return plain(404, errorBody("not_found"), 3600, "REJECTED");
  try {
    return { ...plain(200, JSON.stringify(await teamHistory(deps.db, guildId)), 300, "D1"), entry: { fetchedAt: deps.now() } as Entry };
  } catch (err) {
    console.warn("batch: team history D1 read failed", String(err));
    return { ...plain(503, errorBody("unavailable"), 60, "ERROR"), cacheControl: "no-store" };
  }
}

async function ctLine(deps: Deps, path: string): Promise<Resolved> {
  const r = (await ctApi(deps, path))!;
  if (r.status !== 200) return { ...plain(503, errorBody("unavailable"), 60, "ERROR"), cacheControl: "no-store" };
  return { ...plain(200, r.body, r.maxAgeS, "D1"), entry: { fetchedAt: deps.now() } as Entry };
}

export async function handleBatch(deps: Deps, gate: OriginGate, keys: string[]): Promise<Response> {
  const items = keys.map((k) => {
    const team = TEAM_HISTORY.exec(k);
    if (team) return { k, bad: false as const, team: team[1], path: k, search: "", image: false, key: null };
    if (CT_API.test(k)) return { k, bad: false as const, ct: true, path: k, search: "", image: false, key: null };
    if (k.length > MAX_KEY_LENGTH || !k.startsWith("/btd6/")) return { k, bad: true as const };
    const q = k.indexOf("?");
    const path = q < 0 ? k : k.slice(0, q);
    const search = q < 0 ? "" : k.slice(q);
    const m = matchRoute(path, search);
    const image = m.ok && m.route.cache === "image";
    return { k, bad: false as const, path, search, image, key: m.ok && !image ? m.cacheKey : null };
  });
  const pre = await lookupMany(deps, items.flatMap((i) => (!i.bad && i.key ? [i.key] : [])));

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let open = true;
  const work = mapLimit(items, 6, async (it) => {
    let r: Resolved;
    try {
      r = it.bad
        ? plain(400, errorBody("bad_request"), 3600, "REJECTED") // not a /btd6/ path of ≤ MAX_KEY_LENGTH chars
        : "ct" in it && it.ct
          ? await ctLine(deps, it.path)
          : "team" in it && it.team
          ? await teamHistoryLine(deps, it.team)
          : it.image
          ? plain(400, errorBody("bad_request"), 3600, "REJECTED") // images aren't batchable
          : // Invalid keys still go through resolveKey, which answers with the route's own 403/404.
            await resolveKey(deps, gate, it.path, it.search, pre);
    } catch (err) {
      console.error("batch: key failed", it.k, String(err));
      r = { ...plain(502, errorBody("internal"), 0, "ERROR"), cacheControl: "no-store" };
    }
    if (!open) return;
    const head = JSON.stringify({ k: it.k, s: r.status, a: r.maxAgeS, f: r.frozen ? 1 : 0, t: r.entry?.fetchedAt ?? null, c: r.cache });
    try {
      await writer.write(enc.encode(`${head.slice(0, -1)},"b":${r.body}}\n`));
    } catch {
      open = false; // client went away: finish the in-flight work (it fills the caches), stop writing
    }
  })
    .catch((err) => console.error("batch failed", String(err)))
    .finally(() => writer.close().catch(() => {}));
  deps.waitUntil(work);

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// ─────────────────────────────── lookup

/**
 * Memory and the hot bundle first, then ONE D1 query for everything still missing. A hot-bundle entry wins
 * over an older copy in memory (the cron keeps refreshing it). Never throws: a D1 failure is a miss.
 */
async function lookupMany(deps: Deps, keys: string[]): Promise<Lookup> {
  const found = new Map<string, Found>();
  const hot = await getHot(deps);
  const rest: string[] = [];
  for (const key of keys) {
    const m = mem.get(key);
    // A substring of the bundle text (store.ts): no parse, no re-serialisation.
    const h = hot ? hotEntry(hot, key) : undefined;
    if (h && (!m || h.fetchedAt > m.fetchedAt)) {
      const entry = h;
      mem.set(entry);
      found.set(key, { entry, source: "HOT" });
    } else if (m) {
      found.set(key, { entry: m, source: "MEM" });
    } else {
      rest.push(key);
    }
  }
  let degraded = false;
  if (rest.length) {
    try {
      const { results } = await deps.db
        .prepare(`SELECT key, body, ok, etag, fetched_at, frozen FROM responses WHERE key IN (${rest.map(() => "?").join(",")})`)
        .bind(...rest)
        .all<{ key: string; body: string; ok: number; etag: string | null; fetched_at: number; frozen: number }>();
      for (const r of results) {
        const entry: Entry = { key: r.key, body: r.body, ok: r.ok === 1, etag: r.etag, fetchedAt: r.fetched_at, frozen: r.frozen === 1 };
        mem.set(entry);
        found.set(r.key, { entry, source: "D1" });
      }
    } catch (err) {
      console.warn("lookup: D1 read failed", String(err));
      degraded = true;
    }
    for (const key of rest) if (!found.has(key)) found.set(key, null);
  }
  return { found, degraded };
}

// ─────────────────────────────── policy & refresh

/** Error envelopes get their own (negative-cache) TTL; hot entries tolerate the cron cadence. */
function effectivePolicy(entry: Entry, policy: CachePolicy, source: Source, now: number): CachePolicy {
  if (entry.frozen) return { freshMs: policy.freshMs, staleMs: 0, frozen: true };
  if (!entry.ok) {
    const ttl = errorTtlMs(errorOf(entry), policy, now);
    return { freshMs: ttl, staleMs: 0, frozen: false };
  }
  if (source === "HOT" || entry.hot) return { ...policy, freshMs: Math.max(policy.freshMs, HOT_STALL_MS) };
  return policy;
}

function errorOf(entry: Entry): string {
  try {
    return String((JSON.parse(entry.body) as { error?: unknown }).error ?? "");
  } catch {
    return "";
  }
}

/**
 * Background revalidation of a stale copy. A copy held in isolate memory may be older than D1's (another
 * isolate refreshed it): check D1 first (one row read) before asking the origin.
 */
async function revalidate(deps: Deps, key: string, entry: Entry, source: Source, policy: CachePolicy): Promise<Entry> {
  let prev = entry;
  if (source === "MEM" && !inflight.has(key)) {
    try {
      const row = await d1Get(deps.db, key);
      if (row && row.fetchedAt > entry.fetchedAt) {
        mem.set(row);
        if (row.frozen || deps.now() - row.fetchedAt < policy.freshMs) return row;
        prev = row;
      }
    } catch {
      // D1 unavailable: go to the origin
    }
  }
  return refresh(deps, key, prev, policy, false);
}

/**
 * Fetch from the origin (deduplicated per isolate) and store in memory + D1. `admit` is the origin budget
 * check for a foreground miss; it runs only when a fetch actually starts (joining one in flight is free),
 * and a refused caller never registers in `inflight`, so other clients joining the key aren't refused too.
 * `degraded`: D1 couldn't be read, so we don't know what it holds — don't freeze or remember an error.
 */
async function refresh(
  deps: Deps,
  key: string,
  prev: Entry | null,
  policy: CachePolicy,
  degraded: boolean,
  admit?: () => Promise<void>,
): Promise<Entry> {
  const running = inflight.get(key);
  if (running) return running;
  if (admit) {
    await admit(); // throws RateLimited
    const joined = inflight.get(key); // started by someone else while we waited for the limiter
    if (joined) return joined;
  }
  const p = fetchAndStore(deps, key, prev, policy, degraded).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fetchAndStore(deps: Deps, key: string, prev: Entry | null, policy: CachePolicy, degraded: boolean): Promise<Entry> {
  const got = await fetchUpstream(deps, key, prev);

  // Freezing: never replace good data we already hold with an error from a (possibly purged) event.
  if (policy.frozen && !got.ok && prev?.ok) {
    const frozen: Entry = { ...prev, frozen: true, hot: false, notModified: false };
    mem.set(frozen);
    await d1Write(() => deps.db.batch([d1FreezeStmt(deps.db, key), ...finalTeamIndex(deps, key, prev.body, policy)]));
    return frozen;
  }

  const entry: Entry = { key, body: got.body, ok: got.ok, etag: got.etag, fetchedAt: got.fetchedAt, frozen: policy.frozen };
  if (degraded && !got.ok) return { ...entry, frozen: false }; // the archive may hold real data: serve, don't remember
  mem.set(entry);
  // Negative answers (unknown ids, NK 4xx) stay in isolate memory (mem.set above): a probe must not add a permanent D1 row.
  const cacheable = entry.ok || policy.frozen;
  // One row write either way (a 304 only moves fetched_at, but the row may not exist yet if `prev`
  // came from the hot bundle). A frozen row is never overwritten (d1PutStmt), so this is safe when degraded.
  if (cacheable) {
    const index = entry.ok ? finalTeamIndex(deps, key, entry.body, policy) : [];
    await d1Write(() => (index.length ? deps.db.batch([d1PutStmt(deps.db, entry), ...index]) : d1PutStmt(deps.db, entry).run()));
  }
  return entry;
}

/**
 * CT team history (teams.ts) is built from final data only: team boards once frozen, group pages from the
 * end of the event on (groups aren't archived, and NK drops them a few days after the end).
 */
function finalTeamIndex(deps: Deps, key: string, body: string, policy: CachePolicy) {
  const kind = teamKeyKind(key);
  const final = kind === "team" ? policy.frozen : kind === "group" ? policy.frozen || policy.validFrom !== undefined : false;
  return final ? teamIndexStmts(deps.db, key, body) : [];
}

/** A D1 write that may fail (daily write quota, transient error): the response is served regardless. */
async function d1Write(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn("D1 write skipped", String(err));
  }
}

// ─────────────────────────────── response shaping

function fromEntry(
  entry: Entry,
  policy: CachePolicy,
  source: Source,
  ageMs: number,
  state?: "STALE" | "STALE-IF-ERROR",
): Resolved {
  let maxAgeS: number;
  let cacheControl: string;
  if (state === "STALE-IF-ERROR") {
    maxAgeS = 60;
    cacheControl = "public, max-age=60";
  } else {
    cacheControl = browserCacheControl(policy, ageMs);
    maxAgeS = entry.frozen ? YEAR_S : state === "STALE" ? 0 : Math.max(0, Math.floor((policy.freshMs - ageMs) / 1000));
  }
  return {
    status: 200,
    body: entry.body,
    cacheControl,
    maxAgeS,
    frozen: entry.frozen,
    cache: state ? `${source}-${state}` : source,
    entry,
  };
}

function plain(status: number, body: string, maxAgeS: number, cache: string): Resolved {
  return { status, body, cacheControl: `public, max-age=${maxAgeS}`, maxAgeS, frozen: false, cache };
}

function limited(retryAfterS: number): Resolved {
  const body = errorBody("rate_limited", undefined, { retryAfter: retryAfterS });
  return { status: 429, body, cacheControl: "no-store", maxAgeS: retryAfterS, frozen: false, cache: "LIMITED", retryAfterS };
}

async function passthroughImage(deps: Deps, gate: OriginGate, key: string, policy: CachePolicy): Promise<Response> {
  try {
    await gate.admit();
  } catch (err) {
    const r = limited((err as RateLimited).retryAfterS);
    return jsonResponse(r.body, 429, "no-store", { "Retry-After": String(r.retryAfterS), "X-Cache": "LIMITED" });
  }
  let res: Response;
  try {
    res = await deps.fetch(deps.nkBase + key, { headers: { Accept: "image/*" } });
  } catch {
    return jsonResponse(errorBody("upstream"), 502, "no-store");
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !/^image\/(png|jpeg|webp)\b/.test(ct)) { // never SVG from our own origin
    await res.body?.cancel();
    return res.status >= 500
      ? jsonResponse(errorBody("upstream"), 502, "no-store")
      : jsonResponse(errorBody("not_found", "No preview"), 404, "public, max-age=3600");
  }
  return new Response(res.body, { status: 200, headers: { "Content-Type": ct, "Cache-Control": browserCacheControl(policy) } });
}

export function jsonResponse(
  body: string | null,
  status: number,
  cacheControl: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl, ...extra },
  });
}
