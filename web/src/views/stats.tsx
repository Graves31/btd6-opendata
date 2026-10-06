// Hidden /stats page: visitor numbers from Cloudflare Web Analytics, via the Worker's /api/stats. Not linked
// from anywhere; carries a noindex robots meta while it is open.
import { useEffect, useState } from "preact/hooks";

interface Row {
  name: string;
  views: number;
  visits: number;
}
interface Stats {
  generatedAt: string;
  totals: { d7: { views: number; visits: number }; d30: { views: number; visits: number } };
  daily: { date: string; views: number; visits: number }[];
  pages: Row[];
  referrers: Row[];
  countries: Row[];
  devices: Row[];
}
type State = { kind: "loading" } | { kind: "off" } | { kind: "error"; msg: string } | { kind: "ok"; s: Stats };

const nf = new Intl.NumberFormat();
const dayFmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

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

function Chart(p: { daily: Stats["daily"] }) {
  const W = 720;
  const H = 200;
  const pad = { l: 34, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...p.daily.map((d) => d.visits));
  const top = Math.max(4, Math.ceil(max / 4) * 4);
  const bw = (W - pad.l - pad.r) / p.daily.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const ticks = [0, top / 2, top];
  const last = p.daily.length - 1;
  return (
    <svg class="st-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Visits per day, last 30 days. Busiest day: ${nf.format(max)} visits.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line class="st-grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text class="st-axis" x={pad.l - 6} y={y(t) + 4} text-anchor="end">
            {nf.format(t)}
          </text>
        </g>
      ))}
      {p.daily.map((d, i) => (
        <rect
          key={d.date}
          class="st-bar"
          x={pad.l + i * bw + 1}
          y={y(d.visits)}
          width={Math.max(1, bw - 2)}
          height={Math.max(d.visits > 0 ? 1.5 : 0, H - pad.b - y(d.visits))}
        >
          <title>{`${dayFmt(d.date)}: ${nf.format(d.visits)} visits, ${nf.format(d.views)} page views`}</title>
        </rect>
      ))}
      {[0, 14, last].map((i) => (
        <text
          key={i}
          class="st-axis"
          x={pad.l + i * bw + (i === 0 ? 0 : i === last ? bw : bw / 2)}
          y={H - 6}
          text-anchor={i === 0 ? "start" : i === last ? "end" : "middle"}
        >
          {dayFmt(p.daily[i].date)}
        </text>
      ))}
    </svg>
  );
}

function Rank(p: { title: string; rows: Row[]; label?: (n: string) => string }) {
  const max = Math.max(1, ...p.rows.map((r) => r.views));
  return (
    <section class="st-card">
      <h2 class="st-h">{p.title}</h2>
      {p.rows.length === 0 ? (
        <p class="quiet">Nothing yet.</p>
      ) : (
        <ol class="st-rank">
          {p.rows.map((r) => (
            <li key={r.name} style={`--w:${Math.max(2, Math.round((r.views / max) * 100))}%`}>
              <span class="st-name">{p.label ? p.label(r.name) : r.name}</span>
              <span class="st-n">{nf.format(r.views)}</span>
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
  else {
    const s = st.s;
    if (s.totals.d30.views === 0 && s.daily.every((d) => d.views === 0))
      content = (
        <div class="empty">
          <span class="empty-t">No visits recorded yet</span>
          <span>Data appears a few minutes after visits.</span>
        </div>
      );
    else
      content = (
        <>
          <div class="st-tiles">
            <Tile label="Visits · 7 days" value={s.totals.d7.visits} sub="sessions" />
            <Tile label="Page views · 7 days" value={s.totals.d7.views} sub="pages opened" />
            <Tile label="Visits · 30 days" value={s.totals.d30.visits} sub="sessions" />
            <Tile label="Page views · 30 days" value={s.totals.d30.views} sub="pages opened" />
          </div>
          <section class="st-card">
            <h2 class="st-h">Visits per day</h2>
            <Chart daily={s.daily} />
          </section>
          <div class="st-grid2">
            <Rank title="Top pages" rows={s.pages} />
            <Rank title="Referrers" rows={s.referrers} label={(n) => n || "Direct"} />
            <Rank title="Countries" rows={s.countries} label={(n) => n || "Unknown"} />
            <Rank title="Devices" rows={s.devices} label={(n) => n || "Unknown"} />
          </div>
          <p class="quiet st-foot">Last 30 days, page views per row. Cloudflare Web Analytics, sampled; updated every 15 minutes.</p>
        </>
      );
  }
  return (
    <>
      <header class="page-h">
        <h1>Site stats</h1>
      </header>
      {content}
    </>
  );
}
