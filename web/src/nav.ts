// Client-side navigation + prefetch scheduling. Browser-only (History API, IntersectionObserver).

import { createStore as idbStore, del, entries as idbEntries, setMany } from "idb-keyval";
import { mapMetaKeys } from "./maps.ts";
import { homeExtraKeys, homePicks } from "./picks.ts";
import { ROUND_SETS } from "./data/rounds/index.ts";
import BOSS_STATS_URL from "./data/bosses.json?url";
import { needs, needsForHref, parse, setBossStatsUrl, setHomeExtras, setMapExtras, setRoundKeys, type Route } from "./routes.ts";
import { roundSetKeys } from "./rounds.ts";
import { mapSrc, warmFor } from "./sprite.tsx";
import { Store, type ClientEntry, type Persist } from "./store.ts";

// ─────────────────────────────── store singleton (IndexedDB-backed)

const idb = idbStore("btd6-opendata", "entries");
const MAX_PERSISTED = 800;

/** Round-set files of this build (content-hashed URLs); an older build's copies are dropped from IndexedDB. */
const ROUND_URLS = new Set([...ROUND_SETS.map((s) => s.url), BOSS_STATS_URL]);
const staleAsset = (k: string) => (k.startsWith("/assets/") || k.startsWith("/src/")) && !ROUND_URLS.has(k);

const persist: Persist = {
  async load() {
    let all = (await idbEntries<string, ClientEntry>(idb)).map(([, v]) => v);
    for (const e of all.filter((e) => staleAsset(e.key))) void del(e.key, idb);
    all = all.filter((e) => !staleAsset(e.key));
    if (all.length > MAX_PERSISTED) {
      all.sort((a, b) => b.receivedAt - a.receivedAt);
      for (const old of all.splice(MAX_PERSISTED)) void del(old.key, idb);
    }
    return all;
  },
  async save(batch) {
    await setMany(batch.map((e) => [e.key, e]), idb);
  },
};

/** Warm the browser image cache for pictures a prefetched page will show (our own map art when we have it). */
function warmImages(e: ClientEntry): void {
  const b = e.data?.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return;
  for (const f of ["avatarURL", "bannerURL", "iconURL", "mapURL"]) {
    const u = f === "mapURL" ? mapSrc(b.map, b.mapURL) : b[f];
    if (typeof u === "string" && (u.startsWith("https://static-api.nkstatic.com/") || u.startsWith("/"))) new Image().src = u;
  }
}

export const store = new Store({ fetch: (u, i) => fetch(u, i), persist, onEntry: warmImages });

const peekBody = <T,>(k: string): T | undefined => {
  const e = store.peek(k);
  return e?.ok ? (e.data?.body as T) : undefined;
};
setHomeExtras(() => homeExtraKeys(peekBody, homePicks(peekBody, store.featured)));
setMapExtras(() => mapMetaKeys(peekBody));
// Tools → Rounds: the set file (a static asset). Every link to it, including the always-visible Tools tab
// (the default set), prefetches it like any other page's data.
setRoundKeys(roundSetKeys);
// Boss stats page: bosses.json, a static content-hashed asset fetched and prefetched through the store the same way.
setBossStatsUrl(BOSS_STATS_URL);
export { BOSS_STATS_URL };

/**
 * Re-read the hot bundle (if older than a minute), then top up what the home page shows beyond it. The header's
 * "Now" link is always on screen, but its IntersectionObserver fired before the lists (and so the featured
 * events) were known; this keeps it instant.
 */
export function refreshNow(force = false): Promise<void> {
  return store.loadNow(force).then(() => store.want(needs({ name: "home" })));
}

// ─────────────────────────────── route state

type RouteListener = (r: Route) => void;
const routeListeners = new Set<RouteListener>();
export let route: Route = parse(new URL(location.href));

export function onRoute(fn: RouteListener): () => void {
  routeListeners.add(fn);
  return () => routeListeners.delete(fn);
}

/** Navigation timing, exposed for the on-page badge and for automated checks (window.__nav). */
export interface NavTiming {
  href: string;
  /** Click → DOM committed. */
  renderMs: number;
  /** Click → next frame painted. */
  paintMs: number;
  /** All data the page needs was already in memory at click time. */
  cached: boolean;
}
export const navLog: NavTiming[] = [];
(globalThis as any).__nav = navLog;
/** Diagnostics for scripts/e2e.ts and the console: which keys a link needs and what the store holds. */
(globalThis as any).__debug = { store: () => store, needsForHref };
let pending: { href: string; t0: number; cached: boolean; section?: Element | null } | null = null;

/**
 * `keepScroll`: stay where the reader is (tab switches within a page: Normal/Elite, player count, CT tabs,
 * odyssey difficulty). Everything else starts at the top.
 */
/** Where an in-site click came from, kept in the history entry it opened: drives the "‹ Back to …" link. */
export interface BackTo {
  href: string;
  label: string;
}
let backLabeler: (r: Route) => string = () => "Back";
/** main.tsx registers how a page is named in the back link (its title, plus tab / page). */
export function setBackLabeler(fn: (r: Route) => string): void {
  backLabeler = fn;
}
/** How a page is named in a back link ("Vortex #47 Elite"). */
export const pageLabel = (r: Route): string => backLabeler(r);
/** The page this history entry was opened from, if it was opened by a click inside the site. */
export function backTo(): BackTo | undefined {
  const f = (history.state as { from?: BackTo } | null)?.from;
  return f && typeof f.href === "string" && typeof f.label === "string" ? f : undefined;
}

export function navigate(to: string, opts: { replace?: boolean; keepScroll?: boolean; scrollY?: number } = {}): void {
  const url = new URL(to, location.href);
  const next = parse(url);
  const y = opts.scrollY ?? (opts.keepScroll ? window.scrollY : 0);
  // Already here (the selected tab, the current page number, "Now" on home): no duplicate history entry.
  if (!opts.replace && url.pathname + url.search === location.pathname + location.search) {
    if (opts.scrollY !== undefined) window.scrollTo(0, y);
    return;
  }
  // A pager click (scrollY given) hands focus to the board it belongs to once the new page is in.
  const section = opts.scrollY !== undefined ? document.activeElement?.closest("section") : null;
  pending = { href: url.pathname + url.search, t0: performance.now(), cached: store.has(needs(next)), section };
  history.replaceState({ ...(history.state ?? {}), scrollY: window.scrollY }, "");
  const from: BackTo | undefined = opts.replace ? backTo() : { href: location.pathname + location.search, label: backLabeler(route) };
  if (opts.replace) history.replaceState({ scrollY: y, from }, "", url);
  else history.pushState({ scrollY: y, from }, "", url);
  setRoute(next, y);
}

function setRoute(r: Route, scrollY: number): void {
  route = r;
  for (const fn of routeListeners) fn(r);
  // Restore after the synchronous render below has committed.
  queueMicrotask(() => window.scrollTo(0, scrollY));
  void refreshNow(); // re-read the hot bundle if it's older than a minute
  void store.want(needs(r));
}

/** Called by <App> in a layout effect once the new route is in the DOM. */
export function routeCommitted(): void {
  if (!pending) return;
  const p = pending;
  pending = null;
  const renderMs = performance.now() - p.t0;
  keepFocus(p.section);
  requestAnimationFrame(() => {
    const paintMs = performance.now() - p.t0;
    navLog.push({ href: p.href, renderMs, paintMs, cached: p.cached });
  });
}
/**
 * After a route commits, keyboard / screen-reader users must not be left on <body> (the clicked link was unmounted).
 * If focus was lost, move it to the page's h1 (else <main>) without scrolling; a pager click moves it to its board.
 * Scroll handling stays with setRoute.
 */
function keepFocus(section?: Element | null): void {
  const a = document.activeElement;
  const lost = !a || a === document.body || !a.isConnected;
  const target = section?.isConnected ? (section as HTMLElement) : lost ? (document.querySelector<HTMLElement>("main h1") ?? document.getElementById("main")) : null;
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

addEventListener("popstate", (e) => {
  pending = { href: location.pathname + location.search, t0: performance.now(), cached: store.has(needs(parse(new URL(location.href)))) };
  setRoute(parse(new URL(location.href)), (e.state as { scrollY?: number } | null)?.scrollY ?? 0);
});
history.scrollRestoration = "manual";

// ─────────────────────────────── prefetching

/**
 * Every link on screen prefetches its target's data; everything that becomes visible in the same frame is
 * merged by the store into one /api/batch call. Two observers:
 *  - navigation links (tabs, pagers, event cards…): prefetched a full screen ahead, so they're always ready;
 *  - player/team/challenge links (leaderboard and challenge-list rows: up to 25+ per page, each a separate NK request upstream):
 *    prefetched once actually on screen for ROW_DWELL_MS. Scrolling past doesn't fetch, and NK's rate
 *    limit isn't hit by a fast scroll through a 1000-row leaderboard. Hover/touch still fetch instantly.
 */
const hrefOf = new WeakMap<Element, string>();
const saveData = (navigator as any).connection?.saveData === true;
const ROW_DWELL_MS = 250;
// Challenge rows (up to 25 per list page) are each an upstream request too.
const isRowLink = (h: string) => /^\/(player|team|challenge)\//.test(h);
const canObserve = typeof IntersectionObserver !== "undefined";

const aheadObserver = canObserve
  ? new IntersectionObserver(
      (items) => {
        const keys: string[] = [];
        for (const it of items) {
          if (!it.isIntersecting) continue;
          const h = hrefOf.get(it.target);
          if (h) keys.push(...needsForHref(h));
        }
        if (keys.length) void store.want(keys);
      },
      { rootMargin: "100% 0px" },
    )
  : null;

const dwell = new Map<Element, ReturnType<typeof setTimeout>>();
const rowObserver = canObserve
  ? new IntersectionObserver((items) => {
      for (const it of items) {
        const pending = dwell.get(it.target);
        if (!it.isIntersecting) {
          if (pending) clearTimeout(pending);
          dwell.delete(it.target);
          continue;
        }
        if (pending) continue;
        dwell.set(
          it.target,
          setTimeout(() => {
            dwell.delete(it.target);
            const h = hrefOf.get(it.target);
            if (h) void store.want(needsForHref(h)); // rows landing together still share one batch
          }, ROW_DWELL_MS),
        );
      }
    })
  : null;

export function watchLink(el: Element, h: string): () => void {
  const observer = isRowLink(h) ? rowObserver : aheadObserver;
  if (!observer || saveData) return () => {};
  hrefOf.set(el, h);
  observer.observe(el);
  return () => {
    observer.unobserve(el);
    const pending = dwell.get(el);
    if (pending) clearTimeout(pending);
    dwell.delete(el);
  };
}

/** Pointer/touch/focus intent: fetch now, ahead of anything queued for idle. */
export function intent(h: string): void {
  void store.want(needsForHref(h));
  warmFor(parse(new URL(h, location.href)).name);
}
