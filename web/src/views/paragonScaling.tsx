// Tools → Paragon scaling (/tools/paragon-scaling?d=40): how a paragon gets stronger per degree, charted from the
// game data (paragon.ts scaling() / powerForDegree()). Static page, no NK data. Hover/tap a chart to read a degree.

import { useState } from "preact/hooks";
import { fmtInt } from "../format.ts";
import {
  degreeData,
  gameVersion,
  powerForDegree,
  scaling,
} from "../paragon.ts";
import { href } from "../routes.ts";
import { A } from "../ui.tsx";

const VER = "57" as const;
const DEG = Array.from({ length: 100 }, (_, i) => i + 1);
const one = (n: number) => +n.toFixed(1);
const times = (x: number) => `×${+x.toFixed(2)}`;
const sc = (d: number) => scaling(d, VER);
const pw = (d: number) => powerForDegree(d, false, VER);
const compact = (n: number) =>
  n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${+n.toFixed(1)}`;

interface Series {
  label: string;
  v: (d: number) => number;
  step?: boolean;
  main?: boolean;
}

const W = 400;
const H = 230;
const ML = 40;
const MR = 68;
const MT = 10;
const MB = 26;
const TICKS = [1, 20, 40, 60, 80, 100];

const niceMax = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

function Chart(p: {
  title: string;
  take: string;
  series: Series[];
  yFmt: (n: number) => string;
  read: (d: number) => string;
  mark?: number;
  sel: number | undefined;
  setSel: (d: number | undefined) => void;
}) {
  const ymax = niceMax(Math.max(...p.series.map((s) => s.v(100))));
  const x = (d: number) => ML + ((d - 1) / 99) * (W - ML - MR);
  const y = (v: number) => MT + (1 - v / ymax) * (H - MT - MB);
  const path = (s: Series) =>
    DEG.map((d, i) =>
      i === 0
        ? `M${x(d).toFixed(1)},${y(s.v(d)).toFixed(1)}`
        : `${s.step ? `L${x(d).toFixed(1)},${y(s.v(d - 1)).toFixed(1)}` : ""}L${x(d).toFixed(1)},${y(s.v(d)).toFixed(1)}`,
    ).join("");
  // end labels sit on the line ends, nudged apart when the lines finish close together
  const labels = p.series
    .map((s, i) => ({ i, y: y(s.v(100)) + 4 }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < labels.length; k++)
    labels[k]!.y = Math.max(labels[k]!.y, labels[k - 1]!.y + 13);
  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * W;
    p.setSel(
      Math.min(
        100,
        Math.max(1, Math.round(1 + ((u - ML) / (W - ML - MR)) * 99)),
      ),
    );
  };
  const cur = p.sel ?? p.mark;
  return (
    <section class="pg-panel ps-panel">
      <div class="pg-ph">
        <h2 class="eyebrow">{p.title}</h2>
      </div>
      <p class="ps-take">{p.take}</p>
      <svg
        class="ps-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${p.title}. ${p.take}`}
        onPointerMove={at}
        onPointerDown={at}
        onPointerLeave={(e) => e.pointerType === "mouse" && p.setSel(undefined)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              class="ps-grid"
              x1={ML}
              x2={W - MR}
              y1={y(ymax * f)}
              y2={y(ymax * f)}
            />
            <text class="ps-t" x={ML - 6} y={y(ymax * f) + 4} text-anchor="end">
              {p.yFmt(ymax * f)}
            </text>
          </g>
        ))}
        {TICKS.map((d) => (
          <text key={d} class="ps-t" x={x(d)} y={H - 8} text-anchor="middle">
            {d}
          </text>
        ))}
        {p.mark !== undefined && (
          <line
            class="ps-mark"
            x1={x(p.mark)}
            x2={x(p.mark)}
            y1={MT}
            y2={H - MB}
          />
        )}
        {p.sel !== undefined && (
          <line
            class="ps-cross"
            x1={x(p.sel)}
            x2={x(p.sel)}
            y1={MT}
            y2={H - MB}
          />
        )}
        {/* main series painted last, so it stays visible where lines overlap */}
        {[...p.series]
          .sort((a, b) => Number(!!a.main) - Number(!!b.main))
          .map((s) => (
            <path
              key={s.label}
              class={s.main ? "ps-line ps-main" : "ps-line"}
              d={path(s)}
            />
          ))}
        {cur !== undefined &&
          p.series.map((s) => (
            <circle
              key={s.label}
              class={s.main ? "ps-dot ps-main" : "ps-dot"}
              cx={x(cur)}
              cy={y(s.v(cur))}
              r={3}
            />
          ))}
        {labels.map((l) => (
          <text
            key={l.i}
            class={p.series[l.i]!.main ? "ps-lbl ps-main" : "ps-lbl"}
            x={W - MR + 6}
            y={l.y}
          >
            {p.series[l.i]!.label}
          </text>
        ))}
      </svg>
      <p class="pg-hint ps-read">
        {cur === undefined
          ? "Tap or hover the chart to read a degree."
          : p.read(cur)}
      </p>
    </section>
  );
}

export function ParagonScalingPage(p: { d?: number }) {
  const [sel, setSel] = useState<number | undefined>();
  const D = degreeData(VER);
  const c = { sel, setSel, mark: p.d };
  const step = pw(3) - pw(2);
  const cd = (d: number) => sc(d).cooldownPct;
  const boss = sc(100);
  const rows = [
    ...new Set([1, 20, 40, 60, 80, 100, ...(p.d ? [p.d] : [])]),
  ].sort((a, b) => a - b);
  const H2 = (long: string, short: string) => (
    <th scope="col">
      <span class="pg-long">{long}</span>
      <span class="pg-short">{short}</span>
    </th>
  );
  return (
    <div class="pg">
      <A href={href.tools()} class="backlink rv-back">
        <span aria-hidden="true">‹</span> Tools
      </A>
      <header class="rv-bar">
        <div class="rv-bar-t">
          <p class="eyebrow">Tools</p>
          <h1 class="rv-h1">Paragon scaling</h1>
        </div>
      </header>
      <p class="pg-hint ps-intro">
        What each degree from 1 to 100 adds to a paragon, from the game data (v
        {gameVersion(VER)}). Hover or tap a chart to read a degree
        {p.d ? `; degree ${p.d} is marked` : ""}.
      </p>
      <div class="ps-charts">
        <Chart
          {...c}
          title="Power needed"
          take={`Degree 100 needs ${fmtInt(pw(100))} power; each degree costs more than the last, from ${fmtInt(step)} at degree 3 to ${fmtInt(pw(100) - pw(99))} at degree 100.`}
          series={[{ label: "Power", v: pw, main: true }]}
          yFmt={compact}
          read={(d) =>
            `Degree ${d}: ${fmtInt(pw(d))} power${d > 1 ? ` (${fmtInt(pw(d) - pw(d - 1))} more than degree ${d - 1})` : ""}`
          }
        />
        <Chart
          {...c}
          title="Damage and pierce bonus"
          take={`At degree 100 damage is +${one(sc(100).damagePct)}% and pierce +${one(sc(100).piercePct)}%, a steady +${one(sc(2).damagePct)}% and +${one(sc(2).piercePct)}% per degree.`}
          series={[
            { label: "Damage", v: (d) => sc(d).damagePct, main: true },
            { label: "Pierce", v: (d) => sc(d).piercePct },
          ]}
          yFmt={(n) => `${+n.toFixed(0)}%`}
          read={(d) =>
            `Degree ${d}: damage +${one(sc(d).damagePct)}%, pierce +${one(sc(d).piercePct)}%`
          }
        />
        <Chart
          {...c}
          title="Flat damage and pierce"
          take={`Flat damage grows +${D.damageIncreasePerDegree} every ${D.damageIncreaseForDegrees} degrees (+${sc(100).damageFlat} at 100); flat pierce +${one(sc(2).pierceFlat)} every degree (+${one(sc(100).pierceFlat)} at 100).`}
          series={[
            {
              label: "Damage",
              v: (d) => sc(d).damageFlat,
              step: true,
              main: true,
            },
            { label: "Pierce", v: (d) => sc(d).pierceFlat },
          ]}
          yFmt={(n) => `${+n.toFixed(1)}`}
          read={(d) =>
            `Degree ${d}: damage +${sc(d).damageFlat}, pierce +${one(sc(d).pierceFlat)}`
          }
        />
        <Chart
          {...c}
          title="Cooldown reduction"
          take={`Attacks get ${one(cd(100))}% faster at degree 100, but it levels off: degrees 1 to 21 give ${one(cd(21))}%, degrees 80 to 100 only ${one(cd(100) - cd(80))}% more.`}
          series={[{ label: "Cooldown", v: cd, main: true }]}
          yFmt={(n) => `${+n.toFixed(0)}%`}
          read={(d) => `Degree ${d}: attack cooldown −${one(cd(d))}%`}
        />
        <Chart
          {...c}
          title="Boss damage"
          take={`Boss damage steps up ${times(sc(D.bonusBossDamagePerDegrees).bossNormal - 1)} every ${D.bonusBossDamagePerDegrees} degrees, to ${times(boss.bossNormal)} on normal bosses and ${times(boss.bossElite)} on elite bosses at degree 100.`}
          series={[
            {
              label: "Elite",
              v: (d) => sc(d).bossElite,
              step: true,
              main: true,
            },
            { label: "Normal", v: (d) => sc(d).bossNormal, step: true },
          ]}
          yFmt={(n) => times(n)}
          read={(d) =>
            `Degree ${d}: normal bosses ${times(sc(d).bossNormal)}, elite bosses ${times(sc(d).bossElite)}`
          }
        />
      </div>
      <section class="pg-panel ps-panel">
        <div class="pg-ph">
          <h2 class="eyebrow">Milestones</h2>
        </div>
        <table class="pg-table">
          <thead>
            <tr>
              {H2("Degree", "Deg")}
              {H2("Power", "Pwr")}
              {H2("Damage", "Dmg")}
              {H2("Pierce", "Prc")}
              {H2("Cooldown", "CD")}
              {H2("Boss N", "Boss N")}
              {H2("Boss E", "Boss E")}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const x = sc(d);
              return (
                <tr
                  key={d}
                  class={d === p.d ? "on" : undefined}
                  aria-current={d === p.d ? "true" : undefined}
                >
                  <th scope="row">{d}</th>
                  <td>
                    <span class="pg-long">{fmtInt(pw(d))}</span>
                    <span class="pg-short">
                      {pw(d) < 1000 ? pw(d) : `${+(pw(d) / 1000).toFixed(1)}k`}
                    </span>
                  </td>
                  <td>
                    +{one(x.damagePct)}%<br />+{x.damageFlat}
                  </td>
                  <td>
                    +{one(x.piercePct)}%<br />+{one(x.pierceFlat)}
                  </td>
                  <td>−{one(x.cooldownPct)}%</td>
                  <td>{times(x.bossNormal)}</td>
                  <td>{times(x.bossElite)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="pg-hint">
          Boss N / E: bonus damage to normal / elite bosses. Unofficial.
        </p>
      </section>
    </div>
  );
}
