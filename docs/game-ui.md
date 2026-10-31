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
| Title card `.th.gh` | The page's title card (`<ToolHero tone>`) in the game-panel frame: big game art, eyebrow, outlined display title, one-line sub. | Top of every converted page that has no header of its own (/me with a save uses the profile header instead). Tone = the page's main panel tone. |
| Game panel `.gp` | A framed section: 2 px edge in the section colour, 14 px radius, faint diagonal texture, a light wash of the section colour at the top, a 4 px dark drop below. | One per page section: `<Section tone="teal" title={…} aside={…}>`. |
| Title tab | The section title as a game plate on the panel's top edge: section-colour gradient, display font in capitals with a dark outline, game icon on the left. | Automatic with `tone`. Keep titles short (they are capitals). |
| Aside | Small grey summary top right inside the panel ("12 / 45 owned"). | Counts and totals only, never sentences. |
| Card `.gc` | Dark rounded card (10 px) with a 1 px rim and a 3 px **ledge** in the section colour under it. | Every clickable or stat card inside a panel. `.gc.on` = the picked one (yellow edge and ledge). |
| Number `.gn` | Big display-font number with a dark outline in the section colour. | The one headline number on a card. Not for body figures or tables. |
| Button `.gbtn` | Raised plate in the section colour (blue outside a panel), 2 px dark edge, 3 px dark ledge that presses in on click. `.gbtn.go` = the yellow main action. | Every button on a game-styled page (Refresh, Save, Show). Header: My stats (blue) and Suggest (violet), the tone of their page; `.on` = yellow edge. Not for links or tabs. |
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
6. **Panels are dark in both themes**, like the game's menus and the site header. `.gp` resets the theme tokens
   to the dark set, so content built on `--s1`, `--ink`, `--rule` and so on works inside without per-theme rules.
   Never hard-code light-theme colours inside a panel.
7. **Same size, same row.** Cards in a grid are the same height (min-height on the card, ellipsis on long names),
   and their contents are centred or aligned on a grid. Rows fill evenly: pick column counts that divide the item
   count (/me tiles: 6 / 4 / 3 / 2).
8. **Details open in place.** A card that has more opens one shared full-width panel under its row (Pick/Panel
   in me.tsx), never a modal, never a second page.
9. **Phones.** At 390 px the panel padding drops to 10 px, the tab font to 19 px, grids drop to 2 or 1
   columns, and the aside wraps under the tab. No sideways scroll.
10. **Accessibility.** Text on cards and tabs meets 4.5:1 (white on the tab gradient is fine thanks to the
    outline; grey labels use `--ink-2` / `--ink-3`, never darker). Clickable cards are real `<button>`s with
    `aria-expanded`. Colour is never the only signal: complete also shows the full bar and the count.

## Don't

- Paint whole cards in the section colour (that was the "toy" look). Colour belongs to the frame, tab, ledge and
  bars.
- Use more than one tone inside a panel, or invent a tone for a single element.
- Stack panels inside panels. A sub-group inside a panel uses an `h3` label (`.my-h3`) and its own grid.
- Add outlines, ledges or capitals to running text, tables or form fields.

## Bringing a page over

Pages move over one at a time, and it is a transition, not a redesign: keep the page's layout and graphics, and
change only the frames. Put its content in `<Section tone>` panels, turn its buttons into `.gbtn`, its picked
chips and cards into `.gc` / `.gc.on`, and sink form fields into the panel (dark well, inset shadow; see
`.sug-field`). Its plain title becomes the toned title card (`<ToolHero tone>`). Done so far: /me, /suggest, the header's My
stats and Suggest buttons, /maps and /maps/<id> (tone = the map's difficulty: green, blue, amber, crimson; folding
panels use `.gp-fold`), /odyssey and /odyssey/<id> (teal title cards; Islands panel in the picked difficulty's
colour: Easy green, Medium blue, Hard amber), /races and /race/<id> (crimson title cards; leaderboard blue, medal
cut-offs bronze via `CutoffStrip tone`, rules violet; full history a bronze fold via `FullHistory tone`; boss and CT
pages can reuse all of these).

## New section checklist

1. `<Section tone="…" title={<Lbl k="IconKey">Title</Lbl>} aside={counts}>`, with a tone different from its
   neighbours (`Lbl` = icon + text, in me.tsx; move it to ui.tsx when a second page needs it).
2. Cards: `.gc` (+ `.gn` for the headline number, `.gbar` for progress).
3. Check desktop 1280 and mobile 390 screenshots, in both the dark and light themes.
