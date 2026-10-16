// Tools → Farming resources (/tools/farming?r=12): reference charts for farming. No NK data.
// Banana spawn chart: numbers from the owner's diagram (0-0-0 / 1-0-0 / 2-0-0 farms); bananas sit evenly between
// round start and round end, at (i + ½) / n of the round. With a round picked, its length (the time its bloons
// spawn over, from the default round set: the visualizer's "Spawns over") puts seconds on the chart.

import { useEffect } from "preact/hooks";
import bananaArt from "../art/tools/banana.webp";
import heroArt from "../art/tools/farming.webp";
import farm000 from "../art/tools/farm000.webp";
import farm100 from "../art/tools/farm100.webp";
import farm200 from "../art/tools/farm200.webp";
import { ROUND_SET_BY_ID, type RoundSetData } from "../data/rounds/index.ts";
import { navigate, store } from "../nav.ts";
import { spawnEnd } from "../rounds.ts";
import { href } from "../routes.ts";
import { A, ToolBack, ToolHero } from "../ui.tsx";
import { TargetInput } from "./paragon.tsx";

const FARMS = [
  { path: "0-0-0", art: farm000, bananas: 4, cash: 80 },
  { path: "1-0-0", art: farm100, bananas: 6, cash: 120 },
  { path: "2-0-0", art: farm200, bananas: 8, cash: 160 },
];
const secs = (s: number) => `${+s.toFixed(1)}s`;

function SpawnChart(p: { r?: number }) {
  const set = ROUND_SET_BY_ID.default!;
  useEffect(() => void store.want([set.url]), [set.url]);
  const e = store.peek(set.url);
  const data = e?.ok ? (e.data as RoundSetData) : undefined;
  const r = p.r === undefined ? undefined : Math.min(set.last, Math.max(set.first, p.r));
  const round = r === undefined ? undefined : data?.rounds.find((x) => x.n === r);
  const len = round ? spawnEnd(round) : undefined;
  const go = (n: number | undefined) => navigate(href.farming(n === undefined ? undefined : Math.min(set.last, Math.max(set.first, n))), { replace: true, keepScroll: true });
  return (
    <section class="pg-panel fm-panel" aria-labelledby="fm-spawn">
      <div class="pg-ph">
        <h2 class="eyebrow" id="fm-spawn">
          Banana spawn timing
        </h2>
        <span class="pg-hint">when each banana drops during the round</span>
      </div>
      <div class="fm-round">
        <div class="pg-tstep" role="group" aria-label="Round">
          <button type="button" class="pg-step" aria-label="Previous round" disabled={r !== undefined && r <= set.first} onClick={() => go(r === undefined ? set.first : r - 1)}>
            −
          </button>
          {r === undefined ? (
            <button type="button" class="pg-tin fm-any" onClick={() => go(set.first)}>
              Round
            </button>
          ) : (
            <TargetInput value={r} onChange={go} label="Round" />
          )}
          <button type="button" class="pg-step" aria-label="Next round" disabled={r !== undefined && r >= set.last} onClick={() => go(r === undefined ? set.first : r + 1)}>
            +
          </button>
        </div>
        <p class="pg-hint">
          {r === undefined ? (
            <>Pick a round to put seconds on the chart (rounds {set.first}–{set.last}).</>
          ) : len === undefined ? (
            <>Loading round {r}…</>
          ) : (
            <>
              <strong>Round {r}</strong>: bloons spawn over <strong>{secs(len)}</strong>.{" "}
              <button type="button" class="pg-link" onClick={() => go(undefined)}>
                Any round
              </button>
            </>
          )}
        </p>
      </div>
      <ol class={`fm-rows${len !== undefined ? " fm-timed" : ""}`}>
        {FARMS.map((f) => (
          <li key={f.path} class="fm-row">
            <span class="fm-who">
              <img src={f.art} width={48} height={48} alt="" decoding="async" />
              <span>
                <b class="fm-path">{f.path}</b>
                <span class="fm-n">{f.bananas} bananas</span>
              </span>
            </span>
            <span class="fm-track" role="img" aria-label={len === undefined ? `${f.bananas} bananas spread evenly over the round` : `bananas at ${Array.from({ length: f.bananas }, (_, i) => secs(((i + 0.5) / f.bananas) * len)).join(", ")}`}>
              {Array.from({ length: f.bananas }, (_, i) => {
                const at = (i + 0.5) / f.bananas;
                return (
                  <span key={i} class="fm-b" style={{ left: `${at * 100}%` }}>
                    <img src={bananaArt} alt="" decoding="async" />
                    {len !== undefined && <i>{secs(at * len)}</i>}
                  </span>
                );
              })}
            </span>
            <b class="fm-cash">${f.cash}</b>
          </li>
        ))}
      </ol>
      <div class="fm-axis" aria-hidden="true">
        <span class="fm-tick" style={{ left: "0%" }}>
          Round start{len !== undefined && <i>0s</i>}
        </span>
        <span class="fm-tick" style={{ left: "50%" }}>
          50%{len !== undefined && <i>{secs(len / 2)}</i>}
        </span>
        <span class="fm-tick" style={{ left: "100%" }}>
          Round end{len !== undefined && <i>{secs(len)}</i>}
        </span>
      </div>
      <p class="pg-hint fm-note">Bananas drop at even gaps: the first half a gap after the round starts, the last half a gap before it ends.</p>
    </section>
  );
}

export function FarmingPage(p: { r?: number }) {
  return (
    <div class="pg">
      <ToolBack />
      <ToolHero art={<img src={heroArt} width={96} height={96} alt="" />} title="Farming resources" sub="When Banana Farms drop their bananas during a round, and what they're worth.">
        {FARMS.map((f) => (
          <span key={f.path} class="th-ic">
            <img src={f.art} width={44} height={44} alt={`Banana Farm ${f.path}`} decoding="async" />
          </span>
        ))}
      </ToolHero>
      <SpawnChart r={p.r} />
      <A href={href.bankPlanner()} class="pg-rlink fm-more">
        When to collect a bank → Bank & IMF Loan planner
      </A>
    </div>
  );
}
