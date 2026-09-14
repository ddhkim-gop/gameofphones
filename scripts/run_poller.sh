#!/bin/bash
# Wrapper the LaunchAgent fires every 60s. It polls Sleeper for highlight events
# ONLY during NFL game windows, so it's a sub-50ms no-op the other ~23h/day -
# no 24/7 polling, no busy loop. Widen the windows below if your slate differs.
set -uo pipefail          # not -e: a failed fetch/push must not kill the run
# launchd gives a minimal PATH - add Homebrew (yt-dlp) and system dirs explicitly.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# git push over SSH from launchd (no ssh-agent): point at the passphrase-free key.
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ${HOME}/.ssh/id_ed25519"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$REPO/scripts/.poller.log"
echo "--- $(date '+%Y-%m-%d %H:%M:%S') fire (dow=$(TZ=America/Los_Angeles date +%u) hh=$(TZ=America/Los_Angeles date +%H)) ---" >> "$LOG"

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

# Ingest headless via reddit_fetch (Reddit if scripts/.reddit_cred exists, else
# YouTube - which needs no auth), then publish only when an approval changed so
# we don't spam commits. Reddit gives near-real-time per-play clips; YouTube
# gives per-game/player reels. Either runs unattended.
python3 scripts/ingest_highlights.py --fetch >> "$LOG" 2>&1 || true
if ! git diff --quiet scripts/highlights_reviewed.json assets/highlights 2>/dev/null; then
  git add scripts/highlights_reviewed.json scripts/highlights_pool.txt \
          scripts/.highlights_media_cache.json scripts/.highlights_oembed_cache.json scripts/.playtimes.json \
          assets/highlights >> "$LOG" 2>&1
  git commit -q -m "Highlights: auto-ingest live plays" >> "$LOG" 2>&1 \
    && git pull --rebase -q >> "$LOG" 2>&1 \
    && git push -q >> "$LOG" 2>&1
fi
