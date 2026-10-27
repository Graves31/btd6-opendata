// Contested Territory board: where each 3-letter tile code sits on the 169-tile hex board.
//
// Source: the game's own table, NinjaKiwi.GUTS CtMapGenerator.TileCodes (v57 code). It maps each code to grid
// coords (x, y) in "doubled rows": x = column (|x| <= 7), y steps by 2 down a column, neighbours (0, ±2) and
// (±1, ±1); MapSizing places a tile at world (27.2·x, 15.8·y), i.e. flat-top hexes. The table follows one rule:
//   1st letter = sector A–F, one per team, rotating 60° around MRX (the centre);
//   2nd letter = lane: A runs from the team's corner straight to the centre, B/D/F are 1/2/3 lanes to one side,
//                C/E/G 1/2/3 lanes to the other (lane L holds 7 − L tiles);
//   3rd letter = steps in from the outer edge (xAA = the corner = TeamStart).
// One exception: (-1,-1) is "FAH" in the game, where the rule says FAG.
// Axial coords here: q = x, r = -(x + y) / 2, so standard flat-top maths puts sector A at the bottom.

import type { CTTile } from "../../src/nk/types.ts";

export type Hex = { q: number; r: number };

const SECTORS = "ABCDEF";

/** Axial coords of a tile code (MRX = 0,0), undefined for a code the game doesn't use. */
export function tileHex(id: string): Hex | undefined {
  if (id === "MRX") return { q: 0, r: 0 };
  const code = id === "FAH" ? "FAG" : id === "FAG" ? "" : id;
  if (!/^[A-F][A-G][A-G]$/.test(code)) return undefined;
  const lane = code.charCodeAt(1) - 65;
  const depth = code.charCodeAt(2) - 65;
  if (lane + depth > 6) return undefined;
  const o = (lane + 1) >> 1;
  const side = lane % 2 === 1; // B/D/F
  // sector A: corner (0, 7), inward (0, -1), B-side (1, -1), C-side (-1, 0)
  let q = side ? o : -o;
  let r = 7 - depth - (side ? o : 0);
  for (let k = SECTORS.indexOf(code[0]); k > 0; k--) [q, r] = [q + r, -q];
  return { q: q || 0, r: r || 0 }; // no -0
}

/** Hex distance between two tiles (1 = neighbours). */
export const hexDist = (a: Hex, b: Hex) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/** Centre of a flat-top hex of circumradius 1 (screen y down). */
export const hexXY = (h: Hex): [number, number] => [1.5 * h.q, Math.sqrt(3) * (h.r + h.q / 2)];

/** Relic id of a relic tile ("Relic - ManaBulwark" → "ManaBulwark"). */
export const tileRelic = (t: CTTile) => (t.type.startsWith("Relic - ") ? t.type.slice(8) : undefined);

/** CT game types: label, leaderboard icon (ui sheet) and map colour (CSS var). */
export const CT_GAME: Record<string, { label: string; icon?: string; color: string }> = {
  LeastCash: { label: "Least Cash", icon: "LeastCash", color: "var(--d0)" },
  LeastTiers: { label: "Least Tiers", icon: "LeastTiers", color: "var(--d1)" },
  Race: { label: "Race", icon: "GameTime", color: "var(--d2)" },
  Boss: { label: "Boss", icon: "BossTier", color: "var(--d3)" },
  TeamStart: { label: "Team start", color: "var(--ink-3)" },
};

/** Tile type label ("TeamFirstCapture" → "Team first capture", relics → "Relic"). */
export const tileTypeLabel = (t: CTTile) =>
  t.type.startsWith("Relic - ")
    ? "Relic"
    : ({ Regular: "Regular", Banner: "Banner", TeamFirstCapture: "Team first capture", TeamStart: "Team start" } as Record<string, string>)[t.type] ?? t.type;
