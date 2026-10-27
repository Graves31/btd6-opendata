// Contested Territory hex board (layout in ctMap.ts): the interactive map, a colour-only thumbnail for cards,
// and the panel describing the selected tile.
//
// Tiles are drawn like the game's own: its CT board is 3D, each tile a bevelled flat-top hex (mesh "Tile",
// textures TileTeam<Colour>: a flat face, a light inner edge, a bevel dark on the left, lighter on the right).
// The face colours are the game's team tile colours (CSS .g-<gameType>); the site colours tiles by game type,
// the game by owning team. On tiles: relic icons (the relic sheet) and the banner (ui CtBanner = the game's art
// of the banner it plants on banner tiles). Nothing else is drawn: no invented markers.

import { useState } from "preact/hooks";
import type { CTTile } from "../../../src/nk/types.ts";
import { ART } from "../art/index.ts";
import { CT_GAME, hexXY, tileHex, tileRelic, tileTypeLabel } from "../ctMap.ts";
import { RELIC_INFO } from "../data/names.ts";
import { human } from "../format.ts";
import { hasArt, Spr } from "../sprite.tsx";

/** Flat-top hex corners around (cx,cy), circumradius k. */
const pts = (k: number, cx = 0, cy = 0) =>
  [0, 1, 2, 3, 4, 5].map((i) => [cx + k * Math.cos((i * Math.PI) / 3), cy + k * Math.sin((i * Math.PI) / 3)]);
const str = (p: number[][]) => p.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(" ");
const corners = (k: number, cx = 0, cy = 0) => str(pts(k, cx, cy));
const R = 0.95;
const BEVEL = corners(R);
/** The right half of the bevel, which the game lights (top-middle, upper-right, right, lower-right, bottom-middle). */
const LIT = (() => {
  const c = pts(R);
  return str([[0, c[5][1]], c[5], c[0], c[1], [0, c[1][1]]]);
})();
const EDGE = corners(0.8);
const FACE = corners(0.72);
// radius-7 board + one hex: x ±11.5, y ±13 (√3·7.5)
const VIEW = "-11.6 -13.1 23.2 26.2";

/** One tile as the game draws it (colours from the .g-<gameType> class on an ancestor). */
const Tile = () => (
  <>
    <polygon class="tb" points={BEVEL} />
    <polygon class="tm" points={LIT} />
    <polygon class="tl" points={EDGE} />
    <polygon class="tf" points={FACE} />
  </>
);

/** A single tile as a legend key: the map's own tile, same colours. */
export const TileKey = (p: { g: string }) => (
  <svg class={`hexm-key g-${p.g}`} viewBox="-1 -1 2 2" aria-hidden="true">
    <Tile />
  </svg>
);

type Art = { family: "relic" | "ui"; k: string };

/** A sprite-sheet cell inside the SVG map. */
function SheetImg(p: Art & { y: number; s: number }) {
  const sheet = ART[p.family];
  const i = sheet?.keys[p.k];
  if (!sheet || i === undefined) return null;
  const c = sheet.cell;
  return (
    <svg x={-p.s / 2} y={p.y - p.s / 2} width={p.s} height={p.s} viewBox={`${(i % sheet.cols) * c} ${Math.floor(i / sheet.cols) * c} ${c} ${c}`}>
      <image href={sheet.url} width={sheet.cols * c} height={sheet.rows * c} />
    </svg>
  );
}

/** What a tile carries on top, as the game shows it: its relic, or the banner. */
function tileArt(t: CTTile): Art | undefined {
  const relic = tileRelic(t);
  if (relic) return hasArt("relic", relic) ? { family: "relic", k: relic } : { family: "ui", k: "Relic" };
  if (t.type === "Banner") return { family: "ui", k: "CtBanner" };
  return undefined;
}

const CODES_KEY = "btd6od.ctCodes";
function readCodes(): boolean {
  try {
    return localStorage.getItem(CODES_KEY) === "1";
  } catch {
    return false;
  }
}

export function HexMap(props: {
  tiles: CTTile[];
  sel?: string;
  onSel?: (id: string) => void;
  filter?: (t: CTTile) => boolean;
}) {
  const [codes, setCodes] = useState(readCodes);
  const toggleCodes = () => {
    const v = !codes;
    setCodes(v);
    try {
      localStorage.setItem(CODES_KEY, v ? "1" : "0");
    } catch {
      // private mode / blocked storage: the choice lasts for this visit only
    }
  };
  const placed = props.tiles.flatMap((t) => {
    const h = tileHex(t.id);
    return h ? [{ t, xy: hexXY(h) }] : [];
  });
  const sel = placed.find((p) => p.t.id === props.sel);
  const count = (f: (t: CTTile) => boolean) => props.tiles.filter(f).length;
  const pick = (id: string) => props.onSel?.(id);
  // One tab stop (the selected tile, else the centre); arrow keys walk to the nearest tile that way.
  const stop = sel?.t.id ?? placed.find((p) => p.t.id === "MRX")?.t.id ?? placed[0]?.t.id;
  const ARROW: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const step = (from: [number, number], [dx, dy]: [number, number]) => {
    let best: (typeof placed)[number] | undefined;
    let bestScore = Infinity;
    for (const p of placed) {
      const vx = p.xy[0] - from[0];
      const vy = p.xy[1] - from[1];
      const along = vx * dx + vy * dy;
      if (along < 0.5) continue;
      const score = along + 2 * Math.abs(vx * dy - vy * dx);
      if (score < bestScore) [best, bestScore] = [p, score];
    }
    return best;
  };
  return (
    <div class="hexm">
      <svg class="hexm-svg" viewBox={VIEW} role="group" aria-label="Contested Territory map">
        {placed.map(({ t, xy: [x, y] }) => {
          const relic = tileRelic(t);
          const art = tileArt(t);
          const label = `${t.id}, ${tileTypeLabel(t)}${relic ? ` ${RELIC_INFO[relic]?.name ?? human(relic)}` : ""}${t.gameType === "TeamStart" ? "" : `, ${CT_GAME[t.gameType]?.label ?? human(t.gameType)}`}`;
          return (
            <g
              key={t.id}
              class={`hexm-t g-${t.gameType}${props.filter && !props.filter(t) ? " dim" : ""}`}
              transform={`translate(${x.toFixed(3)} ${y.toFixed(3)})`}
              data-id={t.id}
              tabindex={t.id === stop ? 0 : -1}
              role="button"
              aria-label={label}
              aria-pressed={t.id === props.sel}
              onClick={() => pick(t.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(t.id);
                } else if (ARROW[e.key]) {
                  e.preventDefault();
                  const next = step([x, y], ARROW[e.key]);
                  if (!next) return;
                  pick(next.t.id);
                  (e.currentTarget.ownerSVGElement?.querySelector(`[data-id="${next.t.id}"]`) as SVGGElement | null)?.focus();
                }
              }}
            >
              <title>{label}</title>
              <Tile />
              {art && <SheetImg {...art} y={codes ? 0.24 : 0} s={codes ? 0.95 : 1.25} />}
              {codes && (
                <text class="hexm-code" y={art ? -0.4 : 0.16}>
                  {t.id}
                </text>
              )}
            </g>
          );
        })}
        {sel && (
          <g class="hexm-sel" transform={`translate(${sel.xy[0].toFixed(3)} ${sel.xy[1].toFixed(3)})`}>
            <polygon class="glow" points={BEVEL} />
            <polygon points={BEVEL} />
          </g>
        )}
      </svg>
      <ul class="hexm-legend">
        {Object.entries(CT_GAME).map(([k, g]) => {
          const n = count((t) => t.gameType === k);
          return n ? (
            <li key={k}>
              <TileKey g={k} />
              {g.icon && <Spr family="ui" k={g.icon} size={24} label />}
              {g.label} <span class="num">{n}</span>
            </li>
          ) : null;
        })}
        <li>
          <Spr family="ui" k="CtBanner" size={24} label optional />
          Banner <span class="num">{count((t) => t.type === "Banner")}</span>
        </li>
        <li>
          <Spr family="ui" k="Relic" size={24} label optional />
          Relic <span class="num">{count((t) => !!tileRelic(t))}</span>
        </li>
        <li class="hexm-tgl">
          <button type="button" aria-pressed={codes} onClick={toggleCodes}>
            Tile codes
          </button>
        </li>
      </ul>
    </div>
  );
}

/** Colour-only board for cards: one path per game type, no labels, no interaction. */
export function HexThumb(props: { tiles: CTTile[]; size: number }) {
  const d = new Map<string, string>();
  for (const t of props.tiles) {
    const h = tileHex(t.id);
    if (!h) continue;
    const [x, y] = hexXY(h);
    d.set(t.gameType, `${d.get(t.gameType) ?? ""}M${corners(0.94, x, y).replace(/ /g, "L")}z`);
  }
  return (
    <svg class="hexm-thumb" viewBox={VIEW} width={props.size} height={(props.size * 26.2) / 23.2} aria-hidden="true">
      {[...d].map(([g, path]) => (
        <path key={g} class={`g-${g}`} d={path} />
      ))}
    </svg>
  );
}

/** What the selected tile is: code, type, game type, relic and its effect. */
export function HexTilePanel(props: { tile?: CTTile }) {
  const t = props.tile;
  if (!t) return <div class="hexm-panel hexm-none">Pick a tile on the map to see what it is.</div>;
  const g = CT_GAME[t.gameType];
  const relic = tileRelic(t);
  const info = relic ? (RELIC_INFO[relic] ?? { name: human(relic), description: "" }) : undefined;
  return (
    <div class="hexm-panel" aria-live="polite">
      <div class="hexm-ph">
        <span class="hexm-big mono">{t.id}</span>
        <span class="hexm-kind">
          {t.type === "Banner" && <Spr family="ui" k="CtBanner" size={24} label optional />}
          {tileTypeLabel(t)}
        </span>
      </div>
      {t.gameType !== "TeamStart" && (
        <span class="ifact">
          {g?.icon && <Spr family="ui" k={g.icon} size={32} label />}
          <span>{g?.label ?? human(t.gameType)}</span>
        </span>
      )}
      {relic && info && (
        <span class="relic">
          <Spr family={hasArt("relic", relic) ? "relic" : "ui"} k={hasArt("relic", relic) ? relic : "Relic"} size={48} name={info.name} label />
          <span class="relic-t">
            <span class="relic-n">{info.name}</span>
            {info.description && <span class="relic-d">{info.description}</span>}
          </span>
        </span>
      )}
    </div>
  );
}
