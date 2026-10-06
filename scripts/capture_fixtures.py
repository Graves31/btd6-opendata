"""Capture real responses from every BTD6 Open Data endpoint into docs/api/fixtures/.

One-shot, rate-limited crawl used to derive and verify the API contracts.
Re-run only when Ninja Kiwi changes the API (see the changelog on data.ninjakiwi.com).

    python scripts/capture_fixtures.py
"""

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://data.ninjakiwi.com"
OUT = Path(__file__).resolve().parent.parent / "docs" / "api" / "fixtures"
DELAY_S = 0.5
UA = "btd6-opendata-site/contract-capture (one-shot schema capture)"
KEEP_HEADERS = ("cache-control", "etag", "age", "cf-cache-status", "content-type", "expires", "last-modified")

index = []


def slug(path: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "__", path.strip("/")) or "root"


def get(path: str, note: str = "", binary: bool = False) -> dict | None:
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, headers, raw = r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        status, headers, raw = e.code, e.headers, e.read()
    ms = round((time.perf_counter() - t0) * 1000)
    name = None
    data = None
    if not binary:
        try:
            data = json.loads(raw)
        except ValueError:
            data = {"_non_json": raw.decode("utf-8", "replace")[:2000]}
        name = slug(path) + ".json"
        (OUT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    index.append({
        "path": path, "file": name, "status": status, "ms": ms, "bytes": len(raw), "note": note,
        "headers": {k: headers.get(k) for k in KEEP_HEADERS if headers.get(k) is not None},
    })
    print(f"{status} {ms:>5}ms {len(raw):>7}B {path}")
    time.sleep(DELAY_S)
    return data if isinstance(data, dict) else None


def body(d):
    return (d or {}).get("body")


def rel(url: str) -> str:
    return url.replace(BASE, "") if url else url


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # ---- list endpoints
    races = body(get("/btd6/races")) or []
    bosses = body(get("/btd6/bosses")) or []
    cts = body(get("/btd6/ct")) or []
    odysseys = body(get("/btd6/odyssey")) or []
    get("/btd6/events")
    chal_filters = body(get("/btd6/challenges")) or []
    map_filters = body(get("/btd6/maps")) or []

    # ---- races: newest (may be upcoming) + most recent one with scores
    scored_race = next((r for r in races if r.get("totalScores", 0) > 0), None)
    for r in {id(x): x for x in [races[0] if races else None, scored_race] if x}.values():
        get(rel(r["metadata"]), "race metadata")
        get(rel(r["leaderboard"]), "race leaderboard p1")
    if scored_race:
        get(rel(scored_race["leaderboard"]) + "?page=2", "race leaderboard p2")
        get(rel(scored_race["leaderboard"]) + "?page=0", "page=0 quirk")
        get(rel(scored_race["leaderboard"]) + "?page=99999", "past last page")
    if races:
        get(rel(races[-1]["metadata"]), "oldest race in list")

    # ---- bosses: current + oldest
    users = set()
    for b in [x for x in (bosses[:1] + bosses[-1:]) if x]:
        for diff in ("standard", "elite"):
            get(f"/btd6/bosses/{b['id']}/metadata/{diff}", f"boss metadata {diff}")
            lb = get(f"/btd6/bosses/{b['id']}/leaderboard/{diff}/1", f"boss leaderboard {diff}")
            for e in (body(lb) or [])[:2]:
                users.add(rel(e.get("profile")))
    if bosses:
        b = bosses[0]["id"]
        get(f"/btd6/bosses/{b}/leaderboard/standard/1?page=2", "boss lb page 2")
        for size in (2, 3, 4):
            get(f"/btd6/bosses/{b}/leaderboard/standard/{size}", f"teamSize {size} (docs claim only 1 works)")
        get(f"/btd6/bosses/{b}/leaderboard/standard/5", "teamSize 5 probe")
        last = get(f"/btd6/bosses/{b}/leaderboard/standard/1", "boss lb p1 (for maxPages)") or {}
        if last.get("maxPages"):
            get(f"/btd6/bosses/{b}/leaderboard/standard/1?page={last['maxPages']}", "last page")
            get(f"/btd6/bosses/{b}/leaderboard/standard/1?page={last['maxPages'] + 1}", "past maxPages")
        get(f"/btd6/bosses/{b}/metadata/hard", "invalid difficulty probe")
        get(f"/btd6/bosses?id={b}", "undocumented ?id= filter")
    if races:
        get(f"/btd6/races?id={races[-1]['id']}", "undocumented ?id= filter")
    if odysseys:
        get(f"/btd6/odyssey?id={odysseys[0]['id']}", "undocumented ?id= filter")

    # ---- CT: current + most recent with scores
    scored_ct = next((c for c in cts if c.get("totalScores_team", 0) > 0), None)
    group_url = guild_url = None
    for c in {id(x): x for x in [cts[0] if cts else None, scored_ct] if x}.values():
        get(rel(c["tiles"]), "ct tiles")
        pl = get(rel(c["leaderboard_player"]), "ct player lb")
        tl = get(rel(c["leaderboard_team"]), "ct team lb")
        for e in (body(pl) or [])[:1]:
            users.add(rel(e.get("profile")))
        for e in (body(tl) or [])[:1]:
            group_url = group_url or rel(e.get("group"))
            guild_url = guild_url or rel(e.get("profile"))
    if scored_ct:
        get(rel(scored_ct["leaderboard_player"]) + "?page=2", "ct player lb p2")
        get(rel(scored_ct["leaderboard_team"]) + "?page=2", "ct team lb p2")
    if group_url:
        get(group_url, "ct group")
    if guild_url:
        get(guild_url, "guild")

    # ---- odyssey: newest, all difficulties
    if odysseys:
        o = odysseys[0]["id"]
        for diff in ("easy", "medium", "hard"):
            get(f"/btd6/odyssey/{o}/{diff}", f"odyssey {diff}")
            get(f"/btd6/odyssey/{o}/{diff}/maps", f"odyssey maps {diff}")

    # ---- challenges
    for f in chal_filters:
        lst = get(rel(f["challenges"]), f"challenge filter {f.get('type')}")
        for c in (body(lst) or [])[:1]:
            get(rel(c["metadata"]), "challenge document")
    get("/btd6/challenges/filter/newest?page=2", "challenge filter page 2")
    get("/btd6/challenges/filter/daily?page=2", "filter past the end → empty list")

    # ---- maps
    for f in map_filters:
        lst = get(rel(f["maps"]), f"map filter {f.get('type')}")
        for m in (body(lst) or [])[:1]:
            doc = body(get(rel(m["metadata"]), "map document")) or {}
            if doc.get("mapURL", "").startswith(BASE):
                get(rel(doc["mapURL"]), "map preview image (undocumented)", binary=True)
            if m.get("creator"):
                users.add(rel(m["creator"]))
    get("/btd6/maps/filter/newest?page=2", "map filter page 2")

    # ---- users
    for u in sorted(x for x in users if x)[:5]:
        get(u, "user profile")

    # ---- error probes
    get("/btd6/bosses/NotABoss_x/metadata/standard", "unknown boss")
    get("/btd6/races/NotARace_x/leaderboard", "unknown race")
    get("/btd6/users/notauser", "unknown user")
    get("/btd6/challenges/challenge/ZZZZZZZ", "unknown challenge")
    get("/btd6/maps/map/ZZZZZZZ", "unknown map")
    get("/btd6/challenges/filter/bogus", "unknown filter")
    get("/btd6/save/notanoak", "save without valid OAK")
    get("/btd6/doesnotexist", "unknown route")
    get("/btd6/bosses?pretty=true", "pretty=true returns HTML, not JSON")

    (OUT / "_index.json").write_text(json.dumps({
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "base": BASE, "requests": index,
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
