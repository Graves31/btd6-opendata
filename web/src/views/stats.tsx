// Hidden /stats page: visitor numbers from Cloudflare Web Analytics, via the Worker's /api/stats. Not linked
// from anywhere; carries a noindex robots meta while it is open.
// Filters are client-side over the per-day rows: a day (tap its bar), the last 7 or 30 days, and one row of a
// ranked list (tap it) for the chart.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

interface Row {
  name: string;
  views: number;
  visits: number;
}
type DayRow = Row & { date: string };
interface Stats {
  generatedAt: string;
  totals: { d7: { views: number; visits: number }; d30: { views: number; visits: number } };
  daily: { date: string; views: number; visits: number }[];
  pages: DayRow[];
  referrers: DayRow[];
  countries: DayRow[];
  devices: DayRow[];
}
type State = { kind: "loading" } | { kind: "off" } | { kind: "error"; msg: string } | { kind: "ok"; s: Stats };
type Dim = "pages" | "referrers" | "countries" | "devices";
type Metric = "visits" | "views";

const nf = new Intl.NumberFormat();
const dayFmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const regions = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(undefined, { type: "region" }) : null;
const country = (c: string) => {
  if (!/^[A-Z]{2}$/.test(c)) return c || "Unknown";
  try {
    return regions?.of(c) ?? c;
  } catch {
    return c;
  }
};
const LABEL: Record<Dim, (n: string) => string> = {
  pages: (n) => n,
  referrers: (n) => n || "Direct",
  countries: country,
  devices: (n) => n || "Unknown",
};
const METRIC: Record<Metric, string> = { visits: "Visits", views: "Page views" };

/** Page-level robots meta, removed again on leaving (the SPA shell is shared with the public pages). */
function useNoindex() {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.append(m);
    return () => m.remove();
  }, []);
}

async function load(): Promise<State> {
  try {
    const r = await fetch("/api/stats");
    const j = (await r.json().catch(() => ({}))) as { error?: string; body?: Stats };
    if (r.status === 503 && j.error === "not-configured") return { kind: "off" };
    if (!r.ok || !j.body) return { kind: "error", msg: j.error ?? `HTTP ${r.status}` };
    return { kind: "ok", s: j.body };
  } catch {
    return { kind: "error", msg: "Couldn't reach the server." };
  }
}

/** Top 10 names over the days from..to (inclusive). */
function top(rows: DayRow[], from: string, to: string): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const a = m.get(r.name) ?? { name: r.name, views: 0, visits: 0 };
    a.views += r.views;
    a.visits += r.visits;
    m.set(r.name, a);
  }
  return [...m.values()].sort((a, b) => b.views - a.views).slice(0, 10);
}

function Chart(p: { days: { date: string; v: number }[]; label: string; from: string; to: string; onDay: (d: string) => void }) {
  // Drawn at its on-screen width (1 unit = 1 px), so the axis text is the same size on a phone and a wide screen.
  const ref = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(720);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(Math.max(200, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 200;
  const pad = { l: 34, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...p.days.map((d) => d.v));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const bw = (W - pad.l - pad.r) / p.days.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const ticks = [0, top / 2, top];
  const last = p.days.length - 1;
  const all = p.from === p.days[0].date && p.to === p.days[last].date;
  return (
    <svg ref={ref} class="st-chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${p.label} per day, last 30 days. Busiest day: ${nf.format(max)}. Pick a day to see its lists.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line class="st-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text class="st-axis" x={pad.l - 6} y={y(t) + 4} text-anchor="end">
            {nf.format(t)}
          </text>
        </g>
      ))}
      {p.days.map((d, i) => {
        const on = d.date >= p.from && d.date <= p.to;
        const pick = () => p.onDay(d.date);
        return (
          <g
            key={d.date}
            class={`st-day${on && !all ? " on" : ""}${on ? "" : " off"}`}
            role="button"
            tabIndex={0}
            aria-pressed={on && !all}
            aria-label={`${dayFmt(d.date)}: ${nf.format(d.v)}`}
            onClick={pick}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick())}
          >
            <title>{`${dayFmt(d.date)}: ${nf.format(d.v)} ${p.label.toLowerCase()}`}</title>
            <rect class="st-hit" x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} />
            <rect class="st-bar" x={pad.l + i * bw + 1} y={y(d.v)} width={Math.max(1, bw - 2)} height={Math.max(d.v > 0 ? 1.5 : 0, H - pad.b - y(d.v))} />
          </g>
        );
      })}
      {[0, 14, last].map((i) => (
        <text
          key={i}
          class="st-axis"
          x={pad.l + i * bw + (i === 0 ? 0 : i === last ? bw : bw / 2)}
          y={H - 6}
          text-anchor={i === 0 ? "start" : i === last ? "end" : "middle"}
        >
          {dayFmt(p.days[i].date)}
        </text>
      ))}
    </svg>
  );
}

function Rank(p: { title: string; rows: Row[]; label: (n: string) => string; picked?: string; onPick: (n: string) => void }) {
  const max = Math.max(1, ...p.rows.map((r) => r.views));
  return (
    <section class="st-card">
      <h2 class="st-h">{p.title}</h2>
      {p.rows.length === 0 ? (
        <p class="quiet">Nothing on these days.</p>
      ) : (
        <ol class="st-rank">
          {p.rows.map((r) => (
            <li key={r.name} style={`--w:${Math.max(2, Math.round((r.views / max) * 100))}%`}>
              <button type="button" class={p.picked === r.name ? "on" : undefined} aria-pressed={p.picked === r.name} onClick={() => p.onPick(r.name)}>
                <span class="st-name">{p.label(r.name)}</span>
                <span class="st-n">{nf.format(r.views)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const Tile = (p: { label: string; value: number; sub: string }) => (
  <div class="st-tile">
    <div class="st-v">{nf.format(p.value)}</div>
    <div class="st-l">{p.label}</div>
    <div class="st-s">{p.sub}</div>
  </div>
);

const Chip = (p: { on: boolean; onClick: () => void; children: string }) => (
  <button type="button" class="hist-chip" aria-pressed={p.on} onClick={p.onClick}>
    {p.children}
  </button>
);

function Board(p: { s: Stats }) {
  const s = p.s;
  const [day, setDay] = useState<string | null>(null);
  const [span, setSpan] = useState<7 | 30>(30);
  const [metric, setMetric] = useState<Metric>("visits");
  const [pick, setPick] = useState<{ dim: Dim; name: string } | null>(null);

  const to = day ?? s.daily[s.daily.length - 1].date;
  const from = day ?? s.daily[s.daily.length - span].date;
  const inRange = s.daily.filter((d) => d.date >= from && d.date <= to);
  const sum = (k: Metric) => inRange.reduce((a, d) => a + d[k], 0);
  const days = s.daily.map((d) => ({
    date: d.date,
    v: pick ? s[pick.dim].reduce((a, r) => (r.date === d.date && r.name === pick.name ? a + r[metric] : a), 0) : d[metric],
  }));
  const rank = (dim: Dim, title: string) => (
    <Rank
      title={title}
      rows={top(s[dim], from, to)}
      label={LABEL[dim]}
      picked={pick?.dim === dim ? pick.name : undefined}
      onPick={(name) => setPick(pick?.dim === dim && pick.name === name ? null : { dim, name })}
    />
  );

  return (
    <>
      <div class="st-tiles">
        <Tile label="Visits · 7 days" value={s.totals.d7.visits} sub="sessions" />
        <Tile label="Page views · 7 days" value={s.totals.d7.views} sub="pages opened" />
        <Tile label="Visits · 30 days" value={s.totals.d30.visits} sub="sessions" />
        <Tile label="Page views · 30 days" value={s.totals.d30.views} sub="pages opened" />
      </div>
      <section class="st-card">
        <div class="st-head">
          <h2 class="st-h">
            {METRIC[metric]} per day
            {pick && <span class="st-for"> · {LABEL[pick.dim](pick.name)}</span>}
          </h2>
          <div class="st-chips" role="group" aria-label="Chart shows">
            <Chip on={metric === "visits"} onClick={() => setMetric("visits")}>
              Visits
            </Chip>
            <Chip on={metric === "views"} onClick={() => setMetric("views")}>
              Page views
            </Chip>
            {pick && (
              <Chip on onClick={() => setPick(null)}>
                {`${LABEL[pick.dim](pick.name)} ×`}
              </Chip>
            )}
          </div>
        </div>
        <Chart days={days} label={METRIC[metric]} from={from} to={to} onDay={(d) => setDay(day === d ? null : d)} />
      </section>
      <div class="st-bar-row">
        <div class="st-chips" role="group" aria-label="Lists cover">
          <Chip on={!day && span === 30} onClick={() => (setDay(null), setSpan(30))}>
            30 days
          </Chip>
          <Chip on={!day && span === 7} onClick={() => (setDay(null), setSpan(7))}>
            7 days
          </Chip>
          {day && (
            <Chip on onClick={() => setDay(null)}>
              {`${dayFmt(day)} ×`}
            </Chip>
          )}
        </div>
        <p class="st-sum">
          {day ? dayFmt(day) : `Last ${span} days`}: <b>{nf.format(sum("visits"))}</b> visits · <b>{nf.format(sum("views"))}</b> page views
        </p>
      </div>
      <div class="st-grid2">
        {rank("pages", "Top pages")}
        {rank("referrers", "Referrers")}
        {rank("countries", "Countries")}
        {rank("devices", "Devices")}
      </div>
      <p class="quiet st-foot">
        Page views per row. Tap a bar for that day, a row to chart it. Cloudflare Web Analytics, sampled; updated every 15 minutes.
      </p>
    </>
  );
}

export function StatsPage() {
  useNoindex();
  const [st, setSt] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void load().then((s) => live && setSt(s));
    return () => {
      live = false;
    };
  }, []);

  let content;
  if (st.kind === "loading")
    content = (
      <p class="quiet" role="status">
        Loading stats…
      </p>
    );
  else if (st.kind === "off")
    content = (
      <div class="empty">
        <span class="empty-t">Stats aren't set up yet</span>
        <span>The analytics token hasn't been added to the Worker.</span>
      </div>
    );
  else if (st.kind === "error")
    content = (
      <div class="empty" role="alert">
        <span class="empty-t">Couldn't load stats</span>
        <span>{st.msg}</span>
      </div>
    );
  else if (st.s.totals.d30.views === 0 && st.s.daily.every((d) => d.views === 0))
    content = (
      <div class="empty">
        <span class="empty-t">No visits recorded yet</span>
        <span>Data appears a few minutes after visits.</span>
      </div>
    );
  else content = <Board s={st.s} />;
  return (
    <>
      <header class="page-h">
        <h1>Site stats</h1>
      </header>
      {content}
    </>
  );
}
