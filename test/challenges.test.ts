// Challenge-list logic: daily grouping, prev/next daily, day badges, search targets, rule chips, search matching.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChallengeDocument, ChallengeSummary, TowerRestriction } from "../src/nk/types.ts";
import { dailyNeighbours, dayBadge, matchesText, olderDaily, ruleChipData, searchTargets, splitDaily } from "../web/src/challenges.ts";
import { dailyStart, plain } from "../web/src/format.ts";
import { TOWER_ORDER } from "../web/src/roster.ts";

const C = (id: string, createdAt: number) => ({ id, createdAt, name: id }) as unknown as ChallengeSummary;
const DAY0 = Date.UTC(2026, 9, 20); // 2026-10-20 00:00 UTC
const H = 3_600_000;

describe("splitDaily", () => {
  it("picks the newest started daily per series and lists the rest", () => {
    const now = DAY0 + 10 * H;
    const list = [C("rot299420261020", 1), C("rot299320261019", 0), C("rot299520261021", 2), C("adv299420261020", 1)];
    const [std, adv, coop] = splitDaily(list, now);
    assert.equal(std.cur?.id, "rot299420261020"); // 21st has not started yet (08:00 UTC)
    assert.deepEqual(std.items.map((c) => c.id), ["rot299520261021", "rot299320261019"]);
    assert.equal(adv.cur?.id, "adv299420261020");
    assert.equal(coop.cur, undefined);
  });
  it("lists a co-op daily from 1 h before its createdAt", () => {
    const now = DAY0;
    const [, , coop] = splitDaily([C("coopabc", now + H), C("coopdef", now + H + 1)], now);
    assert.equal(coop.cur?.id, "coopabc");
    assert.equal(coop.items.length, 0);
  });
});

describe("olderDaily", () => {
  it("is the day before the oldest listed standard daily", () => {
    const series = splitDaily([C("rot299420261020", 1), C("rot299320261019", 0)], DAY0 + 10 * H);
    assert.equal(olderDaily(series), "rot299220261018");
    assert.equal(olderDaily(splitDaily([], DAY0)), undefined);
  });
});

describe("dailyNeighbours", () => {
  it("computes numbered neighbours and hides a next daily that is not published yet", () => {
    const id = "rot299420261020";
    assert.deepEqual(dailyNeighbours(id, [], DAY0 + H), { prev: "rot299320261019", next: null });
    assert.equal(dailyNeighbours(id, [], DAY0 + 24 * H + 2 * H).next, "rot299520261021");
    assert.equal(dailyNeighbours(id, [C("rot299520261021", 0)], DAY0).next, "rot299520261021");
  });
  it("follows the feed order for co-op dailies, ignoring ones from the future", () => {
    const feed = [C("coopc", 300), C("coopb", 200), C("coopa", 100)];
    assert.deepEqual(dailyNeighbours("coopb", feed, 250), { prev: "coopa", next: null });
    assert.deepEqual(dailyNeighbours("coopb", feed, 300), { prev: "coopa", next: "coopc" });
    assert.deepEqual(dailyNeighbours("nope", feed, 300), { prev: null, next: null });
    assert.deepEqual(dailyNeighbours("ABCDEFG", feed, 300), { prev: null, next: null });
  });
});

describe("dayBadge", () => {
  const id = "rot299420261020";
  const s = dailyStart(id)!;
  const clock = (ms: number) => `T${ms - s}`;
  it("says Today for 24 h from the start, Starts for the day before, nothing otherwise", () => {
    assert.equal(dayBadge(id, s + H, clock), "Today");
    assert.equal(dayBadge(id, s + 24 * H, clock), undefined);
    assert.equal(dayBadge(id, s - H, clock), "Starts T0");
    assert.equal(dayBadge(id, s - 25 * H, clock), undefined);
    assert.equal(dayBadge("coopabc", s, clock), undefined);
  });
});

describe("searchTargets", () => {
  const feed = [C("rot299420261020", 1), C("adv299420261020", 1)];
  it("opens a daily by id, with any case", () => {
    assert.deepEqual(searchTargets("ROT299420261020", feed), [{ id: "rot299420261020", daily: true }]);
  });
  it("opens a 7-letter challenge code upper-cased", () => {
    assert.deepEqual(searchTargets("zfvhowm", feed), [{ id: "ZFVHOWM", daily: false, code: "ZFVHOWM" }]);
    assert.deepEqual(searchTargets("zfvhow", feed), []);
  });
  it("maps a daily number to both numbered series, with or without #", () => {
    assert.deepEqual(searchTargets("#2992", feed).map((t) => t.id), ["rot299220261018", "adv299220261018"]);
    assert.deepEqual(searchTargets("2994", feed)[0], { id: "rot299420261020", daily: true });
    assert.deepEqual(searchTargets("0", feed), []);
    assert.deepEqual(searchTargets("2994", undefined), []);
    assert.deepEqual(searchTargets("123456", feed), []);
  });
});

describe("matchesText", () => {
  it("ignores case and accents", () => {
    assert.ok(matchesText(["Café Racer", "x"], "cafe"));
    assert.ok(matchesText(["cafe"], plain("CAFÉ")));
    assert.ok(!matchesText(["Dark Castle"], "cafe"));
  });
});

describe("ruleChipData", () => {
  const R = (tower: string, isHero: boolean, max: number) => ({ tower, isHero, max }) as TowerRestriction;
  const towers = (n: number, hero: Record<string, number> = {}) => [
    ...TOWER_ORDER.slice(0, n).map((tower) => R(tower, false, -1)),
    ...Object.entries(hero).map(([tower, max]) => R(tower, true, max)),
  ];
  const doc = (o: Partial<ChallengeDocument>) => o as ChallengeDocument;
  it("is empty for an ordinary ruleset", () => {
    assert.deepEqual(ruleChipData(doc({ _towers: towers(TOWER_ORDER.length, { Quincy: -1, Gwendolin: -1 }), lives: 150 })), []);
  });
  it("names a single allowed hero, or no hero", () => {
    const one = ruleChipData(doc({ _towers: towers(TOWER_ORDER.length, { Quincy: -1, Gwendolin: 0 }) }));
    assert.deepEqual(one.map((c) => [c.key, c.icon]), [["h", "Quincy"]]);
    const none = ruleChipData(doc({ _towers: towers(TOWER_ORDER.length, { Quincy: 0 }) }));
    assert.deepEqual(none.map((c) => [c.key, c.icon, c.text]), [["h", "NoHero", "No hero"]]);
  });
  it("shows no hero chip when your selected hero is on", () => {
    const t = [...towers(TOWER_ORDER.length, { Quincy: 0 }), R("ChosenPrimaryHero", true, -1)];
    assert.deepEqual(ruleChipData(doc({ _towers: t })), []);
  });
  it("counts allowed towers, 1 life and disabled powers", () => {
    const chips = ruleChipData(doc({ _towers: towers(10, { Quincy: -1, Gwendolin: -1 }), lives: 1, disablePowers: true }));
    assert.deepEqual(chips.map((c) => c.key), ["t", "l", "p"]);
    assert.equal(chips[0].text, `10 / ${TOWER_ORDER.length} towers`);
  });
});
