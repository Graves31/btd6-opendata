// Hero XP planner maths: XP per round, level timeline vs the wiki tables, placement plan, cash to buy.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEROES, XP, plan, roundXp, shortfall, timeline, type XpInput } from "../web/src/heroXp.ts";

const base: XpInput = { hero: "Geraldo", place: 1, map: 0, edu: false, taught: false, mts: false, empowered: false, boost: 0, energizer: 0, heroes: 1 };
const allMk = { edu: true, taught: true, mts: true, empowered: true };

describe("hero XP maths", () => {
  it("XP per round: 20R+20, 40R-380 from 21, 90R-2880 from 51 (game code)", () => {
    assert.deepEqual([1, 20, 21, 50, 51, 100, 140].map(roundXp), [40, 420, 460, 1620, 1710, 6120, 9720]);
  });
  it("game data: 18 heroes, x1 curve totals 213,560 XP, Adora's level 2 costs 308, MK values", () => {
    assert.equal(Object.keys(HEROES).length, 18);
    assert.equal(HEROES.Quincy.xp.reduce((a, b) => a + b), 213560);
    assert.equal(HEROES.Adora.xp[0], 308);
    assert.deepEqual(XP.mk, { empoweredHeroesLevels: 2, monkeyEducation: 0.08, monkeysTogetherStrong: 0.05, selfTaughtHeroes: 0.1 });
  });
  // bloonswiki Hero page (Module:BTD6 hero xp): first round played at each level 2..20, placed on round 1.
  it("x1 curve, Beginner, no MK matches the wiki table", () => {
    assert.deepEqual(timeline(base).levels.slice(2), [4, 8, 13, 19, 26, 33, 41, 48, 56, 63, 68, 73, 77, 81, 85, 89, 93, 96, 99]);
  });
  it("x1 curve, Expert, all hero MK matches the wiki table", () => {
    const l = timeline({ ...base, ...allMk, map: 3 }).levels.slice(2);
    assert.deepEqual(l, [1, 1, 8, 13, 20, 26, 33, 39, 45, 52, 57, 61, 64, 68, 71, 74, 78, 80, 83]);
  });
  it("Adora (x1.71 curve) reaches level 20 on round 121", () => {
    assert.equal(timeline({ ...base, hero: "Adora" }).levels[20], 121);
  });
  it("Geraldo level 20 for round 101 (boss tier 4): place by round 38, one round later is short $1,010", () => {
    const p = plan(base, 20, 101);
    assert.equal(p.latest, 38);
    assert.deepEqual(p.window.map((w) => w.at), [101, 101, 101, 102, 102]);
    assert.deepEqual(p.buy, { place: 39, cash: 1010 });
    assert.equal(shortfall({ ...base, place: 38 }, 20, 101), 0);
  });
  it("XP is split between heroes; Energizer and MK speed it up", () => {
    const solo = timeline(base).levels[20]!;
    assert.ok(timeline({ ...base, heroes: 2 }).levels[20]! > solo);
    assert.ok(timeline({ ...base, energizer: 1 }).levels[20]! < solo);
    assert.ok(plan({ ...base, ...allMk, map: 2 }, 20, 101).latest! > 38);
  });
});
