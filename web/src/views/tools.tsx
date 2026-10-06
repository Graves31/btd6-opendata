// Tools hub (/tools): the site's calculators and visualizers, one card each (the Live page's tile look).

import type { ComponentChildren } from "preact";
import { Spr } from "../sprite.tsx";
import { href } from "../routes.ts";
import { A } from "../ui.tsx";
import { paragonIcon } from "./paragon.tsx";

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
        <ToolTile to={href.rounds({})} title="Round visualizer" art={<Spr family="bloon" k="moab" size={96} label />}>
          Every round of every round set, from the game's own data: the bloons, RBE and spawn timeline.
        </ToolTile>
        <ToolTile to={href.paragon()} title="Paragon calculator" art={paragonIcon("DartMonkey", 96)}>
          What degree your sacrifices make, and the quickest way to reach the next boss breakpoint.
        </ToolTile>
      </div>
    </div>
  );
}
