#!/usr/bin/env python3
"""
Poll Sleeper for scoring plays / big plays and emit highlight events.

Sleeper has no public notification or play-event API, so we approximate it:
the public weekly stats endpoint is cumulative and updates through a game, so
diffing consecutive snapshots surfaces the moment a rostered player's TD, FG,
or a big yardage gain lands. Pure Python - zero model tokens. A cron/LaunchAgent
runs this every ~60s during games; each run diffs against the last snapshot and
appends new events to highlights_events.jsonl for the ingest step to act on.

Multiple leagues cost nothing extra: a TD is one real NFL play, so events are
keyed by player, and every league that rosters him is listed under `owners`.
The token-expensive clip-watching is a *separate* consumer of this queue.

Design notes:
- First run with no prior snapshot SEEDS silently (emits nothing) - otherwise
  every already-scored TD would fire at once.
- Injuries are out of scope for v1: the stats endpoint carries no injury_status,
  and the news feed lags minutes. Flagged as TODO, not silently pretended.

Usage:
    python3 poll_highlights.py                 # one poll+diff, append new events
    python3 poll_highlights.py --leagues A,B   # override league id list
    python3 poll_highlights.py --reseed        # re-baseline, emit nothing
    python3 poll_highlights.py --test          # diff against a zeroed snapshot
                                               # (forces detection of current TDs)
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
STATE = HERE / ".poll_state.json"
EVENTS = HERE / "highlights_events.jsonl"
ROSTERS = HERE.parent / "data" / "2026" / "rosters.json"

LEAGUE_IDS = ["1313903635586899968"]     # Game of Phones 2026; add more here
YEAR = 2026

# Big single-poll yardage gain (no TD) that still counts as a highlight.
BIG_PLAY_YDS = 20
# Cumulative-longest thresholds that mark a splash play the first time crossed.
LONG_REC = 25
LONG_RUSH = 15

TD_STATS = {"pass_td": "passing TD", "rush_td": "rushing TD", "rec_td": "receiving TD"}


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "gop-highlights-poller"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def current_week():
    try:
        s = get("https://api.sleeper.app/v1/state/nfl")
        return int(s.get("week") or 1), (s.get("season_type") or "regular")
    except Exception as e:
        print(f"! could not read NFL state ({e}); defaulting week 1", file=sys.stderr)
        return 1, "regular"


def player_meta():
    """player_id -> {name, team, pos} from the local roster snapshot."""
    meta = {}
    try:
        for t in json.loads(ROSTERS.read_text()):
            for p in t.get("players", []):
                meta[str(p.get("player_id"))] = {
                    "name": p.get("name"), "team": p.get("team"), "pos": p.get("position")}
    except Exception as e:
        print(f"! could not read {ROSTERS.name} ({e})", file=sys.stderr)
    return meta


def rostered(league_ids):
    """player_id -> list of {league, owner} across every configured league."""
    owners = {}
    for lid in league_ids:
        try:
            users = {u["user_id"]: (u.get("metadata", {}).get("team_name") or u.get("display_name"))
                     for u in get(f"https://api.sleeper.app/v1/league/{lid}/users")}
            for r in get(f"https://api.sleeper.app/v1/league/{lid}/rosters"):
                who = users.get(r.get("owner_id"), r.get("owner_id"))
                for pid in (r.get("players") or []):
                    owners.setdefault(str(pid), []).append({"league": lid, "owner": who})
        except Exception as e:
            print(f"! league {lid} roster fetch failed ({e})", file=sys.stderr)
    return owners


def load_snapshot():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return None


def save_snapshot(week, stats):
    STATE.write_text(json.dumps({"week": week, "stats": stats}, separators=(",", ":")))


def diff_events(prev, cur, owners, meta, week):
    """Emit an event per new TD / FG / big play for a rostered player."""
    events = []
    for pid, who in owners.items():
        c = cur.get(pid) or {}
        p = prev.get(pid) or {}
        base = {"player_id": pid, "name": (meta.get(pid) or {}).get("name") or pid,
                "team": (meta.get(pid) or {}).get("team"),
                "pos": (meta.get(pid) or {}).get("pos"), "week": week, "owners": who}
        # Touchdowns: emit one per new score, tagged by phase count.
        for stat, label in TD_STATS.items():
            gained = int((c.get(stat) or 0)) - int((p.get(stat) or 0))
            for i in range(gained):
                n = int(p.get(stat) or 0) + i + 1
                events.append({**base, "event": "TD", "detail": f"{label} #{n}"})
        # Field goals (kickers).
        fg = int((c.get("fgm") or 0)) - int((p.get("fgm") or 0))
        for i in range(fg):
            events.append({**base, "event": "FG", "detail": "field goal"})
        # Big non-scoring play: a jump in the cumulative longest reception/rush.
        for stat, thresh, what in (("rec_lng", LONG_REC, "long catch"),
                                   ("rush_lng", LONG_RUSH, "long run")):
            cl, pl = (c.get(stat) or 0), (p.get(stat) or 0)
            if cl >= thresh and cl > pl:
                events.append({**base, "event": "BIG_PLAY", "detail": f"{what} {int(cl)} yds"})
        # Fallback big gain when a longest isn't exposed: a one-poll yardage spike.
        dy = ((c.get("rec_yd") or 0) + (c.get("rush_yd") or 0)) \
            - ((p.get("rec_yd") or 0) + (p.get("rush_yd") or 0))
        if dy >= BIG_PLAY_YDS and not any(
                e["player_id"] == pid and e["event"] in ("TD", "BIG_PLAY") for e in events):
            events.append({**base, "event": "BIG_PLAY", "detail": f"+{int(dy)} scrimmage yds"})
    return events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", help="comma-separated league ids (overrides default)")
    ap.add_argument("--reseed", action="store_true", help="re-baseline; emit nothing")
    ap.add_argument("--test", action="store_true",
                    help="diff against a zeroed snapshot to force detection")
    args = ap.parse_args()

    leagues = args.leagues.split(",") if args.leagues else LEAGUE_IDS
    week, _ = current_week()
    stats = get(f"https://api.sleeper.app/v1/stats/nfl/regular/{YEAR}/{week}")
    meta = player_meta()
    owners = rostered(leagues)

    snap = load_snapshot()
    if not args.test and (args.reseed or snap is None):
        save_snapshot(week, stats)
        print(f"seeded baseline: week {week}, {len(stats)} players, "
              f"{len(owners)} rostered across {len(leagues)} league(s). No events emitted.")
        return

    prev = {} if args.test else ((snap or {}).get("stats") or {})
    if not args.test and (snap or {}).get("week") != week:
        # New week: baseline it, don't fire last week's plays.
        save_snapshot(week, stats)
        print(f"new week {week}; re-baselined, no events emitted.")
        return

    events = diff_events(prev, stats, owners, meta, week)
    now = int(time.time())
    with EVENTS.open("a") as f:
        for e in events:
            f.write(json.dumps({"ts": now, **e}) + "\n")
    if not args.test:
        save_snapshot(week, stats)

    print(f"week {week}: {len(events)} new event(s) for rostered players"
          f"{' (TEST: vs zeroed snapshot, snapshot NOT advanced)' if args.test else ''}")
    for e in events[:40]:
        who = ", ".join(f"{o['owner']}" for o in e["owners"])
        print(f"  {e['event']:9} {e['name']:22} {e['detail']:20} -> {who}")


if __name__ == "__main__":
    main()
