// Notifications: rules turn things the hot cron notices (a trigger) into messages for a channel.
//
// Flow: hot.ts hands over the list items that weren't in its previous copy → `detectNew` keeps those D1's
// `events` table has never stored (one read per kind with candidates, before the upsert) → `noteStmts` queue
// them in the `notifications` outbox inside the cron's batch → `flushOutbox` delivers unsent rows.
// Add a notification type = a trigger + a formatter in FORMATTERS + a rule in RULES (+ a channel if needed).
//
// Budgets: no D1 access at all unless a candidate exists or the outbox may hold unsent rows; one row write per
// notification plus two per delivery attempt. Unconfigured channels (no webhook secret) are skipped silently.

import type { EventKind } from "../nk/routes.ts";
import type { D1Like, Deps } from "./deps.ts";
import type { ListItem } from "./events.ts";

export const SITE = "https://btd6-opendata.btd6-opendata-site.workers.dev";
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 24 * 60 * 60_000;

// ─────────────────────────────── channels

export interface Message {
  embeds: Record<string, unknown>[];
  allowed_mentions: { parse: string[] };
}
export type SendResult = { ok: true } | { retryAfter: number } | { error: string };
export interface Channel {
  send(message: Message): Promise<SendResult>;
}
export type ChannelName = "discord";

/** Posts to the webhook; the URL (a secret) never appears in a result or log. */
export function discordChannel(fetchFn: typeof fetch, url: string): Channel {
  return {
    async send(message) {
      try {
        const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(message) });
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

const CHANNELS: Record<ChannelName, (deps: Deps) => Channel | null> = {
  discord: (deps) => (deps.notify?.discordWebhookUrl ? discordChannel(deps.fetch, deps.notify.discordWebhookUrl) : null),
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
];

/** What is stored in an outbox row for the new-event trigger: only the list fields the message uses. */
export interface NewEventPayload {
  kind: EventKind;
  id: string;
  name?: string;
  bossType?: string;
  bossTypeURL?: string;
  start: number;
  end: number;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unix = (ms: number) => Math.floor(ms / 1000);
const COLORS: Partial<Record<EventKind, number>> = { boss: 0xc0392b, race: 0x2980b9 };

/** One embed for a new boss/race. Only fields of the list item are used. */
export function formatNewEvent(p: NewEventPayload, titlePrefix = ""): Message {
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
      { name: "Starts", value: `<t:${unix(p.start)}:F> (<t:${unix(p.start)}:R>)` },
      { name: "Ends", value: `<t:${unix(p.end)}:F> (<t:${unix(p.end)}:R>)` },
    ],
  };
  // The site's own link preview for a boss uses this same picture (og.ts); races have none in the list.
  if (p.bossTypeURL?.startsWith("https://")) embed.thumbnail = { url: p.bossTypeURL };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

const FORMATTERS: Record<Trigger, (payload: NewEventPayload) => Message> = {
  "new-event": (p) => formatNewEvent(p),
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
            kind, id: it.id, name: str(it.name), bossType: str(it.bossType), bossTypeURL: str(it.bossTypeURL), start: it.start, end: it.end,
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
/** Discord asked us to wait (429): nothing is sent before this time. */
let holdUntil = 0;

export function resetNotifyState(): void {
  mayHaveUnsent = true;
  holdUntil = 0;
}
export const markUnsent = () => {
  mayHaveUnsent = true;
};
export const outboxMayHaveUnsent = (deps: Deps) => mayHaveUnsent && RULES.some((r) => CHANNELS[r.channel](deps));

/** Send unsent rows (≤ 24 h old, < 5 attempts). Never throws; failures are recorded on the row. */
export async function flushOutbox(deps: Deps): Promise<void> {
  try {
    const now = deps.now();
    if (now < holdUntil) return;
    const { results } = await deps.db
      .prepare("SELECT key, rule, payload, attempts FROM notifications WHERE sent_at IS NULL AND attempts < ? AND created_at > ? ORDER BY created_at LIMIT 10")
      .bind(MAX_ATTEMPTS, now - MAX_AGE_MS)
      .all<{ key: string; rule: string; payload: string; attempts: number }>();
    mayHaveUnsent = false;
    for (const row of results) {
      const rule = RULES.find((r) => r.id === row.rule);
      const channel = rule && CHANNELS[rule.channel](deps);
      if (!rule || !channel) continue; // unconfigured now: stays queued until it expires
      // Claim the attempt first, so two isolates never send the same row.
      const claim = (await deps.db
        .prepare("UPDATE notifications SET attempts = attempts + 1 WHERE key = ? AND sent_at IS NULL AND attempts = ?")
        .bind(row.key, row.attempts)
        .run()) as { meta?: { changes?: number } };
      if (claim?.meta?.changes === 0) continue;
      let result: SendResult;
      try {
        result = await channel.send(FORMATTERS[rule.trigger](JSON.parse(row.payload) as NewEventPayload));
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
        holdUntil = deps.now() + result.retryAfter;
        return;
      }
    }
    if (results.length === 10) mayHaveUnsent = true;
  } catch (err) {
    mayHaveUnsent = true;
    console.warn("notify: outbox flush failed", String(err));
  }
}
