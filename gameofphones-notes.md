# gameofphones — notes

## If a transaction takes more than 30 minutes to show up on the site, check the tracker

The site should reflect a new Sleeper transaction within about 5–10 minutes. **If it's been
over 30 minutes, something in the chain is broken — check it in this order.** [obi]

```bash
launchctl list | grep gameofphones          # 2nd column must be 0; nonzero = the poller is failing
tail -20 ~/Library/Logs/gameofphones-poll.log
gh run list --workflow=auto_refresh.yml --limit 5 --repo ddhkim-gop/gameofphones
```

The chain, in order — check each link:

| # | Link | How to tell it's the problem | Fix |
|---|---|---|---|
| 1 | **Mac asleep / off** | No log lines for the gap | Nothing to fix. GitHub's cron still runs, just slowly (~1.5–2h). This is the expected fallback. |
| 2 | **Poller not loaded** | `launchctl list` shows nothing | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.skyler.gameofphones-poll.plist` |
| 3 | **Poller erroring** | Nonzero exit in `launchctl list`, or `ERROR` in the log | Read the log — usually `gh` auth expired (`gh auth status`) or a moved path |
| 4 | **`gh` token lost `workflow` scope** | Log shows dispatch failed | `gh auth refresh -h github.com -s workflow` |
| 5 | **Workflow ran but skipped deploy** | Run shows `deploy: skipped` | Means the refresh found no data change. If Sleeper *does* show the txn, the refresh script is the problem, not the deploy |
| 6 | **Deployed but site stale** | Live `data.js?v=` older than repo's | Browser cache, or the deploy checked out the wrong SHA — compare with `curl -s <site>/index.html \| grep -o 'data\.js?v=[0-9]*'` |

**Pending waivers are invisible by design.** Both the poller and the refresh script only
count transactions with status `complete` or `failed`. An in-flight waiver claim will not
appear until Sleeper processes it — that's not a bug, and no amount of tracker-poking will
surface it early.

## How the update path actually works

Sleeper has **no webhooks** — everything is polling.

1. `local.skyler.gameofphones-poll` (launchd, every 300s) runs the poller on this Mac.
2. Poller compares the newest Sleeper `transaction_id` against
   `~/Library/Application Support/gameofphones/last_txn.json`.
3. On change it fires `gh workflow run auto_refresh.yml`. `workflow_dispatch` is **not**
   throttled by GitHub, unlike `schedule`.
4. `auto_refresh.yml` refreshes `data.js`, commits, and — in the same run — deploys Pages.
5. GitHub's own `*/30` cron remains as a fallback for when this Mac is off.

**Why the local poller exists:** GitHub throttles `schedule` events severely. Measured
2026-08-04 over 73.5h — the `*/30` cron fired 40 times where ~147 were due (27%), median
gap 98 min, worst 234 min.

**The running copy is NOT the vault copy.** launchd has no TCC access to `~/Desktop`, so the
script is deployed to `~/Library/Application Support/gameofphones/`. After editing
`scripts/poll_sleeper_local.py` here, re-deploy or the change does nothing:

```bash
cp "/Users/david/Desktop/Skyler/personal/fantasy football/gameofphones/scripts/poll_sleeper_local.py" "$HOME/Library/Application Support/gameofphones/poll_sleeper_local.py"
```

Then restart it:

```bash
launchctl kickstart -k gui/$(id -u)/local.skyler.gameofphones-poll
```

## Turning the poller off

```bash
launchctl bootout gui/$(id -u)/local.skyler.gameofphones-poll
```

Harmless — the site falls back to GitHub's cron. Delete
`~/Library/LaunchAgents/local.skyler.gameofphones-poll.plist` to make it permanent.
