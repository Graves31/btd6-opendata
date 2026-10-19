// Link previews (Discord, Slack, X, …): page navigations to event / player / team / challenge URLs run the
// Worker first (wrangler.jsonc `run_worker_first`), which serves the SPA shell (index.html from ASSETS)
// with a route-specific <title>, description and Open Graph / Twitter tags.
//
// Budget rules:
//  - Only data we already hold is used: isolate memory, the hot bundle if this isolate has it parsed, one
//    D1 row. Never the origin: a preview must not cost NK a request. Unknown → generic tags.
//  - CPU: one small JSON parse at most, string edits on a ~1 KB shell (HTMLRewriter would stream the same
//    edits, but isn't available in the Node tests; the shell is tiny, so the string path costs the same).
//  - Wall time: lookups are capped at LOOKUP_TIMEOUT_MS; slower → generic tags, the page is never held up.
// Static files (/assets/*, /art/*, sw.js, fonts, images) never reach the Worker.

import { MAP_LIST, MAP_NAMES } from "../../web/src/data/names.ts";
import { parse } from "../../web/src/routes.ts";
import type { Deps } from "./deps.ts";
import { hotPayload, mem, peekHot } from "./store.ts";

export interface AssetsLike {
  fetch(request: Request): Promise<Response>;
}

/** The site's one public address: canonical links, link previews, Discord posts, redirects from other hosts. */
export const SITE = "https://btd6data.com";
export const SITE_NAME = "BTD6 Open Data";
const GENERIC_DESCRIPTION = "Unofficial, instant-loading browser for Bloons TD 6 events, leaderboards and player profiles.";
/** Site-wide preview image (absolute path on this site), or null for none. */
export const SITE_IMAGE: string | null = "/og.jpg";
const LOOKUP_TIMEOUT_MS = 300;
/** Same as the "/*" block of web/public/_headers (static files get them from there). */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000",
};

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute image URL (NK's content-addressed assets), or null. */
  image: string | null;
  /** Wide images (map previews) get the large Twitter card. */
  wide?: boolean;
}

const EVENT_ID = /^[A-Za-z0-9_-]{4,64}$/;
const HEX48 = /^[0-9a-f]{48}$/;
const CHALLENGE_ID = /^[A-Za-z0-9]{4,20}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function handlePage(deps: Deps, assets: AssetsLike, request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return assets.fetch(request);
  const url = new URL(request.url);
  let shell: Response;
  try {
    shell = await assets.fetch(new Request(new URL("/", url), { method: "GET" }));
  } catch {
    return assets.fetch(request);
  }
  if (!shell.ok || !(shell.headers.get("content-type") ?? "").includes("text/html")) {
    await shell.body?.cancel();
    return assets.fetch(request);
  }

  let meta = GENERIC;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)));
    meta = (await Promise.race([describe(deps, url.pathname), timeout])) ?? GENERIC;
  } catch (err) {
    console.warn("og: lookup failed", String(err));
  } finally {
    clearTimeout(timer);
  }

  const html = injectMeta(await shell.text(), meta, url);
  const headers = new Headers(shell.headers);
  for (const h of ["etag", "content-length", "content-encoding", "last-modified"]) headers.delete(h);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  // Paths the app has no page for are real 404s (the app still shows its not-found page), not "soft 404s".
  return new Response(request.method === "HEAD" ? null : html, { status: routeName(url) === "notfound" ? 404 : 200, headers });
}

/** The app's own route table (web/src/routes.ts); a malformed %-escape is a page that doesn't exist. */
function routeName(url: URL): string {
  try {
    return parse(url).name;
  } catch {
    return "notfound";
  }
}

/** One address per page for search engines: no query string (tool settings, board pages, tiers) and no
 *  trailing slash. Old shared /tools?set=… links are the round visualizer. */
export function canonicalPath(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return path === "/tools" && routeName(url) === "rounds" ? "/tools/rounds" : path;
}

const GENERIC: PageMeta = { title: SITE_NAME, description: GENERIC_DESCRIPTION, image: null };

const page = (title: string, description: string, image: string | null = null, wide = false): PageMeta => ({
  title: `${title} · ${SITE_NAME}`,
  description,
  image,
  wide,
});

const LISTS: Record<string, [string, string]> = {
  bosses: ["BTD6 Boss Event Leaderboards", "Every Bloons TD 6 boss event: leaderboards, rules and top scores, with full history."],
  races: ["BTD6 Race Leaderboards", "Every Bloons TD 6 race: leaderboards and rules, with full history."],
  ct: ["BTD6 Contested Territory (CT) Leaderboards", "Every Bloons TD 6 Contested Territory (CT) event: player and team leaderboards and tiles."],
  odyssey: ["Odysseys", "Every Bloons TD 6 odyssey: islands, rules and rewards."],
  events: ["Events", "Bloons TD 6 events: bosses, races, Contested Territory and odysseys."],
};

const TOOLS: [string, string] = ["BTD6 Round Visualizer (RBE & bloons per round)", "Bloons TD 6 round sets from the game's own data: the bloons, RBE and spawn timeline of every round."];

const TOOLS_HUB: [string, string] = ["Tools", "Bloons TD 6 tools built on the game's own data: the round visualizer, the paragon degree calculator and farming resources."];
const FARMING: [string, string] = ["BTD6 Farming Resources", "Bloons TD 6 farming resources: when a 0-0-0, 1-0-0 and 2-0-0 Banana Farm drops its bananas during a round."];
const PARAGON: [string, string] = ["BTD6 Paragon Calculator: Degree & Power", "Bloons TD 6 paragon degree calculator: the degree your sacrificed cash, pops, towers and totems give, what the next degree takes, and the quickest way to the next boss breakpoint."];
const PARAGON_SCALING: [string, string] = ["BTD6 Paragon Scaling", "How a Bloons TD 6 paragon grows per degree: power needed, damage, pierce, attack speed and boss damage, charted from the game's data."];

const CHALLENGE_LISTS: Record<string, [string, string]> = {
  daily: ["Daily challenges", "Every Bloons TD 6 daily challenge: rules, map and modifiers."],
  newest: ["Newest challenges", "The newest Bloons TD 6 player-made challenges: rules, map and modifiers."],
  trending: ["Trending challenges", "Trending Bloons TD 6 player-made challenges: rules, map and modifiers."],
};

/** Boss stats pages (/bosses/<type>), as in web/public/sitemap.xml. */
const BOSS_TYPES = new Set(["bloonarius", "lych", "vortex", "dreadbloon", "phayze", "blastapopoulos", "diamondback"]);

/** Route-specific tags from cached data only; null/GENERIC when nothing usable is cached. */
export async function describe(deps: Deps, pathname: string): Promise<PageMeta> {
  let seg: string[];
  try {
    seg = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return GENERIC;
  }
  const [a, b, c, d] = seg;
  if (!a) return { ...GENERIC, title: `${SITE_NAME} · Live boss, race & CT leaderboards` };
  if (seg.length === 1 && LISTS[a]) return page(...LISTS[a]);
  // Tools (/tools, /tools/rounds, /tools/paragon): static pages, no lookup.
  if (a === "tools" && b === "rounds" && !c) return page(...TOOLS);
  if (a === "tools" && b === "paragon" && !c) return page(...PARAGON);
  if (a === "tools" && b === "farming" && !c) return page(...FARMING);
  if (a === "tools" && b === "paragon-scaling" && !c) return page(...PARAGON_SCALING);
  if (a === "tools" && !b) return page(...TOOLS_HUB);
  if (a === "stats" && !b) return page("Site stats", "How many people use BTD6 Open Data: visits, page views and the most-opened pages."); // old /tools?set=… links are the visualizer, but the hub text is true of both
  if (a === "maps" && !b) return page("BTD6 Maps", "Every official Bloons TD 6 map, with the boss events and races played on it.");
  const m = a === "maps" && b && !c ? MAP_LIST.find((x) => x[0] === b) : undefined;
  if (m) {
    const diff = ["Beginner", "Intermediate", "Advanced", "Expert"][m[1]];
    return page(`${MAP_NAMES[b]} · BTD6 Map`, `${MAP_NAMES[b]}, ${/^[AEIOU]/.test(diff) ? "an" : "a"} ${diff} map in Bloons TD 6${m[2] ? " with water" : ""}: every boss event and race played on it.`);
  }
  if (a === "challenges" && !c && (!b || Object.hasOwn(CHALLENGE_LISTS, b))) return page(...CHALLENGE_LISTS[b ?? "daily"]);
  if (a === "bosses" && b && BOSS_TYPES.has(b) && !c) {
    return page(`BTD6 ${cap(b)} Boss: Health, Tiers & Past Events`, `${cap(b)} boss stats in Bloons TD 6: health, skulls, spawns and minimum kill time per tier, Normal and Elite, plus every past ${cap(b)} event.`);
  }
  if (!b) return GENERIC;

  if ((a === "boss" || a === "race" || a === "ct" || a === "odyssey") && EVENT_ID.test(b)) {
    const kind = a;
    const ev = await eventItem(deps, kind, b);
    if (!ev) return GENERIC;
    const dates = dateRange(num(ev.start), num(ev.end));
    if (kind === "boss") {
      const n = /(\d+)$/.exec(str(ev.name))?.[1];
      const type = str(ev.bossType);
      const title = type ? `${cap(type)}${n ? ` #${n}` : ""} · BTD6 Boss Event` : str(ev.name) || "Boss event";
      return page(title, `Bloons TD 6 ${type ? `${cap(type)} ` : ""}boss event${dates}. Standard and elite leaderboards, rules and top scores.`, asset(ev.bossTypeURL));
    }
    if (kind === "race") {
      const meta = await cachedBody(deps, `/btd6/races/${b}/metadata`);
      return page(`${str(ev.name) || "Race"} · Race`, `Race event${dates}. Leaderboard, rules and fastest times.`, asset(meta?.mapURL), true);
    }
    if (kind === "ct") {
      const group = c === "group" && d ? " group" : "";
      return page(`Contested Territory${group}`, `Contested Territory${dates}. Player and team leaderboards, tiles and relics.`);
    }
    const desc = str(ev.description);
    const blurb = clip(desc, 160);
    const sentence = blurb ? ` ${blurb}${/[.!?…]$/.test(blurb) ? "" : "."}` : "";
    return page(`${str(ev.name) || "Odyssey"} · Odyssey`, `Odyssey${dates}.${sentence} Islands, rules and rewards.`);
  }

  if (a === "player" && HEX48.test(b)) {
    const p = await cachedBody(deps, `/btd6/users/${b}`);
    const name = str(p?.displayName);
    if (!name) return GENERIC;
    const rank = num(p?.rank);
    return page(name, `${rank ? `Rank ${rank}. ` : ""}Bloons TD 6 player profile: medals, badges and stats.`, asset(p?.avatarURL));
  }
  if (a === "team" && HEX48.test(b)) {
    const g = await cachedBody(deps, `/btd6/guild/${b}`);
    const name = str(g?.name);
    if (!name) return GENERIC;
    const members = num(g?.numMembers);
    return page(name, `${members ? `${members} members. ` : ""}Bloons TD 6 team: badges and Contested Territory history.`, asset(g?.iconURL));
  }
  if (a === "challenge" && CHALLENGE_ID.test(b)) {
    const ch = await cachedBody(deps, `/btd6/challenges/challenge/${b}`);
    const name = str(ch?.name);
    if (!name) return GENERIC;
    const map = str(ch?.map);
    return page(name, `Bloons TD 6 challenge ${b}${map ? ` on ${spaced(map)}` : ""}: rules, towers and stats.`, asset(ch?.mapURL), true);
  }
  return GENERIC;
}

// ─────────────────────────────── cached data only

type Obj = Record<string, unknown>;

/** The event's list item: hot bundle if already parsed here, else the permanent `events` table (1 row). */
async function eventItem(deps: Deps, kind: "boss" | "race" | "ct" | "odyssey", id: string): Promise<Obj | null> {
  const hot = peekHot();
  const list = hot ? hotPayload(hot, LIST_KEY[kind]) : undefined;
  if (Array.isArray(list)) {
    const hit = (list as Obj[]).find((x) => x?.id === id);
    if (hit) return hit;
  }
  const row = await deps.db.prepare("SELECT data FROM events WHERE kind = ? AND id = ?").bind(kind, id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Obj) : null;
}

const LIST_KEY = { boss: "/btd6/bosses", race: "/btd6/races", ct: "/btd6/ct", odyssey: "/btd6/odyssey" } as const;

/** A cached NK body: isolate memory, the parsed hot bundle, then one D1 row. Never the origin. */
async function cachedBody(deps: Deps, key: string): Promise<Obj | null> {
  const m = mem.get(key);
  if (m) return m.ok ? bodyOf(m.body) : null;
  const hot = peekHot();
  if (hot?.keys.has(key)) {
    const b = hotPayload(hot, key);
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Obj) : null;
  }
  const row = await deps.db.prepare("SELECT body FROM responses WHERE key = ? AND ok = 1").bind(key).first<{ body: string }>();
  return row ? bodyOf(row.body) : null;
}

function bodyOf(text: string): Obj | null {
  try {
    const b = (JSON.parse(text) as { body?: unknown }).body;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Obj) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────── formatting

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "EndOfTheRoad" → "End Of The Road". */
const spaced = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Only https URLs make it into a preview (NK assets are https://static-api.nkstatic.com/…). */
const asset = (v: unknown) => (typeof v === "string" && v.startsWith("https://") ? v : null);

function dateRange(start: number, end: number): string {
  if (!start || !end) return "";
  const s = new Date(start);
  const e = new Date(end);
  const day = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
  return `, ${day(s)} – ${day(e)} ${e.getUTCFullYear()}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Set <title> and the description, drop any existing og:/twitter: tags, add ours before </head>, and the page's text into #app. */
export function injectMeta(html: string, m: PageMeta, url: URL): string {
  const image = m.image ?? (SITE_IMAGE ? new URL(SITE_IMAGE, url).href : null);
  const prop = (p: string, v: string) => `<meta property="${p}" content="${esc(v)}" />`;
  const name = (n: string, v: string) => `<meta name="${n}" content="${esc(v)}" />`;
  const tags = [
    prop("og:site_name", SITE_NAME),
    prop("og:type", "website"),
    prop("og:title", m.title),
    prop("og:description", m.description),
    prop("og:url", SITE + url.pathname + url.search),
    ...(image ? [prop("og:image", image)] : []),
    name("twitter:card", image && m.wide ? "summary_large_image" : "summary"),
    name("twitter:title", m.title),
    name("twitter:description", m.description),
    ...(image ? [name("twitter:image", image)] : []),
  ];
  let out = html.replace(/[ \t]*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/gi, "");
  out = /<title>[\s\S]*?<\/title>/i.test(out)
    ? out.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${esc(m.title)}</title>`)
    : out.replace(/<\/head>/i, () => `<title>${esc(m.title)}</title></head>`);
  const desc = name("description", m.description);
  // Function replacers throughout: a title containing "$&" must not be read as a replacement pattern.
  out = /<meta\s+name="description"[^>]*>/i.test(out)
    ? out.replace(/<meta\s+name="description"[^>]*>/i, () => desc)
    : out.replace(/<\/head>/i, () => `${desc}</head>`);
  const canonical = `<link rel="canonical" href="${esc(SITE + canonicalPath(url))}" />`;
  out = out.replace(/<\/head>/i, () => `${[canonical, ...tags].join("\n    ")}\n  </head>`);
  // Readable text for crawlers that don't run scripts; the app clears it before its first render.
  const links = SECTIONS.map(([h, l]) => `<a href="${h}">${l}</a>`).join(" · ");
  const text = `<div class="pre"><h1>${esc(m.title)}</h1><p>${esc(m.description)}</p><nav>${links}</nav></div>`;
  return out.replace(/<div id="app"><\/div>/i, () => `<div id="app">${text}</div>`);
}

const SECTIONS = [
  ["/", "Live events"],
  ["/bosses", "Boss events"],
  ["/races", "Races"],
  ["/ct", "Contested Territory"],
  ["/odyssey", "Odysseys"],
  ["/challenges", "Challenges"],
  ["/maps", "Maps"],
  ["/tools/rounds", "Round visualizer"],
  ["/tools/paragon", "Paragon calculator"],
];
