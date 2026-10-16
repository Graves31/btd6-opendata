// Tools → round visualizer: URL ⇄ route, set resolution for the rules panel's link, event modifiers applied only
// where the game data allows, RBE, and notable rounds computed independently from the set files on disk.
// Run with `node --import ./test/url-imports.ts` (the round index imports its set files with Vite's `?url`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ChallengeDocument } from "../src/nk/types.ts";
import { BLOON_TYPES, BLOONS, ROUND_SET_BY_ID, ROUND_SETS, type RoundSetData } from "../web/src/data/rounds/index.ts";
import { href, needs, NO_MODS, parse, PG_MAX, safeSrc, setRoundKeys, type ParagonRoute, type RoundMods, type RoundsRoute } from "../web/src/routes.ts";
import {
  applyFlags,
  bloonLabel,
  bloonRbe,
  bounds,
  gameId,
  activeFilters,
  changedRuns,
  groupMatches,
  moabMult,
  effGroups,
  pickSet,
  roundMatches,
  typesInRange,
  roundRbe,
  roundRbeParts,
  roundsFor,
  roundSetKeys,
} from "../web/src/rounds.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const setFile = (id: string) => JSON.parse(readFileSync(join(root, "web/src/data/rounds", `${id}.json`), "utf8")) as RoundSetData;
const fixture = (f: string) => (JSON.parse(readFileSync(join(root, "docs/api/fixtures", f), "utf8")) as { body: ChallengeDocument }).body;
const U = (p: string) => new URL(p, "https://x.invalid");
const mods = (m: Partial<RoundMods> = {}): RoundMods => ({ ...NO_MODS, ...m });
const route = (r: Partial<RoundsRoute> = {}): RoundsRoute => ({ name: "rounds", mods: mods(), base: false, has: [], bloon: [], ...r });

describe("rounds route: URL ⇄ route", () => {
  const cases: RoundsRoute[] = [
    route(),
    route({ set: "vortex", from: 1, to: 140, r: 1, view: "round", ev: [1, 140], mods: mods({ bhp: 5, bspd: 0.35 }), src: "/boss/Vortex46_ms8tf3cb?d=elite" }),
    route({ set: "default", from: 79, to: 79, r: 79, mode: "Impoppable", mods: mods({ camo: true, spd: 5, mhp: 0.2 }), base: true, has: ["camo", "moabs"] }),
    route({ set: "alternate", from: 40, mods: mods({ regrow: true, fort: true, hp: 2, rgr: 1.5, mspd: 0.7 }), bloon: ["ceramic", "lead"] }),
    route({ set: "dreadbloon", has: ["changed", "regrow", "fort"], bloon: ["ddt"], r: 50 }),
  ];
  for (const r of cases) {
    it(`round-trips ${href.rounds(r)}`, () => {
      assert.deepEqual(parse(U(href.rounds(r))), r);
    });
  }
  it("writes only non-default values", () => {
    assert.equal(href.rounds({ set: "vortex", mods: mods() }), "/tools/rounds?set=vortex");
    assert.equal(href.rounds({}), "/tools/rounds");
  });
  it("filters are canonical (known values, fixed order) and readable in the URL", () => {
    const r = parse(U("/tools/rounds?set=vortex&has=moabs,camo,bogus,camo&bloon=lead,Ceramic!,ceramic,lead&view=round&r=40")) as RoundsRoute;
    assert.deepEqual(r.has, ["camo", "moabs"]);
    assert.deepEqual(r.bloon, ["ceramic", "lead"]);
    assert.equal(r.view, "round");
    assert.equal(href.rounds(r), "/tools/rounds?set=vortex&r=40&has=camo,moabs&bloon=ceramic,lead&view=round");
    assert.equal((parse(U("/tools/rounds?view=list")) as RoundsRoute).view, undefined);
  });
  it("the first version's notable=1 becomes the boss-set filter", () => {
    assert.deepEqual((parse(U("/tools/rounds?set=vortex&notable=1")) as RoundsRoute).has, ["changed"]);
  });
  it("bare /tools is the hub; /tools with round params is still the visualizer", () => {
    assert.deepEqual(parse(U("/tools")), { name: "tools" });
    assert.equal(parse(U("/tools?set=vortex")).name, "rounds");
    assert.equal(parse(U("/tools?utm=x")).name, "tools");
    assert.deepEqual(parse(U("/tools/rounds")), route());
    assert.equal(parse(U("/tools/other")).name, "notfound");
  });
  it("ignores malformed values", () => {
    const r = parse(U("/tools/rounds?set=../x&from=abc&to=-4&r=1e3&hp=0&mhp=nope&spd=-2&camo=yes&mode=%3Cb%3E")) as RoundsRoute;
    assert.deepEqual(r, route());
  });
  it("src must be a known page of this site (no open redirect)", () => {
    assert.equal(safeSrc("/boss/Vortex47_mu62cmt5?d=elite"), "/boss/Vortex47_mu62cmt5?d=elite");
    assert.equal(safeSrc("/challenge/ZFVHOWM"), "/challenge/ZFVHOWM");
    for (const bad of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "/nope/a/b/c", "/tools/rounds?set=x", ""]) {
      assert.equal(safeSrc(bad), undefined, bad);
    }
    const r = parse(U(`/tools/rounds?src=${encodeURIComponent("//evil.example")}`)) as RoundsRoute;
    assert.equal(r.src, undefined);
  });
  it("needs() is the set's static file, plus Default's for any other set (once the browser registers the resolver)", () => {
    setRoundKeys(roundSetKeys);
    const def = ROUND_SET_BY_ID.default!.url;
    try {
      assert.deepEqual(needs(parse(U("/tools/rounds"))), [def]);
      assert.deepEqual(needs(parse(U("/tools/rounds?set=vortex"))), [ROUND_SET_BY_ID.vortex!.url, def]);
      assert.deepEqual(needs(parse(U("/tools/rounds?mode=AlternateBloonsRounds"))), [ROUND_SET_BY_ID.alternate!.url, def]);
      assert.deepEqual(needs(parse(U("/tools/rounds?set=nope"))), []);
      assert.deepEqual(needs(parse(U("/tools/rounds?mode=Apopalypse"))), []);
      for (const k of needs(parse(U("/tools/rounds?set=lych")))) assert.ok(!k.startsWith("/api/") && !k.includes("ninjakiwi"), k);
    } finally {
      setRoundKeys(() => []);
    }
  });
});

describe("rounds: set resolution and range", () => {
  it("picks the set: set= wins, then mode, random for Apopalypse, unknown ids flagged", () => {
    assert.equal((pickSet({ set: "vortex" }) as { info: { id: string } }).info.id, "vortex");
    assert.equal((pickSet({ mode: "AlternateBloonsRounds" }) as { info: { id: string } }).info.id, "alternate");
    assert.equal((pickSet({}) as { info: { id: string } }).info.id, "default");
    assert.deepEqual(pickSet({ mode: "Apopalypse" }), { kind: "random", mode: "Apopalypse" });
    assert.deepEqual(pickSet({ set: "nope" }), { kind: "unknown", id: "nope" });
  });
  it("clamps and swaps the range, clamps the open round into it", () => {
    const info = { first: 1, last: 140 };
    assert.deepEqual(bounds(info, {}), { from: 1, to: 140, open: undefined });
    assert.deepEqual(bounds(info, { from: 90, to: 20, r: 5 }), { from: 20, to: 90, open: 20 });
    assert.deepEqual(bounds(info, { from: 500, to: 999, r: 999 }), { from: 140, to: 140, open: 140 });
  });
});

describe("rules panel link (resolveRoundSet)", () => {
  it("a Vortex boss event links to the Vortex set with its range, modifiers and src", () => {
    const d = fixture("btd6__bosses__Vortex46_ms8tf3cb__metadata__elite.json");
    const rs = roundsFor(d, "/boss/Vortex46_ms8tf3cb?d=elite");
    assert.equal(rs.kind, "link");
    if (rs.kind !== "link") return;
    assert.equal(rs.info.id, "vortex");
    const r = parse(U(rs.href)) as RoundsRoute;
    assert.equal(r.set, "vortex");
    assert.equal(r.from, d.startRound);
    assert.equal(r.to, d.endRound);
    assert.equal(r.r, d.startRound);
    assert.equal(r.view, "round", "arrives on the focused round view");
    assert.deepEqual(r.ev, [d.startRound, d.endRound]);
    assert.equal(r.mode, d.mode === "Standard" ? undefined : d.mode);
    assert.equal(r.mods.bhp, d._bloonModifiers.healthMultipliers.boss);
    assert.equal(r.mods.bspd, d._bloonModifiers.bossSpeedMultiplier);
    assert.equal(r.src, "/boss/Vortex46_ms8tf3cb?d=elite");
  });
  it("an event round set from NK's server settings wins over default and the mode (Diamondback 8: CHIMPS boss)", () => {
    const d = { ...fixture("btd6__bosses__Vortex46_ms8tf3cb__metadata__elite.json"), roundSets: ["default", "chimpsboss"], mode: "Clicks" };
    const rs = roundsFor(d);
    assert.equal(rs.kind, "link");
    if (rs.kind !== "link") return;
    assert.equal(rs.info.id, "chimpsboss");
    assert.equal(rs.info.group, "event");
    assert.equal(ROUND_SET_BY_ID.chimpsboss!.last, 140);
  });
  it("a single-round challenge gets from = to = r, with all-camo", () => {
    const d = fixture("btd6__challenges__challenge__ZFVHOWM.json");
    const rs = roundsFor(d);
    assert.equal(rs.kind, "link");
    const r = parse(U((rs as { href: string }).href)) as RoundsRoute;
    assert.equal(r.set, "default");
    assert.equal(r.from, d.startRound);
    assert.equal(r.to, d.startRound);
    assert.equal(r.r, d.startRound);
    assert.equal(r.mods.camo, true);
    assert.equal(r.mods.mhp, d._bloonModifiers.healthMultipliers.moabs);
  });
  const base = fixture("btd6__races__Gun_Game_mu19oabt__metadata.json");
  it("resolves ABR from the mode even when roundSets only says default", () => {
    const rs = roundsFor({ ...base, roundSets: ["default"], mode: "AlternateBloonsRounds" });
    assert.equal(rs.kind === "link" && rs.info.id, "alternate");
  });
  it("Apopalypse: random rounds, no link", () => {
    assert.deepEqual(roundsFor({ ...base, mode: "Apopalypse" }), { kind: "random" });
  });
  it("an unknown set stays unknown; Fast Track links to the default set from the event's start round", () => {
    assert.deepEqual(roundsFor({ ...base, roundSets: ["default", "SomethingNew"] }), { kind: "unknown" });
    const ft = roundsFor({ ...base, roundSets: ["default", "fasttrack"], startRound: 35, endRound: 80 });
    assert.equal(ft.kind === "link" && ft.info.id, "default");
    assert.equal(ft.kind === "link" && ft.fastTrack, true);
    assert.equal((parse(U((ft as { href: string }).href)) as RoundsRoute).from, 35);
  });
  it("every roundSets value in the fixtures resolves (Apopalypse aside)", () => {
    for (const f of ["btd6__bosses__Vortex47_mu62cmt5__metadata__standard.json", "btd6__challenges__challenge__rot296620260924.json", "btd6__races__Party_Madness_muekt6x6__metadata.json"]) {
      assert.equal(roundsFor(fixture(f)).kind, "link", f);
    }
  });
});

describe("rounds: modifiers only where the variant exists", () => {
  it("camo lands on bloons with a camo variant, not on MOAB-class types without one", () => {
    assert.equal(applyFlags("red", 0, mods({ camo: true })), 1);
    assert.equal(applyFlags("ceramic", 0, mods({ camo: true })), 1);
    for (const k of ["moab", "bfb", "zomg", "bad"]) {
      assert.ok(!BLOON_TYPES[k]!.variants.includes(1), `${k} has no camo variant in the data`);
      assert.equal(applyFlags(k, 0, mods({ camo: true })), 0, k);
    }
  });
  it("fortified only where defined; flags combine to the richest defined variant", () => {
    assert.equal(applyFlags("red", 0, mods({ fort: true })), 0);
    assert.equal(applyFlags("lead", 0, mods({ fort: true })), 4);
    assert.equal(applyFlags("moab", 0, mods({ fort: true })), 4);
    assert.equal(applyFlags("ceramic", 0, mods({ camo: true, regrow: true, fort: true })), 7);
    assert.equal(applyFlags("moab", 0, mods({ camo: true, regrow: true, fort: true })), 4);
    assert.equal(applyFlags("ddt", 1, mods({ fort: true })), 5);
    for (const [k, t] of Object.entries(BLOON_TYPES)) {
      const f = applyFlags(k, 0, mods({ camo: true, regrow: true, fort: true }));
      assert.ok(t.variants.includes(f), `${k} → ${f}`);
    }
  });
  it("names and game ids follow the game's scheme", () => {
    assert.equal(gameId("ceramic", 7), "CeramicRegrowFortifiedCamo");
    assert.equal(bloonLabel("ceramic", 3), "Camo regrow ceramic");
    assert.equal(bloonLabel("moab", 4), "Fortified MOAB");
  });
});

describe("rounds: RBE", () => {
  it("unmodified RBE is the data's; the sum over groups agrees with it", () => {
    for (const id of ["default", "alternate", "vortex"]) {
      for (const round of setFile(id).rounds) {
        assert.equal(roundRbe(round, mods()), round.rbe, `${id} ${round.n}`);
        const sum = round.g.reduce((s, [k, f, n]) => s + bloonRbe(k, f)! * n, 0);
        assert.equal(sum, round.rbe, `${id} ${round.n} group sum`);
      }
    }
  });
  it("a MOAB-health multiplier rescales only the MOAB-class layers (rbeMoab)", () => {
    const rounds = setFile("default").rounds;
    const round = rounds.find((r) => (r.rbeMoab ?? 0) > 0)!;
    assert.equal(roundRbe(round, mods(), 1.5), round.rbe! + round.rbeMoab! * 0.5);
    const p = roundRbeParts(round, mods(), 2)!;
    assert.equal(p.moab, round.rbeMoab! * 2);
    const moab = BLOONS.Moab!;
    assert.equal(bloonRbe("moab", 0, 1.5), moab.rbe! + moab.rbeMoab! * 0.5);
    // bloon-only rounds don't change
    const early = rounds[0]!;
    assert.equal(roundRbe(early, mods(), 3), early.rbe);
  });
  it("fortified raises RBE through the fortified variants' own health", () => {
    const round = setFile("default").rounds.find((r) => r.g.some(([k, f]) => k === "ceramic" && f === 0))!;
    assert.ok(roundRbe(round, mods({ fort: true }))! > round.rbe!);
  });
  it("the applied MOAB multiplier: the event's, else the mode's own rule, never with Base rounds", () => {
    assert.equal(moabMult({ mods: mods({ mhp: 1.5 }), base: false }), 1.5);
    assert.equal(moabMult({ mods: mods({ mhp: 1.5 }), base: true }), 1);
    assert.equal(moabMult({ mods: mods(), base: false, mode: "DoubleMoabHealth" }), 2);
  });
  it("Legends-only bloons without a health tree give no RBE instead of a guess", () => {
    const set = ROUND_SETS.find((s) => !s.hasRbe)!;
    const round = setFile(set.id).rounds.find((r) => r.rbe === undefined)!;
    assert.equal(roundRbe(round, mods()), undefined);
  });
});

describe("rounds: filters (any of) and boss-set changes", () => {
  const def = setFile("default").rounds;
  const f = (has: RoundsRoute["has"] = [], bloon: string[] = []) => ({ has, bloon });
  const any = (r: (typeof def)[number], test: (k: string, fl: number) => boolean, m = mods()) => effGroups(r, m).some((g) => test(g.key, g.flags));
  it("each filter matches exactly the rounds with such a group (after modifiers)", () => {
    const cases: [ReturnType<typeof f>, (k: string, fl: number) => boolean][] = [
      [f(["camo"]), (_, fl) => (fl & 1) === 1],
      [f(["regrow"]), (_, fl) => (fl & 2) === 2],
      [f(["fort"]), (_, fl) => (fl & 4) === 4],
      [f(["moabs"]), (k) => BLOON_TYPES[k]!.moab],
      [f([], ["lead"]), (k) => k === "lead"],
      [f([], ["ceramic", "ddt"]), (k) => k === "ceramic" || k === "ddt"],
    ];
    for (const [flt, test] of cases) {
      for (const r of def) assert.equal(roundMatches(r, flt, mods()), any(r, test), `${JSON.stringify(flt)} round ${r.n}`);
    }
  });
  it("several filters match ANY of them", () => {
    const both = f(["camo"], ["lead"]);
    for (const r of def) {
      const want = roundMatches(r, f(["camo"]), mods()) || roundMatches(r, f([], ["lead"]), mods());
      assert.equal(roundMatches(r, both, mods()), want, `round ${r.n}`);
    }
    const leadOnly = def.find((r) => any(r, (k) => k === "lead") && !any(r, (_, fl) => (fl & 1) === 1));
    assert.ok(leadOnly && roundMatches(leadOnly, both, mods()), "a lead round without camo still matches camo OR lead");
  });
  it("event modifiers count: with all-camo, every round with a camo-capable bloon matches Camo", () => {
    for (const r of def) {
      const capable = r.g.some(([k]) => BLOON_TYPES[k]!.variants.some((v) => (v & 1) === 1));
      assert.equal(roundMatches(r, f(["camo"]), mods({ camo: true })), capable, `round ${r.n}`);
    }
    assert.equal(groupMatches({ key: "moab", flags: 0 }, f(["moabs"])), true);
    assert.equal(groupMatches({ key: "ceramic", flags: 0 }, f(["moabs"])), false);
  });
  it("'changed' only applies on a boss set, and matches its changed rounds", () => {
    assert.deepEqual(activeFilters(f(["changed", "camo"]), ROUND_SET_BY_ID.default!).has, ["camo"]);
    const vortex = setFile("vortex").rounds;
    const info = ROUND_SET_BY_ID.vortex!;
    const hits = vortex.filter((r) => roundMatches(r, activeFilters(f(["changed"]), info), mods())).map((r) => r.n);
    assert.deepEqual(hits, info.overrides);
  });
  it("changed rounds are grouped into runs (one ribbon per run), clipped to the range", () => {
    const info = ROUND_SET_BY_ID.dreadbloon!;
    const runs = changedRuns(setFile("dreadbloon").rounds, info.first, info.last);
    assert.deepEqual(runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)), info.overrides);
    for (let i = 1; i < runs.length; i++) assert.ok(runs[i]![0] > runs[i - 1]![1] + 1, "runs are separated by an unchanged round");
    assert.ok(runs.length < info.overrides!.length, "consecutive changed rounds share a run");
    const v = changedRuns(setFile("vortex").rounds, 35, 60);
    assert.ok(v.every(([a, b]) => a >= 35 && b <= 60));
    assert.deepEqual(changedRuns(setFile("default").rounds, 1, 140), []);
  });
  it("the Bloon menu lists the types used in the range", () => {
    const t = typesInRange(def, 1, 10);
    assert.ok(t.includes("red") && !t.includes("moab"));
    assert.ok(typesInRange(def, 1, 140).includes("bad"));
  });
});

describe("rounds: bloonVariant sprite sheet covers the variants", () => {
  it("every variant with its own game icon has a cell (Tools pages only)", () => {
    const manifest = JSON.parse(readFileSync(join(root, "web/src/art/manifest.json"), "utf8")) as { families: Record<string, { keys: string[] }> };
    const keys = new Set(manifest.families.bloonVariant?.keys ?? []);
    for (const [k, t] of Object.entries(BLOON_TYPES)) {
      if (!t.sprite) continue; // Legends-only bloons: text chip
      for (const [f, icon] of Object.entries(t.icons)) {
        if (f !== "0" && icon !== t.icons["0"]) assert.ok(keys.has(`${k}:${f}`), `${k}:${f}`);
      }
    }
  });
});

describe("tools hub and paragon calculator routes", () => {
  it("/tools/paragon: defaults, short keys, clamping, ignored junk", () => {
    const d = parse(U("/tools/paragon")) as ParagonRoute;
    assert.equal(d.name, "paragon");
    assert.equal(d.picked, false);
    assert.equal(d.diff, "medium");
    assert.equal(d.cash + d.pops + d.totems, 0);
    const r = parse(U("/tools/paragon?p=dart&d=i&co=1&c=85000000&to=3&tg=60&adv=1&x=abc&po=-5&t=99999999")) as ParagonRoute;
    assert.deepEqual([r.tower, r.diff, r.cash, r.totems, r.target, r.adv, r.picked], ["DartMonkey", "impoppable", 85_000_000, 3, 60, true, true]);
    assert.equal(r.extraT5, 0);
    assert.equal(r.pops, 0);
    assert.equal(r.tiers, PG_MAX.tiers);
    assert.equal((parse(U("/tools/paragon?tg=1")) as ParagonRoute).target, undefined);
    assert.equal((parse(U("/tools/paragon?p=nope&d=z")) as ParagonRoute).picked, false);
    assert.equal(parse(U("/tools/paragon/x")).name, "notfound");
  });
  it("/tools/paragon-scaling: degree param", () => {
    assert.deepEqual(parse(U("/tools/paragon-scaling")), { name: "pgscaling", d: undefined, to: undefined });
    assert.deepEqual(parse(U("/tools/paragon-scaling?d=40")), { name: "pgscaling", d: 40, to: undefined });
    assert.deepEqual(parse(U("/tools/paragon-scaling?d=40&to=75")), { name: "pgscaling", d: 40, to: 75 });
    assert.equal((parse(U("/tools/paragon-scaling?to=0")) as { to?: number }).to, undefined);
    assert.equal((parse(U("/tools/paragon-scaling?to=101")) as { to?: number }).to, undefined);
    assert.equal(href.paragonScaling(40, 75), "/tools/paragon-scaling?d=40&to=75");
    assert.equal((parse(U("/tools/paragon-scaling?d=101")) as { d?: number }).d, undefined);
    assert.equal(href.paragonScaling(), "/tools/paragon-scaling");
    assert.equal(href.paragonScaling(40), "/tools/paragon-scaling?d=40");
  });
  it("href.paragon leaves defaults out and round-trips", () => {
    assert.equal(href.paragon(), "/tools/paragon");
    assert.equal(href.tools(), "/tools");
    const r = parse(U("/tools/paragon?p=ninja&d=h&c=1200000&to=2&tg=40&b=1")) as ParagonRoute;
    assert.equal(r.boost, true);
    assert.equal(href.paragon(r), "/tools/paragon?p=ninja&d=h&c=1200000&to=2&tg=40&b=1");
    // adv=1 (old links) is read but no longer written.
    const old = parse(U("/tools/paragon?p=ninja&adv=1")) as ParagonRoute;
    assert.equal(old.boost, false);
    assert.equal(href.paragon(old), "/tools/paragon?p=ninja");
    assert.equal(href.paragon({ diff: "medium" }, true), "/tools/paragon?p=dart&d=m");
  });
  it("needs no data", () => {
    assert.deepEqual(needs(parse(U("/tools"))), []);
    assert.deepEqual(needs(parse(U("/tools/paragon?p=ice"))), []);
  });
});
