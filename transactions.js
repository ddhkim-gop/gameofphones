import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#94a3b8" };
const FAAB_BUDGET = 100;

let allData = [];
let usersMap = {};
let faabRemainingMap = {}; // transaction_id → remaining after this bid
// pickMap["2025-2-ddhk"] = { player, position, team }  (year-round-picked_by)
let pickMap = {};
let selectedUser = "all";

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
    const letter = (name||"?")[0].toUpperCase();
    const fallback = `<span class="tx-avatar-init">${letter}</span>`;
    if (url) {
        return `<img class="tx-avatar" src="${url}" onerror="this.outerHTML='${fallback.replace(/'/g,"&#39;").replace(/"/g,"&quot;")}'">`;
    }
    return fallback;
}

function assetRow(asset, receivedBy, pickConsumers) {
    if ((asset.position || "").toUpperCase() === "PICK") {
        // name format: "2025 Round 2" → year=2025, round=2
        const m = (asset.name || "").match(/(\d{4})\s+Round\s+(\d+)/i);
        let draftedHtml = "";
        if (m && receivedBy) {
            const key = `${m[1]}-${m[2]}-${receivedBy}`;
            const arr = pickMap[key] || [];
            const idx = pickConsumers[key] || 0;
            const dp = arr[idx];
            if (dp) {
                pickConsumers[key] = idx + 1;
                const pickSlot = `R${m[2]}.P${dp.pick_no}`;
                draftedHtml = `
    <div style="margin-top:4px;padding:4px 8px;background:#1a1c22;border-radius:6px;border-left:2px solid #3d4350;">
        <div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Drafted</div>
        <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-size:10px;font-weight:700;color:#8b9099;flex-shrink:0;">${pickSlot}</span>
            ${posBadge(dp.position)}
            <span style="font-size:11px;font-weight:600;color:#c9cdd4;">${dp.player}</span>
        </div>
    </div>`;
            }
        }
        return `<div class="tx-asset-row" style="flex-direction:column;align-items:flex-start;">
    <div style="display:flex;align-items:center;gap:6px;">
        <span class="pick-badge">PICK</span>
        <span class="tx-asset-name">${fmtPick(asset.name)}</span>
    </div>
    ${draftedHtml}
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

    // Per-trade consumption index for pick arrays (supports same manager
    // receiving multiple picks in the same round/year in one deal).
    const pickConsumers = {};

    const cols = entries.map(([team, assets]) => `
        <div class="tx-trade-col">
            <div class="tx-col-header">
                ${avatarEl(team)}
                <span class="tx-col-name">@${team}</span>
                <span class="tx-in-label">→ IN</span>
            </div>
            <div class="tx-assets">${(assets || []).map(a => assetRow(a, team, pickConsumers)).join("")}</div>
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

// ── Custom user dropdown with avatars ─────────────────────────────────────────

const AVATAR_COLORS = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
function accentColor(name) {
    return AVATAR_COLORS[(name||"?").split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];
}

function buildUserDropdown(activeUsers, inactiveUsers) {
    const wrap = document.getElementById("userFilterWrap");
    if (!wrap) return;

    function optionHtml(username) {
        const url = usersMap[username];
        const color = accentColor(username);
        const letter = (username||"?")[0].toUpperCase();
        const sz = 22;
        const avatarHtml = url
            ? `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
            : `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0;">${letter}</span>`;
        return `<div class="tx-ud-option" data-user="${username}" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;border-radius:6px;white-space:nowrap;">${avatarHtml}<span style="font-size:13px;color:#c9cdd4;">${username}</span></div>`;
    }

    const menuHtml = `
        <div class="tx-ud-option" data-user="all" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;border-radius:6px;">
            <span style="font-size:16px;">👥</span><span style="font-size:13px;color:#c9cdd4;">All Users</span>
        </div>
        ${activeUsers.map(u => optionHtml(u)).join("")}
        ${inactiveUsers.length ? `<div style="margin:4px 8px;border-top:1px solid #2d3139;"></div><div style="font-size:10px;color:#5a6070;padding:4px 12px;text-transform:uppercase;letter-spacing:.06em;">Former Members</div>${inactiveUsers.map(u => optionHtml(u)).join("")}` : ""}
    `;

    wrap.innerHTML = `
        <style>
            #txUserFilterBtn { background:#1e2028;border:1.5px solid #2d3139;border-radius:999px;padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;color:#c9cdd4;white-space:nowrap;user-select:none;font-family:inherit; }
            #txUserFilterBtn:hover { border-color:#5a6070; }
            #txUserFilterMenu { position:absolute;top:calc(100% + 4px);left:0;background:#1e2028;border:1px solid #2d3139;border-radius:8px;padding:4px;z-index:100;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.4); }
            .tx-ud-option:hover { background:#252830; }
            .tx-ud-option.selected { background:#252830; }
        </style>
        <div style="position:relative;">
            <button id="txUserFilterBtn"><span style="font-size:16px;">👥</span> All Users <span style="font-size:10px;color:#5a6070;">▼</span></button>
            <div id="txUserFilterMenu" style="display:none;">${menuHtml}</div>
        </div>
    `;

    const btn = document.getElementById("txUserFilterBtn");
    const menu = document.getElementById("txUserFilterMenu");

    btn.addEventListener("click", e => {
        e.stopPropagation();
        menu.style.display = menu.style.display === "none" ? "block" : "none";
    });

    menu.querySelectorAll(".tx-ud-option").forEach(el => {
        el.addEventListener("click", () => {
            selectedUser = el.dataset.user;
            menu.style.display = "none";
            if (selectedUser === "all") {
                btn.innerHTML = '<span style="font-size:16px;">👥</span> All Users <span style="font-size:10px;color:#5a6070;">▼</span>';
            } else {
                const url = usersMap[selectedUser];
                const color = accentColor(selectedUser);
                const letter = (selectedUser||"?")[0].toUpperCase();
                const sz = 22;
                const av = url
                    ? `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;">`
                    : `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;">${letter}</span>`;
                btn.innerHTML = `${av} <span style="font-size:13px;">${selectedUser}</span> <span style="font-size:10px;color:#5a6070;">▼</span>`;
            }
            render();
        });
    });

    document.addEventListener("click", () => { menu.style.display = "none"; }, { capture: true, passive: true });
}

function render() {
    const yearVal = document.getElementById("filterYear").value;
    const typeVal = document.getElementById("filterType").value;
    let filtered = allData.filter(t => t.type !== "commissioner");
    if (yearVal !== "all") filtered = filtered.filter(t => t.season === yearVal);
    if (typeVal !== "all") filtered = filtered.filter(t => t.type === typeVal);
    if (selectedUser !== "all") {
        filtered = filtered.filter(t => {
            if (t.type === "trade") return (t.teams || []).includes(selectedUser);
            return t.team === selectedUser;
        });
    }

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
        <div id="userFilterWrap" style="position:relative;display:inline-block;"></div>
    </div>

    <div id="tx-board">Loading...</div>
    `;

    try {
        const [txData, usersList] = await Promise.all([
            api.getTransactions(),
            api.getLeagueUsers(),
        ]);
        allData = txData;
        const PAUL_YOON_AVATAR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKgAAACoCAYAAAB0S6W0AABwq0lEQVR4nO29CZBl53Ue9v3/Xd7Sr1+v0z0zmA3bYCNIggRJiCAg0RSLtEnKsR2ZZQmkVbbJxEoqZdomEqciuxRWKg5pm6lUKkkRTpVMQnJoSXZZpiPSJLQQEHcCIEWCwGAbDAbT0zO9vH77u8t/U9/5//v69utllp7GzJA5hYuefv3efXc59/xn+c531Pv/3gdwPYpxPyemJ6CQwMsMkGkkqgxAwzcGqU7QDwwyAH7qw09DKBPK5zKvKz9VWseqOo7nw/fgbHAc/cAHP1DtA16GA50S5o1n3ua+7lZkOADgKIDjdkfy//n8uLT9HUbJj0XYnyfcz1cALLi3fkWnGuUYzyQaC1Elkhe9foj5+CyOZf8eE/gRMr8JlQF+UoVvgHIaQSNC7BlkysAzWs431r5clSDry08DH5nSWG2sbjiuUdEZP3/tCs/quhbeCA0NZIkoqOK/+QoVljcvA2JVRVftR+rVYHz+3UAjkZujUEYLBxGp2ptTpamItwK4z2gcR7aueJcp8yM/Hyj87ZNU4kQBmcIiMpwA9LcAPD9Q5e+2siNPAwkM2oBKgMBHkGqEyiDM2iipcwjQFeWV8+W58iHIfEBReX05S14T/n69ynWroFSzBD5SlGEyWrvI3awQngECsaCANj663kGc0+9Cw7sB3bAvN6w2CN/jp/omePojkaodb6n986nslWY1Qexbq2PU3lqYRIu1nUfmzwPmAR5zR0/iDO5fDHD3CaO6X0i9/kupFz3GB8pLy5iKF3A0fQJT6SkEaSJXI9O+nC8fSKpjrNxKobRdXa5TuW4VdFRUpkVZm3o/UlVFmdZHGfQyH83sGFbU3QeWvbkPpn77Qajkvb2kPB/AFwVMuUHbZdndTN7sdK8PmsqZ/1uWWmsF+z4Qm/q8zurzSpkHUhUh9fqLgP6qNvWvGz39pZppLAA1hJoKCvQ9Hx66mMjOwsv68rDSBbAP7fUr17WCcpn20KeviCAz6Kn9OBXcizV1FKUU9M8OpMr/4MDUP9L35h7QBkgTLoHUaIPYg/XdrH9oldP5dMPX8p/rqnQFxdDEO011lpo/VIJUAWlmUI4MNFeDTM8jCx/yUzyUpvtxRj3w+JJ/zxd8RF8yyixEHlDPXsHx/hOYMKdgZB/GugfXsZJe1wpK37KlDiLxq/CVRlMfwqJ/KxreofcEqf4nXhoeD1LMUwUYgogqGKeQGd2DcP3m8UaKWL/VKnFRQfdCqECReyDKBUWyDgwyF8Rwk/XbBnARrSzmHoA39wCPz+jo0cQzv9VPw8fqwTn00yoSz4hFTdBDCBsQXo9yXStoT+3Da/6DWPWPMiA4EKP6iZ5X/2gKzKcBoHlv3U2XJVusE28yN/pzQOiUkT6n/bvbvKZVIFOzl2kvFJXfTeWjFdV9IAvFkjK695wvrZicUECQGrGqUQBEueGlcvIOajyEDA+tebOLPym/+zcCdL+kMrMwbV7GlGogzJg8uDTJXQN+98+4gtqlUyJOJ9rausJfJeWDSFXR0fswUFUJYBr6GFa9u9684h35FSh8VKJlRvOytGlZNbmM82KL8uXCv/EHb7z7Au5v6HOq/IiYriko0vBmpfbDuaXN37OeXlrfT57GMW6p5VPjzpLHYR8CMe25jbfPh1PCzL1KH1v+4B4iOa4RK5+q6nxLT37OHo95NE2qDxv90kKa1eS4GPWPp+fl52aHhedq/XBeCz30X/XPsoIaTE2Oy1M60Dbq9DMjUacyWiLQXLHCRKOhj+DV0jvR8I4y5fKeGLV/0sXsA/YO5vu0y6BVDiD13Dc5pRuqvMfgiMFF/veCDygv1Jxyuv3l0u4AExWraHF//QPF92gNL/Dhe8BgOUN9TqG5SoWO4HvWgotDIZoYWvdCvszui7oYy98wFAY8NogruCDyBzrWeYrJKbw9gYf6mH2oM/2XH41N/+HINwuT6SuYH3wDk+aU5FHt42CvCQPKVPOa+FCZQWCYWwZWG2tXVUmvvgV1OTqbSNZ2WcuYx9ToqypWvWnEqowyrIKeDe440NRHvhhAP6BcmkZkm0CAF774Pe5VF6BstNzrf6M4xXT7lZQT/12rwJeDjSUQ8VWMkLqXGmRZBuUsaxplSE0J8GsY9IBAe8jSEjyjYJitdVZQ9rvhGJwibre0Zvn5jBzvMOFuNvjoDV17CAoPRR4ejVT14clkaYHXk0EVfdSaOYdS1rXX39CCOmVnLhVXX666BU1lHdMIjJYqD30tCo1CS8/hpfDtkr8MjDkwUNVPNL3pT/Lvsc9Eu03U78mVFIW21orfw3sWIJHNS2NR0mowQLJ6Fvsmqth/+ACmp6oolYDGWobz589jsdXGuTBEp6Ph+QECrZHRj6DbqWLninjyMG5wDa6AaJdmkooT7aSnH1rT0w+dqLzj0TC76+FY64XJ9DXcPPgWqslpMQxcyTxaUaauJD9rfrYVlE8rL571CfnvKjq0mKgig49ldQjL+o4DLf/gJ2CM9TElyLEOmslTM1dSQYvLJ4WHRyU1iZQRvX4boeljuhbgyEwVd7/xDdg3oTA3D0xN2pXfGIU4nkM7A574CfCn3+9gtZsi1mVEfKjEj7QRkOFqgSsvZkOazD30qooV78hDgHkvtP58nE0+PK3a0GoSyuPD10UJK1BoDoOj3Ce9WqKuZi2eT+jYDH1Q3tUyWuoIXvPuRSe7GV5SZ1D0npVS9bf7vj8/DC4YBA2DKJd64a+jF3G7/OWopdr2cy6KUrZ4Wkp60P0GJtDHvbcfxp3HfNQzpsr7ODJXxuwsUC4DvUJGh9/ci4HFAfDbX+/iB+f6WE5rSBitx+676ejxezZfHexaCtdgHSNgVxz+Xk6jxcmo+6th1n4sDpoYx4u4If0exrNTkv6iM9JZXruq9fqru8TTepgQfV1Fy5/Dsr4FZ/zb0MluOlCC/wkDfJI5P/veXJnon9qf4rvtaRrEru3GxAh8g9mJMt5+8wHcPA1MA6jEMY7M+pivAlUeUQxJXeXC45xRwEQVePivV/HIYxV89QevYSWpAOkY4BPYskcnoOzh52XOvGxr3SL7t4EK51e88GtQk4/GQfJwS/kLXtJAbAzG0yWEWbfg2/4MKqjOfHhpFREO4bXgLTjn30ZQx3vSzP/tgY958ds9d7GNTfswAuaSGzhLGukr779tEGOAqI/yuI8b90/hzqPAWA+oRQZTocFcrYQxj2gpa9xLI4av2WljbLIGgqf+1n0K1W4N33hhBSeTHlJ/H4wJtgjUroBkVjnLiV1tWDHLrSgNdp4dkZcUHjLKf29bHfqNU75+pJ9M41jyJKrpaacieRHjp1FB8ydQ0iQuQuUXGy2+ZlMdwbI+bn1NfegTQPhJKqSkh4p5PslYO5+IOxD0DuPh9ZzplT925ij7wKCF+ngFtx+oQneBeK2HIBxgsl5G1aN/mgksSTJDG1wGg6kxH+UACPoZtFL4rz40ibVH17ByJkIjG0iQtHdpHL1+Krk/mV+v3MfMU1mKFbfq51r6yK2eh8+O6+4CoXwp1qDRlM9u8EeZfhumqa5XBc006lP75J8afaRegliumZa8ZgvH8GL4dpzz7jjQ0ZNPWURP8fPFX9ylcOkZpknktTx/ua0VHUm/XMjhL/ydFkhHA+yvhfjQG6dxQ8km9quTAfx0BfsPTyJjMK6UVKxGXUkvSxBiAHR6CHQZZVURg/zutx/Fd/7dc/D5eI0GZZuOOxdzgdc3ny933Rd44fppWQ9kh4c605/sqLmPngzfcU9f1Rdunmqjnp1E3yeEz10TQygfS7MardXze6qke6qgfOKYRpJ0heJyXEVLz4KVjbL20VTHuKx/rOEd+lQR9Lt1ILMRwDFc1vcwwuSF99MYR6emMaWBEgMbyYpFqI4FEt4zn8kDkvTnFsfCGyqoIiRQiJF2A9x6GLhh3zQaK66WuUdi5Ng250dFRiF4BRxAjNp8Q9ee0r75jXFz7pF+VkXfM9C6bfOmxA+woPI6ZKH2VkF1gijoCiiXVYo2iMJ5F7rZjShlPi/Ep7uwec1Ll9fHeU/SFPv2hQgCJt95IzPEJkatNuYS87Y0ud0xsjIjVRqx9Bq1MWAtBg7v34fnG6sYFEus15bMt/Xc514M3n2rp7oPx16CcbyMw+kTmFAnUUr7Q+TVXgZSe+6DsmyW6CrW1EGsqjuxrO5A19x0IFD4IhHmVN5rWer1OiYnbfqoVub58GljSonL9fpSuZX1ZI7XAodtnZsfba4Bqgrcfx/wtR/2ofzKLgN5vcPruzNxCXjfqp/MFO4zynw4UuWFcrYif5vIzqCa7j1Kak8VVHpoYh+9bD+WgnfhvL4DA0wfgDJPGaVtlH6hnVyxJXzrGymtIduIgH4zg2oVqKQ2QIhjlhBsSVM2d4xbpTIFS4DQWVBb0uT3ZZHGTA0os2eqUE7d+OWXcGrbfn6rc754a0fvI7BFpQeSzDyVeJP3nNH3LwwwDd98HWWcwnWtoDFqaKljaGS3o4G70cmOvNnLzJe9zCrnBoTRdSAMaGg1U5WJNdQsHqQ7+4AZFFLtOX+QmkycpkaQAaEtgO/uoLLdfXzHXRcid9/48wnqT3W86fdr+E9PqCUEUgF8EaU9xJvuqYJ29AwWgndi0bsLXex/s5fiy0GqJRgasAC054DgC8tOOVRBx+2gAFtjJe0HDCN7KS/aTYQWl1GwS0cxypcIWO9C4dSWX3/Frk0U0g8HQiOdsfMp8OUY+99/Rj3wdKqnUVcNAZtcuwo6zHOyB8j+M1IsAM7gvHc7Gt4dWNXHPoZMfy4HwYplybGN17yYDffdU9mGJjQvyyT1ZK3lRoXPc4fyPqRQxiCi1XHVHCnxXguQoe3E3SPBfuW4WYP5WIdPNdWxj2ttHhl4L8jrY8biTBPBtdrOBSmR7jJL4V+ZPCetQFfSKYnykehjWNHvREPfQUTSx4zSAqLlijhwVtNiG7dQ0gvcsFGLdslVpEupxbvCQC8C1gaQhHtJxdJBury8jPG5KYSZQUnQ7uzJ10g0NyqfdQO4Px8RqmlbkFeRP4GBBn78PDBIKjDEh+50fEO5yKd5t58fFYdzSBzwO181UqU/1/LmYOY+8EgpOYap5BsYZ76UTitdmLgKz/hori7vSkn9Xec5pSfGiCEd6Co6aj9W1e1YVncxz/mxFFY5N+QurxOxkXeIZ05kuP8mhR6jd14x9j91EzTaA8xUK1AZc5wblWNoOQn+dSBsvtbhajgL/PAVoJEFkoa6piWzP7Zyx/qq/rmIvVS+eaSSLSFhSdQ7C5+NjKkFPO/Wgu5qkZXo1Osj8iN0A41V/yBOeQ/iNfVuRObQm710fVm/ZmVDOXXja1yCoyjAyVeX0YiBqAx0PIXYC9DseWi2NCKlEKkAkaay2WDIWhkm59lL5EGnZUSK6KwaKjVguQ18/9Vl9IIaYi9PBxXQ/pckZpef34UIiDv8XEsdevPLwbvxYvAg1ryDNuerLAPKbo9pd4+va2slcrup9mN5mOc88uYgw5fzk7iuZMMS76PTHWC8NoGXzgEhm0BLZaKNpTWl0QWivOUor20LOoDlpgyaydHMIuhTxroesJQC334eaHkloELYnWs8ug5FMynBQoOqfbmhj7w/VsnTXrYiShXoswjYCLhLrITe7QEyQEjNLM5l78JZdX+e5/xyqulM774rUBq4Ctul/v2SJc9LOv8zqJRwrh3h+y+cwZoCuiVgDSW0jIfVXooXXgOaRDKJ8rqIvVBZSaijPtBJgNdawHM94Pe/fRJrjRbQXttccrxk0SPbxZ/fRW07iKDKmCtNMc/0Ie89dYDVQpa0ef9369btWkGFvCqtoY0bBceZmfpTntHztg5//fmdo6ICoFwfQ+RN4Zs/jnFyGViN2e/jIwtDnOsYvHIeaPRdSokWRdKdKbIsldcaETtQgSUf+N/+zUs42wkwObkP1fo4rmtRxV/0fJrVn2KVkKXsLGO79u5ll4ke9hHZJ5f1FWT4Yhjp+YCgCsr1rpwSAFrSh0hXcHIxwzee7qKdAkFNo9Vro5sB59vAqfPAmlPS9R0kCIIEpgqc1MA//lc/wsmmh/H6PLz2AGZlVTikrldJmSclTY+0uYT0teeDNPxiKfERJj5KiW1+3I1cxKfXHXCL57TtqkyZxFnd9aYfY6/6p1lb55Keb5esoNeYL5bBIDEZkmbXwk/DEI2Bj8efXMOfn4rhz0+h4xE2CCy1gVfP2XZh+qV9XUJbV7AS+vjyn7fxP/wfT6JTPowkq2KQ+Oh1I4yPT+B6F1MAPzu34IEY9U83cRPW1C2IUXcMAzaoZiesBUDnrTuX2ZNko2+DySn2DK13WjLXR4fLTwkkOIKTxHP6t32spWc/l2aWUCE/8C2pYy4xz3khueIuxOj+pMs07ztnop494xHKHnGiGvceHcet88AMSUE6CXzTQ702htkDGn/8VAu/962X0Qim0dM1DHTZrTTrjHOMeDeewzVevci2fnmI1meAlPVRxbmPz6bPPXIs+hYmspNIfLIKRsLbyrBRqC+Nj8YqH28LpLnkKF6AOw5gnB8AUy9Ewrf1IZz3juOsf8eBpsVzrjNe/DSJoEDWr34qtfUS+igjWmtjarGP2Rr79oGSJpC3hOZAQ/eAV5sa54NDaPrTI/ss0jr+dFwxU1CwVJXZSvgpA/2lqr+ykBK4rc+gJG06hfe7IHqnVKS/I1DAwcUkQja2F4jS8ebwavAWadPoEQlfBBv/rEiWwWSZMBgHwQEk7EciIW2SIksGKJVKWFpeAnCdB0KXL/Mdb/Kpl7x77mma8sKhJELJRFBEhcH269NtEoTXDqvgRa4nGirzkZm6tAbTcp73b0PDP/SJWFV/9pSzILVaTUq4PlduwvGiCNrTqFSAwWCAn2WJUZ1v6iOfOO/dhiX/uPSfUYeEhv0ig6cLvosJaUaaZPwgDpB966/672BJ82PIwk9ecBcXyKtd8TzmbmX0eF1v/FYbm+B63Z58rNnMEMcJyuUyamwHAYkcJvGzLRpA+ZMddfA9p/XP4Yx3r+gQ9Yk+OP3RC5VCd9QummIh8nIQMQZBHZfvTE3tUxeTzP1pFz/w0WwSea+QxLG0iJBlhBQ43Z5V3p9pyVgOrf82daaFG6XqmOuWDZZ2/vgFzJ8jT5W+ast+5sV1lCL/054h1SGuuOQQtYvdLlY2XIg9zM+OVauYmACSmBXRS/siIR676DfjCp3HJdby1SVsTnSK+SAOPxHEdWmDYSMl8+cXkyO9CEdAC/PH+fCQRKSRqr2HZKmu4f+aF7ZY5G0doqRFq3/RF3r0Jq7fzDQymBwHeo0UFU9hZsKyJrKSWa5NWu6pSywhbjp+ENhMsrSrAAjZrbiSMTJ8sq/q7zkfHAG3vq6t8/LvIDummWRahAbW/GlhmSOELk6rv006miHjx+jFvtp5zILwhloXxabLRFmGf3Q/N31/oX+eUQ/Dc6Hqtm+sTZXlpcHAII0TVIIxpC1gpuRhtqKxv85eI6A0BvQzhYjFeB8gxoSBVIfEzW4aR05I4bmDMIoNIqzK0ce1h+GbWJSTaSluioMfcjT/6MOWH/dO53VBm3ShB+AS87Tu7WSGbmS13+5477hnxtQXboq+gam0f0EoyQXRTPww854NfRgt/+CnoRy5QtGMX8N+qDCPbNVAtunKbEEyZlJAOhdT+EEgPUhRM7bdnCZFEHURRjFqWQUzJeBATXEwF+KW9UE7q+dQVuNI01SYcmkwqr5tZTZJjFQl0L4Pj/lTUTiFbGSZT3PmP/eTO7natNyXIzRo/Syc7/uHPuEl7YepU3aJ37n7dEcFFe44GR5F/k5zQCgQhfjd9QDkHJpXsvpxhcqjuc9p+9EtecKQACIX5uQEEmZR4DYUJB+9vSxKK0yVEvhJF0mUiGJSST3Pk61e6WM8bmJKT2FuzMehaWAQGahYC0fTm4/WcKa5ipLJYBKD1KTiZ3qE6wU+jA7RUx4GsozTQnq2fbnw8KdgRsBmBTZRjo+g/y9OdusiXOLnc4pM5CuH+WhgzGfDVC9Qt+Q+7XDPd1TQnDuJzMau1s5hU5a+z/0ccqVfY5J3IxatDZH/RYY8sn1oQcNbMtxhuc4hwcumi5vGIsxN+9i37yAmJiq44QaLC6WFrGlgNgYOlkjPCPQ7AyF40H6A5UYPv3T/PH7xffNoiUsAxAnw/AkS3CZYOn8eS80VnG6RcaUsBRFuA1WSnwQ/YzQQ2sqlusaFbtaQtZmS6fmBqn2ioY88XFZ9xKqDgNP0LocftKGPYmXfB3E2uO1A0589I6NSaDmFNtEOwbpQrf1CaYRNPugVBZgU82zuJ3O6AS1VhqTPRLrBeDmEn3SQtlZw1437UdURbjs6i3uPA/sJt2NfEQ2ro7eRsaACNQRCIpuMrSJxsI3Ssfi7ke8hyoi0t5jQXMbGrFtLhWWvE32zl88Dz5xMcfJ8G88utNBVNfRUBRER+kLJzFSNKvBQ5QHAkGxps6jR67+15dtbOGShKdD523YF7qKerBzcn/xkYfrcH2Aye/nyLCinaXBgQVMf+7S1nC4adu0MvEHD0S3XmuR+5zAKtz+DUCGN+tKdOVkLEa2tojbo4Mb9k7jlTbMC/LjjMDA3BrQWgPmQwxWtF0CXVMi+CnuktVUOepYx3NGZIHZoOQL0Zb5mlql1RVlj2TiFnxqUMypgCbPzwNuPeojDCbx4bgIvnAGefr6Ll84sYrk7gCrVMMh8tCLO7ByHCSrIqKTZtW9V8yXczUtxUkVTV79Y1t0Hx3R1R24Bkn/YHW2z8yDVpKl5SCCeDjjCCyI4RreEbiSpukYkv3kbhiwY8QEDP0UYeJgJU7zxDQcwV4YQet1xBKgqyJQ6vw1Ux2z/Ok/VUecPpagXOTBbumzJw0neOnLQO+uXp7mM++n7nvigSnm2KMWH3VniY3PAu+eAwd1VtLIj+Lff6OM7L5zDc6+eQaU8jUaq0OdJhdVr0zAURBoGXUu2sBFaH1T80iDFA5zUojM8ttM+hhaUg1kpTGlwCkRPzQvWkwRfduqG44R3IJL15fMqKOZFQvbkqSXjl1g05icT3DA7ielaBfUQGI8GeNth4OgEMEXC4yaETjEou7lMvT50hTilbaSgIPmDmr/kcQpzlsGTB3kdxVMpV+AHnrQj+aQzdFdwOHFGUp0ZPJnZqfDrD5bxtx88gmd7R/DvHlvFd19cwqlOGx1MI/XHkdEKFwfeFp4c+2BcI4ZjyAFg89LUqVhV/0lDH3mMPmglOy8wvZzMNx+Po375f/wVAR9zECuFo0la+iBO+g9iSd99oIu5M3TiN+A7Bd2UD8i62PzalZOd/Fq6OLy5tEw+u05bZ1AfC1Gu1TEzUUYpizAbpjhQTvDO28dxdAwou3PJ8xGybBdOR+gTt4PcuCismB2SfYjyJSinfWgTSQaAfu/hGyxfai75x/LUqKsNyr9SprVcjoEKzFBiEcAffh/4g+++hLODKk63PaThlIzrLionCSVYoh5i2jYebuEAsl3F+GobJ5bg5Hw6ikwZyV1Bl7sVOp2sj1p27p7Z9MdPH0s4Y/SMGEc5flknOOZHqhSW7cL+gRekhlXvRk6E+PTwiIfgicKJDJd2c1WUc0MGQbiOAPK1auYZ0xhZ3Mbx+QlUSwp+mR1tfdRUhAMh8BfurmM2AMa4tG7JTOd+uiArH8ky+nDYEQuC97K/F4C7tMLpoI96NcDE5DQC70JXynI1kfQhXyIr7hMy9ECHknD6G28F7r3zJnzlSeDPfryIE8sLWO2FCCfnZYpIfnXspLyrZ0E3uX6FgEmWfZSxkh35FQ/dpw8nT0pMI4B4fkpWIwNfkN1Z4uatW1IrelEG/gFyl29ywre0Xq/fRdgp6k9ppTpNTFY97JuuYaJSxjR7t0wCw6U+6eLGuQm84w4PFQ3UShzDcWWPb5TI9sD+WZRo1d0afumPs7ZLIu+IiVBFgJJWmKkAx+4H/urb5vE7X1nGV350Fst9BePPIHG04le3KHrRSM6PmtT/bJDqBWZElI4ciMzyVmk7Wo94TwZTZcl7cotR/iCudRmpZpGM68j8JG6YqWF+XGGawzS6LXhJD3VvgAM14IMPejKVo+YDvdYlPFoXi18UBc1g8iVJ4gL+fnnUCrrQlqxVhqpOUGHLCYAbAdweAv/oQzP4px+/C/fORtgXn0Y9XUVougKV3GTxr72Ifz5WZeZFRe+ImFu3ORrql3/zo3ZQaRbKOGvOW+dI66Y/fTZWtXkIuHSH3V/lSFKVgKzFCWkJbpjxRQk5wTg0AwRZhGpFS59QTcf4xfsOYLoMlFw/N1MY/Kl30MfcZ8vcnR597+gNL/kKEccRA5ib1FICvRR2jKyQc9EMEqigMpbQfrNlJHWBlwrRBzc7dqkD4Es/An7nj57DK1ENK3EFXmUa3b7dZ7XiYTAysCM/r1zMJd7g7eCc2650G77OnluA9mI9Wdk/Hz+PI/GTqBvOaeL50Yq60EBymhkb4Y7KvPVYlW3V6BpGz4gT3k0xPwvccaOPuUmXWZL0l61ZD3ptjHkpfuHeA5hj9Se1ZLS+C4qu9ANml/gMnqelqrRryZiAtcGOkOGKujtHQegbbZ6W/aEMvz78BuB//vhtOB4uY143kLRXUCl7opxdkktda8JxjSjPN/Sh96zpo7KK55NS+FBqopo52Zb9IuU0kRxgkOpfG9akLxLzdzWES/ptN3i4cQaoZEBnxYYEpBWPVWDpt1ODW47MS528TOU0Mcq0riYV3BBlO5zp5YAy8mieysmgDZdP3AEbhZMDnsEOOf0VejIvhROSa2BlLynErlTUMQD3lIHf/2/eiL/9riM4PFWWAHgrivIrIZeLz7UnyLQlHzifs1r/CXVPdNBEopPUTWJr7GLidq4yfUCb8KFrtTpBpZR2gSyRNMWknkbaGCCFh8lxHwQOhd76IKu5mo+jM5xtBEwwvxnbPJxNj23vV8oQF6H2theGVtH+vDDImIl4Kujun1/tfA0hHS8cG+OFPHswfKdkYGi0GclzVX/ofh9RycfvfauJ0yt9TNRm0M/SYWQveVsZoXOVbja/VgAjmoWK4yrDAcAsSP+8TqQA4vNG0fBHno+u5EPDD0qeiivLEDO50zK/hxF8fuHY/+MDAZfs1TXM1UMcnalirl5FxJ6gksZAk5eUaCJX4Yz7iJqv4ud+/jj2h0CFUzpkoi+tz7pykqZm67OyCkG6bzmEbc6THPZFSRMlETv1NnEKoy/hannFIfGKiJcx0XQeTe7L5inFYpVZFzCsvE6ep2RP//Be4L6jdfwvv7uGH5w5ifLUIaRBybXwEAI36sTt7rHa1opu04/mJzYW0MB8qvQHu75+JMynNGvrwnBoK1YcQ0hf1z6Sz3K86pI3qBkD0+0hbjUwPxFisgJUVB86HcA3A0Ej8YAl2U7Qb5rK6zdM13B4xkbsVBQ7EE5JGuZCS5KwIBeuAa3MVtuoJGkmYBBuEUnFdnUB9HAStPtNlK44m26IwirkP+kaeFmKqrG+6ZsmgU997DDe95ZDMM0FdFaXkUQDW9xx5dirLqzcqdpHln2LuGdxiOLTvPbVHM6qd+K8vvtAR809IFw7+eO5AWyxVbplu0lnV+7AyeZRCw0qmcHRmQkENO9+gC67A70MqQP60mcMQ4Wk05fl//Y7Dwo0jqt5UdnsUVsAx4X8zEu1J+zsZC9S4vsCr6M2FWtt2WXsX18CHn79Qzbe5yFMBsDttKZ/tYTEO4THn1tGO+4glou7y0juAmi2nUQmBvp2ZavGQB9zD5zy7z8wqSYXbo7+BOOmy3sXCrHqcnADlsO5D/YJkilikK+2JU0GYBfvwakx3HTDNGbrCrVqIIgzS5EaIJGhYHbJYpkz0Bmmxio4PG+tTR4kjBq8vYCaSQ6UUL6Ey/3I9+1iv3oXjz7rEWyAvhnAJ/6yj79y/zxmy13EnfN2At5OzAl7Kc4A0tfkUI124GMl2P/BNX1AphF6JCTLsrJMwu2U+khL7QfToAtFdtyhb2Xxn8Ntjw5yyz+lESbHAqlnz44BB6aBpB8jjXOMJJXUQ6w5osBKkhiUaBqjDibGpIgkMLk8bJbCWWG7oBTZ0LYwt0yF5JsUPMg5rz0kmUGr1Qchp3kqiNueq4Km35p/C50DBkUW0cbjOAzgb94P3D7VxXw1QohY3l4qKWTdy5jWcYnNgBt5ECwBMrwIUamPqNQmYudB6L5w/TOtpmOvOE8zeW/eQShjUui8Xi0LmtmBWeGgiXtuq6HOEYJrxFpqu6TTv6OfqC2jXM7NqWjB0oEERVzahwvBHqZahofsZifJ/CQnrVYbzU5PRh4mVyE7Z+yRyXfSks4AuAPA//hrx3HTWAth2pOHut/s2zaB11UIfHcoJyqqFmjMe4vdqzr2uwKwLcfhe7xBeZ5TiIPUR8CfTOZfrYH2WYZaycfthyZRMUC7xey6Qsy+HRYWkICT1mkZeOOpnNLm4WvE/R6qzDVdvTHnQ+n3+2g2m1hba6EfW2v2+iipEvspKwwY0RNQGaEfrci/7wbwm3/zzTgy64gUCCvssBb1+op0Y5kQQazdJhyj72EaUamunYIj0aHRN3FsSLGZfn0gwB7LSOOUNjFKWQ9zNY25Ka7WPZRLHjrdZKTf3aHT8pWYr3vkgzfwJRl6dYXWfpAC3UEmE0FWW120IluWzG3E6Ap5ySMR1MjvwwBi4x9sNtVgKqyjhBQ1ZLhtDPg7f3EMte5plNm9WqOyvr5LpsA23YmSjtFLy+RuuklWSuZBy3EIz/cZdX4kktF+FpTMuTjyuU0GdOSF3Z7PSBcjl2bV7eJIXeHWfQpRjy04vswo0hVfWnZtXlAhNTY7KTm9PG0qDP6cR+QhYe6ThZgriCWwzS7rsu1jwPZgOimlcXF2eXzspe+YCKHvo1rVqIYQ0Ece3WdbRe9mZ1zSaH5W3J4cEsmAcXi4VE/i1OgL+7K4cLn/pXmg8f4jePQ7K3h1oDFg75Mmk+G2Dfa7kmJgSheSriSNSyxJXo0gCpFl1Y/EqD0SoQ7/vL4TDX2I7CHH84hK0POi2nnNF6+bZEmKQzPjODapUFEZOnGCai1AozHAWK0E0y2ge/KRgoWS2yAmgIQcnbF9yK5imk/AYix+5A1jksgHIpOhmxJYwoLCACUvg+8Hrn5v02UUReoteQK2d7MGUbohTmBD4DClRtCMe4Lyl4rpKt/V7z96L/DDkxpnnj0HrzIniiz9+Q5wvJfCY5fr49qJ5B6ifryJW5CpMvwfVj/ARP2bu4qtW+4khh14rwNWpHAxWcaslxmte6iWABOnKJWsck5OltDurGubTZIzIW1rL/RB+QqROxUdYLW9hti9di2JwIhl/SaoGqiUSmgnGdJegiSJEYaue8FJGvGJk8KrE73By6Sfbmv2VpIkGn5eZylm67UNfw9DBnG23YT7ZBaUodHffO8kFpZbeKoVEbwxNOsSaO/RtRDL6RZtGD6tdip0R0/Pn8H9by6Z/tN+w7uJy9Hb7CeKPqcDMO51kCRXnv2QKUqmj8mwLC28zGdKPjHNxHJSObW25sC4DrbcByXImidGkMggjlCuhmh3DBzq7dqQLa5jYjSa/Xy0dwAVBujnypVb0dAm0nO+jKLwLT3JtNjR4CIerZ+rsZsUjXaPT/rwMyTWDcMApZKW7gNeyroG3jEBvPdNh/HiEwvoZvV1v2kPu0blQcp9pDyNqY00e8Rq+m3w8LQfJJJiulXeIw1xtuLriRLYGZQbG3Su9FEK5S4qOsLcRIhj8z4mWP2h78iuR/BC0620rBtFahhaEPpYOvPEWsr19MjYoTBIFH78fIajxxVqZVZ4yOGZomTXzPXTGQV/XOLzWHwGxOiMmBtbEd+mZWUUBVRYUnPX3JeVJVsHi+RQtML3FJvmhoueXCtPiIcLWS/0YoNePBDwKH3b8UoZXuDBD4GH7gO+8nSCVquBfjiJlLQB0nO9R4BgWaUdeIIWNH8tiGhwbuWu7cqf4b7ipWZuihH9aFR/xUVWaQXPpBjTGabLyion4yBOatOkidn+4/SVfZNIIoW+qPhVfoABnbBSBWeXVuWs2m07I7NcsW2+eyV7YbDVsEPTbYUYfXgqI4ny4kNgOZ38LbcYHtr9GL1ejAFz9Bnwdz50GPvVKvwogSJ7+Z76SA5OqEZGJorOmftombRQrmj/eErLozh9gjg8KokryO+1E+e6Dyu+wYGpAH5i4KeDIZpoqwh8uJwpC7uzc9eteCEDhwR+aUwU9LUFdlPmn9u63Hkl+Ee3Pb1hEcrmUxh85tuGQG+Lzc/JUCwF2obj2VCRGZZC+U7aWo4M53VlYSMHb2/eOKWMpeJ2wuG4MeIO8I4bgHfdOI5pf4CsXQT57ZHI0s5wvu8gdD50HCLoV4+Xe1VmSfUBy1jnkNrOYm41//xKi3yTSVD1gMlyCeMhXYsUoWPiEMT8Tt+f5aOvbcks76QUyFlYxiAJ8OMXz6KvgaAKdHr2huVTmmVS8wXOL69AjW6XI5s+xnZmjG5WwbZE+2dbz6Pf8YHKhCd7y438Tyx8sFQsljbK0F4C7r15FqXBeYxXbKl0z0T4FngDZQjc0Ipy1SBBspfiAPMgd9rlwSonx0PLzHOWQIcO7MXXWi9FeEM8k2Ay8HHXzaHlONIBfBVIjkwOdMQvlB5rx5UpfeM6FCwoxc9SASSXU4W41YP2xvG9Ew281gHWIqBvlAWOMJgi2ITXRabJZcNtw/VzFijlSK8RBdhOcbdPtFsbV6zdb+ArHREGiIa+p7PAw326UYtSOXNZivWN10QNN+uvq53RRK5ULA+4Yo4WuPtO4Oa5ErLGq1Kr3zthuzt73jhkirxf4vCKKrIE3w8wv36F5N64hcKNABxC7vbq8DIjfJkHpgj5d31CchzOO97i/hWb1CzBrlVUy+phhPeo5Cl5X5wFiCtz+L0/XkKTbkvFRvrc7M4uxoJeHA709ZSsUOHbZEVHHpALHWleLbRECwblChD3gLffeQCzFes+7a3kFtQOOMuPiR5mqvE2vvI+vC6y2aZQocqBkaY3plVsQERrldnlt0CjKGwhjvGjSOttUzRayMCscht4zJ84btBG5mOhl+HxZ4CuzxGF9qbRFQiMHZldXByKwKUr4d5caAm+RDDQFZdi/M9VicUD2rE33AQcmCgLcOhqylUm7jGoVz1MVG3zIlslUmXpC8W3HO3XHSqhFTGyo22svNHkNtIuGChXMaiO4Sdnm/jms0CP2EOX22P+kI9JbhXNyHYtiNnjY8rZ+XJ3I0mBWgUYy4DbDs0OLWjGEvPrL7fyqA5cyid2P9eoMIAg6eHGG6rCvMGSHNkkUvThlZSUAqmklNx65lzuvmaS2TIdF60of3KIln3NLfsBa/I+VmKNbz17Fo//OdAixYoDZifC9blu2anc3Ib/HjbLbVza15f77f1RefsFTeR6DH4x9sKMKOwFv3+LQ8g3WZkcrNK+j0gwCDv0/grwzrvLiLotZHEk+erxcfV6uzoHeEWO4vWUfPx0lmGiNiYAGmmeUj2orC+15LVOG+UJCIZydFkcsiBTKSXMX1cuIsOLXZaKFldb7FCkfXS9Gr7/4nk89r0ETPtFRWKGzGzcRntErpJke6wQeehmmZy0tZQRMK6AG2eBmYkaggrZJwK0Wq/7NTmqX18iU5ouAlOtVsxMhahXHZOZisBZdlJ3LqSBpLFRrKZrFvNyi2rhdgIQFt53Zsw8eNobKqqnyPDOXtUujKcQeRW0UMePT3fxxa/2sEYQsaSyNl6G0d9/mkVnW9T40xTeIEVVA/fcvQ9xzLI3H9ocQDT62T2T4/y243v5DcN8Zj5VTNaeGJ7pYIYEsax0ppmgmAj7yFKDeq2GftOg4o2wfxRCeFaZaCGLYlNQQrPFngA7tkUsrd0B02cDHaLrVbHQU/jCfziHl1aBltLoeT4GkmIj+ihPAW1W1L32TSU1XojUsouN1HJc7Dq84ZKKDTkTnYzJJllZGkkV8u6bSIrRkzbmgDfEiUAAZfXaW8ADuyouSS51upu0ArvCspyKr6DSPqpqGXccrqHUAip+BTFzP5x+4VnqxH1hIAUGQSQJGKQIGLObpda2T7WRhLQFP5DCj1uWsaRH3D1vO8u2zDUpDIzBUmLQzgL8wfdXpJX5rptrOLbfDkbwIrYaWLCE7xkEnrXSFB4H86K52BrPutheyq1/t3XynS+gHOKGe6I2FAZybia7F05sY77T1ZAcaCbn5ZSZEZLHLXx+9Ovld1eVsUcwXPjZs377FLAvW8Y57zD6VyGgZ5z8ukwrtj3rBinnApkepsp2AAGxG91mD9NTFay1bclSMARZIr1HJvMkKW1vLr0kqxKSWhLElbV1MZXVMRzIPlyPklGBTa/JXbI7Sn1ipzykqY8zA2B5KcHJ5Sb2T4T4wINlYSDh4C3TAqqBL4FEvrLRouVu9PDELtKKUIm2AzjnikNgR45kMsNgZ11JLXRyHQdJZbTXxe6Z78uDH0eNsvNBFXHJeQ5aXufoIWA8A45OhVhp9QFV2XxP97baOH8pxGuXLEWOI1EmuQEagfIwOzEpjW9R34hyLq90MV6rokOqC1aJHGqe+U3peSchF5dvmaZBS0mgbiZEDanjz2T/FBVIuN9z/nwHxkoLNzpzsD26AaSI0Ukg9NONpQjPfP4sbjt6AHfdWsLt8+SpAspbWI5hkSYnmR/KRrdgk5+2ZTlyY8Q9VHflOk+3KWGKnVM5YNlO1BPQDIkbMJDVI1YV+2xeihJZsIZttFPAzQdn8b2nV4i2weste6qgOeRGrrH7HxXOVx7q1Yo08gWBRquViHJGMQdduTRRMY1l1pc0YYN2VSgBocl4wOIS5b461xumkvLKmGsOGDZUa8thRMX1sgo6aYjZuTpeaEZ45vFlzJUM3nSghiNTFezbZ5WIg2KL5ycWr2AXiwYrryCPXpKdpN3c+Max2ubzku8VHKxGSTbSTWYg9IN8VLbV2PrRl+whFvPMZHVWwKEZH17cYX+QjMNZf6tN7l+/Ckpxx8+nWPpPsgy9dhPz0wfER2J0bjyNmCgmjx2bNr/Hy0sqbD8jtYDlUsqXd/7UgW2RXWt14JWqdBbFItPyktGDYOV2BDR6AyHTSpnwFF236Rqpr2fsb6yIxko7OYDzHdJBJAhUCWf7MZ5bW4OPVWj3tJTCEmrjNczMlDFJ5YktXjOXYpqLx8KVUVoanLRaQKfdRbvTFu2Nk8SO8ZaZoAzqrL9rAzvjPjXsKsPszCympsexfz9wcBK46wAwnQLTmcK4UfDjGGP1OkyJ2E/A0J/mZwsuQuG27OgB8H5x6slbjwPjX42gEGFAqJ4LIhmQ7nX563WxoEO3RuB/BpPVmjSL8cv73RiT4xY13mwOZHalLO6M0ulXego+FclYateNtXiN6tQ4Vts2e8UBroM+sNoHllc76NEil0vO1fCHgwxEQQWIsT5ryIZdVFi+FroAhMMTCPkieSr/S4UyXPVT+Kt9oVojOa7QqOenLHfc/h5lGlFWkQfBXgAGbjYIUWpiqCYkkVUl55ps0BjjdrquqOc5iWStj+ylDKWkhxnVwF37y7jvlhncdqCEubFQChEEaPNwuShbCMalCy1xVXtgr+fMWIB+OpDCpyEB2+ske29BRwA1ymSYmhyXgQLCdFwP0FyzRPH1egWdfmK5lGT5tJpjbxp9LfqgbA+xThuf5MWW0GTK1LZTC8BioyOgUO2PCfsy85xpkiIlxQgKgYDjcZebLwOORgIGN8A1M3mig2xrDqNqMkT91A4s8KrQjozMftYpqGPQ8/J9y+5JKlFowtIuu+Do8GwWLse65tG0Y+Jz++N3K5f7TbIEq1EJ3361h6fPnkVJJbjn1kN4510lmfmkGpBxN5ebCWK6qaqsgu6frODMuQh6t1xOl6Ggi3sayee9C+5is+d9slqyFIFiQRNUqtb57vaIrrYWI0fy8+N0Awi+5VKfGgsJ5LJJ4Ec3YxQOtLsGA75YGpPypayYLBUJVjQ/1XyPI5LTMRb7LYZ/ywMYizKhXvu+ghdouVnd5jZRrLxGYDL9WzNMU22E9I22cBcdWFffHbIpWyXlysIHjm4B4gG88SkkWYaWsJSlWHpuDU++FOH+Ow7il39Box0DNRn5st5mVNz98HC2WeoZT9KZmhqvwqM1eH1lcW8taB6RuAZ7XpCSjjBRspAunnnA+T60LYw8CRaRgIj+TY5W8kjBJ60djNpTNpeNAc0UeG0NOHGa/Sv2NGiPhK2RF9/l2TNR9A2JxJFjzM3LNu+RO1n4lTA+6sZ2MMkN1opLupHAIh8ts6npqaiUm5REbbKk4qKI1nArY5BjBbhfFhu0h7Mmxn/4cQNPn8zwt35hBm+9AZihb97NkHEUpFrfNfn8heVvm+7yZjdD0yjsn5uA/1JriBuWdBfThkOm0r2RvVfQ4RNqJwyXlBHCApZ31980IrLsFmvqtuaZESASBOJjvtq0Cpoo8rYXPrqlJSg489uOudhmHdwUpW6DmdvhNctkvM17Lzb9o1yr9UiXZf5wrn8X2xJCFo1xqtXCv/mj8zh/+z687y0WvSWXXXLS7nAc00OxsW5dXCXOB+pkHBe+BPswCCueIOL3NA96god1Aq+HuKoSpVIFKhWboslBH9IiQ/8yf41EtPn6wzymV0bil9DoA6+dNzh7PkaH6/tFfO8GpbjaAMzXURJdwqst4F//yZ/j974PtOo25Raw88BtF6qnM2b1PWB6ihkQa8XX87R739dNBX0Fr7NUnAWVp3a4lG+MXq2S2sS6IOc9u51eibCw3ESnNxCy2t3LTy8wJFU+WqqGZPoW/P63X8GfPgt0pcWjENRdhPA+1esOWbXnXXQb5BWuDwuv5zdS6Wg9hWLJEQwM/8YrYXLCa/Eo0U8TrHWB0pSP04vAycU2Bl6IjMvYYOdBCHaf9mduKYZRshN7o7YqQObWIX//hb9ru/O1X7zLO5tZv2+4zF+EkPeVpWUSmPnlQ/idx05jOjiE+28Bso4GZ4T47gLlrrhkTyQmsEsMg82MfFksSOgC+CbPgDkm5z3C0Czw6J7HXsno0ppL7qQ7Bd2w5RfBbZSxcR9LTeDZl1cw0GWhZtmp4Wzv5FqiKrk4Ef5UDfSUJ1DD3//Tl/D8KtBjJqIc2GT7DmyGtrDhYI9bO6p7Kq/7NzKHKSfryoSe22R4KDGcUn+31pRPJ6N8po1eWehjpZsKuT4hcXtdYvupELXxJx/uF9ol/NbXzmKNaTqHuS2KIKIEs7AOkM5nWVwF+Yr2DL67gUnZ9ZjLtluLUawkFU5w2GpQfOtwuTfypGacVuxI9pl+O73cgletwbCDc/gpl8PK69Nu5stPeeyzhThEDB9qaXnJoVeFt0iLMnGv43hhxeD//U6Msz2bFzWGyDH6/dsHjnuloNIAKewi3BwIvbiVUiwSsTMMyIhS1YRWWZT7lVzWhELAoZGEs911a0oO2nV1jo/7Yjl5cI12hFUP+NE5oJF4GKTMujHSpxXmgFam7vOCcwZTGABRXKqGY1rcUnVxm62LSzZBttztyH+3K8Gmh3DkYbQIqmIvj9qwXVjUhh2OukQ2FVJwm4RIwGL1GEOKMSDdEQySqI9MBUiDffjDP29ggVDHlPn9gRCybUUzxGPOr8n4+Lg9h5FBuZfrf1rUVQSl+oDPjRO37ewk4UUweEYn2iykGotCgWc/NqzmkBp8T1IJVEapbqRDTKGDcgoLtXRlej7GJkI8+ypwjpygfkUAIlRKKXUyn1oOZV5SxY/sNJXiXMCcGmFPzenVt9WqqB0sESe2AbGqY3iDJry4LQBxXxtMTtak8NGJNc73Svjat22Z2OhAugg2spY4foQcp7oXFnQ4US4fJuCU0H7vIhQWdFTpIi53T1B7c24cpGU3R/HKHxPxm/KQi59J6B0pXnOArRWjSMviS85udaVnq0ueJ1yhJo5t52amcectGnXTgt9dRNpacWjd/BxJOmCfyGtwBPUVW5ECclPltHiu4BS3mwi7i5jyerj7jhpqtTJ63S7W1jrSu8V8Jn38Hz+3KBU5U2ZWRG8g+y0yn9gc9ZU/fiFokFGdvJ9l6TPndLnUi5D63ROcOJNPO/7WRktpx3MP+ZquoBRbdbkMcWgoB7sSkkFS1Qr7lHygkwArLWBAekheUKVkKJdgQyXIUji8D/gX//AQPvjGOUwli/AG54CUNUhrYfeSV+raEG17DFxJ2TMZyoMVzCaL+ODd+/HPPjmP246SejwRQMr0zJg87IQz+kGAxeUmnnsNiAJLfyPukaSZLEafC7AgsKQ1e2+OX3SMlDeOqM6yikhK71vSduL1qjyo5y0Nc4HRPt0bSJVt67UnrIw0XggwRFRUBWi0gLACVCeAkz9ooEeCV1LWCZYyRqk2JqkPyomn23jjvTW87YPjuPfYnfj8V36I8wBW0ir67Flmdpk1vwJL8OiFHn389k6pd/ugq02vSJMcfbPMYKbmIeydx63TEf6b//xW3DkFaa0+/SxxA8Q5hOh26D9af5j+dVCp4UcvR7jzWIiK890V4V+StnXdVoJnsIQOrVYL2ivbPKjzCXeTByXNpxrYkYe0nHLthamXfodNf/rz8WmmH77b0dPCbEvyUGkncORdfKqu5E3LnWrbMkO1ZCZYS3QuT687904MtHvxBuwhrWhKZ57LUZahuXyOJNgyDOCvvwF47xveiN/5LvC7f/oMzpgqMAihOLJa2JrxUyeac6T8GJWoiZlWA3/1XbfgL94D3FG1wxle6AKr58/JnDlesyRJNxBREHjzk1eXkJQPCo6WuhlQ4bjs56CbnBRt5PoNuaF2eQ7s6pXZCI6e0iqnQT1pfJeM2/6x7N+jZY48fQY/txjr2XmLdKH/FkokZZnPdnkU2yoHG4SFrVY6L8UFYknTAJ0BsNbtQ6nShmpTHkXygqexwjPPA8duBeaIJwXw628Dfuktd+K3/qiD//i902iXDsNoEt5fm0q6Af55iVJOu6j3z+Dnb57Ar//SLbh9zF4D7op0/ksd4PzqKlR1WlIkaRrbxdvlkFlpOrW0glfOA7dQo3Pog2QI1qePbJQrGzTnfWOpZzsKuPt6srJ4LP7m05PmNPyZ7EdCu7eMu07obHaePgrligUWI/vJgx+7fHAiRbyhHYGpJx4C2xUa/RSprD0j++AQWdoPXcZTL5zDA7fOyY3xecO8KiY94L977xjuPnILfvdPz+PFBuv4VfQzcsAz4bKxcYiIdsoQeCeWo5jl3iPNzh/+fDbABmymnd4szYJ5sIIUQRbJFpo+JpIV/LO/dwfurdmRMmSmJgqPsqSAJ364htS3QxlMyn4A6+vkKyJnzve9ED94Drj9LW4sdrFB0Pml3KSdm+GYMxB5AHVxqbKdReB+4n/aPGg5a56YwAuYxgloXzXJscuq9xeYkwoTI1PmaEnJHTlaadiNUDmXI08IvLhftlxEfkk2+p/MFE2FFiB7cnEArz4pSjxa+qRwie8hxB8+eUoQ16vELnbskCw6BQc5ueI24F9+bB/+i7dq7O8+g/HoDFRvFRPjNCgGY6TdUZzDFsHoPjKvj4z5OJ0g490eykUkPHehnMN/F7m9VT4v3QhnZ32cnEl9lDsLuBEL+Ae/OI/f/0d34N01izbntWOXQrfTx3IKrGjgD759ArGuWt5Qeeo4SYO+vjfc0rAsfVM8XSZy7EpDHATV2aHLNLDSJf47sLjTDSexi0uQ52hTgBMOw5SM2RG06n8h9duIgyZ8oZnm8Hiv/xLDe9tlbawPfAWNh8xe4uX2yljtAkeYVWCujeWfjH2RnuVoYsrTUSfGYu02W9BcUUlf3vSn8QffAn79PoKfq3LIrqAkij6mgL/7nhm8/Q0z+LffWMafPL+E06+1EIzPYm3VwKvQwrC9oxBJ5S0fLm1zxeOmIjZ0pBy5rrSuJGYSqEEEb9BHtXkK777rID7+l+dwKATmlZ0HL92CRCi5a8IWKF6ThppErMN1NpSRXBGvP6+zGCG6f3aehSsjO1Y78hKARROXLxXwdXpFoMQbKC4dSwl1MNb9l4ywulEfsqol1PeSx+Kgvwil5y3tG4MXPnG4okLupAaX3H3sn3Ncnq4fJ2dZK4ow1hUOwozCyVDDY0++hI/edxMOEWNawJ87SiGMecC754E7PjSDd5+cwb/8Ty/g+6urQDCLNHA9NikflMIaO8oufaVkA1q/8JPRgpSXKSRzZQuHh3KgMZEs40h2Fn//v3gz3nnIPng8ah4iTUoo5SP3UFY12Ln8tSdfxFpWRSxWc+tDMRczZIsRfAysrBIb6ls6wNHjv0yhciY+HS7yddEoyoSPxX6aPKYjzu+sSjfFMJ8G+F+F8R8aEnPmDWVXUJhk73YAQ6cph4850KdwU11CJysVVHiWun08tQiU5+3kNB4x+R+4PAUcWuXeP+8BH7gFuO2WW/CFJ4Df+/YpLCbjiDy2hflQRlLe61q+10GVKyFKIxwHQbCwIH1bNj9YTiPsV238pXtvwK/9/CzG+sAh2jZHcZNPGadbkxfS6Op8/yxwuqPQ8+ubEPfbCa+98AbwmCSytiRuRnrAlLRLb0IzbdclcAkip2qJdvJ9fZVpR8+Q2UQzN+5mwzO8T2pfD2P/Ib4vck2Pu5X1ufNWoiiC5weC1LY3Itt8oTjPp993UC/yK219BYSiQFVxurWK/+dP1nD7hyckWOoO7IlXg/UbWCRzuBHAP3oX8J/dcwS/9Z0+/vS5Zby26qE0NS+zlMhaphFLWRVZCVl+FbfqALloGZJwrgsNAJeNpI+slyD0Nbyojao3gGda+Pm7DuAf/5UbMO386oDdq+48XIpb9pr3WdJysq3tf/93J7ASjyPi1LoL8I5y+e92IiRJKBjd0ZW7WlVSbVpe6qHb7UL51Svc5uGKQrwUMro6+fp4UkYoJe0+fDrinmpjwryGLJ3+EuL9HHEvT6d0yF6JNJMTOuucdLZ4to3ybTWYRgot007ziHU9UBgfryFtrO28P5kdzxTFOJ5aiPBbjwP/+AGgzKY8tzzlSpmHPLzR7CGlXlTHgMl3l3H3sYP43cdO47mzz6PsTyCNq5Yp0rAsuIdmlA9gHEmXKBlC/O4qDlcMDo6n+NB734xfvMVazFrC8p9tf84Vg/ZDFh4DNDMSsFnd+vILwEvtMtLShBCq7fhESZ++wvh4OEx32XvugC0qRRwHCMvA+fPn4ft1cSmuaDEjB/EYRu8GY9m5L02Z1xBmbVkTdN/ntLYlHEqfwKH08YWyOvc472iJkRWd5l3dH5d8lbKjHvqga2trUvc1wq9kh9rnaS32v9geGDUceWjFWgLbjmx71iUlxtJmUMJZNY2v/HgV3+xaKyJtzVEsCsmbmS8Iw2urbDKb9NJ/7Ubg//47h/Drv3gQN/uv4IbyGsqsWbNQ7Py7vRDF6SSqiixWKJk1HKo28dAv3oR/8XeP41duAQ5TOXmhFPuHMserbze2MnNGVNmQ7sZa1j9bBf79k8CrUR26UoVi1JOf7Pq3bvg9TRJMTTPA3HyqOY6BQ9A69Ms0eQnyUUVbrAiXqZziepKoLD33+CHz+ML+7BsoYcmmnfi+MOtiJjmF2eQUNfcLw8/v0nrm9IsblmSxSBqNJm9QCYpT7YpdilSuEJipMa/Zso405/iwGTk/oIyts/bA6LsRSNKBh5e7Jfyvv3sGz/UBPn9yettNZxMrmmEKNsk/C+Bv3zeGz/69t+Ev3FjFdOskZswaQkL59kiCdIB9ZhWHzFn8pTfM4FP/5ZvwN96ihPJalvUO23zz7y+wl8iddQFVEMoIc5Z4/49/+zK+/pMFYGJyyF+1LiNweQk+DcpJC3OSbtsYVct9Y4WPfWBLgFcqo0cCjCGIiDnLXWKG3Q2hB8X7U86aX5hKTmE6PSXEwxRdTjSqbO6PgEoiY0e+lHpY7HKZpGuQpz222TYBTEf464W5suAqcNgr0SCnz/URVn1JLwmK3vl3EQnFNHDzNDDjtZE4PF4+f9INaHM7VyjpWBg1+Le2quK75338/lPAaQMMSh5iLqOpo3UsWlGx7Cy1GrGyTNcwbrvdB/6HvziFf/7X78Sb9YuYDWmS6d3ZztOLl+0nJuVc+tOqjQfHF/B//Y1b8KkP1PCucZvTHHPvC6pElZF1hOk4Tzj7hamPJV8Wx7WPPoAfJcA//8oAJwZTSMbmkES8zhbDuuGpLP50LNVvmgnwvtsBFnKSwnAzSZ7DRyMGXjrXxfl21yknrT55sjg4jYHdZanm+nEwr+gZGM/qXjlNUE4S+LJ6Eywiy6vdhPZQm4XEi07A47VyB3SZB7HB+A7LaAGSTGG1M8AgKwt7mqSX8touGfASjTEfuHF+AgvLljpMPrupr8kW74t0hUtRCZ//2vNYPT2Gj7//IO4aZy+4FFTFZ+PSb+OAHENmR9qE0uttLRff+wu3ADf9w/vwT78J/O43aSlSmCiFJ5Aqd6zDE7t4zfV9jaTTQxaG+AsPzOLvv3UWNxr7gPDh5BiY9b1rOT/CtHP25FX3niCoiI1hkeIzX3wZT5zxcFbzltl1Oo7Xx0Nuvhl2ZyUTYX/ZoH+ec+s5WdnmQi1OwuZIF9rA82fXkHpsww0LRKnuGHNWlssSfj7Kq1uPUvfkUAuZI816bKJ8mdjGQQOM3hPP/KYsIdvRTVyK5BB3J17IhLKP11Z7aLt0yXCQAf3CQGPQSyQlePPB/aikXblqQcFdWD8khUiVBQk1tOphBen4QXz1ZIr/9tEX8fUm8AL7cRzbnOT1XP7QDU8cXvTiqWoXTB2/Gdg34yP0PRkLLvTYbrPJOavg67ObdqbFTphH9D3Uxj3MzADjxB7QjeH3bbAFfIBIZsZ8gl3UJWL3gQYrbQD+eAX4u//XCXy/MYYlfx4Re7nDYhco798Wx0L2QBOjYtp44+03yVRjpqOlqVbK0JZeiMfVSoEXzqwg9SowbqrKlROX20JCnfst6l7fs7rIvjMOafMthbY9ME91Uc9eQT8NH2thejFWtSvO2USjRTaQ892u8CqNyYhwu4xLEx0tSC9FOvBRD3yMmSaQ0FetwmREfrsdObfBjOb5MiAKx6S57smVs/iv/9n38MAbDuLn7zmIt91qp1cwLeNU00bDzmrmIcV5A3znyS7+3++/hKd684gr+2T6Rb+fyFgb+z02sMsuMV8svf6ej3Yzwb/64jmcnG7ir/zcrbj1Rg83s/d85LjMurcp6TIGgN99GXj8B0v43gvnsaymsNDzgTHyLY4aswL5WG5CuYogRintYCxdwz23H0Yldphh5o4Jz+QIIKNlnhQt9qopIwsqGzpppQCZz3a97DjFGi8v6y5OpCuPUfeogxbJZx9038/6w2Ge4+YsjvefQN1fwk8qP//52Jv+5OV+tb0Wtm2geGJ8Hlgy62U1PH0S+MU7gKhrb4jPSNIAofYRxMD+MeCBO4/hO8+dRU+F6LIW7NJHwyUmb1HJLUUQoiukYR5U9QashBV85eUuvvLyaQFZ3Hv7jThQUzJihWS0lWlbZz63CsGiPvNiD0uNNpYaTST+LLq6grgdWQykQ/JvCB4LOdL1i54f2xbXJK9WeT56pWl8u1vGd/7DKdSrJdx640EcPgBMjQFz08B0DRisAqtN4OQKsNDK8J1nTkr5krjOSM+jo+tArfCQut0LfJE+nDFIhFPdzZTSzNDE2Of1cP8tRzDGdJvr4XIVTwmM+LD2PODbLxg09QQSUgVucLGuxJhZ3rsQ1bT9G7cMvon98bMooQFPeuGYnUikfCJ1aBoxL+tjwpxG31QRZv3PAvjobpnvhiy/7uRYBSEXMElrTzcSdDJfwLKC8zRaQAuB9oSNjWmuO2/w8aMfrSHzJwW8QhzyukLSttBxcie7Yea4fbjb/hS6mLAs7irD117qoZw0URqsSBqm708i1VVEWYZIGDdKUP4MTHXfsHJg0TauzOXq9Bu+6DIl1mWcY4GkMoXFKMIrL0YIX0gRqFj6isoqQn/tLLTvYVCeQd8bR798VMjIOJNUshS5T5j78UP8hNSkhPHUIuTpygBZP4Kn+iibFTzwpoM2J+xWggGJf1PY/q7AsgeeXBmgq8YR5YNb17srcUWEXPhZ/0sT5pToHl3OIcEOx63T/xRUpgMGs1Eu8aQVdAEZPo8Mn9x0+wsgEpuW2MJR3ua+iV75TKR7ONNo4lyrjqNjnkT3XhIIo3Lu6TA3xhTIrTfM4AdneqRTFQIxewzW/+MMRR6/fY3LLvOF7NWJ5OHoeyUZmEBJUiPI8IGqwx+vo8ThXmsd+LTMvgflM2Ht2dV6ePx5M1nO274xWWUnCl/uzcl9DbazlCRDkcaxROiDwQCrbOGYul0Y7MjEbBhmu4auDa4NDWSa2uOUqH8d8GIzLevtL2OTIYJGhDuO7sdsuQA5cKXhQZfVI8tQfaYBvLI8wMCbXDcKhetS/I7LvwbmUYVkIfaMZCRs5trONHC5a6ugwznqMjCri8n0FUwnp36nnHXX85R5nsY9ddzJaCnzYkSAKpL/CnBu1aDTJ2gnRRozlMmjSPsUNRfb+Pn79mNsrIIuy595JYVAE/Yn5YFJMQsvyssQaGOQJ8SvpSqyUhWDoIquF6IyNYXSeA0qLFso2Y4Irg2p/t1LvisOk+hm6Lcj9HoR+kkmxF+oTKBpfAwyMoCUXeN/QSTtZmQppKVk4l7C8CEhs23vkNU9f+iiFDU/xft+bhbH5pz7XMDj0pVlILYcAT85TYUpLu16i+0iztHBB4uTSbiFpovJ5NTD0+krkvcUnPAwF8t+AR/+2sqaJdwfDi+gzzLAlGrD6JeeDmc+9HhDH3ogZqLMfRnTQmXngPQFjVQ40Pxk8pdGbvbQ4LiWkh/+6FW87UNHUe9XkLSaAseT2rnjCCJxKqPJ/YdreLFvBKFEg5mnpqw/aDZYNAHiataJcj6jXBe4NLpWBqH0BnrFWZyixCMKuKsAoCgjD7I8WIWUDTsGgxA6C+XBIiVNljuF+YXL3LRSB3B2STLb08Wq1GZHR0QCIOG/NUg7K7j/7YcwXwIGy5a9TtqQnNIEpo8oKkPPAn/4O6cRZbM2Lzf60BaN1nYP9QblZCsRLX15eLvGs5VH60v/cWHKPIM4O4+WxEOOJNcptOTweVJcFu2ECFaW+pg0r2LSSGXpNy14Ns95uV559y2Xy5GUo6i6iY+X2VnIYQS+teT5KEQeTbfVFZT9L7wF2FfmSUaiWbYt1lHgDN2M9WOyLMw5En3zd+fbcKhb/rdhw63d9lZy87VOCCarmGA0ZbDO+ltHH/QCVG+n5JZkALQPTfhk5zzmVBN/6R3ATAWo2/afDaPPWZXrJsBTzwOrsQMo77bLY8SI5K8FaD9MHZtMX5UOAcEDSwk3Zxixurmt8IAjzzwWeebxYVOb82mIM2S+yipIIdVwgfJoscpEFYjYuHWqgQ4vZlAdRshWURWm5mpYOxfhYAJ8+O1lTCli9VL5foJzdwEvuijZqVL2OsyqvGQZqkFeP9BV9FKNeNDBbDjAP/hrN+MIH8wesNyINuSgqajeRIAoBJ788wEGUSF9NlpFLH7PTtdBrCujYAaz1gCl0s2cPArGOdto//Aa73SyJfoI1pJ+2BN0ibsIgkB3vsIuXDJxLcIqTi218VoLkriXc8oDMLc8T4+FiJYivOUIcPs0QQXLUKlzOf5/2V5czEByh1LvHB64bR9unQI00fH9DkLWlF0un1A7ulLLBljoAS++dh5+yfYz7UqGCrwOMiFSadKcenjSWN9zJ9HFKsjoVjPncbz/DRzvP74wkZ79jETM7GmhU8JAhPmqPLIrosO3etK2ECp6rMpY6vv40ek+ULNKSUoce4EztBs9xFEfQSlE4xzwK++awrsOedgX9KVmv2Wl5CJklLGNEzy4jVbQc6d9u+3iZasAw5VbN4wQ33hcaoQzatN56B02whbHgCmvjw/dOY1ffaAivEfMI3P+qJ/GUBwqJcgyNikCBDj+wRN9tFIPvThxvWDbc1htPqARv1QuYk5IZ4djjKeNR28e/NnCjdE3MJYuX/CqbStBxmj+VO6LfhbKLArCZb3Ih90IEUp9KnxlCuf6Pl44k6cardLJgFT6k2mKbmeAbJDg0DjwF944g6l4EeX+eTar7OoYfpolYK50aRE3lvv4pXfOYEqsqf2bx6FpJGkjHDwhgRdQrQM/fo1bE8udBLVJ1/awC5G4xiGjnCyWMvqeJ8GtJLiz7WVHDeMyHvlG6vOx1gtQ+vPWujId5QuIdjc+oPiZDNPGSljqZXjulY6U2fLBWPSJBrokhLVMoyAZYG0NmK8D/+CXb8Yt/hLKZucl4kJpyp0r59e3lLM2bvbP4e//5/swW4P0gkl6kCN9GD94ZZlFZZJY8KAcV/XVbzbR8WoYm96PdpdseLs1QjndIKuVPsnCPp94/QU2xwmbyAU+f8Fvlxo9WGFaQD05+9lymiwW0Sa78QPzQanEf8Z+gJeWOni5AXT9kh0rLfvn2JWcK8jWo2sV4EAJ+Lt/7Q5MpmsoZz3JB+bkQvRhSW9dytgbMHI+OWjEbbtKtO+xZBtHx2/ymphloLJlsR0Qngc8tJxjaQeT8RL+24/ejfHIUhpyeIUMpFBK/E1mncMyK/MeOh7wnReAHy+00MgqWOmnqE1Ud09d7mKKIAGqSbQ4nZwW39PPfc8LsCeSXG7HC0RrWUtXcEv/O5hS3YXXMP2rDV39muVyyt+4/T52mvbLL9dJhF4zQ6rLGATT+OpLHfgzY9L8NlcG0q49kchzFa8eOwA09lWAfQHw3//aTfjCVxM8eboLXa9LqS40CuOE6JgEbRD0YMtncpO3eiTpZ11mRL7b+7eBPnHzX7GpqurKkhbtbqA5cErSjOS70Qg5trTZwhvnFT78wM0CHyRARhrtCKRx900MD5FdbOCtlvFqAvzrPzuJVvmwRXmFZTSkAWqkEXXT+V7YBkp+NQEmTfdXD2Xfxkz2Q9SypszDsh0ShX2oS7CgechQIuI+Pi1bmLUfMxqfKV6wyxe6CwPLsCsABx8NjOF7L1jiq2ZvAFJA23GyNrcZmUwocda6XQHZqnPAh9/p4wNvqWMy6SFdWka/0UA6YF5tIzxMbmoOrMx/XuuSjfwsSJLEiJIU5TBAeVpjrALM6wjve+Mk/s57JnDXFFATSCmb8Dhikl6/Iwt2+2POc6kPfO0pYFVNSvfCFetDy4NJ++9Hy1nzsZnkNGaTM5L3vBgE2I49qTaVZLWbczU16/RBE0mQfBbwPwqF+V33Ro8EW4M4xqmzazgzM4tgzMc4S1a8uNLbaZf6XurhvNBXG8yoFGUVoHoEmEvL+LN0BYs9D52sinZalikXFJmjXuAhzYPMgc/97m0u9XLE4gywzUMkfQoc3cGeCPQHHdSjNRwsdXH/TRP40JtC3DgB9Bp9JAHJFjxoE0lTWh6A8pxjNYauUjhxFvjBT04hTkdmf+/6AbbXlR0asY4ejlUTmkx7bEbkdZf2iJ0BzxdsmmZtPo/CmLOqqRcxpvyFDg79qlG1r+32JJiyKi4bRI93I4PvPXsGE286iPG0jKrnSX92PoJF+uHZCdCNcKDK/nHg+DRRZwpHZm/AE8+28KOzMc60m/DHJ920YYurItgjxw9I5cTYAbXbrdUX7aIWS39XSDySqrGWPkylOeCKGAsLSA55ozvLeMeNNfzyA8dwJARmPaCzsCyToxnI8jNlB6CRCTKZxoDtIlphyQBf/s4JLHUC+BXSvRRWmC1OZ4dLtYVYrLGH9m+M4czCOF4UmqVLCU79nUbeC4hX/Dct6OYQDRxKvgdfNfBKoB/r4NhnAP+T+eDXSxIGPw41Tl+keCXSYAxLURd/+O0X8DfJtBBzbLGlgSFAhbk5Yl36mcLZPqtRwFTHtk383M3A0blxPPky8MSza3i5SzROFYlRGMRAEg3sFSamjNUxwV9YxLo9ro2HucmFzisv2y29O/jclyIWH6GkVs74L2E/SDxAqVpFuazQbUfS8Hbv4XH8wi8cwVsPA2EbmEgGyJIEqlQXJYzpX+fumkmReQH82iRWY6AZAP/T//kUmv4sTJmzDgNLO1Q4z01BpvNJc576YZBZRJwMr4XkPz8zZs4+cjj5NvYnLyBUDRmLYye12BVxJ+25oAW1wQO5xPn0JeLczqRAH7NY8vRn+9n+jya4fOS91NMLJyhjEjh/kxyg0PjD7zbxwJvqqChS2PjiSxHHydPi0tXL7GDZCnt1FNBZBqoKeMuNwE3HJvDdl4Ann23hlTOLqNSmsBIl8MrjKI15pL2X7tJh1LHpCl+Cgm3Df3TZwsIBLHEsLehYSQsrsopXUEoS3Lp/Dg/eM4N79gP7lG16jLrLCCoumGQa0JHQ5p440WMkAOOzflYDj/7hMpaD/ehpy0CSSEqJmIwr4/J46C6Op+c+uy99DjPpCdRw2raVyPW+uOSev101xLYMG2msoqYLVZAbdVIz53As/R7qqrtwyv+5expe7antgM2j+1+/fxsetUIUnRNaBVJr/8lyG90n23jfW2qieFRQOthSx8+Ypq+i66wBG+3kodX232TKu+E48N4j43j5/Di++9w5vLSaYC3po9EzGCRl+B7nMDmG1j2ZFHCZYqxLQigd25NL/Q6R57j/7hvxhmM+bjsGVBmZdyx3El2xydkZkHQrju0In9ERNAQDn49KaKfAv3rC4LEXBwjH5wUva0sipN2RL18/jMvPgy6OpY17jkXfX9hnnkVZLUmDHIcmWFCIdRv1bnzQvK/dMp7ZgybMzcu6qKWn4SsffTW5oGB+o6fmPjcgZjH3Udan5W0pG/0YpnnyJWNdiwke7qQhXlnt4YkfNPCX3j4JnTAwcJN3hRnDWhliSv0xS0AgPd6MrbrABKdWK4PKvMZEaQ6Vg8CPTwM/OZnhtUYfS+2W5APjNBGKGwvwsjYn/3cxiMuZ9YpMxcWfG2eObv59w/UVn1jabd31tiFjHsh4WYJbD+3HwekSbjlYx5EpoMIOUE7xIK9ADMxOAY2VSNDwvhfCSALZkuLQdfLchY5UzZIRTwB/8HgP33uJSfg6Bg7gLJwD0s7ieiBYMbyo59Wm6OjLyzUjnjjrkiHkN/Ynzy3sT06gbk4j9cjxmDu2jn8qu7BPq97/9z6w8YVNQY+L+ja0l2ohXIhVFcH0zVjWd+KU9+5PN9TBT+Z91dL4lL+9WFvelmF44xKbg81JzOAnbUwGEW47UMeDbyoLjyWXc0H+pWTdMDJzMksNZqYCGVYrqRTXoZBnlOLClpNvqcBSC55bAVY7wFKjh0abfUktNFoDZOWadDPS0pI8q92xTj453otCVuKLUVAOhEhZgkx5k2IZozNVCzA3Xcf0WAUzk+OYm/awfxaoepaZTygpaXX4PTQQrtuAXUFa9+QaxkkAjyBnqc/L+iL/7nUUatOhoNUXWsCjX34FJ7sBTg/KiCvT4g8WWZ7zKp4c66b2luLMU+ZU1lkJS45foh8A9ez0Z26O//jhueRZxCsv2qR8AbBsgeSuk/YCFvoiqM9yILMeSbwbicgmspOIUGXd/mEo3KeAB+Q9DuqYt7JcqjAdJDk0Ehb4VSEQeHahjVfPruAD7z6ImgdMEZPc0AiIbHLoSdGfGlAiEDyHnOX1Z/bcswTovoMWhsZrogQcnAciorzHKhhkFUTZtCS3Oa+2n3BShmWk7PWnhviUnJgvf7bymZZFGf29RsYUHzKxJAxsw1rIRjZG2txo0IREiz3hQCnOUNIK7Pg1w+/LE2PsJ3P3xSePJwel2SfX8rGGCKY8idRXesAjv/csTq1l6IWT8MoVS0HKWZ4Fo3RJU5AdFrU46kdleDzMug9PpycxbU5iJa+1D/vGij8vLMJfO/zCLSoFO1eajOQRIy/BQCd8Gj+sYZ5SmZ4vceQSa/lF1E+20/7VpsqT7f1SMH6ISPlYSbroGoN/+0fn8MA75pCMAQcShXLK5ciABb807qPTIRAiIGXT0IoW6B1EhGiRI1nYpKe0NKmxgSzq2MCe5AiCR6T1ogJNWKVabRQi3BFUz1bzhEZ/J+8UuwI4tIAdLuPjll5bIpcUGK8VrpM28t1UOqHiJlA7BxfL3gJow3YQdmIyV8wJgam1uMZHR3l4DcCfnwX+4MtnsNphg944MtKCaxJoWCsgUXnenTASIF1IX/P7FUs2xJBf9sNCiaOIfMupcS4/6NpgQS9vV0z7tFHVL6OnywsDTN6DtP4UQJqLkSfycmKQ/DMcAoCqTP/Q2sMffa+FY+MePvAGjtEJHL0Oc4YJ0iiBajHAKMHn/AQ20o2M/qYpolUSwgIGGxF90AwztUB6pujT8fWSZmI5gWnbq7OPS73ncrLDfbm0C3m+RgKtTUs+rSOVjk+DBtbakeAyA8+DFyqsLa4iDDi0rIRAB65Jz/aqj1ZFxW3JewhzZhjlIdYWy9DwgX/zbeCbzw7Q7FagVA0e2LKskdDC8sFlpxwvwuXcmgIVUabMotLNe8aylYUxvCygU87/tHz/uGy56EPLv2h0CRBWMrOEg+oJBGoFZ9X9Cx09+f5M48uGlaYLKOUGPqvR/eflnvwncxThGLomQQ8az660Ef9wgJtmx3DTwRA15g17TNwn8Dt9tNtd6KpCpVaGLjF6op5z/qZr/s4vHAeKeQolanGUCCTNL/AXUbTPbkMbc1qi3dGi8brvvOH82L9VBtrtBBVShzghQJgGphZyuXaEpgaYnhizEENjby7pEan7sow632/YeR/YSW0mBqokew3LWIuAVgX49gLw6H86jWY6b3vaa6XhkiyKLpP+XPA7kiK7WDtie5jkn4uR1u8vYWVhHn+GGf0MPL2C2AVaRXK4S5VLIhoffRr41GrjCwNcXZ+0/S2YRpD5T3f1/venyn9qN/vfVId2V445Oy7ZfV3Fi80eTp5fwI9Pl/DWm/fjSJ0jvCvwvAp8kyAxLbTbbfT7GuVyWSyTzxbj3LrT+nkKmfQhpBKMEBsw5NQXq+RLUFQ8tItNd7IesNY1qI376DPTwOck94ll49JssQZSVZOHwJe0XuKCR7FUW9xkKjlHajM6JySSAfkPzwF//OM1PLXcQzZxCAl5cpxCFl2tPDax05HXr/0lLXI5egrx+0tYeLpufoJ92TOoZydd7pV5v93lVHfHhC+OUVmgbgp91M0ZjCdfRwNLOBk88PSyPvZxKHzucncvpItirpzX5fJ5FMtYEqKXVjA5Pi1UOv/uT0/grbfcgCP7qji8T6Hu+xjXgczsjOJE+EjTNLFKKoSYdoCAEB1LE9d612QeBUvz3QaW/EtTUBujucGsTleG9D1M77h0RyaJ8tAt0S7DALbdKATbIJ64H1Kdx2PAU2eBb/wow7OvraA5IHIphN8eIEQIw/bjnF7RfTa3osMiRd6hfQFrV/wzS8Sph4+PZaef3m++junsGYxlZxGS7MJQL3xo6dI0V0dB7QnbfBZNPVFPYXoKPjQ4uc4o80gLc8zBfS4fiZ3Pgxye7HaFAlcQtjm5jamPXElZSaIeLbdJ6QjUpw7j+y8v4qUlD9OvBjgyW8VNkxmmx6qojY2JJrJK4idK8oPlgAMILGFBXoOWw+FAXQGn2KKBeJ8jrsjFShwDYzWbXeBSvxmbGgrNOUleWEWT+e3O1dFUPknZOXY7p2B5Ko/MH489meD7J5fw7Pk2YiaCa9M2c88si3GIebnMHNBb+PIiYmnH87FvygdcrI+PIj9M++NjOPfIdPYs9qW0nKekN1/8YbLE5NH9Luof2+ZBLxYQYJdBvt9yxWmXH+2pfTjvHUdj3wfQwk0f81P9OV4IWgfJ0Rab7jYlR92eXUlsndXOLrlDv9S91+q87aNicjsnbSA4ohp3MDdewtz8NCYmQ3K7Sh6eSy2haDeWgRqtp2eVUObZs0TPJZOl0zYnAys7InBIauLAJnbg6HpdumDppJeHLRXS0+NSQSSOoCchpG52biZ7hixZF4sFdhPr7BjEshDoRECzDzQj4MXTwKtLJJVtYKBDnG11ZRgXu1ztwIQ8AW2vH8dv8/iGOc3cauaiRyt5G7RhmOcMGTS6oMyRe3180rz0yOT5/4gZ8yyqGdtvuuvdrm4Qx2j25EIyqne7H3aTK1LB12AvU5C9Ig54kN4ET/mPRNmh78aZ/2UvsxA98c3pPwmVy8gu3UW0ViT3/QrtryPvz62NLZEymLH0KUL46k/hdBTh5MkuMqxCewmCUMHzM0zoGG/YV8VcJcDMzJSkfMhgyOg+yBPXgRbFzRXYJcMK317AnG7xUG/lCtjJbUpyrGfW7AMRktGDBHVdoLlmx7402gOcXe5gtZfiXKuH5V6KyK+h75UR6YqAQdKwZFeUTW6AqwSJ1Vi/V5uPc2dLlOc4C2e8GGbx+2vm1af3mZ+gnj6Lunl1+J3D9+W19l2i3a6Agm4v1WwZ4+YbKOsVvKbf/XRXH3k/YL7sZXqeCOsi3c4myS3lZfovtLSDJMGAjBCcSR8wMW0ZWlWSIszYsJfh3CtdaNODJ8SGQNwfYKxWw/TEJOrVEPvGPLDzgZaXS/Uoq/bk5M7HwR6qojDZ327z9RTNboLWoCSkFRyZzQkozWYTCccWcgx5bCHwGc1uWEUSeoi0luNOZLalq8hIimkb7s6tclNb/H0rPWL5k2kxKqitOJnFVOn318zC08fixzGXPoO+Ifn43smeKqjPSpM5KQn9lp5FrJKnI0zfY7L1POmeCpv6iBohvCs3FO2ucByRrU0HRAiNw3CKRhrb5ami0Uo1ziwZeGkLEzTGWSydpXYsjivXSVbejJQ6Nz9MwylvogvJ0A3gUKwEIaJsTIbd2vRXCZk/i0RxrmYCrTxM1WQ0tTD7kWCLxG6G/Nj5mizjuK8A+8c2Im6CfI1Z9FTznjGsLEziJ5jCMxjHKcSKBMN7B/jesSepKNuR7m13aBJYSG03kchuP55AgBWcxf0LHTV5j/HxxUzhgeHIxVHZ5dIgaSJxxwpYUx4Uqdvcvun7RcIHabtT8/p8Tsqa+iWsDPk8hVUNadEiCTdA8eAvoCUCDFj//BCYsoG9g0V2kpyVYDIfDck15cwfHM+oN9La0nLmdHwb8mCXe90KuxCCOJHHM6M/XPJWFvZnf4YZ9Qzgn0XfzXjfS4aVPbWgFPqQ5HpibgwuT1rN+gvI/Af7qvbpNTX9yXRYHb8MudCNkDUqV7otWiPFKy8oSb5P563vPEzXzse88DHscLyjQeIQFWSPlfUEkQ0PsnN/9tByUZiVmUxXPuOj+3CkOPLm5WGeUwjOXgf2KtJxbpArNoabQstkqpLqCHSEOs5izPwJYL4nf1v1jj38vH7g+YY+8qndEOVuTwFJOkKbcpFnkaUXppCGyUD3U65BsQxa2PfIrkfneolBu8A121h9G3nzcO5L/kKhjVJtRIRZdJet2dukvhyB80VHbmQxmByN3C9OFivZud84ZB5/hIAgWkvSH42nSwgl5+XYA0nytMPKcSH9ulC2aE8taM5gx7wY69nkHQ3MKcukLBOOu2iks48Y4Esdb/qpVHHaZuGQJIhaJ2EtRvLrtmP7i2NHqbg8KuvCjtJHJrBtA6AvLlcX5p6yWrDhom+BFM8ZjO3Rjt6xwq427tZKTu8z9HHZU2UnxBX1e0v9GyX+oghXqPCwb/6bdE4Y8nYu1kzjnn3pcwI2Hs9OYiBcWMzK8BrxIbcpv70mUNukoNtp9KUuJpZ0waDROO8idVsNEqPglqcYL+LG6RBj/srCSfXWexr+oU8g05+0kWlh+ZN7k+dD7UURGJYM+VpPM211FOSjLP7OlMzoTNQtxV0Hs2NSm+p/aT2hmxZF4iq3wkQOH6BsHcBtkdrrHdPFB21kv3ndPT8JKlbMu+07JZWKgPs5vNY8jugztezcZ4/F31+YS05gsPIiDNru/hWuc9ZxweHGB3L08dS75BHYcx80R+LnyiWvyQuWyZnLR2YitLLygknNwx21//k0q3/KMzbKZ4k8ryNvgOJdzInmfuflHHf+j+ESu42lHgG4XI5F2cpFGb6iNh+/Jba90GOht0Qe2f4v9zdXQWYiPtVY9FT7V8eyM4/NmOck+U4kfNMxgHDVG3637PD1IQwadiZfDY4iVp8Sr49QncXh5Fs4mnwT49mZR4Isuqcc41Hy1TJfamfpkNdHZtbIMkRrwM3yll5se8JPgWQ5jeFOUujVde4Qq8Ki69H65hEFNQBKCT4TZMk949npx3gPbki/hVCdsW0au1TETWyBl6hve25BdxIbmzAb2ESYRAhYrjOTaCNa8JP6Rwaq9lsNVH87Ft80/4DttR5G5pS9DiVfr++4gqLdz/zBzWv5uWbw72VjFifT5q+W0HyMpArsW2drMLsvMx0VzNfVI7a4ZAW92Ch/dAneeumzE3sFtkdkuyHxzZOI8az4Zcv+occ6+h37oQ9+2o7E0fMyr28Yua6zb1zs0nqxK/6oW5j3f286f3Vx+1+3FhvfsF2i5qJwHAXZeP7roZj0TRazAfZ9i0bh84FZ+uxBPL4wm5wUxg+28ASq4Yp4vC+46nJVLWgRJSMMaFkXVWN7WOiUZ2hgxtSgTfNhP8VnI1X7dMM/+BAUmW5t9eRypoz8bIhZ/6eLCj0TYTw7+5kg637WwF+YNq9i1vwIs8RvSkerxUYMK8wE6lxvFvSKibDtUjFtPo8lPHgRDHmYXEA1Zs7hpuhbiOMfIkz0wqp35CPPln/+4ZaufVqneMg21hFL+bOjpFne3nzBdzrAogy/ENzp4xPp0odvyB5fICmxZ3zhVq1lZ+1sLFLoELzDgQuysllk2l4XA65xC+qITYdob2Mtp0PQcI79VHpK3ldKtJBIrHn7F8pe/yNBqh+OUf10y598qM9+/OIIwsLszLynZ/iNiiBoh0nKS56uwLRhKdwLsqVNZ0+Ym530ZwEzGl7q2YjbXRM1bDRcP54iwt5+znKoFgf3SioObZSypcfDtPubQeo/Rl7OOfOsMGbTYtpRPixXWiIvizN1fqfrW7/acsntUpeaxyqozZbSWLVwHzuL3EH3ttiDIGowwLRewZiu8n0LDX3kI+nchx7uqyOfhsJD9gCdgkro6lv0EfeZx1NZagsFsrlcqmuZsEla25FoD9hZkEK+cROobRNYaB3xfyHJyOmRRUjz45URfJ7447nhSvOHZtiQbmc98T3rcLo8qTl0nheNweerZuV3Js/9x6epkLkLlWbnsUbWVPr9Dm+b36GN6TLrx9q25p1WqJG+efyU+aDDJ57/22E54YNBizDJaSNuxgKdei+9acFD9yNGiUX9YE/XPxWjbGkhZXCUfe96zdxaC204MMvCyJjsXy8KOHCJWCRu6/Ph90K4YkgSXEiLckR0PoYHNuGe5WVbW5VTLvE+hCrmnEroLlbT5ueDrP9ZBbMwnb6MqYQW85XCN25UyPUrnleF1mFB14ABvYoKKsMYdkeHVMnO41jyBA4lT8I3eqGpDj3yfPn+Rxr60HsCg1/TBg8NLzcp7tkhEhLkkCAk1Y2vZSaQIJVYo3etCkLtwBzgHmeGxWIJCN72dgn1jE7EoqaC94SlGpKCj80F69S37CKO38iLsRgbnEg8/ZsTZumxW/rftENZPXYUdGWC2/Us14AFvXzhDRjPTsuSXU4MqrqLZjyHso4eK6V4TGV4ONb6g5GqfaSPuQc4ONcu4ZEdACGVJtcmMTrznZazWP/fE6Fihi5Jad0Iu2zn32vyRmekPG5XkixlBuM493jZtL+gUvOlNMUCXRTOW98fn8BEdgr9TMvKIOMFr2N53RR0L26z0AyCw6Y0PJ0gzJo4En8PKZ6R3njALPR9/ciyf+SRV/z7DyTe3AehogcB895Y63nW6XVkCV6HyKHcoudA4B3RUpcgRUyqE/qBKiGRlExec0Gas6aSQoOkhjgRAx5HACVfRZJ8vYxzX5pVjy9M45TQTnI/fVJTqq7MWycrIDeuFeJD5qNgisdx2fL6RvXXtQW14mrEwr3Ulfoxlz9G/LzLfelQa6Jt6gteesMjie4/IonsLHyPRvkmldQ+kqB+vOVNzsvEJdZW86V+rxkZRQGt0kigJFbcDtCsJ43FqmmeCLLuF9IseqntRY/xXKtpGZPZa5jEM5jEKYwJUoxN0qGbVE26TPzUyHWroHYRFJ5la/iEB4hSlsg3lnSTTaHUsjO4Of46oqSGKNZI2TahkseQ+Y8hqz/Sym4hN/ObV/Tk26BwK1Ryn87C436KeeFzuJI3fBS2KQRpWEy95ASgvwWD5+vJynePxd98etq8BM2p04QIJtYlkXNWrPicE1JhS/FNwlrXo6Qid11sFE56x2F5eNsree3KdaugVgpz4Z0PyaVyyG0pG+cltVFLu8L2xhZdstgZj78TV1kXP/B8ds/TyPC03Y8LQgwOZBp3OlT9+9yXHgBw1P37uPu5Hdh6sfDvEwAYTi8AeN699l2j5D0LQ5yBINk5bfqUIIrIccRMhEo55IinFiHxIiSikOuBZp6/FK5RaUVx04Kv80rb/wc2SGXljM/L5wAAAABJRU5ErkJggg==";
        (usersList || []).forEach(u => { usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url; });

        // Determine active users (have rosters in any year)
        const rosters2026 = await api.getRosters("2026").catch(() => []);
        const activeSet = new Set((rosters2026 || []).map(r => r.owner).filter(Boolean));
        // Collect ALL usernames from transactions (captures former members not in leagueUsers)
        const txUsernames = new Set();
        (txData || []).forEach(t => {
            (t.teams || []).forEach(u => txUsernames.add(u));
            if (t.team) txUsernames.add(t.team);
        });
        (usersList || []).forEach(u => txUsernames.add(u.username));
        // Filter out NFL team codes (e.g. "KC", "DAL") that appear in transaction data
        const allTxUsers = [...txUsernames].filter(u => u && !/^[A-Z]{2,3}$/.test(u));
        const activeUsers   = allTxUsers.filter(u => activeSet.has(u)).sort();
        const inactiveUsers = allTxUsers.filter(u => !activeSet.has(u)).sort();

        buildUserDropdown(activeUsers, inactiveUsers);
        // Add former members to usersMap (letter fallback since no avatar_url)
        [...txUsernames].filter(u => !usersMap[u]).forEach(u => { usersMap[u] = null; });
        faabRemainingMap = computeFaabRemaining(allData);

        // Build pick→player lookup from draft archive.
        // Key: "year-round-picked_by" → sorted array of traded picks (pick_no, player, position).
        // Only includes picks that arrived via trade (original_owner !== picked_by).
        // Sorted by pick_no so sequential consumption in assetRow matches draft order.
        const draftArchive = window.__STATIC_DATA__?.draft || {};
        Object.entries(draftArchive).forEach(([year, picks]) => {
            (picks || []).forEach(p => {
                if (p.player && p.picked_by && p.original_owner !== p.picked_by) {
                    const key = `${year}-${p.round}-${p.picked_by}`;
                    if (!pickMap[key]) pickMap[key] = [];
                    pickMap[key].push({ player: p.player, position: p.position, team: p.team, pick_no: p.pick_no });
                }
            });
        });
        // Sort each array by pick_no ascending
        Object.values(pickMap).forEach(arr => arr.sort((a, b) => a.pick_no - b.pick_no));

        document.getElementById("filterYear").addEventListener("change", render);
        document.getElementById("filterType").addEventListener("change", render);
        // user dropdown events wired inside buildUserDropdown
        render();
    } catch (err) {
        console.error(err);
        document.getElementById("tx-board").innerHTML = "Failed to load transactions.";
    }
}

init();
