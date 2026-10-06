// Coverage check for the game-art registry. Run: `node scripts/check_art.ts` (npm run art:check).
//
// web/src/art/index.ts imports .webp files, so Node can't load it; scripts/build_art.py therefore also writes
// web/src/art/manifest.json (keys per family, sheet sizes, map names), which this script reads. It reports:
//   - every TowerId / HeroId / PowerId / BossType / MedalTier literal in src/nk/types.ts, found or missing;
//   - every tower / hero / power / bossType / boss-badge / medal / built-in map key that appears in
//     docs/api/fixtures, found or missing;
//   - every CT relic id (tile type "Relic - <id>") that appears in the fixtures, against the "relic" family.
// Exits 1 if anything is missing.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

interface FamilyInfo {
  cell: number;
  cols: number;
  rows: number;
  bytes: number;
  keys: string[];
  missingOptional: string[];
}
interface Manifest {
  families: Record<string, FamilyInfo>;
  totalSheetBytes: number;
  maps: Record<string, { source: string; px: number; bytes: number; s96: string; s200: string; s400: string }>;
}

const manifest = JSON.parse(readFileSync(join(root, "web/src/art/manifest.json"), "utf8")) as Manifest;
const keysOf = (family: string): Set<string> => new Set(manifest.families[family]?.keys ?? []);

// ─── literal unions from src/nk/types.ts
const typesSrc = readFileSync(join(root, "src/nk/types.ts"), "utf8");
function unionLiterals(name: string): string[] {
  const m = new RegExp(`export type ${name} = Open<([\\s\\S]*?)>;`).exec(typesSrc);
  if (!m) throw new Error(`type ${name} not found in src/nk/types.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

// ─── keys seen in fixtures
type Seen = Map<string, Set<string>>; // "family:key" -> fixture files
const seen: Seen = new Map();
function note(family: string, key: string, file: string): void {
  const id = `${family}\u0000${key}`;
  if (!seen.has(id)) seen.set(id, new Set());
  seen.get(id)!.add(file);
}

const MEDAL_FIELDS: Record<string, string> = {
  _medalsRace: "",
  _medalsBoss: "boss:",
  _medalsBossElite: "bossElite:",
  _medalsCTLocal: "ctLocal:",
  _medalsCTGlobal: "ctGlobal:",
};
const heroIds = new Set(unionLiterals("HeroId"));

function walk(node: unknown, file: string): void {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, file);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (typeof o.tower === "string" && o.tower !== "ChosenPrimaryHero") {
    note(o.isHero === true || heroIds.has(o.tower) ? "hero" : "tower", o.tower, file);
  }
  if (typeof o.power === "string") note("power", o.power, file);
  if (typeof o.type === "string" && o.type.startsWith("Relic - ")) note("relic", o.type.slice("Relic - ".length), file);
  if (typeof o.bossType === "string") note("boss", o.bossType, file);
  if (typeof o.map === "string" && typeof o.mapURL === "string" && o.map !== "CustomMap") note("map", o.map, file);
  if (typeof o.mostExperiencedMonkey === "string") note("tower", o.mostExperiencedMonkey, file);
  const obj = (k: string): Record<string, unknown> | null =>
    o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? (o[k] as Record<string, unknown>) : null;
  for (const k of Object.keys(obj("towersPlaced") ?? {})) note("tower", k, file);
  for (const k of Object.keys(obj("heroesPlaced") ?? {})) note("hero", k, file);
  const stats = obj("stats");
  if (stats && stats.paragonsPurchasedByName && typeof stats.paragonsPurchasedByName === "object") {
    for (const k of Object.keys(stats.paragonsPurchasedByName)) note("tower", k, file);
  }
  for (const k of Object.keys(obj("bossBadgesNormal") ?? {})) note("boss", k, file);
  for (const k of Object.keys(obj("bossBadgesElite") ?? {})) note("boss", k, file);
  for (const k of Object.keys(obj("_medalsSinglePlayer") ?? {})) note("modeMedal", k, file);
  for (const k of Object.keys(obj("_medalsMultiplayer") ?? {})) note("modeMedal", `coop:${k}`, file);
  for (const [field, prefix] of Object.entries(MEDAL_FIELDS)) {
    for (const k of Object.keys(obj(field) ?? {})) note("eventMedal", prefix + k, file);
  }
  // Skip NK's self-describing schema ("model": { name, parameters }) — its keys are field docs, not data.
  for (const [k, v] of Object.entries(o)) if (k !== "model") walk(v, file);
}

const fixtureDir = join(root, "docs/api/fixtures");
for (const f of readdirSync(fixtureDir).sort()) {
  if (!f.endsWith(".json")) continue;
  walk(JSON.parse(readFileSync(join(fixtureDir, f), "utf8")), f);
}

// ─── report
let missing = 0;
const has = (family: string, key: string): boolean =>
  family === "map" ? key in manifest.maps : keysOf(family).has(key);

console.log("Sheets:");
for (const [f, i] of Object.entries(manifest.families)) {
  console.log(`  ${f.padEnd(10)} ${String(i.keys.length).padStart(3)} keys  ${i.cols}x${i.rows} @ ${i.cell}px  ` +
    `${(i.bytes / 1024).toFixed(1)} KB`);
}
console.log(`  total      ${(manifest.totalSheetBytes / 1024).toFixed(1)} KB; maps: ${Object.keys(manifest.maps).length}`);

console.log("\nsrc/nk/types.ts literals:");
const typeChecks: [string, string, (k: string) => string][] = [
  ["TowerId", "tower", (k) => k],
  ["HeroId", "hero", (k) => k],
  ["PowerId", "power", (k) => k],
  ["BossType", "boss", (k) => k],
  ["MedalTier", "eventMedal", (k) => k],
];
for (const [type, family, toKey] of typeChecks) {
  const lits = unionLiterals(type);
  const miss = lits.filter((l) => !has(family, toKey(l)));
  missing += miss.length;
  console.log(`  ${type.padEnd(9)} ${lits.length - miss.length}/${lits.length} found` +
    (miss.length ? `  MISSING: ${miss.join(", ")}` : ""));
}

console.log("\nFixture keys (docs/api/fixtures):");
const byFamily = new Map<string, { found: string[]; miss: string[] }>();
for (const id of [...seen.keys()].sort()) {
  const [family, key] = id.split("\u0000");
  if (!byFamily.has(family)) byFamily.set(family, { found: [], miss: [] });
  (has(family, key) ? byFamily.get(family)!.found : byFamily.get(family)!.miss).push(key);
}
for (const [family, { found, miss }] of byFamily) {
  missing += miss.length;
  console.log(`  ${family.padEnd(10)} ${found.length}/${found.length + miss.length} found` +
    (miss.length ? `  MISSING: ${miss.map((k) => `${k} (${[...seen.get(`${family}\u0000${k}`)!][0]})`).join(", ")}` : ""));
}

console.log(missing ? `\n${missing} missing` : "\nAll keys covered.");
process.exitCode = missing ? 1 : 0;
