import { Fragment, type ComponentChildren } from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type {
  Boss,
  BossLeaderboardEntry,
  ChallengeDocument,
  CT,
  CTTeamEntry,
  NKEvent,
  Odyssey,
  OdysseyMetadata,
  Race,
  RaceLeaderboardEntry,
  ScorePart,
} from "../../../src/nk/types.ts";
import {
  bossName,
  bossNum,
  bossTitle,
  cap,
  dailyAuthor,
  dailyTitle,
  fmtCompact,
  dayMonUtc,
  fmtDate,
  fmtDay,
  fmtInt,
  fmtMs,
  fixParts,
  fmtPart,
  fmtPct,
  fmtReward,
  fmtRounds,
  fmtSpan,
  fmtWhen,
  human,
  mapName,
  partLabel,
  scoringShort,
  status,
} from "../format.ts";
import { rankBossRows, SUBMITTED } from "../boards.ts";
import { BOSS_HISTORY_FANDOM, BOSS_HISTORY_SOURCE } from "../data/bossHistory.ts";
import { RACE_HISTORY_SOURCE } from "../data/raceHistory.ts";
import { Freshness } from "../fresh.tsx";
import {
  BOARD_CAP,
  cutoffs,
  medalArt,
  medalName,
  medalTier,
  PAGE_SIZE,
  type Board,
  type Cutoff,
} from "../medals.ts";
import { eventGap, eventHistory, mapMetaKeys, type HistEvent } from "../maps.ts";
import { onRoute, store } from "../nav.ts";
import type { Envelope } from "../store.ts";
import { ctLeader, homePicks } from "../picks.ts";
import {
  bossBoardKey,
  BOSS_TYPES,
  bossMetaKey,
  challengeKey,
  ctKey,
  EVENTS_KEY,
  historyKey,
  href,
  idFromUrl,
  LIST_KEY,
  odyMapsKey,
  odyMetaKey,
  raceBoardKey,
  raceMetaKey,
  type BossDiff,
  type EventKind,
  type OdyDiff,
  type Route,
} from "../routes.ts";
import {
  Crew,
  hasBans,
  heroRule,
  HeroRule,
  HideBannedToggle,
  MapLine,
  modeIcon,
  PowerGrid,
  Ruleset,
  TowerRoster,
} from "../rules.tsx";
import { drawCard, ShareButton, type CardSpec } from "../share.tsx";
import { hasArt, MapArt, mapH, MODE_NAME, Spr } from "../sprite.tsx";
import {
  ApproxNote,
  JumpToRules,
  LinkRow,
  A,
  body,
  Bug,
  EndedBug,
  EvIcon,
  Fact,
  Gate,
  Img,
  Pager,
  PartHead,
  Parts,
  peek,
  Rank,
  Section,
  Stat,
  Submitted,
  Tabs,
  useFullRender,
  useTick,
  When,
} from "../ui.tsx";
import { errorKind, NotFound } from "./errors.tsx";

type AnyEvent = (Boss | Race | CT | Odyssey) & { archived?: boolean };

const EVENT_TYPE_LABEL: Record<string, string> = {
  bossBloon: "Boss event",
  bossRush: "Boss Rush",
  raceEvent: "Race",
  ct: "Contested Territory",
  odysseyEvent: "Odyssey",
  collectableEvent: "Collection event",
  socialseason: "Social season",
};

/** Schedule icon per event type: [family, key]. Boss events use their boss's portrait when known. */
const EVENT_ICON: Record<string, [string, string]> = {
  bossBloon: ["ui", "BossTier"],
  bossRush: ["ui", "BossTier"],
  raceEvent: ["ui", "Race"],
  ct: ["ui", "ContestedTerritory"],
  odysseyEvent: ["ui", "Odyssey"],
  collectableEvent: ["ui", "Collection"],
  socialseason: ["ui", "Trophy"],
};

const KIND_LABEL: Record<EventKind, string> = {
  boss: "Boss events",
  race: "Races",
  ct: "Contested Territory",
  odyssey: "Odysseys",
};
/** Lists with a lede (bosses have their stats strip; races explain themselves). */
const KIND_BLURB: Partial<Record<EventKind, string>> = {
  ct: "Teams claim hexagon tiles over a week. Players and teams are ranked separately.",
  odyssey:
    "A chain of islands with one boat crew. No leaderboards; clear it to collect the rewards.",
};

/** Event from NK's live list, else from our archive (events NK no longer lists). */
export function findEvent<T extends AnyEvent>(
  kind: EventKind,
  id: string,
): T | undefined {
  const live = body<T[]>(LIST_KEY[kind])?.find((e) => e.id === id);
  return live ?? body<T[]>(historyKey(kind))?.find((e) => e.id === id);
}

export function allEvents(kind: EventKind): AnyEvent[] {
  const seen = new Map<string, AnyEvent>();
  for (const e of body<AnyEvent[]>(historyKey(kind)) ?? []) seen.set(e.id, e);
  for (const e of body<AnyEvent[]>(LIST_KEY[kind]) ?? [])
    seen.set(e.id, { ...seen.get(e.id), ...e });
  return [...seen.values()].sort((a, b) => b.start - a.start);
}

export const eventHref = (kind: EventKind, id: string) =>
  kind === "boss"
    ? href.boss(id)
    : kind === "race"
      ? href.race(id)
      : kind === "ct"
        ? href.ct(id)
        : href.odyssey(id);

const EVENT_KIND: Record<string, EventKind> = {
  bossBloon: "boss",
  raceEvent: "race",
  ct: "ct",
  odysseyEvent: "odyssey",
};

/**
 * Boss display name from the list's bossType + the number in NK's name ("Dreadbloon #37"). Never NK's `name`
 * itself (misspelled at times: "Blastapopolous19"), never the id prefix (ids can be bare: "msi6n2qi").
 */
export const bossLabel = (b: Pick<Boss, "bossType" | "name">) =>
  bossTitle(b.bossType, bossNum(b.name));

/** Boss type for a boss event id, from the lists (not the id: bare ids have no prefix). For the page tint. */
export const bossTypeFor = (id: string): string | undefined =>
  findEvent<Boss>("boss", id)?.bossType;

/** Browser-tab title for a boss page: "Dreadbloon #37" once the lists know the id, else undefined. */
export const bossTitleFor = (id: string): string | undefined => {
  const b = findEvent<Boss>("boss", id);
  return b ? bossLabel(b) : undefined;
};

/** True when a key answered "no such id" (unknown event / group): the page shows NotFound instead of a shell. */
export function isMissing(...keys: string[]): boolean {
  return keys.some((k) => {
    const e = peek(k);
    if (!e || e.ok) return false;
    const msg = String(e.data?.error ?? "");
    return (
      msg !== "No Scores Available" &&
      errorKind({ message: msg, code: e.data?.code === undefined ? undefined : String(e.data.code) }) === "notfound"
    );
  });
}

export const ended = (e?: { end: number }) => !!e && e.end <= Date.now();

/** A medal sprite for a board's placement (nothing outside the brackets). */
export function Medal(p: {
  board: Board;
  rank: number;
  total?: number;
  size?: number;
}) {
  const tier = medalTier(p.board, p.rank, p.total);
  if (!tier) return null;
  return (
    <Spr
      family="eventMedal"
      k={medalArt(p.board, tier)}
      size={p.size ?? 24}
      name={`${medalName(p.board, tier)} medal`}
    />
  );
}

/** The score part that tells the story for a scoring type (cash for Least Cash, time for Fastest Time). */
function keyPart(raw: ScorePart[], scoring?: string): ScorePart | undefined {
  const parts = fixParts(raw, scoring);
  const want =
    scoring === "LeastCash"
      ? "Least Cash"
      : scoring === "LeastTiers"
        ? "Least Tiers"
        : scoring === "GameTime"
          ? "Game Time"
          : "";
  return parts.find((p) => p.name === want) ?? parts[parts.length > 1 ? 1 : 0];
}

// ─────────────────────────────── home

export function Home() {
  const p = homePicks(body, store.featured);
  const events = body<NKEvent[]>(EVENTS_KEY);
  if (!p.boss && !p.race) {
    // No pickable boss or race: a Gate for whichever list hasn't arrived (loading / error / retry), else an empty state.
    const missing = !peek(LIST_KEY.boss)?.ok
      ? LIST_KEY.boss
      : !peek(LIST_KEY.race)?.ok
        ? LIST_KEY.race
        : undefined;
    return missing ? (
      <Gate k={missing} rows={8} />
    ) : (
      <div class="empty">
        <p class="empty-t">Nothing scheduled right now</p>
        <p>
          No boss event or race is live or coming up.{" "}
          <A href={href.events("boss")}>See past boss events</A>.
        </p>
      </div>
    );
  }
  return (
    <>
      <h1 class="vh">What's on in BTD6 right now</h1>
      {p.boss && (
        <FeaturedBoss boss={p.boss}>
          {/* Phones: the other live events as a compact 2x2 grid after the top 5 (the big tiles below are hidden there). */}
          <MiniGrid p={p} />
        </FeaturedBoss>
      )}
      <div class="tiles">
        {p.race && <RaceTile race={p.race} prev={p.racePrev} />}
        {p.ct && <CTTile ct={p.ct} prev={p.ctPrev} />}
        {p.ody && <OdysseyTile ody={p.ody} />}
        {p.daily && <DailyTile id={p.daily.id} name={p.daily.name} />}
      </div>
      {events && <ComingUp events={events} />}
    </>
  );
}

/** Home top 5: Normal or Elite. Kept for the visit, so coming back to Now shows the same one. */
let homeDiff: BossDiff = "standard";

function FeaturedBoss(props: { boss: Boss; children?: ComponentChildren }) {
  const b = props.boss;
  const meta = body<ChallengeDocument>(bossMetaKey(b.id, "standard"));
  const live = status(b.start, b.end).s === "live";
  // Live or over: the Normal/Elite tiles pick the top 5. Not started: no board (never the previous boss's).
  const started = b.start <= Date.now();
  const [d, setD] = useState<BossDiff>(homeDiff);
  const elite = d === "elite";
  const scoringNow = elite ? b.eliteScoringType : b.normalScoringType;
  const top = started
    ? body<BossLeaderboardEntry[]>(bossBoardKey(b.id, d, 1))?.slice(0, 5)
    : undefined;
  const to = href.boss(b.id);
  const boardTo = href.boss(b.id, d);
  const pick = (x: BossDiff) => {
    homeDiff = x;
    setD(x);
  };
  return (
    <section class="feature" aria-labelledby="feat-title">
      <BossHero
        boss={b}
        fallback={bossLabel(b)}
        heading="h2"
        headingId="feat-title"
        to={to}
        class="feature-hero"
      />
      <div class="feature-body">
        <div class="feature-main">
          {/* Not a link: the banner already goes to the boss page (one tab stop, not three). */}
          <div class="fm-map">
            <MapArt
              map={meta?.map}
              url={meta?.mapURL}
              size={200}
              eager
              alt={meta ? `Map: ${mapName(meta.map)}` : "Map"}
            />
            {meta && (
              <p class="fm-t">
                <span class="fm-name">{mapName(meta.map)}</span>
                <span class="fm-sub">
                  <span>{meta.difficulty}</span>
                  <span class="mode">
                    <Spr
                      family="ui"
                      k={modeIcon(meta)}
                      size={24}
                      label
                      optional
                    />
                    {MODE_NAME[meta.mode] ?? meta.mode}
                  </span>
                  <span>
                    Rounds {fmtRounds(meta.startRound, meta.endRound)}
                  </span>
                </span>
              </p>
            )}
          </div>
          {/* The two difficulties side by side; while the event is live they also pick the top 5 beside them. */}
          <div
            class="fd-tiles"
            role={started ? "group" : undefined}
            aria-label={started ? "Top 5 leaderboard" : undefined}
          >
            {(["standard", "elite"] as const).map((x) => {
              const t =
                x === "elite" ? b.eliteScoringType : b.normalScoringType;
              const inner = (
                <>
                  <span class="kicker">
                    {x === "standard" ? "Normal" : "Elite"}
                  </span>
                  <span class="fd-sc">
                    <Spr family="ui" k={t} size={48} label optional />
                    {scoringShort(t)}
                  </span>
                  <span class="fd-n">
                    {fmtInt(
                      x === "elite"
                        ? b.totalScores_elite
                        : b.totalScores_standard,
                    )}{" "}
                    entries
                  </span>
                </>
              );
              return started ? (
                <button
                  key={x}
                  type="button"
                  class={d === x ? "fd-tile on" : "fd-tile"}
                  aria-pressed={d === x}
                  onClick={() => pick(x)}
                >
                  {inner}
                </button>
              ) : (
                <div key={x} class="fd-tile">
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
        {started ? (
          <div class="feature-top">
            <h3 class="kicker">
              {live ? "" : "Final · "}
              {elite ? "Elite" : "Normal"} solo · top {top?.length || 5}
              {top?.[0] && (
                <span class="kicker-r">
                  {partLabel(
                    keyPart(top[0].scoreParts, scoringNow)?.name ?? "Score",
                  )}
                </span>
              )}
            </h3>
            {top?.length ? (
              <ol class="podium">
                {top.map((r, i) => {
                  const kp = keyPart(r.scoreParts, scoringNow);
                  return (
                    <LinkRow
                      as="li"
                      key={r.profile + i}
                      href={href.player(idFromUrl(r.profile))}
                    >
                      <span class="rank-in">
                        <span class="pod-m">
                          <Medal
                            board={elite ? "bossElite" : "boss"}
                            rank={i + 1}
                            total={
                              elite
                                ? b.totalScores_elite
                                : b.totalScores_standard
                            }
                            size={28}
                          />
                        </span>
                        <span class={`plate p${i + 1}`}>{i + 1}</span>
                      </span>
                      <A href={href.player(idFromUrl(r.profile))} class="pname">
                        {r.displayName}
                      </A>
                      <span class="num">
                        {kp ? fmtPart(kp) : fmtInt(r.score)}
                      </span>
                    </LinkRow>
                  );
                })}
              </ol>
            ) : (
              <p class="quiet">No scores yet.</p>
            )}
            <A href={boardTo} class="more">
              {live ? "Full" : "Final"} {elite ? "elite " : ""}leaderboard{" "}
              <span aria-hidden="true">→</span>
            </A>
          </div>
        ) : (
          <div class="feature-top">
            <p class="quiet">Scores open {fmtWhen(b.start)}.</p>
            <A href={to} class="more">
              Event page <span aria-hidden="true">→</span>
            </A>
          </div>
        )}
        {props.children}
      </div>
    </section>
  );
}

function RaceTile(props: { race: Race; prev?: Race }) {
  const r = props.race;
  const meta = body<ChallengeDocument>(raceMetaKey(r.id));
  const winner = props.prev
    ? body<RaceLeaderboardEntry[]>(raceBoardKey(props.prev.id))?.[0]
    : undefined;
  return (
    <A href={href.race(r.id)} class="tile">
      <span class="tile-art">
        <MapArt framed map={meta?.map} url={meta?.mapURL} size={120} />
      </span>
      <span class="tile-body">
        <span class="eyebrow ti">
          <EvIcon k="race" size={36} />
          Race
        </span>
        <h2 class="tile-title">{r.name}</h2>
        <Bug start={r.start} end={r.end} />
        <span class="tile-meta">
          {meta && (
            <>
              {mapName(meta.map)} · {meta.difficulty} · Rounds{" "}
              {fmtRounds(meta.startRound, meta.endRound)}
              <br />
            </>
          )}
          {r.totalScores
            ? `${fmtInt(r.totalScores)} finishers`
            : "No finishers yet"}
          {winner && props.prev && (
            <>
              <br />
              Last race, {props.prev.name}:{" "}
              <strong>{winner.displayName}</strong> in{" "}
              <strong class="num">{fmtMs(winner.score)}</strong>
            </>
          )}
        </span>
      </span>
    </A>
  );
}

function CTTile(props: { ct: CT; prev?: CT }) {
  const c = props.ct;
  const leader = ctLeader(body, props.prev ?? c);
  const leadLabel = props.prev
    ? "Previous CT winner"
    : status(c.start, c.end).s === "ended"
      ? "Winning team"
      : "Leading team";
  return (
    <A href={href.ct(c.id)} class="tile">
      <span class="tile-art">
        <NoMapFrame size={120} />
      </span>
      <span class="tile-body">
        <span class="eyebrow ti">
          <EvIcon k="ct" size={36} />
          Team event
        </span>
        <h2 class="tile-title">Contested Territory</h2>
        <Bug start={c.start} end={c.end} />
        <span class="tile-meta">
          {fmtDay(c.start)} – {fmtDay(c.end)}
          <br />
          {leader ? (
            <>
              {leadLabel}: <strong>{leader.displayName}</strong> ·{" "}
              <span class="nowrap">{fmtInt(leader.score)} pts</span>
              <br />
            </>
          ) : ended(c) ? (
            <>
              Leaderboard no longer published by Ninja Kiwi
              <br />
            </>
          ) : (
            <>
              No captures yet
              <br />
            </>
          )}
          {status(c.start, c.end).s === "upcoming"
            ? `Territory opens ${fmtWhen(c.start)}`
            : `${fmtInt(c.totalScores_team)} teams · ${fmtInt(c.totalScores_player)} players`}
        </span>
      </span>
    </A>
  );
}

function OdysseyTile(props: { ody: Odyssey }) {
  const o = props.ody;
  const maps = body<ChallengeDocument[]>(odyMapsKey(o.id, "easy"));
  return (
    <A href={href.odyssey(o.id)} class="tile tile-ody">
      <span class="tile-art">
        <IslandRow maps={maps} size={52} max={4} />
      </span>
      <span class="tile-body">
        <span class="eyebrow ti">
          <EvIcon k="odyssey" size={36} />
          Odyssey
        </span>
        <h2 class="tile-title">{o.name}</h2>
        <Bug start={o.start} end={o.end} />
        <span class="tile-meta">
          {o.description}
          {o.description && maps && <br />}
          {maps ? `${maps.length} islands on Easy` : ""}
        </span>
      </span>
    </A>
  );
}

/** Numbered, framed island maps in a wrapping row (max 5, then "+N"); one placeholder frame while they load. */
function IslandRow(props: {
  maps?: ChallengeDocument[];
  size: number;
  max?: number;
}) {
  const all = props.maps ?? [];
  if (!all.length)
    return (
      <span class="mf-row">
        <MapArt framed size={props.size} />
      </span>
    );
  const max = props.max ?? 5;
  return (
    <span class="mf-row">
      {all.slice(0, max).map((m, i) => (
        <span key={i} class="mf-n">
          <MapArt framed map={m.map} url={m.mapURL} size={props.size} alt="" />
          <b>{i + 1}</b>
        </span>
      ))}
      {all.length > max && <span class="mf-more">+{all.length - max}</span>}
    </span>
  );
}

/** A card with no map picture: the CT event icon centred in the same frame a map would have. */
function NoMapFrame(props: { size: number }) {
  const icon = Math.round(props.size * 0.6);
  return (
    <span class="mf">
      <span
        class="mf-ph"
        style={{ width: `${props.size}px`, height: `${mapH(props.size)}px` }}
      >
        {hasArt("eventIcon", "ct") ? (
          <Spr family="eventIcon" k="ct" size={icon} />
        ) : (
          <Spr family="ui" k="ContestedTerritory" size={icon} />
        )}
      </span>
    </span>
  );
}

/** A daily challenge's tile (home, and the challenges page's "today" card). `eyebrow` defaults to the home one. */
export function DailyTile(props: { id: string; name: string; icon?: string; eyebrow?: string }) {
  const c = body<ChallengeDocument>(challengeKey(props.id));
  const rate = c?.playsUnique ? c.winsUnique / c.playsUnique : null;
  const by = dailyAuthor(props.name);
  return (
    <A href={href.challenge(props.id)} class="tile">
      <span class="tile-art">
        <MapArt framed map={c?.map} url={c?.mapURL} size={120} />
      </span>
      <span class="tile-body">
        <span class="eyebrow ti">
          <EvIcon k={props.icon ?? "daily"} size={36} />
          {props.eyebrow ?? "Daily challenge"}
        </span>
        <h2 class="tile-title">
          {dailyTitle(props.id) ?? props.name.replace(/^(\w+ \d+): /, "")}
        </h2>
        <span class="tile-meta">
          {by && (
            <>
              by <strong>{by}</strong>
              <br />
            </>
          )}
          {c ? (
            <>
              {mapName(c.map)} · {c.difficulty} · {human(c.mode)}
              <br />
              Rounds {fmtRounds(c.startRound, c.endRound)} · $
              {fmtInt(c.startingCash)}
              {rate !== null && (
                <>
                  <br />
                  <strong class="num">{fmtPct(rate)}</strong> of{" "}
                  {fmtCompact(c.playsUnique)} players won
                </>
              )}
            </>
          ) : by ? null : (
            props.name
          )}
        </span>
      </span>
    </A>
  );
}

/** Compact tiles for phones: eyebrow, title, status. The same picks as the big tiles. */
function MiniGrid(props: { p: ReturnType<typeof homePicks> }) {
  const { race, ct, ody, daily } = props.p;
  // Race and daily: a small map and its rounds (CT and odyssey have no single map).
  const raceMeta = race && body<ChallengeDocument>(raceMetaKey(race.id));
  const dailyDoc = daily && body<ChallengeDocument>(challengeKey(daily.id));
  const mini = (
    to: string,
    eyebrow: string,
    icon: string,
    title: string,
    when?: { start: number; end: number },
    map?: ChallengeDocument | false,
  ) => (
    <A href={to} class={map === undefined ? "mini" : "mini has-map"}>
      <span class="eyebrow ti">
        <EvIcon k={icon} size={30} />
        {eyebrow}
      </span>
      <span class="mini-t">{title}</span>
      {map !== undefined && (
        <span class="mini-map">
          <MapArt framed map={map ? map.map : undefined} url={map ? map.mapURL : undefined} size={48} alt="" />
          {map && (
            <span class="mini-r">
              Rounds {fmtRounds(map.startRound, map.endRound)}
            </span>
          )}
        </span>
      )}
      {when && <EvStatus start={when.start} end={when.end} />}
    </A>
  );
  if (!race && !ct && !ody && !daily) return null;
  return (
    <div class="minis">
      {race &&
        mini(href.race(race.id), "Race", "race", race.name, race, raceMeta ?? false)}
      {ct &&
        mini(
          href.ct(ct.id),
          "Contested Territory",
          "ct",
          `${fmtDay(ct.start)} – ${fmtDay(ct.end)}`,
          ct,
        )}
      {ody && mini(href.odyssey(ody.id), "Odyssey", "odyssey", ody.name, ody)}
      {daily &&
        mini(
          href.challenge(daily.id),
          "Daily challenge",
          "daily",
          dailyTitle(daily.id) ?? daily.name.replace(/^(\w+ \d+): /, ""),
          undefined,
          dailyDoc ?? false,
        )}
    </div>
  );
}

/**
 * Status in lists: live and upcoming keep the coloured countdown label; an ended event is the neutral boxed
 * "ENDED | 44 D AGO". Re-checked every 30 s like StatusBadge.
 */
function EvStatus(props: { start: number; end: number }) {
  useTick(30_000);
  const now = Date.now();
  const st = status(props.start, props.end, now);
  return st.s === "ended" ? (
    <EndedBug ms={now - props.end} sm />
  ) : (
    <span class={`st ${st.s}`}>{st.label}</span>
  );
}

/** Home: what starts next (live events are already the cards above). */
function ComingUp(props: { events: NKEvent[] }) {
  const now = Date.now();
  const rows = props.events
    .filter((e) => e.start > now)
    .sort((a, b) => a.start - b.start);
  if (!rows.length) return null;
  return (
    <Section title="Coming up" aside="Your local time">
      <div class="board-wrap">
        <table class="board sched">
          <thead>
            <tr>
              <th>Event</th>
              <th>Starts</th>
              <th class="opt">Ends</th>
              <th class="m-hide">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const kind = EVENT_KIND[e.type];
              const type = EVENT_TYPE_LABEL[e.type] ?? human(e.type);
              const known = kind ? findEvent<AnyEvent>(kind, e.id) : undefined;
              const name =
                known && kind === "boss"
                  ? bossLabel(known as Boss)
                  : known && "name" in known
                    ? (known as Race).name
                    : null;
              const [fam, key] =
                kind === "boss" && known
                  ? ["boss", (known as Boss).bossType]
                  : (EVENT_ICON[e.type] ?? ["ui", e.type]);
              const label = (
                <>
                  <Spr family={fam} k={key} size={24} label />
                  <span class="sched-n">
                    {name ?? type}
                    {name && <span class="sched-type">{type}</span>}
                  </span>
                </>
              );
              const cells = (
                <>
                  <td class="ev-name">
                    {kind ? (
                      <A href={eventHref(kind, e.id)} class="sched-l">
                        {label}
                      </A>
                    ) : (
                      <span class="sched-l">{label}</span>
                    )}
                  </td>
                  <td class="nowrap">
                    {fmtWhen(e.start)}
                    {/* phones: the status under the date instead of a column that scrolls sideways */}
                    <span class="m-sub">
                      <EvStatus start={e.start} end={e.end} />
                    </span>
                  </td>
                  <td class="nowrap opt">{fmtWhen(e.end)}</td>
                  <td class="m-hide">
                    <EvStatus start={e.start} end={e.end} />
                  </td>
                </>
              );
              // Only events with a page are rows that open it; the rest are plain (no hover, muted name).
              return kind ? (
                <LinkRow key={e.id} href={eventHref(kind, e.id)}>
                  {cells}
                </LinkRow>
              ) : (
                <tr key={e.id}>{cells}</tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ─────────────────────────────── event lists

export function EventList(props: { kind: EventKind }) {
  const { kind } = props;
  const every = allEvents(kind);
  // Old CTs whose boards NK no longer publishes fold into one line instead of a row of dashes each.
  const gone = kind === "ct" ? every.filter((e) => ctGone(e as CT)) : [];
  const all =
    gone.length && gone.length < every.length
      ? every.filter((e) => !gone.includes(e))
      : every;
  const folded = all !== every ? gone.length : 0;
  // First frame: the cards on screen; the rest a frame later (useFullRender, like the boards).
  const full = useFullRender();
  const events = full
    ? all
    : all.slice(0, Math.max(6, Math.ceil(innerHeight / 110)));
  return (
    <>
      <header class="page-h">
        <h1 class="title ti">
          <EvIcon k={kind} size={64} />
          {KIND_LABEL[kind]}
        </h1>
        {KIND_BLURB[kind] && <p class="lede">{KIND_BLURB[kind]}</p>}
        <Freshness k={LIST_KEY[kind]} />
        {kind === "boss" && <BossOrder />}
      </header>
      {kind === "boss" && (
        // One page per boss type (health per tier, skulls, spawns): each portrait is a prefetched link.
        <nav class="bs-strip" aria-label="Boss stats and skulls">
          <span class="bs-strip-l">
            More about each boss — health, skulls and shields:
          </span>
          {BOSS_TYPES.map((t) => (
            <A key={t} href={href.bossstats(t)} class="bs-pick" data-boss={t}>
              <Spr family="boss" k={t} size={48} label optional />
              <span>{bossName(t)}</span>
            </A>
          ))}
        </nav>
      )}
      {all.length === 0 ? (
        <Gate k={LIST_KEY[kind]} />
      ) : (
        <ul class={`events k-${kind}`}>
          {events.map((e) => {
            // Cards: the left stripe says live / soon / ended; a live event gets the big card; a boss card wears
            // its boss's tint (styles.css [data-boss]), like its event page.
            const s = status(e.start, e.end).s;
            return (
              <li
                key={e.id}
                class={s === "live" ? "now" : undefined}
                data-boss={kind === "boss" ? (e as Boss).bossType : undefined}
              >
                <A
                  href={eventHref(kind, e.id)}
                  class={`ev-row st-${s}${noArt(kind, e) ? " no-art" : ""}`}
                >
                  <EventRow kind={kind} e={e} big={s === "live"} />
                </A>
              </li>
            );
          })}
          {folded > 0 && (
            <li class="ev-fold">
              Older CTs: leaderboard no longer published ({folded})
            </li>
          )}
        </ul>
      )}
      {!peek(historyKey(kind)) && <p class="quiet">Loading older events…</p>}
      {(kind === "boss" || kind === "race") && <FullHistory key={kind} kind={kind} />}
    </>
  );
}

/**
 * The bosses take turns in a fixed order (BOSS_TYPES; checked against the archive), then start again: a ring of
 * portraits, the live (or last) one marked Now and the one after it Next. Opens on hover (desktop) or tap.
 */
function BossOrder() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) =>
      (e.type === "keydown" ? (e as KeyboardEvent).key === "Escape" : !ref.current?.contains(e.target as Node)) &&
      setOpen(false);
    addEventListener("pointerdown", off);
    addEventListener("keydown", off);
    return () => {
      removeEventListener("pointerdown", off);
      removeEventListener("keydown", off);
    };
  }, [open]);
  const last = (allEvents("boss") as Boss[]).find((e) => e.start <= Date.now());
  const at = last ? (BOSS_TYPES as readonly string[]).indexOf(last.bossType.toLowerCase()) : -1;
  const live = !!last && !ended(last);
  const nx = at < 0 ? -1 : (at + 1) % BOSS_TYPES.length;
  return (
    <div class={`bo${open ? " open" : ""}`} ref={ref}>
      <button type="button" class="share-btn bo-btn" aria-expanded={open} aria-controls="bo-pop" onClick={() => setOpen(!open)}>
        <svg class="bo-ic" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
        </svg>
        <span class="bo-l">Boss order</span>
      </button>
      <div class="bo-pop" id="bo-pop" role="group" aria-label="Boss order">
        <ol class="bo-ring" style={{ "--n": BOSS_TYPES.length }}>
          {BOSS_TYPES.map((t, i) => (
            <li key={t} style={{ "--i": i }} class={i === at ? "now" : i === nx ? "next" : undefined}>
              <A href={href.bossstats(t)}>
                <Spr family="boss" k={t} size={52} label optional />
                <span class="bo-name">{bossName(t)}</span>
              </A>
              {(i === at || i === nx) && <span class="bo-tag">{i === nx ? "Next" : live ? "Now" : "Last"}</span>}
            </li>
          ))}
        </ol>
        {/* Clockwise arrows between the portraits. */}
        <div class="bo-arrows" aria-hidden="true">
          {BOSS_TYPES.map((t, i) => (
            <span key={t} style={{ "--i": i + 0.5 }}>›</span>
          ))}
        </div>
        <p class="bo-mid">
          <strong>Boss order</strong>
          <span>Always this order, then round again</span>
        </p>
      </div>
    </div>
  );
}

const scrollBehavior = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** Why a wiki boss week has no number (bossHistory.ts notes). */
export const OLD_NOTE = { restarted: "Restarted", "taken down": "Taken down", special: "1-day special" } as const;

const dayMon = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
/** Short "10 Oct" of a history row's start and end (the year sits in the header); calendar-day rows read in UTC. */
function histDates(e: HistEvent): [string, string] {
  const f = e.day ? dayMonUtc : dayMon;
  return [f.format(e.start), f.format(e.end)];
}
const histYear = (e: HistEvent) => (e.day ? new Date(e.start).getUTCFullYear() : new Date(e.start).getFullYear());

/** One history row: archive rows link to their event page; wiki rows (no id) are plain. The map is its own link. */
function HistoryRow(props: { e: HistEvent }) {
  const e = props.e;
  const title = e.kind === "boss" ? (e.n ? bossTitle(e.type, e.n) : bossName(e.type)) : e.name;
  const link = e.id ? (e.kind === "boss" ? href.boss(e.id) : href.race(e.id)) : "";
  const [a, b] = histDates(e);
  const now = Date.now();
  const extra =
    e.kind === "boss"
      ? e.note
        ? OLD_NOTE[e.note]
        : ""
      : [e.difficulty, e.mode].filter(Boolean).join(" · ");
  return (
    <li class={`hist-r${e.id ? "" : " old"}`}>
      <div class={`hist-row k-${e.kind}`}>
        <span class="hist-d num">
          {a}
          {b !== a && <span class="hist-e"> – {b}</span>}
        </span>
        {e.kind === "boss" && <Spr family="boss" k={e.type} size={32} label optional class="hist-i" />}
        <span class="hist-t">
          {link ? (
            <>
              <A href={link}>{title}</A>
              <span class="hist-go" aria-hidden="true">
                {" "}›
              </span>
            </>
          ) : (
            <>
              {title}
            </>
          )}
          {e.start <= now && now < e.end && <span class="hist-live">Live</span>}
        </span>
        {e.map ? (
          <A href={href.map(e.map)} class="hist-map" title={mapName(e.map)}>
            <MapArt framed map={e.map} size={40} />
          </A>
        ) : (
          <span class="hist-map hist-nomap" role="img" aria-label="Map not recorded" title="Map not recorded">
            ?
          </span>
        )}
        <span class="hist-s">
          <span class="hist-mn">{e.map ? mapName(e.map) : "Map not recorded"}</span>
          {extra && <span class="hist-x">{extra}</span>}
        </span>
      </div>
    </li>
  );
}

/** Every boss event / race since the wiki's records begin, closed by default and built only once opened (the list stays light). */
function FullHistory(props: { kind: "boss" | "race" }) {
  const { kind } = props;
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const ref = useRef<HTMLDetailsElement>(null);
  const wasOpen = useRef(false);
  // Always closed, no filter on arrival (also when Preact keeps this instance across a route change).
  useEffect(
    () =>
      onRoute(() => {
        wasOpen.current = false;
        setOpen(false);
        setPick("");
        if (ref.current) ref.current.open = false;
      }),
    [],
  );
  const rows = eventHistory(kind, body);
  const keys = open ? mapMetaKeys(body) : [];
  useEffect(() => void store.want(keys), [keys.join()]);
  const gap = open && !pick ? eventGap(kind, body) : null;
  const src = kind === "boss" ? BOSS_HISTORY_SOURCE : RACE_HISTORY_SOURCE;
  const types = kind === "boss" ? BOSS_TYPES.filter((t) => rows.some((e) => e.kind === "boss" && e.type === t)) : [];
  const shown = pick ? rows.filter((e) => e.kind === "boss" && e.type === pick) : rows;
  // Rows are newest first, so the years come out newest first too.
  // The gap sits where the archive ends and the wiki's rows begin: between two year blocks when it starts one.
  const gapRow = gap ? shown.find((e, i) => !e.id && (i === 0 || !!shown[i - 1].id)) : undefined;
  const gapBand = gap && (
    <div class="hist-gap">
      <b>
        {monthYear.format(gap.from)} – {monthYear.format(gap.to)} · not on record
      </b>
      <span>No public list covers these weeks yet.</span>
    </div>
  );
  const groups: { y: number; rows: HistEvent[] }[] = [];
  for (const e of shown) {
    const y = histYear(e);
    (groups[groups.length - 1]?.y === y ? groups[groups.length - 1] : groups[groups.push({ y, rows: [] }) - 1]).rows.push(e);
  }
  const jump = (y: number) =>
    document.getElementById(`hist-${kind}-${y}`)?.scrollIntoView({ behavior: scrollBehavior() });
  // Bring the (closed) summary back under the header and focus it.
  const toSummary = () => {
    const s = ref.current?.querySelector("summary") as HTMLElement | null;
    s?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    s?.focus({ preventScroll: true });
  };
  const collapse = () => {
    wasOpen.current = false;
    setOpen(false);
    if (ref.current) ref.current.open = false;
    toSummary();
  };
  return (
    <details
      class="hist"
      ref={ref}
      onToggle={(ev) => {
        const o = (ev.currentTarget as HTMLDetailsElement).open;
        // Closed by the sticky summary itself (collapse() already scrolled): same scroll + focus.
        if (!o && wasOpen.current) toSummary();
        wasOpen.current = o;
        setOpen(o);
      }}
    >
      <summary>
        <span class="hist-sum">Full history</span>
        {open && <span class="hist-collapse">Collapse</span>}
        {!open && rows.length > 0 && (
          <span class="bs-count num">
            {rows.length} {kind === "boss" ? "boss events" : "races"} since {monthYear.format(rows[rows.length - 1].start)}
          </span>
        )}
      </summary>
      {open && (
        <>
          <p class="hist-legend">
            <span class="hist-go" aria-hidden="true">
              ›
            </span>{" "}
            opens the event's leaderboard. Older events come from the Bloons wikis; no leaderboards exist for them.
          </p>
          {types.length > 0 && (
            <div class="hist-chips" role="group" aria-label="Filter by boss">
              <button type="button" class="hist-chip" aria-pressed={!pick} onClick={() => setPick("")}>
                All
              </button>
              {types.map((t) => (
                <button
                  type="button"
                  key={t}
                  class="hist-chip"
                  aria-pressed={pick === t}
                  aria-label={bossName(t)}
                  title={bossName(t)}
                  onClick={() => setPick(pick === t ? "" : t)}
                >
                  <Spr family="boss" k={t} size={24} optional />
                  <span class="hist-chip-n">{bossName(t)}</span>
                </button>
              ))}
            </div>
          )}
          {pick && (
            <p class="hist-showing">
              Showing: <b>{bossName(pick)}</b> · {shown.length} {shown.length === 1 ? "event" : "events"}
            </p>
          )}
          {groups.length > 1 && (
            <div class="hist-jump">
              <span class="hist-lbl">Jump to</span>
              <div class="hist-chips hist-years" role="group" aria-label="Jump to year">
                {groups.map((g) => (
                  <button type="button" key={g.y} class="hist-chip" onClick={() => jump(g.y)}>
                    {g.y}
                  </button>
                ))}
              </div>
            </div>
          )}
          {groups.map((g) => (
            <Fragment key={g.y}>
            {gapRow === g.rows[0] && gapBand}
            <section id={`hist-${kind}-${g.y}`} class="hist-g">
              <h3 class="hist-y">
                {g.y} <small class="num">{g.rows.length} {g.rows.length === 1 ? "event" : "events"}</small>
              </h3>
              <ul class="hist-l">
                {g.rows.map((e) => {
                  return (
                    <Fragment key={e.id ?? `${e.start}${e.kind === "boss" ? e.type : ""}`}>
                      {e === gapRow && e !== g.rows[0] && <li>{gapBand}</li>}
                      <HistoryRow e={e} />
                    </Fragment>
                  );
                })}
              </ul>
            </section>
            </Fragment>
          ))}
          <p class="bs-src quiet">
            Older events:{" "}
            <a href={src} target="_blank" rel="noopener noreferrer">
              Bloonswiki
            </a>{kind === "boss" && (
              <>
                {" and the "}
                <a href={BOSS_HISTORY_FANDOM} target="_blank" rel="noopener noreferrer">
                  Fandom wiki
                </a>
              </>
            )}{" "}
            (CC BY-SA)
          </p>
          <button type="button" class="hist-top" onClick={collapse}>
            Back to top of history
          </button>
        </>
      )}
    </details>
  );
}

/** An odyssey whose island maps NK no longer serves has no art: its row is plain text, no empty grey well. */
function noArt(kind: EventKind, e: AnyEvent): boolean {
  return (
    kind === "odyssey" &&
    !!peek(odyMapsKey(e.id, "easy")) &&
    !body<ChallengeDocument[]>(odyMapsKey(e.id, "easy"))?.length
  );
}

/** The race rounds NK uses unless a race says otherwise; only different rounds get shown in lists. */
/** The live boss card's second row: map and rules, then per difficulty its scoring, entries and current top 3. */
function BossMore(props: { b: Boss; meta?: ChallengeDocument }) {
  const { b, meta } = props;
  // Normal's board comes with the row's link; Elite's is one more cached request, for the live card only.
  useEffect(() => void store.want([bossBoardKey(b.id, "elite", 1)]), [b.id]);
  return (
    <span class="ev-more">
      <span class="evm-map">
        <MapArt framed map={meta?.map} url={meta?.mapURL} size={120} alt="" />
        {meta && (
          <span class="evm-t">
            <strong>{mapName(meta.map)}</strong>
            <span>
              {meta.difficulty} · {MODE_NAME[meta.mode] ?? meta.mode}
            </span>
            <span>Rounds {fmtRounds(meta.startRound, meta.endRound)}</span>
          </span>
        )}
      </span>
      {(["standard", "elite"] as const).map((x) => {
        const t = x === "elite" ? b.eliteScoringType : b.normalScoringType;
        const rows = body<BossLeaderboardEntry[]>(bossBoardKey(b.id, x, 1));
        const total = x === "elite" ? b.totalScores_elite : b.totalScores_standard;
        return (
          <span key={x} class="evm-d">
            <span class="kicker">{x === "standard" ? "Normal" : "Elite"}</span>
            <span class="evm-sc">
              <Spr family="ui" k={t} size={32} label optional />
              {scoringShort(t)}
            </span>
            <span class="evm-n">{fmtInt(total)} entries</span>
            {/* Top 3 with their medals (phones: #1 only). Plain text: the whole card is already a link. */}
            {rows?.length ? (
              <span class="evm-top">
                {rows.slice(0, 3).map((r, i) => {
                  const kp = keyPart(r.scoreParts, t);
                  return (
                    <span key={r.profile + i} class="evm-r">
                      <Medal board={x === "elite" ? "bossElite" : "boss"} rank={i + 1} total={total} size={30} />
                      <strong>{r.displayName}</strong>
                      <span class="num">{kp ? fmtPart(kp) : fmtInt(r.score)}</span>
                    </span>
                  );
                })}
              </span>
            ) : (
              <span class="evm-top">{rows ? "No scores yet" : "\u00a0"}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

const ODY_DIFFS = ["easy", "medium", "hard"] as const;

/** The odyssey page's hero rule, as a row for the live card: icons of the allowed heroes (or a word). */
function OdyHeroes(props: { meta?: OdysseyMetadata }) {
  const towers = props.meta?._availableTowers;
  if (!towers) return null;
  const { selected, allowed } = heroRule(towers);
  return (
    <span class="oy-side">
      <span class="kicker">Heroes allowed</span>
      {selected || allowed.length === 0 ? (
        <span class="oy-hero-w">{selected ? "Any hero" : "No heroes"}</span>
      ) : (
        <span class="oy-heroes">
          {allowed.map((id) => (
            <Spr key={id} family="hero" k={id} size={40} />
          ))}
        </span>
      )}
    </span>
  );
}

/** One difficulty bar of the live card: boat health, then the rewards as icons (names on hover). */
function OdyBar(props: { d: number; n: number; meta?: OdysseyMetadata; cta?: boolean }) {
  const { d, n, meta, cta } = props;
  const rw = meta?._rewards ?? [];
  return (
    <span class={`oy-bar d${d}`} style={{ gridColumn: `1 / span ${n}` }}>
      <span class="dn">{cap(ODY_DIFFS[d])}</span>
      {meta && (
        <>
          <span class="oy-hp" title={`${fmtInt(meta.startingHealth)} boat health`}>
            <Spr family="ui" k="StartingLives" size={24} label optional />
            {fmtInt(meta.startingHealth)}
          </span>
          {rw.length > 2 ? (
            <span class="oy-more">Show rewards →</span>
          ) : (
            rw.map((r) => {
              const [fam, k] = rewardIcon(r);
              const [kind, value = ""] = r.split(":");
              return (
                <span key={r} class="oy-rw" title={fmtReward(r)}>
                  {fam && <Spr family={fam} k={k} size={24} label optional />}
                  {/^\d+$/.test(value) ? fmtInt(Number(value)) : !fam ? fmtReward(r) : null}
                  {kind === "InstaMonkey" && value.split(",")[1] && <small>{value.split(",")[1].replace(/^(\d)(\d)(\d)$/, "$1-$2-$3")}</small>}
                </span>
              );
            })
          )}
        </>
      )}
      {cta && <OdyCta bar />}
    </span>
  );
}

const OdyCta = (p: { bar?: boolean }) => (
  <span class={p.bar ? "oy-cta in-bar" : "oy-cta"}>Rewards, crew &amp; rules →</span>
);

/**
 * An odyssey's list card. Live: the voyage (Hard's islands as one chain, Easy / Medium / Hard as bars under the
 * islands they cover; Easy and Medium are the first islands of Hard, checked here). Past: just the island chain.
 */
function OdyRow(props: { o: Odyssey; st: ComponentChildren; dates: ComponentChildren; live: boolean }) {
  const { o, st, dates, live } = props;
  // Past: Hard's islands (never change). Live: the other difficulties too (like the boss card's Elite board).
  // Easy's maps and metadata come with the row's own link.
  useEffect(
    () =>
      void store.want(
        live
          ? [
              odyMetaKey(o.id, "medium"),
              odyMetaKey(o.id, "hard"),
              odyMapsKey(o.id, "medium"),
              odyMapsKey(o.id, "hard"),
            ]
          : [odyMapsKey(o.id, "hard")],
      ),
    [o.id, live],
  );
  const mp = Object.fromEntries(ODY_DIFFS.map((d) => [d, body<ChallengeDocument[]>(odyMapsKey(o.id, d))])) as Record<
    OdyDiff,
    ChallengeDocument[] | undefined
  >;
  const title = <span class="ev-title">{o.name}</span>;
  if (!live) {
    // Hard's islands once they've arrived (the chain grows to the right), meanwhile Easy's, meanwhile frames.
    const maps = mp.hard?.length ? mp.hard : mp.easy;
    if (noArt("odyssey", o)) {
      return (
        <>
          <span class="ev-main">
            {title}
            {o.description && <span class="ev-desc oy-desc" title={o.description}>{o.description}</span>}
            {dates}
          </span>
          <span class="ev-st">{st}</span>
        </>
      );
    }
    return (
      <>
        <span class="oy-chain" aria-hidden="true">
          {maps?.length
            ? maps.map((m, i) => (
                <span key={i} class="oy-mf" style={{ zIndex: maps.length - i }}>
                  <MapArt map={m.map} url={m.mapURL} size={96} alt="" />
                  <b class="n">{i + 1}</b>
                </span>
              ))
            : [0, 1, 2].map((i) => <span key={i} class="oy-mf skel" />)}
        </span>
        <span class="ev-main">
          {title}
          {o.description && <span class="ev-desc oy-desc" title={o.description}>{o.description}</span>}
          {dates}
        </span>
        <span class="ev-st">{st}</span>
      </>
    );
  }
  const chain = mp.hard ?? mp.easy ?? [];
  const ready = ODY_DIFFS.every((d) => mp[d]);
  const prefix = (a?: ChallengeDocument[]) =>
    !!a && !!mp.hard && a.length <= mp.hard.length && a.every((m, i) => m.map === mp.hard![i].map);
  const aligned = { easy: prefix(mp.easy), medium: prefix(mp.medium), hard: !!mp.hard };
  const bars = ready && aligned.easy && aligned.medium;
  // Per island, the modes that aren't Standard and the difficulties they apply to.
  const modes = (i: number) => {
    const by = new Map<string, string[]>();
    for (const d of ODY_DIFFS) {
      const m = aligned[d] ? mp[d]?.[i] : undefined;
      if (m && m.mode !== "Standard") by.set(m.mode, [...(by.get(m.mode) ?? []), cap(d)]);
    }
    return by;
  };
  return (
    <>
      <span class="oy-head">
        <span class="oy-pill">{st}</span>
        {title}
        {o.description && <span class="ev-desc oy-desc" title={o.description}>{o.description}</span>}
        {dates}
      </span>
      <OdyHeroes meta={body<OdysseyMetadata>(odyMetaKey(o.id, "easy"))} />
      <span class="oy-scroll">
        <span class="oy-voy" style={{ "--n": Math.max(chain.length, 1) }}>
          {chain.map((m, i) => {
            const by = modes(i);
            return (
              <span key={i} class={`oy-isl${i === chain.length - 1 ? " last" : ""}${i === 0 ? " first" : ""}`}>
                <span class="oy-art">
                  <span class="oy-mf">
                    <MapArt map={m.map} url={m.mapURL} size={200} alt="" />
                    <b class="n">{i + 1}</b>
                    {by.size > 0 && (
                      <span class="md">
                        <Spr family="modeMedal" k={[...by.keys()].pop()!} size={26} />
                      </span>
                    )}
                  </span>
                </span>
                <strong>{mapName(m.map)}</strong>
                {[...by].map(([mode, ds]) => (
                  <span key={mode} class="oy-mode">
                    {MODE_NAME[mode] ?? human(mode)} on {ds.length === 3 ? "all difficulties" : ds.join(", ")}
                  </span>
                ))}
              </span>
            );
          })}
          {bars ? (
            ODY_DIFFS.map((d, i) => (
              <OdyBar
                key={d}
                d={i}
                n={mp[d]!.length}
                meta={body<OdysseyMetadata>(odyMetaKey(o.id, d))}
                cta={d === "hard"}
              />
            ))
          ) : (
            <span class="oy-bar plain">
              {ready && ODY_DIFFS.map((d) => `${cap(d)} ${mp[d]!.length}`).join(" · ") + " islands"}
              <OdyCta bar />
            </span>
          )}
        </span>
      </span>
      <span class="oy-cta-row">
        <OdyCta />
      </span>
    </>
  );
}

function EventRow(props: { kind: EventKind; e: AnyEvent; big?: boolean }) {
  const { kind, e, big } = props;
  const well = big ? 96 : 72;
  const dates = (
    <span class="ev-dates">
      {fmtDate(e.start)} – {fmtDate(e.end)}
    </span>
  );
  const st = <EvStatus start={e.start} end={e.end} />;
  if (kind === "boss") {
    const b = e as Boss;
    // Prefetched by the row's own link; the line appears as soon as it lands.
    const meta = body<ChallengeDocument>(bossMetaKey(b.id, "standard"));
    return (
      <>
        <span class="ev-art banner">
          <Img src={b.bossTypeURL} w={1440} h={332} />
        </span>
        <span class="ev-main">
          <span class="ev-title">{bossLabel(b)}</span>
          {meta && !big && <MapLine doc={meta} brief />}
          {dates}
        </span>
        {big ? (
          <BossMore b={b} meta={meta} />
        ) : (
          <span class="ev-facts">
            {(["standard", "elite"] as const).map((x) => {
              const t =
                x === "elite" ? b.eliteScoringType : b.normalScoringType;
              return (
                <span key={x} class="ev-mode">
                  <Spr family="ui" k={t} size={24} label optional />
                  {scoringShort(t)} · {x === "standard" ? "Normal" : "Elite"}
                </span>
              );
            })}
            <span class="ev-n">
              {b.totalScores_standard !== undefined
                ? `${fmtInt(b.totalScores_standard + b.totalScores_elite)} entries`
                : "–"}
            </span>
          </span>
        )}
        <span class="ev-st">{st}</span>
      </>
    );
  }
  if (kind === "race") {
    const r = e as Race;
    // The row's own link prefetches this metadata; the well is there either way, so nothing shifts.
    const meta = body<ChallengeDocument>(raceMetaKey(r.id));
    return (
      <>
        <span class="ev-art well">
          <MapArt
            framed
            map={meta?.map}
            url={meta?.mapURL}
            size={well}
            alt=""
          />
        </span>
        <span class="ev-main">
          <span class="ev-title">{r.name}</span>
          {meta && <MapLine doc={meta} brief />}
          {dates}
        </span>
        <span class="ev-facts">
          {/* Always shown: the round range is a race's key rule (like a boss's scoring). */}
          <span class="ev-rounds">
            Rounds {meta ? fmtRounds(meta.startRound, meta.endRound) : "…"}
          </span>
          <span>
            {r.totalScores
              ? `${fmtInt(r.totalScores)} finishers`
              : "No finishers"}
          </span>
        </span>
        <span class="ev-st">{st}</span>
      </>
    );
  }
  if (kind === "ct") {
    const c = e as CT;
    // The row's own link prefetches the team board (the CT page opens on Teams), so the winner costs nothing extra.
    const lead = body<CTTeamEntry[]>(ctKey(c.id, "teams"))?.[0];
    const done = ended(c);
    return (
      <>
        <span class="ev-art well">
          <NoMapFrame size={well} />
        </span>
        <span class="ev-main">
          <span class="ev-title">
            {fmtDay(c.start)} – {fmtDay(c.end)}
          </span>
          {dates}
          {!lead && ctGone(c) && (
            <span class="ev-win gone">
              Leaderboard no longer published by Ninja Kiwi
            </span>
          )}
          {lead && (
            <span class="ev-win">
              <Spr
                family="eventMedal"
                k={medalArt("ctTeam", "BlackDiamond")}
                size={20}
                name={done ? "Winner" : "Leader"}
              />
              <span class="ev-win-k">{done ? "Winner" : "Leading"}</span>
              <strong>{lead.displayName}</strong>
              <span class="num">{fmtInt(lead.score)} pts</span>
            </span>
          )}
        </span>
        <span class="ev-facts">
          {c.totalScores_team ? (
            <span>{fmtInt(c.totalScores_team)} teams</span>
          ) : null}
          {c.totalScores_player ? (
            <span>{fmtInt(c.totalScores_player)} players</span>
          ) : null}
        </span>
        <span class="ev-st">{st}</span>
      </>
    );
  }
  const o = e as Odyssey;
  return <OdyRow o={o} st={st} dates={dates} live={status(o.start, o.end).s === "live"} />;
}

/**
 * An ended CT whose boards NK no longer serves: its totals were reset to 0, or the team board answered with an
 * error / no scores. Ninja Kiwi drops old CT leaderboards from the Open Data API after a while.
 */
function ctGone(c: CT): boolean {
  if (!ended(c)) return false;
  const e = peek(ctKey(c.id, "teams"));
  if (e) return boardGone(e);
  return !c.totalScores_player && !c.totalScores_team; // not loaded yet: NK's zeroed totals say it
}

/** A loaded board that is empty, "No Scores Available" or "no such id" (not a transient error / rate limit). */
export function boardGone(e: { ok: boolean; data?: Envelope }): boolean {
  if (e.ok) return !(e.data?.body as unknown[] | undefined)?.length;
  const msg = String(e.data?.error ?? "");
  return (
    msg === "No Scores Available" ||
    errorKind({ message: msg, code: e.data?.code === undefined ? undefined : String(e.data.code) }) === "notfound"
  );
}

/** Column header for the rank column: "#" for eyes, "Rank" for screen readers. */
export const RankTh = () => (
  <th class="rank">
    <span aria-hidden="true">#</span>
    <span class="vh">Rank</span>
  </th>
);

/**
 * True while the element (the sticky side column) fits in the viewport below the header: only then does it stick;
 * a taller one scrolls with the page instead of hiding its lower half. Class `fits`.
 */
export function useFits<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = parseFloat(getComputedStyle(el).top) || 72;
      el.classList.toggle("fits", el.offsetHeight <= innerHeight - top - 16);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      removeEventListener("resize", measure);
    };
  }, []);
  return ref;
}

// ─────────────────────────────── boss header (boss page + home)

/**
 * Boss events: NK's banner is the title (its logo already names the boss), so the name isn't repeated as big
 * text; it stays in the heading for screen readers and the tab title. The banner is shown whole (scaled, never
 * cropped: each boss's logo sits elsewhere), with the event number, status and dates beside it (under it on
 * phones). No art (lists not loaded yet, or the image fails): the name shows as big text in the art slot.
 * `below`: the facts under it (a compact line on the boss page; facts + top 5 on home).
 */
function BossHero(props: {
  boss?: Boss;
  /** Name while the lists load ("Vortex 47" from the id, else "Boss event"). */
  fallback: string;
  heading: "h1" | "h2";
  headingId?: string;
  to?: string;
  class?: string;
  /** Home: the map, after the number ("Vortex #47 · Sanctuary"). */
  sub?: string;
  /** Event page: the Share button under the dates. */
  share?: CardSpec;
  children?: ComponentChildren;
}) {
  const b = props.boss;
  const name = b ? bossTitle(b.bossType) : props.fallback;
  const no = b ? bossNum(b.name) : undefined;
  const H = props.heading;
  // Art that failed to load: its name in its place. Lists not loaded yet: an empty tinted slot (the name is
  // the text title beside it until then).
  const noArt = <span class="bh-noart">{b ? name : ""}</span>;
  const art = (
    <Img src={b?.bossTypeURL} w={1440} h={332} eager alt="" fallback={noArt} />
  );
  const link = (c: ComponentChildren, cls?: string, label?: string) =>
    props.to ? (
      <A href={props.to} class={cls} label={label}>
        {c}
      </A>
    ) : (
      <span class={cls}>{c}</span>
    );
  return (
    <header class={`bhero${props.class ? ` ${props.class}` : ""}`}>
      <div class="bh-top">
        {link(
          b?.bossTypeURL ? art : noArt,
          "bh-art",
          props.to ? `${name}${no ? ` #${no}` : ""} leaderboard` : undefined,
        )}
        <div class="bh-side">
          <p class="eyebrow ti">
            <EvIcon k="boss" size={24} />
            Boss event
          </p>
          {/* Home: the title opens the event too (on phones the banner doesn't read as a link). */}
          <H id={props.headingId} class="bh-title">
            {link(
              <>
                <span class="bh-name">{name}</span>
                {no && <span class="bh-no"> #{no}</span>}
              </>,
            )}
            {props.sub && <span class="bh-sub"> · {props.sub}</span>}
          </H>
          {b && (
            <>
              <div class="bugline">
                <Bug start={b.start} end={b.end} big />
              </div>
              <When start={b.start} end={b.end} />
            </>
          )}
          {props.share && <ShareButton spec={props.share} />}
        </div>
      </div>
      {props.children}
    </header>
  );
}

/** The banner's bottom band: the map (art + name, big), its difficulty and mode, and the rounds (the same for Normal and Elite). */
function BossMapRow(props: {
  meta?: ChallengeDocument;
  stats?: { href: string; name: string; type: string };
}) {
  const m = props.meta;
  return (
    <div class="bh-maprow">
      <MapArt framed map={m?.map} url={m?.mapURL} size={96} eager alt="" />
      {m && (
        <span class="bh-mapline">
          <strong class="bh-mapname">{mapName(m.map)}</strong>
          <span class="bh-mapsub">
            <span>{m.difficulty}</span>
            <span class="mode">
              <Spr family="ui" k={modeIcon(m)} size={24} label optional />
              {MODE_NAME[m.mode] ?? m.mode}
            </span>
            <span>Rounds {fmtRounds(m.startRound, m.endRound)}</span>
          </span>
        </span>
      )}
      {props.stats && (
        <A href={props.stats.href} class="bs-link">
          <Spr family="boss" k={props.stats.type} size={28} label optional />
          <span>
            More about {props.stats.name} — health, skulls and shields{" "}
            <span aria-hidden="true">→</span>
          </span>
        </A>
      )}
      {/* Phones: the rules sit below the board; this jumps there (hidden on wide screens). */}
      <JumpToRules />
    </div>
  );
}

/** Normal / Elite, each with its scoring: the top edge of the panel that holds everything tied to the choice. */
function BossDiffTabs(props: {
  id: string;
  boss?: Boss;
  d: BossDiff;
  n: number;
}) {
  const b = props.boss;
  return (
    <Tabs
      label="Difficulty"
      class="bh-tabs"
      items={(["standard", "elite"] as const).map((x) => {
        const t = b
          ? x === "elite"
            ? b.eliteScoringType
            : b.normalScoringType
          : undefined;
        return {
          href: href.boss(props.id, x, props.n),
          label: (
            <>
              {t && <Spr family="ui" k={t} size={46} label optional />}
              <span class="bt-t">
                <span class="bt-d">
                  {x === "standard" ? "Normal" : "Elite"}
                </span>
                {t && <span class="bt-s">{scoringShort(t)}</span>}
              </span>
            </>
          ),
          current: x === props.d,
        };
      })}
    />
  );
}

// ─────────────────────────────── shared event header

export function EventHead(props: {
  map?: ChallengeDocument;
  showMap?: boolean;
  eyebrow: string;
  /** eventIcon key shown beside the kicker. */
  icon?: string;
  title: ComponentChildren;
  ev?: { start: number; end: number };
  stats?: ComponentChildren;
  children?: ComponentChildren;
  /** Decorative art behind the title (dimmed, not interactive). */
  backdrop?: ComponentChildren;
}) {
  const { map, ev } = props;
  return (
    <header class={props.backdrop ? "ev-hero has-bd" : "ev-hero"}>
      {props.backdrop && (
        <div class="ev-backdrop" aria-hidden="true">
          {props.backdrop}
        </div>
      )}
      <div class="ev-head">
        {props.showMap && (
          <figure class="ev-map">
            <MapArt
              framed
              map={map?.map}
              url={map?.mapURL}
              size={200}
              eager
              alt={map ? `${mapName(map.map)} map` : ""}
            />
            {map && (
              <figcaption>
                <strong class="bh-mapname">{mapName(map.map)}</strong>
                <span class="bh-mapsub">
                  <span>{map.difficulty}</span>
                  <span class="mode">
                    <Spr family="ui" k={modeIcon(map)} size={24} label optional />
                    {MODE_NAME[map.mode] ?? map.mode}
                  </span>
                </span>
              </figcaption>
            )}
          </figure>
        )}
        <div class="ev-title-block">
          <p class="eyebrow ti">
            {props.icon && <EvIcon k={props.icon} size={36} />}
            {props.eyebrow}
          </p>
          <h1
            class={`${typeof props.title === "string" && props.title.length > 16 ? "title xl long" : "title xl"}${
              typeof props.title === "string" &&
              props.title.split(/\s+/).some((w) => w.length > 12)
                ? " long-word"
                : ""
            }`}
          >
            {props.title}
          </h1>
          {ev && (
            <div class="bugline">
              <Bug start={ev.start} end={ev.end} big />
            </div>
          )}
          {ev && <When start={ev.start} end={ev.end} />}
          {props.children}
        </div>
        {props.stats && <dl class="stats">{props.stats}</dl>}
      </div>
    </header>
  );
}

// ─────────────────────────────── medal cut-offs

/**
 * For each medal bracket of a board: the rank at its boundary and, when the page holding that rank is already in
 * memory, the score there. Nothing is fetched for it: unloaded boundaries show their rank only ("rank ≤ 928"),
 * and ranks past NK's top 1,000 are never published.
 */
/** Phones: whether the folded cut-offs are open, kept for the visit (every board page shares it). */
let cutoffsOpen = false;

/**
 * Two placements, so the leaderboard starts right under the tabs: `side` goes in the right-hand column (desktop
 * only), `fold` above the board as a bar that opens in place (phones only). CSS shows one or the other.
 */
export function CutoffStrip(props: {
  board: Board;
  total?: number;
  scoreAt: (rank: number) => string | undefined;
  full?: boolean;
  variant: "side" | "fold";
  coop?: boolean;
  /** Change at a medal's rank since the previous daily snapshot ("+12,340 since yesterday"), live CTs only. */
  trendAt?: (rank: number) => string | undefined;
}) {
  const cuts = cutoffs(props.board, props.total);
  if (!cuts.length) return null;
  const note = (
    <p class="co-note">
      Score at the last rank that still earns each medal.
      {props.coop &&
        " Only rank medals are shown: Ninja Kiwi publishes no entry count for team boards, so % medals can't be placed."}
    </p>
  );
  // Closed (phones): the top three cut-offs that have a score, each under its medal, in even columns.
  const glimpse: { c: Cutoff; sc: string }[] = [];
  for (const c of cuts) {
    const sc =
      !c.coveredBy && c.rank <= BOARD_CAP ? props.scoreAt(c.rank) : undefined;
    if (sc && glimpse.length < 3) glimpse.push({ c, sc });
  }
  const list = (
    <ol class="co-list">
      {/* first frame of a page: the strip keeps its height, chips follow a frame later (useFullRender) */}
      {props.full !== false &&
        cuts.map((c) => {
          if (c.coveredBy) {
            const medal = `${medalName(props.board, c.tier)} medal`;
            return (
              <li
                key={c.tier}
                class="co nil"
                title={`${medal}: ${c.label} (rank ${fmtInt(c.rank)} or better). Nobody earns it yet: those ranks already get the ${c.coveredBy} medal. It appears once the board grows.`}
              >
                <Spr
                  family="eventMedal"
                  k={medalArt(props.board, c.tier)}
                  size={32}
                  name={medal}
                />
                <span class="co-t">
                  <span class="co-l">{c.label}</span>
                  <span class="co-r">all within {c.coveredBy}</span>
                </span>
              </li>
            );
          }
          const score = c.rank <= BOARD_CAP ? props.scoreAt(c.rank) : undefined;
          const pct = c.label.endsWith("%");
          if (!score && !pct) return null; // a cut-off whose page isn't loaded says nothing: no empty chip
          const medal = `${medalName(props.board, c.tier)} medal`;
          const title = `${medal}: ${c.label}${pct ? ` (rank ${fmtInt(c.rank)} or better)` : ""}${
            score
              ? ` · rank ${fmtInt(c.rank)} scored ${score}`
              : c.rank > BOARD_CAP
                ? " · NK publishes only the top 1,000"
                : ""
          }`;
          return (
            <li key={c.tier} class="co" title={title}>
              <Spr
                family="eventMedal"
                k={medalArt(props.board, c.tier)}
                size={32}
                name={medal}
              />
              <span class="co-t">
                <span class="co-l">{c.label}</span>
                {pct && <span class="co-r">to #{fmtInt(c.rank)}</span>}
                {score && <span class="co-s">{score}</span>}
                {score && props.trendAt?.(c.rank) && <span class="co-trend">{props.trendAt(c.rank)}</span>}
              </span>
            </li>
          );
        })}
    </ol>
  );
  if (props.variant === "side") {
    return (
      <section class="cutoffs co-side" aria-label="Medal cut-offs">
        <h2 class="kicker-h">Medal cut-offs</h2>
        {note}
        {list}
      </section>
    );
  }
  return (
    <details
      class="cutoffs co-fold"
      open={cutoffsOpen}
      onToggle={(e) =>
        (cutoffsOpen = (e.currentTarget as HTMLDetailsElement).open)
      }
    >
      <summary>
        <span class="kicker">Medal cut-offs</span>
        <span class="co-more" aria-hidden="true">
          <span class="co-show">Show ▾</span>
          <span class="co-hide">Hide ▴</span>
        </span>
        {glimpse.length > 0 && (
          <span class="co-peek">
            {glimpse.map(({ c, sc }) => (
              <span key={c.tier} class="co-pk">
                <Spr
                  family="eventMedal"
                  k={medalArt(props.board, c.tier)}
                  size={24}
                  name={`${medalName(props.board, c.tier)} medal`}
                />
                <span class="co-pk-t">
                  <span class="co-pk-l">{c.label}</span>
                  <span class="co-pk-s">{sc}</span>
                </span>
              </span>
            ))}
          </span>
        )}
      </summary>
      {note}
      {list}
    </details>
  );
}

// ─────────────────────────────── leaderboard rows (boss, race, CT)

/**
 * Per row of a leaderboard page: the podium / band classes, and the medal bracket that ends after it.
 * `rows[i].rank` is null for a co-op teammate row (it shares the rank above); `approx` marks estimated ranks,
 * which get neither a podium tint nor a divider (they could be wrong). Bands alternate per rank, so a co-op team
 * reads as one block. A divider goes after the last row of the rank a bracket ends at (from Top 50 down: the
 * top 3 are their own brackets and already stand out); percentage brackets need the entry count.
 */
export function lbMeta(
  rows: { rank: number | null; approx?: boolean }[],
  board: Board,
  total?: number,
) {
  const ends = new Map(
    cutoffs(board, total)
      .filter((c) => !c.coveredBy && c.rank > 3)
      .map((c) => [c.rank, c]),
  );
  let rank: number | null = null;
  let approx = false;
  let group = -1;
  let lastTier: string | undefined;
  const out = rows.map((r) => {
    if (r.rank !== null) {
      rank = r.rank;
      approx = !!r.approx;
      group++;
    }
    const top = !approx && rank !== null && rank <= 3 ? rank : 0;
    // The medal once per bracket per page (the top 3 always): 22 identical Top 50 medals in a row say nothing.
    const tier =
      r.rank !== null && !approx ? medalTier(board, r.rank, total) : undefined;
    const medal = top > 0 || (tier !== undefined && tier !== lastTier);
    if (r.rank !== null) lastTier = tier;
    return {
      rank,
      approx,
      first: r.rank !== null,
      medal,
      cls: `${top ? `pod pod${top}` : ""}${group % 2 ? " band" : ""}`.trim(),
      cut: undefined as Cutoff | undefined,
    };
  });
  out.forEach((m, i) => {
    const lastOfRank = i === rows.length - 1 || rows[i + 1].rank !== null;
    if (lastOfRank && !m.approx && m.rank !== null) m.cut = ends.get(m.rank);
  });
  return out;
}

/** A medal bracket's end, as a row across the table: "▲ Top 50 · cut-off 7:01.116". */
export function CutRow(props: {
  board: Board;
  cut: Cutoff;
  cols: number;
  score?: string;
}) {
  const { cut } = props;
  return (
    <tr class="cut">
      <td colSpan={props.cols}>
        <span class="cut-in">
          <Spr
            family="eventMedal"
            k={medalArt(props.board, cut.tier)}
            size={24}
            name={`${medalName(props.board, cut.tier)} medal`}
          />
          <span class="cut-l">
            <span aria-hidden="true">▲ </span>
            <span class="vh">Medal bracket ends: </span>
            {cut.label}
          </span>
          {props.score && <span class="cut-s">cut-off {props.score}</span>}
        </span>
      </td>
    </tr>
  );
}

/** Race empty state: "Leaderboard opens in 2h 10m", re-rendered so it moves with the countdown above. */
function OpensIn(props: { start: number }) {
  useTick(15_000);
  return (
    <p class="empty-t">
      Leaderboard opens in {fmtSpan(props.start - Date.now())}
    </p>
  );
}

/** "+0.517", "+7.250", "+1:07.250": a time gap at the board's own precision. */
function gapMs(ms: number): string {
  return ms < 60_000
    ? `+${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}`
    : `+${fmtMs(ms)}`;
}

/**
 * How far a boss row is behind #1 (page 1 only): fewer boss tiers first ("−1 tier"), else the key score's gap in
 * its own unit (time or cash). None on Least Tiers boards (few distinct values, mostly ties) or for a tie.
 */
function bossGap(
  r: ScorePart[],
  lead: ScorePart[],
  scoring?: string,
): string | undefined {
  if (scoring === "LeastTiers") return undefined;
  const tier = (ps: ScorePart[]) =>
    ps.find((x) => x.name === "Boss Tier")?.score;
  const [rt, lt] = [tier(r), tier(lead)];
  if (rt !== undefined && lt !== undefined && rt < lt)
    return `−${lt - rt} tier${lt - rt === 1 ? "" : "s"}`;
  const [a, b] = [keyPart(r, scoring), keyPart(lead, scoring)];
  if (!a || !b || a.score <= b.score) return undefined;
  const d = a.score - b.score;
  return a.type === "time"
    ? gapMs(d)
    : /cash/i.test(a.name)
      ? `+$${fmtInt(d)}`
      : `+${fmtInt(d)}`;
}

/** A boss row's headline score, with its tier when it didn't reach the top row's tier. */
function bossScore(
  r: BossLeaderboardEntry,
  scoring?: string,
  topTier?: number,
): string {
  const parts = fixParts(r.scoreParts, scoring);
  const kp = keyPart(r.scoreParts, scoring);
  const tier = parts.find((x) => x.name === "Boss Tier")?.score;
  const v = kp ? fmtPart(kp) : fmtInt(r.score);
  return tier !== undefined && topTier !== undefined && tier < topTier
    ? `T${tier} · ${v}`
    : v;
}

// ─────────────────────────────── boss

/** Rows of pages 1…p−1 of a co-op board, in order, if all are in memory (else undefined: ranks get estimated). */
function earlierPages(
  id: string,
  d: BossDiff,
  n: number,
  p: number,
): BossLeaderboardEntry[] | undefined {
  const acc: BossLeaderboardEntry[] = [];
  for (let q = 1; q < p; q++) {
    const b = body<BossLeaderboardEntry[]>(bossBoardKey(id, d, n, q));
    if (!b) return undefined;
    acc.push(...b);
  }
  return acc;
}

/** Rows painted in a long board's first frame (the rest follows one frame later, see useFullRender). */
const firstRows = () => Math.max(10, Math.ceil(innerHeight / 48));

export function BossPage(props: {
  id: string;
  d: BossDiff;
  n: number;
  p: number;
}) {
  const { id, d, n, p } = props;
  const ev = findEvent<Boss>("boss", id);
  const boardKey = bossBoardKey(id, d, n, p);
  const metaKey = bossMetaKey(id, d);
  const rows = body<BossLeaderboardEntry[]>(boardKey);
  const maxPages = peek(boardKey)?.data?.maxPages ?? 1;
  const scoring = ev
    ? d === "elite"
      ? ev.eliteScoringType
      : ev.normalScoringType
    : undefined;
  const full = useFullRender();
  const rulesRef = useFits<HTMLElement>();
  // Co-op boards list each teammate as a row with the same score: group them under one rank.
  // Exact co-op ranks need every earlier page (teams can be short); pages you paged through are in memory.
  const before = n > 1 && p > 1 ? earlierPages(id, d, n, p) : undefined;
  const ranked = useMemo(
    () => rankBossRows(rows ?? [], { n, page: p, scoring, before }),
    [rows, n, p, scoring, before?.length],
  );
  if (!ev && isMissing(metaKey, boardKey)) {
    return (
      <NotFound
        what="boss event"
        back={{ href: href.events("boss"), label: "All boss events" }}
      />
    );
  }
  const meta = body<ChallengeDocument>(metaKey);
  // One tier on every visible row: say it once instead of repeating a column of identical numbers.
  const tiers = new Set(
    ranked.map(
      (x) =>
        fixParts(x.r.scoreParts, scoring).find((q) => q.name === "Boss Tier")
          ?.score,
    ),
  );
  const oneTier =
    tiers.size === 1 && [...tiers][0] !== undefined ? [...tiers][0] : undefined;
  const dropTier = (ps: ScorePart[]) =>
    oneTier === undefined ? ps : ps.filter((q) => q.name !== "Boss Tier");
  const cols = dropTier(fixParts(rows?.[0]?.scoreParts ?? [], scoring));
  // Submission time is secondary (hidden on phones); the last other non-tier part (e.g. Game Time) rides under
  // the lead value on phones instead of taking its own column.
  const metrics = cols.filter(
    (c) => c.name !== "Boss Tier" && c.name !== SUBMITTED,
  );
  const stack =
    metrics.length >= 2 ? metrics[metrics.length - 1].name : undefined;
  const total = ev
    ? d === "elite"
      ? ev.totalScores_elite
      : ev.totalScores_standard
    : undefined;
  const board: Board = d === "elite" ? "bossElite" : "boss";
  // Fallback title while the lists load: "Vortex47_…" ids carry the name; bare ids ("msi6n2qi") don't.
  const pre = /^([A-Za-z]+\d+)_/.exec(id)?.[1];
  // The boss's stats page (carries this event's difficulty and modifiers); the id's prefix until the lists land.
  const guess = (
    ev?.bossType ?? (pre ? bossName(pre.replace(/\d+$/, "")) : "")
  ).toLowerCase();
  const statsType = (BOSS_TYPES as readonly string[]).includes(guess)
    ? guess
    : undefined;

  const topTier = fixParts(
    body<BossLeaderboardEntry[]>(bossBoardKey(id, d, n, 1))?.[0]?.scoreParts ??
      [],
    scoring,
  ).find((x) => x.name === "Boss Tier")?.score;
  const lm = lbMeta(ranked, board, n === 1 ? total : undefined);
  const hero = rows?.[0]
    ? keyPart(rows[0].scoreParts, scoring)?.name
    : undefined;
  // Gap to #1 on page 1 only: deeper down, the bracket dividers (and their cut-offs) are the useful yardstick.
  const lead = p === 1 ? ranked[0]?.r.scoreParts : undefined;
  const scoreAt = (rank: number): string | undefined => {
    if (n === 1) {
      const r = body<BossLeaderboardEntry[]>(
        bossBoardKey(id, d, 1, Math.ceil(rank / PAGE_SIZE[board])),
      )?.[(rank - 1) % PAGE_SIZE[board]];
      return r && bossScore(r, scoring, topTier);
    }
    // Co-op ranks count teams, not rows: only the page on screen (and page 1) can be ranked without guessing.
    const pool = [
      ...ranked,
      ...(p === 1
        ? []
        : rankBossRows(
            body<BossLeaderboardEntry[]>(bossBoardKey(id, d, n, 1)) ?? [],
            { n, page: 1, scoring },
          )),
    ];
    const hit = pool.find((x) => x.rank === rank && !x.approx);
    return hit && bossScore(hit.r, scoring, topTier);
  };

  const lbName = `${d === "elite" ? "Elite" : "Normal"} leaderboard${n > 1 ? ` · ${n} players` : ""}`;
  const estimated = ranked.some((x) => x.approx);
  return (
    <>
      <BossHero
        boss={ev}
        fallback={pre ? bossTitle(pre) : "Boss event"}
        heading="h1"
        share={
          ev && meta ? bossCard(ev, meta, d) : undefined
        }
      >
        <BossMapRow
          meta={meta}
          stats={
            statsType
              ? {
                  href: href.bossstats(statsType, { d, ev: id }),
                  name: bossName(statsType),
                  type: statsType,
                }
              : undefined
          }
        />
      </BossHero>
      <BossDiffTabs id={id} boss={ev} d={d} n={n} />
      <div class="bh-panel">
        <div class="split">
          <section class="board-sec" aria-labelledby="lb-h">
            <h2 class="vh" id="lb-h">
              {lbName}
            </h2>
            <div class="lb-bar lb-bar-t">
              <span class="lb-bar-l" aria-hidden="true">
                Players
              </span>
              <Tabs
                label="Team size"
                items={[1, 2, 3, 4].map((x) => ({
                  href: href.boss(id, d, x),
                  label: String(x),
                  current: x === n,
                }))}
              />
              <Freshness
                k={boardKey}
                ended={ended(ev)}
                shown={
                  n === 1 && total ? Math.min(total, BOARD_CAP) : undefined
                }
                total={n === 1 ? total : undefined}
                extra={
                  oneTier !== undefined ? `All tier ${oneTier}` : undefined
                }
              />
            </div>
            {estimated && <ApproxNote />}
            {rows && rows.length > 0 && (
              <CutoffStrip
                variant="fold"
                board={board}
                total={n === 1 ? total : undefined}
                scoreAt={scoreAt}
                full={full}
                coop={n > 1}
              />
            )}
            <Gate
              k={boardKey}
              rows={25}
              empty={
                ev && status(ev.start, ev.end).s === "upcoming" ? (
                  <p>Scores open when the event starts, {fmtWhen(ev.start)}.</p>
                ) : (
                  <p>No scores on this board yet.</p>
                )
              }
            />
            {rows && (
              <div class="board-wrap">
                <table class="board lb" aria-label={lbName}>
                  <thead>
                    <tr>
                      <RankTh />
                      <th>Player</th>
                      {cols.map((c) => (
                        <PartHead
                          key={c.name}
                          name={c.name}
                          sub={
                            // phones: the stacked part's name under the column it rides in (Parts' host)
                            c.name ===
                            cols.find(
                              (x) => x.name !== "Boss Tier" && x.name !== stack,
                            )?.name
                              ? stack
                              : undefined
                          }
                          class={
                            c.name === stack
                              ? "m-hide"
                              : c.name === SUBMITTED
                                ? "opt"
                                : undefined
                          }
                          title={
                            c.name === SUBMITTED
                              ? "When the run was submitted (your time); hover a time for the offset from the event start"
                              : undefined
                          }
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(full ? ranked : ranked.slice(0, firstRows())).map(
                      ({ r, rank, approx }, i) => [
                        <LinkRow
                          key={`${r.profile}-${i}`}
                          href={href.player(idFromUrl(r.profile))}
                          class={
                            `${rank === null ? "mate" : n > 1 ? "team1" : ""} ${lm[i].cls}`.trim() ||
                            undefined
                          }
                        >
                          <Rank
                            n={rank}
                            board={board}
                            total={n === 1 ? total : undefined}
                            approx={approx}
                            medal={lm[i].medal}
                          />
                          <td class="pl">
                            <A href={href.player(idFromUrl(r.profile))}>
                              {r.displayName}
                            </A>
                          </td>
                          <Parts
                            parts={dropTier(fixParts(r.scoreParts, scoring))}
                            stack={stack}
                            opt={[SUBMITTED]}
                            start={ev?.start}
                            hero={hero}
                            topTier={topTier}
                            gap={
                              lead && rank !== null && rank > 1 && !approx
                                ? bossGap(r.scoreParts, lead, scoring)
                                : undefined
                            }
                          />
                        </LinkRow>,
                        lm[i].cut && (
                          <CutRow
                            key={`cut-${i}`}
                            board={board}
                            cut={lm[i].cut!}
                            cols={2 + cols.length}
                            score={bossScore(r, scoring, topTier)}
                          />
                        ),
                      ],
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <Pager
              page={p}
              maxPages={maxPages}
              to={(x) => href.boss(id, d, n, x)}
            />
          </section>
          <aside class="rules" id="rules" ref={rulesRef}>
            {rows && rows.length > 0 && (
              <CutoffStrip
                variant="side"
                board={board}
                total={n === 1 ? total : undefined}
                scoreAt={scoreAt}
                full={full}
                coop={n > 1}
              />
            )}
            <h2 class="kicker-h">{d === "elite" ? "Elite" : "Normal"} rules</h2>
            {!full ? null : meta ? (
              <Ruleset doc={meta} noPowers />
            ) : (
              <Gate k={metaKey} rows={4} />
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────── race

export function RacePage(props: { id: string; p: number }) {
  const { id, p } = props;
  const ev = findEvent<Race>("race", id);
  const key = raceBoardKey(id, p);
  const full = useFullRender();
  const rulesRef = useFits<HTMLElement>();
  if (!ev && isMissing(raceMetaKey(id), key)) {
    return (
      <NotFound
        what="race"
        back={{ href: href.events("race"), label: "All races" }}
      />
    );
  }
  const rows = body<RaceLeaderboardEntry[]>(key);
  const maxPages = peek(key)?.data?.maxPages ?? 1;
  const meta = body<ChallengeDocument>(raceMetaKey(id));
  const upcoming = ev && status(ev.start, ev.end).s === "upcoming";
  const best = p === 1 ? rows?.[0] : undefined;
  const scoreAt = (rank: number) => {
    const r = body<RaceLeaderboardEntry[]>(
      raceBoardKey(id, Math.ceil(rank / PAGE_SIZE.race)),
    )?.[(rank - 1) % PAGE_SIZE.race];
    return r && fmtMs(r.score);
  };
  const first = (p - 1) * PAGE_SIZE.race;
  const lm = lbMeta(
    (rows ?? []).map((_, i) => ({ rank: first + i + 1 })),
    "race",
    ev?.totalScores,
  );
  return (
    <>
      <EventHead
        showMap
        map={meta}
        eyebrow="Race"
        icon="race"
        title={ev?.name ?? id.replace(/_[a-z0-9]+$/, "").replace(/_/g, " ")}
        ev={ev}
        stats={
          <>
            <Stat k="Finishers" v={ev ? fmtInt(ev.totalScores) : "–"} />
            {best && <Stat k="Best time" v={fmtMs(best.score)} accent />}
            {meta && (
              <Stat k="Rounds" v={fmtRounds(meta.startRound, meta.endRound)} />
            )}
          </>
        }
      >
        {/* Phones: jumps to the rules below (inside the header, not a row of its own). */}
        <JumpToRules />
        <ShareButton
          spec={
            ev && meta ? raceCard(ev, meta) : undefined
          }
        />
      </EventHead>
      <div class="split">
        <section class="board-sec" aria-labelledby="lb-h">
          <h2 class="vh" id="lb-h">
            Race leaderboard
          </h2>
          <div class="lb-bar">
            <Freshness
              k={key}
              ended={ended(ev)}
              shown={
                ev?.totalScores
                  ? Math.min(ev.totalScores, BOARD_CAP)
                  : undefined
              }
              total={ev?.totalScores}
            />
          </div>
          {rows && rows.length > 0 && (
            <CutoffStrip
              variant="fold"
              board="race"
              total={ev?.totalScores}
              scoreAt={scoreAt}
              full={full}
            />
          )}
          <Gate
            k={key}
            rows={25}
            empty={
              upcoming && ev ? (
                <>
                  <OpensIn start={ev.start} />
                  <p>
                    The race starts {fmtWhen(ev.start)}.
                    {meta && (
                      <>
                        {" "}
                        The rules are already out: see Rules{" "}
                        <span class="m-only-i">below</span>
                        <span class="d-only">on the right</span>.
                      </>
                    )}
                  </p>
                </>
              ) : (
                <p>No finishers yet.</p>
              )
            }
          />
          {rows && (
            <div class="board-wrap">
              <table class="board lb" aria-label="Race leaderboard">
                <thead>
                  <tr>
                    <RankTh />
                    <th>Player</th>
                    <PartHead name="Game Time" />
                    <PartHead
                      name={SUBMITTED}
                      class="opt"
                      title="When the run was submitted (your time); hover a time for the offset from the race start"
                    />
                  </tr>
                </thead>
                <tbody>
                  {(full ? rows : rows.slice(0, firstRows())).map((r, i) => [
                    <LinkRow
                      key={`${r.profile}-${i}`}
                      href={href.player(idFromUrl(r.profile))}
                      class={lm[i].cls || undefined}
                    >
                      <Rank
                        n={first + i + 1}
                        board="race"
                        total={ev?.totalScores}
                        medal={lm[i].medal}
                      />
                      <td class="pl">
                        <A href={href.player(idFromUrl(r.profile))}>
                          {r.displayName}
                        </A>
                      </td>
                      <td class="num lead hero">
                        {fmtMs(r.score)}
                        {best && i > 0 && r.score > best.score && (
                          <span class="gap" title="Behind #1">
                            <span class="vh">behind #1 by </span>
                            {gapMs(r.score - best.score)}
                          </span>
                        )}
                      </td>
                      <td class="num opt">
                        {r.scoreParts[1] ? (
                          <Submitted
                            offset={r.scoreParts[1].score}
                            start={ev?.start}
                          />
                        ) : (
                          ""
                        )}
                      </td>
                    </LinkRow>,
                    lm[i].cut && (
                      <CutRow
                        key={`cut-${i}`}
                        board="race"
                        cut={lm[i].cut!}
                        cols={4}
                        score={fmtMs(r.score)}
                      />
                    ),
                  ])}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={p} maxPages={maxPages} to={(x) => href.race(id, x)} />
        </section>
        <aside class="rules" id="rules" ref={rulesRef}>
          {rows && rows.length > 0 && (
            <CutoffStrip
              variant="side"
              board="race"
              total={ev?.totalScores}
              scoreAt={scoreAt}
              full={full}
            />
          )}
          <h2 class="kicker-h">Rules</h2>
          {!full ? null : meta ? (
            <Ruleset doc={meta} noPowers />
          ) : (
            <Gate k={raceMetaKey(id)} rows={4} />
          )}
        </aside>
      </div>
    </>
  );
}

// ─────────────────────────────── odyssey

/** Sprite of one odyssey reward: "MonkeyMoney:100", "Power:SuperMonkeyStorm", "InstaMonkey:DartMonkey,2-0-3", … */
const rewardIcon = (r: string): [string, string] => {
  const [kind, value = ""] = r.split(":");
  return kind === "MonkeyMoney"
    ? ["ui", "MonkeyMoney"]
    : kind === "Power"
      ? ["power", value]
      : kind === "InstaMonkey"
        ? ["tower", value.split(",")[0]]
        : ["", ""];
};

function Rewards(props: { rewards: string[] }) {
  return (
    <ul class="rewards">
      {props.rewards.map((r) => {
        const [fam, k] = rewardIcon(r);
        return (
          <li key={r}>
            {fam && <Spr family={fam} k={k} size={24} label optional />}
            <span>{fmtReward(r)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function OdysseyPage(props: { id: string; d: OdyDiff }) {
  const { id, d } = props;
  const ev = findEvent<Odyssey>("odyssey", id);
  if (!ev && isMissing(odyMetaKey(id, d), odyMapsKey(id, d))) {
    return (
      <NotFound
        what="odyssey"
        back={{ href: href.events("odyssey"), label: "All odysseys" }}
      />
    );
  }
  const meta = body<OdysseyMetadata>(odyMetaKey(id, d));
  const maps = body<ChallengeDocument[]>(odyMapsKey(id, d));
  return (
    <>
      <EventHead
        eyebrow="Odyssey"
        icon="odyssey"
        title={ev?.name ?? "Odyssey"}
        ev={ev}
        stats={
          meta && (
            <>
              <Stat k="Islands" v={maps ? maps.length : "–"} />
              <Stat k="Boat health" v={fmtInt(meta.startingHealth)} />
              <Stat k="Monkey seats" v={meta.maxMonkeySeats} />
            </>
          )
        }
      >
        {ev?.description && <p class="lede">{ev.description}</p>}
        <Freshness k={odyMetaKey(id, d)} ended={ended(ev)} />
      </EventHead>
      <div class="controls">
        <Tabs
          label="Difficulty"
          items={(["easy", "medium", "hard"] as const).map((x) => ({
            href: href.odyssey(id, x),
            label: cap(x),
            current: x === d,
          }))}
        />
        {meta?.isExtreme && (
          <span class="st ended">Extreme: health does not carry over</span>
        )}
      </div>
      <Section
        title="Islands"
        aside={maps ? `${maps.length} maps, played in order` : undefined}
      >
        {maps ? (
          <ol class="islands">
            {maps.map((m, i) => (
              <li key={i} class="island">
                <span class="island-art">
                  <MapArt
                    framed
                    map={m.map}
                    url={m.mapURL}
                    size={120}
                    alt={`${mapName(m.map)} map`}
                  />
                </span>
                <div class="island-b">
                  <p class="island-n">
                    <span class="plate">{i + 1}</span>
                    <MapLine doc={m} />
                  </p>
                  <Ruleset doc={m} compact />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Gate k={odyMapsKey(id, d)} rows={4} />
        )}
      </Section>
      {meta ? (
        <div class="split even">
          <Section title="Boat">
            <dl class="spec">
              {/* Boat health and monkey seats are in the header; the cap on monkeys aboard is a limit, not the crew size below. */}
              <Fact k="Boat capacity" v={`${meta.maxMonkeysOnBoat} monkeys`} />
              <Fact k="Power slots" v={meta.maxPowerSlots} />
              <Fact
                k="Rewards"
                v={
                  meta._rewards.length ? (
                    <Rewards rewards={meta._rewards} />
                  ) : (
                    "–"
                  )
                }
              />
            </dl>
            <div class="rgroup">
              <p class="rhead">
                <span class="label">Starting crew</span>
                <span class="rhead-v quiet">
                  {meta._defaultTowers.reduce((a, t) => a + t.quantity, 0)}{" "}
                  monkeys at the start
                </span>
              </p>
              <Crew
                label="Starting crew"
                family="tower"
                items={meta._defaultTowers.map((t) => ({
                  id: t.name,
                  n: t.quantity,
                }))}
                hero={(id) =>
                  meta._availableTowers.some((a) => a.tower === id && a.isHero)
                }
              />
            </div>
            {meta._defaultPowers.length > 0 && (
              <div class="rgroup">
                <p class="rhead">
                  <span class="label">Starting powers</span>
                </p>
                <Crew
                  label="Starting powers"
                  family="power"
                  items={meta._defaultPowers.map((t) => ({
                    id: t.name,
                    n: t.quantity,
                  }))}
                />
              </div>
            )}
          </Section>
          <Section
            title="Allowed on the boat"
            aside={
              hasBans(meta._availableTowers, meta._availablePowers, true) ? (
                <HideBannedToggle />
              ) : undefined
            }
          >
            <HeroRule towers={meta._availableTowers} roster />
            <TowerRoster towers={meta._availableTowers} />
            <PowerGrid powers={meta._availablePowers} all />
          </Section>
        </div>
      ) : (
        <Gate k={odyMetaKey(id, d)} rows={3} />
      )}
    </>
  );
}

/** The share card's content for a boss event's difficulty / a race. */
function bossCard(ev: Boss, meta: ChallengeDocument, d: BossDiff): CardSpec {
  const scoring = d === "elite" ? ev.eliteScoringType : ev.normalScoringType;
  return {
    eyebrow: `Boss event · ${d === "elite" ? "Elite" : "Normal"}`,
    title: bossTitle(ev.bossType, bossNum(ev.name)),
    banner: ev.bossTypeURL,
    start: ev.start,
    end: ev.end,
    meta,
    scoring: scoring ? { k: scoring, name: scoringShort(scoring) } : undefined,
    path: location.pathname,
  };
}
function raceCard(ev: Race, meta: ChallengeDocument): CardSpec {
  return {
    eyebrow: "Race",
    title: ev.name,
    start: ev.start,
    end: ev.end,
    meta,
    extra: ev.totalScores ? `${fmtInt(ev.totalScores)} finishers` : undefined,
    path: location.pathname,
  };
}

/**
 * `?card` on a boss / race URL: only the card as an <img id="card"> (the Discord notification screenshots it,
 * worker/notify.ts). `data-ready` once loaded, `data-failed` when it can't be drawn.
 */
export function CardOnly(props: { r: Extract<Route, { name: "boss" | "race" }> }) {
  const { r } = props;
  const isBoss = r.name === "boss";
  const ev = findEvent<Boss & Race>(r.name, r.id);
  const metaKey = isBoss ? bossMetaKey(r.id, r.d) : raceMetaKey(r.id);
  const meta = body<ChallengeDocument>(metaKey);
  const [pic, setPic] = useState("");
  const [bad, setBad] = useState(false);
  const failed = bad || isMissing(metaKey) || (!!meta && !ev && !!peek(LIST_KEY[r.name])?.ok);
  useEffect(() => {
    if (!ev || !meta) return;
    let url = "";
    let live = true;
    void drawCard({ ...(isBoss ? bossCard(ev, meta, r.d) : raceCard(ev, meta)), utc: true }).then((b) => {
      if (!live) return;
      if (b) setPic((url = URL.createObjectURL(b)));
      else setBad(true);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [!!ev, !!meta]);
  return (
    <img
      id="card"
      src={pic || undefined}
      width={1200}
      height={630}
      style="display:block"
      alt=""
      data-failed={failed ? "" : undefined}
      onLoad={(e) => pic && ((e.currentTarget as HTMLImageElement).dataset.ready = "")}
    />
  );
}
