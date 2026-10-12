// Maps explorer (/maps) and one map's page (/maps/<id>): the boss events and races played on each map.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BOSS_HISTORY_SOURCE } from "../data/bossHistory.ts";
import { MAP_LIST } from "../data/names.ts";
import { bossName, bossTitle, fmtDate, mapName, oldDates } from "../format.ts";
import { DIFF_ICON, DIFF_LABEL, mapCounts, mapEvents, mapMetaKeys, type MapEvent } from "../maps.ts";
import { navigate, store } from "../nav.ts";
import { historyKey, href, LIST_KEY, type MapSort, type MapsRoute } from "../routes.ts";
import { MapArt, Spr } from "../sprite.tsx";
import { A, body, EvIcon, peek, Skeleton, StatusBadge } from "../ui.tsx";
import { NotFound } from "./errors.tsx";

const SORTS: [MapSort, string][] = [
  ["game", "Game order"],
  ["az", "A–Z"],
  ["bosses", "Most boss events"],
];
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Lists and metadata still on their way: "none" can't be said yet. */
function useMapData(): boolean {
  const keys = mapMetaKeys(body);
  useEffect(() => void store.want(keys), [keys.join()]);
  return [LIST_KEY.boss, historyKey("boss"), LIST_KEY.race, historyKey("race"), ...keys].some((k) => !peek(k));
}

const DiffIcon = (p: { d: number; size: number }) => <Spr family="ui" k={DIFF_ICON[p.d]} size={p.size} label />;

function Tile(p: { id: string; d: number; water: boolean; boss: number; race: number }) {
  return (
    <li data-diff={p.d}>
      <A href={href.map(p.id)} class="map-tile">
        <MapArt framed map={p.id} size={200} />
        <span class="map-tile-n">{mapName(p.id)}</span>
        <span class="map-tile-meta">
          {p.water && <Spr family="ui" k="Water" size={24} name="Has water" />}
          {p.boss > 0 && (
            <span class="map-cnt" title="Boss events">
              <EvIcon k="boss" size={24} />
              <b class="num">{p.boss}</b>
              <span class="vh"> boss events</span>
            </span>
          )}
          {p.race > 0 && (
            <span class="map-cnt" title="Races">
              <EvIcon k="race" size={24} />
              <b class="num">{p.race}</b>
              <span class="vh"> races</span>
            </span>
          )}
        </span>
      </A>
    </li>
  );
}

export function MapsPage(props: { r: MapsRoute }) {
  const r = props.r;
  useMapData();
  const [q, setQ] = useState(r.q);
  useEffect(() => setQ((x) => (x.trim() === r.q ? x : r.q)), [r.q]);
  const go = (p: Partial<Omit<MapsRoute, "name">>) => navigate(href.maps({ ...r, ...p }), { replace: true, keepScroll: true });
  const counts = mapCounts(body);
  const needle = plain(r.q);
  const list = MAP_LIST.filter(([id, d, water]) => (!r.d.length || r.d.includes(d)) && (!r.water || water) && plain(mapName(id)).includes(needle));
  if (r.sort === "az") list.sort((a, b) => mapName(a[0]).localeCompare(mapName(b[0])));
  if (r.sort === "bosses") list.sort((a, b) => (counts.boss.get(b[0]) ?? 0) - (counts.boss.get(a[0]) ?? 0)); // stable: ties keep game order
  const tile = ([id, d, water]: (typeof MAP_LIST)[number]) => (
    <Tile key={id} id={id} d={d} water={water} boss={counts.boss.get(id) ?? 0} race={counts.race.get(id) ?? 0} />
  );
  return (
    <>
      <header class="page-h">
        <h1 class="title ti">
          <Spr family="ui" k="MapBeginner" size={64} label />
          Maps
        </h1>
        <p class="lede">Every map in Bloons TD 6, with the boss events and races played on it.</p>
      </header>
      <div class="map-bar">
        <label class="map-search">
          <Spr family="ui" k="Search" size={24} label />
          <span class="vh">Search maps</span>
          <input
            type="search"
            placeholder="Search maps"
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
        <div class="rv-chips" role="group" aria-label="Difficulty">
          {DIFF_LABEL.map((l, d) => {
            const on = r.d.includes(d);
            return (
              <button key={l} type="button" class={`rv-chip mp-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => go({ d: on ? r.d.filter((x) => x !== d) : [...r.d, d] })}>
                <DiffIcon d={d} size={24} />
                {l}
              </button>
            );
          })}
          <button type="button" class={`rv-chip mp-chip${r.water ? " on" : ""}`} aria-pressed={r.water} onClick={() => go({ water: !r.water })}>
            <Spr family="ui" k="Water" size={24} label />
            Water
          </button>
        </div>
        <div class="rv-chips" role="group" aria-label="Sort">
          {SORTS.map(([s, l]) => (
            <button key={s} type="button" class={`rv-chip${r.sort === s ? " on" : ""}`} aria-pressed={r.sort === s} onClick={() => go({ sort: s })}>
              {l}
            </button>
          ))}
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
              <section key={l} class="map-sec" aria-labelledby={`map-h${d}`}>
                <h2 class="kicker-h mp-h" id={`map-h${d}`}>
                  <DiffIcon d={d} size={24} />
                  {l} <span class="bs-count num">{rows.length}</span>
                </h2>
                <ul class="map-grid">{rows.map(tile)}</ul>
              </section>
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
  const wiki = e.kind === "boss" && !e.id;
  const inner = (
    <>
      {e.kind === "boss" ? <Spr family="boss" k={e.type} size={40} label optional /> : <EvIcon k="race" size={40} />}
      <span class="bs-ev-m">
        <strong>{e.kind === "boss" ? (e.n ? bossTitle(e.type, e.n) : bossName(e.type)) : e.name}</strong>
        <span class="quiet">{wiki ? oldDates(e.start, e.end) : `${fmtDate(e.start)} – ${fmtDate(e.end)}`}</span>
      </span>
      {!wiki && <StatusBadge start={e.start} end={e.end} />}
    </>
  );
  return (
    <li class={wiki ? "old" : undefined}>
      {wiki ? <div class="bs-ev">{inner}</div> : <A href={e.kind === "boss" ? href.boss(e.id!) : href.race(e.id)} class="bs-ev">{inner}</A>}
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
      {rows.length ? <ul class="bs-past">{rows.map((e) => <EventRow key={e.kind === "boss" ? `${e.type}${e.n}${e.start}` : e.id} e={e} />)}</ul> : loading ? <Skeleton rows={2} what={title} /> : <p class="quiet">{none}</p>}
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
      {section("Races", races, "No races on record for this map.")}
    </>
  );
}
