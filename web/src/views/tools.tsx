// Tools hub (/tools): the site's calculators and visualizers, one card each (the Live page's tile look).

import type { ComponentChildren } from "preact";
import bankArt from "../art/tools/bank.webp";
import farmingArt from "../art/tools/farming.webp";
import paragonArt from "../art/tools/paragon.webp";
import paragonScalingArt from "../art/tools/paragonScaling.webp";
import roundsArt from "../art/tools/rounds.webp";
import { href } from "../routes.ts";
import { A, ToolHero } from "../ui.tsx";
import toolsArt from "../art/tools/overclock.webp";

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

/** Every tool: the hub's cards and the header's Tools menu. */
export const TOOLS = [
  {
    to: href.rounds({}),
    title: "Round visualizer",
    art: roundsArt,
    sub: "Every round of every round set, from the game's own data: the bloons, RBE and spawn timeline.",
  },
  {
    to: href.paragon(),
    title: "Paragon calculator",
    art: paragonArt,
    sub: "What degree your sacrifices make, and the quickest way to reach the next boss breakpoint.",
  },
  {
    to: href.paragonScaling(),
    title: "Paragon scaling",
    art: paragonScalingArt,
    sub: "What each paragon degree from 1 to 100 adds: power needed, damage, pierce, attack speed and boss damage, charted.",
  },
  {
    to: href.farming(),
    title: "Farming resources",
    art: farmingArt,
    sub: "Banana farm reference charts: when a 0-0-0, 1-0-0 and 2-0-0 farm drops its bananas during a round.",
  },
  {
    to: href.bankPlanner(),
    title: "Bank & IMF Loan planner",
    art: bankArt,
    sub: "When to collect a Monkey Bank so the cap never eats your cash, and how much to deposit in an IMF Loan.",
  },
];

export function ToolsHub() {
  return (
    <div class="tools">
      <ToolHero
        art={<img src={toolsArt} width={96} height={96} alt="" />}
        eyebrow="BTD6 Open Data"
        title="Tools"
        sub="Calculators and visualizers built from the game's own data."
      />
      <div class="tiles tools-tiles">
        {TOOLS.map((t) => (
          <ToolTile key={t.to} to={t.to} title={t.title} art={art(t.art)}>
            {t.sub}
          </ToolTile>
        ))}
      </div>
    </div>
  );
}
