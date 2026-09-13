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

# Ingest runs headless only when X cookies are configured (scripts/.x_cookies).
# Without them this block is skipped and the queue is drained by an interactive
# session instead. NOTE: the x_fetch authed path is UNTESTED until real cookies
# exist - watch .poller.log the first live game.
if [ -f scripts/.x_cookies ]; then
  python3 scripts/ingest_highlights.py --fetch >> "$LOG" 2>&1 || true
  # Publish only when an approval actually changed, so we don't spam commits.
  if ! git diff --quiet scripts/highlights_reviewed.json assets/highlights 2>/dev/null; then
    git add scripts/highlights_reviewed.json scripts/highlights_pool.txt \
            scripts/.highlights_media_cache.json assets/highlights >> "$LOG" 2>&1
    git commit -q -m "Highlights: auto-ingest live plays" >> "$LOG" 2>&1 \
      && git pull --rebase -q >> "$LOG" 2>&1 \
      && git push -q >> "$LOG" 2>&1
  fi
fi
