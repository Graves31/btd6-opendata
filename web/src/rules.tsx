// Rulesets (race/boss metadata, challenges, odyssey islands): one shared component. Recognisable game objects
// are game art; quantities (limits, tier caps, multipliers) stay numbers.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ChallengeDocument, PowerRestriction, TowerRestriction } from "../../src/nk/types.ts";
import { cap, fmtInt, fmtRounds, human, mapName, unitName } from "./format.ts";
import { roundsFor, setLabel, type RulesRounds } from "./rounds.ts";
import { href } from "./routes.ts";
import { AnyHero, artName, hasArt, MODE_NAME, Spr } from "./sprite.tsx";
import { A, Fact } from "./ui.tsx";

/** In-game tower order: Primary, Military, Magic, Support. Unknown towers are appended. */
export const TOWER_GROUPS: [string, string[]][] = [
  ["Primary", ["DartMonkey", "BoomerangMonkey", "BombShooter", "TackShooter", "IceMonkey", "GlueGunner", "Desperado"]],
  ["Military", ["SniperMonkey", "MonkeySub", "MonkeyBuccaneer", "MonkeyAce", "HeliPilot", "MortarMonkey", "DartlingGunner"]],
  ["Magic", ["WizardMonkey", "SuperMonkey", "NinjaMonkey", "Alchemist", "Druid", "Mermonkey", "Skywarden"]],
  ["Support", ["BananaFarm", "SpikeFactory", "MonkeyVillage", "EngineerMonkey", "BeastHandler"]],
];
export const TOWER_ORDER = TOWER_GROUPS.flatMap(([, t]) => t);
/** Heroes in the game's (release) order. */
export const HERO_ORDER = [
  "Quincy", "Gwendolin", "StrikerJones", "ObynGreenfoot", "CaptainChurchill", "Benjamin", "Ezili", "PatFusty", "Adora",
  "AdmiralBrickell", "Etienne", "Sauda", "Psi", "Geraldo", "Corvus", "Rosalia", "Silas", "DanDMonke",
];

/** `order` first, then any id the data has that we don't know yet. */
export function inOrder(order: string[], ids: Iterable<string>): string[] {
  const extra = [...ids].filter((id) => !order.includes(id));
  return [...order, ...extra];
}

// ─────────────────────────────── tier caps

/**
 * Highest tier allowed per path. pathNNumBlockedTiers is inferred to be "number of top tiers blocked"
 * (docs/api/README.md); -1 is unverified and treated as the whole path blocked, flagged `guess`.
 */
export function tierCaps(t: TowerRestriction): { c: [number, number, number]; guess: boolean } {
  const b = [t.path1NumBlockedTiers, t.path2NumBlockedTiers, t.path3NumBlockedTiers];
  return { c: b.map((n) => (n < 0 ? 0 : Math.max(0, 5 - n))) as [number, number, number], guess: b.some((n) => n < 0) };
}
const capStr = (c: number[]) => c.join("-");
const FREE = "5-5-5";

/**
 * The game's power button backgrounds: orange hexagon for regular powers, blue for Pro powers, purple for
 * store items (the potions). Falls back to the regular tile when a variant isn't in the art.
 */
const PRO_POWERS = new Set(["BananaFarmerPro", "MonkeyBoostPro", "PortableLakePro", "TechBotPrime"]);
const STORE_POWERS = new Set(["HealthPotion", "StaminaPotion"]);
function powerTile(id: string): string {
  const k = PRO_POWERS.has(id) ? "PowerPro" : STORE_POWERS.has(id) ? "PowerStore" : "Power";
  return hasArt("container", k) ? k : "Power";
}

/** Tower id → in-game shop category (the colour of its tile). Heroes are "Hero". */
const CATEGORY = new Map(TOWER_GROUPS.flatMap(([cat, ids]) => ids.map((id) => [id, cat] as const)));

// ─────────────────────────────── rosters: in-game tower tiles

interface Cell {
  id: string;
  max: number;
  caps?: { c: [number, number, number]; guess: boolean };
}

/**
 * One tower/hero as the game draws it in a challenge's rules: portrait on its category-coloured shop tile,
 * a blue circle top-left with the most you can place (only when limited), the highest upgrade per path in red
 * at the bottom (only when restricted, e.g. "2-0-3"). Banned: greyed out in place.
 * The `<li>` stays a list item; a transparent overlay inside it is the one image (named, focusable) so screen
 * readers get a real list. `tabStop`: whether this tile is the roster's single Tab stop (Roster moves it with
 * the arrow keys); a tile used alone is always one.
 */
export function Tile(p: { family: "tower" | "hero" | "power"; cell: Cell; tabStop?: boolean; onFocusTile?: () => void }) {
  const { id, max, caps } = p.cell;
  const banned = max === 0;
  const limit = max > 0 && max < 99 ? max : undefined;
  const cap = !banned && caps && capStr(caps.c) !== FREE ? capStr(caps.c) : undefined;
  const cat = p.family === "hero" ? "Hero" : p.family === "power" ? powerTile(id) : CATEGORY.get(id);
  const name = p.family === "power" ? artName("power", id) : unitName(id);
  const label =
    name +
    (banned ? ", banned" : "") +
    (limit ? `, at most ${limit}` : "") +
    (cap ? `, upgrades up to ${cap}${caps!.guess ? " (a locked path is inferred)" : ""}` : "");
  const note = banned ? "Banned" : [limit ? `Max ${limit}` : "", cap ?? ""].filter(Boolean).join(" · ");
  const tip = useRef<HTMLSpanElement>(null);
  // Esc hides the name while the tile stays hovered/focused (WCAG 1.4.13); leaving the tile brings it back.
  const [hidden, setHidden] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown || hidden) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setHidden(true);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [shown, hidden]);
  // Tap (or focus, or hover) shows the name: tiles are pictures, and phones have no hover. The label is nudged
  // back inside the viewport so it never causes sideways scrolling.
  const place = () => {
    const el = tip.current;
    if (!el) return;
    el.style.setProperty("--dx", "0px");
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const dx = r.left < 8 ? 8 - r.left : r.right > vw - 8 ? vw - 8 - r.right : 0;
      if (dx) el.style.setProperty("--dx", `${dx}px`);
    });
  };
  const leave = (e: Event) => {
    // still inside the tile (its name box, or focus): keep showing
    const li = (e.currentTarget as HTMLElement).closest("li")!;
    if (li.matches(":hover") || li.matches(":focus-within")) return;
    setShown(false);
    setHidden(false);
  };
  return (
    <li
      class={`ttile${cat ? ` c-${cat}` : ""}${banned ? " off" : ""}${hidden ? " tip-off" : ""}`}
      onPointerEnter={() => {
        place();
        setShown(true);
      }}
      onPointerLeave={leave}
    >
      {cat && hasArt("container", cat) && <Spr family="container" k={cat} size={57} class="ttile-bg" label />}
      <Spr family={p.family} k={id} size={44} class={p.family === "power" ? "ttile-p pw" : "ttile-p"} label />
      {/* Towers: the blue circle top-left. Powers: the game's yellow count badge top-right. */}
      {limit !== undefined && (
        <span class={p.family === "power" ? "ttile-n pw" : "ttile-n"} aria-hidden="true">
          {limit}
        </span>
      )}
      {cap && (
        <span class="ttile-cap" aria-hidden="true">
          {cap}
        </span>
      )}
      <span
        class="ttile-f"
        role="img"
        aria-label={label}
        tabIndex={p.tabStop === false ? -1 : 0}
        onClick={(e) => (e.currentTarget as HTMLElement).focus()}
        onFocus={() => {
          place();
          setShown(true);
          p.onFocusTile?.();
        }}
        onBlur={leave}
      />
      <span class="ttile-tip" ref={tip} aria-hidden="true">
        {name}
        {note && <span class="ttile-tip-n">{note}</span>}
      </span>
    </li>
  );
}

/**
 * The roster's keyboard behaviour: one Tab stop for the whole list, arrow keys (and Home/End) move between tiles.
 * Returns the `<ul>` key handler and the tabStop/onFocusTile props for tile `i`.
 */
function useRoving(count: number) {
  const [cur, setCur] = useState(0);
  const at = Math.min(cur, Math.max(0, count - 1));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    const step = k === "ArrowRight" || k === "ArrowDown" ? 1 : k === "ArrowLeft" || k === "ArrowUp" ? -1 : 0;
    if (!step && k !== "Home" && k !== "End") return;
    const tiles = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(".ttile-f")];
    const i = tiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    tiles[k === "Home" ? 0 : k === "End" ? tiles.length - 1 : Math.max(0, Math.min(tiles.length - 1, i + step))]?.focus();
  };
  return { onKeyDown, tile: (i: number) => ({ tabStop: i === at, onFocusTile: () => setCur(i) }) };
}

export function Roster(p: { family: "tower" | "hero" | "power"; cells: Cell[]; label: string; small?: boolean }) {
  const rv = useRoving(p.cells.length);
  return (
    <ul class={`roster ttiles${p.small ? " small" : ""}`} aria-label={p.label} onKeyDown={rv.onKeyDown}>
      {p.cells.map((c, i) => (
        <Tile key={c.id} family={p.family} cell={c} {...rv.tile(i)} />
      ))}
    </ul>
  );
}

// Banned filter: all / hide banned / only banned. One preference for every roster on the page, remembered on
// this device ("1" = hide, "2" = only, as stored by the old two-state toggle).
type BanView = "all" | "hide" | "only";
const HIDE_KEY = "btd6od.hideBanned";
const hideListeners = new Set<(v: BanView) => void>();
function readBanView(): BanView {
  try {
    const v = localStorage.getItem(HIDE_KEY);
    return v === "1" ? "hide" : v === "2" ? "only" : "all";
  } catch {
    return "all";
  }
}
let banView: BanView = typeof window !== "undefined" ? readBanView() : "all";
function setBanView(v: BanView): void {
  banView = v;
  try {
    localStorage.setItem(HIDE_KEY, v === "hide" ? "1" : v === "only" ? "2" : "0");
  } catch {
    // private mode / blocked storage: the choice lasts for this visit only
  }
  for (const fn of hideListeners) fn(v);
}
function useBanView(): BanView {
  const [v, set] = useState(banView);
  useEffect(() => {
    hideListeners.add(set);
    return () => void hideListeners.delete(set);
  }, []);
  return v;
}
/** The cells the banned filter leaves on screen. */
function byBan<T extends { max: number }>(v: BanView, cells: T[]): T[] {
  return v === "all" ? cells : cells.filter((c) => (c.max === 0) === (v === "only"));
}

const BAN_VIEWS: [BanView, string][] = [
  ["all", "All"],
  ["hide", "Hide banned"],
  ["only", "Only banned"],
];
/** One banned filter for a rules block (heroes, towers and powers together): All · Hide banned · Only banned. */
export function HideBannedToggle() {
  const v = useBanView();
  return (
    <span class="hideban" role="group" aria-label="Banned">
      {BAN_VIEWS.map(([k, t]) => (
        <button key={k} type="button" class={v === k ? "on" : undefined} aria-pressed={v === k} onClick={() => setBanView(k)}>
          {t}
        </button>
      ))}
    </span>
  );
}

/** True when a rules block has anything the toggle would hide (a banned tower, roster hero or power). */
export function hasBans(towers: TowerRestriction[] | null | undefined, powers: PowerRestriction[] | null | undefined, heroRoster = false): boolean {
  const t = towers ?? [];
  const listed = new Set(t.filter((x) => !x.isHero && x.max !== 0).map((x) => x.tower as string));
  if (t.length && TOWER_ORDER.some((id) => !listed.has(id))) return true;
  const heroes = t.filter((x) => x.isHero && x.tower !== "ChosenPrimaryHero");
  const chosen = t.find((x) => x.tower === "ChosenPrimaryHero");
  const heroAllowed = heroRoster ? HERO_ORDER.filter((id) => heroes.some((h) => h.tower === id && h.max !== 0)).length : heroes.filter((h) => h.max !== 0).length;
  const heroTotal = heroRoster ? HERO_ORDER.length : heroes.length;
  if (!(chosen && chosen.max !== 0) && heroAllowed > 1 && heroAllowed < heroTotal) return true;
  return (powers ?? []).some((x) => x.max === 0);
}

/** Tower roster for a ruleset: every tower in game order; absent from the list = not available. */
export function TowerRoster(p: { towers: TowerRestriction[]; label?: string }) {
  const ban = useBanView();
  const by = new Map(p.towers.filter((t) => !t.isHero).map((t) => [t.tower as string, t]));
  const cells: Cell[] = inOrder(TOWER_ORDER, by.keys()).map((id) => {
    const t = by.get(id);
    return t ? { id, max: t.max, caps: tierCaps(t) } : { id, max: 0 };
  });
  const allowed = cells.filter((c) => c.max !== 0);
  const banned = cells.length - allowed.length;
  const limit = allowed.some((c) => c.max > 0 && c.max < 99);
  const capped = allowed.filter((c) => capStr(c.caps!.c) !== FREE);
  const sum = banned ? `${allowed.length} of ${cells.length} allowed` : "All allowed";
  return (
    <div class="rgroup">
      <p class="rhead">
        <span class="label">{p.label ?? "Towers"}</span>
        <span class="rhead-v quiet">
          {banned === 0 && !limit && !capped.length ? "Every tower, no limits" : sum}{banned > 0 && " · greyed out = banned"}
        </span>
      </p>
      <Roster family="tower" cells={byBan(ban, cells)} label={p.label ?? "Towers"} />
    </div>
  );
}

/** The game's any-hero / no-hero icon, or our silhouette if the art isn't there. */
const HeroRuleIcon = (p: { k: "AnyHero" | "NoHero" }) =>
  hasArt("hero", p.k) ? (
    <Spr family="hero" k={p.k} size={48} name={p.k === "AnyHero" ? "Any hero" : "No heroes"} label />
  ) : (
    <AnyHero size={48} banned={p.k === "NoHero"} label />
  );

/** The hero rule: your selected hero / a forced hero / a restricted roster / no heroes. */
export function HeroRule(p: { towers: TowerRestriction[]; roster?: boolean }) {
  const ban = useBanView();
  const listed = p.towers.filter((t) => t.isHero && t.tower !== "ChosenPrimaryHero");
  // `roster`: the list only names what's available (odyssey); every other hero is unavailable.
  const heroes = p.roster
    ? inOrder(HERO_ORDER, listed.map((t) => t.tower)).map((id) => listed.find((t) => t.tower === id) ?? ({ tower: id, max: 0 } as TowerRestriction))
    : listed;
  const chosen = p.towers.find((t) => t.tower === "ChosenPrimaryHero");
  const allowed = heroes.filter((t) => t.max !== 0);
  let body: ComponentChildren;
  let roster = false;
  if (chosen && chosen.max !== 0) {
    // NK lists every individual hero as 0 whenever "your selected hero" is on; that isn't a ban.
    body = (
      <span class="hero-one">
        <HeroRuleIcon k="AnyHero" />
        <span>Any hero</span>
      </span>
    );
  } else if (allowed.length === 0) {
    body = (
      <span class="hero-one">
        <HeroRuleIcon k="NoHero" />
        <span>No heroes</span>
      </span>
    );
  } else if (allowed.length === 1) {
    body = (
      <span class="hero-one">
        <Spr family="hero" k={allowed[0].tower} size={48} label />
        <span>
          {unitName(allowed[0].tower)} <span class="quiet">only</span>
        </span>
      </span>
    );
  } else if (allowed.length === heroes.length) {
    body = (
      <span class="hero-one">
        <HeroRuleIcon k="AnyHero" />
        <span>Any hero</span>
      </span>
    );
  } else {
    const by = new Map(heroes.map((t) => [t.tower as string, t]));
    roster = true;
    body = (
      <Roster
        family="hero"
        label="Heroes"
        cells={byBan(
          ban,
          inOrder(HERO_ORDER, by.keys()).map((id) => ({ id, max: by.get(id)?.max ?? 0 })),
        )}
      />
    );
  }
  return (
    <div class="rgroup">
      <p class="rhead">
        <span class="label">{roster ? "Heroes" : "Hero"}</span>
      </p>
      {body}
    </div>
  );
}

/**
 * Powers the in-game way: every power on its power tile, in the game's order; a blue circle with the count
 * when limited, nothing when unlimited, greyed in place when banned. An empty list = no restrictions.
 */
export function PowerGrid(p: { powers: PowerRestriction[]; all?: boolean; label?: string }) {
  const label = p.label ?? "Powers";
  const ban = useBanView();
  const allowed = p.powers.filter((x) => x.max !== 0);
  return (
    <div class="rgroup">
      <p class="rhead">
        <span class="label">{label}</span>
        <span class="rhead-v quiet">
          {!p.powers.length ? "No restrictions" : allowed.length === p.powers.length ? "All allowed" : `${allowed.length} of ${p.powers.length} allowed · greyed out = banned`}
        </span>
      </p>
      {p.powers.length > 0 && <Roster family="power" label={label} small cells={byBan(ban, p.powers).map((x) => ({ id: x.power, max: x.max }))} />}
    </div>
  );
}

/** Crew / inventory: portraits with ×N (odyssey starting crew and powers). */
export function Crew(p: { family: "tower" | "power"; items: { id: string; n: number }[]; label: string; hero?: (id: string) => boolean }) {
  const rv = useRoving(p.items.length);
  return (
    <ul class="roster ttiles small" aria-label={p.label} onKeyDown={rv.onKeyDown}>
      {p.items.map((x, i) => (
        <Tile
          key={x.id}
          {...rv.tile(i)}
          family={p.family === "power" ? "power" : HERO_ORDER.includes(x.id) || p.hero?.(x.id) ? "hero" : "tower"}
          cell={{ id: x.id, max: x.n }}
        />
      ))}
    </ul>
  );
}

// ─────────────────────────────── facts & modifiers

/** A multiplier as the game's challenge editor shows it: 0.9 → "90%". */
const x = (n: number) => `${+(n * 100).toFixed(1)}%`;

/** A spec row with a rules-panel icon (the icon is decoration: the label is visible). */
const IFact = (p: { icon?: string; fam?: string; k: string; v: ComponentChildren }) => (
  <Fact
    k={
      <span class="ifact">
        {p.icon ? <Spr family={p.fam ?? "ui"} k={p.icon} size={24} label optional /> : hasArt("ui", "StartRound") && <span class="spr-gap24" />}
        {p.k}
      </span>
    }
    v={p.v}
  />
);

const BOSS_TYPES = ["bloonarius", "lych", "vortex", "dreadbloon", "phayze", "blastapopoulos", "diamondback"];

/** Round-set icon: the boss portrait for a boss's rounds, else the game's mode icon (ABR, Fast Track…). */
function roundSetIcon(r: string): [string, string] {
  const id = r.toLowerCase();
  const boss = BOSS_TYPES.find((b) => id.includes(b));
  if (boss) return ["boss", boss];
  if (/alternate|abr/.test(id)) return ["ui", "mode:AlternateBloonsRounds"];
  if (/accelerat|fast/.test(id)) return ["ui", "mode:FastTrack"];
  return ["ui", "CustomRounds"];
}
function roundSetName(r: string): string {
  const id = r.toLowerCase();
  const boss = BOSS_TYPES.find((b) => id.includes(b));
  if (boss) return `${cap(boss)} rounds`;
  if (/alternate|abr/.test(id)) return "Alternate Bloons Rounds";
  if (/accelerat|fast/.test(id)) return "Fast Track";
  return cap(human(r.replace(/RoundSet$/i, "")));
}

/** The page the rules are on (the round visualizer's back link). */
const herePath = () => (typeof location !== "undefined" ? location.pathname + location.search : undefined);

/** "Vortex rounds · See rounds ›": the round set, linking to the round visualizer with the event applied. */
function RoundsLink(p: { href: string; name: string }) {
  return (
    <A href={p.href} class="rs-link" label={`${p.name}: see rounds`}>
      <span class="rs-name">{p.name}</span>
      <span class="rs-go">
        See rounds <span aria-hidden="true">›</span>
      </span>
    </A>
  );
}

/** "Paragon calculator →" under the paragon limit, with the event's difficulty when it is one the calculator knows. */
function ParagonLink(p: { d: ChallengeDocument }) {
  const diff = p.d.mode === "Impoppable" ? "impoppable" : ({ Easy: "easy", Medium: "medium", Hard: "hard" } as const)[p.d.difficulty as "Easy"];
  return (
    <A href={diff ? href.paragon({ diff }, true) : href.paragon()} class="pg-rlink">
      Paragon calculator <span aria-hidden="true">→</span>
    </A>
  );
}

/** The "Round set" row(s): linked when the set is known, "Random rounds" for random-round modes, else as named. */
function roundSetRows(d: ChallengeDocument, rs: RulesRounds, keyed = false): ComponentChildren[] {
  const sets = d.roundSets?.filter((r) => r !== "default") ?? [];
  // (compact odyssey blocks list only what differs from the mode: random rounds are the mode itself)
  if (rs.kind === "random") return keyed ? [] : [<IFact key="rs" icon={`mode:${d.mode}`} k="Round set" v="Random rounds" />];
  if (rs.kind === "link") {
    if (keyed && !sets.length) return [];
    const shown = rs.fastTrack ? sets.find((v) => /fast/i.test(v))! : rs.info.id;
    const [fam, icon] = sets.length || rs.info.id !== "default" ? roundSetIcon(shown) : ["ui", `mode:${d.difficulty}`];
    // a known set: its own name (event sets such as "chimpsbloonarius" would read as a boss from the API value)
    const name = rs.fastTrack ? roundSetName(shown) : setLabel(rs.info);
    return [<IFact key="rs" icon={icon} fam={fam} k="Round set" v={<RoundsLink href={rs.href} name={name} />} />];
  }
  if (sets.length)
    return sets.map((r) => {
      const [fam, icon] = roundSetIcon(r);
      return <IFact key={`s${r}`} icon={icon} fam={fam} k="Round set" v={roundSetName(r)} />;
    });
  return keyed ? [] : [<IFact key="rs" icon={`mode:${d.difficulty}`} k="Round set" v="Default" />];
}

/** The game's mode icon for a ruleset ("Standard" is drawn per difficulty in game). */
export const modeIcon = (d: Pick<ChallengeDocument, "mode" | "difficulty">) =>
  d.mode === "Standard" ? `mode:${d.difficulty}` : `mode:${d.mode}`;

/** NK's defaults: no tower cap (9999), paragon limit 10, lives cap 5,000. */
const NO_TOWER_CAP = 9999;
const DEFAULT_PARAGONS = 10;
const DEFAULT_MAX_LIVES = 5000;

/**
 * The whole rule table, same shape on every event: the fixed rows always appear, in the same order
 * ("Unlimited" / "Default" when unrestricted), then the event-specific caps and every modifier as a row of
 * the same size. Odyssey islands report 0 lives/towers because the boat governs them.
 */
export function RuleFacts(p: { d: ChallengeDocument; compact?: boolean }) {
  const d = p.d;
  if (p.compact) return <CompactFacts d={d} />;
  const boat = d.lives === 0 && d.maxLives === 0;
  const lives = boat
    ? "Boat health"
    : d.maxLives && d.maxLives !== DEFAULT_MAX_LIVES && d.maxLives > d.lives
      ? `${fmtInt(d.lives)} (max ${fmtInt(d.maxLives)})`
      : fmtInt(d.lives);
  const towers = d.maxTowers >= NO_TOWER_CAP ? "Unlimited" : d.maxTowers === 0 ? (boat ? "Boat crew" : "None") : fmtInt(d.maxTowers);
  const paragons = d.maxParagons >= DEFAULT_PARAGONS ? "Unlimited" : d.maxParagons === 0 ? "None" : fmtInt(d.maxParagons);
  const rs = roundsFor(d, herePath());
  return (
    <dl class="spec rules-spec">
      <IFact icon="StartRound" k="Rounds" v={fmtRounds(d.startRound, d.endRound)} />
      <IFact icon="StartingCash" k="Starting cash" v={`$${fmtInt(d.startingCash)}`} />
      <IFact icon="StartingLives" k="Lives" v={lives} />
      <IFact icon="MaxTowers" k="Max towers" v={towers} />
      <IFact icon="ParagonLimit" k="Max paragons" v={<>{paragons}{d.maxParagons > 0 && <ParagonLink d={d} />}</>} />
      {roundSetRows(d, rs)}
      {d.leastCashUsed >= 0 && <IFact icon="LeastCashRule" k="Cash cap" v={`$${fmtInt(d.leastCashUsed)}`} />}
      {d.leastTiersUsed >= 0 && <IFact icon="LeastTiersRule" k="Tier cap" v={fmtInt(d.leastTiersUsed)} />}
      {d.removeableCostMultiplier !== 1 && (
        <IFact icon={d.removeableCostMultiplier > 1 ? "RemovableCostIncrease" : "RemovableCostDecrease"} k="Obstacle removal" v={x(d.removeableCostMultiplier)} />
      )}
      <ModifierRows d={d} />
    </dl>
  );
}

/**
 * A normal game's numbers for a mode and difficulty (the game's own defaults): rounds, starting cash, lives.
 * Used to leave out rows that say nothing on odyssey islands.
 */
export function gameDefaults(mode: string, difficulty: string): { start: number; end: number; cash: number; lives: number } {
  const lives = difficulty === "Easy" ? 200 : difficulty === "Medium" ? 150 : 100;
  if (mode === "Impoppable" || mode === "Clicks") return { start: 6, end: 100, cash: 650, lives: 1 };
  if (mode === "Deflation") return { start: 31, end: 60, cash: 20000, lives };
  const [start, end] = difficulty === "Easy" ? [1, 40] : difficulty === "Medium" ? [1, 60] : [3, 80];
  return { start, end, cash: 650, lives };
}

/**
 * Odyssey islands: only what differs from a normal game of that mode and difficulty (the event-wide roster and
 * boat live elsewhere on the page). "No rule changes" when nothing does.
 */
function CompactFacts(p: { d: ChallengeDocument }) {
  const d = p.d;
  const def = gameDefaults(d.mode, d.difficulty);
  const boat = d.lives === 0 && d.maxLives === 0;
  const rs = roundsFor(d, herePath());
  // The link sits on the "Round set" row when there is one, else on the "Rounds" row (random rounds: no link).
  const setRows = roundSetRows(d, rs, true);
  const rows: ComponentChildren[] = [];
  if (d.startRound !== def.start || d.endRound !== def.end) {
    const range = fmtRounds(d.startRound, d.endRound);
    rows.push(<IFact key="r" icon="StartRound" k="Rounds" v={rs.kind === "link" && !setRows.length ? <RoundsLink href={rs.href} name={range} /> : range} />);
  }
  if (d.startingCash !== def.cash) rows.push(<IFact key="c" icon="StartingCash" k="Starting cash" v={`$${fmtInt(d.startingCash)}`} />);
  const maxLives = d.maxLives && d.maxLives !== DEFAULT_MAX_LIVES && d.maxLives > d.lives;
  if (!boat && (d.lives !== def.lives || maxLives))
    rows.push(<IFact key="l" icon="StartingLives" k="Lives" v={maxLives ? `${fmtInt(d.lives)} (max ${fmtInt(d.maxLives)})` : fmtInt(d.lives)} />);
  if (d.maxTowers > 0 && d.maxTowers < NO_TOWER_CAP) rows.push(<IFact key="t" icon="MaxTowers" k="Max towers" v={fmtInt(d.maxTowers)} />);
  if (!boat && d.maxParagons < DEFAULT_PARAGONS)
    rows.push(<IFact key="p" icon="ParagonLimit" k="Max paragons" v={d.maxParagons === 0 ? "None" : fmtInt(d.maxParagons)} />);
  rows.push(...setRows);
  if (d.leastCashUsed >= 0) rows.push(<IFact key="cc" icon="LeastCashRule" k="Cash cap" v={`$${fmtInt(d.leastCashUsed)}`} />);
  if (d.leastTiersUsed >= 0) rows.push(<IFact key="tc" icon="LeastTiersRule" k="Tier cap" v={fmtInt(d.leastTiersUsed)} />);
  if (d.removeableCostMultiplier !== 1)
    rows.push(
      <IFact key="o" icon={d.removeableCostMultiplier > 1 ? "RemovableCostIncrease" : "RemovableCostDecrease"} k="Obstacle removal" v={x(d.removeableCostMultiplier)} />,
    );
  const mods = modifierRows(d);
  if (!rows.length && !mods.length) return <p class="quiet std-rules">No rule changes</p>;
  return (
    <dl class="spec rules-spec">
      {rows}
      {mods.map((r) => (
        <IFact key={r.icon} icon={r.icon} fam={r.fam} k={r.k} v={r.v} />
      ))}
    </dl>
  );
}

/** Everything that differs from a normal game, as rows of the rule table: icon + what + exact value. */
function ModifierRows(p: { d: ChallengeDocument }) {
  return (
    <>
      {modifierRows(p.d).map((r) => (
        <IFact key={r.icon} icon={r.icon} fam={r.fam} k={r.k} v={r.v} />
      ))}
    </>
  );
}

function modifierRows(d: ChallengeDocument): { fam: string; icon: string; k: string; v: ComponentChildren }[] {
  const m = d._bloonModifiers;
  const rows: { fam: string; icon: string; k: string; v: ComponentChildren }[] = [];
  const mult = (v: number, up: string, down: string, k: string) => {
    if (v !== 1) rows.push({ fam: "ui", icon: v > 1 ? up : down, k, v: <b class={v > 1 ? "up" : "down"}>{x(v)}</b> });
  };
  if (m.allCamo) rows.push({ fam: "ui", icon: "AllCamo", k: "Camo", v: "Every bloon" });
  if (m.allRegen) rows.push({ fam: "ui", icon: "AllRegen", k: "Regrow", v: "Every bloon" });
  if (m.allFortified) rows.push({ fam: "bloon", icon: "fortified", k: "Fortified", v: "Every bloon" });
  mult(m.speedMultiplier, "FasterBloons", "SlowerBloons", "Bloon speed");
  mult(m.moabSpeedMultiplier, "FasterMoab", "SlowerMoab", "MOAB speed");
  mult(m.bossSpeedMultiplier, "FasterBoss", "SlowerBoss", "Boss speed");
  mult(m.healthMultipliers.bloons, "BloonBoost", "BloonDecreaseHP", "Bloon health");
  mult(m.healthMultipliers.moabs, "MoabBoost", "MoabDecreaseHP", "MOAB health");
  mult(m.healthMultipliers.boss, "BossBoost", "BossDecreaseHP", "Boss health");
  mult(m.regrowRateMultiplier, "RegrowRateIncrease", "RegrowRateDecrease", "Regrow rate");
  mult(d.abilityCooldownReductionMultiplier, "AbilityCooldownIncrease", "AbilityCooldownDecrease", "Ability cooldown");
  if (d.disableMK) rows.push({ fam: "ui", icon: "NoKnowledge", k: "Monkey Knowledge", v: "Disabled" });
  if (d.disablePowers) rows.push({ fam: "ui", icon: "PowersDisabled", k: "Powers", v: "Disabled" });
  if (d.disableSelling) rows.push({ fam: "ui", icon: "SellingDisabled", k: "Selling", v: "Disabled" });
  if (d.noContinues) rows.push({ fam: "ui", icon: "NoContinues", k: "Continues", v: "Disabled" });
  if (d.disableDoubleCash) rows.push({ fam: "ui", icon: "NoDoubleCash", k: "Double Cash", v: "Disabled" });
  if (d.disableInstas) rows.push({ fam: "ui", icon: "NoInstaMonkeys", k: "Insta Monkeys", v: "Disabled" });
  return rows;
}

/**
 * Map · difficulty · mode. `brief` (event lists): only what's unusual — Medium difficulty and Standard mode,
 * which nearly every event uses, are left out, so "Hard" or "Reverse" stand out.
 */
export function MapLine(props: { doc: ChallengeDocument; brief?: boolean }) {
  const d = props.doc;
  const showDiff = !props.brief || d.difficulty !== "Medium";
  const showMode = !props.brief || d.mode !== "Standard";
  return (
    <span class="mapline">
      <strong>{mapName(d.map)}</strong>
      {showDiff && <span>{d.difficulty}</span>}
      {showMode && (
        <span class="mode">
          <Spr family="ui" k={modeIcon(d)} size={24} label optional />
          {MODE_NAME[d.mode] ?? human(d.mode)}
        </span>
      )}
    </span>
  );
}

/**
 * The whole ruleset. `compact`: numbers and modifiers only (odyssey islands, whose roster is event-wide).
 * `noPowers`: no power grid (boss events and races, where it never says anything).
 */
export function Ruleset(props: { doc: ChallengeDocument; compact?: boolean; noPowers?: boolean }) {
  const d = props.doc;
  const powers = !d.disablePowers && !props.noPowers;
  return (
    <div class="ruleset">
      <RuleFacts d={d} compact={props.compact} />
      {!props.compact && hasBans(d._towers, powers ? d._powers : []) && (
        <p class="hideban-row">
          <HideBannedToggle />
        </p>
      )}
      {!props.compact && d._towers && (
        <>
          <HeroRule towers={d._towers} />
          <TowerRoster towers={d._towers} />
        </>
      )}
      {!props.compact && powers && <PowerGrid powers={d._powers} />}
    </div>
  );
}
