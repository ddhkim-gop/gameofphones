#!/usr/bin/env python3
"""
Headless highlight-candidate fetch: Reddit r/nfl (primary) -> YouTube (fallback).

Replaces the X path with sources that don't fight auth/throttle/ToS:

 - Reddit official OAuth API (sanctioned, free, stable, near-real-time). Fans
   post game clips to r/nfl with a "Highlight" flair within minutes; the title
   names the player + play (great for caption-match) and the link is a
   yt-dlp-resolvable video (v.redd.it / streamable / x / youtube). Needs a
   one-time free "script" app: put CLIENT_ID + CLIENT_SECRET in scripts/.reddit_cred
   (gitignored). App-only (client_credentials) read token - no password stored.

 - YouTube via yt-dlp - ZERO setup, works headless right now, but returns
   per-game / player-season reels (next-day-ish), not per-play. Used when
   Reddit creds are absent or Reddit returns nothing.

Output: JSON list of {url, author, text, ts} for ingest_highlights.py.
The Reddit OAuth path is UNTESTED without creds (token+search not run here);
extract logic is unit-tested and the YouTube path is verified live.

Usage:
    python3 reddit_fetch.py "Derrick Henry touchdown" --out cands.json
    python3 reddit_fetch.py "Puka Nacua" --youtube        # force YouTube
"""
import argparse
import base64
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CRED = HERE / ".reddit_cred"
YEAR = 2026
UA = "gameofphones-highlights/0.1"
# yt-dlp channels we trust to attribute by title alone
OFFICIAL_YT = {
    "NFL", "NFL Films",
    "Buffalo Bills", "Miami Dolphins", "New England Patriots", "New York Jets",
    "Baltimore Ravens", "Cincinnati Bengals", "Cleveland Browns", "Pittsburgh Steelers",
    "Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Tennessee Titans",
    "Denver Broncos", "Kansas City Chiefs", "Las Vegas Raiders", "Los Angeles Chargers",
    "Dallas Cowboys", "New York Giants", "Philadelphia Eagles", "Washington Commanders",
    "Chicago Bears", "Detroit Lions", "Green Bay Packers", "Minnesota Vikings",
    "Atlanta Falcons", "Carolina Panthers", "New Orleans Saints", "Tampa Bay Buccaneers",
    "Arizona Cardinals", "Los Angeles Rams", "San Francisco 49ers", "Seattle Seahawks",
}
VIDEO_DOMAINS = ("v.redd.it", "streamable.com", "x.com", "twitter.com",
                 "youtube.com", "youtu.be")


def _creds():
    if not CRED.exists():
        return None
    kv = {}
    for line in CRED.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            kv[k.strip().upper()] = v.strip()
    if kv.get("CLIENT_ID") and kv.get("CLIENT_SECRET"):
        return kv
    return None


def reddit_token(kv):
    auth = base64.b64encode(f"{kv['CLIENT_ID']}:{kv['CLIENT_SECRET']}".encode()).decode()
    data = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(
        "https://www.reddit.com/api/v1/access_token", data=data,
        headers={"Authorization": f"Basic {auth}", "User-Agent": kv.get("USER_AGENT", UA)})
    return json.load(urllib.request.urlopen(req, timeout=20))["access_token"]


def reddit_search(query, limit):
    kv = _creds()
    if not kv:
        return []
    token = reddit_token(kv)
    q = f'flair:"Highlight" {query}'
    url = ("https://oauth.reddit.com/r/nfl/search?" + urllib.parse.urlencode(
        {"q": q, "restrict_sr": 1, "sort": "new", "t": "week", "limit": limit}))
    req = urllib.request.Request(url, headers={
        "Authorization": f"bearer {token}", "User-Agent": kv.get("USER_AGENT", UA)})
    data = json.load(urllib.request.urlopen(req, timeout=20))
    return reddit_extract(data)


def reddit_extract(data):
    out = []
    for c in data.get("data", {}).get("children", []):
        p = c.get("data", {})
        link = p.get("url_overridden_by_dest") or p.get("url", "")
        dom = (p.get("domain") or "")
        if not any(d in link or d in dom for d in VIDEO_DOMAINS):
            continue
        out.append({"url": link, "author": f'reddit/u/{p.get("author","")}',
                    "text": (p.get("title") or "").replace("\n", " "),
                    "ts": int(p.get("created_utc") or 0)})
    return out


def youtube_search(query, limit):
    """yt-dlp search; keep official-channel results so titles are trustworthy."""
    cmd = ["yt-dlp", "--flat-playlist", "--dump-json",
           f"ytsearch{limit}:{query} highlights {YEAR}"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=90).stdout
    except Exception:
        return []
    res = []
    for line in out.splitlines():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not d.get("id"):
            continue
        chan = (d.get("channel") or d.get("uploader") or "").strip()
        if chan not in OFFICIAL_YT:
            continue
        res.append({"url": f"https://www.youtube.com/watch?v={d['id']}",
                    "author": chan, "text": d.get("title") or "", "ts": 0})
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--limit", type=int, default=15)
    ap.add_argument("--youtube", action="store_true", help="skip Reddit, use YouTube")
    ap.add_argument("--out")
    args = ap.parse_args()

    cands = []
    src = "youtube"
    if not args.youtube:
        try:
            cands = reddit_search(args.query, args.limit)
            if cands:
                src = "reddit"
        except Exception as e:
            print(f"! reddit fetch failed ({e}); falling back to YouTube", file=sys.stderr)
    if not cands:
        cands = youtube_search(args.query, min(args.limit, 8))

    print(f"{len(cands)} candidates via {src}", file=sys.stderr)
    payload = json.dumps(cands, indent=1)
    if args.out:
        Path(args.out).write_text(payload)
        print(f"wrote {len(cands)} -> {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
