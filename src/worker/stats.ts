// GET /api/stats — the hidden /stats page's data: Cloudflare Web Analytics (RUM) numbers for this site, read from
// the GraphQL Analytics API with a Worker secret. One GraphQL request, shaped here into a small JSON; cached in the
// isolate and by the browser/edge for 15 minutes. No D1, no KV. Never echoes the token.
//
// Dataset: viewer.accounts(filter:{accountTag}).rumPageloadEventsAdaptiveGroups — `count` is page views,
// `sum { visits }` is visits (sessions); dimensions date / requestPath / refererHost / countryName / deviceType;
// filter datetime_geq / datetime_leq / requestHost_in; orderBy count_DESC.
// The 7/30-day totals are sums of the daily series (separate GraphQL groups are sampled separately and disagreed).
// The ranked lists come per day (date + dimension), so the page filters any day or range without another request.
// (Cloudflare Web Analytics GraphQL; see https://developers.cloudflare.com/analytics/graphql-api/.)

import { jsonResponse } from "./proxy.ts";

export const STATS_HOST = "btd6data.com";
// ponytail: the site moved here on 2026-10-07; drop the old host once its 30 days have rolled off (2026-11-07).
const STATS_HOSTS = [STATS_HOST, "btd6-opendata.btd6-opendata-site.workers.dev"];
export const STATS_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
export const STATS_TTL_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

export interface StatsConfig {
  token?: string;
  accountId?: string;
  /** Overridable for the offline e2e (a fixture origin). */
  graphqlUrl: string;
}

export interface RankRow {
  name: string;
  views: number;
  visits: number;
}
export interface DayRow extends RankRow {
  date: string;
}
export interface Stats {
  generatedAt: string;
  host: string;
  totals: { d7: { views: number; visits: number }; d30: { views: number; visits: number } };
  /** One row per UTC day, oldest first, the last 30 days (zero-filled). */
  daily: { date: string; views: number; visits: number }[];
  /** Per (day, name), the page ranks and sums them over the chosen days. Referrers leave out this site's own hosts. */
  pages: DayRow[];
  referrers: DayRow[];
  countries: DayRow[];
  devices: DayRow[];
}

// ponytail: 5000 (day, name) groups; a busier site would need fewer days per query or a top-N per day.
const GROUP = "limit: 5000, orderBy: [count_DESC]";
/** Filters are inlined (built only from our own constants and numbers), so no input-type names are needed. */
const filterOf = (hosts: string[], from: string, to: string) =>
  `{ requestHost_in: ${JSON.stringify(hosts)}, datetime_geq: "${from}", datetime_leq: "${to}" }`;
export function statsQuery(account: string, f30: string): string {
  const g = (alias: string, args: string, f: string, dim?: string) =>
    `${alias}: rumPageloadEventsAdaptiveGroups(${args}, filter: ${f}) { count sum { visits }${dim ? ` dimensions { ${dim} }` : ""} }`;
  return `{ viewer { accounts(filter: { accountTag: "${account}" }) {
    ${g("daily", "limit: 40, orderBy: [date_ASC]", f30, "date")}
    ${g("pages", GROUP, f30, "date requestPath")}
    ${g("referrers", GROUP, f30, "date refererHost")}
    ${g("countries", GROUP, f30, "date countryName")}
    ${g("devices", GROUP, f30, "date deviceType")}
  } } }`;
}

interface Group {
  count?: number;
  sum?: { visits?: number };
  dimensions?: Record<string, string | null>;
}
export interface GraphqlResponse {
  data?: { viewer?: { accounts?: Record<string, Group[]>[] } } | null;
  errors?: { message: string }[] | null;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const sumDays = (rows: { views: number; visits: number }[]) => ({ views: rows.reduce((s, d) => s + d.views, 0), visits: rows.reduce((s, d) => s + d.visits, 0) });
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Pure: GraphQL response → Stats. `now` anchors the zero-filled 30-day series. */
export function shapeStats(res: GraphqlResponse, now: number): Stats {
  const acct = res.data?.viewer?.accounts?.[0] ?? {};
  const rank = (rows: Group[] = [], dim: string): DayRow[] =>
    rows
      .filter((g) => g.dimensions?.date)
      .map((g) => ({ date: g.dimensions!.date!, name: g.dimensions?.[dim] ?? "", views: n(g.count), visits: n(g.sum?.visits) }))
      .sort((a, b) => b.views - a.views);
  const byDate = new Map<string, { views: number; visits: number }>();
  for (const g of acct.daily ?? []) {
    const d = g.dimensions?.date;
    if (d) byDate.set(d, { views: n(g.count), visits: n(g.sum?.visits) });
  }
  const daily = Array.from({ length: 30 }, (_, i) => {
    const date = ymd(now - (29 - i) * DAY_MS);
    return { date, ...(byDate.get(date) ?? { views: 0, visits: 0 }) };
  });
  return {
    generatedAt: new Date(now).toISOString(),
    host: STATS_HOST,
    totals: { d7: sumDays(daily.slice(-7)), d30: sumDays(daily) },
    daily,
    pages: rank(acct.pages, "requestPath"),
    referrers: rank(acct.referrers, "refererHost").filter((r) => !STATS_HOSTS.includes(r.name)), // in-site clicks
    countries: rank(acct.countries, "countryName"),
    devices: rank(acct.devices, "deviceType"),
  };
}

let memo: { at: number; json: string } | undefined;
export const resetStatsMemo = () => {
  memo = undefined;
};

const HEADERS = { "X-Robots-Tag": "noindex, nofollow" };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  jsonResponse(JSON.stringify({ success: false, error, ...extra }), status, "no-store", HEADERS);

export async function handleStats(cfg: StatsConfig, fetchFn: typeof fetch, now: number): Promise<Response> {
  if (!cfg.token || !cfg.accountId) return fail(503, "not-configured");
  const cc = "public, max-age=900";
  if (memo && now - memo.at < STATS_TTL_MS) return jsonResponse(memo.json, 200, cc, HEADERS);
  const iso = (ms: number) => new Date(ms).toISOString();
  const day0 = Math.floor(now / DAY_MS) * DAY_MS; // UTC midnight: the daily buckets are whole days
  const f30 = filterOf(STATS_HOSTS, iso(day0 - 29 * DAY_MS), iso(now));
  if (!/^[0-9a-f]{32}$/.test(cfg.accountId)) return fail(503, "not-configured");
  let res: Response;
  try {
    res = await fetchFn(cfg.graphqlUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: statsQuery(cfg.accountId, f30) }),
    });
  } catch {
    return fail(502, "Could not reach Cloudflare analytics");
  }
  let body: GraphqlResponse;
  try {
    body = (await res.json()) as GraphqlResponse;
  } catch {
    return fail(502, `Cloudflare analytics answered HTTP ${res.status}`);
  }
  if (!res.ok || body.errors?.length) {
    const msg = (body.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    return fail(502, msg.split(cfg.token).join("***").slice(0, 300));
  }
  const json = JSON.stringify({ success: true, body: shapeStats(body, now) });
  memo = { at: now, json };
  return jsonResponse(json, 200, cc, HEADERS);
}

