// Origin-fetch budgets: abuse / amplification protection for /api/nk and /api/batch.
//
// Only requests that would reach data.ninjakiwi.com are counted. Cache hits (memory, hot bundle, D1) never
// touch a limiter, so they are never slowed or refused.
//
//  1. Per invocation: at most `perRequest` origin fetches (foreground misses + background revalidations),
//     which keeps every request far below the 50-subrequest cap whatever the batch contains.
//  2. Per client (CF-Connecting-IP, IPv6 grouped by /64): a token bucket of `burst` foreground origin
//     fetches, refilled at `perMinute`. It lives in isolate memory, so it is per isolate: a client whose
//     requests land on several isolates / locations gets that many buckets. It stops casual scraping and
//     runaway clients, not a distributed attacker.
//  3. Optionally the Workers Rate Limiting binding (`ORIGIN_LIMITER` in wrangler.jsonc), which shares its
//     counter across isolates of one Cloudflare location. It is consulted after the local bucket, only on
//     origin misses, and fails open if the binding errors.
//
// A refused miss is answered with 429 (+ Retry-After / the batch line's `a`), unless an older cached copy
// exists, which is then served like stale-if-error.

/** The Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc). */
export interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Origin fetches per invocation (foreground + background). Equal to the batch size: one per key at most. */
export const MAX_ORIGIN_PER_REQUEST = 20;
/** Per-client bucket: a leaderboard page of uncached profiles is 25 fetches, so this allows ~4 at once… */
export const CLIENT_ORIGIN_BURST = 100;
/** …and a sustained ~1 new page of profiles every 15 s. */
export const CLIENT_ORIGIN_PER_MIN = 100;
/** Retry hint when the (window-based) binding refuses. */
const BINDING_RETRY_S = 30;

/** Token buckets keyed by client, bounded in number (oldest-touched evicted first). */
export class TokenBuckets {
  private map = new Map<string, { tokens: number; at: number }>();
  private capacity: number;
  private perMs: number;
  private maxKeys: number;

  constructor(capacity: number, perMinute: number, maxKeys = 10_000) {
    this.capacity = capacity;
    this.perMs = perMinute / 60_000;
    this.maxKeys = maxKeys;
  }

  /** Take one token. Returns 0 when granted, else the seconds until one is available. */
  take(key: string, now: number): number {
    const b = this.map.get(key);
    let tokens = this.capacity;
    if (b) {
      tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.perMs);
      this.map.delete(key); // re-insert below: keeps the Map in least-recently-used order
    }
    const granted = tokens >= 1;
    if (granted) tokens -= 1;
    this.map.set(key, { tokens, at: now });
    if (this.map.size > this.maxKeys) this.map.delete(this.map.keys().next().value!);
    if (granted) return 0;
    return this.perMs > 0 ? Math.max(1, Math.ceil((1 - tokens) / this.perMs / 1000)) : 3600;
  }
}

/** Production singleton: one set of buckets per isolate. */
export const clientBuckets = new TokenBuckets(CLIENT_ORIGIN_BURST, CLIENT_ORIGIN_PER_MIN);

// ─────────────────────────────── Ninja Kiwi's own limit
//
// NK rate-limits its API (undocumented; observed 2026-09-24: ~100 profile requests within a minute from the
// Worker got HTTP 429 for 2–3 minutes). Two defences, both per isolate:
//  - an isolate-wide pace for request-driven origin fetches (all clients together), and
//  - a cooldown after any 429 from NK, honouring Retry-After: nothing is sent to NK until it passes, and
//    cached copies are served instead. Crons check the cooldown too.

/**
 * Request-driven origin fetches per isolate, all clients together. A backstop, not the main defence: NK's
 * limit applies to Cloudflare's shared egress, which no single isolate can see, so the cooldown after a
 * real 429 is what actually keeps us polite. Tighter values starved a single user browsing leaderboards.
 */
export const ISOLATE_ORIGIN_BURST = 100;
export const ISOLATE_ORIGIN_PER_MIN = 100;
export const isolateBucket = new TokenBuckets(ISOLATE_ORIGIN_BURST, ISOLATE_ORIGIN_PER_MIN, 1);
/** Cooldown when NK sends 429 without Retry-After. */
export const DEFAULT_ORIGIN_COOLDOWN_S = 90;

let originCooldownUntil = 0;

/** Record an HTTP 429 from NK. */
export function noteOrigin429(now: number, retryAfter: string | null): void {
  const s = Number(retryAfter);
  const wait = Number.isFinite(s) && s > 0 ? Math.min(s, 900) : DEFAULT_ORIGIN_COOLDOWN_S;
  originCooldownUntil = Math.max(originCooldownUntil, now + wait * 1000);
}

/** Seconds left in the NK cooldown (0 = free to ask). */
export function originCooldownS(now: number): number {
  return originCooldownUntil > now ? Math.ceil((originCooldownUntil - now) / 1000) : 0;
}

export function resetOriginCooldown(): void {
  originCooldownUntil = 0;
}

export interface OriginLimits {
  perRequest: number;
  buckets: TokenBuckets;
  /** Isolate-wide pace shared by every client (optional so tests can leave it out). */
  global?: TokenBuckets;
  binding?: RateLimiterLike;
}

/** Thrown (internally) when an origin fetch is refused. */
export class RateLimited extends Error {
  retryAfterS: number;
  constructor(retryAfterS: number) {
    super("rate limited");
    this.retryAfterS = retryAfterS;
  }
}

/** Per-invocation gate in front of every origin fetch the proxy makes. */
export class OriginGate {
  private limits: OriginLimits;
  private client: string;
  private now: () => number;
  private used = 0;
  /** Once the client is refused, the rest of this invocation is refused too (no further limiter calls). */
  private refusedFor = 0;

  constructor(limits: OriginLimits, client: string, now: () => number) {
    this.limits = limits;
    this.client = client;
    this.now = now;
  }

  /** A foreground miss. Resolves when allowed; throws RateLimited otherwise. */
  async admit(): Promise<void> {
    if (this.refusedFor) throw new RateLimited(this.refusedFor);
    const cooldown = originCooldownS(this.now());
    if (cooldown) this.refuse(cooldown);
    if (this.used >= this.limits.perRequest) throw new RateLimited(1);
    const wait = this.limits.buckets.take(this.client, this.now());
    if (wait) this.refuse(wait);
    const globalWait = this.limits.global?.take("*", this.now()) ?? 0;
    if (globalWait) this.refuse(globalWait);
    if (this.limits.binding) {
      let ok = true;
      try {
        ok = (await this.limits.binding.limit({ key: this.client })).success;
      } catch {
        // fail open: the local bucket still applies
      }
      if (!ok) this.refuse(BINDING_RETRY_S);
    }
    this.used++;
  }

  /** A background revalidation (serving a cached copy either way): only the per-request cap applies. */
  admitBackground(): boolean {
    if (this.used >= this.limits.perRequest || originCooldownS(this.now())) return false;
    if (this.limits.global && this.limits.global.take("*", this.now())) return false;
    this.used++;
    return true;
  }

  private refuse(retryAfterS: number): never {
    this.refusedFor = retryAfterS;
    throw new RateLimited(retryAfterS);
  }
}

/** The limiter key for a request: CF-Connecting-IP, with IPv6 addresses grouped by their /64 prefix. */
export function clientKey(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  return `${expandV6(ip).slice(0, 4).join(":")}::/64`;
}

function expandV6(ip: string): string[] {
  const [head, tail] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0");
  return [...h, ...fill, ...t].map((g) => g.replace(/^0+(?=.)/, ""));
}
