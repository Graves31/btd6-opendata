#!/usr/bin/env python3
"""Boss-stats pipeline: writes web/src/data/bosses.json from the local BTD6 install's own data.
Data (c) Ninja Kiwi - used with the site owner's approval.

Sources (all read-only):
  game_model_assets_all_*.bundle   TextAsset "sim_model" (NK's binary game model), via build_rounds' loader and
                                   BloonModel decoder: health, flags, property bitmask, icon. Read here on top:
                                   speed, the tags pointer, and the bosses' health-percent triggers (skulls).
  localization_assets_all_*.bundle English text (boss name, taglines, info-panel bullets), via build_names.
  globalgamemanagers               game version, via build_rounds.load_game_version.
  il2cpp_data/Metadata/global-metadata.dat   the game's IL2CPP metadata (v39): the TowerSet enum (value -> name) and
                                   the names + declaration order of the fields of every model class under
                                   Assets.Scripts.Models.Bloons* (HealthPercentTriggerModel, TimeTriggerModel, ...).

sim_model layout used here (reverse-engineered; every assumption is re-checked on each run, see CHECKS):
  - The file starts with shared array pools: [i32 count] + count items, back to back, one pool per element type.
    Every pool item (and every model object after the pools) has a global object number, assigned in file
    order. Objects point at arrays / other objects by that number.
      string[] pool item: [i32 n] n x ([u8 0][7-bit-len str])     (build_rounds._read_arr)
      float[]  pool item: [i32 n] n x f32
  - Then object sections: [i32 first object number][i32 count] + count headers
    ([i32 type][u8 0][i32][u8 0][str name]) + count data records. The BloonModel section is the one
    build_rounds finds (build_rounds._header_run).
  - BloonModel block (br.BLOCK bytes; on top of build_rounds' fields): +4 i32 = object number of the bloon's tags
    string[]; +8 i32 = a per-bloon marker that also heads the bloon's reference list (the object numbers of
    its behaviours); +br.SPEED_AT f32 = speed.
  - Health-percent triggers ("skulls"): fixed-size records holding, side by side, an i32 pointer to a float[]
    of health fractions (strictly descending, in (0, 1)) and an i32 pointer to the string[] of action names
    run at each threshold. They are found by that shape, not by their (unnamed) type number.
  - Shields ("shield" per tier): sections whose records start with a column of action-name strings
    ([u8 0][str] x count) that skull triggers run, followed by one row per record in one of two decoded shapes:
      A  [u8 0][str name][i32][f32 shield health][i32][f32]       (Dreadbloon: GenerateArmour, "DreadbloonCeramic<n>")
      B  [u8 0][str name][f32 shield health][u8 0 + str | u8 1]  (Phayze: CamoShield)
    A shape counts only if all rows parse and end exactly where the next section starts. "per": "skull" = the
    record's action is in that tier's skull action list (the shield is (re)built at each skull).
    The data has NO "starts with the shield" field (GenerateArmour / CamoShield appear only in the skull action
    lists and the matching record columns; no other trigger runs them), so the output has no "start" key.
  - Tower-set immunity ("immunity" per tier, Dreadbloon): the section whose action column holds "ApplyImmunity" has
    one row per tier, [u8 0][str name][i32 pointer], the pointer being an ApplyTowerSetImmunityModel.immunities
    array (pointers of the 10 rows are consecutive). The arrays sit in one pool of exactly that many arrays, found
    by shape (not by object number): [i32 n] n x ([u8 len][str id][i32 TowerSet]), id "Phase<k>". TowerSet values
    (flags) come from the metadata enum Assets.Scripts.Models.TowerSets.TowerSet (Primary=1, Military=2, Magic=4,
    Support=8). Entry 0 = the immunity the boss spawns with, entry k = after skull k, so len = skulls + 1 (elite:
    the four sets twice). Output: "immunity": ["Primary", "Military", ...].

  - Model classes (behaviours): every object section is typed by a number = the rank of its model class in the
    case-insensitive sort of "<namespace>.<class>" over the Assets.Scripts.Models.Bloons* classes, plus a constant
    (fixed by the section whose objects are named "DamageStateModel_<n>"; the BloonModel section must then land on the
    BloonModel class). A section holds, for action classes (BloonBehaviorActionModel.actionId), first one string per
    record (the action id), then one row per record with the class's own stored fields in declaration order: f32 floats,
    i32 ints / pointers, u8 bools, [u8 0][len str] strings ([u8 1] = null), [u8 len][chars] asset ids. Fields the game
    keeps in the class but derives at load (mutators, *Frames values, constant ids) are not stored. The layouts used
    are _SPEC; each section must parse to exactly its end.
  - A bloon's behaviours: every bloon's +8 marker occurs twice in the file, once in its block and once at the head of
    its reference list (object numbers of its behaviour models, up to the next bloon's marker), in the region after the
    last object section. The first list entry is the bloon's own object number (outside the sections).

NEW OUTPUT (per boss tier row; nothing existing changes except that Bloonarius' repeating trigger moves from
"triggers" into "passives"). Names are the game's own field names; units: seconds for every duration / interval /
delay (the Phayze timer reads 24 = the game's own "every 24 seconds"; Retribution / Dynamite bloons use the same
fields with values 1.5 / 3 / 6 that read as seconds), game distance units for radius / spacing / offsets, fractions of
max health for *Percent / threshold values (0.01 = 1 %), plain multipliers for *Multiplier.
  "skullTrigger": {"preventFallthrough": bool}   HealthPercentTriggerModel.preventFallthrough of the skull trigger (for
        Lych LychBossSuperScriptModel.preventFallthrough). Bloonarius false, everyone else true. Meaning of the flag
        (several skulls crossed by one hit fire only one?) is not confirmed from the data.
  "passives": [ ... ]   behaviours that are not "run these actions at each skull", in game order:
    {"kind": "everyHealth", "step": 0.01, "do": [...]}   a HealthPercentTriggerModel with repeatFirst = true and one
        percentage value (Bloonarius, all 10 tiers, the only trigger with repeatFirst): runs "do" every `step` of
        health lost instead of once at a skull. The skull triggers all have repeatFirst = false. (Source fields:
        repeatFirst, percentageValues, actionIds; "repeats every 1 %" is the field's meaning plus the owner's report -
        the game code that applies it is not read.)
    {"kind": "timer", "seconds": s, "immediately": bool, "do": [...]}   TimeTriggerModel.interval /
        triggerImmediately / actionIds: Vortex 5 s (storm pulse: DestroyProjectiles), Phayze two at 24 s (Radar Jam;
        the first also fires at spawn), Blastapopoulos 2 s (RemoveAllDot, burns off damage-over-time).
    Lych: {"kind": "timer", "name": "drain"|"regrow"|"tombstone", "seconds": <name>Interval, "first":
        <name>InitialInterval, "afterEtherealExit": <name>EtherealExitInterval, "do": <name>ActionIds} (regrow also
        carries regrowDrainInterval, meaning unknown); {"kind": "tombstones", tombstone{,Moab,Bfb,Zomg}HealthOverride,
        tombstoneSpawnSpeedModifier}; {"kind": "ethereal", "enter": etherealEnterActionIds, "exit":
        etherealExitActionIds}; {"kind": "worthReduction", "worthMultiplier"} (WorthReductionModel).
    {"kind": "heat", ...}  OverheatTriggerModel fields (maxHeatLevel, heatEffectCooldown, heatEffectDuration,
        immuneHeat, damagedHeat, heatIdleDelay, abilityCooldownAddition, passiveHeatReduction, idleHeatReduction,
        iceHeatReduction, projectileBurnLifespan, heatDecayStrength, stunDuration, abilityCooldownHeatModifier,
        abilityTowerFilter, fillHeatOnSpawn); {"kind": "rangeZone", "rangeMultiplier"} and {"kind":
        "abilityCooldownZone", "multiplier"} (Blastapopoulos' RangeReductionZoneModel / AbilityCooldownZoneModel).
    {"kind": "phayze", "shieldSpeedBoost", "powerLevels"} (PhayzeBehaviorModel; powerLevels has one value per skull on
        every tier, meaning not stated by the data); {"kind": "diamondback", ...DiamondbackBehaviorModel fields:
        numOfMiddleSegments (= number of skulls), segmentSpacing, extraHeadSpacing, extraTailSpacing,
        tailShieldRegenerateTime, skullInvulnerableTime, bloonBleedHealthPercent, tailShieldMaxHealthPercent,
        tailDamageMultiplier, tailShieldBrokenActionId, tailShieldRegenerateActionId, skullActionId};
    {"kind": "damageReduction", "amount"} (Dreadbloon, DamageReductionModel.amount); {"kind": "speedBoost",
        "speedBoost", "debuffInRadius"} (Vortex, BuffBloonSpeedModel; units unconfirmed).
  "actions": {action id: [model, ...]}   every non-cosmetic action model of the tier by action id (the ids that
        "skulls[].do", "triggers[].do" and "passives[].do" name; several models may share an id and all run). A model is
        {"model": <class short name>, <the class's own field names>...}; "then": [ids] is the model's actionIds (what
        it runs afterwards). Classes: SpawnBloons (bloonType, spawnCount, spawnOverTime, spawnDistAhead, spawnTrackMin,
        spawnTrackMax, animationLength, invulnerableWhileAnimating; spawnOverTime is seconds but whether it is the
        whole span or the gap between spawns is not stated), SpawnTombstone, StunTowers (radius, stunDuration,
        paragonStunTimeMultiplier, blockTowerSelling), SetInvulnerable (set), SetSpeedPercent (percent, revert, time,
        distance), WaitForSeconds (delayTime, then), DestroyProjectiles, ReflectProjectiles, HealSelf, AbsorbTowerBuffs,
        RemoveAllMutators, GenerateArmour / GenerateShield (amount = the shield's health), SpawnBloonsUntilArmourBreaks,
        Fireball, CreateProps, AddHeat, RemoveAllDot, DashForwards, RedirectBloonSpawn, ThrowBloons (addCamo, ...),
        PhayzeTimer (restore), PlayAnim (only when it pauses the boss: pauseMovementDuration).
  "noModel": [ids]   action ids a trigger runs that have no model in the tier (Lych 1: SpawnLychSoul3 - only two soul
        spawns exist for it).
  Speed: BloonModel.speed (f32 at +br.SPEED_AT of the block; its *Frames twin is not stored); Red = the top-level
  "speed.Red" (25), so a boss's "% of a Red bloon" is speed / speed.Red.

CHECKS (any failure exits loudly; nothing is written unless every check passes):
  1. block walk == build_rounds' decode (health of every bloon); BloonModel section header consistent.
  2. tags pointer: for EVERY bloon build_rounds attaches tags to, the string[] at its +4 object number equals
     those tags (fixes the string pool's numbering; exactly one placement may pass).
  3. speed: Red < Blue < Green < Yellow; no MOAB-class standard bloon except the DDT faster than Red, and
     some strictly slower (the MOAB itself equals Red in the data);
     identical across every Camo/Regrow/Fortified variant of a bloon.
  4. float pool numbering: every trigger record's float[] must be strictly descending fractions in (0, 1)
     (exactly one numbering of the float[] items may fit; since v57 the pool counts don't give it).
  5. skull ownership, two independent ways that must agree on EVERY trigger record: (a) the record's object
     number appears in a bloon's reference list, right after that bloon's +8 marker; (b) its action string[]
     lies in the string pool between that bloon's tags array and the next bloon's.
  6. every boss tier (Normal 1-5, Elite 1-5) has exactly one skull trigger (the one with most thresholds).
  8. shields: the record's owner from the reference list (5a) must be the boss tier whose skull actions contain
     the record's action; a trailing tier number in the row's name must match; at most one shield per tier;
     shield health present on all 5 tiers of a mode and strictly increasing. Shields with health <= 0
     (Diamondback tail: -1) are left out.
  9. immunity: rows' owners (5a) are boss tiers whose skull actions contain the row's action; pointers consecutive;
     exactly one array pool of that shape; array k belongs to row k; entries are TowerSet values and
     len == skulls + 1 on every tier; the game's own "<Boss><Set>Immunity" text exists for every set used;
     TowerSet enum: metadata version 39, names Primary/Military/Magic/Support are distinct powers of two,
     AllMonkeyTowerSets == their OR, None == 0.
 10. model classes: the DamageStateModel and BloonModel anchors agree; every _SPEC class exists once in the metadata with
     its decoded fields in declaration order; every section of such a class parses to exactly its end; BloonModel has
     a `speed` field; BloonBehaviorActionModel has `actionId`.
 11. reference lists: every skull trigger record lies in the list of the bloon the string pool names; each boss tier's
     list has exactly one entry outside the sections and no behaviour class outside _SPEC / _IGNORED_MODELS.
 12. values (check_behaviour): numbers finite / in range, spawned bloons exist, tier order (Vortex stun, Dreadbloon armour,
     Blastapopoulos heat bar, Lych tombstone health), Dreadbloon armour and Phayze shield = the shields decoded in 8,
     Phayze 24 s = the description's "every 24 seconds", ThrowBloons.addCamo = "Camo property", Dreadbloon damage
     reduction = the description's number, Diamondback middle segments = skulls, Phayze powerLevels = skulls, the
     Bloonarius repeating step is below the skull spacing and only Bloonarius has one.
  7. property bits: named by the (shortest-id) standard bloon carrying exactly that bit (Lead, Black, ...); every standard
     bloon's mask must be a combination of named bits.

Run:
  npm run art                        (build_art.py calls this after build_rounds)
  python scripts/build_bosses.py     (just the bosses; re-launches itself inside .venv-art)

Output is deterministic (sorted keys, float32 values as their shortest round-trip decimals): same game build +
same script = byte-identical file.
"""
from __future__ import annotations

import bisect
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "data" / "bosses.json"
FORMAT_VERSION = 1


def _relaunch_in_venv() -> None:
    for rel in ("Scripts/python.exe", "bin/python"):
        venv_py = ROOT / ".venv-art" / rel
        if venv_py.exists():
            if Path(sys.prefix).resolve() != (ROOT / ".venv-art").resolve():
                sys.exit(subprocess.call([str(venv_py), __file__, *sys.argv[1:]]))
            return


sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_names as bn  # noqa: E402
import build_rounds as br  # noqa: E402

# Spawned bloons shown per boss: (key, normal id pattern, elite id pattern). The ids must exist in the model;
# each tier is marked "used" only if some behaviour record references its id. NOT the Diamondback segments
# (Head/Middle/Tail: placeholder health 999999999).
SPAWNS = {
    "lych": [("MiniLych", "MiniLych{}", "MiniLychElite{}"), ("Tombstone", "Tombstone{}", "TombstoneElite{}")],
    "dreadbloon": [("DreadRockBloon", "DreadRockBloonStandard{}", "DreadRockBloonElite{}")],
    "diamondback": [("DiamondbackDiamondBloon", "DiamondbackDiamondBloon{}", "DiamondbackDiamondBloonElite{}")],
}
_FLAG_NAMES = (("Camo", 1), ("Regrow", 2), ("Fortified", 4))


def fail(msg: str) -> None:
    sys.exit(f"bosses: {msg}\n  sim_model layout changed? nothing written ({OUT.relative_to(ROOT)})")


def _i32(b: bytes, p: int) -> int:
    return struct.unpack_from("<i", b, p)[0]


def _f32(b: bytes, p: int) -> float:
    return struct.unpack_from("<f", b, p)[0]


# ─────────────────────────────────────────────────────────────── BloonModel blocks


def bloon_blocks(sim: bytes, bloons: dict) -> tuple[dict, int, int, int]:
    """-> ({id: block offset}, BloonModel section first object number, section start, section end)."""
    ids, end = br._header_run(sim)
    start = end - sum(11 + len(i) for i in ids)  # [i32 type][u8 0][i32][u8 0][u8 len][name]
    p = start
    for bid in ids:
        name, p = br._read_str(sim, p + 10)
        if name != bid:
            fail(f"BloonModel header list does not re-read ({name!r} != {bid!r})")
    if _i32(sim, start - 4) != len(ids):
        fail("BloonModel section count does not match its header list")
    first_obj = _i32(sim, start - 8)
    blocks, pos = {}, end
    for bid in ids:  # same record walk as build_rounds.parse_bloon_models, keeping the block offsets
        m = re.compile(re.escape(b"\x00" + bytes([len(bid)]) + bid.encode()) + rb"\x00").search(sim, pos)
        if not m:
            fail(f"BloonModel record {bid!r} not found")
        q = m.start() + 1
        _id, q = br._read_str(sim, q)
        _base, q = br._read_str(sim, q + 1)
        _disp, q = br._read_str(sim, q)
        _icon, q = br._read_str(sim, q)
        blocks[bid] = q
        pos = q + br.BLOCK
        if _i32(sim, q + br.HP_AT) != bloons[bid]["hp"]:
            fail(f"block walk disagrees with build_rounds on {bid!r}")
    return blocks, first_obj, start - 8, pos


# ─────────────────────────────────────────────────────────────── string[] pool


def _tags_bytes(tags: list) -> bytes:
    return struct.pack("<i", len(tags)) + b"".join(b"\x00" + bytes([len(t)]) + t.encode() for t in tags)


def string_pool(sim: bytes, bloons: dict, blocks: dict) -> tuple[dict, int, int]:
    """-> ({object number: string[]} from the first bloon's tags array to the end of the pool, number after the
    pool's last array, byte offset where the pool ends). CHECK 2."""
    tagged = json.loads(json.dumps(bloons))
    have = br.attach_tags_children(sim, tagged)
    if len(have) < 50:
        fail(f"build_rounds attached tags to only {len(have)} bloons")
    ref = {bid: _i32(sim, p + 4) for bid, p in blocks.items()}
    first = min(ref, key=ref.get)
    if first not in have:
        fail(f"first bloon by tags pointer ({first}) has no build_rounds tags")
    good = []
    for m in re.finditer(re.escape(_tags_bytes(tagged[first]["tags"])), sim):
        arrs, p = {}, m.start()
        n = ref[first]
        while (r := br._read_arr(sim, p)) is not None:
            arrs[n] = r[0]
            n += 1
            p = r[1]
        if all(arrs.get(ref[b]) == tagged[b]["tags"] for b in have) and all(v in arrs for v in ref.values()):
            good.append((arrs, n, p))
    if len(good) != 1:
        fail(f"tags pointer check: {len(good)} string-pool placements agree with build_rounds' tags (need 1)")
    print(f"  bosses     tags pointer == build_rounds tags on all {len(have)} tagged bloons")
    return good[0]


# ─────────────────────────────────────────────────────────────── pools after the string pool (-> float[] pool)


def _parse_pool(sim: bytes, kind: str, p: int):
    cnt = _i32(sim, p)
    if not 0 < cnt < 1_000_000:
        return None
    q = p + 4
    try:
        for _ in range(cnt):
            if kind in ("A4", "A1", "A8", "A12", "A16"):
                n = _i32(sim, q)
                if not 0 <= n < 200_000:
                    return None
                q += 4 + {"A4": 4, "A1": 1, "A8": 8, "A12": 12, "A16": 16}[kind] * n
            elif kind == "S4":
                q += 4
            elif kind in ("AS", "AT"):  # string arrays: [u8 flag][str] / [str][u8 flag] elements
                n = _i32(sim, q)
                if not 0 <= n < 100_000:
                    return None
                q += 4
                for _ in range(n):
                    if kind == "AS":
                        f = sim[q]
                        q += 1
                        if f == 0:
                            _s, q = br._read_str(sim, q)
                        elif f != 1:
                            return None
                    else:
                        _s, q = br._read_str(sim, q)
                        if sim[q] > 1:
                            return None
                        q += 1
            elif kind == "SS":
                f = sim[q]
                q += 1
                if f == 0:
                    _s, q = br._read_str(sim, q)
                elif f != 1:
                    return None
            if q > len(sim):
                return None
    except (IndexError, struct.error):
        return None
    return q


_KINDS = ("A4", "AS", "AT", "S4", "A1", "A8", "SS", "A12", "A16")


def _solve(sim: bytes, p: int, depth: int):
    if depth == 0:
        return [] if 0 < _i32(sim, p) < 1_000_000 else None
    for k in _KINDS:
        e = _parse_pool(sim, k, p)
        if e is not None and 0 < _i32(sim, e) < 1_000_000:
            rest = _solve(sim, e, depth - 1)
            if rest is not None:
                return [(k, p, e)] + rest
    return None


def float_items(sim: bytes, start: int, stop: int) -> list:
    """The float[] pool items ([i32 n][n x f32]), read from the first item of the first 4-byte-element pool after
    the string pool for as long as items parse. Since v57 the pool walk's counts no longer give their object
    numbers (it lands 392 short) and the items run on past that pool's count, so they are numbered by the
    skull triggers instead (anchor_floats)."""
    p = start
    while p < stop:
        s = _solve(sim, p, 2)
        if not s:
            break
        kind, a, e = s[0]
        if kind == "A4":
            items, q = [], a + 4
            while 0 <= (n := _i32(sim, q)) < 5000 and q + 4 + 4 * n <= stop:
                items.append(list(struct.unpack_from(f"<{n}f", sim, q + 4)))
                q += 4 + 4 * n
            return items
        p = e
    fail("float[] pool not found after the string pool")


# ─────────────────────────────────────────────────────────────── object sections, trigger records


def object_sections(sim: bytes, bloon_sec: int, first_obj: int) -> list:
    rx = re.compile(rb"(?s)(?=(.{3}\x00)(.{2}\x00\x00)(.{2}\x00\x00)\x00)")
    found = []
    for m in rx.finditer(sim, bloon_sec):
        q = m.start()
        base, cnt, _t = struct.unpack_from("<iii", sim, q)
        if base < first_obj or not 0 < cnt < 5000 or (found and q < found[-1]["dstart"]):
            continue
        p, ok = q + 8, True
        for _ in range(cnt):
            t, n = _i32(sim, p), sim[p + 10] if p + 10 < len(sim) else 0x80
            if sim[p + 4] != 0 or sim[p + 9] != 0 or not 0 < t < 5000 or n >= 0x80 or \
                    not re.fullmatch(rb"[ -~]*", sim[p + 11:p + 11 + n]):
                ok = False
                break
            p += 11 + n
        if ok:
            found.append(dict(off=q, base=base, cnt=cnt, dstart=p))
    for a, b in zip(found, found[1:]):
        a["dend"] = b["off"]
    if found:
        found[-1]["dend"] = len(sim)
    return found


def _is_thresholds(v) -> bool:
    # 1e-6: int[] items ([1]) read as floats are denormals, not fractions
    return bool(v) and all(1e-6 < x < 1 for x in v) and all(x > y for x, y in zip(v, v[1:]))


def trigger_records(sim: bytes, secs: list, floats: dict, strings: dict, lo: int, hi: int) -> list:
    """Records with a (float[] thresholds, string[] actions) pointer pair at the same offset in every record of a
    fixed-size section, with the actions inside the bloons' part of the string pool [lo, hi)."""
    out = []
    for s in secs[1:]:  # secs[0] is the BloonModel section itself
        size = (s["dend"] - s["dstart"]) / s["cnt"]
        if size != int(size) or not 8 <= size <= 1024:
            continue
        size = int(size)
        recs = [sim[s["dstart"] + k * size:s["dstart"] + (k + 1) * size] for k in range(s["cnt"])]
        cols = [o for o in range(size - 7) if all(
            _is_thresholds(floats.get(_i32(r, o))) and lo <= _i32(r, o + 4) < hi and _i32(r, o + 4) in strings
            for r in recs)]
        if len(cols) > 1:
            fail(f"section at {s['off']:#x}: {len(cols)} threshold/action pointer pairs per record (need 1)")
        for k, r in enumerate(recs if cols else []):
            o = cols[0]
            out.append(dict(obj=s["base"] + k, at=floats[_i32(r, o)], do=strings[_i32(r, o + 4)],
                            sref=_i32(r, o + 4)))
    return out


def anchor_floats(sim: bytes, secs: list, items: list, strings: dict, lo: int, hi: int) -> dict:
    """CHECK 4: number the float[] items so that some fixed-size section has, in every record, a pointer to a
    threshold array (strictly descending fractions) right before a pointer to an action string[] of the bloons'
    part of the string pool. Exactly one numbering may fit. -> {object number: [floats]}."""
    th = [i for i, v in enumerate(items) if _is_thresholds(v)]
    bases: dict = {}
    for s in secs[1:]:
        size = (s["dend"] - s["dstart"]) / s["cnt"]
        if size != int(size) or not 8 <= size <= 1024:
            continue
        size = int(size)
        recs = [sim[s["dstart"] + k * size:s["dstart"] + (k + 1) * size] for k in range(s["cnt"])]
        for o in range(size - 7):
            if not all(lo <= _i32(r, o + 4) < hi and _i32(r, o + 4) in strings for r in recs):
                continue
            fit = None
            for r in recs:
                v = _i32(r, o)
                fit = {v - t for t in th} if fit is None else fit & {v - t for t in th}
                if not fit:
                    break
            for x in fit or ():
                if x >= hi:  # float[] items come after the string pool
                    bases[x] = bases.get(x, 0) + len(recs)
    # A column of one or two records fits by chance; the skull triggers are one section of many records.
    best = sorted(bases.items(), key=lambda kv: -kv[1])[:2]
    if not best or best[0][1] < 20 or (len(best) > 1 and best[1][1] * 4 > best[0][1]):
        fail(f"float[] numbering not unique (records fitted per numbering: {best})")
    base = best[0][0]
    return {base + i: v for i, v in enumerate(items)}


def owner_by_reflist(sim: bytes, obj: int, by_marker: dict) -> set:
    """CHECK 5a: the bloon whose +8 marker is the nearest preceding i32 (4-byte steps, <= 400 back) before each
    occurrence of the object number."""
    owners = set()
    for m in re.finditer(re.escape(struct.pack("<i", obj)), sim):
        q = m.start() - 4
        while q > m.start() - 1604 and q >= 0:
            v = _i32(sim, q)
            if v in by_marker:
                owners.add(by_marker[v])
                break
            q -= 4
    return owners


def _shield_rows(sim: bytes, p: int, cnt: int, end: int):
    """-> [(name, health)] if exactly one decoded row shape (A / B, see the header) parses `cnt` rows from `p`
    and ends exactly at `end`; else None."""
    found = []
    for shape in ("A", "B"):
        q, rows, ok = p, [], True
        try:
            for _ in range(cnt):
                if sim[q] != 0:
                    ok = False
                    break
                name, q = br._read_str(sim, q + 1)
                if not re.fullmatch(r"\w+", name):
                    ok = False
                    break
                if shape == "A":
                    h = _f32(sim, q + 4)
                    q += 16
                else:
                    h = _f32(sim, q)
                    flag = sim[q + 4]
                    q += 5
                    if flag == 0:
                        _s, q = br._read_str(sim, q)
                    elif flag != 1:
                        ok = False
                        break
                rows.append((name, h))
        except (IndexError, struct.error):
            ok = False
        if ok and q == end:
            found.append(rows)
    return found[0] if len(found) == 1 else None


def bloon_base(bid: str) -> str:
    return re.sub(r"(Elite)?\d+$", "", bid)


def _action_column(sim: bytes, s: dict):
    """-> (action names, offset after them) if the section's data starts with a column of `cnt` action names."""
    p, acts = s["dstart"], []
    while len(acts) < s["cnt"] and p < s["dend"] and sim[p] == 0:
        a, p = br._read_str(sim, p + 1)
        if not re.fullmatch(r"[A-Za-z]\w*", a):
            break
        acts.append(a)
    return (acts, p) if len(acts) == s["cnt"] else None


def shield_records(sim: bytes, secs: list, by_marker: dict, skull_do: dict) -> tuple[dict, list, list]:
    """CHECK 8. -> ({boss tier id: {"health", "per", "action"}}, notes, sections with skull actions not parsed)."""
    all_do = set().union(*skull_do.values())
    out, notes, unparsed = {}, [], []
    for s in secs[1:]:
        col = _action_column(sim, s)
        if col is None or not set(col[0]) & all_do:
            continue
        acts, p = col
        rows = _shield_rows(sim, p, s["cnt"], s["dend"])
        if rows is None:
            unparsed.append(f"{s['cnt']} records ({', '.join(sorted(set(acts) & all_do))})")
            continue
        for k, (name, h) in enumerate(rows):
            owners = owner_by_reflist(sim, s["base"] + k, by_marker)
            if len(owners) != 1:
                fail(f"shield record {s['base'] + k}: reference-list owners {sorted(owners)}")
            bid = next(iter(owners))
            if bid not in skull_do:
                notes.append(f"shield-shaped {acts[k]} records of non-boss bloons ignored ({bloon_base(bid)})")
                continue
            if acts[k] not in skull_do[bid]:
                fail(f"shield record of {bid}: action {acts[k]!r} is not one of its skull actions")
            m = re.search(r"(\d+)$", name)
            if m and not bid.endswith(m.group(1)):
                fail(f"shield record of {bid} is named {name!r}")
            if h <= 0:
                notes.append(f"{bid}: {acts[k]} shield health {h} left out")
                continue
            if bid in out:
                fail(f"{bid}: two shield records")
            out[bid] = {"health": _num(h), "per": "skull", "action": acts[k]}
    return out, notes, unparsed


# ─────────────────────────────────────────────────────────────── checks on plain bloon fields

# ─────────────────────────────────────────────────────────────── tower-set immunity (Dreadbloon)


def _meta():
    """-> (metadata bytes, sec(k) -> (offset, size, count) of header section k, name_at(i), types()) of the game's
    IL2CPP global-metadata.dat (v39, the game's Unity since v57). Sections used: 2 strings, 7 field default values,
    8 default value data, 11 fields (12-byte records), 19 type definitions (82-byte records: +0 name, +4 namespace,
    +26 i32 first field, +62 u16 field count)."""
    path = br.DATA_DIR / "il2cpp_data" / "Metadata" / "global-metadata.dat"
    if not path.exists():
        fail(f"{path} not found")
    b = path.read_bytes()
    magic, ver = struct.unpack_from("<Ii", b, 0)
    if magic != 0xFAB11BAF or ver != 39:
        fail(f"global-metadata.dat magic {magic:#x} version {ver} (decoded for version 39 only)")

    def sec(k: int) -> tuple:
        return struct.unpack_from("<3i", b, 8 + 12 * k)

    str_o = sec(2)[0]
    typ_o, typ_s, typ_n = sec(19)
    if typ_s != 82 * typ_n:
        fail("metadata type table is not 82-byte records")

    def name_at(i: int) -> str:
        return b[str_o + i:b.index(b"\0", str_o + i)].decode("utf-8", "replace")

    def types():  # -> (name, namespace, first field, field count) per type definition
        for i in range(typ_n):
            o = typ_o + 82 * i
            yield name_at(_i32(b, o)), name_at(_i32(b, o + 4)), _i32(b, o + 26), struct.unpack_from("<H", b, o + 62)[0]

    return b, sec, name_at, types

def tower_set_enum() -> dict:
    """-> {value: name} of the TowerSet flags enum, from the game's IL2CPP metadata. CHECK 9 (enum part)."""
    b, sec, name_at, types = _meta()
    fdv_o, fdv_s, _ = sec(7)
    data_o, fld_o = sec(8)[0], sec(11)[0]
    hits = [(f, n) for name, ns, f, n in types() if name == "TowerSet" and ns.endswith(".TowerSets")]
    if len(hits) != 1:
        fail(f"metadata: {len(hits)} TowerSet enums (need 1)")
    first, nfields = hits[0]
    dflt = {}
    for k in range(fdv_s // 12):
        f, _t, d = struct.unpack_from("<3i", b, fdv_o + 12 * k)
        dflt[f] = d

    def compressed_int(p: int) -> int:  # il2cpp "compressed" int32 default value
        c = b[p]
        if c < 0x80:
            e = c
        elif c & 0xC0 == 0x80:
            e = ((c & 0x3F) << 8) | b[p + 1]
        elif c & 0xE0 == 0xC0:
            e = ((c & 0x1F) << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]
        elif c == 0xF0:
            e = struct.unpack_from("<I", b, p + 1)[0]
        else:
            fail(f"metadata: default value marker {c:#x}")
        return -((e >> 1) + 1) if e & 1 else e >> 1

    members = {}
    for j in range(first, first + nfields):
        n, _ty, _tok = struct.unpack_from("<3i", b, fld_o + 12 * j)
        if j in dflt:
            members[name_at(n)] = compressed_int(data_o + dflt[j])
    sets = ("Primary", "Military", "Magic", "Support")
    vals = [members.get(x) for x in sets]
    if None in vals or any(v <= 0 or v & (v - 1) for v in vals) or len(set(vals)) != 4:
        fail(f"TowerSet members {members}: Primary/Military/Magic/Support not four distinct powers of two")
    if members.get("None") != 0 or members.get("AllMonkeyTowerSets") != sum(vals):
        fail(f"TowerSet members {members}: None != 0 or AllMonkeyTowerSets != OR of the four sets")
    return {members[x]: x for x in sets}


def _immunity_rows(sim: bytes, p: int, cnt: int, end: int):
    """-> [(name, pointer)] if `cnt` rows [u8 0][str name][i32] parse from `p` and end exactly at `end`."""
    rows = []
    try:
        for _ in range(cnt):
            if sim[p] != 0:
                return None
            name, p = br._read_str(sim, p + 1)
            if not re.fullmatch(r"\w+", name):
                return None
            rows.append((name, _i32(sim, p)))
            p += 4
    except (IndexError, struct.error):
        return None
    return rows if p == end else None


def _phase_pool(sim: bytes, n: int, towerset: dict) -> list:
    """The pool of `n` arrays [i32 k] k x ([u8 len][str id][i32 TowerSet]) -> [[(id, TowerSet value)]]; found by
    shape; exactly one may exist."""
    rx = re.compile(re.escape(struct.pack("<i", n)) + rb"[\x01-\x20]\x00\x00\x00[\x01-\x20][A-Za-z]", re.S)
    found = []
    for m in rx.finditer(sim):
        q, arrs = m.start() + 4, []
        try:
            for _ in range(n):
                k = _i32(sim, q)
                q += 4
                if not 1 <= k <= 64:
                    raise ValueError
                els = []
                for _ in range(k):
                    ln = sim[q]
                    sid = sim[q + 1:q + 1 + ln].decode("ascii")
                    v = _i32(sim, q + 1 + ln)
                    if not sid.isalnum() or v not in towerset:
                        raise ValueError
                    els.append((sid, v))
                    q += 5 + ln
                arrs.append(els)
        except (ValueError, IndexError, UnicodeDecodeError, struct.error):
            continue
        found.append(arrs)
    if len(found) != 1:
        fail(f"tower-set immunity: {len(found)} array pools of {n} (id, TowerSet) arrays (need 1)")
    return found[0]


def immunity_records(sim: bytes, secs: list, by_marker: dict, skull_do: dict, tier_skulls: dict, text: dict):
    """CHECK 9. -> {boss tier id: [tower set name per phase]} (phase 0 = at spawn, k = after skull k)."""
    all_do = set().union(*skull_do.values())
    rows_by_tier, ptr_of = {}, {}
    for s in secs[1:]:
        col = _action_column(sim, s)
        if col is None or "ApplyImmunity" not in col[0] or not set(col[0]) & all_do:
            continue
        acts, p = col
        rows = _immunity_rows(sim, p, s["cnt"], s["dend"])
        if rows is None:
            fail(f"ApplyImmunity section at {s['off']:#x}: rows not [u8 0][str][i32]")
        for k, (name, ptr) in enumerate(rows):
            owners = owner_by_reflist(sim, s["base"] + k, by_marker)
            if len(owners) != 1:
                fail(f"immunity record {s['base'] + k}: reference-list owners {sorted(owners)}")
            bid = next(iter(owners))
            if bid not in skull_do or acts[k] not in skull_do[bid]:
                fail(f"immunity record of {bid}: action {acts[k]!r} is not one of its skull actions")
            if bid in rows_by_tier:
                fail(f"{bid}: two immunity records")
            rows_by_tier[bid], ptr_of[bid] = k, ptr
            if not (name.endswith(re.search(r"(\d+)$", bid).group(1)) and ("Elite" in name) == ("Elite" in bid)):
                fail(f"immunity record of {bid} is named {name!r}")
    if not rows_by_tier:
        return {}
    order = sorted(rows_by_tier, key=lambda t: ptr_of[t])
    ptrs = [ptr_of[t] for t in order]
    if ptrs != list(range(ptrs[0], ptrs[0] + len(ptrs))) or len(set(map(bloon_base, order))) != 1:
        fail(f"immunity pointers {ptrs} are not consecutive over one boss")
    towerset = tower_set_enum()
    pool = _phase_pool(sim, len(order), towerset)
    out = {}
    for bid, arr in zip(order, pool):
        if len(arr) != len(tier_skulls[bid]) + 1:
            fail(f"{bid}: {len(arr)} immunity phases for {len(tier_skulls[bid])} skulls (need skulls + 1)")
        if [i for i, _ in arr] != [f"Phase{(k % 4) + 1}" for k in range(len(arr))]:
            fail(f"{bid}: immunity ids {[i for i, _ in arr]}")
        out[bid] = [towerset[v] for _, v in arr]
        for nm in set(out[bid]):
            if not text.get(f"{bloon_base(bid)}{nm}Immunity"):
                fail(f"{bid}: no game text {bloon_base(bid)}{nm}Immunity for tower set {nm}")
    return out


def check_speed(bloons: dict, speed: dict) -> None:
    """CHECK 3."""
    order = ["Red", "Blue", "Green", "Yellow"]
    if any(b not in speed for b in order + ["Ddt"]):
        fail("standard bloons Red/Blue/Green/Yellow/Ddt missing")
    if not all(speed[a] < speed[b] for a, b in zip(order, order[1:])):
        fail(f"speed field: Red<Blue<Green<Yellow does not hold ({[speed[b] for b in order]})")
    slow = [b for b, x in bloons.items() if x["moab"] and not x["boss"] and b == x["base"] and b != "Ddt"]
    if len(slow) < 3 or any(speed[b] > speed["Red"] for b in slow) or all(speed[b] == speed["Red"] for b in slow):
        fail(f"speed field: MOAB-class bloons not slower than Red ({ {b: speed[b] for b in slow} })")
    for b, x in bloons.items():
        if b != x["base"] and b.startswith(x["base"]) and x["base"] in speed and \
                re.fullmatch(r"(Regrow)?(Fortified)?(Camo)?", b[len(x["base"]):]) and speed[b] != speed[x["base"]]:
            fail(f"speed field differs between {b} and {x['base']}")


def property_names(bloons: dict) -> dict:
    """CHECK 7: bit -> name of the standard bloon carrying exactly that bit (Lead, Black, White, Purple, ...)."""
    names: dict = {}
    std = {b: x for b, x in bloons.items() if b == x["base"] and not x["boss"]}
    carriers: dict = {}
    for b, x in std.items():
        p = x["props"]
        if p > 0 and p & (p - 1) == 0:
            carriers.setdefault(p, []).append(b)
    for p, bs in carriers.items():  # e.g. Lead and GoldenLead both carry only the lead bit: the shortest id names it
        bs.sort(key=lambda b: (len(b), b))
        if len(bs) > 1 and len(bs[0]) == len(bs[1]):
            fail(f"property bit {p} carried alone by both {bs[0]} and {bs[1]}")
        names[p] = bs[0]
    for b, x in std.items():
        rest = x["props"]
        for bit in names:
            rest &= ~bit
        if rest:
            fail(f"property mask of {b} ({x['props']}) has unnamed bits")
    if len(names) < 3:
        fail(f"only {len(names)} property bits could be named")
    return names


# ─────────────────────────────────────────────────────────────── behaviour models (named by IL2CPP metadata)

# Field layouts of the model classes the bosses use. Each entry: class name -> (has the base-class actionId column,
# [(field name, kind)]). The field names are the game's own (global-metadata.dat); every name must be a field of that
# class and in that relative order (CHECK 10). Kinds: f float32, i int32, b bool (u8 0/1), s string ([u8 0][len str] or
# [u8 1] = null), g plain string ([u8 len][chars], asset ids), a pointer to a string[] (resolved), F pointer to a
# float[] (resolved), p other pointer (not read). Fields the game keeps in the class but does not store here (mutators,
# *Frames values, constant ids) are simply absent from the row.
_SPEC = {
    "HealthPercentTriggerModel": (0, [("repeatFirst", "b"), ("preventFallthrough", "b"), ("percentageValues", "F"),
                                      ("actionIds", "a")]),
    "TimeTriggerModel": (0, [("interval", "f"), ("triggerImmediately", "b"), ("actionIds", "a")]),
    "SellTriggerModel": (0, [("actionIds", "a")]),
    "WaitForSecondsActionModel": (1, [("delayTime", "f"), ("actionIds", "a")]),
    "SetSpeedPercentActionModel": (1, [("percent", "f"), ("revert", "b"), ("time", "f"), ("distance", "f")]),
    "SetInvulnerableActionModel": (1, [("set", "b"), ("sound", "b")]),
    "PlayAnimTriggerActionModel": (1, [("triggerName", "s"), ("pauseMovementDuration", "f")]),
    "CreateSoundOnActionModel": (1, [("sounds", "p"), ("delay", "f")]),
    "SpawnBloonsActionModel": (1, [("bossName", "s"), ("bloonType", "s"), ("spawnCount", "i"), ("spawnOverTime", "f"),
                                   ("spawnDistAhead", "f"), ("spawnTrackMin", "f"), ("spawnTrackMax", "f"),
                                   ("animationLength", "f"), ("invulnerableWhileAnimating", "b"),
                                   ("healthPercentOfSelf", "f"), ("healthOverride", "f"), ("animCurveIds", "p"),
                                   ("moabAnimCurveIds", "p")]),
    "StunTowersInRadiusActionModel": (1, [("radius", "f"), ("stunDuration", "f"), ("paragonStunTimeMultiplier", "f"),
                                          ("towerStunEffect", "g"), ("blockTowerSelling", "b")]),
    "ReflectProjectilesInRadiusActionModel": (1, [("lifespan", "f"), ("innerRadius", "f"), ("outerRadius", "f"),
                                                  ("reflectionDamper", "f"), ("onlyIfImmune", "b")]),
    "DestroyProjectilesInRadiusActionModel": (1, [("radius", "f"), ("destroyedItemEffect", "g"),
                                                  ("destroyedItemEffectTime", "f"), ("ignorePowerProjectiles", "b")]),
    "CreateEffectActionModel": (1, [("effect", "g"), ("scale", "f"), ("lifespan", "f"), ("followBloonTransform", "b")]),
    "RemoveAllMutatorsActionModel": (1, [("mutatorsToIgnoreList", "a")]),
    "HealSelfActionModel": (1, [("healAmount", "f"), ("healPercent", "f"), ("bossSkullIncreasePercent", "f")]),
    "LychTombstoneSpawnActionModel": (1, [("bossName", "s"), ("bloonType", "s"), ("spawnCount", "i"),
                                          ("spawnOverTime", "f"), ("spawnDistAhead", "f"), ("spawnTrackMin", "f"),
                                          ("spawnTrackMax", "f")]),
    "AbsorbTowerBuffsActionModel": (1, [("towerFreezeDuration", "f"), ("radius", "f"), ("ignoredBuffs", "a"),
                                        ("buffsAlwaysRemoved", "a"), ("buffsThatDontHeal", "a"),
                                        ("towersWhichAreDestroyed", "a"), ("towerFreezeDisplayAsset", "g"),
                                        ("triggerName", "s")]),
    "WorthReductionModel": (0, [("worthMultiplier", "f")]),
    "RangeReductionZoneModel": (0, [("rangeMultiplier", "f")]),
    "AbilityCooldownZoneModel": (0, [("multiplier", "f")]),
    "BuffBloonSpeedModel": (0, [("speedBoost", "f"), ("debuffInRadius", "f"), ("speedBoostOverlayGroup", "s")]),
    "AddHeatActionModel": (1, [("heatPercent", "f")]),
    "RemoveAllDotActionModel": (1, [("effect", "g"), ("effectOffsetY", "f"), ("effectLifespan", "f")]),
    "FireballActionModel": (1, [("towerStunEffect", "g"), ("fireballDisplay", "g"), ("magmaPoolDisplay", "g"),
                                ("sounds", "p"), ("projectileSpeed", "f"), ("stunDuration", "f"),
                                ("magmaPoolDuration", "f"), ("magmaPoolRadius", "f"), ("rateMultiplier", "f"),
                                ("rangeMultiplier", "f"), ("animationCurveId", "s"), ("actionIds", "a"),
                                ("fireballTargetting", "a"), ("heatPercents", "p")]),
    "CreatePropsOnBloonActionModel": (1, [("rockCircleRadius", "f"), ("rockAmount", "i"), ("rockDuration", "f"),
                                          ("rockPropId", "p"), ("expireEffect", "g"), ("expireEffectDuration", "f"),
                                          ("propScale", "f")]),
    "OverheatTriggerModel": (0, [("projectileExplosionEffect", "g"), ("stunEffect", "g"), ("fullscreenEffect", "g"),
                                 ("sounds", "p"), ("maxHeatLevel", "f"), ("heatEffectCooldown", "f"),
                                 ("heatEffectDuration", "f"), ("immuneHeat", "f"), ("damagedHeat", "f"),
                                 ("heatIdleDelay", "f"), ("abilityCooldownAddition", "f"),
                                 ("passiveHeatReduction", "f"), ("idleHeatReduction", "f"), ("iceHeatReduction", "f"),
                                 ("projectileBurnLifespan", "f"), ("heatDecayStrength", "f"), ("stunDuration", "f"),
                                 ("abilityCooldownHeatModifier", "f"), ("abilityTowerFilter", "a"),
                                 ("animTriggerId", "s"), ("fillHeatOnSpawn", "b")]),
    "DashForwardsActionModel": (1, [("speedMultiplier", "f"), ("dashDistance", "f"), ("actionIds", "a"),
                                    ("dashAnimationName", "s"), ("setSpeed", "b")]),
    "RedirectBloonSpawnActionModel": (1, [("duration", "f"), ("rounds", "i"), ("portalAsset", "g"),
                                          ("rotatePortalToBloon", "b"), ("redirectBloonSpawningModel", "p")]),
    "ThrowBloonsActionModel": (1, [("addCamo", "b"), ("speedMultiplier", "f"), ("offsetMin", "f"),
                                   ("offsetMax", "f")]),
    "PhayzeBehaviorModel": (0, [("powerLevels", "F"), ("shieldSpeedBoost", "f"), ("enterCamoAnimationName", "s"),
                                ("enterCamoImmunityAnimationName", "s"), ("exitCamoImmunityAnimationName", "s"),
                                ("exitCamoAnimationName", "s"), ("camoRemovalTowerDisplay", "g"),
                                ("camoRemovalTowerDisplayModel", "p")]),
    "PhayzeTimerActionModel": (1, [("restore", "b")]),
    "GenerateArmourActionModel": (1, [("id", "s"), ("tags", "p"), ("amount", "f"), ("properties", "i"),
                                      ("speedMultiplier", "f")]),
    "GenerateShieldActionModel": (1, [("id", "s"), ("amount", "f"), ("tags", "s")]),
    "ApplyTowerSetImmunityModel": (1, [("id", "s"), ("immunities", "p")]),
    "DamageReductionModel": (0, [("amount", "f")]),
    "SpawnBloonsUntilArmourBreaksActionModel": (1, [("performActionOnSpawn", "b"), ("bloonType", "s"),
                                                    ("timeBetweenSpawns", "f"), ("inheritImmunityFromParent", "b"),
                                                    ("initialSpawnPackSize", "i")]),
    "DiamondbackBehaviorModel": (0, [("headSegmentBloonId", "s"), ("middleSegmentBloonId", "s"),
                                     ("tailSegmentBloonId", "s"), ("numOfMiddleSegments", "i"),
                                     ("segmentSpacing", "f"), ("extraHeadSpacing", "f"), ("extraTailSpacing", "f"),
                                     ("tailShieldRegenerateTime", "f"), ("tailShieldBrokenActionId", "s"),
                                     ("tailShieldRegenerateActionId", "s"), ("repairTraverseEffect", "g"),
                                     ("skullInvulnerableTime", "f"), ("bloonBleedHealthPercent", "f"),
                                     ("skullActionId", "s"), ("tailShieldDamageStates", "p"),
                                     ("tailShieldMaxHealthPercent", "f"), ("tailDamageMultiplier", "f"),
                                     ("playIntro", "b")]),
    "LychBossSuperScriptModel": (0, [("preventFallthrough", "b"), ("drainInterval", "f"), ("drainInitialInterval", "f"),
                                     ("drainEtherealExitInterval", "f"), ("drainActionIds", "a"),
                                     ("regrowInterval", "f"), ("regrowInitialInterval", "f"),
                                     ("regrowDrainInterval", "f"), ("regrowEtherealExitInterval", "f"),
                                     ("regrowActionIds", "a"), ("tombstoneInterval", "f"),
                                     ("tombstoneInitialInterval", "f"), ("tombstoneEtherealExitInterval", "f"),
                                     ("tombstoneActionIds", "a"), ("tombstoneHealthOverride", "f"),
                                     ("tombstoneMoabHealthOverride", "f"), ("tombstoneBfbHealthOverride", "f"),
                                     ("tombstoneZomgHealthOverride", "f"), ("tombstoneSpawnSpeedModifier", "f"),
                                     ("etherealHealthPercentageValues", "F"), ("etherealEnterActionIds", "a"),
                                     ("etherealExitActionIds", "a"), ("totalKills", "i")]),
}
# classes every boss tier carries that have no behaviour of their own worth showing (sounds, effects, death/spawn
# animation, damage-state sprites, cash/popup/pop effects, the Bad-immunity marker); anything else in a boss tier's
# reference list that is neither here nor in _SPEC fails the run, so a new behaviour cannot slip by unnoticed.
_IGNORED_MODELS = {"DistributeCashModel", "ShowDamageTextModel", "PopEffectModel", "CreateSoundOnDamageBloonModel",
                   "BadImmunityModel", "CreateSoundOnSpawnBloonModel", "SpawnDeathAnimModel", "AnimDamageStateModel",
                   "CreateSoundOnBreakArmourModel", "CreateSoundOnDamageArmourModel", "BloonSpawnEffectModel",
                   "BloonDeathEffectModel"}
# action models that only play sounds / effects / animations are left out of the output (a PlayAnim that pauses the
# boss, pauseMovementDuration > 0, is kept)
_COSMETIC_ACTIONS = {"CreateSoundOnActionModel", "CreateEffectActionModel", "PlayAnimTriggerActionModel"}
# fields that are decoded (so the row must parse) but not published; where the value must be 0 / empty to be left out
_MUST_BE_ZERO = {"SpawnBloonsActionModel": ("healthPercentOfSelf", "healthOverride"),
                 "AbsorbTowerBuffsActionModel": ("towersWhichAreDestroyed",),
                 "LychBossSuperScriptModel": ("totalKills",)}
# published fields per model: class -> (short name, [fields]); everything else is read but not shown
_EXPORT = {
    "SpawnBloonsActionModel": ("SpawnBloons", ["bloonType", "spawnCount", "spawnOverTime", "spawnDistAhead",
                                               "spawnTrackMin", "spawnTrackMax", "animationLength",
                                               "invulnerableWhileAnimating"]),
    "LychTombstoneSpawnActionModel": ("SpawnTombstone", ["bloonType", "spawnCount", "spawnOverTime", "spawnDistAhead",
                                                         "spawnTrackMin", "spawnTrackMax"]),
    "StunTowersInRadiusActionModel": ("StunTowers", ["radius", "stunDuration", "paragonStunTimeMultiplier",
                                                     "blockTowerSelling"]),
    "SetInvulnerableActionModel": ("SetInvulnerable", ["set"]),
    "SetSpeedPercentActionModel": ("SetSpeedPercent", ["percent", "revert", "time", "distance"]),
    "WaitForSecondsActionModel": ("WaitForSeconds", ["delayTime", "actionIds"]),
    "DestroyProjectilesInRadiusActionModel": ("DestroyProjectiles", ["radius", "ignorePowerProjectiles"]),
    "ReflectProjectilesInRadiusActionModel": ("ReflectProjectiles", ["lifespan", "innerRadius", "outerRadius",
                                                                    "reflectionDamper", "onlyIfImmune"]),
    "HealSelfActionModel": ("HealSelf", ["healAmount", "healPercent", "bossSkullIncreasePercent"]),
    "AbsorbTowerBuffsActionModel": ("AbsorbTowerBuffs", ["towerFreezeDuration", "radius", "buffsAlwaysRemoved"]),
    "RemoveAllMutatorsActionModel": ("RemoveAllMutators", ["mutatorsToIgnoreList"]),
    "GenerateArmourActionModel": ("GenerateArmour", ["amount", "speedMultiplier"]),
    "GenerateShieldActionModel": ("GenerateShield", ["amount"]),
    "SpawnBloonsUntilArmourBreaksActionModel": ("SpawnBloonsUntilArmourBreaks",
                                                ["bloonType", "timeBetweenSpawns", "initialSpawnPackSize",
                                                 "inheritImmunityFromParent", "performActionOnSpawn"]),
    "FireballActionModel": ("Fireball", ["stunDuration", "projectileSpeed", "magmaPoolDuration", "magmaPoolRadius",
                                         "rateMultiplier", "rangeMultiplier", "fireballTargetting", "actionIds"]),
    "CreatePropsOnBloonActionModel": ("CreateProps", ["rockCircleRadius", "rockAmount", "rockDuration", "propScale"]),
    "AddHeatActionModel": ("AddHeat", ["heatPercent"]),
    "RemoveAllDotActionModel": ("RemoveAllDot", []),
    "DashForwardsActionModel": ("DashForwards", ["speedMultiplier", "dashDistance", "actionIds"]),
    "RedirectBloonSpawnActionModel": ("RedirectBloonSpawn", ["duration", "rounds"]),
    "ThrowBloonsActionModel": ("ThrowBloons", ["addCamo", "speedMultiplier", "offsetMin", "offsetMax"]),
    "PhayzeTimerActionModel": ("PhayzeTimer", ["restore"]),
    "PlayAnimTriggerActionModel": ("PlayAnim", ["pauseMovementDuration"]),
}
_BOSS_BLOONS_NS = "Assets.Scripts.Models.Bloons"


def _sec_headers(sim: bytes, s: dict) -> list:
    p, out = s["off"] + 8, []
    for _ in range(s["cnt"]):
        n = sim[p + 10]
        out.append((_i32(sim, p), sim[p + 11:p + 11 + n].decode("latin-1")))
        p += 11 + n
    return out


def model_classes(sim: bytes, secs: list) -> tuple:
    """CHECK 10. The sim_model types its object sections with a number; the number is the rank of the model class in
    the case-insensitive sort of "<namespace>.<name>" over the model classes. Over the Assets.Scripts.Models.Bloons*
    namespaces (where every boss behaviour lives) that rank, shifted by a constant, is the type number: the shift is
    fixed by the section whose object names read "DamageStateModel_<n>" and must give the BloonModel section's type.
    -> (class name by type number (function), {class name: [field names in declaration order]})."""
    b, sec, name_at, types = _meta()
    fld_o = sec(11)[0]
    tds = []
    for name, ns, first, nf in types():
        if ns.startswith(_BOSS_BLOONS_NS) and "<" not in name:
            fields = [name_at(_i32(b, fld_o + 12 * j)) for j in range(first, first + nf)]
            tds.append((f"{ns}.{name}".lower(), name, ns, fields))
    tds.sort(key=lambda t: t[0])
    rank = {t[0]: k for k, t in enumerate(tds)}
    damage = [s for s in secs if s["cnt"] and _sec_headers(sim, s)[0][1].startswith("DamageStateModel_")]
    if len(damage) != 1:
        fail(f"{len(damage)} sections with DamageStateModel_ objects (need 1)")
    shift = _i32(sim, damage[0]["off"] + 8) - rank[f"{_BOSS_BLOONS_NS}.behaviors.damagestatemodel".lower()]
    btype = _i32(sim, secs[0]["off"] + 8)
    if btype - shift != rank[f"{_BOSS_BLOONS_NS}.bloonmodel".lower()]:
        fail("model type numbers: DamageStateModel and BloonModel anchors disagree (class table changed?)")
    by_type = {k + shift: t[1] for k, t in enumerate(tds)}
    fields = {}
    for t in tds:
        fields.setdefault(t[1], []).append(t[3])
    out = {}
    for name in list(_SPEC) + ["BloonModel", "BloonBehaviorActionModel"]:
        if name not in fields or len(fields[name]) != 1:
            fail(f"model class {name}: {len(fields.get(name, []))} metadata definitions (need 1)")
        out[name] = fields[name][0]
    if "actionId" not in out["BloonBehaviorActionModel"] or "speed" not in out["BloonModel"]:
        fail("metadata: BloonBehaviorActionModel.actionId / BloonModel.speed missing")
    for name, (col, spec) in _SPEC.items():
        names, have = [f for f, _k in spec], iter(out[name])
        if not all(n in have for n in names):  # subsequence test (consumes the iterator in order)
            fail(f"model {name}: decoded fields {names} are not in the metadata field order {out[name]}")
    return (lambda t: by_type.get(t)), out


class Models:
    """The behaviour models of the object sections: object number -> (class name, decoded row | None).
    Every section of a _SPEC class is decoded in full and must end exactly where the next section starts."""

    def __init__(self, sim: bytes, secs: list, class_of, strings: dict, floats: dict):
        self.sim, self.secs, self.strings, self.floats = sim, secs, strings, floats
        self.bases = [s["base"] for s in secs]
        self.cls = [class_of(_i32(sim, s["off"] + 8)) or f"<type {_i32(sim, s['off'] + 8)}>" for s in secs]
        self.rows: dict = {}

    def _rd(self, p: int, kind: str):
        sim = self.sim
        if kind == "f":
            return br.f32(_f32(sim, p)), p + 4
        if kind in "iaFp":
            return _i32(sim, p), p + 4
        if kind == "b":
            if sim[p] > 1:
                fail(f"bool byte {sim[p]} at {p}")
            return bool(sim[p]), p + 1
        if kind == "s":
            if sim[p] == 1:
                return None, p + 1
            if sim[p] != 0:
                fail(f"string flag {sim[p]} at {p}")
            n = sim[p + 1]
            return sim[p + 2:p + 2 + n].decode("utf-8"), p + 2 + n
        if kind == "g":
            n = sim[p]
            return sim[p + 1:p + 1 + n].decode("ascii"), p + 1 + n
        fail(f"kind {kind}")

    def section(self, i: int) -> list:
        if i in self.rows:
            return self.rows[i]
        s, name = self.secs[i], self.cls[i]
        col, spec = _SPEC[name]
        p, ids = s["dstart"], []
        for _ in range(s["cnt"] if col else 0):
            v, p = self._rd(p, "s")
            ids.append(v)
        rows = []
        for k in range(s["cnt"]):
            r = {"actionId": ids[k]} if col else {}
            for f, kind in spec:
                r[f], p = self._rd(p, kind)
                if kind in "aF":
                    pool = self.strings if kind == "a" else self.floats
                    if r[f] not in pool:
                        fail(f"{name}.{f}: pointer {r[f]} is not in the {'string' if kind == 'a' else 'float'} pool")
                    r[f] = [br.f32(x) for x in pool[r[f]]] if kind == "F" else list(pool[r[f]])
            rows.append(r)
        if p != s["dend"]:
            fail(f"{name} section {s['base']}: decoded {p - s['dstart']} bytes of {s['dend'] - s['dstart']} "
                 "(field layout changed?)")
        for f in _MUST_BE_ZERO.get(name, ()):
            if any(r[f] for r in rows):
                fail(f"{name}.{f} is not 0 / empty on every record; it is not published, so the layout needs a look")
        self.rows[i] = rows
        return rows

    def at(self, obj: int):
        i = bisect.bisect_right(self.bases, obj) - 1
        if i < 0 or obj >= self.secs[i]["base"] + self.secs[i]["cnt"]:
            return None, None
        name = self.cls[i]
        if name not in _SPEC:
            return name, None
        return name, self.section(i)[obj - self.secs[i]["base"]]


def bloon_ref_lists(sim: bytes, blocks: dict, by_marker: dict, tail: int) -> dict:
    """-> {bloon id: [object numbers]}: each bloon's reference list. A bloon's +8 marker occurs exactly twice in the
    file: in its block and at the head of its list in the reference-list region (after the last object section);
    the list runs to the next marker."""
    pos = {}
    for m, bid in by_marker.items():
        q = sim.find(struct.pack("<i", m), tail)
        if q < 0:
            fail(f"reference list of {bid} not found")
        pos[bid] = q
    order = sorted(pos, key=pos.get)
    out = {}
    for k, bid in enumerate(order):
        end = pos[order[k + 1]] if k + 1 < len(order) else pos[bid] + 4 * 64
        out[bid] = [_i32(sim, q) for q in range(pos[bid] + 4, end, 4)]
    return out


def model_tables(sim: bytes, secs: list, blocks: dict, by_marker: dict, bloons: dict, strings: dict,
                 floats: dict, trig: list) -> tuple:
    """-> (Models, {bloon id: reference list}). CHECK 10 (class table) + CHECK 11 (reference lists agree with the
    string-pool owner of every skull trigger record)."""
    class_of, _fields = model_classes(sim, secs)
    models = Models(sim, secs, class_of, strings, floats)
    for i in range(len(secs)):  # every section of a decoded class must parse to its end
        if models.cls[i] in _SPEC:
            models.section(i)
    refs = bloon_ref_lists(sim, blocks, by_marker, secs[-1]["dstart"])
    for t in trig:
        owners = [b for b, objs in refs.items() if t["obj"] in objs]
        if owners != [t["owner"]]:
            fail(f"reference lists: trigger object {t['obj']} is in lists of {owners}, string pool says {t['owner']}")
    return models, refs


def _tier_models(models: Models, refs: dict, bid: str) -> list:
    """-> [(class, row)] of a tier's decoded behaviours. Fails on a behaviour class nobody decoded (CHECK 11: the
    reference list holds exactly one entry outside the object sections - the bloon's own number)."""
    out, outside = [], 0
    for o in refs[bid]:
        name, row = models.at(o)
        if name is None:
            outside += 1
        elif row is None:
            if name not in _IGNORED_MODELS:
                fail(f"{bid}: behaviour {name} (object {o}) is not decoded; add it to _SPEC or _IGNORED_MODELS")
        else:
            out.append((name, row))
    if outside != 1:
        fail(f"{bid}: {outside} reference-list entries outside the object sections (the bloon's own number only)")
    return out


def _pub(name: str, row: dict) -> dict:
    short, fields = _EXPORT[name]
    out = {"model": short}
    for f in fields:
        v = row[f]
        if v is not None and v != []:
            out["then" if f == "actionIds" else f] = v
    return out


_PASSIVE_SKIP = ("projectileExplosionEffect", "stunEffect", "fullscreenEffect", "sounds", "animTriggerId")
_DIAMONDBACK_KEEP = ("numOfMiddleSegments", "segmentSpacing", "extraHeadSpacing", "extraTailSpacing",
                     "tailShieldRegenerateTime", "skullInvulnerableTime", "bloonBleedHealthPercent",
                     "tailShieldMaxHealthPercent", "tailDamageMultiplier", "tailShieldBrokenActionId",
                     "tailShieldRegenerateActionId", "skullActionId")


def tier_behaviour(mods: list) -> tuple:
    """-> (passives, actions, ids): the non-skull behaviours of one boss tier, the tier's action models by action id
    (sound / effect / animation-only ones left out; ids = every action id the tier has, left-out ones included)."""
    passives, actions, ids = [], {}, set()
    for name, r in mods:
        if "actionId" in r:
            ids.add(r["actionId"])
            keep = name in _EXPORT and not (name in _COSMETIC_ACTIONS and not r.get("pauseMovementDuration"))
            if keep:
                actions.setdefault(r["actionId"], []).append(_pub(name, r))
        if name == "HealthPercentTriggerModel" and r["repeatFirst"]:
            if len(r["percentageValues"]) != 1:
                fail(f"repeatFirst trigger with {len(r['percentageValues'])} percentages")
            passives.append({"kind": "everyHealth", "step": r["percentageValues"][0], "do": r["actionIds"]})
        elif name == "TimeTriggerModel":
            passives.append({"kind": "timer", "seconds": r["interval"], "immediately": r["triggerImmediately"],
                             "do": r["actionIds"]})
        elif name == "LychBossSuperScriptModel":
            for n in ("drain", "regrow", "tombstone"):
                t = {"kind": "timer", "name": n, "seconds": r[n + "Interval"], "first": r[n + "InitialInterval"],
                     "afterEtherealExit": r[n + "EtherealExitInterval"], "do": r[n + "ActionIds"]}
                if n == "regrow":
                    t["regrowDrainInterval"] = r["regrowDrainInterval"]
                passives.append(t)
            passives.append({"kind": "tombstones", **{k: r[k] for k in (
                "tombstoneHealthOverride", "tombstoneMoabHealthOverride", "tombstoneBfbHealthOverride",
                "tombstoneZomgHealthOverride", "tombstoneSpawnSpeedModifier")}})
            passives.append({"kind": "ethereal", "enter": r["etherealEnterActionIds"],
                             "exit": r["etherealExitActionIds"]})
        elif name == "OverheatTriggerModel":
            passives.append({"kind": "heat", **{k: v for k, v in r.items() if k not in _PASSIVE_SKIP}})
        elif name == "PhayzeBehaviorModel":
            passives.append({"kind": "phayze", "shieldSpeedBoost": r["shieldSpeedBoost"],
                             "powerLevels": r["powerLevels"]})
        elif name == "DiamondbackBehaviorModel":
            passives.append({"kind": "diamondback", **{k: r[k] for k in _DIAMONDBACK_KEEP}})
        elif name == "DamageReductionModel":
            passives.append({"kind": "damageReduction", "amount": r["amount"]})
        elif name == "WorthReductionModel":
            passives.append({"kind": "worthReduction", "worthMultiplier": r["worthMultiplier"]})
        elif name == "RangeReductionZoneModel":
            passives.append({"kind": "rangeZone", "rangeMultiplier": r["rangeMultiplier"]})
        elif name == "AbilityCooldownZoneModel":
            passives.append({"kind": "abilityCooldownZone", "multiplier": r["multiplier"]})
        elif name == "BuffBloonSpeedModel":
            passives.append({"kind": "speedBoost", "speedBoost": r["speedBoost"],
                             "debuffInRadius": r["debuffInRadius"]})
    return passives, actions, ids


def _walk(x):
    """every number in a nested published structure"""
    if isinstance(x, bool):
        return
    if isinstance(x, (int, float)):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _walk(v)
    elif isinstance(x, list):
        for v in x:
            yield from _walk(v)


def check_behaviour(bosses: dict, bloons: dict, desc: dict) -> None:
    """CHECK 12: values of the decoded behaviours - ranges, cross-tier order, agreement with the shields decoded
    independently, and with every number / property the game's own boss description states. `desc` = {boss key:
    lower-case description text}."""
    def tiers(key):
        return [(m, i, r) for m in ("normal", "elite") for i, r in enumerate(bosses[key][m])]

    def p_of(r, kind):
        return [p for p in r.get("passives", []) if p["kind"] == kind]

    def a_of(r, model):
        return [a for v in r.get("actions", {}).values() for a in v if a["model"] == model]

    def need(cond, msg):
        if not cond:
            fail("behaviour check: " + msg)

    for key, B in bosses.items():
        for m, i, r in tiers(key):
            tag = f"{key} {m} {i + 1}"
            for v in _walk([r.get("passives"), r.get("actions")]):
                need(v == v and abs(v) <= 1e7, f"{tag}: number {v} out of range")
            for a in [a for v in r.get("actions", {}).values() for a in v]:
                if "bloonType" in a:
                    need(a["bloonType"] in bloons, f"{tag}: spawns unknown bloon {a['bloonType']}")
                for f in ("spawnCount", "initialSpawnPackSize"):
                    if f in a:
                        need(a[f] >= 1, f"{tag}: {f} {a[f]}")
            for p in r.get("passives", []):
                for f in ("seconds", "first", "afterEtherealExit", "step"):
                    if f in p:
                        need(p[f] > 0, f"{tag}: {p['kind']}.{f} = {p[f]}")
    # ---- Bloonarius: one repeating trigger per tier; its step is below the gap between two skulls
    for m, i, r in tiers("bloonarius"):
        ev = p_of(r, "everyHealth")
        need(len(ev) == 1, f"bloonarius {m} {i + 1}: {len(ev)} repeating triggers (need 1)")
        gaps = [a["at"] - b["at"] for a, b in zip(r["skulls"], r["skulls"][1:])]
        need(0 < ev[0]["step"] < min(gaps), "bloonarius: repeating step is not below the skull spacing")
    for key in bosses:
        if key != "bloonarius":
            need(all(not p_of(r, "everyHealth") for _m, _i, r in tiers(key)), f"{key}: unexpected repeating trigger")
    # ---- Vortex: stun radius / duration never shrink with the tier; the 5 s timer destroys projectiles
    for m in ("normal", "elite"):
        rows = bosses["vortex"][m]
        for f in ("radius", "stunDuration"):
            vs = [a_of(r, "StunTowers")[0][f] for r in rows]
            need(all(a <= b for a, b in zip(vs, vs[1:])) and vs[0] < vs[-1], f"vortex {m}: StunTowers.{f} {vs}")
    for i, (n, e) in enumerate(zip(bosses["vortex"]["normal"], bosses["vortex"]["elite"])):
        need(a_of(e, "StunTowers")[0]["stunDuration"] >= a_of(n, "StunTowers")[0]["stunDuration"],
             f"vortex tier {i + 1}: elite stuns for less than normal")
    for _m, _i, r in tiers("vortex"):
        tm = p_of(r, "timer")
        need(len(tm) == 1 and any(a["model"] == "DestroyProjectiles" for n in tm[0]["do"]
                                  for a in r["actions"].get(n, [])), f"vortex: timer does not destroy projectiles")
    need("destroying projectiles" in desc["vortex"] and "regular" in desc["vortex"],
         "vortex description no longer mentions the regular projectile-destroying pulse")
    # ---- Phayze: 24 s (the game text says so), Camo on the thrown bloons, speed boost, per-skull power levels
    seconds = re.search(r"every (\d+) seconds", desc["phayze"])
    need(seconds is not None, "phayze description has no 'every N seconds'")
    for m, i, r in tiers("phayze"):
        tm = p_of(r, "timer")
        need(len(tm) == 2 and all(t["seconds"] == int(seconds.group(1)) for t in tm),
             f"phayze {m} {i + 1}: timers {[t['seconds'] for t in tm]} vs the text's {seconds.group(1)} seconds")
        need(a_of(r, "ThrowBloons")[0]["addCamo"] is True and "camo property" in desc["phayze"],
             "phayze: radar jam does not add Camo")
        ph = p_of(r, "phayze")[0]
        need(ph["shieldSpeedBoost"] > 1 and "increases its speed" in desc["phayze"], "phayze: shield speed boost")
        need(len(ph["powerLevels"]) == len(r["skulls"]), f"phayze {m} {i + 1}: powerLevels vs skulls")
        need(a_of(r, "GenerateShield")[0]["amount"] == r["shield"]["health"], "phayze: shield amount mismatch")
    # ---- Dreadbloon: armour = the shield decoded separately; damage reduction as in the text
    red = re.search(r"reduces all incoming damage by (\d+)", desc["dreadbloon"])
    need(red is not None, "dreadbloon description has no damage reduction number")
    for m in ("normal", "elite"):
        hs = [a_of(r, "GenerateArmour")[0]["amount"] for r in bosses["dreadbloon"][m]]
        need(hs == [r["shield"]["health"] for r in bosses["dreadbloon"][m]], f"dreadbloon {m}: armour vs shield")
        need(all(a < b for a, b in zip(hs, hs[1:])), f"dreadbloon {m}: armour not increasing")
    amounts = [p_of(r, "damageReduction")[0]["amount"] for _m, _i, r in tiers("dreadbloon")]
    need(all(a == int(a) for a in amounts) and int(red.group(1)) in amounts, f"dreadbloon: reduction {amounts}")
    # ---- Diamondback: one middle segment per skull, tail-shield break pauses it
    for m, i, r in tiers("diamondback"):
        db = p_of(r, "diamondback")[0]
        need(db["numOfMiddleSegments"] == len(r["skulls"]) and "sheds a middle segment" in desc["diamondback"],
             f"diamondback {m} {i + 1}: {db['numOfMiddleSegments']} middle segments, {len(r['skulls'])} skulls")
        need(0 < db["tailShieldMaxHealthPercent"] <= 1 and 0 < db["bloonBleedHealthPercent"] < 1, "diamondback ranges")
        need(r["actions"][db["tailShieldBrokenActionId"]][0]["pauseMovementDuration"] > 0, "diamondback tail break")
    # ---- Lych: three timers, tombstone zombie health order, sell-value reduction
    for m, i, r in tiers("lych"):
        names = [p["name"] for p in p_of(r, "timer")]
        need(names == ["drain", "regrow", "tombstone"], f"lych {m} {i + 1}: timers {names}")
        t = p_of(r, "tombstones")[0]
        need(t["tombstoneMoabHealthOverride"] < t["tombstoneBfbHealthOverride"] < t["tombstoneZomgHealthOverride"],
             f"lych {m} {i + 1}: tombstone zombie health not MOAB < BFB < ZOMG")
        need(0 < p_of(r, "worthReduction")[0]["worthMultiplier"] < 1, "lych: worth multiplier")
    for m in ("normal", "elite"):
        hs = [p_of(r, "tombstones")[0]["tombstoneHealthOverride"] for r in bosses["lych"][m]]
        need(all(a < b for a, b in zip(hs, hs[1:])), f"lych {m}: tombstone health {hs}")
    need("buffs" in desc["lych"] and "sellback" in desc["lych"], "lych description changed")
    # ---- Blastapopoulos: zones, heat bar growing with the tier, 2 s burn-off timer
    for m in ("normal", "elite"):
        hs = [p_of(r, "heat")[0]["maxHeatLevel"] for r in bosses["blastapopoulos"][m]]
        need(all(a < b for a, b in zip(hs, hs[1:])), f"blastapopoulos {m}: maxHeatLevel {hs}")
    for _m, _i, r in tiers("blastapopoulos"):
        need(p_of(r, "rangeZone")[0]["rangeMultiplier"] < 0 and p_of(r, "abilityCooldownZone")[0]["multiplier"] < 0,
             "blastapopoulos: zone multipliers")
        tm = p_of(r, "timer")
        need(len(tm) == 1 and tm[0]["do"] == ["RemoveDot"] and "burns off" in desc["blastapopoulos"],
             "blastapopoulos: burn-off timer")
    for key, words in (("blastapopoulos", ("heat", "range", "ability cooldowns")),):
        need(all(w in desc[key] for w in words), f"{key} description changed")


# ─────────────────────────────────────────────────────────────── build


def _num(x: float):
    return br.f32(x)


def build(sim: bytes, bloons: dict, text: dict, version: str) -> tuple[dict, dict]:
    blocks, first_obj, bloon_sec, bloon_end = bloon_blocks(sim, bloons)
    speed = {b: _f32(sim, p + br.SPEED_AT) for b, p in blocks.items()}
    check_speed(bloons, speed)
    prop_names = property_names(bloons)

    strings, s_next, s_end = string_pool(sim, bloons, blocks)
    tags_ref = {b: _i32(sim, p + 4) for b, p in blocks.items()}
    by_marker = {_i32(sim, p + 8): b for b, p in blocks.items()}
    if len(by_marker) != len(blocks):
        fail("+8 markers are not unique per bloon")
    tag_order = sorted((v, b) for b, v in tags_ref.items())
    tag_vals = [v for v, _ in tag_order]

    def owner_by_strings(sref: int):  # CHECK 5b
        i = bisect.bisect_right(tag_vals, sref) - 1
        return tag_order[i][1] if i >= 0 else None

    secs = object_sections(sim, bloon_sec, first_obj)
    if not secs or secs[0]["off"] != bloon_sec:
        fail("object sections not found after the BloonModel section")
    floats = anchor_floats(sim, secs, float_items(sim, s_end, bloon_sec), strings, tag_vals[0], s_next)
    trig = trigger_records(sim, secs, floats, strings, tag_vals[0], s_next)
    for t in trig:
        a, b = owner_by_reflist(sim, t["obj"], by_marker), owner_by_strings(t["sref"])
        if a != {b}:
            fail(f"skull owner check: object {t['obj']} -> reference list {sorted(a)}, string pool {b}")
        t["owner"] = b
    print(f"  bosses     {len(trig)} health-trigger records, owner agreed two ways on every one")
    models, refs = model_tables(sim, secs, blocks, by_marker, bloons, strings, floats, trig)
    print(f"  bosses     {sum(1 for c in models.cls if c in _SPEC)} behaviour-model sections decoded "
          f"({len(_SPEC)} classes, named from the game's metadata)")

    # boss types: tiered boss-flag bloons <Base>1-5 / <Base>Elite1-5 whose base has an info-panel text
    types = sorted({x["base"] for b, x in bloons.items() if x["boss"] and
                    re.fullmatch(re.escape(x["base"]) + r"(Elite)?[1-5]", b) and
                    text.get(x["base"] + "InfoPanelDescription")})
    if not types:
        fail("no boss types found")
    referenced = sim[bloon_end:]  # behaviour sections (after the BloonModel section)

    def is_used(bid: str) -> bool:
        return re.search(re.escape(bytes([len(bid)]) + bid.encode()) + rb"(?![A-Za-z0-9])", referenced) is not None

    def prop_list(bid: str) -> list:
        x = bloons[bid]
        out = [n for bit, n in sorted(prop_names.items()) if x["props"] & bit]
        return out + [n for n, bit in _FLAG_NAMES if x["flags"] & bit]

    bosses, icons, notes = {}, {}, []
    tier_trig: dict = {}

    def repeating(t: dict) -> bool:  # a HealthPercentTriggerModel with repeatFirst: fires every step, not once per skull
        n, r = models.at(t["obj"])
        return n == "HealthPercentTriggerModel" and r["repeatFirst"]

    for B in types:
        for fmt in (B + "{}", B + "Elite{}"):
            for i in range(1, 6):
                bid = fmt.format(i)
                if bid not in bloons or not bloons[bid]["boss"]:
                    fail(f"boss tier {bid} missing")
                mine = sorted((t for t in trig if t["owner"] == bid), key=lambda t: (-len(t["at"]), t["obj"]))
                if not mine:
                    fail(f"{bid}: no skull trigger")
                if len(mine) > 1 and len(mine[1]["at"]) == len(mine[0]["at"]):
                    fail(f"{bid}: two triggers with the most thresholds; cannot tell the skulls apart")
                tier_trig[bid] = mine
    shields, snotes, unparsed = shield_records(sim, secs, by_marker,
                                               {b: set(m[0]["do"]) for b, m in tier_trig.items()})
    notes += snotes
    immunity = immunity_records(sim, secs, by_marker, {b: set(m[0]["do"]) for b, m in tier_trig.items()},
                                {b: m[0]["at"] for b, m in tier_trig.items()}, text)
    print(f"  bosses     tower-set immunity on {len(immunity)} boss tiers "
          f"({', '.join(sorted({'-'.join(v[:4]) for v in immunity.values()}))})")
    for B in types:
        for fmt in (B + "{}", B + "Elite{}"):
            hs = [shields[fmt.format(i)]["health"] for i in range(1, 6) if fmt.format(i) in shields]
            if hs and (len(hs) != 5 or any(a >= b for a, b in zip(hs, hs[1:]))):
                fail(f"{fmt.format('*')}: shield health not on all 5 tiers or not increasing ({hs})")
    ratios = sorted({f"{bloon_base(b)} {round(v['health'] / bloons[b]['hp'], 4)}x"
                     + (" elite" if "Elite" in b else "") for b, v in shields.items()})
    print(f"  bosses     shields on {len(shields)} boss tiers (shield / boss health: {', '.join(ratios)}); "
          f"{len(unparsed)} other sections with skull actions not decoded")
    for B in types:
        key = B.lower()
        tiers = {}
        for mode, fmt in (("normal", B + "{}"), ("elite", B + "Elite{}")):
            rows = []
            for i in range(1, 6):
                bid = fmt.format(i)
                mine = tier_trig[bid]
                shape = lambda t: [{"at": _num(v), "do": list(t["do"])} for v in t["at"]]  # noqa: E731
                row = {"id": bid, "health": bloons[bid]["hp"], "speed": _num(speed[bid]),
                       "skulls": shape(mine[0]),
                       "triggers": [x for t in mine[1:] if not repeating(t) for x in shape(t)],
                       "props": prop_list(bid)}
                sname, srow = models.at(mine[0]["obj"])  # the skull record: a plain trigger, or Lych's script
                if sname not in ("HealthPercentTriggerModel", "LychBossSuperScriptModel") or                         (sname == "HealthPercentTriggerModel" and srow["repeatFirst"]):
                    fail(f"{bid}: skull record is {sname} (repeatFirst={srow and srow.get('repeatFirst')})")
                row["skullTrigger"] = {"preventFallthrough": srow["preventFallthrough"]}
                passives, actions, ids = tier_behaviour(_tier_models(models, refs, bid))
                # an action id a trigger runs that has no model in the tier does nothing (Lych 1 names three soul
                # spawns, the game only defines two); listed so the page can say so
                none = sorted(({n for t in mine for n in t["do"]} | {n for p in passives for n in p.get("do", [])})
                              - ids)
                if none:
                    row["noModel"] = none
                    notes.append(f"{bid}: runs action(s) {', '.join(none)} that have no model in the game data")
                if passives:
                    row["passives"] = passives
                if actions:
                    row["actions"] = actions
                if bid in shields:
                    row["shield"] = shields[bid]
                if bid in immunity:
                    row["immunity"] = immunity[bid]
                rows.append(row)
            tiers[mode] = rows
        allp = {tuple(r["props"]) for m in tiers.values() for r in m}
        entry = {"name": text.get(B), "tagline": text.get(B + "TagLine"), "tagline2": text.get(B + "TagLine2"),
                 "desc": [d for d in (bn.clean(x) for x in text[B + "InfoPanelDescription"].split("•")) if d]}
        if len(allp) == 1:
            entry["props"] = list(next(iter(allp)))
            for m in tiers.values():
                for r in m:
                    del r["props"]
        entry.update(tiers)
        spawns = []
        for skey, nfmt, efmt in SPAWNS.get(key, []):
            sp = {"key": skey, "name": bn.clean(text[skey]) if text.get(skey) else None}
            for mode, fmt in (("normal", nfmt), ("elite", efmt)):
                lst = []
                for i in range(1, 6):
                    bid = fmt.format(i)
                    if bid not in bloons:
                        fail(f"spawn {bid} missing")
                    lst.append({"id": bid, "health": bloons[bid]["hp"], "speed": _num(speed[bid]),
                                "used": is_used(bid)})
                sp[mode] = lst
            if skey == "Tombstone":  # the model's health is a placeholder: each Lych tier sets its tombstones'
                for mode in ("normal", "elite"):
                    for x, r in zip(sp[mode], tiers[mode]):
                        t = [p for p in r.get("passives", []) if p["kind"] == "tombstones"]
                        if len(t) != 1:
                            fail(f"lych {mode}: no tombstone health override")
                        x["health"] = _num(t[0]["tombstoneHealthOverride"])
            if skey in bloons:  # an untiered model of the same name: only if a behaviour spawns it
                if is_used(skey):
                    sp["untiered"] = {"id": skey, "health": bloons[skey]["hp"], "speed": _num(speed[skey])}
                else:
                    notes.append(f"untiered {skey} not referenced by any behaviour: left out")
            unused = [x["id"] for m in ("normal", "elite") for x in sp[m] if not x["used"]]
            if unused:
                notes.append(f"not referenced by any behaviour: {', '.join(unused)}")
            spawns.append(sp)
            # icon: the model's own sprite, unless it is borrowed from an unrelated standard bloon (Tombstone's
            # model icon is the ZOMG icon); an icon shared with a bloon whose id is part of the spawn's id is fine
            for mode, fmt, k in (("normal", nfmt, f"spawn:{skey}"), ("elite", efmt, f"spawn:{skey}:elite")):
                sid = fmt.format(1)
                ic = bloons[sid]["icon"]
                borrowed = [b for b, x in bloons.items() if x["icon"] == ic and b == x["base"] and not x["boss"]
                            and x["base"] != bloons[sid]["base"] and b not in sid
                            and b not in {f.format(i) for f in (nfmt, efmt) for i in range(1, 6)}]
                if not ic or borrowed:
                    notes.append(f"{k}: model icon {ic!r} not usable")
                elif mode == "normal" or ic != icons.get(f"spawn:{skey}"):
                    icons[k] = ic
        if spawns:
            entry["spawns"] = spawns
        bosses[key] = entry
    check_behaviour(bosses, bloons, {k: " ".join(bn.clean(text[B + "InfoPanelDescription"]).lower().split())
                                     for k, B in ((B.lower(), B) for B in types)})
    out = {"format": FORMAT_VERSION, "v": version,
           "speed": {b: _num(speed[b]) for b in ("Red", "Moab", "Bfb", "Zomg", "Bad")}, "bosses": bosses}
    for n in sorted(set(notes)):
        print(f"             note: {n}")
    return out, icons


def main() -> dict:
    """Writes bosses.json; returns the spawned bloons' icon specs ("Atlas/Sprite") for build_art."""
    if not br.AA_DIR.is_dir():
        sys.exit(f"BTD6 Addressables not found at {br.AA_DIR} (set BTD6_DIR)")
    text: dict = {}
    for _sec, i, t in bn.load_english():
        text.setdefault(i, t)
    version = br.load_game_version()
    if version == "unknown":
        fail("game version not read")
    sim = br.load_sim_model()
    bloons = br.parse_bloon_models(sim)
    data, icons = build(sim, bloons, {k: v for k, v in text.items()}, version)
    for B in data["bosses"].values():  # plain text for names / taglines (rich-text tags, literal \n)
        for k in ("name", "tagline", "tagline2"):
            if B[k] is not None:
                B[k] = bn.clean(B[k])
    raw = (json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    if not OUT.exists() or OUT.read_bytes() != raw:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_bytes(raw)
    print(f"  bosses     {len(data['bosses'])} boss types -> {OUT.relative_to(ROOT)} ({len(raw) / 1024:.1f} KB)")
    return icons


if __name__ == "__main__":
    _relaunch_in_venv()
    main()
