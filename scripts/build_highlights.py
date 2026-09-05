#!/usr/bin/env python3
"""Build assets/highlights/<team>.json from a pool of candidate X post URLs.

Discovery cannot be automated: X has no public search API, and yt-dlp has no
timeline or search extractor for it. So a human (or Claude driving a logged-in
browser) collects candidate post URLs into a pool file; everything after that
is automatic.

For each URL the script reads X's public oembed endpoint - no auth, no key -
to get the post text, author and date. It then matches the text against every
team's Sleeper roster and writes one feed per team, so a single pool fans out
across all 12 teams instead of being curated twelve times.

Usage:
    python3 scripts/build_highlights.py pool.txt              # all teams
    python3 scripts/build_highlights.py pool.txt --team ddhk   # one team
    python3 scripts/build_highlights.py pool.txt --dry-run
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "assets" / "highlights"
LEAGUE_ID = "1313903635586899968"          # Game of Phones 2026
SLEEPER = "https://api.sleeper.app/v1"
OEMBED = "https://publish.twitter.com/oembed"
MAX_PER_TEAM = 12

# Team defences are excluded: their "name" is a city or franchise, so any post
# mentioning the place matches. That produced 11 entries like a Vikings tweet
# filed under "Minnesota Vikings DEF" - a location match, not a highlight.
EXCLUDE_POSITIONS = {"DEF", "DST", "D/ST"}

# Surnames common enough that a bare match is meaningless - these need the
# first name too, or "Cook" pulls in every post about a coach named Cook.
AMBIGUOUS = {
    "cook", "brown", "smith", "johnson", "williams", "jones", "davis", "wilson",
    "moore", "hill", "bell", "young", "carter", "allen", "robinson", "white",
    "harris", "walker", "mitchell", "warren", "love", "james", "murray", "kirk",
    "black", "thomas", "taylor", "scott", "green", "king", "wright", "lloyd",
    "pitts", "cousins", "jackson", "adams", "evans", "collins", "reed", "hall",
}


def get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "highlights-builder"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def rosters() -> dict[str, list[dict]]:
    """owner display name -> list of {name, position, team} for that roster."""
    users = {u["user_id"]: (u.get("display_name") or u.get("username") or "Unknown")
             for u in get_json(f"{SLEEPER}/league/{LEAGUE_ID}/users")}
    players = get_json(f"{SLEEPER}/players/nfl")
    out: dict[str, list[dict]] = {}
    for r in get_json(f"{SLEEPER}/league/{LEAGUE_ID}/rosters"):
        owner = users.get(r.get("owner_id"), f"team {r['roster_id']}")
        roster = []
        for pid in (r.get("players") or []):
            p = players.get(str(pid)) or {}
            name = (p.get("full_name")
                    or f"{p.get('first_name','')} {p.get('last_name','')}".strip())
            if not name:
                continue
            position = p.get("position") or ""
            if position.upper() in EXCLUDE_POSITIONS:
                continue
            roster.append({"name": name, "position": position,
                           "team": p.get("team") or "FA"})
        out[owner] = roster
    return out


def oembed(url: str) -> dict | None:
    q = urllib.parse.urlencode({"url": url, "dnt": "true", "omit_script": "true"})
    try:
        data = get_json(f"{OEMBED}?{q}")
    except Exception as e:
        print(f"  ! oembed failed for {url}: {e}", file=sys.stderr)
        return None
    raw = data.get("html") or ""
    # strip tags and unescape so name matching runs on plain prose
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # oembed puts the date in the trailing attribution line, spelled out in
    # full ("September 4, 2026"). An earlier \w{3} pattern never matched it.
    date = ""
    m = re.search(r"(January|February|March|April|May|June|July|August|September|"
                  r"October|November|December)\s+(\d{1,2}),\s+(\d{4})", text)
    if m:
        try:
            date = datetime.strptime(" ".join(m.groups()), "%B %d %Y").strftime("%Y-%m-%d")
        except ValueError:
            date = ""
    if not date:
        m = re.search(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+"
                      r"(\d{1,2}),\s+(\d{4})", text)
        if m:
            try:
                date = datetime.strptime(" ".join(m.groups()), "%b %d %Y").strftime("%Y-%m-%d")
            except ValueError:
                date = ""
    return {"url": data.get("url") or url,
            "author": data.get("author_name") or "",
            "author_url": data.get("author_url") or "",
            "text": text, "date": date}


def mentions(text: str, player_name: str) -> bool:
    """Does this post name the player? Conservative on common surnames."""
    t = text.lower()
    parts = [p for p in re.split(r"\s+", player_name.lower()) if p]
    if not parts:
        return False
    first, last = parts[0], parts[-1]
    # drop suffixes so "Kyle Pitts Sr." still matches on "Pitts"
    if last in {"jr.", "sr.", "ii", "iii", "iv", "v"} and len(parts) > 2:
        last = parts[-2]
    if player_name.lower() in t:
        return True
    if last not in t:
        return False
    if last in AMBIGUOUS:
        return first in t or f"{first[0]}. {last}" in t
    return True


def build(pool: list[str], only_team: str | None, dry_run: bool) -> int:
    print(f"resolving {len(pool)} candidate posts via oembed…")
    resolved = []
    for url in pool:
        info = oembed(url)
        if info:
            resolved.append(info)
            print(f"  ok  {info['date'] or '????-??-??'}  @{info['author_url'].rsplit('/',1)[-1]}"
                  f"  {info['text'][:58]}")
        time.sleep(0.4)          # be polite to a public endpoint
    if not resolved:
        print("no posts resolved; nothing written", file=sys.stderr)
        return 1

    teams = rosters()
    print(f"\nmatching against {len(teams)} rosters…")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for owner, roster in sorted(teams.items()):
        slug = re.sub(r"[^a-z0-9]+", "-", owner.lower()).strip("-")
        if only_team and slug != only_team.lower():
            continue
        hits = []
        for post in resolved:
            for p in roster:
                if mentions(post["text"], p["name"]):
                    hits.append({"url": post["url"], "player": p["name"],
                                 "meta": f"{p['position']} · {p['team']}",
                                 "date": post["date"], "author": post["author"]})
                    break        # one post is filed under one player
        hits.sort(key=lambda h: h["date"] or "0000-00-00", reverse=True)
        hits = hits[:MAX_PER_TEAM]
        feed = {"team": owner,
                "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "note": "Curated: X has no public search API, so posts are "
                        "collected by hand and matched to rosters by this script.",
                "tweets": hits}
        players = len({h["player"] for h in hits})
        print(f"  {slug:<22} {len(hits):>2} posts  {players:>2} players")
        if not dry_run:
            (OUT_DIR / f"{slug}.json").write_text(json.dumps(feed, indent=2) + "\n")
            written += 1
    print(f"\n{'dry run - nothing written' if dry_run else f'wrote {written} feeds to {OUT_DIR}'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pool", help="file of candidate X post URLs, one per line")
    ap.add_argument("--team", help="only rebuild this team's feed (slug)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    urls = [l.strip() for l in Path(a.pool).read_text().splitlines()
            if l.strip() and not l.startswith("#")]
    return build(urls, a.team, a.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
