import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

let data = null;
let currentView = "all_time";

const INACTIVE = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma']);

function getTeams(dataset) {
    const set = new Set();
    Object.keys(dataset).forEach(a => {
        set.add(a);
        Object.keys(dataset[a]).forEach(b => set.add(b));
    });
    return [...set].sort((a, b) => {
        const aInactive = INACTIVE.has(a) ? 1 : 0;
        const bInactive = INACTIVE.has(b) ? 1 : 0;
        if (aInactive !== bInactive) return aInactive - bInactive;
        return a.localeCompare(b);
    });
}

function recordCell(d) {
    if (!d) return `<td class="cell-empty">—</td>`;
    const { wins, losses, ties } = d;
    const total = wins + losses + ties;
    const pct = total > 0 ? wins / total : 0;
    const hue = Math.round(pct * 120); // 0=red, 120=green
    const bg = `hsla(${hue}, 60%, 92%, 1)`;
    const color = `hsl(${hue}, 50%, 30%)`;
    const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    return `<td class="cell-record" style="background:${bg};color:${color}" title="${d.pf} PF / ${d.pa} PA">${record}</td>`;
}

function renderMatrix(dataset) {
    const teams = getTeams(dataset);
    if (!teams.length) return `<div class="h2h-empty">No data for this period.</div>`;

    let html = `<div class="matrix-wrap"><table class="matrix">`;

    // Header row
    html += `<thead><tr><th class="corner"></th>`;
    teams.forEach(t => html += `<th class="col-head"><div>${t}</div></th>`);
    html += `</tr></thead><tbody>`;

    // Data rows
    teams.forEach(a => {
        // Compute overall record for this team
        let w = 0, l = 0, ti = 0, pf = 0;
        teams.forEach(b => {
            if (a === b) return;
            const d = dataset[a]?.[b];
            if (d) { w += d.wins; l += d.losses; ti += d.ties; pf += d.pf; }
        });
        const overall = ti > 0 ? `${w}-${l}-${ti}` : `${w}-${l}`;

        html += `<tr class="${INACTIVE.has(a) ? 'inactive-row' : ''}">`;
        html += `<td class="row-head">
            <div class="row-name">${a}</div>
            <div class="row-record">${overall} • ${pf.toFixed(0)} PF</div>
        </td>`;

        teams.forEach(b => {
            if (a === b) {
                html += `<td class="cell-self">●</td>`;
            } else {
                html += recordCell(dataset[a]?.[b]);
            }
        });

        html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    return html;
}

function render() {
    const board = document.getElementById("h2h-board");
    const label = document.getElementById("view-label");

    let dataset;
    if (currentView === "all_time") {
        dataset = data.all_time || {};
        label.textContent = "All-Time Records";
    } else {
        dataset = data.seasons?.[currentView] || {};
        label.textContent = `${currentView} Season`;
    }

    board.innerHTML = renderMatrix(dataset);
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("h2h-container");

    container.innerHTML = `
    <style>
        #h2h-container { max-width: 100%; overflow-x: auto; }

        .h2h-controls {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .h2h-btn {
            padding: 6px 16px;
            border-radius: 999px;
            border: 1px solid #e5e7eb;
            background: #fff;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            color: #374151;
            transition: all 0.15s;
        }
        .h2h-btn:hover { border-color: #9ca3af; }
        .h2h-btn.active {
            background: #111827;
            color: #fff;
            border-color: #111827;
        }

        .view-label {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #111827;
        }

        .matrix-wrap { overflow-x: auto; }

        .matrix {
            border-collapse: collapse;
            font-size: 12px;
            white-space: nowrap;
        }
        .matrix th, .matrix td {
            padding: 0;
            text-align: center;
        }

        .corner { width: 160px; }

        .col-head {
            height: 100px;
            vertical-align: bottom;
            padding-bottom: 6px;
        }
        .col-head div {
            writing-mode: vertical-rl;
            transform: rotate(180deg);
            font-size: 11px;
            font-weight: 700;
            color: #374151;
            padding: 4px 6px;
        }

        .row-head {
            text-align: left;
            padding: 6px 12px 6px 0;
            min-width: 160px;
        }
        .row-name {
            font-size: 13px;
            font-weight: 700;
            color: #111827;
        }
        .row-record {
            font-size: 11px;
            color: #9ca3af;
            margin-top: 1px;
        }

        .cell-record {
            width: 52px;
            height: 40px;
            font-size: 12px;
            font-weight: 700;
            border-radius: 4px;
            cursor: default;
        }
        .cell-self {
            color: #e5e7eb;
            font-size: 16px;
        }
        .cell-empty { color: #e5e7eb; }

        .matrix tbody tr:hover .row-name { color: #7c3aed; }
        .inactive-row { opacity: 0.45; }
        .col-head.inactive { opacity: 0.45; }
        .inactive-row td, .col-head.inactive { font-style: italic; }

        .h2h-empty {
            color: #9ca3af;
            padding: 40px 0;
            text-align: center;
        }
    </style>

    <div class="h2h-controls" id="h2h-controls"></div>
    <div class="view-label" id="view-label"></div>
    <div id="h2h-board">Loading...</div>
    `;

    try {
        data = await api.getHeadToHead();

        const seasons = Object.keys(data.seasons || {}).sort().reverse();
        const controls = document.getElementById("h2h-controls");
        controls.innerHTML = `
            <div class="filter-bar">
                <select id="h2h-select">
                    <option value="all_time">All-Time</option>
                    <option value="2026">2026</option>
                    <option value="2025">2025</option>
                    <option value="2024">2024</option>
                    <option value="2023">2023</option>
                </select>
            </div>
        `;
        document.getElementById("h2h-select").addEventListener("change", (e) => {
            currentView = e.target.value;
            render();
        });
        render();

    } catch (err) {
        console.error(err);
        document.getElementById("h2h-board").innerHTML = "Failed to load H2H data.";
    }
}

init();