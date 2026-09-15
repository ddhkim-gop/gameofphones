#!/bin/bash
# Nightly 11pm job. Two parts:
#   1) daily_scan.py  - injury/gap/compilation detection (0 tokens, no push)
#   2) espn_fetch.py  - pull that week's real NFL highlight clips from ESPN's
#      free public feed, seed the caches, rebuild feeds, and push.
#
# ESPN is the automatable clip source: no key, no paywall, ~0 model tokens
# (headline = attribution). It runs from THIS Mac on purpose - ESPN's CDN answers
# a residential IP but 202-challenges datacenter IPs, so this must not move to a
# GitHub Actions runner.
set -uo pipefail          # not -e: a failed fetch/push must not kill the run
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# git push over SSH from launchd (no ssh-agent): passphrase-free key.
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ${HOME}/.ssh/id_ed25519"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Log lives outside the repo: ~/Desktop is TCC-protected and launchd can only
# open a StandardOutPath it created itself (see run_poller.sh).
LOG="$HOME/Library/Logs/fantasy-football/daily-scan.log"
mkdir -p "$(dirname "$LOG")"
cd "$REPO" || exit 1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') daily scan ---" >> "$LOG"

# 1) detection (existing behaviour)
python3 scripts/daily_scan.py >> "$LOG" 2>&1

# 2) ESPN highlight seed. Sleeper can flip the week before that week's games are
# played, so seed the current week AND the prior one to catch the slate that just
# finished. Seed both without building, then build once.
WEEK=$(curl -s --max-time 15 https://api.sleeper.app/v1/state/nfl \
       | python3 -c 'import sys,json;print(json.load(sys.stdin).get("week") or 1)' 2>/dev/null)
WEEK=${WEEK:-1}
for w in "$WEEK" "$((WEEK-1))"; do
  [ "$w" -ge 1 ] || continue
  echo "  espn_fetch --week $w" >> "$LOG"
  python3 scripts/espn_fetch.py --week "$w" --no-build >> "$LOG" 2>&1 || true
done
python3 scripts/build_highlights.py scripts/highlights_pool.txt >> "$LOG" 2>&1 || true

# 3) publish if anything changed
if ! git diff --quiet scripts/highlights_reviewed.json assets/highlights 2>/dev/null; then
  git add assets/highlights \
          scripts/highlights_reviewed.json scripts/highlights_pool.txt \
          scripts/.highlights_media_cache.json scripts/.highlights_oembed_cache.json \
          scripts/.playtimes.json >> "$LOG" 2>&1
  # --autostash: daily_scan.py mutates its own state files (.daily_seen.json,
  # highlights_events.jsonl) every run, leaving unstaged changes that would
  # otherwise abort the rebase.
  git commit -q -m "Highlights: nightly ESPN auto-seed (week $WEEK)" >> "$LOG" 2>&1 \
    && git pull --rebase --autostash -q >> "$LOG" 2>&1 \
    && git push -q >> "$LOG" 2>&1 \
    && echo "  pushed" >> "$LOG" 2>&1
else
  echo "  no highlight changes; nothing pushed" >> "$LOG"
fi
