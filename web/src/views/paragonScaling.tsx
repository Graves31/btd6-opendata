// Tools → Paragon scaling (/tools/paragon-scaling?d=40&to=75): what each degree adds to a paragon, charted from the
// game data (paragon.ts scaling() / powerForDegree()). Static page, no NK data. The degree (route `d`) is shared by
// the control, the summary and every chart; `to` is an optional second degree to compare against.

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import heroArt from "../art/tools/paragonScaling.webp";
import { fmtInt } from "../format.ts";
import { navigate } from "../nav.ts";
import { cooldownCut, degreeData, MAX_DEGREE, gameVersion, paragonName, paragonTowers, powerForDegree, scaling } from "../paragon.ts";
import { href } from "../routes.ts";
import { Spr } from "../sprite.tsx";
import { A, ToolBack, ToolHero } from "../ui.tsx";
import { paragonIcon, TargetInput } from "./paragon.tsx";

const VER = "57" as const;
const DEG = Array.from({ length: MAX_DEGREE }, (_, i) => i + 1);
const one = (n: number) => +n.toFixed(1);
const times = (x: number) => `×${+x.toFixed(2)}`;
const sc = (d: number) => scaling(d, VER);
const pw = (d: number) => powerForDegree(d, false, VER);
const clampD = (n: number) => Math.min(MAX_DEGREE, Math.max(1, n));
const compact = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${+n.toFixed(1)}`);
/** "+12.5%" / "0%" (never "−0%") */
const pct = (n: number) => (one(n) === 0 ? "0%" : `+${one(n)}%`);
/** signed delta: "+3.5%", "−3", "0" */
const sgnF = (n: number, unit = "") => {
  const r = one(n);
  return r === 0 ? `0${unit}` : `${r > 0 ? "+" : "−"}${Math.abs(r)}${unit}`;
};
/** "+42.4%" attack speed; cooldowns are divided by 1 + that */
const spdTxt = (c: number) => (c === 0 ? "0%" : `+${one(c)}%`);
const cutTxt = (c: number) => `${one(cooldownCut(c)) === 0 ? "0" : `−${one(-cooldownCut(c))}`}%`;
/** "*bold* text" → bold spans */
const rich = (s: string) => s.split("*").map((t, i) => (i % 2 ? <b key={i}>{t}</b> : t));

interface Series {
  label: string;
  v: (d: number) => number;
  step?: boolean;
  main?: boolean;
}

const W = 400;
const ML = 46;
const MR = 72;
const MT = 12;
const MB = 28;
const TICKS = [1, 25, 50, 75, MAX_DEGREE];

const niceMax = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
};

function Chart(p: {
  title: string;
  icon?: ComponentChildren;
  take: string;
  series: Series[];
  yFmt: (n: number) => string;
  /** the value tag at the picked degree (default: yFmt) */
  vFmt?: (n: number) => string;
  ymin?: number;
  d: number;
  to?: number;
  setD: (d: number) => void;
}) {
  const [hov, setHov] = useState<number | undefined>();
  // everything but the degree markers is the same on every render (static game data): built once per chart, so
  // dragging the degree only moves a few marks instead of rebuilding 100-point paths
  const { H, ymin, ymax, x, y, paths, labels } = useMemo(() => {
    const H = p.series.length > 1 ? 230 : 200;
    const ymin = p.ymin ?? 0;
    const ymax = niceMax(Math.max(...p.series.map((s) => s.v(MAX_DEGREE))));
    const x = (d: number) => ML + ((d - 1) / 99) * (W - ML - MR);
    const y = (v: number) => MT + (1 - (v - ymin) / (ymax - ymin)) * (H - MT - MB);
    const f = (n: number) => n.toFixed(1);
    // steps jump halfway between two degrees, so the line ends on a horizontal tread at degree 100
    const path = (s: Series) => {
      let d = `M${f(x(1))},${f(y(s.v(1)))}`;
      for (let i = 2; i <= MAX_DEGREE; i++) {
        if (s.step) {
          if (s.v(i) !== s.v(i - 1)) d += `L${f(x(i - 0.5))},${f(y(s.v(i - 1)))}L${f(x(i - 0.5))},${f(y(s.v(i)))}`;
        } else d += `L${f(x(i))},${f(y(s.v(i)))}`;
      }
      return d + (s.step ? `L${f(x(MAX_DEGREE))},${f(y(s.v(MAX_DEGREE)))}` : "");
    };
    // end labels (split on spaces into lines) centred on the last value, nudged apart when the lines finish close together
    const labels = p.series.map((s, i) => ({ i, y: y(s.v(MAX_DEGREE)) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) labels[k]!.y = Math.max(labels[k]!.y, labels[k - 1]!.y + 36);
    return { H, ymin, ymax, x, y, paths: p.series.map(path), labels };
  }, []);
  const lines = (s: Series) => s.label.split(" ");
  // the value at the picked degree, read off on the left axis: a tag per line, nudged apart when two values are close
  const tags = p.series.map((s, i) => ({ i, v: s.v(p.d), y: y(s.v(p.d)), ty: y(s.v(p.d)) })).sort((a, b) => a.ty - b.ty);
  for (let k = 1; k < tags.length; k++) tags[k]!.ty = Math.max(tags[k]!.ty, tags[k - 1]!.ty + 20);
  const near = (yy: number) => tags.some((t) => Math.abs(t.ty - yy) < 16);
  const at = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * W;
    return clampD(Math.round(1 + ((u - ML) / (W - ML - MR)) * 99));
  };
  const vline = (cls: string, dg: number) => <line class={cls} x1={x(dg)} x2={x(dg)} y1={MT} y2={H - MB} />;
  const plain = p.take.replace(/\*/g, "");
  return (
    <section class={`pg-panel ps-panel`}>
      <div class="pg-ph">
        <h2 class="eyebrow ps-h">
          {p.icon}
          {p.title}
        </h2>
      </div>
      <p class="ps-take">{rich(p.take)}</p>
      <svg
        class="ps-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${p.title}. ${plain}`}
        onPointerDown={(e) => p.setD(at(e))}
        onPointerMove={(e) => {
          const g = at(e);
          if (e.buttons) p.setD(g);
          else setHov(g);
        }}
        onPointerLeave={() => setHov(undefined)}
      >
        {[0, 0.5, 1].map((fr) => (
          <g key={fr}>
            <line class={fr === 0 ? "ps-base" : "ps-grid"} x1={ML} x2={W - MR} y1={y(ymin + (ymax - ymin) * fr)} y2={y(ymin + (ymax - ymin) * fr)} />
            {!near(y(ymin + (ymax - ymin) * fr)) && (
              <text class="ps-t" x={ML - 6} y={y(ymin + (ymax - ymin) * fr) + 5} text-anchor="end">
                {p.yFmt(ymin + (ymax - ymin) * fr)}
              </text>
            )}
          </g>
        ))}
        {TICKS.map((t) => (
          <text key={t} class="ps-t" x={x(t)} y={H - 8} text-anchor="middle">
            {t}
          </text>
        ))}
        {hov !== undefined && hov !== p.d && vline("ps-hover", hov)}
        {p.to !== undefined && p.to !== p.d && vline("ps-mark", p.to)}
        {vline("ps-cross", p.d)}
        {tags.map((t) => (
          <line key={t.i} class={p.series[t.i]!.main ? "ps-hl ps-main" : "ps-hl"} x1={ML} x2={x(p.d)} y1={t.y} y2={t.y} />
        ))}
        {/* main series painted last, so it stays visible where lines overlap */}
        {p.series
          .map((s, i) => ({ s, i }))
          .sort((a, b) => Number(!!a.s.main) - Number(!!b.s.main))
          .map(({ s, i }) => (
            <path key={s.label} class={`ps-line${s.main ? " ps-main" : " ps-sec"}${s.step ? " ps-step" : ""}`} d={paths[i]} />
          ))}
        {p.series
          .filter((s) => !s.main)
          .map((s) => (
            <rect key={s.label} class="ps-end" x={x(MAX_DEGREE) - 3.5} y={y(s.v(MAX_DEGREE)) - 3.5} width={7} height={7} transform={`rotate(45 ${x(MAX_DEGREE)} ${y(s.v(MAX_DEGREE))})`} />
          ))}
        {p.series.map((s) => (
          <circle key={s.label} class={s.main ? "ps-dot ps-main" : "ps-dot"} cx={x(p.d)} cy={y(s.v(p.d))} r={4} />
        ))}
        {tags.map((t) => {
          const main = !!p.series[t.i]!.main;
          return (
            <g key={t.i} class={main ? "ps-tag ps-main" : "ps-tag"}>
              <rect x={0} y={t.ty - 10} width={ML - 3} height={20} rx={4} />
              <text x={ML - 7} y={t.ty + 4.5} text-anchor="end">
                {(p.vFmt ?? p.yFmt)(t.v)}
              </text>
            </g>
          );
        })}
        {labels.map((l) => {
          const s = p.series[l.i]!;
          const ls = lines(s);
          // keep the whole block inside the chart (a label at the top value would lose its first line)
          const top = Math.min(Math.max(0, l.y - (ls.length * 16) / 2), H - ls.length * 16);
          return (
            <text key={l.i} class={s.main ? "ps-lbl ps-main" : "ps-lbl"} x={W - MR + 12}>
              {ls.map((t, k) => (
                <tspan key={k} x={W - MR + 12} y={top + 13 + k * 16}>
                  {t}
                </tspan>
              ))}
            </text>
          );
        })}
      </svg>
    </section>
  );
}

/** A game icon next to visible text (decorative). */
const Ic = (p: { f: "ui" | "boss" | "paragon"; k: string; size?: number }) => <Spr family={p.f} k={p.k} size={p.size ?? 24} label />;
// a fresh element per use (Preact must not mount one vnode twice)
const ICON = {
  damage: () => <Ic f="ui" k="Pops" />,
  pierce: () => <Ic f="paragon" k="DartMonkey" />,
  flat: () => <Ic f="ui" k="Tier5" />,
  cooldown: () => <Ic f="ui" k="AbilityCooldownDecrease" />,
  boss: () => <Ic f="boss" k="Bloonarius" />,
  elite: () => <Ic f="boss" k="elite:bloonarius" />,
  power: () => <Ic f="ui" k="ParagonPower" />,
};

type Stats = ReturnType<typeof sc>;
const flat = (n: number) => (one(n) === 0 ? "0" : `+${one(n)}`);
/** signed change to 2 decimals, for multipliers: "+0.25", "−1" */
const sgn2 = (n: number) => {
  const r = +n.toFixed(2);
  return r === 0 ? "0" : `${r > 0 ? "+" : "−"}${Math.abs(r)}`;
};
/** The summary fields: the picked degree, and the compared degree in the same places. */
const FIELDS: { k: string; icon: () => ComponentChildren; v: (s: Stats) => string; sub?: (s: Stats) => string; dv: (a: Stats, b: Stats) => string }[] = [
  { k: "Damage", icon: ICON.damage, v: (s) => pct(s.damagePct), sub: (s) => `${flat(s.damageFlat)} flat`, dv: (a, b) => `${sgnF(b.damagePct - a.damagePct, "%")}, ${sgnF(b.damageFlat - a.damageFlat)} flat` },
  { k: "Pierce", icon: ICON.pierce, v: (s) => pct(s.piercePct), sub: (s) => `${flat(s.pierceFlat)} flat`, dv: (a, b) => `${sgnF(b.piercePct - a.piercePct, "%")}, ${sgnF(b.pierceFlat - a.pierceFlat)} flat` },
  { k: "Attack speed", icon: ICON.cooldown, v: (s) => spdTxt(s.speedPct), sub: (s) => `cooldowns ${cutTxt(s.speedPct)}`, dv: (a, b) => sgnF(b.speedPct - a.speedPct, " points") },
  { k: "Boss damage", icon: ICON.boss, v: (s) => times(s.bossNormal), dv: (a, b) => sgn2(b.bossNormal - a.bossNormal) },
  { k: "Elite damage", icon: ICON.elite, v: (s) => times(s.bossElite), dv: (a, b) => sgn2(b.bossElite - a.bossElite) },
];

export function ParagonScalingPage(p: { d?: number; to?: number }) {
  // The degree lives here while it changes and reaches the URL once the slider rests: a route change per slider step
  // (history write + whole-app render) is what made dragging lag on phones, and Safari caps history writes too.
  const [d, setLocal] = useState(p.d ?? 1);
  useEffect(() => setLocal(p.d ?? 1), [p.d]);
  const urlT = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(urlT.current), []);
  const D = degreeData(VER);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const go = (nd: number, nto: number | undefined) => {
    clearTimeout(urlT.current);
    navigate(href.paragonScaling(nd === 1 ? undefined : nd, nto), { replace: true, keepScroll: true });
  };
  const setD = (n: number) => {
    n = clampD(n);
    if (n === d) return;
    setLocal(n);
    clearTimeout(urlT.current);
    urlT.current = setTimeout(() => go(n, p.to), 300);
  };
  const setTo = (n: number | undefined) => {
    n = n === undefined ? undefined : clampD(n);
    if (n !== p.to) go(d, n);
  };
  const copy = () => {
    const url = location.origin + href.paragonScaling(d === 1 ? undefined : d, p.to);
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).then(done, done);
    else done();
  };

  const c = { d, to: p.to, setD };
  const cd = (n: number) => sc(n).speedPct;
  const x = sc(d);
  const cmp = p.to !== undefined && p.to !== d ? p.to : undefined;
  const y = cmp === undefined ? undefined : sc(cmp);
  // damage % and pierce % are the same line in the data; if that ever changes the chart and table show both
  const same = useMemo(() => DEG.every((n) => sc(n).damagePct === sc(n).piercePct), []);
  const step = pw(3) - pw(2);
  const bossStep = sc(D.bonusBossDamagePerDegrees).bossNormal - 1;

  const rows = DEG.filter(
    (n) => n === 1 || n === MAX_DEGREE || n === d || n === p.to || sc(n).bossNormal !== sc(n - 1).bossNormal || sc(n).damageFlat !== sc(n - 1).damageFlat,
  );
  // one degree's stats, or (with `base`) another degree's in the same places plus the change from `base`
  const fields = (s: Stats, base?: Stats) => (
    <dl class="ps-sum">
      {FIELDS.map((f) => (
        <div key={f.k}>
          <dt>
            {f.icon()}
            {f.k}
          </dt>
          <dd>
            {f.v(s)}
            {f.sub && <small>{f.sub(s)}</small>}
            {base && (
              <small class="ps-delta">
                {f.dv(base, s)} vs {d}
              </small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
  const thR = (t: string) => <th scope="col">{t}</th>;

  return (
    <div class="pg ps">
      <ToolBack />
      <ToolHero art={<img src={heroArt} width={96} height={96} alt="" />} title="Paragon scaling" sub="What every degree adds to a paragon, from degree 1 to 100.">
        <nav class="ps-pgs" aria-label={`Open a paragon in the calculator at degree ${d}`}>
          {paragonTowers(VER).map((t) => (
            <A key={t} href={href.paragon({ tower: t, target: d >= 2 ? d : undefined }, true)} class="th-ic" title={`${paragonName(t, VER)}, degree ${d}`}>
              {paragonIcon(t, 44)}
              <span class="vh">{paragonName(t, VER)}</span>
            </A>
          ))}
        </nav>
      </ToolHero>
      <section class="ps-ctl" aria-label="Degree">
        <span class="ps-ctl-l">
          <Ic f="ui" k="ParagonDegree" size={28} />
          Degree
        </span>
        <div class="pg-tstep" role="group" aria-label="Degree">
          <button type="button" class="pg-step" aria-label="Previous degree" disabled={d <= 1} onClick={() => setD(d - 1)}>
            −
          </button>
          <TargetInput value={d} onChange={setD} label="Degree" />
          <button type="button" class="pg-step" aria-label="Next degree" disabled={d >= MAX_DEGREE} onClick={() => setD(d + 1)}>
            +
          </button>
        </div>
        <div class="pg-num">
          <input type="range" class="pg-range" min={1} max={MAX_DEGREE} step={1} value={d} aria-label="Degree, 1 to 100" onInput={(e) => setD(+e.currentTarget.value)} />
        </div>
      </section>
      <section class="pg-panel ps-panel" aria-labelledby="ps-sum">
        <div class="pg-ph">
          <h2 class="eyebrow" id="ps-sum">
            Degree {d}
          </h2>
          <button type="button" class="pg-copy" onClick={copy}>
            {copied ? "Link copied" : "Copy link"}
          </button>
        </div>
        {fields(x)}
        <p class="ps-links">
          <A href={href.paragon(d >= 2 ? { target: d } : {})} class="pg-link">
            Open in calculator ›
          </A>
          <span class="pg-hint">From the game data, v{gameVersion(VER)}. Unofficial.</span>
        </p>
        {p.to === undefined ? (
          <button type="button" class="pg-copy ps-add" onClick={() => setTo(d < MAX_DEGREE ? Math.min(MAX_DEGREE, d + 10) : 90)}>
            Compare with…
          </button>
        ) : (
          <div class="ps-cmp">
            <div class="ps-cmp-h">
              <span class="ps-ctl-l">Compare with</span>
              <div class="pg-tstep" role="group" aria-label="Compare with degree">
                <button type="button" class="pg-step" aria-label="Lower compare degree" disabled={p.to <= 1} onClick={() => setTo(p.to! - 1)}>
                  −
                </button>
                <TargetInput value={p.to} onChange={setTo} label="Compare with degree" />
                <button type="button" class="pg-step" aria-label="Higher compare degree" disabled={p.to >= MAX_DEGREE} onClick={() => setTo(p.to! + 1)}>
                  +
                </button>
              </div>
              <button type="button" class="pg-step ps-x" aria-label="Remove comparison" onClick={() => setTo(undefined)}>
                ×
              </button>
            </div>
            {cmp !== undefined && y ? (
              fields(y, x)
            ) : (
              <p class="pg-hint">Pick a different degree to see what changes.</p>
            )}
          </div>
        )}
      </section>
      <div class="ps-charts">
        <Chart
          {...c}
          title="Damage & pierce bonus"
          icon={ICON.damage()}
          take={
            same
              ? `At degree 100 damage and pierce are both *${pct(sc(MAX_DEGREE).damagePct)}*: +${one(sc(2).damagePct)}% per degree, and degree 100 adds one extra step. The pierce % is rounded down to whole pierce, so real pierce climbs in whole steps (base pierce 10: +1 every 10 degrees).`
              : `At degree 100 damage is *${pct(sc(MAX_DEGREE).damagePct)}* and pierce *${pct(sc(MAX_DEGREE).piercePct)}*, +${one(sc(2).damagePct)}% and +${one(sc(2).piercePct)}% per degree, and degree 100 adds one extra step.`
          }
          series={same ? [{ label: "Damage & pierce", v: (n) => sc(n).damagePct, main: true }] : [{ label: "Damage", v: (n) => sc(n).damagePct, main: true }, { label: "Pierce", v: (n) => sc(n).piercePct }]}
          yFmt={(n) => `${+n.toFixed(0)}%`}
          vFmt={(n) => `${one(n)}%`}
        />
        <Chart
          {...c}
          title="Flat bonuses"
          icon={ICON.flat()}
          take={`Flat damage grows +${D.damageIncreasePerDegree} every ${D.damageIncreaseForDegrees} degrees, at 11, 21 … 91, and once more at 100 (*+${sc(MAX_DEGREE).damageFlat}*); flat pierce +${one(sc(2).pierceFlat)} every degree (*+${one(sc(MAX_DEGREE).pierceFlat)}* at 100).`}
          series={[
            { label: "Flat damage", v: (n) => sc(n).damageFlat, step: true, main: true },
            { label: "Flat pierce", v: (n) => sc(n).pierceFlat },
          ]}
          yFmt={(n) => `${+n.toFixed(1)}`}
        />
        <Chart
          {...c}
          title="Attack speed"
          icon={ICON.cooldown()}
          take={`Attacks and abilities are *+${one(cd(MAX_DEGREE))}% faster* at degree 100 (cooldowns ${cutTxt(cd(MAX_DEGREE))}), but it levels off: degrees 1 to 21 give +${one(cd(21))}%, degrees 80 to 100 only ${one(cd(MAX_DEGREE) - cd(80))} points more.`}
          series={[{ label: "Attack speed", v: cd, main: true }]}
          yFmt={(n) => `${+n.toFixed(0)}%`}
          vFmt={(n) => `${one(n)}%`}
        />
        <Chart
          {...c}
          title="Boss damage"
          icon={ICON.boss()}
          ymin={1}
          take={`Boss damage steps up ${times(bossStep)} every ${D.bonusBossDamagePerDegrees} degrees, to *${times(sc(MAX_DEGREE).bossNormal)}* on bosses and *${times(sc(MAX_DEGREE).bossElite)}* on elite bosses at degree 100.`}
          series={[
            { label: "Elite boss", v: (n) => sc(n).bossElite, step: true, main: true },
            { label: "Boss", v: (n) => sc(n).bossNormal, step: true },
          ]}
          yFmt={times}
        />
      </div>
      <details class="pg-fold pg-fold-big ps-fold">
        <summary>Power needed per degree</summary>
        <Chart
          {...c}
          title="Power needed"
          icon={ICON.power()}
          take={`Degree 100 needs *${fmtInt(pw(MAX_DEGREE))} total power*. The power for one degree keeps growing too: *${fmtInt(step)}* for degree 3, *${fmtInt(pw(MAX_DEGREE) - pw(99))}* for degree 100.`}
          series={[{ label: "Total power", v: pw, main: true }]}
          yFmt={compact}
        />
      </details>
      <section class="pg-panel ps-panel">
        <div class="pg-ph">
          <h2 class="eyebrow">Breakpoints</h2>
        </div>
        <div class="ps-tw">
          <table class="pg-table ps-table">
            <thead>
              <tr>
                {thR("Degree")}
                {thR("Total power")}
                {thR(`From degree ${d}`)}
                {thR(same ? "Damage & pierce" : "Damage")}
                {!same && thR("Pierce")}
                {thR("Flat dmg")}
                {thR("Flat pierce")}
                {thR("Attack speed")}
                {thR("Boss")}
                {thR("Elite boss")}
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const s = sc(n);
                return (
                  <tr key={n} class={n === d ? "on" : n === p.to ? "on to" : undefined} aria-current={n === d ? "true" : undefined}>
                    <th scope="row">{n}</th>
                    <td>{fmtInt(pw(n))}</td>
                    <td>{n > d ? `+${fmtInt(pw(n) - pw(d))}` : "—"}</td>
                    <td>{pct(s.damagePct)}</td>
                    {!same && <td>{pct(s.piercePct)}</td>}
                    <td>{s.damageFlat === 0 ? "0" : `+${s.damageFlat}`}</td>
                    <td>{s.pierceFlat === 0 ? "0" : `+${one(s.pierceFlat)}`}</td>
                    <td>{spdTxt(s.speedPct)}</td>
                    <td>{times(s.bossNormal)}</td>
                    <td>{times(s.bossElite)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="pg-hint">Degrees where boss damage or flat damage step up, plus degree 1, 100 and the ones you picked (highlighted). Boss: bonus damage to normal bosses.</p>
      </section>
    </div>
  );
}
