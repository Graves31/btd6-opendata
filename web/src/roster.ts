// Tower / hero order and the hero part of a ruleset (pure data logic; rules.tsx re-exports it).
import type { TowerRestriction } from "../../src/nk/types.ts";

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

/** The hero part of a ruleset: the listed heroes, whether "your selected hero" is on, and the allowed ones in game order. */
export function heroRule(towers: TowerRestriction[]): { listed: TowerRestriction[]; selected: boolean; allowed: string[] } {
  const listed = towers.filter((t) => t.isHero && t.tower !== "ChosenPrimaryHero");
  const chosen = towers.find((t) => t.tower === "ChosenPrimaryHero");
  const allowed = inOrder(HERO_ORDER, listed.map((t) => t.tower)).filter((id) => listed.some((t) => t.tower === id && t.max !== 0));
  return { listed, selected: !!chosen && chosen.max !== 0, allowed };
}
