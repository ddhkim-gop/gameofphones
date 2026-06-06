import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

renderNav();

const YEARS = ["2026", "2025", "2024", "2023"];
// Only years with real completed stats
const REAL_STAT_YEARS = ["2023", "2024", "2025"];
const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", PICK:"#5a6070" };

// Consistent 0–100 scale: 400 half-PPR pts = 100. Linear, position-agnostic.
// Elite QB (~400 pts) = 100, elite RB/WR (~300 pts) = 75, elite TE (~200 pts) = 50.
const PTS_PER_POINT = 4;
function ptsToScore(pts) {
    if (pts == null || pts < 0) return 0;
    return Math.min(100, Math.round(pts / PTS_PER_POINT));
}
function scoreColor(score) {
    if (score >= 65) return "#3ecf8e";
    if (score >= 35) return "#f6ad55";
    return "#f87171";
}

let allTransactions = [];
let nameToId = {};
let statsCache = {};
let draftCache = {};
let selectedYear = "2025";

// ── Value system ──────────────────────────────────────────────────────────────

function playerIdFor(name) { return nameToId[name] || null; }

// Get stats for a player in a given year: { pts, score, rank, position }
function playerYearData(name, year) {
    const pid = playerIdFor(name);
    if (!pid) return null;
    const st = (statsCache[year] || {})[pid];
    if (!st || st.pts_half_ppr == null) return null;
    return { pts: st.pts_half_ppr, score: ptsToScore(st.pts_half_ppr), rank: st.rank, position: st.position };
}

// Post-trade years: only REAL_STAT_YEARS that are strictly after the trade year
function postTradeYears(tradeYear) {
    const yi = parseInt(tradeYear);
    return REAL_STAT_YEARS.filter(y => parseInt(y) > yi);
}

// Average score across post-trade years for a player
function playerPostTradeValue(name, tradeYear) {
    const years = postTradeYears(tradeYear);
    if (!years.length) return { avg: null, byYear: [], position: null };
    const byYear = years.map(y => ({ year: y, data: playerYearData(name, y) }));
    const valid = byYear.filter(e => e.data !== null);
    const avg = valid.length ? valid.reduce((s, e) => s + e.data.score, 0) / valid.length : null;
    const position = valid.length ? valid[valid.length - 1].data.position : null;
    return { avg, byYear, position };
}

// Pick value: resolved player's post-trade score, or round-based estimate
function pickPostTradeValue(asset, receivingTeam, tradeYear) {
    const m = asset.name.match(/(\d{4})\s+Round\s+(\d+)/i);
    if (!m) return { avg: null, byYear: [], resolved: null, estimated: false };
    const [, pickYear, roundStr] = m;
    const round = parseInt(roundStr);
    const draft = draftCache[pickYear] || [];
    const resolved = draft.length
        ? draft.find(p => p.round === round && p.traded && p.picked_by === receivingTeam)
        : null;

    if (resolved) {
        const ptYears = REAL_STAT_YEARS.filter(y => parseInt(y) >= parseInt(pickYear) && parseInt(y) > parseInt(tradeYear));
        const byYear = ptYears.map(y => ({ year: y, data: playerYearData(resolved.player, y) }));
        const valid  = byYear.filter(e => e.data !== null);
        const avg    = valid.length ? valid.reduce((s, e) => s + e.data.score, 0) / valid.length : null;
        const position = valid.length ? valid[valid.length - 1].data.position : null;
        return { avg, byYear, resolved: resolved.player, resolvedPos: resolved.position,
                 origOwner: resolved.original_owner || null, position, estimated: false };
    }

    // Unresolved — estimate by round (converted to 0-100 scale)
    const baseVal = parseInt(pickYear) > 2025 ? null :
        round === 1 ? 45 : round === 2 ? 28 : 14;
    return { avg: baseVal, byYear: [], resolved: null, estimated: baseVal !== null, position: null };
}

// Compute full side value — preserve position from asset if stats don't have it
function sideValue(assets, receivingTeam, tradeYear) {
    return assets.map(asset => {
        if (asset.position === "PICK") {
            const v = pickPostTradeValue(asset, receivingTeam, tradeYear);
            return { ...asset, ...v, isPick: true };
        }
        const v = playerPostTradeValue(asset.name, tradeYear);
        return { ...asset, ...v, position: v.position || asset.position, isPick: false };
    });
}

function totalValue(items) {
    return items.reduce((s, item) => s + (item.avg ?? 0), 0);
}

// ── Trade summary narrative ───────────────────────────────────────────────────

// Describe a player's rank in natural language, per position
function rankDesc(rank, pos) {
    if (!rank) return null;
    const p = (pos || "").toUpperCase();
    // Thresholds: [maxRank, label]
    const tiers = {
        QB:  [[1,"the overall QB1"],[3,"an elite QB"],[8,"a top-tier QB"],[14,"a solid starter at QB"],[24,"a streamer at QB"],[99,"a non-factor at QB"]],
        RB:  [[1,"the overall RB1"],[3,"an elite RB"],[8,"a top-5 RB"],[15,"a strong RB starter"],[24,"a solid RB depth piece"],[36,"a fringe RB"],[99,"a non-factor at RB"]],
        WR:  [[1,"the overall WR1"],[3,"an elite WR"],[8,"a top-5 WR"],[16,"a strong WR starter"],[30,"a solid WR depth piece"],[48,"a fringe WR"],[99,"a non-factor at WR"]],
        TE:  [[1,"the overall TE1"],[3,"an elite TE"],[8,"a top-5 TE"],[14,"a reliable starter at TE"],[20,"a depth TE"],[99,"a non-factor at TE"]],
        K:   [[5,"a top kicker"],[12,"a solid kicker"],[99,"a fringe kicker"]],
        DEF: [[5,"a top defense"],[12,"a solid defense"],[99,"a fringe defense"]],
    };
    const list = tiers[p] || tiers.WR;
    for (const [max, label] of list) {
        if (rank <= max) return label;
    }
    return "a non-factor";
}

// Check if a player was traded away again after this trade
function wasLaterFlipped(playerName, fromTeam, afterSeason, afterWeek) {
    return allTransactions.some(t => {
        if (t.type !== "trade") return false;
        if (t.season < afterSeason || (t.season === afterSeason && t.week <= afterWeek)) return false;
        // Player appears as an asset given away by fromTeam (i.e. in the other team's received list)
        return t.teams.some(team => team !== fromTeam &&
            (t.assets_received[team] || []).some(a => a.name === playerName)
        );
    });
}

function tradeNarrative(tx, itemsA, itemsB, valA, valB) {
    const [teamA, teamB] = tx.teams;
    const margin = Math.abs(valA - valB);
    const pct    = valA + valB > 0 ? margin / ((valA + valB) / 2) : 0;
    const postYears = postTradeYears(tx.season);
    const noData = postYears.length === 0;

    const parts = [];

    if (noData) {
        parts.push(`This trade was made in ${tx.season} and no completed seasons have elapsed yet. Check back after the ${parseInt(tx.season) + 1} season.`);
        return parts.join(" ");
    }

    // Verdict
    if (margin < 5) {
        parts.push(`This trade was roughly even.`);
    } else {
        const winner = valA > valB ? teamA : teamB;
        const descriptor = pct > 0.8 ? "dominated" : pct > 0.5 ? "clearly won" : "edged";
        parts.push(`<strong>${winner}</strong> ${descriptor} this trade.`);
    }

    // Build player list sorted by value
    const allItems = [
        ...itemsA.filter(i => !i.isPick).map(i => ({...i, _team: teamA})),
        ...itemsB.filter(i => !i.isPick).map(i => ({...i, _team: teamB})),
    ].sort((a,b) => (b.avg ?? 0) - (a.avg ?? 0));

    // Describe top contributors naturally by rank
    const contributors = allItems.filter(i => i.byYear.some(e => e.data) && (i.avg ?? 0) >= 30).slice(0, 4);
    for (const p of contributors) {
        const validYears = p.byYear.filter(e => e.data);
        const flipped = wasLaterFlipped(p.name, p._team, tx.season, tx.week);

        if (validYears.length === 1) {
            const d = validYears[0].data;
            const desc = rankDesc(d.rank, d.position);
            const flipNote = flipped ? `, before being flipped in a later trade` : ``;
            parts.push(`<strong>${p.name}</strong> gave ${p._team} a strong return, finishing as ${desc} in ${validYears[0].year}${flipNote}.`);
        } else {
            // Multiple years — look for consistency or arc
            const descs = validYears.map(e => ({ year: e.year, desc: rankDesc(e.data.rank, e.data.position), rank: e.data.rank }));
            const first = descs[0], last = descs[descs.length - 1];
            // Meaningful improvement: rank improved by at least 8 spots
            const improving = last.rank < first.rank - 8;
            // Meaningful decline: rank dropped by at least 8 spots
            const declining = last.rank > first.rank + 8;
            const flipNote = flipped ? ` before eventually being moved on` : ``;
            if (improving) {
                parts.push(`<strong>${p.name}</strong> broke out for ${p._team} — ${first.desc} in ${first.year}, then ${last.desc} in ${last.year}${flipNote}.`);
            } else if (declining) {
                parts.push(`<strong>${p.name}</strong> started strong for ${p._team} as ${first.desc} in ${first.year} but fell off to ${last.desc} in ${last.year}${flipNote}.`);
            } else {
                parts.push(`<strong>${p.name}</strong> was a consistent piece for ${p._team}, finishing as ${first.desc} in ${first.year} and ${last.desc} in ${last.year}${flipNote}.`);
            }
        }
    }

    // Busts
    const busts = allItems.filter(i => i.byYear.some(e => e.data) && (i.avg ?? 0) < 8);
    for (const b of busts.slice(0, 1)) {
        const flipped = wasLaterFlipped(b.name, b._team, tx.season, tx.week);
        if (flipped) {
            parts.push(`<strong>${b.name}</strong> never contributed for ${b._team} and was eventually moved.`);
        } else {
            parts.push(`<strong>${b.name}</strong> was a bust, contributing almost nothing after the trade.`);
        }
    }

    // Inactive / no data players
    const inactive = allItems.filter(i => !i.byYear.some(e => e.data));
    if (inactive.length > 0) {
        const names = inactive.slice(0, 2).map(i => `<strong>${i.name}</strong>`).join(" and ");
        parts.push(`${names} had no production in the post-trade window.`);
    }

    const aGivesPicks = (tx.assets_received[teamB] || []).some(a => a.position === "PICK");
    const bGivesPicks = (tx.assets_received[teamA] || []).some(a => a.position === "PICK");
    const aPickCount  = (tx.assets_received[teamB] || []).filter(a => a.position === "PICK").length;
    const bPickCount  = (tx.assets_received[teamA] || []).filter(a => a.position === "PICK").length;

    if (bGivesPicks && !aGivesPicks) {
        parts.push(`<strong>${teamB}</strong> was in win-now mode, dealing ${bPickCount > 1 ? bPickCount + " picks" : "a pick"} for immediate talent. <strong>${teamA}</strong> was building for the future.`);
    } else if (aGivesPicks && !bGivesPicks) {
        parts.push(`<strong>${teamA}</strong> was in win-now mode, dealing ${aPickCount > 1 ? aPickCount + " picks" : "a pick"} for immediate talent. <strong>${teamB}</strong> was building for the future.`);
    } else if (aGivesPicks && bGivesPicks) {
        parts.push(`Both teams swapped players and picks — a repositioning of their respective rebuild timelines.`);
    }

    if (postYears.length === 1) {
        parts.push(`Note: only ${postYears[0]} data is available; values will refine as more seasons complete.`);
    }

    return parts.join(" ");
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function posTag(pos, small = false) {
    const p = (pos || "").toUpperCase();
    const sz = small ? "8px" : "9px";
    const base = `font-size:${sz};font-weight:800;padding:2px 0;border-radius:3px;flex-shrink:0;min-width:30px;text-align:center;display:inline-block;letter-spacing:.03em;`;
    if (p === "PICK") {
        return `<span style="${base}background:#1e2027;color:#a78bfa;border:1px solid #3d3560;">PICK</span>`;
    }
    const color = POS_COLORS[p] || "#5a6070";
    return `<span style="${base}background:${color};color:#fff;">${pos || "?"}</span>`;
}

function scoreBar(score) {
    if (score === null || score === undefined) return "";
    const pct = Math.min(100, score);
    const color = scoreColor(score);
    return `<div style="height:4px;background:#2d3139;border-radius:2px;margin-top:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;"></div>
    </div>`;
}

function renderItemCard(item, tradeYear) {
    const ptYears = postTradeYears(tradeYear);
    const hasData = ptYears.length > 0;

    if (item.isPick) {
        const m = item.name.match(/(\d{4})\s+Round\s+(\d+)/i);
        const ordinals = ["","1st","2nd","3rd","4th"];
        const label = m ? `${m[1]} ${ordinals[parseInt(m[2])] || m[2]+"th"} Round Pick` : item.name;
        const future = !m || parseInt(m[1]) > 2025;

        let resolvedHtml = "";
        if (item.resolved) {
            const color = item.avg != null ? scoreColor(item.avg) : "#5a6070";
            resolvedHtml = `
            <div style="margin-top:5px;padding:5px 8px;background:#1a1c22;border-radius:6px;border-left:2px solid #3d4350;">
                <div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Drafted</div>
                <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
                    ${posTag(item.resolvedPos, true)}
                    <span style="font-size:11px;font-weight:600;color:#c9cdd4;">${item.resolved}</span>
                </div>
                ${item.avg !== null ? `<div style="font-size:10px;color:#8b9099;">Post-trade value: <strong style="color:${color};">${item.avg.toFixed(0)}/100</strong></div>${scoreBar(item.avg)}` : ""}
            </div>`;
        } else if (item.estimated && !future) {
            resolvedHtml = `<div style="font-size:10px;color:#5a6070;margin-top:3px;">Est. ~${item.avg}/100 (pick unresolved)</div>`;
        } else {
            resolvedHtml = `<div style="font-size:10px;color:#5a6070;margin-top:3px;">${future ? "Future pick — value TBD" : "Pick data unavailable"}</div>`;
        }

        return `
        <div style="margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
                ${posTag("PICK")}
                <span style="font-size:12px;font-weight:600;color:#8b9099;">${label}</span>
                ${item.fromTeam ? `<span style="font-size:10px;color:#5a6070;">· from ${item.fromTeam}</span>` : ""}
            </div>
            ${resolvedHtml}
        </div>`;
    }

    // Regular player
    const pos = item.position;
    const avgColor = item.avg === null ? "#5a6070" : scoreColor(item.avg);
    const avgDisplay = item.avg !== null ? `${item.avg.toFixed(0)}/100` : hasData ? "0/100" : "—";

    const yearRows = item.byYear.map(e => {
        if (!e.data) return `<span style="color:#5a6070;">${e.year}: —</span>`;
        return `<span>${e.year}: <strong style="color:#c9cdd4;">${e.data.score}/100</strong> <span style="color:#5a6070;">#${e.data.rank} ${e.data.position} (${e.data.pts.toFixed(0)} pts)</span></span>`;
    }).join(" · ");

    return `
    <div style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
            ${posTag(pos)}
            <span style="font-size:13px;font-weight:600;color:#c9cdd4;">${item.name}</span>
            ${item.team ? `<span style="font-size:10px;color:#5a6070;">${item.team}</span>` : ""}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;color:#8b9099;margin-bottom:2px;">
            ${hasData
                ? `<span>Post-trade value: <strong style="color:${avgColor};font-size:12px;">${avgDisplay}</strong></span>` +
                  (item.byYear.length ? `<span style="color:#3d4350;">|</span><span>${yearRows}</span>` : "")
                : `<span style="color:#5a6070;">No post-trade data yet</span>`}
        </div>
        ${item.avg !== null ? scoreBar(item.avg) : ""}
    </div>`;
}

function renderTradeCard(tx) {
    const [teamA, teamB] = tx.teams;
    const assetsA = tx.assets_received[teamA] || [];
    const assetsB = tx.assets_received[teamB] || [];

    const itemsA = sideValue(assetsA, teamA, tx.season).map(i =>
        i.isPick ? { ...i, fromTeam: i.origOwner || teamB } : i);
    const itemsB = sideValue(assetsB, teamB, tx.season).map(i =>
        i.isPick ? { ...i, fromTeam: i.origOwner || teamA } : i);
    const valA   = totalValue(itemsA);
    const valB   = totalValue(itemsB);
    const ptYears = postTradeYears(tx.season);
    const hasData = ptYears.length > 0;

    let winner = null;
    if (hasData && Math.abs(valA - valB) >= 5) {
        winner = valA > valB ? teamA : teamB;
    }

    const summary = tradeNarrative(tx, itemsA, itemsB, valA, valB);
    const weekLabel = tx.week === 0 ? "Pre-season" : `Week ${tx.week}`;

    const col = (team, items, val, isWinner) => {
        const isLoser = winner !== null && !isWinner;
        return `
        <div style="flex:1;min-width:0;padding:0 14px 0 0;">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #2d3139;">
                <span style="font-size:13px;font-weight:800;color:#f0f1f3;">${team}</span>
                ${isWinner ? '<span style="font-size:10px;font-weight:700;color:#3ecf8e;background:#0d2b1e;border-radius:4px;padding:2px 6px;">W</span>' : ""}
                ${isLoser  ? '<span style="font-size:10px;font-weight:700;color:#f87171;background:#2b0d0d;border-radius:4px;padding:2px 6px;">L</span>' : ""}
            </div>
            ${items.map(i => renderItemCard(i, tx.season)).join("")}
            ${hasData ? `<div style="font-size:10px;color:#5a6070;border-top:1px solid #2d3139;padding-top:5px;margin-top:4px;">Total post-trade value: <strong style="color:#c9cdd4;">${val.toFixed(0)}</strong></div>` : ""}
        </div>`;
    };

    return `
    <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:16px 18px;margin-bottom:18px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;margin-bottom:12px;">
            ${weekLabel} · ${tx.created || ""}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1px 1fr;gap:0;margin-bottom:14px;">
            ${col(teamA, itemsA, valA, winner === teamA)}
            <div style="background:#2d3139;"></div>
            <div style="padding-left:14px;">${col(teamB, itemsB, valB, winner === teamB).replace('padding:0 14px 0 0', 'padding:0')}</div>
        </div>
        <div style="background:#252830;border-radius:8px;padding:12px 14px;font-size:12px;line-height:1.7;color:#c9cdd4;border-left:3px solid #3d4350;">
            ${summary}
        </div>
    </div>`;
}

function renderAll(year, showPreseason) {
    const board = document.getElementById("ta-board");
    if (!board) return;

    const yearTrades = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);
    const inSeason   = yearTrades.filter(tx => tx.week >= 1).sort((a,b) => a.week - b.week);
    const preseason  = yearTrades.filter(tx => tx.week === 0);

    if (!yearTrades.length) {
        board.innerHTML = `<div style="color:#5a6070;padding:40px 0;text-align:center;">No trades found for ${year}.</div>`;
        return;
    }

    const ptYears = postTradeYears(year);
    const notice = ptYears.length === 0
        ? `<div style="background:#2b1d0d;border:1px solid #7c4a1a;border-radius:8px;padding:10px 14px;font-size:12px;color:#f6ad55;margin-bottom:20px;">
            No completed seasons after ${year} yet — post-trade values will appear once real stats exist.
           </div>`
        : ptYears.length === 1
        ? `<div style="background:#1a2230;border:1px solid #2d4060;border-radius:8px;padding:10px 14px;font-size:12px;color:#8b9099;margin-bottom:20px;">
            Value based on ${ptYears[0]} only — will refine as more seasons complete.
           </div>` : "";

    const section = (label, trades) => !trades.length ? "" : `
        <div style="margin-bottom:32px;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;
                        margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2d3139;">${label}</div>
            ${trades.map(tx => renderTradeCard(tx)).join("")}
        </div>`;

    board.innerHTML = notice
        + (showPreseason ? section("Pre-season", preseason) : "")
        + section("In-Season", inSeason);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    const container = document.getElementById("ta-container");

    container.innerHTML = `
    <style>
        #ta-container { max-width: 960px; }
    </style>
    <div class="filter-bar" style="margin-bottom:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <select id="ta-year">${YEARS.map(y => `<option value="${y}"${y===selectedYear?" selected":""}>${y}</option>`).join("")}</select>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#8b9099;cursor:pointer;">
            <input type="checkbox" id="ta-preseason"> Show pre-season trades
        </label>
    </div>
    <div id="ta-board"><div style="color:#5a6070;padding:40px 0;text-align:center;">Loading…</div></div>
    `;

    const yearSel = document.getElementById("ta-year");
    const preSel  = document.getElementById("ta-preseason");

    const [transactions, nameMap] = await Promise.all([
        api.getTransactions(),
        api.getPlayerNameMap(),
    ]);
    allTransactions = transactions;
    nameToId = nameMap;

    await Promise.all([
        ...REAL_STAT_YEARS.map(y => api.getPlayerStats(y).then(d => { statsCache[y] = d; }).catch(() => {})),
        ...["2023","2024","2025","2026"].map(y => api.getDraft(y).then(d => { draftCache[y] = d || []; }).catch(() => {})),
    ]);

    const redraw = () => renderAll(selectedYear, preSel.checked);
    yearSel.addEventListener("change", e => { selectedYear = e.target.value; redraw(); });
    preSel.addEventListener("change", redraw);
    redraw();
}

init();
