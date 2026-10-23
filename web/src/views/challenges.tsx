// Challenges: the daily challenges (standard, advanced, co-op) and NK's newest / trending player challenges.
// One NK feed request per list page. Each card's challenge document (map, win rate, rules) is fetched only once the
// card has been on screen for a moment (nav.ts treats /challenge/ links like leaderboard rows), so a 25-card page
// never fans out into 25 upstream requests by itself. Search is local: it never calls NK while typing.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ChallengeDocument, ChallengeSummary, UserProfile } from "../../../src/nk/types.ts";
import {
  dailyAuthor,
  dailyInfo,
  dailyNeighbour,
  dailyStart,
  dailyTitle,
  fmtCompact,
  fmtDay,
  fmtInt,
  fmtPct,
  fmtRounds,
  mapName,
} from "../format.ts";
import { Freshness } from "../fresh.tsx";
import { navigate, store } from "../nav.ts";
import { CHALLENGE_FILTERS, CHALLENGE_LABEL, challengeKey, challengeListKey, DAILY_KEY, href, idFromUrl, userKey, type ChallengeFilter } from "../routes.ts";
import { dayBadge, matchesText, olderDaily, ruleChipData, searchTargets, splitDaily, type Kind, type Series } from "../challenges.ts";
import { MapArt, MODE_NAME, Spr } from "../sprite.tsx";
import { A, body, Bug, EvIcon, Gate, peek, Section, Tabs } from "../ui.tsx";

const BLURB: Record<ChallengeFilter, string> = {
  daily: "A new standard and advanced challenge every day, plus the co-op daily. Open one for its full rules and win rate.",
  newest: "The latest challenges players have published in the game's challenge browser.",
  trending: "Player challenges getting the most plays right now.",
};
const FIRST_FACT = 1; // lines[0] is the blurb (see ChallengesPage), the facts follow
const PAGE_SIZE = 25; // NK's page size for the newest / trending feeds

const NOW_LABEL = { standard: "Standard", advanced: "Advanced", coop: "Co-op" } as const;

const media = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
const docOf = (id: string) => body<ChallengeDocument>(challengeKey(id));

const winRate = (d: ChallengeDocument | undefined) => (d?.playsUnique ? d.winsUnique / d.playsUnique : null);

/** The unusual mode (Standard is the norm) else the unusual difficulty (Medium is the norm), as a game key. */
const modeKey = (d: ChallengeDocument) => (d.mode !== "Standard" ? d.mode : d.difficulty !== "Medium" ? d.difficulty : null);
const modeText = (k: string) => MODE_NAME[k] ?? k;

/** Subtitle lines made from what is already in memory (live dailies' documents / the page's cards). */
function factLines(filter: ChallengeFilter, list: ChallengeSummary[], series: Series[]): string[] {
  const out: string[] = [];
  if (filter === "daily") {
    const hard: [string, number][] = [];
    for (const s of series) {
      const d = s.cur && docOf(s.cur.id);
      if (!s.cur || !d) continue;
      const t = dailyTitle(s.cur.id)!;
      const rate = winRate(d);
      if (rate !== null) hard.push([t, rate]);
      out.push(
        s.kind === "advanced"
          ? `${t}: rounds ${fmtRounds(d.startRound, d.endRound)} with $${fmtInt(d.startingCash)}`
          : `${t} on ${mapName(d.map)}${rate !== null ? ` · ${fmtPct(rate)} of ${fmtCompact(d.playsUnique)} players won` : ""}`,
      );
    }
    if (hard.length > 1) {
      const [t, r] = hard.sort((a, b) => a[1] - b[1])[0];
      out.push(`Hardest today: ${t} · ${fmtPct(r)} won`);
    }
  } else {
    let top: [string, number] | undefined;
    for (const c of list) {
      const d = docOf(c.id);
      if (d && (!top || d.plays > top[1])) top = [c.name, d.plays];
    }
    if (top) out.push(`Most played on this page: ${top[0]} · ${fmtCompact(top[1])} plays`);
  }
  return out;
}

/** Changing subtitle: all lines stacked in one grid cell (the tallest sets the height), one visible at a time. */
function Sub(props: { lines: string[] }) {
  const { lines } = props;
  const still = media("(prefers-reduced-motion: reduce)");
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still || lines.length < 2) return;
    const t = setInterval(() => setI((x) => x + 1), 6000);
    return () => clearInterval(t);
  }, [still, lines.length]);
  const cur = still ? Math.min(FIRST_FACT, lines.length - 1) : i % lines.length; // still: the first fact, else the blurb
  return (
    <div class="chl-sub">
      <span class="chl-sub-l">
        {lines.map((l, n) => (
          <span key={n} class={n === cur ? "on" : undefined} aria-hidden={n === cur ? undefined : "true"}>
            {l}
          </span>
        ))}
      </span>
      {lines.length > 1 && !still && (
        <span class="chl-ticks" aria-hidden="true">
          {lines.map((_, n) => (
            <i key={n} class={n === cur ? "on" : undefined} />
          ))}
        </span>
      )}
    </div>
  );
}

/** What the search text can open directly: a challenge code, a daily id, or a daily number (both series). */
function suggestions(raw: string, daily: ChallengeSummary[] | undefined): Sugg[] {
  return searchTargets(raw, daily).map((t) => ({
    href: href.challenge(t.id),
    daily: t.daily,
    text: t.code ? <>Open challenge <b class="mono">{t.code}</b></> : <>Open {dailyTitle(t.id)}</>,
  }));
}

type Sugg = { href: string; text: ComponentChildren; daily?: boolean };

export function ChallengesPage(props: { filter: ChallengeFilter; p: number }) {
  const key = challengeListKey(props.filter, props.p);
  const list = body<ChallengeSummary[]>(key);
  const feed = props.filter === "daily" ? list : body<ChallengeSummary[]>(DAILY_KEY);
  const next = !!peek(key)?.data?.next;
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setQ(""), [key]);
  // "/" focuses the search unless the reader is typing somewhere (the rounds page binds it on its own route).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  const now = Date.now();
  const series = props.filter === "daily" && list ? splitDaily(list, now) : [];
  const lines = [BLURB[props.filter], ...(list ? factLines(props.filter, list, series) : [])];
  const raw = q.trim();
  const sugg = raw ? suggestions(raw, feed) : [];
  const needle = /^#?\d+$/.test(raw) ? "" : raw.toLowerCase(); // numbers open dailies; they don't filter
  const older = props.filter === "daily" ? olderDaily(series) : undefined;
  const olderHref =
    props.filter === "daily"
      ? older && href.challenge(older)
      : next
        ? href.challenges(props.filter, props.p + 1)
        : undefined;
  const lists = { needle, clear: () => setQ(""), older: olderHref };
  return (
    <>
      <header class="page-h">
        <h1 class="title ti">
          <EvIcon k="daily" size={64} />
          Challenges
        </h1>
        <Sub lines={lines} />
        <Freshness k={key} />
      </header>
      <div class="chl-bar">
        <Tabs
          label="Challenge lists"
          items={CHALLENGE_FILTERS.map((f) => ({
            href: href.challenges(f),
            label: CHALLENGE_LABEL[f],
            current: f === props.filter,
          }))}
        />
        <label class="chl-search">
          <Spr family="ui" k="Search" size={24} label />
          <input
            ref={input}
            type="text"
            value={q}
            autocomplete="off"
            spellcheck={false}
            aria-label="Search challenges"
            aria-keyshortcuts="/"
            placeholder={media("(max-width: 560px)") ? "Search, or paste a code" : "Search this page, or paste a code / daily number"}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              else if (e.key === "Enter" && sugg[0]) navigate(sugg[0].href);
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </label>
      </div>
      {sugg.length > 0 && (
        <div class="chl-drop">
          {sugg.map((s, n) => (
            <A key={s.href} href={s.href} class="chl-sg" watch={false}>
              {s.daily ? <EvIcon k="daily" size={24} /> : <Spr family="ui" k="Search" size={24} label />}
              <span>{s.text}</span>
              {n === 0 && <small>Enter</small>}
            </A>
          ))}
        </div>
      )}
      {!list ? (
        <Gate k={key} rows={8} />
      ) : props.filter === "daily" ? (
        <DailyLists series={series} now={now} {...lists} />
      ) : (
        <section class="chl-series">
          <BrowseGrid list={list} filter={props.filter} p={props.p} {...lists} />
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

type Lists = { needle: string; clear: () => void; older?: string };

/** Does the card match the search: challenge name, creator, or map (the map only once its document is in). */
function matches(c: ChallengeSummary, needle: string): boolean {
  const cid = c.creator ? idFromUrl(c.creator) : null;
  const who = dailyAuthor(c.name) ?? (cid ? body<UserProfile>(userKey(cid))?.displayName : "") ?? "";
  const d = docOf(c.id);
  return matchesText([c.name, who, d ? mapName(d.map) : ""], needle);
}

/** "N of M on this page match", or the empty card when none does. */
function MatchNote(props: { n: number; m: number } & Lists) {
  if (props.n)
    return (
      <p class="chl-count quiet" role="status">
        {props.n} of {props.m} on this page match
      </p>
    );
  return (
    <div class="chl-empty" role="status">
      <Spr family="bloon" k="red" size={56} label />
      <strong>Nothing called "{props.needle}" here</strong>
      <p class="quiet">Search looks at the challenges on this page.</p>
      <div class="chl-btns">
        <button type="button" class="chl-btn fill" onClick={props.clear}>
          Clear search
        </button>
        {props.older && (
          <A href={props.older} class="chl-btn">
            Older page ›
          </A>
        )}
      </div>
    </div>
  );
}

function DailyLists(props: { series: Series[]; now: number } & Lists) {
  const { now, needle } = props;
  const cur = props.series.flatMap((s) => (s.cur ? [s.cur] : []));
  // The cards show each live daily's map and win rate: their documents load with the page (3 cached requests).
  useEffect(() => void store.want(cur.map((c) => challengeKey(c.id))), [cur.map((c) => c.id).join()]);
  const total = props.series.reduce((n, s) => n + (s.cur ? 1 : 0) + s.items.length, 0);
  const keep = (c: ChallengeSummary) => !needle || matches(c, needle);
  const shown = props.series.map((s) => ({ ...s, cur: s.cur && keep(s.cur) ? s.cur : undefined, items: s.items.filter(keep) }));
  const n = shown.reduce((k, s) => k + (s.cur ? 1 : 0) + s.items.length, 0);
  return (
    <div class="chl-series">
      {needle && <MatchNote n={n} m={total} {...props} />}
      {shown.some((s) => s.cur) && (
        <section class="chl-now" aria-labelledby="chl-now-h">
          <h2 class="kicker-h" id="chl-now-h">
            Live now
          </h2>
          <ul class="chl-lives">
            {shown.map((s) => s.cur && <LiveDaily key={s.kind} c={s.cur} kind={s.kind} />)}
          </ul>
        </section>
      )}
      {shown.map(({ kind, label, items }) => {
        if (!items.length) return null;
        const older = kind !== "coop" && !needle ? dailyNeighbour(items[items.length - 1].id, -1) : null;
        return (
          <Section
            key={kind}
            title={
              <span class="ti">
                <EvIcon k="daily" size={28} />
                {label}
              </span>
            }>
            <ul class="chl-grid">
              {items.map((c) => (
                <ChallengeCard key={c.id} c={c} kind={kind} badge={kind !== "coop" ? dayBadge(c.id, now) : undefined} />
              ))}
              {older && (
                <li class="chl-oldli">
                  <A href={href.challenge(older)} class="chl-older">
                    <b aria-hidden="true">←</b>
                    <span>Older dailies</span>
                    <small>from {dailyTitle(older)}</small>
                  </A>
                </li>
              )}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}

function BrowseGrid(props: { list: ChallengeSummary[]; filter: ChallengeFilter; p: number } & Lists) {
  const { needle } = props;
  const rows = props.list.map((c, i) => ({ c, rank: (props.p - 1) * PAGE_SIZE + i + 1 })).filter((r) => !needle || matches(r.c, needle));
  if (!props.list.length) return <p class="quiet">No more challenges in this list.</p>;
  return (
    <>
      {needle && <MatchNote n={rows.length} m={props.list.length} {...props} />}
      <ul class="chl-grid">
        {rows.map((r) => (
          <ChallengeCard key={r.c.id} c={r.c} kind="player" rank={props.filter === "trending" ? r.rank : undefined} />
        ))}
      </ul>
    </>
  );
}

// ─────────────────────────────── rule chips + shared bits

const Chip = (p: { icon: ComponentChildren; children: ComponentChildren }) => (
  <span class="chl-chip">
    {p.icon}
    {p.children}
  </span>
);
const ui = (k: string) => <Spr family="ui" k={k} size={24} label optional />;

/** Rules worth a chip, only when unusual and only from the document: hero lock, tower cap, 1 life, no powers. */
const ruleChips = (d: ChallengeDocument) =>
  ruleChipData(d).map((c) => (
    <Chip key={c.key} icon={<Spr family={c.family} k={c.icon} size={24} label optional />}>
      {c.text}
    </Chip>
  ));

/** Medal for an unusual mode / difficulty (top right of the art). */
const Medal = (p: { d?: ChallengeDocument }) => {
  const k = p.d && modeKey(p.d);
  return k ? (
    <span class="chl-medal">
      <Spr family="modeMedal" k={k} size={36} optional />
    </span>
  ) : null;
};

/** The art slot: the map once the document is in, else a series-tinted placeholder with the daily icon. */
function Art(props: { d?: ChallengeDocument; size: number; children?: ComponentChildren }) {
  const d = props.d;
  const hasMap = !!(d?.map || d?.mapURL);
  return (
    <span class={hasMap ? "chl-art" : "chl-art ph"}>
      {hasMap ? <MapArt map={d?.map} url={d?.mapURL} size={props.size} /> : <EvIcon k="daily" size={56} />}
      {props.children}
    </span>
  );
}

function WinBar(props: { d?: ChallengeDocument; players?: boolean }) {
  const d = props.d;
  const rate = winRate(d);
  return (
    <span class="chl-win">
      <span class="tr">{rate !== null && <i style={{ width: `${rate * 100}%` }} />}</span>
      <span class="tx">
        {!d ? (
          <span class="chl-sk w40" />
        ) : rate !== null ? (
          <>
            <b>{fmtPct(rate)}</b> {props.players ? `of ${fmtCompact(d.playsUnique)} players ` : ""}won
          </>
        ) : (
          "No plays yet"
        )}
      </span>
    </span>
  );
}

// ─────────────────────────────── cards

/** A live daily: the map as a banner, series colour on top, title, rules and win rate. The whole card is the link. */
function LiveDaily(props: { c: ChallengeSummary; kind: Kind }) {
  const { c, kind } = props;
  const d = docOf(c.id);
  const start = dailyStart(c.id);
  const author = dailyAuthor(c.name);
  const mk = d && modeKey(d);
  return (
    <li>
      <A href={href.challenge(c.id)} class={`chl-live k-${kind}`}>
        <Art d={d} size={400}>
          <span class="chl-bug">
            {start !== null ? (
              <Bug start={start} end={start + 86_400_000} />
            ) : (
              <span class="bug live">
                <span class="bug-s">Live</span>
              </span>
            )}
          </span>
          <Medal d={d} />
        </Art>
        <span class="chl-lbody">
          <span class="chl-ser">
            <EvIcon k="daily" size={24} />
            {NOW_LABEL[kind]}
          </span>
          <span class="chl-lt">{dailyTitle(c.id)}</span>
          <span class="chl-lm">
            {d ? (
              <>
                <b>{mapName(d.map)}</b>
                {mk && ` · ${modeText(mk)}`}
                {author && ` · by ${author}`}
              </>
            ) : (
              <span class="chl-sk w60" />
            )}
          </span>
          <span class="chl-chips">
            {d && (
              <>
                <Chip icon={ui("StartRound")}>{d.startRound === d.endRound ? `Round ${d.startRound}` : `Rounds ${fmtRounds(d.startRound, d.endRound)}`}</Chip>
                <Chip icon={ui("StartingCash")}>${fmtInt(d.startingCash)}</Chip>
              </>
            )}
          </span>
          <WinBar d={d} players />
        </span>
      </A>
    </li>
  );
}

/** One challenge card; the list feed gives it size, number, creator and date, the document fills in the rest. */
function ChallengeCard(props: { c: ChallengeSummary; kind: Kind | "player"; badge?: string; rank?: number }) {
  const { c, kind } = props;
  const d = docOf(c.id);
  const daily = dailyTitle(c.id);
  const author = daily ? dailyAuthor(c.name) : null;
  const creatorId = c.creator ? idFromUrl(c.creator) : null;
  const creator = creatorId ? body<UserProfile>(userKey(creatorId)) : undefined;
  const info = dailyInfo(c.id);
  const plate = props.rank ? `#${props.rank}` : info?.n != null ? `#${info.n}` : null;
  const mk = d && modeKey(d);
  const title = daily ? (d ? mapName(d.map) : null) : c.name;
  // The title link is stretched over the card (CSS); the creator link sits above it, so no <a> nests in another.
  // The creator's profile loads on hover/tap only: a name on every card was one NK request per card.
  return (
    <li class={`chl-card k-${kind}`}>
      <Art d={d} size={200}>
        {plate && <span class={props.rank ? "chl-plate rank" : "chl-plate"}>{plate}</span>}
        <Medal d={d} />
        {props.badge && <span class="chl-flag">{props.badge}</span>}
      </Art>
      <span class="chl-cb">
        <A href={href.challenge(c.id)} class="chl-t" label={daily ?? c.name}>
          {title ?? <span class="chl-sk w80" />}
        </A>
        {!daily && <span class="chl-sub2">{d ? [mapName(d.map), mk && modeText(mk)].filter(Boolean).join(" · ") : <span class="chl-sk w60" />}</span>}
        {daily ? (
          <span class="chl-by">{author && <>by <b>{author}</b></>}</span>
        ) : creatorId ? (
          <A href={href.player(creatorId)} class="chl-by link" watch={false}>
            {creator ? (
              <>
                by <b>{creator.displayName}</b>
              </>
            ) : (
              "Creator's profile →"
            )}
          </A>
        ) : (
          <span class="chl-by" />
        )}
        <span class="chl-chips">{d && ruleChips(d).slice(0, 3)}</span>
        <WinBar d={d} players={!daily} />
        <span class="chl-foot">
          {daily ? (
            <>
              <span>{fmtDay(c.createdAt)}</span>
              <span>{mk && modeText(mk)}</span>
            </>
          ) : (
            <>
              <span class="mono">{c.id}</span>
              <span>{d && `${fmtCompact(d.upvotes)} upvotes`}</span>
            </>
          )}
        </span>
      </span>
    </li>
  );
}
