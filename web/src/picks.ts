// Which event of each kind the home page features. Shared by the home view and by nav.ts, which turns the
// picks into the extra keys home renders (see setHomeExtras in routes.ts), so prefetch and render agree.

import type { Boss, ChallengeSummary, CT, CTTeamEntry, Odyssey, Race } from "../../src/nk/types.ts";
import { dailyIsOut } from "./format.ts";
import { bossBoardKey, bossMetaKey, challengeKey, ctKey, DAILY_KEY, guildKey, idFromUrl, LIST_KEY, odyMapsKey, raceBoardKey, raceMetaKey } from "./routes.ts";

type Get = <T>(key: string) => T | undefined;
type Timed = { id: string; start: number; end: number };

export interface HomePicks {
  boss?: Boss;
  race?: Race;
  ct?: CT;
  ody?: Odyssey;
  daily?: ChallengeSummary;
  /** When the picked race / CT hasn't started: the last finished one, to show its winner. */
  racePrev?: Race;
  ctPrev?: CT;
}

/** The server's featured event (live, or just ended), else the next upcoming one, else the newest. */
function pick<T extends Timed>(list: T[] | undefined, featured: string | null | undefined, now: number): T | undefined {
  if (!list?.length) return undefined;
  return (
    list.find((e) => e.id === featured) ??
    list.find((e) => e.start <= now && now < e.end) ??
    list.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0] ??
    list[0]
  );
}

/** The most recently finished event, if `e` hasn't started yet. */
function previous<T extends Timed>(list: T[] | undefined, e: T | undefined, now: number): T | undefined {
  if (!list || !e || e.start <= now) return undefined;
  return list.filter((x) => x.end <= now).sort((a, b) => b.end - a.end)[0];
}

export function homePicks(get: Get, featured: Record<string, string | null>, now = Date.now()): HomePicks {
  const races = get<Race[]>(LIST_KEY.race);
  const cts = get<CT[]>(LIST_KEY.ct);
  const race = pick(races, featured.race, now);
  const ct = pick(cts, featured.ct, now);
  return {
    boss: pick(get<Boss[]>(LIST_KEY.boss), featured.boss, now),
    race,
    ct,
    ody: pick(get<Odyssey[]>(LIST_KEY.odyssey), featured.odyssey, now),
    daily: get<ChallengeSummary[]>(DAILY_KEY)?.find((c) => dailyIsOut(c.id, now)),
    racePrev: previous(races, race, now),
    ctPrev: previous(cts, ct, now),
  };
}

/** The team leading a CT's team leaderboard, once that board is known. */
export function ctLeader(get: Get, ct: CT | undefined): CTTeamEntry | undefined {
  return ct ? get<CTTeamEntry[]>(ctKey(ct.id, "teams"))?.[0] : undefined;
}

/** Keys the home page reads beyond the lists. */
export function homeExtraKeys(get: Get, p: HomePicks): string[] {
  const keys: string[] = [];
  // Both top 5s (the home switch flips between them instantly), once the boss has started.
  if (p.boss) keys.push(bossMetaKey(p.boss.id, "standard"));
  if (p.boss && p.boss.start <= Date.now()) keys.push(bossBoardKey(p.boss.id, "standard", 1), bossBoardKey(p.boss.id, "elite", 1));
  if (p.race) keys.push(raceMetaKey(p.race.id));
  if (p.racePrev) keys.push(raceBoardKey(p.racePrev.id));
  const ct = p.ctPrev ?? p.ct;
  if (ct) keys.push(ctKey(ct.id, "teams"));
  const leader = ctLeader(get, ct);
  if (leader) keys.push(guildKey(idFromUrl(leader.profile)));
  if (p.ody) keys.push(odyMapsKey(p.ody.id, "easy"));
  if (p.daily) keys.push(challengeKey(p.daily.id));
  return keys;
}
