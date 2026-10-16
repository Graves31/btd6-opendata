import { render } from "preact";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "preact/hooks";
import type { ChallengeDocument, CT as CTEvent, Guild, Odyssey, Race, UserProfile } from "../../src/nk/types.ts";
import { bossName, bossTitle, dailyTitle, fmtDay, mapName } from "./format.ts";
import { backTo, onRoute, refreshNow, route as initialRoute, routeCommitted, setBackLabeler, store } from "./nav.ts";
import { challengeKey, guildKey, historyKey, href, LIST_KEY, needs, userKey, type EventKind, type Route } from "./routes.ts";
import "./fonts.css";
import { homePicks } from "./picks.ts";
import "./styles.css";
import { warmAllOnIdle, warmFor } from "./sprite.tsx";
import { A, body, EvIcon } from "./ui.tsx";
import { BossPage, bossTitleFor, bossTypeFor, CTGroupPage, CTPage, EventList, Home, OdysseyPage, RacePage } from "./views/events.tsx";
import { MapPage, MapsPage } from "./views/maps.tsx";
import { ChallengesPage } from "./views/challenges.tsx";
import { NotFound } from "./views/errors.tsx";
import { BossStatsPage } from "./views/bossstats.tsx";
import { ChallengePage, PlayerPage, TeamPage } from "./views/people.tsx";
import { ParagonPage } from "./views/paragon.tsx";
import { RoundsPage, roundsTitle, roundsBoss } from "./views/rounds.tsx";
import { ParagonScalingPage } from "./views/paragonScaling.tsx";
import { BankPlannerPage } from "./views/bankPlanner.tsx";
import { FarmingPage } from "./views/farming.tsx";
import { ToolsHub } from "./views/tools.tsx";
import { StatsPage } from "./views/stats.tsx";
import { SuggestPage } from "./views/suggest.tsx";
import { ThemeToggle } from "./theme.tsx";

/** Site version from package.json (vite.config.ts `define`). */
declare const __APP_VERSION__: string;


function Page(props: { r: Route }) {
  const r = props.r;
  switch (r.name) {
    case "home":
      return <Home />;
    case "events":
      return <EventList kind={r.kind} />;
    case "boss":
      return <BossPage id={r.id} d={r.d} n={r.n} p={r.p} />;
    case "bossstats":
      return <BossStatsPage r={r} />;
    case "race":
      return <RacePage id={r.id} p={r.p} />;
    case "ct":
      return <CTPage id={r.id} tab={r.tab} p={r.p} />;
    case "ctgroup":
      return <CTGroupPage id={r.id} gid={r.gid} />;
    case "odyssey":
      return <OdysseyPage id={r.id} d={r.d} />;
    case "player":
      return <PlayerPage id={r.id} />;
    case "team":
      return <TeamPage id={r.id} />;
    case "challenge":
      return <ChallengePage id={r.id} />;
    case "rounds":
      return <RoundsPage r={r} />;
    case "tools":
      return <ToolsHub />;
    case "paragon":
      return <ParagonPage r={r} />;
    case "farming":
      return <FarmingPage r={r.r} />;
    case "bankPlanner":
      return <BankPlannerPage r={r} />;
    case "pgscaling":
      return <ParagonScalingPage d={r.d} to={r.to} />;
    case "stats":
      return <StatsPage />;
    case "suggest":
      return <SuggestPage />;
    case "maps":
      return <MapsPage r={r} />;
    case "map":
      return <MapPage id={r.id} />;
    case "challenges":
      return <ChallengesPage filter={r.filter} p={r.p} />;
    case "notfound":
    default: {
      return (
        <NotFound what="page">
          <p>That address doesn't match anything on this site. Events, leaderboards and profiles are all reachable from the menu above.</p>
        </NotFound>
      );
    }
  }
}

const peekBody = <T,>(k: string): T | undefined => {
  const e = store.peek(k);
  return e?.ok ? (e.data?.body as T) : undefined;
};
/** An event from the live list or the archive, by id. */
function findEvent<T extends { id: string }>(kind: EventKind, id: string): T | undefined {
  return peekBody<T[]>(LIST_KEY[kind])?.find((e) => e.id === id) ?? peekBody<T[]>(historyKey(kind))?.find((e) => e.id === id);
}
/** "Gun_Game_mu19oabt" → "Gun Game" (race ids carry the name). */
const raceFromId = (id: string) => id.replace(/_[a-z0-9]{8}$/, "").replace(/_/g, " ");

/** Browser-tab title for every route; refined as the page's data lands. */
export function title(r: Route): string {
  const base = "BTD6 Open Data";
  const t = (s: string | undefined) => (s ? `${s} · ${base}` : base);
  if (r.name === "challenges") return t(r.filter === "daily" ? "Daily challenges" : r.filter === "newest" ? "Newest challenges" : "Trending challenges");
  switch (r.name) {
    case "home":
      return base;
    case "events":
      return t({ boss: "Boss events", race: "Races", ct: "Contested Territory", odyssey: "Odysseys" }[r.kind]);
    case "boss": {
      // From the lists (bare ids like "msi6n2qi" carry no name); "Vortex47_…" ids can be read before they land.
      const name = bossTitleFor(r.id) ?? (/^[A-Za-z]+\d+_/.test(r.id) ? bossTitle(r.id.split("_")[0]) : "Boss event");
      return t(`${name}${r.d === "elite" ? " Elite" : ""}`);
    }
    case "bossstats":
      return t(`${bossName(r.type)} · Boss stats`);
    case "race":
      return t(`${findEvent<Race>("race", r.id)?.name ?? raceFromId(r.id)} · Race`);
    case "ct":
    case "ctgroup": {
      const e = findEvent<CTEvent>("ct", r.id);
      const when = e ? `CT ${fmtDay(e.start)}` : "Contested Territory";
      return t(r.name === "ctgroup" ? `${when} · Group` : r.tab === "teams" ? `${when} · Teams` : r.tab === "tiles" ? `${when} · Tiles` : when);
    }
    case "odyssey": {
      const o = findEvent<Odyssey>("odyssey", r.id);
      return t(`${o?.name ?? "Odyssey"}${r.d !== "easy" ? ` (${r.d === "medium" ? "Medium" : "Hard"})` : ""}`);
    }
    case "player":
      return t(peekBody<UserProfile>(userKey(r.id))?.displayName ?? "Player");
    case "team":
      return t(peekBody<Guild>(guildKey(r.id))?.name ?? "Team");
    case "challenge":
      return t(dailyTitle(r.id) ?? peekBody<ChallengeDocument>(challengeKey(r.id))?.name ?? "Challenge");
    case "rounds":
      return t(`${roundsTitle(r)} · Round visualizer`);
    case "maps":
      return t("Maps");
    case "map":
      return t(mapName(r.id));
    case "tools":
      return t("Tools");
    case "paragon":
      return t("Paragon degree calculator");
    case "farming":
      return t("Farming resources");
    case "bankPlanner":
      return t("Bank & IMF Loan planner");
    case "pgscaling":
      return t("Paragon scaling");
    case "stats":
      return t("Site stats");
    case "suggest":
      return t("Suggest");
    default:
      return t("Page not found");
  }
}

/** Browser-tab / search-result headline: the main pages use the words people search for (same as og.ts);
 *  the back link keeps title()'s short names. */
function tabTitle(r: Route): string {
  if (r.name === "home") return "BTD6 Open Data · Live boss, race & CT leaderboards";
  const s =
    r.name === "events" && r.kind !== "odyssey"
        ? `BTD6 ${{ boss: "Boss Event", race: "Race", ct: "Contested Territory (CT)" }[r.kind]} Leaderboards`
        : r.name === "paragon"
          ? "BTD6 Paragon Degree Calculator"
          : r.name === "rounds"
            ? `${roundsTitle(r)} · BTD6 Round Visualizer`
            : undefined;
  return s ? `${s} · BTD6 Open Data` : title(r);
}

/** How a page is named in the back link: its title, plus the team size / page it was on. */
function backLabel(r: Route): string {
  let s = title(r).replace(/ · BTD6 Open Data$/, "");
  if (s === "BTD6 Open Data") return "Live";
  if (r.name === "boss" && r.n > 1) s += ` · ${r.n}P`;
  if ((r.name === "boss" || r.name === "race" || r.name === "ct") && r.p > 1) s += ` · page ${r.p}`;
  return s;
}
setBackLabeler(backLabel);

/** Pages you drill into from a list or board get "‹ <where you came from>" (in-site clicks only, not shared links). */
const BACK_ON = new Set<string>(["player", "team", "challenge", "ctgroup", "map"]);
function BackLink(props: { r: Route }) {
  const b = BACK_ON.has(props.r.name) ? backTo() : undefined;
  if (!b) return null;
  return (
    <a
      class="backlink"
      href={b.href}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        history.back(); // same entry as the browser's back button: the board page and scroll position come back
      }}
    >
      <span aria-hidden="true">‹</span> {b.label}
    </a>
  );
}

/** [href, label, section]: a page belongs to the section its list lives in. */
const NAV: [string, string, string][] = [
  [href.home(), "Live", "home"],
  [href.events("boss"), "Bosses", "boss"],
  [href.events("race"), "Races", "race"],
  [href.events("ct"), "CT", "ct"],
  [href.events("odyssey"), "Odysseys", "odyssey"],
  ["/challenges", "Challenges", "challenges"],
  [href.maps(), "Maps", "maps"],
  ["/tools", "Tools", "tools"],
];
/** Phone bottom bar: four tabs + "More" (the rest, in the sheet). [href, label, section, eventIcon key]. */
const BAR = [NAV[0], NAV[1], NAV[2], NAV[3]];
const SHEET = [NAV[4], NAV[5], NAV[6], NAV[7]];
const ICON: Record<string, string> = { boss: "boss", race: "race", ct: "ct", odyssey: "odyssey", challenges: "daily" };
const svg = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": true } as const;
const LiveIcon = () => (
  <svg {...svg}>
    <circle cx="12" cy="12" r="2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </svg>
);
const MoreIcon = () => (
  <svg {...svg}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
const MapIcon = () => (
  <svg {...svg}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" />
  </svg>
);
const ToolsIcon = () => (
  <svg {...svg}>
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 17l-4 4-5.7-1.3a4 4 0 0 0-5-5L3 8.5l4-4z" />
  </svg>
);
const sectionIcon = (sec: string) =>
  sec === "home" ? <LiveIcon /> : sec === "maps" ? <MapIcon /> : sec === "tools" ? <ToolsIcon /> : <EvIcon k={ICON[sec]} size={24} />;
function section(r: Route): string {
  const n = r.name;
  if (r.name === "events") return r.kind;
  if (r.name === "ctgroup") return "ct";
  if (r.name === "challenge") return "challenges";
  if (r.name === "map") return "maps";
  if (r.name === "rounds" || r.name === "paragon" || r.name === "farming" || r.name === "bankPlanner" || r.name === "pgscaling") return "tools";
  if (r.name === "bossstats") return "boss";
  return n;
}

/** "Blastapopolous19_mt1zqdkz" → "blastapopoulos" (until the lists know the id). */
const bossPrefix = (id: string) => {
  const m = /^([A-Za-z]+)\d+_/.exec(id);
  return m ? bossName(m[1]).toLowerCase() : undefined;
};

/**
 * The page's area drives the background tint (styles.css "Areas"): same navy field everywhere, each area in its
 * own colour; boss pages take their boss's. The boss type comes from the lists (bare ids like "msi6n2qi" have no
 * name), else from the id's name prefix; it is re-applied when the lists land.
 */
function setArea(r: Route): void {
  const el = document.documentElement;
  el.dataset.area = r.name === "events" ? `events-${r.kind}` : section(r) === "tools" ? "tools" : r.name === "bossstats" ? "boss" : r.name;
  // Home wears the colour of the boss it headlines (same pick as the page: live, just ended, or next up).
  const boss =
    r.name === "boss"
      ? (bossTypeFor(r.id) ?? bossPrefix(r.id))
      : r.name === "home"
        ? homePicks(body, store.featured).boss?.bossType
        : r.name === "bossstats"
          ? r.type
          : r.name === "rounds"
          ? roundsBoss(r) // a boss's round set wears that boss's tint, like its event pages
          : undefined;
  if (boss) el.dataset.boss = boss;
  else delete el.dataset.boss;
}

function App() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [r, setR] = useState<Route>(initialRoute);
  const live = useRef<HTMLParagraphElement>(null); // polite live region: the new page's name after an in-site navigation
  const first = useRef(true);
  const [more, setMore] = useState(false); // phones: the "More" sheet
  const at = useRef(location.pathname);
  const sheet = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => store.subscribe(() => bump(0)), []);
  useEffect(() => onRoute(setR), []);
  useLayoutEffect(() => {
    setArea(r);
    routeCommitted();
    if (first.current) first.current = false;
    else if (live.current) live.current.textContent = backLabel(r); // no re-render for a status line
    if (at.current !== location.pathname) setMore(false); // the sheet closes when the page changes
    at.current = location.pathname;
  }, [r]);
  useEffect(() => {
    if (!more) return;
    sheet.current?.querySelector("a")?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMore(false);
      moreBtn.current?.focus();
    };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [more]);
  // Every render: the title gets the real name (player, boss…) as soon as that data lands.
  useLayoutEffect(() => {
    const t = tabTitle(r);
    if (document.title !== t) document.title = t;
  });
  // The headline boss is known once /api/now lands (after the first paint on a cold start).
  const homeBoss = r.name === "home" ? homePicks(body, store.featured).boss?.bossType : r.name === "boss" ? bossTypeFor(r.id) : undefined;
  useLayoutEffect(() => setArea(r), [homeBoss]);
  return (
    <>
      <a class="skip" href="#main">
        Skip to content
      </a>
      <header class="top">
        <A href="/" class="brand" label="BTD6 Open Data, home">
          <span class="brand-mark">BTD6</span>
          <span class="brand-t">Open Data</span>
        </A>
        <div class="top-tools">
          <A href="/suggest" class={r.name === "suggest" ? "sug-btn on" : "sug-btn"} current={r.name === "suggest"} label="Suggest an improvement" title="Suggest">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M12 7v6M9 10h6" />
            </svg>
            <span class="sug-t">Suggest</span>
          </A>
          <span class="top-sep" aria-hidden="true" />
          <ThemeToggle />
        </div>
        <nav aria-label="Sections">
          {NAV.map(([h, label, sec]) => {
            const on = section(r) === sec;
            // aria-current="page" only on the page itself; a detail page (a boss, a player) just keeps the tab lit.
            return (
              <A key={h} href={h} class={on ? "on" : undefined} current={on && location.pathname === h}>
                {label}
              </A>
            );
          })}
        </nav>
      </header>
      <nav class="bar" aria-label="Sections">
        {BAR.map(([h, label, sec]) => {
          const on = section(r) === sec;
          return (
            <A key={h} href={h} class={on ? "on" : undefined} current={on && location.pathname === h}>
              {sectionIcon(sec)}
              {label}
            </A>
          );
        })}
        <button
          type="button"
          ref={moreBtn}
          class={more || SHEET.some((n) => n[2] === section(r)) ? "on" : undefined}
          aria-expanded={more}
          aria-controls="more-sheet"
          onClick={() => setMore(!more)}
        >
          <MoreIcon />
          More
        </button>
      </nav>
      <div class="scrim" hidden={!more} onClick={() => (setMore(false), moreBtn.current?.focus())} />
      <div class="sheet" id="more-sheet" ref={sheet} data-open={more ? "" : undefined}>
        {SHEET.map(([h, label, sec]) => (
          <A key={h} href={h} class={section(r) === sec ? "on" : undefined} current={section(r) === sec && location.pathname === h}>
            {sectionIcon(sec)}
            {label}
          </A>
        ))}
      </div>
      <p class="vh" role="status" aria-live="polite" ref={live} />
      <main id="main" tabIndex={-1}>
        <BackLink r={r} />
        <Page r={r} />
      </main>
      <footer>
        <div class="ft-top">
          <p class="ft-brand">
            <A href="/">btd6data.com</A>
            <span>BTD6 Open Data · v{__APP_VERSION__}</span>
          </p>
          <A href="/suggest">Suggest an improvement</A>
        </div>
        <p class="ft-fine">
          Unofficial fan site, not affiliated with Ninja Kiwi. Data and images from the Ninja Kiwi Open Data API; game
          art © Ninja Kiwi. Times are in your time zone.
        </p>
      </footer>
    </>
  );
}

// Boot: last session's data first (instant repeat visits), then the hot bundle (preloaded by index.html).
await Promise.race([store.hydrate(), new Promise((r) => setTimeout(r, 120))]);
void refreshNow(true);
void store.want(needs(initialRoute));
warmFor(initialRoute.name); // this page's sprite sheets first; sprites show text chips until decoded
const root = document.getElementById("app")!;
root.replaceChildren(); // the Worker's text for crawlers (og.ts injectMeta)
render(<App />, root);
warmAllOnIdle();

setInterval(() => document.visibilityState === "visible" && void store.loadNow(), 5 * 60_000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void store.loadNow());
// Not on the old workers.dev address: the worker there only retires itself (sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD && !location.hostname.endsWith(".workers.dev")) void navigator.serviceWorker.register("/sw.js");
