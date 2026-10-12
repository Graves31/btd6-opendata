// Races from before the site's archive (and before NK's API window), for the race list's full history and the map pages.
// Source: the Bloons Wiki "List of Races" page (bloons.fandom.com, CC BY-SA). It covers races #1–#187 (Dec 2018 –
// Jul 2022) with gaps the page itself flags; no public list covers the races after that.
// Run by hand: `node scripts/race_history.ts` → web/src/data/raceHistory.ts (one wiki fetch).

import { writeFileSync } from "node:fs";
import { MAP_NAMES } from "../web/src/data/names.ts";

const API = "https://bloons.fandom.com/api.php";
const PAGE = "Race Mode (BTD6)/List of Races";
const UA = "btd6-opendata-site/1.0 (unofficial fan site; occasional one-off fetch)";
const OUT = new URL("../web/src/data/raceHistory.ts", import.meta.url);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const month = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase());
const plain = (s = "") =>
  s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
// Wiki map name → NK map id, matched on letters and digits only; the wiki's short or old names below.
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const MAP_IDS = new Map(Object.entries(MAP_NAMES).map(([id, name]) => [key(name), id]));
for (const id of Object.keys(MAP_NAMES)) MAP_IDS.set(key(id), id);
const ALIAS: Record<string, string> = { alpine: "AlpineRun", towncenter: "TownCentre", kartsndarts: "KartsNDarts" };
function mapId(name: string, n: number): string {
  const id = MAP_IDS.get(key(name)) ?? ALIAS[key(name)];
  if (!id) throw new Error(`race ${n}: unknown map "${name}"`);
  return id;
}
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** First day number and first month name in a date phrase ("7th/8th", "July 9th/10th", "28th Feb/1st March"). */
function dm(s: string): { d?: number; m?: number } {
  const d = /(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s.replace(/\b\d{4}\b/g, ""));
  const m = [...s.matchAll(/[A-Za-z]+/g)].map((x) => month(x[0])).find((x) => x >= 0);
  return { d: d ? +d[1] : undefined, m };
}

/** "from 7th/8th to 10th/11th May 2021" (and the page's other spellings) → [start, end], or undefined. */
function bulletDates(text: string, fallbackYear: number): [string, string] | undefined {
  const m = /from (.+?) to (.+?)(?:\.|$)/.exec(text.replace(/\(\?\)/g, ""));
  if (!m) return undefined;
  const years = [...m[0].matchAll(/\b(20\d\d)\b/g)].map((x) => +x[1]);
  const endYear = years.at(-1) ?? fallbackYear;
  const a = dm(m[1]);
  const b = dm(m[2]);
  if (!a.d || !b.d || b.m === undefined) return undefined;
  const am = a.m ?? b.m;
  const sy = /\b(20\d\d)\b/.exec(m[1]);
  const startYear = sy ? +sy[1] : am > b.m ? endYear - 1 : endYear;
  return [iso(startYear, am, a.d), iso(endYear, b.m, b.d)];
}

/** Template dates: "17th June 2022 at 20:00 NZST", "July 1 2022 at 20:00 NZST" (the wiki's NZ day). */
function templDate(s = ""): string | undefined {
  const t = plain(s).replace(/~/g, "").split(/\bat\b/)[0]; // the time ("at 3:30pm") is no day
  const y = /\b(20\d\d)\b/.exec(t);
  const { d, m } = dm(t);
  return y && d && m !== undefined ? iso(+y[1], m, d) : undefined;
}

/** Top-level `{{Race Event | k = v | …}}` templates → their parameters. */
function templates(t: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (let i = t.indexOf("{{Race Event"); i >= 0; i = t.indexOf("{{Race Event", i + 1)) {
    let depth = 0;
    let j = i;
    for (; j < t.length; j++) {
      if (t.startsWith("{{", j)) (depth++, j++);
      else if (t.startsWith("}}", j) && (j++, --depth === 0)) break;
    }
    const p: Record<string, string> = {};
    for (const x of t.slice(i + 2, j - 1).split("|").slice(1)) {
      const e = x.indexOf("=");
      if (e > 0) p[x.slice(0, e).trim()] = x.slice(e + 1).trim();
    }
    out.push(p);
  }
  return out;
}

const res = await fetch(`${API}?action=parse&page=${encodeURIComponent(PAGE)}&prop=wikitext&format=json&formatversion=2`, {
  headers: { "user-agent": UA },
});
const text = ((await res.json()) as { parse?: { wikitext: string } }).parse?.wikitext;
if (!text) throw new Error("wiki race list not found");

type Ev = { n: number; name: string; map: string; start: string; end: string };
const evs: Ev[] = [];
const skipped: string[] = [];
let year = 2018;
for (const line of text.split("\n")) {
  const h = /^==\s*(\d{4})\s*==/.exec(line);
  if (h) year = +h[1];
  const b = /^\*'''Event (\d+) "([^"]+)" \(([^,)]+)/.exec(line);
  if (!b) continue;
  const dates = bulletDates(line, year);
  if (!dates) {
    skipped.push(`#${b[1]} (no dates)`);
    continue;
  }
  evs.push({ n: +b[1], name: b[2].trim(), map: mapId(plain(b[3]), +b[1]), start: dates[0], end: dates[1] });
}
for (const p of templates(text)) {
  const n = +plain(p.event);
  const start = templDate(p.start);
  const end = templDate(p.end) ?? start;
  if (!n || !start || !end || !p.track) {
    skipped.push(`#${p.event} (incomplete template)`);
    continue;
  }
  evs.push({ n, name: plain(p.name), map: mapId(plain(p.track), n), start, end });
}
// Dates that disagree (end before start, or longer than any race: the wiki's #41 says "October to September").
const bad = (e: Ev) => e.end < e.start || Date.parse(e.end) - Date.parse(e.start) > 10 * 864e5;
for (const e of evs.filter(bad)) skipped.push(`#${e.n} (dates disagree: ${e.start} – ${e.end})`);
evs.splice(0, evs.length, ...evs.filter((e) => !bad(e)));
// By date: the wiki's numbers are not reliable (two races are both "#83"), so the site shows names and dates only.
evs.sort((a, b) => a.start.localeCompare(b.start) || a.n - b.n);

const rows = evs.map((e) => `  [${[e.n, e.name, e.map, e.start, e.end].map((x) => JSON.stringify(x)).join(", ")}],`);
writeFileSync(
  OUT,
  `// Generated by scripts/race_history.ts from the Bloons Wiki (bloons.fandom.com, CC BY-SA). Do not edit by hand.
// Races before the site's archive, oldest first: [wiki event number (not reliable: shown nowhere), name, NK map id,
// start, end]. Dates are the wiki's calendar days. The wiki lists races #1–#187 with gaps; later ones are on no public list.
export const RACE_HISTORY_SOURCE = "https://bloons.fandom.com/wiki/Race_Mode_(BTD6)/List_of_Races";
export type OldRace = readonly [n: number, name: string, map: string, start: string, end: string];
export const RACE_HISTORY: readonly OldRace[] = [
${rows.join("\n")}
];
`,
);
console.log(`${evs.length} races, ${evs[0].start} … ${evs.at(-1)!.end}`);
if (skipped.length) console.log(`skipped: ${skipped.join(", ")}`);
