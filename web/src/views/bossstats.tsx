// Boss stats (/bosses/<type>): health and speed per tier, the skull bar, spawns and past events of one boss type.
// All numbers come from web/src/data/bosses.json (the game files) or the event's ruleset; see ../bosses.ts.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  ART,
  BOSS_BAR as B,
  BOSS_BAR_MARKER as MK,
  BOSS_BAR_RECT as RC,
  BOSS_HUD,
  type BossBarPart,
} from "../art/index.ts";
import type { Boss, ChallengeDocument } from "../../../src/nk/types.ts";
import { bossNum, fmtDate, fmtInt, mapName, scoringShort } from "../format.ts";
import {
  BAR_EXTRA,
  bossMods,
  commonStretch,
  effects,
  modHealth,
  modSpeed,
  modsChanged,
  mult,
  NO_BOSS_MODS,
  sameEffects,
  shieldHp,
  shieldLabel,
  shieldWord,
  skullRows,
  type SkullRow as SkullRowT,
  passiveLines,
  speedCompare,
  speedVal,
  spawnName,
  tierRatio,
  type BossAction,
  type BossInfo,
  type BossStatsData,
  type BossTier,
  type Effect,
} from "../bosses.ts";
import {
  BOSS_HISTORY,
  BOSS_HISTORY_SOURCE,
  type OldBoss,
} from "../data/bossHistory.ts";
import { BOSS_STATS_URL, navigate, store } from "../nav.ts";
import {
  bossMetaKey,
  historyKey,
  href,
  type BossStatsRoute,
} from "../routes.ts";
import { hasArt, Spr } from "../sprite.tsx";
import { A, body, Img, peek, Skeleton, StatusBadge, Tabs } from "../ui.tsx";
import { allEvents, bossLabel, eventHref } from "./events.tsx";

const PAST_SHOWN = 8;
const OLD_NOTE = {
  restarted: "Restarted",
  "taken down": "Taken down",
  special: "1-day special",
} as const;
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
/** Wiki calendar days ("2021-07-26") → "26 Jul – 29 Jul 2021" (the year once, or on both ends across New Year). */
function oldDates(a: string, b: string): string {
  const [x, y] = [new Date(a), new Date(b)];
  const ya = x.getUTCFullYear();
  const yb = y.getUTCFullYear();
  return `${dayFmt.format(x)}${ya !== yb ? ` ${ya}` : ""} – ${dayFmt.format(y)} ${yb}`;
}

type PastRow = { live: Boss } | { old: OldBoss } | { gap: string };
/** Past events of one boss: the archive's (newest first, links), then a line for numbers on no record, then the wiki's. */
function pastRows(
  type: string,
  events: Boss[],
  loaded: boolean,
): { rows: PastRow[]; wiki: number } {
  const nums = events.map((e) => +bossNum(e.name)).filter((n) => n > 0);
  const oldest = nums.length ? Math.min(...nums) : Infinity;
  const first = events.length
    ? Math.min(...events.map((e) => e.start))
    : Infinity;
  // The archive wins where both have an event (by number, or by date for unnumbered ones).
  const old = BOSS_HISTORY.filter(
    (o) =>
      o[0] === type &&
      (o[1] ? o[1] < oldest : Date.parse(o[3]) < first - 864e5),
  ).reverse();
  const last = Math.max(0, ...old.map((o) => o[1]));
  const rows: PastRow[] = events.map((e) => ({ live: e }));
  if (loaded && oldest !== Infinity && oldest > last + 1)
    rows.push({
      gap:
        last + 1 === oldest - 1
          ? `#${last + 1}`
          : `#${last + 1}–#${oldest - 1}`,
    });
  for (const o of old) rows.push({ old: o });
  return { rows, wiki: old.length };
}
const TIERS = [1, 2, 3, 4, 5];

/** Plain words for a skull's effects; unknown names get a small "(internal name)" hint. */
function Effects(props: { list: Effect[] }) {
  return (
    <>
      {props.list.map((e, i) => (
        <span class="bs-fx" key={e.text}>
          {i > 0 && " · "}
          {e.text}
          {e.internal && <small class="bs-int"> (internal name)</small>}
        </span>
      ))}
    </>
  );
}

/** The game's skull (orange pip); an inline drawing if the art pipeline has none. */
/** "250,000 HP to go", or with a shield on the way "500,000 armor shell + 250,000 HP = 750,000 to go". */
function ToGo(props: { row: SkullRowT; label: string; approx?: boolean }) {
  const { hp, shield } = props.row;
  const ap = props.approx ? "≈ " : "";
  if (!shield)
    return (
      <>
        {ap}
        <span class="num">{fmtInt(hp)}</span> HP to go
      </>
    );
  return (
    <>
      {ap}
      <span class="num">{fmtInt(shield)}</span> {props.label} +{" "}
      <span class="num">{fmtInt(hp)}</span> HP ={" "}
      <b class="num">{fmtInt(shield + hp)}</b> to go
    </>
  );
}

function Skull(props: { size: number }) {
  if (hasArt("boss", "skull:off"))
    return <Spr family="boss" k="skull:off" size={props.size} label optional />;
  return (
    <svg
      class="bs-skull-svg"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 2a8 8 0 0 0-8 8c0 3 1.5 5 3 6v3h2v-2h2v2h2v-2h2v2h2v-3c1.5-1 3-3 3-6a8 8 0 0 0-8-8zM8.5 12a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm7 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" />
    </svg>
  );
}

type Rect = [number, number, number, number];
const pct = (v: number) => `${+(v * 100).toFixed(3)}%`;
/** A rect (game units, y up) as % of the container rect `o`. */
const place = (r: Rect, o: Rect): JSX.CSSProperties => ({
  left: pct((r[0] - o[0]) / o[2]),
  top: pct((o[1] + o[3] - r[1] - r[3]) / o[3]),
  width: pct(r[2] / o[2]),
  height: pct(r[3] / o[3]),
});
const shift = (r: Rect, dx: number, dy: number): Rect => [
  r[0] + dx,
  r[1] + dy,
  r[2],
  r[3],
];

/** One cell of the 96 px boss sheet as a background (responsive size). */
function cell(key: string): JSX.CSSProperties {
  const s = ART.boss;
  const i = s?.keys[key];
  if (!s || i === undefined) return {};
  const pos = (n: number, m: number) => (m > 1 ? (n / (m - 1)) * 100 : 0);
  return {
    backgroundImage: `url(${s.url})`,
    backgroundSize: `${s.cols * 100}% ${s.rows * 100}%`,
    backgroundPosition: `${pos(i % s.cols, s.cols)}% ${pos(Math.floor(i / s.cols), s.rows)}%`,
  };
}

/** How one bar part draws: colour fill, boss-sheet cell, 9-slice (border-image, widths in game units), tiled or stretched. */
function look(p: BossBarPart, plain = false): JSX.CSSProperties {
  if (p.mode === "color") return { background: p.tint ?? "transparent" };
  const st: JSX.CSSProperties = p.art ? cell(p.art) : {};
  if (p.url) {
    const u = `url(${p.url})`;
    if (p.mode === "sliced" && p.slice) {
      const k = p.ppum ?? 1;
      st.borderStyle = "solid";
      st.borderWidth = 0;
      st.borderImageSource = u;
      st.borderImageSlice = `${p.slice.join(" ")}${p.center === false ? "" : " fill"}`;
      st.borderImageWidth = p.slice
        .map((v) => `calc(${+(v / k).toFixed(3)} * var(--u))`)
        .join(" ");
    } else if (p.mode === "tiled") {
      st.backgroundImage = u;
      st.backgroundRepeat = "repeat";
      st.backgroundSize = `calc(${(p.w ?? 0) / (p.ppum ?? 1)} * var(--u)) calc(${(p.h ?? 0) / (p.ppum ?? 1)} * var(--u))`;
    } else {
      st.backgroundImage = u;
      st.backgroundSize = "100% 100%";
    }
  }
  if (!plain && p.tint) {
    const a = parseInt(p.tint.slice(7, 9) || "ff", 16) / 255;
    if (a < 1) st.opacity = +a.toFixed(3);
    if (p.tint.slice(1, 7) === "000000") st.filter = "brightness(0)";
  }
  return st;
}

/** Keeps the left `frac` of `clip`; the children are placed against the whole clip rect. */
function Clip(props: {
  clip: Rect;
  o: Rect;
  frac: number;
  children: (o: Rect) => ComponentChildren;
}) {
  return (
    <div
      class="hb-clip"
      style={{
        ...place(props.clip, props.o),
        width: pct((props.clip[2] * props.frac) / props.o[2]),
      }}
    >
      <div class="hb-clip-in" style={{ width: pct(1 / props.frac) }}>
        {props.children(props.clip)}
      </div>
    </div>
  );
}

/** The in-game boss bar for one boss + tier, full, with every skull still to come. Decoration: the numbers are in the text. */
function BossBar(props: {
  type: string;
  name: string;
  elite: boolean;
  rows: ReturnType<typeof skullRows>;
  triggers: BossAction[];
}) {
  const { type } = props;
  const extra = BAR_EXTRA[type];
  const hp = RC.hp;
  const part = (k: string, o: Rect, st?: JSX.CSSProperties, plain = false) => (
    <i
      class="hb-p"
      style={{ ...place(B[k].rect, o), ...look(B[k], plain), ...st }}
    />
  );
  // bounds = the used parts + a margin, like the game's layout
  const used: Rect[] = [B["hp:frame"].rect, B.hud.rect];
  if (extra === "heat")
    used.push(B["heat:frame"].rect, B["bar:heatGauge"].rect);
  if (extra === "tail") used.push(B["tail:frame"].rect, B["bar:tailOn"].rect);
  if (extra === "armour") used.push(RC[`armour:${type}`]);
  const mg = 30;
  const x0 = Math.min(...used.map((r) => r[0])) - mg;
  const y0 = Math.min(...used.map((r) => r[1])) - mg;
  const x1 = Math.max(...used.map((r) => r[0] + r[2])) + mg;
  const y1 = Math.max(...used.map((r) => r[1] + r[3])) + mg;
  const o: Rect = [x0, y0, x1 - x0, y1 - y0];
  const at = (a: number) => hp[0] + a * hp[2];
  const barLike = (pre: "hp" | "heat", frac: number) => (
    <>
      {part(`${pre}:bg`, o)}
      <Clip clip={B[`${pre}:fill`].rect} o={o} frac={frac}>
        {(c) => (
          <>
            {part(`${pre}:fill`, c)}
            {B[`${pre}:shade`] && part(`${pre}:shade`, c)}
            {B[`${pre}:highlight`] && part(`${pre}:highlight`, c)}
          </>
        )}
      </Clip>
      {part(`${pre}:frame`, o)}
    </>
  );
  const hud = BOSS_HUD[`hud:${props.elite ? "elite:" : ""}${type}`];
  const label = `${props.name} health bar, ${props.rows.length} skulls at ${props.rows.map((r) => mult(r.at)).join(", ")}`;
  return (
    <div
      class="hb"
      style={{ "--u": `calc(100cqw / ${o[2]})` } as JSX.CSSProperties}
    >
      <div
        class="hb-stage"
        role="img"
        aria-label={label}
        style={{ aspectRatio: `${+o[2].toFixed(2)} / ${+o[3].toFixed(2)}` }}
      >
        {barLike("hp", 1)}
        {extra === "armour" && (
          <>
            <Clip
              clip={
                B[`armour:${type}:fill`].clip ?? B[`armour:${type}:fill`].rect
              }
              o={o}
              frac={1}
            >
              {(c) => part(`armour:${type}:fill`, c)}
            </Clip>
            {part(`armour:${type}:edge`, o, {
              left: pct(
                (B[`armour:${type}:fill`].clip![0] +
                  B[`armour:${type}:fill`].clip![2] -
                  B[`armour:${type}:edge`].rect[2] / 2 -
                  o[0]) /
                  o[2],
              ),
            })}
          </>
        )}
        {props.rows.map((r) => {
          const m: Rect = [
            at(r.at) - MK.w / 2,
            hp[1] + (hp[3] - MK.h) / 2,
            MK.w,
            MK.h,
          ];
          return (
            <span key={r.n}>
              <i
                class="hb-p"
                style={{
                  ...place(shift(B["marker:line"].rect, m[0], m[1]), o),
                  ...look(B["marker:line"]),
                }}
              />
              <i
                class="hb-p hb-skull"
                style={{
                  ...place(shift(B["marker:skull"].rect, m[0], m[1]), o),
                  ...cell("skull:off"),
                }}
              />
            </span>
          );
        })}
        {props.triggers.map((t) => (
          <i
            class="hb-p bs-tick"
            key={`t${t.at}`}
            style={{ ...place([at(t.at) - 7, hp[1], 14, hp[3]], o) }}
          />
        ))}
        {extra === "heat" && (
          <>
            {
              barLike(
                "heat",
                0,
              ) /* start state: no heat (decoration, no data) */
            }
            {part("bar:heatGauge", o)}
            {part("bar:heatNeedle", o)}
          </>
        )}
        {extra === "tail" && (
          <>
            {part("tail:bg", o)}
            {part("tail:color", o)}
            <Clip clip={B["tail:fill"].clip!} o={o} frac={1}>
              {(c) => part("tail:fill", c, undefined, true)}
            </Clip>
            {part("tail:highlight", o)}
            {part("tail:frame", o)}
            {part("bar:tailOn", o)}
          </>
        )}
        {hud && (
          <img
            class="hb-p"
            alt=""
            src={hud.url}
            width={hud.w}
            height={hud.h}
            style={place(B.hud.rect, o)}
          />
        )}
      </div>
      <div
        class={`hb-labels${props.rows.length >= 5 ? " many" : ""}`}
        aria-hidden="true"
      >
        <span class="hb-end" style={{ left: pct((at(0) - x0) / o[2]) }}>
          0%
        </span>
        <span class="hb-end" style={{ left: pct((at(1) - x0) / o[2]) }}>
          100%
        </span>
        {props.rows.map((r, i) => (
          <span
            class={`bs-pc${i % 2 ? "" : " alt"}`}
            key={r.n}
            style={{ left: pct((at(r.at) - x0) / o[2]) }}
          >
            {mult(r.at)}
          </span>
        ))}
        {props.triggers.map((t) => (
          <span
            class="bs-pc bs-trig"
            key={`t${t.at}`}
            style={{ left: pct((at(t.at) - x0) / o[2]) }}
          >
            At {mult(t.at)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BossStatsPage(props: { r: BossStatsRoute }) {
  const r = props.r;
  const entry = store.peek(BOSS_STATS_URL);
  const data = entry?.ok ? (entry.data as BossStatsData) : undefined;
  useEffect(() => {
    void store.want([BOSS_STATS_URL]);
  }, []);
  const boss = data?.bosses[r.type];
  const events = allEvents("boss").filter(
    (e) => (e as Boss).bossType === r.type,
  ) as Boss[];
  const opening = r.ev ? events.find((e) => e.id === r.ev) : undefined;
  const meta = r.ev
    ? body<ChallengeDocument>(bossMetaKey(r.ev, r.d))
    : undefined;
  const evMods = bossMods(meta?._bloonModifiers);
  const changed = !!r.ev && modsChanged(evMods);
  const mods = changed && r.mod ? evMods : NO_BOSS_MODS;
  const [all, setAll] = useState(false);

  const to = (patch: Partial<BossStatsRoute>) => {
    const n = { ...r, ...patch };
    return href.bossstats(n.type, { d: n.d, t: n.t, ev: n.ev, mod: n.mod });
  };
  const go = (patch: Partial<BossStatsRoute>) =>
    navigate(to(patch), { replace: true, keepScroll: true });

  const banner = (opening ?? events[0])?.bossTypeURL;
  const name = boss?.name ?? r.type;
  const back = opening
    ? { href: eventHref("boss", opening.id), label: bossLabel(opening) }
    : { href: href.events("boss"), label: "Boss events" };

  return (
    <>
      <A href={back.href} class="backlink">
        <span aria-hidden="true">‹</span> {back.label}
      </A>
      <header class="bhero bs-hero">
        <div class="bh-top">
          <span class="bh-art">
            <Img
              src={banner}
              w={1440}
              h={332}
              eager
              alt=""
              fallback={<span class="bh-noart">{name}</span>}
            />
          </span>
          <div class="bh-side">
            <p class="eyebrow">Boss stats</p>
            <h1 class="bs-title">{name}</h1>
            {boss && (
              <>
                <p class="bs-tag">{boss.tagline}</p>
                <p class="bs-tag2">{boss.tagline2}</p>
                {boss.props.length > 0 && (
                  <ul class="bs-chips" aria-label="Bloon properties">
                    {boss.props.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      {!boss ? (
        data ? (
          <p class="quiet">No stats for this boss.</p>
        ) : (
          <Skeleton rows={6} what="boss stats" />
        )
      ) : (
        <StatsBody
          r={r}
          boss={boss}
          data={data!}
          opening={opening}
          meta={meta}
          changed={changed}
          evMods={evMods}
          mods={mods}
          go={go}
          to={to}
          events={events}
          all={all}
          setAll={setAll}
        />
      )}
    </>
  );
}

function StatsBody(props: {
  r: BossStatsRoute;
  boss: BossInfo;
  data: BossStatsData;
  opening?: Boss;
  meta?: ChallengeDocument;
  changed: boolean;
  evMods: ReturnType<typeof bossMods>;
  mods: ReturnType<typeof bossMods>;
  go: (p: Partial<BossStatsRoute>) => void;
  to: (p: Partial<BossStatsRoute>) => string;
  events: Boss[];
  all: boolean;
  setAll: (v: boolean) => void;
}) {
  const {
    r,
    boss,
    data,
    opening,
    changed,
    evMods,
    mods,
    go,
    to,
    events,
    all,
    setAll,
  } = props;
  const elite = r.d === "elite";
  const tiers: BossTier[] = elite ? boss.elite : boss.normal;
  const tier = tiers[r.t - 1];
  const hpOf = (t: BossTier) => modHealth(t.health, mods);
  const top = hpOf(tiers[tiers.length - 1]);
  const hp = hpOf(tier);
  const modded = mods.health !== 1;
  const rows = skullRows(
    hp,
    tier.skulls,
    tier.shield ? shieldHp(tier.shield, mods) : 0,
  );
  const ctx = { actions: tier.actions, noModel: tier.noModel };
  const fx = tier.skulls.map((s) => effects(s.do, ctx));
  const same = sameEffects(tier.skulls, ctx);
  const anyFx = fx.some((l) => l.length > 0);
  const perSkullFx = !same && anyFx;
  const hasImm = !!tier.immunity;
  const ratio = tierRatio(boss.elite[4].health, boss.normal[4].health);
  const active = passiveLines(tier);
  const spawns = (boss.spawns ?? [])
    .map((s) => ({
      s,
      levels: (elite ? s.elite : s.normal)
        .map((t, i) => ({ ...t, lv: i + 1 }))
        .filter((t) => t.used),
    }))
    .filter((x) => x.levels.length > 0);
  const common = !hasImm && !perSkullFx ? commonStretch(rows) : null;
  const { rows: pastAll, wiki } = pastRows(
    r.type,
    events,
    !!peek(historyKey("boss")),
  );
  const past = all ? pastAll : pastAll.slice(0, PAST_SHOWN);
  const shown = pastAll.filter((x) => !("gap" in x)).length;

  return (
    <div class="bs-page">
      <div class="bs-controls">
        <Tabs
          label="Difficulty"
          class="bs-tabs"
          items={(["standard", "elite"] as const).map((x) => {
            const sc = opening
              ? x === "elite"
                ? opening.eliteScoringType
                : opening.normalScoringType
              : undefined;
            return {
              href: to({ d: x }),
              label: (
                <>
                  {sc && <Spr family="ui" k={sc} size={28} label optional />}
                  <span class="bt-t">
                    <span class="bt-d">
                      {x === "standard" ? "Normal" : "Elite"}
                    </span>
                    {sc && <span class="bt-s">{scoringShort(sc)}</span>}
                  </span>
                </>
              ),
              current: x === r.d,
            };
          })}
        />
        <span class="bs-ctl-l" aria-hidden="true">
          Tier
        </span>
        <div class="bs-seg" role="group" aria-label="Tier">
          {TIERS.map((n) => (
            <button
              key={n}
              type="button"
              class={n === r.t ? "on" : undefined}
              aria-pressed={n === r.t}
              onClick={() => go({ t: n })}
            >
              T{n}
            </button>
          ))}
        </div>
        {changed && opening && (
          <div class="bs-mod">
            <button
              type="button"
              class={`bs-switch${r.mod ? " on" : ""}`}
              role="switch"
              aria-checked={r.mod}
              onClick={() => go({ mod: !r.mod })}
            >
              <span class="bs-knob" aria-hidden="true" />
              <span class="vh">
                Apply event #{bossNum(opening.name)} modifiers
              </span>
            </button>
            <span class="bs-mod-t">
              {r.mod ? (
                <>
                  Event #{bossNum(opening.name)} modifiers (
                  {[
                    evMods.health !== 1
                      ? `boss health ${mult(evMods.health)}`
                      : "",
                    evMods.speed !== 1
                      ? `boss speed ${mult(evMods.speed)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  )
                </>
              ) : (
                `Event #${bossNum(opening.name)} modifiers off`
              )}
            </span>
          </div>
        )}
      </div>

      <div class="bs-grid">
        <div class="bs-stack">
          <section class="bs-plate bs-health" aria-labelledby="bs-hp-h">
            <h2 class="kicker-h" id="bs-hp-h">
              Health per tier
            </h2>
            <div class="bs-th" aria-hidden="true">
              <span>Tier</span>
              <span>Health</span>
              <span title="Bars scaled to T5">Bar</span>
              <span>Speed</span>
            </div>
            <ol class="bs-tiers">
              {TIERS.map((n) => {
                const t = tiers[n - 1];
                const h = hpOf(t);
                return (
                  <li key={n}>
                    <button
                      type="button"
                      class={`bs-tier${n === r.t ? " on" : ""}`}
                      aria-pressed={n === r.t}
                      onClick={() => go({ t: n })}
                    >
                      <span class="bs-tl">T{n}</span>
                      <span class="bs-hp num">
                        {fmtInt(h)}
                        {modded && (
                          <small class="bs-base">
                            before modifier {fmtInt(t.health)}
                          </small>
                        )}
                      </span>
                      <span class="bs-hbar" aria-hidden="true">
                        <i
                          style={{ width: `${Math.max(1, (h / top) * 100)}%` }}
                        />
                      </span>
                      <span class="bs-sp num">
                        {speedVal(modSpeed(t.speed, mods))}
                        {mods.speed !== 1 && (
                          <small class="bs-base">
                            before modifier {speedVal(t.speed)}
                          </small>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p class="bs-note quiet">Elite T5 = {ratio}× Normal T5.</p>
            <p class="bs-note quiet">
              Speed T{r.t}: {speedVal(modSpeed(tier.speed, mods))} —{" "}
              {speedCompare(modSpeed(tier.speed, mods), data.speed)}. Game
              units.
            </p>
          </section>
          {active.length > 0 && (
            <section class="bs-plate bs-active" aria-labelledby="bs-ac-h">
              <h2 class="kicker-h" id="bs-ac-h">
                Always active · {elite ? "Elite" : "Normal"} T{r.t}
              </h2>
              <ul class="bs-lines">
                {active.map((l) => (
                  <li key={l.text}>
                    {l.text}
                    {l.internal && (
                      <small class="bs-int"> (internal name)</small>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section class="bs-plate bs-skulls-plate" aria-labelledby="bs-sk-h">
          <h2 class="kicker-h" id="bs-sk-h">
            Skulls · {elite ? "Elite" : "Normal"} T{r.t}
          </h2>
          <BossBar
            type={r.type}
            name={boss.name}
            elite={elite}
            rows={rows.filter((x) => x.n)}
            triggers={tier.triggers}
          />
          {tier.shield && (
            <p class="bs-every">
              <strong>{shieldLabel(tier.shield)}:</strong>{" "}
              <span class="num">{fmtInt(shieldHp(tier.shield, mods))}</span> HP,
              up at spawn and rebuilt at every skull
              {modded && (
                <small class="bs-base">
                  {" "}
                  (before modifier {fmtInt(tier.shield.health)})
                </small>
              )}
            </p>
          )}
          {same && (
            <p class="bs-every">
              <strong>Every skull:</strong> <Effects list={fx[0]} />
            </p>
          )}
          {common && (
            <p class="bs-every">
              <strong>
                Every skull
                {tier.skulls.length > 0 ? " and the last stretch" : ""}:
              </strong>{" "}
              <ToGo
                row={common.row}
                approx={common.approx}
                label={tier.shield ? shieldWord(tier.shield) : ""}
              />
            </p>
          )}
          {!anyFx && tier.triggers.length === 0 && (
            <p class="bs-note">Skull effects not listed in the game data.</p>
          )}
          {!common && (
            <ol
              class={`bs-skull-list${hasImm ? " has-imm" : ""}${perSkullFx ? " has-fx" : ""}`}
            >
              {rows.map((x, i) => (
                <li key={x.n} class={x.n ? undefined : "bs-end"}>
                  <span class="bs-skull sm">
                    {x.n ? (
                      <Skull size={24} />
                    ) : (
                      <span class="bs-ko" aria-hidden="true" />
                    )}
                  </span>
                  <span class="bs-sk-main">
                    <span class="bs-sk-n">
                      <strong>{x.n ? `Skull ${x.n}` : "Defeat"}</strong> ·{" "}
                      {mult(x.at)}
                    </span>
                    {!common && (
                      <span class="bs-go">
                        <ToGo
                          row={x}
                          label={tier.shield ? shieldWord(tier.shield) : ""}
                        />
                      </span>
                    )}
                  </span>
                  {hasImm && (
                    <span class="bs-imm">
                      {tier.immunity?.[i] && (
                        <>
                          <Spr
                            family="boss"
                            k={`immunity:${tier.immunity[i]}`}
                            size={24}
                            optional
                          />
                          Immune to {tier.immunity[i]}
                        </>
                      )}
                    </span>
                  )}
                  {perSkullFx && (
                    <span class="bs-do">
                      {x.n > 0 && <Effects list={fx[i]} />}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {spawns.length > 0 && (
          <section class="bs-plate bs-spawns-plate" aria-labelledby="bs-sp-h">
            <h2 class="kicker-h" id="bs-sp-h">
              Spawns
            </h2>
            <ul class="bs-spawns">
              {spawns.map(({ s, levels }) => {
                const nm = spawnName(s);
                const key =
                  elite && hasArt("boss", `spawn:${s.key}:elite`)
                    ? `spawn:${s.key}:elite`
                    : `spawn:${s.key}`;
                return (
                  <li key={s.key} class="bs-spawn">
                    <span class="bs-sprite">
                      {hasArt("boss", key) ? (
                        <Spr family="boss" k={key} size={48} name={nm} label />
                      ) : (
                        <span class="bs-chip">{nm}</span>
                      )}
                    </span>
                    <span class="bs-spawn-b">
                      <strong class="bs-spawn-n">{nm}</strong>
                      <span class="bs-lv">
                        {levels.map((l) => (
                          <span key={l.lv}>
                            <small>Lv {l.lv}</small>
                            <b class="num">{fmtInt(l.health)}</b>
                          </span>
                        ))}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p class="bs-note quiet">
              HP of one bloon. Which boss tier spawns which level isn't in the
              game data.
            </p>
          </section>
        )}

        <section class="bs-plate bs-past-plate" aria-labelledby="bs-pe-h">
          <h2 class="kicker-h" id="bs-pe-h">
            Past events <span class="bs-count num">{shown}</span>
          </h2>
          {shown === 0 && <p class="quiet">None in the lists yet.</p>}
          <ul class="bs-past">
            {past.map((x) => {
              if ("gap" in x)
                return (
                  <li key="gap" class="bs-gap">
                    {x.gap} · not on record yet
                  </li>
                );
              if ("old" in x) {
                // Before the archive: no longer on NK's servers, so a plain row (no leaderboard to open).
                const [, n, map, a, b, note] = x.old;
                return (
                  <li key={`${n}-${a}`} class="old">
                    <div class="bs-ev">
                      <span class="plate">{n ? `#${n}` : "–"}</span>
                      <span class="bs-ev-m">
                        <strong>{mapName(map)}</strong>
                        <span class="quiet">{oldDates(a, b)}</span>
                      </span>
                      {note && <span class="bs-note-t">{OLD_NOTE[note]}</span>}
                    </div>
                  </li>
                );
              }
              const e = x.live;
              const mp = body<ChallengeDocument>(
                bossMetaKey(e.id, "standard"),
              )?.map;
              return (
                <li key={e.id} class={e.id === opening?.id ? "on" : undefined}>
                  <A href={eventHref("boss", e.id)} class="bs-ev">
                    <span class="plate">#{bossNum(e.name)}</span>
                    <span class="bs-ev-m">
                      {mp && <strong>{mapName(mp)}</strong>}
                      <span class="quiet">
                        {fmtDate(e.start)} – {fmtDate(e.end)}
                      </span>
                    </span>
                    <StatusBadge start={e.start} end={e.end} />
                  </A>
                </li>
              );
            })}
          </ul>
          {!all && pastAll.length > PAST_SHOWN && (
            <button type="button" class="bs-more" onClick={() => setAll(true)}>
              Show all {shown}
            </button>
          )}
          {wiki > 0 && (all || pastAll.length <= PAST_SHOWN) && (
            <p class="bs-src quiet">
              Events older than this site's archive: from the{" "}
              <a
                href={BOSS_HISTORY_SOURCE}
                target="_blank"
                rel="noopener noreferrer"
              >
                Bloons Wiki
              </a>{" "}
              (dates in New Zealand time), no longer on Ninja Kiwi's servers.
            </p>
          )}
          {!peek(historyKey("boss")) && (
            <p class="quiet">Loading older events…</p>
          )}
        </section>
      </div>

      <details class="bs-plate bs-about">
        <summary>About this data</summary>
        <ul class="bs-words">
          {boss.desc.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p class="bs-foot quiet">
          From the game files, version {data.v}. Not in the game data: leak
          damage, invulnerability lengths, the round each tier appears. Stun
          times are the game's values in seconds (unit confirmed from play).
          Skull effects are the game's internal action names in plain words;
          only counts, intervals and amounts the data states are shown. Times in
          seconds; speed in the game's own units. Shields are up at spawn (from
          play; the game data has no flag for it).
        </p>
      </details>
    </div>
  );
}
