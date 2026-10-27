// Contested Territory hex board (layout in ctMap.ts): the interactive map, a colour-only thumbnail for cards,
// and the panel describing the selected tile.

import type { CTTile } from "../../../src/nk/types.ts";
import { ART } from "../art/index.ts";
import { CT_GAME, hexXY, tileHex, tileRelic, tileTypeLabel } from "../ctMap.ts";
import { RELIC_INFO } from "../data/names.ts";
import { human } from "../format.ts";
import { Spr } from "../sprite.tsx";

/** Flat-top hex corners around (0,0), circumradius k. */
const corners = (k: number, cx = 0, cy = 0) =>
  [0, 1, 2, 3, 4, 5]
    .map((i) => `${(cx + k * Math.cos((i * Math.PI) / 3)).toFixed(3)},${(cy + k * Math.sin((i * Math.PI) / 3)).toFixed(3)}`)
    .join(" ");
const HEX = corners(0.96);
const HEX_IN = corners(0.7);
// radius-7 board + one hex: x ±11.5, y ±13 (√3·7.5)
const VIEW = "-11.6 -13.1 23.2 26.2";
const FLAG = "M-.2 .62V-.12l.52 .19-.52 .19z"; // pennant under the code, like the relic icon

const gameOf = (t: CTTile) => CT_GAME[t.gameType];
const colorOf = (t: CTTile) => gameOf(t)?.color ?? "var(--rule-2)";

function RelicImg(p: { relic: string; x: number; y: number; s: number }) {
  const sheet = ART.relic;
  const i = sheet?.keys[p.relic];
  if (!sheet || i === undefined) return <circle class="hexm-relic-dot" cx={p.x} cy={p.y} r={p.s / 3} />;
  const c = sheet.cell;
  return (
    <svg x={p.x - p.s / 2} y={p.y - p.s / 2} width={p.s} height={p.s} viewBox={`${(i % sheet.cols) * c} ${Math.floor(i / sheet.cols) * c} ${c} ${c}`}>
      <image href={sheet.url} width={sheet.cols * c} height={sheet.rows * c} />
    </svg>
  );
}

export function HexMap(props: {
  tiles: CTTile[];
  sel?: string;
  onSel?: (id: string) => void;
  filter?: (t: CTTile) => boolean;
}) {
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
          const mark = !!relic || t.type === "Banner";
          const label = `${t.id}, ${tileTypeLabel(t)}${relic ? ` ${RELIC_INFO[relic]?.name ?? human(relic)}` : ""}${t.gameType === "TeamStart" ? "" : `, ${gameOf(t)?.label ?? human(t.gameType)}`}`;
          return (
            <g
              key={t.id}
              class={`hexm-t${props.filter && !props.filter(t) ? " dim" : ""}`}
              transform={`translate(${x.toFixed(3)} ${y.toFixed(3)})`}
              style={{ "--c": colorOf(t) }}
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
              <polygon points={HEX} />
              {t.type === "TeamStart" && <polygon class="hexm-start" points={HEX_IN} />}
              {relic && <RelicImg relic={relic} x={0} y={0.22} s={1.05} />}
              {t.type === "Banner" && <path class="hexm-flag" d={FLAG} />}
              <text class="hexm-code" y={mark ? -0.42 : 0.16}>
                {t.id}
              </text>
            </g>
          );
        })}
        {sel && <polygon class="hexm-sel" points={corners(0.96, sel.xy[0], sel.xy[1])} />}
      </svg>
      <ul class="hexm-legend">
        {Object.entries(CT_GAME).map(([k, g]) => {
          const n = count((t) => t.gameType === k);
          return n ? (
            <li key={k}>
              <span class="hexm-sw" style={{ "--c": g.color }} />
              {g.icon && <Spr family="ui" k={g.icon} size={24} label />}
              {g.label} <span class="num">{n}</span>
            </li>
          ) : null;
        })}
        <li>
          <svg class="hexm-li" viewBox="-.4 -.22 .9 .9" aria-hidden="true">
            <path class="hexm-flag" d={FLAG} />
          </svg>
          Banner <span class="num">{count((t) => t.type === "Banner")}</span>
        </li>
        <li>
          <Spr family="ui" k="Relic" size={24} label optional />
          Relic <span class="num">{count((t) => !!tileRelic(t))}</span>
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
    const c = colorOf(t);
    d.set(c, `${d.get(c) ?? ""}M${corners(0.92, x, y).replace(/ /g, "L")}z`);
  }
  return (
    <svg class="hexm-thumb" viewBox={VIEW} width={props.size} height={(props.size * 26.2) / 23.2} aria-hidden="true">
      {[...d].map(([c, path]) => (
        <path key={c} d={path} style={{ "--c": c }} />
      ))}
    </svg>
  );
}

/** What the selected tile is: code, type, game type, relic and its effect. */
export function HexTilePanel(props: { tile?: CTTile }) {
  const t = props.tile;
  if (!t) return <div class="hexm-panel hexm-none">Pick a tile on the map to see what it is.</div>;
  const g = gameOf(t);
  const relic = tileRelic(t);
  const info = relic ? (RELIC_INFO[relic] ?? { name: human(relic), description: "" }) : undefined;
  return (
    <div class="hexm-panel" aria-live="polite">
      <div class="hexm-ph">
        <span class="hexm-big mono">{t.id}</span>
        <span class="hexm-kind">{tileTypeLabel(t)}</span>
      </div>
      {t.gameType !== "TeamStart" && (
        <span class="ifact">
          {g?.icon ? <Spr family="ui" k={g.icon} size={32} label /> : <span class="hexm-sw" style={{ "--c": colorOf(t) }} />}
          <span>{g?.label ?? human(t.gameType)}</span>
        </span>
      )}
      {relic && info && (
        <span class="relic">
          <Spr family="relic" k={relic} size={48} name={info.name} label />
          <span class="relic-t">
            <span class="relic-n">{info.name}</span>
            {info.description && <span class="relic-d">{info.description}</span>}
          </span>
        </span>
      )}
    </div>
  );
}
