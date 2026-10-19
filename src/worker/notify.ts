// Notifications: rules turn things the hot cron notices (a trigger) into messages for a channel.
//
// Flow: hot.ts hands over the list items that weren't in its previous copy → `detectNew` keeps those D1's
// `events` table has never stored (one read per kind with candidates, before the upsert) → `noteStmts` queue
// them in the `notifications` outbox inside the cron's batch → `flushOutbox` delivers unsent rows.
// Add a notification type = a trigger + a formatter in FORMATTERS + a rule in RULES (+ a channel if needed).
//
// Budgets: no D1 access at all unless a candidate exists or the outbox may hold unsent rows; one row write per
// notification plus two per delivery attempt. Unconfigured channels (no webhook secret) are skipped silently.

import { MAP_NAMES } from "../../web/src/data/names.ts";
import type { EventKind } from "../nk/routes.ts";
import type { D1Like, Deps } from "./deps.ts";
import type { ListItem } from "./events.ts";
import { OriginGate } from "./limit.ts";
import { SITE } from "./og.ts";
import { resolveKey } from "./proxy.ts";

const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 60 * 60_000;

// ─────────────────────────────── channels

export interface Message {
  embeds: Record<string, unknown>[];
  allowed_mentions: { parse: string[] };
  /** Forum-channel webhooks: the message opens a new post with this title (max 100 chars). */
  thread_name?: string;
  /** Pictures sent with the message (multipart); the embeds point at them as `attachment://<name>`. */
  files?: { name: string; blob: Blob }[];
}
export type SendResult = { ok: true } | { retryAfter: number } | { error: string };
export interface Channel {
  send(message: Message): Promise<SendResult>;
}
export type ChannelName = "discord" | "indexnow";
/** What flushOutbox calls: a channel turns the stored payload into whatever it sends. */
type Deliver = (deps: Deps, payload: NewEventPayload) => Promise<SendResult>;

/** IndexNow ping for the event's page. No formatting, no NK request. */
function indexNowDeliver(key: string): Deliver {
  return async (deps, p) => {
    try {
      const res = await deps.fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`,
          urlList: [`${SITE}/${p.kind}/${encodeURIComponent(p.id)}`],
        }),
      });
      if (res.status === 200 || res.status === 202) return { ok: true };
      if (res.status === 429) {
        const s = Number(res.headers.get("retry-after") ?? 60);
        return { retryAfter: Math.max(1, Number.isFinite(s) ? s : 60) * 1000 };
      }
      return { error: `HTTP ${res.status}` };
    } catch (err) {
      return { error: String(err) };
    }
  };
}

/** Posts to the webhook; the URL (a secret) never appears in a result or log. */
export function discordChannel(fetchFn: typeof fetch, url: string): Channel {
  return {
    async send(message) {
      try {
        const { files, ...json } = message;
        let res: Response;
        if (files?.length) {
          const form = new FormData(); // fetch adds the multipart content-type and boundary
          form.set("payload_json", JSON.stringify(json));
          files.forEach((f, i) => form.set(`files[${i}]`, f.blob, f.name));
          res = await fetchFn(url, { method: "POST", body: form });
        } else {
          res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
        }
        if (res.ok) return { ok: true };
        if (res.status === 429) {
          const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
          const s = Number(body?.retry_after ?? res.headers.get("retry-after") ?? 60);
          return { retryAfter: Math.max(1, Number.isFinite(s) ? s : 60) * 1000 };
        }
        return { error: `HTTP ${res.status}` };
      } catch (err) {
        return { error: String(err).replaceAll(url, "[webhook]") };
      }
    },
  };
}

const CHANNELS: Record<ChannelName, (deps: Deps) => Deliver | null> = {
  discord: (deps) => {
    const url = deps.notify?.discordWebhookUrl;
    if (!url) return null;
    const channel = discordChannel(deps.fetch, url);
    // The event's share card as the picture; today's text embed when it can't be had.
    return async (d, p) => channel.send((await cardMessage(d.fetch, d.notify, p)) ?? (await FORMATTERS["new-event"](d, p)));
  },
  indexnow: (deps) => (deps.notify?.indexNowKey ? indexNowDeliver(deps.notify.indexNowKey) : null),
};

// ─────────────────────────────── rules & formatters

export type Trigger = "new-event";
export interface Rule {
  id: string;
  trigger: Trigger;
  /** new-event: which event kinds. */
  kinds: EventKind[];
  channel: ChannelName;
}

export const RULES: Rule[] = [
  { id: "new-boss", trigger: "new-event", kinds: ["boss"], channel: "discord" },
  { id: "new-race", trigger: "new-event", kinds: ["race"], channel: "discord" },
  { id: "index-boss", trigger: "new-event", kinds: ["boss"], channel: "indexnow" },
  { id: "index-race", trigger: "new-event", kinds: ["race"], channel: "indexnow" },
  { id: "index-odyssey", trigger: "new-event", kinds: ["odyssey"], channel: "indexnow" },
  { id: "index-ct", trigger: "new-event", kinds: ["ct"], channel: "indexnow" },
];

/** What is stored in an outbox row for the new-event trigger: only the list fields the message uses. */
export interface NewEventPayload {
  kind: EventKind;
  id: string;
  name?: string;
  bossType?: string;
  bossTypeURL?: string;
  normalScoringType?: string;
  eliteScoringType?: string;
  start: number;
  end: number;
}

/** The event's ruleset (NK challenge document; a boss's Normal one): only the fields the message uses. */
export interface EventDoc {
  map?: string;
  mapURL?: string;
  difficulty?: string;
  mode?: string;
  startRound?: number;
  endRound?: number;
  startingCash?: number;
  lives?: number;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unix = (ms: number) => Math.floor(ms / 1000);
const COLORS: Partial<Record<EventKind, number>> = { boss: 0xc0392b, race: 0x2980b9 };
const SCORING: Record<string, string> = { LeastCash: "Least Cash", GameTime: "Fastest Time", LeastTiers: "Least Tiers" };
/** "FloodedValley" → "Flooded Valley"; game modes as the game names them. */
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");
const modeName = (m: string) => (m === "Clicks" ? "CHIMPS" : m === "DoubleMoabHealth" ? "Double HP MOABs" : spaced(m));
const int = (n: number) => n.toLocaleString("en-US");
const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** One embed for a new boss/race: the list item, plus map and rules when the event's document was available. */
export function formatNewEvent(p: NewEventPayload, titlePrefix = "", doc?: EventDoc | null): Message {
  let title: string;
  if (p.kind === "boss") {
    const n = /(\d+)$/.exec(p.name ?? "")?.[1];
    const type = p.bossType ? `${cap(p.bossType)}${n ? ` #${n}` : ""}` : (p.name ?? "");
    title = `New boss event: ${type || p.id}`;
  } else {
    title = `New race: ${p.name ?? p.id}`;
  }
  const embed: Record<string, unknown> = {
    title: titlePrefix + title,
    url: `${SITE}/${p.kind}/${encodeURIComponent(p.id)}`,
    color: COLORS[p.kind] ?? 0x7f8c8d,
    fields: [
      { name: "Starts", value: `<t:${unix(p.start)}:F> (<t:${unix(p.start)}:R>)`, inline: true },
      { name: "Ends", value: `<t:${unix(p.end)}:F> (<t:${unix(p.end)}:R>)`, inline: true },
    ],
  };
  const fields = embed.fields as { name: string; value: string; inline?: boolean }[];
  if (doc) {
    // "**Flooded Valley** · Medium · Standard"
    const map = doc.map ? `**${MAP_NAMES[doc.map] ?? spaced(doc.map)}**` : "";
    embed.description = [map, doc.difficulty, doc.mode && modeName(doc.mode)].filter(Boolean).join(" · ");
    const rules = [
      ok(doc.startRound) && ok(doc.endRound) ? `Rounds ${doc.startRound}–${doc.endRound}` : "",
      ok(doc.startingCash) ? `$${int(doc.startingCash)} starting cash` : "",
      ok(doc.lives) ? `${int(doc.lives)} lives` : "",
    ].filter(Boolean);
    if (rules.length) fields.push({ name: p.kind === "boss" ? "Normal rules" : "Rules", value: rules.join(" · ") });
  }
  if (p.kind === "boss") {
    const sc = (t?: string) => (t ? (SCORING[t] ?? spaced(t)) : "");
    const n = sc(p.normalScoringType);
    const e = sc(p.eliteScoringType);
    if (n || e) fields.push({ name: "Scoring", value: [n && `Normal: ${n}`, e && `Elite: ${e}`].filter(Boolean).join(" · ") });
    if (p.bossType) fields.push({ name: "Boss stats", value: `[Health, skulls and spawns per tier](${SITE}/bosses/${encodeURIComponent(p.bossType)})` });
  }
  // The site's own link preview for a boss uses this same picture (og.ts); races have none in the list.
  if (p.bossTypeURL?.startsWith("https://")) embed.thumbnail = { url: p.bossTypeURL };
  if (doc?.mapURL?.startsWith("https://")) embed[p.kind === "boss" ? "image" : "thumbnail"] = { url: doc.mapURL };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

/** The event's document through the site's own cache (one NK request at most, then cached for visitors too). */
async function eventDoc(deps: Deps, p: NewEventPayload): Promise<EventDoc | null> {
  const id = encodeURIComponent(p.id);
  const path = p.kind === "boss" ? `/btd6/bosses/${id}/metadata/standard` : p.kind === "race" ? `/btd6/races/${id}/metadata` : null;
  if (!path) return null;
  try {
    const r = await resolveKey(deps, new OriginGate(deps.limits, "cron:notify", deps.now), path, "");
    if (r.status !== 200) return null;
    const b = (JSON.parse(r.body) as { body?: unknown }).body;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as EventDoc) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────── share-card message

/**
 * One PNG of the site's `?card` page via Cloudflare Browser Rendering (REST Quick Action /screenshot,
 * https://developers.cloudflare.com/browser-run/quick-actions/screenshot-endpoint/). Null on any failure.
 */
async function screenshot(fetchFn: typeof fetch, accountId: string, token: string, page: string): Promise<Blob | null> {
  try {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/screenshot`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        url: page,
        selector: "#card",
        viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
        waitForSelector: { selector: "#card[data-ready]", timeout: 20_000 },
        screenshotOptions: { type: "png" },
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/png")) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/**
 * The card message for a new boss (Normal + Elite, one gallery: both embeds share the title link) or race:
 * the dates stay as Discord timestamps (they localise per reader), everything else is on the card.
 * Null when there is no token or any screenshot failed.
 */
export async function cardMessage(fetchFn: typeof fetch, cfg: Deps["notify"], p: NewEventPayload, titlePrefix = ""): Promise<Message | null> {
  const { browserToken: token, accountId } = cfg ?? {};
  if (!token || !accountId || (p.kind !== "boss" && p.kind !== "race")) return null;
  const page = `${SITE}/${p.kind}/${encodeURIComponent(p.id)}`;
  const cards = p.kind === "boss"
    ? [{ name: "normal.png", q: "?card=1" }, { name: "elite.png", q: "?d=elite&card=1" }]
    : [{ name: "card.png", q: "?card=1" }];
  const blobs = await Promise.all(cards.map((c) => screenshot(fetchFn, accountId, token, page + c.q)));
  if (blobs.some((b) => !b)) return null;
  const first = formatNewEvent(p, titlePrefix).embeds[0];
  const fields = (first.fields as { name: string }[]).slice(0, 2); // Starts, Ends
  const embeds: Record<string, unknown>[] = [{ title: first.title, url: first.url, color: first.color, fields, image: { url: `attachment://${cards[0].name}` } }];
  if (p.kind === "boss") {
    embeds[0].fields = [...fields, { name: "Boss stats", value: `[Health, skulls and spawns per tier](${SITE}/bosses/${encodeURIComponent(p.bossType ?? "")})` }].slice(0, p.bossType ? 3 : 2);
    embeds.push({ url: first.url, image: { url: `attachment://${cards[1].name}` } });
  }
  return { embeds, allowed_mentions: { parse: [] }, files: cards.map((c, i) => ({ name: c.name, blob: blobs[i]! })) };
}

const FORMATTERS: Record<Trigger, (deps: Deps, payload: NewEventPayload) => Promise<Message>> = {
  "new-event": async (deps, p) => formatNewEvent(p, "", await eventDoc(deps, p)),
};

// ─────────────────────────────── detection → outbox

export interface Note {
  key: string;
  rule: string;
  payload: string;
}

/** Rules whose channel is configured. */
const active = (deps: Deps, trigger: Trigger) => RULES.filter((r) => r.trigger === trigger && CHANNELS[r.channel](deps));

/** Kinds some active rule watches (hot.ts collects candidates only for these). */
export function watchedKinds(deps: Deps): Set<EventKind> {
  return new Set(active(deps, "new-event").flatMap((r) => r.kinds));
}

/**
 * Of `candidates` (items missing from the previous hot copy) those never stored in `events`, as outbox
 * notes. Must run before the upsert. Never throws: a failed read means no notification this time.
 */
export async function detectNew(deps: Deps, candidates: Partial<Record<EventKind, ListItem[]>>, now: number): Promise<Note[]> {
  const notes: Note[] = [];
  try {
    for (const rule of active(deps, "new-event")) {
      for (const kind of rule.kinds) {
        // An event that already ended isn't news (e.g. after the events table was lost).
        const items = (candidates[kind] ?? []).filter((x) => x.end > now);
        if (!items.length) continue;
        const { results } = await deps.db
          .prepare(`SELECT id FROM events WHERE kind = ? AND id IN (${items.map(() => "?").join(",")})`)
          .bind(kind, ...items.map((x) => x.id))
          .all<{ id: string }>();
        const known = new Set(results.map((r) => r.id));
        for (const it of items) {
          if (known.has(it.id)) continue;
          const payload: NewEventPayload = {
            kind, id: it.id, name: str(it.name), bossType: str(it.bossType), bossTypeURL: str(it.bossTypeURL),
            normalScoringType: str(it.normalScoringType), eliteScoringType: str(it.eliteScoringType), start: it.start, end: it.end,
          };
          notes.push({ key: `${rule.id}:${kind}:${it.id}`, rule: rule.id, payload: JSON.stringify(payload) });
        }
      }
    }
  } catch (err) {
    console.warn("notify: detection skipped (D1 read failed)", String(err));
    return [];
  }
  return notes;
}

export function noteStmts(db: D1Like, notes: Note[], now: number) {
  return notes.map((n) =>
    db
      .prepare("INSERT OR IGNORE INTO notifications (key, rule, payload, created_at) VALUES (?, ?, ?, ?)")
      .bind(n.key, n.rule, n.payload, now),
  );
}

// ─────────────────────────────── delivery

/** Unsent rows may exist: true at isolate start (one look), after queuing, and while retries remain. */
let mayHaveUnsent = true;
/** A channel asked us to wait (429): it gets nothing before this time. */
let holdUntil: Partial<Record<ChannelName, number>> = {};

export function resetNotifyState(): void {
  mayHaveUnsent = true;
  holdUntil = {};
}
export const markUnsent = () => {
  mayHaveUnsent = true;
};
export const outboxMayHaveUnsent = (deps: Deps) => mayHaveUnsent && RULES.some((r) => CHANNELS[r.channel](deps));

/** Send unsent rows (≤ 24 h old, < 5 attempts). Never throws; failures are recorded on the row. */
export async function flushOutbox(deps: Deps): Promise<void> {
  try {
    const now = deps.now();
    const { results } = await deps.db
      .prepare("SELECT key, rule, payload, attempts FROM notifications WHERE sent_at IS NULL AND attempts < ? AND created_at > ? ORDER BY created_at LIMIT 10")
      .bind(MAX_ATTEMPTS, now - MAX_AGE_MS)
      .all<{ key: string; rule: string; payload: string; attempts: number }>();
    mayHaveUnsent = false;
    for (const row of results) {
      const rule = RULES.find((r) => r.id === row.rule);
      const channel = rule && CHANNELS[rule.channel](deps);
      if (!rule || !channel) continue; // unconfigured now: stays queued until it expires
      if (now < (holdUntil[rule.channel] ?? 0)) {
        mayHaveUnsent = true;
        continue;
      }
      // Claim the attempt first, so two isolates never send the same row.
      const claim = (await deps.db
        .prepare("UPDATE notifications SET attempts = attempts + 1 WHERE key = ? AND sent_at IS NULL AND attempts = ?")
        .bind(row.key, row.attempts)
        .run()) as { meta?: { changes?: number } };
      if (claim?.meta?.changes === 0) continue;
      let result: SendResult;
      try {
        result = await channel(deps, JSON.parse(row.payload) as NewEventPayload);
      } catch (err) {
        result = { error: String(err) };
      }
      if ("ok" in result) {
        await deps.db.prepare("UPDATE notifications SET sent_at = ?, last_error = NULL WHERE key = ?").bind(deps.now(), row.key).run();
        continue;
      }
      const error = "error" in result ? result.error : `rate limited, retry after ${Math.ceil(result.retryAfter / 1000)} s`;
      await deps.db.prepare("UPDATE notifications SET last_error = ? WHERE key = ?").bind(error, row.key).run();
      console.warn("notify: delivery failed", row.key, error);
      if (row.attempts + 1 < MAX_ATTEMPTS) mayHaveUnsent = true;
      if ("retryAfter" in result) {
        holdUntil[rule.channel] = deps.now() + result.retryAfter;
      }
    }
    if (results.length === 10) mayHaveUnsent = true;
  } catch (err) {
    mayHaveUnsent = true;
    console.warn("notify: outbox flush failed", String(err));
  }
}
