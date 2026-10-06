# Round visualizer: product spec

Written 2026-09-26 by the product owner and a competitive-player advocate (boss, race and CT player; mobile and desktop).
Status: ready to build once the round data lands. There is no app code here.

**Goal:** a player looks at an event's rules and wants to know what bloons they will face on those rounds. One tap takes them there, with the event's set, round range and modifiers already applied. It must open instantly and look like the rest of the site, with game sprites rather than words.

**Numbers rule:** this spec contains no BTD6 numbers. Every count, time, RBE, cash or health value shown on the page comes from the extracted round data (below) or from the event's `ChallengeDocument`. Existing site code is the only other source (for example `gameDefaults()` in `web/src/rules.tsx`). If the data doesn't provide a value, the page doesn't show it and never estimates one.

---

## 1. Navigation and URL

- **Tab name: "Tools".** It says what the tab does. "Extras" reads like bonus content, and the tab will hold more utilities later. It goes last in the top nav: `Now · Bosses · Races · CT · Odyssey · Challenges · Tools`. The area is `data-area="tools"`. When the selected set is a boss set, the page also sets `data-boss=<type>` so it takes that boss's tint, as boss pages do.
- **Phones:** all seven tabs must fit on one row at 390 px. Tighten `.top nav a` padding and letter-spacing to make them fit. Never use a hamburger menu and never wrap. Below 380 px, the nav row (not the page) may scroll sideways, with the current tab scrolled into view.
- **Routes:**
  - `/tools` shows the round visualizer, since it is the only tool for now. A one-item tool strip sits above it and becomes tabs once a second tool exists.
  - `/tools/rounds` is the canonical address of the visualizer.
  - The router gets `{ name: "rounds", set, from, to, r, mods, src }`, and `needs()` returns that set's data file (§4).

`/tools/rounds?set=vortex&from=1&to=140&r=1&camo=1&mhp=1.5&src=%2Fboss%2FVortex47_mu62cmt5%3Fd%3Delite`

| Param | Meaning | Rules |
|---|---|---|
| `set` | Round-set id from the round manifest (§4) | Default `default`. An unknown id shows "We don't have this round set yet" plus a link to the default set |
| `from`, `to` | Round range | Clamped to the rounds the set defines. Swapped if reversed. Default: the whole set |
| `r` | Selected round | Clamped into the range. If absent: nothing is expanded on mobile, and `from` is shown on desktop |
| `mode` | API `mode` (`AlternateBloonsRounds`, `Apopalypse`, `Clicks`, …) | Affects which set is resolved and whether cash can be shown (§2.4) |
| `camo`, `regrow`, `fort` | `1` = the event's `allCamo` / `allRegen` / `allFortified` | Applied to sprites and notable rounds (§2.4) |
| `hp`, `mhp`, `bhp` | `healthMultipliers.bloons / moabs / boss` | Applied only where the data allows it (§2.4) |
| `spd`, `mspd`, `bspd`, `rgr` | Speed and regrow-rate multipliers | Shown as chips only |
| `src` | Site-relative path of the page that linked here | Must `parse()` to a known route, otherwise it is ignored (no open redirect). Drives the "‹ Vortex #47 Elite" back link |
| `vs` | Second set to compare against | Reserved for the "later" compare view |

Only non-default values are written into the URL. The URL is the full state, so shared links reproduce the exact view without any request to NK. The browser tab title reads `Vortex rounds 1–140 · Tools · BTD6 Open Data`.

## 2. The page

### 2.1 Controls (top of the page, both layouts)

1. **Set picker.** A select with the set's official icon, using the same `roundSetIcon`/`roundSetName` as the rules panel: a boss portrait for boss sets, the `mode:*` icon for Alternate Bloons Rounds and Fast Track, and `CustomRounds` otherwise. The game version of the data sits next to it ("Rounds from game v56.x").
2. **Range:** `from`–`to` number inputs (`inputmode="numeric"`), plus preset chips:
   - **Event**: only present when the page was reached from a link;
   - **Easy / Medium / Hard / Impoppable**: taken from `gameDefaults()`;
   - **Whole set**.
3. **Jump to round:** a number field plus ‹ › steppers. On desktop, ←/→ step through rounds and `/` focuses the field.
4. **"From the event" chips**, one per applied modifier, each with its rules-panel icon, for example `[AllCamo] Camo`, `[MoabBoost] MOAB health ×1.5`.
   - Chips the page cannot apply look muted and say "not applied" (for example `Bloon speed ×1.2 · not applied`), so the player knows it was seen and not ignored.
   - A "Base rounds" switch turns every modifier off without losing them from the URL.
5. **Overview strip:** one bar per round in the range, with height = RBE from the data. Rounds matching the active filters (§2.3) are ticked above the bars; boss-set changed rounds show as a ribbon. When the data has no RBE, the strip shows the total bloon count and labels itself that way.
   - Tapping or dragging on the strip selects a round.
   - It is a single row, 48 px tall on mobile and 64 px on desktop.

### 2.2 Round list and round detail

- **List row:**
  - round number in the display font;
  - the round's distinct bloon types as sprites, biggest first (at most 6, then "+N"), at the 24 px minimum;
  - total bloon count;
  - RBE;
  - notable pills.

  *(Superseded 2026-09-27: pills and the "Notable only" toggle were replaced by filters and boss-set markers, §2.3.)*
- **Round detail:**
  - Header: round number, ‹ › to the neighbouring rounds, and the notable pills.
  - Stats, each shown only if the data has it:
    - RBE;
    - cash this round;
    - **cash earned since round `from`** (a running sum, excluding starting cash, for Least Cash planning);
    - number of groups;
    - spawn length (the last group's end time, labelled "spawns over", never "round length").
  - **Timeline:**
    - one lane per group, sorted by start time;
    - each lane has the group's sprite (40 px on mobile, 48 px on desktop, per the visual plan), `×count`, and a bar from start to end on a shared seconds axis;
    - evenly spaced ticks inside the bar when the count is small enough to tell apart, a solid bar otherwise;
    - boss spawns are a lane with the boss portrait (`boss` family, elite portrait for elite sets).
  - **Group table** under the timeline: bloon, count, start, end. It is also the timeline's accessible text alternative.
- **Bloon art:**
  - Keys and flags use the `bloon` family's canonical keys. `build_art.py` gains a separate `bloonVariant` sheet: only the camo, regrow and fortified combinations that the round data actually uses, taken from the game's own variant sprites (the `Bloons/<Base><Variant>` sprites, like the existing `RedCamo`). The sheet is loaded only by Tools pages, so other pages don't pay for it.
  - If the game has no sprite for a combination, show the base sprite plus a text flag chip ("Camo · Regrow"). Never a made-up overlay.
  - Every sprite has an accessible name like "Camo regrow ceramic ×12", and the dark-sprite halo rules apply.

### 2.3 Filters and boss-set markers (replaced "notable rounds", 2026-09-27)

"Notable rounds" (first camo/lead/…/BAD pills and a "Notable only" toggle) were removed after owner review:
on the default set they repeated the same ten labels every time, and on boss sets they turned into a wall of
pills. See docs/round-visualizer-ux-review.md for the evidence. What replaced them:

- **Filters** (list view): chips with the game's art for Camo, Regrow, Fortified, Lead, Ceramic, MOAB-class
  (from the data's MOAB flag), plus a "Bloon ▾" menu of the types used in the range. Several filters match
  **any** of them (OR). The event's own modifiers count: when the event makes every bloon camo (or regrow /
  fortified), that chip reads "all (event)" and can't be toggled. URL: `has=` (camo, regrow, fort, lead,
  ceramic, moab, changed) and `bloon=` (bloon type ids), in a fixed order. The list header reads
  "N of M rounds · first: X", which keeps the useful part of the old "first X" labels. Old `notable=1` links
  map to `has=changed`.
- **Boss sets:** rounds the boss set changes (the data's `o: 1`) get a quiet marker, not a pill: a thin
  boss-tint left edge, "◆" after the round number and screen-reader text "changed by the <Boss> set", with a
  one-line legend in the list header. On the overview strip, each run of consecutive changed rounds is one
  ribbon. A "Changed by <Boss>" filter chip is offered on boss sets only. Boss spawns themselves are not in the
  round data, so the page never claims a round is a spawn round.

### 2.4 Event modifiers: what the page can show honestly

| Input | Effect |
|---|---|
| `mode=AlternateBloonsRounds` | Resolves to the ABR set. |
| `roundSets` with a boss id | Resolves to that boss's set. |
| `mode=Apopalypse` | If the data agent finds no fixed set for it, the page shows "Apopalypse rounds are random: no fixed rounds to show" and the rules row has no link. |
| `camo` / `regrow` / `fort` | Applied to every group, the way the game applies the flag. The data agent documents which bloon types each flag affects. Sprites, pills and names change. |
| `hp` / `mhp` / `bhp` | RBE is rescaled only when the data breaks health down per bloon type (bloon layers, MOAB class, boss). Otherwise the base RBE stays, tagged "before health modifiers", and the chip is shown as not applied. |
| Speed and regrow-rate multipliers | Chip only: how they play out depends on the map. |
| Cash under `Clicks` (CHIMPS), `HalfCash`, `Deflation` and other income-changing modes | Cash is shown only if the game model the data agent extracts includes that mode's income rule. Otherwise the cash stats are hidden, with "Cash depends on this mode's income rules". |
| `Reverse`, difficulty | Rounds unchanged, unless the data says otherwise. No chip. |

### 2.5 Layouts

*(The wireframes below are the original MVP; the current layout is in docs/round-visualizer-ux-review.md.)*

**Mobile (390 px):** one column. The selected round expands **inline** in the list, and only one round is open at a time. The overview strip stays sticky under the header while the list scrolls.

```
┌──────────────────────────────────────────┐
│ BTD6 Open Data                           │
│ NOW BOSSES RACES CT ODYSSEY CHALL. TOOLS │
├──────────────────────────────────────────┤
│ ‹ Vortex #47 Elite                       │
│ ROUNDS                                   │
│ [(V) Vortex rounds       ▾]  game v56.x  │
│ Rounds [  1 ]–[140 ]                     │
│ (Event) (Easy) (Med) (Hard) (Imp) (All)  │
│ [camo] Camo   [MOAB+] MOAB hp ×1.5       │
│ [>>] Speed ×1.2 · not applied            │
│ ▔▔▔▔▔▔▔▔▔ sticky ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│  ▾MOAB  ▾BFB     ◆boss      ▾ZOMG        │
│ ▁▂▂▃▃▅▂▆▇█▃▅▆▇▆▇█▇▇█▆▇█▇▇█▇█▇█ (RBE)     │
│ [ ] Notable only    Jump [ 40 ] ‹ ›      │
├──────────────────────────────────────────┤
│ 38  ◍◍◍◍          ×142          RBE …    │
│ 39  ◍◍◍           ×120          RBE …    │
│ 40  ⬬ ◍◍  [⬬ FIRST MOAB]        RBE …    │
│ ┌ ROUND 40 ─────────────────── ‹  › ┐    │
│ │ RBE …   Cash …   Since r1 …        │    │
│ │ 3 groups · spawns over …s          │    │
│ │ 0s      5s      10s     15s        │    │
│ │ ⬬  ×1   ▮                          │    │
│ │ ◍  ×20  ▮▮▮▮▮▮▮▮▮                   │    │
│ │ ◍  ×10       ▮▮▮▮▮                  │    │
│ │ ▸ Group table                      │    │
│ └────────────────────────────────────┘    │
│ 41  ◍◍◍ …                                │
└──────────────────────────────────────────┘
```

**Desktop (≥ 1024 px):** two panes. The list (≈ 380 px) scrolls on its own, and the detail pane stays sticky. The controls and overview strip span the full width.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BTD6 OPEN DATA    NOW  BOSSES  RACES  CT  ODYSSEY  CHALLENGES  [TOOLS]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ ‹ Vortex #47 Elite                                                           │
│ ROUND VISUALIZER   Set [(V) Vortex rounds ▾]  game v56.x                     │
│ Rounds [1]–[140] (Event)(Easy)(Medium)(Hard)(Impoppable)(All)   Jump [40] ‹ ›│
│ From the event: [camo] Camo · [MOAB+] MOAB hp ×1.5 · Speed ×1.2 not applied  │
│                 ( ) Base rounds                                              │
│   ▾MOAB      ▾BFB          ◆boss        ▾ZOMG        ◆boss       ▾DDT        │
│ ▁▂▂▃▃▅▂▆▇█▃▅▆▇▆▇█▇▇█▆▇█▇▇█▇█▇█▇█▇▆▇█▇▇█▇█▇█▇▆▇█▇█▇▇█▇█▇█▇█▇▇█▇ RBE / round │
├─────────────────────────────────┬────────────────────────────────────────────┤
│ RND  BLOONS            ×     RBE│ ROUND 40                         ‹ 39  41 › │
│ 38   ◍◍◍◍             142     … │ [⬬ FIRST MOAB]                              │
│ 39   ◍◍◍              120     … │ RBE …   Cash …   Since r1 …   3 groups      │
│▶40   ⬬ ◍◍  FIRST MOAB  31     … │ spawns over …s                              │
│ 41   ◍◍◍               …      … │ 0s       5s        10s        15s       20s │
│ 42   …                          │ ⬬ ×1    ▮                                   │
│ (scrolls independently)         │ ◍ ×20   ▮▮▮▮▮▮▮▮▮▮▮▮▮                        │
│ [ ] Notable only                │ ◍ ×10          ▮▮▮▮▮▮▮                       │
│                                 │ Bloon          Count   Start   End          │
│                                 │ MOAB           1       …s      …s           │
└─────────────────────────────────┴────────────────────────────────────────────┘
```

## 3. The "Round set" row in rules

This covers boss, race, challenge and odyssey rules. CT tiles have no ruleset in the API, so they get no link.

- The row keeps its icon and set name. The value becomes a link with a chevron:
  - **`Vortex rounds · See rounds ›`**
  - **`Default · See rounds ›`**
  - **`Alternate Bloons Rounds · See rounds ›`** (resolved from `mode` even when `roundSets` only says `default`)
- The tap target is at least 44 px tall, and the link is styled with the accent ink on hover and focus.
- The link targets `/tools/rounds` with:
  - `set` resolved via the manifest aliases (API `roundSets` value, then `mode`);
  - `from=startRound&to=endRound&r=startRound`, so the first round you play is preselected. A single-round challenge gets `from=to=r`;
  - `mode` and every non-default modifier from `_bloonModifiers`;
  - `src` = the current page.
- Odyssey islands (compact rules): the link sits on the "Round set" row when it's shown, otherwise on the "Rounds" row. If neither row is shown, there is no link.
- No link when the set is unknown to the manifest or has no fixed rounds (Apopalypse). The row then stays plain text, as today.
- The link is a normal `<A>`, so it prefetches while visible (§4).

## 4. Data packaging, caching, performance

- **Source:**
  - The data agent's `scripts/build_rounds.py` reads the local game install (read-only, like `build_art.py`) and writes one JSON file per set to `web/src/data/rounds/<id>.json`.
  - It also regenerates `web/src/data/rounds/index.ts`, the manifest:
    - per set: id, name, icon key, aliases (API `roundSets` values and `mode` names that resolve to it), first and last round, boss type;
    - the game version;
    - which optional fields exist (RBE, cash, per-type health, mode income rules);
    - the `?url` import of each file.
- **Set file format** (compact, columnar):
  - `{ v, id, rounds: [{ n, g: [[bloonKey, flags, count, start, end], …], rbe?, cash? }] }`;
  - `flags` is a bitmask: camo 1, regrow 2, fortified 4;
  - times are in seconds (the data agent converts from the game's unit);
  - boss spawns are groups with a `boss:<type>` key;
  - budget: ≤ 10 KB compressed per set.
- **Static assets only:**
  - Files are imported with `?url`, so Vite content-hashes them into `/assets/`, which is already `immutable` in `_headers` and cache-first in `sw.js`.
  - They are served by Cloudflare without invoking the Worker.
  - **Never through `/api` or NK.** A new game version gives new hashes; the old files die with the old service-worker cache.
- **Prefetch:**
  - `needs({name:"rounds",…})` returns the set file's hashed URL, and the store fetches and persists it in IndexedDB like any other key.
  - Every visible Round-set link therefore prefetches its set, and `intent()` warms the `bloon`, `bloonVariant`, `boss` and `ui` sheets (`PAGE_FAMILIES.rounds`).
  - The always-visible Tools tab prefetches the default set.
- **Instant render:**
  - The page renders synchronously from the store.
  - On a cold deep link, the controls render immediately and the list shows fixed-height placeholder rows until the file lands. No layout shift.
  - Filtering, jumping and range changes are pure client-side and must not refetch.
- **Checks:** a `check_rounds.ts` script, run in CI next to `check_art.ts`, fails when:
  - a bloon key or flag combination in any set has neither a sprite nor a defined text fallback;
  - a Round-set value seen in `docs/api/fixtures` resolves to no manifest set, unless that value is explicitly listed as having no fixed rounds (Apopalypse).

## 5. Scope

**MVP**
- Tools tab, the `/tools` and `/tools/rounds` routes, and the URL scheme above.
- Every set the data agent extracts. The minimum is default, Alternate Bloons Rounds, every boss set in the API, and Fast Track if it is its own set.
- The controls, overview strip, list, filters and boss-set markers (§2.3).
- Round detail with timeline, group table, stats and cash since `from`.
- Modifier handling exactly as in §2.4.
- Round-set links on boss, race, challenge and odyssey rules.
- Packaging and prefetch as in §4, plus the `bloonVariant` sheet.

**Later**
- Compare two sets (`vs=`): matching rounds side by side, with the changed groups highlighted. It's useful (Alternate Bloons Rounds vs default, boss set vs default), but most players arrive from one event with one set, so it waits for v2.
- Health-adjusted RBE for sets or modes the MVP data can't rescale.
- Freeplay rounds past the set's last defined round (random, so they are out of scope unless the game model defines them).
- Open Graph previews for `/tools/*` links.
- "Heaviest rounds" (top RBE) pills.

## 6. Acceptance criteria

1. **Links from rules.**
   - From a Vortex boss page, the "Round set" row links to `/tools/rounds?set=vortex&from=<startRound>&to=<endRound>&r=<startRound>` plus the event's modifiers and `src`.
   - With the link visible for a moment, tapping it renders the page in the same frame: no spinner, and no network request in DevTools at click time.
2. **Deep link on a new device.** A deep link (a cold load with no service worker) makes zero requests to `/api/*` or `data.ninjakiwi.com` for round data. Set files come from `/assets/*.json` with `Cache-Control: immutable`.
3. **Reload and back.** Every control change updates the URL (`replaceState` for typing, `pushState` for round selection). Reload and Back restore the exact view.
4. **Mobile width.**
   - At 390 px there is no horizontal page scroll, the nav fits on one row, and sprites are at least 24 px in list rows and 40 px in timeline lanes.
   - At 360 px, only the nav row may scroll.
5. **Filters and markers.** For every set, a filter shows exactly the rounds in the range whose groups (after the event's modifiers) include a matching bloon, OR-combined; the "first: X" readout is the first such round at or after `from`; boss-set markers match the data's changed rounds.
   - A test computes them from the data file and compares them with the rendered pills.
   - With `camo=1`, "first camo" moves to `from`.
6. **Modifiers.** Every modifier in the URL appears as a chip, either applied or marked "not applied". Nothing is applied that the data can't support. Cash is hidden for modes whose income rule isn't in the data.
7. **Unknown values.** An unknown `set` shows the "don't have this set" state with a link to the default set. An out-of-range `r`, `from` or `to` is clamped without an error.
8. **Accessibility.** Every sprite has an accessible name. The timeline has the group table as its text equivalent. Keyboard alone can pick a set, a range and a round. Contrast meets the existing tokens.
9. **Payload budget.** Each set file is ≤ 10 KB compressed. The `bloonVariant` sheet is loaded only on Tools pages.
10. **Version stamp.** The page states the game version the rounds come from.

## 7. Open questions for the owner

1. **Tab name:** we chose **"Tools"** over "Extras" (clearer, and room to grow). Veto if you prefer "Extras".
2. **Compare view:** OK to ship compare-two-sets in v2 rather than the MVP?

**For the data agent (not the owner)**
- Do elite boss events use a different set than standard?
- Does Apopalypse have fixed rounds?
- Which fields does the game model provide per round (RBE, cash, per-type health)?
- Does the game model include each mode's income rule?
- Which bloon types does each "all camo / regrow / fortified" flag affect?
- What unit are spawn times stored in?

## Owner decisions

2026-09-26
- Tab name: **Tools**.
- Comparing two sets: **not in scope** for now (drop `vs` from the MVP; keep the URL param reserved).

2026-09-27 (after the UX review, docs/round-visualizer-ux-review.md; all six changes built and deployed):
- One page scroll, no inner scrollers; phone pinned bar ≤ 64 px.
- Filters replace notable rounds (§2.3); boss sets get quiet markers.
- Compact set bar with an Edit panel (bottom sheet on phones).
- Focused round view (`view=round`): "See rounds" from an event opens it at the start round; phones open it
  from a row tap (a history entry, Back returns to the list); desktop keeps list + detail side by side with a
  [Focus] button.
- Overview strip follows the scroll position in the list view.
- Sections of this spec that describe the list rows' "notable pills" and wireframes with "Notable only" are
  superseded by the above; the UX review's wireframes are the current layout reference.
