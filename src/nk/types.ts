// TypeScript mirror of docs/api/openapi.yaml — Ninja Kiwi Open Data, BTD6 endpoints.
// Captured and verified against live responses on 2026-09-24 (docs/api/fixtures).
// Open-ended string sets use `Known | (string & {})` so new towers/bosses/modes don't break the build.

type Open<T extends string> = T | (string & {});

/** Unix epoch milliseconds. */
export type EpochMs = number;
/** Absolute URL on https://data.ninjakiwi.com/btd6/… */
export type NKUrl = string;
/** Immutable, content-addressed asset URL (static-api.nkstatic.com), or a custom map's /preview URL. */
export type AssetUrl = string;
/** Dynamic key → integer (tower/hero/ability/medal names). Keys grow as NK adds content. */
export type IntMap = Record<string, number>;

// ─────────────────────────────── envelopes

export interface ModelDoc {
  name: string;
  parameters: Record<string, { description?: string; type?: string; default?: unknown }>;
}

export interface SuccessEnvelope<T> {
  success: true;
  error: null;
  body: T;
  /** Absolute URL of the next page, or null. */
  next: string | null;
  prev: string | null;
  /** Only on leaderboards. */
  maxPages?: number;
  /** NK's self-describing schema; constant per endpoint. Stripped by our proxy. */
  model?: ModelDoc;
}

/** Errors come back as HTTP 200. Always branch on `success`. */
export interface ErrorEnvelope {
  success: false;
  error: NKErrorMessage;
}

export type NKErrorMessage = Open<
  | "No Boss with that ID exists"
  | "No Race with that ID exists"
  | "Invalid boss difficulty"
  | "Invalid team size"
  | "No Scores Available"
  | "Invalid user ID / Player Does not play this game"
  | "No challenge with that ID exists"
  | "Invalid map ID"
  | "Invalid filter type"
  | "This endpoint requires an OAK id. An invalid oak ID was given or the player does not play this game"
>;

export type NKResponse<T> = SuccessEnvelope<T> | ErrorEnvelope;

// ─────────────────────────────── shared enums

export type BossType = Open<"bloonarius" | "lych" | "vortex" | "dreadbloon" | "phayze" | "blastapopoulos" | "diamondback">;
export type ScoringType = Open<"LeastCash" | "GameTime" | "LeastTiers">;
export type BossDifficulty = "standard" | "elite";
export type BossTeamSize = 1 | 2 | 3 | 4;
export type OdysseyDifficulty = "easy" | "medium" | "hard";
export type ChallengeFilterType = "newest" | "trending" | "daily";
export type MapFilterType = "newest" | "trending" | "mostLiked";
export type EventType = Open<
  "bossBloon" | "bossRush" | "collectableEvent" | "ct" | "odysseyEvent" | "raceEvent" | "socialseason"
>;
export type GameMode = Open<"Standard" | "Reverse" | "Impoppable" | "DoubleMoabHealth" | "Apopalypse">;
export type GameDifficulty = Open<"Easy" | "Medium" | "Hard">;

export type TowerId = Open<
  | "DartMonkey" | "BoomerangMonkey" | "BombShooter" | "TackShooter" | "IceMonkey" | "GlueGunner" | "Desperado"
  | "SniperMonkey" | "MonkeySub" | "MonkeyBuccaneer" | "MonkeyAce" | "HeliPilot" | "MortarMonkey" | "DartlingGunner"
  | "WizardMonkey" | "SuperMonkey" | "NinjaMonkey" | "Alchemist" | "Druid" | "Mermonkey" | "Skywarden"
  | "BananaFarm" | "SpikeFactory" | "MonkeyVillage" | "EngineerMonkey" | "BeastHandler"
>;
export type HeroId = Open<
  | "Quincy" | "Gwendolin" | "StrikerJones" | "ObynGreenfoot" | "CaptainChurchill" | "Benjamin" | "Ezili"
  | "PatFusty" | "Adora" | "AdmiralBrickell" | "Etienne" | "Sauda" | "Psi" | "Geraldo" | "Corvus" | "Rosalia"
  | "Silas" | "DanDMonke"
>;
export type PowerId = Open<
  | "BananaFarmer" | "BananaFarmerPro" | "BattleCat" | "CamoTrap" | "CashDrop" | "CaveMonkey" | "DartTime"
  | "EnergisingTotem" | "GlueTrap" | "HealthPotion" | "MoabMine" | "MonkeyBoost" | "MonkeyBoostPro" | "Pontoon"
  | "PortableLake" | "PortableLakePro" | "RoadSpikes" | "SheRa" | "Skeletor" | "StaminaPotion"
  | "SuperMonkeyBeacon" | "SuperMonkeyStorm" | "SwordOfPower" | "TechBot" | "TechBotPrime" | "Thrive"
>;
export type MedalTier = Open<
  "Bronze" | "Silver" | "DoubleSilver" | "GoldSilver" | "DoubleGold" | "GoldDiamond" | "BlueDiamond" | "RedDiamond" | "BlackDiamond"
>;

// ─────────────────────────────── races & bosses

export interface Race {
  id: string;
  name: string;
  start: EpochMs;
  end: EpochMs;
  /** 0 for upcoming races. */
  totalScores: number;
  leaderboard: NKUrl;
  metadata: NKUrl;
}

export interface ScorePart {
  /** `time` values are milliseconds. */
  type: "number" | "time";
  score: number;
  name: Open<"Boss Tier" | "Least Cash" | "Least Tiers" | "Game Time" | "Time after event start">;
}

export interface RaceLeaderboardEntry {
  displayName: string;
  /** Finish time, ms (lower is better). */
  score: number;
  scoreParts: ScorePart[];
  /** Always -1 so far. */
  submissionTime: EpochMs | -1;
  profile: NKUrl;
}

export interface Boss {
  id: string;
  /** e.g. "Vortex47" */
  name: string;
  bossType: BossType;
  bossTypeURL: AssetUrl;
  start: EpochMs;
  end: EpochMs;
  totalScores_standard: number;
  totalScores_elite: number;
  /** @deprecated use normalScoringType / eliteScoringType */
  scoringType: ScoringType;
  normalScoringType: ScoringType;
  eliteScoringType: ScoringType;
  leaderboard_standard_players_1: NKUrl;
  leaderboard_elite_players_1: NKUrl;
  metadataStandard: NKUrl;
  metadataElite: NKUrl;
}

export interface BossLeaderboardEntry {
  displayName: string;
  /** Primary ranking value — NOT always ms (Boss Tier for LeastCash events). Use scoreParts. */
  score: number;
  scoreParts: ScorePart[];
  submissionTime: EpochMs | -1;
  profile: NKUrl;
}

// ─────────────────────────────── challenge document (race/boss metadata, challenges, odyssey islands)

export interface TowerRestriction {
  /** Tower or hero ID; "ChosenPrimaryHero" = the player's selected hero. */
  tower: TowerId | HeroId | "ChosenPrimaryHero";
  /** 0 = banned, -1 = unlimited, N = at most N. */
  max: number;
  /** Inferred: number of top tiers blocked on the path (0 = none). -1 observed; meaning unverified. */
  path1NumBlockedTiers: number;
  path2NumBlockedTiers: number;
  path3NumBlockedTiers: number;
  isHero: boolean;
  /** Player challenges only. */
  restrictParagon?: boolean;
}

export interface PowerRestriction {
  power: PowerId;
  /** 0 = banned, -1 = unlimited. */
  max: number;
}

export interface BloonModifiers {
  speedMultiplier: number;
  moabSpeedMultiplier: number;
  bossSpeedMultiplier: number;
  regrowRateMultiplier: number;
  healthMultipliers: { bloons: number; moabs: number; boss: number };
  allCamo: boolean;
  allRegen: boolean;
  allFortified?: boolean;
}

/**
 * Shared ruleset shape. For NK events (race/boss/odyssey): id "n/a", createdAt 0, gameVersion "0",
 * creator null, every counter 0 — immutable once published.
 */
export interface ChallengeDocument {
  name: string;
  createdAt: EpochMs;
  id: string;
  creator: NKUrl | null;
  gameVersion: string;
  /** Internal map name, e.g. "EndOfTheRoad". */
  map: string;
  mapURL: AssetUrl;
  mode: GameMode;
  difficulty: GameDifficulty;
  disableDoubleCash: boolean;
  disableInstas: boolean;
  disableMK: boolean;
  disablePowers: boolean;
  disableSelling: boolean;
  startingCash: number;
  abilityCooldownReductionMultiplier: number;
  /** -1 = no cap. */
  leastCashUsed: number;
  /** -1 = no cap. */
  leastTiersUsed: number;
  noContinues: boolean;
  seed: number;
  removeableCostMultiplier: number;
  roundSets: Open<"default" | "vortex">[];
  lives: number;
  maxLives: number;
  startRound: number;
  endRound: number;
  /** 9999 = unlimited. */
  maxTowers: number;
  maxParagons: number;
  plays: number;
  wins: number;
  restarts: number;
  losses: number;
  upvotes: number;
  playsUnique: number;
  winsUnique: number;
  lossesUnique: number;
  _powers: PowerRestriction[];
  _bloonModifiers: BloonModifiers;
  /** null on odyssey islands. */
  _towers: TowerRestriction[] | null;
}

// ─────────────────────────────── users & guilds

export interface Badge {
  id: string;
  url: AssetUrl;
  /** Season badges only. */
  count?: number;
}

export interface UserProfile {
  displayName: string;
  rank: number;
  veteranRank: number;
  achievements: number;
  mostExperiencedMonkey: TowerId;
  /** @deprecated use gameplay.highestRound */
  highestRound: number;
  avatar: string;
  avatarURL: AssetUrl;
  banner: string;
  bannerURL: AssetUrl;
  followers: number;
  bloonsPopped: IntMap;
  gameplay: IntMap;
  heroesPlaced: Record<HeroId, number>;
  towersPlaced: Record<TowerId, number>;
  stats: {
    totalTowersSold: number;
    paragonsPurchasedByName: Record<TowerId, number>;
    /** "1".."5" → count; often empty. */
    upgradesPurchasedByTier: IntMap;
    /** Ability display name → count. */
    abilitiesActivatedByName: IntMap;
    /** May include an "" key. */
    heroesPlacedByName: IntMap;
    instaMonkeysUsed: number;
    collectionEventCratesOpened: number;
    ctCapturedTiles: number;
  };
  bossBadgesNormal: Record<Open<"Bloonarius" | "Lych" | "Vortex" | "Dreadbloon" | "Phayze" | "Blastapopoulos" | "Diamondback">, number>;
  bossBadgesElite: Record<string, number>;
  seasonBadges: Record<string, Badge>;
  /** Mode/difficulty (e.g. "CHIMPS-BLACK", "Impoppable") → medals. */
  _medalsSinglePlayer: IntMap;
  _medalsMultiplayer: IntMap;
  _medalsBoss: Partial<Record<MedalTier, number>>;
  _medalsBossElite: Partial<Record<MedalTier, number>>;
  _medalsCTLocal: Partial<Record<MedalTier, number>>;
  _medalsCTGlobal: Partial<Record<MedalTier, number>>;
  _medalsRace: Partial<Record<MedalTier, number>>;
}

export interface Guild {
  name: string;
  owner: NKUrl;
  numMembers: number;
  status: "OPEN" | "FILTERED" | "CLOSED" | "DISBANDED";
  banner: string;
  frame: string;
  icon: string;
  bannerURL: AssetUrl;
  frameURL: AssetUrl;
  iconURL: AssetUrl;
  /** e.g. "Global_BlackDiamond" → badge */
  CtBadges: Record<string, Badge>;
}

/**
 * PRIVATE (requires the player's OAK). UNVERIFIED — transcribed from the official docs only.
 * Never proxy or cache server-side.
 */
export interface UserSave {
  latestGameVersion: string;
  towerXP: Record<string, number>;
  acquiredUpgrades: Record<string, unknown>;
  acquiredKnowledge: Record<string, unknown>;
  unlockedTowers: Record<string, unknown>;
  unlockedHeroes: Record<string, unknown>;
  /** @deprecated use unlockedHeroes */
  unlockedHeros?: Record<string, unknown>;
  unlockedSkins: Record<string, unknown>;
  gamesPlayed: number;
  powers: Record<string, unknown>;
  powersPro: Record<string, unknown>;
  instaTowers: Record<string, Record<string, number>>;
  monkeyMoney: number;
  xp: number;
  rank: number;
  veteranXp: number;
  veteranRank: number;
  trophies: number;
  lifetimeTrophies: number;
  lifetimeTeamTrophies: number;
  knowledgePoints: number;
  primaryHero: string;
  achievementsClaimed: unknown[];
  highestSeenRound: number;
  dailyRewardCount: number;
  totalDailyChallengesCompleted: number;
  consecutiveDailyChallengesCompleted: number;
  totalRacesEntered: number;
  challengesPlayed: number;
  challengesShared: number;
  totalCompletedOdysseys: number;
  unlockedBigBloons: boolean;
  bigBloonsActive: boolean;
  unlockedSmallBloons: boolean;
  smallBloonsActive: boolean;
  seenBigTowers: boolean;
  bigTowersActive: boolean;
  unlockedSmallTowers: boolean;
  smallTowersActive: boolean;
  unlockedSmallBosses: boolean;
  smallBossesActive: boolean;
  /** User-generated, unmoderated names. */
  namedMonkeys: Record<string, Record<string, string>>;
  collectionEventCratesOpened: number;
  continuesUsed: number;
  trophyStoreItems: Record<string, unknown>;
  mapProgress: Record<string, unknown>;
  rogueLegends: Record<string, unknown>;
  frontierLegends: Record<string, unknown>;
  rogueUnlockedStarterArtifacts: Record<string, unknown>;
  rogueLegendsStats: unknown;
  frontierLegendsStats: unknown;
  quests: unknown[];
}

// ─────────────────────────────── challenges & maps (player-made)

export interface ChallengeFilter { type: ChallengeFilterType; challenges: NKUrl }
export interface MapFilter { type: MapFilterType; maps: NKUrl }

export interface ChallengeSummary {
  name: string;
  createdAt: EpochMs;
  id: string;
  /** null for daily challenges. */
  creator: NKUrl | null;
  metadata: NKUrl;
}

export interface MapSummary {
  name: string;
  createdAt: EpochMs;
  id: string;
  creator: NKUrl | null;
  metadata: NKUrl;
}

export interface MapDocument {
  name: string;
  createdAt: EpochMs;
  id: string;
  creator: NKUrl | null;
  gameVersion: string;
  /** "CustomMap" so far. */
  map: string;
  /** → /btd6/maps/map/:id/preview (JPEG). */
  mapURL: NKUrl;
  plays: number;
  wins: number;
  restarts: number;
  losses: number;
  upvotes: number;
  playsUnique: number;
  winsUnique: number;
  lossesUnique: number;
}

// ─────────────────────────────── CT

export interface CT {
  id: string;
  start: EpochMs;
  end: EpochMs;
  totalScores_player: number;
  totalScores_team: number;
  tiles: NKUrl;
  leaderboard_player: NKUrl;
  leaderboard_team: NKUrl;
}

export interface CTTile {
  /** 3-letter tile code, e.g. "MRX". */
  id: string;
  /** "Regular" | "Banner" | "TeamFirstCapture" | "TeamStart" | `Relic - ${string}` */
  type: Open<"Regular" | "Banner" | "TeamFirstCapture" | "TeamStart" | `Relic - ${string}`>;
  gameType: Open<"LeastCash" | "LeastTiers" | "Race" | "Boss" | "TeamStart">;
}

export interface CTTiles { id: string; tiles: CTTile[] }

export interface CTPlayerEntry { displayName: string; score: number; profile: NKUrl }

export interface CTTeamEntry {
  displayName: string;
  score: number;
  /** Guild URL (/btd6/guild/:id). */
  profile: NKUrl;
  group: NKUrl;
}

// ─────────────────────────────── odyssey

export interface Odyssey {
  id: string;
  name: string;
  description: string;
  start: EpochMs;
  end: EpochMs;
  metadata_easy: NKUrl;
  metadata_medium: NKUrl;
  metadata_hard: NKUrl;
}

export interface OdysseyMetadata {
  id: string;
  isExtreme: boolean;
  maxMonkeySeats: number;
  maxMonkeysOnBoat: number;
  maxPowerSlots: number;
  startingHealth: number;
  /** "Kind:Value", e.g. "MonkeyMoney:100", "Power:SuperMonkeyStorm". */
  _rewards: string[];
  _availablePowers: PowerRestriction[];
  _availableTowers: TowerRestriction[];
  _defaultPowers: { name: PowerId; quantity: number }[];
  _defaultTowers: { name: TowerId | HeroId; quantity: number }[];
  maps: NKUrl;
}

// ─────────────────────────────── events

export interface NKEvent {
  id: string;
  type: EventType;
  /** Generic label, e.g. "A Boss Event". */
  name: string;
  start: EpochMs;
  end: EpochMs;
  /** List URL with ?id= filter, or null. */
  url: NKUrl | null;
}

// ─────────────────────────────── endpoint → body map

export interface EndpointBodies {
  "races": Race[];
  "race.leaderboard": RaceLeaderboardEntry[];
  "race.metadata": ChallengeDocument;
  "bosses": Boss[];
  "boss.leaderboard": BossLeaderboardEntry[];
  "boss.metadata": ChallengeDocument;
  "user": UserProfile;
  "guild": Guild;
  "save": UserSave;
  "challenges": ChallengeFilter[];
  "challenges.filter": ChallengeSummary[];
  "challenge": ChallengeDocument;
  "ct": CT[];
  "ct.tiles": CTTiles;
  "ct.leaderboard.player": CTPlayerEntry[];
  "ct.leaderboard.team": CTTeamEntry[];
  "ct.leaderboard.group": CTTeamEntry[];
  "odyssey": Odyssey[];
  "odyssey.metadata": OdysseyMetadata;
  "odyssey.maps": ChallengeDocument[];
  "maps": MapFilter[];
  "maps.filter": MapSummary[];
  "map": MapDocument;
  "events": NKEvent[];
}

export type RouteName = keyof EndpointBodies | "map.preview";
