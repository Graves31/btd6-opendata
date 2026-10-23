// Bank & IMF Loan planner maths: per-round rule, collect timing, deposit ladder, deposit clicks.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BANK, MAX_ROUND, roundsToFill, step, capacity, collectPlan, depositClicks, depositLadder, depositRows, income, type BankInput } from "../web/src/bank.ts";

const mk: BankInput = { tier: 3, path: 1, bb: true, mvb: true, ben: 0, city: false, oc: false, half: false };
const near = (a: number, b: number, d = 0.01) => assert.ok(Math.abs(a - b) <= d, `${a} ≉ ${b}`);

describe("bank maths", () => {
  it("income per round matches the wiki (225 / 275 / 325, 234 / 286 / 338 with MK)", () => {
    const none = { ...mk, mvb: false };
    assert.deepEqual([0, 1, 2].map((p) => +income({ ...none, path: p as 0 }).toFixed(6)), [225, 275, 325]);
    assert.deepEqual([0, 1, 2].map((p) => +income({ ...mk, path: p as 0 }).toFixed(6)), [234, 286, 338]);
    near(income({ ...mk, ben: 9 }), 220 * 1.42);
  });
  it("capacity: 7,000 / 10,000, +2,500 with Bigger Banks", () => {
    assert.equal(capacity({ ...mk, bb: false }), 7000);
    assert.equal(capacity({ ...mk, tier: 4 }), 12500);
  });
  it("2-3-0 with MK makes $9,465 per 11 rounds (wiki, Monkey Bank strategy)", () => {
    const p = collectPlan(1, 0, 338, 9500);
    assert.equal(p.best.k, 11);
    near(p.best.v, 9464.57);
  });
  it("1-3-0 bought before round 30, full MK: 8,008.48 after 40, collect after 41 at the cap", () => {
    const p = collectPlan(30, 0, 286, 9500);
    near(p.rows[10].b, 8008.48);
    assert.equal(p.rows[p.hit].r, 41);
    assert.equal(p.rows[p.hit].b, 9500);
    assert.deepEqual(p.cycles.slice(0, 2).map((c) => c.r), [53, 65]);
  });
  it("collect now when the bank is (almost) full; a last round shortens the plan", () => {
    assert.equal(collectPlan(30, 9500, 286, 9500).hit, -1);
    const p = collectPlan(30, 0, 286, 9500, 36);
    assert.equal(p.rows[p.hit].r, 36);
    assert.equal(p.cycles.length, 0);
  });
  it("deposit ladder: each rung fills the bank to within a dollar after round start + k", () => {
    const P = income({ ...mk, tier: 4, path: 0, ben: 9 });
    const ladder = depositLadder(30, 0, P, 12500);
    assert.equal(ladder[0].r, 31);
    for (const g of ladder) {
      const rows = depositRows(30, 0, g.deposit, P, 12500, g.k + 1);
      assert.ok(rows[g.k].raw <= 12500 && rows[g.k].raw > 12500 - 1.15 ** g.k * 1.01, `rung ${g.k}: ${rows[g.k].raw}`);
      assert.ok(rows.every((r) => r.raw <= 12500));
    }
    // one dollar more overshoots at the target round
    const g = ladder[0];
    assert.ok(depositRows(30, 0, g.deposit + 1, P, 12500, 2)[1].raw > 12500);
  });
  it("a deposit earns no interest in its first round", () => {
    const [a] = depositRows(1, 0, 1000, 100, 12500, 1);
    near(a.b, 1.15 * 100 + 1000);
  });
  it("deposit clicks: half the room each click, the rest with only that cash in hand", () => {
    assert.deepEqual(depositClicks(0, 10000, 12500), { full: [6250, 3125], rest: 625 });
    assert.deepEqual(depositClicks(0, 6250, 12500), { full: [6250], rest: 0 });
    assert.deepEqual(depositClicks(500, 100, 12500), { full: [], rest: 100 });
  });
});

describe("deposit clicks with plenty of cash", () => {
  it("each click adds half the room left; 0 clicks = the plain bank's best cycle", async () => {
    const { clickOptions, bestCycle } = await import("../web/src/bank.ts");
    const P = income({ ...mk, tier: 4, path: 2 });
    const o = clickOptions(30, 0, P, 12500);
    assert.deepEqual(o.map((x) => x.deposit), [0, 6250, 9375, 10937, 11718]);
    near(o[0].perRound, bestCycle(P, 12500).avg);
    for (const x of o) assert.equal(x.r, 30 + x.rounds - 1);
  });
});

describe("bank constants and helpers", () => {
  it("packets per round are 4/6/8 (the farming page shows the same counts, at $20 per banana: 80/120/160)", () => {
    assert.deepEqual(BANK.packets, [4, 6, 8]);
    assert.deepEqual(BANK.packets.map((n) => n * 20), [80, 120, 160]);
  });
  it("roundsToFill counts the rounds to reach the cap, at most 300", () => {
    assert.equal(roundsToFill(10000, 100, 10000), 0);
    const k = roundsToFill(0, 225, 10000);
    let b = 0;
    for (let i = 0; i < k - 1; i++) b = step(b, 225, 10000).b;
    assert.ok(b < 10000 && step(b, 225, 10000).b >= 10000);
    assert.equal(roundsToFill(0, 0, 10000), 0 + 300);
    assert.equal(MAX_ROUND, 999);
  });
});
