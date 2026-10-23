// Cache layers below the browser: isolate memory → KV hot bundle → D1. See docs/api/README.md §6.

import type { EventKind } from "../nk/routes.ts";
import type { D1Like, Deps } from "./deps.ts";
import type { Entry } from "./upstream.ts";

// ─────────────────────────────── L1: isolate memory (free, dies with the isolate)

export class MemCache {
  private map = new Map<string, Entry>();
  private bytes = 0;
  private maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (e) {
      // refresh LRU position
      this.map.delete(key);
      this.map.set(key, e);
    }
    return e;
  }

  set(e: Entry): void {
    const old = this.map.get(e.key);
    if (old) {
      this.bytes -= old.body.length;
      this.map.delete(e.key);
    }
    this.map.set(e.key, e);
    this.bytes += e.body.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.map.delete(k);
      this.bytes -= v.body.length;
    }
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }
}

/** Per-isolate singleton. 8 MB of the 128 MB isolate budget. */
export const mem = new MemCache(8 * 1024 * 1024);

// ─────────────────────────────── L2: KV hot bundle (written by cron only)

export const HOT_KEY = "hot:v1";
/** KV edge-cache TTL for reads of the hot bundle (seconds; KV minimum is 30). */
const HOT_KV_CACHE_TTL_S = 60;
/** How long an isolate reuses its copy of the bundle. */
const HOT_MEM_TTL_MS = 30_000;

/**
 * The published bundle as the browser parses it (/api/now). Built by `buildHotText` from stored body text:
 *   {"v":2,"ix":"<10-digit offset of index>","generatedAt":…,"featured":{…},
 *    "entries":{"<key>":{"fetchedAt":…,"etag":…,"ok":…,"data":<NK envelope>},…},
 *    "index":{"generatedAt":…,"featured":{…},"keys":{"<key>":[start,length,fetchedAt,ok,etag]}}}
 * The trailing index lets the Worker read one entry as a substring of the text (no parse of ~160 KB, no
 * re-serialisation); the browser ignores it.
 */
export interface HotBundle {
  v: 1 | 2;
  generatedAt: number;
  /** The event per kind that the hot set covers (live, or ended within the leaderboard grace period). */
  featured: Record<EventKind, string | null>;
  entries: Record<string, { fetchedAt: number; etag: string | null; ok: boolean; data: Record<string, unknown> }>;
}

/** Index row: where the entry's `data` text sits in the bundle text, and its metadata. */
type IndexRow = [start: number, length: number, fetchedAt: number, ok: 0 | 1, etag: string | null];

/** A published bundle, read without parsing its entries. */
export interface HotView {
  text: string;
  generatedAt: number;
  featured: Record<EventKind, string | null>;
  keys: Map<string, IndexRow>;
  /** Only for a bundle published before the index existed (v1): entry texts re-serialised once. */
  bodies?: Map<string, string>;
  /** Parsed entry data, memoised per view (list lookups for event timing / link previews). */
  parsed: Map<string, Record<string, unknown> | null>;
}

const IX_HEAD = '{"v":2,"ix":"';
const IX_DIGITS = 10;

/** The bundle text from stored NK body texts (spliced, never re-serialised), with its trailing index. */
export function buildHotText(
  generatedAt: number,
  featured: Record<EventKind, string | null>,
  items: { key: string; fetchedAt: number; etag: string | null; ok: boolean; body: string }[],
): string {
  const top = `"generatedAt":${generatedAt},"featured":${JSON.stringify(featured)}`;
  const head = (ix: number) => `${IX_HEAD}${String(ix).padStart(IX_DIGITS, "0")}",${top},"entries":{`;
  const parts: string[] = [];
  const index: Record<string, IndexRow> = {};
  let pos = head(0).length;
  items.forEach((it, i) => {
    const pre = `${i ? "," : ""}${JSON.stringify(it.key)}:{"fetchedAt":${it.fetchedAt},"etag":${JSON.stringify(it.etag)},"ok":${it.ok},"data":`;
    parts.push(pre, it.body, "}");
    pos += pre.length;
    index[it.key] = [pos, it.body.length, it.fetchedAt, it.ok ? 1 : 0, it.etag];
    pos += it.body.length + 1;
  });
  const tail = '},"index":';
  return `${head(pos + tail.length)}${parts.join("")}${tail}{${top},"keys":${JSON.stringify(index)}}}`;
}

/** Index of a bundle text; a v1 bundle (no index) is parsed once instead. null = unreadable. */
export function viewOf(text: string): HotView | null {
  try {
    if (text.startsWith(IX_HEAD)) {
      const at = Number(text.slice(IX_HEAD.length, IX_HEAD.length + IX_DIGITS));
      const ix = JSON.parse(text.slice(at, -1)) as { generatedAt: number; featured: HotView["featured"]; keys: Record<string, IndexRow> };
      return { text, generatedAt: ix.generatedAt, featured: ix.featured, keys: new Map(Object.entries(ix.keys)), parsed: new Map() };
    }
    const b = JSON.parse(text) as HotBundle;
    const keys = new Map<string, IndexRow>();
    const bodies = new Map<string, string>();
    for (const [k, e] of Object.entries(b.entries)) {
      keys.set(k, [0, 0, e.fetchedAt, e.ok ? 1 : 0, e.etag]);
      bodies.set(k, JSON.stringify(e.data));
    }
    return { text, generatedAt: b.generatedAt, featured: b.featured, keys, bodies, parsed: new Map() };
  } catch {
    return null;
  }
}

/** One entry's NK envelope text (a substring of the bundle). */
export function hotBody(v: HotView, key: string): string | undefined {
  const r = v.keys.get(key);
  if (!r) return undefined;
  return v.bodies?.get(key) ?? v.text.slice(r[0], r[0] + r[1]);
}

/** One entry as a cache Entry (for the proxy). */
export function hotEntry(v: HotView, key: string): Entry | undefined {
  const r = v.keys.get(key);
  const body = r && hotBody(v, key);
  return r && body !== undefined ? { key, body, ok: r[3] === 1, etag: r[4], fetchedAt: r[2], frozen: false, hot: true } : undefined;
}

/** One entry's parsed `body` field (NK's payload), memoised per bundle. Only for ok entries. */
export function hotPayload(v: HotView, key: string): unknown {
  let d = v.parsed.get(key);
  if (d === undefined) {
    const r = v.keys.get(key);
    const text = r && r[3] === 1 ? hotBody(v, key) : undefined;
    try {
      d = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      d = null;
    }
    v.parsed.set(key, d);
  }
  return d?.body;
}

let hotMemo: { at: number; text: string | null; view?: HotView | null } | null = null;

/**
 * The hot bundle text as published to KV, re-read at most every HOT_MEM_TTL_MS per isolate. Never throws:
 * if KV fails (daily read quota, transient error) the isolate keeps its last copy, else falls back to the
 * cron's working copy in D1, else answers null.
 */
async function hotText(deps: Deps): Promise<{ text: string | null; view?: HotView | null }> {
  const now = deps.now();
  if (hotMemo && now - hotMemo.at < HOT_MEM_TTL_MS) return hotMemo;
  const prev = hotMemo;
  let text: string | null;
  try {
    text = await deps.kv.get(HOT_KEY, { type: "text", cacheTtl: HOT_KV_CACHE_TTL_S });
  } catch (err) {
    console.warn("hot: KV read failed", String(err));
    text = prev?.text ?? (await hotFromD1(deps.db));
  }
  // Unchanged (the bundle changes at most every 2 min): keep the index instead of reading it again.
  hotMemo = prev && prev.text === text ? { at: now, text, view: prev.view } : { at: now, text };
  return hotMemo;
}

// ─────────────────────────────── the cron's working state (D1), also the fallback when KV is down

/** Per hot key: NK fetch time, CDN expiry, ETag, ok, and what the cron derives from the body. */
export interface HotMetaEntry {
  f: number;
  x: number;
  e: string | null;
  ok: boolean;
  /** Derived from the body when it changed, so the cron never re-reads bodies: event list items (t: timing
   *  plus a hash of the item, so only items that changed are rewritten to `events`), daily feed ids (ids),
   *  page-1 leaderboard profile keys in rank order (p). */
  d?: { t?: [id: string, start: number, end: number, hash: number][]; ids?: string[]; p?: string[] };
}

/** `hot_state.meta`: the cron's index (tens of KB, not measured: up to 25 profile paths per page-1 board); bodies live in `hot_entries`, one row per key. */
export interface HotMeta {
  v: 2;
  generatedAt: number;
  featured: Record<EventKind, string | null>;
  entries: Record<string, HotMetaEntry>;
  /** Profile warmer: every profile of the boards with this signature is fresh until `until` (warm.ts). */
  warm?: { sig: string; until: number };
}

/** Bundle text assembled from D1 (cron state + bodies): the fallback when KV can't be read. */
export async function hotFromD1(db: D1Like): Promise<string | null> {
  try {
    const row = await db.prepare("SELECT meta FROM hot_state WHERE id = 1").first<{ meta: string | null }>();
    if (!row?.meta) return null;
    const meta = JSON.parse(row.meta) as HotMeta;
    const { results } = await db.prepare("SELECT key, body FROM hot_entries").all<{ key: string; body: string }>();
    const bodies = new Map(results.map((r) => [r.key, r.body]));
    const items = Object.entries(meta.entries).flatMap(([key, m]) => {
      const body = bodies.get(key);
      return body === undefined ? [] : [{ key, fetchedAt: m.f, etag: m.e, ok: m.ok, body }];
    });
    return buildHotText(meta.generatedAt, meta.featured, items);
  } catch (err) {
    console.warn("hot: D1 fallback failed", String(err));
    return null;
  }
}

/** Raw bundle text, for /api/now (served as is: no parse, no re-serialisation). */
export async function getHotText(deps: Deps): Promise<string | null> {
  return (await hotText(deps)).text;
}

/** The hot bundle's index (read once per distinct text per isolate; entries are sliced on demand). */
export async function getHot(deps: Deps): Promise<HotView | null> {
  const memo = await hotText(deps);
  if (memo.view === undefined) memo.view = memo.text ? viewOf(memo.text) : null;
  return memo.view;
}

/** Called by the cron after it publishes, so the same isolate serves the new bundle immediately. */
export function setHotMemo(text: string, now: number): void {
  hotMemo = { at: now, text };
}

/** The hot bundle only if this isolate already holds it (no KV read): for optional extras. */
export function peekHot(): HotView | null {
  if (!hotMemo?.text) return null;
  if (hotMemo.view === undefined) hotMemo.view = viewOf(hotMemo.text);
  return hotMemo.view;
}

export function resetHotMemo(): void {
  hotMemo = null;
}

// ─────────────────────────────── L3: D1 (long tail + permanent archive)

interface Row {
  key: string;
  body: string;
  ok: number;
  etag: string | null;
  fetched_at: number;
  frozen: number;
}

const fromRow = (r: Row): Entry => ({
  key: r.key,
  body: r.body,
  ok: r.ok === 1,
  etag: r.etag,
  fetchedAt: r.fetched_at,
  frozen: r.frozen === 1,
});

export async function d1Get(db: D1Like, key: string): Promise<Entry | null> {
  const r = await db.prepare("SELECT key, body, ok, etag, fetched_at, frozen FROM responses WHERE key = ?").bind(key).first<Row>();
  return r ? fromRow(r) : null;
}

export function d1PutStmt(db: D1Like, e: Entry) {
  // A frozen row is never downgraded or overwritten.
  return db
    .prepare(
      `INSERT INTO responses (key, body, ok, etag, fetched_at, frozen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET body = excluded.body, ok = excluded.ok, etag = excluded.etag,
         fetched_at = excluded.fetched_at, frozen = excluded.frozen
       WHERE responses.frozen = 0`,
    )
    .bind(e.key, e.body, e.ok ? 1 : 0, e.etag, e.fetchedAt, e.frozen ? 1 : 0);
}

/** Freeze an existing row in place (used when upstream has since dropped data we already hold). */
export function d1FreezeStmt(db: D1Like, key: string) {
  return db.prepare("UPDATE responses SET frozen = 1 WHERE key = ?").bind(key);
}
