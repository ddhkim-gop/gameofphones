import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#94a3b8" };
const FAAB_BUDGET = 100;

let allData = [];
let usersMap = {};
let faabRemainingMap = {}; // transaction_id → remaining after this bid

function computeFaabRemaining(txData) {
    const spent = {}; // "team-season" → running total
    const result = {};
    // Sleeper transaction_id is a snowflake — higher = later. Sort numerically for chronological order.
    const waiverTxs = txData
        .filter(t => t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waiverTxs.forEach(t => {
        const team = (t.teams || [])[0];
        const year = t.season;
        if (!team || !year) return;
        const key = `${team}-${year}`;
        if (spent[key] === undefined) spent[key] = 0;
        spent[key] += (t.waiver_bid || t.faab || 0);
        result[t.transaction_id] = FAAB_BUDGET - spent[key];
    });
    return result;
}

function fmtPick(name) {
    return (name || "").replace(/Round\s+(\d+)/i, "R$1");
}

function posBadge(pos) {
    const color = POS_COLORS[(pos || "").toUpperCase()] || "#5a6070";
    return `<span class="pos-badge" style="background:${color}">${pos || "?"}</span>`;
}

function avatarEl(name) {
    const url = usersMap[name];
    if (url) {
        return `<img class="tx-avatar" src="${url}" onerror="this.outerHTML='<span class=\\'tx-avatar-init\\'>${(name||"?")[0].toUpperCase()}</span>'">`;
    }
    return `<span class="tx-avatar-init">${(name || "?")[0].toUpperCase()}</span>`;
}

function assetRow(asset) {
    if ((asset.position || "").toUpperCase() === "PICK") {
        return `<div class="tx-asset-row">
            <span class="pick-badge">PICK</span>
            <span class="tx-asset-name">${fmtPick(asset.name)}</span>
        </div>`;
    }
    return `<div class="tx-asset-row">
        ${posBadge(asset.position)}
        ${asset.team ? `<span class="tx-asset-team">${asset.team}</span>` : ""}
        <span class="tx-asset-name">${asset.name || ""}</span>
    </div>`;
}

function renderTrade(t) {
    const entries = Object.entries(t.assets_received || {});
    if (entries.length < 2) return "";

    const cols = entries.map(([team, assets]) => `
        <div class="tx-trade-col">
            <div class="tx-col-header">
                ${avatarEl(team)}
                <span class="tx-col-name">@${team}</span>
                <span class="tx-in-label">→ IN</span>
            </div>
            <div class="tx-assets">${(assets || []).map(assetRow).join("")}</div>
        </div>`
    ).join('<div class="tx-swap">⇄</div>');

    const counts = entries.map(([, a]) => (a || []).length);
    const countBadge = counts.join(" ↔ ");

    return `<div class="tx-card">
        <div class="tx-card-header">
            <span class="tx-meta-date">${t.created || ""}</span>
            <span class="tx-count-badge">${countBadge}</span>
        </div>
        <div class="tx-trade-body">${cols}</div>
    </div>`;
}

function renderWaiverFA(t) {
    const isWaiver = t.type === "waiver";
    const failed   = t.status === "failed";
    const team     = (t.teams || [])[0] || "";
    const faab     = t.waiver_bid || t.faab || 0;

    const failedBidsHtml = (t._failedBids && t._failedBids.length)
        ? `<div class="tx-lost-bids">
            <span class="tx-lost-label">Lost bids:</span>
            ${t._failedBids.map(b => `<span class="tx-lost-bid">${b.teams?.[0] || '?'} $${b.waiver_bid}</span>`).join("")}
           </div>`
        : "";

    const typeLabel = isWaiver ? (failed ? "Failed" : "Waiver") : "Free Agent";
    const typeBg    = failed ? "#3d4350" : isWaiver ? "#292202" : "#0c1a2e";
    const typeColor = failed ? "#8b9099" : isWaiver ? "#fbbf24" : "#60a5fa";

    return `<div class="tx-card ${failed ? "tx-failed" : ""}">
        <div class="tx-card-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                ${avatarEl(team)}
                <span style="font-size:13px;font-weight:700;color:#f0f1f3;">@${team}</span>
                ${t.created ? `<span style="font-size:11px;color:#8b9099;">${t.created}</span>` : ""}
                ${faab > 0 ? (() => {
                    const remaining = faabRemainingMap[t.transaction_id];
                    const remStr = remaining !== undefined ? ` ($${remaining} left)` : "";
                    return `<span style="background:#292202;color:#fbbf24;border-radius:4px;padding:1px 8px;font-size:11px;font-weight:700;">$${faab}${remStr}</span>`;
                })() : ""}
            </div>
            <span style="background:${typeBg};color:${typeColor};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;flex-shrink:0;">${typeLabel}</span>
        </div>
        <div class="tx-waiver-body">
            <div class="tx-waiver-col">
                <div class="tx-verb added">↑ ADD</div>
                <div class="tx-assets">${(t.added || []).map(assetRow).join("") || '<span class="tx-none">—</span>'}</div>
            </div>
            <div class="tx-waiver-col">
                <div class="tx-verb dropped">↓ DROP</div>
                <div class="tx-assets">${(t.dropped || []).map(assetRow).join("") || '<span class="tx-none">—</span>'}</div>
            </div>
        </div>
        ${failedBidsHtml}
        ${t.notes && failed ? `<div class="tx-notes">${t.notes}</div>` : ""}
    </div>`;
}

function renderTransaction(t) {
    return t.type === "trade" ? renderTrade(t) : renderWaiverFA(t);
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

    let filtered = allData.filter(t => t.type !== "commissioner");
    if (yearVal !== "all") filtered = filtered.filter(t => t.season === yearVal);
    if (typeVal !== "all") filtered = filtered.filter(t => t.type === typeVal);

    const grouped = {};
    filtered.forEach(t => {
        const key = `${t.season}-${String(t.week).padStart(2, "0")}`;
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
            const failedTxs = processed.filter(t => t.status === "failed");

            html += `<div class="tx-week"><div class="tx-week-label">${season} — ${week === 0 ? "Offseason" : "Week " + week}</div>`;
            completed.forEach(t => { html += renderTransaction(t); });
            failedTxs.forEach(t => { html += renderTransaction(t); });
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

        .tx-week { margin-bottom: 32px; }
        .tx-week-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #5a6070;
            font-weight: 700;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid #2d3139;
        }

        .tx-card {
            background: #1e2027;
            border: 1px solid #2d3139;
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 8px;
        }
        .tx-card.tx-failed { opacity: 0.35; }

        .tx-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        .tx-meta-date { font-size: 11px; color: #5a6070; }
        .tx-count-badge {
            background: #252830;
            color: #8b9099;
            border-radius: 999px;
            padding: 2px 10px;
            font-size: 11px;
            font-weight: 700;
        }

        /* Trade layout */
        .tx-trade-body {
            display: flex;
            gap: 10px;
            align-items: flex-start;
        }
        .tx-trade-col { flex: 1; min-width: 0; }
        .tx-col-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
        }
        .tx-col-name { font-size: 12px; font-weight: 700; color: #f0f1f3; flex: 1; }
        .tx-in-label {
            font-size: 10px;
            font-weight: 700;
            color: #3ecf8e;
            background: rgba(62,207,142,0.12);
            border-radius: 4px;
            padding: 1px 6px;
        }
        .tx-swap {
            font-size: 16px;
            color: #3d4350;
            flex-shrink: 0;
            align-self: center;
            padding: 0 2px;
        }

        /* Waiver/FA layout */
        .tx-waiver-body {
            display: flex;
            gap: 16px;
        }
        .tx-waiver-col { flex: 1; min-width: 0; }

        /* Asset rows */
        .tx-assets { display: flex; flex-direction: column; gap: 2px; }
        .tx-asset-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 0;
        }
        .tx-asset-name {
            font-size: 12px;
            font-weight: 600;
            color: #f0f1f3;
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .tx-asset-team { font-size: 11px; color: #5a6070; flex-shrink: 0; }

        .pos-badge {
            display: inline-block;
            color: #fff;
            border-radius: 4px;
            padding: 1px 0;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.04em;
            flex-shrink: 0;
            min-width: 36px;
            text-align: center;
        }
        .pick-badge {
            display: inline-block;
            background: #252830;
            color: #a78bfa;
            border-radius: 4px;
            padding: 1px 0;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.04em;
            flex-shrink: 0;
            min-width: 36px;
            text-align: center;
        }

        .tx-verb {
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 2px 8px;
            border-radius: 4px;
            width: fit-content;
            margin-bottom: 6px;
        }
        .tx-verb.added   { background: #064e3b; color: #34d399; }
        .tx-verb.dropped { background: #450a0a; color: #f87171; }

        .tx-avatar {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
        }
        .tx-avatar-init {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: #252830;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            font-weight: 700;
            color: #5a6070;
            flex-shrink: 0;
        }

        .tx-lost-bids { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .tx-lost-label { font-size: 10px; color: #5a6070; font-weight: 700; text-transform: uppercase; }
        .tx-lost-bid { background: #450a0a; color: #f87171; border-radius: 4px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
        .tx-notes { font-size: 11px; color: #5a6070; font-style: italic; margin-top: 6px; }
        .tx-none { color: #3d4350; font-size: 12px; }
        .tx-empty { color: #5a6070; padding: 20px 0; text-align: center; }
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
        const [txData, usersList] = await Promise.all([
            api.getTransactions(),
            api.getLeagueUsers(),
        ]);
        allData = txData;
        (usersList || []).forEach(u => { usersMap[u.username] = u.avatar_url; });
        faabRemainingMap = computeFaabRemaining(allData);

        document.getElementById("filterYear").addEventListener("change", render);
        document.getElementById("filterType").addEventListener("change", render);
        render();
    } catch (err) {
        console.error(err);
        document.getElementById("tx-board").innerHTML = "Failed to load transactions.";
    }
}

init();
