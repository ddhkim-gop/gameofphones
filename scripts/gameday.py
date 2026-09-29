#!/usr/bin/env python3
"""Game-day refresh: keep all four leagues' highlights current while games are on.

The nightly runs (23:00-00:00) left the panels a day behind on Sundays and
needed someone to ask "did it work?". This runs every 30 minutes from a
LaunchAgent, exits at once unless an NFL game is on - kickoff -10 min to 90 min
after the last possible final whistle - and otherwise runs each league's
run_daily_scan.sh in turn (ESPN + YouTube + X ingest, rebuild, push), then
health.py, which notifies only when something is wrong.

One lock covers these and the nightly runs, so two never touch a repo at once.

    python3 scripts/gameday.py           # what the LaunchAgent runs
    python3 scripts/gameday.py --force   # run a cycle now regardless
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import x_poll                                              # noqa: E402

ROOT = HERE.parent.parent                    # .../fantasy football
LEAGUES = ["gameofphones", "indigo", "st", "darwinism"]   # gameofphones first: yt_fetch
LOCK = Path.home() / "Library" / "Caches" / "fantasy-football" / "run.lock"
LOG = Path.home() / "Library" / "Logs" / "fantasy-football" / "gameday.log"
STALE_LOCK = 2 * 3600


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def game_window(times: list) -> bool:
    """A game kicks off within 10 minutes, or kicked off under 6 hours ago -
    4.5 h of game and post-game posting, plus 90 min for the last clips."""
    now = datetime.now(timezone.utc)
    for t in times:
        if not isinstance(t, dict):
            continue
        try:
            k = datetime.fromisoformat(t["at"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        if k - timedelta(minutes=10) <= now <= k + timedelta(hours=6):
            return True
    return False


def take_lock() -> bool:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    try:
        LOCK.mkdir()
        return True
    except FileExistsError:
        if time.time() - LOCK.stat().st_mtime > STALE_LOCK:   # a crashed run's
            LOCK.rmdir()
            return take_lock()
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    state = x_poll._load(x_poll.STATE, {})
    times = x_poll.kickoffs(state)
    x_poll._save(x_poll.STATE, state)
    if not a.force and not game_window(times):
        return 0
    if not take_lock():
        log("skip: another run holds the lock")
        return 0
    try:
        t0 = time.time()
        env = {**os.environ, "FF_LOCK_HELD": "1"}
        for lg in LEAGUES:
            runner = ROOT / lg / "scripts" / "run_daily_scan.sh"
            try:
                r = subprocess.run(["/bin/bash", str(runner)], env=env, timeout=1800,
                                   stdin=subprocess.DEVNULL)
                log(f"{lg}: exit {r.returncode}")
            except subprocess.TimeoutExpired:
                log(f"{lg}: TIMEOUT after 30 min")
        subprocess.run([sys.executable, str(HERE / "health.py"), "--source", "gameday"],
                       timeout=900, stdin=subprocess.DEVNULL)
        log(f"cycle done in {int(time.time() - t0)}s")
    finally:
        try:
            LOCK.rmdir()
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
