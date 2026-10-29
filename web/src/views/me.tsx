// /me "My stats": the player's own save, read in this browser straight from Ninja Kiwi with their Open Access Key
// (oak.ts). Nothing here touches our Worker or the store, so the route needs() nothing.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { UserProfile, UserSave } from "../../../src/nk/types.ts";
import { agoText } from "../boards.ts";
import { cap, fmtInt, human, unitName } from "../format.ts";
import { forgetOak, OAK_FORMAT, refreshOak, setOak, useOak, type OakError } from "../oak.ts";
import { ARTIFACT_NAMES, MAP_LIST, MAP_NAMES, QUEST_NAMES } from "../data/names.ts";
import progressData from "../data/progress.json" with { type: "json" };
import {
  achievementParts,
  completion,
  heroParts,
  instaParts,
  instaPossible,
  instaSummary,
  knowledgeParts,
  medalCounts,
  powerUpgradeParts,
  skinParts,
  towerParts,
  upgradeParts,
  type MedalRow,
  type Part,
  type Progress as GameProgress,
} from "../oakSave.ts";
import { DIFF_LABEL } from "../maps.ts";
import { href } from "../routes.ts";
import { CATEGORY, HERO_ORDER, inOrder, TOWER_ORDER } from "../rules.tsx";
import { artName, hasArt, MapArt, MODE_NAME, Spr } from "../sprite.tsx";
import { A, Img, Section, ToolHero, useTick } from "../ui.tsx";
import { longWord } from "./people.tsx";

const PROGRESS = progressData as unknown as GameProgress;
const OAK_FAQ = "https://ninja.kiwi/opendatafaq";
const NK_ASSETS = "https://static-api.nkstatic.com/";

const ERR: Record<OakError, string> = {
  invalid: "Ninja Kiwi doesn't recognise this key. Check it for typos, or get a fresh one.",
  busy: "Ninja Kiwi is limiting requests right now. Try again in a few minutes.",
  network: "Couldn't reach Ninja Kiwi. Check your connection and try again.",
};

const PersonIcon = () => (
  <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

/** "tilesCaptured" → "Tiles captured". */
const counterLabel = (k: string) => cap(human(k).toLowerCase());
const counters = (o: Record<string, number> | undefined) => Object.entries(o ?? {}).filter(([, v]) => typeof v === "number");
const owned = (o: Record<string, boolean> | undefined) => Object.values(o ?? {}).filter(Boolean).length;

function KeyForm() {
  const [v, setV] = useState("");
  const [show, setShow] = useState(false);
  const [bad, setBad] = useState(false);
  return (
    <form
      class="my-form"
      onSubmit={(e) => {
        e.preventDefault();
        const ok = OAK_FORMAT.test(v.trim());
        setBad(!ok);
        if (ok) void setOak(v);
      }}
    >
      <label for="my-key">Your Open Access Key</label>
      <div class="my-keyrow">
        <input
          id="my-key"
          type={show ? "text" : "password"}
          value={v}
          placeholder="oak_…"
          autocomplete="off"
          spellcheck={false}
          autocapitalize="off"
          aria-invalid={bad}
          aria-describedby="my-key-h"
          onInput={(e) => setV(e.currentTarget.value)}
        />
        <button type="button" class="my-btn gbtn" aria-pressed={show} onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
        <button type="submit" class="my-btn my-go gbtn go">
          Save
        </button>
      </div>
      <p id="my-key-h" class={bad ? "my-msg err" : "my-msg"} role={bad ? "alert" : undefined}>
        {bad ? "That doesn't look like an Open Access Key. It starts with oak_ followed by letters and numbers." : "The key stays in this browser and is sent only to Ninja Kiwi, never to this site's server."}
      </p>
    </form>
  );
}

function Intro() {
  return (
    <div class="my-intro">
      <p>
        An Open Access Key (OAK) is a private key from Ninja Kiwi that lets this page read <strong>your own</strong> BTD6 save: medals, instas, tower XP and more. Anyone with your key can read your save, so don't share
        it.
      </p>
      <p>
        <a href={OAK_FAQ} target="_blank" rel="noopener noreferrer">
          How to get your key (Ninja Kiwi's Open Data FAQ)
        </a>
      </p>
      <KeyForm />
    </div>
  );
}

function Bar(p: { at: number | null; loading: boolean; error: OakError | null }) {
  useTick(30_000);
  return (
    <div class="my-bar">
      <span class="my-when">{p.loading ? "Updating…" : p.at ? `Updated ${agoText(Date.now() - p.at)}` : ""}</span>
      <button type="button" class="my-btn gbtn" disabled={p.loading} onClick={() => void refreshOak()}>
        Refresh
      </button>
      <button type="button" class="my-btn gbtn" onClick={forgetOak}>
        Forget key
      </button>
      {p.error && (
        <p class="my-msg err" role="alert">
          {ERR[p.error]}
        </p>
      )}
    </div>
  );
}

/** A game icon next to text; renders nothing extra when the art has no such key. */
const Ico = (p: { k: string; size?: number }) => <Spr family="ui" k={p.k} size={p.size ?? 24} label optional />;
const Lbl = (p: { k: string; children: string }) => (
  <span class="my-lbl">
    <Ico k={p.k} />
    {p.children}
  </span>
);
const pct = (o: number, t: number) => (t > 0 && o >= t ? 100 : Math.min(99, Math.round((o / Math.max(t, 1)) * 100)));
/** Section wrapper the summary rings scroll to. */
const Anchor = (p: { id: string; children: ComponentChildren }) => (
  <div id={`my-${p.id}`} class="my-anc">
    {p.children}
  </div>
);
const Meter = (p: { o: number; t: number }) => (
  <span class="my-meter" aria-hidden="true">
    <i style={{ width: `${(p.o / Math.max(p.t, 1)) * 100}%` }} />
  </span>
);
/** <details> whose body (long lists) is only built once opened. */
function Lazy(p: { head: ComponentChildren; class?: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <details class={p.class} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{p.head}</summary>
      {open && p.children}
    </details>
  );
}
const Chips = (p: { ids: string[]; label?: (id: string) => string }) => (
  <ul class="my-tiers">
    {p.ids.map((id) => (
      <li key={id}>{p.label ? p.label(id) : id}</li>
    ))}
  </ul>
);
/** "Name  x / n" row with a meter; expands into what's missing when there is something. */
function Miss(p: { name: ComponentChildren; part: Part; label?: (id: string) => string; class?: string; children?: ComponentChildren }) {
  const { owned, total, missing } = p.part;
  const head = (
    <>
      {p.name}
      <span class="my-ic">
        {fmtInt(owned)} / {fmtInt(total)}
      </span>
      <Meter o={owned} t={total} />
    </>
  );
  const cls = `my-miss${p.class ? ` ${p.class}` : ""}`;
  return missing.length ? (
    <Lazy class={cls} head={head}>
      {p.children ?? <Chips ids={missing} label={p.label} />}
    </Lazy>
  ) : (
    <div class={`${cls} done`}>
      <div class="my-sum">{head}</div>
    </div>
  );
}

function Summary(p: { s: UserSave }) {
  const { rings, overall } = completion(p.s, PROGRESS);
  const all = pct(overall, 1);
  const go = (id: string) => (e: Event) => {
    e.preventDefault();
    document.getElementById(`my-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section class="my-sumry" aria-label="Completion">
      <div class={all === 100 ? "my-all done" : "my-all"}>
        <b>{all}%</b>
        <span>overall completion</span>
        <span class="my-allbar" aria-hidden="true">
          <i style={{ width: `${all}%` }} />
        </span>
      </div>
      <ul>
        {rings.map((r) => (
          <li key={r.id}>
            {/* skins live in the heroes section */}
            <a href={`#my-${r.id}`} onClick={go(r.id === "skins" ? "heroes" : r.id)} class={pct(r.owned, r.total) === 100 ? "done" : undefined} style={{ "--p": pct(r.owned, r.total) }}>
              <span class="my-ring">
                <b>{pct(r.owned, r.total)}%</b>
              </span>
              <span class="my-rl">{r.label}</span>
              <span class="my-rn">
                {fmtInt(r.owned)} / {fmtInt(r.total)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Game-panel tile: icon, number, label, note, all centred (the note line is always there so tiles line up). */
const Tile = (p: { k: string; ico?: string; art?: ComponentChildren; v: number | string | undefined; note?: string }) => (
  <div class="my-tile">
    <dt>{p.k}</dt>
    <dd>
      {p.art ?? <Ico k={p.ico ?? ""} size={40} />}
      <b>{typeof p.v === "string" ? p.v : fmtInt(p.v)}</b>
      <small>{p.note}</small>
    </dd>
  </div>
);

function Overview(p: { s: UserSave }) {
  const s = p.s;
  return (
    <dl class="my-tiles">
      <Tile k="Games played" ico="GamesPlayed" v={s.gamesPlayed} />
      <Tile k="Highest round seen" ico="HighestRound" v={s.highestSeenRound} />
      <Tile k="Monkey money" ico="MonkeyMoney" v={s.monkeyMoney} />
      <Tile k="Trophies" ico="Trophy" v={s.trophies} note={`${fmtInt(s.lifetimeTrophies)} lifetime`} />
      <Tile k="Knowledge points" ico="KnowledgePoints" v={s.knowledgePoints} />
      <Tile k="Races entered" ico="Race" v={s.totalRacesEntered} />
      <Tile k="Continues used" ico="Continue" v={s.continuesUsed} />
      <Tile k="Challenges played" ico="ChallengesPlayed" v={s.challengesPlayed} note={`${fmtInt(s.challengesShared)} shared`} />
      <Tile k="Dailies completed" ico="DailyChallenge" v={s.totalDailyChallengesCompleted} note={`streak ${fmtInt(s.consecutiveDailyChallengesCompleted)}`} />
      <Tile k="Odysseys completed" ico="Odyssey" v={s.totalCompletedOdysseys} />
      <Tile k="Crates opened" ico="Crate" v={s.collectionEventCratesOpened} />
      <Tile k="Daily rewards" ico="DailyReward" v={s.dailyRewardCount} />
    </dl>
  );
}

/** A "x / n" card that opens the shared panel (Pick) instead of growing; a plain card when nothing is missing. */
function Pick(p: { name: ComponentChildren; part: Part; unit?: string; on: boolean; panel: string; onPick: () => void; class?: string }) {
  const { owned, total, missing } = p.part;
  const head = (
    <>
      {p.name}
      <span class="my-ic">
        {fmtInt(owned)} / {fmtInt(total)}
        {p.unit}
      </span>
      <Meter o={owned} t={total} />
    </>
  );
  const cls = `my-miss${missing.length ? "" : " done"}${p.on ? " on" : ""}${p.class ? ` ${p.class}` : ""}`;
  return missing.length ? (
    <button type="button" class={cls} aria-expanded={p.on} aria-controls={p.on ? p.panel : undefined} onClick={p.onPick}>
      <span class="my-sum">{head}</span>
    </button>
  ) : (
    <div class={cls}>
      <div class="my-sum">{head}</div>
    </div>
  );
}

/**
 * The one open "what's missing" panel of a card grid: a full-width row placed right after the picked card. The grid
 * packs densely, so the rest of that card's row moves back up beside it and the panel sits under the row.
 */
function Panel(p: { id: string; title: ComponentChildren; art?: ComponentChildren; note: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  return (
    <li class="my-panel" id={p.id}>
      <div class="my-ph">
        {p.art}
        <div class="my-pt">
          <h4>{p.title}</h4>
          <span class="my-ic">{p.note}</span>
        </div>
        <button type="button" class="my-x" onClick={p.onClose} aria-label="Close">
          ×
        </button>
      </div>
      {p.children}
    </li>
  );
}

function Medals(p: { s: UserSave }) {
  const rows = medalCounts(p.s);
  const [sel, setSel] = useState<string | null>(null); // "<difficulty>:<mode>:solo" / ":coop": one open panel
  const medalName = (r: MedalRow, co: boolean) => `${r.mode === "Standard" ? r.difficulty : (MODE_NAME[r.mode] ?? r.mode)} ${co ? "co-op" : "solo"}`;
  const medal = (r: MedalRow, co: boolean, size: number) => <Spr family="modeMedal" k={co ? `coop:${r.medal}` : r.medal} size={size} name={medalName(r, co)} label />;
  const side = (r: MedalRow, co: boolean) => {
    const n = co ? r.coop : r.solo;
    const key = `${r.difficulty}:${r.mode}:${co ? "coop" : "solo"}`;
    const name = (
      <>
        <span class={n ? "my-m" : "my-m dim"}>{medal(r, co, 40)}</span>
        <span class="my-in">{co ? "Co-op" : "Solo"}</span>
      </>
    );
    const part = {
      owned: n,
      total: r.total,
      missing: co ? r.coopMissing : r.soloMissing,
    };
    return <Pick name={name} part={part} on={sel === key} panel="my-medal-panel" onPick={() => setSel(sel === key ? null : key)} class={n ? undefined : "dim"} />;
  };
  const panel = (r: MedalRow) => {
    const co = sel === `${r.difficulty}:${r.mode}:coop`;
    if (!co && sel !== `${r.difficulty}:${r.mode}:solo`) return null;
    const missing = new Set(co ? r.coopMissing : r.soloMissing);
    return (
      <Panel
        key={`${r.mode}-panel`}
        id="my-medal-panel"
        art={medal(r, co, 48)}
        title={`${r.difficulty} · ${MODE_NAME[r.mode] ?? human(r.mode)} · ${co ? "Co-op" : "Solo"}`}
        note={`${fmtInt(missing.size)} ${missing.size === 1 ? "map" : "maps"} still missing this medal`}
        onClose={() => setSel(null)}
      >
        {DIFF_LABEL.map((label, d) => {
          const maps = MAP_LIST.filter(([id, md]) => md === d && missing.has(id));
          return (
            maps.length > 0 && (
              <div key={label}>
                <h5 class="my-h3">
                  {label} <span>{maps.length}</span>
                </h5>
                <ul class="my-maps">
                  {maps.map(([id]) => (
                    <li key={id}>
                      <A href={href.map(id)}>
                        <MapArt map={id} size={112} framed alt="" />
                        <span>{MAP_NAMES[id] ?? human(id)}</span>
                      </A>
                    </li>
                  ))}
                </ul>
              </div>
            )
          );
        })}
      </Panel>
    );
  };
  return (
    <Section tone="teal" title={<Lbl k="Medal">Map medals</Lbl>} aside={<A href={href.maps()}>All maps</A>}>
      {(["Easy", "Medium", "Hard"] as const).map((d) => (
        <div key={d} class="my-medals">
          <h3>{d}</h3>
          <ul class="my-dense">
            {rows
              .filter((r) => r.difficulty === d)
              .flatMap((r) => [
                <li key={r.mode}>
                  <span class="my-mn">{MODE_NAME[r.mode] ?? human(r.mode)}</span>
                  {side(r, false)}
                  {side(r, true)}
                </li>,
                panel(r),
              ])}
          </ul>
        </div>
      ))}
    </Section>
  );
}

function Instas(p: { s: UserSave }) {
  const [sel, setSel] = useState<string | null>(null);
  const owned = new Map(instaSummary(p.s).map((r) => [r.tower, r]));
  if (!owned.size) return null;
  const rank = (t: string) => TOWER_ORDER.indexOf(t) + 1 || 99;
  const parts = instaParts(p.s, PROGRESS).sort((a, b) => rank(a.tower) - rank(b.tower)); // the game's shop order
  const sets = parts.reduce((n, r) => n + r.owned, 0);
  const possible = parts.reduce((n, r) => n + r.total, 0);
  const all = [...owned.values()].reduce((n, r) => n + r.total, 0);
  // Every crosspath an insta can have, in the same order for every tower.
  const tiers = instaPossible().map((k) => k.split("").join("-"));
  return (
    <Section tone="amber" title={<Lbl k="Tier5">Insta Monkeys</Lbl>} aside={`${fmtInt(sets)} / ${fmtInt(possible)} sets · ${fmtInt(all)} in total`}>
      <ul class="my-instas my-dense">
        {parts.flatMap((r) => {
          const o = owned.get(r.tower);
          const on = sel === r.tower;
          const have = new Map(o?.tiers);
          return [
            <li key={r.tower}>
              <Pick
                name={
                  <>
                    <Spr family="tower" k={r.tower} size={40} count={o?.total || undefined} label />
                    <span class="my-in">{unitName(r.tower)}</span>
                  </>
                }
                part={r}
                on={on}
                panel="my-insta-panel"
                onPick={() => setSel(on ? null : r.tower)}
              />
            </li>,
            on && (
              <Panel
                key={`${r.tower}-panel`}
                id="my-insta-panel"
                art={<Spr family="tower" k={r.tower} size={48} label />}
                title={unitName(r.tower)}
                note={`${fmtInt(r.owned)} of ${fmtInt(r.total)} crosspaths owned · ${fmtInt(o?.total ?? 0)} instas · dimmed = missing`}
                onClose={() => setSel(null)}
              >
                <ol class="my-tgrid">
                  {tiers.map((t) => {
                    const n = have.get(t) ?? 0;
                    return (
                      <li key={t} class={n ? undefined : "no"}>
                        <Spr family="insta" k={`${r.tower}:${t.replace(/-/g, "")}`} size={56} name={`${unitName(r.tower)} ${t}`} label optional />
                        <b>{t}</b>
                        <span>{n ? `×${fmtInt(n)}` : "–"}</span>
                      </li>
                    );
                  })}
                </ol>
              </Panel>
            ),
          ];
        })}
      </ul>
    </Section>
  );
}

function Xp(p: { s: UserSave }) {
  const rows = Object.entries(p.s.towerXP ?? {})
    .filter(([, x]) => x > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const max = rows[0][1];
  return (
    <Section tone="green" title={<Lbl k="Xp">Tower XP</Lbl>}>
      <ol class="my-xp">
        {rows.map(([t, x]) => (
          <li key={t} class={`my-cat-${CATEGORY.get(t) ?? "Other"}`}>
            <Spr family="tower" k={t} size={32} label />
            <span class="my-xn">{unitName(t)}</span>
            <span class="my-xb" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (x / max) * 100)}%` }} />
            </span>
            <span class="my-xv">{fmtInt(x)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Every unit as a tile; the ones you don't have are greyed out. */
function Units(p: { family: "tower" | "hero"; all: string[]; missing: string[] }) {
  const lock = new Set(p.missing);
  return (
    <ul class="my-heroes">
      {p.all.map((h) => (
        <li key={h} class={lock.has(h) ? "locked" : undefined}>
          <Spr family={p.family} k={h} size={48} label />
          <span>{unitName(h)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Heroes and their skins in one grid: a card per hero with its skins under it; what isn't owned is greyed out. */
function Heroes(p: { s: UserSave }) {
  const h = heroParts(p.s, PROGRESS);
  const sk = skinParts(p.s, PROGRESS);
  const heroLock = new Set(h.missing);
  const skinLock = new Set(sk?.missing);
  const skins = Object.entries(PROGRESS.skins ?? {});
  const aside = `${h.owned} / ${h.total} heroes · ${sk ? `${sk.owned} / ${sk.total}` : owned(p.s.unlockedSkins)} skins`;
  return (
    <Section tone="rose" title={<Lbl k="Hero">Heroes and skins</Lbl>} aside={aside}>
      <ul class="my-hs">
        {inOrder(HERO_ORDER, PROGRESS.heroes)
          .filter((hero) => PROGRESS.heroes.includes(hero))
          .map((hero) => {
            const mine = skins.filter(([, v]) => v.hero === hero);
            const got = mine.filter(([k]) => !skinLock.has(k)).length;
            return (
              <li key={hero} class={heroLock.has(hero) ? "locked" : undefined}>
                <div class="my-hsh">
                  <Spr family="hero" k={hero} size={56} label />
                  <span class="my-in">{unitName(hero)}</span>
                  {mine.length > 0 && (
                    <span class="my-ic">
                      {got} / {mine.length}
                    </span>
                  )}
                </div>
                {mine.length > 0 && (
                  <ul>
                    {mine.map(([k, v]) => (
                      <li key={k} class={skinLock.has(k) ? "locked" : undefined}>
                        <Spr family="skin" k={k} size={48} name={v.name} label />
                        <span>{v.name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
      </ul>
    </Section>
  );
}

function Towers(p: { s: UserSave }) {
  const t = towerParts(p.s, PROGRESS);
  return (
    <Section tone="blue" title={<Lbl k="Towers">Towers</Lbl>} aside={`${t.owned} / ${t.total} unlocked`}>
      {t.missing.length ? <Units family="tower" all={t.missing} missing={t.missing} /> : <p class="my-note">Every tower is unlocked.</p>}
    </Section>
  );
}

function Collection(p: { s: UserSave }) {
  const mk = knowledgeParts(p.s, PROGRESS);
  const up = upgradeParts(p.s, PROGRESS);
  const pw = powerUpgradeParts(p.s, PROGRESS);
  const mkOwned = mk.reduce((n, t) => n + t.owned, 0);
  const mkTotal = mk.reduce((n, t) => n + t.total, 0);
  const nameOf = (t: string) =>
    t === "_" ? (
      <span class="my-in">Missing upgrades</span>
    ) : (
      <>
        <Spr family="tower" k={t} size={32} label optional />
        <span class="my-in">{unitName(t)}</span>
      </>
    );
  return (
    <>
      <Anchor id="mk">
        <Section tone="blue" title={<Lbl k="KnowledgePoints">Monkey Knowledge</Lbl>} aside={`${mkOwned} / ${mkTotal} owned`}>
          <div class="my-misses">
            {mk.map((t) => (
              <Miss key={t.tree} name={<span class="my-in">{t.tree}</span>} part={t} label={human} />
            ))}
          </div>
        </Section>
      </Anchor>
      <Anchor id="upgrades">
        <Section tone="blue" title={<Lbl k="Upgrade">Upgrades</Lbl>} aside={`${fmtInt(up.owned)} / ${fmtInt(up.total)} owned`}>
          {up.by.length ? (
            <div class="my-misses">
              {up.by.map((t) => (
                <Miss key={t.tower} name={nameOf(t.tower)} part={t} />
              ))}
            </div>
          ) : (
            <p class="my-note">Every upgrade is unlocked.</p>
          )}
        </Section>
      </Anchor>
      {pw && (
        <Anchor id="powerups">
          <Section tone="blue" title={<Lbl k="Powers">Pro power upgrades</Lbl>} aside={`${fmtInt(pw.owned)} / ${fmtInt(pw.total)} owned`}>
            {pw.by.length ? (
              <div class="my-misses">
                {pw.by.map((t) => (
                  <Miss
                    key={t.power}
                    name={
                      <>
                        <Spr family="power" k={t.power} size={32} label optional />
                        <span class="my-in">{artName("power", t.power)}</span>
                      </>
                    }
                    part={t}
                  />
                ))}
              </div>
            ) : (
              <p class="my-note">Every Pro power upgrade is unlocked.</p>
            )}
          </Section>
        </Anchor>
      )}
    </>
  );
}

function Progress(p: { s: UserSave }) {
  const s = p.s;
  const [sel, setSel] = useState<"ac" | "q" | null>(null);
  const q = s.quests ?? [];
  const qOpen = q.filter((x) => !x.complete);
  const qPart: Part = {
    owned: q.length - qOpen.length,
    total: q.length,
    missing: qOpen.map((x) => x.id),
  };
  const ac = achievementParts(s, PROGRESS) ?? {
    owned: s.achievementsClaimed?.length ?? 0,
    total: s.achievementsClaimed?.length ?? 0,
    missing: [],
  };
  const powers = Object.entries(s.powers ?? {})
    .filter(([, v]) => v.quantity > 0)
    .sort((a, b) => b[1].quantity - a[1].quantity);
  const card = (id: "ac" | "q", ico: string, label: string, part: Part) => (
    <li key={id}>
      <Pick
        name={
          <>
            <Ico k={ico} size={40} />
            <span class="my-in">{label}</span>
          </>
        }
        part={part}
        on={sel === id}
        panel="my-aq-panel"
        onPick={() => setSel(sel === id ? null : id)}
      />
    </li>
  );
  return (
    <Section tone="violet" title={<Lbl k="Achievement">Achievements, quests and powers</Lbl>}>
      <ul class="my-aq my-dense">
        {card("ac", "Achievement", "Achievements", ac)}
        {card("q", "Quest", "Quests", qPart)}
        {sel === "ac" && (
          <Panel key="ac-panel" id="my-aq-panel" art={<Ico k="Achievement" size={48} />} title="Achievements" note={`${fmtInt(ac.missing.length)} not claimed yet`} onClose={() => setSel(null)}>
            <Chips ids={ac.missing} label={human} />
          </Panel>
        )}
        {sel === "q" && (
          <Panel key="q-panel" id="my-aq-panel" art={<Ico k="Quest" size={48} />} title="Quests" note={`${fmtInt(qOpen.length)} not complete yet`} onClose={() => setSel(null)}>
            <ul class="my-tiers">
              {qOpen.map((x) => (
                <li key={x.id}>
                  {QUEST_NAMES[x.id] ?? human(x.id)}
                  {x.parts > 1 && (
                    <span class="my-ic">
                      {" "}
                      {x.partsComplete} / {x.parts}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </ul>
      {powers.length > 0 && (
        <>
          <h3 class="my-h3">Powers in stock</h3>
          <ul class="my-powers">
            {powers.map(([k, v]) => (
              <li key={k}>
                <Spr family="power" k={k} size={40} count={v.quantity} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/** The parts of save.rogueLegendsStats this page reads (docs/api/fixtures/btd6__save__sample.json). */
interface RogueHero {
  heroName: string;
  skinName: string;
  runsCompletedNormal: number;
  runsCompletedChimps: number;
  highestStageReachedNormal: number;
  highestStageReachedChimps: number;
  fastestNormalCompletionSeconds: number;
  fastestChimpsCompletionSeconds: number;
  lifetimePops: number;
  favouriteArtifacts?: { tier: number; name: string; count: number }[];
  favouriteTeamMembers?: { tiers: number[]; name: string; count: number }[];
}
interface RogueStats {
  winsByTileType?: Record<string, number>;
  rogueHeroStats?: RogueHero[];
  miniGameTilesCompleted?: string[];
  legendaryBoostTypesCollected?: string[];
  [k: string]: unknown;
}
const TILE_TYPE: Record<string, string> = {
  pathStandardGame: "Standard tiles",
  miniGame: "Mini-games",
  miniBoss: "Mini-bosses",
  boss: "Bosses",
};
/** Rogue counters listed as feats (the stats object also carries Frontier Legends counters: not these). */
const ROGUE_FEATS = ["extractedArtifacts", "totalBoostMonkeys", "fullParty", "perfectAdventure", "perfectTrade", "overgeared", "masterBlacksmith", "trainingWeights", "tomfoolery"];
/** Artifact tier 1..3 in the save id = the game's Common / Rare / Legendary (rarity word in its names, checked). */
const RARITY = ["Common", "Rare", "Legendary"];
const mmss = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "–");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** A Rogue Legends artifact by save id ("OneShot2") or base name + tier. */
function Artifact(p: { id?: string; name?: string; tier?: number; size: number; named?: boolean }) {
  const id = p.id ?? `${p.name}${(p.tier ?? 0) + 1}`; // favourites carry a 0-based tier, save ids end in 1..3
  const tier = Number(id.slice(-1));
  const label = ARTIFACT_NAMES[id] ?? human(id.replace(/\d$/, ""));
  return (
    <>
      <Spr family="artifact" k={id} size={p.size} name={label} label />
      {p.named && <span>{label}</span>}
      {tier >= 1 && tier <= 3 && <small class={`my-rar r${tier}`}>{RARITY[tier - 1]}</small>}
    </>
  );
}

function Rogue(p: { s: UserSave }) {
  const st = (p.s.rogueLegendsStats ?? {}) as RogueStats;
  const rl = p.s.rogueLegends ?? {};
  const n = (k: string) => num(rl[k] ?? st[k]);
  if (!n("tilesCaptured") && !st.rogueHeroStats?.length) return null;
  const heroes = [...(st.rogueHeroStats ?? [])].sort((a, b) => b.lifetimePops - a.lifetimePops);
  const starters = Object.values(p.s.rogueUnlockedStarterArtifacts ?? {});
  const feats = ROGUE_FEATS.filter((k) => typeof st[k] === "number").map((k) => [k, st[k]] as const);
  const towers = (k: string) => (Array.isArray(st[k]) ? (st[k] as string[]).filter((t) => hasArt("tower", t)) : []) // also lists powers (SuperMonkeyBeacon);
  const split = (a: string, b: string, c: string) => `${fmtInt(n(a))} common · ${fmtInt(n(b))} rare · ${fmtInt(n(c))} legendary`;
  return (
    <Section tone="crimson" title={<Lbl k="rogue:Legends">Rogue Legends</Lbl>}>
      <dl class="my-tiles">
        <Tile k="Tiles captured" ico="rogue:Legends" v={n("tilesCaptured")} note={st.tilesCapturedWithinCampaign !== undefined ? `${fmtInt(num(st.tilesCapturedWithinCampaign))} in campaign` : undefined} />
        <Tile k="Bosses defeated" art={<Spr family="boss" k="skull" size={40} label />} v={n("bossesDefeated")} />
        <Tile k="Campaigns won" ico="Trophy" v={n("campaignMapsWon")} />
        <Tile k="Loops" ico="HighestRound" v={n("loops")} />
        <Tile
          k="Artifacts"
          art={<Spr family="artifact" k={starters[0] ?? "BouncingProjectiles3"} size={40} label optional />}
          v={n("totalArtifacts")}
          note={split("commonArtifactsCollected", "rareArtifactsCollected", "legendaryArtifactsCollected")}
        />
        <Tile
          k="Boosts"
          art={<Spr family="artifact" k="boost:Toughness" size={40} label optional />}
          v={n("commonBoostsCollected") + n("rareBoostsCollected") + n("legendaryBoostsCollected")}
          note={split("commonBoostsCollected", "rareBoostsCollected", "legendaryBoostsCollected")}
        />
      </dl>
      {st.winsByTileType && (
        <>
          <h3 class="my-h3">Wins by tile</h3>
          <ul class="my-rwins">
            {Object.entries(st.winsByTileType).map(([k, v]) => (
              <li key={k}>
                <span>{TILE_TYPE[k] ?? counterLabel(k)}</span>
                <b>{fmtInt(v)}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      {heroes.length > 0 && (
        <>
          <h3 class="my-h3">Heroes</h3>
          <ul class="my-rh">
            {heroes.map((h) => (
              <li key={h.heroName}>
                <div class="my-hsh">
                  {h.skinName && h.skinName !== h.heroName ? <Spr family="skin" k={h.skinName} size={56} name={unitName(h.heroName)} label /> : <Spr family="hero" k={h.heroName} size={56} label />}
                  <span class="my-in">{unitName(h.heroName)}</span>
                  <span class="my-ic">{fmtInt(h.lifetimePops)} pops</span>
                </div>
                <table class="my-rt">
                  <thead>
                    <tr>
                      <th />
                      <th scope="col">Runs won</th>
                      <th scope="col">Best stage</th>
                      <th scope="col">Fastest</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Normal</th>
                      <td>{fmtInt(h.runsCompletedNormal)}</td>
                      <td>{fmtInt(h.highestStageReachedNormal)}</td>
                      <td>{mmss(h.fastestNormalCompletionSeconds)}</td>
                    </tr>
                    <tr>
                      <th scope="row">CHIMPS</th>
                      <td>{fmtInt(h.runsCompletedChimps)}</td>
                      <td>{fmtInt(h.highestStageReachedChimps)}</td>
                      <td>{mmss(h.fastestChimpsCompletionSeconds)}</td>
                    </tr>
                  </tbody>
                </table>
                {!!h.favouriteTeamMembers?.length && (
                  <div class="my-rfav">
                    <span>Favourite team</span>
                    <ul>
                      {h.favouriteTeamMembers.map((m, i) => (
                        <li key={i}>
                          <Spr family="tower" k={m.name} size={40} label optional />
                          <small>{m.tiers.join("-")}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!h.favouriteArtifacts?.length && (
                  <div class="my-rfav">
                    <span>Favourite artifacts</span>
                    <ul>
                      {h.favouriteArtifacts.map((a, i) => (
                        <li key={i}>
                          <Artifact name={a.name} tier={a.tier} size={40} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {starters.length > 0 && (
        <>
          <h3 class="my-h3">
            Starter artifacts unlocked <span>{starters.length}</span>
          </h3>
          <ul class="my-rart">
            {starters.map((id) => (
              <li key={id}>
                <Artifact id={id} size={56} named />
              </li>
            ))}
          </ul>
        </>
      )}
      {[
        ["towerTypesPlaced", "Towers placed"],
        ["tier5sAcrossAll", "Tier 5s reached"],
      ].map(
        ([k, title]) =>
          towers(k).length > 0 && (
            <div key={k}>
              <h3 class="my-h3">
                {title} <span>{towers(k).length}</span>
              </h3>
              <ul class="my-powers">
                {towers(k).map((t) => (
                  <li key={t}>
                    <Spr family="tower" k={t} size={48} label />
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}
      {!!st.miniGameTilesCompleted?.length && (
        <>
          <h3 class="my-h3">Mini-games cleared</h3>
          <ul class="my-rart">
            {st.miniGameTilesCompleted.map((k) => (
              <li key={k}>
                <Ico k={`rogue:${k}`} size={56} />
                <span>{counterLabel(k)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!!st.legendaryBoostTypesCollected?.length && (
        <>
          <h3 class="my-h3">Legendary boosts found</h3>
          <ul class="my-rart">
            {st.legendaryBoostTypesCollected.map((k) => (
              <li key={k}>
                <Spr family="artifact" k={`boost:${k}`} size={56} name={k} label optional />
                <span>{counterLabel(k)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {feats.length > 0 && (
        <>
          <h3 class="my-h3">Feats</h3>
          <dl class="my-kv">
            {feats.map(([k, v]) => (
              <div key={k}>
                <dt>{counterLabel(k)}</dt>
                <dd>{fmtInt(v as number)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Section>
  );
}

function Legends(p: { title: string; data: Record<string, number> | undefined }) {
  const rows = counters(p.data);
  if (!rows.some(([, v]) => v !== 0)) return null;
  return (
    <Section tone="bronze" title={p.title}>
      <dl class="my-kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{counterLabel(k)}</dt>
            <dd>{fmtInt(v)}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** The public profile's header (people.tsx PlayerPage): NK banner, avatar, name, rank, main tower and hero. */
function Head(p: { prof: UserProfile; hero: string | undefined; playerId: string | null; bar: ComponentChildren }) {
  const u = p.prof;
  const nk = (url: string | undefined) => (url?.startsWith(NK_ASSETS) ? url : null);
  return (
    <header class="profile">
      <div class="profile-banner">
        <Img src={nk(u.bannerURL)} w={1536} h={192} eager />
      </div>
      <div class="profile-id">
        <Img src={nk(u.avatarURL)} w={360} h={360} eager class="avatar" alt="" />
        <div class="profile-t">
          <p class="eyebrow">Your save</p>
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
            <span class="main-t">
              <Spr family="tower" k={u.mostExperiencedMonkey} size={32} label />
              Main <b>{unitName(u.mostExperiencedMonkey)}</b>
            </span>
            {p.hero && (
              <span class="main-t">
                <Spr family="hero" k={p.hero} size={32} label optional />
                Hero <b>{unitName(p.hero)}</b>
              </span>
            )}
            {p.playerId && <A href={href.player(p.playerId)}>Public profile</A>}
          </p>
        </div>
        {p.bar}
      </div>
    </header>
  );
}

export function MePage() {
  const o = useOak();
  const mine = o.mine;
  const prof = mine?.profile;
  const bar = o.key && <Bar at={mine?.at ?? null} loading={o.loading} error={o.error} />;
  return (
    <div class="my">
      {prof ? (
        <Head prof={prof} hero={mine.save.primaryHero || undefined} playerId={o.playerId} bar={bar} />
      ) : (
        <ToolHero eyebrow="Your save" art={<PersonIcon />} title="My stats" sub="Your own BTD6 progress, read straight from Ninja Kiwi." />
      )}
      {!o.key && <Intro />}
      {!prof && bar}
      {o.key && !mine && o.loading && <p class="my-note">Loading your stats from Ninja Kiwi…</p>}
      {mine && (
        <>
          {!o.playerId && <p class="my-note">Want your public profile here too? Open your player page from any leaderboard and press "This is me".</p>}
          <Section tone="blue" title={<Lbl k="Trophy">Overview</Lbl>}>
            <Summary s={mine.save} />
            <Overview s={mine.save} />
          </Section>
          <Anchor id="medals">
            <Medals s={mine.save} />
          </Anchor>
          <Anchor id="instas">
            <Instas s={mine.save} />
          </Anchor>
          <Xp s={mine.save} />
          <Anchor id="heroes">
            <Heroes s={mine.save} />
          </Anchor>
          <Anchor id="towers">
            <Towers s={mine.save} />
          </Anchor>
          <Collection s={mine.save} />
          <Anchor id="achievements">
            <Progress s={mine.save} />
          </Anchor>
          <Rogue s={mine.save} />
          <Legends title="Frontier Legends" data={mine.save.frontierLegends} />
        </>
      )}
    </div>
  );
}
