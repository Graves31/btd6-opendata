# Backlog

Open items, newest decisions first. The owner gives go / no-go on each before it's built.
Status: **later** = agreed, not scheduled · **idea** = not yet approved · **declined** = owner said no (for now).

## Later (agreed)

- **Maps explorer follow-ups** (2026-10-12, owner: later if needed). (1) `/api/maps`: one cached D1 read of the
  archived boss/race/odyssey metadata maps, so map pages list every archived event (today: the wiki's bosses plus
  the events in the lists, ~11 bosses and ~11 races; odysseys not shown yet). (2) Product/UI/end-user review of
  /maps and the map page. Maps sits in the top nav; move it under Tools if the nav gets crowded.

- **Paragon calculator: re-check v57 power formulas in game code** (2026-10-07). v57 changed only three caps in the
  data (cash 60k→80k, pops 90k→125k, upgrade tiers 10k→0) and ParagonTower kept the same methods, so the v56.3
  power formulas, totem power (2,000) and cost rules are kept for v57 (toggle on /tools/paragon, `gv=56` = old).
  Cpp2IL now reads the v57 code (CLAUDE.md, tooling): the per-degree stats were checked with it on 2026-10-14;
  the power side (ParagonTower.GetTowerInvestment, cost mods, rounding) is still to check the same way.
  The ×2 on elite bosses comes from the wiki only; it isn't in GetDegreeMutator, so find where the game applies it.

- **UI audit follow-ups (fixes deployed 2026-09-30, version 89a3822d).** Objective findings from the six reports in `.audit/`
  fixed by 4 parallel agents + a CSS fold pass (layers merged into styles.css; pre-fold copy in
  `.audit/styles.before.css`). Owner decisions built: boss difficulty is "Normal" everywhere, #3 plate bronze,
  neutral row-hover edge. Left for a small TSX pass: `theme.tsx`/`index.html` always set `data-theme` (css#2, so the
  light theme stops being written twice), `Emblem` inline size (css#6), `Rank` `plate bare` (css#7), dead
  `ScoringPair` `compact` prop; interaction#24 (CT history can't link a group: archive has no group id).
- **Challenges: filter chips and sort by win rate** (2026-10-23, from the challenges review). Difficulty, map and
  hero-lock chips over the cards already loaded, plus sort by win rate (hardest / easiest first). No NK requests.
- **Challenges: "played" tick and copy-code button** (2026-10-23). A per-browser "played" mark on cards
  (localStorage), and a copy-code button on the challenge page.
- **Round visualizer, later items** (docs/round-visualizer-ux-review.md "Later"): `n`/`p` next/prev-match
  shortcuts, filters shown in the tab title, "Up next" = next matches when a filter is on, Edit-panel state in
  the URL, link previews for /tools pages with the set name, heaviest-rounds labels.

- **History: race mode/difficulty after Dec 2025**: the 2026 races came from the community list (`EVENT_LIST_BASE`
  env, never named in the repo), which has no mode/difficulty; rerun both history scripts once bloonswiki has 2026 pages.

- **IndexNow pings for new events never reach Bing** (2026-10-21). Every Worker ping to api.indexnow.org got 429 and
  was given up after 5 tries (`notifications` rows `index-*`), while the same ping from home got 200. First check
  the rows after the next new event; if still 429, ping `https://www.bing.com/indexnow` instead (notify.ts).
- **Drop the old workers.dev host from /stats** (after 2026-11-07, when its 30 days have rolled off; `STATS_HOSTS`
  in src/worker/stats.ts).

## Ideas (not approved)

- **IMF loan planner** (2026-10-16, from the bank planner review). When to take IMF loans and what the debt skim costs
  (skim % and cooldowns are wiki-only; collecting while in debt is skimmed per the game code, untested in game). Also
  unverified for the bank planner: buying mid-round, Overclock packet value, Monkey City rounding, Benjamin's range, Double Cash.
- **Paragon scaling follow-ups** (2026-10-14, from the product/UI/end-user review). A "value per 1,000 power" chart
  (what each extra degree buys for its cost) and a short explanation of the power sources on the scaling page.
- **Tools hub title card**: the /tools hub has no ToolHero (it isn't a tool); add one if the hub should match.

- **Useful / community links page** (2026-10-25, owner: later). One page listing community resources (wikis, tools,
  other fan sites). Until then no other fan site is named anywhere on the site, in the repo or in commit messages.

- **Feature gaps vs other BTD6 sites** (2026-10-09, competitor research). Each needs
  its own go:
  2. **Challenge / map code lookup**: type a code → rules, map, creator, plays/wins (`/btd6/challenges/challenge/{id}`,
     `/btd6/maps/map/{id}`); reuses the rules panel.
  3. **Boss HP calculator** by boss, tier, Elite and player count, from game data (bosses.json), never from memory.
  4. **Hero XP and tower cost calculators** across difficulties, from game data (like the paragon calculator).
  5. **Browse player-made challenges and maps** (newest / trending; `/btd6/maps/filter/{filter}`).
- **"Don't count this browser" switch on /stats** (2026-10-09; owner: not yet). Flag in localStorage; index.html
  loads the Cloudflare beacon only when it's off. Per browser, from then on (past visits stay; Web Analytics has no IPs).

- **Cheaper home page** (2026-10-07). A visit (home → boss board → races → a race) costs ~12 Worker requests, 7 of
  them on the home page (/api/now, a batch, 4 separate /api/history calls), so the free 100k/day ≈ 7–8k visits.
  Folding the history calls and /api/now into the one batch would make the home page ~2 requests.

- **Art pipeline: fresh vs cached run differ** (2026-10-03). After the BOSS_UI_VERSION bump, the first
  `build_art.py --skip-maps` run (rebuilding the BossUi cache) wrote index.ts/manifest.json with different hashes
  than the following cached runs (those are identical). Find what differs before the next game-patch rebuild.

- **Boss stats page: Lych soul / tombstone icons** (2026-10-02). Their bloon models have no usable icon (soul: none,
  tombstone: the ZOMG icon), so the page shows text chips. Unused game sprites that might fit, for the owner to pick
  by eye: ref/LychSoulDroplet, ref/GraveGrey, scene/GraveGhost. Spawn counts are not decoded (tier N spawns level N:
  checked in the data and on the wiki, pinned in test/bosses.test.ts).

- **Boss page header, option B** (kept as a fallback, 2026-09-30). The owner chose option A (Normal/Elite tabs form
  the top edge of the details card; the card shows only the selected difficulty). Option B, if A doesn't work out:
  keep the strip and the separate Normal/Elite + Solo–4P row; the strip shows the selected difficulty only (one
  bigger scoring, map, rounds) and drops entries (the tab shows the count).
- **Game-style identity** (UI audit, 2026-09-30; owner: "for later"). The visual designer's "Bigger ideas" A–E in
  `.audit/visual.md` (from l.344): chunky game-style buttons for controls, outlined game-style numerals for hero
  figures, game icons instead of caps labels, a "blue sky" light theme, ribbon-shaped podium plates. Each needs the
  owner's go before it's built; a mock-up per idea first. Tool pages already got theirs (2026-10-14): the title
  card template and game icons on stats (CLAUDE.md, product rules).
- **Search** players/teams by name (NK has no search API: only names on boards we've already loaded/archived).
- **Player boss history**: past boss placements per player from archived boards (like team CT history).
- **Name the remaining unnamed ability keys** (17 read fine as-is; see `scripts/build_names.py` output).

## Declined / on hold

- **Slower countdowns for far-off events** (tick per minute when more than a day away): owner keeps the
  per-second tick (2026-09-30, UI audit interaction#5).
- **Compact pager on desktop** ("‹ 1 / 40 ›" above boards, as on phones): owner keeps the full numbered pager on
  desktop (2026-09-30, UI audit interaction#14).
- **Archive every CT group page once at CT end** (would give team history its "1st of 4" for every CT):
  a few hundred extra NK requests per CT. On hold — owner: "for now no extra memory" (2026-09-26).
- **Compare two round sets** in the visualizer: out of scope for now (2026-09-26).
- **Search across all challenges or creators**: NK has no search, and paging the feeds would hit the 429 limit.
  The challenges search covers codes, daily numbers and the cards on the page (owner, 2026-10-23).
- "Max 3 each" roster headers / ×N plates / folding banned towers: owner wants in-game-style tiles instead.

## Known limitations (by design)

- NK publishes only the top 1,000 per board; CT groups disappear a few days after a CT ends.
- Co-op ranks are exact only when earlier pages are in memory (else "≈N", no medal).
- Round data has no cash per round and no boss spawn timing (game code, not data).
- Dailies: a numbered daily counts as started at 08:00 UTC on its date (`DAILY_START_H`, owner saw 10:00 CEST in
  game, 2026-10-07). NK publishes no start time; if it shifts to 09:00 CEST in winter, NK follows DST.
