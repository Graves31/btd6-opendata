// Maps explorer (/maps) and one map's page (/maps/<id>): the boss events and races played on each map.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BOSS_HISTORY_SOURCE } from "../data/bossHistory.ts";
import { RACE_HISTORY_SOURCE } from "../data/raceHistory.ts";
import { MAP_LIST } from "../data/names.ts";
import { bossName, bossTitle, fmtDate, mapName, oldDates } from "../format.ts";
import { DIFF_ICON, DIFF_LABEL, fmtAgo, mapCounts, mapEvents, mapMetaKeys, type MapEvent } from "../maps.ts";
import { navigate, store } from "../nav.ts";
import { historyKey, href, LIST_KEY, type MapSort, type MapsRoute } from "../routes.ts";
import { MapArt, Spr } from "../sprite.tsx";
import { A, body, EvIcon, peek, Skeleton, StatusBadge, ToolHero } from "../ui.tsx";
import { NotFound } from "./errors.tsx";

const SORTS: [MapSort, string][] = [
  ["game", "Game order"],
  ["recent", "Recently played"],
  ["bossgap", "Longest since a boss"],
  ["racegap", "Longest since a race"],
  ["bosses", "Most boss events"],
  ["races", "Most races"],
  ["az", "A–Z"],
];
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Lists and metadata still on their way: "none" can't be said yet. */
function useMapData(): boolean {
  const keys = mapMetaKeys(body);
  useEffect(() => void store.want(keys), [keys.join()]);
  return [LIST_KEY.boss, historyKey("boss"), LIST_KEY.race, historyKey("race"), ...keys].some((k) => !peek(k));
}

const DiffIcon = (p: { d: number; size: number }) => <Spr family="ui" k={DIFF_ICON[p.d]} size={p.size} label />;

/** One kind's cell in a card footer: count + last played, "No boss yet", or a skeleton while the maps are still loading. */
function Cell(p: { kind: "boss" | "race"; n: number; last?: number; loading: boolean; now: number }) {
  const { kind, n } = p;
  if (!n)
    return (
      <span class={`map-cnt${p.loading ? "" : " never"}`}>
        <EvIcon k={kind} size={24} />
        {p.loading ? <span class="sk" /> : <b>No {kind} yet</b>}
      </span>
    );
  const word = kind === "boss" ? (n === 1 ? "boss" : "bosses") : n === 1 ? "race" : "races";
  return (
    <span class="map-cnt">
      <EvIcon k={kind} size={24} />
      <b class="num">
        {n}
        <small>{word}</small>
      </b>
      {p.last != null && <em>last {fmtAgo(p.last, p.now)}</em>}
    </span>
  );
}

function Tile(p: { id: string; d: number; water: boolean; boss: number; race: number; lb?: number; lr?: number; fresh: boolean; loading: boolean; now: number }) {
  return (
    <li data-diff={p.d}>
      <A href={href.map(p.id)} class="map-tile">
        <span class="map-tile-art">
          <MapArt map={p.id} size={200} />
          <span class="map-tile-d">
            <DiffIcon d={p.d} size={34} />
          </span>
          {p.water && (
            <span class="map-tile-w">
              <Spr family="ui" k="Water" size={28} name="Has water" />
            </span>
          )}
          {p.fresh && <span class="map-tile-new">Latest</span>}
          <b class="map-tile-n">{mapName(p.id)}</b>
        </span>
        <span class="map-tile-f">
          <Cell kind="boss" n={p.boss} last={p.lb} loading={p.loading} now={p.now} />
          <Cell kind="race" n={p.race} last={p.lr} loading={p.loading} now={p.now} />
        </span>
      </A>
    </li>
  );
}

function Stat(p: { art: ComponentChildren; big: ComponentChildren; small: string; href?: string }) {
  const inner = (
    <>
      {p.art}
      <b class="num">{p.big}</b>
      <small>{p.small}</small>
      {p.href && <span class="map-stat-go" aria-hidden="true">›</span>}
    </>
  );
  return p.href ? (
    <A href={p.href} class="map-stat map-stat-link">
      {inner}
    </A>
  ) : (
    <div class="map-stat">{inner}</div>
  );
}

export function MapsPage(props: { r: MapsRoute }) {
  const r = props.r;
  const loading = useMapData();
  const [q, setQ] = useState(r.q);
  const [open, setOpen] = useState(false);
  // Opened fresh at the top: let the browser skip the sections below the fold (.cv). Not when Back restores a
  // scroll position: that needs the real heights, not the estimates.
  const [cv] = useState(() => !((history.state as { scrollY?: number } | null)?.scrollY ?? 0));
  useEffect(() => setQ((x) => (x.trim() === r.q ? x : r.q)), [r.q]);
  const go = (p: Partial<Omit<MapsRoute, "name">>) => navigate(href.maps({ ...r, ...p }), { replace: true, keepScroll: true });
  const now = Date.now();
  const counts = mapCounts(body, now);
  const needle = plain(r.q);
  const n = (c: Map<string, number>, id: string) => c.get(id) ?? 0;
  const list = MAP_LIST.filter(
    ([id, d, water]) =>
      (!r.d.length || r.d.includes(d)) &&
      (!r.water || water) &&
      (!r.noBoss || !n(counts.boss, id)) &&
      (!r.noRace || !n(counts.race, id)) &&
      plain(mapName(id)).includes(needle),
  );
  // Stable sorts: ties keep game order. A map never played is -Infinity: first in the "longest since" lists.
  const t = (m: Map<string, number>, id: string) => m.get(id) ?? -Infinity;
  const gap = (m: Map<string, number>, a: string, b: string) => (t(m, a) === t(m, b) ? 0 : t(m, a) - t(m, b));
  const newest = (id: string) => Math.max(t(counts.last.boss, id), t(counts.last.race, id));
  const by: Partial<Record<MapSort, (a: string, b: string) => number>> = {
    az: (a, b) => mapName(a).localeCompare(mapName(b)),
    bosses: (a, b) => n(counts.boss, b) - n(counts.boss, a),
    races: (a, b) => n(counts.race, b) - n(counts.race, a),
    recent: (a, b) => (newest(a) === newest(b) ? 0 : newest(b) - newest(a)),
    bossgap: (a, b) => gap(counts.last.boss, a, b),
    racegap: (a, b) => gap(counts.last.race, a, b),
  };
  const cmp = by[r.sort];
  if (cmp) list.sort((a, b) => cmp(a[0], b[0]));
  const tile = ([id, d, water]: (typeof MAP_LIST)[number]) => (
    <Tile
      key={id}
      id={id}
      d={d}
      water={water}
      boss={n(counts.boss, id)}
      race={n(counts.race, id)}
      lb={counts.last.boss.get(id)}
      lr={counts.last.race.get(id)}
      fresh={id === counts.latest.boss?.map || id === counts.latest.race?.map}
      loading={loading}
      now={now}
    />
  );
  const never = MAP_LIST.filter(([id]) => !n(counts.boss, id)).length;
  const lb = counts.latest.boss;
  const lr = counts.latest.race;
  const filters = r.d.length + +r.water + +r.noBoss + +r.noRace;
  const pill = (on: boolean, onClick: () => void, label: string, icon?: ComponentChildren, d?: number) => (
    <button type="button" class="map-pill" data-diff={d} aria-pressed={on} onClick={onClick}>
      {on && <span class="ck" aria-hidden="true">✓</span>}
      {icon}
      {label}
    </button>
  );
  const flip = (key: "water" | "noBoss" | "noRace") => () => go({ [key]: !r[key] });
  return (
    <>
      <ToolHero art={<Spr family="ui" k="MapBeginner" size={72} label />} eyebrow="Official maps · Bloons TD 6" title="Maps" sub={`All ${MAP_LIST.length} official maps: when each last had a boss event or a race, and how often.`} />
      <div class="map-strip">
        <Stat art={<Spr family="ui" k="Trophy" size={40} label />} big={MAP_LIST.length} small="maps in the game" />
        <Stat art={<EvIcon k="boss" size={40} />} big={loading ? "–" : never} small="never had a boss event" />
        {lb?.map && <Stat art={<MapArt map={lb.map} size={48} />} big="Latest boss" small={`${mapName(lb.map)} · ${fmtAgo(lb.start, now)}`} href={href.boss(lb.id!)} />}
        {lr?.map && <Stat art={<MapArt map={lr.map} size={48} />} big="Latest race" small={`${mapName(lr.map)} · ${fmtAgo(lr.start, now)}`} href={href.race(lr.id!)} />}
      </div>
      <div class="map-bar">
        <label class="map-search">
          <Spr family="ui" k="Search" size={24} label />
          <span class="vh">Search official maps</span>
          <input
            type="search"
            placeholder="Search official maps"
            value={q}
            maxLength={40}
            autocomplete="off"
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              setQ(v);
              go({ q: v });
            }}
          />
        </label>
        <button type="button" class="map-filt" aria-expanded={open} onClick={() => setOpen(!open)}>
          Filters{filters > 0 && <i>{filters}</i>}
        </button>
        <label class="map-sort">
          <span>Sort by</span>
          <select aria-label="Sort by" value={r.sort} onChange={(e) => go({ sort: (e.currentTarget as HTMLSelectElement).value as MapSort })}>
            {SORTS.map(([s, l]) => (
              <option key={s} value={s}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div class={`map-panel${open ? " open" : ""}`}>
          <span class="map-cap">Show</span>
          {DIFF_LABEL.map((l, d) => {
            const on = r.d.includes(d);
            return pill(on, () => go({ d: on ? r.d.filter((x) => x !== d) : [...r.d, d] }), l, <DiffIcon d={d} size={20} />, d);
          })}
          <span class="map-div" aria-hidden="true" />
          {pill(r.water, flip("water"), "Water", <Spr family="ui" k="Water" size={20} label />)}
          {pill(r.noBoss, flip("noBoss"), "No boss yet")}
          {pill(r.noRace, flip("noRace"), "Never raced")}
          {filters > 0 && (
            <button type="button" class="map-clear" onClick={() => go({ d: [], water: false, noBoss: false, noRace: false })}>
              Clear
            </button>
          )}
        </div>
      </div>
      {list.length === 0 ? (
        <p class="quiet map-none">
          No maps match. <A href={href.maps()}>Clear the filters</A>
        </p>
      ) : r.sort === "game" ? (
        DIFF_LABEL.map((l, d) => {
          const rows = list.filter((m) => m[1] === d);
          return (
            rows.length > 0 && (
              <details key={l} open class={`map-sec${cv ? " cv" : ""}`} id={`map-s${d}`} data-diff={d}>
                <summary class="map-band">
                  <DiffIcon d={d} size={40} />
                  <h2>{l}</h2>
                  <span class="c">
                    <b class="num">{rows.length}</b> maps
                  </span>
                </summary>
                <ul class="map-grid">{rows.map(tile)}</ul>
              </details>
            )
          );
        })
      ) : (
        <ul class="map-grid">{list.map(tile)}</ul>
      )}
    </>
  );
}

function EventRow(p: { e: MapEvent }) {
  const e = p.e;
  const wiki = !e.id;
  const inner = (
    <>
      {e.kind === "boss" ? <Spr family="boss" k={e.type} size={40} label optional /> : <EvIcon k="race" size={40} />}
      <span class="bs-ev-m">
        <strong>{e.kind === "boss" ? (e.n ? bossTitle(e.type, e.n) : bossName(e.type)) : e.name}</strong>
        <span class="quiet">{wiki && e.day ? oldDates(e.start, e.end) : `${fmtDate(e.start)} – ${fmtDate(e.end)}`}</span>
      </span>
      {!wiki && <StatusBadge start={e.start} end={e.end} />}
    </>
  );
  return (
    <li class={wiki ? "old" : undefined}>
      {wiki ? <div class="bs-ev">{inner}</div> : <A href={e.kind === "boss" ? href.boss(e.id!) : href.race(e.id!)} class="bs-ev">{inner}</A>}
    </li>
  );
}

function Neighbour(p: { m?: (typeof MAP_LIST)[number]; dir: "prev" | "next" }) {
  if (!p.m) return <span />;
  return (
    <A href={href.map(p.m[0])} class={`mp-nb ${p.dir}`}>
      {p.dir === "prev" && <span aria-hidden="true">‹</span>}
      <MapArt framed map={p.m[0]} size={48} />
      <span class="mp-nb-t">
        <small>{p.dir === "prev" ? "Previous" : "Next"}</small>
        {mapName(p.m[0])}
      </span>
      {p.dir === "next" && <span aria-hidden="true">›</span>}
    </A>
  );
}

export function MapPage(props: { id: string }) {
  const id = props.id;
  const loading = useMapData();
  const i = MAP_LIST.findIndex((m) => m[0] === id);
  if (i < 0) {
    return (
      <NotFound what="map" back={{ href: href.maps(), label: "All maps" }}>
        <p>That map isn't in the game's map list.</p>
      </NotFound>
    );
  }
  const [, d, water] = MAP_LIST[i];
  const same = MAP_LIST.filter((m) => m[1] === d);
  const evs = mapEvents(id, body);
  const bosses = evs.filter((e) => e.kind === "boss");
  const races = evs.filter((e) => e.kind === "race");
  const section = (title: string, rows: MapEvent[], none: string, extra?: ComponentChildren) => (
    <section class="bs-plate map-ev">
      <h2 class="kicker-h">
        {title} <span class="bs-count num">{rows.length}</span>
      </h2>
      {rows.length ? <ul class="bs-past">{rows.map((e) => <EventRow key={e.id ?? `${e.start}${"type" in e ? e.type : ""}`} e={e} />)}</ul> : loading ? <Skeleton rows={2} what={title} /> : <p class="quiet">{none}</p>}
      {extra}
    </section>
  );
  return (
    <>
      <header class="page-h mp-head" data-diff={d}>
        <MapArt framed map={id} size={400} eager alt={mapName(id)} />
        <div class="mp-info">
          <h1 class="title">{mapName(id)}</h1>
          <div class="mp-chips">
            <A href={href.maps({ d: [d] })} class="rv-chip mp-chip">
              <DiffIcon d={d} size={24} />
              {DIFF_LABEL[d]}
            </A>
            {water && (
              <span class="mp-pill">
                <Spr family="ui" k="Water" size={24} label />
                Water
              </span>
            )}
            <span class="mp-pill">
              #{same.findIndex((m) => m[0] === id) + 1} of {same.length} {DIFF_LABEL[d]} maps
            </span>
          </div>
        </div>
      </header>
      <nav class="mp-pn" aria-label="Neighbouring maps">
        <Neighbour m={MAP_LIST[i - 1]} dir="prev" />
        <Neighbour m={MAP_LIST[i + 1]} dir="next" />
      </nav>
      {section(
        "Boss events",
        bosses,
        "No boss events on record for this map.",
        bosses.some((e) => e.kind === "boss" && !e.id) && (
          <p class="bs-src quiet">
            Older events: from the{" "}
            <a href={BOSS_HISTORY_SOURCE} target="_blank" rel="noopener noreferrer">
              Bloons Wiki
            </a>
            , no longer on Ninja Kiwi's servers.
          </p>
        ),
      )}
      {section(
        "Races",
        races,
        "No races on record for this map.",
        races.some((e) => !e.id) && (
          <p class="bs-src quiet">
            Older races: from the{" "}
            <a href={RACE_HISTORY_SOURCE} target="_blank" rel="noopener noreferrer">
              Bloons Wiki
            </a>
            , no longer on Ninja Kiwi's servers. It lists only part of the races before 2022.
          </p>
        ),
      )}
    </>
  );
}
