import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleApi } from "../src/worker/app.ts";
import { DAILY_CAP } from "../src/worker/suggest.ts";
import { DAY, makeEnv } from "./harness.ts";

const HOOK = "https://discord.test/api/webhooks/1/secret";
const TEXT = "The boss page shows the wrong tier count";
let ip = 0;

/** Env with a recording Discord stub; each call of `send` is a fresh visitor unless `ip` is given. */
function setup(hook: string | undefined) {
  const t = makeEnv();
  const posts: { url: string; body: any }[] = [];
  const discord = { down: false };
  t.deps.fetch = (async (url: string, init: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return discord.down ? new Response("no", { status: 500 }) : new Response(null, { status: 204 });
  }) as typeof fetch;
  t.deps.suggest = { webhookUrl: hook };
  const visitor = `10.9.0.${++ip}`;
  const send = async (body: unknown, headers: Record<string, string> = {}, who = visitor) => {
    const res = await handleApi(
      t.deps,
      new Request("https://site.test/api/suggest", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { Origin: "https://site.test", "CF-Connecting-IP": who, ...headers },
      }),
    );
    await t.settle();
    return res;
  };
  const rows = () => (t.db.raw.prepare("SELECT * FROM suggestions").all() as any[]);
  return { t, posts, discord, send, rows, visitor };
}

describe("suggestions box", () => {
  it("stores the row and posts to Discord", async () => {
    const s = setup(HOOK);
    const res = await s.send({ text: `  ${TEXT}  `, kind: "data", page: "Boss", pageUrl: "/boss/x", discord: "me", width: 390, version: "2.8.2", t: 9000 });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await res.json(), { success: true });
    const [row, ...more] = s.rows();
    assert.equal(more.length, 0);
    assert.equal(row.text, TEXT);
    assert.equal(row.kind, "data");
    assert.equal(row.width, 390);
    assert.equal(row.page_url, "/boss/x");
    assert.equal(s.posts.length, 1);
    assert.equal(s.posts[0].url, HOOK);
    const e = s.posts[0].body.embeds[0];
    assert.equal(e.title, "Suggestion: Wrong data");
    assert.deepEqual(s.posts[0].body.allowed_mentions, { parse: [] });
    assert.deepEqual(e.fields.map((f: any) => f.name), ["Page", "Discord name", "Screen width", "Version"]);
    assert.equal(e.fields[0].value, "`Boss`\n`https://site.test/boss/x`");
  });

  it("stores without a webhook, posts nothing", async () => {
    const s = setup(undefined);
    assert.equal((await s.send({ text: TEXT })).status, 200);
    assert.equal(s.rows().length, 1);
    assert.equal(s.posts.length, 0);
  });

  it("rejects malformed bodies with 400 bad_request", async () => {
    const s = setup(HOOK);
    const cases: unknown[] = [
      "{nope",
      "[]",
      { text: "short" },
      { text: "x".repeat(1001) },
      { text: 5 },
      { text: TEXT, kind: "spam" },
      { text: TEXT, page: "p".repeat(121) },
      { text: TEXT, pageUrl: "https://evil.test/" },
      { text: TEXT, pageUrl: "/" + "a".repeat(300) },
      { text: TEXT, discord: "d".repeat(41) },
      { text: TEXT, version: "v".repeat(21) },
      { text: TEXT, width: "wide" },
      { text: TEXT, t: "slow" },
      { text: TEXT, pad: "z".repeat(9000) },
    ];
    for (const c of cases) {
      const res = await s.send(c);
      assert.equal(res.status, 400, JSON.stringify(c).slice(0, 60));
      assert.deepEqual(await res.json(), { success: false, error: "Invalid request", code: "bad_request" });
    }
    assert.equal(s.rows().length, 0);
    assert.equal(s.posts.length, 0);
  });

  it("is same-origin only (403) and POST only (405)", async () => {
    const s = setup(HOOK);
    for (const h of [{ Origin: "https://evil.test" }, { Origin: "http://site.test" }]) {
      const res = await s.send({ text: TEXT }, h);
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "bad_request");
    }
    const noOrigin = await handleApi(s.t.deps, new Request("https://site.test/api/suggest", { method: "POST", body: JSON.stringify({ text: TEXT }) }));
    assert.equal(noOrigin.status, 403);
    for (const method of ["GET", "HEAD", "PUT"]) {
      const res = await handleApi(s.t.deps, new Request("https://site.test/api/suggest", { method }));
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("Allow"), "POST");
    }
    assert.equal(s.rows().length, 0);
  });

  it("honeypot, fast form and duplicate text answer 200 but store and send nothing more", async () => {
    const s = setup(HOOK);
    assert.deepEqual(await (await s.send({ text: TEXT, hp: "http://spam" })).json(), { success: true });
    assert.deepEqual(await (await s.send({ text: TEXT, t: 1000 })).json(), { success: true });
    assert.equal(s.rows().length, 0);
    assert.equal(s.posts.length, 0);
    assert.equal((await s.send({ text: TEXT })).status, 200);
    assert.equal((await s.send({ text: ` ${TEXT} ` })).status, 200); // duplicate
    assert.equal(s.rows().length, 1);
    assert.equal(s.posts.length, 1);
    s.t.clock.now += DAY + 1; // a day later the same text is accepted again
    await s.send({ text: TEXT });
    assert.equal(s.rows().length, 2);
  });

  it("4th submit from one client is 429 (visitor); other clients are unaffected", async () => {
    const s = setup(HOOK);
    for (let i = 0; i < 3; i++) assert.equal((await s.send({ text: `${TEXT} number ${i}` })).status, 200);
    const res = await s.send({ text: `${TEXT} number 4` });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.code, "rate_limited");
    assert.equal(body.scope, "visitor");
    assert.ok(body.retryAfter > 0);
    assert.equal(res.headers.get("Retry-After"), String(body.retryAfter));
    assert.equal(s.rows().length, 3);
    assert.equal((await s.send({ text: `${TEXT} number 5` }, {}, "10.8.8.8")).status, 200);
  });

  it("daily cap: 429 daily after the 100th, one cap alert", async () => {
    const s = setup(HOOK);
    const insert = s.t.db.raw.prepare("INSERT INTO suggestions (created_at, text) VALUES (?, ?)");
    const dayStart = s.t.clock.now - (s.t.clock.now % DAY);
    s.t.clock.now = dayStart + 1000;
    for (let i = 0; i < DAILY_CAP - 1; i++) insert.run(dayStart + i, `earlier ${i}`);
    assert.equal((await s.send({ text: `${TEXT} the hundredth` })).status, 200);
    assert.equal(s.rows().length, DAILY_CAP);
    assert.equal(s.posts.length, 2);
    assert.match(s.posts[1].body.embeds[0].description, /Daily suggestion cap \(100\) reached; new suggestions are refused until 00:00 UTC\./);
    const res = await s.send({ text: `${TEXT} the 101st` });
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.scope, "daily");
    assert.equal(body.retryAfter, Math.ceil((DAY - 1000) / 1000));
    assert.equal(res.headers.get("Retry-After"), String(body.retryAfter));
    assert.equal(s.rows().length, DAILY_CAP);
    assert.equal(s.posts.length, 2);
  });

  it("Discord down still answers 200 and keeps the row", async () => {
    const s = setup(HOOK);
    s.discord.down = true;
    assert.equal((await s.send({ text: TEXT })).status, 200);
    assert.equal(s.rows().length, 1);
  });

  it("D1 write failure is 503 unavailable", async () => {
    const s = setup(HOOK);
    s.t.db.fail.writes = true;
    const res = await s.send({ text: TEXT });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "unavailable");
    assert.equal(s.posts.length, 0);
  });

  it("user text cannot break out of the code block", async () => {
    const s = setup(HOOK);
    await s.send({ text: "before ``` @everyone [x](http://evil.test) ``` after", pageUrl: "/a`b" });
    const e = s.posts[0].body.embeds[0];
    const d: string = e.description;
    assert.ok(d.startsWith("```\n") && d.endsWith("\n```"));
    assert.equal(d.split("```").length, 3); // only our own opening and closing fences
    assert.ok(!e.fields[0].value.slice(1, -1).includes("`"));
  });
});
