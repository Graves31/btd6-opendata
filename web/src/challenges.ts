// Challenge-list logic with no UI: grouping the dailies, prev/next daily, day badges, search targets, rule chips.
// views/challenges.tsx and views/people.tsx render it.

import type { ChallengeDocument, ChallengeSummary } from "../../src/nk/types.ts";
import { dailyInfo, dailyIsOut, dailyNeighbour, dailyStart, plain, unitName } from "./format.ts";
import { heroRule, TOWER_ORDER } from "./roster.ts";

export type Kind = NonNullable<ReturnType<typeof dailyInfo>>["kind"];
export type Series = { kind: Kind; label: string; cur?: ChallengeSummary; items: ChallengeSummary[] };

export const SERIES: [Kind, string][] = [
  ["standard", "Daily"],
  ["advanced", "Advanced daily"],
  ["coop", "Co-op daily"],
];

/**
 * Per series: the daily live in game now (co-op: the newest), shown big up top; the rest listed below.
 * Co-op ids carry no date: a co-op daily is listed from 1 h before its createdAt (the list page's own slack;
 * dailyNeighbours below is stricter on purpose, to keep each page's behaviour as it was).
 */
export function splitDaily(list: ChallengeSummary[], now: number): Series[] {
  return SERIES.map(([kind, label]) => {
    const all = list
      .filter((c) => dailyInfo(c.id)?.kind === kind && (kind !== "coop" || c.createdAt <= now + 3_600_000))
      .sort((a, b) => b.createdAt - a.createdAt);
    const cur = all.find((c) => dailyIsOut(c.id, now)); // newest started = the one in game now
    return { kind, label, cur, items: all.filter((c) => c !== cur) };
  });
}

/** The daily the "Older dailies" button of the first series leads to (the day before its oldest listed card). */
export const olderDaily = (series: Series[]): string | undefined => {
  const s = series[0]?.items.at(-1);
  return (s && dailyNeighbour(s.id, -1)) || undefined;
};

/** "Today" for the daily live in game now, "Starts 10:00" (viewer's time) for the next one, else nothing. */
export function dayBadge(id: string, now: number, clock: (ms: number) => string = hm): string | undefined {
  const s = dailyStart(id);
  if (s === null) return undefined;
  if (now >= s) return now < s + 86_400_000 ? "Today" : undefined;
  return s - now <= 86_400_000 ? `Starts ${clock(s)}` : undefined;
}
const hmFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const hm = (ms: number) => hmFmt.format(ms);

/**
 * Previous / next daily of the same series on a challenge page. Numbered dailies are computed from the id (NK keeps
 * old ones); co-op dailies follow the order of the daily feed. `next` only once it has been published: it is in
 * the feed, or it is 2 h past its date's midnight UTC.
 */
export function dailyNeighbours(id: string, feed: ChallengeSummary[], now: number): { prev: string | null; next: string | null } {
  const info = dailyInfo(id);
  if (!info) return { prev: null, next: null };
  if (info.kind === "coop") {
    const coop = feed.filter((c) => dailyInfo(c.id)?.kind === "coop" && c.createdAt <= now).sort((x, y) => x.createdAt - y.createdAt);
    const i = coop.findIndex((c) => c.id === id);
    return i < 0 ? { prev: null, next: null } : { prev: coop[i - 1]?.id ?? null, next: coop[i + 1]?.id ?? null };
  }
  const prev = dailyNeighbour(id, -1);
  const next = dailyNeighbour(id, 1);
  const nextDay = next ? dailyInfo(next)?.day : null;
  const published = !!next && (feed.some((c) => c.id === next) || (nextDay != null && now >= nextDay + 2 * 3_600_000));
  return { prev, next: published ? next : null };
}

export type SearchTarget = { id: string; daily: boolean; code?: string };

/** What the search text can open directly: a daily id, a challenge code, or a daily number (both numbered series). */
export function searchTargets(raw: string, daily: ChallengeSummary[] | undefined): SearchTarget[] {
  const out: SearchTarget[] = [];
  const low = raw.toLowerCase();
  if (dailyInfo(low)) out.push({ id: low, daily: true });
  else if (/^[a-z]{7}$/i.test(raw)) out.push({ id: raw.toUpperCase(), daily: false, code: raw.toUpperCase() });
  const num = /^#?(\d{1,5})$/.exec(raw);
  if (num && daily) {
    for (const kind of ["standard", "advanced"] as const) {
      const known = daily.find((c) => dailyInfo(c.id)?.kind === kind && dailyInfo(c.id)?.n != null);
      const id = known && dailyNeighbour(known.id, Number(num[1]) - dailyInfo(known.id)!.n!);
      if (id && Number(num[1]) > 0) out.push({ id, daily: true });
    }
  }
  return out;
}

/** Does any of the texts contain the search text (accents and case ignored)? */
export const matchesText = (texts: string[], needle: string) => texts.some((s) => plain(s).includes(plain(needle)));

export type RuleChip = { key: "h" | "t" | "l" | "p"; family: "hero" | "ui"; icon: string; text: string };

/** Rules worth a chip, only when unusual and only from the document: hero lock, tower cap, 1 life, no powers. */
export function ruleChipData(d: ChallengeDocument): RuleChip[] {
  const out: RuleChip[] = [];
  const t = d._towers;
  if (t) {
    const { selected, allowed } = heroRule(t);
    if (!selected) {
      if (allowed.length === 1) out.push({ key: "h", family: "hero", icon: allowed[0], text: `${unitName(allowed[0])} only` });
      else if (!allowed.length) out.push({ key: "h", family: "hero", icon: "NoHero", text: "No hero" });
    }
    const n = t.filter((x) => !x.isHero && x.max !== 0).length;
    if (n < TOWER_ORDER.length) out.push({ key: "t", family: "ui", icon: "MaxTowers", text: `${n} / ${TOWER_ORDER.length} towers` });
  }
  if (d.lives === 1) out.push({ key: "l", family: "ui", icon: "StartingLives", text: "1 life" });
  if (d.disablePowers) out.push({ key: "p", family: "ui", icon: "PowersDisabled", text: "No powers" });
  return out;
}
