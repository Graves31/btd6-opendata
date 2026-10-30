# Farming optimizer (boss events): P0 feasibility

Goal: for a boss event, find the farming build order that reaches cash fastest (or has the most cash at a boss
tier), under every rule that changes the economy. A real optimizer: a mixed-integer linear program (MILP,
matrices `A x ≤ b`) solved in the browser, with an exact simulator of the game's economy to check its answer.

**Verdict: feasible.** Every economy rule found in the v57 game code is linear, or linear once a few 0/1 variables
are added (caps, buffs that are on or off, the IMF loan). The hard part is the data, not the maths: almost every
number is model data, which the Mod Helper export provides (see Data). The game's fights are not simulated: the
player's defence is an input (cash that must be spent by given rounds).

Rules from the game code, with files and methods: `docs/economy/round-cash.md` (cash flow, pop cash, income sets,
end-of-round cash, costs, discounts, selling, mode mods), `docs/economy/farms.md` (bananas, banks, deposits,
IMF, Monkey Banker, farm buffs, Overclock), `docs/economy/other.md` (villages, buccaneers, discount zones,
heroes, Monkey Knowledge, powers). All numbers there are field names; values come from the export.

## Stack

All in the browser, nothing on the Worker (10 ms CPU) and no NK requests. `scripts/build_economy.py` turns the
export into `web/src/data/economy.json` (committed, rerun per patch). `web/src/economy.ts`: the exact simulator
(pure TS, like `bank.ts`). `web/src/farmOpt.ts`: builds the MILP and runs HiGHS (MIT, WebAssembly `highs` npm
package, loaded only on the tool page) in a Web Worker. Page `/tools/farming-planner`. Tests in `npm run check`;
the same TS runs from node for development.

## Data

The Mod Helper in `ModStuff` (Mods → Mod Helper settings → Export Game Data) writes the game model as JSON: tower
models with every behaviour's fields, upgrades, Monkey Knowledge, modes. "Export Selected Tower" writes one placed
tower's exact in-game model (with Monkey Knowledge and buffs applied): the check for the simulator. Needs a
MelonLoader / Mod Helper build that supports the current game version (can lag a patch by days).

## Model

Rounds `r = r0 … R` (event start round to the last tier). Purchases happen at round start, income lands by
round end (finer steps inside a round are possible later: packets are evenly spaced, farms.md R2).

Configurations `k`: one per tower and crosspath that earns, discounts or buffs (farm 2-0-0, village 0-0-2, …),
minus banned ones; discounted variants `k^d` when a purchase can sit in a discount zone. Upgrades are edges
`k → k'` with cost `cost(k') − cost(k)` at that discount level (costs: `(1 − Σ discounts)·base`, rounded to 5,
round-cash.md §5–7, precomputed per difficulty, mode and Monkey Knowledge).

Variables per round (integers unless noted): `n[k,r]` towers held, `buy[k,r]`, `up[k→k',r]`, `sell[k,r]`;
`c[r] ≥ 0` cash (continuous); bank balance `B[j,r]` and collect `col[j,r]` (continuous); `y[b,r] ∈ {0,1}` buff
present (Banana Central, Monkey City, …); `z[r] ∈ {0,1}` target reached.

Constraints (each row of `A`):
- Towers: `n[k,r] = n[k,r−1] + buy[k,r] + Σ up(→k) − Σ up(k→) − sell[k,r]`.
- Cash: `c[r] = c[r−1] + g[r] + Σ_k inc[k,r]·n[k,r] + Σ_j col[j,r] + Σ_k sv[k]·sell[k,r] − Σ_k cost[k]·buy[k,r]
  − Σ Δcost·up − def[r]`, `c[r] ≥ 0`. `g[r]` = pop cash of the round set (all bloons popped, income-set multiplier,
  round-cash.md §1–2) + end-of-round cash (§4). `inc[k,r]` = per-round tower cash, e.g. `(r+1)·mult + perRound`
  (other.md A1) or farm packets × value. `def[r]` = the player's defence spend.
- Banks (farms.md R3): `B[j,r] ≤ (1+i)·(B[j,r−1] + P_j·n[j,r]) − col`, `B[j,r] ≤ cap_j·n[j,r]`. `min(cap, …)` is
  concave, so `≤` rows are exact in a maximisation. Banks of a type are pooled (same collect plan for all).
- Buffs: buffed farm counts `nb[k,r] ≤ n[k,r]`, `nb[k,r] ≤ M·y[b,r]`, `y[b,r] ≤ n[buffer,r]`; additive multipliers
  stay linear (farms.md R6).
- IMF loan (farms.md R7): debt `D[r]`, forced repayment `rep[r] = min(rate·income, D)` with one 0/1 per round.
- Overclock: `oc[k,r] ≤ n[k,r]`, `Σ_k oc[k,r] ≤ n[engineer,r]`, extra income per overclocked config.
- Event rules (boss metadata): bans and per-tower max as bounds, `maxTowers` as `Σ n ≤ max`, `disableSelling` →
  `sell = 0`, `disableMK` → base costs and values, starting cash and round from the event.

Objectives:
- **Fastest to a target** (e.g. the cost of the kill build): `min Σ_r (1 − z[r])`, `z[r] ≤ z[r+1]`,
  `c[r] ≥ T − M·(1 − z[r])` (or net worth `c + Σ sv·n` when selling is allowed).
- **Most cash at a tier round `R*`**: `max c[R*]` (+ sell value if selling is allowed).

Size: ~40 configurations × ~60–100 rounds ≈ 10k integer variables, sparse, network-like. Whether HiGHS solves it
in seconds in the browser is the first thing P1 measures; fallback: LP relaxation, then rounding repaired by
the simulator.

Check: every plan the solver returns is replayed in the exact simulator (rounding, packet timing, debt skim
order). Differences larger than rounding mean the MILP misses a rule.

## Scope

In: single player; farms (all paths, banks, deposits, IMF, Monkey Banker, Overclock); villages (discounts, income,
Monkey City, Monkeyopolis); buccaneer trade line; hero effects that are model data (level per round from
heroes.json); Monkey Knowledge (mods by name, other.md G; the player's own from the OAK save); difficulty and
mode mods; event rules.

Pop-dependent income (cash-per-pop zones, Syphon, bloon-worth mutators) depends on what the defence pops: a
player-set fraction of the round's pops, off by default. Out: co-op cash sharing, powers (`disablePowers` in
events), Rogue artifacts, map area price buffs (later), cash sinks.

## Open questions (all in the rule files) and how they close

- Values, Monkey Knowledge id → mod, which tower or hero owns each behaviour: the Mod Helper game export.
- Rounding mode (round to nearest 5: banker's or half up), round indexing (0-based), whether the last packet
  lands before the round ends, the cash type / source enum numbers: in-game checks (sandbox, one per question)
  and the "Export Selected Tower" dump.

## Phases

- P0 (this): rules inventory, formulation, verdict. Done.
- P1: export → `build_economy.py`/`economy.json`; exact simulator + tests against the owner's in-game checks; a
  HiGHS benchmark on a full-size model.
- P2: MILP builder + objectives + event prefill; the simulator replays each answer.
- P3: page (product / UI / end-user review first).
