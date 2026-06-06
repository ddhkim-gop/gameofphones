import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

let standings = null;
let transactions = null;
let history = null;
let leagueUsers = [];
let currentView = "2025";

const FAAB_BUDGET = 100;

function computeFaabRemaining(year) {
    const spent = {};
    const result = {};
    const waivers = (transactions || [])
        .filter(t => t.season === year && t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waivers.forEach(t => {
        const team = (t.teams || [])[0];
        if (!team) return;
        if (spent[team] === undefined) spent[team] = 0;
        spent[team] += (t.waiver_bid || t.faab || 0);
        result[team] = FAAB_BUDGET - spent[team];
    });
    return result;
}

function avatarEl(name, size) {
    const sz = size || 24;
    const u = leagueUsers.find(u => u.username === name);
    const url = u?.avatar_url;
    if (url) {
        return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`;
    }
    return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#252830;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#5a6070;flex-shrink:0;">${(name||"?")[0].toUpperCase()}</span>`;
}

const YEARS = ["2026", "2025", "2024", "2023"];

function buildTxStats(txData) {
    // Only count complete trade/waiver/free_agent — exclude commissioner and failed
    const stats = {};
    (txData || []).forEach(t => {
        if (t.status === "failed") return;
        if (t.type === "commissioner") return;
        const year = t.season;
        if (!stats[year]) stats[year] = {};
        (t.teams || []).forEach(name => {
            if (!stats[year][name]) stats[year][name] = { total: 0, trades: 0, waivers: 0, fa: 0 };
            stats[year][name].total++;
            if (t.type === "trade")       stats[year][name].trades++;
            if (t.type === "waiver")      stats[year][name].waivers++;
            if (t.type === "free_agent")  stats[year][name].fa++;
        });
    });
    return stats;
}

function buildPlayoffRecords(historyData, year) {
    const records = {};
    const season = (historyData || {})[year] || {};
    function processMatch(m) {
        if (!m.winner || !m.loser) return;
        if (!records[m.winner]) records[m.winner] = { wins: 0, losses: 0 };
        if (!records[m.loser])  records[m.loser]  = { wins: 0, losses: 0 };
        records[m.winner].wins++;
        records[m.loser].losses++;
    }
    (season.winners_bracket || []).forEach(processMatch);
    (season.losers_bracket  || []).forEach(processMatch);
    return records;
}

function buildAllTimePlayoffRecords(historyData) {
    const records = {};
    Object.values(historyData || {}).forEach(season => {
        function processMatch(m) {
            if (!m.winner || !m.loser) return;
            if (!records[m.winner]) records[m.winner] = { wins: 0, losses: 0 };
            if (!records[m.loser])  records[m.loser]  = { wins: 0, losses: 0 };
            records[m.winner].wins++;
            records[m.loser].losses++;
        }
        (season.winners_bracket || []).forEach(processMatch);
        (season.losers_bracket  || []).forEach(processMatch);
    });
    return records;
}

function buildAllTime(standingsData, txStats) {
    const combined = {};
    const seasonCounts = {};

    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(row => {
            if (!combined[row.name]) {
                combined[row.name] = {
                    name: row.name, wins: 0, losses: 0, pf: 0, pa: 0,
                    total: 0, trades: 0, waivers: 0, fa: 0, highestPF: 0
                };
                seasonCounts[row.name] = 0;
            }
            const c = combined[row.name];
            c.wins    += row.wins;
            c.losses  += row.losses;
            c.pf      += row.pf;
            c.pa      += row.pa;
            c.highestPF = Math.max(c.highestPF, row.pf);
            seasonCounts[row.name]++;

            const tx = txStats[year]?.[row.name] || {};
            c.total   += tx.total   || 0;
            c.trades  += tx.trades  || 0;
            c.waivers += tx.waivers || 0;
            c.fa      += tx.fa      || 0;
        });
    });

    return Object.values(combined).map(r => ({
        ...r,
        seasons: seasonCounts[r.name] || 1,
        avgPF: r.pf / (seasonCounts[r.name] || 1),
    })).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

function renderTable(rows, txStats, year, playoffRecords, isAllTime) {
    if (!rows || !rows.length) return `<div class="s-empty">No data for this period.</div>`;

    const yearTx = txStats[year] || {};

    const enriched = rows.map((r, i) => {
        const tx = yearTx[r.name] || {};
        return {
            rank:     i + 1,
            name:     r.name,
            wins:     r.wins,
            losses:   r.losses,
            ties:     r.ties || 0,
            pf:       r.pf,
            pa:       r.pa,
            avgPF:    r.avgPF,
            highestPF: r.highestPF,
            seasons:  r.seasons,
            total:    r.total   ?? tx.total   ?? 0,
            trades:   r.trades  ?? tx.trades  ?? 0,
            waivers:  r.waivers ?? tx.waivers ?? 0,
            fa:       r.fa      ?? tx.fa      ?? 0,
            playoff:  playoffRecords[r.name] || null,
        };
    });

    const faabByTeam = (!isAllTime) ? computeFaabRemaining(year) : {};

    const allTimeExtraCols = isAllTime ? `
        <th>Avg PF</th>
        <th>Best PF</th>
        <th>Playoff W-L</th>
        <th>Seasons</th>
    ` : `<th>Playoff W-L</th><th>FAAB Left</th>`;

    let html = `
        <div class="s-table-wrap">
        <table class="s-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th class="left">Team</th>
                    <th>RS W</th>
                    <th>RS L</th>
                    <th>PF</th>
                    <th>PA</th>
                    <th>+/-</th>
                    ${allTimeExtraCols}
                    <th>Transactions</th>
                    <th>Trades</th>
                    <th>Waivers</th>
                    <th>FA</th>
                </tr>
            </thead>
            <tbody>
    `;

    enriched.forEach(r => {
        const diff = (r.pf - r.pa).toFixed(1);
        const diffColor = r.pf > r.pa ? "#3ecf8e" : "#f87171";
        const playoffStr = r.playoff ? `${r.playoff.wins}-${r.playoff.losses}` : "—";
        const faabLeft = faabByTeam[r.name];
        const faabStyle = faabLeft != null && faabLeft < 20 ? "color:#f87171;font-weight:700;" : "";

        const extraCols = isAllTime ? `
            <td class="num">${r.avgPF != null ? r.avgPF.toFixed(1) : "—"}</td>
            <td class="num">${r.highestPF != null ? r.highestPF.toFixed(1) : "—"}</td>
            <td class="num">${playoffStr}</td>
            <td class="num" style="color:#5a6070;">${r.seasons ?? "—"}</td>
        ` : `<td class="num">${playoffStr}</td><td class="num" style="${faabStyle}">${faabLeft != null ? `$${faabLeft}` : "—"}</td>`;

        html += `
            <tr>
                <td class="rank">${r.rank}</td>
                <td class="team-name">
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${avatarEl(r.name, 26)}
                        <span>${r.name}</span>
                    </div>
                </td>
                <td class="num wins">${r.wins}</td>
                <td class="num losses">${r.losses}</td>
                <td class="num">${r.pf.toFixed(1)}</td>
                <td class="num">${r.pa.toFixed(1)}</td>
                <td class="num" style="color:${diffColor};font-weight:700;">${diff > 0 ? "+" : ""}${diff}</td>
                ${extraCols}
                <td class="num">${r.total}</td>
                <td class="num">${r.trades}</td>
                <td class="num">${r.waivers}</td>
                <td class="num">${r.fa}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    return html;
}

function render() {
    const board = document.getElementById("s-board");
    const label = document.getElementById("s-label");

    const txStats = buildTxStats(transactions);

    if (currentView === "all_time") {
        label.textContent = "All Years Standings";
        const rows = buildAllTime(standings, txStats);
        const playoffRecords = buildAllTimePlayoffRecords(history);
        board.innerHTML = renderTable(rows, {}, "all_time", playoffRecords, true);
    } else {
        label.textContent = `${currentView} Season`;
        const rows = standings[currentView] || [];
        const playoffRecords = buildPlayoffRecords(history, currentView);
        board.innerHTML = renderTable(rows, txStats, currentView, playoffRecords, false);
    }
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("standings-container");

    container.innerHTML = `
    <style>
        #standings-container { max-width: 1050px; margin: 0; }

        .s-label {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #f0f1f3;
        }

        .s-table-wrap { overflow-x: auto; }

        .s-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            background: #1e2027;
            border-radius: 12px;
            overflow: hidden;
        }
        .s-table thead th {
            text-align: center;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #5a6070;
            padding: 10px 10px;
            border-bottom: 1px solid #2d3139;
            white-space: nowrap;
            background: #252830;
            font-weight: 700;
        }
        .s-table thead th.left { text-align: left; }

        .s-table tbody tr {
            border-bottom: 1px solid #2d3139;
            transition: background 0.1s;
        }
        .s-table tbody tr:last-child { border-bottom: none; }
        .s-table tbody tr:hover { background: #252830; }

        .s-table td {
            padding: 10px 10px;
            text-align: center;
            vertical-align: middle;
        }

        td.rank {
            font-size: 12px;
            color: #5a6070;
            font-weight: 700;
            width: 32px;
        }
        td.team-name {
            text-align: left;
            font-weight: 700;
            font-size: 14px;
            color: #f0f1f3;
            white-space: nowrap;
        }
        td.wins   { color: #3ecf8e; font-weight: 700; }
        td.losses { color: #f87171; font-weight: 700; }
        td.num    { color: #c9cdd4; }

        .s-empty {
            color: #5a6070;
            padding: 40px 0;
            text-align: center;
        }
    </style>

    <div class="s-controls" id="s-controls"></div>
    <div class="s-label" id="s-label"></div>
    <div id="s-board">Loading...</div>
    `;

    try {
        [standings, transactions, history, leagueUsers] = await Promise.all([
            api.getStandings(),
            api.getTransactions(),
            api.getSeasonHistory(),
            api.getLeagueUsers(),
        ]);

        const controls = document.getElementById("s-controls");
        controls.innerHTML = `
            <div class="filter-bar">
                <select id="s-select">
                    <option value="all_time">All Years</option>
                    <option value="2026">2026</option>
                    <option value="2025" selected>2025</option>
                    <option value="2024">2024</option>
                    <option value="2023">2023</option>
                </select>
            </div>
        `;
        document.getElementById("s-select").addEventListener("change", (e) => {
            currentView = e.target.value;
            render();
        });
        render();

    } catch (err) {
        console.error(err);
        document.getElementById("s-board").innerHTML = "Failed to load standings.";
    }
}

init();
