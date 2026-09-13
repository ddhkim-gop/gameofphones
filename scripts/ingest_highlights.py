#!/usr/bin/env python3
"""
Consume poller events -> match a clip by caption -> approve -> rebuild feeds.

The poller (poll_highlights.py) already knows *exactly* what happened for each
rostered player ("Brock Purdy passing TD #3"). So turning an event into a clip
is a caption match, not a watch: pick the candidate post whose text names the
player and the play, preferring official/known accounts and recency. That's
zero model tokens - no frames read.

Clip FINDING is deliberately decoupled. X search needs an authenticated session
(no public API), which a headless cron can't do, so candidates are supplied as
a JSON file: [{"url","author","text","ts"}...]. An interactive session (with the
logged-in browser) produces that file; this script does the deterministic rest.
Optionally, a single frame can be read as a sanity gate on low-trust accounts
(--verify-frame), but the default path reads no pixels.

Usage:
    # produce candidates.json from the browser, then:
    python3 ingest_highlights.py --candidates candidates.json
    python3 ingest_highlights.py --candidates c.json --no-build   # match only
    python3 ingest_highlights.py --candidates c.json --all        # ignore offset

Writes approvals into highlights_reviewed.json (keep) + highlights_pool.txt,
then runs build_highlights.py unless --no-build. Dedup (same play reposted) is
handled downstream by build_highlights' video-id dedupe.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).parent
FETCHER = HERE / "reddit_fetch.py"   # Reddit primary, YouTube fallback (no auth)
# search term added per event type when auto-fetching candidates
EVENT_QUERY = {"TD": "touchdown", "FG": "field goal", "BIG_PLAY": ""}
EVENTS = HERE / "highlights_events.jsonl"
STATE = HERE / ".ingest_state.json"
REVIEWED = HERE / "highlights_reviewed.json"
POOL = HERE / "highlights_pool.txt"
BUILD = HERE / "build_highlights.py"

# Accounts whose game clips are trustworthy enough to ship on caption alone.
KNOWN_ACCOUNTS = {
    "nfl", "nflonfox", "snfonnbc", "espn", "espnausnz", "nflplus", "nflnetwork",
    "seahawks", "patriots", "49ers", "ramsnfl", "sportscenter", "thecheckdown",
}
EVENT_WORDS = {
    "TD": ["touchdown", " td", "td ", "scores", "score", "pay dirt", "end zone"],
    "FG": ["field goal", "fg ", " fg", "splits the uprights", "50-yard", "kick"],
    "BIG_PLAY": ["yard", "yds", "catch", "run", "grab", "reception", "big play"],
}


def _norm(s):
    # lower, drop punctuation that varies across captions (A.J. -> aj)
    return re.sub(r"[.’']", "", (s or "").lower())


def name_parts(name):
    parts = [p for p in re.split(r"\s+", _norm(name)) if p]
    return (parts[0] if parts else ""), (parts[-1] if parts else "")


def score(event, cand):
    """Higher = better match. None (reject) if the player isn't clearly named.

    Requires BOTH first and last name in the caption - surname alone collides
    (A.J. Brown vs Amon-Ra St. Brown, Kyren vs other Williamses). Nickname-only
    captions ("THERE GOES JSN") deliberately fail here; those need an alias
    table, handled separately, not a loose surname match that mis-attributes.
    """
    text = _norm(cand.get("text"))
    first, last = name_parts(event.get("name"))
    if not last or last not in text or (first and first not in text):
        return None                              # must name the player, fully
    s = 3.0
    words = EVENT_WORDS.get(event.get("event"), [])
    if any(w in text for w in words):
        s += 2.0
    author = (cand.get("author") or "").lower().lstrip("@")
    if author in KNOWN_ACCOUNTS:
        s += 2.0
    # gentle recency nudge: closer candidate ts to the event ts wins ties
    try:
        s += max(0.0, 1.0 - abs((cand.get("ts") or 0) - (event.get("ts") or 0)) / 3600.0)
    except Exception:
        pass
    return s


def load_events(process_all):
    if not EVENTS.exists():
        return [], 0
    lines = [l for l in EVENTS.read_text().splitlines() if l.strip()]
    done = 0
    if not process_all:
        try:
            done = int(json.loads(STATE.read_text()).get("consumed", 0))
        except Exception:
            done = 0
    events = []
    for l in lines[done:]:
        try:
            events.append(json.loads(l))
        except json.JSONDecodeError:
            pass
    return events, len(lines)


def already_have(url, reviewed):
    return url in reviewed.get("keep", {}) or url in reviewed.get("reject", {})


def fetch_candidates(events):
    """Fetch candidate clips for each distinct player+event via reddit_fetch.py.

    One query per (name, event-type) so a player's three TDs cost one search.
    reddit_fetch tries Reddit (needs .reddit_cred) then falls back to YouTube,
    which needs no auth - so this always returns something and never hard-gates.
    """
    seen_q, cands = set(), []
    for ev in events:
        q = f"{ev.get('name','')} {EVENT_QUERY.get(ev.get('event'), '')}".strip()
        if not q or q in seen_q:
            continue
        seen_q.add(q)
        with tempfile.NamedTemporaryFile("r", suffix=".json", delete=True) as tf:
            r = subprocess.run(
                [sys.executable, str(FETCHER), q, "--limit", "15", "--out", tf.name],
                capture_output=True, text=True)
            if r.returncode != 0:
                print(f"  ! fetch failed for {q!r}: {r.stderr.strip()[:160]}",
                      file=sys.stderr)
                continue
            try:
                cands.extend(json.loads(Path(tf.name).read_text()))
            except Exception:
                pass
    uniq = {c["url"]: c for c in cands if c.get("url")}
    print(f"fetched {len(uniq)} unique candidate posts from {len(seen_q)} queries")
    return list(uniq.values())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates",
                    help="JSON list of {url,author,text,ts} posts to match against")
    ap.add_argument("--fetch", action="store_true",
                    help="auto-fetch candidates from X via x_fetch.py (needs .x_cookies)")
    ap.add_argument("--all", action="store_true", help="reprocess every event")
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--min-score", type=float, default=4.0,
                    help="reject best matches below this (default 4.0)")
    args = ap.parse_args()

    if not args.candidates and not args.fetch:
        sys.exit("give --candidates <file> or --fetch")
    events, total = load_events(args.all)
    if not events:
        print("no new events to ingest.")
        return

    if args.fetch:
        cands = fetch_candidates(events)
    else:
        cands = json.loads(Path(args.candidates).read_text())
    if not isinstance(cands, list):
        sys.exit("candidates must be a JSON list")
    if not cands:
        print("no candidates available; nothing to match.")
        return

    reviewed = json.loads(REVIEWED.read_text())
    reviewed.setdefault("keep", {})
    pool_urls = set(POOL.read_text().split()) if POOL.exists() else set()

    matched, skipped = [], []
    for ev in events:
        best, best_s = None, -1.0
        for c in cands:
            sc = score(ev, c)
            if sc is not None and sc > best_s:
                best, best_s = c, sc
        if not best or best_s < args.min_score:
            skipped.append((ev, "no candidate matched"))
            continue
        url = best["url"]
        if already_have(url, reviewed):
            skipped.append((ev, "clip already reviewed"))
            continue
        note = (f"{ev['name']} - {ev.get('detail','')} "
                f"(auto: caption-matched @{best.get('author','?')}, score {best_s:.1f})")
        reviewed["keep"][url] = note
        if url not in pool_urls:
            with POOL.open("a") as f:
                f.write(url + "\n")
            pool_urls.add(url)
        matched.append((ev, best, best_s))

    REVIEWED.write_text(json.dumps(reviewed, indent=1, ensure_ascii=False))
    if not args.all:
        STATE.write_text(json.dumps({"consumed": total}))

    print(f"ingested {len(events)} event(s): {len(matched)} matched, {len(skipped)} skipped")
    for ev, c, s in matched:
        print(f"  MATCH {ev['name']:20} {ev.get('detail',''):18} <- @{c.get('author','?')} ({s:.1f})")
    for ev, why in skipped[:20]:
        print(f"  skip  {ev['name']:20} {ev.get('detail',''):18} ({why})")

    if matched and not args.no_build:
        print("\nrebuilding feeds...")
        subprocess.run([sys.executable, str(BUILD), str(POOL)], cwd=str(HERE.parent))


if __name__ == "__main__":
    main()
