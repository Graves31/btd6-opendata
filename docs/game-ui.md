# Game UI: modern, but BTD6

The look the owner picked for My stats (Oct 2026), and the default for new content pages: a clean modern
dark UI whose **frames** feel like the game's menus. The game feel comes from the frames around content, not from
painting every card bright. Plain grey cards look like a dashboard; the old all-blue tiles looked like a toy.
Target the middle.

Code: `<Section tone="…">` (ui.tsx) and the `.gp` / `.gc` / `.gn` / `.gbar` block in styles.css
("game panels"). Reference page: `/me` (views/me.tsx).

## Building blocks

| Piece | What it is | Use |
|---|---|---|
| Title card `.th.gh` | The page's title card (`<ToolHero tone>`) in the game-panel frame: big game art, eyebrow, outlined display title, one-line sub. | Top of every page that has no header of its own (event pages use `EventHead tone`, profiles `.profile.gh`). Tone = the page's main panel tone. |
| Game panel `.gp` | A framed section: 2 px edge in the section colour, 14 px radius, faint diagonal texture, a light wash of the section colour at the top, a 4 px dark drop below. | One per page section: `<Section tone="teal" title={…} aside={…}>`. |
| Title tab | The section title as a game plate on the panel's top edge: section-colour gradient, display font in capitals with a dark outline, game icon on the left. | Automatic with `tone`. Keep titles short (they are capitals). |
| Aside | Small grey summary top right inside the panel ("12 / 45 owned"). | Counts and totals only, never sentences. |
| Card `.gc` | Rounded card (10 px; dark, white in light-theme panels) with a 1 px rim and a 3 px **ledge** in the section colour under it. | Every clickable or stat card inside a panel. `.gc.on` = the picked one (yellow edge and ledge). |
| Number `.gn` | Big display-font number with a dark outline in the section colour. | The one headline number on a card. Not for body figures or tables. |
| Button `.gbtn` | Raised plate in the section colour (blue outside a panel), 2 px dark edge, 3 px dark ledge that presses in on click, white text with a dark outline. `.gbtn.go` = the yellow main action. | Every button on a game-styled page (Refresh, Save, Show). Header: My stats (blue) and Suggest (violet), the tone of their page; `.on` = yellow edge. Not for links or tabs. |
| Bar `.gbar > i` | Sunken dark track, glossy fill in the section colour; `.done` turns it green. | Progress. Green means complete, everywhere. |

## Rules

1. **Colour = section.** Each panel gets one tone. Its tab, edge, card ledges, ×count badges and bars all follow
   it. Neighbouring panels never share a tone, except a run of closely related panels (Towers, Monkey Knowledge,
   Upgrades and Pro powers share blue on /me). Tones: blue, amber, violet, teal, rose, bronze, crimson, green.
   Their values live only in the `.gp-<tone>` rules. Add a tone there, never a hex in a page's CSS.
2. **Meaning colours stay fixed.** Yellow (`--accent`) = "this one" (picked, #1, the brand). Green = complete or
   live. Blue (`--soon`) = in progress or upcoming. Section tones never replace these: a finished bar is green in
   every section, and rings stay green/blue.
3. **Depth is one step.** Panel > card. Cards sit on the panel; nothing sits on a card except text, icons and
   bars. Depth comes from the ledge (a solid 3-4 px shadow straight down) and a 1 px top highlight. No blurred
   drop shadows, no glow halos, no gradients across the whole page.
4. **Game art carries the identity.** Every section tab and every card with a subject gets its official icon
   (`Spr` / `Ico`). Prefer the game's art over generic SVG icons. Icons get a small hard drop shadow
   (`drop-shadow(0 2px 0 rgb(0 0 0 / .4))`), never a halo.
5. **Type.** Display font (Big Shoulders) for tab titles and headline numbers, with the dark outline
   (`-webkit-text-stroke` + `paint-order: stroke fill`). Archivo for everything else. Labels are 11-12 px capitals
   with letter spacing, in `--ink-2`. Body text never gets an outline.
6. **Panels follow the theme; art cards stay dark.** Content panels (`.gp`) are dark in the dark theme and light
   in the light theme (pale surface, white cards, dark text); the section colour stays on the tab, edge, rims and
   ledges. Title cards and art cards (`.gh`: banners, profile headers, tool heroes) are dark in both themes so the
   game art pops. Both set their own token set, `--bg` included, so content built on `--bg`, `--s1`, `--ink`,
   `--rule` and so on works inside without per-theme rules. Panel and card surfaces are tokens too (`--gp-bg`,
   `--gc-1` / `--gc-2`, `--gc-hi`, `--gc-ink`): use them, never a hex. `--page` is the real page colour (for
   something that must match the page from inside a panel). White text only on coloured plates (tabs, buttons).
7. **Same size, same row.** Cards in a grid are the same height (min-height on the card, ellipsis on long names),
   and their contents are centred or aligned on a grid. Rows fill evenly: pick column counts that divide the item
   count (/me tiles: 6 / 4 / 3 / 2).
8. **Details open in place.** A card that has more opens one shared full-width panel under its row (Pick/Panel
   in me.tsx), never a modal, never a second page.
9. **Phones.** At 390 px the panel padding drops to 10 px, the tab font to 19 px, grids drop to 2 or 1
   columns, and the aside wraps under the tab. No sideways scroll.
10. **Accessibility.** Text on cards and tabs meets 4.5:1 (white on a tab or button plate is fine thanks to the
    outline: a text stroke on tabs, a 4-way text shadow on buttons; grey labels use `--ink-2` / `--ink-3`, never darker). Clickable cards are real `<button>`s with
    `aria-expanded`. Colour is never the only signal: complete also shows the full bar and the count.

## Don't

- Paint whole cards in the section colour (that was the "toy" look). Colour belongs to the frame, tab, ledge and
  bars.
- Use more than one tone inside a panel, or invent a tone for a single element.
- Stack panels inside panels. A sub-group inside a panel uses an `h3` label (`.my-h3`) and its own grid.
- Add outlines, ledges or capitals to running text, tables or form fields.

## Page map (v3.0.0: every page is in the game look)

The look shipped page by page as a transition, not a redesign: each page kept its layout and graphics and only its
frames changed. The tone of every page, for reference when touching one:

| Page | Title card | Panels |
|---|---|---|
| Live `/` | featured boss in the rose frame | this week blue (four cards built alike: same ledge, art well, height), coming up violet; phones: mini cards in the boss frame |
| `/bosses` | rose | boss stats violet (portrait ledges in each boss's colour), this week green, past blue, history bronze. The boss-tinted banner cards and the boss order ring stay as they are (the list's identity) |
| `/boss/<id>` | banner in the rose frame, Normal / Elite cards | board blue, cut-offs bronze, rules violet |
| `/bosses/<type>` | banner in the rose frame | health green, kill time amber, always active violet, skulls crimson, spawns teal, past events blue, about bronze (fold) |
| `/races`, `/race/<id>` | crimson | leaderboard blue, cut-offs bronze (`CutoffStrip tone`), rules violet, history bronze (`FullHistory tone`) |
| `/ct`, `/ct/<id>`, groups | amber, tab cards | boards blue, cut-offs bronze, map teal, tile mix violet, relics rose; list: my team violet, this week green, next teal, past blue |
| `/odyssey`, `/odyssey/<id>` | teal | islands in the picked difficulty's colour (Easy green, Medium blue, Hard amber) |
| `/maps`, `/maps/<id>` | the map's difficulty (green, blue, amber, crimson) | folds use `.gp-fold` |
| `/challenges`, `/challenge/<id>` | bronze | live now green, each daily series in its card colour (standard amber, advanced crimson, co-op blue), player lists violet; play stats blue, rules violet |
| `/player/<id>`, `/team/<id>` | profile header in the blue / amber frame (`.profile.gh`) | overview stat cards blue, event medals amber, boss badges rose, seasons violet, single-player teal, co-op green; CT badges violet, CT history blue |
| `/me`, `/suggest` | blue / violet | see me.tsx |
| `/tools` and the tools | hub blue, paragon and scaling violet, farming green, bank amber, hero XP teal, rounds blue | `gp gp-<tone>` on a `.pg-panel`: its `.pg-ph` heading becomes the tab, steppers and chips become plates. Round visualizer: frames only (its layout and scroll model stay) |
| `/stats` | blue | totals blue, chart teal, top lists one colour each |
| errors, offline | `.gh` title card: amber, warnings crimson, busy and offline blue | |

The logo is the game-logo wordmark: "BTD6" white and "Open Data" yellow in Luckiest Guy (`logo-font.css`, inlined),
heavy dark-blue outline, two-step drop, tilted -4°; only "BTD6" under 900 px. The favicon, phone icon and link preview
are drawn from the same font and colours (`scripts/logo_font.py`). Back links (`‹ Maps`, `‹ Boss events`) are small blue plates. Pages opened from a list or board get one
(`BACK_ON` in main.tsx); a tab or page of the same page keeps it (nav.ts).

## New page checklist

1. A toned title card (`<ToolHero tone>`, or `EventHead tone` for an event), then one `<Section tone>` per block.
2. Buttons `.gbtn` (or a page plate rule with the same look), picked chips and cards `.gc` / `.gc.on`, form fields
   sunk into the panel (dark well, inset shadow; see `.sug-field`).
3. White text on a plate gets the dark outline (the "Plate text" rule in styles.css): add the plate's selector there.
4. The offline e2e guards this: it fails on a `section.sec` that isn't a game panel or a leftover `.page-h`, and on
   text inside a light-theme panel under 3:1.

## New section checklist

1. `<Section tone="…" title={<><Spr family="ui" k="IconKey" size={34} />Title</>} aside={counts}>`, with a tone
   different from its neighbours.
2. Cards: `.gc` (+ `.gn` for the headline number, `.gbar` for progress).
3. Check desktop 1280 and mobile 390 screenshots, in both the dark and light themes.
