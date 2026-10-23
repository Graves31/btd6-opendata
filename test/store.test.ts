// Client store ↔ real Worker handlers (no network): batching, coalescing, freshness, profile prefetch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleApi } from "../src/worker/app.ts";
import { refreshHot } from "../src/worker/hot.ts";
import { Store } from "../web/src/store.ts";
import { bossBoardKey, historyKey, idFromUrl, needsForHref, userKey } from "../web/src/routes.ts";
import { get, makeEnv, MIN } from "./harness.ts";

const BOSS = "Vortex47_mu62cmt5";

async function setup() {
  const t = makeEnv();
  await refreshHot(t.deps);
  const clock = { now: 1_000_000 };
  const urls: string[] = [];
  const store = new Store({
    fetch: async (u) => {
      urls.push(u);
      return handleApi(t.deps, get(u));
    },
    now: () => clock.now,
  });
  return { t, store, clock, urls };
}

describe("client store", () => {
  it("seeds every hot key from one /api/now request", async () => {
    const { store, urls } = await setup();
    await store.loadNow(true);
    assert.deepEqual(urls, ["/api/now"]);
    assert.equal(store.featured.boss, BOSS);
    // The whole featured boss is now renderable with zero requests: every tab of its page.
    for (const d of ["standard", "elite"] as const) {
      for (let n = 1; n <= 4; n++) assert.ok(store.has(needsForHref(`/boss/${BOSS}?d=${d}&n=${n}`)), `${d}/${n}`);
    }
  });

  it("prefetches all visible player profiles of a leaderboard page in 2 batch calls", async () => {
    const { store, urls, t } = await setup();
    await store.loadNow(true);
    const rows = store.peek(bossBoardKey(BOSS, "standard", 1))!.data.body as { profile: string }[];
    const profileKeys = rows.map((r) => userKey(idFromUrl(r.profile)));
    assert.equal(profileKeys.length, 25);

    // What the IntersectionObserver does when the table scrolls into view: many want() calls, same tick.
    const done = Promise.all(profileKeys.map((k) => store.want([k])));
    await done;
    const batches = urls.filter((u) => u.startsWith("/api/batch"));
    assert.equal(batches.length, 2, "25 keys → one batch of 20 + one of 5");
    assert.ok(store.has(profileKeys), "every visible profile is in memory before any click");
    assert.ok(t.origin.calls.length > 0);

    // Clicking a profile afterwards costs nothing.
    const before = urls.length;
    await store.want(needsForHref(`/player/${idFromUrl(rows[3].profile)}`));
    assert.equal(urls.length, before);
  });

  it("coalesces everything requested in one tick into one batch", async () => {
    const { store, urls } = await setup();
    await store.loadNow(true);
    await Promise.all([
      store.want([bossBoardKey(BOSS, "standard", 1, 2)]),
      store.want([bossBoardKey(BOSS, "elite", 1, 2)]),
      store.want(["/btd6/challenges/challenge/ZFVHOWM"]),
    ]);
    assert.equal(urls.filter((u) => u.startsWith("/api/batch")).length, 1);
  });

  it("serves stale data instantly and revalidates it in the background", async () => {
    const { store, urls, clock } = await setup();
    await store.want(["/btd6/challenges/challenge/ZFVHOWM"]);
    const first = store.peek("/btd6/challenges/challenge/ZFVHOWM")!;
    clock.now += 2 * 60 * MIN;
    assert.equal(store.isFresh(first.key), false);
    assert.equal(store.peek(first.key), first, "still renderable while stale");
    await store.want([first.key]);
    assert.equal(urls.filter((u) => u.startsWith("/api/batch")).length, 2);
    assert.ok(store.isFresh(first.key));
  });

  it("fetches archive lists (non-NK keys) directly", async () => {
    const { store, urls } = await setup();
    await store.want([historyKey("boss")]);
    assert.deepEqual(urls, [historyKey("boss")]);
    assert.ok(Array.isArray(store.peek(historyKey("boss"))!.data.body));
  });

  it("records errors (e.g. no scores yet) so the page shows them instead of spinning", async () => {
    const { store } = await setup();
    await store.loadNow(true);
    const k = "/btd6/races/Party_Madness_muekt6x6/leaderboard";
    await store.want([k]);
    const e = store.peek(k)!;
    assert.equal(e.ok, false);
    assert.equal(e.data.error, "No Scores Available");
  });
  it("re-reading /api/now does not re-put entries whose data did not change", async () => {
    const t = makeEnv();
    await refreshHot(t.deps);
    const clock = { now: 1_000_000 };
    let received = 0;
    const store = new Store({ fetch: async (u) => handleApi(t.deps, get(u)), now: () => clock.now, onEntry: () => received++ });
    await store.loadNow(true);
    const first = received;
    const keys = [...(store as unknown as { map: Map<string, unknown> }).map.keys()];
    const before = new Map(keys.map((k) => [k, store.peek(k)]));
    clock.now += 3 * MIN;
    await store.loadNow(true);
    assert.ok(first > 0);
    assert.equal(received, first, "no entry was put again");
    for (const k of keys) assert.equal(store.peek(k), before.get(k), k);
    assert.ok(store.isFresh(keys[0]), "freshness was extended");
  });
});
