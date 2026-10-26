// /me "My stats": the player's own save, read in this browser straight from Ninja Kiwi with their Open Access Key
// (oak.ts). Nothing here touches our Worker or the store, so the route needs() nothing.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { UserSave } from "../../../src/nk/types.ts";
import { agoText } from "../boards.ts";
import { cap, fmtInt, human, unitName } from "../format.ts";
import { forgetOak, OAK_FORMAT, refreshOak, setOak, useOak, type OakError } from "../oak.ts";
import { MAP_LIST, MAP_NAMES } from "../data/names.ts";
import progressData from "../data/progress.json" with { type: "json" };
import { achievementParts, completion, heroParts, instaParts, instaPossible, instaSummary, knowledgeParts, medalCounts, powerUpgradeParts, skinParts, towerParts, upgradeParts, type MedalRow, type Part, type Progress as GameProgress } from "../oakSave.ts";
import { DIFF_LABEL } from "../maps.ts";
import { href } from "../routes.ts";
import { CATEGORY } from "../rules.tsx";
import { artName, MapArt, MODE_NAME, Spr } from "../sprite.tsx";
import { A, Img, Section, Stat, ToolHero, useTick } from "../ui.tsx";

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
        <button type="button" class="my-btn" aria-pressed={show} onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </button>
        <button type="submit" class="my-btn my-go">
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
        An Open Access Key (OAK) is a private key from Ninja Kiwi that lets this page read <strong>your own</strong> BTD6 save: medals, instas, tower XP and more. Anyone with your key can read your save, so don't share it.
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
      <button type="button" class="my-btn" disabled={p.loading} onClick={() => void refreshOak()}>
        Refresh
      </button>
      <button type="button" class="my-btn" onClick={forgetOak}>
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
  const go = (id: string) => (e: Event) => {
    e.preventDefault();
    document.getElementById(`my-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <section class="my-sumry" aria-label="Completion">
      <p class="my-all">
        <b>{pct(overall, 1)}%</b> overall completion <span>(mean of the parts below)</span>
      </p>
      <ul>
        {rings.map((r) => (
          <li key={r.id}>
            <a href={`#my-${r.id}`} onClick={go(r.id)} style={{ "--p": pct(r.owned, r.total) }}>
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

function Overview(p: { s: UserSave }) {
  const s = p.s;
  return (
    <dl class="stats grid my-tiles">
      <Stat k={<Lbl k="GamesPlayed">Games played</Lbl>} v={fmtInt(s.gamesPlayed)} />
      <Stat k="Highest round seen" v={fmtInt(s.highestSeenRound)} />
      <Stat k={<Lbl k="MonkeyMoney">Monkey money</Lbl>} v={fmtInt(s.monkeyMoney)} />
      <Stat k={<Lbl k="Trophy">Trophies</Lbl>} v={fmtInt(s.trophies)} note={`${fmtInt(s.lifetimeTrophies)} lifetime`} />
      <Stat k={<Lbl k="KnowledgePoints">Knowledge points</Lbl>} v={fmtInt(s.knowledgePoints)} />
      <Stat k={<Lbl k="Race">Races entered</Lbl>} v={fmtInt(s.totalRacesEntered)} />
      <Stat k="Continues used" v={fmtInt(s.continuesUsed)} />
      <Stat k="Challenges played" v={fmtInt(s.challengesPlayed)} note={`${fmtInt(s.challengesShared)} shared`} />
      <Stat k={<Lbl k="DailyChallenge">Dailies completed</Lbl>} v={fmtInt(s.totalDailyChallengesCompleted)} note={`streak ${fmtInt(s.consecutiveDailyChallengesCompleted)}`} />
      <Stat k={<Lbl k="Odyssey">Odysseys completed</Lbl>} v={fmtInt(s.totalCompletedOdysseys)} />
      <Stat k={<Lbl k="Crate">Crates opened</Lbl>} v={fmtInt(s.collectionEventCratesOpened)} />
      <Stat k="Daily rewards" v={fmtInt(s.dailyRewardCount)} />
      <Stat k="Game version" v={s.latestGameVersion} />
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
    const part = { owned: n, total: r.total, missing: co ? r.coopMissing : r.soloMissing };
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
    <Section title={<Lbl k="Medal">Map medals</Lbl>} aside={<A href={href.maps()}>All maps</A>}>
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
      <p class="my-note">Maps completed out of all {MAP_LIST.length}. Open a medal to see the maps still missing it.</p>
    </Section>
  );
}

function Instas(p: { s: UserSave }) {
  const [sel, setSel] = useState<string | null>(null);
  const owned = new Map(instaSummary(p.s).map((r) => [r.tower, r]));
  if (!owned.size) return null;
  const parts = instaParts(p.s, PROGRESS).sort((a, b) => (owned.get(b.tower)?.total ?? 0) - (owned.get(a.tower)?.total ?? 0));
  const sets = parts.reduce((n, r) => n + r.owned, 0);
  const possible = parts.reduce((n, r) => n + r.total, 0);
  const all = [...owned.values()].reduce((n, r) => n + r.total, 0);
  // Every crosspath an insta can have, in the same order for every tower.
  const tiers = instaPossible().map((k) => k.split("").join("-"));
  return (
    <Section title={<Lbl k="Tier5">Insta Monkeys</Lbl>} aside={`${fmtInt(sets)} / ${fmtInt(possible)} sets · ${fmtInt(all)} in total`}>
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
                    <Spr family="tower" k={r.tower} size={36} label />
                    <span class="my-in">{unitName(r.tower)}</span>
                  </>
                }
                part={r}
                unit={` sets · ${fmtInt(o?.total ?? 0)}`}
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
    <Section title={<Lbl k="Xp">Tower XP</Lbl>}>
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

function Heroes(p: { s: UserSave }) {
  const h = heroParts(p.s, PROGRESS);
  return (
    <Section title={<Lbl k="Hero">Heroes</Lbl>} aside={`${h.owned} / ${h.total} unlocked`}>
      <Units family="hero" all={PROGRESS.heroes} missing={h.missing} />
    </Section>
  );
}

function Towers(p: { s: UserSave }) {
  const t = towerParts(p.s, PROGRESS);
  return (
    <Section title="Towers" aside={`${t.owned} / ${t.total} unlocked`}>
      {t.missing.length ? <Units family="tower" all={t.missing} missing={t.missing} /> : <p class="my-note">Every tower is unlocked.</p>}
    </Section>
  );
}

function Collection(p: { s: UserSave }) {
  const mk = knowledgeParts(p.s, PROGRESS);
  const up = upgradeParts(p.s, PROGRESS);
  const sk = skinParts(p.s, PROGRESS);
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
        <Section title={<Lbl k="KnowledgePoints">Monkey Knowledge</Lbl>} aside={`${mkOwned} / ${mkTotal} owned`}>
          <div class="my-misses">
            {mk.map((t) => (
              <Miss key={t.tree} name={<span class="my-in">{t.tree}</span>} part={t} label={human} />
            ))}
          </div>
        </Section>
      </Anchor>
      <Anchor id="upgrades">
        <Section title={<Lbl k="Upgrade">Upgrades</Lbl>} aside={`${fmtInt(up.owned)} / ${fmtInt(up.total)} owned`}>
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
          <Section title={<Lbl k="Powers">Pro power upgrades</Lbl>} aside={`${fmtInt(pw.owned)} / ${fmtInt(pw.total)} owned`}>
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
      <Anchor id="skins">
        <Section title={<Lbl k="Skin">Skins</Lbl>} aside={sk ? `${sk.owned} / ${sk.total} owned` : `${owned(p.s.unlockedSkins)} owned`}>
          {sk ? <Miss name={<span class="my-in">Not owned yet</span>} part={sk} label={human} /> : <p class="my-note">{owned(p.s.unlockedSkins)} skins owned.</p>}
        </Section>
      </Anchor>
    </>
  );
}

function Progress(p: { s: UserSave }) {
  const s = p.s;
  const q = s.quests ?? [];
  const ac = achievementParts(s, PROGRESS);
  const powers = Object.entries(s.powers ?? {})
    .filter(([, v]) => v.quantity > 0)
    .sort((a, b) => b[1].quantity - a[1].quantity);
  return (
    <Section title={<Lbl k="Powers">Powers, achievements and quests</Lbl>}>
      <dl class="stats grid my-tiles">
        <Stat k={<Lbl k="Achievement">Achievements claimed</Lbl>} v={ac ? `${fmtInt(ac.owned)} / ${fmtInt(ac.total)}` : fmtInt(s.achievementsClaimed?.length ?? 0)} />
        <Stat k={<Lbl k="Quest">Quests complete</Lbl>} v={fmtInt(q.filter((x) => x.complete).length)} note={`of ${fmtInt(q.length)}`} />
      </dl>
      {ac && <Miss name={<span class="my-in">Achievements not claimed yet</span>} part={ac} label={human} />}
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

function Legends(p: { title: string; data: Record<string, number> | undefined }) {
  const rows = counters(p.data);
  if (!rows.some(([, v]) => v !== 0)) return null;
  return (
    <Section title={p.title}>
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

export function MePage() {
  const o = useOak();
  const mine = o.mine;
  const prof = mine?.profile;
  const avatar = prof?.avatarURL?.startsWith(NK_ASSETS) ? prof.avatarURL : null;
  return (
    <div class="my">
      <ToolHero
        eyebrow="Your save"
        art={avatar ? <Img src={avatar} w={72} h={72} alt="" class="my-av" eager fallback={<PersonIcon />} /> : <PersonIcon />}
        title={prof?.displayName ?? "My stats"}
        sub={prof ? `Rank ${fmtInt(prof.rank)} · Veteran rank ${fmtInt(prof.veteranRank)}` : "Your own BTD6 progress, read straight from Ninja Kiwi."}
      >
        {prof && <Spr family="tower" k={prof.mostExperiencedMonkey} size={44} name={`Most experienced: ${unitName(prof.mostExperiencedMonkey)}`} />}
        {mine && mine.save.primaryHero && <Spr family="hero" k={mine.save.primaryHero} size={44} name={`Primary hero: ${unitName(mine.save.primaryHero)}`} optional />}
      </ToolHero>
      {!o.key && <Intro />}
      {o.key && <Bar at={mine?.at ?? null} loading={o.loading} error={o.error} />}
      {o.key && !mine && o.loading && <p class="my-note">Loading your stats from Ninja Kiwi…</p>}
      {mine && (
        <>
          {o.playerId ? (
            <p class="my-pub">
              <A href={href.player(o.playerId)}>Your public profile</A>
            </p>
          ) : (
            <p class="my-note">Want your public profile here too? Open your player page from any leaderboard and press "This is me".</p>
          )}
          <Summary s={mine.save} />
          <Overview s={mine.save} />
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
          <Legends title="Rogue Legends" data={mine.save.rogueLegends} />
          <Legends title="Frontier Legends" data={mine.save.frontierLegends} />
        </>
      )}
    </div>
  );
}
