import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cutoffs } from "../web/src/medals.ts";
import { nextMedal, placings, type TeamHistoryEntry } from "../web/src/myTeam.ts";

const E = (ct: string, start: number, rank: number | null): TeamHistoryEntry => ({ ct, start, end: start + 1, rank, total: 1000, score: 1, group: null });

describe("my team helpers", () => {
  it("placings: best and last, skipping unranked and the named CT", () => {
    const h = [E("a", 1, 40), E("b", 3, null), E("c", 2, 9), E("d", 4, 77)];
    assert.deepEqual(placings(h), { best: 9, last: 77 });
    assert.deepEqual(placings(h, "d"), { best: 9, last: 9 });
    assert.equal(placings([E("a", 1, null)]), undefined);
  });
  it("nextMedal: nearest cut-off above the team, gap from the snapshot", () => {
    const cuts = cutoffs("ctTeam", 1000);
    const n = nextMedal(cuts, 60, 500, { "25": 800 });
    assert.equal(n?.rank, 25);
    assert.equal(n?.gap, 300);
    assert.equal(nextMedal(cuts, 60, 500)?.gap, undefined);
    assert.equal(nextMedal(cuts, 1, 500), undefined);
  });
});
