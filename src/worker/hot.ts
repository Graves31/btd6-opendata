// Cron (every minute): keep the hot set current and publish it to KV.
//
// Hot set = the 5 list endpoints + today's daily challenge + everything for the "featured" event of each
// kind (live, or ended within the leaderboard grace period): ≤ 28 keys.
//
// Budgets (free plan):
//  - CPU (10 ms): the working state is split (migrations/0004): a small index row (`hot_state.meta`) is read
//    and written each run; bodies are one row per key in `hot_entries`, written only when NK sends a new
//    one and read only to publish. What the cron needs from a body (event timings, daily ids, leaderboard
//    profiles) is derived once when it arrives and kept in the index. No run parses or stringifies the
//    ~160 KB bundle; publishing splices stored body texts (store.ts buildHotText).
//  - NK: a key is re-requested once NK's own CDN copy has expired (max-age − Age), and no sooner than its
//    class's floor (MIN_REFETCH_MS): rules, maps and challenge documents don't change during an event, so
//    they're asked hourly (daily challenge: every 15 min, for its win rate) instead of every few minutes.
//  - D1 (100k row writes/day): 1 index row per run that contacted NK + 1 row per changed body.
//  - KV (1k writes/day): published at most every PUBLISH_MIN_INTERVAL_MS when something changed
//    (≤ 720/day), plus a heartbeat every HEARTBEAT_MS so the proxy can tell the cron is alive.

import { LEADERBOARD_FREEZE_GRACE_MS, matchRoute, ORIGIN_MAX_AGE_MS, type CacheClass, type EventKind } from "../nk/routes.ts";
import type { Deps } from "./deps.ts";
import { eventKeys, LIST_PATH, upsertEventStmts, type ListItem } from "./events.ts";
import { buildHotText, HOT_KEY, mem, setHotMemo, type HotMeta, type HotMetaEntry } from "./store.ts";
import { originCooldownS } from "./limit.ts";
import { detectNew, flushOutbox, markUnsent, noteStmts, outboxMayHaveUnsent, resetNotifyState, watchedKinds, type Note } from "./notify.ts";
import { fetchUpstream, mapLimit } from "./upstream.ts";
import { profileKeysOf, warmProfiles } from "./warm.ts";

const KINDS: EventKind[] = ["race", "boss", "ct", "odyssey"];
const DAILY_FEED = "/btd6/challenges/filter/daily";
const OTHER_LISTS = ["/btd6/events", DAILY_FEED];
const MIN = 60_000;
/** Minimum spacing of KV writes: 1 per 2 min = 720/day, under the free 1,000/day. */
export const PUBLISH_MIN_INTERVAL_MS = 2 * MIN;
/** Publish even without changes this often (must stay below proxy.ts HOT_STALL_MS). */
export const HEARTBEAT_MS = 10 * MIN;
/**
 * Shortest time between two NK requests for a hot key, by cache class; NK's CDN expiry applies on top.
 * Live leaderboards follow NK's CDN period (re-asked within ~1–2 min of it expiring); lists every 5 min;
 * documents that don't change during an event hourly.
 */
export const MIN_REFETCH_MS: Partial<Record<CacheClass, number>> = {
  list: 5 * MIN, // event lists: featured events switch on their start/end times, known in advance
  feed: 5 * MIN, // the daily challenge feed
  "event-doc": 60 * MIN, // rules, odyssey islands & maps, CT tiles
  "ugc-doc": 15 * MIN, // the daily challenge document (its win rate moves during the day)
};
/** A featured event that has ended: its boards are final once fetched after end + NK's CDN period. */
const ENDED_REFETCH_MS = 60 * MIN;
/** The profile warmer runs only on minutes that fetched at most this many hot keys (CPU per invocation). */
const WARM_MAX_FETCHED = 2;
/**
 * NK requests per run for keys we already hold, most overdue first; the rest wait a minute. Each request
 * costs ~0.6 ms of Worker CPU, and keys tend to expire together (a boss's 8 boards, the 6 lists): this
 * spreads them over consecutive minutes. Keys we don't hold yet (first run, a new featured event) are
 * always fetched.
 */
export const REFRESH_CAP = { perRun: 5 };

export interface HotResult {
  published: boolean;
  fetched: number;
  changed: number;
  skipped: number;
  failed: string[];
  /** Due, but left for the next run (REFRESH_CAP). */
  deferred: number;
  featured: HotMeta["featured"];
  /** Profiles warmed this run (warm.ts). */
  warmed?: number;
  /** Set when the run was skipped or only partly persisted (D1/KV failure); logged by the scheduler. */
  error?: string;
}

/** Keys that make up the hot set for a featured event. Odysseys have no leaderboards: hot only while live. */
export function featuredKeys(kind: EventKind, id: string, live: boolean): string[] {
  return kind === "odyssey" && !live ? [] : eventKeys(kind, id);
}

/** Live event, else the most recent one still inside the leaderboard grace window. */
export function pickFeatured(items: Pick<ListItem, "id" | "start" | "end">[], now: number): { id: string; live: boolean; end: number } | null {
  const live = items.find((x) => x.start <= now && now < x.end);
  if (live) return { id: live.id, live: true, end: live.end };
  const recent = items
    .filter((x) => x.end <= now && now < x.end + LEADERBOARD_FREEZE_GRACE_MS)
    .sort((a, b) => b.end - a.end)[0];
  return recent ? { id: recent.id, live: false, end: recent.end } : null;
}

/** 32-bit FNV-1a of a string: tells whether a list item changed since the last copy. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** What the cron needs from a body, kept in the index so it never has to read the body again. */
export function derive(key: string, data: Record<string, unknown>): HotMetaEntry["d"] {
  const body = data.body;
  if (!Array.isArray(body)) return undefined;
  if ((Object.values(LIST_PATH) as string[]).includes(key)) {
    return {
      t: (body as ListItem[]).filter((x) => typeof x?.id === "string").map((x) => [x.id, x.start, x.end, fnv1a(JSON.stringify(x))]),
    };
  }
  if (key === DAILY_FEED) return { ids: (body as { id?: unknown }[]).flatMap((c) => (typeof c?.id === "string" ? [c.id] : [])) };
  if (key.includes("/leaderboard/") && !key.includes("?page=")) {
    const p: string[] = [];
    for (const r of body as { profile?: unknown }[]) {
      const m = typeof r?.profile === "string" ? /\/btd6\/(users|guild)\/([0-9a-f]{48})$/.exec(r.profile) : null;
      if (m) p.push(`/btd6/${m[1]}/${m[2]}`);
    }
    return { p };
  }
  return undefined;
}

interface HotState {
  meta: HotMeta | null;
  /** The JSON text `meta` was parsed from / serialised to. */
  text: string | null;
  publishedAt: number;
  dirty: boolean;
}

/**
 * This isolate's state after its last run. `saved: false` means the D1 write failed, so it is newer than
 * D1 and wins; otherwise D1 is authoritative (another isolate may have run since).
 */
let stateMemo: (HotState & { saved: boolean }) | null = null;
/**
 * Body texts this isolate has written or read, by key: an isolate that runs the cron again publishes without
 * reading them back from D1. Entries are checked against the index's fetch time before use.
 */
const bodyMemo = new Map<string, { f: number; body: string }>();
/** Bodies whose D1 write failed: written again with the next run's batch (before anything reads them). */
const unsavedBodies = new Map<string, string>();
/** Notifications whose outbox insert was lost with a failed batch (idempotent: INSERT OR IGNORE). */
const unsavedNotes = new Map<string, Note>();

export function resetHotState(): void {
  stateMemo = null;
  bodyMemo.clear();
  unsavedBodies.clear();
  unsavedNotes.clear();
  resetNotifyState();
}

/** null = state unknown (D1 unreadable and nothing in memory). */
async function loadState(deps: Deps): Promise<HotState | null> {
  if (stateMemo && !stateMemo.saved) return stateMemo;
  let row: { meta: string | null; published_at: number; dirty: number } | null;
  try {
    row = await deps.db
      .prepare("SELECT meta, published_at, dirty FROM hot_state WHERE id = 1")
      .first<{ meta: string | null; published_at: number; dirty: number }>();
  } catch (err) {
    console.warn("hot: D1 state read failed", String(err));
    return stateMemo;
  }
  if (!row) return { meta: null, text: null, publishedAt: 0, dirty: true };
  let meta: HotMeta | null = null;
  if (stateMemo && stateMemo.text === row.meta) meta = stateMemo.meta;
  else if (row.meta) {
    try {
      meta = JSON.parse(row.meta) as HotMeta;
    } catch {
      meta = null; // corrupt: rebuilt from scratch this run
    }
  }
  // A state row from before the split (meta NULL): start over; the first run fetches every key once.
  return { meta, text: row.meta, publishedAt: row.published_at, dirty: row.dirty === 1 || !meta };
}

export async function refreshHot(deps: Deps): Promise<HotResult> {
  const now = deps.now();
  const result: HotResult = {
    published: false,
    fetched: 0,
    changed: 0,
    skipped: 0,
    failed: [],
    deferred: 0,
    featured: { race: null, boss: null, ct: null, odyssey: null },
  };
  const state = await loadState(deps);
  if (!state) {
    // Without the last publish time we can't honour the KV write budget; D1 will be back next minute.
    result.error = "hot_state unreadable: run skipped";
    return result;
  }
  const prev = state.meta?.entries ?? {};

  const next: Record<string, HotMetaEntry> = {};
  /** New bodies this run: written to D1, and the list payloads (for the permanent `events` table). */
  const changedBodies = new Map<string, { body: string; data: Record<string, unknown> }>();

  /** When `key` is next due: NK's CDN expiry, and not before its class floor. */
  const dueAt = (key: string, floorMs: number): number => {
    const old = prev[key];
    if (!old) return -Infinity;
    const route = matchRoute(key);
    const classFloor = route.ok ? (MIN_REFETCH_MS[route.route.cache] ?? 0) : 0;
    // Error envelopes (e.g. rules not published yet) get no floor: asked again once NK's copy expires.
    return Math.max(old.x, old.ok ? old.f + Math.max(classFloor, floorMs) : 0);
  };
  let budget = REFRESH_CAP.perRun;
  /** The keys to ask NK for now, most overdue first; the others keep their last copy. */
  const plan = (items: { key: string; floor: number }[]): string[] => {
    const todo: string[] = [];
    const due = items.map((it) => ({ key: it.key, at: dueAt(it.key, it.floor) })).sort((a, b) => a.at - b.at);
    for (const { key, at } of due) {
      const old = prev[key];
      if (old && now < at) {
        next[key] = old; // NK's CDN would hand back the same object
        result.skipped++;
      } else if (old && budget <= 0) {
        next[key] = old; // next minute
        result.deferred++;
      } else {
        if (old) budget--;
        todo.push(key);
      }
    }
    return todo;
  };

  const pull = async (key: string) => {
    const old = prev[key];
    if (originCooldownS(deps.now())) {
      // NK rate-limited us recently: keep the last copy, ask again after the cooldown.
      result.failed.push(key);
      if (old) next[key] = old;
      return;
    }
    try {
      // `old` only supplies the ETag: on 304 nothing but the index entry changes.
      const e = await fetchUpstream(deps, key, old ? { key, body: "", ok: old.ok, etag: old.e, fetchedAt: old.f, frozen: false } : null);
      result.fetched++;
      const x = e.upstreamExpiresAt ?? now + MIN;
      if (e.notModified && old) {
        next[key] = { ...old, f: e.fetchedAt, x };
        const known = bodyMemo.get(key);
        if (known?.f === old.f) bodyMemo.set(key, { f: e.fetchedAt, body: known.body });
        return;
      }
      const data = e.data ?? (JSON.parse(e.body) as Record<string, unknown>);
      const known = bodyMemo.get(key);
      if (!old || !known || known.f !== old.f || known.body !== e.body) {
        result.changed++;
        changedBodies.set(key, { body: e.body, data });
      }
      next[key] = { f: e.fetchedAt, x, e: e.etag, ok: e.ok, d: e.ok ? derive(key, data) : undefined };
      bodyMemo.set(key, { f: e.fetchedAt, body: e.body });
      mem.set({ key, body: e.body, ok: e.ok, etag: e.etag, fetchedAt: e.fetchedAt, frozen: false, hot: true });
    } catch {
      result.failed.push(key);
      if (old) next[key] = old; // keep the last good copy
    }
  };

  // 1. Lists (they decide what else is hot).
  await mapLimit(plan([...KINDS.map((k) => LIST_PATH[k]), ...OTHER_LISTS].map((key) => ({ key, floor: 0 }))), 6, pull);

  // 2. Remember every event ever seen (NK drops old ones); pick the featured event per kind.
  const stmts = [];
  const hot: { key: string; floor: number }[] = [];
  const watched = watchedKinds(deps);
  const fresh: Partial<Record<EventKind, ListItem[]>> = {};
  for (const kind of KINDS) {
    const list = changedBodies.get(LIST_PATH[kind]);
    if (list && Array.isArray(list.data.body)) {
      // Only items that are new or changed since the last copy (usually just the live event's totals).
      const before = new Map((prev[LIST_PATH[kind]]?.d?.t ?? []).map((x) => [x[0], x[3]]));
      const hashes = new Map((next[LIST_PATH[kind]]?.d?.t ?? []).map((x) => [x[0], x[3]]));
      const items = (list.data.body as ListItem[]).filter((x) => before.get(x.id) === undefined || before.get(x.id) !== hashes.get(x.id));
      if (items.length) stmts.push(...upsertEventStmts(deps.db, kind, items));
      // Not in the previous copy: maybe new (a cold start has no previous copy), decided against `events` below.
      if (watched.has(kind)) fresh[kind] = items.filter((x) => before.get(x.id) === undefined);
    }
    const t = next[LIST_PATH[kind]]?.d?.t ?? [];
    const f = pickFeatured(t.map(([id, start, end]) => ({ id, start, end })), now);
    result.featured[kind] = f?.id ?? null;
    if (!f) continue;
    // An ended event's boards are final once fetched after its end + NK's CDN period: hourly from then on.
    for (const key of featuredKeys(kind, f.id, f.live)) {
      const final = !f.live && (prev[key]?.f ?? 0) >= f.end + ORIGIN_MAX_AGE_MS;
      hot.push({ key, floor: final ? ENDED_REFETCH_MS : 0 });
    }
  }

  // New events → notification outbox rows, decided before the upsert makes them "known" (notify.ts).
  const notes = await detectNew(deps, fresh, now);
  for (const n of notes) unsavedNotes.set(n.key, n);
  if (unsavedNotes.size) stmts.push(...noteStmts(deps.db, [...unsavedNotes.values()], now));

  // 3. Today's daily challenge document.
  // The feed lists tomorrow's dailies early: take the newest whose date (rot/adv<N><YYYYMMDD>) has started.
  const started = (id: string) => {
    const m = /(\d{4})(\d{2})(\d{2})$/.exec(/^(rot|adv)\d+\d{8}$/.test(id) ? id : "");
    return !m || Date.UTC(+m[1], +m[2] - 1, +m[3]) <= now;
  };
  const dailyFirst = (next[DAILY_FEED]?.d?.ids ?? []).find(started);
  if (dailyFirst) hot.push({ key: `/btd6/challenges/challenge/${dailyFirst}`, floor: 0 });

  // 4. Featured event data.
  await mapLimit(plan(hot), 6, pull);

  // 5. A few leaderboard profiles, so the most-viewed ones are cached before anyone asks (warm.ts). Once
  //    all are warm, nothing is due until the oldest goes stale: skip the D1 lookup until then. Only on
  //    minutes that asked NK for little else, so its CPU never lands on a busy run.
  const profiles = profileKeysOf(next);
  const sig = `${profiles.length}:${profiles[0] ?? ""}:${profiles.at(-1) ?? ""}`;
  let warm = state.meta?.warm && state.meta.warm.sig === sig && now < state.meta.warm.until ? state.meta.warm : undefined;
  if (warm || result.fetched > WARM_MAX_FETCHED) {
    result.warmed = 0;
    warm ??= state.meta?.warm;
  } else {
    try {
      const w = await warmProfiles(deps, profiles, now);
      result.warmed = w.warmed;
      if (w.idleUntil !== null) warm = { sig, until: w.idleUntil };
    } catch (err) {
      result.error = [result.error, `warm failed: ${String(err)}`].filter(Boolean).join("; ");
    }
  }

  const prevKeys = Object.keys(prev);
  const setChanged =
    !state.meta ||
    prevKeys.length !== Object.keys(next).length ||
    prevKeys.some((k) => !(k in next)) ||
    JSON.stringify(state.meta.featured) !== JSON.stringify(result.featured);
  let dirty = state.dirty || setChanged || result.changed > 0;

  const sincePublish = now - state.publishedAt;
  let publish = (dirty && sincePublish >= PUBLISH_MIN_INTERVAL_MS) || sincePublish >= HEARTBEAT_MS;

  // Publishing: every body, from this isolate's memory where it holds the current one, else one D1 read.
  let text: string | null = null;
  if (publish) {
    const bodies = new Map<string, string>();
    const missing: string[] = [];
    for (const [key, m] of Object.entries(next)) {
      const known = bodyMemo.get(key);
      if (known && known.f === m.f) bodies.set(key, known.body);
      else missing.push(key);
    }
    let readFailed = false;
    if (missing.length) {
      try {
        const { results } = await deps.db
          .prepare(`SELECT key, body FROM hot_entries WHERE key IN (${missing.map(() => "?").join(",")})`)
          .bind(...missing)
          .all<{ key: string; body: string }>();
        for (const r of results) {
          bodies.set(r.key, r.body);
          bodyMemo.set(r.key, { f: next[r.key].f, body: r.body });
        }
      } catch (err) {
        readFailed = true;
        result.error = [result.error, `D1 body read failed: ${String(err)}`].filter(Boolean).join("; ");
      }
    }
    if (readFailed) {
      publish = false; // D1 unreadable: don't publish a partial bundle; stay dirty and retry next minute
      dirty = true;
    } else {
      // A body D1 doesn't have (its write was lost): drop the key so the next run fetches it again.
      for (const key of missing) if (!bodies.has(key)) delete next[key];
      text = buildHotText(
        now,
        result.featured,
        Object.entries(next).map(([key, m]) => ({ key, fetchedAt: m.f, etag: m.e, ok: m.ok, body: bodies.get(key)! })),
      );
    }
  }

  const meta: HotMeta = { v: 2, generatedAt: publish ? now : (state.meta?.generatedAt ?? now), featured: result.featured, entries: next, warm };
  if (publish && text !== null) {
    try {
      await deps.kv.put(HOT_KEY, text);
      result.published = true;
    } catch (err) {
      // KV write quota spent or transient error: stay dirty so the next run retries.
      result.error = [result.error, `KV put failed: ${String(err)}`].filter(Boolean).join("; ");
    }
    setHotMemo(text, now); // this isolate serves the new bundle either way
  }
  const published = result.published;
  const nextState: HotState = {
    meta,
    text: null,
    publishedAt: published ? now : state.publishedAt,
    dirty: published ? false : dirty,
  };
  // `behind`: last run's D1 write failed, so D1 must be brought up to date even if nothing changed.
  const behind = state === stateMemo && !stateMemo.saved;
  const warmChanged = JSON.stringify(warm) !== JSON.stringify(state.meta?.warm);
  const writeState = behind || published || result.fetched > 0 || setChanged || warmChanged || nextState.dirty !== state.dirty;
  nextState.text = writeState ? JSON.stringify(meta) : state.text;

  const toWrite = new Map(unsavedBodies);
  for (const [key, b] of changedBodies) toWrite.set(key, b.body);
  for (const [key, body] of toWrite) {
    if (!(key in next)) continue;
    stmts.push(deps.db.prepare("INSERT INTO hot_entries (key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body").bind(key, body));
  }
  if (setChanged && state.meta) {
    const keep = Object.keys(next);
    stmts.push(deps.db.prepare(`DELETE FROM hot_entries WHERE key NOT IN (${keep.map(() => "?").join(",")})`).bind(...keep));
    for (const k of bodyMemo.keys()) if (!(k in next)) bodyMemo.delete(k);
  }
  if (writeState) {
    stmts.push(
      deps.db
        .prepare(
          `INSERT INTO hot_state (id, bundle, published_at, dirty, meta) VALUES (1, '', ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET bundle = '', published_at = excluded.published_at,
             dirty = excluded.dirty, meta = excluded.meta`,
        )
        .bind(nextState.publishedAt, nextState.dirty ? 1 : 0, nextState.text),
    );
  }
  let saved = true;
  if (stmts.length) {
    try {
      await deps.db.batch(stmts);
      unsavedBodies.clear();
      if (unsavedNotes.size) markUnsent();
      unsavedNotes.clear();
    } catch (err) {
      for (const [key, body] of toWrite) if (key in next) unsavedBodies.set(key, body);
      // Keep the new state in this isolate (fetch expiries, publish time, bodies) so the next run neither
      // re-asks NK for everything nor re-publishes to KV; it retries the write.
      saved = false;
      result.error = [result.error, `D1 write failed: ${String(err)}`].filter(Boolean).join("; ");
    }
  }
  stateMemo = { ...nextState, saved };
  if (outboxMayHaveUnsent(deps)) deps.waitUntil(flushOutbox(deps));
  return result;
}
