# Visual plan: official game art across the site

Agreed on 2026-09-24 between the UI designer and the product owner (player advocate), with the lead's review.
The site owner approved using official Ninja Kiwi art (a non-commercial fan project). The footer credits it: "Game art © Ninja Kiwi".

## Principles
- **Recognisable game objects become official art; quantities stay numbers.** A portrait replaces a tower's *name*, never its count, limit or tier cap.
- **Minimum sizes:**
  - 24 px for any sprite (20 px for leaderboard header icons);
  - 32 px in medal cabinets;
  - 40 px on the bloon wall and in roster cells on mobile;
  - 48 px for roster cells on desktop.

  Below the minimum, use text. No redrawn small versions.
- **Our own SVG only for generic marks:** ban slash, lock, 3×5 upgrade pips, ×N plates, and the "any hero" silhouette.
- **Never colour alone:**
  - banned = greyscale + 35% opacity + slash + `aria-label` "Dart Monkey, banned";
  - medal tiers use fixed in-game order and ghost slots, so position encodes the tier.
- **Accessibility:** every sprite has an accessible name, and a tooltip with the in-game name. A sprite next to visible text is `aria-hidden`.
- **Fallbacks:**
  - an unknown key, or a sheet that hasn't loaded, shows a text chip in the same fixed-size box (e.g. "Black Dia. ×3", "DRT");
  - never a wrong or blank icon, never a layout shift, never a wait during navigation.
- **Dark-bodied sprites** (black bloon, ZOMG, DDT, lead, black diamond) get a baked 1 px 50%-white halo, so they don't vanish on #0a0a0b.

## Assets (scripts/build_art.py → web/src/art/)
- Extract with UnityPy from the local game install: `BTD6_DIR` env, default `C:\Program Files (x86)\Steam\steamapps\common\BloonsTD6`.
- Atlases in `sprite_atlases_assets_all_*.bundle`: MonkeyIcons, UiEventRaceMedals, MapMedals, ChallengeRulesIcons, PowerIcons, Bloons, MapImages, Ui, …
- **One WebP sheet per family**, uniform square cells at 2× the largest display size, q82:
  - `tower` 96 px, `hero` 96 px (default skins), `eventMedal` 64 px, `modeMedal` 64 px, `ui` 48 px, `power` 64 px;
  - `bloon` 64 px: a curated ~30, not all 319;
  - `boss` 96 px: boss portrait sprites from the game if present, else a crop of the API banner.
- Total ≈ 280 KB. Budgets: player page ≈ 200 KB, home/events ≈ 20 KB.
- **Maps:** WebP at 96, 200 and 400 px per built-in map, keyed by the API's `map` name, with content-hashed file names.
  - Source: the MapImages atlas if it is ≥ 256 px, else a resize of NK's 510 px PNGs.
  - Custom-map JPEGs stay hotlinked.
- **The registry contract is `web/src/art/index.ts`:** `ART[family]` = { url, cols, rows, cell, keys }, plus `MAPS[name]`. The pipeline regenerates it. Keys are API ids, or the canonical keys documented in that file.
- **Loading:**
  - sheets are imported so Vite hashes them, and cached as immutable;
  - warmed with `new Image().decode()` on link intent, and all sheets on idle unless Save-Data is on;
  - the UI never awaits them.

## Pages
1. **Maps: never crop.**
   - Built-in art is 1:1, custom art 597:400. `object-fit: contain` on `--s2` when a slot's shape differs.
   - Home tiles become horizontal cards with a square art well: 160 px desktop, 96 px mobile.
   - Odyssey tile: an island mosaic that handles 1–N islands with no empty ghost cells.
   - Island cards: square art. List rows: 64 px square.
2. **Rulesets** (boss, race, challenge, odyssey islands), one shared component:
   - **Tower roster:** in game order (Primary, Military, Magic, Support), every tower in place.
     - Allowed: colour portrait, plus a ×N plate when limited.
     - Banned: greyscale, 35% opacity and slash, in place. Never collapsed or hidden.
   - **Tier cap:** one header ("4-4-4 max") when all allowed towers share it. 3×5 pips under a cell only when that tower differs from the header, or is capped when others aren't.
   - **Heroes:**
     - "Your selected hero" (`ChosenPrimaryHero` allowed): one "Any hero" tile, plus slashed portraits of banned heroes, if any.
     - A forced hero: only that portrait.
     - Individually restricted heroes: the hero roster, same rules as towers.
   - **Rules-panel icons** for facts: StartingCash, StartingLives, Start/EndRound, ParagonLimit.
   - **Modifier and toggle icons only when they differ from the default:**
     - AllCamo, AllRegen, fortified;
     - Faster/Slower Bloons, MOAB and Boss, with their HP boost/decrease icons and the exact multiplier as text;
     - NoKnowledge, PowersDisabled, SellingDisabled, NoContinues, NoDoubleCash, NoInstaMonkeys.
   - **Powers:** icon + count.
3. **Scoring:**
   - LeastCash / LeastTiers / GameTime (stopwatch) icons.
   - Boss rows and headers always show two icons, labelled "Normal" and "Elite" in small text. No "E" plate.
   - Leaderboard headers: 20 px icon + header text.
   - Keep a narrow Boss Tier column (BossTier icon + number) whenever the score parts include "Boss Tier". Never hide it per page.
4. **Player profile:**
   - **Medal cabinet:** one row per event type (Boss, Elite Boss, Race, CT local, CT global). Slots only for the tiers that event awards. Fixed in-game order, ghost outlines for unearned tiers, 32 px, count beside each earned tier.
     - Label fix: `_medalsCTGlobal` = the player's **global** CT medals, not "team".
   - **Single-player medal board:** rows Easy (Easy, Primary Only, Deflation), Medium (Medium, Military Only, Apopalypse, Reverse), and Hard (Hard, Magic Monkeys Only, Double HP MOABs, Half Cash, Alternate Bloons Rounds, Impoppable, CHIMPS). Then a co-op row from `_medalsMultiplayer`.
     - `CHIMPS-BLACK` = the **black** CHIMPS medal.
     - Use in-game mode names.
   - **Boss badges:** a strip of 7 boss portraits with Normal/Elite counts.
   - **Bloon wall:** 40 px sprite + compact number in game order. "Popped in co-op" and "leaked" are stats, not bloons.
   - **Towers / heroes / paragons placed:** portrait + bar + count.
   - **Header:** main tower as a 32 px portrait. No main-tower portraits on leaderboard rows.
   - **Season badge:** a broken image falls back to a tier text chip.
   - **Season badges (2026-09-27):** all eight always shown (Tier 1–4, Ultimate 1–3, Champion), 48 px from the
     game's art (`season` sheet; NK's Ultimate 3 URL is a 404), unearned greyed with "none". Ultimate n = season
     n's themed medal (1 Dr. Monkey / Science, 2 Striker's Vacation, 3 Quincy's Roadtrip). Checked 2026-09-27
     against NK's Ultimate 1/2 images.
   - **Team CT badges (2026-09-27):** same style, one labelled row per ranking: Global (9 tiers, `ctTeam:` art)
     and Group (4 tiers, `ctGroup:` art), best first like the medal cabinet, unearned greyed "none", earned
     marked "earned" (the API has no count). BlueDiamond is named "Diamond" there, as the game's sprites are.
5. **Odyssey:**
   - Crews and available towers/heroes/powers as portrait grids with ×N.
   - Rewards with icons: MonkeyMoney + amount, power icons.
6. **CT tiles:** game-type icon (Boss, Race, LeastCash, LeastTiers) + count. Relic icons if found in the atlases, else text.
7. **Schedule rows:** event-type icon.
8. **Event lists (Bosses, Races, CT, Odyssey), 2026-09-27:** one card per event on `--s1` with a 10 px gap.
   - A 5 px left stripe gives the status (live green, soon blue, ended grey); the status badge still says it in words.
   - Art fills the card's height: boss banner (boss end first, fading into the card; full width on top on phones),
     race map well, odyssey island mosaic, CT icon. Wells are 112 px (88 on phones).
   - A wash of the area colour runs left to right; boss cards take their boss's tint (`data-boss` on the `li`).
   - A live event gets the big card (160 px well, 38 px title), framed in live green with a glow and a "Live now"
     flag on its art, so it reads as featured, not as a slightly-off row.
   - Race cards show the round range ("Rounds 40–100") next to Finishers: it changes a race a lot.
9. **Boss header (boss page + home featured block), 2026-09-27:** NK's banner is the title, since its logo already names
   the boss. It's shown whole (scaled, never cropped), with "#N", status and dates beside it (under it on phones), one
   compact facts line under it (map · rounds · scoring · entries; entries on the tabs on phones), and one yellow rule.
   The name stays in the heading for screen readers. Art failed: the name in its place. Race/CT/odyssey keep text titles.
10. **Medal cut-offs (boss, race, CT boards), 2026-09-27:** never between the tabs and the leaderboard. Desktop: a panel in
    the right-hand column above the rules (CT: its own right-hand column). Phones: a folded bar above the board (title,
    the medal icons, "Show"), opening in place as the usual rows of chips; open/closed is kept for the visit. No popup,
    no sideways scroll.
11. **Leaderboard tables (`table.board.lb`: boss, race, CT players/teams/group), 2026-09-27**, after a product-owner,
    UI-designer and player review:
    - Rows grouped by rank in soft bands (a co-op team is one band) instead of a rule under every row; hover adds a
      layer and a neutral (`--ink-2`) left edge; yellow stays the #1 row's alone (2026-09-30).
    - Top 3: taller rows, 40 px medal (32 on phones), bigger name; #1 a faint yellow wash and yellow left bar, #2/#3 a
      faint white wash. The row washes aren't gold/silver/bronze (the boss medals themselves aren't those colours),
      but the rank plates are, classic podium style (owner, 2026-09-30): #1 yellow, #2 solid ink, #3 bronze.
    - Rank 4+: a bare muted numeral and a 24 px medal.
    - The key score (cash on Least Cash, time on Fastest Time, points on CT) in the display font, 20 px (24 for the top
      3; 18/20 on phones). Tier, dates and secondary times muted, 13 px. A tier below the board's best is set in full
      ink, so the number shows the difference.
    - Gap to #1 under the score on page 1 only, at the board's precision ("+0.517", "+$10,920"); a lower boss tier
      shows as "−1 tier". None on Least Tiers boards. CT global boards: none (rewards depend on the group); CT group
      pages: the gap to the group's first.
    - Medal bracket dividers: a row "▲ Top 50 · cut-off …" with the bracket's medal after the last row of that rank,
      from Top 50 down, never between co-op teammates, none for estimated ranks.
    - Medals once per bracket per page: on the top 3 and the first row of each bracket (the dividers mark the rest).
12. **Calmer event pages, 2026-09-27:** yellow only for what's first or the event itself (the #N plate, the #1 row).
    Selected tabs and the current page are white-on-dark (dark-on-light in light mode); "Rules ↓" and "Show" are
    text links.
13. **Boss page and home boss card, 2026-10-01 (owner):**
    - Boss page: under the banner, one band for what's the same on both difficulties (map art 88 px, map name big in
      the display face, difficulty · mode · rounds). Then Normal / Elite as folder tabs (icon + difficulty + scoring
      name, said once) that are the top edge of one panel holding everything tied to the choice: team size,
      freshness, cut-offs, board, rules, pager. No ranking sentence, no entries figure in the header.
    - Leaderboards have one pager, below the board (no top pager).
    - Home boss card: map art + map name big, then Normal and Elite as two tiles (scoring icon, name, entries);
      while the event is live the tiles pick the top 5 beside them.
    - Option B (a plain strip + separate tab row) is in the backlog as a fallback.

## Acceptance
- On a boss/race/challenge page a player names every banned tower and the hero rule within 2 s without reading. Checked on mobile at 390 px, with no toggle.
- Tier cap readable from the header or pips alone.
- Scoring type (Normal and Elite) identifiable per events-list row in under 2 s.
- No map crop anywhere, at any width.
- Every medal sprite matches its tier: all tiers × event types checked against the game.
- Nothing overflows at 390 px.
- Unknown keys → text chips.
- Page changes stay instant: `node scripts/e2e.ts` passes, and sprites never block rendering.
- Blind screenshot check by experienced players (owner to run).
