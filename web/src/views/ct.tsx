import { useEffect, useRef, useState } from "preact/hooks";
import type {
  CT,
  CTPlayerEntry,
  CTTeamEntry,
  CTTile,
  CTTiles,
  Guild,
} from "../../../src/nk/types.ts";
import {
  fmtDay,
  fmtInt,
  fmtWhen,
  human,
  status,
} from "../format.ts";
import { ordinal } from "../boards.ts";
import {
  cutoffTrend,
  gameMix,
  relicHistory,
  relicOf,
  tileStats,
  type CTCutoffs,
  type RelicCT,
} from "../ctStats.ts";
import { RELIC_INFO } from "../data/names.ts";
import { Freshness } from "../fresh.tsx";
import {
  BOARD_CAP,
  PAGE_SIZE,
  type Board,
} from "../medals.ts";
import { store } from "../nav.ts";
import {
  CT_GROUP_PLACEHOLDER,
  CT_RELICS_KEY,
  ctCutoffsKey,
  ctGroupKey,
  ctKey,
  guildKey,
  href,
  idFromUrl,
  type CTTab,
} from "../routes.ts";
import { hasArt, Spr } from "../sprite.tsx";
import {
  LinkRow,
  A,
  body,
  Emblem,
  Gate,
  Pager,
  peek,
  Rank,
  Section,
  Stat,
} from "../ui.tsx";
import { NotFound } from "./errors.tsx";
import { boardGone, CutRow, CutoffStrip, ended, EventHead, findEvent, isMissing, lbMeta, Medal, RankTh, useFits } from "./events.tsx";
import { HexMap, HexThumb, HexTilePanel, TileKey } from "./ctMap.tsx";
// ─────────────────────────────── CT

const CT_TABS = ["teams", "players", "map"] as const;
const TAB_LABEL = { teams: "Teams", players: "Players", map: "Map" } as const;

/** Loads keys into the store once the page is up (batched; what the route already holds is not refetched). */
function useWant(keys: string[]): void {
  const k = keys.join("|");
  useEffect(() => void (k && store.want(k.split("|"))), [k]);
}

/** "+12,340 since yesterday" for one medal rank, from the last two daily snapshots. */
function trendText(t: { delta: number; since: number; at: number }): string {
  const day = t.at - t.since <= 36 * 3_600_000 ? "yesterday" : fmtDay(t.since);
  return t.delta === 0 ? `no change since ${day}` : `${t.delta > 0 ? "+" : ""}${fmtInt(t.delta)} since ${day}`;
}

/** A team's emblem from its guild when that is in memory, else an empty frame. */
function TeamEmblem(p: { r: CTTeamEntry; size: number }) {
  const g = body<Guild>(guildKey(idFromUrl(p.r.profile)));
  return g ? <Emblem frame={g.frameURL} icon={g.iconURL} size={p.size} /> : <span class="emblem" style={{ width: `${p.size}px`, height: `${p.size}px` }} />;
}

export function CTPage(props: { id: string; tab: CTTab; p: number }) {
  const { id, p } = props;
  const asideRef = useFits<HTMLElement>();
  const ev = findEvent<CT>("ct", id);
  const upcoming = !!ev && status(ev.start, ev.end).s === "upcoming";
  const done = ended(ev);
  const live = !!ev && !upcoming && !done;
  // Before the start only the map exists (the tiles are published early); an old ?tab=tiles link opens it too.
  const tab: "teams" | "players" | "map" = upcoming || props.tab === "map" ? "map" : props.tab;
  const key = ctKey(id, tab, p);
  const tilesKey = ctKey(id, "map");
  const tiles = body<CTTiles>(tilesKey)?.tiles;
  const top = upcoming ? undefined : body<CTTeamEntry[]>(ctKey(id, "teams"));
  const winner = top?.[0];
  useWant([tilesKey, CT_RELICS_KEY, ctCutoffsKey(id), ...(top ?? []).slice(0, 3).map((r) => guildKey(idFromUrl(r.profile)))]);
  if (!ev && isMissing(key)) {
    return (
      <NotFound
        what="Contested Territory event"
        back={{ href: href.events("ct"), label: "All CT events" }}
      />
    );
  }
  const entry = peek(key);
  const maxPages = entry?.data?.maxPages ?? 1;
  // Old CTs: NK stops serving their boards (totals reset to 0, empty or failing leaderboards).
  const gone = !!ev && done && tab !== "map" && !!entry && boardGone(entry);
  const total =
    tab === "players"
      ? ev?.totalScores_player
      : tab === "teams"
        ? ev?.totalScores_team
        : undefined;
  const board: Board = tab === "players" ? "ctPlayer" : "ctTeam";
  const scoreAt = (rank: number) => {
    const r = body<CTTeamEntry[]>(
      ctKey(id, tab, Math.ceil(rank / PAGE_SIZE[board])),
    )?.[(rank - 1) % PAGE_SIZE[board]];
    return r && `${fmtInt(r.score)} pts`;
  };
  const snaps = live ? (peek(ctCutoffsKey(id))?.data as unknown as CTCutoffs | undefined) : undefined;
  const trendAt = snaps
    ? (rank: number) => {
        const t = cutoffTrend(board === "ctPlayer" ? snaps.player : snaps.team, rank);
        return t && trendText(t);
      }
    : undefined;
  const rows = body<(CTPlayerEntry | CTTeamEntry)[]>(key);
  const ts = tiles && tileStats(tiles);
  const n = (v: number) => (gone || !v ? "–" : fmtInt(v));
  const wg = winner && done && !gone ? body<Guild>(guildKey(idFromUrl(winner.profile))) : undefined;
  return (
    <>
      <EventHead
        eyebrow="Contested Territory"
        icon="ct"
        title={
          ev ? `${fmtDay(ev.start)} – ${fmtDay(ev.end)}` : "Contested Territory"
        }
        ev={ev}
        backdrop={tiles && <HexThumb tiles={tiles} size={420} />}
        stats={
          ev &&
          (upcoming ? (
            ts && (
              <>
                <Stat k="Tiles" v={fmtInt(ts.tiles)} />
                <Stat k="Relics" v={fmtInt(ts.relics)} />
                <Stat k="Banners" v={fmtInt(ts.banners)} />
                <Stat k="Team starts" v={fmtInt(ts.starts)} />
              </>
            )
          ) : (
            <>
              {winner && done && !gone && (
                <div class="stat ct-winner">
                  <dt>Winner</dt>
                  <dd>
                    <A href={href.team(idFromUrl(winner.profile))} class="ct-win">
                      {wg && <Emblem frame={wg.frameURL} icon={wg.iconURL} size={56} eager />}
                      <span class="ct-win-t">
                        <strong>{winner.displayName}</strong>
                        <span>{fmtInt(winner.score)} pts</span>
                      </span>
                    </A>
                  </dd>
                </div>
              )}
              <Stat k="Teams" v={n(ev.totalScores_team)} />
              <Stat k="Players" v={n(ev.totalScores_player)} />
              {live && <Stat k="Top score" v={winner ? fmtInt(winner.score) : "–"} />}
            </>
          ))
        }
      />
      <div class="controls ct-tabs">
        <nav class="tabs" aria-label="Contested Territory">
          {CT_TABS.map((t) =>
            upcoming && t !== "map" ? (
              <span key={t} class="tab dis" aria-disabled="true">
                {TAB_LABEL[t]}
              </span>
            ) : (
              <A
                key={t}
                href={href.ct(id, t)}
                class={t === tab ? "tab on" : "tab"}
                current={t === tab}
                keepScroll
              >
                {TAB_LABEL[t]}
              </A>
            ),
          )}
        </nav>
        {upcoming && ev && (
          <p class="quiet small ct-soon">
            Teams and Players open when the CT starts, {fmtWhen(ev.start)}.
          </p>
        )}
      </div>
      {gone ? (
        <div class="empty ct-gone">
          <p class="empty-t">Leaderboard no longer published</p>
          <p>
            Ninja Kiwi removes older Contested Territory leaderboards from its
            Open Data API, so this CT's {tab === "players" ? "player" : "team"}{" "}
            ranking can't be shown.{" "}
            {tab === "teams" && ev
              ? "Team pages may still list the placement if this site archived it."
              : ""}
          </p>
        </div>
      ) : (
        <>
          {tab === "map" && (
            <>
              <Freshness k={key} ended={done} />
              <Gate k={key} rows={25} empty={<p>No tile data yet.</p>} />
              <CTMapTab id={id} tiles={tiles} />
            </>
          )}
          {tab !== "map" && (
            <div class="split ct-split">
              <section class="board-sec" aria-labelledby="lb-h">
                <h2 class="vh" id="lb-h">
                  {tab === "players" ? "Player" : "Team"} leaderboard
                </h2>
                <div class="lb-bar">
                  <Freshness
                    k={key}
                    ended={done}
                    shown={total ? Math.min(total, BOARD_CAP) : undefined}
                    total={total}
                  />
                </div>
                {tab === "teams" && p === 1 && rows && rows.length > 0 && (
                  <Podium rows={rows as CTTeamEntry[]} />
                )}
                {rows && rows.length > 0 && (
                  <CutoffStrip
                    variant="fold"
                    board={board}
                    total={total}
                    scoreAt={scoreAt}
                    trendAt={trendAt}
                  />
                )}
                <Gate k={key} rows={25} empty={<p>No scores yet.</p>} />
                {tab === "players" && (
                  <CTPlayers
                    rows={body<CTPlayerEntry[]>(key)}
                    p={p}
                    total={total}
                  />
                )}
                {tab === "teams" && (
                  <CTTeams
                    id={id}
                    rows={body<CTTeamEntry[]>(key)}
                    p={p}
                    total={total}
                  />
                )}
                <Pager
                  page={p}
                  maxPages={maxPages}
                  to={(x) => href.ct(id, tab, x)}
                />
              </section>
              <aside class="co-aside" ref={asideRef}>
                {rows && rows.length > 0 && (
                  <CutoffStrip
                    variant="side"
                    board={board}
                    total={total}
                    scoreAt={scoreAt}
                    trendAt={trendAt}
                  />
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** The top three teams, large: 2nd | 1st | 3rd. */
function Podium(props: { rows: CTTeamEntry[] }) {
  const top = props.rows.slice(0, 3);
  if (!top.length) return null;
  return (
    <ol class="ctpod-list" aria-label="Top three teams">
      {[1, 0, 2].map((i) => {
        const r = top[i];
        if (!r) return null;
        return (
          <li key={r.profile} class={`ctpod ctpod-${i + 1}`}>
            <A href={href.team(idFromUrl(r.profile))} class="ctpod-a">
              <span class="ctpod-rank">{i + 1}</span>
              <TeamEmblem r={r} size={i === 0 ? 104 : 76} />
              <span class="ctpod-n">{r.displayName}</span>
              <span class="ctpod-s">{fmtInt(r.score)} pts</span>
            </A>
          </li>
        );
      })}
    </ol>
  );
}

function CTPlayers(props: {
  rows?: CTPlayerEntry[];
  p: number;
  total?: number;
}) {
  if (!props.rows) return null;
  const size = PAGE_SIZE.ctPlayer;
  const lm = lbMeta(
    props.rows.map((_, i) => ({ rank: (props.p - 1) * size + i + 1 })),
    "ctPlayer",
    props.total,
  );
  return (
    <div class="board-wrap narrow">
      <table class="board lb" aria-label="Player leaderboard">
        <thead>
          <tr>
            <RankTh />
            <th>Player</th>
            <th class="num">Points</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => [
            <LinkRow
              key={`${r.profile}-${i}`}
              href={href.player(idFromUrl(r.profile))}
              class={lm[i].cls || undefined}
            >
              <Rank
                n={(props.p - 1) * size + i + 1}
                board="ctPlayer"
                total={props.total}
                medal={lm[i].medal}
              />
              <td class="pl">
                <A href={href.player(idFromUrl(r.profile))}>{r.displayName}</A>
              </td>
              <td class="num lead hero">{fmtInt(r.score)}</td>
            </LinkRow>,
            lm[i].cut && (
              <CutRow
                key={`cut-${i}`}
                board="ctPlayer"
                cut={lm[i].cut!}
                cols={3}
                score={`${fmtInt(r.score)} pts`}
              />
            ),
          ])}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Whether a team row's group link leads anywhere. Once NK drops a CT's groups (2–3 days after the end) every team
 * links to one placeholder group whose page answers "No Group Available": no link then (and so no prefetch).
 * `shared`: how many rows on this page link the same group — more than a group can hold means a placeholder.
 */
function hasGroup(ctId: string, gid: string, shared: number): boolean {
  if (!gid || gid === CT_GROUP_PLACEHOLDER || shared > 4) return false;
  const e = peek(ctGroupKey(ctId, gid));
  return !(e && !e.ok && String(e.data?.error ?? "") === "No Group Available");
}

/** A team's place in its CT group ("1st of 4"), once that group's board is in memory (its link prefetches it). */
function groupPlace(
  ctId: string,
  groupUrl: string,
  teamUrl: string,
): { rank: number; of: number } | undefined {
  const grp = body<CTTeamEntry[]>(ctGroupKey(ctId, idFromUrl(groupUrl)));
  const i =
    grp?.findIndex((x) => idFromUrl(x.profile) === idFromUrl(teamUrl)) ?? -1;
  return grp && i >= 0 ? { rank: i + 1, of: grp.length } : undefined;
}

function CTTeams(props: {
  id: string;
  rows?: CTTeamEntry[];
  p: number;
  total?: number;
}) {
  if (!props.rows) return null;
  const uses = new Map<string, number>();
  for (const r of props.rows) {
    const gid = idFromUrl(r.group);
    uses.set(gid, (uses.get(gid) ?? 0) + 1);
  }
  const size = PAGE_SIZE.ctTeam;
  const lm = lbMeta(
    props.rows.map((_, i) => ({ rank: (props.p - 1) * size + i + 1 })),
    "ctTeam",
    props.total,
  );
  let noGroups = false;
  const table = (
    <div class="board-wrap narrow">
      <table class="board lb" aria-label="Team leaderboard">
        <thead>
          <tr>
            <RankTh />
            <th>Team</th>
            <th class="num">Points</th>
            <th class="num">Group</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => {
            const gid = idFromUrl(r.group);
            const linked = hasGroup(props.id, gid, uses.get(gid) ?? 0);
            const g = linked
              ? groupPlace(props.id, r.group, r.profile)
              : undefined;
            if (!linked) noGroups = true;
            return [
              <LinkRow
                key={`${r.profile}-${i}`}
                href={href.team(idFromUrl(r.profile))}
                class={lm[i].cls || undefined}
              >
                <Rank
                  n={(props.p - 1) * size + i + 1}
                  board="ctTeam"
                  total={props.total}
                  medal={lm[i].medal}
                />
                <td class="pl">
                  <A href={href.team(idFromUrl(r.profile))}>{r.displayName}</A>
                </td>
                <td class="num lead hero">{fmtInt(r.score)}</td>
                <td class="num grp">
                  {!linked ? (
                    <span
                      class="nil"
                      title="Ninja Kiwi no longer publishes this CT's groups"
                    >
                      n/a
                    </span>
                  ) : (
                    <A
                      href={href.ctgroup(props.id, gid)}
                      class="small-link"
                      label={
                        g
                          ? `${r.displayName}: ${ordinal(g.rank)} of ${g.of} in its group`
                          : `${r.displayName}'s group`
                      }
                    >
                      {g ? (
                        <span class="grp-in">
                          <Medal board="ctGroup" rank={g.rank} size={20} />
                          <span>
                            {ordinal(g.rank)}{" "}
                            <span class="grp-of">of {g.of}</span>
                          </span>
                        </span>
                      ) : (
                        "Group"
                      )}
                    </A>
                  )}
                </td>
              </LinkRow>,
              lm[i].cut && (
                <CutRow
                  key={`cut-${i}`}
                  board="ctTeam"
                  cut={lm[i].cut!}
                  cols={4}
                  score={`${fmtInt(r.score)} pts`}
                />
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
  return noGroups ? (
    <>
      {table}
      <p class="quiet small tbl-note">
        n/a: Ninja Kiwi no longer publishes this CT's groups.
      </p>
    </>
  ) : (
    table
  );
}

const GAME_TYPE: Record<string, string> = {
  LeastCash: "Least Cash",
  LeastTiers: "Least Tiers",
  Race: "Race",
  Boss: "Boss",
  TeamStart: "Team start",
};
/** CT game type → ui icon. */
const GAME_ICON: Record<string, string> = {
  LeastCash: "LeastCash",
  LeastTiers: "LeastTiers",
  Race: "GameTime",
  Boss: "BossTier",
};
/** The four game types a relic tile can have (filter chips). */
const FILTERS = ["LeastCash", "LeastTiers", "Race", "Boss"] as const;

/** Relic name + effect from the game's data (names.ts), else the humanised id. */
const relicInfo = (id: string) =>
  RELIC_INFO[id] ?? { name: human(id), description: "" };

const GameBadge = (p: { g: string; size: number }) => (
  <span class="ifact">
    {GAME_ICON[p.g] && <Spr family="ui" k={GAME_ICON[p.g]} size={p.size} label optional />}
    <span>{GAME_TYPE[p.g] ?? human(p.g)}</span>
  </span>
);

/** The map tab: game-type filter, the hex map with the selected tile's details, the game mix and the relic grid. */
function CTMapTab(props: { id: string; tiles?: CTTile[] }) {
  const [sel, setSel] = useState<string>();
  const [game, setGame] = useState<string>();
  const mapRef = useRef<HTMLDivElement>(null);
  const { tiles, id } = props;
  if (!tiles) return null;
  const ts = tileStats(tiles);
  const cts = (peek(CT_RELICS_KEY)?.data as unknown as { cts?: RelicCT[] } | undefined)?.cts;
  const mix = gameMix(id, ts.games, cts);
  const relics = tiles.filter((t) => relicOf(t) && (!game || t.gameType === game));
  const pick = (tile: string) => {
    setSel(tile);
    mapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const kinds = Object.entries(ts.games).sort((a, b) => b[1] - a[1]);
  return (
    <div class="ctv">
      <div class="ctv-chips" role="group" aria-label="Filter by game type">
        <button type="button" aria-pressed={!game} onClick={() => setGame(undefined)}>
          All <span class="num">{ts.tiles}</span>
        </button>
        {FILTERS.filter((g) => ts.games[g]).map((g) => (
          <button key={g} type="button" aria-pressed={game === g} onClick={() => setGame(game === g ? undefined : g)}>
            <GameBadge g={g} size={20} /> <span class="num">{ts.games[g]}</span>
          </button>
        ))}
      </div>
      <div class="ctv-main" ref={mapRef}>
        <div class="ctv-map">
          <HexMap tiles={tiles} sel={sel} onSel={setSel} filter={game ? (t) => t.gameType === game : undefined} />
        </div>
        <aside class="ctv-side" aria-label="Selected tile">
          <HexTilePanel tile={tiles.find((t) => t.id === sel)} />
        </aside>
      </div>
      <Section title="Tiles by game type" aside={`${ts.tiles} tiles · ${ts.banners} banners`}>
        <ol class="ctv-bar" aria-hidden="true">
          {kinds.map(([k, v]) => (
            <li key={k} class={`g-${k}`} style={{ flex: v }} title={`${GAME_TYPE[k] ?? human(k)}: ${v}`}>
              {v}
            </li>
          ))}
        </ol>
        <ul class="ctv-leg">
          {kinds.map(([k, v]) => (
            <li key={k} class={`g-${k}`}>
              <TileKey g={k} />
              <GameBadge g={k} size={24} />
              <b class="num">{v}</b>
              {mix?.by[k] && <span class="quiet small">usually {mix.by[k].avg}</span>}
            </li>
          ))}
        </ul>
        {mix && <p class="quiet small">"Usually" is the average of the last {mix.of} CTs.</p>}
      </Section>
      <Section title="Relics" aside={`${relics.length}${game ? ` ${GAME_TYPE[game]}` : ""} on the map`}>
        {relics.length === 0 ? (
          <p class="quiet">No relics in this CT.</p>
        ) : (
          <ul class="relic-grid">
            {relics.map((t) => {
              const relic = relicOf(t)!;
              const info = relicInfo(relic);
              const h = cts ? relicHistory(id, relic, cts) : undefined;
              const hist =
                h && h.of > 0
                  ? h.seen === 0
                    ? "New"
                    : `In ${h.seen} of the last ${h.of} CTs · last ${fmtDay(h.last!)}`
                  : undefined;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    class={sel === t.id ? "rc on" : "rc"}
                    aria-pressed={sel === t.id}
                    onClick={() => pick(t.id)}
                    title={info.description ? `${info.name}: ${info.description}` : info.name}
                  >
                    <Spr
                      family={hasArt("relic", relic) ? "relic" : "ui"}
                      k={hasArt("relic", relic) ? relic : "Relic"}
                      size={56}
                      name={info.name}
                      label
                      optional
                    />
                    <span class="rc-n">{info.name}</span>
                    <span class="rc-g">
                      <GameBadge g={t.gameType} size={20} />
                      <span class="mono">{t.id}</span>
                    </span>
                    {hist && <span class={h!.seen === 0 ? "rc-h new" : "rc-h"}>{hist}</span>}
                    {info.description && <span class="rc-tip">{info.description}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
