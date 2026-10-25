// Bank & IMF Loan planner maths (Tools → /tools/bank-planner). Pure functions, no DOM.
//
// Per round (game code v57.1, Simulation/Towers/Behaviors/Bank): each banana packet adds to the balance (clamped
// to the capacity) and to the interest base; at round end balance = min(cap, balance + 15% × base), then
// base = balance. Without deposits: B = min(cap, 1.15 × (B + P)), so interest includes that round's bananas.
// A manual deposit (MK Bank Deposits, tier 4+) adds to the balance but not to the base: it earns from the
// second round end on. Deposit button: trunc(half the remaining capacity), or all your cash if you have less.

/**
 * Sources. GAME = v57.1 sim data/code; WIKI = bloonswiki (pages stamped 43.1–54.3, no mismatch with the data).
 * interest, cap, packet value: GAME (BankModel, CashModel; the +25% Valuable Bananas is baked into the packet).
 * base = packets/round × packet value: counts 4/6/8 WIKI. overclock = packets/round under Overclock: WIKI.
 * biggerBanks, mvb (More Valuable Bananas +25% → +30%), ben (Bank Hack lv5 / lv9), city (Monkey City),
 * depositShare: WIKI. The income buffs add to one multiplier and none touches the interest.
 */
export const BANK = {
  interest: 0.15,
  cap: { 3: 7000, 4: 10000, 5: 10000 } as Record<Tier, number>,
  biggerBanks: 2500,
  base: [180, 220, 260],
  packets: [4, 6, 8],
  overclock: [7, 10, 14],
  valuable: 0.25,
  mvb: 0.05,
  ben: { 0: 0, 5: 0.05, 9: 0.12 } as Record<Ben, number>,
  city: 0.2,
  depositShare: 0.5,
};

export type Tier = 3 | 4 | 5;
export type Path = 0 | 1 | 2;
export type Ben = 0 | 5 | 9;
export type BankInput = { tier: Tier; path: Path; bb: boolean; mvb: boolean; ben: Ben; city: boolean; oc: boolean; half: boolean };

const G = 1 + BANK.interest;

/** Cash the bank's bananas add per round. */
export function income(i: BankInput): number {
  const mult = 1 + BANK.valuable + (i.mvb ? BANK.mvb : 0) + BANK.ben[i.ben] + (i.city ? BANK.city : 0);
  let v = BANK.base[i.path] * mult;
  if (i.oc) v *= BANK.overclock[i.path] / BANK.packets[i.path]; // ponytail: assumes Overclock keeps the packet value (wiki doesn't say)
  return i.half ? v / 2 : v;
}

export const capacity = (i: BankInput) => BANK.cap[i.tier] + (i.bb ? BANK.biggerBanks : 0);

/** One round: bananas in, interest on (balance + bananas). raw = the balance without the cap. */
export function step(b: number, P: number, cap: number) {
  const raw = G * (b + P);
  return { b: Math.min(cap, raw), raw };
}

/** Balance of an empty bank after k rounds. */
export function fresh(k: number, P: number, cap: number): number {
  let b = 0;
  for (let i = 0; i < k; i++) b = step(b, P, cap).b;
  return b;
}

/** Highest round the planner takes. */
export const MAX_ROUND = 999;

/** Rounds until a bank holding `b0` is full (at most 300). */
export function roundsToFill(b0: number, P: number, cap: number): number {
  let b = b0;
  let k = 0;
  while (b < cap && k < 300) [b, k] = [step(b, P, cap).b, k + 1];
  return k;
}

/**
 * A bank holding `b0` that fills by itself after k rounds: `lost` = what goes over the cap that round, `over` =
 * how much of b0 is too much (b0 − over fills it exactly). The balance grows uncapped until then, so lost = over × 1.15^k.
 */
export function overfill(b0: number, P: number, cap: number) {
  const k = roundsToFill(b0, P, cap);
  let raw = b0;
  for (let i = 0; i < k; i++) raw = step(raw, P, Infinity).raw;
  const lost = Math.max(0, raw - cap);
  return { k, lost, over: lost / G ** k };
}

/** Best repeating cycle from an empty bank: the length k that earns the most per round. */
export function bestCycle(P: number, cap: number) {
  let b = 0;
  let best = { k: 1, v: 0, avg: 0 };
  for (let k = 1; k <= 300; k++) {
    b = step(b, P, cap).b;
    if (b / k > best.avg) best = { k, v: b, avg: b / k };
    if (b >= cap) break;
  }
  return best;
}

export type Row = { r: number; b: number; raw: number; add: number; dep?: number };
export type Cycle = { r: number; k: number; v: number; last?: boolean };

/**
 * When to collect a bank that has `b0` before round `start`. Collect after the round n that maximises
 * balance + what an empty bank makes afterwards: forever = −n × the best cycle's cash per round; with a last
 * round `end`, G[j] = most cash an empty bank can make in j rounds (exact, by DP). hit = −1: collect now.
 * rows run two rounds past the collect, to show what waiting would lose.
 */
export function collectPlan(start: number, b0: number, P: number, cap: number, end = 0) {
  const best = bestCycle(P, cap);
  const m = end >= start ? end - start + 1 : 0;
  const Gm = [0];
  const ch = [0];
  if (m) {
    const V = [0];
    for (let k = 1; k <= m; k++) V.push(step(V[k - 1], P, cap).b);
    for (let j = 1; j <= m; j++) {
      Gm[j] = -1;
      for (let k = 1; k <= j; k++) if (V[k] + Gm[j - k] > Gm[j] + 1e-6) [Gm[j], ch[j]] = [V[k] + Gm[j - k], k];
    }
  }
  const future = (n: number) => (m ? Gm[m - n] : -n * best.avg);
  const rows: Row[] = [];
  let b = b0;
  let hit = -1;
  let top = b0 > 0 ? b0 + future(0) : -Infinity;
  for (let n = 1; n <= 300; n++) {
    const s = step(b, P, cap);
    rows.push({ r: start + n - 1, b: s.b, raw: s.raw, add: s.b - b });
    b = s.b;
    if ((!m || n <= m) && s.b + future(n) > top + 1e-6) [top, hit] = [s.b + future(n), n - 1];
    if ((b >= cap || (m && n >= m)) && n >= hit + 3) break;
  }
  rows.length = Math.min(rows.length, hit + 3);
  const cycles: Cycle[] = [];
  let at = start + hit;
  if (m) {
    for (let j = m - (hit + 1); j > 0 && cycles.length < 5; j -= ch[j]) {
      at += ch[j];
      cycles.push({ r: at, k: ch[j], v: fresh(ch[j], P, cap), last: j === ch[j] });
    }
  } else {
    for (let i = 0; i < 5; i++) cycles.push({ r: (at += best.k), k: best.k, v: best.v });
  }
  return { rows, hit, best, cycles };
}

/**
 * Deposit before round `start` (balance b0) so the bank is exactly full after round start + k, k ≥ 1 (the
 * deposit must earn interest at least once). B_start = 1.15(b0 + P) + D, then k plain rounds:
 * D_k = (cap − P × (1.15 + … + 1.15^k)) / 1.15^k − 1.15(b0 + P). Rounded down to whole dollars (the game's
 * deposits are whole dollars), so the bank ends a dollar or so under the cap. Rungs where the bank fills
 * by itself (D ≤ 0) are left out. gain = what you collect minus the deposit, over k + 1 rounds.
 */
export function depositLadder(start: number, b0: number, P: number, cap: number, max = 6) {
  const rungs: { k: number; r: number; deposit: number; out: number; gain: number; perRound: number }[] = [];
  let pk = 1;
  let S = 0;
  for (let k = 1; k <= 40 && rungs.length < max; k++) {
    pk *= G;
    S += pk;
    const D = Math.floor((cap - P * S) / pk - G * (b0 + P));
    if (D <= 0) break;
    const out = depositRows(start, b0, D, P, cap, k + 1)[k].b;
    rungs.push({ k, r: start + k, deposit: D, out, gain: out - b0 - D, perRound: (out - b0 - D) / (k + 1) });
  }
  return rungs;
}

/** Balance per round with deposit D placed before round `start` (it skips the first round's interest). */
export function depositRows(start: number, b0: number, D: number, P: number, cap: number, n: number): Row[] {
  const raw = G * (b0 + P) + D;
  const rows: Row[] = [{ r: start, b: Math.min(cap, raw), raw, add: Math.min(cap, raw) - b0, dep: D }];
  for (let i = 1; i < n; i++) {
    const prev = rows[i - 1].b;
    const s = step(prev, P, cap);
    rows.push({ r: start + i, b: s.b, raw: s.raw, add: s.b - prev });
  }
  return rows;
}

/**
 * How to put exactly D in with the Deposit button: whole clicks (each = trunc(half the remaining capacity)),
 * then one click holding only `rest` cash (with less cash than half the room, a click deposits all of it).
 */
export function depositClicks(balance: number, D: number, cap: number) {
  const full: number[] = [];
  let sum = 0;
  for (let cash = balance; full.length < 20; ) {
    const c = Math.trunc((cap - cash) * BANK.depositShare) || cap - cash;
    if (c <= 0 || sum + c > D) break;
    full.push(c);
    sum += c;
    cash += c;
  }
  return { full, rest: D - sum };
}

/**
 * Plenty of cash: the Deposit button only puts in set chunks (half the room left per click). For 0..max clicks
 * before round `start`, the round to collect that makes the most per round held:
 * (collected − b0 − deposit) / rounds. rounds = n: deposit before round start, collect before round start + n.
 */
export function clickOptions(start: number, b0: number, P: number, cap: number, max = 4) {
  const out: { clicks: number; deposit: number; r: number; rounds: number; out: number; lost: number; gain: number; perRound: number }[] = [];
  let D = 0;
  for (let c = 0; c <= max; c++) {
    if (c > 0) {
      const d = Math.trunc((cap - b0 - D) * BANK.depositShare) || cap - b0 - D;
      if (d <= 0) break;
      D += d;
    }
    const rows = depositRows(start, b0, D, P, cap, 120);
    let n = 1;
    for (let i = 1; i <= rows.length; i++) {
      if ((rows[i - 1].b - b0 - D) / i > (rows[n - 1].b - b0 - D) / n + 1e-9) n = i;
      if (rows[i - 1].b >= cap) break; // a full bank only loses per round from here
    }
    const x = rows[n - 1];
    out.push({ clicks: c, deposit: D, r: x.r, rounds: n, out: x.b, lost: Math.max(0, x.raw - cap), gain: x.b - b0 - D, perRound: (x.b - b0 - D) / n });
  }
  return out;
}
