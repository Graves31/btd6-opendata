// Game art (© Ninja Kiwi) from the sprite sheets in ./art. Every sprite is a fixed-size box: the sheet cell when
// the sheet is decoded, else a short text chip in the same box — never blank, never a layout shift, never a
// wait. Sheets are warmed on link intent (nav.ts) and on idle (main.tsx), never awaited by navigation.

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { ART, MAPS, type SpriteSheet } from "./art/index.ts";
import { cap, human, unitName } from "./format.ts";
import { MEDAL_NAME } from "./medals.ts";

type AnyFamily = keyof typeof ART | (string & {});
const sheetOf = (family: AnyFamily): SpriteSheet | null | undefined => (ART as Record<string, SpriteSheet | null>)[family];

/** True when the registry has art for this key (whether or not the sheet has loaded yet). */
export const hasArt = (family: AnyFamily, k: string) => sheetOf(family)?.keys[k] !== undefined;

// ─────────────────────────────── names (tooltips, accessible names) and short chip tags

export { MEDAL_NAME };
const MEDAL_TAG: Record<string, string> = {
  BlackDiamond: "Black Dia.",
  RedDiamond: "Red Dia.",
  BlueDiamond: "Blue Dia.",
  GoldDiamond: "Gold Dia.",
  DoubleGold: "2× Gold",
  GoldSilver: "Gold Silv.",
  DoubleSilver: "2× Silv.",
};

/** In-game names of the single-player modes (keys of UserProfile._medalsSinglePlayer). */
export const MODE_NAME: Record<string, string> = {
  Easy: "Easy",
  PrimaryOnly: "Primary Only",
  Deflation: "Deflation",
  Medium: "Medium",
  MilitaryOnly: "Military Only",
  Apopalypse: "Apopalypse",
  Reverse: "Reverse",
  Hard: "Hard",
  MagicOnly: "Magic Monkeys Only",
  DoubleMoabHealth: "Double HP MOABs",
  HalfCash: "Half Cash",
  AlternateBloonsRounds: "Alternate Bloons Rounds",
  Impoppable: "Impoppable",
  Clicks: "CHIMPS",
  "CHIMPS-BLACK": "Black CHIMPS",
  FastTrack: "Fast Track",
};


const UI_NAME: Record<string, string> = {
  GameTime: "Fastest Time",
  MaxTowers: "Max towers",
  AnyHero: "Any hero",
  NoHero: "No heroes",
  CustomRounds: "Custom rounds",
  BossTier: "Boss tier",
  AllCamo: "All camo",
  AllRegen: "All regrow",
  NoKnowledge: "No Monkey Knowledge",
  PowersDisabled: "Powers disabled",
  SellingDisabled: "Selling disabled",
  NoDoubleCash: "No Double Cash",
  NoInstaMonkeys: "No Insta Monkeys",
  StartingLives: "Lives",
  CtTickets: "CT tickets",
  ContestedTerritory: "Contested Territory",
};
const UI_TAG: Record<string, string> = {
  LeastCash: "$",
  LeastTiers: "Tiers",
  GameTime: "Time",
  BossTier: "Tier",
  MonkeyMoney: "MM",
  CtTickets: "CT",
  Odyssey: "ODY",
};

export const BLOON_NAME: Record<string, string> = {
  moab: "MOAB",
  bfb: "BFB",
  zomg: "ZOMG",
  ddt: "DDT",
  bad: "BAD",
  camo: "Camo",
  regrow: "Regrow",
  fortified: "Fortified",
  necro: "Necro bloon",
  boss: "Boss",
};

/** In-game name of a key, for tooltips and accessible names. */
export function artName(family: AnyFamily, k: string): string {
  switch (family) {
    case "tower":
    case "hero":
      return unitName(k);
    case "eventMedal":
      return MEDAL_NAME[k] ?? human(k);
    case "modeMedal":
      return k.startsWith("coop:") ? `Co-op ${MODE_NAME[k.slice(5)] ?? human(k.slice(5))}` : (MODE_NAME[k] ?? human(k));
    case "ui":
      if (k.startsWith("mode:")) return MODE_NAME[k.slice(5)] ?? human(k.slice(5));
      return UI_NAME[k] ?? human(k);
    case "bloon":
      return BLOON_NAME[k] ?? cap(k);
    case "boss":
      return cap(k);
    default:
      return human(k);
  }
}

/** Short text for the fallback chip. */
function tag(family: AnyFamily, k: string, name: string): string {
  const key = family === "modeMedal" ? k.replace(/^coop:/, "") : k;
  const t =
    (family === "eventMedal" && MEDAL_TAG[key]) ||
    (family === "ui" && UI_TAG[key]);
  if (t) return t;
  if (family === "hero" || family === "tower") return name.replace(/ Monkey$/, "").slice(0, 4).toUpperCase();
  if (name.length <= 7) return name;
  const words = name.split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 4).toUpperCase() : name.slice(0, 4);
}

// ─────────────────────────────── sheet loading

const decoded = new Set<string>();
const loading = new Map<string, Promise<boolean>>();

function load(url: string): Promise<boolean> {
  let p = loading.get(url);
  if (!p) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    p = img.decode().then(
      () => (decoded.add(url), true),
      () => (loading.delete(url), false), // offline / broken: keep chips, retry on the next warm
    );
    loading.set(url, p);
  }
  return p;
}

/** Sheets each page shows (warmed on link intent). */
const PAGE_FAMILIES: Record<string, AnyFamily[]> = {
  home: ["ui", "boss", "eventMedal"],
  events: ["ui", "boss"],
  boss: ["ui", "container", "tower", "hero", "power", "boss"],
  bossstats: ["ui", "boss"],
  race: ["ui", "container", "tower", "hero", "power"],
  challenge: ["ui", "container", "tower", "hero", "power", "bloon"],
  odyssey: ["ui", "container", "tower", "hero", "power", "bloon"],
  player: ["eventMedal", "modeMedal", "bossBadge", "bloon", "tower", "hero"],
  ct: ["ui", "relic"],
  notfound: ["bloon"],
  challenges: ["bloon"],
  rounds: ["bloon", "bloonVariant", "boss", "ui"],
};
/** Sheets only their own pages load (never warmed on idle elsewhere). */
const PAGE_ONLY = new Set<AnyFamily>(["bloonVariant"]);

/** Start decoding the sheets a page will use. Fire and forget. */
export function warmFor(page: string): void {
  for (const f of PAGE_FAMILIES[page] ?? []) {
    const s = sheetOf(f);
    if (s) void load(s.url);
  }
}

const saveData = typeof navigator !== "undefined" && (navigator as any).connection?.saveData === true;

/** Every sheet, one at a time, when the browser is idle (skipped with Save-Data). */
export function warmAllOnIdle(): void {
  if (saveData) return;
  const urls = Object.entries(ART as Record<string, SpriteSheet | null>)
    .filter(([f, s]) => !!s && !PAGE_ONLY.has(f))
    .map(([, s]) => s!.url);
  const idle: (fn: () => void) => void = (globalThis as any).requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  const next = () => {
    const u = urls.shift();
    if (u) idle(() => void load(u).then(next));
  };
  next();
}

// ─────────────────────────────── <Spr>

export interface SprProps {
  family: AnyFamily;
  k: string;
  /** Box size in px (min 24; 20 only for leaderboard header icons). The size is a fallback (--s0): CSS overrides it through --s. */
  size: number;
  /** Accessible name / tooltip; defaults to the in-game name. */
  name?: string;
  /** The name is already visible as text next to the sprite: hide it from assistive tech. */
  label?: boolean;
  /** ×N plate (drawn at ≥ 40 px; smaller sizes put it in the tooltip and fallback chip). */
  count?: number;
  banned?: boolean;
  /** Paired with visible text: render nothing when the registry has no art for the key. */
  optional?: boolean;
  class?: string;
}

export function Spr(p: SprProps) {
  const sheet = sheetOf(p.family);
  const idx = sheet?.keys[p.k];
  const url = idx !== undefined ? sheet!.url : undefined;
  const [, bump] = useState(0);
  const ready = !!url && decoded.has(url);
  useEffect(() => {
    // Decoded between this render and its effect (e.g. rows mounted a frame after the sheet started loading):
    // re-render now, or the text chip would stay until something else re-renders this sprite.
    if (url && decoded.has(url) && !ready) bump((x) => x + 1);
    if (url && !decoded.has(url)) {
      let live = true;
      void load(url).then((ok) => ok && live && bump((x) => x + 1));
      return () => {
        live = false;
      };
    }
  }, [url]);
  if (p.optional && idx === undefined) return null;

  const name = p.name ?? artName(p.family, p.k);
  const n = p.count !== undefined && p.count >= 0 ? `×${p.count}` : "";
  const a11y = `${name}${n ? ` ${n}` : ""}${p.banned ? ", banned" : ""}`;
  const plate = n && p.size >= 40;
  const cls = `spr${p.banned ? " ban" : ""}${ready ? "" : url ? " spr-chip spr-wait" : " spr-chip"}${p.class ? ` ${p.class}` : ""}`;
  let inner: ComponentChildren;
  if (ready) {
    const col = idx! % sheet!.cols;
    const row = Math.floor(idx! / sheet!.cols);
    const pos = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
    inner = (
      <span
        class="spr-i"
        style={{
          backgroundImage: `url(${url})`,
          backgroundSize: `${sheet!.cols * 100}% ${sheet!.rows * 100}%`,
          backgroundPosition: `${pos(col, sheet!.cols)}% ${pos(row, sheet!.rows)}%`,
        }}
      />
    );
  } else if (p.optional) {
    inner = null; // loading, text beside it says it all
  } else {
    inner = (
      <span class="spr-t">
        {tag(p.family, p.k, name)}
        {n && !plate ? ` ${n}` : ""}
      </span>
    );
  }
  return (
    <span
      class={cls}
      style={{ "--s0": `${p.size}px` }}
      role={p.label ? undefined : "img"}
      aria-label={p.label ? undefined : a11y}
      aria-hidden={p.label ? "true" : undefined}
      title={p.label ? undefined : a11y}
    >
      {inner}
      {plate && <span class="spr-n">{n}</span>}
    </span>
  );
}

/** Our own mark: the "any hero" silhouette, in a sprite-sized box. */
export function AnyHero(p: { size: number; banned?: boolean; label?: boolean }) {
  const name = p.banned ? "No heroes" : "Any hero";
  return (
    <span
      class={`spr any-hero${p.banned ? " ban" : ""}`}
      style={{ "--s0": `${p.size}px` }}
      role={p.label ? undefined : "img"}
      aria-label={p.label ? undefined : name}
      aria-hidden={p.label ? "true" : undefined}
      title={p.label ? undefined : name}
    >
      <svg class="spr-i" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="17" r="9" />
        <path d="M8 44c0-10 7-16 16-16s16 6 16 16z" />
        <text x="37" y="15" class="any-q">?</text>
      </svg>
    </span>
  );
}

// ─────────────────────────────── maps: never cropped

/** Custom (player-made) maps are 597:400 JPEG previews; built-in map art is square. */
export const isCustomMap = (map: string | undefined, url: string | null | undefined) =>
  map === "CustomMap" || /\.jpe?g($|\?)/i.test(url ?? "") || /\/maps\/map\/[^/]+\/preview/.test(url ?? "");

export function MapArt(p: { map?: string; url?: string | null; custom?: boolean; size: number; eager?: boolean; alt?: string; class?: string; framed?: boolean }) {
  const [broken, setBroken] = useState(false);
  const own = p.map ? MAPS[p.map] : undefined;
  const custom = p.custom ?? isCustomMap(p.map, p.url);
  const cls = `map-art${custom ? " custom" : ""}${p.class ? ` ${p.class}` : ""}`;
  const [w, h] = custom ? [p.size, Math.round((p.size * 400) / 597)] : [p.size, p.size];
  // `framed`: the one map-preview look (mat + hairline), inset, native aspect (.mf in styles.css).
  const frame = (el: JSX.Element) => (p.framed ? <span class={`mf${custom ? " custom" : ""}`}>{el}</span> : el);
  if ((!own && !p.url) || broken) {
    const miss = <span class={`${cls} img-missing`} style={p.framed ? { width: `${w}px`, height: `${h}px` } : undefined} aria-hidden="true" />;
    return frame(miss);
  }
  let src = p.url ?? "";
  let srcset: string | undefined;
  if (own && !custom) {
    const [a, b] = p.size <= 96 ? [own.s96, own.s200] : p.size <= 200 ? [own.s200, own.s400] : [own.s400, own.s400];
    src = a;
    srcset = a === b ? undefined : `${a} 1x, ${b} 2x`;
  }
  return frame(
    <img
      class={cls}
      src={src}
      srcset={srcset}
      width={w}
      height={h}
      alt={p.alt ?? ""}
      loading={p.eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setBroken(true)}
    />,
  );
}

/** The map picture a page will show (warmed when its data arrives, see nav.ts). */
export const mapSrc = (map: string | undefined, url: string | null | undefined, size = 200) => {
  const own = map ? MAPS[map] : undefined;
  return own && !isCustomMap(map, url) ? (size <= 96 ? own.s96 : size <= 200 ? own.s200 : own.s400) : url;
};
