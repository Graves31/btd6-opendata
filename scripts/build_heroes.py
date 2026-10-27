#!/usr/bin/env python3
"""Hero XP pipeline: writes web/src/data/heroes.json from the local BTD6 install's own data (for the
Tools -> Hero XP planner). Data (c) Ninja Kiwi - used with the site owner's approval.

Sources (all read-only):
  game_model_assets_all_*.bundle   TextAsset "sim_model" (see build_rounds.py / build_paragons.py):
    * hero levels: UpgradeModel records (build_paragons.parse_upgrades). Each hero has one run of 19 records with
      path 0, tiers 1..19, cost 0; xpCost = the XP that level takes (level 2..20), the hero's XP curve already
      applied (Adora's level 2 = 308 = 180 x 1.71). The run is matched to a hero by its first record's name.
    * Monkey Knowledge (found by name + record shape, every value range-checked):
        MonkeyEducation, SelfTaughtHeroes   TowerXpModModel {float multiplier}: one header run of exactly 3 records
                                            (EliteMilitaryTraining, MonkeyEducation, SelfTaughtHeroes), data = 3 x f32.
                                            In game: TransformTowerXp, xp *= 1 + multiplier, chained per behaviour.
        MonkeysTogetherStrong               HeroXPBonusModModel {float percentMultiplier}: a run of 1 record, 1 x f32.
                                            In game: + that per hero placed, added into Hero.xpBonus (AddXp multiplier).
        EmpoweredHeroes                     HeroXpInjectionModModel {int amount, int levels, bool subtractHeroCost}:
                                            a run of 1 record; the hero is placed `levels` levels up.
  localization_assets_all_*.bundle  "<Hero> Level <n> Description" (what each level does), via build_names.
  globalgamemanagers                the game version.

Game code, not data (Simulation.GetXpForRound / DistributeXpToHeroes, Hero.AddXp / GetCostToLevelUp, v57; read with
Cpp2IL, see CLAUDE.md), so it lives in web/src/heroXp.ts: the XP per round, the map difficulty scale
(Simulation.trackDifficultyXpScale; its 4 floats are checked against global-metadata.dat below), the split between
heroes, float accumulation with carry-over, and $1 per missing XP to buy a level (HeroModel.costPerXpToLevel = 1).

Run:
  python scripts/build_heroes.py    (re-launches itself inside .venv-art; npm run art also runs it)

Output is deterministic (sorted keys): same game build + same script = byte-identical file.
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

from _common import f32, relaunch_in_venv

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "data" / "heroes.json"
FORMAT_VERSION = 1
# Hero ids as the API names them (web/src/roster.ts HERO_ORDER) -> how their level-2 upgrade name starts.
# Extend when NK ships a hero (the script fails until it's listed).
HEROES = {
    "Quincy": "quincy ", "Gwendolin": "gwendolin ", "StrikerJones": "blast radius", "ObynGreenfoot": "obyngreenfoot-",
    "CaptainChurchill": "churchill ", "Benjamin": "benjamin ", "Ezili": "ezili ", "PatFusty": "2 patfusty ",
    "Adora": "adora ", "AdmiralBrickell": "admiralbrickell ", "Etienne": "etienne ", "Sauda": "sauda ", "Psi": "psi ",
    "Geraldo": "geraldo ", "Corvus": "corvus ", "Rosalia": "rosalia ", "Silas": "silas ", "DanDMonke": "dandmonke ",
}
MAP_XP_SCALE = (1.0, 1.1, 1.2, 1.3)  # Simulation.trackDifficultyXpScale (Beginner..Expert), checked in metadata


def fail(msg: str) -> None:
    sys.exit(f"build_heroes: {msg}")


def hero_levels(ups: list) -> dict:
    runs = []
    for i in range(len(ups) - 18):
        r = ups[i:i + 19]
        if [u["tier"] for u in r] == list(range(1, 20)) and all(u["path"] == 0 and u["cost"] == 0 for u in r):
            runs.append(r)
    out, used = {}, set()
    for hero, prefix in HEROES.items():
        hit = [r for r in runs if r[0]["name"].lower().startswith(prefix)]
        if len(hit) != 1:
            fail(f"{hero}: {len(hit)} level runs start with {prefix!r} (need 1)")
        xp = [u["xp"] for u in hit[0]]
        if not all(100 <= x <= 100_000 for x in xp):
            fail(f"{hero}: implausible level XP {xp}")
        out[hero] = xp
        used.add(hit[0][0]["name"])
    if len(runs) != len(HEROES):
        fail(f"{len(runs)} hero level runs in the data, {len(HEROES)} heroes listed; unlisted runs start with "
             f"{sorted(r[0]['name'] for r in runs if r[0]['name'] not in used)}")
    return out


def _header(b: bytes, p: int):
    """[i32 type][u8 0][i32 id][u8 0][u8 len][name] -> (type, name, end) or None."""
    if p < 0 or b[p + 4] != 0 or b[p + 9] != 0:
        return None
    n = b[p + 10]
    name = b[p + 11:p + 11 + n]
    if not name.isascii() or not name.isalnum():
        return None
    return struct.unpack_from("<i", b, p)[0], name.decode(), p + 11 + n


def header_runs(b: bytes, name: str) -> list:
    """Every run of same-type model headers that holds `name` -> [(names, data offset)]."""
    out, a = [], name.encode()
    for m in re.finditer(re.escape(bytes([len(a)]) + a) + rb"(?![A-Za-z0-9])", b):
        h = _header(b, m.start() - 10)
        if not h:
            continue
        t, start = h[0], m.start() - 10
        while True:  # walk back to the run's first header
            for L in range(1, 128):
                r = _header(b, start - 11 - L)
                if r and r[0] == t and r[2] == start:
                    start -= 11 + L
                    break
            else:
                break
        names, q = [], start
        while (r := _header(b, q)) and r[0] == t:
            names.append(r[1])
            q = r[2]
        out.append((names, q))
    return out


def knowledge(sim: bytes) -> dict:
    def only(name: str, names: list) -> int:
        runs = [q for n, q in header_runs(sim, name) if n == names]
        if len(runs) != 1:
            fail(f"Monkey Knowledge {name}: {len(runs)} model runs {names} (need 1); data layout changed?")
        return runs[0]

    _emt, edu, taught = struct.unpack_from(
        "<3f", sim, only("MonkeyEducation", ["EliteMilitaryTraining", "MonkeyEducation", "SelfTaughtHeroes"]))
    mts = struct.unpack_from("<f", sim, only("MonkeysTogetherStrong", ["MonkeysTogetherStrong"]))[0]
    amount, levels, sub = struct.unpack_from("<iiB", sim, only("EmpoweredHeroes", ["EmpoweredHeroes"]))
    if not (0 < edu < 1 and 0 < taught < 1 and 0 < mts < 1) or amount != 0 or not 1 <= levels <= 5 or sub not in (0, 1):
        fail(f"Monkey Knowledge values out of range: {edu} {taught} {mts} {amount} {levels} {sub}")
    return {"monkeyEducation": f32(edu), "selfTaughtHeroes": f32(taught), "monkeysTogetherStrong": f32(mts),
            "empoweredHeroesLevels": levels}


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_names
    import build_paragons
    import build_rounds

    meta = build_rounds.DATA_DIR / "il2cpp_data" / "Metadata" / "global-metadata.dat"
    if meta.read_bytes().count(struct.pack("<4f", *MAP_XP_SCALE)) != 1:
        fail(f"map XP scale {MAP_XP_SCALE} not found once in the game metadata (changed? re-read the game code)")
    sim = build_rounds.load_sim_model()
    levels = hero_levels(build_paragons.parse_upgrades(sim))
    text: dict = {}
    for _sec, i, t in build_names.load_english():
        m = re.fullmatch(r"(\w+) Level (\d+) Description", i)
        if m and m.group(1) in levels:
            text.setdefault(m.group(1), {})[int(m.group(2))] = build_names.clean(t)
    heroes = {}
    for hero, xp in levels.items():
        t = text.get(hero, {})
        if sorted(t) != list(range(1, 21)):
            fail(f"{hero}: level texts for {sorted(t)} (need 1..20)")
        heroes[hero] = {"xp": xp, "text": [t[n] for n in range(1, 21)]}
    data = {"formatVersion": FORMAT_VERSION, "gameVersion": build_rounds.load_game_version(),
            "mk": knowledge(sim), "heroes": heroes}
    if data["gameVersion"] == "unknown":
        fail("game version not read")
    raw = (json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    if not OUT.exists() or OUT.read_bytes() != raw:
        OUT.write_bytes(raw)
    print(f"  heroes     {len(heroes)} heroes, game {data['gameVersion']} -> {OUT.relative_to(ROOT)} "
          f"({len(raw) / 1024:.1f} KB)")


if __name__ == "__main__":
    relaunch_in_venv(__file__)
    main()
