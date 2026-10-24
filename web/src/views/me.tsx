// /me "My stats": the player's own save, read in this browser straight from Ninja Kiwi with their Open Access Key
// (oak.ts). Nothing here touches our Worker or the store, so the route needs() nothing.
import { useState } from "preact/hooks";
import type { UserSave } from "../../../src/nk/types.ts";
import { agoText } from "../boards.ts";
import { cap, fmtInt, human, unitName } from "../format.ts";
import { forgetOak, OAK_FORMAT, refreshOak, setOak, useOak, type OakError } from "../oak.ts";
import { instaSummary, medalCounts } from "../oakSave.ts";
import { href } from "../routes.ts";
import { MODE_NAME, Spr } from "../sprite.tsx";
import { A, Img, Section, Stat, ToolHero, useTick } from "../ui.tsx";

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

function Overview(p: { s: UserSave }) {
  const s = p.s;
  return (
    <dl class="stats grid my-tiles">
      <Stat k="Games played" v={fmtInt(s.gamesPlayed)} />
      <Stat k="Highest round seen" v={fmtInt(s.highestSeenRound)} />
      <Stat k="Monkey money" v={fmtInt(s.monkeyMoney)} />
      <Stat k="Trophies" v={fmtInt(s.trophies)} note={`${fmtInt(s.lifetimeTrophies)} lifetime`} />
      <Stat k="Knowledge points" v={fmtInt(s.knowledgePoints)} />
      <Stat k="Races entered" v={fmtInt(s.totalRacesEntered)} />
      <Stat k="Continues used" v={fmtInt(s.continuesUsed)} />
      <Stat k="Challenges played" v={fmtInt(s.challengesPlayed)} note={`${fmtInt(s.challengesShared)} shared`} />
      <Stat k="Dailies completed" v={fmtInt(s.totalDailyChallengesCompleted)} note={`streak ${fmtInt(s.consecutiveDailyChallengesCompleted)}`} />
      <Stat k="Odysseys completed" v={fmtInt(s.totalCompletedOdysseys)} />
      <Stat k="Crates opened" v={fmtInt(s.collectionEventCratesOpened)} />
      <Stat k="Daily rewards" v={fmtInt(s.dailyRewardCount)} />
      <Stat k="Game version" v={s.latestGameVersion} />
    </dl>
  );
}

function Medals(p: { s: UserSave }) {
  const rows = medalCounts(p.s);
  return (
    <Section title="Map medals" aside={<A href={href.maps()}>All maps</A>}>
      {(["Easy", "Medium", "Hard"] as const).map((d) => {
        const rs = rows.filter((r) => r.difficulty === d);
        return (
          rs.length > 0 && (
            <div key={d} class="my-medals">
              <h3>{d}</h3>
              <ul>
                {rs.map((r) => (
                  <li key={r.mode}>
                    <span class={r.solo ? "my-m" : "my-m dim"}>
                      <Spr family="modeMedal" k={r.medal} size={48} count={r.solo} name={`${r.mode === "Standard" ? d : (MODE_NAME[r.mode] ?? r.mode)} solo`} />
                    </span>
                    <span class={r.coop ? "my-m" : "my-m dim"}>
                      <Spr family="modeMedal" k={`coop:${r.medal}`} size={48} count={r.coop} name={`${r.mode === "Standard" ? d : (MODE_NAME[r.mode] ?? r.mode)} co-op`} />
                    </span>
                    <span class="my-mn">{MODE_NAME[r.mode] ?? human(r.mode)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        );
      })}
      <p class="my-note">Maps completed per mode, solo then co-op.</p>
    </Section>
  );
}

function Instas(p: { s: UserSave }) {
  const rows = instaSummary(p.s);
  if (!rows.length) return null;
  const all = rows.reduce((n, r) => n + r.total, 0);
  return (
    <Section title="Insta Monkeys" aside={`${fmtInt(all)} in total`}>
      <div class="my-instas">
        {rows.map((r) => (
          <details key={r.tower}>
            <summary>
              <Spr family="tower" k={r.tower} size={36} label />
              <span class="my-in">{unitName(r.tower)}</span>
              <span class="my-ic">
                {fmtInt(r.sets)} {r.sets === 1 ? "set" : "sets"} · {fmtInt(r.total)}
              </span>
            </summary>
            <ul class="my-tiers">
              {r.tiers.map(([t, n]) => (
                <li key={t}>
                  {t} <b>×{n}</b>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
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
    <Section title="Tower XP">
      <ol class="my-xp">
        {rows.map(([t, x]) => (
          <li key={t}>
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

function Heroes(p: { s: UserSave }) {
  const heroes = Object.entries(p.s.unlockedHeroes ?? {}).filter(([, v]) => v);
  return (
    <Section title="Heroes" aside={`${heroes.length} unlocked · ${owned(p.s.unlockedSkins)} skins`}>
      <ul class="my-heroes">
        {heroes.map(([h]) => (
          <li key={h}>
            <Spr family="hero" k={h} size={48} label />
            <span>{unitName(h)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Progress(p: { s: UserSave }) {
  const s = p.s;
  const kn = Object.keys(s.acquiredKnowledge ?? {}).length;
  const q = s.quests ?? [];
  const powers = Object.entries(s.powers ?? {})
    .filter(([, v]) => v.quantity > 0)
    .sort((a, b) => b[1].quantity - a[1].quantity);
  return (
    <Section title="Knowledge, powers and quests">
      <dl class="stats grid my-tiles">
        <Stat k="Monkey Knowledge" v={fmtInt(owned(s.acquiredKnowledge))} note={`of ${fmtInt(kn)} listed`} />
        <Stat k="Achievements claimed" v={fmtInt(s.achievementsClaimed?.length ?? 0)} />
        <Stat k="Quests complete" v={fmtInt(q.filter((x) => x.complete).length)} note={`of ${fmtInt(q.length)}`} />
      </dl>
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
          <Overview s={mine.save} />
          <Medals s={mine.save} />
          <Instas s={mine.save} />
          <Xp s={mine.save} />
          <Heroes s={mine.save} />
          <Progress s={mine.save} />
          <Legends title="Rogue Legends" data={mine.save.rogueLegends} />
          <Legends title="Frontier Legends" data={mine.save.frontierLegends} />
        </>
      )}
    </div>
  );
}
