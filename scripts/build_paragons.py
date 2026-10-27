#!/usr/bin/env python3
"""Paragon data pipeline: writes web/src/data/paragons.json from the local BTD6 install's own data (for the
Tools -> Paragon degree calculator). Data (c) Ninja Kiwi - used with the site owner's approval.

Sources (all read-only):
  game_model_assets_all_*.bundle   TextAsset "sim_model" (NK's binary GameModel, see build_rounds.py). Two parts are
                                   decoded here:
    * GameModel.paragonDegreeDataModel (class ParagonDegreeDataModel, not a Model subclass, so no header record):
      its scalar fields are stored inline, in declaration order, as one 76-byte block
          6 x float32  attackCooldownReductionX piercePercentPerDegree pierceIncreasePerDegree damagePercentPerDegree
                       damageIncreasePerDegree damageIncreaseForDegrees
          5 x int32    degreeCount maxPowerFromPops maxPowerFromMoneySpent maxPowerFromNonTier5Count
                       maxPowerFromTier5Count
          4 x float32  popsOverX moneySpentOverX nonTier5TowersMultByX tier5TowersMultByX
          float32 bonusBossDamagePercent, int32 bonusBossDamagePerDegrees,
          float32 cashEarnedContributionModifier, float32 paidContributionPenalty
      and its int[] powerDegreeRequirements lives in the int[] pool at the start of the file ([int32 n] then n
      arrays of [int32 len][len x int32]; the pool count is the int32 at offset 0x2c).
      Field names/types/order: Assets.Scripts.Data.ParagonData.ParagonDegreeData(Model) of game 56.3 (checked in
      the MelonLoader/Cpp2IL assembly). The order is re-checked on every run against the field-name strings in
      il2cpp_data/Metadata/global-metadata.dat, and the block is located by shape (must be unique).
    * UpgradeModel records: a run of Model headers [int32 runtimeTypeIndex][u8 isTower][int32 id][u8 0][str name]
      (one per upgrade, all the same type), followed by the same number of data records
          [int32 cost][int32 xpCost][str icon guid][int32 path][int32 tier][int32 locked]
          [nullable str confirmation][nullable str localizedNameOverride]      (nullable str: u8 0 + str, or u8 1)
      Paragon upgrades are the ones with confirmation "Paragon" and path -1; their name is "<TowerId> Paragon".
  localization_assets_all_*.bundle English text table (paragon display names), via build_names.load_english.
  globalgamemanagers               the game version (build_rounds.load_game_version).

Not in the game data (so not in the JSON): the difficulty cost multipliers and the cost rounding rule (game code,
not data), and the power a Paragon Power Totem adds (the totem tower's behaviours carry no power value).
The power formulas themselves are game code too; the JSON only has the parameters, under the game's field names.

Run:
  python scripts/build_paragons.py    (re-launches itself inside .venv-art like build_rounds.py)

Output is deterministic (sorted keys, float32 values as their shortest round-trip decimal): same game build + same
script = byte-identical file. The script exits loudly when a game update moves or changes anything it checks.
"""
from __future__ import annotations

import json
import math
import re
import struct
import subprocess
import sys
from pathlib import Path

from _common import f32, relaunch_in_venv

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "data" / "paragons.json"
FORMAT_VERSION = 1
EXPECTED_PARAGONS = 14  # raise when NK ships a new paragon (after checking the new one decodes like the others)

# ParagonDegreeDataModel fields in declaration order: (name, struct code). powerDegreeRequirements is the int[].
FIELDS = [
    ("powerDegreeRequirements", None),
    ("attackCooldownReductionX", "f"), ("piercePercentPerDegree", "f"), ("pierceIncreasePerDegree", "f"),
    ("damagePercentPerDegree", "f"), ("damageIncreasePerDegree", "f"), ("damageIncreaseForDegrees", "f"),
    ("degreeCount", "i"), ("maxPowerFromPops", "i"), ("maxPowerFromMoneySpent", "i"),
    ("maxPowerFromNonTier5Count", "i"), ("maxPowerFromTier5Count", "i"),
    ("popsOverX", "f"), ("moneySpentOverX", "f"), ("nonTier5TowersMultByX", "f"), ("tier5TowersMultByX", "f"),
    ("bonusBossDamagePercent", "f"), ("bonusBossDamagePerDegrees", "i"),
    ("cashEarnedContributionModifier", "f"), ("paidContributionPenalty", "f"),
]
SCALARS = [(n, c) for n, c in FIELDS if c]
BLOCK = "<" + "".join(c for _, c in SCALARS)
BLOCK_LEN = struct.calcsize(BLOCK)  # 76
DEGREE_COUNT_AT = 4 * 6  # degreeCount follows the six leading floats


def fail(msg: str) -> None:
    sys.exit(f"build_paragons: {msg}")


# ─────────────────────────────────────────────────────────────── field order check (global-metadata.dat)


def check_field_order(metadata: bytes) -> None:
    """The metadata string table lists ParagonDegreeData's field names in declaration order, right after the type
    name; names already interned earlier in the table are not repeated. Rebuild that expectation from FIELDS."""
    start = metadata.find(b"\0powerDegreeRequirements\0")
    end = metadata.find(b"\0ParagonDegreeDataModel\0", start)
    if start < 0 or end < 0 or end - start > 2000:
        fail("ParagonDegreeData field names not found in global-metadata.dat; class renamed or moved?")
    seen = metadata[start + 1:end].split(b"\0")
    want = [n.encode() for n, _ in FIELDS if metadata.find(b"\0" + n.encode() + b"\0") >= start]
    if seen != want:
        fail(f"ParagonDegreeData fields changed: metadata lists {[s.decode() for s in seen]}, "
             f"decoder expects {[s.decode() for s in want]}")
    for n, _ in FIELDS:
        if metadata.find(b"\0" + n.encode() + b"\0") < 0:
            fail(f"field {n} no longer exists in global-metadata.dat")


# ─────────────────────────────────────────────────────────────── sim_model: degree data


def int_pool(b: bytes) -> list:
    n = struct.unpack_from("<i", b, 0x2C)[0]
    if not 0 < n < 1_000_000:
        fail(f"int[] pool count {n} at 0x2c looks wrong; sim_model header changed?")
    pos, out = 0x30, []
    for _ in range(n):
        c = struct.unpack_from("<i", b, pos)[0]
        if not 0 <= c <= 100_000:
            fail(f"int[] pool entry at {pos} has length {c}; sim_model layout changed?")
        out.append(struct.unpack_from(f"<{c}i", b, pos + 4))
        pos += 4 + 4 * c
    return out


def _sane_float(x: float, positive: bool) -> bool:
    return math.isfinite(x) and (x > 1e-6 if positive else (x == 0 or 1e-6 < x < 1e9))


def parse_degree_data(b: bytes) -> dict:
    ladders = [a for a in int_pool(b) if len(a) >= 20 and a[0] == 0 and all(x < y for x, y in zip(a, a[1:]))]
    if len(ladders) != 1:
        fail(f"expected one strictly increasing degree ladder in the int[] pool, found {len(ladders)}")
    req = list(ladders[0])
    hits = []
    for m in re.finditer(re.escape(struct.pack("<i", len(req))), b):
        p = m.start() - DEGREE_COUNT_AT
        if p < 0 or p + BLOCK_LEN > len(b):
            continue
        v = dict(zip((n for n, _ in SCALARS), struct.unpack_from(BLOCK, b, p)))
        # caps may be 0 (v57: upgrade tiers no longer add power); the counts may not
        ints_ok = all(v[n] >= 0 for n, c in SCALARS if c == "i") and v["degreeCount"] > 0 and v["bonusBossDamagePerDegrees"] > 0
        rates_ok = all(_sane_float(v[n], True) for n in ("popsOverX", "moneySpentOverX", "nonTier5TowersMultByX",
                                                         "tier5TowersMultByX"))
        rest_ok = all(_sane_float(v[n], False) for n, c in SCALARS if c == "f")
        if ints_ok and rates_ok and rest_ok:
            hits.append((p, v))
    if len(hits) != 1:
        fail(f"expected one ParagonDegreeDataModel block (degreeCount {len(req)}), found {len(hits)} at "
             f"{[p for p, _ in hits]}")
    p, v = hits[0]
    if v["degreeCount"] != len(req):
        fail("degreeCount disagrees with the degree ladder length")
    if req[-1] < max(v["maxPowerFromPops"], v["maxPowerFromMoneySpent"], v["maxPowerFromNonTier5Count"],
                     v["maxPowerFromTier5Count"]):
        fail("a single power-source cap exceeds the top degree's requirement; wrong block?")
    out = {n: (f32(x) if c == "f" else x) for (n, c), x in zip(SCALARS, (v[n] for n, _ in SCALARS))}
    out["powerDegreeRequirements"] = req
    print(f"  paragons   degree data at sim_model+{p}: {len(req)} degrees, last {req[-1]}")
    return out


# ─────────────────────────────────────────────────────────────── sim_model: UpgradeModel records


def _read_str(b: bytes, pos: int) -> tuple[str, int]:
    n = shift = 0
    while True:
        c = b[pos]
        pos += 1
        n |= (c & 0x7F) << shift
        if c < 0x80:
            break
        shift += 7
    return b[pos:pos + n].decode("utf-8"), pos + n


def _nullable_str(b: bytes, pos: int) -> tuple[str | None, int]:
    if b[pos] == 1:
        return None, pos + 1
    if b[pos] != 0:
        raise ValueError(f"bad string flag {b[pos]} at {pos}")
    return _read_str(b, pos + 1)


def _header(b: bytes, p: int):
    """[int32 runtimeTypeIndex][u8 isTower][int32 id][u8 0][str name] -> (type, name, end) or None."""
    if p < 0 or p + 11 > len(b) or b[p + 4] > 1 or b[p + 9] != 0:
        return None
    t = struct.unpack_from("<i", b, p)[0]
    if not 0 < t < 100_000:
        return None
    try:
        s, end = _read_str(b, p + 10)
    except (UnicodeDecodeError, IndexError):
        return None
    return t, s, end


def parse_upgrades(b: bytes) -> list:
    anchor = b"DartMonkey Paragon"
    names, p = [], 0
    for m in re.finditer(re.escape(bytes([len(anchor)]) + anchor), b):
        p0 = m.start() - 10
        r0 = _header(b, p0)
        if not r0:
            continue
        t, start = r0[0], p0
        while True:  # walk back to the first header of the run (names < 128 bytes: 1-byte length prefix)
            for L in range(0, 128):
                r = _header(b, start - 11 - L)
                if r and r[0] == t and r[2] == start:
                    start -= 11 + L
                    break
            else:
                break
        run, q = [], start
        while (r := _header(b, q)) and r[0] == t:
            run.append(r[1])
            q = r[2]
        if len(run) > len(names):
            names, p = run, q
    if len(names) < 100 or len(set(names)) != len(names):
        fail(f"UpgradeModel header run not found (best run: {len(names)} names)")
    ups = []
    try:
        for name in names:
            cost, xp = struct.unpack_from("<ii", b, p)
            icon, p = _read_str(b, p + 8)
            path, tier, locked = struct.unpack_from("<iii", b, p)
            conf, p = _nullable_str(b, p + 12)
            lno, p = _nullable_str(b, p)
            if not re.fullmatch(r"[0-9a-f]{32}|", icon) or not -1 <= path <= 2 or not 0 <= tier <= 30 \
                    or locked not in (0, 1) or cost < 0 or xp < 0:
                raise ValueError(f"implausible record for {name!r}: cost {cost} path {path} tier {tier} icon {icon!r}")
            ups.append({"name": name, "cost": cost, "xp": xp, "path": path, "tier": tier, "confirmation": conf, "icon": icon})
    except (ValueError, UnicodeDecodeError, struct.error, IndexError) as e:
        fail(f"UpgradeModel data records no longer decode ({e})")
    if sum(1 for u in ups if u["tier"] == 0 and u["path"] in (0, 1, 2)) < 60:
        fail("too few tier-1 upgrades decoded; UpgradeModel layout changed?")
    print(f"  paragons   {len(ups)} upgrade records decoded")
    return ups


# ─────────────────────────────────────────────────────────────── helpers


def tower_ids() -> set:
    src = (ROOT / "src" / "nk" / "types.ts").read_text(encoding="utf-8")
    m = re.search(r"export type TowerId = Open<(.*?)>;", src, re.S)
    if not m:
        fail("TowerId union not found in src/nk/types.ts")
    return set(re.findall(r'"(\w+)"', m.group(1)))


# ─────────────────────────────────────────────────────────────── build


def main() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import build_names
    import build_rounds

    if not build_rounds.AA_DIR.is_dir():
        fail(f"BTD6 Addressables not found at {build_rounds.AA_DIR} (set BTD6_DIR)")
    meta = build_rounds.DATA_DIR / "il2cpp_data" / "Metadata" / "global-metadata.dat"
    if not meta.is_file():
        fail(f"{meta} not found")
    check_field_order(meta.read_bytes())

    sim = build_rounds.load_sim_model()
    degree = parse_degree_data(sim)
    ups = parse_upgrades(sim)

    texts: dict = {}
    for _sec, i, t in build_names.load_english():
        if i.endswith(" Paragon"):
            texts.setdefault(i, set()).add(build_names.clean(t))
    towers = tower_ids()
    paragons = {}
    for u in ups:
        if u["confirmation"] != "Paragon":
            continue
        base = u["name"].removesuffix(" Paragon")
        if u["path"] != -1 or u["tier"] != 5 or base == u["name"]:
            fail(f"paragon upgrade {u['name']!r} has an unexpected shape (path {u['path']}, tier {u['tier']})")
        if base not in towers:
            fail(f"paragon base tower {base!r} is not a TowerId in src/nk/types.ts")
        names = texts.get(u["name"], set())
        if len(names) != 1:
            fail(f"English name of {u['name']!r}: expected exactly one, found {sorted(names)}")
        if u["cost"] <= 0 or base in paragons:
            fail(f"paragon {u['name']!r}: cost {u['cost']} / duplicate")
        paragons[base] = {"upgrade": u["name"], "name": names.pop(), "cost": u["cost"]}
    if len(paragons) != EXPECTED_PARAGONS:
        fail(f"expected {EXPECTED_PARAGONS} paragons, found {len(paragons)}: {sorted(paragons)}")

    data = {
        "formatVersion": FORMAT_VERSION,
        "gameVersion": build_rounds.load_game_version(),
        "degreeData": degree,
        "paragons": paragons,
    }
    if data["gameVersion"] == "unknown":
        fail("game version not read")
    raw = (json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not OUT.exists() or OUT.read_bytes() != raw:
        OUT.write_bytes(raw)
    print(f"  paragons   {len(paragons)} paragons, game {data['gameVersion']} -> {OUT.relative_to(ROOT)} "
          f"({len(raw) / 1024:.1f} KB)")


if __name__ == "__main__":
    relaunch_in_venv(__file__)
    main()
