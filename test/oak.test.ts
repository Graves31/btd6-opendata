// Open Access Key helpers: NK envelope handling, "is this profile mine?", and the /me page's derived numbers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { UserProfile, UserSave } from "../src/nk/types.ts";
import { looksLikeMe, unwrap } from "../web/src/oak.ts";
import { instaSummary, medalCounts } from "../web/src/oakSave.ts";

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../docs/api/fixtures/${name}.json`, import.meta.url), "utf8"));
const save: UserSave = fx("btd6__save__sample").body;
const profile: UserProfile = fx("btd6__users__9ce915df8b92f0ac18138b4e5976e77fca0d19b49b46dd6d").body;

describe("unwrap", () => {
  it("429 is busy, an error envelope is invalid, success gives the body", () => {
    assert.equal(unwrap(429, null), "busy");
    assert.equal(unwrap(200, { success: false, error: "Invalid OAK", body: null }), "invalid");
    assert.equal(unwrap(200, null), "invalid");
    assert.deepEqual(unwrap(200, { success: true, body: { a: 1 } }), { a: 1 });
  });
});

describe("looksLikeMe", () => {
  const copy = (f: (p: UserProfile) => void) => {
    const p: UserProfile = structuredClone(profile);
    f(p);
    return p;
  };
  it("same profile, or one whose counters only grew", () => {
    assert.equal(looksLikeMe(profile, profile), true);
    assert.equal(looksLikeMe(profile, copy((p) => (p.gameplay.cashEarned += 5, p.bloonsPopped.bloonsPopped = (p.bloonsPopped.bloonsPopped ?? 0) + 9))), true);
  });
  it("one counter up and another down is somebody else", () => {
    assert.equal(looksLikeMe(profile, copy((p) => (p.gameplay.cashEarned += 5, p.gameplay.challengesCompleted -= 1))), false);
  });
  it("a different name is somebody else", () => {
    assert.equal(looksLikeMe(profile, copy((p) => (p.displayName = "someoneelse"))), false);
  });
});

describe("derived save numbers", () => {
  it("medal counts match a manual count and count only real medals", () => {
    const rows = medalCounts(save);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => !["Sandbox", "SuperChimps"].includes(r.mode) && r.solo + r.coop > 0));
    // the sample save has Easy Reverse / Hard Deflation entries: not medals
    assert.ok(!rows.some((r) => (r.difficulty === "Easy" && r.mode === "Reverse") || (r.difficulty === "Hard" && r.mode === "Deflation")));
    assert.ok(rows.length <= 14);
    const easy = rows.find((r) => r.difficulty === "Easy" && r.mode === "Standard")!;
    assert.equal(easy.medal, "Easy");
    const want = Object.values(save.mapProgress).filter((m) => m.difficulty?.Easy?.single?.Standard?.completed).length;
    assert.equal(easy.solo, want);
    const chimps = rows.find((r) => r.mode === "Clicks");
    if (chimps) assert.equal(chimps.medal, "Clicks");
  });
  it("insta counts: sets and totals per tower, tiers written 0-3-2", () => {
    const rows = instaSummary(save);
    const dart = rows.find((r) => r.tower === "DartMonkey")!;
    const raw = Object.values(save.instaTowers.DartMonkey).filter((n) => n > 0);
    assert.equal(dart.sets, raw.length);
    assert.equal(dart.total, raw.reduce((a, b) => a + b, 0));
    assert.ok(dart.tiers.every(([t]) => /^\d-\d-\d$/.test(t)));
    assert.deepEqual(rows.map((r) => r.total), rows.map((r) => r.total).sort((a, b) => b - a));
  });
});
