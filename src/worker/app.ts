// API routing and cron dispatch. Static assets are served by Cloudflare without invoking the Worker
// (free, unlimited); only /api/* and page navigations that get link-preview tags reach it (see wrangler.jsonc
// `run_worker_first`).
//
//   GET /api/nk/<btd6 path>[?page=N]   cached mirror of data.ninjakiwi.com (docs/api)
//   GET /api/batch?k=<key>&k=…         up to 20 keys in one invocation, streamed as NDJSON (prefetching)
//   GET /api/now                       hot bundle: lists + featured events, one request for the home page
//   GET /api/history/:kind[?before=ms&limit=n]  every race|boss|ct|odyssey ever seen, newest first
//   GET /sitemap-events.xml                     every archived event page (boss/race/ct/odyssey) for crawlers
//   GET /api/history/team/:guildId    a team's CT results (rank, score, group) from archived data only
//   GET /api/ct/:id/cutoffs            CT cut-off scores per day (hot cron snapshots, D1 only)
//   GET /api/ct/relics                 relic tiles of every archived CT (D1 only)
//   GET /api/health                    cache status
//   POST /api/suggest                  suggestions box: stored in D1 + posted to a private Discord channel (suggest.ts)
//   GET /boss/:id, /player/:id, …      the SPA shell with link-preview tags (og.ts)
//
// Every response carries X-Content-Type-Options: nosniff. HEAD is answered like GET without a body (and a
// HEAD batch does no work). No path throws: KV/D1 failures degrade (proxy.ts), anything unexpected is a 503.

import type { EventKind } from "../nk/routes.ts";
import { NK_BASE, type D1Like, type Deps, type KVLike } from "./deps.ts";
import { runArchive } from "./archive.ts";
import { ctApi } from "./ct.ts";
import { listHistoryJson } from "./events.ts";
import { refreshHot } from "./hot.ts";
import { clientBuckets, clientKey, isolateBucket, MAX_ORIGIN_PER_REQUEST, OriginGate, type RateLimiterLike } from "./limit.ts";
import { errorBody, type ErrorCode } from "./errors.ts";
import { handleBatch, handleNk, jsonResponse, parseBatchKeys } from "./proxy.ts";
import { handlePage, SITE, type AssetsLike } from "./og.ts";
import { handleStats, STATS_GRAPHQL_URL } from "./stats.ts";
import { getHot, getHotText } from "./store.ts";
import { handleSuggest } from "./suggest.ts";
import { GUILD_ID, teamHistory } from "./teams.ts";

export interface Env {
  HOT: KVLike;
  DB: D1Like;
  /** Optional override of the upstream base URL (local dev against a fixture server). */
  NK_BASE?: string;
  /** Optional Workers Rate Limiting binding for origin fetches per client (limit.ts). */
  ORIGIN_LIMITER?: RateLimiterLike;
  /** Static assets (wrangler.jsonc `assets.binding`): the SPA shell for link-preview pages (og.ts). */
  ASSETS?: AssetsLike;
  /** Worker secret (Account Analytics:Read) for the hidden /stats page; unset → /api/stats answers 503 not-configured. */
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  /** Worker secret: Discord webhook for new boss/race notifications (notify.ts); unset → no notifications. */
  DISCORD_WEBHOOK_URL?: string;
  /** Worker secret (Browser Rendering - Edit): screenshots of the event card for the Discord post; unset → text embed. */
  BROWSER_TOKEN?: string;
  /** Plain var (the key is public, served at /<key>.txt): IndexNow pings for new events; unset → none. */
  INDEXNOW_KEY?: string;
  /** Worker secret: private Discord webhook for the suggestions box (suggest.ts); unset → stored only. */
  SUGGEST_WEBHOOK_URL?: string;
  /** Optional override of the Cloudflare GraphQL endpoint (offline e2e fixture). */
  STATS_GRAPHQL_URL?: string;
}

export interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

export const CRON_HOT = "* * * * *";
export const CRON_ARCHIVE = "0 * * * *";

const KINDS = new Set<EventKind>(["race", "boss", "ct", "odyssey"]);
const HISTORY_MAX_LIMIT = 100;

export function makeDeps(env: Env, ctx: Ctx): Deps {
  return {
    kv: env.HOT,
    db: env.DB,
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    waitUntil: (p) => ctx.waitUntil(p),
    nkBase: env.NK_BASE || NK_BASE,
    limits: { perRequest: MAX_ORIGIN_PER_REQUEST, buckets: clientBuckets, global: isolateBucket, binding: env.ORIGIN_LIMITER },
    stats: { token: env.CF_ANALYTICS_TOKEN, accountId: env.CF_ACCOUNT_ID, graphqlUrl: env.STATS_GRAPHQL_URL || STATS_GRAPHQL_URL },
    notify: { discordWebhookUrl: env.DISCORD_WEBHOOK_URL, indexNowKey: env.INDEXNOW_KEY, browserToken: env.BROWSER_TOKEN, accountId: env.CF_ACCOUNT_ID },
    suggest: { webhookUrl: env.SUGGEST_WEBHOOK_URL },
  };
}

/**
 * Worker entry for every request that runs the Worker first: /api/* and the page navigations that get
 * link-preview tags (og.ts). Everything else is served by Cloudflare's asset handler without invoking us.
 */
export async function handleRequest(deps: Deps, env: Pick<Env, "ASSETS">, request: Request): Promise<Response> {
  const { pathname, search, hostname } = new URL(request.url);
  if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/sitemap-events.xml" || !env.ASSETS) return handleApi(deps, request);
  // Pages on the old workers.dev address and on www move to the one public address. /api/* stays answered on
  // every host, so tabs still open on the old address keep working.
  if (hostname.endsWith(".workers.dev") || hostname.startsWith("www.")) return Response.redirect(SITE + pathname + search, 301);
  try {
    return await handlePage(deps, env.ASSETS, request);
  } catch (err) {
    console.error("page: unhandled", String((err as Error)?.stack ?? err));
    return env.ASSETS.fetch(request);
  }
}

export async function handleApi(deps: Deps, request: Request): Promise<Response> {
  let res: Response;
  try {
    res = await route(deps, request);
  } catch (err) {
    console.error("api: unhandled", String((err as Error)?.stack ?? err));
    res = jsonResponse(errorBody("unavailable"), 503, "no-store", { "Retry-After": "30" });
  }
  res.headers.set("X-Content-Type-Options", "nosniff");
  if (request.method === "HEAD" && res.body) {
    await res.body.cancel();
    res = new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  return res;
}

const error = (status: number, code: ErrorCode, cacheControl = "no-store", extra: Record<string, string> = {}, message?: string) =>
  jsonResponse(errorBody(code, message), status, cacheControl, extra);

const SITEMAP_TTL_MS = 10 * 60_000;
let sitemapCache: { db: D1Like; at: number; xml: string } | undefined;
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** urlset of every archived event page that has started (lastmod = end date once over); built once per 10 min per isolate. */
async function eventsSitemap(deps: Deps): Promise<string> {
  const now = deps.now();
  if (sitemapCache && sitemapCache.db === deps.db && now - sitemapCache.at < SITEMAP_TTL_MS) return sitemapCache.xml;
  const urls: string[] = [];
  for (const kind of KINDS) {
    const items = JSON.parse(await listHistoryJson(deps.db, kind, now, 100_000)) as { id: string; end?: number }[];
    for (const it of items) {
      const lastmod = typeof it.end === "number" && it.end <= now ? `<lastmod>${new Date(it.end).toISOString().slice(0, 10)}</lastmod>` : "";
      urls.push(`<url><loc>${xmlEsc(`${SITE}/${kind}/${encodeURIComponent(it.id)}`)}</loc>${lastmod}</url>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  sitemapCache = { db: deps.db, at: now, xml };
  return xml;
}

async function route(deps: Deps, request: Request): Promise<Response> {
  if (new URL(request.url).pathname === "/api/suggest") {
    if (request.method !== "POST") return error(405, "method_not_allowed", "no-store", { Allow: "POST" });
    return handleSuggest(deps, request);
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return error(405, "method_not_allowed", "no-store", { Allow: "GET, HEAD" });
  }
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/api/nk/")) {
    const gate = new OriginGate(deps.limits, clientKey(request), deps.now);
    return handleNk(deps, gate, path.slice("/api/nk".length), url.search, request);
  }

  if (path === "/api/batch") {
    const keys = parseBatchKeys(url);
    if (typeof keys === "string") return error(400, "bad_request");
    if (request.method === "HEAD") {
      return new Response(null, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return handleBatch(deps, new OriginGate(deps.limits, clientKey(request), deps.now), keys);
  }

  if (path === "/api/now") {
    // Served as the stored text: no parse, no re-serialisation.
    const text = await getHotText(deps);
    if (!text) return error(503, "unavailable", "no-store", { "Retry-After": "60" }, "Starting up, try again in a minute");
    // The browser revalidates in the background (stale-while-revalidate): unchanged → 304, no 18 KB re-download.
    const gen = /"generatedAt":(\d+)/.exec(text.slice(0, 80))?.[1] ?? "0";
    const etag = `W/"${gen}-${text.length.toString(36)}"`;
    const cc = "public, max-age=60, stale-while-revalidate=86400";
    if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cc } });
    return jsonResponse(text, 200, cc, { ETag: etag });
  }

  const ct = await ctApi(deps, path);
  if (ct) {
    if (ct.status !== 200) return error(503, "unavailable", "no-store", { "Retry-After": "60" });
    return jsonResponse(ct.body, 200, `public, max-age=${ct.maxAgeS}, stale-while-revalidate=86400`);
  }

  const team = /^\/api\/history\/team\/([^/]+)$/.exec(path);
  if (team) {
    if (!GUILD_ID.test(team[1])) return error(404, "not_found", "public, max-age=3600");
    let json: string;
    try {
      json = JSON.stringify(await teamHistory(deps.db, team[1]));
    } catch (err) {
      console.warn("team history: D1 read failed", String(err));
      return error(503, "unavailable", "no-store", { "Retry-After": "60" });
    }
    return jsonResponse(json, 200, "public, max-age=300, stale-while-revalidate=86400");
  }

  const hist = /^\/api\/history\/([a-z]+)$/.exec(path);
  if (hist && KINDS.has(hist[1] as EventKind)) {
    const q = parseHistoryQuery(url);
    if (typeof q === "string") return error(400, "bad_request", "public, max-age=3600");
    let items: string;
    try {
      items = await listHistoryJson(deps.db, hist[1] as EventKind, q.before, q.limit);
    } catch (err) {
      console.warn("history: D1 read failed", String(err));
      return error(503, "unavailable", "no-store", { "Retry-After": "60" });
    }
    return jsonResponse(`{"success":true,"body":${items}}`, 200, "public, max-age=300, stale-while-revalidate=86400");
  }

  if (path === "/sitemap-events.xml") {
    let xml: string;
    try {
      xml = await eventsSitemap(deps);
    } catch (err) {
      console.warn("sitemap: D1 read failed", String(err));
      return error(503, "unavailable", "no-store", { "Retry-After": "60" });
    }
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  }

  if (path === "/api/stats") {
    if (request.method === "HEAD") return new Response(null, { headers: { "Cache-Control": "no-store" } });
    return handleStats(deps.stats ?? { graphqlUrl: STATS_GRAPHQL_URL }, deps.fetch, deps.now());
  }

  if (path === "/api/health") return health(deps);

  return error(404, "not_found", "public, max-age=3600");
}

/** `before`: epoch ms (digits only, default: now and later); `limit`: 1–100 (default 50). */
export function parseHistoryQuery(url: URL): { before: number; limit: number } | string {
  const b = url.searchParams.get("before");
  const l = url.searchParams.get("limit");
  if (b !== null && !/^\d{1,15}$/.test(b)) return "before must be an epoch-milliseconds integer";
  if (l !== null && !/^\d{1,3}$/.test(l)) return `limit must be an integer 1–${HISTORY_MAX_LIMIT}`;
  return {
    before: b === null ? Number.MAX_SAFE_INTEGER : Number(b),
    limit: l === null ? 50 : Math.min(HISTORY_MAX_LIMIT, Math.max(1, Number(l))),
  };
}

async function health(deps: Deps): Promise<Response> {
  const hot = await getHot(deps); // never throws
  let archive: { archiveQueue: number | null; d1: "ok" | "error" } = { archiveQueue: null, d1: "error" };
  try {
    const queued = await deps.db.prepare("SELECT COUNT(*) AS n FROM archive_queue").first<{ n: number }>();
    archive = { archiveQueue: queued?.n ?? 0, d1: "ok" };
  } catch (err) {
    console.warn("health: D1 read failed", String(err));
  }
  return jsonResponse(
    JSON.stringify({
      hotGeneratedAt: hot ? new Date(hot.generatedAt).toISOString() : null,
      hotKeys: hot ? hot.keys.size : 0,
      ...archive,
    }),
    200,
    "public, max-age=30", // what smoke.ts reads; cached so repeats don't hit D1
  );
}

/** Never throws: a failing run is logged and the next scheduled run starts from consistent state. */
export async function runScheduled(deps: Deps, cron: string): Promise<void> {
  try {
    if (cron === CRON_ARCHIVE) {
      const r = await runArchive(deps);
      (r.error ? console.error : console.log)("archive", JSON.stringify(r));
    } else {
      const r = await refreshHot(deps);
      (r.error ? console.error : console.log)("hot", JSON.stringify(r));
    }
  } catch (err) {
    console.error("cron failed", cron, String((err as Error)?.stack ?? err));
  }
}
