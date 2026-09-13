#!/usr/bin/env python3
"""
Headless X (Twitter) search -> candidate clips JSON for ingest_highlights.py.

X has no free API and killed guest access, so a headless daemon can only search
by replaying the web app's own GraphQL SearchTimeline call with YOUR logged-in
cookies. You supply them once (see SETUP); this script needs no browser.

⚠️  READ BEFORE RELYING ON THIS:
 - UNTESTED end-to-end here: it was written without live cookies, so the authed
   request path has not been run. Treat first use as a smoke test.
 - Automating X with your account cookies is against X's ToS and can get the
   account limited/locked. Your call.
 - X rotates the GraphQL query id + "features" blob periodically; when it does,
   this 404s/400s until you refresh QUERY_ID/FEATURES from a real session.
 - Cookies expire; refresh auth_token/ct0 when it starts 401ing.

SETUP (one time), in scripts/.x_cookies (gitignored, KEY=VALUE per line):
   AUTH_TOKEN=<the 'auth_token' cookie value from x.com>
   CT0=<the 'ct0' cookie value from x.com>
   # optional, only if the defaults below stop working:
   QUERY_ID=<SearchTimeline query id from a /i/api/graphql/.../SearchTimeline URL>
Get them in the logged-in browser: DevTools > Application > Cookies > x.com for
auth_token and ct0; DevTools > Network, do any search, open the SearchTimeline
request for the query id. This script never prints or transmits the cookies
anywhere except api.x.com.

Usage:
    python3 x_fetch.py "Cooper Kupp catch" --since 2026-09-13 --out cands.json
    python3 x_fetch.py "Kyren Williams touchdown" --limit 15   # prints JSON
"""
import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
COOKIES = HERE / ".x_cookies"

# Public web-app bearer (not a secret; shipped in x.com's JS). Cookies are auth.
BEARER = ("Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
          "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA")
# Rotates - override via QUERY_ID in .x_cookies when X changes it.
DEFAULT_QUERY_ID = "nK1dw4oV3k4w5TdtcAdSww"
FEATURES = {
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_graphql_exclude_directive_enabled": True,
    "verified_phone_label_enabled": False,
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "tweetypie_unmention_optimization_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}


def load_cookies():
    if not COOKIES.exists():
        sys.exit(f"missing {COOKIES} - see SETUP in this file's docstring")
    kv = {}
    for line in COOKIES.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            kv[k.strip().upper()] = v.strip()
    if not kv.get("AUTH_TOKEN") or not kv.get("CT0"):
        sys.exit("need AUTH_TOKEN and CT0 in .x_cookies")
    return kv


def search(query, limit, since):
    kv = load_cookies()
    q = query if not since else f"{query} since:{since}"
    q += " filter:native_video -filter:retweets"
    variables = {"rawQuery": q, "count": max(limit, 20), "querySource": "typed_query",
                 "product": "Latest"}
    qid = kv.get("QUERY_ID") or DEFAULT_QUERY_ID
    url = (f"https://api.x.com/graphql/{qid}/SearchTimeline?"
           f"variables={urllib.parse.quote(json.dumps(variables))}"
           f"&features={urllib.parse.quote(json.dumps(FEATURES))}")
    req = urllib.request.Request(url, headers={
        "authorization": BEARER,
        "x-csrf-token": kv["CT0"],
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "content-type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "cookie": f"auth_token={kv['AUTH_TOKEN']}; ct0={kv['CT0']}",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def extract(data):
    """Pull {url, author, text, ts, has_video} from a SearchTimeline response."""
    out = []
    try:
        insts = (data["data"]["search_by_raw_query"]["search_timeline"]
                 ["timeline"]["instructions"])
    except (KeyError, TypeError):
        return out
    for inst in insts:
        for entry in inst.get("entries", []):
            try:
                res = entry["content"]["itemContent"]["tweet_results"]["result"]
                legacy = res.get("legacy") or res.get("tweet", {}).get("legacy") or {}
                core = (res.get("core") or res.get("tweet", {}).get("core") or {})
                user = (core["user_results"]["result"]["legacy"])
                handle = user.get("screen_name", "")
                media = (legacy.get("extended_entities") or {}).get("media", [])
                has_video = any(m.get("type") in ("video", "animated_gif") for m in media)
                tid = legacy.get("id_str") or res.get("rest_id")
                if not tid:
                    continue
                dt = legacy.get("created_at")
                ts = int(time.mktime(time.strptime(dt, "%a %b %d %H:%M:%S +0000 %Y"))) if dt else 0
                out.append({"url": f"https://x.com/{handle}/status/{tid}",
                            "author": handle, "text": (legacy.get("full_text") or "").replace("\n", " "),
                            "ts": ts, "has_video": has_video})
            except (KeyError, TypeError, ValueError):
                continue
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--since", help="YYYY-MM-DD")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--video-only", action="store_true", help="drop non-video results")
    ap.add_argument("--out", help="write JSON here instead of stdout")
    args = ap.parse_args()

    try:
        data = search(args.query, args.limit, args.since)
    except urllib.error.HTTPError as e:
        sys.exit(f"X returned HTTP {e.code} - cookies expired, or X rotated the "
                 f"query id/features (refresh QUERY_ID in .x_cookies). Body: "
                 f"{e.read()[:300]!r}")
    cands = extract(data)
    if args.video_only:
        cands = [c for c in cands if c.get("has_video")]
    payload = json.dumps(cands, indent=1)
    if args.out:
        Path(args.out).write_text(payload)
        print(f"wrote {len(cands)} candidates -> {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
