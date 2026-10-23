// Leaderboard score parts: NK labels them by slot, not by content. These are the three shapes seen live.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScorePart } from "../src/nk/types.ts";
import { dailyIsOut, fixParts, fmtPart, partLabel } from "../web/src/format.ts";
import { medalTier } from "../web/src/medals.ts";

const P = (name: string, type: "number" | "time", score: number): ScorePart => ({ name, type, score });
const shown = (parts: ScorePart[]) => parts.map((p) => `${partLabel(p.name)}=${fmtPart(p)}`);

describe("boss score parts", () => {
  it("Least Cash boards are labelled correctly (Vortex47)", () => {
    const parts = [P("Boss Tier", "number", 5), P("Least Cash", "number", 189920), P("Game Time", "time", 1905200)];
    assert.deepEqual(shown(fixParts(parts, "LeastCash")), ["Tier=T5", "Cash spent=$189,920", "Game Time=31:45.200"]);
  });

  it("Fastest Time boards: 'Least Cash' is the run time, 'Game Time' is the submission time (Lych61)", () => {
    const parts = [P("Boss Tier", "number", 5), P("Least Cash", "time", 32733), P("Game Time", "time", 496293000)];
    assert.deepEqual(shown(fixParts(parts, "GameTime")), ["Tier=T5", "Game Time=0:32.733", "Submitted=+5d 17h"]);
  });

  it("Least Tiers boards: 'Tier Count' and 'Submission Time' (Bloonarius69 elite)", () => {
    const parts = [P("Boss Tier", "number", 5), P("Tier Count", "number", 24), P("Game Time", "time", 2173800), P("Submission Time", "time", 219858000)];
    assert.deepEqual(shown(fixParts(parts, "LeastTiers")), ["Tier=T5", "Tiers=24 tiers", "Game Time=36:13.800", "Submitted=+2d 13h"]);
  });
});

describe("medal brackets", () => {
  it("boss/race: 1st/2nd/3rd, top 50, top 100, then percent of the board", () => {
    assert.equal(medalTier("boss", 1, 9283), "BlackDiamond");
    assert.equal(medalTier("boss", 3, 9283), "BlueDiamond");
    assert.equal(medalTier("boss", 50, 9283), "GoldDiamond");
    assert.equal(medalTier("boss", 51, 9283), "DoubleGold");
    assert.equal(medalTier("boss", 928, 9283), "GoldSilver"); // top 10% = 928
    assert.equal(medalTier("boss", 929, 9283), "DoubleSilver");
  });
  it("without a total (co-op boards) only rank brackets apply", () => {
    assert.equal(medalTier("boss", 100), "DoubleGold");
    assert.equal(medalTier("boss", 101), undefined);
  });
  it("CT: players have no Black/Red Diamond; groups have four medals", () => {
    assert.equal(medalTier("ctPlayer", 1, 13546), "BlueDiamond");
    assert.equal(medalTier("ctTeam", 1, 4780), "BlackDiamond");
    assert.equal(medalTier("ctGroup", 2), "DoubleGold");
    assert.equal(medalTier("ctGroup", 5), undefined);
  });
});

// ── time zones, names, dailies
import { abilityName, bossNum, bossParts, bossTitle, dailyAuthor, dailyInfo, dailyNeighbour, dailyTitle, mapName, tzLabel } from "../web/src/format.ts";

describe("time zone label per date", () => {
  it("uses the offset in force on that date (DST), not January's", () => {
    const winter = Date.UTC(2026, 0, 15, 12);
    const summer = Date.UTC(2026, 6, 15, 12);
    assert.equal(tzLabel(winter, { timeZone: "America/New_York", locale: "en-US" }), "EST");
    assert.equal(tzLabel(summer, { timeZone: "America/New_York", locale: "en-US" }), "EDT");
    assert.notEqual(tzLabel(winter, { timeZone: "Europe/Paris", locale: "en-GB" }), tzLabel(summer, { timeZone: "Europe/Paris", locale: "en-GB" }));
  });
  it("never throws on a bad zone", () => {
    assert.equal(tzLabel(0, { timeZone: "Not/AZone" }), "");
  });
});

describe("boss titles", () => {
  it("builds the title from bossType + number", () => {
    assert.equal(bossTitle("dreadbloon", 37), "Dreadbloon #37");
    assert.equal(bossTitle("blastapopoulos", "12"), "Blastapopoulos #12");
  });
  it("keeps accepting NK names, fixing the misspelling", () => {
    assert.equal(bossTitle("Vortex47"), "Vortex #47");
    assert.equal(bossTitle("Blastapopolous19"), "Blastapopoulos #19");
    assert.equal(bossTitle("BLASTAPOPOLOUS19"), "Blastapopoulos #19");
    assert.deepEqual(bossParts("Blastapopolous19"), ["Blastapopoulos", "19"]);
    assert.equal(bossNum("Dreadbloon37"), "37");
  });
  it("leaves bare ids alone", () => {
    assert.equal(bossTitle("msi6n2qi"), "msi6n2qi");
  });
});

describe("map and ability names", () => {
  it("falls back to the humanised id for maps it doesn't know", () => {
    assert.equal(mapName("SomeBrandNewMap"), "Some Brand New Map");
    assert.equal(mapName("CustomMap"), "Custom map");
    assert.equal(mapName(undefined), "");
  });
  it("humanises unknown ability keys and tolerates trailing spaces", () => {
    assert.equal(abilityName("ZzUnknownAbility2"), "Zz Unknown Ability 2");
    assert.equal(abilityName("ZzUnknown "), "Zz Unknown");
  });
});

describe("daily challenges", () => {
  it("reads number, series and date from the id", () => {
    assert.deepEqual(dailyInfo("rot296620260924"), { kind: "standard", n: 2966, day: Date.UTC(2026, 8, 24) });
    assert.equal(dailyInfo("adv295320260924")?.kind, "advanced");
    assert.equal(dailyInfo("coopmtr86jby")?.kind, "coop");
    assert.equal(dailyInfo("ZFVHOWM"), null);
  });
  it("titles and neighbours (across month ends)", () => {
    assert.equal(dailyTitle("rot296620260924"), "Daily #2966");
    assert.equal(dailyTitle("adv295320260924"), "Advanced daily #2953");
    assert.equal(dailyTitle("ZFVHOWM"), null);
    assert.equal(dailyNeighbour("rot296620260924", -1), "rot296520260923");
    assert.equal(dailyNeighbour("rot290020260801", -1), "rot289920260731");
    assert.equal(dailyNeighbour("adv295320260930", 1), "adv295420261001");
    assert.equal(dailyNeighbour("coopmtr86jby", 1), null);
  });
  it("finds the author in the daily's name", () => {
    assert.equal(dailyAuthor("Standard 2966: BrightGiraffe84's Challenge"), "BrightGiraffe84");
    assert.equal(dailyAuthor("Advanced 2949: Flat_Batteries's Chalennge"), "Flat_Batteries");
    assert.equal(dailyAuthor("coop - pizzapatrol1234's Challenge"), "pizzapatrol1234");
    assert.equal(dailyAuthor("No Name"), null);
  });
});

describe("upcoming dailies", () => {
  it("a numbered daily is out from 08:00 UTC on its date; co-op ids always", () => {
    const now = Date.UTC(2026, 8, 26, 19, 50);
    assert.equal(dailyIsOut("rot296820260926", now), true);
    assert.equal(dailyIsOut("rot296820260926", Date.UTC(2026, 8, 26, 7, 59)), false);
    assert.equal(dailyIsOut("rot296820260926", Date.UTC(2026, 8, 26, 8, 0)), true);
    assert.equal(dailyIsOut("rot296920260927", now), false);
    assert.equal(dailyIsOut("adv295620260927", now), false);
    assert.equal(dailyIsOut("coopmtr86jby", now), true);
  });
});
