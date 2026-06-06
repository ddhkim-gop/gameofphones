import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

renderNav();

const YEARS = ["2025", "2024", "2023"];
const PLAYOFF_START = 15;

const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#64748b" };
function posColor(pos) { return POS_COLORS[(pos||"").toUpperCase()] || "#5a6070"; }

let usersMap = {};
let matchupsCache = {};
let recordsCache = {};   // year → { owner → { w, l } } per week cumulative
let weekStatsCache = {}; // "year_week" → { player_id → stats }
let selectedYear = YEARS[0];
let selectedWeek = null;
let _did = 0;

// Fetch per-week player stats from Sleeper's public API
async function fetchWeekStats(year, weekStr) {
    const key = `${year}_${weekStr}`;
    if (weekStatsCache[key]) return weekStatsCache[key];
    const w = parseInt(weekStr);
    const type = w >= PLAYOFF_START ? "post" : "regular";
    const sleeperWeek = w >= PLAYOFF_START ? w - PLAYOFF_START + 1 : w;
    try {
        const r = await fetch(`https://api.sleeper.app/v1/stats/nfl/${type}/${year}/${sleeperWeek}`);
        if (!r.ok) return {};
        const data = await r.json();
        weekStatsCache[key] = data || {};
    } catch {
        weekStatsCache[key] = {};
    }
    return weekStatsCache[key];
}

function avatarEl(name, size = 24) {
    const url = usersMap[name];
    const sz = size;
    if (url) {
        return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='<span style=\\'width:${sz}px;height:${sz}px;border-radius:50%;background:#252830;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.4)}px;font-weight:700;color:#5a6070;\\'>${(name||"?")[0].toUpperCase()}</span>'">`;
    }
    return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#252830;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.4)}px;font-weight:700;color:#5a6070;flex-shrink:0;">${(name||"?")[0].toUpperCase()}</span>`;
}

// Build cumulative W/L records through each week
function buildRecords(data) {
    const totals = {}; // owner → {w, l}
    const byWeek = {}; // weekStr → { owner → {w, l} snapshot after that week }
    const weeks = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));
    for (const w of weeks) {
        // Only count regular season for records
        if (parseInt(w) >= PLAYOFF_START) { byWeek[w] = JSON.parse(JSON.stringify(totals)); continue; }
        for (const matchup of (data[w] || [])) {
            const [t1, t2] = matchup.teams || [];
            if (!t1 || !t2) continue;
            if (!totals[t1.owner]) totals[t1.owner] = { w: 0, l: 0 };
            if (!totals[t2.owner]) totals[t2.owner] = { w: 0, l: 0 };
            if (t1.points > t2.points) { totals[t1.owner].w++; totals[t2.owner].l++; }
            else if (t2.points > t1.points) { totals[t2.owner].w++; totals[t1.owner].l++; }
        }
        byWeek[w] = JSON.parse(JSON.stringify(totals));
    }
    return byWeek;
}

function recordStr(weekStr, owner) {
    const rec = recordsCache[selectedYear]?.[weekStr]?.[owner];
    if (!rec) return null;
    return `${rec.w}-${rec.l}`;
}

function renderLineup(starters) {
    if (!starters || !starters.length) return `<div style="color:#5a6070;font-size:12px;padding:8px 0;">No lineup data</div>`;
    return starters.map(s => {
        const pts = s.points != null ? s.points.toFixed(1) : "—";
        const clr = posColor(s.position);
        return `<div style="display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid #1a1c22;">
            <span style="background:${clr};color:#fff;font-size:9px;font-weight:800;padding:2px 5px;border-radius:3px;width:28px;text-align:center;flex-shrink:0;">${s.position||"?"}</span>
            <span style="flex:1;font-size:12px;color:#c9cdd4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.name||"Unknown"}</span>
            ${s.nfl_team ? `<img src="https://a.espncdn.com/i/teamlogos/nfl/500-dark/${s.nfl_team.toLowerCase()}.png" style="width:13px;height:13px;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">` : ""}
            <span style="font-size:12px;font-weight:700;color:${pts > 0 ? '#f0f1f3' : '#5a6070'};flex-shrink:0;min-width:32px;text-align:right;">${pts}</span>
        </div>`;
    }).join("");
}

// ── Stat helpers ─────────────────────────────────────────────────────────────

function statLine(player, weekStats) {
    const s = weekStats?.[player.player_id] || {};
    const pos = (player.position || "").toUpperCase();
    const parts = [];

    if (pos === "QB") {
        if (s.pass_yd) parts.push(`${Math.round(s.pass_yd)} pass yds`);
        if (s.pass_td) parts.push(`${s.pass_td} TD${s.pass_td !== 1 ? "s" : ""}`);
        if (s.pass_int) parts.push(`${s.pass_int} INT`);
        if (s.rush_yd >= 20) parts.push(`${Math.round(s.rush_yd)} rush yds`);
        if (s.rush_td) parts.push(`${s.rush_td} rush TD`);
    } else if (pos === "RB") {
        if (s.rush_yd) parts.push(`${Math.round(s.rush_yd)} rush yds`);
        if (s.rush_td) parts.push(`${s.rush_td} rush TD${s.rush_td !== 1 ? "s" : ""}`);
        if (s.rec) parts.push(`${s.rec}/${s.tar ?? s.rec} rec`);
        if (s.rec_yd >= 10) parts.push(`${Math.round(s.rec_yd)} rec yds`);
        if (s.rec_td) parts.push(`${s.rec_td} rec TD`);
    } else if (pos === "WR" || pos === "TE") {
        if (s.rec != null) parts.push(`${s.rec}/${s.tar ?? s.rec} rec`);
        if (s.rec_yd) parts.push(`${Math.round(s.rec_yd)} yds`);
        if (s.rec_td) parts.push(`${s.rec_td} TD${s.rec_td !== 1 ? "s" : ""}`);
        if (s.rush_yd >= 10) parts.push(`${Math.round(s.rush_yd)} rush yds`);
    } else if (pos === "K") {
        if (s.fgm != null) parts.push(`${s.fgm}/${(s.fga ?? s.fgm)} FG`);
        if (s.xpm != null) parts.push(`${s.xpm} XP`);
    } else if (pos === "DEF") {
        if (s.pts_allow != null) parts.push(`${s.pts_allow} pts allowed`);
        if (s.sack) parts.push(`${s.sack} sack${s.sack !== 1 ? "s" : ""}`);
        if (s.int) parts.push(`${s.int} INT`);
        if (s.def_td) parts.push(`${s.def_td} TD`);
    }
    return parts.join(", ");
}

// ── Cumulative score chart ────────────────────────────────────────────────────

function buildChart(t1, t2) {
    const s1 = t1.starters || [];
    const s2 = t2.starters || [];
    const n = Math.max(s1.length, s2.length);
    if (n === 0) return "";

    // Build cumulative arrays
    let cum1 = 0, cum2 = 0;
    const pts1 = [0], pts2 = [0];
    for (let i = 0; i < n; i++) {
        cum1 += (s1[i]?.points || 0);
        cum2 += (s2[i]?.points || 0);
        pts1.push(cum1);
        pts2.push(cum2);
    }

    const W = 360, H = 90;
    const PAD = { t: 8, r: 8, b: 20, l: 36 };
    const maxPts = Math.max(...pts1, ...pts2, 50);
    const gW = W - PAD.l - PAD.r;
    const gH = H - PAD.t - PAD.b;

    const xScale = i => PAD.l + (i / n) * gW;
    const yScale = v => PAD.t + gH - (v / maxPts) * gH;

    const polyline = pts => pts.map((v, i) => `${xScale(i)},${yScale(v)}`).join(" ");

    // Color: winner is brighter
    const t1win = t1.points > t2.points;
    const c1 = t1win ? "#3ecf8e" : "#5a6070";
    const c2 = t1win ? "#5a6070" : "#3ecf8e";

    // Y axis labels
    const yTicks = [0, Math.round(maxPts / 2), Math.round(maxPts)];
    const yTicksHtml = yTicks.map(v =>
        `<text x="${PAD.l - 4}" y="${yScale(v) + 4}" text-anchor="end" style="font-size:9px;fill:#5a6070;">${v}</text>`
    ).join("");

    // Final score labels at end of lines
    const finalLabel = (pts, color, isTop) => {
        const x = xScale(n) + 3;
        const y = yScale(pts[pts.length - 1]);
        return `<text x="${x}" y="${y + (isTop ? -3 : 9)}" style="font-size:9px;font-weight:700;fill:${color};">${pts[pts.length-1].toFixed(1)}</text>`;
    };

    return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible;">
        <!-- grid lines -->
        ${yTicks.map(v => `<line x1="${PAD.l}" y1="${yScale(v)}" x2="${PAD.l + gW}" y2="${yScale(v)}" stroke="#2d3139" stroke-width="0.5"/>`).join("")}
        <!-- x axis -->
        <line x1="${PAD.l}" y1="${PAD.t + gH}" x2="${PAD.l + gW}" y2="${PAD.t + gH}" stroke="#2d3139" stroke-width="0.5"/>
        ${yTicksHtml}
        <!-- lines -->
        <polyline points="${polyline(pts2)}" fill="none" stroke="${c2}" stroke-width="1.5" stroke-linejoin="round"/>
        <polyline points="${polyline(pts1)}" fill="none" stroke="${c1}" stroke-width="1.5" stroke-linejoin="round"/>
        <!-- dots at final point -->
        <circle cx="${xScale(n)}" cy="${yScale(pts1[n])}" r="3" fill="${c1}"/>
        <circle cx="${xScale(n)}" cy="${yScale(pts2[n])}" r="3" fill="${c2}"/>
        <!-- name + score labels -->
        <text x="${PAD.l}" y="${H - 4}" style="font-size:9px;fill:${c1};">${t1.owner}</text>
        <text x="${PAD.l + gW / 2}" y="${H - 4}" text-anchor="middle" style="font-size:9px;fill:${c2};">${t2.owner}</text>
        ${finalLabel(pts1, c1, pts1[n] >= pts2[n])}
        ${finalLabel(pts2, c2, pts2[n] > pts1[n])}
    </svg>`;
}

// ── Recap narrative ───────────────────────────────────────────────────────────

function topPlayer(starters) {
    return starters.reduce((best, s) => s.points > best.points ? s : best, starters[0]);
}
function zeroers(starters) {
    return starters.filter(s => s.points === 0 && s.position !== "K" && s.position !== "DEF");
}
function marginTag(m) {
    if (m < 5)  return "nail-biter";
    if (m < 15) return "close";
    if (m < 30) return "comfortable";
    if (m < 50) return "decisive";
    return "dominant";
}

function generateRecap(matchup, weekStr, weekStats) {
    const [a, b] = matchup.teams;
    if (!a || !b || !a.starters?.length || !b.starters?.length) return "";
    const winner = a.points > b.points ? a : b;
    const loser  = a.points > b.points ? b : a;
    const margin = Math.abs(a.points - b.points);
    const tag    = marginTag(margin);
    const isPlayoff = parseInt(weekStr) >= PLAYOFF_START;
    const playoffNote = isPlayoff ? " in the playoffs" : "";

    // Opening line
    let text = `${winner.owner} defeated ${loser.owner}${playoffNote}, ${winner.points.toFixed(2)}–${loser.points.toFixed(2)} (margin: ${margin.toFixed(2)}). `;

    // Top performers from each side with real stats
    const winTop = topPlayer(winner.starters);
    const loseTop = topPlayer(loser.starters);
    const winTopStat = statLine(winTop, weekStats);
    const loseTopStat = statLine(loseTop, weekStats);

    text += `${winTop.name} was the key contributor for ${winner.owner}`;
    text += winTopStat ? ` (${winTopStat}; ${winTop.points.toFixed(1)} pts). ` : ` with ${winTop.points.toFixed(1)} pts. `;

    if (loseTop.points >= winTop.points) {
        text += `${loseTop.name} actually outscored every player in the matchup`;
        text += loseTopStat ? ` (${loseTopStat}; ${loseTop.points.toFixed(1)} pts)` : ` with ${loseTop.points.toFixed(1)} pts`;
        text += `, but ${loser.owner} couldn't get enough production elsewhere. `;
    } else {
        text += `For ${loser.owner}, ${loseTop.name} led the way`;
        text += loseTopStat ? ` (${loseTopStat}; ${loseTop.points.toFixed(1)} pts). ` : ` with ${loseTop.points.toFixed(1)} pts. `;
    }

    // Highlight other notable performers (top 3 total across both teams, skip already mentioned)
    const allStarters = [
        ...winner.starters.map(s => ({ ...s, team: winner.owner })),
        ...loser.starters.map(s => ({ ...s, team: loser.owner })),
    ].filter(s => s.name !== winTop.name && s.name !== loseTop.name)
     .sort((a, b) => b.points - a.points)
     .slice(0, 2);

    const notable = allStarters.filter(s => s.points >= 20);
    if (notable.length) {
        const notableStr = notable.map(s => {
            const sl = statLine(s, weekStats);
            return sl ? `${s.name} (${sl}; ${s.points.toFixed(1)} pts)` : `${s.name} (${s.points.toFixed(1)} pts)`;
        }).join(" and ");
        text += `Other standouts: ${notableStr}. `;
    }

    // Zeros
    const zeros = zeroers(loser.starters);
    if (zeros.length >= 2) {
        text += `${loser.owner} was hurt by zeros from ${zeros.slice(0, 2).map(z => z.name).join(" and ")}. `;
    } else if (zeros.length === 1) {
        text += `A goose egg from ${zeros[0].name} didn't help ${loser.owner}'s cause. `;
    }

    // Tone closer
    if (tag === "nail-biter") text += "A couple of points in either direction would have flipped the result.";
    else if (tag === "dominant") text += "The result was never really in doubt.";

    return text;
}

// ── Matchup card ──────────────────────────────────────────────────────────────

function renderMatchup(matchup, weekStr, weekStats) {
    if (!matchup || !matchup.teams || matchup.teams.length < 2) return "";
    const [t1, t2] = matchup.teams;
    const t1win = t1.points > t2.points;
    const t2win = t2.points > t1.points;

    const teamCol = (team, isWinner) => {
        const rec = recordStr(weekStr, team.owner);
        return `<div style="padding:14px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                ${avatarEl(team.owner, 26)}
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:700;color:${isWinner ? '#f0f1f3' : '#8b9099'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${team.owner}</div>
                    ${rec ? `<div style="font-size:10px;color:#5a6070;margin-top:1px;">${rec}</div>` : ""}
                </div>
                <div style="font-size:20px;font-weight:800;color:${isWinner ? '#f0f1f3' : '#5a6070'};flex-shrink:0;">${(team.points||0).toFixed(2)}</div>
                ${isWinner
                    ? `<span style="font-size:9px;font-weight:800;color:#3ecf8e;background:#0d2b1e;border-radius:4px;padding:2px 6px;flex-shrink:0;">W</span>`
                    : `<span style="font-size:9px;font-weight:800;color:#f87171;background:#2b0d0d;border-radius:4px;padding:2px 6px;flex-shrink:0;">L</span>`}
            </div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;margin:8px 0 4px;">Starters</div>
            ${renderLineup(team.starters)}
            <div style="text-align:right;margin-top:6px;font-size:11px;color:#5a6070;">Total: <strong style="color:#c9cdd4;">${(team.points||0).toFixed(2)}</strong></div>
        </div>`;
    };

    const recap = generateRecap(matchup, weekStr, weekStats);
    const chart = buildChart(t1, t2);

    return `<div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;overflow:hidden;">
        <div class="mu-matchup-grid">
            ${teamCol(t1, t1win)}
            <div style="width:1px;background:#2d3139;"></div>
            ${teamCol(t2, t2win)}
        </div>
        ${chart ? `<div style="padding:10px 16px 6px;border-top:1px solid #2d3139;background:#171a20;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:6px;">Score progression</div>
            ${chart}
        </div>` : ""}
        ${recap ? `<div style="padding:10px 16px 14px;background:#171a20;border-top:1px solid #1a1c22;">
            <p style="margin:0;font-size:12px;line-height:1.7;color:#8b9099;">${recap}</p>
        </div>` : ""}
    </div>`;
}

function getWeekLabel(weekStr) {
    const w = parseInt(weekStr);
    if (w >= PLAYOFF_START) {
        const labels = {
            [PLAYOFF_START]:   "Playoffs · Round 1",
            [PLAYOFF_START+1]: "Playoffs · Semifinals",
            [PLAYOFF_START+2]: "Playoffs · Championship"
        };
        return labels[w] || `Playoffs · Week ${w}`;
    }
    return `Week ${w}`;
}

async function renderWeek(weekStr, weekMatchups) {
    const label = getWeekLabel(weekStr);
    const ddhkIdx = weekMatchups.findIndex(m => m.teams?.some(t => t.owner === "ddhk"));
    const fi = ddhkIdx >= 0 ? ddhkIdx : 0;
    const ordered = fi > 0
        ? [weekMatchups[fi], ...weekMatchups.filter((_, i) => i !== fi)]
        : weekMatchups;

    const weekStats = await fetchWeekStats(selectedYear, weekStr);

    return `<div style="margin-bottom:32px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2d3139;">${label}</div>
        <div class="mu-grid">${ordered.map(m => renderMatchup(m, weekStr, weekStats)).join("")}</div>
    </div>`;
}

async function renderAll(data) {
    const board = document.getElementById("mu-board");
    if (!board) return;
    const weeks = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));
    if (!weeks.length) {
        board.innerHTML = `<div style="color:#5a6070;padding:40px 0;text-align:center;">No matchup data for this season.</div>`;
        return;
    }
    const toShow = selectedWeek ? [selectedWeek] : weeks;
    // Render a loading placeholder immediately, then fill week by week
    board.innerHTML = `<div style="color:#5a6070;padding:20px 0;">Loading game stats…</div>`;
    const rendered = await Promise.all(toShow.map(w => data[w] ? renderWeek(w, data[w]) : Promise.resolve("")));
    board.innerHTML = rendered.join("");
}

function buildWeekSelect(data) {
    const el = document.getElementById("mu-week-select");
    if (!el) return;
    const weeks = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));
    el.innerHTML = [`<option value="">All Weeks</option>`, ...weeks.map(w => `<option value="${w}">${getWeekLabel(w)}</option>`)].join("");
    el.value = selectedWeek || "";
}

async function loadYear(year) {
    const board = document.getElementById("mu-board");
    if (board) board.innerHTML = `<div style="color:#5a6070;padding:20px 0;">Loading ${year}…</div>`;
    try {
        if (!matchupsCache[year]) {
            matchupsCache[year] = await api.getMatchups(year);
        }
        const data = matchupsCache[year] || {};
        if (!recordsCache[year]) {
            recordsCache[year] = buildRecords(data);
        }
        selectedWeek = null;
        buildWeekSelect(data);
        renderAll(data);
    } catch (err) {
        if (board) board.innerHTML = `<div style="color:#f87171;padding:20px 0;">Error loading matchups: ${err.message}</div>`;
        console.error("matchups load error:", err);
    }
}

async function init() {
    await new Promise(r => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r) : r());

    const container = document.getElementById("matchups-container");
    container.innerHTML = `
    <style>
        #matchups-container { max-width: 1200px; }
        .mu-matchup-grid { display: grid; grid-template-columns: 1fr 1px 1fr; }
        .mu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        @media (max-width: 768px) {
            .mu-grid { grid-template-columns: 1fr; }
            .mu-matchup-grid { grid-template-columns: 1fr !important; }
            .mu-matchup-grid > div[style*="width:1px"] { width: 100% !important; height: 1px !important; }
        }
    </style>
    <div class="filter-bar" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
        <select id="mu-year-select">${YEARS.map(y => `<option value="${y}">${y}</option>`).join("")}</select>
        <select id="mu-week-select"><option value="">All Weeks</option></select>
    </div>
    <div id="mu-board">Loading…</div>`;

    try {
        const leagueUsers = await api.getLeagueUsers();
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.avatar_url; });
    } catch { /* avatars optional */ }

    document.getElementById("mu-year-select").addEventListener("change", e => {
        selectedYear = e.target.value;
        selectedWeek = null;
        loadYear(selectedYear);
    });
    document.getElementById("mu-week-select").addEventListener("change", e => {
        selectedWeek = e.target.value || null;
        renderAll(matchupsCache[selectedYear] || {});  // async, fire and forget
    });

    await loadYear(selectedYear);
}

init();
