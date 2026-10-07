# Backlog

Open items, newest decisions first. The owner gives go / no-go on each before it's built.
Status: **later** = agreed, not scheduled · **idea** = not yet approved · **declined** = owner said no (for now).

## Later (agreed)

- **Paragon calculator: v57 paragon power rework.** When v57 ships (the wiki flags v57.0 as reworking paragon power),
  add an old/new calculation toggle on /tools/paragon. Before running `npm run art` on v57, freeze the v56.3
  `web/src/data/paragons.json` as its own file (e.g. `paragons-56.json`) and version the formula block in
  `web/src/paragon.ts`; re-verify totem power and the formulas against the new game code.

- **UI audit follow-ups (fixes deployed 2026-09-30, version 89a3822d).** Objective findings from the six reports in `.audit/`
  fixed by 4 parallel agents + a CSS fold pass (layers merged into styles.css; pre-fold copy in
  `.audit/styles.before.css`). Owner decisions built: boss difficulty is "Normal" everywhere, #3 plate bronze,
  neutral row-hover edge. Left for a small TSX pass: `theme.tsx`/`index.html` always set `data-theme` (css#2, so the
  light theme stops being written twice), `Emblem` inline size (css#6), `Rank` `plate bare` (css#7), dead
  `ScoringPair` `compact` prop; interaction#24 (CT history can't link a group: archive has no group id).
- **Stats page follow-ups** (hidden `/stats`, live 2026-10-01). Check after a few days of data: 7-day totals
  came back smaller than the same-day 30-day totals (t7 3/1 vs t30 10/10), so likely sampling; if it persists,
  derive d7 from the daily series. Countries show ISO codes ("FR"); map via `Intl.DisplayNames`. Mobile chart
  axis labels are tiny.
- **Daily challenges list: map art on every row** (2026-09-27). Older dailies show an empty grey well until
  hovered, because the map comes from each daily's challenge document, loaded on link intent. Fix = load the
  documents of the rows on screen when the list opens: one NK request per daily, fetched once and cached for
  good (dailies never change).
- **Round visualizer, later items** (docs/round-visualizer-ux-review.md "Later"): `n`/`p` next/prev-match
  shortcuts, filters shown in the tab title, "Up next" = next matches when a filter is on, Edit-panel state in
  the URL, link previews for /tools pages with the set name, heaviest-rounds labels.

- **Boss history gap** (2026-10-04). Boss stats "Past events" lists the wiki's events up to week 246 (1 Apr 2026);
  Apr–Jul 2026 (incl. Diamondback #1–#6) show as "not on record yet". Rerun `node scripts/boss_history.ts` once the
  Bloons Wiki has its "Version 54.0" list page (the script picks new version pages up by itself).

## Ideas (not approved)

- **Art pipeline: fresh vs cached run differ** (2026-10-03). After the BOSS_UI_VERSION bump, the first
  `build_art.py --skip-maps` run (rebuilding the BossUi cache) wrote index.ts/manifest.json with different hashes
  than the following cached runs (those are identical). Find what differs before the next game-patch rebuild.

- **Boss stats page: Lych soul / tombstone icons** (2026-10-02). Their bloon models have no usable icon (soul: none,
  tombstone: the ZOMG icon), so the page shows text chips. Unused game sprites that might fit, for the owner to pick
  by eye: ref/LychSoulDroplet, ref/GraveGrey, scene/GraveGhost. Boss-tier → spawn-level pairing and spawn counts are
  not decoded (game behaviours, not data).

- **Boss page header, option B** (kept as a fallback, 2026-09-30). The owner chose option A (Normal/Elite tabs form
  the top edge of the details card; the card shows only the selected difficulty). Option B, if A doesn't work out:
  keep the strip and the separate Normal/Elite + Solo–4P row; the strip shows the selected difficulty only (one
  bigger scoring, map, rounds) and drops entries (the tab shows the count).
- **Game-style identity** (UI audit, 2026-09-30; owner: "for later"). The visual designer's "Bigger ideas" A–E in
  `.audit/visual.md` (from l.344): chunky game-style buttons for controls, outlined game-style numerals for hero
  figures, game icons instead of caps labels, a "blue sky" light theme, ribbon-shaped podium plates. Each needs the
  owner's go before it's built; a mock-up per idea first.
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
- "Max 3 each" roster headers / ×N plates / folding banned towers: owner wants in-game-style tiles instead.

## Known limitations (by design)

- NK publishes only the top 1,000 per board; CT groups disappear a few days after a CT ends.
- Co-op ranks are exact only when earlier pages are in memory (else "≈N", no medal).
- Round data has no cash per round and no boss spawn timing (game code, not data).
- Dailies: a numbered daily counts as started at 08:00 UTC on its date (`DAILY_START_H`, owner saw 10:00 CEST in
  game, 2026-10-07). NK publishes no start time; if it shifts to 09:00 CEST in winter, NK follows DST.
