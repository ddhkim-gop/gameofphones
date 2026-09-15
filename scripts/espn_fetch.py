#!/usr/bin/env python3
"""Pull real NFL per-play highlight clips from ESPN's free public feed.

ESPN's game pages carry a `videos[]` array whose headlines name the player and
the play ("Derrick Henry powers in for a Ravens TD", "Jared Goff finds Amon-Ra
St. Brown"), each with a direct .mp4 on ESPN's CDN and a thumbnail. That is
everything the panel needs - and it costs no API key, no auth, and zero model
tokens (the headline IS the attribution, so no frame-watching).

Why this exists: X has no public search API and rate-limits hard; Reddit blocks
Anthropic's crawler; Highlightly paywalls NFL. ESPN's `cdn.espn.com/core` route
answers from this machine (the `site.api.espn.com` host is IP-blocked; the CDN
core route is not) and serves NFL highlights free.

It does NOT reinvent the build. It pre-seeds the three committed caches the X
pipeline already reads -
    .highlights_oembed_cache.json   author/text/date  (so oembed() is a cache hit)
    .highlights_media_cache.json    {video, poster}   (so the panel plays inline)
    highlights_reviewed.json keep{} "Player - detail" (trusted attribution)
- appends each clip's ESPN watch URL to highlights_pool.txt, then runs
build_highlights.py. Everything downstream (dedupe, per-player cap, playtimes,
dual-credit labelling, team fan-out) is reused unchanged.

The mp4 URL points at ESPN's Akamai CDN; the bytes stream from there exactly as
X clips stream from video.twimg - nothing is rehosted, so the repo stays small.

    python3 espn_fetch.py                     # Week-1 slate, then build
    python3 espn_fetch.py --dates 20260907 20260908
    python3 espn_fetch.py --no-build          # seed caches only
    python3 espn_fetch.py --dry-run           # print matches, write nothing
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Headlines that are recaps or negative plays, not a highlight of the named
# player: "...win big over...", "takes 5 sacks in loss", full-game wraps.
NEGATIVE_RE = re.compile(
    r"\b(win big|wins big|in (a )?loss|takes? \d+ sacks?|"
    r"shines as|recap|full (game )?highlights|reaction|breaks? down|"
    r"press conference|highlights?$)\b", re.I)

HERE = Path(__file__).resolve().parent
POOL = HERE / "highlights_pool.txt"
REVIEWED = HERE / "highlights_reviewed.json"
OEMBED_CACHE = HERE / ".highlights_oembed_cache.json"
MEDIA_CACHE = HERE / ".highlights_media_cache.json"
BUILD = HERE / "build_highlights.py"

CORE = "https://cdn.espn.com/core/nfl"                      # game videos (works)
SCORE = ("https://site.web.api.espn.com/apis/site/v2/"      # scoreboard: this host
         "sports/football/nfl/scoreboard")                 # answers 200 where the
                                                           # cdn/core route 202-blocks
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")

# Reuse the X builder's roster load and name matcher verbatim, so ESPN clips are
# attributed with the same ambiguity guard (shared surnames need a first name).
sys.path.insert(0, str(HERE))
from build_highlights import rosters, mentions  # noqa: E402


def get(url: str, timeout: int = 25, tries: int = 3):
    """GET JSON with retries. ESPN's CDN intermittently answers a rapid burst
    with an HTML challenge page (non-JSON); a short backoff clears it."""
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept": "application/json",
                              "Referer": "https://www.espn.com/"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def current_week() -> int:
    try:
        return int(get("https://api.sleeper.app/v1/state/nfl", timeout=15).get("week") or 1)
    except Exception:
        return 1


def game_ids(week: int, year: int) -> list[tuple[str, str]]:
    """[(gameId, 'AWAY@HOME'), ...] for every NFL game in a regular-season week.

    One scoreboard call returns the whole week's slate (~16 games), so this hits
    ESPN once instead of once per calendar day - fewer requests, less throttling.
    """
    try:
        evs = get(f"{SCORE}?seasontype=2&week={week}&dates={year}")["events"]
    except Exception as e:
        print(f"  ! scoreboard week {week}: {e}", file=sys.stderr)
        return []
    return [(e["id"], e.get("shortName", "")) for e in evs]


def mp4_of(v: dict) -> str:
    src = (v.get("links", {}) or {}).get("source", {}) or {}
    for k in ("href", "HD", "full", "mezzanine"):
        h = src.get(k)
        if isinstance(h, dict):
            h = h.get("href")
        if h and ".mp4" in h:
            return h
    return ""


def game_videos(gid: str) -> list[dict]:
    try:
        gp = get(f"{CORE}/game?xhr=1&gameId={gid}").get("gamepackageJSON", {})
    except Exception as e:
        print(f"  ! game {gid}: {e}", file=sys.stderr)
        return []
    return gp.get("videos") or []


def _load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int, help="NFL week (default: current from Sleeper)")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="print matches only")
    a = ap.parse_args()

    week = a.week or current_week()
    print(f"ESPN pull for {a.year} week {week}")

    teams = rosters()                      # arms the shared-surname guard
    roster_union = sorted({p["name"] for r in teams.values() for p in r})
    print(f"{len(roster_union)} rostered players to match against")

    oe = _load(OEMBED_CACHE)
    mc = _load(MEDIA_CACHE)
    rv = _load(REVIEWED)
    keep = rv.setdefault("keep", {})
    pool = set(POOL.read_text().split()) if POOL.exists() else set()

    seen_clip: set[str] = set()
    seen_games: set[str] = set()
    matched, scanned = [], 0
    for gid, label in game_ids(week, a.year):
        if gid in seen_games:
            continue
        seen_games.add(gid)
        time.sleep(0.4)                      # be polite to ESPN's CDN
        for v in game_videos(gid):
                scanned += 1
                cid = str(v.get("id") or "")
                if cid and cid in seen_clip:
                    continue
                seen_clip.add(cid)
                headline = v.get("headline") or ""
                if NEGATIVE_RE.search(headline):
                    continue                 # recap / negative play, not a highlight
                text = headline
                desc = v.get("description") or ""
                if desc and desc != text:
                    text = f"{text}. {desc}"
                who = [n for n in roster_union if mentions(text, n)]
                if not who:
                    continue
                url = ((v.get("links", {}) or {}).get("web", {}) or {}).get("href")
                mp4 = mp4_of(v)
                if not url or not mp4:
                    continue
                date_iso = (v.get("originalPublishDate") or "")[:10]
                poster = v.get("thumbnail") or ""
                note = f"{' & '.join(who)} - {v.get('headline','')} (auto: ESPN)"
                matched.append({"url": url, "who": who, "text": text,
                                "date": date_iso, "label": label, "note": note,
                                "mp4": mp4, "poster": poster})
                if a.dry_run:
                    continue
                oe[url] = {"url": url, "author": "ESPN",
                           "author_url": "https://www.espn.com",
                           "text": text, "date": date_iso}
                mc[url] = {"video": mp4, **({"poster": poster} if poster else {})}
                keep[url] = note
                pool.add(url)

    print(f"\nscanned {scanned} ESPN videos -> {len(matched)} name a rostered player")
    for m in sorted(matched, key=lambda x: x["date"]):
        print(f"  {m['date']}  {m['label']:9}  {' & '.join(m['who'])[:34]:34}  "
              f"{m['text'][:46]}")

    if a.dry_run:
        print("\ndry run - nothing written")
        return 0
    if not matched:
        print("no ESPN clips matched a rostered player; nothing written")
        return 0

    OEMBED_CACHE.write_text(json.dumps(oe, indent=1, sort_keys=True) + "\n")
    MEDIA_CACHE.write_text(json.dumps(mc, indent=1, sort_keys=True) + "\n")
    REVIEWED.write_text(json.dumps(rv, indent=1, ensure_ascii=False) + "\n")
    POOL.write_text("\n".join(sorted(pool)) + "\n")
    print(f"seeded caches; pool now {len(pool)} urls")

    if not a.no_build:
        print("\nrebuilding feeds…")
        subprocess.run([sys.executable, str(BUILD), str(POOL)], cwd=str(HERE.parent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
