// The only place that talks to data.ninjakiwi.com.

import type { Deps } from "./deps.ts";
import { noteOrigin429 } from "./limit.ts";

/** A cached upstream response. `body` is the NK envelope JSON with `model` stripped. */
export interface Entry {
  key: string;
  body: string;
  ok: boolean;
  etag: string | null;
  fetchedAt: number;
  frozen: boolean;
  /**
   * When NK's own CDN copy expires (from its Cache-Control max-age minus Age). Asking again before this
   * returns the same object, so the per-minute cron skips keys until then. Not persisted in D1.
   */
  upstreamExpiresAt?: number;
  /** Set by fetchUpstream when NK answered 304: `body` is `prev.body`, unchanged. */
  notModified?: boolean;
  /** fetchUpstream only: `body` already parsed (callers that need the object skip a second parse). */
  data?: Record<string, unknown>;
  /** Came from the cron's hot bundle: the cron keeps it current, so the proxy tolerates the cron cadence. */
  hot?: boolean;
}

const MIN_UPSTREAM_TTL_S = 60;
const DEFAULT_UPSTREAM_TTL_S = 300;

/** NK's remaining CDN lifetime for a response, clamped to [60 s, max-age]. */
export function upstreamExpiry(headers: Headers, now: number): number {
  const m = /max-age=(\d+)/.exec(headers.get("cache-control") ?? "");
  const maxAge = m ? Number(m[1]) : DEFAULT_UPSTREAM_TTL_S;
  const age = Number(headers.get("age") ?? 0) || 0;
  const remaining = Math.min(maxAge, Math.max(MIN_UPSTREAM_TTL_S, maxAge - age));
  return now + remaining * 1000;
}

export class UpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const USER_AGENT = "btd6-opendata-site/1.0 (cached fan site; respects max-age, uses If-None-Match)";

/**
 * Fetch `key` (an upstream path + canonical query) from NK. With `prev`, sends If-None-Match and returns
 * `prev` with a new fetchedAt on 304. Throws UpstreamError on network failure, non-JSON or HTTP errors.
 */
export async function fetchUpstream(deps: Deps, key: string, prev?: Entry | null): Promise<Entry> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;

  let res: Response;
  try {
    res = await deps.fetch(deps.nkBase + key, { headers });
  } catch (err) {
    throw new UpstreamError(502, `network error: ${(err as Error).message}`);
  }
  const fetchedAt = deps.now();
  const upstreamExpiresAt = upstreamExpiry(res.headers, fetchedAt);
  if (res.status === 304 && prev) return { ...prev, fetchedAt, upstreamExpiresAt, notModified: true };
  if (res.status === 429) {
    noteOrigin429(fetchedAt, res.headers.get("retry-after"));
    throw new UpstreamError(429, "upstream rate limit");
  }
  if (!res.ok) throw new UpstreamError(res.status >= 500 ? 502 : res.status, `upstream HTTP ${res.status}`);
  if (!(res.headers.get("content-type") ?? "").includes("json")) {
    throw new UpstreamError(502, "upstream returned non-JSON");
  }

  let data: Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new UpstreamError(502, "upstream returned invalid JSON");
  }
  if (typeof data.success !== "boolean") throw new UpstreamError(502, "upstream envelope without `success`");
  delete data.model; // constant self-description, ~19% of bytes

  return {
    key,
    body: JSON.stringify(data),
    ok: data.success,
    etag: res.headers.get("etag"),
    fetchedAt,
    frozen: false,
    upstreamExpiresAt,
    data,
  };
}

/** Run `fn` over `items` with at most `limit` in flight (Workers allow 6 open connections per invocation). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
