// Tools → Paragon degree calculator (/tools/paragon). Maths in paragon.ts (pure), numbers in data/paragons.json.
// The URL is the whole state (routes.ts ParagonRoute); every control change replaces the history entry, so Back
// leaves the tool. No NK data: the page is instant by construction. Last tower + difficulty are remembered in
// localStorage (optional: every access is wrapped).

import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ART } from "../art/index.ts";
import heroArt from "../art/tools/paragon.webp";
import { fmtInt, unitName } from "../format.ts";
import { navigate } from "../nav.ts";
import { degreeData, evaluate, MAX_DEGREE, gameVersion, inputMax, paragonCost, paragonName, paragonTowers, powerForDegree, REF, scaling, waysTo, type Bucket, type Difficulty, type GameVer, type ParagonInput, type ParagonResult, type ParagonTower, type Way } from "../paragon.ts";
import { href, PG_DIFFS, type ParagonRoute } from "../routes.ts";
import { TOWER_GROUPS } from "../rules.tsx";
import { Spr } from "../sprite.tsx";
import { A, Stat, ToolBack, ToolHero } from "../ui.tsx";

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

/** Picker runs of a version = the game's shop categories in shop order; a paragon of an unknown tower goes last, in sprite-sheet order. */
const pickRuns = (ver: GameVer): [string, ParagonTower[]][] => {
  const all = paragonTowers(ver);
  const isParagon = (t: string): t is ParagonTower => (all as string[]).includes(t);
  const known = TOWER_GROUPS.map(([cat, ids]): [string, ParagonTower[]] => [cat, ids.filter(isParagon)]);
  const placed = new Set<string>(known.flatMap(([, t]) => t));
  const rest = all.filter((t) => !placed.has(t)).sort((a, b) => (ART.tower?.keys[a] ?? 99) - (ART.tower?.keys[b] ?? 99));
  return [...known, ["Other", rest] as [string, ParagonTower[]]].filter(([, t]) => t.length > 0);
};
/** Short tower names on the picker tiles (wide screens). */
const SHORT: Record<string, string> = {
  DartMonkey: "Dart",
  BoomerangMonkey: "Boomerang",
  BombShooter: "Bomb",
  TackShooter: "Tack",
  IceMonkey: "Ice",
  MonkeySub: "Sub",
  SniperMonkey: "Sniper",
  MonkeyBuccaneer: "Buccaneer",
  MonkeyAce: "Ace",
  WizardMonkey: "Wizard",
  NinjaMonkey: "Ninja",
  Druid: "Druid",
  SpikeFactory: "Spike",
  EngineerMonkey: "Engineer",
};

// ─────────────────────────────── helpers

const LAST_KEY = "pg-last";
function lastUsed(ver: GameVer): { tower: ParagonTower; diff: Difficulty } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
    const tower = paragonTowers(ver).find((t) => t === v?.tower);
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

/** A way as amount + noun ("+$2.11M" "sacrificed cash"), plus the exact amount when the big one is rounded. */
function describe(w: Way): { amt: string; noun: string; exact: string } {
  const n = w.add;
  switch (w.key) {
    case "cash":
      return { amt: `+$${up(n)}`, noun: "sacrificed cash", exact: n >= 1e6 ? `$${fmtInt(n)}` : "" };
    case "pops":
      return { amt: `+${up(n)}`, noun: "pops", exact: n >= 1e6 ? fmtInt(n) : "" };
    case "totems":
      return { amt: `+${fmtInt(n)}`, noun: plural(n, "power totem", "power totems"), exact: "" };
    case "t5":
      return { amt: `+${fmtInt(n)}`, noun: plural(n, "tier 5 tower", "tier 5 towers"), exact: "" };
    default:
      return { amt: `+${fmtInt(n)}`, noun: plural(n, "upgrade tier", "upgrade tiers"), exact: "" };
  }
}

// ─────────────────────────────── number field

/** A field's game icon (ui sheet). */
const FieldIcon = (p: { k: string; size?: number }) => <Spr family="ui" k={p.k} size={p.size ?? 28} label />;

/** Slider grain: about 400 stops over the range, on a round 1/2/5 step (whole units at least). */
function grain(max: number): number {
  const raw = max / 400;
  if (raw <= 1) return 1;
  const e = 10 ** Math.floor(Math.log10(raw));
  return raw <= 2 * e ? 2 * e : raw <= 5 * e ? 5 * e : 10 * e;
}

function NumField(p: { id: string; icon: string; label: string; hint: string; value: number; max: number; decimal?: boolean; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);
  // While dragging, the slider's value shows at once; the URL follows 150 ms after the first move with the latest
  // value (every change replaces the history entry, and Safari caps replaceState calls). No "change" event: Chrome
  // skips it on release when the value was re-set during the drag, which left the last move unsent.
  const [drag, setDrag] = useState<number | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const live = useRef(p);
  live.current = p;
  useEffect(() => () => clearTimeout(timer.current), []);
  const clamp = (n: number) => Math.min(p.max, Math.max(0, Math.round(n)));
  const commit = (text: string) => {
    setDraft(null);
    const n = parseNum(text);
    if (n === null) return; // not a number: back to the last good value
    setCapped(n > p.max);
    const v = clamp(n);
    if (v !== p.value) p.onChange(v);
  };
  const flush = () => {
    timer.current = undefined;
    setDrag(null);
    if (latest.current !== live.current.value) live.current.onChange(latest.current);
  };
  const slide = (raw: number) => {
    const g = grain(p.max);
    latest.current = raw >= p.max ? p.max : clamp(Math.round(raw / g) * g);
    setDraft(null);
    setCapped(false);
    setDrag(latest.current);
    timer.current ??= setTimeout(flush, 150);
  };
  // Typing moves the slider too (applied to the result on Enter or leaving the field).
  const typed = draft === null ? null : parseNum(draft);
  const shown = drag ?? (typed === null ? p.value : clamp(typed));
  return (
    <div class="pg-field">
      <div class="pg-fl">
        <label for={p.id} class="pg-lab">
          <FieldIcon k={p.icon} />
          {p.label}
        </label>
        <p class="pg-hint">
          {p.hint}
          {capped && (
            <>
              {" · "}
              <strong>limited to the max, {fmtInt(p.max)}</strong>
            </>
          )}
        </p>
      </div>
      <div class="pg-num">
        <input
          id={p.id}
          type="text"
          inputMode={p.decimal ? "decimal" : "numeric"}
          enterKeyHint="done"
          autocomplete="off"
          spellcheck={false}
          value={draft ?? fmtInt(shown)}
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.select(), 0);
          }}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <input
          type="range"
          class="pg-range"
          min={0}
          max={p.max}
          step="any"
          value={shown}
          aria-label={`${p.label}, 0 to ${fmtInt(p.max)}`}
          aria-valuetext={fmtInt(shown)}
          onInput={(e) => slide(+e.currentTarget.value)}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────── page

type Patch = Partial<Omit<ParagonRoute, "name" | "picked">>;
type InKey = "cash" | "slider" | "pops" | "income" | "tiers" | "extraT5" | "totems";
const IN_KEYS: InKey[] = ["cash", "slider", "pops", "income", "tiers", "extraT5", "totems"];
/** Each input's game icon (ui sheet), and each power source's in the result. */
const IN_ICON: Record<InKey, string> = { cash: "StartingCash", slider: "CashSpent", pops: "Pops", income: "Income", tiers: "LeastTiersRule", extraT5: "Tier5", totems: "ParagonTotem" };
const BUCKET_ICON: Record<string, string> = { cash: "StartingCash", pops: "Pops", tiers: "LeastTiersRule", t5: "Tier5", totems: "ParagonTotem" };
type Max = Record<InKey, number>;

export function ParagonPage(props: { r: ParagonRoute }) {
  const r = props.r;
  const last = useMemo(() => lastUsed(r.ver), [r.ver]);
  const picked: ParagonRoute = !r.picked && last ? { ...r, tower: last.tower, diff: last.diff } : r;
  useEffect(() => remember(picked.tower, picked.diff), [picked.tower, picked.diff]);
  // The URL accepts generous values; each input stops where its source fills (per paragon and difficulty).
  const max = inputMax(picked.tower, picked.diff, picked.ver);
  const s: ParagonRoute = { ...picked };
  for (const k of IN_KEYS) s[k] = Math.min(max[k], s[k]);

  const go = (patch: Patch) => navigate(href.paragon({ ...s, ...patch }, true), { replace: true, keepScroll: true });
  const input: ParagonInput = { tower: s.tower, diff: s.diff, ver: s.ver, cash: s.cash, slider: s.slider, pops: s.pops, income: s.income, tiers: s.tiers, extraT5: s.extraT5, totems: s.totems, boost: s.boost };
  const res = evaluate(input);
  const defTarget = res.breakpoint?.degree ?? res.next?.degree ?? MAX_DEGREE;
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
      <ToolBack />
      <ToolHero
        art={<img src={heroArt} width={96} height={96} alt="" />}
        title="Paragon degree calculator"
        sub="How much sacrificed cash, pops, towers and totems each paragon degree takes, from the game's own data."
      >
        {Object.entries(BUCKET_ICON).map(([b, k]) => (
          <span key={b} class="th-ic">
            <Spr family="ui" k={k} size={44} name={BUCKET_NAME[b]} />
          </span>
        ))}
      </ToolHero>

      <button type="button" class="pg-mbar" onClick={toResult} aria-label="Show the full result">
        <span>Degree</span>
        <b>{res.degree}</b>
        <span>{fmtInt(res.power)} power</span>
        <span class="pg-mbar-n">{res.next ? `next in ${fmtInt(res.next.gap)}` : "max degree"}</span>
        <i class="pg-mbar-go" aria-hidden="true" />
      </button>

      <Picker s={s} go={go} />

      {/* Settings | target over inputs | result (one column on phones, in that order). */}
      <div class="pg-grid">
        <Settings s={s} go={go} />
        <TargetPanel s={s} input={input} res={res} target={target} go={go} />
        <InputsPanel s={s} res={res} max={max} go={go} />
        <aside class="pg-side" id="pg-result" aria-label="Result">
          <ResultCard res={res} ver={s.ver} boost={s.boost} copied={copied} copy={copy} />
        </aside>
      </div>

      <ScalingFold degree={res.degree} ver={s.ver} />
      <MethodFold s={s} max={max} />
      <p class="pg-foot">Data from game v{gameVersion(s.ver)} · unofficial</p>
    </div>
  );
}

// ─────────────────────────────── picker, difficulty, boost

const VERS: [GameVer, string][] = [
  ["57", "v57"],
  ["56", "v56.3"],
];

/** The version's power caps, from its data ("upgrade tiers give no power" when that cap is 0). */
function verHint(ver: GameVer): string {
  const d = degreeData(ver);
  const tiers = d.maxPowerFromNonTier5Count ? `upgrade tiers ${fmtInt(d.maxPowerFromNonTier5Count)}` : "upgrade tiers none";
  return `${ver === "56" ? "Before the paragon rework. " : ""}Power caps: cash ${fmtInt(d.maxPowerFromMoneySpent)}, pops ${fmtInt(d.maxPowerFromPops)}, ${tiers}`;
}

function Picker(props: { s: ParagonRoute; go: (p: Patch) => void }) {
  const { s, go } = props;
  return (
    <section class="pg-pick" aria-label="Paragon">
      <div class="pg-picker">
        {pickRuns(s.ver).map(([cat, towers]) => (
          <div key={cat} class="pg-run" role="group" aria-label={cat}>
            {towers.map((t) => (
              <button key={t} type="button" class={`pg-tile c-${cat}`} data-k={t} aria-pressed={t === s.tower} aria-label={`${paragonName(t, s.ver)} (${unitName(t)})`} title={paragonName(t, s.ver)} onClick={() => go({ tower: t })}>
                <span class="pg-tile-art">{paragonIcon(t, 72)}</span>
                <span class="pg-tile-ft" aria-hidden="true">
                  <Spr family="tower" k={t} size={24} label />
                  <span class="pg-tile-n">{SHORT[t] ?? unitName(t)}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <p class="pg-picked">
        <strong>{paragonName(s.tower, s.ver)}</strong>
        <span class="pg-picked-t">
          <Spr family="tower" k={s.tower} size={28} label />
          {unitName(s.tower)}
        </span>
        <span>
          · ${fmtInt(paragonCost(s.tower, s.diff, s.ver))} on {DIFF_NAME[s.diff]}
        </span>
      </p>
    </section>
  );
}

/** Difficulty, game version, Paragon Boost, no totems. */
function Settings(props: { s: ParagonRoute; go: (p: Patch) => void }) {
  const { s, go } = props;
  return (
    <section class="pg-panel pg-set" aria-label="Settings">
      <div class="pg-ph">
        <p class="eyebrow">Settings</p>
      </div>
      <div class="pg-opts">
        <div class="rv-chips" role="group" aria-label="Difficulty">
          {PG_DIFFS.map((d) => (
            <button key={d} type="button" class={`rv-chip${d === s.diff ? " on" : ""}`} aria-pressed={d === s.diff} onClick={() => go({ diff: d })}>
              {DIFF_NAME[d]}
            </button>
          ))}
        </div>
        <div class="pg-tog">
          <div class="rv-chips" role="group" aria-label="Game version">
            {VERS.map(([v, label]) => (
              <button key={v} type="button" class={`rv-chip${v === s.ver ? " on" : ""}`} aria-pressed={v === s.ver} onClick={() => go({ ver: v })}>
                {label}
              </button>
            ))}
          </div>
          <span class="pg-hint">{verHint(s.ver)}</span>
        </div>
        <div class="pg-tog">
          <button type="button" class={`rv-chip${s.boost ? " on" : ""}`} aria-pressed={s.boost} onClick={() => go({ boost: !s.boost })}>
            Paragon Boost
          </button>
          <span class="pg-hint">+{REF.boostDegrees} degrees</span>
          <label class="pg-check">
            <input type="checkbox" checked={s.noTotems} onChange={() => go({ noTotems: !s.noTotems })} />
            No Geraldo
          </label>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────── target

function TargetPanel(p: { s: ParagonRoute; input: ParagonInput; res: ParagonResult; target: number; go: (p: Patch) => void }) {
  const { res, target, go } = p;
  const explicit = p.s.target !== undefined;
  const need = powerForDegree(target, p.s.boost, p.s.ver);
  const ways = res.degree < MAX_DEGREE && target > res.degree ? waysTo(p.input, need, p.s.noTotems) : [];
  const [best, ...others] = ways;
  const step = (n: number) => go({ target: Math.min(MAX_DEGREE, Math.max(2, n)) });
  let answer: ComponentChildren;
  if (res.degree >= MAX_DEGREE) {
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
          Degree {target} needs {fmtInt(need)} power. Combine several inputs{p.s.noTotems ? "" : ", or add totems"}.
        </p>
      </>
    );
  } else {
    const d = describe(best);
    answer = (
      <>
        <p class="pg-k">Quickest way</p>
        <p class="pg-ans-t">
          <b>{d.amt}</b> <span>{d.noun}</span>
        </p>
        <p class="pg-ans-s">
          {d.exact && <>{d.exact} · </>}reaches degree {target}: {fmtInt(need)} power, you have {fmtInt(res.power)}.
        </p>
        {others.length > 0 && (
          <details class="pg-fold pg-other">
            <summary>Other ways ({others.length})</summary>
            <ul>
              {others.map((w) => {
                const o = describe(w);
                return (
                  <li key={w.key}>
                    <b>{o.amt}</b> {o.noun}
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
    <section class="pg-panel pg-tg" aria-label="Target degree">
      <div class="pg-ph">
        <p class="eyebrow">Target degree</p>
        {explicit ? (
          <button type="button" class="pg-link" onClick={() => go({ target: undefined })}>
            Back to next boss breakpoint
          </button>
        ) : (
          <span class="pg-hint">next boss breakpoint</span>
        )}
      </div>
      <div class="pg-target">
        <div class="pg-tstep" role="group" aria-label="Target degree">
          <button type="button" class="pg-step" aria-label="Lower target degree" disabled={target <= 2} onClick={() => step(target - 1)}>
            −
          </button>
          <TargetInput value={target} onChange={step} />
          <button type="button" class="pg-step" aria-label="Higher target degree" disabled={target >= MAX_DEGREE} onClick={() => step(target + 1)}>
            +
          </button>
        </div>
        <div class="pg-ans">{answer}</div>
      </div>
    </section>
  );
}

// ─────────────────────────────── inputs

/** A limit as a whole percentage of the cost (the slider's 315%). */
const pct = (n: number, cost: number) => Math.round((n / cost) * 100);

function InputsPanel(p: { s: ParagonRoute; res: ParagonResult; max: Max; go: (p: Patch) => void }) {
  const { s, res, max, go } = p;
  const field = (k: InKey, id: string, label: string, hint: string, decimal = false) => (
    <NumField id={id} icon={IN_ICON[k]} label={label} hint={hint} value={s[k]} max={max[k]} decimal={decimal} onChange={(n) => go({ [k]: n })} />
  );
  // One block per power source (bucket order), its power on the right.
  const block = (key: Bucket["key"], fields: ComponentChildren) => {
    const b = res.buckets.find((x) => x.key === key)!;
    return (
      <div class={`pg-bk${b.full ? " full" : ""}`}>
        <div class="pg-bk-f">{fields}</div>
        <p class={`pg-bk-pw${b.power === 0 ? " zero" : ""}`}>
          <b>{b.full ? "MAX" : fmtInt(b.power)}</b>
          <span>power</span>
        </p>
      </div>
    );
  };
  const keys = degreeData(s.ver).maxPowerFromNonTier5Count ? IN_KEYS : IN_KEYS.filter((k) => k !== "tiers"); // v57: tiers give no power
  const empty = keys.every((k) => s[k] === 0);
  return (
    <section class="pg-panel pg-in" aria-label="Your inputs">
      <div class="pg-ph">
        <p class="eyebrow">Your inputs</p>
        <span class="pg-ph-a">
          <span class="pg-hint">type 85m · 1.2b · 40k</span>
          <button type="button" class="pg-copy" disabled={empty} onClick={() => go(Object.fromEntries(keys.map((k) => [k, 0])))}>
            Reset all
          </button>
        </span>
      </div>
      {block(
        "cash",
        <>
          {field("cash", "pg-cash", "Sacrificed cash", "paid for same-type towers below tier 5", true)}
          {field("slider", "pg-slider", "Cash slider", `paid on top of the price · up to ${pct(max.slider, paragonCost(s.tower, s.diff, s.ver))}%`, true)}
        </>,
      )}
      {block(
        "pops",
        <>
          {field("pops", "pg-pops", "Pops", "damage counters of the absorbed towers", true)}
          {field("income", "pg-income", "Income", "income counters, e.g. merchantmen", true)}
        </>,
      )}
      {res.buckets.find((x) => x.key === "tiers")!.cap !== 0 && block("tiers", field("tiers", "pg-tiers", "Upgrade tiers", "towers below tier 5 · a 2-0-3 counts 5"))}
      {block("t5", field("extraT5", "pg-t5", "Extra tier 5s", "beyond the three needed · co-op +3 per teammate"))}
      {block("totems", field("totems", "pg-totems", "Power totems", "yours and teammates' · no cap"))}
    </section>
  );
}

/** A small whole number typed directly (the target degree; the farming tool's round); arrows step it, Enter or leaving the field applies it. The caller clamps. */
export function TargetInput(p: { value: number; onChange: (n: number) => void; label?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const n = parseInt(text, 10);
    if (Number.isFinite(n) && n !== p.value) p.onChange(n);
  };
  return (
    <input
      class="pg-tin"
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      autocomplete="off"
      maxLength={3}
      aria-label={p.label ?? "Target degree"}
      value={draft ?? String(p.value)}
      onFocus={(e) => {
        const el = e.currentTarget;
        setTimeout(() => el.select(), 0);
      }}
      onInput={(e) => setDraft(e.currentTarget.value.replace(/\D/g, ""))}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          setDraft(null);
          p.onChange(p.value + (e.key === "ArrowUp" ? 1 : -1));
        }
      }}
    />
  );
}

// ─────────────────────────────── result

function ResultCard(p: { res: ParagonResult; ver: GameVer; boost: boolean; copied: boolean; copy: () => void }) {
  const { res } = p;
  const bp = res.breakpoint;
  const at = bp ? scaling(bp.degree, p.ver) : undefined;
  return (
    <div class="pg-res">
      <div class="pg-res-h">
        <p class="eyebrow">Result</p>
        <button type="button" class="pg-copy" onClick={p.copy}>
          {p.copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <dl class="pg-hero">
        <Stat k={<><FieldIcon k="ParagonDegree" size={24} />Degree</>} v={res.degree} accent note={p.boost ? `${res.base} from power + ${res.degree - res.base} Paragon Boost` : undefined} />
      </dl>
      <A href={href.paragonScaling(res.degree)} class="pg-link">
        See what degree {res.degree} gives ›
      </A>
      <dl class="pg-nums">
        <Stat k={<><FieldIcon k="ParagonPower" size={24} />Power</>} v={fmtInt(res.power)} />
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
        {res.buckets.filter((b) => b.cap !== 0).map((b) => {
          const pct = b.cap ? Math.min(100, (b.power / b.cap) * 100) : 0;
          return (
            <li key={b.key} class={b.full ? "pg-b full" : "pg-b"}>
              <div class="pg-b-h">
                <span class="pg-b-n2">
                  <FieldIcon k={BUCKET_ICON[b.key]} size={24} />
                  {BUCKET_NAME[b.key]}
                </span>
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

function ScalingFold(p: { degree: number; ver: GameVer }) {
  const rows = [...new Set([1, 20, 40, 60, 80, 100, p.degree])].sort((a, b) => a - b);
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
            {H("Attack speed", "Speed")}
            {H("Boss N", "Boss N")}
            {H("Boss E", "Boss E")}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const x = scaling(d, p.ver);
            return (
              <tr key={d} class={d === p.degree ? "on" : undefined} aria-current={d === p.degree ? "true" : undefined}>
                <th scope="row">{d}</th>
                <td>
                  +{one(x.damagePct)}%<br />+{x.damageFlat}
                </td>
                <td>
                  +{one(x.piercePct)}%<br />+{one(x.pierceFlat)}
                </td>
                <td>+{one(x.speedPct)}%</td>
                <td>{times(x.bossNormal)}</td>
                <td>{times(x.bossElite)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="pg-hint">Your degree is highlighted. Boss N / E: bonus damage to normal / elite bosses.</p>
      <A href={href.paragonScaling(p.degree)} class="pg-link">
        Full scaling analysis ›
      </A>
    </details>
  );
}

function MethodFold(p: { s: ParagonRoute; max: Max }) {
  const { s, max } = p;
  const D = degreeData(s.ver);
  const REQS = D.powerDegreeRequirements;
  const cost = paragonCost(s.tower, s.diff, s.ver);
  const unit = cost / D.moneySpentOverX;
  const pen = +(D.paidContributionPenalty * 100).toFixed(1);
  return (
    <details class="pg-fold pg-fold-big">
      <summary>How this is calculated</summary>
      <ul class="pg-how">
        <li>
          <b>Absorbed towers:</b> every tower of the paragon's type on the map, from any player, is absorbed when the paragon is built. Monkey Knowledge doesn't change the power.
        </li>
        <li>
          <b>Sacrificed cash:</b> the price actually paid (discounts included) for the absorbed towers below tier 5. 1 power per ${+unit.toFixed(2)} (this paragon's cost ÷ {fmtInt(D.moneySpentOverX)}); fills at {fmtInt(D.maxPowerFromMoneySpent)} power, {+(D.maxPowerFromMoneySpent / D.moneySpentOverX).toFixed(2)}× the cost (${fmtInt(max.cash)}), shared with the slider.
        </li>
        <li>
          <b>Cash slider:</b> paid on top of the price, up to {pct(max.slider, cost)}% of the cost (${fmtInt(max.slider)}, and only the cash you have). {pen}% less efficient than sacrificed cash, rounded up.
        </li>
        <li>
          <b>Pops:</b> damage dealt by all absorbed towers, tier 5s included (their damage counters): 1 power per {fmtInt(D.popsOverX)}. <b>Income</b> (cash generated, the income counters) counts ×{D.cashEarnedContributionModifier} as pops: ${+(D.popsOverX / D.cashEarnedContributionModifier).toFixed(2)} = 1 power. Both share one cap of {fmtInt(D.maxPowerFromPops)} power ({fmtInt(max.pops)} pops).
        </li>
        {D.maxPowerFromNonTier5Count > 0 && (
          <li>
            <b>Upgrade tiers</b> of the absorbed towers below tier 5: {fmtInt(D.nonTier5TowersMultByX)} power each; fills at {fmtInt(max.tiers)} tiers ({fmtInt(D.maxPowerFromNonTier5Count)} power).
          </li>
        )}
        <li>
          <b>Extra tier 5s</b> beyond the three lowest-investment ones the paragon is built from: {fmtInt(D.tier5TowersMultByX)} power each; fills at {fmtInt(max.extraT5)} ({fmtInt(D.maxPowerFromTier5Count)} power).
        </li>
        <li>
          <b>Power totems:</b> {fmtInt(REF.totemPower)} power each, no cap; teammates' totems count too (read from the game's code).
        </li>
        <li>
          <b>Paragon Boost:</b> +{REF.boostDegrees} degrees on the game's first paragon, added after the power (degree 100 at most).
        </li>
        <li>
          <b>Cost by difficulty:</b> {PG_DIFFS.map((d) => `${d[0].toUpperCase()}${d.slice(1)} $${fmtInt(paragonCost(s.tower, d, s.ver))}`).join(" · ")}. The game's cost mods: Easy ×0.85, Hard ×1.08, Impoppable is Hard then ×1.111; rounded to ${REF.costRounding}.
        </li>
        <li>
          <b>Degree:</b> the highest degree whose power requirement you meet: degree 2 at {fmtInt(REQS[1])}, degree 100 at {fmtInt(REQS[99])}. Boss damage grows {+(D.bonusBossDamagePercent * 100).toFixed(0)}% every {D.bonusBossDamagePerDegrees} degrees; elites take double.
        </li>
      </ul>
    </details>
  );
}
