import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

let standings = null;
let transactions = null;
let currentView = "2025";

const YEARS = ["2026", "2025", "2024", "2023"];

function buildTxStats(txData) {
    // Returns { year: { username: { total, trades, waivers, fa } } }
    const stats = {};
    (txData || []).forEach(t => {
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

function buildAllTime(standingsData, txStats) {
    const combined = {};

    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(row => {
            if (!combined[row.name]) {
                combined[row.name] = { name: row.name, wins: 0, losses: 0, pf: 0, pa: 0, total: 0, trades: 0, waivers: 0, fa: 0 };
            }
            combined[row.name].wins    += row.wins;
            combined[row.name].losses  += row.losses;
            combined[row.name].pf      += row.pf;
            combined[row.name].pa      += row.pa;

            const tx = txStats[year]?.[row.name] || {};
            combined[row.name].total   += tx.total   || 0;
            combined[row.name].trades  += tx.trades  || 0;
            combined[row.name].waivers += tx.waivers || 0;
            combined[row.name].fa      += tx.fa      || 0;
        });
    });

    return Object.values(combined).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

function renderTable(rows, txStats, year) {
    if (!rows || !rows.length) return `<div class="s-empty">No data for this period.</div>`;

    const yearTx = txStats[year] || {};

    // Enrich rows with tx data
    const enriched = rows.map((r, i) => {
        const tx = yearTx[r.name] || {};
        return {
            rank: i + 1,
            name: r.name,
            wins: r.wins,
            losses: r.losses,
            ties: r.ties || 0,
            pf: r.pf,
            pa: r.pa,
            total:   r.total   ?? tx.total   ?? 0,
            trades:  r.trades  ?? tx.trades  ?? 0,
            waivers: r.waivers ?? tx.waivers ?? 0,
            fa:      r.fa      ?? tx.fa      ?? 0,
        };
    });

    const maxPF = Math.max(...enriched.map(r => r.pf));
    const maxTrades = Math.max(...enriched.map(r => r.trades), 1);

    let html = `
        <div class="s-table-wrap">
        <table class="s-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th class="left">Team</th>
                    <th>W</th>
                    <th>L</th>
                    <th>PF</th>
                    <th>PA</th>
                    <th>+/-</th>
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
        const diffColor = r.pf > r.pa ? "#15803d" : "#b91c1c";
        const pfPct = (r.pf / maxPF * 100).toFixed(0);
        const record = r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : "";

        html += `
            <tr>
                <td class="rank">${r.rank}</td>
                <td class="team-name">${r.name}</td>
                <td class="num wins">${r.wins}</td>
                <td class="num losses">${r.losses}</td>
                <td class="num">${r.pf.toFixed(1)}</td>
                <td class="num">${r.pa.toFixed(1)}</td>
                <td class="num" style="color:${diffColor};font-weight:700;">${diff > 0 ? "+" : ""}${diff}</td>
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
        label.textContent = "All-Time Standings";
        const rows = buildAllTime(standings, txStats);
        board.innerHTML = renderTable(rows, {}, "all_time");
    } else {
        label.textContent = `${currentView} Season`;
        const rows = standings[currentView] || [];
        board.innerHTML = renderTable(rows, txStats, currentView);
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
        #standings-container { max-width: 960px; margin: 0; }

        .s-controls {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .s-btn {
            padding: 6px 16px;
            border-radius: 999px;
            border: 1px solid #e5e7eb;
            background: #fff;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            color: #374151;
        }
        .s-btn:hover { border-color: #9ca3af; }
        .s-btn.active { background: #111827; color: #fff; border-color: #111827; }

        .s-label {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #111827;
        }

        .s-table-wrap { overflow-x: auto; }

        .s-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .s-table thead th {
            text-align: center;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #9ca3af;
            padding: 8px 10px;
            border-bottom: 2px solid #e5e7eb;
            white-space: nowrap;
        }
        .s-table thead th.left { text-align: left; }

        .s-table tbody tr {
            border-bottom: 1px solid #f3f4f6;
            transition: background 0.1s;
        }
        .s-table tbody tr:hover { background: #f9fafb; }

        .s-table td {
            padding: 10px 10px;
            text-align: center;
            vertical-align: middle;
        }

        td.rank {
            font-size: 12px;
            color: #9ca3af;
            font-weight: 700;
            width: 32px;
        }
        td.team-name {
            text-align: left;
            font-weight: 700;
            font-size: 14px;
            color: #111827;
            white-space: nowrap;
        }
        td.wins   { color: #15803d; font-weight: 700; }
        td.losses { color: #b91c1c; font-weight: 700; }
        td.num    { color: #374151; }

        td.pf { min-width: 90px; }
        .pf-wrap {
            display: flex;
            flex-direction: column;
            gap: 3px;
            align-items: center;
        }
       
        .s-empty {
            color: #9ca3af;
            padding: 40px 0;
            text-align: center;
        }
    </style>

    <div class="s-controls" id="s-controls"></div>
    <div class="s-label" id="s-label"></div>
    <div id="s-board">Loading...</div>
    `;

    try {
        [standings, transactions] = await Promise.all([
            api.getStandings(),
            api.getTransactions(),
        ]);

        const controls = document.getElementById("s-controls");
        controls.innerHTML = `
            <div class="filter-bar">
                <select id="s-select">
                    <option value="all_time">All-Time</option>
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