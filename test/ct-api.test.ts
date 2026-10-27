import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleApi } from "../src/worker/app.ts";
import { ctCutoffStep, ctCutoffTick, cutoffRanks, nextPage } from "../src/worker/ct.ts";
import { DAY, get, makeEnv } from "./harness.ts";

const LIVE = "livect01";
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);
const END = T0 + 5 * DAY;

function liveCt(t: ReturnType<typeof makeEnv>, team = 4780, player = 90000) {
  t.db.raw
    .prepare("INSERT INTO events (kind, id, start_at, end_at, data) VALUES ('ct', ?, ?, ?, ?)")
    .run(LIVE, T0 - DAY, END, JSON.stringify({ id: LIVE, totalScores_team: team, totalScores_player: player }));
}
const rows = (t: ReturnType<typeof makeEnv>, day: number) =>
  t.db.raw.prepare("SELECT board, rank FROM ct_cutoffs WHERE ct_id = ? AND day = ? ORDER BY board, rank").all(LIVE, day) as { board: string; rank: number }[];

describe("ct cut-off snapshots (scheduling)", () => {
  it("cutoffRanks: fixed ranks plus fractions, capped at 1000 and at the board size", () => {
    assert.deepEqual(cutoffRanks("team", 4780), [1, 2, 3, 25, 47, 100, 478]);
    assert.deepEqual(cutoffRanks("player", 0), [25, 100]);
    assert.ok(cutoffRanks("team", 10).every((r) => r <= 10));
  });

  it("nextPage: lowest page holding a missing rank", () => {
    assert.equal(nextPage([1, 25, 100], new Set()), 1);
    assert.equal(nextPage([1, 25, 100], new Set([1, 25])), 4);
    assert.equal(nextPage([1, 25], new Set([1, 25])), null);
  });

  it("one NK page per run, one snapshot per board and UTC day, then silence", async () => {
    const t = makeEnv(T0);
    liveCt(t);
    const ranks = cutoffRanks("team", 4780).length + cutoffRanks("player", 90000).length;
    const calls: number[] = [];
    for (let i = 0; i < 30; i++) {
      const before = t.origin.calls.length;
      await ctCutoffTick(t.deps, { id: LIVE, live: true, end: END }, t.clock.now);
      calls.push(t.origin.calls.length - before);
      t.clock.now += 60_000;
    }
    assert.ok(calls.every((c) => c <= 1), "max one NK page per run");
    const day = Math.floor(T0 / DAY);
    assert.equal(rows(t, day).length, ranks);
    const n = t.origin.calls.length;
    assert.ok(n >= 2 && n <= ranks, `pages fetched: ${n}`);
    await ctCutoffTick(t.deps, { id: LIVE, live: true, end: END }, t.clock.now);
    assert.equal(t.origin.calls.length, n, "same day again: nothing");
    t.clock.now = (day + 1) * DAY + 3600_000;
    await ctCutoffTick(t.deps, { id: LIVE, live: true, end: END }, t.clock.now);
    assert.equal(t.origin.calls.length, n + 1, "next UTC day: a new snapshot starts");
  });

  it("stops at the first error and retries later", async () => {
    const t = makeEnv(T0);
    liveCt(t);
    t.origin.status429.add(`/btd6/ct/${LIVE}/leaderboard/team`);
    await ctCutoffStep(t.deps, LIVE, 1, T0);
    assert.equal(rows(t, 1).length, 0);
    assert.equal(t.origin.calls.length, 1);
    await ctCutoffStep(t.deps, LIVE, 1, T0);
    assert.equal(t.origin.calls.length, 1, "backs off");
  });

  it("the final snapshot (day 0) is taken after the end, once", async () => {
    const t = makeEnv(T0);
    liveCt(t);
    assert.equal(await ctCutoffTick(t.deps, { id: LIVE, live: false, end: END }, END + 1000), 0, "not final yet");
    t.clock.now = END + 6 * 60_000;
    for (let i = 0; i < 20; i++) await ctCutoffTick(t.deps, { id: LIVE, live: false, end: END }, t.clock.now);
    assert.ok(rows(t, 0).length > 0);
    const n = t.origin.calls.length;
    await ctCutoffTick(t.deps, { id: LIVE, live: false, end: END }, t.clock.now);
    assert.equal(t.origin.calls.length, n);
  });
});

describe("GET /api/ct/:id/cutoffs and /api/ct/relics", () => {
  it("cutoffs: snapshots oldest first, empty for an id with none, also in /api/batch", async () => {
    const t = makeEnv(T0);
    liveCt(t);
    for (let d = 1; d <= 2; d++) {
      t.db.raw.prepare("INSERT INTO ct_cutoffs VALUES (?, 'team', ?, 1, ?, ?)").run(LIVE, d, 100 * d, d * 1000);
      t.db.raw.prepare("INSERT INTO ct_cutoffs VALUES (?, 'team', ?, 25, ?, ?)").run(LIVE, d, 50 * d, d * 1000);
    }
    t.db.raw.prepare("INSERT INTO ct_cutoffs VALUES (?, 'player', 2, 100, 7, 2000)").run(LIVE);
    const r = await handleApi(t.deps, get(`/api/ct/${LIVE}/cutoffs`));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control")!, /max-age=300/);
    assert.deepEqual(await r.json(), {
      id: LIVE,
      team: [{ at: 1000, ranks: { 1: 100, 25: 50 } }, { at: 2000, ranks: { 1: 200, 25: 100 } }],
      player: [{ at: 2000, ranks: { 100: 7 } }],
    });
    assert.deepEqual(await (await handleApi(t.deps, get("/api/ct/nothing1/cutoffs"))).json(), { id: "nothing1", team: [], player: [] });
    const b = await handleApi(t.deps, get(`/api/batch?k=${encodeURIComponent(`/api/ct/${LIVE}/cutoffs`)}`));
    const line = JSON.parse((await b.text()).trim());
    assert.equal(line.s, 200);
    assert.equal(line.b.team.length, 2);
    assert.equal(t.origin.calls.length, 0, "no NK requests");
  });

  it("cutoffs of an ended CT are cached for a day", async () => {
    const t = makeEnv(END + 10 * DAY);
    liveCt(t);
    const r = await handleApi(t.deps, get(`/api/ct/${LIVE}/cutoffs`));
    assert.match(r.headers.get("cache-control")!, /max-age=86400/);
  });

  it("relics: archived CTs only, newest first, relic names in tile order", async () => {
    const t = makeEnv();
    const ins = t.db.raw.prepare("INSERT INTO events (kind, id, start_at, end_at, data) VALUES ('ct', ?, ?, ?, '{}')");
    ins.run("oldct001", 1000, 2000);
    ins.run("newct001", 3000, 4000);
    ins.run("liveCt01", 5000, 6000);
    const tiles = (ty: [string, string][]) => JSON.stringify({ success: true, body: { id: "x", tiles: ty.map(([type, gameType]) => ({ id: "A", type, gameType })) } });
    const put = t.db.raw.prepare("INSERT INTO responses (key, body, ok, fetched_at, frozen) VALUES (?, ?, 1, 0, ?)");
    put.run("/btd6/ct/oldct001/tiles", tiles([["Regular", "Race"], ["Relic - Techbot", "Boss"], ["Banner", "Boss"], ["TeamStart", "TeamStart"]]), 1);
    put.run("/btd6/ct/newct001/tiles", tiles([["Relic - ManaBulwark", "Boss"], ["Relic - Techbot", "LeastCash"], ["Regular", "LeastCash"]]), 1);
    put.run("/btd6/ct/liveCt01/tiles", tiles([["Relic - Nope", "Boss"]]), 0);
    const r = await handleApi(t.deps, get("/api/ct/relics"));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), {
      cts: [
        { id: "newct001", start: 3000, end: 4000, relics: ["ManaBulwark", "Techbot"], banners: 0, games: { Boss: 1, LeastCash: 2 } },
        { id: "oldct001", start: 1000, end: 2000, relics: ["Techbot"], banners: 1, games: { Boss: 2, Race: 1 } },
      ],
    });
    const b = await handleApi(t.deps, get(`/api/batch?k=${encodeURIComponent("/api/ct/relics")}`));
    assert.equal(JSON.parse((await b.text()).trim()).b.cts.length, 2);
    assert.equal(t.origin.calls.length, 0);
  });
});
