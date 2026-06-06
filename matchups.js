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

// ── Recap narrative ───────────────────────────────────────────────────────────

function topPlayer(starters) {
    return starters.reduce((best, s) => s.points > best.points ? s : best, starters[0]);
}
function zeroers(starters) {
    return starters.filter(s => s.points === 0 && s.position !== "K");
}
function marginTag(m) {
    if (m < 5)  return "nail-biter";
    if (m < 15) return "close";
    if (m < 30) return "comfortable";
    if (m < 50) return "decisive";
    return "dominant";
}
function strHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
}
function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }

const CLOSE_OPENERS   = ["It came down to the wire.", "This one wasn't decided until the final whistle.", "A close call that could have gone either way.", "Barely enough to survive."];
const BLOWOUT_OPENERS = ["No drama here.", "A statement win from start to finish.", "This one was over early.", "Dominant performance top to bottom."];
const MID_OPENERS     = ["A solid win with room to spare.", "Enough firepower to get the job done.", "A workmanlike victory.", "Consistent production secured the W."];

function generateRecap(matchup, weekStr) {
    const [a, b] = matchup.teams;
    if (!a || !b || !a.starters?.length || !b.starters?.length) return "";
    const winner = a.points > b.points ? a : b;
    const loser  = a.points > b.points ? b : a;
    const margin = Math.abs(a.points - b.points);
    const tag    = marginTag(margin);
    const seed   = strHash(`${winner.owner}${loser.owner}${weekStr}`);
    const isPlayoff = parseInt(weekStr) >= PLAYOFF_START;

    let opener;
    if (tag === "nail-biter" || tag === "close") opener = pick(CLOSE_OPENERS, seed);
    else if (tag === "dominant" || tag === "decisive") opener = pick(BLOWOUT_OPENERS, seed + 1);
    else opener = pick(MID_OPENERS, seed + 2);

    const winTop  = topPlayer(winner.starters);
    const loseTop = topPlayer(loser.starters);
    const playoffNote = isPlayoff ? " in the playoffs" : "";

    let body = `${winner.owner} defeated ${loser.owner}${playoffNote} by ${margin.toFixed(2)} points (${winner.points.toFixed(2)}–${loser.points.toFixed(2)}). `;
    body += `${winTop.name} led ${winner.owner}'s lineup with ${winTop.points.toFixed(1)} points. `;
    if (loseTop.points >= winTop.points) {
        body += `${loser.owner} actually had the top scorer of the matchup — ${loseTop.name} with ${loseTop.points.toFixed(1)} — but couldn't get enough support elsewhere. `;
    } else {
        body += `${loseTop.name} was ${loser.owner}'s best option at ${loseTop.points.toFixed(1)} points. `;
    }
    const zeros = zeroers(loser.starters);
    if (zeros.length >= 2) body += `${loser.owner} was hurt by ${zeros.length} zero-point performances including ${zeros[0].name} and ${zeros[1].name}. `;
    else if (zeros.length === 1) body += `A zero from ${zeros[0].name} didn't help ${loser.owner}'s cause. `;
    const winZeros = zeroers(winner.starters);
    if (winZeros.length >= 1) body += `${winner.owner} even overcame a scoreless outing from ${winZeros[0].name}. `;
    if (tag === "nail-biter") body += `A couple of extra points from either side could have changed the outcome.`;
    else if (tag === "dominant") body += `The result was never really in doubt.`;

    return `${opener} ${body}`;
}

// ── Matchup card ──────────────────────────────────────────────────────────────

function renderMatchup(matchup, weekStr) {
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

    const recap = generateRecap(matchup, weekStr);

    return `<div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;overflow:hidden;">
        <div class="mu-matchup-grid">
            ${teamCol(t1, t1win)}
            <div style="width:1px;background:#2d3139;"></div>
            ${teamCol(t2, t2win)}
        </div>
        ${recap ? `<div style="padding:12px 16px;border-top:1px solid #2d3139;background:#171a20;">
            <p style="margin:0;font-size:12px;line-height:1.65;color:#8b9099;">${recap}</p>
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
