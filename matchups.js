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
let selectedYear = YEARS[0];
let selectedWeek = null;
let _did = 0;

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

function renderMatchup(matchup, weekStr) {
    if (!matchup || !matchup.teams || matchup.teams.length < 2) return "";
    const [t1, t2] = matchup.teams;
    const t1win = t1.points > t2.points;
    const t2win = t2.points > t1.points;

    const teamCol = (team, isWinner) => {
        const rec = recordStr(weekStr, team.owner);
        return `<div style="padding:14px;${isWinner ? '' : ''}">
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

    return `<div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;overflow:hidden;">
        <div class="mu-matchup-grid">
            ${teamCol(t1, t1win)}
            <div style="width:1px;background:#2d3139;"></div>
            ${teamCol(t2, t2win)}
        </div>
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

function renderWeek(weekStr, weekMatchups) {
    const label = getWeekLabel(weekStr);
    const ddhkIdx = weekMatchups.findIndex(m => m.teams?.some(t => t.owner === "ddhk"));
    const fi = ddhkIdx >= 0 ? ddhkIdx : 0;
    const ordered = fi > 0
        ? [weekMatchups[fi], ...weekMatchups.filter((_, i) => i !== fi)]
        : weekMatchups;

    return `<div style="margin-bottom:32px;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2d3139;">${label}</div>
        <div class="mu-grid">${ordered.map(m => renderMatchup(m, weekStr)).join("")}</div>
    </div>`;
}

function renderAll(data) {
    const board = document.getElementById("mu-board");
    if (!board) return;
    const weeks = Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b));
    if (!weeks.length) {
        board.innerHTML = `<div style="color:#5a6070;padding:40px 0;text-align:center;">No matchup data for this season.</div>`;
        return;
    }
    const toShow = selectedWeek ? [selectedWeek] : weeks;
    board.innerHTML = toShow.map(w => data[w] ? renderWeek(w, data[w]) : "").join("");
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
        renderAll(matchupsCache[selectedYear] || {});
    });

    await loadYear(selectedYear);
}

init();
