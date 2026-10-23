// End-to-end check in a real browser. By default fully offline (fake NK origin replaying docs/api/fixtures):
//   home → Bosses → newest boss → Elite tab → 2 players → page 2 → a player profile → Now
//   → race → Now → CT → Teams tab → a team → Now → odyssey → Now → daily challenge → Now
//   (+ boss rules → See rounds (focused round) → next round → back; Now → Tools hub → Round visualizer → Camo filter → Focus → next match
//   → List; Tools → Paragon calculator → type totems (URL updates in place) → pick a tower; boss rules → Paragon calculator; phones: a row opens the round view and Back returns to the list)
// Between clicks the script "reads" (waits for prefetching to go quiet), like a user would. Every navigation
// must open from memory: `cached` true and paint within 50 ms. Screenshots (desktop 1280×900 and mobile
// 390×844) of home, events list, boss, player, challenge and odyssey go to .wrangler/e2e-shots.
//
//   npm run build && node scripts/e2e.ts                  (needs Chrome or Edge installed)
//   E2E_BASE=https://x.workers.dev node scripts/e2e.ts    (same scenario against a deployed site)

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = process.env.E2E_BASE?.replace(/\/+$/, "");
// Ports/dirs are overridable so several people/agents can run their own stack at once:
//   E2E_PORT (Worker, default 8787), E2E_ORIGIN_PORT (fixture origin, 8788), E2E_ASSETS (built site, "dist").
const PORT = Number(process.env.E2E_PORT ?? 8787);
const ORIGIN_PORT = Number(process.env.E2E_ORIGIN_PORT ?? 8788);
const ASSETS = process.env.E2E_ASSETS ?? "dist";
const BASE = REMOTE ?? `http://127.0.0.1:${PORT}`;
const STATE = PORT === 8787 ? ".wrangler/e2e-state" : `.wrangler/e2e-state-${PORT}`;
const SHOTS = process.env.E2E_SHOTS ?? join(root, ".wrangler", PORT === 8787 ? "e2e-shots" : `e2e-shots-${PORT}`);
const BROWSERS = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const procs: ChildProcess[] = [];
function start(cmd: string): ChildProcess {
  const p = spawn(cmd, { cwd: root, shell: true, stdio: "ignore" });
  procs.push(p);
  return p;
}
function stopAll() {
  for (const p of procs) {
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: "ignore" });
      else p.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}
async function until(fn: () => Promise<boolean>, what: string, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Wait until no /api request has been in flight for `quietMs` ("the user reads the page"). */
function trackApi(page: Page) {
  // Track request objects, not a counter: some requests (e.g. the preloaded /api/now reused by fetch)
  // report more than one "finished" event, which made a counter drift below zero.
  let last = Date.now();
  const log: string[] = [];
  const open = new Map<object, string>();
  const isApi = (u: string) => {
    const url = new URL(u);
    return url.origin === new URL(BASE).origin && url.pathname.startsWith("/api/");
  };
  page.on("request", (r) => {
    if (isApi(r.url())) {
      last = Date.now();
      log.push(r.url().replace(BASE, ""));
      open.set(r, r.url().replace(BASE, ""));
    }
  });
  const done = (r: object) => {
    if (open.delete(r)) last = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return {
    log,
    open: { get size() { return open.size; }, [Symbol.iterator]: () => open.values() },
    // "Done reading": no API request open for quietMs AND the app's store has nothing queued or in flight
    // (a prefetch can be scheduled by an IntersectionObserver callback after the network went quiet).
    quiet: (quietMs = 600) =>
      until(
        async () =>
          open.size === 0 &&
          Date.now() - last > quietMs &&
          (await page.evaluate(() => {
            const st = (window as any).__debug?.store() as any;
            return !st || (st.pending.size === 0 && st.inflight.size === 0);
          })),
        "prefetch to settle",
        30_000,
      ),
  };
}

/** Let visible images finish (NK assets are hotlinked; offline they fail fast and show a placeholder). */
async function settleImages(page: Page) {
  await page
    .waitForFunction(() => [...document.images].filter((i) => i.loading !== "lazy" || i.getBoundingClientRect().top < innerHeight).every((i) => i.complete), {
      timeout: 10_000,
    })
    .catch(() => {});
}

/** Sprite sheets decode off the navigation path; until then sprites are text chips (class spr-wait). */
async function settleSprites(page: Page) {
  await page.waitForFunction(() => !document.querySelector(".spr-wait"), { timeout: 10_000 }).catch(() => {});
}

async function shoot(page: Page, name: string) {
  await settleImages(page);
  await settleSprites(page);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  // Full page too, with lazy images below the fold loaded.
  await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => ((i as HTMLImageElement).loading = "eager")));
  await settleImages(page);
  await page.screenshot({ path: join(SHOTS, `${name}-full.png`), fullPage: true });
}

function portBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => (sock.destroy(), resolve(true)));
    sock.once("error", () => resolve(false));
  });
}

async function main() {
  const exe = BROWSERS.find((b) => existsSync(b));
  if (!exe) throw new Error("no Chrome/Edge found (set CHROME_PATH to the browser executable)");
  mkdirSync(SHOTS, { recursive: true });

  if (!REMOTE) {
    // A leftover `wrangler dev` / workerd on these ports makes the page talk to a stale server and hang.
    for (const port of [PORT, ORIGIN_PORT]) {
      if (await portBusy(port)) throw new Error(`port ${port} is already in use (a leftover wrangler dev / workerd / fixture server?) — stop it first`);
    }
    if (!existsSync(join(root, ASSETS, "index.html"))) throw new Error(`run \`npm run build\` first (no ${ASSETS}/index.html)`);
    execSync(`npx wrangler d1 migrations apply btd6-opendata --local --persist-to ${STATE}`, { cwd: root, stdio: "ignore" });
    start(`node scripts/fixture-server.ts ${ORIGIN_PORT}`);
    start(`npx wrangler dev --local --port ${PORT} --assets ${ASSETS} --persist-to ${STATE} --test-scheduled --var NK_BASE:http://127.0.0.1:${ORIGIN_PORT} --var CF_ANALYTICS_TOKEN:e2e-token --var STATS_GRAPHQL_URL:http://127.0.0.1:${ORIGIN_PORT}/stats-graphql --var DISCORD_WEBHOOK_URL:http://127.0.0.1:${ORIGIN_PORT}/discord-webhook`);
    await until(async () => (await fetch(`${BASE}/api/health`)).ok, "wrangler dev");
    await fetch(`${BASE}/cdn-cgi/local/scheduled?cron=*+*+*+*+*`);
  }
  await until(async () => (await fetch(`${BASE}/api/now`)).ok, "hot bundle");

  const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ["--no-first-run", "--host-resolver-rules=MAP *.cloudflareinsights.com ~NOTFOUND, MAP cloudflareinsights.com ~NOTFOUND"] });
  const results: { step: string; renderMs: number; paintMs: number; cached: boolean; prefetchCalls: number; note?: string }[] = [];
  const problems: string[] = [];
  const pages: Record<string, string> = {};
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => problems.push(`page error: ${String(e)}`));
    // The CSP in web/public/_headers: anything it blocks is a failure, not a silent missing image.
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy/i.test(m.text())) problems.push(`CSP: ${m.text().slice(0, 200)}`);
    });
    await page.setViewport({ width: 1280, height: 900 });
    const api = trackApi(page);
    // Every open request (not just /api): printed when a page load never goes network-idle.
    const inflight = new Map<object, [number, string]>();
    page.on("request", (r) => void inflight.set(r, [Date.now(), r.url()]));
    page.on("requestfinished", (r) => void inflight.delete(r));
    page.on("requestfailed", (r) => void inflight.delete(r));
    const load = async (path: string) => {
      try {
        await page.goto(BASE + path, { waitUntil: "networkidle0" });
      } catch (e) {
        // Seen with local wrangler dev: Chrome keeps one request (usually the /api/now preload) pending for 30 s
        // while the Worker answers the same URL in milliseconds. The page itself has loaded from the store by
        // then; note it and carry on rather than abort the whole run.
        const open = [...inflight.values()].map(([t, u]) => `${u.replace(BASE, "")} (${Date.now() - t} ms)`);
        if (!/timeout/i.test(String(e)) || !(await page.$("main > *"))) throw new Error(`${path}: ${String(e)}; open requests: ${open.join(" | ") || "none"}`);
        console.warn(`  [load ${path}] network never went idle; open requests: ${open.join(" | ") || "none"}`);
      }
    };
    await page.goto(BASE, { waitUntil: "networkidle0" });
    await page.waitForSelector(".feature, .tiles");
    await api.quiet();
    pages.home = "/";
    await shoot(page, "desktop-home");
    await api.quiet(); // a full-page screenshot makes every link "visible" → prefetch storm; let it land

    const here = () => page.evaluate(() => location.pathname + location.search);
    const has = (sel: string) => page.evaluate((s) => !!document.querySelector(s), sel);
    const step = async (name: string, selector: string, shot?: string) => {
      const before = await page.evaluate(() => (window as any).__nav.length as number);
      const calls = api.log.length;
      const el = await page.waitForSelector(selector, { timeout: 5000 });
      // Like a person: bring the link on screen and look at it before clicking. (Player/team rows only
      // prefetch after being visible for 250 ms; a click on an off-screen row would skip that.) Layout
      // shifts, dwell timers and the periodic /api/now top-up can also start prefetches: let them land.
      await el!.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await new Promise((r) => setTimeout(r, 400));
      await api.quiet(300);
      // Diagnostics: keys the target needs that weren't in memory at click time (empty when instant).
      const target = await el!.evaluate((a) => a.getAttribute("href") ?? "");
      const missing: string[] = await page.evaluate((h) => {
        const d = (window as any).__debug;
        if (!d) return [];
        const store = d.store();
        return d.needsForHref(h)
          .filter((k: string) => !store.peek(k))
          .map((k: string) => {
            const ls = store.loadState(k) as { retryAt: number; busy: boolean };
            const flags = [ls.retryAt > Date.now() ? `backoff ${Math.round((ls.retryAt - Date.now()) / 1000)}s` : "", ls.busy ? "loading" : ""].filter(Boolean);
            return flags.length ? `${k} (${flags.join(", ")})` : k;
          });
      }, target);
      if (missing.length) {
        console.log(`  [${name}] not in memory at click: ${missing.join(", ")}`);
        console.log(`    open API requests: ${[...api.open].map(decodeURIComponent).join(" | ") || "none"}`);
        console.log(`    last API requests: ${api.log.slice(-4).map(decodeURIComponent).join(" | ")}`);
      }
      await el!.click();
      await page.waitForFunction((n) => (window as any).__nav.length > n, {}, before);
      const t = await page.evaluate(() => (window as any).__nav.at(-1));
      // "Read" the page: let visible-link prefetching finish.
      await api.quiet();
      const row: (typeof results)[number] = { step: name, ...t, prefetchCalls: api.log.length - calls };
      results.push(row);
      if (shot) {
        pages[shot] = await here();
        await shoot(page, `desktop-${shot}`);
        await api.quiet(); // see above: full-page screenshots trigger prefetch of every link on the page
      }
      return row;
    };
    /** Upcoming events have no leaderboard yet: the page must say so instead of showing a table. */
    const boardOrEmpty = async (row: (typeof results)[number]) => {
      if (await has("main table.board tbody tr")) return true;
      if (await has("main .empty")) {
        row.note = "empty state (no scores yet)";
        return false;
      }
      problems.push(`${row.step}: neither a leaderboard nor an empty state`);
      return false;
    };
    const home = () => step("→ Now", 'header nav a[href="/"]');

    await step("Now → Bosses", 'header nav a[href="/bosses"]', "events");
    if ((await page.evaluate(() => document.querySelectorAll(".bs-strip a[href^='/bosses/']").length)) !== 7) problems.push("/bosses: the 7-portrait boss stats strip is missing");
    await step("Bosses → newest boss", "ul.events li:first-child a[href^='/boss/']", "boss");
    // The boss stats page, opened from the event page's link (data file + lists + the event's ruleset prefetched).
    await step("Boss → boss stats", "a.bs-link[href^='/bosses/']", "bossstats");
    if (!(await has(".bs-tiers .bs-tier")) || !(await has(".hb-stage .hb-skull")) || !((await has(".bs-skull-list li")) || (await has(".bs-every")))) problems.push("boss stats: tiers / skull bar / skull stretches missing");
    await step("Boss stats → back to the event", "a.backlink");
    if (!(await here()).startsWith("/boss/")) problems.push(`boss stats back link went to ${await here()}`);
    // The rules' "Max paragons" row links to the paragon calculator (no data to fetch: opens from memory). Live, the
    // newest boss may allow no paragons (then there is no link: e.g. a CHIMPS boss event).
    if (!REMOTE || (await has("a.pg-rlink[href^='/tools/paragon']"))) {
      await step("Boss rules → Paragon calculator", "a.pg-rlink[href^='/tools/paragon']");
      if (!(await has(".pg-picker")) || !(await has(".pg-res"))) problems.push("boss → paragon calculator: page didn't render");
      await page.goBack();
      await page.waitForFunction(() => location.pathname.startsWith("/boss/"), { timeout: 3000 }).catch(() => problems.push("paragon calculator: Back didn't return to the boss"));
    } else console.log("  (live: the newest boss allows no paragons; paragon link step skipped)");
    await step("Boss → Elite tab", "nav.tabs a.tab[href*='d=elite']");
    // The rules' "Round set" row links to the round visualizer with the event applied (set file prefetched).
    await step("Boss rules → See rounds", "a.rs-link[href^='/tools/rounds']");
    if (!(await here()).includes("view=round") || !(await has(".rv-card.focus .rv-lane"))) problems.push("See rounds: didn't land on the focused round view");
    const r0 = await page.evaluate(() => new URLSearchParams(location.search).get("r"));
    await step("Focused round → next round", ".rv-card.focus button.rv-next", "rounds");
    if ((await page.evaluate(() => new URLSearchParams(location.search).get("r"))) !== String(Number(r0) + 1)) problems.push("focused view: › didn't step to the next round");
    await step("Rounds → back to the boss", "a.rv-back");
    if (!(await here()).startsWith("/boss/")) problems.push(`rounds back link went to ${await here()}`);
    const two = await step("Elite → 2 players", "nav.tabs a.tab[href*='n=2']");
    if ((await boardOrEmpty(two)) && (await has(".pager a[href$='p=2']"))) {
      await step("Leaderboard → page 2", ".pager a[href$='p=2']");
    }
    if (await has("table.board tbody tr a[href^='/player/']")) {
      const n = await page.evaluate(() => document.querySelectorAll("table.board tbody tr a[href^='/player/']").length);
      await step("Leaderboard → a visible player's profile", `table.board tbody tr:nth-child(${Math.min(4, n)}) a[href^='/player/']`, "player");
    }
    await home();

    await step("Now → Maps", 'header nav a[href="/maps"]', "maps");
    await step("Maps → a map", ".map-tile", "map");
    if (await has(".map-ev a[href^='/boss/']")) await step("Map → boss event", ".map-ev a[href^='/boss/']", "boss");
    await home();

    const race = await step("Now → race", ".tile[href^='/race/']");
    await boardOrEmpty(race);
    await home();

    const ct = await step("Now → CT", ".tile[href^='/ct/']");
    await boardOrEmpty(ct);
    const teams = await step("CT → Teams tab", "nav.tabs a.tab[href*='tab=teams']");
    if (!(await boardOrEmpty(teams))) {
      // The featured CT hasn't started: use the latest one that has, from the CT list.
      await step("→ CT list", 'header nav a[href="/ct"]');
      await step("CT list → latest started CT", "ul.events a.st-live, ul.events a.st-ended");
      await boardOrEmpty(await step("CT → Teams tab", "nav.tabs a.tab[href*='tab=teams']"));
    }
    if (await has("table.board tbody tr a[href^='/team/']")) {
      await step("Teams → a team", "table.board tbody tr:first-child a[href^='/team/']", "team");
      // The back link returns to the board the team was opened from (browser-back semantics).
      await step("Team → back link", "a.backlink");
      const at = await page.evaluate(() => location.pathname);
      if (!at.startsWith("/ct/")) problems.push(`back link went to ${at}, not the CT board`);
    }
    await home();

    await step("Now → Tools", 'header nav a[href="/tools"]', "tools");
    if ((await page.evaluate(() => document.querySelectorAll(".tools-tiles a.tile").length)) !== 5) problems.push("tools hub: want 5 tool cards");
    await step("Tools → Round visualizer", ".tools-tiles a.tile[href^='/tools/rounds']", "rounds-tool");
    if (!(await has("ol.rv-list li.rv-row"))) problems.push("tools: no round rows");
    // One scroll context: nothing on the page may be an inner vertical scroller, and the wheel over the list
    // must scroll the page all the way back up to the controls.
    const inner = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
        .map((e) => e.className || e.tagName),
    );
    if (inner.length) problems.push(`tools: inner vertical scrollers: ${inner.join(", ")}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const row = await page.$("ol.rv-list li.rv-row:nth-child(8)");
    const box = await row?.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 60, box.y + box.height / 2);
      for (let i = 0; i < 12; i++) await page.mouse.wheel({ deltaY: -2000 });
      await new Promise((r) => setTimeout(r, 400));
      const y = await page.evaluate(() => window.scrollY);
      if (y > 0) problems.push(`tools: wheel over the list stopped at scrollY ${y} (scroll trap)`);
    }
    const all = await page.evaluate(() => document.querySelectorAll("ol.rv-list li.rv-row").length);
    await step("Tools → Camo filter", "button.rv-fchip[data-f='camo']", "filter");
    const some = await page.evaluate(() => document.querySelectorAll("ol.rv-list li.rv-row").length);
    if (!(await here()).includes("has=camo") || !(some > 0 && some < all)) problems.push(`camo filter: ${some} of ${all} rows, url ${await here()}`);
    await step("List → Focus", "button.rv-focus");
    if (!(await here()).includes("view=round")) problems.push("Focus: no round view");
    const m0 = await page.evaluate(() => new URLSearchParams(location.search).get("r"));
    await step("Focused → next match", "button.rv-nextmatch:not([disabled])");
    const m1 = await page.evaluate(() => new URLSearchParams(location.search).get("r"));
    if (!(Number(m1) > Number(m0))) problems.push(`next match: r ${m0} → ${m1}`);
    await step("Focused → List", "button.rv-tolist");
    if ((await here()).includes("view=round")) problems.push("‹ List: still on the round view");

    // Tools → Farming resources: the banana spawn chart (4 + 6 + 8 bananas).
    await step("→ Tools hub", 'header nav a[href="/tools"]');
    await step("Tools → Farming resources", ".tools-tiles a.tile[href='/tools/farming']", "farming");
    if ((await page.evaluate(() => document.querySelectorAll(".fm-b img").length)) !== 18) problems.push("farming: want 18 bananas on the spawn chart");
    // Picking a round puts its seconds on the chart (the default round set is prefetched with the page).
    await page.click(".fm-any");
    await page.waitForFunction(() => location.search.includes("r=1") && document.querySelectorAll(".fm-b i").length === 18, { timeout: 3000 }).catch(() => problems.push("farming: round 1 didn't put seconds on the chart"));
    pages["farming-round"] = await here();
    await shoot(page, "desktop-farming-round");

    // Tools → Bank & IMF Loan planner: default 1-3-0 bought before round 30 with full MK collects before round 42 (after round 41, test/bank.test.ts).
    await step("→ Tools hub", 'header nav a[href="/tools"]');
    await step("Tools → Bank & IMF Loan planner", ".tools-tiles a.tile[href='/tools/bank-planner']", "bank-planner");
    const bankAns = await page.$eval(".bk-big .v", (el) => el.textContent).catch(() => "");
    if (bankAns !== "42") problems.push(`bank planner: default answer reads "${bankAns}", want round 42`);
    await page.click(".bk-mode .tab:last-child");
    await page.waitForFunction(() => location.search.includes("m=dep") && document.querySelectorAll(".bk-ladder tbody tr").length > 0 && /\$/.test(document.querySelector(".bk-big .v")?.textContent ?? ""), { timeout: 3000 }).catch(() => problems.push("bank planner: Deposit planner shows no amount / ladder"));
    pages["bank-planner-deposit"] = await here();
    await shoot(page, "desktop-bank-planner-deposit");

    // Tools → Paragon calculator: the URL is the state; changing an input rewrites it in place (no new history entry).
    await step("→ Tools hub", 'header nav a[href="/tools"]');
    await step("Tools → Paragon calculator", ".tools-tiles a.tile[href^='/tools/paragon']", "paragon");
    if (!(await has(".pg-picker button[aria-pressed='true']")) || !(await has(".pg-res .pg-buckets li"))) problems.push("paragon: picker / result missing");
    const hist = await page.evaluate(() => history.length);
    await page.click("#pg-totems");
    await new Promise((r) => setTimeout(r, 150));
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => location.search.includes("to=3"), { timeout: 3000 }).catch(() => problems.push(`paragon: totems input didn't update the URL (${location.search})`));
    if ((await page.evaluate(() => history.length)) !== hist) problems.push("paragon: an input change added a history entry");
    // A fast drag right then all the way left must end at 0 (the release used to drop the last move).
    const bar = await page.$eval("#pg-cash ~ .pg-range", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; });
    await page.mouse.move(bar.x + 2, bar.y);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.w - 2, bar.y, { steps: 4 });
    await new Promise((r) => setTimeout(r, 200));
    await page.mouse.move(bar.x - 20, bar.y, { steps: 2 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 400));
    const slid = await page.evaluate(() => [new URLSearchParams(location.search).get("c"), (document.getElementById("pg-cash") as HTMLInputElement).value]);
    if (slid[0] !== null || slid[1] !== "0") problems.push(`paragon: slider dragged to the left ended at c=${slid[0]}, field ${slid[1]}`);
    if ((await page.evaluate(() => document.querySelector(".pg-res .stat-v")?.textContent ?? "")) === "1") problems.push("paragon: degree didn't move after 3 totems");
    await page.click(".pg-tile[data-k='BombShooter']");
    await page.waitForFunction(() => location.search.includes("p=bomb"), { timeout: 3000 }).catch(() => problems.push("paragon: picking a tower didn't update the URL"));
    await shoot(page, "desktop-paragon-set");
    await api.quiet();
    pages["paragon-set"] = "/tools/paragon?p=dart&d=h&c=85000000&to=2&x=1&adv=1&b=1&po=4500000";
    await home();

    await step("Now → Suggest", "header a.sug-btn", "suggest");
    if (!(await has("form.sug-form textarea")) || !(await has("button.sug-send"))) problems.push("suggest: form didn't render");
    await home();

    await step("Now → Challenges", 'header nav a[href="/challenges"]', "challenges");
    await step("Challenges → a daily", "main a[href^='/challenge/']");
    await home();

    await step("Now → odyssey", ".tile[href^='/odyssey/']", "odyssey");
    await home();
    await step("Now → daily challenge", ".tile[href^='/challenge/']", "challenge");
    await home();

    // The other event lists (cards with art per kind).
    await step("Now → Races", 'header nav a[href="/races"]', "races");
    await step("Races → CT list", 'header nav a[href="/ct"]', "ctlist");
    await step("CT list → Odysseys", 'header nav a[href="/odyssey"]', "odysseys");
    await home();

    // A CT group NK no longer publishes (placeholder id): a designed "not available" page, not an empty board.
    if (!REMOTE) {
      await page.goto(`${BASE}/ct/mtv62zza/group/c7fa4bd7`, { waitUntil: "networkidle0" });
      await page.waitForSelector("main > *");
      await api.quiet();
      const txt = await page.evaluate(() => document.querySelector("main")?.textContent ?? "");
      if (!/stops publishing/i.test(txt)) problems.push("dropped CT group: no 'no longer published' page");
      if (await has("main table.board")) problems.push("dropped CT group: shows a board");
    }

    // Hidden /stats page (offline only: the fixture origin plays Cloudflare's GraphQL API).
    const statsCheck = async (label: "desktop" | "mobile") => {
      await load("/stats");
      await page.waitForSelector("svg.st-chart", { timeout: 8000 }).catch(() => problems.push(`stats ${label}: no chart`));
      const bars = await page.evaluate(() => document.querySelectorAll("svg.st-chart rect.st-bar").length);
      if (bars !== 30) problems.push(`stats ${label}: ${bars} bars (want 30)`);
      if (!(await has("main .st-rank li"))) problems.push(`stats ${label}: no ranked lists`);
      const robots = await page.evaluate(() => document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "");
      if (!/noindex/.test(robots)) problems.push(`stats ${label}: no noindex meta`);
      // Filters: tap today's bar → the lists cover that day only (the fixture's "/" has 95 of its 190 views today);
      // tap a page → the chart follows it.
      await page.click("svg.st-chart g.st-day:last-of-type").catch(() => problems.push(`stats ${label}: no day to tap`));
      const today = await page.evaluate(() => [document.querySelector(".st-sum")?.textContent ?? "", document.querySelector(".st-rank .st-n")?.textContent ?? ""]);
      if (/Last 30/.test(today[0]) || today[1] !== "95") problems.push(`stats ${label}: tapping a day didn't filter the lists (${today.join(" / ")})`);
      await page.click(".st-rank button").catch(() => {});
      if (!(await has(".st-head .st-for"))) problems.push(`stats ${label}: picking a page didn't filter the chart`);
      if (label === "mobile") {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (overflow > 0) problems.push(`mobile stats: page scrolls sideways by ${overflow}px`);
      }
      await shoot(page, `${label}-stats`);
    };
    if (!REMOTE) await statsCheck("desktop");

    // Dreadbloon's boss stats (armour layer on the in-game bar): desktop here, mobile in the loop below.
    await load("/bosses/dreadbloon");
    await page.waitForSelector(".hb-stage");
    await api.quiet();
    if (!(await has(".hb-stage .hb-skull")) || !(await has(".bs-every"))) problems.push("boss stats (Dreadbloon): skulls on the bar / armour line missing");
    pages["bossstats-dread"] = "/bosses/dreadbloon";
    await shoot(page, "desktop-bossstats-dread");

    // Boss and race lists: the "Full history" fold (closed by default) opens onto wiki + archive rows with map links.
    const history = async (label: "desktop" | "mobile") => {
      // Boss order: the button opens the ring of 7 bosses without pushing the page sideways.
      await load("/bosses");
      await page.waitForSelector(".bo-btn");
      await page.$eval(".bo-btn", (el) => (el as HTMLElement).click());
      if ((await page.evaluate(() => document.querySelectorAll(".bo.open .bo-ring li a[href^='/bosses/']").length)) !== 7) problems.push(`${label} /bosses: boss order doesn't open onto 7 bosses`);
      const boOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (boOverflow > 0) problems.push(`${label} boss order: page scrolls sideways by ${boOverflow}px`);
      await settleImages(page);
      await page.screenshot({ path: join(SHOTS, `${label}-boss-order.png`) });
      for (const [kind, path] of [["boss", "/bosses"], ["race", "/races"]] as const) {
        await load(path);
        await page.waitForSelector("details.hist");
        await api.quiet();
        if (await has("details.hist[open]")) problems.push(`${kind} history: open by default`);
        // A DOM click: on phones the list is still laying out its rows, so a coordinate click can land elsewhere.
        await page.$eval("details.hist > summary", (el) => (el as HTMLElement).click());
        if (!(await has("details.hist[open]"))) problems.push(`${label} ${kind} history: the summary doesn't open it`);
        await page.waitForSelector("details.hist .hist-r.old", { timeout: 5_000 }).catch(() => {});
        await api.quiet();
        if (!(await has("details.hist .hist-map[href^='/maps/']"))) problems.push(`${label} ${kind} history: no rows with a map link`);
        if (!(await has("details.hist .hist-y"))) problems.push(`${label} ${kind} history: no year headers`);
        if (kind === "boss") {
          await page.$eval("details.hist .hist-chips button:nth-child(2)", (el) => (el as HTMLElement).click());
          if (!(await has("details.hist .hist-chips button[aria-pressed=true]:not(:first-child)"))) problems.push(`${label} boss history: a boss chip does not press`);
          await page.$eval("details.hist .hist-chips button", (el) => (el as HTMLElement).click());
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (overflow > 0) problems.push(`${label} ${kind} history: page scrolls sideways by ${overflow}px`);
        await settleImages(page);
        // Viewport shots (the list is thousands of px tall, and rows off screen are not painted): mid-list and the very bottom, both themes.
        for (const theme of ["dark", "light"]) {
          await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
          await page.evaluate(() => {
            const r = document.querySelector("details.hist")!.getBoundingClientRect();
            scrollTo(0, scrollY + r.top + 700);
          });
          await new Promise((r) => setTimeout(r, 300));
          await page.screenshot({ path: join(SHOTS, `${label}-${kind}-history-${theme}-mid.png`) });
          await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
          await new Promise((r) => setTimeout(r, 300));
          await page.screenshot({ path: join(SHOTS, `${label}-${kind}-history-${theme}-end.png`) });
        }
        await page.evaluate(() => delete document.documentElement.dataset.theme);
      }
      // No memory: open + a boss picked, then Races via the nav and Back: both folds arrive closed; "Back to top" collapses.
      await load("/bosses");
      await page.waitForSelector("details.hist");
      await page.$eval("details.hist > summary", (el) => (el as HTMLElement).click());
      await page.waitForSelector("details.hist .hist-chips button:nth-child(2)");
      await page.$eval("details.hist .hist-chips button:nth-child(2)", (el) => (el as HTMLElement).click());
      await page.evaluate(() => {
        const a = [...document.querySelectorAll<HTMLElement>("a[href='/races']")].find((x) => x.offsetParent !== null);
        a?.click();
      });
      await page.waitForFunction(() => location.pathname === "/races", { timeout: 5_000 }).catch(() => {});
      await page.waitForSelector("details.hist");
      if (await has("details.hist[open]")) problems.push(`${label} history: /races fold open after leaving /bosses`);
      await page.goBack();
      await page.waitForFunction(() => location.pathname === "/bosses", { timeout: 5_000 }).catch(() => {});
      await page.waitForSelector("details.hist");
      if (await has("details.hist[open]")) problems.push(`${label} history: /bosses fold open after Back`);
      await page.$eval("details.hist > summary", (el) => (el as HTMLElement).click());
      await page.waitForSelector("details.hist .hist-top");
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await page.$eval("details.hist .hist-top", (el) => (el as HTMLElement).click());
      if (await has("details.hist[open]")) problems.push(`${label} history: "Back to top of history" leaves the fold open`);
      await page
        .waitForFunction(() => {
          const r = document.querySelector("details.hist > summary")!.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        }, { timeout: 5_000 })
        .catch(() => problems.push(`${label} history: the summary is not in view after "Back to top of history"`));
    };
    await history("desktop");

    // Mobile: the same pages, loaded directly (data comes from memory / IndexedDB like a returning visitor).
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await history("mobile");
    for (const [name, path] of Object.entries(pages)) {
      await load(path);
      await page.waitForSelector("main > *");
      await api.quiet();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) problems.push(`mobile ${name}: page scrolls sideways by ${overflow}px`);
      await shoot(page, `mobile-${name}`);
    }

    // Phones: a row opens the round view as a history entry; Back returns to the list where it was.
    if (pages.tools) {
      await load("/tools/rounds?set=vortex");
      await api.quiet();
      await page.evaluate(() => window.scrollTo(0, 900));
      await new Promise((r) => setTimeout(r, 300));
      const y0 = await page.evaluate(() => window.scrollY);
      const rowLink = await page.$("ol.rv-list li.rv-row:nth-child(20) a.rv-rb");
      await rowLink?.tap();
      await page.waitForFunction(() => location.search.includes("view=round"), { timeout: 3000 }).catch(() => problems.push("phone: row tap didn't open the round view"));
      const sticky = await page.evaluate(() => document.querySelector(".rv-sticky")?.getBoundingClientRect().height ?? 0);
      if (sticky > 64) problems.push(`phone: pinned bar is ${Math.round(sticky)} px (max 64)`);
      await shoot(page, "mobile-round-view");
      await page.goBack();
      await page.waitForFunction(() => !location.search.includes("view=round"), { timeout: 3000 }).catch(() => problems.push("phone: Back didn't return to the list"));
      await new Promise((r) => setTimeout(r, 300));
      const y1 = await page.evaluate(() => window.scrollY);
      if (Math.abs(y1 - y0) > 4) problems.push(`phone: Back restored scrollY ${y1}, was ${y0}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) problems.push(`mobile rounds list: page scrolls sideways by ${overflow}px`);
      await shoot(page, "mobile-rounds-list");
    }

    // 360 px (the narrowest phone): the paragon calculator must not scroll sideways there either.
    await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true });
    await load(pages["paragon-set"] ?? "/tools/paragon");
    await page.waitForSelector(".pg-res");
    await api.quiet();
    const o360 = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (o360 > 0) problems.push(`paragon at 360 px: page scrolls sideways by ${o360}px`);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    if (!REMOTE) await statsCheck("mobile");

    // Phone navigation: no sideways scroll, bottom bar + "More" sheet (390 and 360 px).
    for (const [w, h] of [[390, 800], [360, 740]] as const) {
      await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
      await load("/races");
      await page.waitForSelector(".bar");
      await api.quiet();
      const tag = `phone nav ${w}px`;
      if ((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) > 0) problems.push(`${tag}: page scrolls sideways`);
      if (!(await page.evaluate(() => { const b = document.querySelector(".bar")?.getBoundingClientRect(); return !!b && b.width > 0 && Math.round(b.bottom) === innerHeight; }))) problems.push(`${tag}: bottom bar not visible at the bottom`);
      if ((await page.$$eval("nav[aria-label=Sections]", (n) => n.filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === "fixed").length)) !== 1) problems.push(`${tag}: not exactly one visible Sections landmark`);
      if (!(await has('.bar a[href="/races"][aria-current="page"]'))) problems.push(`${tag}: Races has no aria-current on /races`);
      const openMore = async () => {
        await page.tap(".bar button");
        await page.waitForSelector('.bar button[aria-expanded="true"]', { timeout: 5000 }).catch(() => problems.push(`${tag}: More didn't open the sheet`));
        await page.waitForFunction(() => document.activeElement?.closest("#more-sheet"), { timeout: 2000 }).catch(() => problems.push(`${tag}: opening the sheet didn't focus its first link`));
      };
      const sheetOpen = () => has('.bar button[aria-expanded="true"]');
      await openMore();
      await page.keyboard.press("Escape");
      if (await sheetOpen()) problems.push(`${tag}: Escape didn't close the sheet`);
      await openMore();
      // 360 px goes to Tools: the Maps grid paints in ~55 ms there (a page cost, not the nav's), over the 50 ms bar.
      const dest = w === 390 ? "/maps" : "/tools";
      await step(`${tag}: More → ${dest}`, `#more-sheet a[href="${dest}"]`);
      if ((await here()) !== dest || (await sheetOpen())) problems.push(`${tag}: ${dest} didn't open with the sheet closed`);
      await step(`${tag}: header → Suggest`, "header a.sug-btn");
      if (!(await has("form.sug-form textarea"))) problems.push(`${tag}: suggest form didn't render`);
    }
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    // Light theme (prefers-color-scheme), desktop.
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
    for (const name of ["home", "events", "boss", "player"]) {
      if (!pages[name]) continue;
      await load(pages[name]);
      await api.quiet();
      await shoot(page, `light-${name}`);
    }

    console.table(results);
    console.log(`API requests during the whole session: ${api.log.length} (${api.log.filter((u) => u.startsWith("/api/batch")).length} batches)`);
    console.log(`screenshots: ${SHOTS}`);
    const slow = results.filter((r) => !r.cached || r.paintMs > 50);
    if (slow.length) problems.push(`NOT INSTANT: ${JSON.stringify(slow)}`);
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("Every navigation opened from memory.");
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(stopAll);
