import { render } from "preact";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "preact/hooks";
import type { ChallengeDocument, CT as CTEvent, Guild, Odyssey, Race, UserProfile } from "../../src/nk/types.ts";
import { bossName, bossTitle, dailyTitle, fmtDay } from "./format.ts";
import { backTo, onRoute, refreshNow, route as initialRoute, routeCommitted, setBackLabeler, store } from "./nav.ts";
import { challengeKey, guildKey, historyKey, href, LIST_KEY, needs, userKey, type EventKind, type Route } from "./routes.ts";
import "./fonts.css";
import { homePicks } from "./picks.ts";
import "./styles.css";
import { warmAllOnIdle, warmFor } from "./sprite.tsx";
import { A, body } from "./ui.tsx";
import { BossPage, bossTitleFor, bossTypeFor, CTGroupPage, CTPage, EventList, Home, OdysseyPage, RacePage } from "./views/events.tsx";
import { ChallengesPage } from "./views/challenges.tsx";
import { NotFound } from "./views/errors.tsx";
import { BossStatsPage } from "./views/bossstats.tsx";
import { ChallengePage, PlayerPage, TeamPage } from "./views/people.tsx";
import { ParagonPage } from "./views/paragon.tsx";
import { RoundsPage, roundsTitle, roundsBoss } from "./views/rounds.tsx";
import { ToolsHub } from "./views/tools.tsx";
import { StatsPage } from "./views/stats.tsx";
import { ThemeToggle } from "./theme.tsx";


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
    case "stats":
      return <StatsPage />;
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
    case "tools":
      return t("Tools");
    case "paragon":
      return t("Paragon degree calculator");
    case "stats":
      return t("Site stats");
    default:
      return t("Page not found");
  }
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
const BACK_ON = new Set<string>(["player", "team", "challenge", "ctgroup"]);
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
  ["/tools", "Tools", "tools"],
];
function section(r: Route): string {
  const n = r.name;
  if (r.name === "events") return r.kind;
  if (r.name === "ctgroup") return "ct";
  if (r.name === "challenge") return "challenges";
  if (r.name === "rounds" || r.name === "paragon") return "tools";
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
  useEffect(() => store.subscribe(() => bump(0)), []);
  useEffect(() => onRoute(setR), []);
  useLayoutEffect(() => {
    setArea(r);
    routeCommitted();
    if (first.current) first.current = false;
    else if (live.current) live.current.textContent = backLabel(r); // no re-render for a status line
    // Narrow phones (< 380 px): the tab row scrolls sideways; keep the current tab in view.
    const nav = document.querySelector<HTMLElement>(".top nav");
    const on = nav?.querySelector<HTMLElement>("a.on");
    if (nav && on && nav.scrollWidth > nav.clientWidth) {
      const l = on.offsetLeft - nav.offsetLeft;
      if (l < nav.scrollLeft || l + on.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = l - (nav.clientWidth - on.offsetWidth) / 2;
    }
  }, [r]);
  // Every render: the title gets the real name (player, boss…) as soon as that data lands.
  useLayoutEffect(() => {
    const t = title(r);
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
        <ThemeToggle />
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
      <p class="vh" role="status" aria-live="polite" ref={live} />
      <main id="main" tabIndex={-1}>
        <BackLink r={r} />
        <Page r={r} />
      </main>
      <footer>
        <span>Unofficial fan site, not affiliated with Ninja Kiwi. Data and images from the Ninja Kiwi Open Data API. Game art © Ninja Kiwi. Times are in your time zone.</span>
      </footer>
    </>
  );
}

// Boot: last session's data first (instant repeat visits), then the hot bundle (preloaded by index.html).
await Promise.race([store.hydrate(), new Promise((r) => setTimeout(r, 120))]);
void refreshNow(true);
void store.want(needs(initialRoute));
warmFor(initialRoute.name); // this page's sprite sheets first; sprites show text chips until decoded
render(<App />, document.getElementById("app")!);
warmAllOnIdle();

setInterval(() => document.visibilityState === "visible" && void store.loadNow(), 5 * 60_000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void store.loadNow());
// Not on the old workers.dev address: the worker there only retires itself (sw.js).
if ("serviceWorker" in navigator && import.meta.env.PROD && !location.hostname.endsWith(".workers.dev")) void navigator.serviceWorker.register("/sw.js");
