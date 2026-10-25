// Boss events from before the site's archive (and before NK's API window), for the boss stats "Past events" list.
// Base: the old Bloons Wiki "List of Boss Events" pages (bloons.fandom.com, CC BY-SA), one per game version: numbering,
// notes, calendar days. Correction layer: bloonswiki.com's "Event history:Boss Bloon Event/<year>" pages (CC BY-SA) give
// exact start/end instants (and fix a few wrong Fandom dates). Rows only Fandom has keep its calendar days.
// Gap filler: an optional extra community event list (JSON, base URL in env EVENT_LIST_BASE; skipped when unset, and the
// entries it filled earlier stay in the data file). It gives exact UTC start/end, map and number, and only adds events the
// other sources lack.
// Run by hand after a few new versions: `node scripts/boss_history.ts` → web/src/data/bossHistory.ts.
// Fetches ~35 wiki pages, one per second. The numbering is checked against real NK event ids (ANCHORS).

import { writeFileSync } from "node:fs";
import { MAP_NAMES } from "../web/src/data/names.ts";

const API = "https://bloons.fandom.com/api.php";
const LIST = "Boss_Bloon_Event_(BTD6)/List_of_Boss_Events";
const UA =
  "btd6-opendata-site/1.0 (unofficial fan site; occasional one-off fetch)";
const BW = "https://www.bloonswiki.com/api.php";
const OUT = new URL("../web/src/data/bossHistory.ts", import.meta.url);
const EVENT_LIST = process.env.EVENT_LIST_BASE ? `${process.env.EVENT_LIST_BASE}/bosses` : "";
// Entries already in the data file (a run without the community list must keep what it filled earlier).
const PREV: readonly (readonly [string, number, string, string, string, string?])[] = (await import(OUT.href)).BOSS_HISTORY;

// NK event ids seen in the Wayback Machine (data.ninjakiwi.com/btd6/bosses/<id>): name number + id time (base36 ms).
const ANCHORS = [
  "Bloonarius42_ljrtsk2t",
  "Bloonarius48_lsxq2drv",
  "Bloonarius53_lzvqs1tu",
  "Bloonarius54_m19qvz1p",
  "Bloonarius65_mkq9qc8q",
  "Lych38_lrtqdk00",
  "Lych39_lt7sbm5v",
  "Lych44_m05t23u1",
  "Lych45_m1iu0qod",
  "Lych56_ml1nx2lh",
  "Lych57_mmn3mxs7",
  "Vortex26_ls3lkvwz",
  "Vortex27_lthpaqb6",
  "Vortex32_m0fzxrgk",
  "Vortex33New_m1w0dd1c",
  "Vortex44_mmy77iti",
  "Dreadbloon16_lsdqfw6d",
  "Dreadbloon17_ltrqmb29",
  "Dreadbloon21_lzc3rb6t",
  "Dreadbloon22_m0p6mhkh",
  "Dreadbloon23_m370xbcb",
  "Dreadbloon34_mljy9gkp",
  "Dreadbloon35_mn7wz29e",
  "Phayze8_lr9s67w0",
  "Phayze9_lsnqxshw",
  "Phayze10_lu1toocp",
  "Phayze14_lzlqagn4",
  "Phayze15_m0zodiws",
  "Phayze16_m3hhnaiz",
  "Phayze26_mk5y6ypi",
  "Phayze27_mltto1x2",
  "Blastapopoulos1_m240g668",
  "Blastapopoulos3_m2nu8z56",
  "Blastapopoulos4_m2xu48n4",
  "Blastapopoulos15New2_mkhon93q",
];
const TYPES = [
  "bloonarius",
  "lych",
  "vortex",
  "dreadbloon",
  "phayze",
  "blastapopoulos",
  "diamondback",
];
// Wiki weeks NK gave no number of their own: runs restarted a few hours in (the restart kept the number), the day-one
// takedown of week 178, and the April one-day specials. (Not a length rule: week 99 ended within a day and is numbered.)
const UNNUMBERED: Record<string, string> = {
  "87a": "restarted",
  "168a": "restarted",
  "178": "taken down",
  "194a": "special",
  "246a": "special",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function wikitext(page: string, api = API): Promise<string | undefined> {
  const u = `${api}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
  const j = (await (
    await fetch(u, { headers: { "user-agent": UA } })
  ).json()) as { parse?: { wikitext: string } };
  await wait(1000);
  return j.parse?.wikitext;
}

/** Top-level `{{Boss Bloon Event | k = v | …}}` templates → their parameters. */
function templates(t: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (
    let i = t.indexOf("{{Boss Bloon Event");
    i >= 0;
    i = t.indexOf("{{Boss Bloon Event", i)
  ) {
    let depth = 0;
    let j = i;
    for (; j < t.length; j++) {
      if (t.startsWith("{{", j)) (depth++, j++);
      else if (t.startsWith("}}", j) && (j++, --depth === 0)) break;
    }
    const body = t.slice(i + 2, j - 1);
    i = j;
    const parts: string[] = [];
    let cur = "";
    let d = 0;
    for (let k = 0; k < body.length; k++) {
      const two = body.slice(k, k + 2);
      if (two === "{{" || two === "[[") (d++, (cur += two), k++);
      else if (two === "}}" || two === "]]") (d--, (cur += two), k++);
      else if (body[k] === "|" && d === 0) (parts.push(cur), (cur = ""));
      else cur += body[k];
    }
    parts.push(cur);
    const p: Record<string, string> = {};
    for (const x of parts.slice(1)) {
      const e = x.indexOf("=");
      if (e > 0) p[x.slice(0, e).trim()] = x.slice(e + 1).trim();
    }
    out.push(p);
  }
  return out;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
/** "28th July 2023 at 10:00am NZST" → a UTC day (the wiki's NZ date; the hour is left out). Year may be missing. */
function day(s: string, year: number): number | undefined {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s*(\d{4})?/.exec(
    s.replace(/<!--[\s\S]*?-->|<[^>]+>/g, ""),
  );
  const mo = m
    ? MONTHS.indexOf(m[2].toLowerCase().replace("novemeber", "november"))
    : -1;
  return m && mo >= 0 ? Date.UTC(m[3] ? +m[3] : year, mo, +m[1]) : undefined;
}
const plain = (s = "") =>
  s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
// Wiki map name → NK map id, matched on letters and digits only ("End of the Road", "Three Mines 'Round").
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const MAP_IDS = new Map(
  Object.entries(MAP_NAMES).map(([id, name]) => [key(name), id]),
);
function mapId(name: string, week: string): string {
  const id = MAP_IDS.get(key(name));
  if (!id) throw new Error(`week ${week}: unknown map "${name}"`);
  return id;
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const index = await wikitext(LIST.replace(/_/g, " "));
if (!index) throw new Error("wiki list page not found");
const versions = [
  ...new Set([...index.matchAll(/Version[ _](\d+)\.0/g)].map((m) => +m[1])),
].sort((a, b) => a - b);

type Ev = {
  type: string;
  n: number;
  map: string;
  start: number;
  end: number;
  week: string;
};
const evs: Ev[] = [];
let year = 2021;
let prev = 0;
for (const v of versions) {
  const t = await wikitext(`${LIST.replace(/_/g, " ")}/Version ${v}.0`);
  if (!t) {
    console.log(`version ${v}: no wiki page yet`);
    continue;
  }
  for (const p of templates(t)) {
    const type = plain(p.boss).toLowerCase();
    if (!TYPES.includes(type))
      throw new Error(`week ${p.week}: unknown boss ${p.boss}`);
    let start = day(p.start ?? "", year);
    if (start === undefined)
      throw new Error(`week ${p.week}: bad start ${p.start}`);
    if (start < prev - 30 * 864e5)
      start = Date.UTC(
        new Date(start).getUTCFullYear() + 1,
        new Date(start).getUTCMonth(),
        new Date(start).getUTCDate(),
      );
    year = new Date(start).getUTCFullYear();
    prev = start;
    let end = day(p.end ?? "", year) ?? start;
    if (end < start)
      end = Date.UTC(
        year + 1,
        new Date(end).getUTCMonth(),
        new Date(end).getUTCDate(),
      );
    evs.push({
      type,
      n: 0,
      map: mapId(plain(p.track), plain(p.week)),
      start,
      end,
      week: plain(p.week),
    });
  }
  console.log(`version ${v}: ${evs.length} events so far`);
}

const count: Record<string, number> = {};
for (const e of evs)
  if (!(e.week in UNNUMBERED)) e.n = count[e.type] = (count[e.type] ?? 0) + 1;

// Every anchor must land on a wiki event of its boss, a few days after the id was made, with the same number.
const bad: string[] = [];
for (const id of ANCHORS) {
  const [, name, num] = /^([A-Za-z]+?)(\d+)/.exec(id)!;
  const made = parseInt(id.split("_").pop()!, 36);
  // Closest numbered event of that boss within 6 days (an id is usually made a day or two before the start).
  const near = evs.filter(
    (e) =>
      e.type === name.toLowerCase() &&
      e.n > 0 &&
      Math.abs(e.start - made) < 6 * 864e5,
  );
  const hit = near.sort(
    (a, b) => Math.abs(a.start - made) - Math.abs(b.start - made),
  )[0];
  if (!hit || hit.n !== +num)
    bad.push(`${id}: wiki ${hit ? `#${hit.n} week ${hit.week}` : "no event"}`);
}
if (bad.length)
  throw new Error(`numbering disagrees with NK ids:\n${bad.join("\n")}`);

// ---- bloonswiki correction layer ----
const ALIAS: Record<string, string> = { monkeymeadow: "Tutorial", towncenter: "TownCentre", alpine: "AlpineRun" };
for (const id of Object.keys(MAP_NAMES)) MAP_IDS.set(key(id), id);
function bwMap(name: string): string {
  const id = MAP_IDS.get(key(name)) ?? ALIAS[key(name)];
  if (!id) throw new Error(`bloonswiki: unknown map "${name}"`);
  return id;
}
/** Top-level `{{name | k = v | …}}` templates → parameters (first occurrence wins; split on | at depth 0). */
function bwTemplates(t: string, name: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (let i = t.indexOf(`{{${name}`); i >= 0; i = t.indexOf(`{{${name}`, i)) {
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
const instant = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");
type Bw = { type: string; n: number; map: string; start: number; end: number; name: string };
const titles = (
  (await (
    await fetch(`${BW}?action=query&list=allpages&apnamespace=3150&aplimit=500&format=json&formatversion=2`, {
      headers: { "user-agent": UA },
    })
  ).json()) as { query: { allpages: { title: string }[] } }
).query.allpages
  .map((p) => p.title)
  .filter((t) => /^Event history:Boss Bloon Event\/\d{4}$/.test(t));
await wait(1000);
const bw: Bw[] = [];
for (const title of titles) {
  const t = await wikitext(title, BW);
  if (!t) throw new Error(`bloonswiki page ${title} missing`);
  for (const p of bwTemplates(t, "BTD6 boss event rules")) {
    const m = /^([A-Za-z]+?)_?(\d*)(?:[A-Z][A-Za-z]*)?$/.exec((p.name ?? "").replace(/^Bloonsarius/, "Bloonarius"));
    const type = m?.[1].toLowerCase();
    if (!m || !TYPES.includes(type!)) {
      console.log(`bloonswiki: skipping ${p.name} (no boss type in the name)`);
      continue;
    }
    const map = /\|map=([^|}]*)/.exec(p["normal rules"] ?? "")?.[1];
    if (!map || !p.start || !p.end) throw new Error(`bloonswiki ${p.name}: no map/start/end`);
    bw.push({ type: type!, n: +m[2] || 1, map: bwMap(map), start: +p.start * 1000, end: +p.end * 1000, name: p.name });
  }
}
console.log(`bloonswiki: ${bw.length} boss events from ${titles.length} pages`);

const used = new Set<Bw>();
const fix = new Map<Ev, Bw>();
for (const e of [...evs.filter((x) => x.n), ...evs.filter((x) => !x.n)]) { // numbered first: a restart row must not steal its event
  // Numbered: same type and number (re-runs share a number: the closest start wins). Unnumbered: same type, start within a day.
  const cand = bw
    .filter((b) => b.type === e.type && (e.n ? b.n === e.n : Math.abs(b.start - e.start) < 1.5 * 864e5) && !used.has(b))
    .sort((a, b) => Math.abs(a.start - e.start) - Math.abs(b.start - e.start));
  if (cand[0]) (fix.set(e, cand[0]), used.add(cand[0]));
}
for (const [e, b] of fix) {
  if (Math.abs(b.start - e.start) > 1.5 * 864e5) console.log(`date: ${e.type} #${e.n || e.week} fandom ${iso(e.start)} → bloonswiki ${instant(b.start)}`);
  if (e.map !== b.map) console.log(`map: ${e.type} #${e.n || e.week} fandom ${e.map} → bloonswiki ${b.map}`);
}
console.log(
  `bloonswiki events with no Fandom row (left out): ${bw.filter((b) => !used.has(b)).map((b) => `${b.name} ${iso(b.start)}`).join(", ") || "none"}`,
);

type Row = { type: string; n: number; map: string; start: string; end: string; note?: string };
const data: Row[] = evs.map((e) => {
  const b = fix.get(e);
  return {
    type: e.type,
    n: e.n,
    map: b?.map ?? e.map,
    start: b ? instant(b.start) : iso(e.start),
    end: b ? instant(b.end) : iso(e.end),
    ...(e.n ? {} : { note: UNNUMBERED[e.week] }),
  };
});
// Events neither wiki lists, from NK's own boss list (data.ninjakiwi.com/btd6/bosses) as the Wayback Machine captured it
// on 2026-04-10. The map is unknown there (only the event's metadata has it).
const EXTRA = [{ id: "Phayze28_mniqi8ra", type: "phayze", n: 28, start: 1775268000000, end: 1775516400000 }];
for (const x of EXTRA)
  if (!data.some((r) => r.type === x.type && r.n === x.n))
    data.push({ type: x.type, n: x.n, map: "", start: instant(x.start), end: instant(x.end) });
// ---- community-list gap filler: only events no better source has ----
type Pt = { name: string; bossType: string; start: number; end: number; mapName?: string };
const portal: Pt[] = [];
for (let page = 1, pages = EVENT_LIST ? 1 : 0; page <= pages; page++) {
  const j = (await (await fetch(`${EVENT_LIST}?page=${page}&limit=100&sortBy=start_time&order=asc`, { headers: { "user-agent": UA } })).json()) as { data: Pt[]; pagination: { total_pages: number } };
  pages = j.pagination.total_pages;
  portal.push(...j.data.filter((p) => p.start > 0 && TYPES.includes(p.bossType)));
  await wait(1500);
}
let added = 0;
for (const p of portal) {
  // The event name is "<Boss><number>" (NK has misspelled Blastapopolous); named specials have no number: match those by date.
  const num = /^[A-Za-z]+?([0-9]+)[A-Za-z]*$/.exec(p.name)?.[1];
  const n = num ? +num : 0;
  const hit = data.find((r) => r.type === p.bossType && (num ? r.n === n : Math.abs(Date.parse(r.start) - p.start) < 1.5 * 864e5));
  if (hit) {
    // Cross-check only (the existing source wins): same start, same map.
    if (Math.abs(Date.parse(hit.start) - p.start) > 1.5 * 864e5) console.log(`list date: ${p.name} list ${instant(p.start)} vs ${hit.start}`);
    else if (hit.start.includes("T") && Math.abs(Date.parse(hit.start) - p.start) > 6e4) console.log(`list time: ${p.name} list ${instant(p.start)} vs bloonswiki ${hit.start}`);
    if (hit.map && p.mapName && hit.map !== p.mapName) console.log(`list map: ${p.name} list ${p.mapName} vs ${hit.map}`);
    continue;
  }
  if (!num) console.log(`list: skipping unnumbered ${p.name} (${instant(p.start)})`);
  if (!num) continue;
  const map = p.mapName && MAP_NAMES[p.mapName] ? p.mapName : "";
  if (!map) console.log(`list: ${p.name} has unknown map "${p.mapName}"`);
  data.push({ type: p.bossType, n, map, start: instant(p.start), end: instant(p.end) });
  added++;
}
if (!EVENT_LIST) console.log("community list: EVENT_LIST_BASE not set, keeping earlier entries");
else console.log(`community list: ${portal.length} events with times, ${added} added`);
for (const o of PREV) {
  const same = data.some((r) => r.type === o[0] && (o[1] ? r.n === o[1] : Math.abs(Date.parse(r.start) - Date.parse(o[3])) < 1.5 * 864e5));
  if (!same) data.push({ type: o[0], n: o[1], map: o[2], start: o[3], end: o[4], ...(o[5] ? { note: o[5] } : {}) });
}
data.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
for (const [type, n, start] of [["vortex", 7, "2022-07-09"], ["phayze", 10, "2024-03-23"], ["blastapopoulos", 6, "2025-01-04"]] as const) {
  const r = data.find((x) => x.type === type && x.n === n);
  if (!r?.start.startsWith(start)) throw new Error(`${type} #${n} should start ${start}, got ${r?.start}`);
}

const rows = data.map(
  (r) => `  [${[r.type, r.n, r.map, r.start, r.end, ...(r.note ? [r.note] : [])].map((x) => JSON.stringify(x)).join(", ")}],`,
);
writeFileSync(
  OUT,
  `// Generated by scripts/boss_history.ts from bloonswiki.com and the old Bloons Wiki (bloons.fandom.com), both CC BY-SA, and a community list for the newest events. Do not edit by hand.
// Boss events before the site's archive: [boss type, NK number, NK map id ("" = unknown), start, end, why unnumbered (number 0 only)].
// start/end: a full UTC instant (bloonswiki or community list), or where only Fandom has the event its (New Zealand) calendar day "YYYY-MM-DD".
// Numbering checked against ${ANCHORS.length} real NK event ids.
export const BOSS_HISTORY_SOURCE = "https://www.bloonswiki.com/Event_history:Boss_Bloon_Event";
export const BOSS_HISTORY_FANDOM = "https://bloons.fandom.com/wiki/Boss_Bloon_Event_(BTD6)/List_of_Boss_Events";
export type OldBoss = readonly [type: string, n: number, map: string, start: string, end: string, note?: "restarted" | "taken down" | "special"];
export const BOSS_HISTORY: readonly OldBoss[] = [
${rows.join("\n")}
];
`,
);
console.log(
  `${data.length} events (${fix.size} with exact times), ${data.filter((e) => !e.n).length} unnumbered; last ${data.at(-1)!.start}. Numbers match ${ANCHORS.length} NK ids.`,
);
console.log(
  Object.entries(count)
    .map(([k, n]) => `${k} ${n}`)
    .join(", "),
);
