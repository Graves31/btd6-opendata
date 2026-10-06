// Test doubles: node:sqlite-backed D1, Map-backed KV, and a fake data.ninjakiwi.com that serves
// docs/api/fixtures (synthesising any leaderboard page / event document the fixtures don't contain).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { matchRoute } from "../src/nk/routes.ts";
import type { D1Like, D1StatementLike, Deps, KVLike } from "../src/worker/deps.ts";
import { resetTimingMemo } from "../src/worker/events.ts";
import { resetHotState } from "../src/worker/hot.ts";
import { CLIENT_ORIGIN_BURST, CLIENT_ORIGIN_PER_MIN, MAX_ORIGIN_PER_REQUEST, resetOriginCooldown, TokenBuckets } from "../src/worker/limit.ts";
import { mem, resetHotMemo } from "../src/worker/store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(root, "docs/api/fixtures");
const index = JSON.parse(readFileSync(join(FIX, "_index.json"), "utf8")) as {
  capturedAt: string;
  requests: { path: string; file: string | null; status: number; headers: Record<string, string> }[];
};

export const CAPTURED_AT = Date.parse(index.capturedAt);
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// ─────────────────────────────── D1

/**
 * Failure injection: `fail.reads` / `fail.writes` make every read (first/all, or run of a SELECT) / write
 * (run of anything else, batch) throw, like D1 does once a daily quota is spent.
 */
export interface Faults {
  reads: boolean;
  writes: boolean;
}

const quotaError = (what: string) => new Error(`D1_ERROR: ${what} limit exceeded (injected)`);

export function makeD1(): D1Like & { raw: DatabaseSync; fail: Faults } {
  const raw = new DatabaseSync(":memory:");
  const fail: Faults = { reads: false, writes: false };
  for (const f of readdirSync(join(root, "migrations")).sort()) raw.exec(readFileSync(join(root, "migrations", f), "utf8"));
  type Stmt = D1StatementLike & { runSync: () => { meta: { changes: number } } };
  const stmt = (sql: string, args: unknown[] = []): Stmt => {
    const isRead = /^\s*SELECT/i.test(sql);
    const runSync = () => ({ meta: { changes: Number(raw.prepare(sql).run(...(args as never[])).changes) } });
    return {
      runSync,
      bind: (...values: unknown[]) => stmt(sql, values),
      first: async <T,>() => {
        if (fail.reads) throw quotaError("rows read");
        return (raw.prepare(sql).get(...(args as never[])) as T) ?? null;
      },
      all: async <T,>() => {
        if (fail.reads) throw quotaError("rows read");
        return { results: raw.prepare(sql).all(...(args as never[])) as T[] };
      },
      run: async () => {
        if (isRead ? fail.reads : fail.writes) throw quotaError(isRead ? "rows read" : "rows written");
        return runSync();
      },
    };
  };
  return {
    raw,
    fail,
    prepare: (sql: string) => stmt(sql),
    // Synchronous, like D1's server-side batch: atomic and never interleaved with other batches.
    batch: async (statements: D1StatementLike[]) => {
      if (fail.writes) throw quotaError("rows written");
      raw.exec("BEGIN");
      try {
        const out = (statements as Stmt[]).map((s) => s.runSync());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// ─────────────────────────────── KV

export function makeKV(): KVLike & { store: Map<string, string>; puts: number; gets: number; fail: Faults } {
  const store = new Map<string, string>();
  const kv = {
    store,
    puts: 0,
    gets: 0,
    fail: { reads: false, writes: false } as Faults,
    get: async (key: string) => {
      if (kv.fail.reads) throw new Error("KV GET failed: 429 Too Many Requests (injected)");
      kv.gets++;
      return store.get(key) ?? null;
    },
    put: async (key: string, value: string) => {
      if (kv.fail.writes) throw new Error("KV put() limit exceeded for the day (injected)");
      kv.puts++;
      store.set(key, value);
    },
  };
  return kv;
}

// ─────────────────────────────── fake NK origin

export interface FakeOrigin {
  fetch: typeof fetch;
  calls: string[];
  down: boolean;
  /** Value of the `Age` header NK's CDN reports (max-age is 300). */
  ageS: number;
  /** Paths answered with HTTP 429 + Retry-After: 60 (NK's rate limit). */
  status429: Set<string>;
  /** Per-path overrides (JSON text). */
  override: Map<string, string>;
}

export function makeOrigin(): FakeOrigin {
  const byPath = new Map<string, { text: string; etag: string; ct: string; status: number }>();
  const templates = new Map<string, string>(); // route name → successful JSON text
  for (const r of index.requests) {
    if (!r.file) {
      byPath.set(r.path, { text: "", etag: r.headers.etag ?? "", ct: r.headers["content-type"] ?? "", status: r.status });
      continue;
    }
    const text = readFileSync(join(FIX, r.file), "utf8");
    byPath.set(r.path, { text, etag: r.headers.etag ?? `W/"${r.path}"`, ct: r.headers["content-type"] ?? "", status: r.status });
    const [p, q = ""] = r.path.split("?");
    const m = matchRoute(p, q && `?${q}`);
    if (m.ok && !templates.has(m.route.name) && (JSON.parse(text) as { success?: boolean }).success) {
      templates.set(m.route.name, text);
    }
  }

  const origin: FakeOrigin = {
    calls: [],
    down: false,
    ageS: 0,
    override: new Map(),
    status429: new Set(),
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const key = url.pathname + url.search;
      origin.calls.push(key);
      if (origin.down) throw new TypeError("fetch failed");
      const ifNoneMatch = new Headers(init?.headers).get("If-None-Match");
      const cdn = { "cache-control": "public, max-age=300", age: String(origin.ageS) };
      const json = (text: string, etag: string) =>
        ifNoneMatch && ifNoneMatch === etag
          ? new Response(null, { status: 304, headers: { etag, ...cdn } })
          : new Response(text, { status: 200, headers: { "content-type": "application/json; charset=utf-8", etag, ...cdn } });

      if (origin.status429.has(key)) return new Response("rate limited", { status: 429, headers: { "retry-after": "60" } });
      const ov = origin.override.get(key);
      if (ov !== undefined) return json(ov, `W/"override-${ov.length}"`);

      const hit = byPath.get(key);
      if (hit) {
        if (!hit.ct.includes("json")) return new Response(hit.text || new Uint8Array(8), { status: hit.status, headers: { "content-type": hit.ct } });
        return json(hit.text, hit.etag);
      }
      // Like NK once a CT's groups are dropped: every team links to one placeholder group that answers this.
      if (/\/leaderboard\/group\/c7fa4bd7$/.test(url.pathname)) return json(JSON.stringify({ error: "No Group Available", success: false }), `W/"ng"`);
      // Synthesise from a template of the same route.
      const m = matchRoute(url.pathname, url.search);
      const tpl = m.ok ? templates.get(m.route.name) : undefined;
      if (!m.ok || !tpl) return json(JSON.stringify({ error: "No Boss with that ID exists", success: false }), `W/"nf"`);
      const data = JSON.parse(tpl) as Record<string, unknown>;
      if (typeof data.maxPages === "number" && m.page > data.maxPages) {
        return json(JSON.stringify({ error: "No Scores Available", success: false }), `W/"ns"`);
      }
      data.prev = m.page > 1 ? `https://data.ninjakiwi.com${url.pathname}?page=${m.page - 1}` : null;
      return json(JSON.stringify(data), `W/"syn-${key}"`);
    },
  };
  return origin;
}

// ─────────────────────────────── deps

export interface TestEnv {
  deps: Deps;
  db: ReturnType<typeof makeD1>;
  kv: ReturnType<typeof makeKV>;
  origin: FakeOrigin;
  clock: { now: number };
  pending: Promise<unknown>[];
  settle: () => Promise<void>;
}

export function makeEnv(now = CAPTURED_AT): TestEnv {
  mem.clear();
  resetHotMemo();
  resetHotState();
  resetTimingMemo();
  resetOriginCooldown();
  const db = makeD1();
  const kv = makeKV();
  const origin = makeOrigin();
  const clock = { now };
  const pending: Promise<unknown>[] = [];
  const deps: Deps = {
    kv,
    db,
    fetch: origin.fetch,
    now: () => clock.now,
    waitUntil: (p) => pending.push(p),
    nkBase: "https://data.ninjakiwi.com",
    // Fresh buckets per test (production shares one set per isolate).
    limits: { perRequest: MAX_ORIGIN_PER_REQUEST, buckets: new TokenBuckets(CLIENT_ORIGIN_BURST, CLIENT_ORIGIN_PER_MIN) },
  };
  return {
    deps, db, kv, origin, clock, pending,
    settle: async () => {
      while (pending.length) await pending.shift();
    },
  };
}

export const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(`https://site.test${path}`, { headers, method });
