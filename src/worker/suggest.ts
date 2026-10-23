// Suggestions box: POST /api/suggest stores a visitor's note and forwards it to a private Discord channel.
//
// Flow: same-origin + size + shape checks (400/403) → honeypot / form-open-time / per-visitor bucket (silent
// fake success for the first two, 429 for the bucket) → one D1 read (today's count + identical text in the last
// 24 h; duplicates get a silent fake success, a full day gets 429) → one row insert → a Discord post in
// waitUntil. A Discord failure never fails the request: the row is the record. The visitor's IP only keys the
// in-memory bucket; it is never stored or sent anywhere.
//
// Budgets: per suggestion 1 Worker request, 1 D1 read + 1 row write, 1 Discord post (a 2nd, once a day, when
// the 100/day cap is hit). Refused and fake-success submits cost no write. No webhook secret → no post.

import type { Deps } from "./deps.ts";
import { errorBody } from "./errors.ts";
import { clientKey, TokenBuckets } from "./limit.ts";
import { discordChannel, type Message } from "./notify.ts";
import { jsonResponse } from "./proxy.ts";

export const DAILY_CAP = 100;
const MAX_BODY = 8 * 1024;
const MIN_FORM_MS = 3000;
const DAY_MS = 24 * 60 * 60_000;
const KINDS: Record<string, string> = { bug: "Bug", data: "Wrong data", idea: "Idea" };

/** 3 suggestions per visitor, refilled at 3 per 10 minutes; per isolate, like the origin buckets. */
export const suggestBuckets = new TokenBuckets(3, 0.3);

interface Input {
  text: string;
  kind?: string;
  page?: string;
  pageUrl?: string;
  discord?: string;
  width?: number;
  version?: string;
  hp?: string;
  t?: number;
}

const bad = () => jsonResponse(errorBody("bad_request"), 400, "no-store");
const ok = () => jsonResponse(JSON.stringify({ success: true }), 200, "no-store");

/** Optional string field ≤ max chars: undefined when absent, null when invalid. */
const optStr = (v: unknown, max: number): string | undefined | null =>
  v === undefined ? undefined : typeof v === "string" && v.length <= max ? v : null;

function parse(raw: string): Input | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j) || typeof j.text !== "string") return null;
  const page = optStr(j.page, 120);
  const pageUrl = optStr(j.pageUrl, 300);
  const discord = optStr(j.discord, 40);
  const version = optStr(j.version, 20);
  const hp = optStr(j.hp, 10_000);
  if ([page, pageUrl, discord, version, hp].includes(null)) return null;
  if (pageUrl !== undefined && !pageUrl!.startsWith("/")) return null;
  if (j.kind !== undefined && (typeof j.kind !== "string" || !Object.hasOwn(KINDS, j.kind))) return null;
  for (const n of [j.width, j.t]) if (n !== undefined && !(typeof n === "number" && Number.isFinite(n))) return null;
  return { text: j.text.trim(), kind: j.kind as string | undefined, page, pageUrl, discord, version, hp, width: j.width as number | undefined, t: j.t as number | undefined } as Input;
}

/** Inline-code safe: no backticks or line breaks. */
const inline = (s: string) => `\`${s.replace(/`/g, "'").replace(/\s+/g, " ")}\``;

export function formatSuggestion(s: Input, host: string): Message {
  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (s.page || s.pageUrl) {
    fields.push({ name: "Page", value: [s.page && inline(s.page), s.pageUrl && inline(`https://${host}${s.pageUrl}`)].filter(Boolean).join("\n") });
  }
  if (s.discord) fields.push({ name: "Discord name", value: inline(s.discord), inline: true });
  if (s.width !== undefined) fields.push({ name: "Screen width", value: inline(String(s.width)), inline: true });
  if (s.version) fields.push({ name: "Version", value: inline(s.version), inline: true });
  return {
    embeds: [{
      title: s.kind ? `Suggestion: ${KINDS[s.kind]}` : "Suggestion",
      color: 0x27ae60,
      // A code block shows the text literally (no markdown, links or mentions); ``` inside it can't close the block.
      description: "```\n" + s.text.replaceAll("```", "'''") + "\n```",
      fields,
    }],
    allowed_mentions: { parse: [] },
    // Each suggestion is its own forum post: "Bug: first words of the text…".
    thread_name: clip(`${s.kind ? KINDS[s.kind] : "Suggestion"}: ${s.text.replace(/\s+/g, " ")}`, 100),
  };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function handleSuggest(deps: Deps, request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.get("Origin") !== url.origin) return jsonResponse(errorBody("bad_request"), 403, "no-store");

  if (Number(request.headers.get("Content-Length")) > MAX_BODY) return bad(); // before buffering the body
  const raw = await request.text();
  if (raw.length > MAX_BODY) return bad();
  const s = parse(raw);
  if (!s || s.text.length < 10 || s.text.length > 1000) return bad();

  // Bots get the same answer as people, but nothing is stored or sent.
  if (s.hp || (s.t !== undefined && s.t < MIN_FORM_MS)) return ok();

  const now = deps.now();
  const wait = suggestBuckets.take(clientKey(request), now);
  if (wait) {
    return jsonResponse(errorBody("rate_limited", undefined, { scope: "visitor", retryAfter: wait }), 429, "no-store", { "Retry-After": String(wait) });
  }

  const dayStart = now - (now % DAY_MS);
  let count: number;
  try {
    const r = await deps.db
      .prepare("SELECT COUNT(CASE WHEN created_at >= ? THEN 1 END) AS n, COUNT(CASE WHEN text = ? THEN 1 END) AS dup FROM suggestions WHERE created_at > ?")
      .bind(dayStart, s.text, now - DAY_MS)
      .first<{ n: number; dup: number }>();
    if (r && r.dup > 0) return ok();
    count = r?.n ?? 0;
  } catch (err) {
    console.warn("suggest: D1 read failed", String(err));
    return jsonResponse(errorBody("unavailable"), 503, "no-store", { "Retry-After": "60" });
  }
  if (count >= DAILY_CAP) {
    const retryAfter = Math.max(1, Math.ceil((dayStart + DAY_MS - now) / 1000));
    return jsonResponse(errorBody("rate_limited", undefined, { scope: "daily", retryAfter }), 429, "no-store", { "Retry-After": String(retryAfter) });
  }

  try {
    await deps.db
      .prepare("INSERT INTO suggestions (created_at, kind, text, page, page_url, discord, width, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(now, s.kind ?? null, s.text, s.page ?? null, s.pageUrl ?? null, s.discord ?? null, s.width === undefined ? null : Math.round(s.width), s.version ?? null)
      .run();
  } catch (err) {
    console.warn("suggest: D1 write failed", String(err));
    return jsonResponse(errorBody("unavailable"), 503, "no-store", { "Retry-After": "60" });
  }

  const hook = deps.suggest?.webhookUrl;
  if (hook) {
    const channel = discordChannel(deps.fetch, hook);
    const msgs = [formatSuggestion(s, url.host)];
    if (count + 1 === DAILY_CAP) {
      msgs.push({ embeds: [{ description: `Daily suggestion cap (${DAILY_CAP}) reached; new suggestions are refused until 00:00 UTC.`, color: 0xe67e22 }], allowed_mentions: { parse: [] }, thread_name: "Daily suggestion cap reached" });
    }
    deps.waitUntil(
      (async () => {
        for (const m of msgs) {
          const r = await channel.send(m);
          if (!("ok" in r)) console.warn("suggest: discord post failed", "error" in r ? r.error : "rate limited");
        }
      })(),
    );
  }
  return ok();
}
