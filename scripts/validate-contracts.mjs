// Validates docs/api/fixtures against docs/api/openapi.yaml, and cross-checks src/nk/routes.ts:
//   1. every successful fixture body matches its endpoint's schema (additionalProperties:false → drift is caught)
//   2. every error fixture matches ErrorEnvelope
//   3. routes.ts classifies every fixture path with the same cache class as the spec's x-cache-class
//   4. every OpenAPI path has a routes.ts route (except private ones) and vice versa
//
//   npm run validate

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";
import { ROUTES, matchRoute } from "../src/nk/routes.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = YAML.parse(readFileSync(join(root, "docs/api/openapi.yaml"), "utf8"));
const fixDir = join(root, "docs/api/fixtures");
const index = JSON.parse(readFileSync(join(fixDir, "_index.json"), "utf8"));

const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: "nk", components: spec.components });

// OpenAPI path templates → regex, most literal segments first so /maps/map/{id}/preview beats /maps/map/{id}.
const specPaths = Object.entries(spec.paths)
  .map(([tpl, item]) => ({
    tpl,
    op: item.get,
    re: new RegExp("^" + tpl.replace(/\{[^}]+\}/g, "[^/]+") + "$"),
    literal: tpl.split("/").filter((s) => s && !s.startsWith("{")).length,
  }))
  .sort((a, b) => b.literal - a.literal);

const failures = [];
const fail = (where, msg) => failures.push(`${where}: ${msg}`);
let checked = 0;

for (const req of index.requests) {
  const [pathname, search = ""] = req.path.split("?");
  const where = req.path;
  const sp = specPaths.find((p) => p.re.test(pathname));
  const m = matchRoute(pathname, search ? `?${search}` : "");

  // ── routes.ts ↔ spec
  if (!sp) {
    if (m.ok) fail(where, "routes.ts accepts a path the spec doesn't define");
    if (req.status !== 404) fail(where, `no spec path, but upstream returned ${req.status}`);
    continue;
  }
  const specClass = sp.op["x-cache-class"];
  if (!specClass) fail(sp.tpl, "missing x-cache-class");
  if (m.ok && m.route.cache !== specClass) {
    fail(where, `cache class mismatch: routes.ts=${m.route.cache} spec=${specClass}`);
  }
  if (!m.ok && m.status === 403 && specClass !== "private" && !/^\/btd6\/users\//.test(pathname)) {
    fail(where, "routes.ts treats as private but spec does not");
  }

  // ── body ↔ schema
  const content = sp.op.responses["200"].content;
  if (content["application/json"]) {
    const data = JSON.parse(readFileSync(join(fixDir, req.file), "utf8"));
    if (data._non_json !== undefined) {
      if (!/pretty=true/.test(search)) fail(where, "non-JSON body from a JSON endpoint");
      continue;
    }
    const alts = content["application/json"].schema.oneOf.map((s) => s.$ref);
    const ref = data.success ? alts.find((r) => !r.endsWith("/ErrorEnvelope")) : `#/components/schemas/ErrorEnvelope`;
    const validate = ajv.getSchema(`nk${ref}`);
    if (!validate(data)) {
      for (const e of validate.errors.slice(0, 8)) fail(where, `${e.instancePath || "/"} ${e.message} ${JSON.stringify(e.params)}`);
    }
  } else {
    const ct = req.headers["content-type"] ?? "";
    if (!Object.keys(content).some((k) => ct.startsWith(k))) fail(where, `content-type ${ct} not in spec`);
  }
  checked++;
}

// ── coverage both ways
const routeNames = new Set(ROUTES.map((r) => r.pattern.source));
for (const sp of specPaths) {
  if (sp.op["x-cache-class"] === "private") continue;
  const sample = sp.tpl
    .replace("{raceID}", "Gun_Game_mu19oabt").replace("{bossID}", "Vortex47_mu62cmt5")
    .replace("{type}", "elite").replace("{teamSize}", "4").replace("{difficulty}", sp.tpl.includes("odyssey") ? "hard" : "elite")
    .replace("{userID}", "0".repeat(48)).replace("{guildID}", "0".repeat(48))
    .replace("{ctID}", "mtv62zza").replace("{groupID}", "0".repeat(44)).replace("{odysseyID}", "muekowzs")
    .replace("{challengeFilter}", "daily").replace("{challengeID}", "rot296620260924")
    .replace("{mapFilter}", "mostLiked").replace("{mapID}", "ZMYWROV");
  const m = matchRoute(sample);
  if (!m.ok) fail(sp.tpl, `no routes.ts route matches sample ${sample}`);
}
if (routeNames.size !== ROUTES.length) fail("routes.ts", "duplicate route patterns");

const probes = [
  ["/btd6/bosses/Vortex47_mu62cmt5/leaderboard/standard/5", false],
  ["/btd6/bosses/Vortex47_mu62cmt5/metadata/hard", false],
  ["/btd6/races/Gun_Game_mu19oabt/leaderboard?page=21", false],
  ["/btd6/races/Gun_Game_mu19oabt/leaderboard?page=20", true],
  ["/btd6/save/anything", false],
  ["/btd6/users/oak_something", false],
];
for (const [p, expectOk] of probes) {
  const [a, b = ""] = p.split("?");
  if (matchRoute(a, b && `?${b}`).ok !== expectOk) fail(p, `local validation expected ok=${expectOk}`);
}

console.log(`${checked} fixtures checked against ${specPaths.length} spec paths, ${ROUTES.length} routes.`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("Contracts OK.");
