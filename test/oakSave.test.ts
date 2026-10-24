import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { UserSave } from "../src/nk/types.ts";
import { bankKnowledge, mapMedals } from "../web/src/oakSave.ts";

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
