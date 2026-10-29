#!/usr/bin/env python3
"""Game-text pipeline: writes web/src/data/names.ts (map names, ability names, CT relic names + descriptions)
from the local BTD6 install's own data. Text (c) Ninja Kiwi - used with the site owner's approval.

Sources (all read-only, from the Addressables bundles under BloonsTD6_Data/StreamingAssets/aa):
  localization_assets_all_*.bundle  TextAsset "English": the game's English text table (XML, <T id="...">)
  game_data_assets_all_*.bundle     MonoBehaviour "MapDetails": every built-in map id

Run:
  npm run art                         (build_art.py calls this at the end)
  python scripts/build_names.py       (just the names; re-launches itself inside .venv-art like build_art.py)

Output is deterministic (sorted keys): same game build + same script = byte-identical names.ts.
"""
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from _common import AA_DIR, BTD6_DIR, find_bundle, relaunch_in_venv

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "data" / "names.ts"


# ─────────────────────────────────────────────────────────────── ability keys
#
# UserProfile.stats.abilitiesActivatedByName is keyed by the game's AbilityModel.displayName (an internal string:
# "Summon Pheonix", "TakeAim2", "RocketStormMAD", …), not by a localization id. The keys below are every key seen
# in the captured profiles (docs/api/fixtures). The in-game names live in the English table as "<X> Ability" ids
# (sections HeroAbilityNames, AbilityNames, TowerAbilities, TheRest); by default a key K resolves to the id "<K> Ability"
# (compared ignoring case, spaces and apostrophes), else to an id equal to K itself (same normalisation, only if
# the text is K's own name, e.g. "AmbushTech" -> "Ambush Tech"). Keys whose "<X>" is the granting upgrade or level
# rather than the ability's own internal name are listed in ABILITY_SOURCES (reviewed by hand against the game's
# sim model, where each AbilityModel carries displayName, description and addedViaUpgrade). Keys that resolve to
# nothing are left out; the UI falls back to a humanised key.
ABILITY_KEYS = [
    "Absolute Zero", "Ambush Tech", "Anti-Camo Dust", "Anti-CamoDust", "Anti-Regrow Serum", "Arcane Metamorphosis",
    "Armor Piercing Shells", "Artillery Command", "Assassinate MOAB", "Ball of Light", "Battle Cat Transform",
    "Battlecry", "Big Squeeze", "BigThunderAbility", "Biohack", "Blade Maelstrom", "Blast Chain Ability",
    "Blood Sacrifice", "Bomb Blitz", "Bombardment", "Brambles", "Call to Arms", "Carpet Bomb", "ChampionDarkshift",
    "Cocktail of Fire", "Concussive Shell", "Controlled Burst", "Dark Ritual", "Darkshift", "Deploy", "Door Gunner",
    "Drone Swarm", "Eclipse of Fimbulwinter", "Elite Supply Drop", "Emergency Unlock", "Eruption", "Final Strike",
    "Firestorm", "First Strike Capability", "Flight Boost", "Frostbite", "Frozen Burial", "Frozen Cascade",
    "Giga STOMP ", "Glue Storm", "Glue Strike", "Grand Sabotage", "Ground Zero", "Heartstopper", "Homeland Defense",
    "IMF loan", "Indomitable Surface-to-Air Ballistic Missile", "Jungle's Bounty", "Kinetic Charge",
    "Large BAD Harpoon", "Leaping Sword Attack", "LeapingSmash", "Legend of the Night", "Link", "MOAB Barrage",
    "MOAB Hex", "MOAB Takedown", "Marked To Pop", "Marked To Pop2", "Mega Mine", "MermonkyAbility",
    "MermonkyAbilityBig", "Meteor Impact", "Moab Eliminator", "Monkey-Nomics", "Naval Tactics", "Overcharge",
    "Overclock", "Paragon Overclock", "Perma Charge", "Phoenix Rebirth", "Plasma Monkey Fan Club", "Pop And Awe",
    "Primordial Wrath", "Psionic Scream", "Psychic Blast", "Rallying Roar", "Rapid Shot", "Redeploy", "Retaliation",
    "RocketStorm", "RocketStormMAD", "Sabotage", "Sacrificial Totem", "Scatter Missile", "SentryParagonSpawner",
    "Snowstorm", "Soul Harvest", "Special Poperations", "Spike Storm", "Spikeageddon", "Spirit Walk",
    "Storm of Arrows", "Summon Lord Phoenix", "Summon Pheonix", "Super Maelstrom", "Super Monkey Beacon 3",
    "Super Monkey Fan Club", "Supply Drop", "Support Drop", "Sword Charge", "Syphon Funding", "T Rex STOMP",
    "Take Aim", "TakeAim2", "Target Focus", "Tech Terror", "Teleport", "The Anti-Bloon", "The Long Arm of Light",
    "ThunderCharge", "Total Transforming Tonic", "Transform Ability", "Transforming Tonic", "Tsar Bomba",
    "Turbo Charge", "UCAV", "Ultraboost", "Unlink", "Vine Crush", "Vine Rupture", "Wall of Trees", "Warcry",
    "ZOMG Takedown",
]

# key -> localization id whose text is the name, or (id, regex) whose group 1 is the name inside that text.
ABILITY_SOURCES: dict = {
    # tower abilities named after the upgrade that grants them (AbilityModel.addedViaUpgrade / tower tier)
    "Assassinate MOAB": "MOAB Assassin Ability",
    "MOAB Takedown": "Monkey Pirates Ability",
    "Summon Pheonix": "Summon Phoenix Ability",
    "Summon Lord Phoenix": "Wizard Lord Phoenix Ability",
    "Sabotage": "Bloon Sabotage Ability",
    "Grand Sabotage": "Grand Saboteur Ability",
    "RocketStormMAD": "Rocket Storm Ability",  # M.A.D's AbilityModel is the same "RocketStorm" model, upgraded
    "Darkshift": "Dark Knight Ability",
    "ChampionDarkshift": "Dark Champion Ability",
    "Total Transforming Tonic": "Total Transformation Ability",
    "Giga STOMP ": "Giganotosaurus Stomp Ability",
    "Retaliation": "Elite Defender Ability",  # addedViaUpgrade "Elite Defender"
    "Elite Supply Drop": "Elite Sniper Ability",
    "Redeploy": "Support Chinook Redeploy Ability",
    "Support Drop": "Support Chinook Supplies Ability",  # same description text as the AbilityModel
    # powers / perks with their own text ids
    "Anti-Camo Dust": "PerkAntiCamoDust",
    "Anti-CamoDust": "PerkAntiCamoDust",
    "Anti-Regrow Serum": "PerkAntiRegrowSerum",
    "Super Monkey Beacon 3": ("SuperMonkeyBeacon Description", r"with a (Beacon Storm) ability"),
    # abilities only named inside the granting upgrade / hero level description
    "Take Aim": ("Deadeye Description", r"^(Take Aim) ability"),
    "TakeAim2": ("Deadeye Description", r"^(Take Aim) ability"),
    "Marked To Pop": ("Bounty Hunter Description", r"^(Marked to Pop) ability"),
    "Marked To Pop2": ("Bounty Hunter Description", r"^(Marked to Pop) ability"),
    "Target Focus": ("StrikerJones Level 7 Description", r"(Target Focus):"),
    "Scatter Missile": ("Rosalia Level 3 Description", r"^(Scatter Missile) ability"),
    "Flight Boost": ("Rosalia Level 7 Description", r"(Flight Boost) ability"),
    "Kinetic Charge": ("Rosalia Level 10 Description", r"^(Kinetic Charge) ability"),
    "Vine Crush": ("Jungle's Bounty Description", r"(Vine Crush) Ability"),
    "ThunderCharge": ("ThundersDecree Description", r"(Thunder Charge) Ability"),
    "BigThunderAbility": ("ThundersDecree Description", r"(Thunder Charge) Ability"),
    # Dan D'Monke (hero id DanDMonke; the HeMan texts are a skin). Keys are the He-Man-era internal names.
    "Transform Ability": ("DanDMonke Level 3 Description", r"(Transformation) ability"),
    "Teleport": ("DanDMonke Level 7 Description", r"^(Reposition) ability"),
    "Battlecry": ("DanDMonke Level 10 Description", r"^(Rabble Rouser) ability"),
    "LeapingSmash": ("DanDMonkeTransformed Level 7 Description", r"^(Volant Strike) ability"),
    "Warcry": ("DanDMonkeTransformed Level 10 Description", r"^(Berserk Frenzy) ability"),
}



# ─────────────────────────────────────────────────────────────── game data


def _bundle(prefix: str) -> Path:
    return find_bundle(AA_DIR, prefix)


def load_english() -> list[tuple[str, str, str]]:
    """[(section, id, text)] in document order."""
    import UnityPy

    env = UnityPy.load(str(_bundle("localization_assets_all")))
    for obj in env.objects:
        if obj.type.name == "TextAsset" and obj.peek_name() == "English":
            s = obj.read().m_Script
            raw = s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
            root = ET.fromstring(raw)
            out = []
            for sec in root.find("Language"):
                for t in sec:
                    if t.get("id") is not None:
                        out.append((sec.tag, t.get("id"), t.text or ""))
            return out
    sys.exit("English localization TextAsset not found")


def load_map_details() -> list[dict]:
    """MapDetails entries in the game's map-select order, debug maps left out."""
    import UnityPy

    env = UnityPy.load(str(_bundle("game_data_assets_all")))
    for obj in env.objects:
        if obj.type.name == "MonoBehaviour" and obj.peek_name() == "MapDetails":
            return [m for m in obj.read_typetree()["Maps"]["items"] if not m.get("isDebug")]
    sys.exit("MapDetails not found in game_data bundle")


_RECORDS: dict | None = None


def load_game_records() -> dict:
    """One pass over game_data: {"quests": {id: title loc id}, "artifacts": [{key, kind, tier, base, name, icon}]}.

    Quests: QuestData assets (id, questTitleLoc). Rogue Legends artifacts: assets holding one `<kind>ArtifactModel`
    (item / map / boost; the Frontier-only trait kind is left out). The asset name (m_Name) is the id the save uses
    ("BouncingProjectiles3" = baseId + tier + 1); favouriteArtifacts give baseId + 0-based tier instead."""
    global _RECORDS
    if _RECORDS is None:
        import UnityPy

        env = UnityPy.load(str(_bundle("game_data_assets_all")))
        quests, arts = {}, []
        for obj in env.objects:
            if obj.type.name != "MonoBehaviour":
                continue
            tt = obj.read_typetree()
            if "questTitleLoc" in tt:
                quests[tt["id"]] = tt["questTitleLoc"]
            for kind in ("item", "map", "boost"):
                m = tt.get(kind + "ArtifactModel")
                if isinstance(m, dict) and "baseId" in m:
                    arts.append({"key": tt["m_Name"], "kind": kind, "tier": m["tier"], "base": m["baseId"],
                                 "name": m["nameLocKey"], "icon": m["icon"]["guidRef"]})
        if not quests or not arts:
            sys.exit(f"quests/artifacts not found in game_data ({len(quests)} quests, {len(arts)} artifacts)")
        _RECORDS = {"quests": quests, "artifacts": sorted(arts, key=lambda a: a["key"])}
    return _RECORDS


def artifact_aliases(arts: list) -> dict:
    """"<baseId><tier+1>" -> artifact key, where that differs from the asset name (the favouriteArtifacts form)."""
    out = {}
    for a in arts:
        k = f"{a['base']}{a['tier'] + 1}"
        if k != a["key"]:
            if k in out and out[k] != a["key"]:
                out[k] = None  # ambiguous: leave out
            else:
                out[k] = a["key"]
    return {k: v for k, v in out.items() if v and k not in {a["key"] for a in arts}}


# ─────────────────────────────────────────────────────────────── text helpers

_TAG = re.compile(r"</?(?:color|b|i|u|s|size|sprite|style|font|mark|sup|sub|link|align|nobr|lowercase|uppercase|"
                  r"smallcaps|voffset|cspace|mspace|indent|line-height|margin|br)\b[^>]*>", re.I)


def clean(text: str) -> str:
    """Game text -> plain text: drop TextMeshPro rich-text tags, turn literal \\n into spaces, collapse whitespace."""
    text = _TAG.sub("", text).replace("\\n", " ")
    return re.sub(r"\s+", " ", text).strip()


def _norm(s: str) -> str:
    return re.sub(r"[\s'\u2019]", "", s).lower()


# ─────────────────────────────────────────────────────────────── tables


def build_maps(text: dict, map_ids: list[str]) -> tuple[dict, list]:
    # Most names sit in the <Maps> section, newer ones in <TheRest>; ids are unique across sections.
    out, missing = {}, []
    for mid in map_ids:
        if clean(text.get(mid, "")):
            out[mid] = clean(text[mid])
        else:
            missing.append(mid)
    return out, missing


def build_relics(text: dict, relic_ids: list[str] | None) -> dict:
    ids = sorted({m.group(1) for i in text if (m := re.fullmatch(r"Relic([A-Z]\w*)Description", i))
                  and "Relic" + m.group(1) in text})
    if relic_ids is not None and sorted(relic_ids) != ids:
        sys.exit(f"relic ids differ from build_art.RELIC_IDS: extra {sorted(set(ids) - set(relic_ids))}, "
                 f"missing {sorted(set(relic_ids) - set(ids))}")
    return {r: {"name": clean(text["Relic" + r]), "description": clean(text["Relic" + r + "Description"])}
            for r in ids}


# Internal ability keys with no display text in the game files, named from Blooncyclopedia (checked 2026-09-26):
# Mermonkey (BTD6): Arctic Knight's "Ice Jet", which Popseidon enhances; Engineer Monkey (BTD6): Master Builder
# (paragon) deploys Mega Sentries. Keys that already read as names ("Carpet Bomb", …) stay as they are.
WIKI_ABILITY_NAMES = {
    "MermonkyAbility": "Ice Jet",
    "MermonkyAbilityBig": "Ice Jet (Popseidon)",
    "SentryParagonSpawner": "Mega Sentry",
}


def build_abilities(text: dict) -> tuple[dict, list]:
    by_ability: dict = {}  # normalised "<X>" of "<X> Ability" ids -> text
    for i, t in text.items():
        if i.endswith(" Ability"):
            by_ability.setdefault(_norm(i[: -len(" Ability")]), t)
    by_id: dict = {}
    for i, t in text.items():
        by_id.setdefault(_norm(i), t)
    out, unmapped = {}, []
    for k in ABILITY_KEYS:
        src = ABILITY_SOURCES.get(k)
        name = None
        if isinstance(src, str):
            if src not in text:
                sys.exit(f"ability {k!r}: localization id {src!r} not found")
            name = text[src]
        elif isinstance(src, tuple):
            lid, rx = src
            m = re.search(rx, clean(text.get(lid, "")))
            if not m:
                sys.exit(f"ability {k!r}: {rx!r} does not match localization {lid!r}")
            name = m.group(1)
        elif _norm(k) in by_ability:
            name = by_ability[_norm(k)]
        elif k.endswith(" Ability") and _norm(k[: -len(" Ability")]) in by_ability:
            name = by_ability[_norm(k[: -len(" Ability")])]
        elif _norm(k) in by_id and _norm(by_id[_norm(k)]) == _norm(k):
            name = by_id[_norm(k)]
        if name:
            # three hero entries read "Frostbite Ability" etc.; the rest of the table has no suffix
            out[k] = re.sub(r"\s+Ability$", "", clean(name))
        else:
            unmapped.append(k)
    return out, unmapped


# ─────────────────────────────────────────────────────────────── output

HEAD = """// Display names and texts from the game's own data (© Ninja Kiwi), keyed by the ids the API uses.
// GENERATED by scripts/build_names.py (run by `npm run art`) from the local BTD6 install: the English localization
// table and MapDetails. Do not edit by hand. Keys missing here fall back to humanised ids in the UI.
"""


def _lit(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def _obj(d: dict, fmt) -> str:
    if not d:
        return "{}"
    return "{\n" + "".join(f"  {_lit(k)}: {fmt(v)},\n" for k, v in sorted(d.items())) + "}"


def map_list(details: list[dict], maps: dict) -> list:
    # isBrowserOnly = maps outside the Steam game (Blons, Protect the Yacht, the editor's base map): left out.
    # difficulty 0-3 = Beginner..Expert (checked: Monkey Meadow 0, Logs 0, Infernal 3, #ouch 3).
    return [(m["id"], m["difficulty"], bool(m["hasWater"])) for m in details
            if not m.get("isBrowserOnly") and m["id"] in maps]


def build_quests(text: dict) -> dict:
    quests = load_game_records()["quests"]
    if missing := [k for k, v in quests.items() if v not in text]:
        sys.exit(f"quests without an English title: {missing}")
    return {k: clean(text[v]) for k, v in quests.items()}


_RARITY = re.compile(r"\s*(?:\{0\}|Common|Rare|Legendary)$")


def build_artifacts(text: dict) -> dict:
    """Display name per artifact key (+ the favouriteArtifacts aliases). The game's names end in the rarity ("{0}" or
    spelled out); the tier is in the key, so it is dropped here."""
    arts = load_game_records()["artifacts"]
    out = {}
    for a in arts:
        if a["name"] in text:  # a few (unused test artifacts) have no text: the UI humanises their key
            out[a["key"]] = _RARITY.sub("", clean(text[a["name"]]))
        else:
            print(f"  names      artifact {a['key']}: no English text for {a['name']!r}")
    for alias, key in artifact_aliases(arts).items():
        if key in out:
            out[alias] = out[key]
    return out


def render(maps: dict, abilities: dict, relics: dict, mlist: list, quests: dict, artifacts: dict) -> str:
    rel = lambda v: "{ name: %s, description: %s }" % (_lit(v["name"]), _lit(v["description"]))  # noqa: E731
    rows = "".join(f"  [{_lit(i)}, {d}, {'true' if w else 'false'}],\n" for i, d, w in mlist)
    return (
        HEAD
        + '\n/** Built-in map id (ChallengeDocument.map, e.g. "AdorasTemple") → in-game name ("Adora\'s Temple"). */\n'
        + f"export const MAP_NAMES: Record<string, string> = {_obj(maps, _lit)};\n"
        + "\n/** Maps of the Steam game in map-select order: [map id, difficulty 0 Beginner..3 Expert, has water]. */\n"
        + f"export const MAP_LIST: readonly (readonly [id: string, difficulty: 0 | 1 | 2 | 3, water: boolean])[] = [\n{rows}];\n"
        + '\n/** Ability key as in UserProfile.stats.abilitiesActivatedByName (e.g. "TakeAim2") → in-game name. */\n'
        + f"export const ABILITY_NAMES: Record<string, string> = {_obj(abilities, _lit)};\n"
        + '\n/** CT relic id as after "Relic - " in CT tiles (e.g. "ManaBulwark") → in-game name + effect description. */\n'
        + f"export const RELIC_INFO: Record<string, {{ name: string; description: string }}> = {_obj(relics, rel)};\n"
        + '\n/** Quest id as in save.quests[].id (e.g. "BattleCatQuest") → in-game quest title. */\n'
        + f"export const QUEST_NAMES: Record<string, string> = {_obj(quests, _lit)};\n"
        + '\n/** Rogue Legends artifact key (the save id: "OneShot2" = base + tier 1..3; favouriteArtifacts: name + (tier + 1)) → name without the rarity. */\n'
        + f"export const ARTIFACT_NAMES: Record<string, string> = {_obj(artifacts, _lit)};\n"
    )


def main(relic_ids: list[str] | None = None) -> None:
    if not AA_DIR.is_dir():
        sys.exit(f"BTD6 Addressables not found at {AA_DIR} (set BTD6_DIR)")
    text: dict = {}
    for sec, i, t in load_english():
        if i in text and text[i] != t:  # never happened so far; keep the first (document order) but say so
            print(f"  names      note: id {i!r} has two texts; using the first ({sec} has another)")
        text.setdefault(i, t)
    details = load_map_details()
    maps, no_map = build_maps(text, [m["id"] for m in details])
    mlist = map_list(details, maps)
    relics = build_relics(text, relic_ids)
    abilities, no_ability = build_abilities(text)
    for k, v in WIKI_ABILITY_NAMES.items():  # keys the game text doesn't name (checked on Blooncyclopedia)
        if k not in abilities:
            abilities[k] = v
            no_ability = [x for x in no_ability if x != k]
    quests = build_quests(text)
    artifacts = build_artifacts(text)
    data = render(maps, abilities, relics, mlist, quests, artifacts).encode("utf-8")
    if not OUT.exists() or OUT.read_bytes() != data:
        OUT.write_bytes(data)
    print(f"  names      {len(maps)} maps ({len(mlist)} listed), {len(abilities)}/{len(ABILITY_KEYS)} abilities, {len(relics)} relics, {len(quests)} quests, {len(artifacts)} artifacts"
          f" -> {OUT.relative_to(ROOT)} ({len(data) / 1024:.1f} KB)")
    if no_map:
        print(f"             maps without a name: {', '.join(no_map)}")
    if no_ability:
        print(f"             abilities without a game name: {', '.join(repr(k) for k in no_ability)}")


if __name__ == "__main__":
    relaunch_in_venv(__file__)
    main()
