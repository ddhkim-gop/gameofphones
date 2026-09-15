#!/usr/bin/env python3
"""
Nightly (11pm) scan: detect injuries + queue per-player film/compilation pulls.

Runs once a day, separate from the 60s in-game TD poller. Two jobs, both ~free:

  1. INJURIES - diff each rostered player's Sleeper news for injury language.
     Sleeper's news is written by the trusted insiders (Rapoport, Schefter,
     Pelissero...), so a hit is a confirmed injury with zero video/tokens. Emits
     an INJURY event; the replay clip is found later from a clip account and
     trust-checked against injury_sources.txt.

  2. COMPILATIONS - queue a per-player search task ("<name> all-22 / film /
     highlights") so day-after film breakdowns (e.g. a Caleb Williams All-22)
     get added through the week. Finding the clip is the semi-auto X step.

Detection is pure Python (0 model tokens). Emits to highlights_events.jsonl
(shared queue) with a per-day dedupe in .daily_seen.json.

    python3 daily_scan.py            # all configured leagues
    python3 daily_scan.py --dry-run  # print, don't write
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
ROSTERS = HERE.parent / "data" / "2026" / "rosters.json"
# Names for players rostered only in a sibling league.
SIBLING_ROSTERS = [HERE.parent.parent / "st" / "data" / "2026" / "rosters.json"]
FEEDS = HERE.parent / "assets" / "highlights"
EVENTS = HERE / "highlights_events.jsonl"
SEEN = HERE / ".daily_seen.json"
LEAGUE_IDS = ["1313903635586899968",                 # Game of Phones 2026
              "1400268451699818496"]                 # ST 2026

# Any real injury (in-game OR practice). In-game gets a replay clip; practice
# is news-only (no footage) - both captured, tagged by setting.
INJURY_RE = re.compile(
    r"\b(injur\w*|hurt|carted|strain|sprain|tear|torn|acl|mcl|concussion|"
    r"hamstring|ankle|knee|hip|groin|shoulder|quad|calf|exit(s|ed)?|"
    r"left the game|went down|placed on ir|ruled out)\b", re.I)
# In-game language -> a replay exists; otherwise treat as practice/news-only.
INGAME_RE = re.compile(
    r"\b(exit(s|ed)?|left the game|carted|went down|goes down|injured (on|during)|"
    r"leaves? (with|the game)|knocked out of|ruled out (with|after))\b", re.I)
# Fantasy-advice / roster noise that isn't an injury report.
SKIP_RE = re.compile(
    r"\b(must-add|waiver|hauls in|scores?|touchdown|targets|sleeper|start[/ ]sit|"
    r"fantasy (start|add|pickup)|snap count)\b", re.I)
LOOKBACK_H = 36          # only news newer than this many hours


def get(u, t=20):
    try:
        return json.load(urllib.request.urlopen(
            urllib.request.Request(u, headers={"User-Agent": "gop-daily"}), timeout=t))
    except Exception:
        return None


def rostered():
    """player_id -> (name, [owners]) from live Sleeper rosters + local names."""
    names = {}
    for extra in SIBLING_ROSTERS:
        try:
            for t in json.loads(extra.read_text()):
                for p in t.get("players", []):
                    names[str(p.get("player_id"))] = p.get("name")
        except Exception:
            pass
    try:
        for t in json.loads(ROSTERS.read_text()):
            for p in t.get("players", []):
                names[str(p.get("player_id"))] = p.get("name")
    except Exception as e:
        print(f"! roster names ({e})", file=sys.stderr)
    owners = {}
    for lid in LEAGUE_IDS:
        us = get(f"https://api.sleeper.app/v1/league/{lid}/users") or []
        um = {u["user_id"]: (u.get("metadata", {}).get("team_name") or u.get("display_name")) for u in us}
        for r in get(f"https://api.sleeper.app/v1/league/{lid}/rosters") or []:
            who = um.get(r.get("owner_id"), r.get("owner_id"))
            for pid in (r.get("players") or []):
                owners.setdefault(str(pid), []).append({"league": lid, "owner": who})
    return {pid: (names.get(pid, pid), ow) for pid, ow in owners.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    try:
        seen = set(json.loads(SEEN.read_text()))
    except Exception:
        seen = set()
    now = int(time.time())
    cutoff = now - LOOKBACK_H * 3600
    players = rostered()
    # only queue compilations for players with a scoring play this week (relevant)
    try:
        scored_keys = set(json.loads((HERE / ".playtimes.json").read_text()))
    except Exception:
        scored_keys = set()

    def scored(name):
        parts = [p for p in re.split(r"\s+", (name or "").strip()) if p]
        if len(parts) < 2:
            return False
        last = re.sub(r"[^a-z0-9]", "", "".join(parts[1:]).lower())
        return f"{last}#{parts[0][:1].lower()}" in scored_keys

    # who already has a shipped clip (the gap check re-queues everyone else)
    shipped = set()
    for f in FEEDS.glob("*.json"):
        try:
            for t in json.loads(f.read_text()).get("tweets", []):
                shipped.add(t.get("player"))
        except Exception:
            pass

    injuries, comps, gaps = [], [], []
    for pid, (name, owners) in players.items():
        # GAP CHECK: a rostered player who scored but has no shipped clip yet -
        # the nightly net that catches highlights the live pass missed.
        if scored(name) and name not in shipped:
            gkey = f"gap:{pid}:{time.strftime('%Y-%m-%d')}"
            if gkey not in seen:
                gaps.append({"ts": now, "event": "SCORING_GAP", "player": name,
                             "player_id": pid, "owners": owners,
                             "query": f"{name} touchdown highlights"})
                seen.add(gkey)
        # compilation task (one per rostered player per day)
        ckey = f"comp:{pid}:{time.strftime('%Y-%m-%d')}"
        if scored(name) and ckey not in seen:
            comps.append({"ts": now, "event": "COMPILATION", "player": name,
                          "player_id": pid, "owners": owners,
                          "query": f"{name} all-22 OR film OR highlights"})
            seen.add(ckey)
        # injuries from Sleeper news (trusted insiders write it); in-game only,
        # one per player per scan.
        if f"inj:{pid}:{time.strftime('%Y-%m-%d')}" in seen:
            continue
        news = get(f"https://api.sleeper.com/players/nfl/{pid}/news") or []
        for it in news[:6]:
            raw = it.get("published") or 0
            pub = int(raw) // 1000 if raw > 1e12 else int(raw)
            m = it.get("metadata", {}) or {}
            text = (m.get("title") or "") + " " + (m.get("description") or "")
            if pub and pub >= cutoff and INJURY_RE.search(text) and not SKIP_RE.search(text):
                seen.add(f"inj:{pid}:{time.strftime('%Y-%m-%d')}")
                setting = "in-game" if INGAME_RE.search(text) else "practice"
                # Both settings can have footage - in-game replay, or a beat
                # reporter's practice clip - so always attempt a clip; the
                # trusted-source allowlist (injury_sources.txt) keeps it clean.
                injuries.append({"ts": now, "event": "INJURY", "player": name,
                                 "player_id": pid, "owners": owners, "setting": setting,
                                 "clip": True,
                                 "detail": (m.get("title") or "")[:120],
                                 "source": it.get("source"), "article": m.get("url", "")})
                break            # one injury per player

    print(f"scan: {len(gaps)} missed scoring, {len(injuries)} injuries "
          f"({sum(1 for i in injuries if i['clip'])} in-game / "
          f"{sum(1 for i in injuries if not i['clip'])} practice), "
          f"{len(comps)} compilation tasks | {len(players)} rostered")
    for e in gaps[:20]:
        who = ', '.join(o['owner'] if isinstance(o, dict) else str(o) for o in e['owners'])
        print(f"  MISSED  {e['player']:22} -> {who[:24]}")
    for e in injuries[:20]:
        print(f"  INJURY  {e['player']:22} [{e['setting']:7}] {e['detail'][:60]}")
    if not args.dry_run:
        with EVENTS.open("a") as f:
            for e in gaps + injuries + comps:
                f.write(json.dumps(e) + "\n")
        SEEN.write_text(json.dumps(sorted(seen)))


if __name__ == "__main__":
    main()
