# Round visualizer: UX review and redesign proposal

Written 2026-09-27. Three roles reviewed the live page together and agreed on one proposal:
- **PO**: the product owner.
- **UI**: a senior UI designer (mobile-first, high contrast, allergic to generic "AI slop" UI).
- **Player**: a competitive boss and race player who checks rounds before an event.

This is a proposal only. No app code was changed.

Pages reviewed: `/tools/rounds?set=default`, `?set=vortex&from=1&to=140`, `?set=dreadbloon`, `?set=default&r=40`, and an event-style deep link (`?set=vortex&from=35&to=60&r=40&ev=35-60&camo=1&mhp=1.5&spd=1.2&src=/bosses`). Each was captured at 1280×900 and 390×844 in dark mode.

Screenshots are in the session scratchpad at `…/scratchpad/ux/`. File names are `d-*` for desktop and `m-*` for mobile, with the suffixes `-top`, `-mid` and `-full`. `d-default-trap.png` shows the scroll trap. `metrics.json` has the measured layout numbers.

**Numbers rule:** round numbers quoted below are the ones the live page rendered from the site's own data. No BTD6 value here comes from memory.

The owner's feedback, in short:
1. Too much at once. Wants a "focused" view once a set is chosen.
2. "Notable" rounds on the default set are useless. Filtering by camo, MOAB-class and similar would be useful.
3. Boss notables are good, but should be more subtle than the big tags.
4. Scrolling feels overwhelming. You get stuck in sections.

---

## 1. Top problems, with evidence

### P1. Nested scroll containers trap the wheel and the finger (owner point 4)

| # | Container | Where | What happens |
|---|---|---|---|
| a | `.rv-listpane` (desktop ≥ 1024 px) | `styles.css:3811-3818`: `position: sticky` + `max-height: calc(100vh - var(--hdr) - 24px)` + `overflow-y: auto` + **`overscroll-behavior: contain`** | The list is a second scroller, about 7,150 px tall inside an 820 px box (`listScrollH` 7149 vs `listClientH` 820 in metrics). `contain` stops scroll chaining. Measured: after the page scrolls to its end (y = 564), wheeling up over the list scrolls the list from 4800 back to 0, but **the page stays at y = 564**. The set picker, range, strip and jump field can't be reached until the pointer leaves the list (`d-default-trap.png`). |
| b | `.rv-detailpane` (desktop) | `styles.css:3825-3831`: sticky + `max-height` + `overflow-y: auto` | A third scroller next to the list. It is short for early rounds (347 px, leaving empty space: `d-default-trap.png`). For big rounds it scrolls internally, especially because the group table is open by default on desktop (`rounds.tsx:768`). The wheel then does three different things depending on where the pointer is. |
| c | `.rv-lh` | `styles.css:3819-3824` | A sticky header inside scroller (a). Harmless on its own, but it is sticky inside another sticky. |
| d | `.rv-sticky` (≤ 1023 px) | `styles.css:3845-3861`, `rounds.tsx:384-397` | The strip, "Notable only" and the jump field are pinned at **166 px of an 844 px screen (20 %)** on phones (metrics `sticky.h`). On tablets (701–1023 px) the site header is sticky too (`styles.css:311-313`; it only goes static at ≤ 700 px, `:1438`), so about 222 px is pinned. |
| e | Strip drag | `rounds.tsx:538-541, 573-581` + layout effect `:329-331` | Every round crossed while dragging calls `go()`. That runs `scrollIntoView({block:"nearest"})` on that row. On phones it also moves the **inline detail (a row grows from 48 px to 428 px, metrics `m-default-open`)** from one row to the next (`:416`). The page jumps under your finger while you scrub. |
| f | No `scroll-margin-top` on rows | `grep scroll-margin` finds nothing | `scrollIntoView` doesn't know about the 166 px sticky bar, so a picked row can land under it when you scroll up (from reading the code). |

**Player:** "It's the desktop one. I scroll the list to 90, then I can't get back to the range buttons without moving my mouse off the list. It feels like the page is stuck."

### P2. Too much chrome before the first round (owner point 1)

- **Mobile, no event:** the list header sits at y ≈ 672 CSS px (`listpane.top`). Only about 2 rows fit on the first screen (`m-default-top.png`). Above them are:
  - the tool strip and a giant "ROUNDS" H1 (`rounds.tsx:198-206`, 75 px + 18 px margin);
  - the set picker plus the version line (120 px);
  - range inputs plus **6 preset chips on 2 lines** (136 px, `:430-479`);
  - the strip block (166 px).
- **Mobile, arriving from an event link:** the modifier chips add 195 px (`:366-383`). The strip starts at y = 747, so **no round is visible on arrival** (`m-event-top.png`). The round the link asked for (r = 40) is at y = 1264. The page deliberately never scrolls on arrival (`rounds.tsx:319-320`), so the player has to find it by hand.
- **Desktop:** the list starts at y = 524 of 900 (`d-default-top.png`).
- The H1 says "Rounds" while the useful title (set and range) is buried in a `<select>`. The one-item "Tools / Round visualizer" strip is navigation to the page you are already on.

### P3. "Notable" is noise on the default set, and pills bloat the rows (owner points 2 and 3)

- On the default set the pills are the same 10 "firsts" every time: camo 24, purple 25, lead 28, ceramic 38, MOAB 40, fortified 45, BFB 60, ZOMG 80, DDT 90, BAD 100 (as rendered). A competitive player knows these, and a new player wants to *filter*, not read trivia (`rounds.ts:210-250`).
- **Dreadbloon:** 74 of 140 rows carry a pill, and 64 of those carry the full-width "DREADBLOON SET" tag (`m-dread-mid.png`). Average row height goes from 51 to 62 px, and the page grows to 9,535 px. "Notable only" then filters down to more than half the set, which makes it pointless.
- **The boss pill's meaning isn't clear.** "Vortex set" (`rounds.ts:247`) means "this round's groups differ from the default set" (the `o` flag). It doesn't mean "boss round", and nothing on the page says so.
- **Pills are duplicated:** the open round shows the same pill in its row *and* in the detail header (`rounds.tsx:724-730`; `m-event-open.png` shows "VORTEX SET" twice).
- **Strip markers:** the Dreadbloon marker band is a solid smear of diamonds (`m-dread-mid.png`, 74 marks in a 358 px band). On Vortex, the boss diamonds use the boss tint (a light blue) right above blue "bloon layer" bars, so two blues mean different things (`d-vortex-top.png`).

### P4. The overview strip doesn't show where you are, and early rounds are invisible

- **Linear RBE scale** (`rounds.tsx:606`): for a 1–140 range, about the first half of the bars are 0–1 px tall (`d-default-top.png`, `m-default-top.png`). There is nothing to see or aim at where most early-game checks happen.
- **The cursor and jump field show the *selected* round, not the scroll position** (`cur = shown ?? from`, `rounds.tsx:286, 395`). Scrolled to rounds 56–68, the sticky bar still says "Round 1" and the cursor sits at the far left (`m-default-mid.png`). The pinned bar costs 20 % of the screen and doesn't tell you where you are.

### P5. Row density

A row can hold: number, up to 6 sprites + "+N", `×count`, RBE, plus a second line of pills (`rounds.tsx:629-658`, grid areas `"n s c r" "n p p p"` at `styles.css:3512`). Rows are therefore 48–105 px tall, so the rhythm breaks and scanning is slow.

**Player:** "I read RBE and the sprites. Bloon count I only care about once I open the round."

---

## 2. Converged redesign

### How the three roles got there

- **PO:** Two jobs:
  - *scan a range for threats* ("when do I need camo detection or lead popping, where do MOABs start");
  - *inspect one round* (the spawn timing, for races and boss setups).

  Today both jobs share one screen, so neither is comfortable. Split them. Picking a set shouldn't leave the whole setup form on screen.
- **UI:**
  - One scroll context: the page. No inner scrollers, ever.
  - Setup collapses into a one-line **set bar**.
  - A slim sticky **scrubber** that always shows where you are.
  - Uniform one-line rows.
  - Tapping a row on a phone opens a **round view** (the owner's "focused" view) instead of inflating the list.
  - Filters replace notables.
  - The boss change becomes a quiet marker (shape + tint + screen-reader text), not a tag.
- **Player:**
  - Filters must include MOAB-class and the specific bloon types.
  - "Next camo round ›" inside the round view is the thing I'd actually use.
  - Keep "first in range" somewhere, because for an event range starting at 35 it *is* useful. Just not as a pill on every set.

  Agreed: show it as a line of text when a filter is on.
- **PO:** Coming from an event link, open straight on the round the event starts at (open question 1). Everything is derived from the set file already in memory, so every view switch stays instant.

### 2.1 View model and URL

| State | URL | Notes |
|---|---|---|
| Setup open | `/tools/rounds` with no `set=` | The only state where the full form (set, range, presets, modifiers) is expanded. |
| **List view** (default once a set is chosen) | `?set=…&from&to[&has=…][&bloon=…]` | Set bar, filter chips, scrubber, rows. Desktop adds the sticky detail pane for `r` (or `from`). |
| **Round view** (focused) | `…&r=40&view=round` | One round, full width. On phones a row tap *pushes* this entry, so Back returns to the list at the same scroll position (`navigate` already stores `scrollY`). ‹ ›, swipe, scrubbing and "next match" *replace* it. |
| Filters | `has=camo,regrow,fort,moabs,changed` and `bloon=lead,ceramic,ddt` (`BLOON_TYPES` keys) | Combined as "any of" (open question 2). Old `notable=1` links become `has=changed` on boss sets and are ignored elsewhere. |

Modifier params (`camo`, `mhp`, …), `ev`, `mode` and `src` are unchanged.

### 2.2 Filters replace "notable"

- **Chips** use official art, 24 px sprite + short word:
  - **Camo** `ui/AllCamo`
  - **Regrow** `ui/AllRegen`
  - **Fortified** `bloon/fortified`
  - **Lead** `bloon/lead`
  - **Ceramic** `bloon/ceramic`
  - **MOAB-class** `bloon/moab`, matching `BLOON_TYPES[k].moab`, which comes from the game model
  - **Bloon ▾**: a menu listing the types used in this range with their sprites. Types without art (`sprite: null`, e.g. Aura Bloon) use the text fallback.
  - Boss sets add **◆ Changed by Vortex** first.
- **Matching** runs on `effGroups()`, so event modifiers count, exactly as `notables()` does today. When the event sets all-camo (`camo=1`), the Camo chip reads "Camo · all (event)" and is inert, because every round with a camo-capable bloon matches.
- **When a filter is on:**
  - non-matching rows are hidden;
  - the list header reads **"N of 140 rounds · first: 24"**, with N and the first round computed from the data (24 is the default set's first camo round, as the page renders it). This keeps the useful part of "first X" for custom and event ranges;
  - inside matching rows, the sprites that don't match are dimmed to about 40 % so the reason for the match stands out;
  - the strip shows ticks for matches in the marker band. With no filter on, the band is empty.
- **Chip row layout:**
  - **Phones:** one line, 44 px tall. The row itself scrolls sideways with a right-edge fade. That is not page scroll, and it can't trap vertical scrolling because it doesn't capture vertical pans.
  - **Desktop:** chips wrap inline.
- **Boss-changed rounds get a subtle marker instead of pills:**
  - in the row, a 3 px boss-tint left rail and a "◆" after the round number, with visually-hidden text "changed by the Vortex set". Shape and colour both carry the meaning, never colour alone;
  - a one-line legend in the list header: "◆ changed by the Vortex set";
  - on the strip, contiguous changed runs are drawn as a **ribbon under the bars** instead of one diamond per round. Dreadbloon's 37–80 run reads as one segment, not a smear;
  - no more "First X" pills or markers on any set.

### 2.3 Scroll model (fixes P1)

- **Desktop:**
  - Remove `max-height`, `overflow-y` and `overscroll-behavior` from `.rv-listpane`. The list flows in the page.
  - The detail pane stays sticky **only while it fits the viewport**. A `ResizeObserver` sets `.fits`. Otherwise it scrolls with the page. It is never an inner scroller.
  - The group table is collapsed by default everywhere.
- **Phones:**
  - Sticky height ≤ 64 px: the set bar row collapses into the scrubber row once you scroll past it.
  - No inline expansion. A row tap goes to the round view.
- **Scrubber:**
  - In list view, dragging scrolls the page to that round (instant `scrollTo`). It does not select a round and writes no URL entry until release.
  - The cursor and readout follow the topmost visible row (IntersectionObserver).
  - In round view, dragging changes `r` (replace).
  - Rows get `scroll-margin-top: var(--sticky-h)`.
- **Strip bars** get a 2 px minimum height, so every round is visible and aimable. The scale stays linear and honest, and a narrower range rescales it.

### 2.4 Wireframes

#### Mobile, list view (390 px), for example `?set=vortex&from=35&to=60&camo=1&mhp=1.5`

```
┌──────────────────────────────────────┐
│ BTD6 OPEN DATA                       │  site header (static on phones)
│ NOW BOSSES RACES CT ODYSSEY CHAL TOOLS│
├──────────────────────────────────────┤
│ ‹ Boss events                        │  back link (only with src)
│ [◈] VORTEX ROUNDS 35–60        [Edit]│  set bar = the H1; 48 px
│     Camo · MOAB hp ×1.5 · 1 n/a      │  mods summary, 1 line, muted
│ [◆Changed][◌Camo·all][◍Lead][◍Cer][⬬M›│  filter chips, row scrolls itself
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔ sticky 56 px ▔▔▔▔▔▔▔▔▔▔ │
│ ▂▃▃▄▂▅▆▆▇▅▆█▇▆▇█▇▆▇█▇▇█▆  │ R41      │  scrubber + readout (follows scroll)
│ ▀▀▀▀▀     ▀▀                         │  ribbon: changed-by-Vortex runs
├──────────────────────────────────────┤
│ RND  BLOONS                    RBE   │  ◆ changed by the Vortex set
│ 35   ◍◍◍                     …       │
│ 40◆▌ ◍                         624   │  tint rail + ◆, no pill
│ 41◆▌ ◍◍◍                     2,340   │
│ 42   ◍◍                        517   │  one line per row, 48 px, fixed
│ 43   ◍◍                      1,198   │
│ …                                    │  tap a row → round view
└──────────────────────────────────────┘
```

#### Mobile, round view (focused), `…&r=40&view=round`

```
┌──────────────────────────────────────┐
│ ‹ List    [◈] VORTEX 35–60     [Edit]│  48 px, sticky with scrubber
│ ▂▃▃▄▂▅┃▆▆▇▅▆█▇▆▇█▇▆▇█▇▇█▆ ←drag→     │  scrubber: drag = change round
├──────────────────────────────────────┤
│  ‹   ROUND 40  ◆                  ›  │  44 px buttons; swipe card ← →
│      changed by the Vortex set       │  plain text, not a pill
│ RBE 624   BLOONS 6   GROUPS 1        │
│ SPAWNS OVER 18s                      │
│ ─ 0s ──── 5s ──── 10s ──── 15s ───── │
│ ◍ ×6              ▮▮▮▮▮▮             │  40 px sprites
│ ▸ Group table                        │  collapsed
│ ──────────────────────────────────── │
│ With filter "Camo":                  │
│ [‹ prev match 38]   [next match 43 ›]│  only when a filter is on
│ UP NEXT                              │
│ 41◆  ◍◍◍                     2,340   │  3 compact rows, tap = go
│ 42   ◍◍                        517   │
│ 43   ◍◍                      1,198   │
└──────────────────────────────────────┘
```

#### Mobile, Edit sheet (setup)

This is shown expanded on a bare `/tools/rounds`. Elsewhere it opens as a bottom sheet from [Edit], and the page underneath doesn't scroll.

```
┌──────────────────────────────────────┐
│ ROUND SET                         [×]│
│ [◈ VORTEX ROUNDS               ▾]    │
│ ROUNDS  [ 35 ] – [ 60 ]              │
│ (Event)(Easy)(Med)(Hard)(Imp)(All)   │  one scrolling row
│ FROM THE EVENT                       │
│ [◌] Camo   [⬬+] MOAB health ×1.5 ✓   │
│ [»] Bloon speed ×1.2 · not applied   │
│ [ ] Base rounds (modifiers off)      │
│ Rounds from the game's data, v56.3   │
│ [          Show rounds          ]    │
└──────────────────────────────────────┘
```

#### Desktop, list view (1280 px, default)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BTD6 OPEN DATA   NOW BOSSES RACES CT ODYSSEY CHALLENGES [TOOLS]   (sticky)   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ‹ Vortex #47 Elite                                                           │
│ [◈] VORTEX ROUNDS ▾   Rounds [35]–[60] (Event)(Easy)(Med)(Hard)(Imp)(All)    │  one row
│ From the event: Camo · MOAB health ×1.5 (applied to RBE) · Speed ×1.2 n/a  ⌄ │  one row
│ Filter: [◆ Changed by Vortex] [Camo] [Regrow] [Fortified] [Lead] [Ceramic]   │
│         [MOAB-class] [Bloon ▾]                    N of 26 · first: …       │
│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ sticky scrubber, 64 px ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ ▂▃▃▄▂▅▆▆▇▅┃▆█▇▆▇█▇▆▇█▇▇█▆▇█▇▆▇█▇▇█▆       R40 · RBE 624   Round [40] ‹ ›     │
│ ▀▀▀▀▀    ▀▀                        (changed-by-Vortex ribbon)                │
├───────────────────────────────┬──────────────────────────────────────────────┤
│ RND BLOONS             RBE    │ ROUND 40 ◆                    [Focus] ‹  ›   │
│ 38  ◍◍◍◍            …         │ changed by the Vortex set                    │
│▶40◆ ◍                 624     │ RBE 624  BLOONS 6  GROUPS 1  SPAWNS OVER 18s │
│ 41◆ ◍◍◍             2,340     │ 0s        5s        10s        15s           │
│ 42  ◍◍                517     │ ◍ ×6                ▮▮▮▮▮▮                   │
│ …   (flows in the page:       │ ▸ Group table                                │
│      no inner scrollbar)      │ (sticky only while it fits the viewport)     │
└───────────────────────────────┴──────────────────────────────────────────────┘
```

#### Desktop, round view (focused), `view=round`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [◈] VORTEX ROUNDS 35–60 · Camo · MOAB ×1.5            [Edit]   [‹ List]      │  set bar collapsed
│ ▂▃▃▄▂▅┃▆▆▇▅▆█▇▆▇█▇▆▇█▇▇█▆▇█▇▆▇█▇▇█▆   (drag = change round)   Round [40] ‹ ›  │  sticky
├──────────────────────────────────────────────────────────────────────────────┤
│  ‹   ROUND 40 ◆  changed by the Vortex set                               ›   │
│  RBE 624     BLOONS 6     GROUPS 1     SPAWNS OVER 18s                       │
│  0s            5s             10s             15s                            │
│  ◍ ×6                           ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮                             │  48 px sprites, wide axis
│  ▾ Group table  (Bloon · Count · Start · End)                                │
│  [‹ prev match 38]                                       [next match 43 ›]   │
│  UP NEXT   41◆ ◍◍◍ 2,340   ·   42 ◍◍ 517   ·   43 ◍◍ 1,198                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.5 Interaction details

- **Swipe** on the round card:
  - pointer events, `touch-action: pan-y` on the card;
  - fires when |dx| > 48 px and |dx| > 2·|dy|;
  - the change is instant with no slide animation, which also respects reduced motion;
  - ←/→ and `/` keep working. `n` / `p` could step to the next / previous match later.
- **Instant everywhere:** filters, "next match", "Up next" and the ribbon are all computed from the set file already in the store, next to `notables()` today. There are no new requests.
- **Honesty:**
  - the Camo chip under all-camo says "all (event)";
  - modifiers the page can't apply stay listed as "not applied" in the Edit sheet, and the summary line counts them ("1 n/a").
- **No horizontal page scroll at 390 px:** only the filter-chip row and the preset row scroll on their own, and both are single-line `overflow-x: auto`.

---

## 3. Prioritized change list

| Pri | Change | Files | Size |
|---|---|---|---|
| **Must** | M1. **Kill the inner scrollers.** Drop `max-height`, `overflow-y` and `overscroll-behavior` from `.rv-listpane`. The detail pane is sticky only while `.fits` (ResizeObserver). The group table is closed by default. Add `scroll-margin-top` to rows. | `styles.css:3811-3831`, `rounds.tsx:424, 768` | S |
| Must | M2. **Filters replace "Notable only" and the "First X" pills.** Add `has=` / `bloon=` to `RoundsRoute`, `parseRounds` and `href.rounds`. Add a pure `matches(round, filters, mods)` in `rounds.ts` next to `effGroups`. Show the "N of M · first: X" line. Map `notable=1` to `changed`. Rewrite spec §2.3 and acceptance criterion 5, plus the notables unit test. | `routes.ts`, `rounds.ts:200-250`, `rounds.tsx:346, 390-394`, spec | M |
| Must | M3. **Subtle boss marker.** Row: tint rail + "◆" + screen-reader text, with a legend in the list header. Strip: changed runs drawn as a ribbon under the bars. Remove the pill from the rows and the detail header, and relabel "Vortex set" as "changed by the Vortex set". | `rounds.tsx:593-603, 649-655, 724-730`, `styles.css:3397-3419, 3566-3590` | S |
| Must | M4. **Compact set bar** once `set=` is present. It becomes the H1 ("Vortex rounds 35–60"). Hide the one-item tool strip. Setup moves into an Edit sheet on phones and a one-row form on desktop, with modifiers summarized on one line. | `rounds.tsx:198-266, 365-383, 430-479`, CSS | M |
| Must | M5. **Phones: a row tap opens the round view** (`view=round`, pushState) instead of expanding inline. Back restores the list scroll. This removes the 48→428 px relayout while scrubbing (P1e). | `rounds.tsx:335-341, 410-419` | M |
| **Should** | S1. **Round view** content: 44 px ‹ ›, swipe, prev/next *match*, "Up next" (3 rows). Desktop gets a [Focus] button on the detail header. | `rounds.tsx` (new `RoundView`) | M |
| Should | S2. **The scrubber follows the scroll** in list view (IntersectionObserver readout; dragging scrolls without selecting). Slim phone sticky to ≤ 64 px. 2 px minimum bar height. | `rounds.tsx:516-625, 286, 395`, `styles.css:3329-3371, 3845-3861` | M |
| Should | S3. **One-line rows**: number, ≤ 5 sprites + "+N", RBE. Move `×count` to the detail. Dim non-matching sprites while a filter is on. | `rounds.tsx:629-658`, `styles.css:3489-3525` | S |
| Should | S4. **Event deep links** (`ev` + `r`) open in round view on `r`, depending on open question 1. The rules panel's link adds `view=round`. | `rounds.ts:265-303` | S |
| Should | S5. **"Bloon ▾" picker** listing the types used in range, with sprites and a text fallback. | `rounds.tsx`, `rounds.ts` | M |
| **Later** | L1. Desktop full-width round view polish (wide timeline, 48 px lanes, inline "Up next"). | `rounds.tsx`, CSS | M |
| Later | L2. An "all of" filter mode, if the owner wants it (open question 2). | `rounds.ts` | S |
| Later | L3. `n` / `p` keys for next / previous match. Filter state in the browser-tab title ("Vortex rounds 35–60 · camo"). | `rounds.tsx:287-306, 39-46` | S |
| Later | L4. e2e coverage: no inner scroller on desktop (wheel over the list reaches the controls), no horizontal scroll at 390 px with 8 chips, and swipe steps rounds. | `scripts/e2e.ts` | M |

Suggested order: M1 → M3 → M2 → M4 → M5 → S2 → S1. M1 and M3 are quick wins that fix the "stuck" feeling and the Dreadbloon tag wall on their own.

---

## 4. Open questions for the owner

1. **Arriving from an event's "See rounds" link:** open straight on the focused **round view** at the event's start round (proposed), or on the list with that round highlighted?
2. **Several filters at once:** show rounds matching **any** chip (proposed, e.g. "camo *or* lead rounds"), or only rounds matching **all** of them?
3. **Desktop default:** keep **list + detail side by side** as the desktop default, with the round view opt-in via [Focus] (proposed)? Or should desktop work like phones (list, click, full-width round)?
