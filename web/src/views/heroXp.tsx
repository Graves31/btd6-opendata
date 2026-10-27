// Tools → Hero XP planner (/tools/hero-xp): when to place a hero so it plays a round at a level. All maths lives in
// ../heroXp.ts; this is the view. The URL is the state (routes.ts HeroXpRoute).

import { useMemo, useState } from "preact/hooks";
import energizerArt from "../art/tools/energizer.webp";
import heroArt from "../art/tools/heroXp.webp";
import mkEducation from "../art/tools/mkMonkeyEducation.webp";
import mkEmpowered from "../art/tools/mkEmpoweredHeroes.webp";
import mkTogether from "../art/tools/mkMonkeysTogetherStrong.webp";
import mkTaught from "../art/tools/mkSelfTaughtHeroes.webp";
import { MAP_LIST } from "../data/names.ts";
import { mapName } from "../format.ts";
import { GAME_VERSION, HEROES, MAX_LEVEL, MAX_ROUND, plan, timeline, XP, type MapDiff, type XpInput } from "../heroXp.ts";
import { navigate } from "../nav.ts";
import { useOak } from "../oak.ts";
import { heroKnowledge } from "../oakSave.ts";
import { HERO_ORDER } from "../roster.ts";
import { href, type HeroXpRoute } from "../routes.ts";
import { artName, Spr } from "../sprite.tsx";
import { A, ToolBack, ToolHero } from "../ui.tsx";
import { TargetInput } from "./paragon.tsx";

const money = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const MAPS = ["Beginner", "Intermediate", "Advanced", "Expert"];
/** Boss Bloon Event tiers (bloonswiki): tier 1 on round 40, then every 20 rounds. */
const TIERS = [40, 60, 80, 100, 120];
const HERO_IDS = HERO_ORDER.filter((h) => HEROES[h]);
const LEVELS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
/** Heroes by XP curve: total level XP over Quincy's (×1, ×1.425, ×1.5, ×1.71 in v57), cheapest first. */
const total = (h: string) => HEROES[h].xp.reduce((a, b) => a + b, 0);
const mult = (h: string) => Math.round((total(h) / total("Quincy")) * 1000) / 1000;
const GROUPS = [...new Set(HERO_IDS.map(mult))].sort((a, b) => a - b).map((m) => ({ mult: m, ids: HERO_IDS.filter((h) => mult(h) === m) }));

function Check(p: { on: boolean; set: (v: boolean) => void; art: string; name: string; sub: string }) {
  return (
    <label class="bk-check">
      <input type="checkbox" checked={p.on} onChange={(e) => p.set(e.currentTarget.checked)} />
      <img src={p.art} width={32} height={32} alt="" decoding="async" />
      <span>
        <b>{p.name}</b>
        <small>{p.sub}</small>
      </span>
    </label>
  );
}

function Num(p: { value: number; label: string; min: number; max: number; set: (n: number) => void }) {
  return (
    <div class="pg-tstep" role="group" aria-label={p.label}>
      <button type="button" class="pg-step" aria-label={`${p.label}: less`} disabled={p.value <= p.min} onClick={() => p.set(p.value - 1)}>
        −
      </button>
      <TargetInput value={p.value} label={p.label} onChange={(n) => p.set(Math.min(p.max, Math.max(p.min, n)))} />
      <button type="button" class="pg-step" aria-label={`${p.label}: more`} disabled={p.value >= p.max} onClick={() => p.set(p.value + 1)}>
        +
      </button>
    </div>
  );
}

export function HeroXpPage(p: { r: HeroXpRoute }) {
  const { mine } = useOak();
  // No `mk` in the URL: the Monkey Knowledge defaults come from the player's save (the URL always wins).
  const mk = heroKnowledge(mine?.save, new URLSearchParams(location.search).has("mk"), p.r);
  const r = { ...p.r, ...mk };
  const go = (o: Partial<HeroXpRoute>) => navigate(href.heroXp({ ...r, ...o }), { replace: true, keepScroll: true });
  const placed = r.mode === "placed";
  /** A setup change; in goal mode the timeline goes back to the plan's own placement round. */
  const set = (o: Partial<HeroXpRoute>) => go(placed ? o : { at: undefined, ...o });

  const base: Omit<XpInput, "hero" | "place"> = {
    map: r.map as MapDiff,
    edu: r.edu,
    taught: r.taught,
    mts: r.mts,
    empowered: r.emp,
    boost: r.boost,
    energizer: r.en,
    heroes: r.n,
  };
  const input: XpInput = { ...base, hero: r.hero, place: r.first };
  const pl = useMemo(() => plan(input, r.level, r.round, r.first), [r.hero, r.level, r.round, r.map, r.edu, r.taught, r.mts, r.emp, r.boost, r.en, r.n, r.first]);
  const place = placed ? Math.min(MAX_ROUND, r.at ?? r.first) : Math.max(r.first, Math.min(MAX_ROUND, r.at ?? pl.latest ?? r.first));
  const tl = timeline({ ...input, place }, MAX_ROUND);
  /** "from round 40": the first round played at that level. */
  const when = (l: number) => {
    const at = tl.levels[l];
    return at === undefined ? `not reached by round ${MAX_ROUND}` : at === place ? `placed on round ${at}` : `from round ${at}`;
  };
  // Boss tier badges: the level the hero has at the start of each tier round ("T3–5" when several share one).
  const tierAt: Record<number, string> = {};
  const tiers: Record<number, number[]> = {};
  TIERS.forEach((t, i) => {
    const l = t < place ? 0 : LEVELS.findLast((l) => (tl.levels[l] ?? Infinity) <= t);
    if (l) (tiers[l] ??= []).push(i + 1);
  });
  for (const [l, ix] of Object.entries(tiers)) tierAt[+l] = ix.length === 1 ? `T${ix[0]}` : `T${ix[0]}–${ix.at(-1)}`;
  const [pick, setPick] = useState<number>();
  const shown = pick ?? (placed ? MAX_LEVEL : r.level);
  const hero = artName("hero", r.hero);
  const lvAt = (pw: number) => pl.window.find((w) => w.place === pw)?.at;
  const landing = pl.latest !== undefined ? lvAt(pl.latest) : undefined;
  const from = pl.window.filter((w) => pl.latest !== undefined && w.place <= pl.latest && w.at === landing).map((w) => w.place)[0];

  const compare = useMemo(
    () =>
      Object.fromEntries(
        HERO_IDS.map((h) => {
          const q = plan({ ...input, hero: h }, r.level, r.round, r.first);
          return [h, { latest: q.latest, buy: q.buy }];
        }),
      ),
    [r.level, r.round, r.map, r.edu, r.taught, r.mts, r.emp, r.boost, r.en, r.n, r.first],
  );

  return (
    <div class="pg bk hx">
      <ToolBack />
      <ToolHero art={<img src={heroArt} width={96} height={96} alt="" />} title="Hero XP planner" sub="When to place a hero so it reaches a level by a round, such as a boss tier.">
        {[
          { art: mkEducation, alt: "Monkey Education" },
          { art: mkTaught, alt: "Self Taught Heroes" },
          { art: mkTogether, alt: "Monkeys Together Strong" },
          { art: mkEmpowered, alt: "Empowered Heroes" },
          { art: energizerArt, alt: "Energizer" },
        ].map((x) => (
          <span key={x.alt} class="th-ic">
            <img src={x.art} width={44} height={44} alt={x.alt} decoding="async" />
          </span>
        ))}
      </ToolHero>

      <section class="pg-panel hx-heroes" aria-labelledby="hx-hero">
        <div class="pg-ph">
          <h2 class="eyebrow" id="hx-hero">
            Hero
          </h2>
          <span class="pg-hint">{hero}</span>
        </div>
        <div class="hx-pick">
          {GROUPS.map((g) => (
            <div key={g.mult} class="hx-g" role="group" aria-label={`Hero XP ×${g.mult}`}>
              <span class="hx-gl">XP ×{g.mult}</span>
              <div class="hx-gr">
                {g.ids.map((h) => (
                  <button key={h} type="button" class="hx-h" aria-pressed={r.hero === h} title={artName("hero", h)} onClick={() => set({ hero: h })}>
                    <Spr family="hero" k={h} size={48} label />
                    <span class="hx-hn">{artName("hero", h)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div class="bk-grid">
        <div class="bk-side">
          <section class="pg-panel" aria-label={placed ? "Placement" : "Goal"}>
            <div class="bk-seg hx-mode" role="group" aria-label="Mode">
              <button type="button" class="bk-chip" aria-pressed={!placed} onClick={() => go({ mode: "goal", at: undefined })}>
                Goal
              </button>
              <button type="button" class="bk-chip" aria-pressed={placed} onClick={() => go({ mode: "placed", at: place })}>
                Placed on round
              </button>
            </div>
            {placed ? (
              <div class="bk-field">
                <span class="bk-lab">Placed on round</span>
                <Num value={place} label="Placement round" min={1} max={MAX_ROUND} set={(n) => go({ at: n })} />
              </div>
            ) : (
              <>
                <div class="bk-row2">
                  <div>
                    <span class="bk-lab">Level</span>
                    <Num value={r.level} label="Target level" min={2} max={MAX_LEVEL} set={(n) => set({ level: n })} />
                  </div>
                  <div>
                    <span class="bk-lab">at the start of round</span>
                    <Num value={r.round} label="Target round" min={1} max={MAX_ROUND} set={(n) => set({ round: n })} />
                  </div>
                </div>
                <div class="bk-seg hx-tiers" role="group" aria-label="Boss tier">
                  {TIERS.map((t, i) => (
                    <button key={t} type="button" class="bk-chip" aria-pressed={r.round === t} title={`Boss tier ${i + 1}`} onClick={() => set({ round: t })}>
                      T{i + 1} · {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section class="pg-panel hx-setup" aria-label="Map and Monkey Knowledge">
            <div class="bk-field">
              <span class="bk-lab">Map difficulty</span>
              <div class="bk-seg" role="group" aria-label="Map difficulty">
                {MAPS.map((m, i) => (
                  <button key={m} type="button" class="bk-chip" aria-pressed={r.map === i} onClick={() => set({ map: i as MapDiff })}>
                    {m}
                  </button>
                ))}
              </div>
              <select
                class="hx-sel"
                aria-label="Or pick a map"
                value=""
                onChange={(e) => {
                  const m = MAP_LIST.find((x) => x[0] === e.currentTarget.value);
                  if (m) set({ map: m[1] });
                }}
              >
                <option value="">Or pick a map…</option>
                {MAP_LIST.map((m) => (
                  <option key={m[0]} value={m[0]}>
                    {mapName(m[0])} ({MAPS[m[1]]})
                  </option>
                ))}
              </select>
            </div>

            <div class="bk-field">
              <span class="bk-lab">Monkey Knowledge</span>
              <div class="bk-checks">
                <Check on={r.edu} set={(v) => set({ edu: v })} art={mkEducation} name="Monkey Education" sub={`+${pct(XP.mk.monkeyEducation)} XP`} />
                <Check on={r.taught} set={(v) => set({ taught: v })} art={mkTaught} name="Self Taught Heroes" sub={`+${pct(XP.mk.selfTaughtHeroes)} XP`} />
                <Check on={r.mts} set={(v) => set({ mts: v })} art={mkTogether} name="Monkeys Together Strong" sub={`+${pct(XP.mk.monkeysTogetherStrong)} XP per hero placed`} />
                <Check on={r.emp} set={(v) => set({ emp: v })} art={mkEmpowered} name="Empowered Heroes" sub={`placed at level ${1 + XP.mk.empoweredHeroesLevels}`} />
              </div>
              {mine && (
                <p class="pg-hint bk-gap">
                  From your save: <A href="/me">My stats</A>
                </p>
              )}
            </div>

            <details class="bk-more hx-more" open={r.en > 0 || r.n > 1 || (!placed && r.first > 1) || r.boost > 0 || undefined}>
              <summary>Energizer, co-op, event start, Hero Boost</summary>
              <span class="bk-lab">Energizer from round</span>
              <div class="hx-en">
                <img src={energizerArt} width={32} height={32} alt="" decoding="async" />
                <Num value={r.en} label="Energizer from round" min={0} max={MAX_ROUND} set={(n) => set({ en: n })} />
                <span class="pg-hint">0 = none</span>
              </div>

              <div class="bk-row2 bk-gap">
                <div>
                  <span class="bk-lab">Heroes on the map</span>
                  <div class="bk-seg" role="group" aria-label="Heroes on the map">
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} type="button" class="bk-chip" aria-pressed={r.n === n} onClick={() => set({ n })}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {!placed && (
                  <div>
                    <span class="bk-lab">Event starts on round</span>
                    <Num value={r.first} label="First placement round" min={1} max={MAX_ROUND} set={(n) => set({ first: n })} />
                  </div>
                )}
              </div>

              <span class="bk-lab bk-gap">Hero Boost (Contested Territory relic)</span>
              <div class="bk-seg" role="group" aria-label="Hero Boost">
                {[0, 1, 2].map((n) => (
                  <button key={n} type="button" class="bk-chip" aria-pressed={r.boost === n} onClick={() => set({ boost: n as 0 | 1 | 2 })}>
                    {n > 0 && <Spr family="relic" k="HeroBoost" size={24} label optional />}
                    {n === 0 ? "None" : `×${n}`}
                  </button>
                ))}
              </div>
            </details>
          </section>
        </div>

        <div class="bk-col">
          {!placed && (
            <section class="pg-panel bk-hot" aria-labelledby="hx-ans">
              <h2 class="eyebrow" id="hx-ans">
                Answer
              </h2>
              {pl.latest !== undefined ? (
                <div class="bk-ans">
                  <div class="bk-big">
                    <span class="k">Place on round</span>
                    <span class="v">{pl.latest}</span>
                  </div>
                  <div class="bk-ans-t">
                    <p>
                      Place <strong>{hero}</strong> on round <strong>{pl.latest}</strong>
                      {from !== undefined && from < pl.latest && (
                        <>
                          {" "}
                          (or earlier: rounds{" "}
                          <strong>
                            {from}–{pl.latest}
                          </strong>{" "}
                          all land on round {landing})
                        </>
                      )}{" "}
                      and reach <strong>level {r.level}</strong> at the start of round <strong>{landing}</strong>.
                    </p>
                    {pl.buy && (
                      <p>
                        Or place on round <strong>{pl.buy.place}</strong> and buy the rest for <strong>{money(pl.buy.cash)}</strong>.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div class="bk-ans-t">
                  <p class="bk-loss">
                    {hero} can't reach level {r.level} by round {r.round} when placed from round {r.first}.
                  </p>
                  {pl.buy && (
                    <p>
                      Placed on round <strong>{pl.buy.place}</strong>, buying the rest at the start of round {r.round} costs <strong>{money(pl.buy.cash)}</strong>.
                    </p>
                  )}
                </div>
              )}
              <table class="hx-win">
                <thead>
                  <tr>
                    <th scope="col">Place on round</th>
                    <th scope="col">Level {r.level} from round</th>
                    <th scope="col">Target {r.round}</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.window.map((w) => {
                    const d = w.at === undefined ? undefined : w.at - r.round;
                    return (
                      <tr key={w.place} class={`hx-r${d === 0 ? " hit" : ""}${w.place === place ? " sel" : ""}`}>
                        <td>
                          <button type="button" class="hx-pl" aria-pressed={w.place === place} onClick={() => go({ at: w.place })}>
                            {w.place}
                          </button>
                        </td>
                        <td>{w.at ?? "not reached"}</td>
                        <td class={d !== undefined && d > 0 ? "hx-late" : undefined}>
                          {d === undefined ? "too late" : d === 0 ? "on target" : d < 0 ? `${-d} early` : `${d} late`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section class="pg-panel" aria-labelledby="hx-tl">
            <div class="pg-ph">
              <h2 class="eyebrow" id="hx-tl">
                Timeline
              </h2>
              <span class="pg-hint">
                {hero} placed on round {place}
              </span>
            </div>
            <ol class="hx-track">
              {LEVELS.map((l) => {
                const at = tl.levels[l];
                const t = tierAt[l];
                return (
                  <li key={l}>
                    <button
                      type="button"
                      class={`hx-t${!placed && l === r.level ? " goal" : ""}${at === undefined ? " no" : at === place ? " pl" : ""}${!placed && at !== undefined && at > r.round ? " late" : ""}`}
                      aria-pressed={l === shown}
                      aria-label={`Level ${l}, ${when(l)}${t ? `, boss ${t}` : ""}`}
                      onClick={() => setPick(l)}
                    >
                      <b>{l}</b>
                      <span>{at === undefined ? "–" : at === place ? "placed" : `from r${at}`}</span>
                      {t && <i class="hx-tier">{t}</i>}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p class="hx-pick-tx" aria-live="polite">
              <b>
                Level {shown} · {when(shown)}
              </b>{" "}
              {HEROES[r.hero].text[shown - 1]}
            </p>
            <details class="bk-more hx-det">
              <summary>Hero level details</summary>
              <ol class="hx-tl">
                {LEVELS.map((l) => {
                  const at = tl.levels[l];
                  return (
                    <li
                      key={l}
                      class={`hx-lv${!placed && l === r.level ? " goal" : ""}${at !== undefined && (placed || at <= r.round) ? " ok" : ""}`}
                      aria-current={!placed && l === r.level ? "true" : undefined}
                    >
                      <b class="hx-n">{l}</b>
                      <span class="hx-at">{when(l)}</span>
                      <span class="hx-xp">{l === 1 ? "" : `${HEROES[r.hero].xp[l - 2].toLocaleString("en-US")} XP`}</span>
                      <span class="hx-tx">{HEROES[r.hero].text[l - 1]}</span>
                    </li>
                  );
                })}
              </ol>
            </details>
          </section>
        </div>
      </div>

      {!placed && (
        <section class="pg-panel" aria-labelledby="hx-cmp">
          <div class="pg-ph">
            <h2 class="eyebrow" id="hx-cmp">
              Every hero
            </h2>
            <span class="pg-hint">
              Level {r.level} by round {r.round}: latest placement
            </span>
          </div>
          {GROUPS.map((g) => (
            <div key={g.mult} class="hx-cg" role="group" aria-label={`Hero XP ×${g.mult}`}>
              <span class="hx-gl">XP ×{g.mult}</span>
              <div class="hx-cmp">
                {g.ids.map((h) => {
                  const c = compare[h];
                  return (
                    <button key={h} type="button" class="hx-c" aria-pressed={h === r.hero} onClick={() => set({ hero: h })}>
                      <Spr family="hero" k={h} size={40} label />
                      <span class="n">{artName("hero", h)}</span>
                      <span class="v">{c.latest !== undefined ? `round ${c.latest}` : c.buy ? `buy ${money(c.buy.cash)}` : "–"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}

      <p class="pg-hint hx-note">
        Game v{GAME_VERSION} code and data; Energizer (+{pct(XP.energizer)}) and Hero Boost (+{pct(XP.heroBoost)}) from bloonswiki. XP comes at the end of each round (the placement
        round too), split between heroes on the map. A level costs $1 per missing XP. Heroes are grouped by how much XP their levels cost (×1 = Quincy).
      </p>
    </div>
  );
}
