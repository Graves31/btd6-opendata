// Paragon calculator maths: thresholds, caps, slider penalty, totems, next/breakpoint, waysTo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluate, inputMax, paragonCost, PARAGON_TOWERS, powerForDegree, REF, scaling, waysTo, type ParagonInput } from "../web/src/paragon.ts";

const json = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/data/paragons.json"), "utf8"));
const D = json.degreeData;
const reqs: number[] = D.powerDegreeRequirements;
const tower = PARAGON_TOWERS[0];
const zero: ParagonInput = { tower, diff: "medium", coop: false, cash: 0, slider: 0, pops: 0, income: 0, tiers: 0, extraT5: 0, totems: 0, boost: false };
const bucket = (r: ReturnType<typeof evaluate>, k: string) => r.buckets.find((b) => b.key === k)!;
// Totems giving at least this much power (totem power is not in the data, so derive from REF).
const totemsFor = (p: number) => Math.ceil(p / REF.totemPower);

describe("paragon maths", () => {
  it("cost medium equals the data", () => {
    for (const t of PARAGON_TOWERS) assert.equal(paragonCost(t, "medium"), json.paragons[t].cost);
  });
  it("Impoppable price matches the game (checked in game, v56.3: Apex Plasma Master $180,000)", () => {
    assert.equal(paragonCost("DartMonkey", "impoppable"), 180_000);
  });
  it("degree from exact threshold powers", () => {
    for (const d of [1, 2, 10, 50, 100]) {
      const r = evaluate({ ...zero, totems: totemsFor(reqs[d - 1]) });
      assert.ok(r.power >= reqs[d - 1]);
      assert.ok(r.degree >= d);
    }
    // Power exactly on a threshold via pops (popsOverX per power point).
    const exact = evaluate({ ...zero, pops: reqs[9] * D.popsOverX });
    assert.equal(exact.power, reqs[9]);
    assert.equal(exact.degree, 10);
    assert.equal(evaluate({ ...zero, pops: (reqs[9] - 1) * D.popsOverX }).degree, 9);
  });
  it("caps honoured and full flags", () => {
    const r = evaluate({ ...zero, pops: 1e9, cash: 1e12, tiers: 1e6, extraT5: 1e6 });
    assert.equal(bucket(r, "pops").power, D.maxPowerFromPops);
    assert.equal(bucket(r, "cash").power, D.maxPowerFromMoneySpent);
    assert.equal(bucket(r, "tiers").power, D.maxPowerFromNonTier5Count);
    assert.equal(bucket(r, "t5").power, D.maxPowerFromTier5Count);
    assert.ok(r.buckets.filter((b) => b.key !== "totems").every((b) => b.full));
    assert.equal(bucket(evaluate(zero), "pops").full, false);
  });
  it("slider is less efficient than cash by the penalty, rounded up", () => {
    const cash = 1e6;
    const a = bucket(evaluate({ ...zero, cash }), "cash").raw;
    const b = bucket(evaluate({ ...zero, slider: cash }), "cash").raw;
    assert.equal(b, Math.ceil(a / (1 + D.paidContributionPenalty)));
  });
  it("totems are uncapped", () => {
    const r = evaluate({ ...zero, totems: 1000 });
    assert.equal(bucket(r, "totems").power, 1000 * REF.totemPower);
    assert.equal(bucket(r, "totems").cap, null);
    assert.equal(bucket(r, "totems").full, false);
  });
  it("degree 100 has no next; breakpoint gap", () => {
    assert.equal(evaluate({ ...zero, totems: totemsFor(reqs[99]) }).next, null);
    const r = evaluate({ ...zero, pops: reqs[1] * D.popsOverX });
    assert.equal(r.degree, 2);
    assert.equal(r.next!.gap, reqs[2] - r.power);
    assert.equal(r.breakpoint!.degree, D.bonusBossDamagePerDegrees);
    assert.equal(r.breakpoint!.gap, reqs[D.bonusBossDamagePerDegrees - 1] - r.power);
    assert.deepEqual(r.boss, { normal: 1, elite: 2 });
  });
  it("scaling from data", () => {
    const s = scaling(21);
    assert.equal(s.damagePct, D.damagePercentPerDegree * 20);
    assert.equal(s.bossNormal, 1 + D.bonusBossDamagePercent);
  });
  it("waysTo skips full buckets and each way reaches the target", () => {
    const i: ParagonInput = { ...zero, pops: D.maxPowerFromPops * D.popsOverX * 2, cash: 1000, tiers: 5 };
    const target = reqs[99];
    const ways = waysTo(i, target);
    assert.ok(ways.length > 0);
    for (const w of ways) {
      assert.notEqual(w.key, "pops");
      const f = { ...i };
      if (w.key === "cash") f.cash += w.add;
      else if (w.key === "tiers") f.tiers += w.add;
      else if (w.key === "t5") f.extraT5 += w.add;
      else if (w.key === "totems") f.totems += w.add;
      assert.ok(evaluate(f).power >= target, w.key);
    }
    const low = waysTo(zero, reqs[40]);
    assert.ok(low.some((w) => w.key === "totems"));
    assert.ok(!waysTo(zero, reqs[40], true).some((w) => w.key === "totems"));
    assert.equal(low.some((w) => w.key === "tiers"), reqs[40] <= D.maxPowerFromNonTier5Count);
  });
  it("Paragon Boost adds its degrees after the power, capped at 100", () => {
    const b = REF.boostDegrees;
    const r = evaluate({ ...zero, boost: true });
    assert.equal(r.base, 1);
    assert.equal(r.degree, 1 + b);
    // The next final degree needs the next base degree.
    assert.deepEqual(r.next, { degree: 2 + b, power: reqs[1], gap: reqs[1] });
    const top = evaluate({ ...zero, boost: true, totems: totemsFor(reqs[99 - b]) });
    assert.equal(top.degree, 100);
    assert.equal(top.next, null);
    assert.equal(top.breakpoint, null);
    assert.equal(evaluate({ ...zero, boost: true, totems: totemsFor(reqs[98 - b]) }).next!.degree, 100);
    assert.equal(evaluate({ ...zero, boost: true, totems: totemsFor(reqs[99]) }).degree, 100);
    // Breakpoint in final degrees; its gap is the power of (breakpoint − boost) base degrees.
    const per = D.bonusBossDamagePerDegrees;
    const bp = Math.min(100, (Math.floor((1 + b) / per) + 1) * per);
    assert.equal(r.breakpoint!.degree, bp);
    assert.equal(r.breakpoint!.gap, reqs[bp - b - 1]);
    assert.deepEqual(r.boss, { normal: 1 + D.bonusBossDamagePercent * Math.floor((1 + b) / per), elite: 2 * (1 + D.bonusBossDamagePercent * Math.floor((1 + b) / per)) });
    // Target → power: the boost's degrees come free.
    assert.equal(powerForDegree(1 + b, true), 0);
    assert.equal(powerForDegree(40, true), reqs[40 - b - 1]);
    assert.equal(powerForDegree(40, false), reqs[39]);
    const ways = waysTo({ ...zero, boost: true }, powerForDegree(bp, true));
    assert.ok(ways.length > 0);
    assert.ok(evaluate({ ...zero, boost: true, totems: ways.find((w) => w.key === "totems")!.add }).degree >= bp);
  });
  it("input maxima: where each source fills", () => {
    const cost = paragonCost(tower, "medium");
    const m = inputMax(tower, "medium");
    assert.equal(m.cash, (D.maxPowerFromMoneySpent / D.moneySpentOverX) * cost);
    assert.equal(m.slider, Math.ceil(+(m.cash * (1 + D.paidContributionPenalty)).toFixed(6)));
    assert.equal(m.pops, D.maxPowerFromPops * D.popsOverX);
    assert.equal(m.income * D.cashEarnedContributionModifier, m.pops);
    assert.equal(bucket(evaluate({ ...zero, cash: m.cash }), "cash").full, true);
    assert.equal(bucket(evaluate({ ...zero, slider: m.slider }), "cash").full, true);
    assert.equal(bucket(evaluate({ ...zero, income: m.income }), "pops").full, true);
    assert.equal(bucket(evaluate({ ...zero, tiers: m.tiers }), "tiers").full, true);
    assert.equal(bucket(evaluate({ ...zero, tiers: m.tiers - 1 }), "tiers").full, false);
    assert.equal(bucket(evaluate({ ...zero, extraT5: m.extraT5 }), "t5").full, true);
    assert.equal(bucket(evaluate({ ...zero, extraT5: m.extraT5 - 1 }), "t5").full, false);
    assert.equal(evaluate({ ...zero, totems: m.totems }).degree, 100);
    assert.ok(evaluate({ ...zero, totems: m.totems - 1 }).degree < 100);
  });
});
