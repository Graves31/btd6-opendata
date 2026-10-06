# Batch 1–19: coordination (4 parallel agents)

Each agent owns files. Do NOT edit files owned by another agent; if you need a change there, write it in
your final report under "Requests for other owners" (the integrator applies it).

## Shared contracts

- `web/src/data/names.ts` — `MAP_NAMES`, `ABILITY_NAMES`, `RELIC_INFO {name, description}`. Shape is fixed;
  the Data agent fills it (generated). Front-end agents import it and must fall back gracefully when a key is
  missing (humanised id).
- `GET /api/history/team/:guildId` (Backend) → JSON
  `{ "team": string, "entries": [{ "ct": string, "start": number, "end": number, "rank": number|null, "total": number|null, "score": number|null, "group": { "rank": number|null, "of": number|null } | null }] }`
  newest first, built only from data already archived in D1 (no new NK requests). Empty `entries` when unknown.
  FE-A consumes it on the Team page CT-history section (it can read via `fetch("/api/history/team/"+id)`).
- Event IDs: any `[A-Za-z0-9_-]{4,64}` is a valid id segment (Backend loosens `src/nk/routes.ts`); web routes
  must accept the same shape.
- Keep `window.__nav` (e2e reads it) even though the visible "page opened in X ms" footer goes away.

## Ownership

| Agent | Files | Items |
|---|---|---|
| Backend | `src/**`, `test/worker.test.ts`, `test/store.test.ts`, `wrangler.jsonc`, `migrations/**`, `docs/api/**` | 1, 9 (investigate + fix/explain), 17 (OG tags via HTMLRewriter), team CT history endpoint, friendly API error JSON |
| Data | `scripts/build_art.py`, `web/src/data/names.ts`, `web/src/art.gen.*`/art outputs, `scripts/*.py` | map names, ability names, relic name+description, boss display names if in game data |
| FE-A | `web/src/views/events.tsx`, `web/src/ui.tsx`, `web/src/medals.ts`, `web/src/routes.ts` | 4, 6, 8, 10 (freshness labels), 12, 13, 14, 15 (UI), 18, 19, boss name from bossType |
| FE-B | `web/src/views/people.tsx`, `web/src/rules.tsx`, `web/src/main.tsx`, `web/src/format.ts`, `web/src/sprite.tsx`, `web/src/nav.ts`, new `web/src/views/challenges.tsx`, `index.html`, fonts | 2, 3, 5 (UI), 7, 11, 16, footer removal, odyssey non-default facts, hide-banned toggle |

`web/src/styles.css` is shared: append new rules only, inside a block headed `/* ── FE-A: … */` or
`/* ── FE-B: … */`; don't rewrite existing rules another agent may touch (edit your own blocks freely).
`test/format.test.ts`: FE-B owns; FE-A adds tests in a new `test/events.test.ts` (add it to the npm test script
only via "Requests"; the integrator will).

## Ports / build dirs (parallel-safe)

| Agent | build | e2e |
|---|---|---|
| FE-A | `OUT_DIR=../dist-a npm run build` | `E2E_PORT=8787 E2E_ORIGIN_PORT=8788 E2E_ASSETS=dist-a` |
| FE-B | `OUT_DIR=../dist-b` | `E2E_PORT=8797 E2E_ORIGIN_PORT=8798 E2E_ASSETS=dist-b` |
| Backend | `OUT_DIR=../dist-c` | `E2E_PORT=8807 E2E_ORIGIN_PORT=8808 E2E_ASSETS=dist-c` |
| Data | none needed (tsc only) | — |

Never run `npm run deploy` / `wrangler deploy` / remote D1 commands. Never hit the live NK API in bursts
(rate limit ~100 quick requests → 429 for minutes); prefer fixtures (`npm run fixture-origin`, captured data).

## Extra shared stubs (signatures fixed; owner implements)

- `web/src/views/errors.tsx` (FE-B): `NotFound({what, back?, children?})`, `ErrorPanel({status?, message?})`.
  FE-B also owns the `Gate` function inside `web/src/ui.tsx` (only that function) to route errors through these.
  FE-A uses `NotFound` for bad event ids / unknown boards in events views.
- `web/src/fresh.tsx` (FE-A): `Freshness({k, ended?, shown?, total?})` — reads `store.peek(k).fetchedAt`
  (server fetch time, ms) and renders "Updated N min ago" / "Final" / "Top 1,000 of N". FE-B places it on
  player/team/challenge pages and removes the footer in main.tsx.
- Boss display name: `bossTitle` in `web/src/format.ts` (FE-B) builds "Dreadbloon #37" / "Blastapopoulos #12"
  from bossType + number, never from NK's `name` string (misspelled). FE-A just calls it.
- Map display names: `MapLine` (rules.tsx, FE-B) and a `mapName(id)` helper exported from format.ts (FE-B)
  reading `MAP_NAMES`; FE-A calls `mapName` where it prints map names.
