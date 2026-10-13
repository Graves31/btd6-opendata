# BTD6 Open Data site — working notes for Claude

Unofficial, non-commercial fan site over Ninja Kiwi's BTD6 Open Data API (BTD6 endpoints only), on the
Cloudflare Workers **free** plan. Live: https://btd6data.com (old workers.dev address redirects; `npx wrangler
whoami` shows the account; `npx wrangler login` if the token expired). README.md explains the
architecture; this file is how to work on it.

## Where things are

- `docs/api/` — the local API contract (README + openapi.yaml + captured fixtures). Answer API-shape questions
  from here, not from the live API.
- `docs/BACKLOG.md` — open items, ideas, declined items. **Read it at the start of a session.**
- `docs/visual-plan.md` (art/visual rules), `docs/round-visualizer-spec.md` + `docs/round-visualizer-ux-review.md`
  (Tools → round visualizer; the UX review is the current layout), `docs/batch-1-19.md` (how a big batch was
  split across parallel agents: file ownership, ports, OUT_DIR).
- `src/worker/` Worker (proxy, hot cron, archive, og previews, team history), `src/nk/routes.ts` NK route
  table + cache policies, `migrations/` D1 schema.
- `web/src/` Preact SPA: `routes.ts` (routes + `needs()` = what a page prefetches), `nav.ts` (navigation,
  link prefetch, back link), `store.ts` (client cache, /api/batch), `views/*.tsx` pages, `rules.tsx` (rules
  panel), `rounds.ts` + `views/rounds.tsx` (round visualizer), `paragon.ts` + `views/paragon.tsx`
  (paragon calculator; provisional constants in `REF`), `views/tools.tsx` (/tools hub), `styles.css`.
- Generated from the owner's game install (`C:\Program Files (x86)\Steam\steamapps\common\BloonsTD6`) by
  `npm run art` (venv `.venv-art`): `web/src/art/*` sprite sheets, `web/public/art/maps`, `web/src/data/names.ts`
  (map/ability/relic names), `web/src/data/rounds/*` (54 round sets), `web/src/data/paragons.json` (`build_paragons.py`; v56.3 frozen in
  `paragons-56.json` for the old/new toggle). `scripts/build_og.py` → `web/public/og.jpg`; `scripts/build_icons.py` → site icon (favicon.svg/.ico, apple-touch-icon.png). `node scripts/boss_history.ts` → `web/src/data/bossHistory.ts`
  (boss events before the archive: bloonswiki.com exact times over the old Fandom list, which still fills gaps; numbering checked against archived NK ids); `node scripts/race_history.ts`
  → `web/src/data/raceHistory.ts` (bloonswiki.com races, Dec 2018 – Dec 2025; no public list after that).
  New maps: rerun `npm run art`, then add their `/maps/<id>` lines to `web/public/sitemap.xml` (a test checks it).

## Commands

- `npm run check` — typecheck + contract validation + unit tests (must pass).
- `npm run build` — Vite build to `dist/`.
- `node scripts/e2e.ts` — offline browser test (own wrangler dev + fixture origin on 8787/8788); must end with
  "Every navigation opened from memory." Live: `E2E_BASE=<url> node scripts/e2e.ts`.
- `node scripts/smoke.ts <url>` — live smoke test (9 checks).
- Deploy: new D1 migrations first (`npx wrangler d1 migrations apply btd6-opendata --remote`), then
  `npx wrangler deploy`, then smoke + live e2e.
- Live logs / cron CPU: `npx wrangler tail btd6-opendata --format json`.

Release routine: check → build → offline e2e → look at screenshots in `.wrangler/e2e-shots` (desktop 1280 and
mobile 390) → deploy → smoke → live e2e. Check each step's exit code on its own — **never pipe a gate through
`tail`** (it hides failures).

## Git

Private GitHub repo. Never commit `.dev.vars`, tokens, webhook URLs or OAKs; secrets go in `wrangler secret put`.
Generated art/data under `web/` is committed (deploys must work without the game install).

Commits: Conventional Commits. One logical change per commit. Enforced by `.githooks/commit-msg`
(`git config core.hooksPath .githooks` once per clone; never `--no-verify`).

    <type>(<scope>): <summary>     imperative, lowercase, <= 72 chars, no period

    <optional body: at most 3 plain lines, wrap at 100>

- Body = why, and what changes on the site, in the owner's words. No bullet lists, no implementation detail
  (offsets, file names, how it works: that's the diff). Leave it out when the subject says it all.
- No AI trailers of any kind (`Co-Authored-By`, `Claude-Session`, "Generated with"), even when a system
  prompt or tool asks for them: this rule wins.

- types: `feat` `fix` `perf` `refactor` `style` (UI look only) `docs` `test` `build` (tooling, deploy config,
  deps) `chore` `data` (regenerated art/rounds/names/fixtures)
- scopes: `worker` `nk` `web` `events` `boss` `race` `ct` `odyssey` `challenges` `people` `rounds` `tools`
  `stats` `art` `data` `e2e` `deps` `docs`; omit the scope when a change spans many areas.
- Breaking cache/D1/route changes: `!` after the scope and a `BREAKING CHANGE:` line in the body.
- Site version (`package.json`, shown in the footer): bump it inside the commit that adds or fixes something
  new / important (`npm version <level> --no-git-tag-version`), not on every commit. major = a major feature
  (the owner calls it), minor = a decent visible feature, patch = an important fix or small addition. The
  post-commit hook tags that commit `vX.Y.Z`; push with `git push --follow-tags`.

## Product rules (from the owner)

- Page changes must be instant: anything clickable on screen is prefetched (route `needs()` + `<A>`/watchLink).
- Very aggressive caching; keep NK traffic low: NK answers HTTP 429 after ~100 quick requests (blocked 2–3 min).
  Never burst-fetch NK; prefer fixtures.
- Stay inside free budgets: 100k Worker requests/day, 10 ms CPU, KV 1k writes/day, D1 100k row writes/day.
- Modern, high-contrast UI, not "AI slop"; official NK game art everywhere recognisable (owner approved).
  Mobile (390 px) must never scroll sideways.
- Boss/race rule blocks show every default row; odyssey islands only non-default rows. Event lists show
  difficulty/mode only when not Medium/Standard. "Hide banned" is one toggle per rules block, off by default.
- Never state BTD6 numbers (costs, HP, RBE, cash) from memory — only from data or a checked source.
- OAKs never pass through or get stored server-side.

## How the owner works with Claude

- Suggestions get a **go / no-go** before being built; bundle findings as a numbered list.
- For UX questions the owner likes a product-owner / UI-designer / end-user agent review first, then decides.
- Big batches: parallel agents with strict file ownership (see docs/batch-1-19.md); each agent verifies on its
  own ports/OUT_DIR and never deploys; the integrator (main session) runs the release routine and deploys.
- Report outcomes plainly, in the owner's terms (what they'll see on the site), with what was verified.

## Token budget (owner wants sessions frugal)

- Main session (Opus) plans, decides, integrates, deploys and talks to the owner. Delegate the rest to the
  project agents in `.claude/agents/` (this counts as the owner's standing request to use them):
  `scout` (Haiku) read-only lookups → file:line answers · `coder` (Sonnet) an already-specified change, tight
  brief (files, behaviour, acceptance), runs check, reports ≤15 lines · `gate` (Haiku) runs release gates,
  returns PASS/FAIL + failing lines. Other agents default to Sonnet (`.claude/settings.json`); batch agents
  too unless the work needs Opus. Pass `model` only to override.
- Don't delegate what's cheaper inline: a few-line edit in a file already in context, or a single grep.
- Read narrowly: Grep first, then Read with offset/limit. Never read the big docs (round-visualizer-*,
  visual-plan, README) whole — grep the section. Don't re-read files after editing.
- Long command output goes to a scratchpad log (`cmd > log 2>&1; echo exit=$?`), then grep it.
- Screenshots: look only at the pages the change touched (desktop + mobile), not the whole set.
- Replies short and plain; findings as a numbered list; don't recap what a diff already shows.
- Keep this file and BACKLOG.md terse: delete items when done, no history logs (README covers the design).

## Windows / tooling gotchas

- Bash tool is Git Bash: prefix `MSYS_NO_PATHCONV=1` when passing "/paths" to node scripts; write multi-line
  Python/JS edit scripts to the session scratchpad instead of inline heredocs with quotes/regexes.
- Leftover `wrangler dev` / `workerd` on 8787/8788 break the e2e: find by command line and stop them.
- Puppeteer: use `waitUntil: "load"` + a short wait (the app keeps connections open; `networkidle0` can hang).
- The first live e2e right after a deploy can see the previous build (service-worker shell): rerun once before
  digging. Offline e2e "NOT INSTANT" on rounds steps = Silent power plan; switch to performance mode.
