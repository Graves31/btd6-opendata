// Challenges: the daily challenges (standard, advanced, co-op) and NK's newest / trending player challenges.
// One NK feed request per list page. Each row's challenge document (map, win rate) is fetched only once the row
// has been on screen for a moment (nav.ts treats /challenge/ links like leaderboard rows), so a 25-row page
// never fans out into 25 upstream requests by itself.

import type { ChallengeDocument, ChallengeSummary, UserProfile } from "../../../src/nk/types.ts";
import { dailyAuthor, dailyInfo, dailyIsOut, dailyNeighbour, dailyStart, dailyTitle, fmtDay, fmtPct, mapName } from "../format.ts";
import { Freshness } from "../fresh.tsx";
import { useEffect } from "preact/hooks";
import { store } from "../nav.ts";
import { challengeKey, challengeListKey, href, idFromUrl, userKey, type ChallengeFilter } from "../routes.ts";
import { MapArt } from "../sprite.tsx";
import { A, body, EvIcon, Gate, peek, Section, Tabs } from "../ui.tsx";
import { DailyTile } from "./events.tsx";

const CHALLENGE_FILTERS: readonly ChallengeFilter[] = ["daily", "newest", "trending"];
const TITLE: Record<ChallengeFilter, string> = { daily: "Daily challenges", newest: "Newest challenges", trending: "Trending challenges" };
const BLURB: Record<ChallengeFilter, string> = {
  daily: "A new standard and advanced challenge every day, plus the co-op daily. Open one for its full rules and win rate.",
  newest: "The latest challenges players have published in the game's challenge browser.",
  trending: "Player challenges getting the most plays right now.",
};

export function ChallengesPage(props: { filter: ChallengeFilter; p: number }) {
  const key = challengeListKey(props.filter, props.p);
  const list = body<ChallengeSummary[]>(key);
  const next = !!peek(key)?.data?.next;
  return (
    <>
      <header class="page-h">
        <p class="eyebrow">Challenges</p>
        <h1 class="title ti">
          {props.filter === "daily" && <EvIcon k="daily" size={64} />}
          {TITLE[props.filter]}
        </h1>
        <p class="lede">{BLURB[props.filter]}</p>
        <Freshness k={key} />
      </header>
      <Tabs
        label="Challenge lists"
        items={CHALLENGE_FILTERS.map((f) => ({
          href: href.challenges(f),
          label: f === "daily" ? "Daily" : f === "newest" ? "Newest" : "Trending",
          current: f === props.filter,
        }))}
      />
      {!list ? (
        <Gate k={key} rows={8} />
      ) : props.filter === "daily" ? (
        <DailyLists list={list} />
      ) : (
        <section class="chl-sec">
          {list.length ? (
            <ul class="chl">
              {list.map((c) => (
                <ChallengeRow key={c.id} c={c} />
              ))}
            </ul>
          ) : (
            <p class="quiet">No more challenges in this list.</p>
          )}
          <nav class="chl-pager" aria-label="Pages">
            {props.p > 1 ? (
              <A href={href.challenges(props.filter, props.p - 1)} class="chl-pg" toSection>
                ‹ Newer
              </A>
            ) : (
              <span />
            )}
            <span class="quiet">Page {props.p}</span>
            {next && list.length ? (
              <A href={href.challenges(props.filter, props.p + 1)} class="chl-pg" toSection>
                Older ›
              </A>
            ) : (
              <span />
            )}
          </nav>
        </section>
      )}
    </>
  );
}

const SERIES: [NonNullable<ReturnType<typeof dailyInfo>>["kind"], string][] = [
  ["standard", "Daily"],
  ["advanced", "Advanced daily"],
  ["coop", "Co-op daily"],
];

const hm = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** "Today" for the daily live in game now, "Starts 10:00" (viewer's time) for the next one, else nothing. */
function dayBadge(id: string, now: number): string | undefined {
  const s = dailyStart(id);
  if (s === null) return undefined;
  if (now >= s) return now < s + 86_400_000 ? "Today" : undefined;
  return s - now <= 86_400_000 ? `Starts ${hm.format(s)}` : undefined;
}

const ICON = { standard: "daily", advanced: "dailyAdvanced", coop: "dailyCoop" } as const;
const NOW_LABEL = { standard: "Standard", advanced: "Advanced", coop: "Co-op" } as const;

function DailyLists(props: { list: ChallengeSummary[] }) {
  const now = Date.now();
  // Per series: the daily live in game now (co-op: the newest), shown on the card up top; the rest listed below.
  const series = SERIES.map(([kind, label]) => {
    const all = props.list
      .filter((c) => dailyInfo(c.id)?.kind === kind && (kind !== "coop" || c.createdAt <= now + 3_600_000))
      .sort((a, b) => b.createdAt - a.createdAt);
    const cur = all.find((c) => dailyIsOut(c.id, now)); // newest started = the one in game now
    return { kind, label, cur, items: all.filter((c) => c !== cur) };
  });
  const cur = series.flatMap((s) => (s.cur ? [s.cur] : []));
  // The card shows each live daily's map and win rate: their documents load with the page (3 cached requests).
  useEffect(() => void store.want(cur.map((c) => challengeKey(c.id))), [cur.map((c) => c.id).join()]);
  return (
    <div class="chl-series">
      {cur.length > 0 && (
        <section class="chl-now" aria-labelledby="chl-now-h">
          <h2 class="kicker-h" id="chl-now-h">
            Live now
          </h2>
          <div class="chl-now-tiles">
            {series.map(
              (s) => s.cur && <DailyTile key={s.kind} id={s.cur.id} name={s.cur.name} icon={ICON[s.kind]} eyebrow={NOW_LABEL[s.kind]} />,
            )}
          </div>
        </section>
      )}
      {series.map(({ kind, label, items }) => {
        if (!items.length) return null;
        const oldest = items[items.length - 1];
        const older = kind !== "coop" ? dailyNeighbour(oldest.id, -1) : null;
        return (
          <Section
            key={kind}
            title={
              <span class="ti">
                <EvIcon k={kind === "standard" ? "daily" : kind === "advanced" ? "dailyAdvanced" : "dailyCoop"} size={28} />
                {label}
              </span>
            }
            aside={older ? <A href={href.challenge(older)}>Older: {dailyTitle(older)} →</A> : undefined}>
            <ul class="chl">
              {items.map((c) => (
                <ChallengeRow key={c.id} c={c} badge={kind !== "coop" ? dayBadge(c.id, now) : undefined} />
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}

/** One challenge: map, title, who made it, date; map/difficulty/win rate once its document is in memory. */
function ChallengeRow(props: { c: ChallengeSummary; badge?: string }) {
  const { c } = props;
  const doc = body<ChallengeDocument>(`/btd6/challenges/challenge/${c.id}`);
  const daily = dailyTitle(c.id);
  const author = daily ? dailyAuthor(c.name) : null;
  const creatorId = c.creator ? idFromUrl(c.creator) : null;
  const creator = creatorId ? body<UserProfile>(userKey(creatorId)) : undefined;
  const hasMap = !!(doc?.map || doc?.mapURL);
  const rate = doc?.playsUnique ? doc.winsUnique / doc.playsUnique : null;
  return (
    <li class="chl-item">
      <A href={href.challenge(c.id)} class={hasMap ? "chl-row" : "chl-row nomap"}>
        {hasMap && (
          <span class="chl-map">
            <MapArt framed map={doc?.map} url={doc?.mapURL} size={64} />
          </span>
        )}
        <span class="chl-main">
          <span class="chl-title">
            {daily ? daily : <span class="uname">{c.name}</span>}
            {props.badge && <span class="chl-new">{props.badge}</span>}
          </span>
          {author && (
            <span class="chl-by">
              by <span class="uname">{author}</span>
            </span>
          )}
          <span class="chl-meta">
            {doc ? (
              <>
                <span>{mapName(doc.map)}</span>
                <span>{doc.difficulty}</span>
                {rate !== null && <span>{fmtPct(rate)} won</span>}
              </>
            ) : null}
            <span class="quiet">{fmtDay(c.createdAt)}</span>
            {!daily && <span class="chl-code mono">{c.id}</span>}
          </span>
        </span>
      </A>
      {creatorId && (
        <A href={href.player(creatorId)} class="chl-creator">
          {creator ? (
            <>
              by <span class="uname">{creator.displayName}</span>
            </>
          ) : (
            "Creator's profile →"
          )}
        </A>
      )}
    </li>
  );
}
