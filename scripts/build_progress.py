#!/usr/bin/env python3
"""Completion totals for the /me page: writes web/src/data/progress.json from the local BTD6 install's own data.
Data (c) Ninja Kiwi - used with the site owner's approval. The save lists only what a player HAS; this is the
"everything that exists" side.

Sources (all read-only), all in the binary GameModel TextAsset "sim_model" (see build_rounds.py, build_paragons.py):
  UpgradeModel records   (build_paragons.parse_upgrades) the XP-buyable tower upgrades are the cost > 0, path 0..2
                         records (hero upgrades cost 0). UpgradeModel has no tower field; the records are stored
                         tower by tower in 15-upgrade blocks (3 paths x 5 tiers), a paragon record after the block
                         of a tower that has one. Tower order = order of the TowerModel runs ("<Id>-000" ...) in
                         sim_model; checked against every paragon ("<TowerId> Paragon" must follow its own block).
  KnowledgeModel records a Model-header run (one per Monkey Knowledge id) followed by 24-byte data records
                         [int32 position][int32 tree][int32 row][int32 cost][int32 id][int32 id2]; tree 0..5 is the
                         MK tab order Primary, Military, Magic, Support, Heroes, Powers (checked on anchor ids).
  HeroDetailsModel_<Id>  one per selectable hero.
Skins and achievements are MonoBehaviours in the "game_data_assets_all" bundle; the asset name (m_Name) is exactly the
save's key / string, however odd ("Biker Bones", "BenJammin", "You've Got the Power"):
  skins          assets with baseTowerName + isDefaultTowerSkin: the non-default, not isHiddenWhenLocked ones (the
                 default skin of each hero is the hero itself, already counted under heroes).
  achievements   the assets listed by the "Achievements" list asset, hidden ones included (hidden = shown as "???"
                 until earned, still earnable). The game has no legacy flag; the save may hold older names not here.
Output is deterministic (sorted keys).

Run: python scripts/build_progress.py   (re-launches itself inside .venv-art)
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

from _common import relaunch_in_venv
from build_paragons import _read_str

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "data" / "progress.json"
TREES = ["Primary", "Military", "Magic", "Support", "Heroes", "Powers"]
# one anchor id per tree, so a changed tab order fails loudly
TREE_ANCHORS = {"FastTackAttacks": "Primary", "NavalUpgrades": "Military", "MagicTricks": "Magic",
                "MonkeyEducation": "Support", "HeroicReach": "Heroes", "BiggerCamoTrap": "Powers"}
BLOCK = 15


def fail(msg: str) -> None:
    sys.exit(f"build_progress: {msg}")


def tower_order(sim: bytes) -> list:
    """Base tower ids in sim_model order: names with a full set of '<Id>-ddd' upgrade-path TowerModels."""
    first, variants = {}, {}
    for m in re.finditer(rb"([\x05-\x40])([A-Za-z]+)-(\d{3})", sim):
        n = m.group(2).decode()
        if len(n) + 4 != m.group(1)[0]:
            continue
        first.setdefault(n, m.start())
        variants.setdefault(n, set()).add(m.group(3))
    return sorted((n for n in first if len(variants[n]) >= BLOCK), key=first.get)


def heroes(sim: bytes) -> list:
    out = []
    for m in re.finditer(rb"([\x11-\x40])HeroDetailsModel_([A-Za-z]+)", sim):
        n = m.group(2).decode()
        if len(n) + 17 == m.group(1)[0] and n not in out:
            out.append(n)
    return out


def upgrades_by_tower(ups: list, towers: list) -> dict:
    out, i, t = {}, 0, 0
    buy = [u for u in ups if u["path"] in (0, 1, 2) and u["cost"] > 0 or u["confirmation"] == "Paragon"]
    while i < len(buy):
        blk = buy[i:i + BLOCK]
        shape = [(u["path"], u["tier"]) for u in blk]
        if len(blk) != BLOCK or shape != [(p, k) for p in range(3) for k in range(5)]:
            fail(f"upgrade block {t} at record {i} is not 3 paths x 5 tiers: {shape}")
        if t >= len(towers):
            fail("more upgrade blocks than towers")
        i += BLOCK
        if i < len(buy) and buy[i]["confirmation"] == "Paragon":
            if buy[i]["name"] != towers[t] + " Paragon":
                fail(f"block {t} is tower {towers[t]} but is followed by {buy[i]['name']!r}; tower order changed?")
            i += 1
        out[towers[t]] = [u["name"] for u in blk]
        t += 1
    if t != len(towers):
        fail(f"{t} upgrade blocks for {len(towers)} towers")
    return out


def knowledge(sim: bytes, rounds) -> list:
    best = []
    for m in re.finditer(re.escape(b"\x0fFastTackAttacks"), sim):
        q = m.start() - 10
        r0 = rounds._header(sim, q)
        if not r0 or r0[1] != "FastTackAttacks":
            continue
        t, names = r0[0], []
        while (r := rounds._header(sim, q)) and r[0] == t:
            names.append(r[1])
            q = r[2]
        if len(names) > len(best):
            best, end = names, q
    if len(best) < 50 or len(set(best)) != len(best):
        fail(f"KnowledgeModel header run not found (best run: {len(best)})")
    out = []
    for k, n in enumerate(best):
        pos, tree, row, cost = struct.unpack_from("<iiii", sim, end + 24 * k)
        if not 0 <= tree < len(TREES) or pos < 0 or cost < 0:
            fail(f"implausible knowledge record for {n!r}: tree {tree} pos {pos} cost {cost}")
        out.append({"id": n, "tree": TREES[tree]})
    for k, want in TREE_ANCHORS.items():
        got = next((e["tree"] for e in out if e["id"] == k), None)
        if got != want:
            fail(f"knowledge anchor {k} is in tree {got}, expected {want}; MK tab order changed?")
    return out


def power_upgrades(sim: bytes) -> dict:
    """Pro-power upgrades: a run of [str '<Power>-ddd'][u8 0][str upgrade name][u8 0] pairs, 9 per power."""
    start = sim.find(b"BananaFarmerPro-100" + bytes(1))
    if start < 0:
        fail("Pro-power upgrade list (BananaFarmerPro-100")
    pos, out = start - 1, {}
    while True:
        try:
            key, p = _read_str(sim, pos)
            m = re.fullmatch(r"([A-Za-z]+)-[0-3]{3}", key)
            if not m or sim[p] != 0:
                break
            name, p = _read_str(sim, p + 1)
        except (UnicodeDecodeError, IndexError):
            break
        out.setdefault(m.group(1), []).append(name)
        pos = p + 1
    if len(out) != 5 or any(len(v) != 9 for v in out.values()) or len({n for v in out.values() for n in v}) != 45:
        fail(f"Pro-power upgrades: expected 5 powers x 9 distinct upgrades, got {({k: len(v) for k, v in out.items()})}")
    return out


def skins_achievements(rounds) -> tuple[list, list]:
    import UnityPy

    env = UnityPy.load(str(rounds._bundle("game_data_assets_all")))
    ach, listed, skins = {}, None, []
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tt = obj.read_typetree()
        if "achievementId" in tt:
            ach[obj.path_id] = tt["m_Name"]
        elif tt.get("m_Name") == "Achievements" and "achievements" in tt:
            listed = [a["m_PathID"] for a in tt["achievements"]]
        elif "baseTowerName" in tt and "isDefaultTowerSkin" in tt and not tt["isDefaultTowerSkin"]                 and not tt["isHiddenWhenLocked"]:
            skins.append(tt["m_Name"])
    if not listed or not skins or any(p not in ach for p in listed):
        fail(f"skins/achievements not found in game_data ({len(skins)} skins, {len(listed or [])} listed)")
    return sorted(set(skins)), sorted({ach[p] for p in listed})


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_paragons
    import build_rounds

    sim = build_rounds.load_sim_model()
    towers = tower_order(sim)
    ids = build_paragons.tower_ids()
    if set(towers) != ids:
        fail(f"towers in sim_model differ from TowerId in src/nk/types.ts: +{sorted(set(towers) - ids)} "
             f"-{sorted(ids - set(towers))}")
    hs = heroes(sim)
    src = (ROOT / "src" / "nk" / "types.ts").read_text(encoding="utf-8")
    hero_ids = set(re.findall(r'"(\w+)"', re.search(r"export type HeroId = Open<(.*?)>;", src, re.S).group(1)))
    if set(hs) != hero_ids:
        fail(f"heroes in sim_model differ from HeroId in src/nk/types.ts: +{sorted(set(hs) - hero_ids)} "
             f"-{sorted(hero_ids - set(hs))}")
    ups = upgrades_by_tower(build_paragons.parse_upgrades(sim), towers)
    names = [n for v in ups.values() for n in v]
    if len(set(names)) != len(names):
        fail("duplicate upgrade names across towers; the save keys upgrades by name only")
    kn = knowledge(sim, build_paragons)
    skins, achievements = skins_achievements(build_rounds)
    data = {"gameVersion": build_rounds.load_game_version(), "towers": sorted(towers), "heroes": sorted(hs),
            "upgrades": ups, "knowledge": kn, "skins": skins, "achievements": achievements,
            "powerUpgrades": power_upgrades(sim)}
    if data["gameVersion"] == "unknown":
        fail("game version not read")
    raw = (json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    if not OUT.exists() or OUT.read_bytes() != raw:
        OUT.write_bytes(raw)
    print(f"  progress   {len(towers)} towers, {len(hs)} heroes, {len(names)} upgrades, {len(kn)} knowledge, "
          f"{len(skins)} skins, {len(achievements)} achievements, "
          f"game {data['gameVersion']} -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    relaunch_in_venv(__file__)
    main()
