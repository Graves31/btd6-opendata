// Client data store: everything a page needs is read synchronously from memory, so navigation renders in
// the same frame as the click. Data gets there ahead of time through prefetching (see link.tsx):
//
//   want(keys)  → keys that are missing or stale are coalesced across the current tick and fetched through
//                 /api/batch (≤ 20 keys per Worker invocation, streamed: each key lands as soon as it's
//                 resolved server-side). Team CT history keys ride along too; other /api/ keys (history
//                 lists) and static JSON (round sets: /assets/*.json) are fetched individually.
//   loadNow()   → /api/now seeds every hot key (lists + featured events) in one request.
//   hydrate()   → last session's entries from IndexedDB, so repeat visits render instantly offline-first.
//
// Stale entries are still served (stale-while-revalidate); `want` refreshes them in the background.

export interface ClientEntry {
  key: string;
  /** NK envelope (model-stripped) for /btd6 keys, raw JSON for /api keys. */
  data: any;
  ok: boolean;
  /** Server-side fetch time of the data (null when unknown). */
  fetchedAt: number | null;
  receivedAt: number;
  freshUntil: number;
}

export interface Persist {
  load(): Promise<ClientEntry[]>;
  save(entries: ClientEntry[]): Promise<void>;
}

export interface StoreOptions {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  persist?: Persist;
  maxBatch?: number;
  /** Runs a flush; defaults to setTimeout(0) so every link registered in one render shares a batch. */
  schedule?: (fn: () => void) => void;
  /** Called with each newly received entry (used to warm images). */
  onEntry?: (e: ClientEntry) => void;
}

/** Floor on client freshness, so a stale-served key isn't re-requested in a tight loop. */
const MIN_FRESH_MS = 15_000;
/**
 * Hot keys from /api/now are revalidated by re-reading /api/now, at most this often. The server publishes a
 * new bundle at most every 2 minutes (src/worker/hot.ts), so asking sooner mostly returns the same data.
 */
export const NOW_TTL_MS = 120_000;

interface Waiter {
  promise: Promise<void>;
  resolve: () => void;
}

function waiter(): Waiter {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

interface BatchLine {
  k: string;
  s: number;
  a: number;
  f: 0 | 1;
  t: number | null;
  c: string;
  b: any;
}

export class Store {
  private map = new Map<string, ClientEntry>();
  /** Requested, not yet sent. */
  private pending = new Map<string, Waiter>();
  /** Sent; resolved by the request that owns the waiter (never by an older request for the same key). */
  private inflight = new Map<string, Waiter>();
  /** Rate-limited keys (429): not re-requested before this time (ms). */
  private retryAt = new Map<string, number>();
  private flushScheduled = false;
  private listeners = new Set<() => void>();
  private notifyScheduled = false;
  private dirty = new Map<string, ClientEntry>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private opts: Required<Omit<StoreOptions, "persist" | "onEntry">> & Pick<StoreOptions, "persist" | "onEntry">;

  featured: Record<string, string | null> = {};
  nowLoadedAt = 0;
  private nowInflight: Promise<void> | null = null;
  /** Counters for diagnostics (and tests). */
  stats = { batches: 0, batchKeys: 0, rawFetches: 0, nowFetches: 0 };

  constructor(opts: StoreOptions) {
    this.opts = {
      now: () => Date.now(),
      maxBatch: 20,
      schedule: (fn) => setTimeout(fn, 0),
      ...opts,
    };
  }

  // ─────────────────────────────── reading

  peek(key: string): ClientEntry | undefined {
    return this.map.get(key);
  }

  isFresh(key: string): boolean {
    const e = this.map.get(key);
    return !!e && e.freshUntil > this.opts.now();
  }

  /** True when every key is in memory (fresh or stale): the page can render with no wait. */
  has(keys: string[]): boolean {
    return keys.every((k) => this.map.has(k));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ─────────────────────────────── fetching

  /**
   * Make sure `keys` are in memory and fresh. Returns when all have arrived (or failed). Calls within the
   * same tick are merged into as few /api/batch requests as possible.
   */
  want(keys: string[]): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const key of keys) {
      if (this.isFresh(key)) continue;
      if ((this.retryAt.get(key) ?? 0) > this.opts.now()) continue; // server asked us to back off
      let w = this.pending.get(key) ?? this.inflight.get(key);
      if (!w) {
        w = waiter();
        this.pending.set(key, w);
      }
      waits.push(w.promise);
    }
    if (this.pending.size && !this.flushScheduled) {
      this.flushScheduled = true;
      this.opts.schedule(() => this.flush());
    }
    return Promise.all(waits).then(() => undefined);
  }

  private flush(): void {
    this.flushScheduled = false;
    const keys = [...this.pending.keys()];
    for (const k of keys) this.inflight.set(k, this.pending.get(k)!);
    this.pending.clear();
    // NK keys (and team CT history) go through /api/batch; other /api/ keys and static files (round sets under
    // /assets/, content-hashed and immutable) are fetched directly.
    const batchable = (k: string) => k.startsWith("/btd6/") || k.startsWith("/api/history/team/");
    const raw = keys.filter((k) => !batchable(k));
    const nk = keys.filter(batchable);
    for (const k of raw) void this.fetchRaw(k);
    for (let i = 0; i < nk.length; i += this.opts.maxBatch) void this.fetchBatch(nk.slice(i, i + this.opts.maxBatch));
  }

  private async fetchRaw(key: string): Promise<void> {
    const mine = this.inflight.get(key);
    this.stats.rawFetches++;
    try {
      const res = await this.opts.fetch(key);
      if (res.status === 429) this.backOff(key, Number(res.headers.get("retry-after")));
      if (res.ok) {
        const data = await res.json();
        const cc = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
        this.put({ key, data, ok: true, fetchedAt: null, maxAgeS: cc ? Number(cc[1]) : 60 });
      }
    } catch {
      // keep whatever we had
    } finally {
      this.settle(key, mine);
    }
  }

  private async fetchBatch(keys: string[]): Promise<void> {
    const mine = new Map(keys.map((k) => [k, this.inflight.get(k)]));
    this.stats.batches++;
    this.stats.batchKeys += keys.length;
    const url = `/api/batch?${keys.map((k) => `k=${encodeURIComponent(k)}`).join("&")}`;
    try {
      const res = await this.opts.fetch(url);
      if (!res.ok) return;
      const onLine = (line: string) => {
        if (!line.trim()) return;
        const l = JSON.parse(line) as BatchLine;
        if (l.s === 429) return this.backOff(l.k, l.a); // rate-limited: keep the stale copy, retry later
        if (l.s >= 500) return; // upstream trouble: keep the stale copy
        const ok = l.s === 200 && l.b?.success !== false;
        this.put({ key: l.k, data: l.b, ok, fetchedAt: l.t, maxAgeS: l.a });
        this.settle(l.k, mine.get(l.k));
      };
      if (res.body && typeof res.body.getReader === "function") {
        // Stream: apply each key the moment its line arrives.
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            onLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        }
        onLine(buf);
      } else {
        for (const line of (await res.text()).split("\n")) onLine(line);
      }
    } catch {
      // network failure: keep stale copies
    } finally {
      for (const k of keys) this.settle(k, mine.get(k));
    }
  }

  /** Remember not to ask for `key` again for `seconds` (default 5). The waiter is settled by the caller. */
  /** Load status of a key with nothing in memory: when a 429 back-off ends (ms epoch, 0 = none) and whether a fetch is queued/in flight. */
  loadState(key: string): { retryAt: number; busy: boolean } {
    return { retryAt: this.retryAt.get(key) ?? 0, busy: this.inflight.has(key) || this.pending.has(key) };
  }

  private backOff(key: string, seconds: number): void {
    const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 5;
    this.retryAt.set(key, this.opts.now() + s * 1000);
  }

  private settle(key: string, w: Waiter | undefined): void {
    if (!w) return;
    if (this.inflight.get(key) === w) this.inflight.delete(key);
    w.resolve();
  }

  /** Data arrived another way (e.g. /api/now): release a queued request for it. */
  private release(key: string): void {
    const w = this.pending.get(key);
    if (w) {
      this.pending.delete(key);
      w.resolve();
    }
  }

  private put(p: { key: string; data: any; ok: boolean; fetchedAt: number | null; maxAgeS: number }): void {
    const now = this.opts.now();
    const old = this.map.get(p.key);
    // Never replace newer data with older (e.g. a slow batch line after a fresher /api/now).
    if (old && old.fetchedAt !== null && p.fetchedAt !== null && p.fetchedAt < old.fetchedAt) return;
    const e: ClientEntry = {
      key: p.key,
      data: p.data,
      ok: p.ok,
      fetchedAt: p.fetchedAt,
      receivedAt: now,
      freshUntil: now + Math.max(MIN_FRESH_MS, p.maxAgeS * 1000),
    };
    this.map.set(p.key, e);
    this.dirty.set(p.key, e);
    this.opts.onEntry?.(e);
    this.scheduleSave();
    this.notify();
  }

  /** Seed all hot keys (lists + featured events) from /api/now. */
  loadNow(force = false): Promise<void> {
    if (!force && this.opts.now() - this.nowLoadedAt < NOW_TTL_MS) return Promise.resolve();
    if (this.nowInflight) return this.nowInflight;
    this.stats.nowFetches++;
    this.nowInflight = (async () => {
      try {
        const res = await this.opts.fetch("/api/now");
        if (!res.ok) return;
        const bundle = (await res.json()) as {
          featured: Record<string, string | null>;
          entries: Record<string, { fetchedAt: number; ok: boolean; data: any }>;
        };
        this.featured = bundle.featured ?? {};
        for (const [key, e] of Object.entries(bundle.entries ?? {})) {
          this.put({ key, data: e.data, ok: e.ok, fetchedAt: e.fetchedAt, maxAgeS: NOW_TTL_MS / 1000 });
          this.release(key);
        }
        this.nowLoadedAt = this.opts.now();
        this.notify();
      } catch {
        // offline: hydrated data keeps the app usable
      } finally {
        this.nowInflight = null;
      }
    })();
    return this.nowInflight;
  }

  // ─────────────────────────────── persistence

  async hydrate(): Promise<void> {
    if (!this.opts.persist) return;
    try {
      for (const e of await this.opts.persist.load()) {
        if (!this.map.has(e.key)) this.map.set(e.key, e);
      }
      const featured = this.map.get("__featured");
      if (featured) this.featured = featured.data;
      this.notify();
    } catch {
      // private mode / blocked storage: run from memory only
    }
  }

  private scheduleSave(): void {
    if (!this.opts.persist || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const batch = [...this.dirty.values()];
      this.dirty.clear();
      batch.push({ key: "__featured", data: this.featured, ok: true, fetchedAt: null, receivedAt: this.opts.now(), freshUntil: 0 });
      void this.opts.persist!.save(batch).catch(() => {});
    }, 1000);
  }

  private notify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const fn of this.listeners) fn();
    });
  }
}
