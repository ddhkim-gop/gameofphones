import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const TYPE_LABELS = {
    trade:      { label: "Trade",      color: "#7c3aed" },
    waiver:     { label: "Waiver",     color: "#b45309" },
    free_agent: { label: "Free Agent", color: "#0369a1" },
};

let allData = [];

function playerTag(p) {
    if (!p || !p.name) return "";
    if (p.position === "PICK") {
        const roundColors = {
            "1": { bg: "#dbeafe", border: "#93c5fd", color: "#1e40af" },
            "2": { bg: "#ffedd5", border: "#fdba74", color: "#9a3412" },
            "3": { bg: "#f3e8ff", border: "#d8b4fe", color: "#6b21a8" },
        };
        const roundNum = p.name.match(/Round (\d)/)?.[1] || "1";
        const c = roundColors[roundNum] || roundColors["1"];
        return `<span class="player-tag" style="background:${c.bg};border-color:${c.border};color:${c.color}">${p.name}</span>`;
    }
    const meta = [p.position, p.team].filter(Boolean).join(" • ");
    return `<span class="player-tag">${p.name}<span class="player-meta">${meta}</span></span>`;
}

function renderTransaction(t) {
    const meta = TYPE_LABELS[t.type] || { label: t.type, color: "#6b7280" };
    const failed = t.status === "failed";

    let body = "";

    if (t.type === "trade") {
        const entries = Object.entries(t.assets_received || {});
        const cols = entries.map(([team, assets]) => `
            <div class="trade-col">
                <div class="trade-team">${team}</div>
                <div class="trade-assets">${(assets || []).map(playerTag).join("")}</div>
            </div>
        `).join('<div class="trade-arrow">⇄</div>');

        body = `<div class="trade-grid">${cols}</div>`;

    } else {
        const added   = (t.added   || []).map(playerTag).join("");
        const dropped = (t.dropped || []).map(playerTag).join("");

        let faabHtml = "";
        if (t.type === "waiver" && t.waiver_bid > 0) {
            faabHtml = `<span class="faab">$${t.waiver_bid} bid</span>`;
        } else if (t.faab > 0) {
            faabHtml = `<span class="faab">$${t.faab} FAAB</span>`;
        }

        const notesHtml = failed && t.notes
            ? `<div class="tx-notes">${t.notes}</div>` : "";

        const failedBidsHtml = (t._failedBids && t._failedBids.length)
            ? `<div class="tx-lost-bids">
                <span class="tx-lost-label">Lost bids:</span>
                ${t._failedBids.map(b => `<span class="tx-lost-bid">${b.teams?.[0] || '?'} $${b.waiver_bid}</span>`).join("")}
               </div>`
            : "";

        body = `
            <div class="waiver-grid">
                <div class="waiver-col">
                    <div class="tx-verb added">Added</div>
                    <div class="waiver-players">${added || '<span class="tx-none">—</span>'}</div>
                    ${faabHtml}
                </div>
                <div class="waiver-col">
                    <div class="tx-verb dropped">Dropped</div>
                    <div class="waiver-players">${dropped || '<span class="tx-none">—</span>'}</div>
                </div>
            </div>
            ${notesHtml}
            ${failedBidsHtml}
        `;
    }

    return `
        <div class="tx-card ${failed ? "tx-failed" : ""}">
            <div class="tx-header">
                <div class="tx-left">
                    <div class="tx-teams">
                        ${(t.teams || []).map(x => `<span class="team-pill">${x}</span>`).join("")}
                    </div>
                    ${t.created ? `<div class="tx-date">${t.created}</div>` : ""}
                </div>
                <span class="tx-badge" style="background:${failed ? "#9ca3af" : meta.color}">
                    ${failed ? "Failed" : meta.label}
                </span>
            </div>
            <div class="tx-body">${body}</div>
        </div>
    `;
}

function attachFailedBids(txs) {
    const failed = txs.filter(t => t.status === "failed" && t.type === "waiver");
    const successful = txs.filter(t => t.status !== "failed");

    const failedByPlayer = {};
    failed.forEach(t => {
        const playerName = t.added?.[0]?.name;
        if (!playerName) return;
        const key = `${t.season}-${t.week}-${playerName}`;
        if (!failedByPlayer[key]) failedByPlayer[key] = [];
        failedByPlayer[key].push(t);
    });

    const matchedFailed = new Set();
    successful.forEach(t => {
        if (t.type !== "waiver") return;
        const playerName = t.added?.[0]?.name;
        if (!playerName) return;
        const key = `${t.season}-${t.week}-${playerName}`;
        const bids = failedByPlayer[key] || [];
        if (bids.length) {
            t._failedBids = bids;
            bids.forEach(b => matchedFailed.add(b.transaction_id));
        }
    });

    const unmatchedFailed = failed.filter(t => !matchedFailed.has(t.transaction_id));
    return [...successful, ...unmatchedFailed];
}

function render() {
    const yearVal = document.getElementById("filterYear").value;
    const typeVal = document.getElementById("filterType").value;

    let filtered = allData;
    if (yearVal !== "all") filtered = filtered.filter(t => t.season === yearVal);
    if (typeVal !== "all") filtered = filtered.filter(t => t.type === typeVal);

    const grouped = {};
    filtered.forEach(t => {
        const key = `${t.season}-${String(t.week).padStart(2,"0")}`;
        if (!grouped[key]) grouped[key] = { season: t.season, week: t.week, txs: [] };
        grouped[key].txs.push(t);
    });

    const board = document.getElementById("tx-board");

    if (!Object.keys(grouped).length) {
        board.innerHTML = `<div class="tx-empty">No transactions found.</div>`;
        return;
    }

    let html = "";
    Object.keys(grouped)
        .sort((a, b) => b.localeCompare(a))
        .forEach(key => {
            const { season, week, txs } = grouped[key];
            const processed = attachFailedBids(txs);
            const completed = processed.filter(t => t.status !== "failed");
            const failed    = processed.filter(t => t.status === "failed");

            html += `<div class="tx-week"><div class="tx-week-label">${season} — ${week === 0 ? "Offseason" : "Week " + week}</div>`;
            completed.forEach(t => { html += renderTransaction(t); });
            failed.forEach(t    => { html += renderTransaction(t); });
            html += `</div>`;
        });

    board.innerHTML = html;
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("transactions-container");

    container.innerHTML = `
    <style>
        #transactions-container { max-width: 800px; margin: 0; }

        .tx-filters {
            display: flex;
            gap: 12px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }
        .tx-filters select {
            padding: 6px 12px;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
            font-size: 13px;
            background: #fff;
            cursor: pointer;
        }

        .tx-week { margin-bottom: 32px; }
        .tx-week-label {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #9ca3af;
            margin-bottom: 10px;
            padding-bottom: 6px;
            border-bottom: 1px solid #e5e7eb;
        }

        .tx-card {
            background: var(--card-bg, #fff);
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.07);
        }
        .tx-card.tx-failed { opacity: 0.4; }

        .tx-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
            gap: 10px;
        }
        .tx-left { display: flex; flex-direction: column; gap: 4px; }
        .tx-teams { display: flex; flex-wrap: wrap; gap: 6px; }
        .tx-date { font-size: 11px; color: #9ca3af; }

        .team-pill {
            background: #f3f4f6;
            color: #374151;
            border-radius: 999px;
            padding: 2px 10px;
            font-size: 12px;
            font-weight: 600;
        }
        .tx-badge {
            color: #fff;
            border-radius: 999px;
            padding: 3px 11px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
            flex-shrink: 0;
        }

        /* Trade layout */
        .trade-grid {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            flex-wrap: wrap;
        }
        .trade-col {
            flex: 1;
            min-width: 140px;
            background: #f9fafb;
            border-radius: 8px;
            padding: 10px 12px;
        }
        .trade-team {
            font-size: 12px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }
        .trade-assets { display: flex; flex-direction: column; gap: 4px; }
        .trade-arrow {
            font-size: 18px;
            color: #d1d5db;
            align-self: center;
            flex-shrink: 0;
        }

        /* Waiver/FA layout */
        .waiver-grid {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }
        .waiver-col {
            flex: 1;
            min-width: 140px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .waiver-players { display: flex; flex-direction: column; gap: 4px; }

        .tx-verb {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            padding: 2px 8px;
            border-radius: 4px;
            width: fit-content;
        }
        .tx-verb.added   { background: #dcfce7; color: #15803d; }
        .tx-verb.dropped { background: #fee2e2; color: #b91c1c; }

        .player-tag {
            display: inline-flex;
            flex-direction: column;
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 4px 8px;
            font-size: 12px;
            font-weight: 600;
            color: #111827;
            line-height: 1.4;
        }
        .player-tag.pick {
            background: #ede9fe;
            border-color: #c4b5fd;
            color: #6d28d9;
        }
        .player-meta {
            font-size: 10px;
            font-weight: 400;
            color: #6b7280;
        }

        .faab {
            background: #fef9c3;
            color: #854d0e;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 700;
            width: fit-content;
        }
        .tx-notes {
            font-size: 11px;
            color: #9ca3af;
            font-style: italic;
            margin-top: 4px;
        }
        .tx-none { color: #d1d5db; font-size: 12px; }
        .tx-empty { color: #9ca3af; padding: 20px 0; text-align: center; }
        .tx-lost-bids { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .tx-lost-label { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .tx-lost-bid { background: #fee2e2; color: #b91c1c; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
    </style>

    <div class="filter-bar">
        <select id="filterYear">
            <option value="all">All Years</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
        </select>
        <select id="filterType">
            <option value="all">All Types</option>
            <option value="trade">Trades</option>
            <option value="waiver">Waivers</option>
            <option value="free_agent">Free Agents</option>
        </select>
    </div>

    <div id="tx-board">Loading...</div>
    `;

    try {
        allData = await api.getTransactions();

        document.getElementById("filterYear").addEventListener("change", render);
        document.getElementById("filterType").addEventListener("change", render);

        render();
    } catch (err) {
        console.error(err);
        document.getElementById("tx-board").innerHTML = "Failed to load transactions.";
    }
}

init();