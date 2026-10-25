// Races from before the site's archive (and before NK's API window), for the race list's full history and the map pages.
// Source: bloonswiki.com "Event history:Race Event/<year>" pages (CC BY-SA), Dec 2018 – Dec 2025: every race with its exact
// start/end, map, mode and difficulty. Years are discovered from the wiki, so a new year page is picked up on rerun.
// Gap filler: an optional extra community event list (JSON, base URL in env EVENT_LIST_BASE; skipped when unset, and the
// races it filled earlier stay in the data file). Exact start/end and map, no mode/difficulty; only adds races bloonswiki lacks.
// Run by hand: `node scripts/race_history.ts` → web/src/data/raceHistory.ts (one request per second).

import { writeFileSync } from "node:fs";
import { MAP_NAMES } from "../web/src/data/names.ts";

const API = "https://www.bloonswiki.com/api.php";
const UA = "btd6-opendata-site/1.0 (unofficial fan site; occasional one-off fetch)";
const OUT = new URL("../web/src/data/raceHistory.ts", import.meta.url);
const EVENT_LIST = process.env.EVENT_LIST_BASE ? `${process.env.EVENT_LIST_BASE}/races` : "";
const PREV: readonly string[][] = (await import(OUT.href)).RACE_HISTORY;

// Wiki map name → NK map id, matched on letters and digits only; the wiki's short or old names below.
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const MAP_IDS = new Map(Object.entries(MAP_NAMES).map(([id, name]) => [key(name), id]));
for (const id of Object.keys(MAP_NAMES)) MAP_IDS.set(key(id), id);
const ALIAS: Record<string, string> = { monkeymeadow: "Tutorial", towncenter: "TownCentre", alpine: "AlpineRun" };
function mapId(name: string, race: string): string {
  const id = MAP_IDS.get(key(name)) ?? ALIAS[key(name)];
  if (!id) throw new Error(`race ${race}: unknown map "${name}"`);
  return id;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get<T>(query: string): Promise<T> {
  const j = (await (await fetch(`${API}?${query}&format=json&formatversion=2`, { headers: { "user-agent": UA } })).json()) as T;
  await wait(1000);
  return j;
}

/** Top-level `{{BTD6 challenge rules | k = v | …}}` templates → parameters (first occurrence wins; split on | at depth 0). */
function templates(t: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (let i = t.indexOf("{{BTD6 challenge rules"); i >= 0; i = t.indexOf("{{BTD6 challenge rules", i)) {
    let depth = 0;
    let j = i;
    for (; j < t.length; j++) {
      if (t.startsWith("{{", j)) (depth++, j++);
      else if (t.startsWith("}}", j) && (j++, --depth === 0)) break;
    }
    const body = t.slice(i + 2, j - 1);
    i = j;
    const p: Record<string, string> = {};
    let cur = "";
    let d = 0;
    const put = (x: string) => {
      const e = x.indexOf("=");
      const k = x.slice(0, e).trim();
      if (e > 0 && !(k in p)) p[k] = x.slice(e + 1).trim();
    };
    for (let k = 0; k < body.length; k++) {
      const two = body.slice(k, k + 2);
      if (two === "{{" || two === "[[") (d++, (cur += two), k++);
      else if (two === "}}" || two === "]]") (d--, (cur += two), k++);
      else if (body[k] === "|" && d === 0) (put(cur), (cur = ""));
      else cur += body[k];
    }
    put(cur);
    out.push(p);
  }
  return out;
}

const instant = (s: string) => new Date(+s * 1000).toISOString().replace(".000Z", "Z");
const titles = (await get<{ query: { allpages: { title: string }[] } }>("action=query&list=allpages&apnamespace=3150&aplimit=500")).query.allpages
  .map((p) => p.title)
  .filter((t) => /^Event history:Race Event\/\d{4}/.test(t));
if (!titles.length) throw new Error("no race pages on bloonswiki");

const rows: string[][] = [];
for (const title of titles) {
  const j = await get<{ parse?: { wikitext: string } }>(`action=parse&page=${encodeURIComponent(title)}&prop=wikitext`);
  if (!j.parse) throw new Error(`bloonswiki page ${title} missing`);
  for (const p of templates(j.parse.wikitext)) {
    const what = p.name ?? p.id ?? "?";
    if (!p.start || !p.end || !p.map || !p.name) throw new Error(`race ${what}: missing start/end/map/name`);
    rows.push([p.name, mapId(p.map, what), instant(p.start), instant(p.end), ...(p.mode && p.mode !== "Standard" ? [p.mode] : p.difficulty && p.difficulty !== "Medium" ? [""] : []), ...(p.difficulty && p.difficulty !== "Medium" ? [p.difficulty] : [])]);
  }
  console.log(`${title}: ${rows.length} races so far`);
}
// ---- community-list gap filler ----
type Pt = { id: string; name: string; start: number; end: number; mapName?: string };
let added = 0;
for (let page = 1, pages = EVENT_LIST ? 1 : 0; page <= pages; page++) {
  const j = (await (await fetch(`${EVENT_LIST}?page=${page}&limit=100&sortBy=start_time&order=asc`, { headers: { "user-agent": UA } })).json()) as { data: Pt[]; pagination: { total_pages: number } };
  pages = j.pagination.total_pages;
  await wait(1500);
  for (const p of j.data.filter((x) => x.start > 0)) {
    const hit = rows.find((x) => Math.abs(Date.parse(x[2]) - p.start) < 1.5 * 864e5);
    if (hit) {
      // Cross-check only (bloonswiki wins): same start, same map.
      if (Math.abs(Date.parse(hit[2]) - p.start) > 6e4 || Math.abs(Date.parse(hit[3]) - p.end) > 6e4) console.log(`list time: ${p.name} list ${instant(String(p.start / 1000))} vs ${hit[2]}`);
      if (p.mapName && hit[1] !== p.mapName) console.log(`list map: ${p.name} list ${p.mapName} vs ${hit[1]}`);
      continue;
    }
    if (!p.mapName || !MAP_NAMES[p.mapName]) console.log(`list: ${p.name} has unknown map "${p.mapName}"`);
    rows.push([p.name, p.mapName && MAP_NAMES[p.mapName] ? p.mapName : "", instant(String(p.start / 1000)), instant(String(p.end / 1000))]);
    added++;
  }
}
console.log(EVENT_LIST ? `community list: ${added} races added` : "community list: EVENT_LIST_BASE not set, keeping earlier entries");
for (const o of PREV) if (!rows.some((x) => Math.abs(Date.parse(x[2]) - Date.parse(o[2])) < 1.5 * 864e5)) rows.push([...o]);
rows.sort((a, b) => a[2].localeCompare(b[2]));

writeFileSync(
  OUT,
  `// Generated by scripts/race_history.ts from bloonswiki.com (CC BY-SA) and a community list. Do not edit by hand.
// Races before the site's archive, oldest first: [name, NK map id, start, end, mode (only if not Standard), difficulty (only if not Medium; mode "" when only the difficulty is set)].
// start/end are exact UTC instants. Races after Dec 2025 come from the community list, which has no mode/difficulty.
export const RACE_HISTORY_SOURCE = "https://www.bloonswiki.com/Event_history:Race_Event";
export type OldRace = readonly [name: string, map: string, start: string, end: string, mode?: string, difficulty?: string];
export const RACE_HISTORY: readonly OldRace[] = [
${rows.map((r) => `  [${r.map((x) => JSON.stringify(x)).join(", ")}],`).join("\n")}
];
`,
);
console.log(`${rows.length} races, ${rows[0][2]} … ${rows.at(-1)![3]}`);
