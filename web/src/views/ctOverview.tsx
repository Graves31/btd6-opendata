import { useEffect, useState } from "preact/hooks";
import type { CT, CTTeamEntry, CTTile, Guild } from "../../../src/nk/types.ts";
import { ordinal } from "../boards.ts";
import { fmtClock, fmtDay, fmtInt, status } from "../format.ts";
import { Freshness } from "../fresh.tsx";
import { cutoffs, PAGE_SIZE } from "../medals.ts";
import { byRecent, myTeam, nextMedal, onMyTeam, placings, type MyTeam, type TeamHistoryEntry } from "../myTeam.ts";
import { ctCutoffsKey, ctKey, guildKey, historyKey, href, idFromUrl, teamHistoryKey } from "../routes.ts";
import { store } from "../nav.ts";
import { A, body, Emblem, EvIcon, Gate, peek, useFullRender, useTick } from "../ui.tsx";
import { allEvents, ended, Medal } from "./events.tsx";
import { HexThumb } from "./ctMap.tsx";

const relicsKey = "/api/ct/relics";

const tilesOf = (id: string): CTTile[] => body<{ tiles: CTTile[] }>(ctKey(id, "map"))?.tiles ?? [];
const winnerOf = (id: string) => body<CTTeamEntry[]>(ctKey(id, "teams"))?.[0];
const gid = (r?: CTTeamEntry) => (r ? idFromUrl(r.profile) : "");
const relicsOf = (id: string) => body<{ cts: { id: string; relics: string[] }[] }>(relicsKey)?.cts?.find((c) => c.id === id)?.relics;

/** Loads keys into the store once the page is up (cached, batched; what the route already holds is not refetched). */
function useWant(keys: string[]): void {
  const k = keys.filter(Boolean).join("|");
  useEffect(() => void (k && store.want(k.split("|"))), [k]);
}

/** The team's own emblem when its guild is in memory, else an empty frame of the same size. */
export function TeamEmblem(p: { id: string; size: number }) {
  const g = body<Guild>(guildKey(p.id));
  return g ? <Emblem frame={g.frameURL} icon={g.iconURL} size={p.size} /> : <span class="emblem" style={{ width: `${p.size}px`, height: `${p.size}px` }} />;
}

function useMyTeam(): MyTeam | null {
  const [t, set] = useState(myTeam);
  useEffect(() => onMyTeam(() => set(myTeam())), []);
  return t;
}

// ─────────────────────────────── my team

function RankChips(p: { entries: TeamHistoryEntry[] }) {
  return (
    <ul class="ctm-chips" aria-label="Ranks in past CTs, newest first">
      {byRecent(p.entries)
        .slice(0, 8)
        .map((e) => (
          <li key={e.ct}>
            <A href={href.ct(e.ct, "teams")} title={`CT ${fmtDay(e.start)}`}>
              <b class="num">{e.rank !== null ? `#${fmtInt(e.rank)}` : "–"}</b>
              <span>{fmtDay(e.start)}</span>
            </A>
          </li>
        ))}
    </ul>
  );
}

/** The followed team's live place, only from team-board pages already in memory. */
function liveStanding(ct: CT, id: string): { rank: number; score: number; total: number } | undefined {
  for (let p = 1; p <= 40; p++) {
    const rows = body<CTTeamEntry[]>(ctKey(ct.id, "teams", p));
    if (!rows) break;
    const i = rows.findIndex((r) => gid(r) === id);
    if (i >= 0) return { rank: (p - 1) * PAGE_SIZE.ctTeam + i + 1, score: rows[i].score, total: ct.totalScores_team };
  }
  return undefined;
}

function MyTeamCard(p: { live?: CT }) {
  const my = useMyTeam();
  useWant(my ? [teamHistoryKey(my.id), guildKey(my.id), ...(p.live ? [ctCutoffsKey(p.live.id)] : [])] : []);
  if (!my)
    return (
      <p class="ctm-hint">
        <b>Follow your team:</b> open its page and tap <i>Set as my team</i>. Its results then wait for you here.
      </p>
    );
  const h = peek(teamHistoryKey(my.id));
  const entries = h?.ok ? ((h.data as unknown as { entries?: TeamHistoryEntry[] }).entries ?? []) : [];
  const last = byRecent(entries)[0];
  const stand = p.live ? liveStanding(p.live, my.id) : undefined;
  const snaps = p.live ? (peek(ctCutoffsKey(p.live.id))?.data as unknown as { team?: { ranks: Record<string, number> }[] } | undefined)?.team : undefined;
  const next = stand ? nextMedal(cutoffs("ctTeam", stand.total), stand.rank, stand.score, snaps?.at(-1)?.ranks) : undefined;
  const best = placings(entries);
  return (
    <section class="ctm" aria-label="My team">
      <A href={href.team(my.id)} class="ctm-id">
        <TeamEmblem id={my.id} size={64} />
        <span class="ctm-name">
          <span class="eyebrow">My team</span>
          <strong>{my.name}</strong>
        </span>
      </A>
      <div class="ctm-main">
        {p.live &&
          (stand ? (
            <p class="ctm-live">
              <span class="ctm-k">Live</span> <b class="num">{ordinal(stand.rank)}</b> with <b class="num">{fmtInt(stand.score)}</b> pts
              {next && (
                <span class="quiet">
                  {" "}
                  · {next.gap !== undefined ? `${fmtInt(next.gap)} pts` : "a few places"} to the {next.label} cut-off
                </span>
              )}
            </p>
          ) : (
            <p class="ctm-live quiet">Its live rank shows here once this CT ends and the result is archived.</p>
          ))}
        {last ? (
          <p>
            <span class="ctm-k">Last CT</span>{" "}
            {last.rank !== null ? (
              <>
                <b class="num">{ordinal(last.rank)}</b>
                {last.total ? ` of ${fmtInt(last.total)}` : ""}
              </>
            ) : (
              "unranked"
            )}
            {last.group?.rank ? (
              <>
                {" "}
                · <b class="num">{ordinal(last.group.rank)}</b> in its group
              </>
            ) : null}
            {best && best.best !== best.last && <span class="quiet"> · best {ordinal(best.best)}</span>}
          </p>
        ) : (
          <p class="quiet">{h?.ok ? "No archived CT results for this team yet." : "Loading its results…"}</p>
        )}
        {entries.length > 1 && <RankChips entries={entries} />}
      </div>
    </section>
  );
}

// ─────────────────────────────── now / next

function Clock(p: { to: number }) {
  useTick();
  return <span class="ctn-clock num">{fmtClock(p.to - Date.now())}</span>;
}

function NowCard(p: { ct: CT; live: boolean }) {
  const { ct, live } = p;
  const top = body<CTTeamEntry[]>(ctKey(ct.id, "teams"))?.slice(0, 3) ?? [];
  const relics = relicsOf(ct.id);
  useWant(top.map((r) => guildKey(gid(r))));
  const tiles = tilesOf(ct.id);
  return (
    <section class={`ctn ${live ? "live" : "soon"}`} aria-label={live ? "Contested Territory now" : "Next Contested Territory"}>
      <div class="ctn-h">
        <EvIcon k="ct" size={56} />
        <div class="ctn-hm">
          <p class="eyebrow">{live ? "Now" : "Next"}</p>
          <h2 class="ctn-t">
            {fmtDay(ct.start)} – {fmtDay(ct.end)}
          </h2>
          <p class="ctn-when">
            {live ? "Ends in " : "Starts in "}
            <Clock to={live ? ct.end : ct.start} />
          </p>
        </div>
        <A href={href.ct(ct.id, "map")} class="ctn-btn">
          Open the map →
        </A>
      </div>
      <div class="ctn-body">
        {tiles.length > 0 && (
          <A href={href.ct(ct.id, "map")} class="ctn-hex" label="Map of this CT">
            <HexThumb tiles={tiles} size={live ? 200 : 240} />
          </A>
        )}
        <div class="ctn-side">
          {live && top.length > 0 && (
            <ol class="ctn-top" aria-label="Top teams">
              {top.map((r, i) => (
                <li key={r.profile}>
                  <A href={href.team(gid(r))}>
                    <Medal board="ctTeam" rank={i + 1} size={24} />
                    <TeamEmblem id={gid(r)} size={40} />
                    <span class="ctn-tn">{r.displayName}</span>
                    <b class="num">{fmtInt(r.score)}</b>
                  </A>
                </li>
              ))}
            </ol>
          )}
          {live && top.length === 0 && <p class="quiet">The team board fills in as teams score.</p>}
          {!live && (
            <p class="ctn-facts">
              {relics?.length ? (
                <span>
                  <b class="num">{relics.length}</b> relics on the map
                </span>
              ) : null}
              <span>{tiles.length ? `${fmtInt(tiles.length)} tiles` : "The map arrives with the event"}</span>
            </p>
          )}
          {live && (
            <A href={href.ct(ct.id, "teams")} class="ctn-more">
              Full team board →
            </A>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────── past CTs

function PastCard(p: { ct: CT }) {
  const { ct } = p;
  const w = winnerOf(ct.id);
  const tiles = tilesOf(ct.id);
  const relics = relicsOf(ct.id);
  return (
    <li>
      <A href={href.ct(ct.id, "teams")} class="ctp">
        <span class="ctp-hex">{tiles.length > 0 ? <HexThumb tiles={tiles} size={96} /> : <EvIcon k="ct" size={48} />}</span>
        <span class="ctp-main">
          <strong class="ctp-d">
            {fmtDay(ct.start)} – {fmtDay(ct.end)}
          </strong>
          {w ? (
            <span class="ctp-win">
              <TeamEmblem id={gid(w)} size={56} />
              <span>
                <span class="ctp-wn">{w.displayName}</span>
                <span class="num ctp-ws">{fmtInt(w.score)} pts</span>
              </span>
            </span>
          ) : (
            <span class="quiet">
              {ct.totalScores_team || ct.totalScores_player ? "Winner loads with the board" : "Leaderboard no longer published by Ninja Kiwi"}
            </span>
          )}
          <span class="ctp-f">
            {ct.totalScores_team ? <span>{fmtInt(ct.totalScores_team)} teams</span> : null}
            {ct.totalScores_player ? <span>{fmtInt(ct.totalScores_player)} players</span> : null}
            {relics?.length ? <span>{relics.length} relics</span> : null}
          </span>
        </span>
      </A>
    </li>
  );
}

export function CTOverview() {
  const all = allEvents("ct") as CT[];
  const now = Date.now();
  const liveCt = all.find((e) => status(e.start, e.end, now).s === "live");
  const nextCt = [...all].reverse().find((e) => e.start > now);
  const past = all.filter((e) => ended(e));
  const full = useFullRender();
  const shown = full ? past : past.slice(0, 6);
  useWant(past.slice(0, 12).map((c) => guildKey(gid(winnerOf(c.id)))));
  useWant([relicsKey]);
  return (
    <>
      <header class="page-h">
        <h1 class="title ti">
          <EvIcon k="ct" size={64} />
          Contested Territory
        </h1>
        <p class="lede">Teams claim hexagon tiles over a week. Players and teams are ranked separately.</p>
        <Freshness k="/btd6/ct" />
      </header>
      <MyTeamCard live={liveCt} />
      {all.length === 0 && <Gate k="/btd6/ct" />}
      {liveCt && <NowCard ct={liveCt} live />}
      {nextCt && <NowCard ct={nextCt} live={false} />}
      {past.length > 0 && (
        <>
          <h2 class="ctp-h">Past Contested Territories</h2>
          <ul class="ctp-grid">
            {shown.map((c) => (
              <PastCard key={c.id} ct={c} />
            ))}
          </ul>
        </>
      )}
      {!peek(historyKey("ct")) && <p class="quiet">Loading older events…</p>}
    </>
  );
}
