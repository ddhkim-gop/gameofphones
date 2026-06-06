import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

function el(id) { return document.getElementById(id); }
function safeName(v) { return (v == null || v === "") ? "Unknown" : v; }

const PICK_COLORS = {
    QB:  "#fda4af",
    RB:  "#86efac",
    WR:  "#93c5fd",
    TE:  "#fdba74",
    K:   "#c4b5fd",
    DEF: "#94a3b8",
};

function pickColor(pos) {
    return PICK_COLORS[(pos || "").toUpperCase()] || "#d1d5db";
}

function avgAge(picks, pos, draftYear) {
    const sep1 = new Date(`${draftYear}-09-01`).getTime();
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const ages = picks
        .filter(p => (p.position || "").toUpperCase() === pos && p.birth_date)
        .map(p => (sep1 - new Date(p.birth_date).getTime()) / msPerYear);
    if (!ages.length) return null;
    return (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1);
}

function renderPositions(picks, year) {
    const stats = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, OTHER: 0 };
    picks.forEach(p => {
        const pos = (p.position || "OTHER").toUpperCase();
        if (stats[pos] !== undefined) stats[pos]++;
        else stats.OTHER++;
    });
    const total = picks.length || 0;
    const boxes = [
        { label:"QB",    n:stats.QB,  bg:"#fda4af", pos:"QB" },
        { label:"RB",    n:stats.RB,  bg:"#86efac", pos:"RB" },
        { label:"WR",    n:stats.WR,  bg:"#93c5fd", pos:"WR" },
        { label:"TE",    n:stats.TE,  bg:"#fdba74", pos:"TE" },
        { label:"K",     n:stats.K,   bg:"#c4b5fd", pos:"K"  },
        { label:"Total", n:total,     bg:"#ffffff",  pos:null },
    ];
    el("position-stats").innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:24px;">
            ${boxes.map(({ label, n, bg, pos }) => {
                const avg = pos ? avgAge(picks, pos, year) : null;
                return `
                <div style="background:${bg};border-radius:10px;padding:10px 12px;text-align:center;border:1px solid rgba(0,0,0,0.08);">
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:rgba(0,0,0,0.45);margin-bottom:2px;">${label}</div>
                    <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.75);">${n}</div>
                    ${avg != null ? `<div style="font-size:9px;color:rgba(0,0,0,0.4);margin-top:3px;">avg ${avg}</div>` : ""}
                </div>`;
            }).join("")}
        </div>
    `;
}

const POS_BRIGHT = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#64748b" };
const CARD_HEIGHT = 92; // fixed height for all pick cards

let tradedPicksData = [];
let allTransactions = [];

function getPickHistory(pickYear, pickRound, pickNo, pickedBy, originalOwner) {
    // Find all trades that involved this pick from transactions
    const pickName1 = `${pickYear} Round ${pickRound}`;
    const pickName2 = `${pickYear} R${pickRound}`;
    const events = [];

    (allTransactions || []).forEach(t => {
        if (t.type !== "trade") return;
        let found = false;
        Object.entries(t.assets_received || {}).forEach(([team, assets]) => {
            (assets || []).forEach(a => {
                if ((a.position || "").toUpperCase() !== "PICK") return;
                const name = (a.name || "");
                if (name.includes(pickYear) && (name.includes(`Round ${pickRound}`) || name.includes(`R${pickRound}`))) {
                    found = true;
                    events.push({ date: t.created, team, type: "received" });
                }
            });
        });
    });

    return events;
}

function renderPickCard(p, round) {
    if (!p) {
        return `<div style="height:${CARD_HEIGHT}px;background:#1a1c21;border-radius:8px;border:1px dashed #2d3139;"></div>`;
    }
    const pos = (p.position || "").toUpperCase();
    const bg = pickColor(pos);
    const posClr = POS_BRIGHT[pos] || "rgba(0,0,0,0.25)";
    const traded = p.original_owner && p.original_owner !== p.picked_by;

    return `<div class="pick-card-clickable" data-pick='${JSON.stringify({
        year: p.season || "", round: String(round), pickNo: String(p._pick_in_round || ""),
        pickedBy: p.picked_by || "", originalOwner: p.original_owner || "",
        player: p.player || "", pos, team: p.team || "",
    }).replace(/'/g, "&#39;")}' style="background:${bg};border-radius:8px;padding:9px 10px;height:${CARD_HEIGHT}px;box-sizing:border-box;display:flex;flex-direction:column;gap:3px;cursor:pointer;transition:filter 0.12s;" onmouseenter="this.style.filter='brightness(0.93)'" onmouseleave="this.style.filter=''">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
            <div style="display:flex;align-items:center;gap:5px;min-width:0;">
                <span style="background:${posClr};color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:800;letter-spacing:0.04em;flex-shrink:0;">${pos || "—"}</span>
                <span style="font-size:10px;font-weight:600;color:rgba(0,0,0,0.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.team || "—"}</span>
            </div>
            <span style="font-size:10px;font-weight:700;color:rgba(0,0,0,0.4);flex-shrink:0;">${round}.${p._pick_in_round}</span>
        </div>
        <div style="font-size:12px;font-weight:800;color:rgba(0,0,0,0.85);line-height:1.2;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeName(p.player)}</div>
        <div style="font-size:10px;color:rgba(0,0,0,0.6);">Picked by: ${safeName(p.picked_by)}</div>
        ${traded ? `<div style="font-size:10px;color:rgba(0,0,0,0.6);">Original owner: ${safeName(p.original_owner)}</div>` : ""}
    </div>`;
}

function renderDraft(picks) {
    const container = el("draft-container");
    if (!picks || !picks.length) {
        container.innerHTML = `<div class="card">No draft data found for this year.</div>`;
        return;
    }

    const grouped = {};
    picks.forEach(p => {
        const r = p.round || 0;
        if (!grouped[r]) grouped[r] = [];
        grouped[r].push(p);
    });

    const sortedRounds = Object.keys(grouped).sort((a, b) => Number(a) - Number(b));
    sortedRounds.forEach(round => {
        grouped[round]
            .sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0))
            .forEach((p, i) => { p._pick_in_round = i + 1; });
    });

    const nTeams = Math.max(...sortedRounds.map(r => grouped[r].length));

    const headerCols = Array.from({ length: nTeams }, (_, i) =>
        `<div style="text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#5a6070;padding:4px 0;">Pick ${i+1}</div>`
    ).join("");

    let html = `
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <div style="min-width:${60 + nTeams * 148}px;">
        <div style="display:grid;grid-template-columns:60px repeat(${nTeams},1fr);gap:6px;margin-bottom:4px;padding:0 2px;">
            <div></div>
            ${headerCols}
        </div>`;

    sortedRounds.forEach(round => {
        const roundPicks = grouped[round];
        const slots = Array.from({ length: nTeams }, (_, i) => roundPicks[i] || null);
        const cells = slots.map(p => `<div>${renderPickCard(p, round)}</div>`).join("");

        html += `
        <div style="display:grid;grid-template-columns:60px repeat(${nTeams},1fr);gap:6px;margin-bottom:6px;align-items:stretch;">
            <div style="display:flex;align-items:center;justify-content:center;background:#252830;border-radius:6px;font-size:11px;font-weight:700;color:#5a6070;letter-spacing:0.04em;min-height:${CARD_HEIGHT}px;">R${round}</div>
            ${cells}
        </div>`;
    });

    html += `</div></div>`;
    container.innerHTML = html;

    // Attach click handlers for pick history popover
    container.querySelectorAll(".pick-card-clickable").forEach(card => {
        card.addEventListener("click", () => {
            try {
                const data = JSON.parse(card.getAttribute("data-pick").replace(/&#39;/g, "'"));
                openPickPopover(card, data);
            } catch (e) { console.error(e); }
        });
    });
}

// Pick history popover
function ensurePickPopover() {
    if (document.getElementById("pick-popover")) return;
    const pop = document.createElement("div");
    pop.id = "pick-popover";
    pop.style.cssText = `
        display:none;position:fixed;z-index:9999;
        background:#13151a;border:1px solid #2d3139;
        border-radius:12px;width:300px;max-height:calc(100vh - 24px);
        overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.6);
        padding:0;
    `;
    document.body.appendChild(pop);
    document.addEventListener("click", e => {
        const p = document.getElementById("pick-popover");
        if (p && !e.target.closest(".pick-card-clickable") && !p.contains(e.target)) {
            p.style.display = "none";
        }
    });
}

function openPickPopover(element, data) {
    const pop = document.getElementById("pick-popover");
    if (!pop) return;

    const { year, round, pickNo, pickedBy, originalOwner, player, pos, team } = data;
    const bg = pickColor(pos);
    const posClr = POS_BRIGHT[pos] || "#5a6070";
    const traded = originalOwner && originalOwner !== pickedBy;

    // Find trade history for this pick from transactions
    const pickLabel = `${year} Round ${round}`;
    const tradeHistory = [];
    (allTransactions || []).forEach(t => {
        if (t.type !== "trade") return;
        Object.entries(t.assets_received || {}).forEach(([teamReceiver, assets]) => {
            (assets || []).forEach(a => {
                if ((a.position || "").toUpperCase() !== "PICK") return;
                const name = a.name || "";
                if (name.includes(year) && (name.includes(`Round ${round}`) || name.includes(`R${round}`))) {
                    tradeHistory.push({ date: t.created, receiver: teamReceiver });
                }
            });
        });
    });

    const historyHtml = tradeHistory.length
        ? tradeHistory.map(e =>
            `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2d3139;font-size:12px;">
                <span style="color:#f0f1f3;font-weight:600;">→ ${e.receiver}</span>
                <span style="color:#5a6070;">${e.date || ""}</span>
            </div>`
        ).join("")
        : `<div style="color:#5a6070;font-size:12px;">No trade history</div>`;

    pop.innerHTML = `
        <div style="background:${bg};padding:14px 16px;border-radius:12px 12px 0 0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <div style="font-size:10px;font-weight:700;color:rgba(0,0,0,0.45);text-transform:uppercase;letter-spacing:0.05em;">Round ${round} · Pick ${pickNo}</div>
                    <div style="font-size:16px;font-weight:800;color:rgba(0,0,0,0.85);margin-top:3px;">${player || "Unknown"}</div>
                    <div style="display:flex;align-items:center;gap:5px;margin-top:5px;">
                        <span style="background:${posClr};color:#fff;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:800;">${pos}</span>
                        <span style="font-size:11px;color:rgba(0,0,0,0.55);font-weight:600;">${team}</span>
                    </div>
                </div>
                <button onclick="document.getElementById('pick-popover').style.display='none'" style="background:rgba(0,0,0,0.1);border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;color:rgba(0,0,0,0.5);font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
            </div>
        </div>
        <div style="padding:14px 16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #2d3139;">
                <div>
                    <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Picked By</div>
                    <div style="font-size:13px;font-weight:700;color:#f0f1f3;">${pickedBy || "—"}</div>
                </div>
                ${traded ? `<div style="text-align:right;">
                    <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Original Owner</div>
                    <div style="font-size:13px;font-weight:700;color:#f0f1f3;">${originalOwner}</div>
                </div>` : ""}
            </div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;font-weight:700;margin-bottom:8px;">Trade History</div>
            ${historyHtml}
        </div>
    `;

    pop.style.display = "block";

    // Position popover
    const rect = element.getBoundingClientRect();
    const popW = 300;
    let left = rect.right + 8;
    if (left + popW > window.innerWidth - 8) left = rect.left - popW - 8;
    if (left < 8) left = 8;
    let top = rect.top;
    const estH = 300;
    if (top + estH > window.innerHeight - 12) top = window.innerHeight - estH - 12;
    if (top < 12) top = 12;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
}

async function load(year) {
    el("draft-container").innerHTML = `<div class="card" style="color:var(--text-3);">Loading ${year} draft...</div>`;
    el("position-stats").innerHTML = "";
    try {
        const picks = await api.getDraft(year);
        // Attach season to each pick for pick history lookup
        (picks || []).forEach(p => { p.season = year; });
        renderPositions(picks, year);
        renderDraft(picks);
    } catch (err) {
        console.error("Draft load error:", err);
        el("draft-container").innerHTML = `<div class="card">Failed to load draft data for ${year}.</div>`;
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    renderNav();
    ensurePickPopover();
    const select = el("yearSelect");

    // Load transactions for pick history
    try {
        allTransactions = await api.getTransactions() || [];
    } catch { allTransactions = []; }

    load(select.value);
    select.addEventListener("change", () => load(select.value));
});
