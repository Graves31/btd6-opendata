// Boss events from before the site's archive (and before NK's API window), for the boss stats "Past events" list.
// Source: the Bloons Wiki "List of Boss Events" pages (bloons.fandom.com, CC BY-SA), one page per game version.
// Run by hand after a few new versions: `node scripts/boss_history.ts` → web/src/data/bossHistory.ts.
// Fetches ~30 wiki pages, one per second. The numbering is checked against real NK event ids (ANCHORS).

import { writeFileSync } from "node:fs";
import { MAP_NAMES } from "../web/src/data/names.ts";

const API = "https://bloons.fandom.com/api.php";
const LIST = "Boss_Bloon_Event_(BTD6)/List_of_Boss_Events";
const UA =
  "btd6-opendata-site/1.0 (unofficial fan site; occasional one-off fetch)";
const OUT = new URL("../web/src/data/bossHistory.ts", import.meta.url);

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
async function wikitext(page: string): Promise<string | undefined> {
  const u = `${API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
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

const rows = evs.map(
  (e) =>
    `  [${[e.type, e.n, e.map, iso(e.start), iso(e.end), ...(e.n ? [] : [UNNUMBERED[e.week]])].map((x) => JSON.stringify(x)).join(", ")}],`,
);
writeFileSync(
  OUT,
  `// Generated by scripts/boss_history.ts from the Bloons Wiki (bloons.fandom.com, CC BY-SA). Do not edit by hand.
// Boss events before the site's archive: [boss type, NK number, NK map id, start, end, why unnumbered (number 0 only)].
// Dates are the wiki's (New Zealand) calendar days. Numbering checked against ${ANCHORS.length} real NK event ids.
export const BOSS_HISTORY_SOURCE = "https://bloons.fandom.com/wiki/Boss_Bloon_Event_(BTD6)/List_of_Boss_Events";
export type OldBoss = readonly [type: string, n: number, map: string, start: string, end: string, note?: "restarted" | "taken down" | "special"];
export const BOSS_HISTORY: readonly OldBoss[] = [
${rows.join("\n")}
];
`,
);
console.log(
  `${evs.length} events, ${evs.filter((e) => !e.n).length} unnumbered; last ${iso(evs.at(-1)!.start)}. Numbers match ${ANCHORS.length} NK ids.`,
);
console.log(
  Object.entries(count)
    .map(([k, n]) => `${k} ${n}`)
    .join(", "),
);
