// Sends one test boss and one test race message to the Discord webhook, built with the real formatter from
// the newest boss/race in the docs/api fixtures, with a fixture ruleset (Vortex 47 / Party Madness) as the document.
//   DISCORD_WEBHOOK_URL=... node scripts/notify-test.ts      (or put it in .dev.vars as KEY=value)

import { readFileSync } from "node:fs";
import { cardMessage, discordChannel, formatNewEvent, type EventDoc, type NewEventPayload } from "../src/worker/notify.ts";

const root = new URL("../", import.meta.url);
let url = process.env.DISCORD_WEBHOOK_URL;
if (!url) {
  try {
    const m = /^DISCORD_WEBHOOK_URL\s*=\s*"?([^"\r\n]+?)"?\s*$/m.exec(readFileSync(new URL(".dev.vars", root), "utf8"));
    url = m?.[1];
  } catch {}
}
if (!url) {
  console.error("DISCORD_WEBHOOK_URL not set (environment or .dev.vars)");
  process.exit(1);
}

const newest = (kind: "boss" | "race", file: string): NewEventPayload => {
  const body = (JSON.parse(readFileSync(new URL(`docs/api/fixtures/${file}`, root), "utf8")) as { body: Record<string, unknown>[] }).body;
  const it = body.reduce((a, b) => ((b.start as number) > (a.start as number) ? b : a));
  return { kind, id: it.id, name: it.name, bossType: it.bossType, bossTypeURL: it.bossTypeURL, normalScoringType: it.normalScoringType, eliteScoringType: it.eliteScoringType, start: it.start, end: it.end } as NewEventPayload;
};
const doc = (file: string) => (JSON.parse(readFileSync(new URL(`docs/api/fixtures/${file}`, root), "utf8")) as { body: EventDoc }).body;
const DOCS = { boss: doc("btd6__bosses__Vortex47_mu62cmt5__metadata__standard.json"), race: doc("btd6__races__Party_Madness_muekt6x6__metadata.json") };

// With BROWSER_TOKEN too (env or .dev.vars) the messages carry the share card, like the real ones.
const dv = (k: string) => {
  try {
    return process.env[k] ?? new RegExp(String.raw`^${k}\s*=\s*"?([^"\r\n]+?)"?\s*$`, "m").exec(readFileSync(new URL(".dev.vars", root), "utf8"))?.[1];
  } catch {}
};
const cfg = { browserToken: dv("BROWSER_TOKEN"), accountId: /"CF_ACCOUNT_ID":\s*"(\w+)"/.exec(readFileSync(new URL("wrangler.jsonc", root), "utf8"))?.[1] };
const channel = discordChannel(fetch, url);
let failed = false;
for (const p of [newest("boss", "btd6__bosses.json"), newest("race", "btd6__races.json")]) {
  const r = await channel.send((await cardMessage(fetch, cfg, p, "[Test] ")) ?? formatNewEvent(p, "[Test] ", DOCS[p.kind as "boss" | "race"]));
  console.log(p.kind, p.id, "ok" in r ? "sent" : JSON.stringify(r));
  if (!("ok" in r)) failed = true;
}
process.exit(failed ? 1 : 0);
