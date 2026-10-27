import {
  useEffect,
  useState,
} from "preact/hooks";
import type {
  CT,
  CTTeamEntry,
} from "../../../src/nk/types.ts";
import {
  fmtDay,
  fmtInt,
} from "../format.ts";
import { ordinal } from "../boards.ts";
import { Freshness } from "../fresh.tsx";
import { backTo, store } from "../nav.ts";
import {
  CT_GROUP_PLACEHOLDER,
  ctGroupKey,
  href,
  idFromUrl,
  teamHistoryKey,
} from "../routes.ts";
import {
  LinkRow,
  A,
  body,
  Gate,
  peek,
  Rank,
  Section,
  Skeleton,
} from "../ui.tsx";
import { NotFound } from "./errors.tsx";
import { ended, findEvent, isMissing, lbMeta, CutRow, Medal, RankTh } from "./events.tsx";
export function CTGroupPage(props: { id: string; gid: string }) {
  const key = ctGroupKey(props.id, props.gid);
  const ev = findEvent<CT>("ct", props.id);
  const err = peek(key);
  if (
    props.gid === CT_GROUP_PLACEHOLDER ||
    (err && !err.ok && String(err.data?.error ?? "") === "No Group Available")
  ) {
    return (
      <NotFound
        what="CT group"
        back={{
          href: href.ct(props.id, "teams"),
          label: "CT team leaderboard",
        }}
      >
        <p>
          Ninja Kiwi stops publishing Contested Territory groups a few days
          after a CT ends, so this group can't be shown any more.
        </p>
      </NotFound>
    );
  }
  if (isMissing(key))
    return (
      <NotFound
        what="CT group"
        back={{
          href: href.ct(props.id, "teams"),
          label: "CT team leaderboard",
        }}
      />
    );
  const rows = body<CTTeamEntry[]>(key);
  const lm = lbMeta(
    (rows ?? []).map((_, i) => ({ rank: i + 1 })),
    "ctGroup",
  );
  return (
    <>
      <header class="page-h">
        <p class="eyebrow">
          {backTo() ? (
            <>Contested Territory{ev ? ` · ${fmtDay(ev.start)}` : ""}</>
          ) : (
            <A href={href.ct(props.id, "teams")}>
              ‹ Contested Territory{ev ? ` · ${fmtDay(ev.start)}` : ""}
            </A>
          )}
        </p>
        <h1 class="title">Team group</h1>
        <p class="lede">
          Teams in the same CT group compete for the same tiles.
        </p>
        <Freshness k={key} ended={ended(ev)} />
      </header>
      <Gate k={key} />
      {rows && (
        <div class="board-wrap narrow">
          <table class="board lb" aria-label="Group leaderboard">
            <thead>
              <tr>
                <RankTh />
                <th>Team</th>
                <th class="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => [
                <LinkRow
                  key={r.profile}
                  href={href.team(idFromUrl(r.profile))}
                  class={lm[i].cls || undefined}
                >
                  <Rank n={i + 1} board="ctGroup" medal={lm[i].medal} />
                  <td class="pl">
                    <A href={href.team(idFromUrl(r.profile))}>
                      {r.displayName}
                    </A>
                  </td>
                  <td class="num lead hero">
                    {fmtInt(r.score)}
                    {/* In a group, the place (and its reward) is what counts: the gap to the group's first. */}
                    {i > 0 && rows[0].score > r.score && (
                      <span class="gap" title="Behind the group's first">
                        <span class="vh">behind the group's first by </span>−
                        {fmtInt(rows[0].score - r.score)}
                      </span>
                    )}
                  </td>
                </LinkRow>,
                lm[i].cut && (
                  <CutRow
                    key={`cut-${i}`}
                    board="ctGroup"
                    cut={lm[i].cut!}
                    cols={3}
                    score={`${fmtInt(r.score)} pts`}
                  />
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────── team CT history (mounted on the Team page)

interface TeamHistory {
  team: string;
  entries: {
    ct: string;
    start: number;
    end: number;
    rank: number | null;
    total: number | null;
    score: number | null;
    group: { rank: number | null; of: number | null } | null;
  }[];
}

/**
 * A team's past CT placements, from the server's archive (GET /api/history/team/:guildId; no NK requests).
 * The key is in the team route's needs, so it is normally in memory already; if the endpoint fails or is missing
 * (older Worker) the section says so instead of loading forever.
 */
export function CTHistory(props: { guildId: string }) {
  const key = teamHistoryKey(props.guildId);
  const e = peek(key);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    setSettled(false);
    void store.want([key]).then(() => live && setSettled(true));
    return () => {
      live = false;
    };
  }, [key]);
  const h = e?.ok ? (e.data as unknown as TeamHistory) : undefined; // the Worker answers with the bare TeamHistory
  const entries = Array.isArray(h?.entries) ? h.entries : undefined;
  const aside = entries?.length
    ? `${entries.length} CT${entries.length === 1 ? "" : "s"} archived`
    : undefined;
  // Nothing to list (empty archive or endpoint unavailable): one muted line, no empty section.
  if (entries ? !entries.length : settled || e?.ok === false) {
    return (
      <p class="quiet ct-hist-none">
        {entries
          ? "No archived CT placements for this team yet."
          : "CT history isn't available right now."}
      </p>
    );
  }
  return (
    <Section title="Contested Territory history" aside={aside} class="ct-hist">
      {!entries ? (
        <Skeleton rows={3} />
      ) : (
        <div class="board-wrap narrow">
          <table class="board compact">
            <thead>
              <tr>
                <th>CT</th>
                <th class="rank">Global</th>
                <th class="num">Points</th>
                <th class="num">Group</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((x) => (
                <LinkRow key={x.ct} href={href.ct(x.ct, "teams")}>
                  <td class="pl">
                    <A href={href.ct(x.ct, "teams")}>
                      {fmtDay(x.start)} – {fmtDay(x.end)}
                    </A>
                  </td>
                  <Rank
                    n={x.rank}
                    board="ctTeam"
                    total={x.total ?? undefined}
                  />
                  <td class="num lead">
                    {x.score !== null ? fmtInt(x.score) : "–"}
                  </td>
                  <td class="num">
                    {x.group?.rank ? (
                      <span class="grp-in">
                        <Medal board="ctGroup" rank={x.group.rank} size={20} />
                        <span>
                          {ordinal(x.group.rank)}
                          {x.group.of ? (
                            <span class="grp-of"> of {x.group.of}</span>
                          ) : null}
                        </span>
                      </span>
                    ) : (
                      "–"
                    )}
                  </td>
                </LinkRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
