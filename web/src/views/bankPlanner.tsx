// Tools → Bank & IMF Loan planner (/tools/bank-planner): when to collect a Monkey Bank, and how much to deposit in
// an IMF Loan. All maths lives in ../bank.ts; this is the view. The URL is the state (routes.ts BankRoute).

import { useState } from "preact/hooks";
import benjaminArt from "../art/tools/benjamin.webp";
import farm030 from "../art/tools/farm030.webp";
import farm040 from "../art/tools/farm040.webp";
import farm050 from "../art/tools/farm050.webp";
import halfCashArt from "../art/tools/halfCash.webp";
import heroArt from "../art/tools/bank.webp";
import mkBankDeposits from "../art/tools/mkBankDeposits.webp";
import mkBiggerBanks from "../art/tools/mkBiggerBanks.webp";
import mkMoreValuableBananas from "../art/tools/mkMoreValuableBananas.webp";
import monkeyCityArt from "../art/tools/monkeyCity.webp";
import overclockArt from "../art/tools/overclock.webp";
import {
  BANK,
  bestCycle,
  clickOptions,
  collectPlan,
  depositClicks,
  depositLadder,
  depositRows,
  income,
  capacity,
  step,
  type BankInput,
  type Ben,
  type Path,
  type Row,
  type Tier,
} from "../bank.ts";
import { navigate } from "../nav.ts";
import { href, type BankRoute } from "../routes.ts";
import { A, ToolBack, ToolHero } from "../ui.tsx";
import { TargetInput } from "./paragon.tsx";

const money = (v: number) => "$" + Math.floor(v + 1e-6).toLocaleString("en-US");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const TIERS: { t: Tier; name: string; art: string }[] = [
  { t: 3, name: "Monkey Bank", art: farm030 },
  { t: 4, name: "IMF Loan", art: farm040 },
  { t: 5, name: "Monkey-Nomics", art: farm050 },
];
const PATHS: Path[] = [0, 1, 2];
const BENS: { b: Ben; label: string }[] = [
  { b: 0, label: "No Benjamin" },
  { b: 5, label: "Lvl 5–8" },
  { b: 9, label: "Lvl 9+" },
];

/** A whole-number box that may be empty (no value). Commits on blur / Enter, like TargetInput. */
function NumField(p: {
  value?: number;
  onChange: (n: number | undefined) => void;
  label: string;
  max: number;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const n = text ? Math.min(p.max, parseInt(text, 10)) : undefined;
    if (n !== p.value) p.onChange(n);
  };
  return (
    <input
      class="pg-tin bk-num"
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      autocomplete="off"
      maxLength={String(p.max).length}
      aria-label={p.label}
      placeholder={p.placeholder}
      value={draft ?? (p.value === undefined ? "" : String(p.value))}
      onFocus={(e) => {
        const el = e.currentTarget;
        setTimeout(() => el.select(), 0);
      }}
      onInput={(e) => setDraft(e.currentTarget.value.replace(/\D/g, ""))}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/**
 * Balance per round as bars: balance (blue), collect round (yellow), later rounds dimmed, overshoot hatched, your
 * deposit as a bottom segment. Each bar shows its amount (on crowded phones only the collect bar);
 * tapping a bar reads it out above the chart (default: the collect round).
 */
function Strip(p: {
  rows: Row[];
  cap: number;
  hit: number;
  dep?: number;
  legend?: boolean;
}) {
  const { rows, cap, hit, dep } = p;
  const [pick, setPick] = useState<number | undefined>(undefined);
  const top = Math.max(cap, ...rows.map((x) => x.raw)) * 1.04;
  const every = rows.length > 24 ? 3 : rows.length > 14 ? 2 : 1;
  const h = rows[hit];
  const si = pick !== undefined && pick < rows.length ? pick : hit;
  const s = rows[si];
  const lost = (x: Row) => Math.max(0, x.raw - cap);
  const pos = (v: number) => `calc(${(v / top) * 100}% + 3px)`;
  const crowd = rows.length > 16 ? " many" : rows.length > 6 ? " mid" : "";
  return (
    <>
      <p class="bk-read" aria-live="polite">
        <b>Before round {s.r + 1}</b>: {money(s.b)} in the bank
        {dep !== undefined && si === 0 && (
          <> (your {money(dep)} deposit included)</>
        )}
        , +{money(s.add)} during round {s.r}
        {lost(s) > 0 && (
          <span class="loss">, {money(lost(s))} lost to the cap</span>
        )}
        {si === hit ? (
          <strong> · collect now</strong>
        ) : si > hit ? (
          <> · if you wait</>
        ) : (
          ""
        )}
      </p>
      <div
        class={`bk-strip${crowd}`}
        role="group"
        aria-label={`Bank balance before rounds ${rows[0].r + 1} to ${rows[rows.length - 1].r + 1}; collect before round ${h.r + 1}: ${money(h.b)}.`}
      >
        <div
          class="bk-capline"
          style={{ bottom: `calc((100% - var(--bk-pad)) * ${cap / top})` }}
        >
          <span>cap {money(cap)}</span>
        </div>
        {rows.map((x, i) => (
          <button
            type="button"
            class={`bk-bc${i === si ? " sel" : ""}`}
            key={x.r}
            aria-label={`Round ${x.r}: ${money(x.b)}`}
            aria-pressed={i === si}
            onClick={() => setPick(i)}
          >
            {i === hit ? (
              <span class="bk-flag" style={{ bottom: pos(x.raw) }}>
                Collect
                <b>{money(x.b)}</b>
              </span>
            ) : i > hit ? (
              lost(x) > 0 && (
                <span class="bk-v loss" style={{ bottom: pos(x.raw) }}>
                  −{money(lost(x))}
                </span>
              )
            ) : (
              <span class="bk-v" style={{ bottom: pos(x.raw) }}>
                {money(x.b)}
              </span>
            )}
            {x.raw > cap && (
              <div
                class="bk-ov"
                style={{ height: `${((x.raw - cap) / top) * 100}%` }}
              />
            )}
            <div
              class={`bk-b${i === hit ? " col" : i > hit ? " dim" : ""}`}
              style={{ height: `${(x.b / top) * 100}%` }}
            >
              {dep !== undefined && i <= hit && (
                <i
                  class="bk-dep"
                  style={{ height: `${Math.min(100, (dep / x.b) * 100)}%` }}
                >
                  {i === 0 && <span>{money(dep)}</span>}
                </i>
              )}
            </div>
          </button>
        ))}
      </div>
      <div class="bk-xs" aria-hidden="true">
        {rows.map((x, i) => (
          <span key={x.r} class={i === hit ? "on" : ""}>
            {i === hit ||
            (i % every === 0 && (every === 1 || Math.abs(i - hit) > 1))
              ? x.r + 1
              : ""}
          </span>
        ))}
      </div>
      <div class="bk-legend" aria-hidden="true">
        <span>
          <i style={{ background: "var(--rv-b)" }} />
          Balance
        </span>
        {dep !== undefined && (
          <span>
            <i style={{ background: "var(--rv-m)" }} />
            Your deposit
          </span>
        )}
        <span>
          <i style={{ background: "var(--accent)" }} />
          Collect
        </span>
        <span>
          <i class="bk-ov" />
          Lost to the cap if you wait
        </span>
        <span>
          <i
            style={{
              borderTop: "2px dashed var(--ink-3)",
              height: 0,
              width: 16,
              verticalAlign: 3,
            }}
          />
          Capacity
        </span>
      </div>
    </>
  );
}

function Check(p: {
  on: boolean;
  set: (v: boolean) => void;
  art: string;
  name: string;
  sub: string;
  tag?: string;
}) {
  return (
    <label class="bk-check">
      <input
        type="checkbox"
        checked={p.on}
        onChange={(e) => p.set(e.currentTarget.checked)}
      />
      <img src={p.art} width={32} height={32} alt="" decoding="async" />
      <span>
        <b>{p.name}</b>
        <small>{p.sub}</small>
      </span>
      {p.tag && <span class="bk-tag">{p.tag}</span>}
    </label>
  );
}

function Collect(p: { r: BankRoute; P: number; cap: number }) {
  const { r, P, cap } = p;
  const b0 = r.b === undefined ? 0 : Math.min(r.b, cap);
  const end = r.end ?? 0;
  const pl = collectPlan(r.r, b0, P, cap, end);
  if (pl.hit < 0) {
    return (
      <section
        class="pg-panel bk-hot"
        aria-labelledby="bk-ans"
        aria-live="polite"
      >
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-ans">
            When to collect
          </h2>
        </div>
        <div class="bk-ans">
          <div class="bk-big">
            <span class="k">Collect</span>
            <span class="v">Now</span>
            <span class="c">{money(b0)}</span>
          </div>
          <div class="bk-ans-t">
            <p>
              {b0 >= cap
                ? "The bank is full. A full bank earns nothing until you collect."
                : "It is this close to the cap: collecting now and restarting earns more than waiting."}
            </p>
          </div>
        </div>
      </section>
    );
  }
  const rows = pl.rows;
  const h = rows[pl.hit];
  /** Cash the bank made per round you kept it, if you collect after rows[i]. */
  const perRound = (i: number) => (rows[i].b - b0) / (i + 1);
  const nx = step(h.b, P, cap);
  const bc = pl.best;
  return (
    <>
      <section
        class="pg-panel bk-hot"
        aria-labelledby="bk-ans"
        aria-live="polite"
      >
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-ans">
            When to collect
          </h2>
          <span class="pg-hint">
            {r.path}-{r.tier}-0 · {money(P)} a round · cap {money(cap)}
          </span>
        </div>
        <div class="bk-ans">
          <div class="bk-big">
            <span class="k">Collect before round</span>
            <span class="v">{h.r + 1}</span>
            <span class="c">{money(h.b)}</span>
          </div>
          <div class="bk-ans-t">
            <p>
              When the round counter shows <strong>{h.r + 1}</strong>, collect
              before you press Play: {pl.hit + 1} round{pl.hit ? "s" : ""}{" "}
              {b0 > 0 ? "from now" : "after buying it"}.
            </p>
            {end && h.r === end && h.raw <= cap ? (
              <p>
                Round {end} is your last: collect or sell the bank before the
                game ends (selling pays out the balance too).
              </p>
            ) : h.raw > cap ? (
              <>
                <p>
                  The bank fills up during round {h.r}:{" "}
                  <span class="bk-loss">
                    {money(h.raw - cap)} over the cap is lost.
                  </span>
                </p>
              </>
            ) : end ? (
              <p>
                Timed around your last round ({end}): collecting here leaves
                room for {pl.cycles.length} more fill
                {pl.cycles.length === 1 ? "" : "s"}, the most cash you can bank
                by then.
              </p>
            ) : (
              <p>
                Waiting one more round (to before round {h.r + 2}) adds only{" "}
                <strong>{money(nx.b - h.b)}</strong>
                {nx.raw > cap && (
                  <>
                    {" "}
                    and <span class="bk-loss">
                      loses {money(nx.raw - cap)}
                    </span>{" "}
                    to the cap
                  </>
                )}
                . An empty bank averages {money(bc.avg)} a round, so restarting
                wins.
              </p>
            )}
          </div>
        </div>
        <div class="bk-tw bk-cmp">
          <table>
            <caption>
              What each collect round is worth: cash out ÷ rounds held
            </caption>
            <thead>
              <tr>
                <th>Collect before</th>
                <th>You get</th>
                <th>Lost to the cap</th>
                <th>Per round</th>
              </tr>
            </thead>
            <tbody>
              {[pl.hit - 1, pl.hit, pl.hit + 1]
                .filter((i) => i >= 0 && i < rows.length)
                .map((i) => (
                  <tr key={i} class={i === pl.hit ? "hit" : ""}>
                    <td>
                      {rows[i].r + 1}
                      {i === pl.hit
                        ? " · best"
                        : i < pl.hit
                          ? " · a round early"
                          : " · a round late"}
                    </td>
                    <td>{money(rows[i].b - b0)}</td>
                    <td>
                      {rows[i].raw > cap ? money(rows[i].raw - cap) : "–"}
                    </td>
                    <td>{money(perRound(i))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="pg-panel" aria-labelledby="bk-rr">
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-rr">
            Bank balance before each round
          </h2>
          <span class="pg-hint">
            rounds {rows[0].r + 1}–{rows[rows.length - 1].r + 1}
          </span>
        </div>
        <Strip rows={rows} cap={cap} hit={pl.hit} />
        <details class="bk-tbl">
          <summary>Round by round</summary>
          <div class="bk-tw">
            <table>
              <thead>
                <tr>
                  <th>Before round</th>
                  <th>Added</th>
                  <th>Balance</th>
                  <th>Lost</th>
                  <th>Per round</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x, i) => (
                  <tr
                    key={x.r}
                    class={i === pl.hit ? "hit" : i > pl.hit ? "after" : ""}
                  >
                    <td>
                      {x.r + 1}
                      {i === pl.hit ? " · collect" : ""}
                    </td>
                    <td>+{money(x.add).slice(1)}</td>
                    <td>{money(x.b)}</td>
                    <td>{x.raw > cap ? money(x.raw - cap) : "–"}</td>
                    <td>{money(perRound(i))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section class="pg-panel" aria-labelledby="bk-cy">
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-cy">
            Collect before these rounds
          </h2>
          <span class="pg-hint">
            every {bc.k} round{bc.k > 1 ? "s" : ""} · {money(bc.v)} ·{" "}
            {money(bc.avg)} a round
          </span>
        </div>
        <div class="bk-cards">
          <div class="bk-card first">
            <div class="r">Round {h.r + 1}</div>
            <div class="m">
              first collect: <b>{money(h.b)}</b>
            </div>
          </div>
          {pl.cycles.map((c) => (
            <div class="bk-card" key={c.r}>
              <div class="r">{c.last ? "Game end" : `Round ${c.r + 1}`}</div>
              <div class="m">
                {c.last ? `last ${c.k} rounds` : `${c.k} rounds`}:{" "}
                <b>{money(c.v)}</b>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Deposit(p: {
  r: BankRoute;
  P: number;
  cap: number;
  go: (o: Partial<BankRoute>) => void;
}) {
  const { r, P, cap, go } = p;
  const b0 = Math.min(r.b ?? 0, cap);
  const end = r.end ?? 0;
  const all = depositLadder(r.r, b0, P, cap);
  const ladder = all.filter((x) => !end || x.r <= end);
  if (!ladder.length) {
    // The bank fills by itself, or the last round comes first.
    let b = b0;
    let at = r.r - 1;
    while (b < cap && at < r.r + 300) [b, at] = [step(b, P, cap).b, at + 1];
    return (
      <section
        class="pg-panel bk-hot"
        aria-labelledby="bk-ans"
        aria-live="polite"
      >
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-ans">
            How much to deposit
          </h2>
        </div>
        <p class="bk-none">
          {all.length
            ? `No deposit fits before your last round (${end}).`
            : `No deposit needed: the bank fills on its own; collect before round ${at + 1}.`}
        </p>
        <button
          type="button"
          class="bk-chip"
          onClick={() => go({ dep: false })}
        >
          Switch to Collect timing
        </button>
      </section>
    );
  }
  const k = Math.min(r.k, ladder.length);
  const sel = ladder[k - 1];
  const first = depositRows(r.r, b0, sel.deposit, P, cap, 1)[0];
  const best = ladder.reduce(
    (m, x) => (x.perRound > m.perRound ? x : m),
    ladder[0],
  );
  const { full, rest } = depositClicks(b0, sel.deposit, cap);
  const opts = clickOptions(r.r, b0, P, cap);
  const top = opts.reduce((m, x) => (x.perRound > m.perRound ? x : m), opts[0]);
  const rows = depositRows(r.r, b0, sel.deposit, P, cap, k + 3);
  // Every cycle after the first collect: an empty bank, re-deposited at the fastest rung.
  const again = depositLadder(sel.r + 1, 0, P, cap)[0];
  const N = again ? again.k + 1 : 0;
  const cycles: { r: number }[] = [];
  if (again)
    for (let at = sel.r + N; cycles.length < 5 && (!end || at <= end); at += N)
      cycles.push({ r: at });
  const clicks = (
    <>
      {full.length > 0 && (
        <>
          click Deposit {full.length === 1 ? "once" : `${full.length}×`} (
          {full.map(money).join(" + ")})
        </>
      )}
      {full.length > 0 && rest > 0 && ", then click once more"}
      {full.length === 0 && rest > 0 && "click Deposit once"}
      {rest > 0 && ` with only ${money(rest)} in hand`}.
    </>
  );
  return (
    <>
      <section
        class="pg-panel bk-hot"
        aria-labelledby="bk-ans"
        aria-live="polite"
      >
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-ans">
            How much to deposit
          </h2>
          <span class="pg-hint">
            {r.path}-{r.tier}-0 · {money(P)} a round · cap {money(cap)}
          </span>
        </div>
        <div class="bk-ans">
          <div class="bk-big">
            <span class="k">Deposit up to</span>
            <span class="v">{money(sel.deposit)}</span>
            <span class="c">
              Collect before round {sel.r + 1} · {money(sel.out)}
            </span>
          </div>
          <div class="bk-ans-t">
            <p>
              Deposit before round <strong>{r.r}</strong> and collect before
              round <strong>{sel.r + 1}</strong>: {k + 1} rounds. During round{" "}
              {r.r} the deposit earns no interest yet (only the bananas
              {b0 > 0 ? " and the balance" : ""} do), so the bank has{" "}
              <strong>{money(first.b)}</strong> before round {r.r + 1}. From
              then on it compounds and reaches the cap. A bigger deposit only
              goes over the cap.
            </p>
            <p>In game: {clicks}</p>
          </div>
        </div>
      </section>

      <section class="pg-panel" aria-labelledby="bk-lad">
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-lad">
            Deposit amounts
          </h2>
          <span class="pg-hint">a smaller deposit takes longer to fill</span>
        </div>
        <div class="bk-tw">
          <table class="bk-ladder">
            <thead>
              <tr>
                <th>Collect before</th>
                <th>Deposit</th>
                <th class="bk-out">Collect</th>
                <th>Gain</th>
                <th>Gain per round</th>
              </tr>
            </thead>
            <tbody>
              {ladder.map((x) => (
                <tr
                  key={x.k}
                  class={x.k === k ? "hit" : ""}
                  onClick={() => go({ k: x.k })}
                >
                  <td>
                    <button
                      type="button"
                      class="bk-pick"
                      aria-pressed={x.k === k}
                      aria-label={`Deposit ${money(x.deposit)}, collect before round ${x.r + 1}`}
                    >
                      {x.r + 1}
                    </button>
                  </td>
                  <td>{money(x.deposit)}</td>
                  <td class="bk-out">{money(x.out)}</td>
                  <td>{money(x.gain)}</td>
                  <td>
                    {money(x.perRound)}
                    {x === best && <span class="bk-best">most per round</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="pg-panel" aria-labelledby="bk-clk">
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-clk">
            Plenty of cash? Count the clicks
          </h2>
          <span class="pg-hint">each click puts in half the room left</span>
        </div>
        <p class="bk-read">
          With more cash than you need, the button decides the amount. Best:{" "}
          <strong>
            {top.clicks === 0
              ? "don't deposit"
              : `${top.clicks} click${top.clicks > 1 ? "s" : ""} (${money(top.deposit)})`}
          </strong>
          , collect before round {top.r + 1}.
        </p>
        <div class="bk-tw">
          <table class="bk-ladder">
            <thead>
              <tr>
                <th>Clicks</th>
                <th>Deposit</th>
                <th>Collect before</th>
                <th class="bk-out">You get</th>
                <th class="bk-out">Lost</th>
                <th>Gain per round</th>
              </tr>
            </thead>
            <tbody>
              {opts.map((x) => (
                <tr key={x.clicks} class={x === top ? "hit" : ""}>
                  <td>{x.clicks}</td>
                  <td>{money(x.deposit)}</td>
                  <td>
                    {x.r + 1}
                    <span class="bk-sub">
                      {x.rounds} round{x.rounds > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td class="bk-out">{money(x.out)}</td>
                  <td class="bk-out">{x.lost > 0 ? money(x.lost) : "–"}</td>
                  <td>
                    {money(x.perRound)}
                    {x === top && <span class="bk-best">most per round</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="pg-panel" aria-labelledby="bk-rr">
        <div class="pg-ph">
          <h2 class="eyebrow" id="bk-rr">
            Bank balance before each round
          </h2>
          <span class="pg-hint">
            rounds {rows[0].r + 1}–{rows[rows.length - 1].r + 1}
          </span>
        </div>
        <Strip rows={rows} cap={cap} hit={k} dep={sel.deposit} />
      </section>

      {again && (
        <section class="pg-panel" aria-labelledby="bk-cy">
          <div class="pg-ph">
            <h2 class="eyebrow" id="bk-cy">
              Collect before these rounds
            </h2>
            <span class="pg-hint">
              every {N} rounds: collect, then deposit {money(again.deposit)}{" "}
              again
            </span>
          </div>
          <div class="bk-cards">
            <div class="bk-card first">
              <div class="r">Round {sel.r + 1}</div>
              <div class="m">
                first collect: <b>{money(sel.out)}</b>
              </div>
            </div>
            {cycles.map((c) => (
              <div class="bk-card" key={c.r}>
                <div class="r">Round {c.r + 1}</div>
                <div class="m">
                  {N} rounds: <b>{money(again.out)}</b>
                </div>
              </div>
            ))}
          </div>
          <p class="bk-cmp">
            Without deposits this bank averages{" "}
            <strong>{money(bestCycle(P, cap).avg)}</strong> a round; depositing{" "}
            <strong>{money(again.deposit)}</strong> every {N} rounds makes{" "}
            <strong>{money(again.perRound)}</strong> a round.
          </p>
        </section>
      )}
    </>
  );
}

export function BankPlannerPage(p: { r: BankRoute }) {
  const r = p.r;
  const go = (o: Partial<BankRoute>) =>
    navigate(href.bankPlanner({ ...r, ...o }), {
      replace: true,
      keepScroll: true,
    });
  /** A setup change; the deposit rung goes back to the fastest. */
  const set = (o: Partial<BankRoute>) => go({ k: 1, ...o });
  const input: BankInput = {
    tier: r.tier,
    path: r.path,
    bb: r.bb,
    mvb: r.mvb,
    ben: r.ben,
    city: r.city,
    oc: r.oc,
    half: r.half,
  };
  const P = income(input);
  const cap = capacity(input);
  const cash = r.b !== undefined || r.dep;
  const label =
    !r.dep && r.b === undefined ? "Bought before round" : "Next round to play";
  return (
    <div class="pg bk">
      <ToolBack />
      <ToolHero
        art={<img src={heroArt} width={96} height={96} alt="" />}
        title="Bank & IMF Loan planner"
        sub="When to collect a Monkey Bank, and how much to deposit in an IMF Loan."
      >
        {[
          { art: farm030, alt: "Monkey Bank 0-3-0" },
          { art: farm040, alt: "IMF Loan 0-4-0" },
          { art: farm050, alt: "Monkey-Nomics 0-5-0" },
          { art: benjaminArt, alt: "Benjamin" },
        ].map((x) => (
          <span key={x.alt} class="th-ic">
            <img
              src={x.art}
              width={44}
              height={44}
              alt={x.alt}
              decoding="async"
            />
          </span>
        ))}
      </ToolHero>

      <div class="tabs bk-mode" role="group" aria-label="Mode">
        <button
          type="button"
          class={`tab${r.dep ? "" : " on"}`}
          aria-pressed={!r.dep}
          onClick={() => set({ dep: false })}
        >
          Collect timing
        </button>
        <button
          type="button"
          class={`tab${r.dep ? " on" : ""}`}
          aria-pressed={r.dep}
          onClick={() => set({ dep: true, tier: Math.max(4, r.tier) as Tier })}
        >
          Deposit planner
        </button>
      </div>

      <div class="bk-grid">
        <div class="bk-side">
          <section class="pg-panel" aria-labelledby="bk-setup">
            <div class="pg-ph">
              <h2 class="eyebrow" id="bk-setup">
                Your bank
              </h2>
              <span class="pg-hint">Game v57.1</span>
            </div>

            <div class="bk-field">
              <span class="bk-lab">Tier</span>
              <div class="bk-tiles" role="group" aria-label="Tier">
                {TIERS.filter((t) => !r.dep || t.t > 3).map((t) => (
                  <button
                    key={t.t}
                    type="button"
                    class="bk-tile"
                    aria-pressed={r.tier === t.t}
                    onClick={() => set({ tier: t.t })}
                  >
                    <img
                      src={t.art}
                      width={56}
                      height={56}
                      alt=""
                      decoding="async"
                    />
                    <span>{t.name}</span>
                    <small>
                      cap {money(capacity({ ...input, tier: t.t }))}
                    </small>
                  </button>
                ))}
              </div>
            </div>
            <div class="bk-field">
              <span class="bk-lab">Top path</span>
              <div class="bk-seg" role="group" aria-label="Top path">
                {PATHS.map((x) => (
                  <button
                    key={x}
                    type="button"
                    class="bk-chip"
                    aria-pressed={r.path === x}
                    onClick={() => set({ path: x })}
                  >
                    <span class="bk-path">
                      {x}-{r.tier}-0
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div class="bk-field">
              {!r.dep && <span class="bk-lab">Start</span>}
              {!r.dep && (
                <div class="bk-seg" role="group" aria-label="Start">
                  <button
                    type="button"
                    class="bk-chip"
                    aria-pressed={r.b === undefined}
                    onClick={() => set({ b: undefined })}
                  >
                    Just bought
                  </button>
                  <button
                    type="button"
                    class="bk-chip"
                    aria-pressed={r.b !== undefined}
                    onClick={() => set({ b: r.b ?? Math.floor(cap / 2) })}
                  >
                    Already has cash
                  </button>
                </div>
              )}
              <div class="bk-row2">
                <div>
                  <span class="bk-lab" id="bk-round-lab">
                    {label}
                  </span>
                  <div
                    class="pg-tstep"
                    role="group"
                    aria-labelledby="bk-round-lab"
                  >
                    <button
                      type="button"
                      class="pg-step"
                      aria-label="Previous round"
                      disabled={r.r <= 1}
                      onClick={() => set({ r: r.r - 1 })}
                    >
                      −
                    </button>
                    <TargetInput
                      value={r.r}
                      label={label}
                      onChange={(n) =>
                        set({ r: Math.min(999, Math.max(1, n)) })
                      }
                    />
                    <button
                      type="button"
                      class="pg-step"
                      aria-label="Next round"
                      disabled={r.r >= 999}
                      onClick={() => set({ r: r.r + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
                {cash && (
                  <div>
                    <span class="bk-lab" id="bk-bal-lab">
                      Balance now
                    </span>
                    <NumField
                      value={r.b ?? 0}
                      label="Balance now"
                      max={cap}
                      onChange={(n) => set({ b: n ?? 0 })}
                    />
                  </div>
                )}
              </div>
              <p class="pg-hint bk-gap">
                {r.dep
                  ? "0 = just bought or just collected."
                  : r.b === undefined
                    ? `Placed before you press Play on round ${r.r}, so it gets all of that round's bananas.`
                    : `The round counter shows ${r.r}: you haven't pressed Play yet.`}
              </p>
            </div>

            <div class="bk-field">
              <span class="bk-lab">Monkey Knowledge</span>
              <div class="bk-checks">
                <Check
                  on={r.bb}
                  set={(v) => set({ bb: v })}
                  art={mkBiggerBanks}
                  name="Bigger Banks"
                  sub={`+${money(BANK.biggerBanks)} capacity`}
                />
                <Check
                  on={r.mvb}
                  set={(v) => set({ mvb: v })}
                  art={mkMoreValuableBananas}
                  name="More Valuable Bananas"
                  sub={`bank income +${pct(BANK.valuable)} → +${pct(BANK.valuable + BANK.mvb)}`}
                />
                {r.dep && (
                  <div class="bk-check bk-fixed">
                    <img
                      src={mkBankDeposits}
                      width={32}
                      height={32}
                      alt=""
                      decoding="async"
                    />
                    <span>
                      <b>Bank Deposits</b>
                      <small>needed for the Deposit button</small>
                    </span>
                  </div>
                )}
              </div>
              <p class="pg-hint bk-gap">
                Off in CHIMPS: the game ignores Monkey Knowledge there.
              </p>
            </div>

            <div class="bk-field">
              <span class="bk-lab">Benjamin (Bank Hack)</span>
              <div
                class="bk-seg"
                role="group"
                aria-label="Benjamin (Bank Hack)"
              >
                {BENS.map((x) => (
                  <button
                    key={x.b}
                    type="button"
                    class="bk-chip"
                    aria-pressed={r.ben === x.b}
                    onClick={() => set({ ben: x.b })}
                  >
                    {x.b > 0 && (
                      <img
                        src={benjaminArt}
                        width={24}
                        height={24}
                        alt=""
                        decoding="async"
                      />
                    )}
                    {x.label}
                    {x.b > 0 && <span class="bk-x">+{pct(BANK.ben[x.b])}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div class="bk-field">
              <details
                class="bk-more"
                open={
                  r.city || r.oc || r.half || r.end !== undefined || undefined
                }
              >
                <summary>More buffs and modes</summary>
                <div class="bk-checks">
                  <Check
                    on={r.city}
                    set={(v) => set({ city: v })}
                    art={monkeyCityArt}
                    name="Monkey City"
                    sub={`village 0-0-4 in range, +${pct(BANK.city)}`}
                  />
                  <Check
                    on={r.oc}
                    set={(v) => set({ oc: v })}
                    art={overclockArt}
                    name="Overclock"
                    sub="more bananas a round"
                    tag="approx."
                  />
                  <Check
                    on={r.half}
                    set={(v) => set({ half: v })}
                    art={halfCashArt}
                    name="Half Cash"
                    sub="bank income halved"
                  />
                </div>
                <div class="bk-gap">
                  <span class="bk-lab" id="bk-end-lab">
                    Last round you play
                  </span>
                  <NumField
                    value={r.end}
                    label="Last round you play"
                    max={999}
                    placeholder="—"
                    onChange={(n) => set({ end: n })}
                  />
                  <p class="pg-hint bk-gap">
                    Leave empty for boss events and endless play.
                  </p>
                </div>
              </details>
            </div>
          </section>
        </div>

        <div class="bk-col">
          {r.dep ? (
            <Deposit r={r} P={P} cap={cap} go={go} />
          ) : (
            <Collect r={r} P={P} cap={cap} />
          )}
          <div class="bk-foot">
            <p>
              Bank capacity ({money(BANK.cap[3])} Monkey Bank,{" "}
              {money(BANK.cap[4])} IMF Loan and Monkey-Nomics),{" "}
              {pct(BANK.interest)} interest and banana values come from the game
              data (v57.1). Banana counts, Monkey Knowledge, Benjamin, Monkey
              City, Overclock and Half Cash come from bloonswiki.
            </p>
            <p>
              Each round the bank adds its bananas, then pays{" "}
              {pct(BANK.interest)} at the end of the round on its balance, that
              round's bananas included. At capacity it stops and anything over
              is lost. Bottom-path upgrades change nothing here; a 0-x-2 bank
              collects by itself once full. Selling a bank pays out its balance.
            </p>
            {r.dep && (
              <p>
                Deposits need the Bank Deposits knowledge and an IMF Loan or
                Monkey-Nomics. The button puts in half the room left, or all
                your cash if you have less. Deposited cash earns interest from
                the second round end on. If you still owe an IMF loan,
                collecting likely pays part of the debt first (from the game
                code, not tested in game).
              </p>
            )}
            <p>
              <A href={href.farming()} class="pg-rlink">
                Banana spawn timing → Farming resources
              </A>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
