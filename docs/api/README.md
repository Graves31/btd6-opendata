# Ninja Kiwi Open Data API: BTD6 contract

This is the local, authoritative description of the BTD6 half of `https://data.ninjakiwi.com`.
It exists so that nobody working on this site needs to open the live docs or probe the API again.

| File | What it is |
|---|---|
| `README.md` (this) | Conventions, observed behaviour, quirks vs. the official docs, cache policy |
| `openapi.yaml` | Machine-readable contract (OpenAPI 3.1): every path, parameter and response schema |
| `fixtures/` | Real responses captured on **2026-09-24** (game v56.x). `fixtures/_index.json` records status, latency, size and cache headers for each request |
| `../../src/nk/types.ts` | TypeScript mirror of `openapi.yaml` |
| `../../src/nk/routes.ts` | Route table: path matching, local parameter validation, cache class per endpoint |
| `../../scripts/validate-contracts.mjs` | Validates every fixture against `openapi.yaml` and checks that `routes.ts` classifies every fixture path (`npm run validate`) |
| `../../scripts/capture_fixtures.py` | Re-captures the fixtures. Run it only when NK changes the API |

Only the `btd6` endpoints are covered. `battles2` and `blitz` are out of scope.

Official contact for API bugs: `opendata@ninjakiwi.com`. OAK FAQ: `https://ninja.kiwi/opendatafaq`.

---

## 1. Transport

- **Base URL:** `https://data.ninjakiwi.com`. The API is served through Cloudflare. Only `GET` is supported.
- **CORS** reflects any `Origin` (`Access-Control-Allow-Origin: <origin>`, `access-control-max-age: 1728000`), so browsers can call it directly.
- **Cache headers:** every response, including error envelopes, carries `Cache-Control: public, max-age=300`, plus an `Expires` header and a weak `ETag`.
- **Conditional requests:** `If-None-Match: <etag>` returns `304 Not Modified`. Always send it when refreshing.
- **Latency:** Cloudflare HIT ≈ 100–400 ms. MISS/EXPIRED up to **3.3 s**. The slowest endpoints were `challenges/filter/daily`, CT team leaderboards and some user profiles.
- **Content type:** `application/json; charset=utf-8`, except map previews (`image/jpg`) and unknown routes (HTML 404).
- **Rate limit (undocumented, observed 2026-09-24):** about 100 profile requests within a minute from the deployed Worker got **HTTP 429**, and requests were refused for 2–3 minutes. Spaced requests (1 every 20 s) were never refused. The Worker therefore:
  - enters a cooldown on any 429 (`Retry-After`, else 90 s) and serves cached copies meanwhile;
  - paces request-driven fetches per isolate;
  - warms leaderboard profiles 4 per minute from the cron instead of in bursts.

  See `src/worker/limit.ts` and `warm.ts`.
- **`robots.txt` is `Disallow: /`.** Don't crawl. Fetch only what users need, plus bounded prewarm and archive jobs (see §6).
- **Do not use `?pretty=true`.** It returns an **HTML page** (`text/html`), not JSON.

## 2. Response envelope

Every JSON response is wrapped. Successful responses look like this:

```jsonc
{
  "error": null,
  "success": true,
  "body": [ ... ] | { ... },   // payload; list endpoints return an array, document endpoints an object
  "next": "https://…?page=2" | null,
  "prev": "https://…?page=1" | null,
  "maxPages": 40,              // ONLY on leaderboards (boss, race, CT player/team/group)
  "model": { "name": "_btd6race", "parameters": { "<field>": { "description", "type", "default"? } } }
}
```

- `model` is NK's self-description of the body schema. It is **~19% of all bytes** and never changes, so **strip it** in the proxy.
- `next` and `prev` are absolute URLs on `data.ninjakiwi.com`. Only paginated endpoints set them; everything else returns `null`.

### Errors

**Errors are HTTP 200.** Always branch on `success`, never on the status code.

```json
{ "error": "No Boss with that ID exists", "success": false }
```

The error envelope has only these two keys: no `body`, `next`, `prev` or `model`.

| Error string (exact) | When |
|---|---|
| `No Boss with that ID exists` | Unknown boss ID (metadata or leaderboard) |
| `No Race with that ID exists` | Unknown race ID |
| `Invalid boss difficulty` | `:difficulty` / `:type` not `standard` or `elite` |
| `Invalid team size` | Boss `:teamSize` outside 1–4 |
| `No Group Available` | CT group page after NK dropped the groups (§5) |
| `No Scores Available` | Leaderboard for an event with no scores yet (upcoming event), **or** `?page` beyond `maxPages` |
| `Invalid user ID / Player Does not play this game` | Unknown or malformed user ID |
| `No challenge with that ID exists` | Unknown challenge ID |
| `Invalid map ID` | Unknown map ID |
| `Invalid filter type` | Unknown challenge or map filter |
| `This endpoint requires an OAK id. An invalid oak ID was given or the player does not play this game` | `/btd6/save/:oakID` without a valid OAK |

Only a path that matches no route returns a real **HTTP 404**, with an HTML body (`Cannot GET /btd6/…`).

## 3. Pagination

| Endpoint family | Page size | `maxPages` | Max rows | Past the last page |
|---|---|---|---|---|
| Boss leaderboard, `teamSize=1` | 25 | 40 | **1000** | error `No Scores Available` |
| Boss leaderboard, `teamSize=2/3/4` | 25 | fewer (22 and 15 observed for 3 and 4) | ≤ 1000 | error `No Scores Available` |
| Race leaderboard | **50** | 20 | **1000** | error `No Scores Available` |
| CT player / team leaderboard | 25 | 40 | **1000** | error `No Scores Available` |
| CT group leaderboard | all rows (4 observed) | 1 | – | – |
| Challenge / map filter lists | 25 | *(absent)* | unbounded | `success: true` with **empty `body: []`** |
| Everything else | not paginated | – | – | – |

- The query parameter is `?page=N`, 1-based. Page 1 is the same as no parameter.
- `?page=0` returns page 1's rows but sets `next` to `?page=1`. Normalise `page < 1` to "no param".
- Leaderboards are **capped at the top 1000**. A full leaderboard is a bounded, known number of requests, which makes complete archiving cheap (§6).
- The `daily` challenge filter has one page. `?page=2` is an empty list.

## 4. Identifiers and value conventions

| Thing | Format (observed) | Example |
|---|---|---|
| Boss event ID | Usually `<BossName><N>_<8 base36>`, **but the newest bosses use a bare 8-char ID** | `Vortex47_mu62cmt5`, `msi6n2qi` (Dreadbloon #37) |
| Race event ID | Usually `<Words_Joined>_<8 base36>`; may contain `-` | `Gun_Game_mu19oabt`, `Regene-race_mtjapaiu` |
| CT / odyssey / generic event ID | 8 chars base36 | `mtv62zza`, `muekowzs` |
| User ID | **48 lowercase hex** (NK-encrypted); the endpoint also accepts an OAK | `9fb6118ddcc2fcf7184add1e0974ee71980d1ebe9617dd6a` |
| Guild (team) ID | 48 lowercase hex | `9fb9168a…df39` |
| CT group ID | **44** lowercase hex during an event; once NK drops the groups (2–3 days after the end, see §5) every team links to one 8-hex placeholder | `cafb78d69bd0ffa75208de245c74ef189b4144e0ca53`, `c7fa4bd7` |
| Player-made challenge ID / map ID | 7 uppercase alphanumerics | `ZFVWLUS`, `ZMYWROV` |
| Daily challenge ID | `rot<N><YYYYMMDD>` (standard), `adv<N><YYYYMMDD>` (advanced), `coop…` (co-op) | `rot296620260924`, `adv295520260926` |

- **Never parse meaning out of event IDs.** Naming has changed over time (see the boss and race rows). `routes.ts` validates every event ID by shape only: `[A-Za-z0-9_-]{4,64}`. Boss type and number come from the list item's `bossType` and `name`, not the ID.
- **Timestamps** (`start`, `end`, `createdAt`, `submissionTime`) are Unix epoch **milliseconds**.
- **`submissionTime` has been `-1` in every leaderboard row observed.** Treat it as unavailable.
- **Scores of type `time`** are milliseconds. For example, 1905200 → 31:45.200.
- **Asset URLs** (`*URL`) point to `https://static-api.nkstatic.com/appdocs/4/assets/opendata/<md5>_<Name>.png`. They are content-addressed and therefore immutable. Hotlink them rather than proxying.
- **Cross-links** (`profile`, `creator`, `metadata`, `leaderboard*`, `tiles`, `group`, `owner`, `maps`) are absolute `https://data.ninjakiwi.com/...` URLs. The client maps them to proxy paths.
- `-1` means "unset / unlimited" in counters and limits: `leastCashUsed`, `leastTiersUsed`, tower `max`, power `max`.

### Game rotation times (observed)

| Event | Starts | Ends |
|---|---|---|
| Boss | 02:00 UTC | 03:00 UTC, ~5 days later |
| Race | 02:00 UTC | 03:00 UTC, ~4 days later |
| Odyssey | 02:00 UTC | 02:00 UTC, 6 days later |
| CT | 22:00 UTC | 22:00 UTC, 7 days later |
| Daily challenge | `createdAt` ≈ 01:36 UTC each day | – |

**List endpoints include upcoming events** before they start: `totalScores: 0`, leaderboards return `No Scores Available`, and metadata is already available. They keep only recent history: races 9, bosses 8, CT 8, odyssey 14, events 15, daily challenges 17 items, about 2–3 months. **Older events vanish from the API**, so history has to be archived locally.

## 5. Endpoints

`openapi.yaml` has every field and type. This section covers the meaning of each endpoint and what the official docs get wrong.

### Events and lists

| Path | Body | Notes |
|---|---|---|
| `/btd6/races` | `Race[]` | Newest first. Accepts undocumented `?id=<raceID>` → 1-item list |
| `/btd6/bosses` | `Boss[]` | Newest first. `?id=<bossID>` works. `scoringType` is deprecated; use `normalScoringType` / `eliteScoringType` ∈ `LeastCash`, `GameTime`, `LeastTiers` |
| `/btd6/ct` | `CT[]` | Newest first. Includes the next CT before it starts |
| `/btd6/odyssey` | `Odyssey[]` | Newest first. `?id=<odysseyID>` works |
| `/btd6/events` | `Event[]` | All in-game events. `type` ∈ `bossBloon`, `bossRush`, `collectableEvent`, `ct`, `odysseyEvent`, `raceEvent`, `socialseason` (open set). `url` is `null` or a `?id=` list URL (for example `/btd6/races?id=…`). `name` is generic ("A Boss Event") |

### Event details

| Path | Body | Notes |
|---|---|---|
| `/btd6/races/:raceID/metadata` | `ChallengeDocument` | The race ruleset |
| `/btd6/races/:raceID/leaderboard` | `RaceLeaderboardEntry[]` | 50/page. `score` = finish time in ms. `scoreParts`: `Game Time` (time), `Time after event start` (time) |
| `/btd6/bosses/:bossID/metadata/:difficulty` | `ChallengeDocument` | `difficulty` ∈ `standard`, `elite` (anything else → `Invalid boss difficulty`) |
| `/btd6/bosses/:bossID/leaderboard/:type/:teamSize` | `BossLeaderboardEntry[]` | `type` ∈ `standard`, `elite`. **`teamSize` 1–4 all work** (the docs claim only 1). Co-op boards list each teammate as a separate row with the same score. `score` is the primary ranking value, **not always milliseconds**: for LeastCash it was the Boss Tier (5). Tie-breakers are in `scoreParts`, for example `[Boss Tier (number), Least Cash (number), Game Time (time)]` |
| `/btd6/ct/:ctID/tiles` | `{ id, tiles: CTTile[] }` | 169 tiles observed. Tile `type` ∈ `Regular`, `Banner`, `TeamFirstCapture`, `TeamStart`, `Relic - <RelicName>`. `gameType` ∈ `LeastCash`, `LeastTiers`, `Race`, `Boss`, `TeamStart` |
| `/btd6/ct/:ctID/leaderboard/player` | `CTPlayerEntry[]` | 25/page |
| `/btd6/ct/:ctID/leaderboard/team` | `CTTeamEntry[]` | 25/page. `profile` is a **guild** URL; `group` links to the group leaderboard |
| `/btd6/ct/:ctID/leaderboard/group/:groupID` | `CTTeamEntry[]` | The team's CT group (single page). **Groups disappear 2–3 days after the CT ends**: still served ~20 h after the end (2026-09-24), but on 2026-09-25 the team board linked every team to the placeholder `group/c7fa4bd7`, which answers `No Group Available` |
| `/btd6/odyssey/:odysseyID/:difficulty` | `OdysseyMetadata` | `difficulty` ∈ `easy`, `medium`, `hard` |
| `/btd6/odyssey/:odysseyID/:difficulty/maps` | `ChallengeDocument[]` | One per odyssey island. `_towers` is **`null`** here. `_powers` may be `[]` |

### Players and teams

| Path | Body | Notes |
|---|---|---|
| `/btd6/users/:userID` | `UserProfile` | Accepts an encrypted ID **or an OAK**. `achievements` is a **number** (docs say string). Map-like objects (`towersPlaced`, `heroesPlaced`, `stats.*ByName`) have dynamic keys that grow when NK adds towers or heroes. `stats.heroesPlacedByName` can contain an empty-string key |
| `/btd6/guild/:guildID` | `Guild` | `status` ∈ `OPEN`, `FILTERED`, `CLOSED`, `DISBANDED`. `CtBadges` is a map `badgeId → { id, url }` |
| `/btd6/save/:oakID` | `UserSave` | **Private player data. Requires the player's OAK.** No live sample was captured, so the schema comes from the official docs only. **Never proxy or cache it server-side** (§6.4) |

### Player-made content

| Path | Body | Notes |
|---|---|---|
| `/btd6/challenges` | `{type, challenges}[]` | Filter types: `newest`, `trending`, `daily` |
| `/btd6/challenges/filter/:challengeFilter` | `ChallengeSummary[]` | 25/page. `creator` can be `null` (daily challenges) |
| `/btd6/challenges/challenge/:challengeID` | `ChallengeDocument` | Includes live counters (`plays`, `wins`, `upvotes`, …) |
| `/btd6/maps` | `{type, maps}[]` | Filter types: `newest`, `trending`, `mostLiked` |
| `/btd6/maps/filter/:mapFilter` | `MapSummary[]` | 25/page |
| `/btd6/maps/map/:mapID` | `MapDocument` | `map` is always `CustomMap`. `mapURL` → the preview endpoint below |
| `/btd6/maps/map/:mapID/preview` | **`image/jpg`** | Undocumented. Map preview image (40–47 KB observed) |

### `ChallengeDocument`: the shared ruleset shape

Race metadata, boss metadata, challenges and odyssey islands all use this shape.

- For **NK events** (boss, race, odyssey) the document has placeholders: `id: "n/a"`, `createdAt: 0`, `gameVersion: "0"`, `creator: null`, and **every counter is 0**. Once published, an event document never changes (§6).
- For **player challenges**, the counters are live and keep changing.
- `noContinues` is a **boolean** (the docs say number).
- `abilityCooldownReductionMultiplier` can be fractional (`0.05`).
- `roundSets`: observed `default` and boss-specific values like `vortex`.
- `mode` is an open set. Observed: `Standard`, `Reverse`, `Impoppable`, `DoubleMoabHealth`, `Apopalypse`.
- `_bloonModifiers` has these fields: `speedMultiplier`, `moabSpeedMultiplier`, `bossSpeedMultiplier`, `regrowRateMultiplier`, `healthMultipliers {bloons, moabs, boss}`, `allCamo`, `allRegen`, and optional `allFortified`.
- `_powers[]` = `{ power, max }`, where `max: -1` means unlimited.
- `_towers[]` = `{ tower, max, path1NumBlockedTiers, path2NumBlockedTiers, path3NumBlockedTiers, isHero, restrictParagon? }`:
  - `max`: `0` = banned, `-1` = unlimited, `N` = limit of N.
  - `pathKNumBlockedTiers` is *inferred* to be the number of top tiers blocked on path K: `0` = none blocked, `2` = tiers 4–5 blocked, `3` = tiers 3–5 blocked. `-1` was observed once (Banana Farm path 2 in a race) and probably means the whole path is blocked. **Unverified; confirm in-game before relying on it.**
  - `ChosenPrimaryHero` is a pseudo-entry for "whatever hero the player has selected".
  - Tower IDs are internal names (`DartMonkey`, `DanDMonke`, `Skywarden`, …). The observed set is in `openapi.yaml` under `x-known-values`.

### Discrepancies with the official docs (summary)

1. Boss leaderboards support team sizes **1–4**, not only 1.
2. Errors are **HTTP 200** with `success: false`.
3. The envelope has `model` and, on leaderboards, `maxPages`.
4. Race leaderboards return **50** rows per page. Every leaderboard stops at **1000** rows.
5. `?id=` filters work on `/btd6/races`, `/btd6/bosses` and `/btd6/odyssey`.
6. `/btd6/maps/map/:id/preview` exists and returns a JPEG.
7. `?pretty=true` returns HTML.
8. Type corrections: `noContinues` is boolean. `UserProfile.achievements` is a number. The boss leaderboard's `score` isn't always ms. `_towers` can be `null`.
9. `/btd6/events` has more `type` values than documented.

---

## 6. Cache policy ("cache everything, as long as it can possibly be valid")

Every route in `src/nk/routes.ts` has a **cache class**. The Worker and the service worker both apply these classes. Most classes depend on event timing (`start`/`end` from the list endpoints), because an event's data **freezes** once the event ends.

Terms:
- **fresh**: serve without revalidating.
- **stale**: serve instantly *and* revalidate in the background (stale-while-revalidate).
- **frozen**: immutable. Stored permanently in the archive (D1, `responses.frozen = 1`) and served with `Cache-Control: public, max-age=31536000, immutable`.

Polling faster than **5 min** is pointless: the origin's own Cloudflare cache holds each object for 300 s.

| Class | Routes | Fresh | Stale window | Freeze rule |
|---|---|---|---|---|
| `static` | `/btd6/challenges`, `/btd6/maps` | 7 d | 365 d | – |
| `list` | `/btd6/races`, `/btd6/bosses`, `/btd6/ct`, `/btd6/odyssey`, `/btd6/events` | 5 min | 30 d | – (the cron job also refreshes right after every `start`/`end` boundary) |
| `feed` | `/btd6/{challenges,maps}/filter/:f` | 5 min | 7 d | – |
| `event-doc` | boss metadata, race metadata, odyssey metadata and maps, CT tiles | 1 h before `end` | 30 d | **Frozen at `end`** (counters are always 0, so nothing moves) |
| `leaderboard` | boss (all types/sizes/pages), race, CT player/team/group | 5 min while live; 1 h in the grace period | **5 min while live**; 1 d in the grace period | Before `start`: don't call the origin; answer `No Scores Available` locally. **Frozen at `end + 24 h`**: re-snapshot once, then immutable. The grace period is an assumption, in case NK removes cheaters after the event; tune it if frozen boards turn out to differ. **A copy fetched before `end + 5 min` is never served as final** in the grace period, nor one fetched before `end + 24 h` once frozen (`validFrom`, §6.6): it's refetched in the foreground, and the old copy is served only if that fails |
| `ugc-doc` | `/btd6/challenges/challenge/:id`, `/btd6/maps/map/:id` | 1 h | 30 d | – (the ruleset is immutable but counters are live) |
| `profile` | `/btd6/users/:id`, `/btd6/guild/:id` | 15 min | 30 d | – |
| `image` | `/btd6/maps/map/:id/preview` | 30 d | 365 d | – |
| `private` | `/btd6/save/:oak`, and `/btd6/users/:x` when `x` isn't a 48-hex ID (it's an OAK) | **never cached, never proxied** | – | – |

### 6.1 Negative caching

| Upstream result | Cached as |
|---|---|
| `No Scores Available` for an event whose `start` is in the future | Until `start` |
| `No Scores Available` for a page beyond `maxPages` | Can't happen: pages are validated locally against the `maxPages` of page 1 |
| `No … with that ID exists`, `Invalid user ID…`, `Invalid map ID`, `No Group Available` | 1 h (stops junk IDs from reaching the origin repeatedly). Event IDs are validated by shape only, so a well-formed junk event ID reaches NK at most once per hour |
| `Invalid boss difficulty`, `Invalid team size`, `Invalid filter type` | Never sent upstream: `routes.ts` rejects them locally |

### 6.2 Request normalisation (the cache key)

- Path only, plus `page` when `page ≥ 2`. Drop every other query parameter (including `pretty`).
- Clamp `page` to the route's `maxPages` (boss/CT 40, race 20). The `id` list filter is served from the cached full list, never from the origin.
- Strip `model` from stored bodies. Keep `maxPages`, `next` and `prev`.

### 6.3 Prewarm and archive budget

- The **hot set** is checked by cron **every minute**. A key is re-requested once NK's own CDN copy has expired (`max-age` − `Age` from the previous response), and no sooner than its class's floor (`MIN_REFETCH_MS` in `src/worker/hot.ts`):
  - live leaderboards: NK's expiry only. NK's CDN often answers with `Age` > `max-age`, which clamps the expiry to 60 s, so in practice every 1–2 minutes;
  - lists and the daily feed: every 5 minutes (featured events switch on their start/end times, which are known in advance);
  - the daily challenge document: every 15 minutes (its win rate moves);
  - rules, odyssey islands and maps, CT tiles (`event-doc`): hourly, since they don't change during an event;
  - an ended event's boards: hourly once fetched after its end + 5 min (final).

  At most 5 keys the cron already holds are asked per run, most overdue first; the rest wait a minute (`REFRESH_CAP`). Each request costs ~0.6 ms of Worker CPU, and keys tend to expire together, so this spreads them out. Keys it doesn't hold yet are always fetched. A simulated day (`test/worker.test.ts`) costs ~2,800 NK requests instead of ~20,700 at NK's expiry alone. Requests are conditional (`If-None-Match`).

  **Working state (migration 0004).** The cron never parses or rewrites the whole bundle, which costs 10–25 ms of CPU against the 10 ms limit. Instead:
  - `hot_state.meta` is a small index. For each key it holds the fetch time, CDN expiry and ETag, plus what the cron derives from the body when it arrives: event timings, daily ids and page-1 profile keys.
  - `hot_entries` holds one row per body, written only when NK sends a new one.

  A 304 changes only the index. Publishing to KV splices the stored body texts into one bundle, at most every 2 minutes (≤ 720 of the 1,000 free writes/day), plus a heartbeat every 10 minutes.

  **Bundle format (`/api/now`, KV `hot:v1`).** Plain JSON for the browser, with a trailing `index` of `[start, length, fetchedAt, ok, etag]` per key. Its offset is a fixed-width field at the start: `{"v":2,"ix":"0000123456",…`. The Worker reads one entry as a substring of the text; only the few-KB index is ever parsed. A v1 bundle (no index) is still read, by parsing it once.

  The set (~30 keys):
  - the 5 lists (`list` class)
  - for the current boss: 2 metadata + 8 leaderboards (standard/elite × team sizes 1–4, page 1)
  - for the current race: metadata + leaderboard page 1
  - for the current CT: tiles + player/team page 1
  - for the current odyssey: 3 metadata + 3 maps
  - `challenges/filter/daily` and its newest document
- The **archive**, when an event freezes, costs at most 1000 rows per board:
  - boss: 2 × (40 + ≤40 + ≤40 + ≤40) ≤ 320 pages
  - race: 20 pages
  - CT: 80 pages plus tiles

  The archive cron runs **hourly** with ≤ 45 requests (under the 50-subrequest cap). Pages a visitor opens are frozen on the spot by the proxy anyway, so the archiver only fills in what nobody asked for. That's roughly **400 requests per week** in total: negligible load, and full history forever.

### 6.4 Private data (OAK)

An OAK grants access to a player's save. The proxy **only accepts 48-hex user IDs**, so an OAK can never pass through or be logged by the server. Features that need `/btd6/save/:oak` call `data.ninjakiwi.com` **directly from the browser** (CORS allows it) and keep the key client-side only.

### 6.5 Origin budget and degradation

These rules protect NK (and the free-plan quotas) from abuse, and keep the site serving when Cloudflare storage is unavailable. They live in `src/worker/limit.ts` and `src/worker/proxy.ts`.

- **Only origin fetches are budgeted.** Cache hits (memory, hot bundle, D1) never touch a limiter.
- **Per request:** at most 20 origin fetches, foreground misses and background revalidations together, which is well under the 50-subrequest cap. A background revalidation beyond the cap is skipped; the stale copy is still served.
- **Per client** (`CF-Connecting-IP`, IPv6 per /64): a token bucket of 100 origin fetches refilled at 100 per minute, kept in isolate memory. An uncached leaderboard page of profiles is 25 fetches.
- **Optional:** the Workers Rate Limiting binding `ORIGIN_LIMITER` (100 per 60 s per client, per Cloudflare location). It is consulted after the local bucket, only on misses, and fails open.
- **A refused miss** is a 429 with `Retry-After` (in a batch: a line with `s: 429`, `c: "LIMITED"`, `a` = seconds to wait). If any older copy is cached, it is served instead, as with stale-if-error. Joining a fetch already in flight for the same key is free, and a refused client never makes another client's request fail.
- **Hot-bundle copies kept in isolate memory** keep the cron's grace period (`HOT_STALL_MS`, 15 min), so the proxy doesn't refetch keys the cron maintains. A stale memory copy is first checked against D1, where another isolate may have refreshed it, before the origin is asked.
- **KV / D1 failures** (for example, a daily quota exhausted):
  - A failed read counts as a miss. A failed write is skipped.
  - While D1 can't be read, an upstream *error* is served but neither remembered nor frozen, because the archive may hold the real data.
  - If KV can't be read, the hot bundle is rebuilt from D1 (`hot_state.meta` + `hot_entries`).
  - The hot cron keeps `hot_state` dirty until a KV publish succeeds. If its D1 write fails, it keeps the new state (index and new bodies) in the isolate, so NK isn't asked again early and KV isn't written twice, and it resyncs D1 next run. If it can't read the bodies it needs to publish, it doesn't publish a partial bundle; it stays dirty and retries. If D1 can't be read and nothing is in memory, it skips the run: the KV budget can't be enforced without the last publish time.
  - The archive cron stops fetching after the first failed D1 write. Queue rows are only deleted together with their frozen write, so the next run resumes where it stopped.

### 6.6 Why a CT group page could disagree with the team board (item 9, 2026-09-25)

Report: team `PINK` showed **257,650** on the CT `mtv62zza` team board and **257,590** on its group page.

- **Not an NK discrepancy.** NK's final board says 257,650 (the 2026-09-24 fixture and a live check on 2026-09-25 agree), and on 2026-09-24 NK's group page for the #1 team matched the board exactly (291,810 both).
- **Our caching.** Team board page 1 is in the hot set (refreshed by the cron every NK CDN period) and was archived after the freeze. A group page is only fetched when someone opens it. A copy fetched while the CT was live was then (a) served stale-while-revalidate for up to a day, and (b) after `end + 24 h` served under the frozen policy, with `immutable` browser caching, because only its age was checked, not *when* it was fetched. A copy fetched shortly before the end therefore became the "final" group score.
- **Fix** (`routes.ts`: `validFrom`, `LIVE_LEADERBOARD`): live leaderboards serve stale-while-revalidate for 5 min only, then refresh in the foreground; a copy fetched before the end (grace period) or before the freeze point (frozen) is refetched before it's served as final. Budget-neutral: every stale view already cost one origin fetch (in the background), and each key is still fetched at most once per NK CDN period.
- **Residual:** NK's CDN caches both endpoints independently for 300 s, so during a live CT they can differ by up to ~5 minutes of scoring whatever we do. For `mtv62zza` NK has dropped the groups (`No Group Available`), so a group copy we already hold stays the last one NK gave us (it's frozen rather than replaced by the error).

## 7. The Worker's own API

Served by `src/worker/app.ts` next to the NK mirror (`/api/nk/<btd6 path>`, `/api/batch`).

### 7.1 Error JSON

NK's own error envelopes (`{"error":"No Scores Available","success":false}`, …) pass through unchanged, with the HTTP 200 NK sends. Errors produced by the Worker itself have a short, user-facing message a page can show as is, the real HTTP status, and a machine-readable `code`:

```json
{ "success": false, "error": "Not found", "code": "not_found" }
```

| `code` | Status | `error` | When |
|---|---|---|---|
| `not_found` | 404 | `Not found` | Unknown `/api` path, a `/btd6` path no route matches (or an ID of the wrong shape), page beyond `maxPages`, invalid guild ID in `/api/history/team/:id`. `No preview` for a missing map preview |
| `private` | 403 | `This data is private` | `/btd6/save/*`, `/btd6/users/<non-48-hex>` (an OAK: never proxied, §6.4) |
| `bad_request` | 400 | `Invalid request` | Non-integer `page`, bad `before`/`limit`, bad batch keys, images in a batch, no `k=` |
| `rate_limited` | 429 | `Too many requests, try again shortly` | Origin budget refused (§6.5). Also `retryAfter` (seconds) and a `Retry-After` header; in a batch line, `a` |
| `upstream` | 502 | `Ninja Kiwi's servers aren't responding` | NK unreachable / HTTP error and no cached copy |
| `unavailable` | 503 | `Temporarily unavailable` (`/api/now` before the first cron run: `Starting up, try again in a minute`) | D1 read failure, unexpected error |
| `method_not_allowed` | 405 | `Method not allowed` | Anything but GET / HEAD |
| `internal` | 502 (batch line) | `Something went wrong` | A batch key failed unexpectedly |

In `/api/batch`, each line's `b` carries the same object and `s` the status.

### 7.2 `GET /api/history/team/:guildId`

A team's Contested Territory results, **newest CT first**, built only from data already in D1, never from an NK request. `guildId` is the 48-hex guild ID (anything else: 404 `not_found`). An unknown team gets `200` with empty `entries`.

```json
{
  "team": "9fb9168a8a94f1a449458c4a0a25e522cf021ab59f41df39",
  "entries": [
    { "ct": "mtv62zza", "start": 1789509600000, "end": 1790114400000,
      "rank": 1, "total": 4780, "score": 291810, "group": { "rank": 1, "of": 4 } }
  ]
}
```

| Field | Meaning |
|---|---|
| `rank` | Position on the global team board (frozen archive, top 1,000 only); `null` if the team isn't on it or the CT isn't archived yet |
| `total` | Teams that scored in that CT (`totalScores_team` of the CT list item), or `null` |
| `score` | Final team score: from the board, or from the group page for teams outside the top 1,000 |
| `group` | `{rank, of}` in its CT group, or `null` when no final group page is stored. Group pages aren't archived (NK drops them 2–3 days after the end); one is recorded when a visitor opens it after the CT ended |

Source: the `ct_teams` table (`migrations/0003_ct_teams.sql`, which also backfills from boards already archived), written when a frozen team-board page or a post-event group page is stored (`src/worker/teams.ts`). One indexed query per request, ≤ 200 entries; ≤ 1,000 extra row writes per CT. `Cache-Control: public, max-age=300, stale-while-revalidate=86400`.

### 7.3 Link previews (Open Graph / Twitter tags)

Page loads of `/`, `/bosses`, `/races`, `/ct`, `/odyssey`, `/events`, `/boss/*`, `/race/*`, `/ct/*`, `/odyssey/*`, `/player/*`, `/team/*` and `/challenge/*` run the Worker first (`wrangler.jsonc` `run_worker_first`). It serves the SPA shell (`index.html` from the `ASSETS` binding) with a route-specific `<title>`, `description`, `og:*` and `twitter:*` tags (`src/worker/og.ts`); the shell's own `og:`/`twitter:` tags are replaced.

- Only cached data: isolate memory, the hot bundle if this isolate already holds it, one D1 row (`events` for event pages; `responses` for players, teams, challenges and race maps). **Never an NK request**: nothing cached means generic tags. Lookups are capped at 300 ms.
- Images are NK's own asset URLs: boss portrait (`bossTypeURL`), race/challenge map (`mapURL`, large card), player avatar, team icon. Otherwise no image (`SITE_IMAGE` in og.ts is `null` until the site has one).
- Everything else (`/assets/*`, `/art/*`, `sw.js`, fonts, images) is still served by Cloudflare without invoking the Worker. The cost is one Worker request per full page load of those URLs (the SPA navigates client-side afterwards).
