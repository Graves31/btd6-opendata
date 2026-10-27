// event-page logic that doesn't need a DOM — co-op grouping, medal cut-offs, freshness text, routes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScorePart } from "../src/nk/types.ts";
import { agoText, freshParts, ordinal, rankBossRows, teamSig } from "../web/src/boards.ts";
import { cutoffs } from "../web/src/medals.ts";
import { ctKey, href, needs, parse, teamHistoryKey } from "../web/src/routes.ts";

const P = (name: string, type: "number" | "time", score: number): ScorePart => ({ name, type, score });
/** A Least Cash co-op row: [Boss Tier, Least Cash, Game Time = each player's own submission time]. */
const row = (who: string, cash: number, submitted: number) => ({
  displayName: who,
  score: 5,
  scoreParts: [P("Boss Tier", "number", 5), P("Least Cash", "number", cash), P("Game Time", "time", submitted)],
});
/** A Fastest Time co-op row: NK's "Game Time" slot there is the submission time (see fixParts). */
const ftRow = (who: string, run: number, submitted: number) => ({
  displayName: who,
  score: 5,
  scoreParts: [P("Boss Tier", "number", 5), P("Least Cash", "time", run), P("Game Time", "time", submitted)],
});

describe("co-op boss grouping (item 4)", () => {
  it("teammates with different submission times share one rank", () => {
    const rows = [ftRow("a", 30000, 1000), ftRow("b", 30000, 2000), ftRow("c", 31000, 5000), ftRow("d", 31000, 5100)];
    const out = rankBossRows(rows, { n: 2, page: 1, scoring: "GameTime" });
    assert.deepEqual(
      out.map((x) => x.rank),
      [1, null, 2, null],
    );
    assert.equal(teamSig(rows[0], "GameTime"), teamSig(rows[1], "GameTime"));
  });

  it("Least Tiers boards drop the 'Submission Time' part from the signature", () => {
    const a = { score: 5, scoreParts: [P("Boss Tier", "number", 5), P("Tier Count", "number", 24), P("Submission Time", "time", 1)] };
    const b = { ...a, scoreParts: [P("Boss Tier", "number", 5), P("Tier Count", "number", 24), P("Submission Time", "time", 99)] };
    assert.equal(teamSig(a, "LeastTiers"), teamSig(b, "LeastTiers"));
  });

  it("two tied teams stay apart (a team has at most n rows)", () => {
    // Least Cash boards: "Game Time" is the run's real time (a tie-breaker), so identical parts = a genuine tie.
    const tie = [row("a", 100, 7), row("b", 100, 7), row("c", 100, 7), row("d", 100, 7)];
    assert.deepEqual(
      rankBossRows(tie, { n: 2, page: 1, scoring: "LeastCash" }).map((x) => x.rank),
      [1, null, 2, null],
    );
  });

  it("page 2 with page 1 known: exact ranks, short teams and a team straddling the page edge", () => {
    // page 1 ends with the first row of team "t"; a solo-in-2P team "s" sits before it
    const page1 = [ftRow("a", 1, 1), ftRow("b", 1, 2), ftRow("s", 2, 3), ftRow("t1", 3, 4)];
    const page2 = [ftRow("t2", 3, 5), ftRow("c", 4, 6), ftRow("d", 4, 7)];
    const out = rankBossRows(page2, { n: 2, page: 2, scoring: "GameTime", before: page1 });
    assert.deepEqual(
      out.map((x) => [x.rank, x.approx ?? false]),
      [
        [null, false], // t's teammate, ranked on page 1
        [4, false],
        [null, false],
      ],
    );
  });

  it("page 2 without page 1: estimated from full teams and marked approx", () => {
    const rows = [ftRow("c", 4, 6), ftRow("d", 4, 7), ftRow("e", 5, 8)];
    const out = rankBossRows(rows, { n: 2, page: 2, scoring: "GameTime" });
    // ⌊25/2⌋ = 12 full teams assumed before this page
    assert.deepEqual(
      out.map((x) => [x.rank, x.approx]),
      [
        [13, true],
        [null, true],
        [14, true],
      ],
    );
  });

  it("solo boards rank every row", () => {
    const out = rankBossRows([row("a", 1, 1), row("b", 1, 1)], { n: 1, page: 3, scoring: "LeastCash" });
    assert.deepEqual(
      out.map((x) => x.rank),
      [51, 52],
    );
  });
});

describe("medal cut-offs (item 18)", () => {
  it("boss board with a total: rank brackets then percent boundaries", () => {
    const c = cutoffs("boss", 9283);
    assert.deepEqual(
      c.map((x) => [x.tier, x.rank, x.label]),
      [
        ["BlackDiamond", 1, "1st"],
        ["RedDiamond", 2, "2nd"],
        ["BlueDiamond", 3, "3rd"],
        ["GoldDiamond", 50, "Top 50"],
        ["DoubleGold", 100, "Top 100"],
        ["GoldSilver", 928, "Top 10%"],
        ["DoubleSilver", 2320, "Top 25%"],
        ["Silver", 4641, "Top 50%"],
        ["Bronze", 6962, "Top 75%"],
      ],
    );
  });
  it("without a total (co-op) only rank brackets", () => {
    assert.deepEqual(
      cutoffs("boss").map((x) => x.rank),
      [1, 2, 3, 50, 100],
    );
  });
  it("small boards collapse duplicate boundaries", () => {
    assert.deepEqual(
      cutoffs("race", 40)
        .filter((x) => !x.coveredBy)
        .map((x) => x.rank),
      [1, 2, 3, 40],
    );
  });
  it("medals nobody can earn yet say which better medal covers them (elite, 248 entries)", () => {
    const c = cutoffs("bossElite", 248);
    assert.deepEqual(
      c.map((x) => [x.label, x.rank, x.coveredBy ?? null]),
      [
        ["1st", 1, null],
        ["2nd", 2, null],
        ["3rd", 3, null],
        ["Top 50", 50, null],
        ["Top 100", 100, null],
        ["Top 10%", 24, "Top 100"],
        ["Top 25%", 62, "Top 100"],
        ["Top 50%", 124, null],
        ["Top 75%", 186, null],
      ],
    );
  });
});

describe("freshness text (item 10)", () => {
  it("minutes, hours, days", () => {
    assert.equal(agoText(20_000), "just now");
    assert.equal(agoText(4 * 60_000), "4 min ago");
    assert.equal(agoText(3 * 3_600_000), "3 h ago");
    assert.equal(agoText(3 * 86_400_000), "3 d ago");
  });
  it("Final for ended events, Top N of M for capped boards", () => {
    assert.deepEqual(freshParts({ fetchedAt: 0, now: 1, ended: true, shown: 1000, total: 13546 }), ["Final", "Showing top 1,000 of 13,546"]);
    assert.deepEqual(freshParts({ fetchedAt: 1_000, now: 1_000 + 5 * 60_000 }), ["Updated 5 min ago"]);
    assert.deepEqual(freshParts({ now: 0, shown: 40, total: 40 }), ["All 40 entries"]);
  });
  it("ordinals", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});

describe("routes (items 1, 14)", () => {
  const at = (p: string) => parse(new URL(p, "https://x.invalid"));
  it("accepts bare and hyphenated event ids", () => {
    assert.deepEqual(at("/boss/msi6n2qi"), { name: "boss", id: "msi6n2qi", d: "standard", n: 1, p: 1 });
    assert.equal(at("/race/Regene-race_mtjapaiu").name, "race");
    assert.equal(at("/boss/Vortex47_mu62cmt5?d=elite&n=2").name, "boss");
  });
  it("rejects malformed ids as not found", () => {
    assert.equal(at("/boss/abc").name, "notfound");
    assert.equal(at("/boss/" + "x".repeat(65)).name, "notfound");
    assert.equal(at("/race/bad%20id!").name, "notfound");
    assert.equal(at("/ct/mtv62zza/group/not%20hex").name, "notfound");
    assert.equal(at("/ct/mtv62zza/group/CAFB78D6").name, "notfound"); // group ids are lowercase hex
  });
  it("CT group ids: 44-hex groups and NK's 8-hex placeholder", () => {
    assert.equal(at("/ct/mtv62zza/group/cafb78d69bd0ffa75208de245c74ef189b4144e0ca53").name, "ctgroup");
    assert.equal(at("/ct/mtv62zza/group/c7fa4bd7").name, "ctgroup");
    assert.equal(at("/ct/mtv62zza/group/c7fa4b").name, "notfound");
  });
  it("challenge lists", () => {
    assert.deepEqual(at("/challenges"), { name: "challenges", filter: "daily", p: 1 });
    assert.deepEqual(at("/challenges/newest?p=3"), { name: "challenges", filter: "newest", p: 3 });
    assert.equal(at("/challenges/bogus").name, "notfound");
    assert.equal(href.challenges("trending", 2), "/challenges/trending?p=2");
    assert.equal(href.challenges(), "/challenges");
    assert.deepEqual(needs(at("/challenges/newest?p=3")), ["/btd6/challenges/filter/newest?page=3", "/btd6/challenges/filter/daily"]);
  });
  it("CT opens on Teams; explicit tabs stay explicit", () => {
    const r = at("/ct/mtv62zza");
    assert.deepEqual(r, { name: "ct", id: "mtv62zza", tab: "teams", p: 1 });
    for (const k of ["/btd6/ct", ctKey("mtv62zza", "teams"), ctKey("mtv62zza", "map")]) assert.ok(needs(r).includes(k), k);
    assert.equal(href.ct("mtv62zza"), "/ct/mtv62zza");
    assert.equal(href.ct("mtv62zza", "teams"), "/ct/mtv62zza?tab=teams");
    assert.equal(href.ct("mtv62zza", "players", 2), "/ct/mtv62zza?tab=players&p=2");
    assert.deepEqual(at(href.ct("mtv62zza", "players", 2)), { name: "ct", id: "mtv62zza", tab: "players", p: 2 });
  });
  it("team pages prefetch the archived CT history", () => {
    const id = "9fb9168a8a94f1a449458c4a0a25e522cf021ab59f41df39";
    assert.ok(needs(at(`/team/${id}`)).includes(teamHistoryKey(id)));
  });
});
