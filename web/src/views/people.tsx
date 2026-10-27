import type { ChallengeDocument, ChallengeSummary, Guild, UserProfile } from "../../../src/nk/types.ts";
import { dailyIsOut, dailyStart, fmtWhen, abilityName, cap, dailyAuthor, dailyInfo, dailyTitle, fmtCompact, fmtDate, fmtInt, fmtPct, human, unitName } from "../format.ts";
import { dailyNeighbours } from "../challenges.ts";
import { ctTierName } from "../medals.ts";
import { Freshness } from "../fresh.tsx";
import { Ruleset } from "../rules.tsx";
import { challengeKey, DAILY_KEY, guildKey, href, idFromUrl, isPublicId, userKey } from "../routes.ts";
import { hasArt, MEDAL_NAME, MODE_NAME, Spr } from "../sprite.tsx";

import { A, body, Emblem, Gate, Img, Section, Stat } from "../ui.tsx";
import { backTo } from "../nav.ts";
import { looksLikeMe, setPlayerId, useOak } from "../oak.ts";
import { CTHistory } from "./ctGroup.tsx";
import { EventHead } from "./events.tsx";
import { ErrorPanel } from "./errors.tsx";

/** Event medal tiers, best first (the game's order). Position encodes the tier. */
const MEDAL_ORDER = ["BlackDiamond", "RedDiamond", "BlueDiamond", "GoldDiamond", "DoubleGold", "GoldSilver", "DoubleSilver", "Silver", "Bronze"];

/**
 * Tiers an event type awards, from the game's own medal set: the art registry has a "<prefix>:<Tier>" key only
 * for medals the game has (boss and elite boss: all nine; CT local: no Gold Silver / Double Silver; CT global:
 * Blue Diamond down). Races use the bare keys (all nine). Tiers a player somehow has are always shown.
 */
function eventTiers(prefix: string, m: Partial<Record<string, number>>): string[] {
  const own = prefix ? MEDAL_ORDER.filter((t) => hasArt("eventMedal", `${prefix}:${t}`)) : [];
  const set = own.length ? own : MEDAL_ORDER;
  return MEDAL_ORDER.filter((t) => set.includes(t) || m[t]);
}
const medalKey = (prefix: string, t: string) => (prefix && hasArt("eventMedal", `${prefix}:${t}`) ? `${prefix}:${t}` : t);

/** One row per event type with medals, earned tiers only (best first); event types with none are one muted line. */
function MedalCabinet(props: { rows: [string, string, Partial<Record<string, number>>][] }) {
  const total = (m: Partial<Record<string, number>>) => Object.values(m).reduce((a: number, b) => a + (b ?? 0), 0);
  const rows = props.rows.filter(([, , m]) => total(m) > 0);
  const none = props.rows.filter(([, , m]) => total(m) === 0).map(([label]) => label);
  return (
    <div class="cabinet">
      {!rows.length && <p class="quiet">No event medals yet.</p>}
      {rows.map(([label, prefix, m]) => {
        const tiers = eventTiers(prefix, m).filter((t) => m[t]);
        return (
          <div key={label} class="cab-row">
            <p class="cab-l">
              {label}
              <span class="quiet">{fmtInt(total(m))}</span>
            </p>
            <ol class="cab-slots" aria-label={`${label} medals`}>
              {tiers.map((t) => (
                <li key={t}>
                  <Spr family="eventMedal" k={medalKey(prefix, t)} size={32} name={`${label} ${MEDAL_NAME[t] ?? t}`} />
                  <span class="num">{fmtCompact(m[t])}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {rows.length > 0 && none.length > 0 && <p class="quiet cab-none">None yet: {none.join(", ")}</p>}
    </div>
  );
}

/** Single-player medal board: rows by difficulty in the game's order, in-game mode names. */
const MODE_ROWS: [string, string[]][] = [
  ["Easy", ["Easy", "PrimaryOnly", "Deflation"]],
  ["Medium", ["Medium", "MilitaryOnly", "Apopalypse", "Reverse"]],
  ["Hard", ["Hard", "MagicOnly", "DoubleMoabHealth", "HalfCash", "AlternateBloonsRounds", "Impoppable", "Clicks", "CHIMPS-BLACK"]],
];

function ModeRow(props: { label: string; keys: string[]; m: Record<string, number>; coop?: boolean }) {
  const keys = props.keys.filter((k) => (props.m[k] ?? 0) > 0);
  if (!keys.length) return null;
  return (
    <div class="mode-row">
      <p class="cab-l">{props.label}</p>
      <ul class="modes">
        {keys.map((k) => {
          const v = props.m[k] ?? 0;
          return (
            <li key={k}>
              <Spr family="modeMedal" k={props.coop ? `coop:${k}` : k} size={32} label />
              <span class="mode-n">{MODE_NAME[k] ?? human(k)}</span>
              <span class="num">{fmtInt(v)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Mode medal board (single-player or co-op: same rows, the game's co-op medal art for co-op). */
function ModeBoard(props: { m: Record<string, number>; coop?: boolean }) {
  const known = MODE_ROWS.flatMap(([, k]) => k);
  const extra = Object.keys(props.m).filter((k) => !known.includes(k));
  if (!Object.values(props.m).some((v) => v > 0)) return <p class="quiet">No medals yet.</p>;
  return (
    <div class="modeboard">
      {MODE_ROWS.map(([label, keys]) => (
        <ModeRow key={label} label={label} keys={label === "Hard" ? [...keys, ...extra] : keys} m={props.m} coop={props.coop} />
      ))}
    </div>
  );
}

/** Long boss names break at a syllable in narrow cells. */
const SOFT: Record<string, string> = { Bloonarius: "Bloon­arius", Dreadbloon: "Dread­bloon", Blastapopoulos: "Blasta­popoulos", Diamondback: "Diamond­back" };
const BOSSES = ["Bloonarius", "Lych", "Vortex", "Dreadbloon", "Phayze", "Blastapopoulos", "Diamondback"];

/** One boss badge (the game's art; greyed when none earned) with its count. */
function BossBadge(props: { boss: string; elite?: boolean; n: number }) {
  const k = `${props.elite ? "elite:" : ""}${props.boss.toLowerCase()}`;
  const name = `${props.boss} ${props.elite ? "elite" : "normal"} badge`;
  return (
    <span class={props.n ? "bb" : "bb nil"} title={`${name}: ${fmtInt(props.n)}`}>
      {hasArt("bossBadge", k) ? <Spr family="bossBadge" k={k} size={48} name={name} /> : <Spr family="boss" k={k} size={48} name={name} />}
      <b class="num">{fmtInt(props.n)}</b>
      <span class="sc-l">{props.elite ? "Elite" : "Normal"}</span>
    </span>
  );
}

function BossStrip(props: { normal: Record<string, number>; elite: Record<string, number> }) {
  const all = [...BOSSES, ...Object.keys({ ...props.normal, ...props.elite }).filter((b) => !BOSSES.includes(b))];
  return (
    <ul class="bossstrip">
      {all.map((b) => (
        <li key={b}>
          <span class="bs-name">{SOFT[b] ?? b}</span>
          <span class="bs-b">
            <BossBadge boss={b} n={props.normal[b] ?? 0} />
            <BossBadge boss={b} elite n={props.elite[b] ?? 0} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Bloon wall, in the game's order. [stat key, bloon sprite key, name]; "ui:" keys come from the ui sheet. */
const WALL: [string, string, string][] = [
  ["purplesPopped", "purple", "Purple"],
  ["leadsPopped", "lead", "Lead"],
  ["ceramicsPopped", "ceramic", "Ceramic"],
  ["moabsPopped", "moab", "MOAB"],
  ["bfbsPopped", "bfb", "BFB"],
  ["zomgsPopped", "zomg", "ZOMG"],
  ["ddtsPopped", "ddt", "DDT"],
  ["badsPopped", "bad", "BAD"],
  ["bossesPopped", "ui:BossTier", "Bosses"],
  ["camosPopped", "camo", "Camo"],
  ["regrowsPopped", "regrow", "Regrow"],
  ["goldenBloonsPopped", "golden", "Golden"],
  ["necroBloonsReanimated", "necro", "Reanimated"],
];
/** Stat keys that are counts, not bloons (shown as stats, not on the wall). */
const NOT_BLOONS = ["bloonsPopped", "bloonsLeaked", "coopBloonsPopped", "transformingTonicsUsed"];

function BloonWall(props: { bp: Record<string, number> }) {
  const known = new Set([...WALL.map(([k]) => k), ...NOT_BLOONS]);
  const extra = Object.keys(props.bp).filter((k) => !known.has(k) && props.bp[k] > 0);
  const cells: [string, string, string][] = [...WALL.filter(([k]) => props.bp[k] !== undefined), ...extra.map((k): [string, string, string] => [k, k, human(k.replace(/Popped$/, ""))])];
  return (
    <ul class="wall">
      {cells.map(([stat, key, name]) => (
        <li key={stat} title={`${name}: ${fmtInt(props.bp[stat])}`}>
          <Spr family={key.startsWith("ui:") ? "ui" : "bloon"} k={key.replace(/^ui:/, "")} size={40} name={name} label />
          <span class="wall-n">{name}</span>
          <span class="num">{fmtCompact(props.bp[stat])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Top-N bars; `family` puts a 32 px portrait on each row. */
function Bars(props: { m: Record<string, number>; n?: number; name?: (k: string) => string; compact?: boolean; family?: string }) {
  const top = Object.entries(props.m)
    .filter(([k, v]) => k && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, props.n ?? 10);
  if (!top.length) return <p class="quiet">Nothing yet.</p>;
  return (
    <ol class="bars">
      {top.map(([k, v]) => (
        <li key={k} class={props.family ? "has-i" : undefined} style={{ "--w": `${(v / top[0][1]) * 100}%` }}>
          {props.family && <Spr family={props.family} k={k} size={32} label />}
          <span>{(props.name ?? unitName)(k)}</span>
          <span class="num">{props.compact ? fmtCompact(v) : fmtInt(v)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Ability counts keyed by in-game name: several stat keys share one name ("TakeAim" / "TakeAim2",
 * "RocketStorm" / "RocketStormMAD"…), and some keys carry trailing spaces ("Giga STOMP ").
 */
function byAbilityName(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) {
    const name = abilityName(k);
    out[name] = (out[name] ?? 0) + v;
  }
  return out;
}

/** "SeasonUltimate3" → "Ultimate 3" */
const seasonName = (id: string) => human(id.replace(/^(SocialSeasons|Season)/, "").replace(/Medal$/, ""));

/** Every Social Season badge the game has, in its order; each season's Ultimate is named after its theme. */
const SEASON_BADGES = ["SeasonTier1", "SeasonTier2", "SeasonTier3", "SeasonTier4", "SeasonUltimate1", "SeasonUltimate2", "SeasonUltimate3", "SeasonChampion"];
const SEASON_THEME: Record<string, string> = {
  SeasonUltimate1: "Season 1: Dr. Monkey Needs You!",
  SeasonUltimate2: "Season 2: Striker's Vacation!",
  SeasonUltimate3: "Season 3: Quincy's Roadtrip!",
};

/**
 * Earned season badges only, plus a muted count of the rest. Art from the game
 * (NK's own URL for Ultimate 3 is a 404); a badge the sheet doesn't know yet falls back to NK's image.
 */
function SeasonBadges(props: { badges: Record<string, { id: string; url: string; count?: number }> }) {
  const ids = [...SEASON_BADGES, ...Object.keys(props.badges).filter((k) => !SEASON_BADGES.includes(k))];
  const earned = ids.filter((id) => props.badges[id]);
  if (!earned.length) return <p class="quiet">No season badges earned yet.</p>;
  return (
    <>
    <ul class="seasons">
      {earned.map((id) => {
        const b = props.badges[id];
        const n = b ? (b.count ?? 1) : 0;
        const name = seasonName(id);
        return (
          <li key={id} class={n ? undefined : "nil"} title={`${SEASON_THEME[id] ? `${name} (${SEASON_THEME[id]})` : name}: ${n ? `×${fmtInt(n)}` : "not earned"}`}>
            {hasArt("season", id) || !b ? (
              <Spr family="season" k={id} size={48} name={name} />
            ) : (
              <Img src={b.url} w={48} h={48} alt="" fallback={<span class="badge-fb">{name}</span>} />
            )}
            <span class="ss-n">{name}</span>
            <span class="num">{n ? `×${fmtInt(n)}` : "none"}</span>
          </li>
        );
      })}
    </ul>
    {ids.length > earned.length && <p class="quiet cab-none">{ids.length - earned.length} not earned</p>}
    </>
  );
}

/** "Is this you?" for the key's owner: only when a key is saved and this public profile matches their own. */
function ThisIsMe(p: { id: string; u: UserProfile }) {
  const { mine, playerId } = useOak();
  if (!mine) return null;
  if (playerId === p.id) {
    return (
      <p class="me-note">
        <A href="/me">You · My stats</A>
        <button type="button" class="me-btn" onClick={() => setPlayerId(null)}>
          Not me
        </button>
      </p>
    );
  }
  if (!looksLikeMe(p.u, mine.profile)) return null;
  return (
    <p class="me-note">
      Is this you?
      <button type="button" class="me-btn" onClick={() => setPlayerId(p.id)}>
        This is me
      </button>
    </p>
  );
}

export function PlayerPage(props: { id: string }) {
  if (!isPublicId(props.id)) return <ErrorPanel code="private" what="player" />; // maybe an OAK: never requested
  const key = userKey(props.id);
  const u = body<UserProfile>(key);
  if (!u) return <Gate k={key} rows={10} />;
  const g = u.gameplay;
  const won = g.gameCount ? g.gamesWon / g.gameCount : null;
  const bp = u.bloonsPopped;
  const seasonTotal = Object.values(u.seasonBadges ?? {}).reduce((a, b) => a + (b.count ?? 1), 0);
  const spTotal = Object.values(u._medalsSinglePlayer).reduce((a, b) => a + b, 0);
  const coopTotal = Object.values(u._medalsMultiplayer ?? {}).reduce((a, b) => a + b, 0);
  return (
    <>
      <header class="profile">
        <div class="profile-banner">
          <Img src={u.bannerURL} w={1536} h={192} eager />
        </div>
        <div class="profile-id">
          <Img src={u.avatarURL} w={360} h={360} eager class="avatar" alt="" />
          <div class="profile-t">
            <p class="eyebrow">Player</p>
            <h1 class={`title xl uname${longWord(u.displayName)}`}>{u.displayName}</h1>
            <p class="profile-sub">
              <span>
                Rank <b class="num">{u.rank}</b>
              </span>
              {u.veteranRank > 0 && (
                <span>
                  Veteran <b class="num">{u.veteranRank}</b>
                </span>
              )}
              <span>
                <b class="num">{fmtInt(u.followers)}</b> followers
              </span>
              <span>
                <b class="num">{fmtInt(u.achievements)}</b> achievements
              </span>
              <span class="main-t">
                <Spr family="tower" k={u.mostExperiencedMonkey} size={32} label />
                Main <b>{unitName(u.mostExperiencedMonkey)}</b>
              </span>
            </p>
            <p class="fresh-line">
              <Freshness k={key} />
            </p>
          </div>
        </div>
      </header>
      <ThisIsMe id={props.id} u={u} />

      <dl class="stats grid">
        <Stat k="Games won" v={fmtInt(g.gamesWon)} note={won !== null ? `of ${fmtInt(g.gameCount)} · ${fmtPct(won)}` : undefined} />
        <Stat k="Highest round" v={fmtInt(g.highestRound ?? u.highestRound)} />
        <Stat k="Best CHIMPS round" v={fmtInt(g.highestRoundCHIMPS)} />
        <Stat k="Best Deflation round" v={fmtInt(g.highestRoundDeflation)} />
        <Stat k="Bloons popped" v={fmtCompact(bp.bloonsPopped)} note={`${fmtCompact(bp.coopBloonsPopped)} in co-op · ${fmtCompact(bp.bloonsLeaked)} leaked`} />
        <Stat k="Boss damage" v={fmtCompact(g.damageDoneToBosses)} />
        <Stat k="Cash earned" v={`$${fmtCompact(g.cashEarned)}`} />
        <Stat k="Monkeys placed" v={fmtCompact(g.monkeysPlaced)} note={`${fmtCompact(u.stats.totalTowersSold)} sold`} />
        <Stat k="Abilities used" v={fmtCompact(g.abilitiesUsed)} />
        <Stat k="Trophies earned" v={fmtInt(g.totalTrophiesEarned)} />
        <Stat k="Challenges won" v={fmtInt(g.challengesCompleted)} />
        <Stat k="Odysseys" v={fmtInt(g.totalOdysseysCompleted)} note={`${fmtInt(g.totalOdysseyStars)} stars`} />
        <Stat k="Insta collection" v={fmtInt(g.instaMonkeyCollection)} note={`${fmtInt(g.instaMonkeysUsed)} used`} />
        <Stat k="CT tiles captured" v={fmtInt(u.stats.ctCapturedTiles)} />
      </dl>

      <div class="split even">
        <Section title="Event medals" aside="Best tier first">
          <MedalCabinet
            rows={[
              ["Boss", "boss", u._medalsBoss],
              ["Elite Boss", "bossElite", u._medalsBossElite],
              ["Race", "", u._medalsRace],
              ["CT Local", "ctLocal", u._medalsCTLocal],
              ["CT Global", "ctGlobal", u._medalsCTGlobal],
            ]}
          />
        </Section>
        <Section title="Boss badges" aside="Normal / Elite">
          <BossStrip normal={u.bossBadgesNormal} elite={u.bossBadgesElite} />
        </Section>
      </div>

      <Section title="Season badges" aside={seasonTotal ? `${fmtInt(seasonTotal)} earned` : undefined}>
        <SeasonBadges badges={u.seasonBadges ?? {}} />
      </Section>

      <Section title="Single-player medals" aside={`${fmtInt(spTotal)} total`}>
        <ModeBoard m={u._medalsSinglePlayer} />
      </Section>
      <Section title="Co-op medals" aside={`${fmtInt(coopTotal)} total`}>
        <ModeBoard m={u._medalsMultiplayer ?? {}} coop />
      </Section>

      <details class="lt-fold">
        <summary>Lifetime stats</summary>
      <Section title="Bloons popped" aside={`${fmtInt(bp.bloonsPopped)} total`}>
        <BloonWall bp={bp} />
      </Section>

      <div class="split even">
        <Section title="Towers placed">
          <Bars m={u.towersPlaced} n={12} family="tower" />
        </Section>
        <Section title="Heroes placed">
          <Bars m={u.heroesPlaced} n={12} family="hero" />
        </Section>
      </div>
      <div class="split even">
        <Section title="Paragons bought" aside={`${fmtInt(Object.values(u.stats.paragonsPurchasedByName ?? {}).reduce((a, b) => a + b, 0))} total`}>
          <Bars m={u.stats.paragonsPurchasedByName ?? {}} n={10} family="tower" />
        </Section>

        <Section title="Most used abilities">
          <Bars m={byAbilityName(u.stats.abilitiesActivatedByName ?? {})} n={10} name={(k) => k} />
        </Section>
      </div>
      </details>
    </>
  );
}

/** Team CT badges: one row per ranking, every tier the game awards there (best first, like the medal cabinet). */
const CT_BADGE_ROWS: [scope: string, label: string, prefix: string][] = [
  ["Global", "Global ranking", "ctTeam"],
  ["Local", "Group ranking", "ctGroup"],
];

/**
 * Earned tiers per ranking only, in the game's art, plus one muted "N not earned". The API has no count for
 * team badges, so earned ones say so. A badge id we don't know yet still shows, with NK's image.
 */
function CtBadges(props: { badges: Record<string, { id: string; url: string }> }) {
  const known = new Set<string>();
  let missing = 0;
  const rows = CT_BADGE_ROWS.map(([scope, label, prefix]) => {
    const owned: Record<string, number> = {};
    for (const id of Object.keys(props.badges)) {
      const [sc, tier] = id.split("_");
      if (sc === scope && tier) owned[tier] = 1;
    }
    const tiers = eventTiers(prefix, owned);
    tiers.forEach((t) => known.add(`${scope}_${t}`));
    const earned = tiers.filter((t) => owned[t]);
    missing += tiers.length - earned.length;
    if (!earned.length) return null;
    return (
      <div key={scope} class="ctb-row">
        <p class="cab-l">{label}</p>
        <ul class="seasons">
          {earned.map((t) => {
            const name = ctTierName(t);
            return (
              <li key={t} title={`${label}, ${name}: earned`}>
                {hasArt("eventMedal", `${prefix}:${t}`) ? (
                  <Spr family="eventMedal" k={`${prefix}:${t}`} size={48} name={`${label} ${name}`} />
                ) : (
                  <Img src={props.badges[`${scope}_${t}`]?.url} w={48} h={48} alt="" fallback={<span class="badge-fb">{name}</span>} />
                )}
                <span class="ss-n">{name}</span>
                <span class="num">earned</span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  });
  const other = Object.values(props.badges).filter((b) => !known.has(b.id));
  return (
    <div class="ctbadges">
      {rows}
      {!rows.some(Boolean) && !other.length && <p class="quiet">No Contested Territory badges earned yet.</p>}
      {other.length > 0 && (
        <div class="ctb-row">
          <p class="cab-l">Other</p>
          <ul class="seasons">
            {other.map((b) => (
              <li key={b.id}>
                <Img src={b.url} w={48} h={48} alt="" fallback={<span class="badge-fb">{human(b.id)}</span>} />
                <span class="ss-n">{human(b.id.replace(/_/g, " "))}</span>
                <span class="num">earned</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing > 0 && (rows.some(Boolean) || other.length > 0) && <p class="quiet">{missing} not earned</p>}
    </div>
  );
}

/** layout#12: " nlong" when the longest word is over 12 characters, so the name can shrink instead of breaking mid-word. */
const longWord = (s: string) => (s.split(/\s+/).some((w) => w.length > 12) ? " nlong" : "");

const TEAM_STATUS: Record<string, string> = { OPEN: "Open to join", FILTERED: "Join by request", CLOSED: "Closed", DISBANDED: "Disbanded" };

export function TeamPage(props: { id: string }) {
  if (!isPublicId(props.id)) return <ErrorPanel code="private" what="team" />;
  const key = guildKey(props.id);
  const t = body<Guild>(key);
  if (!t) return <Gate k={key} rows={6} />;
  const badgeCount = Object.keys(t.CtBadges ?? {}).length;
  return (
    <>
      <header class="profile">
        <div class="profile-banner">
          <Img src={t.bannerURL} w={1536} h={192} eager />
        </div>
        <div class="profile-id">
          <Emblem frame={t.frameURL} icon={t.iconURL} size={112} eager />
          <div class="profile-t">
            <p class="eyebrow">Team</p>
            <h1 class={`title xl uname${longWord(t.name)}`}>{t.name}</h1>
            <p class="profile-sub">
              <span>
                <b class="num">{t.numMembers}</b> members
              </span>
              <span>{TEAM_STATUS[t.status] ?? cap(t.status.toLowerCase())}</span>
              <span>
                <A href={href.player(idFromUrl(t.owner))}>Owner's profile →</A>
              </span>
            </p>
            <p class="fresh-line">
              <Freshness k={key} />
            </p>
          </div>
        </div>
      </header>
      <Section title="Contested Territory badges" aside={badgeCount ? `${badgeCount} earned` : undefined}>
        <CtBadges badges={t.CtBadges ?? {}} />
      </Section>
      <CTHistory guildId={props.id} />
    </>
  );
}

function DailyNav(props: { id: string }) {
  const { prev, next } = dailyNeighbours(props.id, body<ChallengeSummary[]>(DAILY_KEY) ?? [], Date.now());
  const label = (id: string) => dailyTitle(id) ?? id;
  return (
    <nav class="daynav" aria-label="Other daily challenges">
      {prev ? (
        <A href={href.challenge(prev)} class="daynav-a prev" label={`Previous: ${label(prev)}`}>
          <span aria-hidden="true">‹</span> <span class="daynav-t">{label(prev)}</span>
        </A>
      ) : (
        <span class="daynav-a off" />
      )}
      {backTo()?.href === href.challenges("daily") ? (
        <span />
      ) : (
        <A href={href.challenges("daily")} class="daynav-all">
          All dailies
        </A>
      )}
      {next ? (
        <A href={href.challenge(next)} class="daynav-a next" label={`Next: ${label(next)}`}>
          <span class="daynav-t">{label(next)}</span> <span aria-hidden="true">›</span>
        </A>
      ) : (
        <span class="daynav-a off" />
      )}
    </nav>
  );
}

/** The challenge's creator: their name once their profile is in memory, else a plain profile link. */
function Creator(props: { url: string }) {
  const id = idFromUrl(props.url);
  const u = body<UserProfile>(userKey(id));
  return (
    <A href={href.player(id)} class="creator">
      {u ? (
        <>
          by <span class="uname">{u.displayName}</span> →
        </>
      ) : (
        "Creator's profile →"
      )}
    </A>
  );
}

export function ChallengePage(props: { id: string }) {
  const key = challengeKey(props.id);
  const c = body<ChallengeDocument>(key);
  const daily = dailyInfo(props.id);
  if (!c)
    return (
      <>
        {daily && <DailyNav id={props.id} />}
        <Gate k={key} rows={8} />
      </>
    );
  const isDaily = !!daily || !c.creator;
  const rate = c.playsUnique ? c.winsUnique / c.playsUnique : null;
  const attemptRate = c.plays ? c.wins / c.plays : null;
  const author = isDaily ? dailyAuthor(c.name) : null;
  const eyebrow = !isDaily ? "Player challenge" : daily?.kind === "advanced" ? "Advanced daily challenge" : daily?.kind === "coop" ? "Co-op daily challenge" : "Daily challenge";
  return (
    <>
      {daily && <DailyNav id={props.id} />}
      <EventHead
        showMap
        map={c}
        eyebrow={eyebrow}
        title={daily ? (dailyTitle(props.id) ?? c.name) : <span class="uname">{c.name}</span>}
        stats={
          <>
            <Stat k="Win rate" v={rate !== null ? fmtPct(rate) : "–"} note="of players" />
            <Stat k="Players" v={fmtCompact(c.playsUnique)} />
            {c.upvotes > 0 && <Stat k="Upvotes" v={fmtInt(c.upvotes)} />}
          </>
        }
      >
        <p class="meta-line">
          {author && (
            <span>
              by <span class="uname">{author}</span>
            </span>
          )}
          {c.creator && <Creator url={c.creator} />}
          <span>
            {isDaily ? "ID" : "Code"} <span class="mono code">{c.id}</span>
          </span>
          {daily?.day != null ? (
            <span>{fmtWhen(dailyStart(props.id)!)}</span>
          ) : (
            c.createdAt > 0 && <span>Created {fmtDate(c.createdAt)}</span>
          )}
          {c.gameVersion && c.gameVersion !== "0" && <span>Game v{c.gameVersion}</span>}
        </p>
        <p class="fresh-line">
          <Freshness k={key} />
        </p>
      </EventHead>
      <div class="split">
        <Section title="Play stats" aside={isDaily && !dailyIsOut(props.id, Date.now()) ? "Not started yet" : undefined}>
          <div class="board-wrap narrow play-stats">
            <table class="board compact">
              <thead>
                <tr>
                  <th />
                  <th class="num">Players</th>
                  <th class="num">Attempts</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Played</td>
                  <td class="num">{fmtInt(c.playsUnique)}</td>
                  <td class="num">{fmtInt(c.plays)}</td>
                </tr>
                <tr>
                  <td>Won</td>
                  <td class="num">{fmtInt(c.winsUnique)}</td>
                  <td class="num">{fmtInt(c.wins)}</td>
                </tr>
                <tr>
                  <td>Lost</td>
                  <td class="num">{fmtInt(c.lossesUnique)}</td>
                  <td class="num">{fmtInt(c.losses)}</td>
                </tr>
                <tr>
                  <td>Restarted</td>
                  <td class="num nil">–</td>
                  <td class="num">{fmtInt(c.restarts)}</td>
                </tr>
                <tr class="total">
                  <td>Win rate</td>
                  <td class="num">{rate !== null ? fmtPct(rate) : "–"}</td>
                  <td class="num">{attemptRate !== null ? fmtPct(attemptRate) : "–"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
        <aside class="rules" id="rules">
          <header class="sec-h">
            <h2>Rules</h2>
          </header>
          <Ruleset doc={c} />
        </aside>
      </div>
    </>
  );
}
