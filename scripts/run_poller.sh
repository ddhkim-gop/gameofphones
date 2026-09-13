#!/bin/bash
# Wrapper the LaunchAgent fires every 60s. It polls Sleeper for highlight events
# ONLY during NFL game windows, so it's a sub-50ms no-op the other ~23h/day -
# no 24/7 polling, no busy loop. Widen the windows below if your slate differs.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$REPO/scripts/.poller.log"

# Game-window gate in America/Los_Angeles. dow: 1=Mon .. 7=Sun.
dow=$(TZ=America/Los_Angeles date +%u)
hh=$(TZ=America/Los_Angeles date +%H); hh=$((10#$hh))
inwin=0
case "$dow" in
  7)   [ "$hh" -ge 9  ] && [ "$hh" -le 23 ] && inwin=1 ;;  # Sun 9a–11p
  4|1) [ "$hh" -ge 17 ] && [ "$hh" -le 23 ] && inwin=1 ;;  # Thu & Mon 5p–11p
esac
[ "$inwin" -eq 1 ] || exit 0

cd "$REPO"
echo "--- $(date '+%Y-%m-%d %H:%M:%S') poll ---" >> "$LOG"
python3 scripts/poll_highlights.py >> "$LOG" 2>&1
# NOTE: the ingest step (event -> clip) is NOT run here: it needs an
# authenticated X session to find candidate clips, which a headless daemon
# can't do. Run ingest_highlights.py from an interactive session (with the
# logged-in browser producing candidates) to drain the queue this fills.
