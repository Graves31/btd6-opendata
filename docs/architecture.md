# btd6-opendata-site

An unofficial Bloons TD 6 events / leaderboards / profiles browser over the Ninja Kiwi Open Data API.
Page changes render from memory in a few milliseconds, and it's hosted on Cloudflare's free plan.
The upstream API contract is in [`docs/api/`](api/README.md).

## How "instant" works

```
                ┌──────────────── browser ────────────────┐
 click ────────►│ store (memory) ── render in the same frame
                │    ▲ IndexedDB (last session, offline)  │
                │    │ /api/now (all hot data, 1 request) │
 links on       │    │ /api/batch (≤20 keys, streamed)    │
 screen ───────►│ IntersectionObserver → needs(route)      │
                └────┼────────────────────────────────────┘
                     ▼
 Worker /api/*: isolate memory → KV hot bundle → D1 → data.ninjakiwi.com
 cron every minute: hot set (only keys whose NK CDN copy expired) → D1 → KV (≤ every 2 min)
 cron hourly: archive ended events, every page → D1, frozen forever
```

- **Every visible link prefetches its target.** Each route declares the keys it renders (`web/src/routes.ts` `needs()`). Links within one screen of the viewport are watched by a shared `IntersectionObserver`. All the keys that become visible in one frame go out as a single `/api/batch` call:
  - on the events page, every event's leaderboard and rules
  - on a boss page, every tab and page link
  - on a leaderboard, every visible player's profile

  Hover, touch or focus fetches anything not loaded yet at high priority.
- **Navigation never waits.** Clicking pushes history and renders from the in-memory store. Stale data renders too and refreshes in the background.
- **Cold start is instant too.** A service worker serves the app shell from disk. The last session's data comes back from IndexedDB, and `/api/now` is preloaded by `index.html`.
- **Proof:** the footer shows `page opened in X ms · cached` after each click, and `window.__nav` holds every timing. `node scripts/e2e.ts` drives Chrome through events → boss → Elite → 2 players → page 2 → a player profile, and fails unless every step opened from memory. Last run: 1–6 ms render, 2–23 ms to paint.

## API

| Endpoint | |
|---|---|
| `GET /api/nk/<btd6 path>[?page=N]` | Mirror of `data.ninjakiwi.com/<btd6 path>` without the `model` field. `X-Cache` is `MEM`, `HOT`, `D1`, `ORIGIN`, `SYNTHETIC`, `REJECTED` (403/404 decided locally) or `LIMITED` (429), with a `-STALE` / `-STALE-IF-ERROR` suffix when the copy is stale. Frozen data carries `X-Frozen: 1` |
| `GET /api/batch?k=<key>&k=…` | Up to 20 distinct `/btd6/…` keys in one Worker call. NDJSON lines `{k,s,a,f,t,c,b}` in completion order, so cache hits arrive first. A malformed key gets its own `s: 400` line. A key refused by the origin budget gets `s: 429`, `c: "LIMITED"`, and `a` = seconds to wait |
| `GET /api/now` | Hot bundle: every list, plus all data for the live or just-ended event of each kind. Served as stored, with no parse |
| `GET /api/history/:kind` | Every race, boss, CT or odyssey event ever seen, newest first. `?before=<epoch ms>&limit=<1–100>`; anything else is a 400 |
| `GET /api/health` | Hot bundle age, archive progress and `d1: "ok" \| "error"` |

Every response carries `X-Content-Type-Options: nosniff`. `HEAD` works everywhere; a `HEAD` batch does no work.

**Origin budget.** Only cache misses count against it; cache hits are never limited. See `src/worker/limit.ts`:
- **Per request:** at most 20 origin fetches, foreground and background.
- **Per client:** `CF-Connecting-IP`, with IPv6 grouped by /64. A burst of 100 origin fetches, refilled at 100 per minute, kept in isolate memory. It is per isolate, so it stops runaway clients and scrapers, not a distributed attack.
- **Optional Workers Rate Limiting binding `ORIGIN_LIMITER`:** a shared counter per Cloudflare location, also consulted only on misses. It fails open.

A refused miss gets a 429 with `Retry-After`, unless an older copy is cached; that copy is served instead, like stale-if-error.

**Degradation.** KV or D1 errors, such as a daily quota exhausted, never fail a request:
- A failed read counts as a miss.
- A failed write is skipped; the data stays in memory.
- `/api/now` falls back to D1's working copy.
- `/api/history` answers 503 with `Retry-After`.
- **Notifications** (`src/worker/notify.ts`): rules (trigger + filter + channel) turn hot-cron findings into messages. First rules: a boss or race id that is in no `events` row yet is queued in the D1 `notifications` outbox (one read per run with candidates, before the upsert) and posted as a Discord embed. Delivery retries up to 5 times within 24 h and honours Discord's `retry_after`. The webhook is the secret `DISCORD_WEBHOOK_URL`; unset means nothing is queued. `node scripts/notify-test.ts` sends two test messages.
- The crons log the error and never throw. The hot cron stays dirty and retries a failed KV publish every minute. If its D1 write fails, it keeps its state in the isolate, so it neither refetches everything nor republishes to KV.

## Free-plan budget

| Resource | Limit | Use |
|---|---|---|
| Worker requests | 100k/day | ~1,450 crons + ~1 per page view: the e2e session used 13 API calls for 8 pages |
| CPU | 10 ms/invocation | cache hits splice stored JSON text (no re-serialisation). The ~160 KB hot bundle is never parsed: requests read one entry through its trailing index, and the cron keeps a few-KB index plus one D1 row per body (docs/api §6.3) |
| Static assets | unlimited | the whole frontend (~33 KB gzipped JS, 2 self-hosted fonts, ~390 KB of game-art sprite sheets + map WebPs, all immutable) |
| KV writes | 1k/day | ≤ 720 (hot bundle, at most every 2 min) |
| KV reads | 100k/day | ≤ 1 per isolate per 30 s (hot bundle memo) |
| D1 writes | 100k/day | ≤ 1,440 hot-state index rows + one row per changed hot body + long-tail cache + archive |
| Subrequests | 50/invocation | hot cron ≤ 28, archive ≤ 45, any request ≤ 20 (origin budget) |

## Develop

```sh
npm install
npm run check          # typecheck + contract validation + 43 tests (no network)
npm run build          # Vite → dist/
node scripts/e2e.ts    # real browser, fully offline (fake NK origin); screenshots in .wrangler/e2e-shots

npm run fixture-origin # terminal 1: fake NK origin replaying docs/api/fixtures
npm run dev:offline    # terminal 2: build + local Worker/D1/KV against it, on :8787
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=*+*+*+*+*"   # run the hot cron once
```

`npm run dev` does the same against the real API. `npm run dev:web` gives Vite hot reload, with `/api` proxied to `:8787`.
`FIXTURE_DELAY_MS=1500 FIXTURE_SLOW=users npm run fixture-origin` makes matching fake-origin paths slow, so you can watch `/api/batch` stream.

## Deploy (free plan)

```sh
npx wrangler login
npx wrangler kv namespace create HOT        # paste the id into wrangler.jsonc
npx wrangler d1 create btd6-opendata        # paste the database_id into wrangler.jsonc
npm run deploy                              # build + remote migrations + deploy
node scripts/smoke.ts https://btd6data.com   # post-deploy check, ~13–20 requests
```

The smoke test checks the static site (HTML, immutable hashed assets, `no-cache` service worker), `/api/health`, and `/api/now`. `/api/now` is polled for up to ~3 min until the first cron has run. It then checks a cache hit on `/api/nk`, a streamed 3-key batch, a local 404 and 403, and `/api/history`. It prints a table with timings and exits 1 on any failure.
