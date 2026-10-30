"""Helpers shared by the build_*.py scripts (run from scripts/, so `import _common` works)."""
from __future__ import annotations

import glob
import os
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BTD6_DIR = Path(os.environ.get("BTD6_DIR", r"C:\Program Files (x86)\Steam\steamapps\common\BloonsTD6"))
AA_DIR = BTD6_DIR / "BloonsTD6_Data" / "StreamingAssets" / "aa" / "StandaloneWindows64" / "Full"
# Mod Helper "Export Game Data" (the game model as JSON), one folder per game version (game-export/README.md).
EXPORT_ROOT = Path(os.environ.get("GAME_EXPORT_ROOT", ROOT.parent / "game-export"))


def game_export(version: str) -> Path:
    """The export for exactly this game version (build_rounds.load_game_version()): never mixes two versions."""
    path = EXPORT_ROOT / f"v{version}"
    if not (path / "Towers").is_dir():
        sys.exit(f"no Mod Helper export for game {version} at {path}: re-export (game-export/README.md)")
    return path


def relaunch_in_venv(script: str) -> None:
    """`npm run art` calls plain `python`; hop into .venv-art (pinned deps) when we're not already in it."""
    venv = ROOT / ".venv-art"
    for rel in ("Scripts/python.exe", "bin/python"):
        venv_py = venv / rel
        if venv_py.exists():
            if Path(sys.prefix).resolve() != venv.resolve():
                sys.exit(subprocess.call([str(venv_py), script, *sys.argv[1:]]))
            return
    sys.exit("missing .venv-art; create it with:\n  python -m venv .venv-art && "
             ".venv-art/Scripts/pip install -r scripts/requirements-art.txt")


def find_bundle(aa_dir: Path, prefix: str) -> Path:
    hits = sorted(glob.glob(str(aa_dir / f"{prefix}_*.bundle")))
    if not hits:
        sys.exit(f"no {prefix}_*.bundle under {aa_dir} (set BTD6_DIR)")
    return Path(hits[-1])


def f32(x: float) -> float | int:
    """Shortest decimal that round-trips to the same float32 (the game's own value), ints as ints."""
    target = struct.pack("<f", x)
    for p in range(1, 10):
        v = float(f"{x:.{p}g}")
        if struct.pack("<f", v) == target:
            return int(v) if v == int(v) else v
    return x
