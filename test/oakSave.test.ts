import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { UserSave } from "../src/nk/types.ts";
import { MAP_LIST } from "../web/src/data/names.ts";
import progress from "../web/src/data/progress.json" with { type: "json" };
import { bankKnowledge, completion, heroParts, instaParts, instaPossible, knowledgeParts, mapMedals, medalCounts, powerUpgradeParts, skinParts, towerParts, upgradeParts, type Progress } from "../web/src/oakSave.ts";

const save = JSON.parse(readFileSync(new URL("../docs/api/fixtures/btd6__save__sample.json", import.meta.url), "utf8")).body as UserSave;

describe("save → map medals", () => {
  it("counts earned solo medals from the sample, Standard = difficulty medal", () => {
    for (const id of Object.keys(save.mapProgress)) {
      const m = mapMedals(save, id);
      const raw = save.mapProgress[id].difficulty;
      assert.equal(m.total, 14);
      assert.equal(m.single[0].cells[0].earned, !!raw.Easy?.single?.Standard?.completed);
      assert.equal(m.single[0].cells[0].key, "Easy");
      assert.equal(m.coop[2].cells[6].earned, !!raw.Hard?.coop?.Clicks?.completed);
    }
    const t = mapMedals(save, "Tutorial");
    assert.equal(t.single[0].cells[0].bestRound, 50);
    assert.equal(t.single[0].cells[0].times, 3);
  });
  it("unknown map: nothing earned", () => assert.equal(mapMedals(save, "Nope").earned, 0));
});

describe("bank Monkey Knowledge from the save", () => {
  const s = { acquiredKnowledge: { BiggerBanks: false, MoreValuableBananas: true, BankDeposits: true } } as unknown as UserSave;
  it("save sets the default, URL wins, no save keeps the route", () => {
    assert.deepEqual(bankKnowledge(s, false, { bb: true, mvb: true }), { bb: false, mvb: true, deposits: true });
    assert.deepEqual(bankKnowledge(s, true, { bb: true, mvb: false }), { bb: true, mvb: false, deposits: true });
    assert.deepEqual(bankKnowledge(undefined, false, { bb: true, mvb: true }), { bb: true, mvb: true, deposits: undefined });
  });
});

const prog = progress as Progress;
describe("completion readers on the sample save", () => {
  it("medals: every grid medal is listed with the maps still missing", () => {
    const rows = medalCounts(save);
    assert.equal(rows.length, 14);
    for (const r of rows) {
      assert.equal(r.total, MAP_LIST.length);
      assert.equal(r.solo + r.soloMissing.length, r.total);
      assert.equal(r.coop + r.coopMissing.length, r.total);
    }
    const easy = rows[0];
    const raw = Object.values(save.mapProgress).filter((m) => m.difficulty.Easy?.single?.Standard?.completed).length;
    assert.equal(easy.solo, raw);
    // maps the save has never seen count as missing
    assert.ok(MAP_LIST.every(([id]) => id in save.mapProgress || easy.soloMissing.includes(id)));
  });
  it("heroes, towers, knowledge, upgrades, skins add up to the game's totals", () => {
    for (const x of [heroParts(save, prog), towerParts(save, prog)]) assert.equal(x.owned + x.missing.length, x.total);
    assert.equal(heroParts(save, prog).owned, prog.heroes.filter((h) => save.unlockedHeroes[h]).length);
    const mk = knowledgeParts(save, prog);
    assert.equal(mk.reduce((n, t) => n + t.total, 0), prog.knowledge.length);
    assert.equal(mk.reduce((n, t) => n + t.owned, 0), prog.knowledge.filter((k) => save.acquiredKnowledge[k.id]).length);
    const up = upgradeParts(save, prog);
    assert.equal(up.owned + up.by.reduce((n, x) => n + x.missing.length, 0), up.total);
    const sk = skinParts(save, prog);
    if (sk) assert.equal(sk.owned + sk.missing.length, sk.total);
    assert.equal(skinParts(save, { ...prog, skins: undefined }), null);
  });
  it("insta tier sets: the generated rule covers every key of the sample", () => {
    const possible = new Set(instaPossible());
    assert.equal(possible.size, 64);
    for (const t of Object.values(save.instaTowers)) for (const k of Object.keys(t)) assert.ok(possible.has(k), k);
    const rows = instaParts(save, prog);
    for (const r of rows) assert.equal(r.owned + r.missing.length, 64);
    assert.ok(rows.some((r) => r.owned > 0));
  });
  it("overall = mean of the ring percentages", () => {
    const c = completion(save, prog);
    const mean = c.rings.reduce((n, r) => n + r.owned / r.total, 0) / c.rings.length;
    assert.ok(Math.abs(c.overall - mean) < 1e-9);
  });
  it("pro power upgrades: absent list = null, else owned + missing = total", () => {
    assert.equal(powerUpgradeParts(save, { ...prog, powerUpgrades: undefined }), null);
    const names = Object.keys(save.acquiredUpgrades);
    const r = powerUpgradeParts(save, { ...prog, powerUpgrades: { X: [names[0], "Not An Upgrade"] } })!;
    assert.deepEqual([r.owned, r.total, r.by[0].missing], [1, 2, ["Not An Upgrade"]]);
  });
});
