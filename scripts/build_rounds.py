#!/usr/bin/env python3
"""Round-data pipeline: writes web/src/data/rounds/<id>.json (one per round set) + web/src/data/rounds/index.ts
from the local BTD6 install's own data. Data (c) Ninja Kiwi - used with the site owner's approval.

Sources (all read-only, from the Addressables bundles under BloonsTD6_Data/StreamingAssets/aa):
  game_data_assets_all_*.bundle    MonoBehaviours with {rounds, scale}: every round set (RoundSet / MergeableRoundSet).
                                   rounds[i].bloonGroups[] = {bloon, count, start, duration}, in SECONDS (the game
                                   converts to frames when it builds its sim model: freeplay group "Red x15" has
                                   end 5.0 here and 300.0 in sim_model, i.e. x60).
                                   Boss sets (MergeableRoundSet) carry {roundNumber, addToRound} per entry.
                                   Also: IncomeSets (linkedIncomeSet), game-mode mutators ({mutatorMods}).
  game_model_assets_all_*.bundle   TextAsset "sim_model": NK's binary game model. We decode only BloonModel records
                                   (id, baseId, isMoab/isBoss/camo/regrow/fortified, health, variant flags) and the
                                   string[] stream that holds each bloon's tags and spawn-children ids. The decoder
                                   validates itself (flags vs ids, children resolvable, no cycles) and exits loudly
                                   if a game update moves things.
  localization_assets_all_*.bundle English text table (bloon / boss / mode names), via build_names.load_english.
  sprite_atlases_assets_all_*.bundle  only to check that each bloon's icon sprite exists.
  globalgamemanagers               PlayerSettings.bundleVersion (the game version, e.g. "56.3").

Run:
  npm run art                         (build_art.py calls this at the end)
  python scripts/build_rounds.py      (just the rounds; re-launches itself inside .venv-art like build_art.py)

Output is deterministic (sorted keys, fixed float formatting): same game build + same script = byte-identical files.
"""
from __future__ import annotations

import glob
import json
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "web" / "src" / "data" / "rounds"
BTD6_DIR = Path(os.environ.get("BTD6_DIR", r"C:\Program Files (x86)\Steam\steamapps\common\BloonsTD6"))
DATA_DIR = BTD6_DIR / "BloonsTD6_Data"
AA_DIR = DATA_DIR / "StreamingAssets" / "aa" / "StandaloneWindows64" / "Full"
FORMAT_VERSION = 1


def _relaunch_in_venv() -> None:
    for rel in ("Scripts/python.exe", "bin/python"):
        venv_py = ROOT / ".venv-art" / rel
        if venv_py.exists():
            if Path(sys.prefix).resolve() != (ROOT / ".venv-art").resolve():
                sys.exit(subprocess.call([str(venv_py), __file__, *sys.argv[1:]]))
            return


def _bundle(prefix: str) -> Path:
    hits = sorted(glob.glob(str(AA_DIR / f"{prefix}_*.bundle")))
    if not hits:
        sys.exit(f"no {prefix}_*.bundle under {AA_DIR} (set BTD6_DIR)")
    return Path(hits[-1])


# ─────────────────────────────────────────────────────────────── game data (MonoBehaviours)


def load_game_data() -> tuple[dict, dict, dict]:
    """-> (round sets by game name, income sets by path id, mode mutators by name)."""
    import UnityPy

    env = UnityPy.load(str(_bundle("game_data_assets_all")))
    sets, incomes, modes = {}, {}, {}
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        tt = obj.read_typetree()
        if "rounds" in tt and "scale" in tt:
            sets[tt["m_Name"]] = tt
        elif "thresholds" in tt and "finalMultiplier" in tt:
            incomes[obj.path_id] = tt
        elif "mutatorMods" in tt and "references" in tt:
            refs = {r["rid"]: r for r in tt["references"]["RefIds"]}
            mods = []
            for m in tt["mutatorMods"]:
                r = refs.get(m["rid"])
                if r:
                    mods.append([r["type"]["class"], r["data"]])
            modes[tt["m_Name"]] = mods
    if "DefaultRoundSet" not in sets:
        sys.exit("DefaultRoundSet not found in game_data bundle")
    return sets, incomes, modes


def load_sim_model() -> bytes:
    import UnityPy

    env = UnityPy.load(str(_bundle("game_model_assets_all")))
    for obj in env.objects:
        if obj.type.name == "TextAsset" and obj.peek_name() == "sim_model":
            s = obj.read().m_Script
            return s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
    sys.exit("sim_model TextAsset not found")


def load_atlas_sprites() -> set:
    import UnityPy

    env = UnityPy.load(str(_bundle("sprite_atlases_assets_all")))
    out = set()
    for obj in env.objects:
        if obj.type.name == "SpriteAtlas":
            a = obj.read()
            out.update((a.m_Name, n) for n in a.m_PackedSpriteNamesToIndex)
    return out


def load_game_version() -> str:
    """PlayerSettings.bundleVersion. UnityPy's typetree for PlayerSettings is off by a few bytes on this Unity
    version, so read it from the raw object: the length-prefixed "NN.N[.N]" string (other version-like strings
    there are "1.0")."""
    import UnityPy

    try:
        env = UnityPy.load(str(DATA_DIR / "globalgamemanagers"))
        for obj in env.objects:
            if obj.type.name == "PlayerSettings":
                raw = obj.get_raw_data()
                for m in re.finditer(rb"(.{4})(\d{2,}\.\d+(?:\.\d+)?)", raw, re.S):
                    if struct.unpack("<i", m.group(1))[0] == len(m.group(2)):
                        return m.group(2).decode()
    except Exception as e:  # pragma: no cover
        print(f"  rounds     note: game version not read ({e})")
    return "unknown"


# ─────────────────────────────────────────────────────────────── sim_model: BloonModel decoder
#
# Layout observed in sim_model (reverse-engineered, validated below):
#   header list:  [int32 type][u8 0][int32 x][u8 0][7-bit-len string name]  one per BloonModel, all the same type
#   data records: [u8 0][str id][u8 0][str baseId][str display guid][str icon "Atlas[Sprite]"] + a 112-byte block
#       (v57; v56 was 110 bytes, without +35 and with health at +52, variant flags at +105):
#       +24 int32 bloonProperties bitmask     +32 u8 isMoab   +33 u8 isBoss   +34 u8 camo  +35 u8 (0 on every bloon)
#       +36 u8 regrow   +37 u8 fortified      +54 int32 health   +93 f32 speed  +107 int32 variant flags (1|2|4, -1=all)
#   string[] stream (elsewhere): [int32 n] n x ([u8 0][str]) per array, in BloonModel order: each bloon's tags array,
#       followed (for bloons that spawn children) by its children id array (one entry per child).

BLOCK = 112  # BloonModel block size; HP_AT / SPEED_AT: offsets of health (i32) and speed (f32) in it
HP_AT = 54
SPEED_AT = 93
_VARIANT_TAGS = {"Camo": 1, "Grow": 2, "Fortified": 4}
_SUFFIX = (("Regrow", 2), ("Fortified", 4), ("Camo", 1))  # order the game uses in ids: <Base>Regrow?Fortified?Camo?


def _read_str(b: bytes, pos: int) -> tuple[str, int]:
    n = shift = 0
    while True:
        c = b[pos]
        pos += 1
        n |= (c & 0x7F) << shift
        if c < 0x80:
            break
        shift += 7
    return b[pos:pos + n].decode("utf-8", "replace"), pos + n


def _header_run(b: bytes) -> tuple[list, int]:
    """The BloonModel header list: the longest run of same-type header records that contains 'Red'."""

    def rec(p):
        t = struct.unpack_from("<i", b, p)[0]
        if b[p + 4] != 0 or b[p + 9] != 0 or not 0 < t < 100000:
            return None
        s, end = _read_str(b, p + 10)
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*", s):
            return None
        return t, s, end

    best: tuple[list, int] = ([], 0)
    for m in re.finditer(rb"\x00\x03Red", b):
        p0 = m.start() - 9
        if p0 < 0 or (r0 := rec(p0)) is None:
            continue
        t = r0[0]
        start = p0
        while True:  # walk back to the first record of the run
            for L in range(2, 70):
                p = start - 10 - L
                r = rec(p) if p >= 0 else None
                if r and r[0] == t and r[2] == start:
                    start = p
                    break
            else:
                break
        names, p = [], start
        while (r := rec(p)) and r[0] == t:
            names.append(r[1])
            p = r[2]
        if len(names) > len(best[0]) and {"Red", "Blue", "Ceramic", "Moab"} <= set(names):
            best = (names, p)
    if not best[0]:
        sys.exit("sim_model: BloonModel header list not found")
    return best


def parse_bloon_models(b: bytes) -> dict:
    ids, pos = _header_run(b)
    out: dict = {}
    for bid in ids:
        pat = re.compile(re.escape(b"\x00" + bytes([len(bid)]) + bid.encode()) + rb"\x00")
        m = pat.search(b, pos)
        if not m:
            sys.exit(f"sim_model: BloonModel record {bid!r} not found")
        p = m.start() + 1
        s_id, p = _read_str(b, p)
        base, p = _read_str(b, p + 1)
        _display, p = _read_str(b, p)
        icon, p = _read_str(b, p)
        blk = b[p:p + BLOCK]
        pos = p + BLOCK
        bools = blk[32:38]
        if any(x > 1 for x in bools) or bools[3]:
            sys.exit(f"sim_model: unexpected BloonModel layout at {bid!r} (flag bytes {bools.hex()})")
        camo, grow, fort = bools[2], bools[4], bools[5]
        flags = camo | grow << 1 | fort << 2
        var = struct.unpack_from("<i", blk, 107)[0]
        if (7 if var == -1 else var) != flags:
            sys.exit(f"sim_model: variant flags {var} of {bid!r} disagree with its camo/regrow/fortified bytes")
        m_icon = re.fullmatch(r"(\w+)\[(\w+)\]", icon)
        out[s_id] = {
            "base": base, "moab": bools[0], "boss": bools[1], "flags": flags,
            "hp": struct.unpack_from("<i", blk, HP_AT)[0], "props": struct.unpack_from("<i", blk, 24)[0],
            "icon": f"{m_icon.group(1)}/{m_icon.group(2)}" if m_icon else None,
        }
    # Self-check: wherever an id spells <base><Regrow?><Fortified?><Camo?>, the decoded flags must say the same.
    checked = 0
    for bid, x in out.items():
        spelled = x["base"] + "".join(s for s, bit in _SUFFIX if x["flags"] & bit)
        if bid.startswith(x["base"]) and re.fullmatch(r"(Regrow)?(Fortified)?(Camo)?", bid[len(x["base"]):]):
            if spelled != bid:
                sys.exit(f"sim_model: flags of {bid!r} decode as {spelled!r}")
            checked += 1
    if checked < 50:
        sys.exit(f"sim_model: only {checked} bloon ids could be checked against their flags; layout changed?")
    return out


def _read_arr(b: bytes, pos: int):
    n = struct.unpack_from("<i", b, pos)[0]
    if not 0 <= n <= 4096:
        return None
    pos += 4
    items = []
    for _ in range(n):
        if pos >= len(b) or b[pos] != 0:
            return None
        s, pos = _read_str(b, pos + 1)
        if not re.fullmatch(r"[\w:\- .]*", s):
            return None
        items.append(s)
    return items, pos


_ARR_START = re.compile(rb"(?=[\x00-\x40]\x00\x00\x00)")


def _arrays_around(b: bytes, anchor: int, back: int = 4000) -> list:
    """The string[] stream around `anchor`: walk back up to `back` arrays (unique predecessor ending exactly where
    the known array starts), then forward until the framing breaks."""
    start = anchor
    for _ in range(back):
        lo = max(start - 2048, 0)
        preds = [m.start() for m in _ARR_START.finditer(b, lo, start)]
        preds = [p for p in preds if p <= start - 4 and (r := _read_arr(b, p)) and r[1] == start]
        if len(preds) != 1:
            break
        start = preds[0]
    arrs, p = [], start
    while (r := _read_arr(b, p)) is not None:
        arrs.append(r[0])
        p = r[1]
    return arrs


def attach_tags_children(b: bytes, bloons: dict) -> list:
    """Adds 'tags' and (when present) 'children' to the standard bloons. Returns the ids that got tags."""
    red = next((k for k, v in bloons.items() if k == v["base"] == "Red"), None)
    if not red:
        return []
    # Anchor: the Red family's 4 tags arrays [T], [T,Camo], [T,Grow], [T,Grow,Camo] back to back (Red has no children).
    m = re.search(rb"\x01\x00\x00\x00\x00([\x01-\x3f])([A-Za-z]+)\x02\x00\x00\x00\x00\1\2\x00\x04Camo"
                  rb"\x02\x00\x00\x00\x00\1\2\x00\x04Grow\x03\x00\x00\x00\x00\1\2\x00\x04Grow\x00\x04Camo", b)
    if not m:
        print("  rounds     note: bloon tags stream not found; no children / RBE")
        return []
    arrs = _arrays_around(b, m.start())
    order = list(bloons)
    ids = set(bloons)

    def standard(bid):
        x = bloons[bid]
        return not x["boss"] and bid.startswith(x["base"]) and bool(
            re.fullmatch(r"(Regrow)?(Fortified)?(Camo)?", bid[len(x["base"]):]))

    def tags_ok(a, bid):
        x = bloons[bid]
        if not a or not x["base"].startswith(a[0]):
            return False
        vt = [t for t in a if t in _VARIANT_TAGS]
        return sum(_VARIANT_TAGS[t] for t in vt) == x["flags"] and len(vt) == len(set(vt))

    def after(j, bid):
        """index after bid's tags at j (+ its children array, if the next array is one)."""
        k = order.index(bid)
        nxt = order[k + 1] if k + 1 < len(order) else None
        c = arrs[j + 1] if j + 1 < len(arrs) else None
        is_children = bool(c) and all(i in ids for i in c) and not (nxt and standard(nxt) and tags_ok(c, nxt))
        return (j + 2, c) if is_children else (j + 1, None)

    got, p = [], 0
    for k, bid in enumerate(order):
        if not standard(bid):
            continue
        fam = [o for o in order[k:] if bloons[o]["base"] == bloons[bid]["base"] and standard(o)]
        # a lone bloon (no family to chain-check) must sit close to where the stream is
        for j in range(p, len(arrs) if len(fam) > 1 else min(p + 200, len(arrs))):
            if not tags_ok(arrs[j], bid):
                continue
            # chain check: the rest of the family must follow, in order
            q, ok = j, True
            for f in fam:
                if q >= len(arrs) or not tags_ok(arrs[q], f):
                    ok = False
                    break
                q, _ = after(q, f)
            if ok:
                nj, ch = after(j, bid)
                bloons[bid]["tags"] = arrs[j]
                p = nj
                if "Frontier" in arrs[j]:
                    # Legends-only bloons: their other arrays belong to special behaviours (bursts, auras, ...),
                    # so what follows the tags is not reliably a plain spawn-children list. No tree, no RBE.
                    break
                if ch:
                    bloons[bid]["children"] = ch
                got.append(bid)
                break
    # sanity: no cycles
    def depth(bid, seen=()):
        if bid in seen:
            sys.exit(f"sim_model: children cycle through {bid!r}")
        return 1 + max((depth(c, seen + (bid,)) for c in bloons[bid].get("children", [])), default=0)

    for bid in got:
        depth(bid)
    return got


def compute_rbe(bloons: dict, have_tags: set) -> None:
    """rbe = own health + rbe of every child (recursively); rbeMoab = the part from MOAB-class layers.
    Only for bloons whose whole descendant tree was decoded (tags found => children known)."""
    memo: dict = {}

    def go(bid):
        if bid in memo:
            return memo[bid]
        x = bloons[bid]
        if bid not in have_tags:
            memo[bid] = None
            return None
        tot, mo = x["hp"], x["hp"] if x["moab"] else 0
        for c in x.get("children", []):
            r = go(c)
            if r is None:
                memo[bid] = None
                return None
            tot, mo = tot + r[0], mo + r[1]
        memo[bid] = (tot, mo)
        return memo[bid]

    for bid in bloons:
        r = go(bid)
        if r:
            bloons[bid]["rbe"], bloons[bid]["rbeMoab"] = r


# ─────────────────────────────────────────────────────────────── helpers


def f32(x: float) -> float | int:
    """Shortest decimal that round-trips to the same float32 (the game's own value), ints as ints."""
    target = struct.pack("<f", x)
    for p in range(1, 10):
        v = float(f"{x:.{p}g}")
        if struct.pack("<f", v) == target:
            return int(v) if v == int(v) else v
    return x


def end_of(start: float, duration: float) -> float | int:
    """start + duration of the game's float32 values, to 1/10000 s (float32 sums only add noise below that)."""
    v = round(float(f32(start)) + float(f32(duration)), 4)
    return int(v) if v == int(v) else v


_WORDS = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])")


def kebab(game_id: str) -> str:
    """Site id: "QuestAdoraTrialRoundSet" -> "quest-adora-trial", "DefaultRoundSet" -> "default", "vortex" -> "vortex"."""
    return _WORDS.sub("-", game_id.replace("RoundSet", "") or game_id).lower()


def humanize(game_id: str) -> str:
    return _WORDS.sub(" ", game_id.replace("RoundSet", "") or game_id)


def _lit(v) -> str:
    return json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(", ", ": "))


# ─────────────────────────────────────────────────────────────── build


BOSS_SETS_BASE = "DefaultRoundSet"  # API roundSets ["default", "<boss>"]: the boss set is merged onto the default set
API_DEFAULT = {"DefaultRoundSet": ["default"]}  # "default" is the only non-boss value seen in docs/api/fixtures


def build(sets: dict, incomes: dict, modes: dict, bloons: dict, text: dict, sprites: set, version: str,
          sprite_keys: set) -> tuple[dict, str]:
    used_ids = sorted({g["bloon"] for s in sets.values() for r in s["rounds"] for g in r["bloonGroups"]})
    unknown = [i for i in used_ids if i not in bloons]
    if unknown:
        sys.exit(f"round sets use bloon ids missing from sim_model: {unknown}")

    # bloon types (the key used in set files) = lower-case baseId; flags = the model's variant bitmask
    def key_of(bid):
        return bloons[bid]["base"].lower()

    types: dict = {}
    for bid, x in bloons.items():
        if x["boss"] or not (bid.startswith(x["base"]) and re.fullmatch(r"(Regrow)?(Fortified)?(Camo)?",
                                                                         bid[len(x["base"]):])):
            continue
        k = key_of(bid)
        t = types.setdefault(k, {"id": x["base"], "moab": bool(x["moab"]), "variants": {}, "used": set()})
        t["variants"][x["flags"]] = bid
    for bid in used_ids:
        types[key_of(bid)]["used"].add(bloons[bid]["flags"])
    types = {k: v for k, v in types.items() if v["used"]}

    def type_name(base):
        for lid in (base, f"ft_{base.lower()}title"):
            if text.get(lid):
                return re.sub(r"!$", "", text[lid]).strip()
        return humanize(base)

    # modes that swap the round set (RoundSetModModel)
    set_modes: dict = {}
    for mode, mods in modes.items():
        for cls, data in mods:
            if cls == "RoundSetModModel" and data.get("roundsetName"):
                set_modes.setdefault(data["roundsetName"], []).append(mode)

    def groups_of(r):
        g = []
        for grp in r["bloonGroups"]:
            bid = grp["bloon"]
            start = grp["start"]
            g.append([key_of(bid), bloons[bid]["flags"], int(grp["count"]), f32(start), end_of(start, grp["duration"])])
        return g

    def round_obj(n, g, override=False):
        o: dict = {"n": n, "g": g}
        rbe = mo = 0
        for key, flags, count, *_ in g:
            bid = types[key]["variants"].get(flags)
            x = bloons.get(bid) if bid else None
            if not x or "rbe" not in x:
                rbe = None
                break
            rbe += count * x["rbe"]
            mo += count * x["rbeMoab"]
        if rbe is not None:
            o["rbe"] = rbe
            o["rbeMoab"] = mo
        if override:
            o["o"] = 1
        return o

    manifest = []
    files: dict = {}
    boss_names = {n for n, s in sets.items() if s["rounds"] and "roundNumber" in s["rounds"][0]}
    rank = {"DefaultRoundSet": 0, "AlternateRoundSet": 1}
    for gid in sorted(sets, key=lambda g: (rank.get(g, 2 if g in boss_names else 3), kebab(g))):
        s = sets[gid]
        sid = kebab(gid)
        entry: dict = {"id": sid, "gameId": gid}
        if gid in boss_names:
            base = sets[BOSS_SETS_BASE]["rounds"]
            over = {r["roundNumber"]: r for r in s["rounds"]}
            if any(r.get("addToRound") for r in s["rounds"]):
                sys.exit(f"{gid}: addToRound=1 entries seen; merge semantics need a look")
            rounds, changed = [], []
            for n in range(1, max(len(base), max(over)) + 1):
                if n in over:
                    diff = n > len(base) or over[n]["bloonGroups"] != base[n - 1]["bloonGroups"]
                    rounds.append(round_obj(n, groups_of(over[n]), diff))
                    if diff:
                        changed.append(n)
                else:
                    rounds.append(round_obj(n, groups_of(base[n - 1])))
            entry.update(name=type_name(gid.capitalize()) if text.get(gid.capitalize()) else humanize(gid).title(),
                         group="boss", boss=gid, base=kebab(BOSS_SETS_BASE), api=[gid], modes=[],
                         overrides=changed)
        else:
            rounds = [round_obj(i + 1, groups_of(r)) for i, r in enumerate(s["rounds"])]
            name = {"DefaultRoundSet": "Default"}.get(gid)
            if not name and set_modes.get(gid):
                name = text.get("Mode " + set_modes[gid][0])
            if not name:
                name = text.get(gid + "QuestName") or humanize(gid)
            group = ("standard" if gid in ("DefaultRoundSet", "AlternateRoundSet") else
                     "frontier" if gid.startswith("Frontier") else "rogue" if gid.startswith("Rogue") else
                     "quest" if re.match(r"Quest|.*(Quest|Tale|Stage)", gid) else "other")
            entry.update(name=name, group=group, api=API_DEFAULT.get(gid, []), modes=sorted(set_modes.get(gid, [])))
            inc = s.get("linkedIncomeSet") or {}
            if inc.get("m_PathID") in incomes:
                entry["incomeSet"] = incomes[inc["m_PathID"]]["m_Name"]
        if s.get("scale") not in (None, 1.0):
            entry["scale"] = f32(s["scale"])
        entry["first"], entry["last"] = 1, len(rounds)
        entry["hasRbe"] = all("rbe" in r for r in rounds)
        files[sid] = {"v": FORMAT_VERSION, "id": sid, "rounds": rounds}
        manifest.append(entry)

    # income sets used by any set (raw: pop-cash multiplier thresholds by round)
    inc_used = sorted({e["incomeSet"] for e in manifest if "incomeSet" in e})
    inc_out = {}
    for t in incomes.values():
        if t["m_Name"] in inc_used:
            inc_out[t["m_Name"]] = {"thresholds": [[int(i["threshold"]), f32(i["multiplier"])] for i in t["thresholds"]["items"]],
                                    "final": f32(t["finalMultiplier"])}

    # bloon type table
    btypes = {}
    for k in sorted(types):
        t = types[k]
        icons = {}
        for flags, bid in sorted(t["variants"].items()):
            ic = bloons[bid]["icon"]
            if ic and tuple(ic.split("/", 1)) in sprites:
                icons[flags] = ic
        btypes[k] = {"id": t["id"], "name": type_name(t["id"]), "sprite": k if k in sprite_keys else None,
                     "moab": t["moab"], "variants": sorted(t["variants"]), "used": sorted(t["used"]),
                     "icons": icons}
    # per game-id detail for ids in the sets and their descendants
    need, stack = set(), list(used_ids)
    while stack:
        i = stack.pop()
        if i in need:
            continue
        need.add(i)
        stack.extend(bloons[i].get("children", []))
    bl = {}
    for bid in sorted(need):
        x = bloons[bid]
        e = {"base": x["base"], "flags": x["flags"], "hp": x["hp"], "moab": bool(x["moab"])}
        if "tags" in x:
            e["tags"] = x["tags"]
            e["children"] = x.get("children", [])
        if "rbe" in x:
            e["rbe"], e["rbeMoab"] = x["rbe"], x["rbeMoab"]
        bl[bid] = e

    mode_out = {m: [[c, {k: (f32(v) if isinstance(v, float) else v) for k, v in sorted(d.items())}] for c, d in mods]
                for m, mods in sorted(modes.items())}
    ts = render_index(manifest, btypes, bl, mode_out, inc_out, version, text)
    return files, ts


HEAD = """// Round sets from the game's own data (© Ninja Kiwi).
// GENERATED by scripts/build_rounds.py (run by `npm run art`) from the local BTD6 install. Do not edit by hand.
//
// Set files (./<id>.json, imported with ?url so Vite content-hashes them into /assets/, cacheable immutably):
//   { v: 1, id, rounds: [{ n, g: [[key, flags, count, start, end], ...], rbe?, rbeMoab?, o? }] }
//   n        round number (1-based)
//   g        the round's bloon groups, in the game's order. key = BLOON_TYPES key (lower-case game baseId, e.g.
//            "ceramic"); flags = the game's variant bitmask (camo 1, regrow 2, fortified 4); count = bloons in the
//            group; start/end = spawn window in SECONDS from round start (the game stores seconds here and
//            converts to 60 fps frames in its sim model; end = start + the game's "duration"). Values are the
//            game's float32 values, printed shortest. One group in the default set starts at -0.15 (as in the game).
//   rbe      Red Bloon Equivalent of the round: sum over groups of count x RBE(bloon), where RBE(bloon) = its
//            BloonModel health + RBE of each spawned child (recursively). Omitted when a bloon's tree could not be
//            decoded (Legends-only bloons such as AuraBloon). Before any event health multiplier.
//   rbeMoab  the part of rbe from MOAB-class layers (BloonModel isMoab), so a MOAB health multiplier can rescale.
//   o        1 = the boss set replaced this round with different groups (boss sets = the default set with the
//            boss set's rounds swapped in; the game's entries all have addToRound = 0, i.e. replace).
// Cash is NOT included: the model's per-pop cash rules are code, not data (see INCOME_SETS / MODE_MODS for the
// data that does exist).
"""


def render_index(manifest, btypes, bl, modes, incomes, version, text) -> str:
    imports = "".join(f'import u{i} from "./{e["id"]}.json?url";\n' for i, e in enumerate(manifest))
    rows = []
    for i, e in enumerate(manifest):
        e2 = {k: v for k, v in e.items()}
        body = ", ".join(f"{k}: {_lit(v)}" for k, v in e2.items())
        rows.append(f"  {{ {body}, url: u{i}, file: () => loadRoundSet(u{i}) }},\n")
    bt = "".join(f"  {_lit(k)}: {_lit(v)},\n" for k, v in btypes.items())
    blo = "".join(f"  {_lit(k)}: {_lit(v)},\n" for k, v in bl.items())
    md = "".join(f"  {_lit(k)}: {_lit(v)},\n" for k, v in modes.items())
    inc = "".join(f"  {_lit(k)}: {_lit(v)},\n" for k, v in sorted(incomes.items()))
    return (
        HEAD + "\n" + imports + """
/** [key, flags, count, startSec, endSec] */
export type Group = [key: string, flags: number, count: number, start: number, end: number];
export interface Round {
  n: number;
  g: Group[];
  rbe?: number;
  rbeMoab?: number;
  /** 1 = the boss set replaced this round (with groups that differ from the default set) */
  o?: 1;
}
export interface RoundSetData {
  v: 1;
  id: string;
  rounds: Round[];
}
export interface RoundSetInfo {
  /** site id (URL `set=`): kebab-case game id without "RoundSet"; "default" and boss ids equal the API values */
  id: string;
  /** the game's own round-set asset name, e.g. "DefaultRoundSet", "vortex" */
  gameId: string;
  name: string;
  group: "standard" | "boss" | "quest" | "frontier" | "rogue" | "other";
  /** ChallengeDocument.roundSets values that select this set (boss sets: the boss id; see README notes) */
  api: string[];
  /** ChallengeDocument.mode values whose game mutator swaps in this set (RoundSetModModel), e.g. AlternateBloonsRounds */
  modes: string[];
  /** boss sets: boss type (as in Boss.bossType / art keys) */
  boss?: string;
  /** boss sets: the set the boss rounds are merged onto */
  base?: string;
  /** boss sets: round numbers where the boss set's groups differ from the base set */
  overrides?: number[];
  /** the game's linked IncomeSet (pop-cash multiplier by round), see INCOME_SETS */
  incomeSet?: string;
  /** the set's raw `scale` field when not 1 (meaning not known) */
  scale?: number;
  first: number;
  last: number;
  /** every round has rbe */
  hasRbe: boolean;
  /** hashed asset URL of the set file */
  url: string;
  file: () => Promise<RoundSetData>;
}
export interface BloonType {
  /** game baseId */
  id: string;
  /** English name from the game's text table */
  name: string;
  /** key in the `bloon` sprite family, or null when there is no sprite yet */
  sprite: string | null;
  /** MOAB-class (BloonModel isMoab) */
  moab: boolean;
  /** flag combos the game model defines for this bloon (what all-camo/regrow/fortified can turn it into) */
  variants: number[];
  /** flag combos used by any round set */
  used: number[];
  /** flag combo -> the game's own icon sprite ("Atlas/Sprite" as in build_art.py specs), when it exists */
  icons: Record<string, string>;
}
export interface BloonInfo {
  base: string;
  flags: number;
  /** BloonModel health of this layer */
  hp: number;
  moab: boolean;
  tags?: string[];
  children?: string[];
  rbe?: number;
  rbeMoab?: number;
}

export const FLAG = { camo: 1, regrow: 2, fortified: 4 } as const;
export const GAME_VERSION = """ + _lit(version) + """;
/** Which optional values the data provides. */
export const ROUND_FIELDS = { rbe: true, rbeMoab: true, cash: false, perLayerHealth: true, modeIncomeRules: "partial" } as const;

export async function loadRoundSet(url: string): Promise<RoundSetData> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`round set ${url}: HTTP ${r.status}`);
  return (await r.json()) as RoundSetData;
}

export const ROUND_SETS: RoundSetInfo[] = [
""" + "".join(rows) + """];

export const ROUND_SET_BY_ID: Record<string, RoundSetInfo> = Object.fromEntries(ROUND_SETS.map((s) => [s.id, s]));

/** Resolve a ChallengeDocument's roundSets + mode to a set: a boss value wins, then a mode that swaps the set,
 *  then the first API value. Returns undefined for unknown values. */
export function resolveRoundSet(roundSets: readonly string[] = [], mode?: string): RoundSetInfo | undefined {
  const boss = ROUND_SETS.find((s) => s.boss && roundSets.includes(s.api[0]!));
  if (boss) return boss;
  const byMode = mode ? ROUND_SETS.find((s) => s.modes.includes(mode)) : undefined;
  if (byMode) return byMode;
  return ROUND_SETS.find((s) => roundSets.some((v) => s.api.includes(v)));
}

/** Bloon types used by the round sets, keyed by the `key` in set files. */
export const BLOON_TYPES: Record<string, BloonType> = {
""" + bt + """};

/** Every game bloon id used by a set (and their spawned children): the decoded BloonModel values. */
export const BLOONS: Record<string, BloonInfo> = {
""" + blo + """};

/** Game-mode mutators as the game defines them (ChallengeDocument.mode values: Clicks = CHIMPS, HalfCash,
 *  Deflation, AlternateBloonsRounds, Apopalypse, …): [modelClass, data]. Income-related ones: StartingCashModModel,
 *  ModifyAllCashModModel (multiplier on all cash), BonusCashPerRoundModModel, ChimpsModModel (no data: its rules
 *  are code). Apopalypse has no RoundSetModModel: no fixed round set. */
export const MODE_MODS: Record<string, [string, Record<string, number | string>][]> = {
""" + md + """};

/** The game's IncomeSets (linked from round sets): [roundThreshold, popCashMultiplier] pairs + the multiplier after
 *  the last threshold. Raw data; how the game applies the thresholds is code. */
export const INCOME_SETS: Record<string, { thresholds: [number, number][]; final: number }> = {
""" + inc + """};
""")


def _sprite_keys() -> set:
    """Keys of the `bloon` family in web/src/art/index.ts (generated by build_art.py)."""
    idx = ROOT / "web" / "src" / "art" / "index.ts"
    if not idx.exists():
        return set()
    m = re.search(r"\bbloon:\s*\{[^\n]*?keys:\s*\{([^}]*)\}", idx.read_text("utf-8"))
    return set(re.findall(r'"?([\w-]+)"?\s*:', m.group(1))) if m else set()


def main() -> None:
    if not AA_DIR.is_dir():
        sys.exit(f"BTD6 Addressables not found at {AA_DIR} (set BTD6_DIR)")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_names

    text: dict = {}
    for _sec, i, t in build_names.load_english():
        text.setdefault(i, build_names.clean(t))
    sets, incomes, modes = load_game_data()
    sim = load_sim_model()
    bloons = parse_bloon_models(sim)
    have = set(attach_tags_children(sim, bloons))
    compute_rbe(bloons, have)
    files, ts = build(sets, incomes, modes, bloons, text, load_atlas_sprites(), load_game_version(), _sprite_keys())

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for sid, data in files.items():
        raw = (json.dumps(data, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
        total += len(raw)
        path = OUT_DIR / f"{sid}.json"
        if not path.exists() or path.read_bytes() != raw:
            path.write_bytes(raw)
    for stale in OUT_DIR.glob("*.json"):
        if stale.stem not in files:
            stale.unlink()
    data = ts.encode("utf-8")
    idx = OUT_DIR / "index.ts"
    if not idx.exists() or idx.read_bytes() != data:
        idx.write_bytes(data)
    used = sorted({g["bloon"] for s in sets.values() for r in s["rounds"] for g in r["bloonGroups"]})
    no_rbe = [i for i in used if "rbe" not in bloons[i]]
    print(f"  rounds     {len(files)} sets, {len(used)} bloon ids ({len(have)} decoded trees) -> "
          f"{OUT_DIR.relative_to(ROOT)} ({total / 1024:.1f} KB json, index {len(data) / 1024:.1f} KB)")
    if no_rbe:
        print(f"             no RBE (tree not decoded): {', '.join(no_rbe)}")


if __name__ == "__main__":
    _relaunch_in_venv()
    main()
