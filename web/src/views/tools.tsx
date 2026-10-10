// Tools hub (/tools): the site's calculators and visualizers, one card each (the Live page's tile look).

import type { ComponentChildren } from "preact";
import farmingArt from "../art/tools/farming.webp";
import paragonArt from "../art/tools/paragon.webp";
import roundsArt from "../art/tools/rounds.webp";
import { href } from "../routes.ts";
import { A } from "../ui.tsx";

/** Tile art: the game sprite at 2x (scripts/build_art.py TOOL_ICONS), so it stays sharp on phones. */
const art = (src: string) => <img src={src} width={96} height={96} alt="" decoding="async" />;

function ToolTile(p: { to: string; art: ComponentChildren; title: string; children: ComponentChildren }) {
  return (
    <A href={p.to} class="tile tool-tile">
      <span class="tile-art">{p.art}</span>
      <span class="tile-body">
        <span class="eyebrow">Tool</span>
        <h2 class="tile-title">{p.title}</h2>
        <span class="tile-meta">{p.children}</span>
        <span class="tool-go">
          Open <span aria-hidden="true">→</span>
        </span>
      </span>
    </A>
  );
}

export function ToolsHub() {
  return (
    <div class="tools">
      <header class="rv-bar">
        <div class="rv-bar-t">
          <p class="eyebrow">BTD6 Open Data</p>
          <h1 class="rv-h1">Tools</h1>
        </div>
      </header>
      <div class="tiles tools-tiles">
        <ToolTile to={href.rounds({})} title="Round visualizer" art={art(roundsArt)}>
          Every round of every round set, from the game's own data: the bloons, RBE and spawn timeline.
        </ToolTile>
        <ToolTile to={href.paragon()} title="Paragon calculator" art={art(paragonArt)}>
          What degree your sacrifices make, and the quickest way to reach the next boss breakpoint.
        </ToolTile>
        <ToolTile to={href.farming()} title="Farming resources" art={art(farmingArt)}>
          Banana farm reference charts: when a 0-0-0, 1-0-0 and 2-0-0 farm drops its bananas during a round.
        </ToolTile>
      </div>
    </div>
  );
}
