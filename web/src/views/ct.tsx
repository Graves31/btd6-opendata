import type {
  CT,
  CTPlayerEntry,
  CTTeamEntry,
  CTTiles,
} from "../../../src/nk/types.ts";
import {
  cap,
  fmtDay,
  fmtInt,
  fmtWhen,
  human,
  status,
} from "../format.ts";
import { ordinal } from "../boards.ts";
import { RELIC_INFO } from "../data/names.ts";
import { Freshness } from "../fresh.tsx";
import {
  BOARD_CAP,
  PAGE_SIZE,
  type Board,
} from "../medals.ts";
import {
  CT_GROUP_PLACEHOLDER,
  ctGroupKey,
  ctKey,
  href,
  idFromUrl,
  type CTTab,
} from "../routes.ts";
import { hasArt, Spr } from "../sprite.tsx";
import {
  LinkRow,
  A,
  body,
  Gate,
  Pager,
  peek,
  Rank,
  Section,
  Stat,
  Tabs,
} from "../ui.tsx";
import { NotFound } from "./errors.tsx";
import { boardGone, CutRow, CutoffStrip, ended, EventHead, findEvent, isMissing, lbMeta, Medal, RankTh, useFits } from "./events.tsx";
// ─────────────────────────────── CT

const CT_TABS = ["teams", "players", "tiles"] as const;

export function CTPage(props: { id: string; tab: CTTab; p: number }) {
  const { id, tab, p } = props;
  const asideRef = useFits<HTMLElement>();
  const ev = findEvent<CT>("ct", id);
  const key = ctKey(id, tab, p);
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
  const upcoming = ev && status(ev.start, ev.end).s === "upcoming";
  const done = ended(ev);
  // Old CTs: NK stops serving their boards (totals reset to 0, empty or failing leaderboards).
  const gone = !!ev && done && tab !== "tiles" && !!entry && boardGone(entry);
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
  const rows = body<(CTPlayerEntry | CTTeamEntry)[]>(key);
  return (
    <>
      <EventHead
        eyebrow="Contested Territory"
        icon="ct"
        title={
          ev ? `${fmtDay(ev.start)} – ${fmtDay(ev.end)}` : "Contested Territory"
        }
        ev={ev}
        stats={
          ev && (
            <>
              <Stat
                k="Teams"
                v={
                  gone || !ev.totalScores_team
                    ? "–"
                    : fmtInt(ev.totalScores_team)
                }
              />
              <Stat
                k="Players"
                v={
                  gone || !ev.totalScores_player
                    ? "–"
                    : fmtInt(ev.totalScores_player)
                }
              />
            </>
          )
        }
      />
      <div class="controls">
        <Tabs
          label="Leaderboard"
          items={CT_TABS.map((t) => ({
            href: href.ct(id, t),
            label: cap(t),
            current: t === tab,
          }))}
        />
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
          {tab === "tiles" && (
            <>
              <Freshness k={key} ended={done} />
              <Gate
                k={key}
                rows={25}
                empty={
                  upcoming && ev ? (
                    <p>
                      This CT starts {fmtWhen(ev.start)}. The map appears once
                      it has started.
                    </p>
                  ) : (
                    <p>No tile data yet.</p>
                  )
                }
              />
              <CTTilesView tiles={body<CTTiles>(key)} />
            </>
          )}
          {tab !== "tiles" && (
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
                {rows && rows.length > 0 && (
                  <CutoffStrip
                    variant="fold"
                    board={board}
                    total={total}
                    scoreAt={scoreAt}
                  />
                )}
                <Gate
                  k={key}
                  rows={25}
                  empty={
                    upcoming && ev ? (
                      <p>
                        This CT starts {fmtWhen(ev.start)}. Scores appear once
                        teams capture tiles.
                      </p>
                    ) : (
                      <p>No scores yet.</p>
                    )
                  }
                />
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

/** Relic name + effect from the game's data (names.ts), else the humanised id. */
const relicInfo = (id: string) =>
  RELIC_INFO[id] ?? { name: human(id), description: "" };

function CTTilesView(props: { tiles?: CTTiles }) {
  if (!props.tiles) return null;
  const tiles = props.tiles.tiles;
  const byType = new Map<string, number>();
  const relics: { id: string; relic: string; game: string }[] = [];
  let banners = 0;
  for (const t of tiles) {
    byType.set(t.gameType, (byType.get(t.gameType) ?? 0) + 1);
    if (t.type.startsWith("Relic - "))
      relics.push({ id: t.id, relic: t.type.slice(8), game: t.gameType });
    if (t.type === "Banner") banners++;
  }
  const max = Math.max(...byType.values());
  return (
    <div class="split even">
      <Section
        title="Tiles by game type"
        aside={`${tiles.length} tiles · ${banners} banners`}
      >
        <ol class="bars">
          {[...byType]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <li
                key={k}
                class="has-i"
                style={{ "--w": `${(v / max) * 100}%` }}
              >
                {GAME_ICON[k] ? (
                  <Spr family="ui" k={GAME_ICON[k]} size={32} label />
                ) : (
                  <span class="spr-gap" />
                )}
                <span>{GAME_TYPE[k] ?? human(k)}</span>
                <span class="num">{v}</span>
              </li>
            ))}
        </ol>
      </Section>
      <Section title="Relics" aside={`${relics.length} on the map`}>
        <div class="board-wrap">
          <table class="board compact relics">
            <thead>
              <tr>
                <th>Relic</th>
                <th>Tile</th>
                <th>Game</th>
              </tr>
            </thead>
            <tbody>
              {relics.map((r) => {
                const info = relicInfo(r.relic);
                return (
                  <tr key={r.id}>
                    <td>
                      <span
                        class="relic"
                        title={
                          info.description
                            ? `${info.name}: ${info.description}`
                            : info.name
                        }
                      >
                        {hasArt("relic", r.relic) ? (
                          <Spr
                            family="relic"
                            k={r.relic}
                            size={36}
                            name={info.name}
                            label
                          />
                        ) : (
                          <Spr
                            family="ui"
                            k="Relic"
                            size={36}
                            name={info.name}
                            label
                            optional
                          />
                        )}
                        <span class="relic-t">
                          <span class="relic-n">{info.name}</span>
                          {info.description && (
                            <span class="relic-d">{info.description}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td class="mono">{r.id}</td>
                    <td>
                      <span class="ifact">
                        {GAME_ICON[r.game] && (
                          <Spr
                            family="ui"
                            k={GAME_ICON[r.game]}
                            size={24}
                            label
                            optional
                          />
                        )}
                        <span class="m-hide">
                          {GAME_TYPE[r.game] ?? human(r.game)}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
