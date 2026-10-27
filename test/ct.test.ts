// CT event page logic without a DOM: tile counts, cut-off trend, relic history, routes and prefetch keys.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CTTile } from "../src/nk/types.ts";
import { cutoffTrend, gameMix, relicHistory, tileStats, type RelicCT, type Snap } from "../web/src/ctStats.ts";
import { CT_RELICS_KEY, ctCutoffsKey, ctExtraKeys, ctKey, needs, parse } from "../web/src/routes.ts";

const T = (id: string, type: string, gameType: string): CTTile => ({ id, type, gameType });
const tiles = [T("AAA", "Regular", "LeastCash"), T("BBB", "Relic - ManaBulwark", "Boss"), T("CCC", "Banner", "Race"), T("DDD", "TeamStart", "TeamStart")];
const cts: RelicCT[] = [
  { id: "a", start: 1, end: 100, relics: ["ManaBulwark", "X"], banners: 1, games: { LeastCash: 40, Boss: 10 } },
  { id: "me", start: 2, end: 200, relics: ["ManaBulwark"], banners: 1, games: { LeastCash: 99 } },
  { id: "b", start: 3, end: 300, relics: ["Y"], banners: 1, games: { LeastCash: 30, Boss: 20 } },
];

describe("ct page", () => {
  it("counts tiles", () => {
    assert.deepEqual(tileStats(tiles), { tiles: 4, relics: 1, banners: 1, starts: 1, games: { LeastCash: 1, Boss: 1, Race: 1, TeamStart: 1 } });
  });
  it("cut-off trend needs two snapshots with the rank", () => {
    const s: Snap[] = [{ at: 1, ranks: { "10": 100 } }, { at: 2, ranks: { "10": 160, "20": 5 } }];
    assert.deepEqual(cutoffTrend(s, 10), { delta: 60, since: 1, at: 2 });
    assert.equal(cutoffTrend(s, 20), undefined);
    assert.equal(cutoffTrend(s.slice(1), 10), undefined);
    assert.equal(cutoffTrend(undefined, 10), undefined);
  });
  it("relic history leaves this CT out", () => {
    assert.deepEqual(relicHistory("me", "ManaBulwark", cts), { seen: 1, of: 2, last: 100 });
    assert.deepEqual(relicHistory("me", "Z", cts), { seen: 0, of: 2, last: undefined });
  });
  it("game mix averages the previous CTs", () => {
    assert.deepEqual(gameMix("me", { LeastCash: 38, Boss: 12 }, cts), { of: 2, by: { LeastCash: { now: 38, avg: 35 }, Boss: { now: 12, avg: 15 } } });
    assert.equal(gameMix("me", {}, []), undefined);
  });
  it("tab=tiles opens the map; no tab is Teams", () => {
    assert.equal((parse(new URL("https://x/ct/abc12345?tab=tiles")) as { tab: string }).tab, "map");
    assert.equal((parse(new URL("https://x/ct/abc12345?tab=map")) as { tab: string }).tab, "map");
    assert.equal((parse(new URL("https://x/ct/abc12345")) as { tab: string }).tab, "teams");
  });
  it("the event page prefetches tiles, relics, cut-offs and the team board", () => {
    const k = needs({ name: "ct", id: "abc12345", tab: "players", p: 1 });
    for (const want of [ctKey("abc12345", "map"), ctKey("abc12345", "teams"), ctKey("abc12345", "players"), CT_RELICS_KEY, ctCutoffsKey("abc12345")]) assert.ok(k.includes(want), want);
  });
  it("extras: top three guilds, group history + leader, every listed CT", () => {
    const rows = ["g1", "g2", "g3", "g4"].map((g) => ({ profile: `https://data.ninjakiwi.com/btd6/guild/${g}` }));
    const peek = (<T>(key: string) => (key === ctKey("abc12345", "teams") || key === "/btd6/ct/abc12345/leaderboard/group/ff" ? rows : key === "/btd6/ct" ? [{ id: "c1" }, { id: "c2" }] : undefined) as T);
    assert.equal(ctExtraKeys(peek, { name: "ct", id: "abc12345", tab: "teams", p: 1 }).length, 3);
    assert.equal(ctExtraKeys(peek, { name: "ctgroup", id: "abc12345", gid: "ff" }).length, 5);
    assert.deepEqual(ctExtraKeys(peek, { name: "events", kind: "ct" }), [ctKey("c1", "map"), ctKey("c1", "teams"), ctKey("c2", "map"), ctKey("c2", "teams")]);
  });
});
