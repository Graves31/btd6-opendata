// Tools → Paragon degree calculator (/tools/paragon). Maths in paragon.ts (pure), numbers in data/paragons.json.
// The URL is the whole state (routes.ts ParagonRoute); every control change replaces the history entry, so Back
// leaves the tool. No NK data: the page is instant by construction. Last tower + difficulty are remembered in
// localStorage (optional: every access is wrapped).

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import data from "../data/paragons.json" with { type: "json" };
import { ART } from "../art/index.ts";
import { fmtInt } from "../format.ts";
import { navigate } from "../nav.ts";
import { evaluate, GAME_VERSION, paragonCost, PARAGON_TOWERS, REF, scaling, waysTo, type Difficulty, type ParagonInput, type ParagonResult, type ParagonTower, type Way } from "../paragon.ts";
import { href, PG_DIFFS, PG_MAX, type ParagonRoute } from "../routes.ts";
import { Spr } from "../sprite.tsx";
import { A, Section, Stat } from "../ui.tsx";

const D = data.degreeData;
const REQS = D.powerDegreeRequirements;
const DIFF_NAME: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard", impoppable: "Impoppable" };
const BUCKET_NAME: Record<string, string> = {
  cash: "Sacrificed cash",
  pops: "Pops and income",
  tiers: "Upgrade tiers",
  t5: "Extra tier 5s",
  totems: "Power totems",
};

/** A paragon's upgrade icon (from the game's art). */
export function paragonIcon(tower: ParagonTower, size = 64) {
  return <Spr family="paragon" k={tower} size={size} label />;
}

const paragonName = (t: ParagonTower) => data.paragons[t].name;
/** Picker order = the game's shop order (as in the tower sprite sheet). */
const PICK_ORDER = [...PARAGON_TOWERS].sort((a, b) => (ART.tower?.keys[a] ?? 99) - (ART.tower?.keys[b] ?? 99));

// ─────────────────────────────── helpers

const LAST_KEY = "pg-last";
function lastUsed(): { tower: ParagonTower; diff: Difficulty } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    const tower = PARAGON_TOWERS.find((t) => t === v?.tower);
    const diff = PG_DIFFS.find((d) => d === v?.diff);
    return tower && diff ? { tower, diff } : undefined;
  } catch {
    return undefined;
  }
}
function remember(tower: ParagonTower, diff: Difficulty): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ tower, diff }));
  } catch {
    /* storage blocked: the page works without it */
  }
}

/** "85m", "1.2m", "40k", "1,500,000", "$2b" → number; null when it isn't one. */
export function parseNum(text: string): number | null {
  const m = /^(\d+\.?\d*|\.\d+)([kmb])?$/.exec(text.replace(/[\s,$_]/g, "").toLowerCase());
  if (!m) return null;
  const unit = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return parseFloat(m[1]) * unit;
}

/** Rounded UP to two decimals (an amount to add must never read lower than it is): 2,104,560 → "2.11M". */
function up(n: number): string {
  if (n >= 1e9) return `${+(Math.ceil(n / 1e7) / 100).toFixed(2)}B`;
  if (n >= 1e6) return `${+(Math.ceil(n / 1e4) / 100).toFixed(2)}M`;
  return fmtInt(n);
}
const times = (x: number) => `×${+x.toFixed(2)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function describe(w: Way): { big: string; exact: string } {
  const n = w.add;
  switch (w.key) {
    case "cash":
      return { big: `+$${up(n)} sacrificed cash`, exact: `$${fmtInt(n)}` };
    case "pops":
      return { big: `+${up(n)} pops`, exact: fmtInt(n) };
    case "totems":
      return { big: `Add ${fmtInt(n)} ${plural(n, "totem", "totems")}`, exact: "" };
    case "t5":
      return { big: `Add ${fmtInt(n)} tier 5 ${plural(n, "tower", "towers")}`, exact: "" };
    default:
      return { big: `Add ${fmtInt(n)} upgrade ${plural(n, "tier", "tiers")} (non-tier-5 towers)`, exact: "" };
  }
}

// ─────────────────────────────── number field

function NumField(p: { id: string; label: string; hint?: string; value: number; max: number; step: number; decimal?: boolean; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);
  const clamp = (n: number) => Math.min(p.max, Math.max(0, Math.round(n)));
  const commit = (text: string) => {
    setDraft(null);
    const n = parseNum(text);
    if (n === null) return; // not a number: back to the last good value
    setCapped(n > p.max);
    const v = clamp(n);
    if (v !== p.value) p.onChange(v);
  };
  const bump = (dir: number) => {
    setDraft(null);
    setCapped(false);
    const v = clamp(p.value + dir * p.step);
    if (v !== p.value) p.onChange(v);
  };
  return (
    <div class="pg-field">
      <label for={p.id} class="pg-label">
        {p.label}
      </label>
      <div class="pg-num">
        <button type="button" class="pg-step" aria-label={`Less ${p.label.toLowerCase()}`} disabled={p.value <= 0} onClick={() => bump(-1)}>
          −
        </button>
        <input
          id={p.id}
          type="text"
          inputMode={p.decimal ? "decimal" : "numeric"}
          enterKeyHint="done"
          autocomplete="off"
          spellcheck={false}
          value={draft ?? fmtInt(p.value)}
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.select(), 0);
          }}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              bump(e.key === "ArrowUp" ? 1 : -1);
            }
          }}
        />
        <button type="button" class="pg-step" aria-label={`More ${p.label.toLowerCase()}`} disabled={p.value >= p.max} onClick={() => bump(1)}>
          +
        </button>
      </div>
      <p class="pg-hint">
        {p.hint && <>{p.hint} · </>}
        {capped ? <strong>limited to the max, {fmtInt(p.max)}</strong> : <>max {fmtInt(p.max)}</>}
      </p>
    </div>
  );
}

// ─────────────────────────────── page

type Patch = Partial<Omit<ParagonRoute, "name" | "picked">>;

export function ParagonPage(props: { r: ParagonRoute }) {
  const last = useMemo(lastUsed, []);
  const r = props.r;
  const s: ParagonRoute = !r.picked && last ? { ...r, tower: last.tower, diff: last.diff } : r;
  useEffect(() => remember(s.tower, s.diff), [s.tower, s.diff]);

  const go = (patch: Patch) => navigate(href.paragon({ ...s, ...patch }, true), { replace: true, keepScroll: true });
  const input: ParagonInput = { tower: s.tower, diff: s.diff, coop: s.coop, cash: s.cash, slider: s.slider, pops: s.pops, income: s.income, tiers: s.tiers, extraT5: s.extraT5, totems: s.totems };
  const res = evaluate(input);
  const defTarget = res.breakpoint?.degree ?? res.next?.degree ?? 100;
  const target = s.target ?? defTarget;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    const url = location.origin + href.paragon(s, true);
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(url).then(done, done);
    else done();
  };
  const toResult = () => document.getElementById("pg-result")?.scrollIntoView({ block: "start" });

  return (
    <div class="pg">
      <A href={href.tools()} class="backlink rv-back">
        <span aria-hidden="true">‹</span> Tools
      </A>
      <header class="rv-bar">
        <div class="rv-bar-t">
          <p class="eyebrow">Tools</p>
          <h1 class="rv-h1">Paragon degree calculator</h1>
        </div>
      </header>

      <button type="button" class="pg-mbar" onClick={toResult} aria-label="Show the full result">
        <span>Degree</span>
        <b>{res.degree}</b>
        <span>{fmtInt(res.power)} power</span>
        <span class="pg-mbar-n">{res.next ? `next in ${fmtInt(res.next.gap)}` : "max degree"}</span>
      </button>

      <Picker s={s} go={go} />

      <div class="pg-cols">
        <div class="pg-main">
          <TargetSection s={s} input={input} res={res} target={target} go={go} />
          <Section title="Your sacrifices">
            <div class="pg-quick rv-form">
              <NumField id="pg-cash" label="Sacrificed cash" hint="exclude what you spent on tier 5s" value={s.cash} max={PG_MAX.cash} step={10_000} decimal onChange={(n) => go({ cash: n })} />
              <NumField id="pg-t5" label="Extra tier 5s" hint="sacrificed beyond the paragon's three" value={s.extraT5} max={PG_MAX.extraT5} step={1} onChange={(n) => go({ extraT5: n })} />
              <NumField id="pg-totems" label="Power totems" hint="Paragon Power Totems placed" value={s.totems} max={PG_MAX.totems} step={1} onChange={(n) => go({ totems: n })} />
            </div>
            <details class="pg-fold" open={s.adv} onToggle={(e) => e.currentTarget.open !== s.adv && go({ adv: e.currentTarget.open })}>
              <summary>Advanced: pops, income, tiers, slider</summary>
              <div class="pg-quick rv-form">
                <NumField id="pg-pops" label="Pops" hint="by the sacrificed towers" value={s.pops} max={PG_MAX.pops} step={1_000_000} decimal onChange={(n) => go({ pops: n })} />
                <NumField id="pg-income" label="Income" hint="cash the sacrificed towers earned" value={s.income} max={PG_MAX.income} step={100_000} decimal onChange={(n) => go({ income: n })} />
                <NumField id="pg-tiers" label="Upgrade tiers" hint="on sacrificed non-tier-5 towers (a 2-0-3 counts 5)" value={s.tiers} max={PG_MAX.tiers} step={1} onChange={(n) => go({ tiers: n })} />
                <NumField id="pg-slider" label="Cash slider" hint={`paid in through the paragon's slider, +${+(D.paidContributionPenalty * 100).toFixed(1)}% cost`} value={s.slider} max={PG_MAX.slider} step={10_000} decimal onChange={(n) => go({ slider: n })} />
              </div>
            </details>
          </Section>
        </div>
        <aside class="pg-side" id="pg-result" aria-label="Result">
          <ResultCard res={res} copied={copied} copy={copy} />
        </aside>
      </div>

      <ScalingFold degree={res.degree} />
      <MethodFold s={s} />
      <p class="pg-foot">Data from game v{GAME_VERSION} · unofficial</p>
    </div>
  );
}

// ─────────────────────────────── picker, difficulty, co-op

function Picker(props: { s: ParagonRoute; go: (p: Patch) => void }) {
  const { s, go } = props;
  return (
    <Section title="Paragon" class="pg-pick-sec">
      <div class="pg-picker" role="group" aria-label="Paragon">
        {PICK_ORDER.map((t) => (
          <button key={t} type="button" class="pg-tile" aria-pressed={t === s.tower} aria-label={paragonName(t)} title={paragonName(t)} onClick={() => go({ tower: t })}>
            {paragonIcon(t, 48)}
          </button>
        ))}
      </div>
      <p class="pg-picked">
        <strong>{paragonName(s.tower)}</strong>
        <span>
          ${fmtInt(paragonCost(s.tower, s.diff))} on {DIFF_NAME[s.diff]}
        </span>
      </p>
      <div class="pg-opts">
        <div class="rv-chips" role="group" aria-label="Difficulty">
          {PG_DIFFS.map((d) => (
            <button key={d} type="button" class={`rv-chip${d === s.diff ? " on" : ""}`} aria-pressed={d === s.diff} onClick={() => go({ diff: d })}>
              {DIFF_NAME[d]}
            </button>
          ))}
        </div>
        <div class="pg-coop">
          <button type="button" class={`rv-chip${s.coop ? " on" : ""}`} aria-pressed={s.coop} onClick={() => go({ coop: !s.coop })}>
            Co-op
          </button>
          <span class="pg-hint">
            {s.coop
              ? "Teammates' towers, tier 5s and totems are absorbed too: up to 3 extra tier 5s per teammate."
              : "Solo: an extra tier 5 is only possible for Apex Plasma Master (Master Double Cross) and Herald of Everfrost (Silas)."}
          </span>
        </div>
      </div>
    </Section>
  );
}

// ─────────────────────────────── target

function TargetSection(p: { s: ParagonRoute; input: ParagonInput; res: ParagonResult; target: number; go: (p: Patch) => void }) {
  const { res, target, go } = p;
  const explicit = p.s.target !== undefined;
  const ways = res.degree < 100 && target > res.degree ? waysTo(p.input, REQS[target - 1]) : [];
  const [best, ...others] = ways;
  const step = (n: number) => go({ target: Math.min(100, Math.max(2, n)) });
  let answer: ComponentChildren;
  if (res.degree >= 100) {
    answer = <p class="pg-ans-t">Degree 100: the highest there is.</p>;
  } else if (target <= res.degree) {
    answer = (
      <>
        <p class="pg-ans-t">Already there</p>
        <p class="pg-ans-s">You are at degree {res.degree}. Pick a higher target.</p>
      </>
    );
  } else if (!best) {
    answer = (
      <>
        <p class="pg-ans-t">No single change gets there</p>
        <p class="pg-ans-s">
          Degree {target} needs {fmtInt(REQS[target - 1])} power. Combine several sources (the Advanced inputs help), or add totems.
        </p>
      </>
    );
  } else {
    const d = describe(best);
    answer = (
      <>
        <p class="pg-ans-t">{d.big}</p>
        <p class="pg-ans-s">
          {d.exact && <>{d.exact} · </>}reaches degree {target}: {fmtInt(REQS[target - 1])} power, you have {fmtInt(res.power)}.
        </p>
        {others.length > 0 && (
          <details class="pg-fold pg-other">
            <summary>Other ways</summary>
            <ul>
              {others.map((w) => {
                const o = describe(w);
                return (
                  <li key={w.key}>
                    {o.big}
                    {o.exact && <span> ({o.exact})</span>}
                  </li>
                );
              })}
            </ul>
            <p class="pg-hint">Each is enough on its own; the rest of your inputs stay as they are.</p>
          </details>
        )}
      </>
    );
  }
  return (
    <Section
      title="Target"
      class="pg-target-sec"
      aside={
        explicit ? (
          <button type="button" class="pg-link" onClick={() => go({ target: undefined })}>
            Back to next boss breakpoint
          </button>
        ) : (
          "next boss breakpoint"
        )
      }
    >
      <div class="pg-target">
        <div class="pg-tstep" role="group" aria-label="Target degree">
          <button type="button" class="pg-step" aria-label="Lower target degree" disabled={target <= 2} onClick={() => step(target - 1)}>
            −
          </button>
          <span class="pg-tval" aria-live="polite">
            <span class="pg-tk">Degree</span>
            <b>{target}</b>
          </span>
          <button type="button" class="pg-step" aria-label="Higher target degree" disabled={target >= 100} onClick={() => step(target + 1)}>
            +
          </button>
        </div>
        <div class="pg-ans">{answer}</div>
      </div>
    </Section>
  );
}

// ─────────────────────────────── result

function ResultCard(p: { res: ParagonResult; copied: boolean; copy: () => void }) {
  const { res } = p;
  const bp = res.breakpoint;
  const at = bp ? scaling(bp.degree) : undefined;
  return (
    <div class="pg-res">
      <div class="pg-res-h">
        <p class="eyebrow">Result</p>
        <button type="button" class="pg-copy" onClick={p.copy}>
          {p.copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <dl class="pg-hero">
        <Stat k="Degree" v={res.degree} accent />
      </dl>
      <dl class="pg-nums">
        <Stat k="Power" v={fmtInt(res.power)} />
        <Stat k="Next degree" v={res.next ? `+${fmtInt(res.next.gap)}` : "Max"} note={res.next ? `degree ${res.next.degree} at ${fmtInt(res.next.power)}` : "degree 100 reached"} />
      </dl>
      {bp && at && (
        <p class="pg-bp">
          <span class="rv-chip on pg-chip">
            {bp.degree} · +{bp.degree - res.degree} {plural(bp.degree - res.degree, "degree", "degrees")}
          </span>
          <span>
            Next boss step: {times(at.bossNormal)} boss damage, {times(at.bossElite)} on elites (now {times(res.boss.normal)} / {times(res.boss.elite)}).
          </span>
        </p>
      )}
      <ul class="pg-buckets">
        {res.buckets.map((b) => {
          const pct = b.cap ? Math.min(100, (b.power / b.cap) * 100) : 0;
          return (
            <li key={b.key} class={b.full ? "pg-b full" : "pg-b"}>
              <div class="pg-b-h">
                <span>{BUCKET_NAME[b.key]}</span>
                <b>
                  {fmtInt(b.power)}
                  {b.cap !== null ? ` / ${fmtInt(b.cap)}` : ""}
                </b>
              </div>
              <div class="pg-track" aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </div>
              <p class="pg-b-n">{b.cap === null ? "uncapped" : b.full ? "MAX" : `${Math.floor(pct)}% of the cap`}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────── folds

function ScalingFold(p: { degree: number }) {
  const set = new Set<number>([20, 40, 60, 80, 100]);
  for (let d = p.degree - 3; d <= p.degree + 3; d++) if (d >= 1 && d <= 100) set.add(d);
  const rows = [...set].sort((a, b) => a - b);
  const one = (n: number) => +n.toFixed(1);
  const H = (long: string, short: string) => (
    <th scope="col">
      <span class="pg-long">{long}</span>
      <span class="pg-short">{short}</span>
    </th>
  );
  return (
    <details class="pg-fold pg-fold-big">
      <summary>Per-degree scaling</summary>
      <table class="pg-table">
        <thead>
          <tr>
            {H("Degree", "Deg")}
            {H("Damage", "Dmg")}
            {H("Pierce", "Prc")}
            {H("Cooldown", "CD")}
            {H("Boss N", "Bos N")}
            {H("Boss E", "Bos E")}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const x = scaling(d);
            return (
              <tr key={d} class={d === p.degree ? "on" : undefined} aria-current={d === p.degree ? "true" : undefined}>
                <th scope="row">{d}</th>
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
      <p class="pg-hint">Your degree is highlighted. Boss N / E: bonus damage to normal / elite bosses.</p>
    </details>
  );
}

function MethodFold(p: { s: ParagonRoute }) {
  const unit = paragonCost(p.s.tower, p.s.diff) / D.moneySpentOverX;
  return (
    <details class="pg-fold pg-fold-big">
      <summary>How this is calculated</summary>
      <ul class="pg-how">
        <li>
          <b>Sacrificed cash:</b> 1 power per ${+unit.toFixed(2)} (this paragon's cost ÷ {fmtInt(D.moneySpentOverX)}), up to {fmtInt(D.maxPowerFromMoneySpent)} power. The slider pays {+(D.paidContributionPenalty * 100).toFixed(1)}% more per power.
        </li>
        <li>
          <b>Pops:</b> 1 power per {fmtInt(D.popsOverX)} pops, up to {fmtInt(D.maxPowerFromPops)}. Cash the towers earned counts ×{D.cashEarnedContributionModifier} as pops.
        </li>
        <li>
          <b>Upgrade tiers</b> on sacrificed non-tier-5 towers: {fmtInt(D.nonTier5TowersMultByX)} power each, up to {fmtInt(D.maxPowerFromNonTier5Count)}.
        </li>
        <li>
          <b>Extra tier 5s:</b> {fmtInt(D.tier5TowersMultByX)} power each, up to {fmtInt(D.maxPowerFromTier5Count)}.
        </li>
        <li>
          <b>Power totems:</b> {fmtInt(REF.totemPower)} power each, no cap (read from the game's code).
        </li>
        <li>
          <b>Cost by difficulty:</b> {PG_DIFFS.map((d) => `${d[0].toUpperCase()}${d.slice(1)} $${fmtInt(paragonCost(p.s.tower, d))}`).join(" · ")}. The game's cost mods: Easy ×0.85, Hard ×1.08, Impoppable is Hard then ×1.111; rounded to ${REF.costRounding}.
        </li>
        <li>
          <b>Degree:</b> the highest degree whose power requirement you meet: degree 2 at {fmtInt(REQS[1])}, degree 100 at {fmtInt(REQS[99])}. Boss damage grows {+(D.bonusBossDamagePercent * 100).toFixed(0)}% every {D.bonusBossDamagePerDegrees} degrees; elites take double.
        </li>
        <li>
          <b>Co-op:</b> accepted, but changes nothing yet (pending verification).
        </li>
      </ul>
    </details>
  );
}
