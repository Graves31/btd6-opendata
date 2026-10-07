#!/usr/bin/env python3
"""Game-art pipeline: extracts official Ninja Kiwi sprites from the local BTD6 install into WebP sprite sheets.

Art (c) Ninja Kiwi - used with the site owner's approval for this non-commercial fan site.

Outputs (all committed build artifacts):
  web/src/art/<family>.webp      one sheet per family, uniform square cells (Vite hashes these on import)
  web/src/art/index.ts           the registry (REGENERATED - contract with web/src/sprite.tsx)
  web/src/art/manifest.json      keys / sizes / map names, read by scripts/check_art.ts
  web/public/art/maps/<Map>.<hash>-{96,200,400}.webp   built-in map art, content-hashed
  web/src/data/names.ts          map / ability / CT relic names + relic descriptions (scripts/build_names.py)
  web/src/data/bosses.json       boss stats (scripts/build_bosses.py)
  web/src/art/bossbar/<part>.webp  in-game boss health-bar pieces at native size (BOSS_BAR in index.ts)

Setup (once):
  python -m venv .venv-art
  .venv-art/Scripts/python -m pip install -r scripts/requirements-art.txt      (Windows; bin/python elsewhere)
Run:
  npm run art                       (= python scripts/build_art.py; re-launches itself inside .venv-art)
  python scripts/build_art.py --qa  also renders review contact sheets into .wrangler/art-cache/qa/

The game directory is only ever read. Set BTD6_DIR to point at a non-default install.
Output is deterministic: same game build + same script = byte-identical files.
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import io
import json
import math
import os
import re
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _relaunch_in_venv() -> None:
    """`npm run art` calls plain `python`; hop into .venv-art (pinned deps) when it exists and we're not in it."""
    for rel in ("Scripts/python.exe", "bin/python"):
        venv_py = ROOT / ".venv-art" / rel
        if venv_py.exists():
            if Path(sys.prefix).resolve() != (ROOT / ".venv-art").resolve():
                sys.exit(subprocess.call([str(venv_py), __file__, *sys.argv[1:]]))
            return


_relaunch_in_venv()

try:
    import UnityPy
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as e:  # pragma: no cover
    sys.exit(f"missing dependency ({e}); create .venv-art as described in scripts/requirements-art.txt")


def _slice_bundle_nodes() -> None:
    """Since v57 (Unity 6) the asset_references bundle is ~4.4 GB decompressed and UnityPy copies each node out of
    that buffer (bytes), which runs out of memory. Hand each node a slice of the buffer instead: same bytes, no copy."""
    from UnityPy.files import File, SerializedFile
    from UnityPy.helpers import ImportHelper
    from UnityPy.streams.EndianBinaryReader import EndianBinaryReader, EndianBinaryReader_Memoryview
    copy = File.read_files

    def read_files(self, reader, files):
        if not isinstance(reader, EndianBinaryReader_Memoryview):
            return copy(self, reader, files)
        for node in files:  # File.read_files, with reader.view[...] for reader.read(node.size)
            data = reader.view[node.offset:node.offset + node.size]
            f = ImportHelper.parse_file(EndianBinaryReader(data, offset=reader.BaseOffset + node.offset), self,
                                        node.path, is_dependency=self.is_dependency)
            if isinstance(f, (EndianBinaryReader, SerializedFile)) and self.environment:
                self.environment.register_cab(node.path, f)
            f.flags = getattr(node, "flags", 0)
            self.files[node.path] = f

    File.read_files = read_files


_slice_bundle_nodes()

ART_DIR = ROOT / "web" / "src" / "art"
MAPS_DIR = ROOT / "web" / "public" / "art" / "maps"
CACHE_DIR = ROOT / ".wrangler" / "art-cache"
BTD6_DIR = Path(os.environ.get("BTD6_DIR", r"C:\Program Files (x86)\Steam\steamapps\common\BloonsTD6"))
AA_DIR = BTD6_DIR / "BloonsTD6_Data" / "StreamingAssets" / "aa" / "StandaloneWindows64" / "Full"

# Bump when the rendering below changes, so cached sprite PNGs are not reused across incompatible versions.
PIPELINE_VERSION = 1

# q75 / alpha 70: visually indistinguishable from q82 at 1x and 2x (checked side by side), ~30% smaller.
WEBP_SHEET = dict(quality=75, alpha_quality=70, method=6)
WEBP_MAP = dict(quality=80, alpha_quality=90, method=6)
MAP_SIZES = (96, 200, 400)

# ─────────────────────────────────────────────────────────────── mapping tables (reviewed by eye)
#
# Source spec: "<Atlas>/<SpriteName>" = a sprite packed in that SpriteAtlas of sprite_atlases_assets_all_*.bundle;
#              "ref/<SpriteName>"     = a loose sprite in asset_references_assets_all_*.bundle;
#              "scene/<SpriteName>"   = a loose sprite in ui_scenes_all_*.bundle.
# A "#<W>x<H>" suffix on the sprite name (e.g. "ref/CamoTrap#300x300") picks, among several sprites sharing
# that name, the one whose rect is exactly W x H (default: the largest).
# Each table entry: key -> source, or key -> (source, {options}). Options: halo=True bakes a 1px 50%-white
# outer halo (dark-bodied sprites that would vanish on #0a0a0b). Several keys may share one source (aliases
# share one cell). Order = cell order in the sheet.

TOWERS = {  # API TowerId -> MonkeyIcons (tower-select portraits). Note NK's spellings: NInja, Monkeyicon.
    "DartMonkey": "MonkeyIcons/DartMonkeyIcon",
    "BoomerangMonkey": "MonkeyIcons/BoomerangMonkeyIcon",
    "BombShooter": ("MonkeyIcons/BombShooterIcon", {"halo": True}),  # black cannon
    "TackShooter": "MonkeyIcons/TackShooterIcon",
    "IceMonkey": "MonkeyIcons/IceMonkeyIcon",
    "GlueGunner": "MonkeyIcons/GlueGunnerIcon",
    "Desperado": "MonkeyIcons/DesperadoIcon",
    "SniperMonkey": "MonkeyIcons/SniperMonkeyIcon",
    "MonkeySub": "MonkeyIcons/MonkeySubIcon",
    "MonkeyBuccaneer": "MonkeyIcons/MonkeyBuccaneerIcon",
    "MonkeyAce": "MonkeyIcons/MonkeyAceIcon",
    "HeliPilot": "MonkeyIcons/HeliPilotIcon",
    "MortarMonkey": "MonkeyIcons/MortarMonkeyIcon",
    "DartlingGunner": "MonkeyIcons/DartlingGunnerIcon",
    "WizardMonkey": "MonkeyIcons/WizardIcon",
    "SuperMonkey": "MonkeyIcons/SuperMonkeyIcon",
    "NinjaMonkey": "MonkeyIcons/NInjaMonkeyIcon",
    "Alchemist": "MonkeyIcons/AlchemistIcon",
    "Druid": "MonkeyIcons/DruidIcon",
    "Mermonkey": "MonkeyIcons/MermonkeyIcon",
    "Skywarden": "MonkeyIcons/SkyWardenIcon",
    "BananaFarm": "MonkeyIcons/BananaFarmIcon",
    "SpikeFactory": "MonkeyIcons/SpikeFactoryIcon",
    "MonkeyVillage": "MonkeyIcons/MonkeyVillageIcon",
    "EngineerMonkey": "MonkeyIcons/EngineerMonkeyicon",
    "BeastHandler": "MonkeyIcons/BeastHandlerIcon",
}

HEROES = {  # API HeroId -> MonkeyIcons DEFAULT skin (skins like AdoraSheRaIcon / QuincyCyberIcon deliberately unused)
    "Quincy": "MonkeyIcons/QuincyIcon",
    "Gwendolin": "MonkeyIcons/GwendolinIcon",
    "StrikerJones": "MonkeyIcons/StrikerJonesIcon",
    "ObynGreenfoot": "MonkeyIcons/ObynGreenFootIcon",
    "CaptainChurchill": "MonkeyIcons/CaptainChurchillIcon",
    "Benjamin": "MonkeyIcons/BenjaminIcon",
    "Ezili": "MonkeyIcons/EziliIcon",
    "PatFusty": "MonkeyIcons/PatFustyIcon",
    "Adora": "MonkeyIcons/AdoraIcon",
    "AdmiralBrickell": "MonkeyIcons/AdmiralBrickellIcon",
    "Etienne": "MonkeyIcons/EtienneIcon",
    "Sauda": "MonkeyIcons/SaudaIcon",
    "Psi": "MonkeyIcons/PsiIcon",
    "Geraldo": "MonkeyIcons/GeraldoIcon",
    "Corvus": ("MonkeyIcons/CorvusIcon", {"halo": True}),  # dark navy body
    "Rosalia": "MonkeyIcons/RosaliaIcon",
    "Silas": "MonkeyIcons/SilasIcon",
    "DanDMonke": "MonkeyIcons/DanDMonkeIcon",
    # hero rule: the game's "any hero" (a group of heroes) and "no hero" (crossed-out hero) icons, in the
    # 96 px hero sheet so they stay sharp at 48 px
    "AnyHero": "scene/AllHeroesIcon",
    "NoHero": "ref/OdysseyNoHeroIcon",
}

# Event medal tiers. API "BlueDiamond" = NK's "Diamond" medal. Bare keys = race medals (UiEventRaceMedals, the
# generic event set). Prefixed keys are the per-event-type medals the game shows in the profile cabinet:
#   boss:<Tier> (BossMedalEvent*), bossElite:<Tier> (EliteBossMedalEvent*),
#   ctLocal:<Tier> (CtLocalPlayer*), ctGlobal:<Tier> (CtGlobalPlayer*), ctTeam:<Tier> (CtGlobalTeam*, global team
#   board), ctGroup:<Tier> (CtLocalTeam*, a team's CT group).
# Only tiers the game actually has a sprite for exist (e.g. no ctGlobal:BlackDiamond, no boss:Participation).
_TIER_SPRITE = {
    "BlackDiamond": "BlackDiamond", "RedDiamond": "RedDiamond", "BlueDiamond": "Diamond",
    "GoldDiamond": "GoldDiamond", "DoubleGold": "DoubleGold", "GoldSilver": "GoldSilver",
    "DoubleSilver": "DoubleSilver", "Silver": "Silver", "Bronze": "Bronze", "Participation": "Participation",
}
_DARK_MEDAL = {"BlackDiamond"}


def _event_medals() -> dict:
    out: dict = {}
    sets = [
        ("", "UiEventRaceMedals/MedalEvent{}Medal"),
        ("boss:", "ref/BossMedalEvent{}Medal"),
        ("bossElite:", "ref/EliteBossMedalEvent{}Medal"),
        ("ctLocal:", "ref/CtLocalPlayer{}Medal"),
        ("ctGlobal:", "ref/CtGlobalPlayer{}Medal"),
        # team medals, for the CT team leaderboards: global (all 9 tiers) and local group (4 tiers)
        ("ctTeam:", "ref/CtGlobalTeam{}Medal"),
        ("ctGroup:", "ref/CtLocalTeam{}Medal"),
    ]
    for prefix, pattern in sets:
        for tier, sprite in _TIER_SPRITE.items():
            src = pattern.format(sprite)
            out[prefix + tier] = (src, {"halo": tier in _DARK_MEDAL, "optional": prefix != ""})
    return out


EVENT_MEDALS = _event_medals()

# Single-player map medals (MapMedals atlas). Verified by eye: the numbered variants follow the game's mode order
# within each difficulty, and the star colour encodes the slot (01 = green, 02 = purple, 03 = dark blue,
# 04 = iridescent), consistent across bronze / silver / gold and across the co-op set.
#   Easy:   MedalBronze = Easy, 01 = Primary Only, 02 = Deflation
#   Medium: MedalSilver = Medium, 01 = Military Only, 02 = Apopalypse, 03 = Reverse
#   Hard:   MedalGold = Hard, 01 = Magic Monkeys Only, 02 = Double HP MOABs, 03 = Half Cash, 04 = Alt. Bloons Rounds
#   Impoppable = MedalImpoppable (blue skull); CHIMPS ("Clicks") = MedalImpoppableRuby (red skull);
#   CHIMPS-BLACK = MedalImpoppableHematite (black skull).
_MODE_SPRITE = {
    "Easy": "Bronze", "PrimaryOnly": "Bronze01", "Deflation": "Bronze02",
    "Medium": "Silver", "MilitaryOnly": "Silver01", "Apopalypse": "Silver02", "Reverse": "Silver03",
    "Hard": "Gold", "MagicOnly": "Gold01", "DoubleMoabHealth": "Gold02", "HalfCash": "Gold03",
    "AlternateBloonsRounds": "Gold04",
    "Impoppable": "Impoppable", "Clicks": "ImpoppableRuby", "CHIMPS-BLACK": "ImpoppableHematite",
    "Empty": "Empty",  # ghost outline for an unearned slot
}
MODE_MEDALS = {}
for _k, _s in _MODE_SPRITE.items():
    MODE_MEDALS[_k] = ("MapMedals/Medal" + _s, {"halo": _k == "CHIMPS-BLACK"})
for _k, _s in _MODE_SPRITE.items():
    MODE_MEDALS["coop:" + _k] = ("MapMedals/MedalCoop" + _s, {"halo": _k == "CHIMPS-BLACK"})

UI = {
    # scoring (frameless leaderboard versions - legible at 20 px)
    "LeastCash": "ChallengeRulesIcons/LeastCashIconSmall",
    "LeastTiers": "ChallengeRulesIcons/LeastTiersIconSmall",
    "GameTime": "Ui/StopWatch",
    "BossTier": "ChallengeRulesIcons/BossTiersIconSmall",
    # rules-panel modifiers & toggles (framed ChallengeRulesIcons)
    "AllCamo": "ChallengeRulesIcons/AllCamoIcon",
    "AllRegen": "ChallengeRulesIcons/AllRegenIcon",
    "FasterBloons": "ChallengeRulesIcons/FasterBloonsIcon",
    "SlowerBloons": "ChallengeRulesIcons/SlowerBloonsIcon",
    "FasterMoab": "ChallengeRulesIcons/FasterMoabIcon",
    "SlowerMoab": "ChallengeRulesIcons/SlowerMoabIcon",
    "FasterBoss": "ChallengeRulesIcons/FasterBossIcon",
    "SlowerBoss": "ChallengeRulesIcons/SlowerBossIcon",
    "BloonBoost": "ChallengeRulesIcons/BloonBoostIcon",
    "BloonDecreaseHP": "ChallengeRulesIcons/BloonDecreaseHPIcon",
    "MoabBoost": "ChallengeRulesIcons/MoabBoostIcon",
    "MoabDecreaseHP": "ChallengeRulesIcons/MoabDecreaseHPIcon",
    "BossBoost": "ChallengeRulesIcons/BossBoostIcon",
    "BossDecreaseHP": "ChallengeRulesIcons/BossDecreaseHPIcon",
    "RegrowRateIncrease": "ChallengeRulesIcons/RegrowRateIncreaseIcon",
    "RegrowRateDecrease": "ChallengeRulesIcons/RegrowRateDecreaseIcon",
    # NK's sprite names say "cooldown REDUCTION increase/decrease": Increase = up arrows = abilities recharge
    # faster (abilityCooldownReductionMultiplier > 1); Decrease = slower (< 1).
    "AbilityCooldownIncrease": "ChallengeRulesIcons/AbilityCooldownReductionIncreaseIcon",
    "AbilityCooldownDecrease": "ChallengeRulesIcons/AbilityCooldownReductionDecreaseIcon",
    "NoKnowledge": "ChallengeRulesIcons/NoKnowledgeIcon",
    "PowersDisabled": "ChallengeRulesIcons/PowersDisabledIcon",
    "SellingDisabled": "ChallengeRulesIcons/SellingDisabledIcon",
    "NoContinues": "ChallengeRulesIcons/NoContinuesIcon",
    "NoDoubleCash": "ChallengeRulesIcons/NoDoubleCashIcon",
    "NoInstaMonkeys": "ChallengeRulesIcons/NoInstaMonkeys",
    "ParagonLimit": "ChallengeRulesIcons/ParagonLimitIcon",
    "StartingCash": "ChallengeRulesIcons/StartingCash",
    "StartingLives": "ChallengeRulesIcons/StartingLives",
    "StartRound": "ChallengeRulesIcons/StartRoundIcon",
    "EndRound": "ChallengeRulesIcons/EndRoundIcon",
    # currencies / misc
    # The currency icon the game draws next to the Monkey Money balance (ForegroundScreen/CashInfo/Icon), on
    # continue/retry costs, hero/MK prices and MM rewards: a green banknote with a monkey face. NK calls it
    # "Bloonjamins". (MonkeyKnowledgeUi/MoMonkeyMoneyIcon is the purple "More Monkey Money" MK perk, not this.)
    "MonkeyMoney": "Ui/BloonjaminsIcon",
    "Trophy": "Ui/TrophyIcon",
    "CtTickets": "Ui/CtTicketsIcon",
    "Powers": "Ui/PowersIcon",
    "Coop1": "IngameUi/CoopPlayer1Icon",
    "Coop2": "IngameUi/CoopPlayer2Icon",
    "Coop3": "IngameUi/CoopPlayer3Icon",
    "Coop4": "IngameUi/CoopPlayer4Icon",
    # extras beyond the original contract list (documented in index.ts)
    "LeastCashRule": "ChallengeRulesIcons/LeastCashIcon",
    "LeastTiersRule": "ChallengeRulesIcons/LeastTiersIcon",
    "RemovableCostIncrease": "ChallengeRulesIcons/RemovableCostIncreaseIcon",
    "RemovableCostDecrease": "ChallengeRulesIcons/RemovableCostDecreaseIcon",
    "CeramicIncreaseHP": "ChallengeRulesIcons/CeramicIncreaseHPIcon.png",  # sic, NK's sprite name
    "CeramicDecreaseHP": "ChallengeRulesIcons/CeramicDecreaseHPIcon",
    "FastTrackDisabled": "ChallengeRulesIcons/FastTrackDisabledIcon",
    "NoLivesLost": "ChallengeRulesIcons/NoLivesLostIcon",
    "Race": "ref/RaceIcon",
    "Odyssey": "ref/OdysseyIcon",
    "ContestedTerritory": "ref/ContestedTerritoryEventBtn",
    "CtPoints": "Ui/CtPointsIcon",
    "Relic": "ref/DefaultRelicIcon",
    "MaxTowers": "Ui/MaxMonkeysIcon",
    "CustomRounds": "ChallengeRulesIcons/CustomRoundIcon",
    # game-mode icons from the mode-select screen, keyed "mode:<ChallengeDocument.mode>" ("Standard" is
    # per difficulty: mode:Easy / mode:Medium / mode:Hard). "Clicks" is NK's internal name for CHIMPS.
    "mode:Easy": "MainMenuUiAtlas/ModeSelectEasyBtn",
    "mode:Medium": "MainMenuUiAtlas/ModeSelectMediumBtn",
    "mode:Hard": "MainMenuUiAtlas/ModeSelectHardBtn",
    "mode:PrimaryOnly": "MainMenuUiAtlas/PrimaryBtn",
    "mode:MilitaryOnly": "MainMenuUiAtlas/MilitaryBtn",
    "mode:MagicOnly": "MainMenuUiAtlas/MagicBtn",
    "mode:Deflation": "ref/DeflationBtn",
    "mode:Apopalypse": "ref/ApopalypseBtn",
    "mode:Reverse": "scene/ReverseBtn",
    "mode:DoubleMoabHealth": "scene/DoubleHpMoabsBtn",
    "mode:HalfCash": "ref/HalfCashIcon",
    "mode:AlternateBloonsRounds": "ref/AlternateBloonsBtn",
    "mode:Impoppable": "ref/ImpoppableBtn",
    "mode:Clicks": "ref/CHIMPSIcon",
    "mode:FastTrack": "Ui/FastTrackModeIcon",
}

# In-game tower-shop tile backgrounds by category (blue Primary, green Military, purple Magic, orange Support,
# yellow Hero). Drawn behind roster portraits so towers read by category as in game.
CONTAINERS = {
    "Primary": "ref/TowerContainerPrimary",
    "Military": "ref/TowerContainerMilitary",
    "Magic": "ref/TowerContainerMagic",
    "Support": "ref/TowerContainerSupport",
    "Hero": "ref/TowerContainerHero",
    # Power tiles (hexagonal, 308:354), exactly as the game's PowerPurchaseButton prefab (powers menu in game,
    # powers select screen, store) switches its background: PowerBg = PowerContainer (orange/yellow, regular
    # powers), ProBg = PowersProContainer (blue, Pro powers: BananaFarmerPro, MonkeyBoostPro, PortableLakePro,
    # TechBotPrime), StoreBg/PotionBg = PowerIAPContainer (purple: potions and store-only powers).
    "Power": "MainMenuUiAtlas/PowerContainer",
    "PowerPro": "ref/PowersProContainer",
    "PowerStore": "MainMenuUiAtlas/PowerIAPContainer",
}

POWERS = {  # API PowerId -> PowerIcons atlas (24 store powers) + Legends store icons for the potions
    "BananaFarmer": "PowerIcons/BananaFarmerIcon",
    "BananaFarmerPro": "PowerIcons/BananaFarmerProIcon",
    "BattleCat": "PowerIcons/BattleCatIcon",
    "CamoTrap": "PowerIcons/CamoTrapIcon",
    "CashDrop": "PowerIcons/CashDropIcon",
    "CaveMonkey": "PowerIcons/CaveMonkeyIcon",
    "DartTime": "PowerIcons/DartTimeIcon",
    "EnergisingTotem": "PowerIcons/EnergisingTotemIcon",
    "GlueTrap": "PowerIcons/GlueTrapIcon",
    "HealthPotion": "ref/HealthPotionStoreIcon",  # not in PowerIcons; Legends store icon
    "MoabMine": "PowerIcons/MoabMineIcon",
    "MonkeyBoost": "PowerIcons/MonkeyBoostIcon",
    "MonkeyBoostPro": "PowerIcons/MonkeyBoostProIcon",
    "Pontoon": "PowerIcons/PontoonIcon",
    "PortableLake": "PowerIcons/PortableLakeIcon",
    "PortableLakePro": "PowerIcons/PortableLakeProIcon",
    "RoadSpikes": "PowerIcons/HotSpikesIcon",  # the atlas's only spikes icon; 24 atlas icons = 24 store powers
    "SheRa": "PowerIcons/SheRaPowerIcon",
    "Skeletor": "PowerIcons/SkeletorPowerIcon",
    "StaminaPotion": "ref/StaminaPotionStoreIcon",  # not in PowerIcons; Legends store icon
    "SuperMonkeyBeacon": "PowerIcons/SuperMonkeyBeaconIcon",
    "SuperMonkeyStorm": "PowerIcons/SuperMonkeyStormIcon",
    "SwordOfPower": "PowerIcons/SwordOfPowerIcon",
    "TechBot": "PowerIcons/TechbotIcon",
    "TechBotPrime": "PowerIcons/TechbotProIcon",
    "Thrive": "PowerIcons/ThriveIcon",
}

# CT relics, keyed by the API relic id (CT tile type "Relic - <id>", = TeamsStoreItem.id / the game's
# ContestedTerritoryRelicType enum). Complete list from game_data (RelicKnowledgeData + Relic* store items); icons
# resolved through each relic's icon guidRef in the Addressables catalog (TeamsStoreIcons/Relics/<file>.png) and
# checked by eye. Icon file = id except SuperMonkeyStorm -> "Sms". All are 300x300 round framed icons; a few names
# are shared with bigger unrelated sprites (CamoTrap, GlueTrap, MonkeyBoost, Thrive), hence the size selector.
RELIC_IDS = [
    "StartingStash", "ExtraEmpowered", "BoxOfChocolates", "BoxOfMonkey", "MarchingBoots", "HeroBoost",
    "BiggerBloonSabotage", "RoundingUp", "ManaBulwark", "Regeneration", "Restoration", "DurableShots",
    "AlchemistTouch", "DeepHeat", "Sharpsplosion", "RoyalTreatment", "HardBaked", "Fortifried", "MoabClash",
    "CamoFlogged", "BrokenHeart", "GoingTheDistance", "Heartless", "FlintTips", "Abilitized", "AirAndSea",
    "ElDorado", "MonkeyShield", "MonkeyShieldMark2", "MonkeyShieldMark3", "PsiVision", "OpenSeason",
    "CamoTrap", "Thrive", "SuperMonkeyStorm", "MonkeyBoost", "RoadSpikes", "MoabMine", "GlueTrap", "Techbot",
    "PrimaryPrimates", "MilitaryMonkeys", "MagicMonkeys", "SupportSimians", "MonkeyTycoon",
]
_RELIC_FILE = {"SuperMonkeyStorm": "Sms"}
RELICS = {r: "ref/%s#300x300" % _RELIC_FILE.get(r, r) for r in RELIC_IDS}

# Paragon upgrade icons. build_paragons decodes the 13 "<TowerId> Paragon" UpgradeModel records from the game's
# sim_model, each with an icon Addressables guid; the binary catalog (aa/catalog.bin) maps that guid (a key) to
# its locations, whose internal id ends in the sprite's file name ("ApexPlasmaMasterUpgradeIcon.png"). The sprite
# of that name (".png" dropped) is in the asset_references bundle ("ref/"). The Paragon Power Totem tower has
# no icon guid here: its portrait sprite is "ParagonPowerTotemPortrait" (same bundle).
CATALOG_BIN = BTD6_DIR / "BloonsTD6_Data" / "StreamingAssets" / "aa" / "catalog.bin"
PARAGON_TOTEM_SPRITE = "ref/ParagonPowerTotemPortrait"


def catalog_file_names(guids: list) -> dict:
    """guid -> file name (last path part of its location internal id) from Addressables' catalog.bin.

    Layout (ContentCatalogData binary, checked here): header uints [magic 0x0de38942, version 2, keysOffset,
    ...]; at keysOffset an array [u32 byte size][(keyObj, locationList) u32 pairs]; keyObj = [typeOff, dataOff]
    with data -> a string offset (strings are length-prefixed UTF-8/ASCII, offset points at the bytes); a location
    list = [u32 byte size][location offsets]; a location = [primaryKey, internalId, ...] string offsets, where a
    string offset with bit 0x40000000 is a "dynamic" node [filePartStr, parentNode] (directory chain omitted:
    only the file part is needed)."""
    import struct

    if not CATALOG_BIN.is_file():
        sys.exit(f"{CATALOG_BIN} not found (set BTD6_DIR)")
    d = CATALOG_BIN.read_bytes()
    u = lambda o: struct.unpack_from("<I", d, o)[0]
    if u(0) != 0x0DE38942 or u(4) != 2:
        sys.exit(f"catalog.bin format changed (magic {u(0):#x}, version {u(4)})")
    start = u(8)
    end = start + u(start - 4)

    def text(o: int) -> str:
        return d[o:o + u(o - 4)].decode("utf-8")

    def file_part(p: int) -> str:
        return text(u(p & 0x3FFFFFFF)) if p & 0x40000000 else text(p)

    want = {}
    for g in guids:
        off = d.find(g.encode("ascii"))
        if off < 0 or u(off - 4) != len(g):
            sys.exit(f"icon guid {g} not in catalog.bin")
        want[off] = g
    out: dict = {}
    for o in range(start, end, 8):
        k, v = u(o), u(o + 4)
        if k + 8 > len(d) or v < 4 or v >= len(d):
            continue
        if u(k + 4) + 4 > len(d) or u(k + 4) < 4:
            continue
        ds = u(u(k + 4)) if u(k + 4) + 4 <= len(d) else None
        if ds in want:
            names = {file_part(u(u(v + 4 * i))) for i in range(u(v - 4) // 4)}
            if len(names) != 1:
                sys.exit(f"icon guid {want[ds]}: expected one file name, got {sorted(names)}")
            out[want[ds]] = names.pop()
    missing = [g for g in guids if g not in out]
    if missing:
        sys.exit(f"icon guids without a catalog location: {missing}")
    return out


def paragon_icons() -> dict:
    """TowerId -> sprite spec, for the "paragon" family (+ ParagonPowerTotem)."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_paragons
    import build_rounds

    ups = [u for u in build_paragons.parse_upgrades(build_rounds.load_sim_model()) if u["confirmation"] == "Paragon"]
    names = catalog_file_names([u["icon"] for u in ups])
    table = {}
    for u in sorted(ups, key=lambda u: u["name"]):
        file = names[u["icon"]]
        if not file.endswith(".png"):
            sys.exit(f"paragon icon of {u['name']!r} is not a .png: {file!r}")
        table[u["name"].removesuffix(" Paragon")] = "ref/" + file[: -len(".png")]
    table["ParagonPowerTotem"] = PARAGON_TOTEM_SPRITE
    return table


BLOONS = {  # canonical bloon keys -> plain base sprites (no damage states, no event skins)
    "red": "Bloons/Red",
    "blue": "Bloons/Blue",
    "green": "Bloons/Green",
    "yellow": "Bloons/Yellow",
    "pink": "Bloons/Pink",
    "black": ("Bloons/Black", {"halo": True}),
    "white": "Bloons/White",
    "purple": "Bloons/Purple",
    "zebra": "Bloons/Zebra",
    "lead": ("Bloons/Lead", {"halo": True}),
    "rainbow": "Bloons/Rainbow",
    "ceramic": "Bloons/Ceramic",
    "moab": "UiBloonIcons/MoabIcon",
    "bfb": "UiBloonIcons/BfbIcon",
    "zomg": ("UiBloonIcons/ZomgIcon", {"halo": True}),
    "ddt": ("UiBloonIcons/DdtIcon", {"halo": True}),
    "bad": ("UiBloonIcons/BadIcon", {"halo": True}),
    "golden": "Bloons/GoldenBloon",
    "camo": "Bloons/RedCamo",
    "regrow": "Bloons/RedRegrow",
    "fortified": ("Bloons/LeadFortified", {"halo": True}),
    "ceramic-fortified": "Bloons/CeramicFortified",
    "necro": "ref/NecroBloonIcon",
}

# Camo / regrow / fortified variants, as the game draws them (its own `Bloons/<Base><Variant>` sprites and
# fortified MOAB-class icons). Only the Tools pages load this sheet. The combinations come from BLOON_TYPES in the
# generated round-set index (scripts/build_rounds.py, run first by main()): every flag combo the game model
# defines for a bloon type the round sets use, whose icon differs from the base sprite. Keys: "<bloon key>:<flags>"
# (flags = camo 1 | regrow 2 | fortified 4), e.g. "ceramic:5" = fortified camo ceramic.
_DARK_BLOONS = {"black", "lead", "zomg", "ddt", "bad"}
ROUNDS_INDEX = ROOT / "web" / "src" / "data" / "rounds" / "index.ts"


def bloon_variants() -> dict:
    out: dict = {}
    if not ROUNDS_INDEX.exists():
        return out
    src = ROUNDS_INDEX.read_text("utf-8")
    block = src.split("export const BLOON_TYPES", 1)[1].split("\n};", 1)[0]
    for m in re.finditer(r'^\s*"([\w-]+)":\s*(\{.*\}),\s*$', block, re.M):
        key, t = m.group(1), json.loads(m.group(2))
        icons = t.get("icons", {})
        if not t.get("sprite"):
            continue  # no base sprite in the bloon family (Legends-only bloons): the UI shows text chips
        for flags in sorted(icons, key=int):
            if flags != "0" and icons[flags] != icons.get("0"):
                out[f"{key}:{flags}"] = (icons[flags], {"halo": key in _DARK_BLOONS})
    return out


_BOSSES = ["bloonarius", "lych", "vortex", "dreadbloon", "phayze", "blastapopoulos", "diamondback"]
_DARK_BOSS = {"phayze", "lych"}
_DARK_ELITE_BOSS = _DARK_BOSS | {"diamondback"}  # elite Diamondback is navy/black
BOSSES: dict = {}
for _b in _BOSSES:  # in-game boss portraits (asset_references); "elite:" = elite portrait
    BOSSES[_b] = ("ref/%sPortrait" % _b.capitalize(), {"halo": _b in _DARK_BOSS})
for _b in _BOSSES:
    BOSSES["elite:" + _b] = ("ref/%sPortraitElite" % _b.capitalize(), {"halo": _b in _DARK_ELITE_BOSS})
# The skull markers on a boss health bar (BossUi's skullPrefab "AbilityMarker"): SkullIdle = BossSkullPipOff
# (not reached yet) -> "skull:off"; SkullActivated = BossSkullPipOn (reached) -> "skull". Also seen:
# BossSkullLarge, BossSkullPipFire. Added by main(): spawned-bloon icons ("spawn:<key>", "spawn:<key>:elite")
# from scripts/build_bosses.py, the bar's boss icons ("hud:<boss>", "hud:elite:<boss>") and the bar's small
# icons ("bar:<name>") from the BossUi prefab (see boss_ui()).
BOSSES["skull"] = "ref/BossSkullPipOn"
BOSSES["skull:off"] = "ref/BossSkullPipOff"
# UserProfile.bossBadgesNormal/Elite use capitalised names: alias them onto the same cells.
BOSS_ALIASES = {b.capitalize(): b for b in _BOSSES}
# The boss badges a profile shows (normal / elite), as on the game's profile screen. Own sheet: profiles only.
BOSS_BADGES: dict = {}
for _b in _BOSSES:
    BOSS_BADGES[_b] = "ref/%sBadge" % _b.capitalize()
    BOSS_BADGES["elite:" + _b] = "ref/%sEliteBadge" % _b.capitalize()

# Social Season badges, keyed by the API's seasonBadges ids (NK's own URL for SeasonUltimate3 answers 404).
# The game names each Ultimate medal after its season's theme; season order from the Blooncyclopedia's
# Social Season Event page (1 "Dr. Monkey Needs You!", 2 "Striker's Vacation!", 3 "Quincy's Roadtrip!").
# Ultimate 2 checked by eye against NK's SocialSeasonsUltimate2Medal.png (the beach ball).
SEASON_BADGES = {
    "SeasonTier1": "ref/SocialSeasonsTier1Medal",
    "SeasonTier2": "ref/SocialSeasonsTier2Medal",
    "SeasonTier3": "ref/SocialSeasonsTier3Medal",
    "SeasonTier4": "ref/SocialSeasonsTier4Medal",
    "SeasonUltimate1": "ref/SocialSeasonsUltimateMedalScience",
    "SeasonUltimate2": "ref/SocialSeasonsUltimateMedalStrikersVacation",
    "SeasonUltimate3": "ref/SocialSeasonsUltimateMedalQuincysRoadTrip",
    "SeasonChampion": "ref/SocialSeasonsChampionMedal",
}

# Official event-type icons (the round buttons on the main-menu Events panel). No official sprite exists for
# dailyAdvanced / dailyCoop (the game reuses DailyChallengeBtn), so those keys are intentionally absent.
EVENT_ICONS = {
    "boss": "ref/BossChallenge",
    "race": "ref/EventRaceBtn",
    "ct": "ref/ContestedTerritoryEventBtn",
    "odyssey": "ref/OdysseyEventBtn",
    "daily": "MainMenuUiAtlas/DailyChallengeBtn",
    "bossRush": "ref/BushRushEventBtn",  # sic: NK's sprite name
}

FAMILIES = {  # family -> (table, cell px, aliases)
    "tower": (TOWERS, 96, {}),
    "hero": (HEROES, 96, {}),
    "eventMedal": (EVENT_MEDALS, 64, {}),
    "modeMedal": (MODE_MEDALS, 64, {}),
    "ui": (UI, 48, {}),
    "power": (POWERS, 64, {}),
    "bloon": (BLOONS, 64, {}),
    "bloonVariant": ({}, 64, {}),  # filled by main() from bloon_variants(), after build_rounds has run
    "boss": (BOSSES, 96, BOSS_ALIASES),
    "bossBadge": (BOSS_BADGES, 64, {}),
    "container": (CONTAINERS, 112, {}),
    "relic": (RELICS, 64, {}),
    "paragon": ({}, 96, {}),  # filled by main() from paragon_icons()
    "season": (SEASON_BADGES, 96, {}),
    "eventIcon": (EVENT_ICONS, 96, {}),
}

# ─────────────────────────────────────────────────────────────── sprite source


def _bundle(prefix: str) -> Path:
    hits = sorted(glob.glob(str(AA_DIR / f"{prefix}_*.bundle")))
    if not hits:
        sys.exit(f"no {prefix}_*.bundle under {AA_DIR} (set BTD6_DIR)")
    return Path(hits[-1])


class Source:
    """Lazy sprite lookup with an on-disk PNG cache keyed by bundle file name (which embeds NK's content hash)."""

    def __init__(self) -> None:
        self.atlas_bundle = _bundle("sprite_atlases_assets_all")
        self.ref_bundle = _bundle("asset_references_assets_all")
        self.scene_bundle = _bundle("ui_scenes_all")
        self._atlas: dict | None = None
        self._ref: dict | None = None
        self._scene: dict | None = None
        self.cache = CACHE_DIR / "sprites"

    def _cache_path(self, bundle: Path, name: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
        return self.cache / f"v{PIPELINE_VERSION}-{bundle.stem}" / f"{safe}.png"

    def _load_atlases(self) -> dict:
        if self._atlas is None:
            env = UnityPy.load(str(self.atlas_bundle))
            idx: dict = {}
            for obj in env.objects:
                if obj.type.name != "SpriteAtlas":
                    continue
                a = obj.read()
                names = list(a.m_PackedSpriteNamesToIndex)
                for name, pptr in zip(names, a.m_PackedSprites):
                    idx.setdefault((a.m_Name, name), []).append(pptr)
            self._atlas = idx
        return self._atlas

    def _load_scene(self) -> dict:
        if self._scene is None:
            env = UnityPy.load(str(self.scene_bundle))
            idx: dict = {}
            for obj in env.objects:
                if obj.type.name == "Sprite":
                    idx.setdefault(obj.peek_name(), []).append(obj)
            self._scene = idx
        return self._scene

    def _load_refs(self) -> dict:
        if self._ref is None:
            env = UnityPy.load(str(self.ref_bundle))
            idx: dict = {}
            for obj in env.objects:
                if obj.type.name == "Sprite":
                    idx.setdefault(obj.peek_name(), []).append(obj)
            self._ref = idx
        return self._ref

    @staticmethod
    def _largest(sprites: list, size: tuple | None = None) -> Image.Image:
        # Duplicate names exist (e.g. two "PowersIcon" in Ui): deterministically take the largest rect, or the
        # one of exactly `size` (w, h) when the spec asks for it.
        if size:
            sprites = [s for s in sprites if (round(s.m_Rect.width), round(s.m_Rect.height)) == size]
            if not sprites:
                raise KeyError(size)
        best = sorted(sprites, key=lambda s: (-(s.m_Rect.width * s.m_Rect.height), s.m_Name))[0]
        return best.image.convert("RGBA")

    def get(self, spec: str) -> Image.Image:
        where, name = spec.split("/", 1)
        size = None
        m = re.fullmatch(r"(.+)#(\d+)x(\d+)", name)  # map names may contain '#' ("#ouch"): digits only
        if m:
            name, size = m.group(1), (int(m.group(2)), int(m.group(3)))
        bundle = {"ref": self.ref_bundle, "scene": self.scene_bundle}.get(where, self.atlas_bundle)
        cp = self._cache_path(bundle, where + "__" + name + (f"__{size[0]}x{size[1]}" if size else ""))
        if cp.exists():
            return Image.open(cp).convert("RGBA")
        if where in ("ref", "scene"):
            objs = (self._load_refs() if where == "ref" else self._load_scene()).get(name)
            if not objs:
                raise KeyError(spec)
            try:
                img = self._largest([o.read() for o in objs], size)
            except KeyError:
                raise KeyError(spec)
        else:
            pptrs = self._load_atlases().get((where, name))
            if not pptrs:
                raise KeyError(spec)
            try:
                img = self._largest([p.read() for p in pptrs], size)
            except KeyError:
                raise KeyError(spec)
        cp.parent.mkdir(parents=True, exist_ok=True)
        img.save(cp)
        return img

    def map_details(self) -> list[dict]:
        env = UnityPy.load(str(_bundle("game_data_assets_all")))
        for obj in env.objects:
            if obj.type.name == "MonoBehaviour" and obj.peek_name() == "MapDetails":
                return obj.read_typetree()["Maps"]["items"]
        sys.exit("MapDetails not found in game_data bundle")


# ─────────────────────────────────────────────────────────────── in-game boss UI (BossUi prefab)
#
# The game's boss HUD is the "BossUi" prefab in asset_references (MonoBehaviour BossUI). Its main health bar is
# shared by every boss (Bg tint + BossBarGradient fill + 9-sliced BossFrame); what differs per boss is the HUD
# icon (Bosses.BossList[i].normalHudIcon / eliteHudIcon) and the extra bars: armour/shield bars (one BossArmourUI
# per boss: Dreadbloon, Lych, Phayze, Diamondback), Blastapopoulos' heat bar (BossUI.heatBar) and Diamondback's
# tail bar (BossUI.tailBar). Everything below is read from the prefab (RectTransforms, Image sprite/type/colour/
# border, fill method); a missing node or sprite exits loudly. Unity Image types: 0 simple, 1 sliced, 2 tiled,
# 3 filled. Rects are [x, y, w, h] in prefab units, origin = bottom-left of the main HP bar, y up.
_IMAGE_MODE = {0: "simple", 1: "sliced", 2: "tiled", 3: "filled"}
_PLAIN_SPRITES = {"WhitePixel"}  # a 1x1 white pixel: the prefab only uses it as a tinted colour
BOSS_UI_VERSION = 2


def _hex_rgba(c) -> str:
    return "#" + "".join(f"{round(max(0.0, min(1.0, v)) * 255):02x}" for v in (c.r, c.g, c.b, c.a))


def _r2(v: float) -> float:
    v = round(v, 2)
    return int(v) if v == int(v) else v


def boss_ui(src: "Source") -> dict:
    """-> {"parts", "rects", "marker", "icons"} from the BossUi prefab and the Bosses data (cached per game build in
    .wrangler/art-cache)."""
    mono = sorted(glob.glob(str(AA_DIR / "*_monoscripts_*.bundle")))
    if not mono:
        sys.exit(f"no *_monoscripts_*.bundle under {AA_DIR}")
    tag = hashlib.sha256((src.ref_bundle.name + Path(mono[-1]).name + src.atlas_bundle.name
                          + _bundle("game_data_assets_all").name).encode()).hexdigest()[:16]
    cache = CACHE_DIR / f"bossui-v{BOSS_UI_VERSION}-{tag}.json"
    if cache.exists():
        return json.loads(cache.read_text("utf-8"))
    env = UnityPy.load(str(src.ref_bundle), mono[-1])

    def comps(go):
        for c in go.m_Component:
            yield (c.component if hasattr(c, "component") else c).read()

    def script(mb) -> str:
        try:
            return mb.m_Script.read().m_ClassName
        except Exception:
            return ""

    def image(go):
        for c in comps(go):
            if c.object_reader.type.name == "MonoBehaviour" and script(c) == "Image":
                return c
        return None

    def transform(go):
        for c in comps(go):
            if c.object_reader.type.name in ("RectTransform", "Transform"):
                return c
        sys.exit(f"BossUi: {go.m_Name} has no transform")

    def children(go):
        return [ch.read().m_GameObject.read() for ch in transform(go).m_Children]

    def child(go, name, optional=False):
        hits = [c for c in children(go) if c.m_Name == name]
        if len(hits) != 1:
            if optional and not hits:
                return None
            sys.exit(f"BossUi: {go.m_Name}/{name} found {len(hits)} times")
        return hits[0]

    def descendants(go):
        for c in children(go):
            yield c
            yield from descendants(c)

    def rect_in(go, parent_rect, cache_r) -> tuple:
        """(left, bottom, right, top) of go's RectTransform inside parent_rect (Unity's anchor/pivot rules)."""
        rt = transform(go)
        pl, pb, pr, pt = parent_rect
        amin, amax, piv = rt.m_AnchorMin, rt.m_AnchorMax, rt.m_Pivot
        ap, sd = rt.m_AnchoredPosition, rt.m_SizeDelta
        l = pl + (pr - pl) * amin.x + ap.x - sd.x * piv.x
        r = pl + (pr - pl) * amax.x + ap.x + sd.x * (1 - piv.x)
        b = pb + (pt - pb) * amin.y + ap.y - sd.y * piv.y
        t = pb + (pt - pb) * amax.y + ap.y + sd.y * (1 - piv.y)
        return (l, b, r, t)

    def abs_rect(go, root, root_rect) -> tuple:
        if go.object_reader.path_id == root.object_reader.path_id:
            return root_rect
        par = transform(go).m_Father.read().m_GameObject.read()
        return rect_in(go, abs_rect(par, root, root_rect), None)

    uis = []
    for o in env.objects:
        if o.type.name == "MonoBehaviour":
            mb = o.read()
            if script(mb) == "BossUI" and mb.m_GameObject.read().m_Name == "BossUi":
                uis.append(mb)
    if len(uis) != 1:
        sys.exit(f"BossUi prefab: {len(uis)} BossUI components on a 'BossUi' object (need 1)")
    ui = uis[0]
    boss_obj = next((g for g in descendants(ui.m_GameObject.read()) if g.m_Name == "BossObj"), None)
    if boss_obj is None:
        sys.exit("BossUi: no BossObj")
    boss_rect = rect_in(boss_obj, (0, 0, 0, 0), None)  # BossObj hangs off a centred zero-size container
    hp_go = transform(ui.hpBarImg.read().m_GameObject.read()).m_Father.read().m_GameObject.read()
    if hp_go.m_Name != "HPBar":
        sys.exit(f"BossUi: hpBarImg parent is {hp_go.m_Name!r}, expected HPBar")
    hp_abs = abs_rect(hp_go, boss_obj, boss_rect)
    ox, oy = hp_abs[0], hp_abs[1]

    def rect_hp(go, root=boss_obj, root_rect=boss_rect) -> list:
        l, b, r, t = abs_rect(go, root, root_rect)
        return [_r2(l - ox), _r2(b - oy), _r2(r - l), _r2(t - b)]

    def sprite_spec(name: str) -> str:
        # some prefab sprites are stubs in asset_references (no texture): their pixels live in the Ui atlas
        if any(o.read().m_RD.texture.path_id for o in src._load_refs().get(name, [])):
            return "ref/" + name
        if ("Ui", name) in src._load_atlases():
            return "Ui/" + name
        sys.exit(f"BossUi: sprite {name!r} is in neither asset_references nor the Ui atlas")

    def part(go, rect) -> dict:
        img = image(go)
        if img is None:
            sys.exit(f"BossUi: {go.m_Name} has no Image")
        mode = _IMAGE_MODE.get(img.m_Type)
        tint = _hex_rgba(img.m_Color)
        out: dict = {"rect": rect}
        if img.m_Sprite.path_id and img.m_Sprite.read().m_Name not in _PLAIN_SPRITES:
            sp = img.m_Sprite.read()
            out.update(sprite=sp.m_Name, spec=sprite_spec(sp.m_Name), mode=mode,
                       w=round(sp.m_Rect.width), h=round(sp.m_Rect.height))
            b = sp.m_Border  # x left, y bottom, z right, w top (sprite pixels)
            if mode == "sliced":
                out["slice"] = [round(b.w), round(b.z), round(b.y), round(b.x)]  # CSS order: top right bottom left
                if not img.m_FillCenter:
                    out["center"] = False
            if img.m_PixelsPerUnitMultiplier != 1.0:
                out["ppum"] = _r2(img.m_PixelsPerUnitMultiplier)  # drawn at 1/ppum of the sprite's pixel size
        else:
            out["mode"] = "color" if mode != "filled" else "filled"
        if mode == "filled":
            if img.m_FillMethod != 0 or img.m_FillOrigin != 0:
                sys.exit(f"BossUi: {go.m_Name} fill method {img.m_FillMethod}/{img.m_FillOrigin} unsupported")
            out["fill"] = "horizontal"
        if tint != "#ffffffff":
            out["tint"] = tint
        return out

    parts: dict = {}
    rects: dict = {}
    icons: dict = {}

    def add(key, go, **extra):
        p = part(go, rect_hp(go))
        p.update(extra)
        parts[key] = p
        return p

    def add_icon(key, go):
        p = part(go, rect_hp(go))
        if "spec" not in p:
            sys.exit(f"BossUi: icon {go.m_Name} has no sprite")
        icons[key] = p.pop("spec")
        parts[key] = {"art": key, "rect": p["rect"], "w": p["w"], "h": p["h"], "mode": "simple"}

    def bar(prefix, go, bg, inner, frame):
        rects[prefix] = rect_hp(go)
        add(f"{prefix}:bg", bg)
        add(f"{prefix}:fill", inner)
        for name in ("Shade", "Highlight"):
            n = child(inner, name, optional=True)
            if n is not None:
                add(f"{prefix}:{name.lower()}", n)
        add(f"{prefix}:frame", frame)

    # main health bar (shared by every boss)
    inner = ui.hpBarImg.read().m_GameObject.read()
    bar("hp", hp_go, child(hp_go, "Bg"), inner, child(hp_go, "Frame"))
    # Blastapopoulos heat bar
    heat = ui.heatBar.read()
    if ui.heatBarImg.read().m_GameObject.read().m_Name != "InnerBar":
        sys.exit("BossUi: heatBarImg is not an InnerBar")
    bar("heat", heat, child(heat, "Bg"), ui.heatBarImg.read().m_GameObject.read(), child(heat, "Frame"))
    gauge = child(heat, "HeatGuageIcon")
    add_icon("bar:heatGauge", gauge)
    add_icon("bar:heatNeedle", child(gauge, "HeatGuageNeedle"))
    # Diamondback tail bar: Bg, a coloured "BG", the masked tile (InnerBar clips it), frame, ON/OFF icons
    tail = ui.tailBar.read()
    rects["tail"] = rect_hp(tail)
    add("tail:bg", child(tail, "Bg"))
    add("tail:color", child(tail, "BG"))
    t_inner = ui.tailBarImg.read().m_GameObject.read()
    if t_inner.m_Name != "InnerBar":
        sys.exit("BossUi: tailBarImg is not an InnerBar")
    add("tail:fill", child(t_inner, "Texture"), clip=rect_hp(t_inner), fill="horizontal")
    add("tail:highlight", child(t_inner, "Highlight"))
    add("tail:frame", child(tail, "Frame"))
    add_icon("bar:tailOn", child(tail, "FortifiedON"))
    add_icon("bar:tailOff", child(tail, "FortifiedOFF"))
    # armour / shield bars, one BossArmourUI per boss
    seen = []
    for o in env.objects:
        if o.type.name != "MonoBehaviour":
            continue
        c = o.read()
        if script(c) != "BossArmourUI":
            continue
        g = c.m_GameObject.read()
        # the prefab holds each bar once under BossObj; other prefabs carry copies: take the one under BossObj
        if all(g.object_reader.path_id != d.object_reader.path_id for d in descendants(boss_obj)):
            continue
        boss = c.bossID.lower()
        if boss not in _BOSSES or boss in seen:
            sys.exit(f"BossUi: unexpected or duplicate BossArmourUI bossID {c.bossID!r}")
        seen.append(boss)
        in_go = c.img.read().m_GameObject.read()
        fills = [x for x in descendants(in_go) if image(x) is not None and image(x).m_Sprite.path_id
                 and image(x).m_Sprite.read().m_Name not in _PLAIN_SPRITES and not
                 any(script(m) == "Mask" for m in comps(x))]
        edge_go = c.edge.read()
        # the edge object either carries the sprite itself (Dreadbloon's RockEdge) or has one child "Image";
        # its other children are particle bits (gibs, dust, fx), not part of the bar
        cand = [edge_go] if image(edge_go) is not None and image(edge_go).m_Sprite.path_id else             [x for x in children(edge_go) if x.m_Name == "Image"]
        edges = [x for x in cand if image(x) is not None and image(x).m_Sprite.path_id]
        if len(fills) != 1 or len(edges) != 1:
            sys.exit(f"BossUi: armour bar of {c.bossID}: {len(fills)} fill / {len(edges)} edge sprites")
        rects[f"armour:{boss}"] = rect_hp(g)
        add(f"armour:{boss}:fill", fills[0], clip=rect_hp(in_go), fill="horizontal")
        add(f"armour:{boss}:edge", edges[0])
        fr = child(g, "Frame", optional=True)
        if fr is not None and image(fr) is not None and image(fr).m_Sprite.path_id:
            add(f"armour:{boss}:frame", fr)
    if sorted(seen) != sorted(["dreadbloon", "lych", "phayze", "diamondback"]):
        sys.exit(f"BossUi: armour bars found for {seen}")
    # skull marker prefab: a vertical line plus the skull (idle = not reached, activated = reached) and its flames
    mk = ui.skullPrefab.read()
    mk_rt = transform(mk)
    mk_rect = (0.0, 0.0, mk_rt.m_SizeDelta.x, mk_rt.m_SizeDelta.y)

    def mpart(key, go, **extra):
        p = part(go, [_r2(v) for v in (lambda r: (r[0], r[1], r[2] - r[0], r[3] - r[1]))(
            abs_rect(go, mk, mk_rect))])
        p.update(extra)
        parts[key] = p
        return p

    mpart("marker:line", child(mk, "Bar"))
    idle, act = child(mk, "SkullIdle"), child(mk, "SkullActivated")
    pi, pa = part(idle, None), part(act, None)
    if (pi.get("sprite"), pa.get("sprite")) != ("BossSkullPipOff", "BossSkullPipOn"):
        sys.exit(f"BossUi: skull sprites are {pi.get('sprite')}/{pa.get('sprite')}")
    p = mpart("marker:skull", act)
    p.pop("spec"), p.pop("sprite")
    p["art"] = "skull"
    p["artOff"] = "skull:off"
    for nm in ("FireL", "FireR"):
        q = mpart(f"marker:{nm.lower()}", child(act, nm))
        icons["bar:skullFire"] = q.pop("spec")
        q.pop("sprite")
        q["art"] = "bar:skullFire"
    group = next(g for g in descendants(boss_obj) if g.m_Name == "AbilityMarkersGroup")
    marker = {"w": _r2(mk_rt.m_SizeDelta.x), "h": _r2(mk_rt.m_SizeDelta.y), "group": rect_hp(group)}
    # the HUD icons: Bosses data -> boss type -> "<Boss>Btn" / "<Boss>BtnElite" (the HUD icon fields hold the very
    # same Addressables guids as normalBtn / eliteBtn, asserted below)
    genv = UnityPy.load(str(_bundle("game_data_assets_all")))
    types: dict = {}
    items = None
    for o in genv.objects:
        if o.type.name != "MonoBehaviour":
            continue
        n = o.peek_name()
        if n == "Bosses":
            items = o.read_typetree()["BossList"]["items"]
        m = re.fullmatch(r"BossRush(\w+)Data", n or "")
        if m and m.group(1).lower() in _BOSSES:
            types[m.group(1).lower()] = o.read_typetree()["bossType"]
    if not items:
        sys.exit("game_data: Bosses list not found")
    missing = [b for b in _BOSSES if b not in types]
    free = [it["id"] for it in items if it["id"] not in types.values()]
    if len(missing) == 1 and len(free) == 1:  # Vortex has no BossRush data: the one remaining boss type
        types[missing[0]] = free[0]
    if sorted(types) != sorted(_BOSSES) or sorted(types.values()) != sorted(it["id"] for it in items):
        sys.exit(f"Bosses data: cannot map boss types: {types}")
    by_id = {it["id"]: it for it in items}
    for boss, bid in types.items():
        it = by_id[bid]
        if it["normalHudIcon"]["guidRef"] != it["normalBtn"]["guidRef"] or \
                it["eliteHudIcon"]["guidRef"] != it["eliteBtn"]["guidRef"]:
            sys.exit(f"Bosses data: {boss} HUD icon is not its Btn sprite")
        cap = boss.capitalize()
        icons[f"hud:{boss}"] = sprite_spec(f"{cap}Btn")
        icons[f"hud:elite:{boss}"] = sprite_spec(f"{cap}BtnElite")
    # Dreadbloon's tower-set immunity icons (BossUI.primaryImmunity ... supportImmunity)
    for s in ("Primary", "Military", "Magic", "Support"):
        pp = getattr(ui, f"{s.lower()}Immunity", None)
        if pp is None or not pp.path_id or pp.read().m_Name != f"Immunity{s}":
            sys.exit(f"BossUi: {s.lower()}Immunity is not the Immunity{s} sprite")
        icons[f"immunity:{s}"] = sprite_spec(pp.read().m_Name)
    # the HUD icon's place on the bar (BossIcon: same on every boss)
    add("hud", next(g for g in descendants(boss_obj) if g.m_Name == "BossIcon"))
    parts["hud"].pop("spec", None)
    parts["hud"].pop("sprite", None)
    parts["hud"].update(mode="simple", art="hud:<boss>")
    for k in ("w", "h"):
        parts["hud"].pop(k, None)
    out = {"parts": dict(sorted(parts.items())), "rects": dict(sorted(rects.items())), "marker": marker,
           "icons": dict(sorted(icons.items()))}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(out, indent=1, sort_keys=True), "utf-8")
    return out


BOSSBAR_DIR = ART_DIR / "bossbar"


def build_boss_bar(src: "Source", ui: dict) -> dict:
    """Writes each sprite-backed bar part at native size to web/src/art/bossbar/<key>.webp; -> parts with files."""
    out, written = {}, set()
    for key, p in sorted(ui["parts"].items()):
        entry = {k: v for k, v in p.items() if k not in ("sprite", "spec")}
        if p.get("spec"):
            img = src.get(p["spec"])
            if (img.width, img.height) != (p["w"], p["h"]):
                img = img.resize((p["w"], p["h"]), Image.LANCZOS)
            fname = re.sub(r"[^A-Za-z0-9]+", "-", key).strip("-") + ".webp"
            data = webp_bytes(img, **WEBP_SHEET)
            write_if_changed(BOSSBAR_DIR / fname, data)
            written.add(fname)
            entry.update(file=fname, source=p["sprite"], bytes=len(data))
        out[key] = entry
    for f in BOSSBAR_DIR.glob("*.webp"):
        if f.name not in written and not f.name.startswith("hud-"):
            f.unlink()
    total = sum(e.get("bytes", 0) for e in out.values())
    print(f"  bossbar    {len(out)} parts ({len(written)} images, {total / 1024:.1f} KB) from the BossUi prefab")
    return out


def build_boss_hud(src: "Source", ui: dict) -> dict:
    """The boss HUD icons ("hud:<boss>", "hud:elite:<boss>") at native size -> web/src/art/bossbar/hud-*.webp.
    The 96 px boss sheet is too soft for the bar; these keep the sprite's own pixels. -> key -> {file, w, h, bytes}."""
    out = {}
    for key, spec in sorted(ui["icons"].items()):
        if not key.startswith("hud:"):
            continue
        img = src.get(spec)
        fname = "hud-" + re.sub(r"[^A-Za-z0-9]+", "-", key[4:]).strip("-") + ".webp"
        data = webp_bytes(img, **WEBP_SHEET)
        write_if_changed(BOSSBAR_DIR / fname, data)
        out[key] = {"file": fname, "w": img.width, "h": img.height, "bytes": len(data)}
    print(f"  bosshud    {len(out)} icons ({sum(e['bytes'] for e in out.values()) / 1024:.1f} KB)")
    return out


# ─────────────────────────────────────────────────────────────── image helpers


def trim(img: Image.Image) -> Image.Image:
    bbox = img.getchannel("A").point(lambda a: 255 if a > 2 else 0).getbbox()
    return img.crop(bbox) if bbox else img


def fit(img: Image.Image, box: int) -> Image.Image:
    img = trim(img)
    scale = box / max(img.width, img.height)
    w = max(1, round(img.width * scale))
    h = max(1, round(img.height * scale))
    return img.resize((w, h), Image.LANCZOS, reducing_gap=3.0)


def halo(img: Image.Image) -> Image.Image:
    """1px 50%-white outer halo under the sprite."""
    pad = Image.new("RGBA", (img.width + 2, img.height + 2), (0, 0, 0, 0))
    pad.alpha_composite(img, (1, 1))
    grown = pad.getchannel("A").filter(ImageFilter.MaxFilter(3)).point(lambda a: a // 2)
    ring = Image.new("RGBA", pad.size, (255, 255, 255, 0))
    ring.putalpha(grown)
    ring.alpha_composite(pad)
    return ring


def render_cell(img: Image.Image, cell: int, dark: bool) -> Image.Image:
    # 1px margin on every side so the halo (or plain antialiasing) never touches the neighbouring cell.
    inner = cell - 2
    sprite = fit(img, inner)
    if dark:
        sprite = halo(fit(img, inner - 2))
    out = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    out.alpha_composite(sprite, ((cell - sprite.width) // 2, (cell - sprite.height) // 2))
    return out


def webp_bytes(img: Image.Image, **opts) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", **opts)
    return buf.getvalue()


def write_if_changed(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return
    path.write_bytes(data)


# ─────────────────────────────────────────────────────────────── build


def build_family(src: Source, family: str, table: dict, cell: int, aliases: dict) -> dict:
    cells: list[Image.Image] = []
    by_source: dict = {}
    keys: dict = {}
    skipped: list = []
    for key, entry in table.items():
        spec, opts = (entry, {}) if isinstance(entry, str) else entry
        sig = (spec, bool(opts.get("halo")))
        if sig not in by_source:
            try:
                img = src.get(spec)
            except KeyError:
                if opts.get("optional"):
                    skipped.append(key)
                    continue
                sys.exit(f"[{family}] sprite not found for {key!r}: {spec}")
            by_source[sig] = len(cells)
            cells.append(render_cell(img, cell, bool(opts.get("halo"))))
        keys[key] = by_source[sig]
    for alias, target in aliases.items():
        keys[alias] = keys[target]
    n = len(cells)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        sheet.alpha_composite(c, ((i % cols) * cell, (i // cols) * cell))
    data = webp_bytes(sheet, **WEBP_SHEET)
    write_if_changed(ART_DIR / f"{family}.webp", data)
    print(f"  {family:10s} {n:3d} cells {len(keys):3d} keys  {cols}x{rows} @ {cell}px  {len(data) / 1024:6.1f} KB"
          + (f"  (no sprite: {', '.join(skipped)})" if skipped else ""))
    return {"cell": cell, "cols": cols, "rows": rows, "bytes": len(data), "keys": keys, "skipped": skipped}


def map_slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", name) or "map"


def build_maps(src: Source) -> dict:
    out: dict = {}
    written: set = set()
    for m in src.map_details():
        ref = m["mapSprite"]["guidRef"]
        mm = re.fullmatch(r"MapImages\[(.+)\]", ref)
        if m.get("isDebug") or not mm:
            continue
        img = src.get("MapImages/" + mm.group(1))
        if img.width != img.height:
            sys.exit(f"map {m['id']} art is not square ({img.size})")
        opaque = img.getchannel("A").getextrema()[0] == 255
        base = img.convert("RGB") if opaque else img
        encoded = {}
        for s in MAP_SIZES:
            if s > img.width:
                continue
            r = base.resize((s, s), Image.LANCZOS, reducing_gap=3.0)
            encoded[s] = webp_bytes(r, **WEBP_MAP)
        digest = hashlib.sha256(b"".join(encoded[s] for s in sorted(encoded))).hexdigest()[:8]
        slug = map_slug(m["id"])
        urls = {}
        for s, data in encoded.items():
            fname = f"{slug}.{digest}-{s}.webp"
            write_if_changed(MAPS_DIR / fname, data)
            written.add(fname)
            urls[f"s{s}"] = f"/art/maps/{fname}"
        out[m["id"]] = {"urls": urls, "source": mm.group(1), "px": img.width,
                        "bytes": sum(len(d) for d in encoded.values())}
    for f in MAPS_DIR.glob("*.webp"):  # drop stale hashes
        if f.name not in written and not f.name.startswith("hud-"):
            f.unlink()
    total = sum(v["bytes"] for v in out.values())
    print(f"  maps       {len(out)} maps from MapImages ({total / 1024:.0f} KB for all sizes)")
    return dict(sorted(out.items()))


# ─────────────────────────────────────────────────────────────── registry (index.ts)

INDEX_HEAD = '''// Game-art registry: the contract between the art pipeline (scripts/build_art.py, which REGENERATES this
// file) and the UI (web/src/sprite.tsx). Until the pipeline has run, every family is empty and the UI shows
// its text fallbacks, so the site works either way.
//
// Keys are the identifiers the NK Open Data API uses (or, for families the API has no ids for, the
// canonical keys listed per family below). Sheets are uniform grids of square cells; cell `i` sits at
// column i % cols, row floor(i / cols). Art © Ninja Kiwi — extracted from the game for this fan site.
//
// GENERATED by scripts/build_art.py — do not edit by hand (edit the mapping tables there and re-run `npm run art`).
'''

INDEX_TYPES = '''
export interface SpriteSheet {
  /** URL of the WebP sheet (imported so Vite content-hashes it). */
  url: string;
  cols: number;
  rows: number;
  /** Cell size in px (square). Sprites are centred in their cell, aspect preserved. */
  cell: number;
  /** key → cell index */
  keys: Record<string, number>;
}

export type Family =
  /** API tower ids: DartMonkey, BoomerangMonkey, … Skywarden, BeastHandler (see src/nk/types.ts TowerId). */
  | "tower"
  /** API hero ids, default skins: Quincy, Gwendolin, StrikerJones, ObynGreenfoot, … DanDMonke. */
  | "hero"
  /** Event medal tiers as in profile/team medal keys: BlackDiamond, RedDiamond, BlueDiamond, GoldDiamond,
   *  DoubleGold, GoldSilver, DoubleSilver, Silver, Bronze, Participation.
   *  Bare keys are the race (generic event) medals. The game draws different medals per event type, so the
   *  same tier keys also exist with a prefix: "boss:<Tier>" (_medalsBoss), "bossElite:<Tier>"
   *  (_medalsBossElite), "ctLocal:<Tier>" (_medalsCTLocal), "ctGlobal:<Tier>" (_medalsCTGlobal). A prefixed
   *  key is present only if the game has that medal (no boss Participation, no ctGlobal Red/Black Diamond…). */
  | "eventMedal"
  /** Single-player medal keys from UserProfile._medalsSinglePlayer (Easy, PrimaryOnly, Deflation, Medium,
   *  MilitaryOnly, Apopalypse, Reverse, Hard, MagicOnly, DoubleMoabHealth, HalfCash, AlternateBloonsRounds,
   *  Impoppable, CHIMPS-BLACK, Clicks), plus "coop:<same key>" for _medalsMultiplayer.
   *  "Clicks" is NK's internal name for CHIMPS (red medal); CHIMPS-BLACK is the black CHIMPS medal.
   *  Also "Empty" / "coop:Empty": the game's ghost outline for an unearned slot. */
  | "modeMedal"
  /** Rules-panel & UI icons. Keys: LeastCash, LeastTiers, GameTime (stopwatch), BossTier, AllCamo, AllRegen,
   *  FasterBloons, SlowerBloons, FasterMoab, SlowerMoab, FasterBoss, SlowerBoss, BloonBoost, BloonDecreaseHP,
   *  MoabBoost, MoabDecreaseHP, BossBoost, BossDecreaseHP, RegrowRateIncrease, RegrowRateDecrease,
   *  AbilityCooldownIncrease, AbilityCooldownDecrease, NoKnowledge, PowersDisabled, SellingDisabled,
   *  NoContinues, NoDoubleCash, NoInstaMonkeys, ParagonLimit, StartingCash, StartingLives, StartRound,
   *  EndRound, MonkeyMoney, Trophy, CtTickets, Powers, Coop1, Coop2, Coop3, Coop4.
   *  LeastCash/LeastTiers/BossTier/GameTime are the frameless leaderboard icons. AbilityCooldownIncrease is
   *  NK's "cooldown reduction increase" icon (abilities recharge faster, abilityCooldownReductionMultiplier > 1);
   *  AbilityCooldownDecrease the opposite. Extras: LeastCashRule, LeastTiersRule (framed rule versions),
   *  RemovableCostIncrease, RemovableCostDecrease, CeramicIncreaseHP, CeramicDecreaseHP, FastTrackDisabled,
   *  NoLivesLost, Race, Odyssey, ContestedTerritory, CtPoints, Relic (generic relic), MaxTowers, CustomRounds,
   *  mode:<mode>. MonkeyMoney is the game's currency banknote ("BloonjaminsIcon"). */
  | "ui"
  /** API power ids: BananaFarmer, CamoTrap, CashDrop, … Thrive (see PowerId). */
  | "power"
  /** Bloon keys: red, blue, green, yellow, pink, black, white, purple, zebra, lead, rainbow, ceramic, moab,
   *  bfb, zomg, ddt, bad, golden, camo (camo red), regrow (regrow red), fortified (fortified lead),
   *  ceramic-fortified, necro (if present). */
  | "bloon"
  /** Camo / regrow / fortified bloon variants, the game's own sprites (Tools pages only): "<bloon key>:<flags>"
   *  with flags = camo 1 | regrow 2 | fortified 4, e.g. "ceramic:1" (camo ceramic), "lead:6" (regrow fortified
   *  lead), "moab:4" (fortified MOAB). Present only for combos the game model defines and whose icon differs from
   *  the base sprite (a camo DDT is drawn with the plain DDT icon: use the `bloon` key). */
  | "bloonVariant"
  /** Boss types as in Boss.bossType: bloonarius, lych, vortex, dreadbloon, phayze, blastapopoulos, diamondback.
   *  "elite:<bossType>" = the elite portrait. Capitalised aliases (Bloonarius, …, as in bossBadgesNormal) point
   *  at the normal portrait. "skull" = reached skull marker (BossSkullPipOn), "skull:off" = not yet reached
   *  (BossSkullPipOff). "hud:<bossType>" / "hud:elite:<bossType>" = the boss icon on the in-game health bar.
   *  "bar:heatGauge", "bar:heatNeedle" (Blastapopoulos heat gauge), "bar:tailOn" / "bar:tailOff" (Diamondback tail
   *  shield), "bar:skullFire" (flame on a reached skull) = pieces of the in-game bars (see BOSS_BAR).
   *  "spawn:<key>" (+ "spawn:<key>:elite" when the elite icon differs) = spawned bloons by their key in
   *  src/data/bosses.json, from the model's own icon: spawn:DreadRockBloon(:elite), spawn:DiamondbackDiamondBloon
   *  (no usable model icon for MiniLych / Tombstone). */
  /** Official event-type icons (Events panel buttons): boss, race, ct, odyssey, daily, bossRush. */
  | "eventIcon"
  | "boss"
  /** Profile boss badges (UserProfile.bossBadgesNormal/Elite): "<bossType>" = normal (blue) badge,
   *  "elite:<bossType>" = elite (gold) badge. */
  | "bossBadge"
  /** Tower-shop tile backgrounds by category: Primary, Military, Magic, Support, Hero (portrait-shaped
   *  312:368 art centred in a square cell). Power tile backgrounds (hexagons, 308:354, centred): Power (orange,
   *  regular powers), PowerPro (blue, Pro powers: BananaFarmerPro, MonkeyBoostPro, PortableLakePro,
   *  TechBotPrime), PowerStore (purple: potions / store-only powers). In game the power icon sits centred at
   *  ~66% of the tile width, with the count in a yellow-orange circle (NotificationYellow, white text) on the
   *  top-right corner. */
  | "container"
  /** CT relic icons (round, framed) keyed by the relic id as in CT tile types "Relic - <id>": ManaBulwark,
   *  Techbot, AlchemistTouch, CamoFlogged, Fortifried, SuperMonkeyStorm, … all 45 relics the game defines
   *  (incl. MonkeyShield, MonkeyShieldMark2/3, PsiVision, OpenSeason, PrimaryPrimates, MonkeyTycoon, …). */
  | "relic"
  /** Paragon upgrade icons keyed by TowerId (the keys of src/data/paragons.json: DartMonkey, BoomerangMonkey, …
   *  EngineerMonkey), plus ParagonPowerTotem (the Paragon Power Totem tower's portrait). */
  | "paragon"
  /** Social Season badges keyed by UserProfile.seasonBadges ids: SeasonTier1–4, SeasonUltimate1–3 (one per
   *  season: 1 Dr. Monkey, 2 Striker's Vacation, 3 Quincy's Roadtrip), SeasonChampion. */
  | "season";
'''

INDEX_BOSSBAR = '''
/** In-game boss health bar, read from the game's BossUi prefab (scripts/build_art.py boss_ui(); 1 unit = 1 px of
 *  the prefab's reference layout). Parts are keyed "<bar>:<piece>": hp:bg|fill|shade|highlight|frame (the main bar,
 *  shared by every boss), heat:* (Blastapopoulos heat bar), tail:bg|color|fill|highlight|frame (Diamondback tail bar),
 *  armour:<bossType>:fill|edge[|frame] (shield/armour bar: dreadbloon, lych, phayze, diamondback), marker:* (the
 *  line + skull at each threshold, rects relative to the marker), hud (where the boss icon sits) and bar:* icons.
 *  rect = [x, y, w, h] with the origin at the bottom-left of the hp bar, y up; BOSS_BAR_RECT = each whole bar.
 *  mode: "sliced" -> 9-slice (CSS border-image-slice = `slice`, order top right bottom left, source px; centre
 *  not drawn when center === false), "tiled" -> repeat at native size, "filled" -> horizontal fill (crop), "simple"
 *  -> stretch, "color" -> no image, just `tint`. `tint` multiplies the image (#rrggbbaa). ppum = Unity's pixels-per-
 *  unit multiplier (the image is drawn at 1/ppum of its pixel size). clip = the mask rect that a filled bar crops
 *  `fill` content to. url = the piece at native size w x h; art = a key of the "boss" sprite family instead
 *  (artOff = its "not reached" variant). */
export interface BossBarPart {
  url?: string;
  art?: string;
  artOff?: string;
  mode: "simple" | "sliced" | "tiled" | "filled" | "color";
  w?: number;
  h?: number;
  slice?: [number, number, number, number];
  center?: boolean;
  ppum?: number;
  tint?: string;
  fill?: "horizontal";
  rect: [number, number, number, number];
  clip?: [number, number, number, number];
}
'''

INDEX_MAPS = '''
/** Built-in map art by the API's internal map name (ChallengeDocument.map, e.g. "EndOfTheRoad"). */
export interface MapArt {
  /** Square WebP URLs at 96, 200 and 400 px. */
  s96: string;
  s200: string;
  s400: string;
}
'''


def ts_str(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def ts_key(k: str) -> str:
    return k if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", k) else ts_str(k)


def write_index(fams: dict, maps: dict, bar: dict) -> None:
    order = list(FAMILIES)
    lines = [INDEX_HEAD]
    for f in order:
        lines.append(f'import {f}Url from "./{f}.webp";')
    bar_var = {}
    for key, p in [*bar["parts"].items(), *bar["hud"].items()]:
        if "file" in p:
            bar_var[key] = "bossBar_" + re.sub(r"[^A-Za-z0-9]", "_", key)
            lines.append(f'import {bar_var[key]} from "./bossbar/{p["file"]}";')
    lines.append(INDEX_TYPES)
    lines.append("export const ART: Record<Family, SpriteSheet | null> = {")
    for f in order:
        info = fams[f]
        keys = ", ".join(f"{ts_key(k)}: {v}" for k, v in info["keys"].items())
        lines.append(f"  {f}: {{ url: {f}Url, cols: {info['cols']}, rows: {info['rows']}, cell: {info['cell']}, "
                     f"keys: {{ {keys} }} }},")
    lines.append("};")
    lines.append(INDEX_BOSSBAR.rstrip("\n"))
    lines.append("export const BOSS_BAR: Record<string, BossBarPart> = {")
    for key, p in bar["parts"].items():
        fields = ([f"url: {bar_var[key]}"] if key in bar_var else []) + [
            f"{k}: {json.dumps(p[k])}" for k in ("art", "artOff", "mode", "w", "h", "slice", "center", "ppum", "tint",
                                                 "fill", "rect", "clip") if k in p]
        lines.append(f"  {ts_str(key)}: {{ {', '.join(fields)} }},")
    lines.append("};")
    lines.append("export const BOSS_BAR_RECT: Record<string, [number, number, number, number]> = {")
    for key, r in bar["rects"].items():
        lines.append(f"  {ts_str(key)}: {json.dumps(r)},")
    lines.append("};")
    lines.append("/** The skull marker prefab: its size, and the strip (rect, hp-bar space) it is spread along. */")
    lines.append(f"export const BOSS_BAR_MARKER = {json.dumps(bar['marker'])} as const;")
    lines.append('/** The boss icons on the bar at native size: "hud:<bossType>" / "hud:elite:<bossType>" -> { url, w, h }. */')
    lines.append("export const BOSS_HUD: Record<string, { url: string; w: number; h: number }> = {")
    for key, h in bar["hud"].items():
        lines.append(f"  {ts_str(key)}: {{ url: {bar_var[key]}, w: {h['w']}, h: {h['h']} }},")
    lines.append("};")
    lines.append(INDEX_MAPS.rstrip("\n"))
    # Compact table (JS budget): the value is the file's content hash, or "<stem>.<hash>" when the file stem
    # differs from the key (ids with non-alphanumerics, e.g. "#ouch"). Expanded to full URLs once at load.
    lines.append("const MAP_FILES: Record<string, string> = {")
    for name, m in maps.items():
        stem_hash = Path(m["urls"]["s96"]).name[: -len("-96.webp")]
        stem, digest = stem_hash.rsplit(".", 1)
        lines.append(f"  {ts_key(name)}: {ts_str(digest if stem == name else stem_hash)},")
    lines.append("};")
    lines.append("export const MAPS: Record<string, MapArt> = {};")
    lines.append("for (const [name, v] of Object.entries(MAP_FILES)) {")
    lines.append("  const base = `/art/maps/${v.includes(\".\") ? v : `${name}.${v}`}`;")
    lines.append("  MAPS[name] = { s96: `${base}-96.webp`, s200: `${base}-200.webp`, s400: `${base}-400.webp` };")
    lines.append("}")
    write_if_changed(ART_DIR / "index.ts", ("\n".join(lines) + "\n").encode("utf-8"))


def write_manifest(fams: dict, maps: dict, bar: dict) -> None:
    manifest = {
        "generatedBy": "scripts/build_art.py",
        "pipelineVersion": PIPELINE_VERSION,
        "sourceBundles": sorted({_bundle(p).name for p in
                                 ("sprite_atlases_assets_all", "asset_references_assets_all", "game_data_assets_all")}),
        "families": {f: {"cell": i["cell"], "cols": i["cols"], "rows": i["rows"], "bytes": i["bytes"],
                         "keys": sorted(i["keys"]), "missingOptional": i["skipped"]} for f, i in fams.items()},
        "totalSheetBytes": sum(i["bytes"] for i in fams.values()),
        "bossBar": {"parts": bar["parts"], "rects": bar["rects"], "marker": bar["marker"], "hud": bar["hud"]},
        "maps": {n: {"source": m["source"], "px": m["px"], "bytes": m["bytes"], **m["urls"]} for n, m in maps.items()},
    }
    data = (json.dumps(manifest, indent=1, sort_keys=False) + "\n").encode("utf-8")
    write_if_changed(ART_DIR / "manifest.json", data)


# ─────────────────────────────────────────────────────────────── QA contact sheets


def qa_sheets(fams: dict, maps: dict, out_dir: Path) -> None:
    """Render every family at display size (and 2x) on #0a0a0b and on white, labelled, for human review."""
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("arial.ttf", 11)
    except OSError:
        font = ImageFont.load_default()
    for f, info in fams.items():
        sheet = Image.open(ART_DIR / f"{f}.webp").convert("RGBA")
        cell = info["cell"]
        disp = cell // 2
        inv: dict = {}
        for k, v in info["keys"].items():
            inv.setdefault(v, []).append(k)
        n = info["cols"] * info["rows"]
        per_row = 8
        colw, rowh = max(cell, 110) + 10, cell + disp + 44
        for bg, fg, tag in (((10, 10, 11, 255), (230, 230, 230, 255), "dark"),
                            ((255, 255, 255, 255), (20, 20, 20, 255), "white")):
            idxs = [i for i in range(n) if i in inv]
            rows = math.ceil(len(idxs) / per_row)
            img = Image.new("RGBA", (per_row * colw + 10, rows * rowh + 10), bg)
            d = ImageDraw.Draw(img)
            for j, i in enumerate(idxs):
                x, y = 10 + (j % per_row) * colw, 10 + (j // per_row) * rowh
                c = sheet.crop(((i % info["cols"]) * cell, (i // info["cols"]) * cell,
                                (i % info["cols"] + 1) * cell, (i // info["cols"] + 1) * cell))
                img.alpha_composite(c, (x, y))  # 2x (retina) size
                small = c.resize((disp, disp), Image.LANCZOS)
                img.alpha_composite(small, (x + cell + 4 if cell + 4 + disp < colw else x, y + cell + 2))
                d.text((x, y + cell + disp + 4), inv[i][0][:20], fill=fg, font=font)
                if len(inv[i]) > 1:
                    d.text((x, y + cell + disp + 17), ("= " + ", ".join(inv[i][1:]))[:20], fill=fg, font=font)
            img.save(out_dir / f"{f}-{tag}.png")
    # maps: 96 px thumbnails in a labelled grid
    names = list(maps)
    per_row, cw, ch = 10, 110, 124
    img = Image.new("RGBA", (per_row * cw + 10, math.ceil(len(names) / per_row) * ch + 10), (10, 10, 11, 255))
    d = ImageDraw.Draw(img)
    for j, name in enumerate(names):
        x, y = 10 + (j % per_row) * cw, 10 + (j // per_row) * ch
        t = Image.open(MAPS_DIR / Path(maps[name]["urls"]["s96"]).name).convert("RGBA")
        img.alpha_composite(t, (x, y))
        d.text((x, y + 100), name[:17], fill=(230, 230, 230, 255), font=font)
    img.save(out_dir / "maps-dark.png")
    print(f"  QA contact sheets -> {out_dir}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--qa", nargs="?", const=str(CACHE_DIR / "qa"), default=None,
                    help="also render review contact sheets (default dir .wrangler/art-cache/qa)")
    ap.add_argument("--skip-maps", action="store_true", help="reuse maps from the existing manifest")
    args = ap.parse_args()
    if not AA_DIR.is_dir():
        sys.exit(f"BTD6 Addressables not found at {AA_DIR} (set BTD6_DIR)")
    print(f"BTD6: {BTD6_DIR}")
    src = Source()
    # Round sets first: the bloonVariant sheet is built from their bloon types. (build_rounds reads the `bloon`
    # family keys from the previous art index; that table is static.)
    import build_rounds  # round sets -> web/src/data/rounds/ (same install, same determinism rules)

    build_rounds.main()
    import build_bosses  # boss stats -> web/src/data/bosses.json; returns the spawned bloons' icon sprites

    for key, spec in sorted(build_bosses.main().items()):
        BOSSES[key] = spec
    ui = boss_ui(src)
    for key, spec in ui["icons"].items():
        BOSSES[key] = spec
    bar = {"parts": build_boss_bar(src, ui), "rects": ui["rects"], "marker": ui["marker"],
           "hud": build_boss_hud(src, ui)}
    FAMILIES["bloonVariant"] = (bloon_variants(), 64, {})
    FAMILIES["paragon"] = (paragon_icons(), 96, {})
    fams = {f: build_family(src, f, t, c, a) for f, (t, c, a) in FAMILIES.items()}
    print(f"  sheets total {sum(i['bytes'] for i in fams.values()) / 1024:.1f} KB")
    if args.skip_maps and (ART_DIR / "manifest.json").exists():
        old = json.loads((ART_DIR / "manifest.json").read_text("utf-8"))["maps"]
        maps = {n: {"source": m["source"], "px": m["px"], "bytes": m["bytes"],
                    "urls": {k: m[k] for k in ("s96", "s200", "s400")}} for n, m in old.items()}
    else:
        maps = build_maps(src)
    write_index(fams, maps, bar)
    write_manifest(fams, maps, bar)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_names  # game text -> web/src/data/names.ts (same install, same determinism rules)

    build_names.main(relic_ids=RELIC_IDS)
    for stale in ART_DIR.glob("*.webp"):
        if stale.stem not in FAMILIES:
            stale.unlink()
    if args.qa:
        qa_sheets(fams, maps, Path(args.qa))
    print("done")


if __name__ == "__main__":
    main()
