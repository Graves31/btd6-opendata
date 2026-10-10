// Tools → Round visualizer (/tools, /tools/rounds). A round set from the game's own data (web/src/data/rounds).
//
// Two jobs, two views (docs/round-visualizer-ux-review.md):
//  - list view: scan a range. A one-line set bar (setup behind "Edit"), filter chips ("any of"), a slim sticky
//    scrubber that follows the scroll position, one-line rows. Desktop adds a detail pane for the selected round.
//  - round view (`view=round`): one round, full width: big ‹ ›, swipe, next/previous match, "Up next".
// One scroll context: the page. Nothing here is an inner scroller (the Edit sheet on phones is a modal).
// The URL is the whole view. Control changes replace the history entry; opening a round from the list on a phone
// (and [Focus] on desktop) pushes one, so Back returns to the list where it was. Everything is computed from the
// set file already in the store, so every switch is instant.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { BLOON_TYPES, GAME_VERSION, ROUND_SETS, type Round, type RoundSetData, type RoundSetInfo } from "../data/rounds/index.ts";
import { fmtInt } from "../format.ts";
import { backTo, navigate, pageLabel, store } from "../nav.ts";
import { href, parse, type HasFilter, type RoundMods, type RoundsRoute } from "../routes.ts";
import {
  activeFilters,
  activeMods,
  bloonLabel,
  bounds,
  changedRuns,
  distinctBloons,
  effGroups,
  filtering,
  flagWords,
  groupMatches,
  modeMoabHealth,
  moabMult,
  pickSet,
  roundCount,
  roundMatches,
  roundRbeParts,
  setIcon,
  setLabel,
  spawnEnd,
  typesInRange,
  type Filters,
} from "../rounds.ts";
import { gameDefaults } from "../rules.tsx";
import { hasArt, MODE_NAME, Spr } from "../sprite.tsx";
import { A, useFullRender } from "../ui.tsx";

// ─────────────────────────────── titles

const rangeTitle = (info: RoundSetInfo, from: number, to: number) => {
  const name = setLabel(info);
  if (from === to) return `${name.replace(/ rounds$/i, "")} round ${from}`;
  return `${/rounds$/i.test(name) ? name : `${name} rounds`} ${from}–${to}`;
};

/** Browser-tab title: "Vortex rounds 1–140", or "Vortex round 40" in the round view. */
export function roundsTitle(r: RoundsRoute): string {
  const p = pickSet(r);
  if (p.kind !== "set") return "Round visualizer";
  const { from, to, open } = bounds(p.info, r);
  if (r.view === "round") return rangeTitle(p.info, open ?? from, open ?? from);
  return rangeTitle(p.info, from, to);
}

/** Boss type of the route's set (the page takes that boss's tint). */
export function roundsBoss(r: RoundsRoute): string | undefined {
  const p = pickSet(r);
  return p.kind === "set" ? p.info.boss : undefined;
}

const GROUPS: [RoundSetInfo["group"], string][] = [
  ["standard", "Standard"],
  ["boss", "Boss events"],
  ["other", "Other game modes"],
  ["quest", "Quests"],
  ["legends", "Legends"],
];

const secs = (s: number) => `${+s.toFixed(2)}s`;
const mult = (n: number) => `${+(n * 100).toFixed(1)}%`;
const changedText = (info: RoundSetInfo) => `changed by the ${info.name} set`;

// ─────────────────────────────── sprites

/**
 * A bloon as the game draws it: the variant sprite (camo / regrow / fortified) when the game has one, else the
 * base sprite plus the variant words as a text flag. Accessible name: "Camo regrow ceramic ×12".
 */
export function BloonSpr(p: { k: string; flags: number; size: number; count?: number; label?: boolean; dim?: boolean }) {
  const t = BLOON_TYPES[p.k];
  const name = bloonLabel(p.k, p.flags);
  let family = "bloon";
  let key = t?.sprite ?? p.k;
  let flagText = "";
  if (p.flags) {
    const icon = t?.icons[String(p.flags)];
    const vk = `${p.k}:${p.flags}`;
    if (icon && icon === t!.icons["0"]) {
      // the game draws this variant with the plain icon (e.g. a camo DDT)
    } else if (icon && hasArt("bloonVariant", vk)) {
      family = "bloonVariant";
      key = vk;
    } else {
      flagText = flagWords(p.flags).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" · ");
    }
  }
  const s = <Spr family={family} k={key} size={p.size} name={name} count={p.count} label={p.label} class={p.dim ? "dim" : undefined} />;
  if (!flagText) return s;
  return (
    <span class={`bspr${p.dim ? " dim" : ""}`}>
      {s}
      <span class="bflag" aria-hidden="true">
        {flagText}
      </span>
    </span>
  );
}

// ─────────────────────────────── helpers

function useMedia(q: string): boolean {
  const [m, set] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => set(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

const DESKTOP = "(min-width: 1024px)";

interface Chip {
  fam: string;
  icon: string;
  label: string;
  applied: boolean;
  note?: string;
}

/** Every modifier in the URL as a chip: applied, or muted with "not applied" (seen, but the data can't show it). */
function modChips(r: RoundsRoute, info: RoundSetInfo | undefined): Chip[] {
  const m = r.mods;
  const out: Chip[] = [];
  const moabOk = !!info?.hasRbe;
  if (m.camo) out.push({ fam: "ui", icon: "AllCamo", label: "Camo", applied: true });
  if (m.regrow) out.push({ fam: "ui", icon: "AllRegen", label: "Regrow", applied: true });
  if (m.fort) out.push({ fam: "bloon", icon: "fortified", label: "Fortified", applied: true });
  const hp = (v: number, up: string, down: string, label: string, applied: boolean, note?: string) => {
    if (v !== 1) out.push({ fam: "ui", icon: v > 1 ? up : down, label: `${label} ${mult(v)}`, applied, note });
  };
  hp(m.mhp, "MoabBoost", "MoabDecreaseHP", "MOAB health", moabOk, moabOk ? "applied to RBE" : undefined);
  hp(m.hp, "BloonBoost", "BloonDecreaseHP", "Bloon health", false);
  hp(m.bhp, "BossBoost", "BossDecreaseHP", "Boss health", false);
  const modeMoab = modeMoabHealth(r.mode);
  if (modeMoab !== 1) {
    const name = MODE_NAME[r.mode!] ?? r.mode!;
    const ok = moabOk && m.mhp === 1;
    out.push({ fam: "ui", icon: `mode:${r.mode}`, label: `${name}: MOAB health ${mult(modeMoab)}`, applied: ok, note: ok ? "applied to RBE" : undefined });
  }
  const sp = (v: number, up: string, down: string, label: string) => {
    if (v !== 1) out.push({ fam: "ui", icon: v > 1 ? up : down, label: `${label} ${mult(v)}`, applied: false, note: "depends on the map" });
  };
  sp(m.spd, "FasterBloons", "SlowerBloons", "Bloon speed");
  sp(m.mspd, "FasterMoab", "SlowerMoab", "MOAB speed");
  sp(m.bspd, "FasterBoss", "SlowerBoss", "Boss speed");
  sp(m.rgr, "RegrowRateIncrease", "RegrowRateDecrease", "Regrow rate");
  return out;
}

/** Rounds per difficulty, from the site's own game defaults (rules.tsx). */
const PRESETS: [string, { start: number; end: number }][] = [
  ["Easy", gameDefaults("Standard", "Easy")],
  ["Medium", gameDefaults("Standard", "Medium")],
  ["Hard", gameDefaults("Standard", "Hard")],
  ["Impoppable", gameDefaults("Impoppable", "Hard")],
];

/** A round to bring into view when the list next renders (set by "‹ List" from the round view). */
let rowOnList: number | null = null;

// ─────────────────────────────── page

type Go = (patch: Partial<RoundsRoute>, opts?: { push?: boolean }) => void;

export function RoundsPage(props: { r: RoundsRoute }) {
  const r = props.r;
  const pick = pickSet(r);
  const info = pick.kind === "set" ? pick.info : undefined;
  const url = info?.url;
  const entry = url ? store.peek(url) : undefined;
  const data = entry?.ok ? (entry.data as RoundSetData) : undefined;
  useEffect(() => {
    if (url) void store.want([url]);
  }, [url]);

  const go: Go = (patch, opts = {}) => {
    const to = href.rounds({ ...r, ...patch });
    if (opts.push) navigate(to);
    else navigate(to, { replace: true, keepScroll: true });
  };

  const src = r.src;
  const back = src ? pageLabel(parse(new URL(src, location.origin))) : undefined;

  return (
    <div class="rv">
      {src && back ? (
        <A href={src} class="backlink rv-back">
          <span aria-hidden="true">‹</span> {back}
        </A>
      ) : (
        <A href={href.tools()} class="backlink rv-back">
          <span aria-hidden="true">‹</span> Tools
        </A>
      )}
      {pick.kind === "set" ? (
        <Visualizer r={r} info={info!} data={data} go={go} />
      ) : (
        <>
          <header class="rv-bar">
            <h1 class="rv-h1">Round visualizer</h1>
          </header>
          <EditForm r={r} go={go} />
          <div class="empty rv-empty">
            {pick.kind === "unknown" ? (
              <>
                <p class="empty-t">We don't have this round set yet</p>
                <p>
                  “{pick.id}” isn't a round set in the game data this site has (game v{GAME_VERSION}).{" "}
                  <A href={href.rounds({ set: "default" })}>See the default rounds</A>
                </p>
              </>
            ) : (
              <>
                <p class="empty-t">Random rounds</p>
                <p>
                  {MODE_NAME[pick.mode] ?? pick.mode} rounds are random: there are no fixed rounds to show.{" "}
                  <A href={href.rounds({ set: "default" })}>See the default rounds</A>
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Visualizer(p: { r: RoundsRoute; info: RoundSetInfo; data?: RoundSetData; go: Go }) {
  const { r, info, data, go } = p;
  const desktop = useMedia(DESKTOP);
  const setup = !r.set && !r.mode; // bare /tools: the setup form stays open
  const focus = r.view === "round";
  const { from, to, open } = bounds(info, r);
  const sel = open ?? from;
  const mods = activeMods(r);
  const moab = info.hasRbe ? moabMult(r) : 1;
  const flt = activeFilters(r, info);
  const on = filtering(flt);

  // Everything derived from the set file, for the range (pure client-side: filters and jumps never refetch).
  const rounds = data ? data.rounds.filter((x) => x.n >= from && x.n <= to) : [];
  const parts = rounds.map((x) => roundRbeParts(x, mods, moab));
  const hasRbe = parts.length > 0 && parts.every((x) => x !== undefined);
  const matches = on ? new Set(rounds.filter((x) => roundMatches(x, flt, mods)).map((x) => x.n)) : null;
  const runs = data && info.boss ? changedRuns(data.rounds, from, to) : [];
  const beforeHp = !r.base && r.mods.hp !== 1;
  const selRound = data?.rounds.find((x) => x.n === sel);

  // Sticky scrubber height → rows' scroll-margin, so a row brought into view never lands under it.
  const rootRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = stickyRef.current;
    const root = rootRef.current;
    if (!el || !root || typeof ResizeObserver === "undefined") return;
    const set = () => {
      const top = parseFloat(getComputedStyle(el).top) || 0;
      root.style.setProperty("--rv-sm", `${Math.round(top + el.offsetHeight + 6)}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop, focus]);

  // Keyboard: ←/→ step through rounds (round view, desktop), "/" focuses the jump field (desktop).
  const jumpRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus && !desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      // interaction#21: leave keys alone while focus is on a link, button, field or the scrubber slider
      const t = e.target as HTMLElement | null;
      if (t && t.closest("a, button, input, select, textarea, [contenteditable], dialog, [role=slider]")) return;
      // a11y#19 (WCAG 2.1.4): "/" only fires when nothing is focused (Ctrl/Alt/Meta variants are ignored above)
      if (e.key === "/" && jumpRef.current && (!t || t === document.body || t === document.documentElement)) {
        e.preventDefault();
        jumpRef.current.focus();
        jumpRef.current.select();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const n = Math.min(to, Math.max(from, sel + (e.key === "ArrowLeft" ? -1 : 1)));
        if (n !== sel) {
          e.preventDefault();
          go({ r: n });
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // List view: the round to bring into view (coming back from the round view; desktop jumps and keys).
  const listRef = useRef<HTMLOListElement>(null);
  const prevSel = useRef<number | null>(null); // null: not rendered with data yet
  const fromRow = useRef(false);
  useLayoutEffect(() => {
    if (focus || !data) return;
    const first = prevSel.current === null;
    const changed = prevSel.current !== sel;
    prevSel.current = sel;
    const row = (n: number) => listRef.current?.querySelector<HTMLElement>(`[data-n="${n}"]`);
    if (rowOnList !== null) {
      const n = rowOnList;
      rowOnList = null;
      // after nav.ts has applied the navigation's scroll position (queued before this render committed)
      queueMicrotask(() => row(n)?.scrollIntoView({ block: "center" }));
    } else if (!first && changed && desktop && !fromRow.current) {
      queueMicrotask(() => row(sel)?.scrollIntoView({ block: "nearest" }));
    }
    fromRow.current = false;
  }, [sel, data, focus]);

  const focusHref = (n: number) => href.rounds({ ...r, r: n, view: "round" });
  const toList = () => {
    const b = backTo();
    const prev = b ? parse(new URL(b.href, location.origin)) : undefined;
    if (prev?.name === "rounds" && prev.view !== "round" && prev.set === r.set) {
      history.back(); // the list entry we came from, at its scroll position
      return;
    }
    rowOnList = sel;
    navigate(href.rounds({ ...r, view: undefined }), { replace: true });
  };

  const [editOpen, setEditOpen] = useState(false);
  const chips = modChips(r, info);

  return (
    <div ref={rootRef} class={`rv-v${focus ? " focus" : ""}`}>
      <SetBar r={r} info={info} from={from} to={to} chips={chips} setup={setup} desktop={desktop} editOpen={editOpen} setEditOpen={setEditOpen} go={go} />
      {!focus && <FilterBar r={r} info={info} data={data} from={from} to={to} mods={mods} runs={runs} go={go} />}
      <div ref={stickyRef} class="rv-sticky">
        {focus && (
          <button type="button" class="rv-tolist" onClick={toList} aria-label="Back to the list">
            <span aria-hidden="true">‹</span>
            <span class="rv-tolist-t">List</span>
          </button>
        )}
        {data ? (
          <Strip
            key={`${info.id}:${from}:${to}:${focus}`}
            rounds={rounds}
            parts={parts}
            hasRbe={hasRbe}
            matches={matches}
            runs={runs}
            boss={info.boss ? info.name : undefined}
            sel={focus || desktop ? sel : undefined}
            follow={!focus}
            listRef={listRef}
            from={from}
            to={to}
            beforeHp={beforeHp}
            onSelect={(n) => go({ r: n })}
          />
        ) : (
          <div class="rv-strip sk" aria-hidden="true" />
        )}
        {desktop && <Jump key={`${sel}`} cur={sel} from={from} to={to} inputRef={jumpRef} go={(n) => go({ r: n })} />}
      </div>
      {focus ? (
        selRound ? (
          <RoundCard
            round={selRound}
            info={info}
            from={from}
            to={to}
            mods={mods}
            moab={moab}
            desktop={desktop}
            beforeHp={beforeHp}
            focus
            flt={on ? flt : null}
            all={data!.rounds}
            go={(n) => go({ r: n })}
          />
        ) : (
          <div class="rv-card sk" aria-hidden="true" />
        )
      ) : (
        <div class="rv-body">
          <div class="rv-listpane">
            <ListHead info={info} runs={runs} on={on} matches={matches} rounds={rounds} hasRbe={hasRbe || !data} />
            {!data ? (
              <ListSkeleton n={Math.min(12, to - from + 1)} url={info.url} />
            ) : (
              <RoundList
                listRef={listRef}
                rounds={rounds}
                parts={parts}
                matches={matches}
                flt={flt}
                mods={mods}
                info={info}
                sel={desktop ? sel : undefined}
                anchor={rowOnList ?? (desktop ? sel : from)}
                hrefFor={focusHref}
                onPick={(n, e) => {
                  e.preventDefault();
                  if (desktop) {
                    fromRow.current = true;
                    go({ r: n });
                  } else navigate(focusHref(n)); // phones: the round view, as a history entry
                }}
              />
            )}
          </div>
          {desktop && (
            <DetailPane>
              {selRound ? (
                <RoundCard
                  round={selRound}
                  info={info}
                  from={from}
                  to={to}
                  mods={mods}
                  moab={moab}
                  desktop
                  beforeHp={beforeHp}
                  flt={null}
                  all={data!.rounds}
                  go={(n) => go({ r: n })}
                  onFocus={() => navigate(focusHref(sel))}
                />
              ) : (
                <div class="rv-card sk" aria-hidden="true" />
              )}
            </DetailPane>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── set bar + Edit

function SetBar(p: {
  r: RoundsRoute;
  info: RoundSetInfo;
  from: number;
  to: number;
  chips: Chip[];
  setup: boolean;
  desktop: boolean;
  editOpen: boolean;
  setEditOpen: (v: boolean) => void;
  go: Go;
}) {
  const { r, info, chips } = p;
  const [fam, icon] = setIcon(info);
  const applied = chips.filter((c) => c.applied).map((c) => c.label);
  const na = chips.length - applied.length;
  const summary = r.base
    ? "Base rounds: the event's modifiers are off"
    : [...applied, na ? `${na} not applied` : ""].filter(Boolean).join(" · ");
  const editBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    p.setEditOpen(false);
    editBtn.current?.focus();
  };
  return (
    <>
      <header class="rv-bar">
        <Spr family={fam} k={icon} size={40} label />
        <div class="rv-bar-t">
          <p class="eyebrow">Round visualizer</p>
          <h1 class="rv-h1">{rangeTitle(info, p.from, p.to)}</h1>
          {!summary && !p.setup && <p class="rv-intro">The bloons, RBE and spawn timing of every round, from the game's own data.</p>}
          {summary && !p.setup && (
            <p class="rv-sum">
              <span class="vh">From the event: </span>
              {summary}
            </p>
          )}
        </div>
        {!p.setup && (
          <button
            ref={editBtn}
            type="button"
            class={`rv-edit${p.editOpen ? " on" : ""}`}
            aria-expanded={p.editOpen}
            aria-controls="rv-edit"
            onClick={() => p.setEditOpen(!p.editOpen)}
          >
            Edit
          </button>
        )}
      </header>
      {p.setup ? (
        <EditForm r={r} info={info} go={p.go} />
      ) : p.editOpen && p.desktop ? (
        <EditForm r={r} info={info} go={p.go} onDone={close} />
      ) : p.editOpen ? (
        <Sheet onClose={close}>
          <EditForm r={r} info={info} go={p.go} onDone={close} sheet />
        </Sheet>
      ) : null}
    </>
  );
}

/** Phones: the Edit form as a modal bottom sheet (the page underneath doesn't scroll). */
function Sheet(p: { onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
      if (d.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class="rv-sheet"
      aria-labelledby="rv-edit-h"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose(); // backdrop
      }}
    >
      {p.children}
    </dialog>
  );
}

function EditForm(p: { r: RoundsRoute; info?: RoundSetInfo; go: Go; onDone?: () => void; sheet?: boolean }) {
  const { r, info, go } = p;
  const [fam, icon] = info ? setIcon(info) : ["ui", "CustomRounds"];
  const chips = modChips(r, info);
  return (
    <section id="rv-edit" class={`rv-form${p.sheet ? " sheet" : ""}`} aria-labelledby="rv-edit-h">
      <div class="rv-form-h">
        <h2 id="rv-edit-h" class="label">
          Round set
        </h2>
        {p.onDone && (
          <button type="button" class="rv-x" aria-label="Close" onClick={p.onDone}>
            ×
          </button>
        )}
      </div>
      <label class="rv-set-f">
        <Spr family={fam} k={icon} size={32} label />
        <span class="vh">Round set</span>
        <select
          value={info?.id ?? ""}
          onChange={(e) => {
            const set = (e.currentTarget as HTMLSelectElement).value;
            if (set) go({ set });
          }}
        >
          {!info && <option value="">Choose a round set</option>}
          {GROUPS.map(([g, label]) => (
            <optgroup key={g} label={label}>
              {ROUND_SETS.filter((s) => s.group === g).map((s) => (
                <option key={s.id} value={s.id}>
                  {setLabel(s)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {info && <RangeControls r={r} info={info} go={go} />}
      {chips.length > 0 && (
        <div class="rv-mods">
          <span class="label">From the event</span>
          <ul class="rv-chips">
            {chips.map((c) => (
              <li key={c.label} class={`rv-mod${c.applied && !r.base ? "" : " na"}`}>
                <Spr family={c.fam} k={c.icon} size={24} label optional />
                <span>{c.label}</span>
                {r.base ? <span class="rv-na">off</span> : !c.applied ? <span class="rv-na">not applied{c.note ? ` · ${c.note}` : ""}</span> : c.note && <span class="rv-ok">{c.note}</span>}
              </li>
            ))}
          </ul>
          <label class="rv-switch">
            <input type="checkbox" checked={r.base} onChange={(e) => go({ base: (e.currentTarget as HTMLInputElement).checked })} />
            Base rounds <span class="quiet">(modifiers off)</span>
          </label>
        </div>
      )}
      <p class="rv-ver">Rounds from the game's data, v{GAME_VERSION}</p>
      {p.sheet && (
        <button type="button" class="rv-done" onClick={p.onDone}>
          Show rounds
        </button>
      )}
    </section>
  );
}

function RangeControls(p: { r: RoundsRoute; info: RoundSetInfo; go: Go }) {
  const { r, info, go } = p;
  const { from, to } = bounds(info, r);
  const commit = (which: "from" | "to") => (e: Event) => {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v) || v < 1) return;
    go({ [which]: Math.round(v) });
  };
  const presets: [string, number, number][] = [];
  if (r.ev) presets.push(["Event", r.ev[0], r.ev[1]]);
  for (const [name, d] of PRESETS) presets.push([name, d.start, d.end]);
  presets.push(["Whole set", info.first, info.last]);
  const b = (lo: number, hi: number) => bounds(info, { from: lo, to: hi });
  return (
    <div class="rv-range">
      <fieldset class="rv-fromto">
        <legend class="label">Rounds</legend>
        <input key={`f${from}`} type="number" inputMode="numeric" min={info.first} max={info.last} defaultValue={String(from)} aria-label="From round" onChange={commit("from")} />
        <span aria-hidden="true">–</span>
        <input key={`t${to}`} type="number" inputMode="numeric" min={info.first} max={info.last} defaultValue={String(to)} aria-label="To round" onChange={commit("to")} />
      </fieldset>
      <div class="rv-presets" role="group" aria-label="Round range presets">
        {presets.map(([name, lo, hi]) => {
          const x = b(lo, hi);
          const on = x.from === from && x.to === to;
          return (
            <button
              key={name}
              type="button"
              class={`rv-chip${on ? " on" : ""}${name === "Event" ? " ev" : ""}`}
              aria-pressed={on}
              title={`Rounds ${x.from}–${x.to}`}
              onClick={() => go({ from: x.from, to: x.to, r: r.r === undefined ? undefined : Math.min(x.to, Math.max(x.from, r.r)) })}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────── filters

/** The fixed chips: [filter, label, art family, art key]. Lead and Ceramic are bloon-type filters. */
const FIXED: { f: HasFilter | `bloon:${string}`; label: string; fam: string; k: string }[] = [
  { f: "camo", label: "Camo", fam: "ui", k: "AllCamo" },
  { f: "regrow", label: "Regrow", fam: "ui", k: "AllRegen" },
  { f: "fort", label: "Fortified", fam: "bloon", k: "fortified" },
  { f: "bloon:lead", label: "Lead", fam: "bloon", k: "lead" },
  { f: "bloon:ceramic", label: "Ceramic", fam: "bloon", k: "ceramic" },
  { f: "moabs", label: "MOAB-class", fam: "bloon", k: "moab" },
];
/** The event forces this variant on every bloon that has it: the chip says so and is inert. */
const EVENT_ALL: Partial<Record<HasFilter, keyof RoundMods>> = { camo: "camo", regrow: "regrow", fort: "fort" };

function FilterBar(p: { r: RoundsRoute; info: RoundSetInfo; data?: RoundSetData; from: number; to: number; mods: RoundMods; runs: [number, number][]; go: Go }) {
  const { r, info, go } = p;
  const [menu, setMenu] = useState(false);
  const toggleHas = (h: HasFilter) => go({ has: r.has.includes(h) ? r.has.filter((x) => x !== h) : [...r.has, h] });
  const toggleBloon = (k: string) => go({ bloon: r.bloon.includes(k) ? r.bloon.filter((x) => x !== k) : [...r.bloon, k] });
  const types = p.data ? typesInRange(p.data.rounds, p.from, p.to) : [];
  const extra = r.bloon.filter((k) => k !== "lead" && k !== "ceramic");
  const pressedClass = (on: boolean) => `rv-fchip${on ? " on" : ""}`;
  return (
    <div class="rv-filters">
      <div class="rv-fscroll" role="group" aria-label="Show only rounds with (any of)">
        {info.boss && p.runs.length > 0 && (
          <button type="button" data-f="changed" class={`${pressedClass(r.has.includes("changed"))} boss`} aria-pressed={r.has.includes("changed")} onClick={() => toggleHas("changed")}>
            <span class="rv-dia" aria-hidden="true">
              ◆
            </span>
            Changed by {info.name}
          </button>
        )}
        {FIXED.map((c) => {
          const bloon = c.f.startsWith("bloon:") ? c.f.slice(6) : null;
          const forced = !bloon && !r.base && EVENT_ALL[c.f as HasFilter] && p.mods[EVENT_ALL[c.f as HasFilter]!];
          const on = bloon ? r.bloon.includes(bloon) : r.has.includes(c.f as HasFilter);
          if (forced)
            return (
              <span key={c.f} data-f={c.f} class="rv-fchip forced" title="The event makes every bloon that can be this variant">
                <Spr family={c.fam} k={c.k} size={24} label />
                {c.label} <span class="rv-na">all (event)</span>
              </span>
            );
          return (
            <button key={c.f} type="button" data-f={bloon ?? c.f} class={pressedClass(on)} aria-pressed={on} onClick={() => (bloon ? toggleBloon(bloon) : toggleHas(c.f as HasFilter))}>
              <Spr family={c.fam} k={c.k} size={24} label />
              {c.label}
            </button>
          );
        })}
        {extra.map((k) => (
          <button key={k} type="button" data-f={k} class={pressedClass(true)} aria-pressed onClick={() => toggleBloon(k)}>
            <BloonSpr k={k} flags={0} size={24} label />
            {BLOON_TYPES[k]?.name ?? k}
          </button>
        ))}
        <button type="button" class={`rv-fchip menu${menu ? " open" : ""}`} aria-expanded={menu} aria-controls="rv-bmenu" onClick={() => setMenu(!menu)}>
          Bloon{extra.length ? ` (${extra.length})` : ""} <span aria-hidden="true">{menu ? "▴" : "▾"}</span>
        </button>
      </div>
      {menu && (
        <div id="rv-bmenu" class="rv-bmenu" role="group" aria-label="Bloon types in this range">
          {types.map((k) => {
            const on = r.bloon.includes(k);
            return (
              <button key={k} type="button" class={pressedClass(on)} aria-pressed={on} onClick={() => toggleBloon(k)}>
                <BloonSpr k={k} flags={0} size={24} label />
                {BLOON_TYPES[k]?.name ?? k}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListHead(p: { info: RoundSetInfo; runs: [number, number][]; on: boolean; matches: Set<number> | null; rounds: Round[]; hasRbe: boolean }) {
  const n = p.matches?.size ?? 0;
  const first = p.rounds.find((x) => p.matches?.has(x.n))?.n;
  return (
    <div class="rv-lhead">
      {(p.on || p.runs.length > 0) && (
        <p class="rv-count" aria-live="polite">
          {p.on && (
            <span>
              <b>{fmtInt(n)}</b> of {fmtInt(p.rounds.length)} rounds match{first !== undefined ? ` · first: round ${first}` : ""}
            </span>
          )}
          {p.runs.length > 0 && (
            <span class="rv-legend">
              <span class="rv-dia" aria-hidden="true">
                ◆
              </span>{" "}
              {changedText(p.info)}
            </span>
          )}
        </p>
      )}
      <div class="rv-lh" aria-hidden="true">
        <span>Rnd</span>
        <span>Bloons</span>
        <span class="num">{p.hasRbe ? "RBE" : "Bloons"}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────── list

function RoundList(p: {
  listRef: { current: HTMLOListElement | null };
  rounds: Round[];
  parts: ({ total: number; moab: number } | undefined)[];
  matches: Set<number> | null;
  flt: Filters;
  mods: RoundMods;
  info: RoundSetInfo;
  sel?: number;
  anchor: number;
  hrefFor: (n: number) => string;
  onPick: (n: number, e: MouseEvent) => void;
}) {
  // First paint: the rows up to a screen past the anchor; the rest one frame later (a click paints at once).
  const full = useFullRender();
  const from = p.rounds[0]?.n ?? 1;
  const shown = p.matches ? p.rounds.filter((x) => p.matches!.has(x.n)) : p.rounds;
  const list = full ? shown : shown.filter((x) => x.n <= p.anchor + 16);
  // Dim the sprites that aren't why a round matched (group filters only: "changed" is about the whole round).
  const groupFlt: Filters = { has: p.flt.has.filter((h) => h !== "changed"), bloon: p.flt.bloon };
  const on = !!p.matches && filtering(groupFlt);
  return (
    <ol class="rv-list" ref={p.listRef} aria-label={`Rounds ${from} to ${p.rounds[p.rounds.length - 1]?.n ?? from}`}>
      {list.map((x) => {
        const rbe = p.parts[x.n - from]?.total;
        const types = distinctBloons(x, p.mods);
        const more = types.length - 5;
        const isSel = x.n === p.sel;
        return (
          <li key={x.n} data-n={x.n} class={`rv-row${isSel ? " sel" : ""}${x.o && p.info.boss ? " ovr" : ""}`}>
            <a class="rv-rb" href={p.hrefFor(x.n)} aria-current={isSel ? "true" : undefined} onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              p.onPick(x.n, e);
            }}>
              <span class="rv-n">
                {x.n}
                {x.o && p.info.boss ? (
                  <>
                    <span class="rv-dia" aria-hidden="true">
                      ◆
                    </span>
                    <span class="vh">, {changedText(p.info)}</span>
                  </>
                ) : null}
              </span>
              <span class="rv-sprs">
                {types.slice(0, 5).map((t) => (
                  <BloonSpr key={`${t.key}:${t.flags}`} k={t.key} flags={t.flags} size={24} count={t.count} dim={on && !groupMatches(t, groupFlt)} />
                ))}
                {more > 0 && <span class="rv-more">+{more}</span>}
              </span>
              <span class="rv-rbe num">{rbe !== undefined ? fmtInt(Math.round(rbe)) : `×${fmtInt(roundCount(x))}`}</span>
            </a>
          </li>
        );
      })}
      {list.length === 0 && <li class="quiet rv-none">No round in this range matches the filter.</li>}
    </ol>
  );
}

function ListSkeleton(p: { n: number; url: string }) {
  const e = store.peek(p.url);
  const failed = e ? !e.ok : !store.loadState(p.url).busy;
  return (
    <div class="rv-sk">
      {failed ? (
        <div class="empty">
          <p class="empty-t">Round data didn't load</p>
          <p>
            Check your connection.{" "}
            <button type="button" class="rv-chip" onClick={() => void store.want([p.url])}>
              Try again
            </button>
          </p>
        </div>
      ) : (
        <div class="skeleton" aria-busy="true" aria-label="Loading rounds">
          {Array.from({ length: p.n }, (_, i) => (
            <div key={i} class="sk-row rv-sk-row" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Desktop detail: sticky while it fits the viewport, otherwise it scrolls with the page (never an inner scroller). */
function DetailPane(p: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => {
      const top = parseFloat(getComputedStyle(el).getPropertyValue("--rv-sm")) || 0; // its sticky top
      setFits(el.offsetHeight + top + 12 <= innerHeight);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    addEventListener("resize", check);
    return () => {
      ro.disconnect();
      removeEventListener("resize", check);
    };
  }, []);
  return (
    <div ref={ref} class={`rv-detailpane${fits ? " fits" : ""}`}>
      {p.children}
    </div>
  );
}

function Jump(p: { cur: number; from: number; to: number; inputRef: { current: HTMLInputElement | null }; go: (n: number) => void }) {
  // The ‹ › pair lives on the round card; the scrubber row keeps only the jump field (interaction#21).
  return (
    <div class="rv-jump">
      <label>
        <span class="label">Round</span>
        <input
          ref={p.inputRef}
          type="number"
          inputMode="numeric"
          min={p.from}
          max={p.to}
          defaultValue={String(p.cur)}
          aria-keyshortcuts="/"
          onChange={(e) => {
            const v = Math.round(Number((e.currentTarget as HTMLInputElement).value));
            if (Number.isFinite(v) && v >= 1) p.go(Math.min(p.to, Math.max(p.from, v)));
          }}
        />
      </label>
    </div>
  );
}

// ─────────────────────────────── scrubber

/**
 * RBE (or bloon count) per round. List view (`follow`): the cursor follows the topmost visible row, and dragging
 * scrolls the page to a round without selecting it. Round view: dragging picks the round. Filter matches are
 * ticks above the bars; rounds a boss set changed are one ribbon per run under them.
 */
function Strip(p: {
  rounds: Round[];
  parts: ({ total: number; moab: number } | undefined)[];
  hasRbe: boolean;
  matches: Set<number> | null;
  runs: [number, number][];
  boss?: string;
  sel?: number;
  follow: boolean;
  listRef: { current: HTMLOListElement | null };
  from: number;
  to: number;
  beforeHp: boolean;
  onSelect: (n: number) => void;
}) {
  const n = p.rounds.length;
  const vals = useMemo(() => p.rounds.map((x, i) => (p.hasRbe ? p.parts[i]!.total : roundCount(x))), [p.rounds, p.parts, p.hasRbe]);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const [at, setAt] = useState<number>(p.sel ?? p.from);
  const cur = p.follow ? at : (p.sel ?? p.from);
  const i = cur - p.from;

  // List view: follow the scroll position (the first row below the sticky bar).
  useEffect(() => {
    if (!p.follow) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rows = p.listRef.current?.children;
      const bar = ref.current?.closest(".rv-sticky");
      if (!rows || !rows.length || !bar) return;
      const line = bar.getBoundingClientRect().bottom + 2;
      let lo = 0;
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid]!.getBoundingClientRect().bottom <= line) lo = mid + 1;
        else hi = mid;
      }
      const k = Number((rows[lo] as HTMLElement).dataset.n);
      if (Number.isFinite(k)) setAt(k);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [p.follow, n]);

  const roundAt = (clientX: number) => {
    const b = ref.current!.getBoundingClientRect();
    const k = Math.min(n - 1, Math.max(0, Math.floor(((clientX - b.left) / b.width) * n)));
    return p.rounds[k]?.n;
  };
  const scrollTo = (k: number) => {
    const row = p.listRef.current?.querySelector<HTMLElement>(`[data-n="${k}"]`) ?? nearestRow(p.listRef.current, k);
    if (row) row.scrollIntoView({ block: "start" });
    setAt(k);
  };
  const pick = (k: number | undefined) => {
    if (k === undefined) return;
    if (p.follow) scrollTo(k);
    else if (k !== p.sel) p.onSelect(k);
  };
  const what = p.hasRbe ? "RBE" : "Bloons";
  // css#16: the bars only change with the data or the selection, not with each scroll-follow step of the cursor.
  const minPct = 5; // ≥ 2 px bars: every round is visible and can be aimed at
  const bars = useMemo(() => {
    const max = Math.max(1, ...vals);
    return (
      <svg class="rv-bars" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
        {p.rounds.map((x, j) => {
          const h = Math.max((vals[j]! / max) * 100, minPct);
          const m = p.hasRbe ? Math.min((p.parts[j]!.moab / max) * 100, h) : 0;
          return (
            <g key={x.n} class={x.n === p.sel ? "sel" : undefined}>
              <rect class="b" x={j + 0.08} width={0.84} y={100 - h} height={Math.max(h - m, 0)} />
              {m > 0 && <rect class="m" x={j + 0.08} width={0.84} y={100 - m} height={m} />}
            </g>
          );
        })}
      </svg>
    );
  }, [vals, p.rounds, p.parts, p.hasRbe, p.sel, n]);
  return (
    <div class="rv-ov">
      <div
        ref={ref}
        class={`rv-strip${p.matches ? " filtering" : ""}${p.runs.length ? " ribbon" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label={p.follow ? "Scroll to round" : "Round"}
        aria-valuemin={p.from}
        aria-valuemax={p.to}
        aria-valuenow={cur}
        aria-valuetext={`Round ${cur}, ${what} ${fmtInt(Math.round(vals[i] ?? 0))}`}
        onPointerDown={(e) => {
          drag.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          pick(roundAt(e.clientX));
        }}
        onPointerMove={(e) => drag.current && pick(roundAt(e.clientX))}
        onPointerUp={() => (drag.current = false)}
        onPointerCancel={() => (drag.current = false)}
        onKeyDown={(e) => {
          const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "PageDown" ? -10 : e.key === "PageUp" ? 10 : 0;
          const k = e.key === "Home" ? p.from : e.key === "End" ? p.to : d ? Math.min(p.to, Math.max(p.from, cur + d)) : undefined;
          if (k === undefined) return;
          e.preventDefault();
          pick(k);
        }}
      >
        {p.matches && (
          <div class="rv-marks" aria-hidden="true">
            {p.rounds.map((x, j) => (p.matches!.has(x.n) ? <span key={x.n} class="rv-mk" style={{ left: `${(j / n) * 100}%`, width: `${100 / n}%` }} /> : null))}
          </div>
        )}
        {bars}
        {p.runs.length > 0 && (
          <div class="rv-ribbon" aria-hidden="true">
            {p.runs.map(([a, b]) => (
              <span key={a} style={{ left: `${((a - p.from) / n) * 100}%`, width: `${((b - a + 1) / n) * 100}%` }} />
            ))}
          </div>
        )}
        <span class="rv-cursor" style={{ left: `${((i + 0.5) / n) * 100}%` }} aria-hidden="true" />
      </div>
      <p class="rv-read" aria-hidden="true">
        <b>R{cur}</b>
        <span>
          {what} {fmtInt(Math.round(vals[i] ?? 0))}
          {p.hasRbe && p.beforeHp ? "*" : ""}
        </span>
      </p>
    </div>
  );
}

/** The listed row closest to round `k` (a filter may hide `k` itself). */
function nearestRow(list: HTMLOListElement | null, k: number): HTMLElement | null {
  if (!list) return null;
  let best: HTMLElement | null = null;
  for (const el of list.children) {
    const n = Number((el as HTMLElement).dataset.n);
    if (!Number.isFinite(n)) continue;
    best = el as HTMLElement;
    if (n >= k) break;
  }
  return best;
}

// ─────────────────────────────── one round

function RoundCard(p: {
  round: Round;
  info: RoundSetInfo;
  from: number;
  to: number;
  mods: RoundMods;
  moab: number;
  desktop: boolean;
  beforeHp: boolean;
  focus?: boolean;
  flt: Filters | null;
  all: Round[];
  go: (n: number) => void;
  onFocus?: () => void;
}) {
  const { round, info } = p;
  const groups = effGroups(round, p.mods)
    .map((g, i) => ({ ...g, i }))
    .sort((a, b) => a.start - b.start || a.i - b.i);
  const parts = roundRbeParts(round, p.mods, p.moab);
  const t0 = Math.min(0, ...groups.map((g) => g.start));
  const t1 = Math.max(spawnEnd(round), t0 + 1);
  const span = t1 - t0;
  const pct = (t: number) => ((t - t0) / span) * 100;
  const ticks = axisTicks(t0, t1);
  const size = p.desktop ? 48 : 40;
  const id = `rv-d-${round.n}`;
  const changed = !!round.o && !!info.boss;

  // Round view: swipe left/right on the card steps rounds (instant, no animation).
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const inRange = p.all.filter((x) => x.n >= p.from && x.n <= p.to);
  const prevMatch = p.flt ? [...inRange].reverse().find((x) => x.n < round.n && roundMatches(x, p.flt!, p.mods))?.n : undefined;
  const nextMatch = p.flt ? inRange.find((x) => x.n > round.n && roundMatches(x, p.flt!, p.mods))?.n : undefined;
  const upNext = inRange.filter((x) => x.n > round.n).slice(0, 3);
  return (
    <section
      class={`rv-card${p.focus ? " focus" : ""}${changed ? " ovr" : ""}`}
      aria-labelledby={id}
      onPointerDown={
        p.focus
          ? (e) => {
              if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
            }
          : undefined
      }
      onPointerUp={
        p.focus
          ? (e) => {
              const s = swipe.current;
              swipe.current = null;
              if (!s || s.id !== e.pointerId) return;
              const dx = e.clientX - s.x;
              const dy = e.clientY - s.y;
              if (Math.abs(dx) > 48 && Math.abs(dx) > 2 * Math.abs(dy)) {
                const n = round.n + (dx < 0 ? 1 : -1);
                if (n >= p.from && n <= p.to) p.go(n);
              }
            }
          : undefined
      }
      onPointerCancel={() => (swipe.current = null)}
    >
      <header class="rv-ch">
        <button type="button" class="rv-step rv-prev" aria-label={`Round ${round.n - 1}`} disabled={round.n <= p.from} onClick={() => p.go(round.n - 1)}>
          ‹
        </button>
        <div class="rv-ch-t">
          <h2 id={id}>
            Round {round.n}
            {changed && (
              <span class="rv-dia" aria-hidden="true">
                {" "}
                ◆
              </span>
            )}
          </h2>
          {changed && <p class="rv-chg">{changedText(info)}</p>}
        </div>
        {p.onFocus && (
          <button type="button" class="rv-focus" onClick={p.onFocus}>
            Focus
          </button>
        )}
        <button type="button" class="rv-step rv-next" aria-label={`Round ${round.n + 1}`} disabled={round.n >= p.to} onClick={() => p.go(round.n + 1)}>
          ›
        </button>
      </header>
      <dl class="rv-stats">
        {parts && <Stat k="RBE" v={fmtInt(Math.round(parts.total))} note={p.beforeHp ? "before bloon health modifier" : parts.moab > 0 ? `${fmtInt(Math.round(parts.moab))} in MOAB-class layers` : undefined} />}
        <Stat k="Bloons" v={fmtInt(roundCount(round))} />
        <Stat k="Groups" v={fmtInt(round.g.length)} />
        <Stat k="Spawns over" v={secs(spawnEnd(round))} />
      </dl>
      <div class="rv-tl" role="img" aria-label={`Spawn timeline of round ${round.n}; the group table lists the same groups`}>
        <div class="rv-ax" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ left: `${pct(t)}%` }}>
              {t}s
            </span>
          ))}
        </div>
        {groups.map((g) => {
          const w = pct(g.end) - pct(g.start);
          return (
            <div key={g.i} class="rv-lane">
              <span class="rv-who">
                <BloonSpr k={g.key} flags={g.flags} size={size} label />
                <span class="rv-cnt">×{fmtInt(g.count)}</span>
              </span>
              <span class="rv-track">
                {ticks.map((t) => (
                  <i key={t} class="rv-grid" style={{ left: `${pct(t)}%` }} />
                ))}
                <span class={`rv-span${g.count > 1 && g.count <= 40 && w > 0 ? " ticks" : ""}`} style={{ left: `${pct(g.start)}%`, width: `${w}%`, "--n": g.count }} />
              </span>
            </div>
          );
        })}
      </div>
      <details class="rv-gt">
        <summary>Group table</summary>
        <table>
          <caption class="vh">Bloon groups of round {round.n}, by start time</caption>
          <thead>
            <tr>
              <th scope="col">Bloon</th>
              <th scope="col" class="num">
                Count
              </th>
              <th scope="col" class="num">
                Start
              </th>
              <th scope="col" class="num">
                End
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.i}>
                <td>
                  <span class="rv-gtb">
                    <BloonSpr k={g.key} flags={g.flags} size={24} label />
                    {bloonLabel(g.key, g.flags)}
                  </span>
                </td>
                <td class="num">{fmtInt(g.count)}</td>
                <td class="num">{secs(g.start)}</td>
                <td class="num">{secs(g.end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {p.focus && p.flt && (
        <nav class="rv-matchnav" aria-label="Rounds matching the filter">
          <button type="button" class="rv-chip rv-prevmatch" disabled={prevMatch === undefined} onClick={() => prevMatch !== undefined && p.go(prevMatch)}>
            ‹ {prevMatch !== undefined ? `Previous match ${prevMatch}` : "No earlier match"}
          </button>
          <button type="button" class="rv-chip rv-nextmatch" disabled={nextMatch === undefined} onClick={() => nextMatch !== undefined && p.go(nextMatch)}>
            {nextMatch !== undefined ? `Next match ${nextMatch}` : "No later match"} ›
          </button>
        </nav>
      )}
      {p.focus && upNext.length > 0 && (
        <div class="rv-upnext">
          <h3 class="label">Up next</h3>
          <ul>
            {upNext.map((x) => {
              const rb = roundRbeParts(x, p.mods, p.moab)?.total;
              return (
                <li key={x.n}>
                  <button type="button" class="rv-un" onClick={() => p.go(x.n)}>
                    <span class="rv-n">
                      {x.n}
                      {x.o && info.boss ? (
                        <>
                          <span class="rv-dia" aria-hidden="true">
                            ◆
                          </span>
                          <span class="vh">, {changedText(info)}</span>
                        </>
                      ) : null}
                    </span>
                    <span class="rv-sprs">
                      {distinctBloons(x, p.mods)
                        .slice(0, 5)
                        .map((t) => (
                          <BloonSpr key={`${t.key}:${t.flags}`} k={t.key} flags={t.flags} size={24} count={t.count} />
                        ))}
                    </span>
                    <span class="rv-rbe num">{rb !== undefined ? fmtInt(Math.round(rb)) : `×${fmtInt(roundCount(x))}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

const Stat = (p: { k: string; v: ComponentChildren; note?: string }) => (
  <div class="rv-stat">
    <dt>{p.k}</dt>
    <dd>
      {p.v}
      {p.note && <span class="rv-note">{p.note}</span>}
    </dd>
  </div>
);

/** Whole-second axis labels, at most ~6. */
function axisTicks(t0: number, t1: number): number[] {
  const span = t1 - t0;
  const step = [1, 2, 5, 10, 15, 20, 30, 60, 120].find((s) => span / s <= 6) ?? 300;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) out.push(t);
  return out;
}
