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

/** What the home page shows from the picks: live cards, "Last ..." rows (ended) and the unstarted ones for "Next up". */
export function homeSlots(p: HomePicks, now = Date.now()) {
  const live = (e?: Timed) => (e && e.start <= now && now < e.end ? e : undefined);
  const over = (e?: Timed) => (e && e.end <= now ? e : undefined);
  return {
    liveBoss: live(p.boss) as Boss | undefined,
    liveRace: live(p.race) as Race | undefined,
    liveCt: live(p.ct) as CT | undefined,
    liveOdy: live(p.ody) as Odyssey | undefined,
    lastBoss: over(p.boss) as Boss | undefined,
    lastRace: (over(p.race) ?? p.racePrev) as Race | undefined,
    lastCt: (over(p.ct) ?? p.ctPrev) as CT | undefined,
    /** Picked events that haven't started: [event type, event]. */
    soon: (
      [
        ["bossBloon", p.boss],
        ["raceEvent", p.race],
        ["ct", p.ct],
        ["odysseyEvent", p.ody],
      ] as [string, Timed | undefined][]
    ).filter((x): x is [string, Timed] => !!x[1] && x[1].start > now),
  };
}

/** Keys the home page reads beyond the lists (exactly what renders: see Home in views/events.tsx). */
export function homeExtraKeys(get: Get, p: HomePicks): string[] {
  const s = homeSlots(p);
  const keys: string[] = [];
  // The boss's Normal board (top 3 / winner) once it has started; its map line while live.
  if (s.liveBoss) keys.push(bossMetaKey(s.liveBoss.id, "standard"));
  const boss = s.liveBoss ?? s.lastBoss;
  if (boss) keys.push(bossBoardKey(boss.id, "standard", 1));
  if (s.liveRace) keys.push(raceMetaKey(s.liveRace.id));
  if (s.lastRace) keys.push(raceBoardKey(s.lastRace.id));
  for (const ct of [s.liveCt, s.lastCt]) {
    if (!ct) continue;
    keys.push(ctKey(ct.id, "teams"));
    const leader = ctLeader(get, ct);
    if (leader) keys.push(guildKey(idFromUrl(leader.profile)));
  }
  if (s.liveOdy) keys.push(odyMapsKey(s.liveOdy.id, "easy"));
  if (p.daily) keys.push(challengeKey(p.daily.id));
  return keys;
}
