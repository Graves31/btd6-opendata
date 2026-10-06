// Serves docs/api/fixtures as a fake data.ninjakiwi.com, so `npm run dev:offline` never touches NK.
//   node scripts/fixture-server.ts [port]
//
// Optional latency, to watch /api/batch stream (fast lines first, slow ones as they land):
//   FIXTURE_DELAY_MS=1500 FIXTURE_SLOW=/users/ node scripts/fixture-server.ts 8798
// delays every request whose path matches the FIXTURE_SLOW regex (default: all) by FIXTURE_DELAY_MS.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { makeOrigin } from "../test/harness.ts";

const port = Number(process.argv[2] ?? 8788);
const delayMs = Number(process.env.FIXTURE_DELAY_MS ?? 0);
const slow = new RegExp(process.env.FIXTURE_SLOW ?? "");
const origin = makeOrigin();

/** Fake Cloudflare GraphQL endpoint for the hidden /stats page: docs/api/stats-graphql.json with its 30 days re-dated to end today. */
function statsFixture(): string {
  const j = JSON.parse(readFileSync(new URL("../docs/api/stats-graphql.json", import.meta.url), "utf8"));
  const daily = j.data.viewer.accounts[0].daily as { dimensions: { date: string } }[];
  daily.forEach((g, i) => (g.dimensions.date = new Date(Date.now() - (daily.length - 1 - i) * 86_400_000).toISOString().slice(0, 10)));
  return JSON.stringify(j);
}

createServer(async (req, res) => {
  if (req.url === "/stats-graphql") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(statsFixture());
    return;
  }
  const headers: Record<string, string> = {};
  if (req.headers["if-none-match"]) headers["If-None-Match"] = String(req.headers["if-none-match"]);
  if (delayMs > 0 && slow.test(req.url ?? "")) await new Promise((r) => setTimeout(r, delayMs));
  const r = await origin.fetch(`https://data.ninjakiwi.com${req.url}`, { headers });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
  console.log(r.status, req.url);
}).listen(port, "127.0.0.1", () => console.log(`fixture origin on http://127.0.0.1:${port}`));
