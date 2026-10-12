// Maps explorer: /maps and /maps/<id> routing, and which boss events / races land on which map.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { BOSS_HISTORY } from "../web/src/data/bossHistory.ts";
import { MAP_LIST, MAP_NAMES } from "../web/src/data/names.ts";
import { mapCounts, mapEvents } from "../web/src/maps.ts";
import { bossMetaKey, historyKey, href, LIST_KEY, needs, parse, raceMetaKey, type MapsRoute } from "../web/src/routes.ts";

const at = (p: string) => parse(new URL(p, "https://x.invalid")) as MapsRoute;

describe("maps routes", () => {
  it("round-trips /maps with defaults left out", () => {
    assert.equal(href.maps(), "/maps");
    assert.deepEqual(at("/maps"), { name: "maps", q: "", d: [], water: false, sort: "game" });
    const r = { name: "maps" as const, q: "ouch", d: [0, 2], water: true, sort: "az" as const };
    assert.equal(href.maps(r), "/maps?q=ouch&d=0,2&water=1&sort=az");
    assert.deepEqual(at(href.maps(r)), r);
  });
  it("canonicalises d, q and sort", () => {
    assert.deepEqual(at("/maps?d=3,1,1,9,x,-1,2.5&sort=nope&q=%20%20hi%20").d, [1, 3]);
    assert.equal(at("/maps?q=%20%20hi%20").q, "hi");
    assert.equal(at("/maps?q=" + "a".repeat(80)).q.length, 40);
    assert.equal(at("/maps?sort=nope").sort, "game");
    assert.equal(href.maps({ d: [2, 0, 2, 7] }), "/maps?d=0,2");
  });
  it("round-trips /maps/<id>, including #ouch", () => {
    assert.deepEqual(parse(new URL("/maps/InTheLoop", "https://x.invalid")), { name: "map", id: "InTheLoop" });
    assert.equal(href.map("#ouch"), "/maps/%23ouch");
    assert.deepEqual(parse(new URL(href.map("#ouch"), "https://x.invalid")), { name: "map", id: "#ouch" });
    assert.deepEqual(parse(new URL("/maps/Nope", "https://x.invalid")), { name: "map", id: "Nope" });
  });
  it("needs the lists", () => {
    for (const p of ["/maps", "/maps/InTheLoop"]) assert.deepEqual(needs(at(p)), [LIST_KEY.boss, historyKey("boss"), LIST_KEY.race, historyKey("race")]);
  });
});

describe("map events", () => {
  const ev = (id: string, name: string, bossType: string, start: number) => ({ id, name, bossType, start, end: start + 1e6 });
  const first = BOSS_HISTORY[0]; // oldest wiki row: [type, n, map, start, end]
  const [type, n, wikiMap] = first;
  const data: Record<string, unknown> = {
    [LIST_KEY.boss]: [ev("b1", `${type}${n + 50}`, type, 2e12), ev("b2", `${type}${n + 51}`, type, 2e12 + 5)],
    [historyKey("boss")]: [ev("b1", `${type}${n + 50}`, type, 2e12)],
    [LIST_KEY.race]: [{ id: "r1", name: "Race One", start: 1e12, end: 1e12 + 1 }],
    [historyKey("race")]: [],
    [bossMetaKey("b1", "standard")]: { map: "InTheLoop" },
    [bossMetaKey("b2", "standard")]: { map: "InTheLoop" },
    [raceMetaKey("r1")]: { map: "InTheLoop" },
  };
  const get = <T>(k: string) => data[k] as T | undefined;
  it("merges archive and race, no duplicates, newest first", () => {
    const e = mapEvents("InTheLoop", get);
    assert.deepEqual(e.filter((x) => x.id).map((x) => x.id), ["b2", "b1", "r1"]); // real wiki rows on this map have no id
    assert.ok(e.every((x, i) => !i || e[i - 1].start >= x.start));
    assert.equal(mapCounts(get).boss.get("InTheLoop"), e.filter((x) => x.kind === "boss").length);
    assert.equal(mapCounts(get).race.get("InTheLoop"), 1);
  });
  it("adds wiki rows the archive does not cover (no id), and drops the covered ones", () => {
    const e = mapEvents(wikiMap, get);
    assert.ok(e.some((x) => x.kind === "boss" && !x.id && x.type === type && x.n === n));
    const covered = { ...data, [historyKey("boss")]: [ev("b0", `${type}${n}`, type, 2e12 - 9)], [bossMetaKey("b0", "standard")]: { map: wikiMap } };
    const e2 = mapEvents(wikiMap, <T>(k: string) => covered[k] as T | undefined);
    assert.ok(e2.some((x) => x.kind === "boss" && x.id === "b0"));
    assert.ok(!e2.some((x) => x.kind === "boss" && !x.id && x.type === type && x.n === n));
  });
});

describe("map list", () => {
  it("every map has art and a name", () => {
    // Read as text: art/index.ts imports .webp sheets, which node can't load.
    const art = readFileSync(new URL("../web/src/art/index.ts", import.meta.url), "utf8");
    for (const [id] of MAP_LIST) {
      assert.ok(art.includes(`  ${JSON.stringify(id)}: "`) || art.includes(`  ${id}: "`), `art for ${id}`);
      assert.ok(MAP_NAMES[id], `name for ${id}`);
    }
  });
});
