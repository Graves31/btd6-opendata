import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runArchive, ARCHIVE_BUDGET } from "../src/worker/archive.ts";
import { MIN_REFETCH_MS, REFRESH_CAP, refreshHot, resetHotState } from "../src/worker/hot.ts";
import { readFileSync } from "node:fs";
import { handleApi, handleRequest, runScheduled } from "../src/worker/app.ts";
import { clientKey, TokenBuckets } from "../src/worker/limit.ts";
import { buildHotText, HOT_KEY, hotBody, mem, resetHotMemo, viewOf, type HotBundle } from "../src/worker/store.ts";
import { MAX_BATCH } from "../src/worker/proxy.ts";
import { handleStats, resetStatsMemo, shapeStats } from "../src/worker/stats.ts";
import { CAPTURED_AT, DAY, HOUR, MIN, get, makeEnv } from "./harness.ts";
import { MAP_LIST } from "../web/src/data/names.ts";

/** Origin requests for hot-set keys (excludes the profile warmer's /users and /guild fetches). */
const hotCalls = (t: { origin: { calls: string[] } }) => t.origin.calls.filter((c) => !/^\/btd6\/(users|guild)\//.test(c)).length;

const BOSS = "Vortex47_mu62cmt5"; // ended 2026-09-24 03:00 UTC, i.e. inside the 24 h grace at capture time
const CHALLENGE = "/api/nk/btd6/challenges/challenge/ZFVHOWM";

describe("proxy", () => {
  it("miss → origin → D1; repeat → memory; model stripped", async () => {
    const t = makeEnv();
    const r1 = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("X-Cache"), "ORIGIN");
    assert.match(r1.headers.get("Cache-Control")!, /^public, max-age=3600, stale-while-revalidate=2592000$/);
    const body = await r1.json();
    assert.equal(body.success, true);
    assert.equal(body.model, undefined);
    assert.equal(body.body.id, "ZFVHOWM");
    assert.equal(t.origin.calls.length, 1);
    assert.ok(t.db.raw.prepare("SELECT 1 FROM responses WHERE key = ?").get("/btd6/challenges/challenge/ZFVHOWM"));

    const r2 = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r2.headers.get("X-Cache"), "MEM");
    mem.clear();
    const r3 = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r3.headers.get("X-Cache"), "D1");
    assert.equal(t.origin.calls.length, 1, "served from cache without touching the origin");
  });

  it("answers If-None-Match with 304", async () => {
    const t = makeEnv();
    const etag = (await handleApi(t.deps, get(CHALLENGE))).headers.get("ETag")!;
    const r = await handleApi(t.deps, get(CHALLENGE, { "If-None-Match": etag }));
    assert.equal(r.status, 304);
  });

  it("rejects invalid and private requests without calling the origin", async () => {
    const t = makeEnv();
    const cases: [string, number][] = [
      [`/api/nk/btd6/bosses/${BOSS}/leaderboard/standard/5`, 404],
      [`/api/nk/btd6/bosses/${BOSS}/metadata/hard`, 404],
      ["/api/nk/btd6/races/Gun_Game_mu19oabt/leaderboard?page=21", 404],
      ["/api/nk/btd6/save/some-oak", 403],
      ["/api/nk/btd6/users/oak_abcdef", 403],
      ["/api/nk/btd6/doesnotexist", 404],
      ["/api/elsewhere", 404],
    ];
    for (const [path, status] of cases) assert.equal((await handleApi(t.deps, get(path))).status, status, path);
    assert.equal(t.origin.calls.length, 0);
  });

  it("normalises the cache key (pretty, junk params, page=1)", async () => {
    const t = makeEnv();
    await handleApi(t.deps, get("/api/nk/btd6/maps/filter/newest?pretty=true&x=1"));
    await handleApi(t.deps, get("/api/nk/btd6/maps/filter/newest?page=1"));
    await handleApi(t.deps, get("/api/nk/btd6/maps/filter/newest?page=0"));
    assert.deepEqual(t.origin.calls, ["/btd6/maps/filter/newest"]);
  });

  it("stale-while-revalidate, then stale-if-error", async () => {
    const t = makeEnv();
    await handleApi(t.deps, get(CHALLENGE));
    t.clock.now += 2 * HOUR; // past the 1 h fresh window, inside the 30 d stale window
    const stale = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(stale.headers.get("X-Cache"), "MEM-STALE");
    assert.equal(t.pending.length, 1, "background refresh scheduled");
    await t.settle();
    assert.equal(t.origin.calls.length, 2);

    t.origin.down = true;
    t.clock.now += 40 * DAY; // beyond fresh + stale: must try the origin, which is down
    const r = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("X-Cache"), "MEM-STALE-IF-ERROR");
  });

  it("returns 502 when there is no copy and the origin is down", async () => {
    const t = makeEnv();
    t.origin.down = true;
    assert.equal((await handleApi(t.deps, get(CHALLENGE))).status, 502);
  });

  it("negative-caches unknown IDs for an hour", async () => {
    const t = makeEnv();
    const path = "/api/nk/btd6/maps/map/ZZZZZZZ";
    const r1 = await handleApi(t.deps, get(path));
    assert.equal((await r1.json()).success, false);
    await handleApi(t.deps, get(path));
    assert.equal(t.origin.calls.length, 1);
    t.clock.now += HOUR + 1;
    await handleApi(t.deps, get(path));
    assert.equal(t.origin.calls.length, 2);
  });
});

describe("hot bundle (per-minute cron)", () => {
  it("builds the hot set and only re-asks NK once its CDN copy has expired", async () => {
    const t = makeEnv();
    // Archived rows NK no longer lists: an upcoming one (pulled before it began) goes, a past one stays.
    const row = t.db.raw.prepare("INSERT INTO events (kind, id, start_at, end_at, data) VALUES ('boss', ?, ?, ?, '{}')");
    row.run("Ghost1_pulled", CAPTURED_AT + DAY, CAPTURED_AT + 2 * DAY);
    row.run("Old1_archived", CAPTURED_AT - 400 * DAY, CAPTURED_AT - 395 * DAY);
    const r1 = await refreshHot(t.deps);
    const ids = (t.db.raw.prepare("SELECT id FROM events WHERE kind = 'boss'").all() as { id: string }[]).map((r) => r.id);
    assert.ok(!ids.includes("Ghost1_pulled") && ids.includes("Old1_archived"), "pulled upcoming event dropped, history kept");
    assert.equal(r1.published, true);
    assert.equal(r1.failed.length, 0);
    assert.ok(r1.fetched <= 45, `stays under the 50-subrequest cap (fetched ${r1.fetched})`);
    assert.equal(r1.featured.boss, BOSS);
    assert.equal(r1.featured.odyssey, "muekowzs");
    assert.equal(r1.featured.race, null);
    assert.equal(r1.featured.ct, null);

    const bundle = JSON.parse(t.kv.store.get(HOT_KEY)!) as HotBundle;
    for (const type of ["standard", "elite"]) {
      for (let s = 1; s <= 4; s++) assert.ok(bundle.entries[`/btd6/bosses/${BOSS}/leaderboard/${type}/${s}`]);
    }
    assert.ok(bundle.entries["/btd6/challenges/challenge/rot296620260924"], "daily challenge document");
    assert.ok(Object.values(bundle.entries).every((e) => !("model" in e.data)));
    const listed = t.db.raw.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    assert.ok(listed.n >= 30, `events archived from lists (${listed.n})`);

    // +1 min: NK's CDN copies (max-age 300, Age 0) are still valid → no hot key is requested
    // (only the profile warmer's few fetches, which are counted separately).
    const calls = hotCalls(t);
    t.clock.now += MIN;
    row.run("Ghost2_pulled", CAPTURED_AT + DAY, CAPTURED_AT + 2 * DAY); // left over from before: no list change needed
    const r2 = await refreshHot(t.deps);
    assert.equal(r2.fetched, 0);
    assert.equal(t.db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE id = 'Ghost2_pulled'").get()!.n, 0, "dropped on a quiet run");
    assert.equal(r2.skipped, r1.fetched);
    assert.equal(hotCalls(t), calls);

    // +5 min: NK's copies expired. Only the 6 lists are due (conditional, all 304): rules, maps and the daily
    // challenge wait for their floors (MIN_REFETCH_MS), the ended boss's final boards for an hour. At most
    // REFRESH_CAP.perRun are asked per run; the 6th waits a minute.
    t.clock.now += 4 * MIN + 1;
    const r3 = await refreshHot(t.deps);
    assert.equal(r3.fetched, REFRESH_CAP.perRun);
    assert.equal(r3.deferred, 6 - REFRESH_CAP.perRun);
    assert.equal(r3.changed, 0);
    assert.equal(r3.published, false);
    assert.equal(t.kv.puts, 1);

    // +11 min: heartbeat publish even without changes.
    t.clock.now += 6 * MIN;
    assert.equal((await refreshHot(t.deps)).published, true);
    assert.equal(t.kv.puts, 2);

    // +1 h: everything is due again; it's asked over the next few minutes, a few per run.
    t.clock.now += HOUR;
    let asked = 0;
    for (let i = 0; i < 10; i++) {
      const r = await refreshHot(t.deps);
      assert.ok(r.fetched <= REFRESH_CAP.perRun);
      asked += r.fetched;
      if (!r.deferred) break;
      t.clock.now += MIN;
    }
    assert.ok(asked >= r1.fetched, `${asked} of ${r1.fetched} keys asked again`);
  });

  it("refresh floors cut the hot cron's NK traffic to under a third", async (tc) => {
    const day = async () => {
      const t = makeEnv();
      t.origin.ageS = 240; // NK's CDN serves old copies (as observed live): re-asked a minute after each fetch
      await refreshHot(t.deps);
      const calls = hotCalls(t);
      for (let i = 0; i < 1440; i++) {
        t.clock.now += MIN;
        await refreshHot(t.deps);
      }
      return hotCalls(t) - calls;
    };
    const withFloors = await day();
    const floors = { ...MIN_REFETCH_MS };
    const cap = REFRESH_CAP.perRun;
    tc.after(() => {
      Object.assign(MIN_REFETCH_MS, floors);
      REFRESH_CAP.perRun = cap;
    });
    for (const k of Object.keys(MIN_REFETCH_MS)) delete MIN_REFETCH_MS[k as keyof typeof MIN_REFETCH_MS];
    REFRESH_CAP.perRun = Infinity;
    const without = await day(); // the old behaviour: every key at NK's CDN expiry (final boards still hourly)
    console.log(`    hot-set NK requests over a simulated day: ${withFloors} (without floors: ${without})`);
    assert.ok(withFloors * 3 < without, `${withFloors} vs ${without}`);
  });

  it("publishes changes at most every 2 minutes (≤ 720 KV writes/day)", async (tc) => {
    const t = makeEnv();
    t.origin.ageS = 240; // CDN copies expire after 60 s → every key is re-asked each minute
    const floors = { ...MIN_REFETCH_MS };
    MIN_REFETCH_MS.list = 0; // lists re-asked every minute too: a change can land a minute after a publish
    tc.after(() => {
      for (const k of Object.keys(MIN_REFETCH_MS)) delete MIN_REFETCH_MS[k as keyof typeof MIN_REFETCH_MS];
      Object.assign(MIN_REFETCH_MS, floors);
    });
    await refreshHot(t.deps);
    const puts = t.kv.puts;

    t.clock.now += MIN;
    t.origin.override.set("/btd6/races", JSON.stringify({ error: null, success: true, body: [], next: null, prev: null }));
    const r1 = await refreshHot(t.deps);
    assert.ok(r1.changed > 0);
    assert.equal(r1.published, false, "1 min after the last publish: held back");
    const dirty = t.db.raw.prepare("SELECT dirty FROM hot_state").get() as { dirty: number };
    assert.equal(dirty.dirty, 1, "pending change remembered in D1");

    t.clock.now += MIN;
    const r2 = await refreshHot(t.deps);
    assert.equal(r2.changed, 0);
    assert.equal(r2.published, true, "published once 2 min have passed");
    assert.equal(t.kv.puts, puts + 1);

    // A full day of per-minute runs with constant churn stays under the free KV limit.
    let n = 0;
    for (let i = 0; i < 1440; i++) {
      t.clock.now += MIN;
      t.origin.override.set("/btd6/races", JSON.stringify({ error: null, success: true, body: [], next: null, prev: null, i }));
      if ((await refreshHot(t.deps)).published) n++;
    }
    assert.ok(n <= 720, `${n} KV writes in 24 h`);
  });

  it("proxy serves hot keys without the origin; /api/now returns the bundle", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    resetHotMemo();
    const calls = t.origin.calls.length;

    const r = await handleApi(t.deps, get(`/api/nk/btd6/bosses/${BOSS}/leaderboard/elite/3`));
    assert.equal(r.headers.get("X-Cache"), "HOT");
    t.clock.now += 12 * MIN; // cron slack: still served from HOT without a refresh
    mem.clear();
    const r2 = await handleApi(t.deps, get("/api/nk/btd6/bosses"));
    assert.equal(r2.headers.get("X-Cache"), "HOT");
    assert.equal(t.pending.length, 0);
    assert.equal(t.origin.calls.length, calls);

    const now = await handleApi(t.deps, get("/api/now"));
    assert.equal(now.status, 200);
    assert.equal((await now.json()).featured.boss, BOSS);
    const etag = now.headers.get("ETag")!;
    assert.match(etag, /^W\/"\d+-[0-9a-z]+"$/);
    assert.equal((await handleApi(t.deps, get("/api/now", { "If-None-Match": etag }))).status, 304, "unchanged bundle: 304");
  });

  it("/api/now is 503 before the first cron run", async () => {
    const t = makeEnv();
    assert.equal((await handleApi(t.deps, get("/api/now"))).status, 503);
  });

  it("answers upcoming-event leaderboards locally", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const calls = t.origin.calls.length;
    const r = await handleApi(t.deps, get("/api/nk/btd6/races/Party_Madness_muekt6x6/leaderboard"));
    assert.equal(r.headers.get("X-Cache"), "SYNTHETIC");
    assert.deepEqual(await r.json(), { error: "No Scores Available", success: false });
    assert.equal(t.origin.calls.length, calls);
  });
});

describe("archive (cron)", () => {
  it("freezes every page of ended events, then serves them as immutable", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CAPTURED_AT + 3 * DAY;

    let runs = 0;
    let fetchedTotal = 0;
    for (;;) {
      const before = t.origin.calls.length;
      const r = await runArchive(t.deps);
      assert.ok(t.origin.calls.length - before <= ARCHIVE_BUDGET, "per-run budget respected");
      fetchedTotal += r.fetched;
      runs++;
      if (r.queued === 0 && r.expanded.length === 0) break;
      assert.ok(runs < 500, "archive terminates");
    }
    const states = t.db.raw.prepare("SELECT archive_state AS s, COUNT(*) AS n FROM events GROUP BY archive_state").all() as { s: number; n: number }[];
    const due = t.db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE end_at + ? <= ?").get(DAY, t.clock.now) as { n: number };
    assert.equal(states.find((x) => x.s === 2)?.n, due.n, "all due events fully archived");

    const lastPage = `/btd6/bosses/${BOSS}/leaderboard/standard/1?page=40`;
    const row = t.db.raw.prepare("SELECT frozen FROM responses WHERE key = ?").get(lastPage) as { frozen: number };
    assert.equal(row.frozen, 1);
    console.log(`    archived ${due.n} events in ${runs} runs, ${fetchedTotal} upstream requests`);

    mem.clear();
    const calls = t.origin.calls.length;
    const r = await handleApi(t.deps, get(`/api/nk${lastPage}`));
    assert.equal(r.headers.get("X-Frozen"), "1");
    assert.equal(r.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    t.clock.now += 400 * DAY;
    await handleApi(t.deps, get(`/api/nk${lastPage}`));
    assert.equal(t.origin.calls.length, calls, "frozen data never refetched");
  });

  it("never replaces data we hold with an upstream error when freezing", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const key = "/btd6/races/Gun_Game_mu19oabt/metadata";
    await handleApi(t.deps, get(`/api/nk${key}`)); // good copy in D1
    t.origin.override.set(key, JSON.stringify({ error: "No Race with that ID exists", success: false }));
    t.clock.now = CAPTURED_AT + 3 * DAY;
    for (let i = 0; i < 300; i++) if ((await runArchive(t.deps)).queued === 0) break;
    const row = t.db.raw.prepare("SELECT ok, frozen FROM responses WHERE key = ?").get(key) as { ok: number; frozen: number };
    assert.deepEqual({ ...row }, { ok: 1, frozen: 1 });
  });
});

describe("history", () => {
  it("lists every event seen, newest first", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const r = await handleApi(t.deps, get("/api/history/boss?limit=3"));
    const { body } = await r.json();
    assert.equal(body.length, 3);
    assert.ok(body[0].start >= body[1].start && body[1].start >= body[2].start);
    assert.equal((await handleApi(t.deps, get("/api/history/nope"))).status, 404);
  });
});

describe("batch (prefetch)", () => {
  const lines = async (r: Response) => (await r.text()).trim().split(/\n/).map((l) => JSON.parse(l));

  it("resolves many keys in one invocation, streamed as NDJSON", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    const calls = t.origin.calls.length;
    const keys = [
      `/btd6/bosses/${BOSS}/leaderboard/elite/2`,
      "/btd6/challenges/challenge/ZFVHOWM",
      `/btd6/bosses/${BOSS}/leaderboard/standard/1?page=2`,
      `/btd6/bosses/${BOSS}/metadata/hard`,
      "/btd6/maps/map/ZMYWROV/preview",
    ];
    const r = await handleApi(t.deps, get(`/api/batch?${keys.map((k) => `k=${encodeURIComponent(k)}`).join("&")}`));
    assert.equal(r.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
    const out = new Map((await lines(r)).map((l) => [l.k, l]));
    assert.equal(out.size, keys.length);
    assert.equal(out.get(keys[0]).c, "HOT");
    assert.equal(out.get(keys[0]).b.success, true);
    assert.equal(out.get(keys[0]).b.model, undefined);
    assert.ok(out.get(keys[0]).a > 0);
    assert.equal(out.get(keys[1]).c, "ORIGIN");
    assert.equal(out.get(keys[2]).c, "ORIGIN");
    assert.equal(out.get(keys[3]).s, 404);
    assert.equal(out.get(keys[4]).s, 400, "images aren't batchable");
    assert.equal(t.origin.calls.length, calls + 2, "only the two uncached keys hit the origin");

    mem.clear();
    const again = new Map((await lines(await handleApi(t.deps, get(`/api/batch?k=${encodeURIComponent(keys[1])}`)))).map((l) => [l.k, l]));
    assert.equal(again.get(keys[1]).c, "D1");
  });

  it("caps the batch size", async () => {
    const t = makeEnv();
    const qs = Array.from({ length: MAX_BATCH + 1 }, (_, i) => `k=/btd6/maps/map/ZZZZZ${String(i).padStart(2, "0")}`).join("&");
    assert.equal((await handleApi(t.deps, get(`/api/batch?${qs}`))).status, 400);
  });
});

// ─────────────────────────────── production hardening

const ndjson = async (r: Response) =>
  new Map((await r.text()).trim().split(/\n/).map((l) => JSON.parse(l)).map((l) => [l.k, l]));
const batchUrl = (keys: string[]) => `/api/batch?${keys.map((k) => `k=${encodeURIComponent(k)}`).join("&")}`;
/** A valid-looking user ID the fixtures don't hold: the fake origin synthesises a profile for it. */
const user = (i: number) => `/btd6/users/${i.toString(16).padStart(48, "a")}`;
const IP_A = { "CF-Connecting-IP": "203.0.113.7" };
const IP_B = { "CF-Connecting-IP": "198.51.100.9" };
const HOT_BOARD = `/btd6/bosses/${BOSS}/leaderboard/elite/2`;

describe("origin budget (abuse / amplification)", () => {
  it("per client: refused misses get 429 lines, cache hits and other clients are unaffected", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    t.deps.limits.buckets = new TokenBuckets(3, 60); // burst 3, then 1/s
    const calls = t.origin.calls.length;

    const keys = [HOT_BOARD, user(1), user(2), user(3), user(4), user(5)];
    const out = await ndjson(await handleApi(t.deps, get(batchUrl(keys), IP_A)));
    assert.equal(out.size, 6);
    assert.equal(out.get(HOT_BOARD).c, "HOT", "cache hits never touch the budget");
    const lines = keys.slice(1).map((k) => out.get(k));
    assert.equal(lines.filter((l) => l.c === "ORIGIN").length, 3);
    const refused = lines.filter((l) => l.c === "LIMITED");
    assert.equal(refused.length, 2);
    for (const l of refused) {
      assert.equal(l.s, 429);
      assert.ok(l.a >= 1, "a = seconds to wait");
      assert.equal(l.b.success, false);
      assert.equal(l.b.code, "rate_limited");
      assert.equal(l.b.retryAfter, l.a);
    }
    assert.equal(t.origin.calls.length, calls + 3);

    const single = await handleApi(t.deps, get(`/api/nk${user(6)}`, IP_A));
    assert.equal(single.status, 429);
    assert.equal(single.headers.get("X-Cache"), "LIMITED");
    assert.equal(single.headers.get("Cache-Control"), "no-store");
    assert.ok(Number(single.headers.get("Retry-After")) >= 1);

    const cached = lines.find((l) => l.c === "ORIGIN").k;
    assert.equal((await handleApi(t.deps, get(`/api/nk${cached}`, IP_A))).headers.get("X-Cache"), "MEM");
    assert.equal((await handleApi(t.deps, get(`/api/nk${user(6)}`, IP_B))).headers.get("X-Cache"), "ORIGIN");

    t.clock.now += 2000; // refilled 2 tokens
    assert.equal((await handleApi(t.deps, get(`/api/nk${user(7)}`, IP_A))).status, 200);
  });

  it("a refused client never makes another client's request for the same key fail", async () => {
    const t = makeEnv();
    t.deps.limits.buckets = new TokenBuckets(1, 0);
    await handleApi(t.deps, get(`/api/nk${user(1)}`, IP_A)); // A's only token
    const [a, b] = await Promise.all([
      handleApi(t.deps, get(`/api/nk${user(2)}`, IP_A)),
      handleApi(t.deps, get(`/api/nk${user(2)}`, IP_B)),
    ]);
    assert.equal(a.status, 429);
    assert.equal(b.status, 200);
  });

  it("per request: caps origin fetches; an old cached copy beats a 429", async () => {
    const t = makeEnv();
    await handleApi(t.deps, get(CHALLENGE));
    t.deps.limits.perRequest = 2;
    const out = await ndjson(await handleApi(t.deps, get(batchUrl([user(1), user(2), user(3), user(4)]))));
    assert.deepEqual([...out.values()].map((l) => l.c).sort(), ["LIMITED", "LIMITED", "ORIGIN", "ORIGIN"]);

    t.deps.limits.perRequest = 0;
    t.clock.now += 40 * DAY; // past fresh + stale: would need the origin
    const r = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("X-Cache"), "MEM-STALE-IF-ERROR");
    assert.equal((await handleApi(t.deps, get("/api/nk/btd6/maps/map/ZMYWROV/preview"))).status, 429, "images too");
  });

  it("uses the Rate Limiting binding when bound (misses only), failing open if it errors", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    let calls = 0;
    let answer: "deny" | "throw" | "allow" = "deny";
    t.deps.limits.binding = {
      limit: async ({ key }) => {
        calls++;
        assert.equal(key, "203.0.113.7");
        if (answer === "throw") throw new Error("binding down");
        return { success: answer === "allow" };
      },
    };
    const denied = await handleApi(t.deps, get(`/api/nk${user(1)}`, IP_A));
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("Retry-After"), "30");
    assert.equal((await handleApi(t.deps, get(`/api/nk${HOT_BOARD}`, IP_A))).status, 200);
    assert.equal(calls, 1, "cache hits don't consult the binding");
    answer = "throw";
    assert.equal((await handleApi(t.deps, get(`/api/nk${user(1)}`, IP_A))).status, 200);
  });

  it("keys clients by IP, IPv6 by /64", () => {
    const req = (ip?: string) => get("/", ip ? { "CF-Connecting-IP": ip } : {});
    assert.equal(clientKey(req("203.0.113.7")), "203.0.113.7");
    assert.equal(clientKey(req("2001:db8:1:2:3:4:5:6")), "2001:db8:1:2::/64");
    assert.equal(clientKey(req("2001:0db8:0001:0002::9")), "2001:db8:1:2::/64");
    assert.equal(clientKey(req("2001:db8::1")), "2001:db8:0:0::/64");
    assert.equal(clientKey(req()), "unknown");
  });
});

describe("KV / D1 failures degrade instead of failing", () => {
  it("KV unreadable: /api/now and hot keys come from D1's working copy", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    resetHotMemo();
    t.kv.fail.reads = true;
    const calls = t.origin.calls.length;
    const now = await handleApi(t.deps, get("/api/now"));
    assert.equal(now.status, 200);
    assert.equal((await now.json()).featured.boss, BOSS);
    assert.equal((await handleApi(t.deps, get(`/api/nk${HOT_BOARD}`))).headers.get("X-Cache"), "HOT");
    assert.equal(t.origin.calls.length, calls);
  });

  it("D1 unreadable: hits still served, misses fetched from the origin, nothing 500s", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    resetHotMemo();
    t.db.fail.reads = true;
    assert.equal((await handleApi(t.deps, get(`/api/nk${HOT_BOARD}`))).headers.get("X-Cache"), "HOT");
    const miss = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(miss.status, 200);
    assert.equal(miss.headers.get("X-Cache"), "ORIGIN");
    const out = await ndjson(await handleApi(t.deps, get(batchUrl([HOT_BOARD, user(1), "/btd6/challenges/challenge/ZFVWLVG"]))));
    assert.deepEqual([...out.values()].map((l) => l.s), [200, 200, 200]);
    const hist = await handleApi(t.deps, get("/api/history/boss"));
    assert.equal(hist.status, 503);
    assert.equal(hist.headers.get("Retry-After"), "60");
    const health = await handleApi(t.deps, get("/api/health"));
    assert.equal(health.status, 200);
    const h = await health.json();
    assert.equal(h.d1, "error");
    assert.equal(h.featured.boss, BOSS);
  });

  it("D1 unwritable: responses are served and kept in memory; the write is skipped", async () => {
    const t = makeEnv();
    t.db.fail.writes = true;
    assert.equal((await handleApi(t.deps, get(CHALLENGE))).headers.get("X-Cache"), "ORIGIN");
    assert.equal((await handleApi(t.deps, get(CHALLENGE))).headers.get("X-Cache"), "MEM");
    assert.equal((t.db.raw.prepare("SELECT COUNT(*) AS n FROM responses").get() as { n: number }).n, 0);
    assert.equal(t.origin.calls.length, 1);
  });

  it("while D1 is unreadable, an upstream error is served but never frozen over archived data", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const key = "/btd6/races/Gun_Game_mu19oabt/metadata"; // ended: frozen on first fetch
    assert.equal((await handleApi(t.deps, get(`/api/nk${key}`))).headers.get("X-Frozen"), "1");
    mem.clear();
    t.db.fail.reads = true;
    t.origin.override.set(key, JSON.stringify({ error: "No Race with that ID exists", success: false }));
    const during = await handleApi(t.deps, get(`/api/nk${key}`));
    assert.equal((await during.json()).success, false);
    assert.equal(during.headers.get("X-Frozen"), null);
    t.db.fail.reads = false;
    const after = await handleApi(t.deps, get(`/api/nk${key}`));
    assert.equal(after.headers.get("X-Cache"), "D1");
    assert.equal((await after.json()).success, true, "archived copy intact, memory not poisoned");
  });

  it("hot cron: a failed KV put keeps hot_state dirty and is retried next minute", async () => {
    const t = makeEnv();
    t.kv.fail.writes = true;
    const r1 = await refreshHot(t.deps);
    assert.equal(r1.published, false);
    assert.match(r1.error!, /KV put failed/);
    const row = t.db.raw.prepare("SELECT dirty, published_at FROM hot_state").get() as { dirty: number; published_at: number };
    assert.deepEqual({ ...row }, { dirty: 1, published_at: 0 });

    t.kv.fail.writes = false;
    t.clock.now += MIN;
    const r2 = await refreshHot(t.deps);
    assert.equal(r2.published, true);
    assert.equal(r2.fetched, 0, "fetch expiries were saved: NK isn't asked again");
    assert.equal((t.db.raw.prepare("SELECT dirty FROM hot_state").get() as { dirty: number }).dirty, 0);
  });

  it("hot cron: D1 down → no crash, no KV write; D1 write lost → state kept in the isolate and resynced", async () => {
    const t = makeEnv();
    t.db.fail.reads = true;
    const r0 = await refreshHot(t.deps);
    assert.match(r0.error!, /skipped/);
    assert.equal(t.kv.puts + t.origin.calls.length, 0, "unknown publish time: nothing done");
    t.db.fail.reads = false;

    await refreshHot(t.deps); // publishes
    const t0 = t.clock.now;
    t.clock.now += MIN;
    t.db.fail.writes = true;
    t.clock.now += 5 * MIN; // every NK CDN copy (max-age 300) expired → all re-asked
    t.origin.override.set("/btd6/races", JSON.stringify({ error: null, success: true, body: [], next: null, prev: null }));
    const r1 = await refreshHot(t.deps);
    assert.ok(r1.fetched > 0);
    assert.equal(r1.published, true, "KV still works: the change is published");
    assert.match(r1.error!, /D1 write failed/);
    const puts = t.kv.puts;

    t.clock.now += MIN;
    const calls = hotCalls(t);
    await refreshHot(t.deps);
    assert.ok(hotCalls(t) - calls <= r1.deferred, "expiries from the unsaved run are remembered: only keys the cap deferred are asked");
    assert.equal(t.kv.puts, puts, "publish time from the unsaved run is remembered: no extra KV write");

    t.db.fail.writes = false;
    t.clock.now += MIN;
    await refreshHot(t.deps);
    const row = t.db.raw.prepare("SELECT published_at FROM hot_state").get() as { published_at: number };
    assert.ok(row.published_at > t0, "D1 caught up with the publish made while it was failing");
    const body = t.db.raw.prepare("SELECT body FROM hot_entries WHERE key = '/btd6/races'").get() as { body: string };
    assert.deepEqual(JSON.parse(body.body).body, [], "the body whose write was lost is written too");
  });

  it("archive cron: a D1 write failure stops the run early; the queue resumes afterwards", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CAPTURED_AT + 3 * DAY;
    await runArchive(t.deps);
    const queued = () => (t.db.raw.prepare("SELECT COUNT(*) AS n FROM archive_queue").get() as { n: number }).n;
    const before = queued();
    assert.ok(before > 0);

    t.db.fail.writes = true;
    const calls = t.origin.calls.length;
    const r = await runArchive(t.deps);
    assert.ok(r.error);
    assert.ok(t.origin.calls.length - calls <= 6, "stops fetching after the first failed write");
    assert.equal(queued(), before, "nothing lost from the queue");
    await runScheduled(t.deps, "0 * * * *"); // never throws
    await runScheduled(t.deps, "* * * * *");

    t.db.fail.writes = false;
    for (let i = 0; i < 500 && (await runArchive(t.deps)).queued > 0; i++);
    assert.equal(queued(), 0);
  });

  it("anything unexpected becomes a 503 (single key) or a 502 line (batch), never an exception", async () => {
    const t = makeEnv();
    const now = t.deps.now;
    let allowed = 0;
    t.deps.now = () => {
      if (allowed-- > 0) return now();
      throw new Error("boom");
    };
    const r = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
    allowed = 1; // the batch's shared lookup succeeds; the key's own resolution throws
    const out = await ndjson(await handleApi(t.deps, get(batchUrl([user(1)]))));
    assert.equal(out.get(user(1)).s, 502);
  });
});

describe("hot paths (10 ms CPU)", () => {
  it("/api/now serves the stored text without parsing it", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    resetHotMemo();
    const parse = JSON.parse;
    let parses = 0;
    JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      parses++;
      return parse(text, reviver);
    }) as typeof JSON.parse;
    let body: string;
    try {
      body = await (await handleApi(t.deps, get("/api/now"))).text();
    } finally {
      JSON.parse = parse;
    }
    assert.equal(parses, 0);
    assert.equal(body, t.kv.store.get(HOT_KEY));
  });

  it("a hot key held in isolate memory keeps the cron's grace: no proxy refetch after 5 min", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    resetHotMemo();
    const calls = t.origin.calls.length;
    assert.equal((await handleApi(t.deps, get("/api/nk/btd6/bosses"))).headers.get("X-Cache"), "HOT");
    t.clock.now += 6 * MIN; // past the list's 5 min fresh window, before the cron republished
    const r = await handleApi(t.deps, get("/api/nk/btd6/bosses"));
    assert.equal(r.headers.get("X-Cache"), "MEM");
    assert.equal(t.pending.length, 0);
    assert.equal(t.origin.calls.length, calls);
  });

  it("a stale memory copy is revalidated from D1 before asking the origin", async () => {
    const t = makeEnv();
    await handleApi(t.deps, get(CHALLENGE));
    const stale = mem.get(CHALLENGE.slice("/api/nk".length))!;
    t.clock.now += 2 * HOUR;
    // Another isolate refreshed it meanwhile: D1 holds a newer copy.
    t.db.raw.prepare("UPDATE responses SET fetched_at = ?").run(t.clock.now - MIN);
    mem.set(stale);
    assert.equal((await handleApi(t.deps, get(CHALLENGE))).headers.get("X-Cache"), "MEM-STALE");
    await t.settle();
    assert.equal(t.origin.calls.length, 1, "D1's copy was fresh enough");
    assert.equal((await handleApi(t.deps, get(CHALLENGE))).headers.get("X-Cache"), "MEM");
  });
});

describe("input validation & headers", () => {
  it("validates /api/history before & limit", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    for (const q of ["before=abc", "before=-1", "before=1e12", "limit=abc", "limit=-1", "limit=1000", "limit=2.5"]) {
      assert.equal((await handleApi(t.deps, get(`/api/history/boss?${q}`))).status, 400, q);
    }
    const one = await (await handleApi(t.deps, get("/api/history/boss?limit=0"))).json();
    assert.equal(one.body.length, 1, "limit clamped to 1–100");
    const all = (await (await handleApi(t.deps, get("/api/history/boss?limit=100"))).json()).body;
    const cut = all[1].start;
    const older = (await (await handleApi(t.deps, get(`/api/history/boss?before=${cut}`))).json()).body;
    assert.ok(older.length > 0 && older.every((x: { start: number }) => x.start < cut));
    assert.equal(typeof all[0].archived, "boolean");
  });

  it("rejects malformed batch keys per line without calling the origin", async () => {
    const t = makeEnv();
    const bad = [`/btd6/users/${"a".repeat(300)}`, "https://evil.test/btd6/races", "/api/now", "btd6/races", ""];
    const out = await ndjson(await handleApi(t.deps, get(batchUrl(bad))));
    for (const k of bad) assert.equal(out.get(k).s, 400, JSON.stringify(k));
    assert.equal(t.origin.calls.length, 0);
    assert.equal((await handleApi(t.deps, get("/api/batch"))).status, 400);
  });

  it("HEAD answers like GET without a body (a HEAD batch does no work)", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const calls = t.origin.calls.length;
    const nk = await handleApi(t.deps, get(`/api/nk${HOT_BOARD}`, {}, "HEAD"));
    assert.equal(nk.status, 200);
    assert.equal(nk.headers.get("X-Cache"), "MEM");
    assert.equal(nk.body, null);
    const b = await handleApi(t.deps, get(batchUrl([user(1), user(2)]), {}, "HEAD"));
    assert.equal(b.status, 200);
    assert.equal(b.body, null);
    assert.equal((await handleApi(t.deps, get("/api/now", {}, "HEAD"))).body, null);
    assert.equal(t.origin.calls.length, calls);
    assert.equal(t.pending.length, 0);
  });

  it("sends X-Content-Type-Options: nosniff on every API response", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const etag = (await handleApi(t.deps, get(CHALLENGE))).headers.get("ETag")!;
    const reqs = [
      get(CHALLENGE),
      get(CHALLENGE, { "If-None-Match": etag }),
      get("/api/nk/btd6/save/x"),
      get("/api/nope"),
      new Request("https://site.test/api/now", { method: "POST" }),
      get("/api/now"),
      get("/api/health"),
      get("/api/history/race"),
      get(batchUrl([HOT_BOARD])),
      get("/api/nk/btd6/maps/map/ZMYWROV/preview"),
    ];
    for (const req of reqs) {
      const r = await handleApi(t.deps, req);
      assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff", `${req.method} ${req.url} → ${r.status}`);
      await r.body?.cancel();
    }
  });
});

describe("NK rate limit (observed live: HTTP 429 after ~100 quick profile requests)", () => {
  it("a 429 from NK starts a cooldown: misses are LIMITED without asking NK, cached keys still served", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const key = "/btd6/challenges/challenge/ZFVHOWM";
    t.origin.status429.add(key);
    const r1 = await handleApi(t.deps, get(`/api/nk${key}`));
    assert.equal(r1.status, 429);
    assert.equal(r1.headers.get("X-Cache"), "LIMITED");
    assert.ok(Number(r1.headers.get("Retry-After")) >= 30, "cooldown from Retry-After");

    const calls = t.origin.calls.length;
    const r2 = await handleApi(t.deps, get("/api/nk/btd6/maps/map/ZMYWROV"));
    assert.equal(r2.status, 429, "during the cooldown other misses aren't sent to NK");
    assert.equal(t.origin.calls.length, calls);
    const hot = await handleApi(t.deps, get(`/api/nk/btd6/bosses/${BOSS}/leaderboard/elite/1`));
    assert.equal(hot.status, 200, "cached data is unaffected");

    // Crons respect it too.
    t.clock.now += 6 * MIN; // hot keys expired… but the cooldown (Retry-After 60 s in the fake) has also passed
    t.origin.status429.clear();
    const ok = await handleApi(t.deps, get(`/api/nk${key}`));
    assert.equal(ok.status, 200, "after the cooldown NK is asked again");
  });

  it("the hot cron skips NK entirely during a cooldown and keeps its last copies", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.origin.status429.add("/btd6/races");
    t.clock.now += 5 * MIN + 1;
    const before = t.origin.calls.length;
    const r = await refreshHot(t.deps);
    const asked = t.origin.calls.length - before;
    assert.ok(asked < r.failed.length + 6, `stopped asking after the 429 (asked ${asked}, kept ${r.failed.length})`);
    const bundle = JSON.parse(t.kv.store.get(HOT_KEY)!) as HotBundle;
    assert.ok(bundle.entries["/btd6/bosses"], "last copies kept");
  });

  it("the warmer caches featured leaderboard profiles a few per run, best ranks first", async () => {
    const t = makeEnv();
    const r0 = await refreshHot(t.deps);
    assert.equal(r0.warmed, 0, "not on a run that fetched the whole hot set (CPU)");
    t.clock.now += MIN;
    const r1 = await refreshHot(t.deps);
    assert.equal(r1.warmed, 4);
    const profiles = t.db.raw.prepare("SELECT COUNT(*) AS n FROM responses WHERE key LIKE '/btd6/users/%'").get() as { n: number };
    assert.equal(profiles.n, 4);
    const board = JSON.parse(t.kv.store.get(HOT_KEY)!).entries[`/btd6/bosses/${BOSS}/leaderboard/standard/1`].data.body;
    const top = `/btd6/users/${board[0].profile.split("/").pop()}`;
    assert.ok(t.db.raw.prepare("SELECT 1 FROM responses WHERE key = ?").get(top), "rank 1 warmed first");
    t.clock.now += MIN;
    assert.equal((await refreshHot(t.deps)).warmed, 4, "next run continues with the next ones");
  });
});

// ─────────────────────────────── batch 1–19 (backend)

const BARE_BOSS = "msi6n2qi"; // Dreadbloon #37: the newest bosses have no "Name123_" prefix
const HYPHEN_RACE = "Regene-race_mtjapaiu";
const TEAM_GUILD = "9fb9168a8a94f1a449458c4a0a25e522cf021ab59f41df39"; // CHEESINGTHEALG0RITHM, #1 on CT mtv62zza
const CT_ID = "mtv62zza"; // ended 2026-09-22 22:00 UTC (frozen at capture time)
const CT_END = 1790114400000;
const CT_GROUP = `/btd6/ct/${CT_ID}/leaderboard/group/cafb78d69bd0ffa75208de245c74ef189b4144e0ca53`;

function addEvent(t: ReturnType<typeof makeEnv>, kind: string, id: string, start: number, end: number, extra: Record<string, unknown> = {}) {
  t.db.raw
    .prepare("INSERT INTO events (kind, id, start_at, end_at, data) VALUES (?, ?, ?, ?, ?)")
    .run(kind, id, start, end, JSON.stringify({ id, start, end, ...extra }));
}

async function archiveAll(t: ReturnType<typeof makeEnv>) {
  for (let i = 0; i < 500; i++) {
    const r = await runArchive(t.deps);
    if (r.queued === 0 && r.expanded.length === 0) return;
  }
  throw new Error("archive did not terminate");
}

describe("event IDs: validated by shape, not naming", () => {
  it("accepts a bare boss ID and a hyphenated race ID via /api/nk and /api/batch", async () => {
    const t = makeEnv();
    const keys = [
      `/btd6/bosses/${BARE_BOSS}/metadata/standard`,
      `/btd6/bosses/${BARE_BOSS}/leaderboard/elite/2?page=3`,
      `/btd6/races/${HYPHEN_RACE}/metadata`,
      `/btd6/races/${HYPHEN_RACE}/leaderboard`,
    ];
    for (const k of keys) {
      const r = await handleApi(t.deps, get(`/api/nk${k}`));
      assert.equal(r.status, 200, k);
      assert.equal((await r.json()).success, true, k);
    }
    mem.clear();
    const out = await ndjson(await handleApi(t.deps, get(batchUrl(keys))));
    for (const k of keys) assert.equal(out.get(k).s, 200, k);
    assert.equal(out.get(keys[0]).c, "D1");
  });

  it("still rejects IDs of the wrong shape, without calling the origin", async () => {
    const t = makeEnv();
    for (const id of ["abc", "bad.id", "a".repeat(65), "x%20y"]) {
      assert.equal((await handleApi(t.deps, get(`/api/nk/btd6/bosses/${id}/metadata/standard`))).status, 404, id);
      assert.equal((await handleApi(t.deps, get(`/api/nk/btd6/races/${id}/leaderboard`))).status, 404, id);
    }
    assert.equal(t.origin.calls.length, 0);
  });

  it("archives events with bare and hyphenated IDs", async () => {
    const t = makeEnv();
    const end = CAPTURED_AT - 3 * DAY;
    addEvent(t, "boss", BARE_BOSS, end - 5 * DAY, end, { name: "Dreadbloon37", bossType: "dreadbloon" });
    addEvent(t, "race", HYPHEN_RACE, end - 4 * DAY, end, { name: "Regene-race" });
    await archiveAll(t);
    const states = t.db.raw.prepare("SELECT id, archive_state AS s FROM events ORDER BY id").all() as { id: string; s: number }[];
    assert.deepEqual(states.map((x) => ({ ...x })), [{ id: HYPHEN_RACE, s: 2 }, { id: BARE_BOSS, s: 2 }]);
    for (const k of [
      `/btd6/bosses/${BARE_BOSS}/metadata/elite`,
      `/btd6/bosses/${BARE_BOSS}/leaderboard/standard/1?page=40`,
      `/btd6/races/${HYPHEN_RACE}/metadata`,
      `/btd6/races/${HYPHEN_RACE}/leaderboard?page=20`,
    ]) {
      const row = t.db.raw.prepare("SELECT frozen, ok FROM responses WHERE key = ?").get(k) as { frozen: number; ok: number } | undefined;
      assert.deepEqual(row && { ...row }, { frozen: 1, ok: 1 }, k);
    }
  });
});

describe("friendly error JSON", () => {
  it("short messages plus a machine-readable code, same status codes", async () => {
    const t = makeEnv();
    const cases: [Request, number, string][] = [
      [get("/api/nk/btd6/doesnotexist"), 404, "not_found"],
      [get(`/api/nk/btd6/bosses/${BOSS}/metadata/hard`), 404, "not_found"],
      [get("/api/nk/btd6/races/Gun_Game_mu19oabt/leaderboard?page=21"), 404, "not_found"],
      [get("/api/nk/btd6/races/Gun_Game_mu19oabt/leaderboard?page=x"), 400, "bad_request"],
      [get("/api/nk/btd6/users/oak_abcdef"), 403, "private"],
      [get("/api/nk/btd6/save/x"), 403, "private"],
      [get("/api/elsewhere"), 404, "not_found"],
      [get("/api/batch"), 400, "bad_request"],
      [get("/api/history/boss?limit=x"), 400, "bad_request"],
      [get("/api/now"), 503, "unavailable"],
      [new Request("https://site.test/api/now", { method: "POST" }), 405, "method_not_allowed"],
    ];
    for (const [req, status, code] of cases) {
      const r = await handleApi(t.deps, req);
      const body = await r.json();
      assert.equal(r.status, status, req.url);
      assert.equal(body.success, false);
      assert.equal(body.code, code, req.url);
      assert.ok(body.error.length <= 40 && !/[:→]|OAK|route|maxPages/.test(body.error), `user-facing: ${body.error}`);
    }
    t.origin.down = true;
    const r = await handleApi(t.deps, get(CHALLENGE));
    assert.equal(r.status, 502);
    assert.equal((await r.json()).code, "upstream");
    const out = await ndjson(await handleApi(t.deps, get(batchUrl(["/btd6/nope", "/api/now"]))));
    assert.equal(out.get("/btd6/nope").b.code, "not_found");
    assert.equal(out.get("/api/now").b.code, "bad_request");
  });

  it("NK's own error envelopes pass through unchanged", async () => {
    const t = makeEnv();
    const body = await (await handleApi(t.deps, get("/api/nk/btd6/maps/map/ZZZZZZZ"))).json();
    assert.equal(body.success, false);
    assert.equal(body.code, undefined);
  });
});

describe("leaderboard freshness around an event's end (item 9: CT group vs team board)", () => {
  const groupScore = (score: number) =>
    JSON.stringify({
      success: true, error: null, next: null, prev: null, maxPages: 1,
      body: [{ displayName: "PINK", score, profile: `https://data.ninjakiwi.com/btd6/guild/${"b".repeat(48)}`, group: `https://data.ninjakiwi.com${CT_GROUP}` }],
    });

  it("a copy fetched while live is never served as final (nor frozen) after the event", async () => {
    const t = makeEnv();
    await refreshHot(t.deps); // CT timing → events table
    t.clock.now = CT_END - 30 * MIN;
    t.origin.override.set(CT_GROUP, groupScore(257_590));
    assert.equal((await handleApi(t.deps, get(`/api/nk${CT_GROUP}`))).headers.get("X-Cache"), "ORIGIN");

    // Grace period: the copy predates the end → refetched in the foreground, not served for another hour.
    t.origin.override.set(CT_GROUP, `${groupScore(257_650)} `); // (the fake ETag is length-based)
    t.clock.now = CT_END + 10 * MIN;
    const grace = await handleApi(t.deps, get(`/api/nk${CT_GROUP}`));
    assert.equal(grace.headers.get("X-Cache"), "ORIGIN");
    assert.equal((await grace.json()).body[0].score, 257_650);
    assert.equal((await handleApi(t.deps, get(`/api/nk${CT_GROUP}`))).headers.get("X-Cache"), "MEM");

    // After the freeze point the grace copy is re-snapshotted once, then immutable.
    t.clock.now = CT_END + 2 * DAY;
    const frozen = await handleApi(t.deps, get(`/api/nk${CT_GROUP}`));
    assert.equal(frozen.headers.get("X-Cache"), "ORIGIN");
    assert.equal(frozen.headers.get("X-Frozen"), "1");
    const calls = t.origin.calls.length;
    mem.clear();
    assert.equal((await handleApi(t.deps, get(`/api/nk${CT_GROUP}`))).headers.get("X-Cache"), "D1");
    assert.equal(t.origin.calls.length, calls);
  });

  it("if NK has dropped the group, the last copy is served (and frozen) instead of the error", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CT_END - 30 * MIN;
    t.origin.override.set(CT_GROUP, groupScore(257_590));
    await handleApi(t.deps, get(`/api/nk${CT_GROUP}`));
    t.origin.override.set(CT_GROUP, JSON.stringify({ error: "No Group Available", success: false }));
    t.clock.now = CT_END + 3 * DAY;
    const r = await handleApi(t.deps, get(`/api/nk${CT_GROUP}`));
    assert.equal((await r.json()).body[0].score, 257_590);
    assert.equal(r.headers.get("X-Frozen"), "1");
  });

  it("live boards: stale-while-revalidate only briefly, then a foreground refresh", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CT_END - 3 * DAY;
    const key = `/api/nk/btd6/ct/${CT_ID}/leaderboard/team?page=5`;
    assert.equal((await handleApi(t.deps, get(key))).headers.get("X-Cache"), "ORIGIN");
    t.clock.now += 7 * MIN;
    assert.equal((await handleApi(t.deps, get(key))).headers.get("X-Cache"), "MEM-STALE");
    await t.settle();
    t.clock.now += 11 * MIN;
    assert.equal((await handleApi(t.deps, get(key))).headers.get("X-Cache"), "ORIGIN");
  });
});

describe("team CT history (/api/history/team/:guildId)", () => {
  it("built from archived team boards and stored group pages, newest first, no NK requests", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CAPTURED_AT + 3 * DAY;
    await archiveAll(t);
    await handleApi(t.deps, get(`/api/nk${CT_GROUP}`)); // a visitor opens the (frozen) group page

    const calls = t.origin.calls.length;
    const r = await handleApi(t.deps, get(`/api/history/team/${TEAM_GUILD}`));
    assert.equal(r.status, 200);
    const h = await r.json();
    assert.equal(t.origin.calls.length, calls, "no NK requests");
    assert.equal(h.team, TEAM_GUILD);
    const e = h.entries.find((x: { ct: string }) => x.ct === CT_ID);
    assert.deepEqual(e, { ct: CT_ID, start: 1789509600000, end: CT_END, rank: 1, total: 4780, score: 291810, group: { rank: 1, of: 4 } });
    for (let i = 1; i < h.entries.length; i++) assert.ok(h.entries[i - 1].start >= h.entries[i].start, "newest first");

    // A team only seen in a group page still gets its group placing.
    const jhyu = await (await handleApi(t.deps, get("/api/history/team/9fee128ad9c4fdf31f4b871f5f7ae722c8024fbccb138b3e"))).json();
    const j = jhyu.entries.find((x: { ct: string }) => x.ct === CT_ID);
    assert.equal(j.group.rank, 2);
    assert.equal(j.group.of, 4);

    assert.deepEqual(await (await handleApi(t.deps, get(`/api/history/team/${"c".repeat(48)}`))).json(), { team: "c".repeat(48), entries: [] });
    const bad = await handleApi(t.deps, get("/api/history/team/nope"));
    assert.equal(bad.status, 404);
    assert.equal((await bad.json()).code, "not_found");
  });

  it("rides in /api/batch next to NK keys (one Worker request per page, still no NK requests)", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CAPTURED_AT + 3 * DAY;
    await archiveAll(t);
    const calls = t.origin.calls.length;
    const keys = [`/api/history/team/${TEAM_GUILD}`, "/api/history/team/nope", "/api/history/boss"];
    const r = await handleApi(t.deps, get(`/api/batch?${keys.map((k) => `k=${encodeURIComponent(k)}`).join("&")}`));
    const out = new Map((await r.text()).trim().split(/\n/).map((l) => JSON.parse(l)).map((l) => [l.k, l]));
    assert.equal(t.origin.calls.length, calls, "no NK requests");
    const ok = out.get(keys[0]);
    assert.equal(ok.s, 200);
    assert.equal(ok.b.team, TEAM_GUILD);
    assert.ok(ok.b.entries.some((x: { ct: string }) => x.ct === CT_ID));
    assert.equal(out.get(keys[1]).s, 404);
    assert.equal(out.get(keys[2]).s, 400, "other /api/ keys stay out of batches");
  });

  it("live boards are not indexed (only final data)", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CT_END - DAY;
    await handleApi(t.deps, get(`/api/nk/btd6/ct/${CT_ID}/leaderboard/team?page=2`));
    await handleApi(t.deps, get(`/api/nk${CT_GROUP}`));
    assert.equal((t.db.raw.prepare("SELECT COUNT(*) AS n FROM ct_teams").get() as { n: number }).n, 0);
  });

  it("the migration backfills ct_teams from what is already stored", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    t.clock.now = CAPTURED_AT + 3 * DAY;
    await archiveAll(t);
    await handleApi(t.deps, get(`/api/nk${CT_GROUP}`));
    const before = t.db.raw.prepare("SELECT * FROM ct_teams ORDER BY guild_id, ct_id").all();
    t.db.raw.exec("DELETE FROM ct_teams");
    t.db.raw.exec(readFileSync(new URL("../migrations/0003_ct_teams.sql", import.meta.url), "utf8"));
    const after = t.db.raw.prepare("SELECT * FROM ct_teams ORDER BY guild_id, ct_id").all();
    assert.ok(before.some((r) => (r as { guild_id: string }).guild_id === TEAM_GUILD));
    assert.deepEqual(after, before);
  });
});

describe("link previews (og tags on page navigations)", () => {
  const SHELL = `<!doctype html><html><head><meta charset="utf-8" />
    <meta name="description" content="Generic." />
    <title>BTD6 Open Data</title><meta property="og:title" content="static" /></head><body><div id="app"></div></body></html>`;
  const assets = () => {
    const seen: string[] = [];
    return {
      seen,
      fetch: async (req: Request) => {
        seen.push(new URL(req.url).pathname);
        return new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8", ETag: `"shell"` } });
      },
    };
  };
  const page = async (t: ReturnType<typeof makeEnv>, path: string, a = assets(), method = "GET") => {
    const r = await handleRequest(t.deps, { ASSETS: a }, get(path, {}, method));
    return { r, html: method === "HEAD" ? "" : await r.text() };
  };
  const meta = (html: string, p: string) => new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`).exec(html)?.[1];

  it("map pages: own title and description, in the sitemap; ids outside the game's map list are real 404s", async () => {
    const t = makeEnv();
    const { r, html } = await page(t, "/maps/%23ouch");
    assert.equal(r.status, 200);
    assert.match(html, /<title>#Ouch · BTD6 Map · BTD6 Open Data<\/title>/);
    assert.match(meta(html, "description")!, /^#Ouch, an Expert map in Bloons TD 6/);
    assert.match(html, /<link rel="canonical" href="https:\/\/btd6data\.com\/maps\/%23ouch" \/>/);
    for (const bad of ["/maps/Blons", "/maps/NotAMap"]) assert.equal((await page(t, bad)).r.status, 404, bad);
    const sitemap = readFileSync(new URL("../web/public/sitemap.xml", import.meta.url), "utf8");
    const listed = [...sitemap.matchAll(/btd6data\.com\/maps\/([^<]+)</g)].map((x) => decodeURIComponent(x[1]));
    assert.deepEqual(listed, MAP_LIST.map((m) => m[0]), "web/public/sitemap.xml lists every map page, in game order");
  });

  it("event pages use cached event data (boss portrait from NK), never the origin", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    resetHotMemo(); // force the D1 `events` path (no parsed bundle in this isolate)
    const calls = t.origin.calls.length;
    const { r, html } = await page(t, `/boss/${BOSS}?d=elite`);
    assert.equal(r.status, 200);
    assert.match(html, /<title>Vortex #47 · BTD6 Boss Event · BTD6 Open Data<\/title>/);
    assert.equal(meta(html, "og:title"), "Vortex #47 · BTD6 Boss Event · BTD6 Open Data");
    assert.match(meta(html, "og:image")!, /^https:\/\/static-api\.nkstatic\.com\/.*vortex\.png$/);
    assert.match(meta(html, "description")!, /^Bloons TD 6 Vortex boss event, \d+ Sep – \d+ Sep 2026\./);
    assert.equal(meta(html, "twitter:card"), "summary");
    assert.equal(meta(html, "og:url"), "https://btd6data.com/boss/Vortex47_mu62cmt5?d=elite");
    assert.equal((html.match(/og:title/g) ?? []).length, 1, "the shell's own og tags are replaced");
    assert.equal(r.headers.get("ETag"), null);
    assert.equal(t.origin.calls.length, calls);

    assert.match((await page(t, "/odyssey/muekowzs")).html, /<title>Not all Heroes wear capes · Odyssey/);
    assert.match((await page(t, `/ct/${CT_ID}`)).html, /<title>Contested Territory · /);
    assert.match((await page(t, "/races/")).html, /<title>BTD6 Race Leaderboards · /);
    assert.match((await page(t, "/challenges")).html, /<title>Daily challenges · /);
    assert.match((await page(t, "/challenges/constructor")).html, /<title>BTD6 Open Data<\/title>/);
    const lych = (await page(t, "/bosses/lych")).html;
    assert.match(lych, /<title>BTD6 Lych Boss: Health, Tiers &amp; Past Events · /);
    assert.match(lych, /<div id="app"><div class="pre"><h1>BTD6 Lych Boss: Health, Tiers &amp; Past Events · BTD6 Open Data<\/h1><p>Lych boss stats/);
    assert.equal(t.origin.calls.length, calls);
  });

  it("works for a bare boss ID", async () => {
    const t = makeEnv();
    addEvent(t, "boss", BARE_BOSS, CAPTURED_AT - DAY, CAPTURED_AT + DAY, {
      name: "Dreadbloon37", bossType: "dreadbloon", bossTypeURL: "https://static-api.nkstatic.com/x_dreadbloon.png",
    });
    const { html } = await page(t, `/boss/${BARE_BOSS}`);
    assert.match(html, /<title>Dreadbloon #37 · /);
  });

  it("uncached player → generic tags without asking NK; cached → name and avatar", async () => {
    const t = makeEnv();
    const id = "9fb6118ddcc2fcf7184add1e0974ee71980d1ebe9617dd6a";
    const a = await page(t, `/player/${id}`);
    assert.match(a.html, /<title>BTD6 Open Data<\/title>/);
    assert.equal(meta(a.html, "og:image"), "https://site.test/og.jpg"); // site-wide fallback image
    assert.equal(t.origin.calls.length, 0);

    await handleApi(t.deps, get(`/api/nk/btd6/users/${id}`));
    mem.clear(); // served from D1
    const b = await page(t, `/player/${id}`);
    assert.doesNotMatch(b.html, /<title>BTD6 Open Data<\/title>/);
    assert.match(meta(b.html, "og:image")!, /^https:\/\//);
    assert.equal(t.origin.calls.length, 1);
  });

  it("escapes cached text and keeps unknown routes generic", async () => {
    const t = makeEnv();
    const doc = JSON.parse(readFileSync(new URL("../docs/api/fixtures/btd6__challenges__challenge__ZFVHOWM.json", import.meta.url), "utf8"));
    doc.body.name = `<script>"x"</script> $& $'`;
    t.origin.override.set("/btd6/challenges/challenge/ZFVHOWM", JSON.stringify(doc));
    await handleApi(t.deps, get(CHALLENGE));
    const { html } = await page(t, "/challenge/ZFVHOWM");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("<title>&lt;script&gt;&quot;x&quot;&lt;/script&gt; $&amp; $&#39; · BTD6 Open Data</title>"));
    assert.equal(meta(html, "twitter:card"), "summary_large_image");
    assert.match((await page(t, "/nope/x/y")).html, /<title>BTD6 Open Data<\/title>/);
    assert.match((await page(t, "/player/%E0%A4%A")).html, /<title>BTD6 Open Data<\/title>/);
  });

  it("HEAD has no body; /api stays on the API; non-GET goes straight to the assets", async () => {
    const t = makeEnv();
    const a = assets();
    const head = await page(t, "/", a, "HEAD");
    assert.equal(head.r.status, 200);
    assert.equal(head.r.body, null);
    const api = await handleRequest(t.deps, { ASSETS: a }, get("/api/nope"));
    assert.equal((await api.json()).code, "not_found");
    await handleRequest(t.deps, { ASSETS: a }, new Request("https://site.test/boss/x", { method: "POST" }));
    assert.deepEqual(a.seen, ["/", "/boss/x"]);
  });

  it("pages on workers.dev and www move to btd6data.com; the API answers on every host", async () => {
    const t = makeEnv();
    const a = assets();
    for (const host of ["btd6-opendata.x.workers.dev", "www.btd6data.com"]) {
      const r = await handleRequest(t.deps, { ASSETS: a }, new Request(`https://${host}/race/x?p=2`));
      assert.equal(r.status, 301);
      assert.equal(r.headers.get("Location"), "https://btd6data.com/race/x?p=2");
      const api = await handleRequest(t.deps, { ASSETS: a }, new Request(`https://${host}/api/nope`));
      assert.equal(api.status, 404);
    }
    assert.deepEqual(a.seen, []);
    const { r, html } = await page(t, "/races?x=1", a);
    assert.match(html, /<link rel="canonical" href="https:\/\/btd6data\.com\/races" \/>/);
    assert.equal(r.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  });

  it("search engines: one canonical address per page, real 404s for unknown paths", async () => {
    const t = makeEnv();
    const canonical = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
    for (const [path, want] of [
      ["/", "https://btd6data.com/"],
      ["/bosses/", "https://btd6data.com/bosses"],
      ["/bosses/phayze?d=elite&t=3", "https://btd6data.com/bosses/phayze"],
      ["/tools/rounds?set=default&r=60", "https://btd6data.com/tools/rounds"],
      ["/tools?set=default", "https://btd6data.com/tools/rounds"],
      ["/tools", "https://btd6data.com/tools"],
    ]) {
      const { r, html } = await page(t, path);
      assert.equal(r.status, 200, path);
      assert.equal(canonical(html), want, path);
    }
    for (const path of ["/nope", "/nope/x/y", "/bosses/zzz", "/boss/x", "/challenges/constructor", "/player/%E0%A4%A"]) {
      assert.equal((await page(t, path)).r.status, 404, path);
    }
    const stats = await page(t, "/stats");
    assert.equal(stats.r.status, 200);
    assert.match(stats.html, /<title>Site stats · BTD6 Open Data<\/title>/);
    assert.match((await page(t, "/ct")).html, /<title>BTD6 Contested Territory \(CT\) Leaderboards · /);
  });
});

describe("challenge ids", () => {
  it("accepts standard, advanced and co-op daily ids and player codes; rejects bad shapes", async () => {
    const { matchRoute } = await import("../src/nk/routes.ts");
    for (const id of ["rot296820260926", "adv295520260926", "coopmtr1jby", "ZMYWROV"]) {
      const m = matchRoute(`/btd6/challenges/challenge/${id}`);
      assert.ok(m.ok && m.route.name === "challenge", id);
    }
    for (const id of ["a/b", "x", "has space"]) {
      const m = matchRoute(`/btd6/challenges/challenge/${id}`);
      assert.ok(!m.ok || m.route.name !== "challenge", id);
    }
  });
});

const countParses = async <T,>(fn: () => Promise<T>): Promise<{ out: T; sizes: number[] }> => {
  const parse = JSON.parse;
  const sizes: number[] = [];
  JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
    sizes.push(text.length);
    return parse(text, reviver);
  }) as typeof JSON.parse;
  try {
    return { out: await fn(), sizes };
  } finally {
    JSON.parse = parse;
  }
};

describe("hot bundle text", () => {
  it("is valid JSON whose index points at each entry's data text", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const text = t.kv.store.get(HOT_KEY)!;
    const b = JSON.parse(text) as HotBundle;
    const v = viewOf(text)!;
    assert.equal(v.keys.size, Object.keys(b.entries).length);
    assert.deepEqual(v.featured, b.featured);
    for (const [k, e] of Object.entries(b.entries)) assert.deepEqual(JSON.parse(hotBody(v, k)!), e.data, k);
    // Keys and bodies with characters JSON escapes, and non-ASCII text, keep their offsets.
    const weird = '/btd6/x"\\y';
    const odd = buildHotText(1, b.featured, [
      { key: weird, fetchedAt: 2, etag: 'W/"a"', ok: true, body: JSON.stringify({ success: true, body: 'é ✓ "q"' }) },
      { key: "/btd6/z", fetchedAt: 3, etag: null, ok: false, body: '{"success":false,"error":"x"}' },
    ]);
    const ov = viewOf(odd)!;
    assert.equal(JSON.parse(hotBody(ov, "/btd6/z")!).error, "x");
    assert.equal(JSON.parse(hotBody(ov, weird)!).body, 'é ✓ "q"');
    assert.deepEqual(JSON.parse(odd).entries["/btd6/z"], { fetchedAt: 3, etag: null, ok: false, data: { success: false, error: "x" } });
  });

  it("a request reads one entry without parsing the bundle", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    mem.clear();
    resetHotMemo();
    const { out: r, sizes } = await countParses(() => handleApi(t.deps, get(`/api/nk/btd6/bosses/${BOSS}/leaderboard/elite/3`)));
    assert.equal(r.headers.get("X-Cache"), "HOT");
    assert.equal((await r.json()).success, true);
    const whole = t.kv.store.get(HOT_KEY)!.length;
    assert.ok(sizes.every((n) => n < whole / 4), `parsed ${sizes.join(", ")} chars of a ${whole}-char bundle`);
  });

  it("a bundle published before the index existed (v1) is still served", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const v2 = JSON.parse(t.kv.store.get(HOT_KEY)!) as HotBundle;
    t.kv.store.set(HOT_KEY, JSON.stringify({ v: 1, generatedAt: v2.generatedAt, featured: v2.featured, entries: v2.entries }));
    mem.clear();
    resetHotMemo();
    const r = await handleApi(t.deps, get(`/api/nk/btd6/bosses/${BOSS}/leaderboard/elite/3`));
    assert.equal(r.headers.get("X-Cache"), "HOT");
    assert.equal((await r.json()).success, true);
  });

  it("the cron never parses the bundle: its state is a small index plus one row per body", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const state = t.db.raw.prepare("SELECT bundle, meta FROM hot_state").get() as { bundle: string; meta: string };
    assert.equal(state.bundle, "");
    assert.ok(state.meta.length < 20_000, `index is ${state.meta.length} chars`);
    const rows = t.db.raw.prepare("SELECT COUNT(*) AS n FROM hot_entries").get() as { n: number };
    assert.equal(rows.n, Object.keys(JSON.parse(state.meta).entries).length);

    const whole = t.kv.store.get(HOT_KEY)!.length;
    for (const step of [5 * MIN + 1, 6 * MIN, HOUR]) {
      t.clock.now += step; // lists due; a heartbeat publish; everything due
      const { sizes } = await countParses(() => refreshHot(t.deps));
      assert.ok(sizes.every((n) => n < whole / 4), `parsed ${sizes.join(", ")} chars (bundle: ${whole})`);
    }
  });

  it("the profile warmer stops looking once every profile is warm", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const warmState = () => JSON.parse((t.db.raw.prepare("SELECT meta FROM hot_state").get() as { meta: string }).meta).warm;
    let total = 0;
    for (let i = 0; i < 400 && !warmState(); i++) {
      t.clock.now += MIN;
      total += (await refreshHot(t.deps)).warmed ?? 0;
    }
    assert.ok(total > 0);
    assert.ok(warmState()?.until > t.clock.now, "idle until the oldest profile goes stale");
    t.clock.now += MIN;
    assert.equal((await refreshHot(t.deps)).warmed, 0);
  });
});

describe("stats", () => {
  const fixture = JSON.parse(readFileSync(new URL("../docs/api/stats-graphql.json", import.meta.url), "utf8"));
  const NOW = Date.parse("2026-09-30T10:00:00Z");
  const cfg = { token: "secret-token", accountId: "923b0e4244cbc8a739105c5db9c05ae5", graphqlUrl: "https://gql.test/graphql" };

  it("shapes the GraphQL response", () => {
    const s = shapeStats(fixture, NOW);
    assert.equal(s.daily.length, 30);
    assert.equal(s.daily.at(-1)!.date, "2026-09-30");
    assert.equal(s.daily[0].date, "2026-09-01");
    assert.equal(s.totals.d30.views, fixture.data.viewer.accounts[0].daily.reduce((a: number, g: { count: number }) => a + g.count, 0));
    assert.ok(s.totals.d7.views <= s.totals.d30.views && s.totals.d7.visits > 0);
    assert.equal(s.totals.d7.views, s.daily.slice(-7).reduce((a, d) => a + d.views, 0));
    assert.equal(s.totals.d7.visits, s.daily.slice(-7).reduce((a, d) => a + d.visits, 0));
    assert.equal(s.pages[0].name, "/");
    assert.equal(s.referrers[0].name, ""); // direct; the page labels it
    assert.equal(s.devices.length, 3);
    assert.deepEqual(shapeStats({ data: null }, NOW).totals.d30, { views: 0, visits: 0 });
  });

  it("503 without the secret; 502 on GraphQL errors, never leaking the token; caches 15 min", async () => {
    resetStatsMemo();
    const noFetch = (async () => assert.fail("no fetch")) as unknown as typeof fetch;
    const r0 = await handleStats({ ...cfg, token: undefined }, noFetch, NOW);
    assert.equal(r0.status, 503);
    assert.equal((await r0.json()).error, "not-configured");

    const bad = (async () => new Response(JSON.stringify({ errors: [{ message: "bad secret-token" }] }), { status: 200 })) as typeof fetch;
    const r1 = await handleStats(cfg, bad, NOW);
    assert.equal(r1.status, 502);
    assert.ok(!(await r1.text()).includes("secret-token"));

    let calls = 0;
    const ok = (async (_u: string, init: RequestInit) => {
      calls++;
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer secret-token");
      assert.match(String(init.body), /rumPageloadEventsAdaptiveGroups/);
      return new Response(JSON.stringify(fixture), { status: 200 });
    }) as unknown as typeof fetch;
    const r2 = await handleStats(cfg, ok, NOW);
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get("X-Robots-Tag"), "noindex, nofollow");
    await handleStats(cfg, ok, NOW + 10 * MIN);
    assert.equal(calls, 1);
    await handleStats(cfg, ok, NOW + 16 * MIN);
    assert.equal(calls, 2);

    resetStatsMemo();
  });
});

// ─────────────────────────────── notifications

describe("notifications (new boss / race → Discord)", () => {
  const HOOK = "https://discord.test/api/webhooks/1/secret-token";
  const NEW_RACE = "Brand_New_race_mzzzzzzz";
  const fixture = (f: string) => JSON.parse(readFileSync(new URL(`../docs/api/fixtures/${f}`, import.meta.url), "utf8")) as { body: Record<string, unknown>[] };
  const racesFixture = fixture("btd6__races.json");

  /** Env that has already stored today's events (so nothing is new), with a fake Discord webhook. */
  async function setup(opts: { hook?: boolean } = {}) {
    const t = makeEnv();
    await refreshHot(t.deps);
    await t.settle();
    const discord = { posts: [] as { url: string; body: any }[], status: 204, retryAfter: 0 };
    const nk = t.deps.fetch;
    t.deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith("https://discord.test/")) return nk(input, init);
      discord.posts.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      if (discord.status === 429) return new Response(JSON.stringify({ retry_after: discord.retryAfter }), { status: 429 });
      return new Response(null, { status: discord.status });
    }) as typeof fetch;
    if (opts.hook !== false) t.deps.notify = { discordWebhookUrl: HOOK };
    const run = async () => {
      t.clock.now += MIN;
      await refreshHot(t.deps);
      await t.settle();
    };
    /** NK lists a new race (the lists are re-asked once their 5 min CDN copy expired). */
    const list = async (id = NEW_RACE) => {
      const item = { id, name: "Brand New", start: t.clock.now + DAY, end: t.clock.now + 4 * DAY, totalScores: 0 };
      t.origin.override.set("/btd6/races", JSON.stringify({ error: null, success: true, body: [item, ...racesFixture.body], next: null, prev: null }));
      t.clock.now += 5 * MIN;
      await refreshHot(t.deps);
      await t.settle();
      return item;
    };
    const rows = () => t.db.raw.prepare("SELECT key, sent_at, attempts, last_error FROM notifications").all() as { key: string; sent_at: number | null; attempts: number; last_error: string | null }[];
    return { t, discord, run, list, rows };
  }

  it("new race → one outbox row and one Discord embed", async () => {
    const { discord, list, rows } = await setup();
    const item = await list();
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].key, `new-race:race:${NEW_RACE}`);
    assert.ok(rows()[0].sent_at);
    assert.equal(discord.posts.length, 1);
    assert.equal(discord.posts[0].url, HOOK);
    const { embeds, allowed_mentions } = discord.posts[0].body;
    assert.deepEqual(allowed_mentions, { parse: [] });
    assert.equal(embeds.length, 1);
    assert.equal(embeds[0].title, "New race: Brand New");
    assert.equal(embeds[0].url, `https://btd6data.com/race/${NEW_RACE}`);
    const start = Math.floor(item.start / 1000);
    assert.equal(embeds[0].fields[0].value, `<t:${start}:F> (<t:${start}:R>)`);
    assert.ok(!JSON.stringify(rows()).includes("secret-token"));
  });

  it("new boss → boss embed with type, thumbnail and site link", async () => {
    const { t, discord, run, rows } = await setup();
    const bosses = fixture("btd6__bosses.json");
    const item = { id: "Lych99_mzzzzzzz", name: "Lych99", bossType: "lych", bossTypeURL: "https://static-api.nkstatic.com/x_lych.png", start: t.clock.now + DAY, end: t.clock.now + 6 * DAY };
    t.origin.override.set("/btd6/bosses", JSON.stringify({ ...bosses, body: [item, ...bosses.body] }));
    t.clock.now += 5 * MIN;
    await run();
    assert.equal(rows().length, 1);
    const e = discord.posts[0].body.embeds[0];
    assert.equal(e.title, "New boss event: Lych #99");
    assert.equal(e.url, "https://btd6data.com/boss/Lych99_mzzzzzzz");
    assert.equal(e.thumbnail.url, item.bossTypeURL);
  });

  it("new race with its ruleset cached → map, rules and map picture in the embed", async () => {
    const { t, discord, list } = await setup();
    const meta = fixture("btd6__races__Party_Madness_muekt6x6__metadata.json") as unknown as { body: Record<string, any> };
    t.origin.override.set(`/btd6/races/${NEW_RACE}/metadata`, JSON.stringify(meta));
    await list();
    const e = discord.posts[0].body.embeds[0];
    const m = meta.body;
    assert.ok(e.description.includes(String(m.difficulty)), e.description);
    const rules = e.fields.find((f: { name: string }) => f.name === "Rules").value;
    assert.ok(rules.includes(`Rounds ${m.startRound}–${m.endRound}`), rules);
    assert.ok(rules.includes(`${m.lives} lives`), rules);
    assert.equal(e.thumbnail.url, m.mapURL);
  });

  it("an id already stored in events → nothing", async () => {
    const { t, discord, list, rows } = await setup();
    addEvent(t, "race", NEW_RACE, t.clock.now, t.clock.now + DAY);
    await list();
    assert.equal(rows().length, 0);
    assert.equal(discord.posts.length, 0);
  });

  it("cold start (no previous copy) with every id already in events → nothing", async () => {
    const { t, discord, run, rows } = await setup();
    t.db.raw.exec("DELETE FROM hot_state");
    resetHotState();
    await run();
    assert.equal(rows().length, 0);
    assert.equal(discord.posts.length, 0);
  });

  it("webhook unset → no outbox rows, no POST", async () => {
    const { t, discord, list, rows } = await setup({ hook: false });
    await list();
    assert.equal(rows().length, 0);
    assert.equal(discord.posts.length, 0);
    assert.equal((t.db.raw.prepare("SELECT COUNT(*) AS n FROM events WHERE id = ?").get(NEW_RACE) as { n: number }).n, 1);
  });

  it("the same race seen on two runs is sent once", async () => {
    const { discord, list, run, rows } = await setup();
    await list();
    await run();
    await list();
    await run();
    assert.equal(rows().length, 1);
    assert.equal(discord.posts.length, 1);
  });

  it("a Discord 500 is retried each run and given up after 5 attempts", async () => {
    const { discord, list, run, rows } = await setup();
    discord.status = 500;
    await list();
    assert.equal(rows()[0].attempts, 1);
    assert.equal(rows()[0].last_error, "HTTP 500");
    assert.equal(rows()[0].sent_at, null);
    for (let i = 0; i < 6; i++) await run();
    assert.equal(rows()[0].attempts, 5);
    assert.equal(discord.posts.length, 5);
    discord.status = 204;
    await run();
    assert.equal(discord.posts.length, 5, "given up");
  });

  it("a Discord 429 waits for retry_after, then the next run delivers", async () => {
    const { discord, list, run, rows } = await setup();
    discord.status = 429;
    discord.retryAfter = 150;
    await list();
    assert.equal(rows()[0].attempts, 1);
    await run();
    assert.equal(discord.posts.length, 1, "held back");
    discord.status = 204;
    await run();
    await run();
    assert.equal(discord.posts.length, 2);
    assert.ok(rows()[0].sent_at);
  });

  describe("IndexNow channel", () => {
    const KEY = "abc123key";
    /** Setup with IndexNow on (no Discord unless asked) and a spy on its POSTs. */
    async function withIndexNow(discord = false) {
      const s = await setup({ hook: discord });
      s.t.deps.notify = { ...s.t.deps.notify, indexNowKey: KEY };
      const pings = { posts: [] as { init: RequestInit; body: any }[], status: 202, retryAfter: "" };
      const inner = s.t.deps.fetch;
      s.t.deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).startsWith("https://api.indexnow.org/")) return inner(input, init);
        pings.posts.push({ init: init!, body: JSON.parse(String(init?.body)) });
        return new Response(null, { status: pings.status, headers: pings.retryAfter ? { "retry-after": pings.retryAfter } : {} });
      }) as typeof fetch;
      return { ...s, pings };
    }

    it("new race and new ct → POST with host, key, keyLocation and the event page; 202 is sent", async () => {
      const { t, pings, list, rows } = await withIndexNow();
      await list();
      const ctFx = fixture("btd6__ct.json");
      const ct = { id: "CtNew_mzzzzzzz", name: "Ct New", start: t.clock.now + DAY, end: t.clock.now + 4 * DAY };
      t.origin.override.set("/btd6/ct", JSON.stringify({ ...ctFx, body: [ct, ...ctFx.body] }));
      t.clock.now += 5 * MIN;
      await refreshHot(t.deps);
      await t.settle();
      assert.deepEqual(rows().map((r) => r.key).sort(), [`index-ct:ct:${ct.id}`, `index-race:race:${NEW_RACE}`]);
      assert.ok(rows().every((r) => r.sent_at));
      assert.equal(pings.posts.length, 2);
      const urls = pings.posts.map((p) => p.body.urlList[0]).sort();
      assert.deepEqual(urls, [`https://btd6data.com/ct/${ct.id}`, `https://btd6data.com/race/${NEW_RACE}`]);
      const p = pings.posts[0];
      assert.equal(p.init.method, "POST");
      assert.equal((p.init.headers as Record<string, string>)["content-type"], "application/json; charset=utf-8");
      assert.equal(p.body.host, "btd6data.com");
      assert.equal(p.body.key, KEY);
      assert.equal(p.body.keyLocation, `https://btd6data.com/${KEY}.txt`);
    });

    it("no NK request and no Discord post for an IndexNow row", async () => {
      const { t, pings, discord, list } = await withIndexNow();
      const before = t.origin.calls.length;
      await list();
      assert.equal(pings.posts.length, 1);
      assert.equal(discord.posts.length, 0);
      assert.ok(!t.origin.calls.slice(before).some((c) => c.includes(`${NEW_RACE}/metadata`)), "eventDoc not called");
    });

    it("an IndexNow 429 does not hold a queued Discord row", async () => {
      const { pings, discord, list, rows } = await withIndexNow(true);
      pings.status = 429;
      pings.retryAfter = "300";
      await list();
      const byKey = Object.fromEntries(rows().map((r) => [r.key, r]));
      assert.equal(discord.posts.length, 1);
      assert.ok(byKey[`new-race:race:${NEW_RACE}`].sent_at);
      assert.equal(byKey[`index-race:race:${NEW_RACE}`].sent_at, null);
      assert.ok(byKey[`index-race:race:${NEW_RACE}`].last_error?.includes("rate limited"));
    });
  });

  it("D1 read failure during detection → no notification, refresh still works", async () => {
    const { t, discord, run, rows } = await setup();
    const item = { id: NEW_RACE, name: "Brand New", start: t.clock.now + DAY, end: t.clock.now + 4 * DAY };
    t.origin.override.set("/btd6/races", JSON.stringify({ error: null, success: true, body: [item, ...racesFixture.body], next: null, prev: null }));
    t.clock.now += 5 * MIN;
    t.db.fail.reads = true;
    const r = await refreshHot(t.deps);
    t.db.fail.reads = false;
    await t.settle();
    assert.ok(r.fetched > 0);
    await run();
    assert.equal(rows().length, 0);
    assert.equal(discord.posts.length, 0);
  });
});
