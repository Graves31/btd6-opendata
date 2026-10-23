import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ScorePart } from "../../src/nk/types.ts";
import { fmtClock, fmtDate, fmtPart, fmtSpan, fmtWhen, partLabel, status, tzLabel } from "./format.ts";
import { bracketLabel, medalArt, medalName, medalTier, type Board } from "./medals.ts";
import { backTo, intent, navigate, store, watchLink } from "./nav.ts";
import { hasArt, Spr } from "./sprite.tsx";
import type { ClientEntry } from "./store.ts";
import { ErrorPanel, whatOfKey } from "./views/errors.tsx";

// ─────────────────────────────── links: every link prefetches its target while visible

export function A(props: {
  href: string;
  class?: string;
  title?: string;
  children: ComponentChildren;
  current?: boolean;
  label?: string;
  keepScroll?: boolean;
  /** Pager links: land at the top of the enclosing section (the leaderboard) if the reader is below it. */
  toSection?: boolean;
  /** false: prefetch on intent only, not when on screen (links that change as you type). */
  watch?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => (props.watch !== false && ref.current ? watchLink(ref.current, props.href) : undefined), [props.href, props.watch]);
  return (
    <a
      ref={ref}
      href={props.href}
      class={props.class}
      title={props.title}
      aria-label={props.label}
      aria-current={props.current ? "page" : undefined}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(props.href, { keepScroll: props.keepScroll, scrollY: props.toSection ? sectionTop(e.currentTarget as Element) : undefined });
      }}
      onPointerEnter={() => intent(props.href)}
      onTouchStart={() => intent(props.href)}
      onFocus={() => intent(props.href)}
    >
      {props.children}
    </a>
  );
}

/** Height of the header when it covers the top of the viewport (sticky); 0 where it scrolls away (phones). */
function stickyHeader(): number {
  const top = document.querySelector<HTMLElement>(".top");
  return top && getComputedStyle(top).position !== "static" && getComputedStyle(top).position !== "relative" ? top.getBoundingClientRect().height : 0;
}

/**
 * Phones: the rules sit below the leaderboard. This jumps straight to them and moves focus there, so the next Tab
 * starts in the rules, not back in the leaderboard. Hidden on wide screens, where the rules are already beside the board.
 */
export function JumpToRules() {
  return (
    <a
      href="#rules"
      class="jump-rules"
      onClick={(e) => {
        e.preventDefault();
        const el = document.getElementById("rules");
        if (!el) return;
        const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyHeader() - 8, behavior: smooth ? "smooth" : "auto" });
        el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
      }}
    >
      Rules <span aria-hidden="true">↓</span>
    </a>
  );
}

/** Scroll target for a pager click: the top of its section (under the sticky header), or stay if already above it. */
function sectionTop(el: Element): number {
  const sec = el.closest("section") ?? el;
  const top = sec.getBoundingClientRect().top + window.scrollY - stickyHeader() - 12;
  return Math.max(0, Math.min(window.scrollY, top));
}

/**
 * A leaderboard row that opens `href` wherever it's clicked. The name inside stays a real link (keyboard,
 * screen readers, right-click); ctrl/cmd/shift/middle click opens a new tab; selecting text doesn't navigate.
 * Hovering the row prefetches the profile like hovering the link would.
 */
export function LinkRow(props: { href: string; class?: string; children: ComponentChildren; as?: "tr" | "li" }) {
  const open = (e: MouseEvent) => {
    if ((e.target as Element).closest("a")) return; // real links handle themselves
    if (getSelection()?.toString()) return;
    if (e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(props.href, "_blank", "noopener");
      return;
    }
    if (e.button === 0) navigate(props.href);
  };
  const Tag = props.as ?? "tr";
  return (
    <Tag class={`linkrow${props.class ? ` ${props.class}` : ""}`} onClick={open} onAuxClick={open} onPointerEnter={() => intent(props.href)}>
      {props.children}
    </Tag>
  );
}

/**
 * Progressive first paint for long pages: false on a page's first render when the navigation lands at the top,
 * true one frame later (Preact runs effects after paint). Views render what's in the first screen now and the rest
 * (rows below the fold, the rules column) in the next frame, so a click paints as fast as a short page. When the
 * navigation restores a scroll position (back/forward, pager), everything renders at once so the page is tall
 * enough to scroll to it.
 */
export function useFullRender(): boolean {
  const [full, setFull] = useState(() => ((history.state as { scrollY?: number } | null)?.scrollY ?? 0) > 0);
  useEffect(() => {
    if (!full) setFull(true);
  }, []);
  return full;
}

// ─────────────────────────────── data access

export const peek = (key: string): ClientEntry | undefined => store.peek(key);
/** The NK envelope body, or undefined while loading / on error. */
export function body<T>(key: string): T | undefined {
  const e = store.peek(key);
  return e?.ok ? (e.data?.body as T) : undefined;
}

/**
 * Loading / error / empty states for one key. Returns null when the data is ready. (FE-B owns this function.)
 * Errors go through ErrorPanel/NotFound with human wording; both the NK envelope ({success:false, error}) and the
 * Worker's {error, code} shape are read. Rate-limited keys (the store keeps no entry for a 429) show a
 * "retrying…" panel and are re-requested when the back-off ends; a load that hangs offers a retry.
 */
export function Gate(props: { k: string; rows?: number; empty?: ComponentChildren }) {
  const e = store.peek(props.k);
  const [, tick] = useState(0);
  // Store internals (read-only): back-off deadline and whether a request is queued/in flight.
  const ls = e ? null : store.loadState(props.k);
  const retryAt = ls?.retryAt ?? 0;
  const busy = !!ls?.busy;
  const [since] = useState(() => Date.now());
  useEffect(() => {
    if (e) return;
    const left = retryAt - Date.now();
    const t = setTimeout(
      () => {
        if (retryAt > 0 && Date.now() >= retryAt && !busy) void store.want([props.k]); // the back-off just ended: ask once more
        tick((x) => x + 1);
      },
      // counting down: wake every second so the "in about N s" text moves; the last wake lands just after the deadline
      left > 0 ? Math.min(1000, left + 50) : 1000,
    );
    return () => clearTimeout(t);
  });
  useEffect(() => {
    // Back online: ask again at once instead of waiting for the next poll.
    if (e) return;
    const on = () => void store.want([props.k]).then(() => tick((x) => x + 1));
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [e, props.k]);
  if (!e) {
    const now = Date.now();
    if (retryAt > now) return <ErrorPanel status={429} what={whatOfKey(props.k)} retryIn={(retryAt - now) / 1000} />;
    // Nothing arrived and nothing is on its way (upstream 5xx / network): say so after a short grace period.
    if (!busy && now - since > 4000) {
      const retry = () => void store.want([props.k]).then(() => tick((x) => x + 1));
      if (typeof navigator !== "undefined" && navigator.onLine === false) return <OfflinePanel onRetry={retry} />;
      return <ErrorPanel status={503} what={whatOfKey(props.k)} onRetry={retry} />;
    }
    return <Skeleton rows={props.rows ?? 6} what={props.k} />;
  }
  if (!e.ok) {
    const d = (e.data ?? {}) as { error?: unknown; code?: unknown; status?: unknown; retryAfter?: unknown };
    const msg = typeof d.error === "string" ? d.error : "";
    if (msg === "No Scores Available" || d.code === "no_scores") return <div class="empty">{props.empty ?? <p>No scores yet.</p>}</div>;
    return (
      <ErrorPanel
        message={msg || undefined}
        code={typeof d.code === "string" ? d.code : undefined}
        status={typeof d.status === "number" ? d.status : undefined}
        what={whatOfKey(props.k)}
        retryIn={typeof d.retryAfter === "number" ? d.retryAfter : undefined}
        onRetry={() => void store.want([props.k])}
      />
    );
  }
  return null;
}

/** No connection: the fault is on this side, not Ninja Kiwi's (same panel look as views/errors.tsx). */
function OfflinePanel(p: { onRetry: () => void }) {
  return (
    <section class="oops oops-info">
      <span class="oops-art" aria-hidden="true">
        <Spr family="bloon" k="moab" size={72} label />
      </span>
      <div class="oops-t">
        <p class="oops-k">Offline</p>
        <h2 class="oops-h">You're offline</h2>
        <div class="oops-p">
          <p>Pages you've opened before still work. This one fills in when you're back online.</p>
        </div>
        <p class="oops-a">
          <button type="button" class="oops-btn" onClick={p.onRetry}>
            Try again
          </button>
        </p>
      </div>
    </section>
  );
}

/** Placeholder rows while a page loads. `what`: a store key, to say what is loading to screen readers. */
export const Skeleton = (p: { rows: number; what?: string }) => (
  <div class="skeleton" role="status" aria-busy="true">
    <span class="vh">Loading{p.what ? ` ${whatOfKey(p.what)}` : ""}…</span>
    {Array.from({ length: p.rows }, (_, i) => (
      <div key={i} class="sk-row" aria-hidden="true" />
    ))}
  </div>
);

// ─────────────────────────────── images (NK assets are content-addressed: hotlink, never proxy)

export function Img(props: { src?: string | null; w: number; h: number; alt?: string; class?: string; eager?: boolean; fallback?: ComponentChildren }) {
  const [broken, setBroken] = useState(false);
  if ((!props.src || broken) && props.fallback) return <>{props.fallback}</>;
  if (!props.src || broken) return <span class={`img-missing ${props.class ?? ""}`} style={{ aspectRatio: `${props.w} / ${props.h}` }} aria-hidden="true" />;
  return (
    <img
      src={props.src}
      alt={props.alt ?? ""}
      width={props.w}
      height={props.h}
      class={props.class}
      loading={props.eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

/** A team emblem is two layered assets: frame behind icon. */
export function Emblem(props: { frame?: string; icon?: string; size: number; eager?: boolean }) {
  return (
    <span class="emblem" style={{ width: `${props.size}px`, height: `${props.size}px` }}>
      {props.frame && <Img src={props.frame} w={props.size} h={props.size} eager={props.eager} />}
      {props.icon && <Img src={props.icon} w={props.size} h={props.size} eager={props.eager} />}
    </span>
  );
}

// ─────────────────────────────── time

/** One shared timer per period; each stops when no clock on the page uses it. */
const tickers = new Map<number, { subs: Set<() => void>; timer: ReturnType<typeof setInterval> }>();
/** Re-render every `ms` (default once a second) from the shared timer for that period. */
function useTick(ms = 1000): number {
  const [, set] = useState(0);
  useEffect(() => {
    const fn = () => set((x) => x + 1);
    let t = tickers.get(ms);
    if (!t) tickers.set(ms, (t = { subs: new Set(), timer: setInterval(() => tickers.get(ms)?.subs.forEach((f) => f()), ms) }));
    t.subs.add(fn);
    return () => {
      t.subs.delete(fn);
      if (!t.subs.size) {
        clearInterval(t.timer);
        tickers.delete(ms);
      }
    };
  }, [ms]);
  return Date.now();
}

const STATUS_WORD = { live: "Live", upcoming: "Soon", ended: "Ended" } as const;

/**
 * A ticking clock whose width never changes: every digit sits in a 1ch cell. The display font has no
 * tabular figures, so `font-variant-numeric: tabular-nums` alone let the box twitch every second.
 */
const Digits = (p: { s: string }) => <>{[...p.s].map((ch, i) => (/\d/.test(ch) ? <i key={i}>{ch}</i> : ch))}</>;

/** "ENDED | 2 D AGO": the live bug with the neutral fill. `ms` = time since the end. `sm`: list-row size. */
export function EndedBug(props: { ms: number; big?: boolean; sm?: boolean }) {
  const days = Math.floor(props.ms / 86_400_000);
  const ago = `${days >= 1 ? `${days} d` : fmtSpan(props.ms)} ago`;
  return (
    <span class={`bug ended${props.big ? " big" : ""}${props.sm ? " sm" : ""}`} role="timer" aria-label={`Ended ${ago}`}>
      <span class="bug-s" aria-hidden="true">
        Ended
      </span>
      <span class="bug-t" aria-hidden="true">
        <span class="bug-c">{ago}</span>
      </span>
    </span>
  );
}

/** Event-type logo (family "eventIcon"): renders nothing until the art exists, so callers can always place it. */
export function EvIcon(props: { k: string; size: number }) {
  return hasArt("eventIcon", props.k) ? <Spr family="eventIcon" k={props.k} size={props.size} label optional class="ev-icon" /> : null;
}

/** The score bug: status block + running clock. */
export function Bug(props: { start: number; end: number; big?: boolean }) {
  const now = useTick();
  const st = status(props.start, props.end, now);
  const [lead, ms] = st.s === "live" ? ["ends in", props.end - now] : st.s === "upcoming" ? ["starts in", props.start - now] : ["", now - props.end];
  // Ended: the same box, neutral fill, "ENDED | 2 D AGO" (whole days once past a day).
  if (st.s === "ended") return <EndedBug ms={ms} big={props.big} />;
  return (
    <span class={`bug ${st.s}${props.big ? " big" : ""}`} role="timer" aria-label={`${STATUS_WORD[st.s]}, ${st.label}`}>
      <span class="bug-s" aria-hidden="true">
        {STATUS_WORD[st.s]}
      </span>
      <span class="bug-t" aria-hidden="true">
        {lead && <span class="bug-l">{lead}</span>} <span class="bug-c"><Digits s={fmtClock(ms)} /></span>
      </span>
    </span>
  );
}

/** Small status label for lists and tables. Re-checked every 30 s, so an event that starts or ends flips on a page left open. */
export function StatusBadge(props: { start: number; end: number }) {
  const st = status(props.start, props.end, useTick(30_000));
  if (st.s === "ended") return <EndedBug ms={Date.now() - props.end} sm />;
  return <span class={`st ${st.s}`}>{st.label}</span>;
}

/** tzLabel builds an Intl formatter per call; the zone label only changes at DST switches, so memoise per hour. */
const tzMemo = new Map<number, string>();
function tzAt(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  let v = tzMemo.get(h);
  if (v === undefined) tzMemo.set(h, (v = tzLabel(ms)));
  return v;
}

/** Absolute start → end in the viewer's time zone (labelled with the zone the start date is in: CET vs CEST). */
export function When(props: { start: number; end: number }) {
  const tz = tzAt(props.start);
  return (
    <span class="when">
      <time dateTime={new Date(props.start).toISOString()}>{fmtWhen(props.start)}</time>
      <span class="arrow" aria-hidden="true"> → </span>
      <span class="vh"> to </span>
      <time dateTime={new Date(props.end).toISOString()}>{fmtWhen(props.end)}</time>
      {tz && <span class="tz"> {tz}</span>}
    </span>
  );
}

// ─────────────────────────────── small components

export function Tabs(props: { label: string; class?: string; items: { href: string; label: ComponentChildren; current: boolean; hint?: string; hintUnit?: string }[] }) {
  return (
    <nav class={props.class ? `tabs ${props.class}` : "tabs"} aria-label={props.label}>
      {props.items.map((t) => (
        <A key={t.href} href={t.href} class={t.current ? "tab on" : "tab"} current={t.current} keepScroll>
          {t.label}
          {t.hint && (
            <span class="tab-hint">
              <span class="vh">, </span>
              {t.hint}
              {t.hintUnit && <span class="vh"> {t.hintUnit}</span>}
            </span>
          )}
        </A>
      ))}
    </nav>
  );
}

/** Which page links a pager shows with a window of `w` pages around the current one. */
function pagerLayout(page: number, max: number, w: number) {
  const from = Math.max(1, Math.min(page - Math.floor(w / 2), max - w + 1));
  const to = Math.min(max, from + w - 1);
  return { from, to, first: from > 1, gapL: from > 2, gapR: to < max - 1, last: to < max };
}

/**
 * First, previous, a window of pages, next, last. All links prefetch while visible. Phones get a 3-page window
 * (5 on wider screens) so the row never wraps at 390 px; both layouts share one DOM, the extra links carry
 * `pg-d` (wide only) or `pg-m` (phones only).
 */
export function Pager(props: { page: number; maxPages: number; to: (p: number) => string }) {
  const { page, maxPages, to } = props;
  if (maxPages <= 1) return null;
  const d = pagerLayout(page, maxPages, 5);
  const m = pagerLayout(page, maxPages, 3);
  const shown = (l: typeof d, x: number) => (x >= l.from && x <= l.to) || (x === 1 && l.first) || (x === maxPages && l.last);
  const vis = (inD: boolean, inM: boolean) => (inD && inM ? "" : inD ? "pg-d" : "pg-m");
  const nums = [...new Set([1, d.from, m.from, ...Array.from({ length: maxPages }, (_, i) => i + 1).filter((x) => x >= Math.min(d.from, m.from) && x <= Math.max(d.to, m.to)), maxPages])]
    .filter((x) => shown(d, x) || shown(m, x))
    .sort((a, b) => a - b);
  const items: ComponentChildren[] = [];
  for (const x of nums) {
    const cls = [vis(shown(d, x), shown(m, x)), x === page ? "on" : ""].filter(Boolean).join(" ") || undefined;
    items.push(
      <A key={x} href={to(x)} class={cls} current={x === page} toSection>
        {x}
      </A>,
    );
    if (x === 1 && (d.gapL || m.gapL)) items.push(<span key="gl" class={`gap ${vis(d.gapL, m.gapL)}`} aria-hidden="true">…</span>);
    if (x !== maxPages && nums[nums.indexOf(x) + 1] === maxPages && (d.gapR || m.gapR)) {
      items.push(<span key="gr" class={`gap ${vis(d.gapR, m.gapR)}`} aria-hidden="true">…</span>);
    }
  }
  return (
    <nav class="pager" aria-label="Pages">
      {page > 1 ? (
        <A href={to(page - 1)} label="Previous page" toSection>
          <span aria-hidden="true">‹</span>
        </A>
      ) : (
        <span class="off" aria-hidden="true">‹</span>
      )}
      {items}
      {page < maxPages ? (
        <A href={to(page + 1)} label="Next page" toSection>
          <span aria-hidden="true">›</span>
        </A>
      ) : (
        <span class="off" aria-hidden="true">›</span>
      )}
    </nav>
  );
}

/**
 * Rank cell: the medal this placement earns (per leaderboard type, see medals.ts), then the rank plate;
 * 1/2/3 get podium plates. `total` = the board's entry count, needed for the "Top N%" medals.
 */
export function Rank(p: { n: number | null; board?: Board; total?: number; approx?: boolean; medal?: boolean }) {
  // An estimated rank (co-op page opened without the pages before it) gets no medal: it could be the wrong one.
  // `medal: false`: the row repeats the medal of the row above (leaderboards show it once per bracket per page).
  const tier = p.n !== null && p.board && !p.approx && p.medal !== false ? medalTier(p.board, p.n, p.total) : undefined;
  return (
    <td class="rank">
      {p.n !== null && (
        <span class="rank-in">
          {p.board && (
            <span class="medal-slot">
              {tier && (
                <Spr
                  family="eventMedal"
                  k={medalArt(p.board, tier)}
                  size={28}
                  name={`${medalName(p.board, tier)} medal (${bracketLabel(p.board, tier)})`}
                />
              )}
            </span>
          )}
          {p.approx ? (
            <span class="plate approx" title="About this rank: open the earlier pages for the exact one (co-op teams can be short)">
              <span aria-hidden="true">≈{p.n}</span>
              <span class="vh">About rank {p.n}: open the earlier pages for the exact one</span>
            </span>
          ) : (
            <span class={p.n <= 3 ? `plate p${p.n}` : "plate"}>{p.n}</span>
          )}
        </span>
      )}
    </td>
  );
}

/** One-line note under a board that shows "≈" ranks (the tooltip alone is out of reach on touch screens). */
export const ApproxNote = () => <p class="approx-note quiet">≈ ranks are estimates: open the earlier pages for the exact ones.</p>;

/** Scoring icon (ui family) for a score part / scoring type. */
export const PART_ICON: Record<string, string> = {
  "Boss Tier": "BossTier",
  "Least Cash": "LeastCash",
  "Least Tiers": "LeastTiers",
  "Game Time": "GameTime",
  LeastCash: "LeastCash",
  LeastTiers: "LeastTiers",
  GameTime: "GameTime",
};

/** Leaderboard column header: 20 px icon + text. Boss Tier is a narrow column. */
export function PartHead(props: { name: string; class?: string; title?: string; sub?: string }) {
  const icon = PART_ICON[props.name];
  const tier = props.name === "Boss Tier";
  return (
    <th class={`num${tier ? " tiercol" : ""}${props.class ? ` ${props.class}` : ""}`} title={props.title ?? (tier ? "Highest boss tier defeated" : undefined)}>
      <span class="th-i">
        {icon && <Spr family="ui" k={icon} size={20} label optional />}
        <span class="th-t">{partLabel(props.name)}</span>
      </span>
      {/* phones: the name of the part stacked under this column's values (Parts `stack`) */}
      {props.sub && <span class="m-sub th-sub">{partLabel(props.sub)}</span>}
    </th>
  );
}

/**
 * Score cells. `stack`: on phones that part's column is hidden and its value shown as a second line under the
 * first non-tier part, so a board never needs sideways scrolling. `hero`: the part that tells the story (cash on
 * Least Cash, time on Fastest Time), drawn big; `gap` rides under it (how far behind #1). `topTier`: the page's
 * best boss tier; a lower tier is set in full ink so the difference shows by its number, not colour alone.
 */
export function Parts(props: { parts: ScorePart[]; opt?: string[]; stack?: string; start?: number; hero?: string; gap?: string; topTier?: number }) {
  const under = props.stack ? props.parts.find((p) => p.name === props.stack) : undefined;
  const host = props.parts.findIndex((p) => p.name !== "Boss Tier" && p.name !== props.stack);
  const heroAt = props.hero ? props.parts.findIndex((p) => p.name === props.hero) : 0;
  return (
    <>
      {props.parts.map((p, i) => {
        const tier = p.name === "Boss Tier";
        const low = tier && props.topTier !== undefined && p.score < props.topTier;
        return (
          <td
            key={p.name}
            class={`num${i === heroAt ? " lead hero" : ""}${tier ? " tiercol" : ""}${low ? " low" : ""}${props.opt?.includes(p.name) ? " opt" : ""}${p.name === props.stack ? " m-hide" : ""}`}
          >
            {tier ? p.score : p.name === SUBMITTED ? <Submitted offset={p.score} start={props.start} /> : fmtPart(p)}
            {under && i === host && (
              <span class="m-sub">
                <span class="vh">{partLabel(under.name)} </span>
                {fmtPart(under)}
              </span>
            )}
            {props.gap && i === heroAt && <span class={under && i === host ? "gap m-gap" : "gap"} title="Behind #1">
                <span class="vh">behind #1 by </span>
                {props.gap}
              </span>}
          </td>
        );
      })}
    </>
  );
}

const SUBMITTED = "Time after event start";

/**
 * When a run was submitted: NK gives the offset from the event start ("+5d 17h"). Shown as a local date and
 * time once the start is known; the raw offset stays in the tooltip.
 */
export function Submitted(p: { offset: number; start?: number }) {
  const raw = fmtPart({ name: SUBMITTED, type: "time", score: p.offset });
  if (!p.start) return <>{raw}</>;
  const at = p.start + p.offset;
  return (
    <time class="subm" dateTime={new Date(at).toISOString()} title={`${raw} after the event start`}>
      {fmtDate(at)}
    </time>
  );
}

export const Fact = (p: { k: ComponentChildren; v: ComponentChildren; note?: ComponentChildren }) => (
  <div class="fact">
    <dt>{p.k}</dt>
    <dd>
      {p.v}
      {p.note && <span class="fact-note"> {p.note}</span>}
    </dd>
  </div>
);

/** Big number with a label (scoreboard stat). */
export const Stat = (p: { k: ComponentChildren; v: ComponentChildren; note?: ComponentChildren; accent?: boolean }) => (
  <div class={p.accent ? "stat accent" : "stat"}>
    <dt>{p.k}</dt>
    <dd>
      <span class="stat-v">{p.v}</span>
      {p.note && <span class="stat-note">{p.note}</span>}
    </dd>
  </div>
);

export function Section(props: { title: ComponentChildren; aside?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`sec ${props.class ?? ""}`}>
      <header class="sec-h">
        <h2>{props.title}</h2>
        {props.aside && <span class="sec-aside">{props.aside}</span>}
      </header>
      {props.children}
    </section>
  );
}


/**
 * A tool page's title card (the template for every tool, see CLAUDE.md): its art, a big title, one line on what it
 * does, and an optional strip of game icons or buttons (right of the title on desktop, under it on phones).
 */
export function ToolHero(p: { art: ComponentChildren; eyebrow?: string; title: ComponentChildren; sub?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <header class="th">
      <span class="th-art">{p.art}</span>
      <div class="th-t">
        <p class="eyebrow">{p.eyebrow ?? "Tools"}</p>
        <h1 class="th-h1">{p.title}</h1>
        {p.sub && <p class="th-sub">{p.sub}</p>}
      </div>
      {p.children && <div class="th-x">{p.children}</div>}
    </header>
  );
}

/** A tool's back link: "‹ <page>" when a click inside the site opened it (the browser's back, scroll included), else "‹ Tools". */
export function ToolBack() {
  const b = backTo();
  if (!b || b.href === "/tools")
    return (
      <A href="/tools" class="backlink rv-back">
        <span aria-hidden="true">‹</span> Tools
      </A>
    );
  return (
    <a
      class="backlink rv-back"
      href={b.href}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        history.back();
      }}
    >
      <span aria-hidden="true">‹</span> {b.label}
    </a>
  );
}
