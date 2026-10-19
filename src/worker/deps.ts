// Narrow interfaces over the Cloudflare bindings the worker uses, so the caching logic runs unchanged
// in workerd (real KV/D1) and in Node tests (Map-backed KV, node:sqlite-backed D1).

import type { OriginLimits } from "./limit.ts";
import type { StatsConfig } from "./stats.ts";

export interface KVLike {
  get(key: string, options: { type: "text"; cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}

export interface Deps {
  kv: KVLike;
  db: D1Like;
  fetch: typeof fetch;
  now: () => number;
  /** Background work that must outlive the response (ctx.waitUntil). */
  waitUntil: (p: Promise<unknown>) => void;
  /** Upstream base URL; overridable for local dev against a fixture server. */
  nkBase: string;
  /** Origin-fetch budgets for requests (limit.ts). Crons don't use them. */
  limits: OriginLimits;
  /** Cloudflare analytics access for /api/stats (stats.ts); absent in tests unless set. */
  stats?: StatsConfig;
  /** Notification channels (notify.ts); a channel without its secret is skipped. */
  notify?: { discordWebhookUrl?: string; indexNowKey?: string; browserToken?: string; accountId?: string };
  /** Suggestions box (suggest.ts): its own private channel; unset → rows are stored, nothing is posted. */
  suggest?: { webhookUrl?: string };
}

export const NK_BASE = "https://data.ninjakiwi.com";
