import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const PICK_BG = { QB:"#fda4af", RB:"#86efac", WR:"#93c5fd", TE:"#fdba74", K:"#c4b5fd", DEF:"#94a3b8" };
const PICK_FG = { QB:"#e74c82", RB:"#16a34a", WR:"#2563eb", TE:"#d97706", K:"#7c3aed", DEF:"#475569" };

const CARD_H = 72;
const COL_W  = 130; // px per team column

let allTransactions = [];
let leagueUsers     = [];
let playerStats     = {};   // year → { player_id: { pts_half_ppr } }
let playerNameMap   = {};   // player_name → player_id

function pickBg(pos)  { return PICK_BG[(pos||"").toUpperCase()] || "#d1d5db"; }
function pickFg(pos)  { return PICK_FG[(pos||"").toUpperCase()] || "#374151"; }

function abbrevName(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    return parts[0][0] + ". " + parts.slice(1).join(" ");
}

function avatarEl(username, size = 24) {
    const u = leagueUsers.find(u => u.username === username);
    const url = u?.avatar_url;
    const sz = size;
    const letter = (username || "?")[0].toUpperCase();
    const fallback = `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:rgba(0,0,0,0.15);display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:800;color:rgba(0,0,0,0.45);flex-shrink:0;">${letter}</span>`;
    if (!url) return fallback;
    return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='${fallback.replace(/'/g, "&#39;")}'">`;
}

// ── Positional breakdown ──────────────────────────────────────────────────────

function calcAvgAge(picks) {
    if (!picks.length) return null;
    const now = new Date();
    const ages = picks.map(p => {
        if (!p.birth_date) return null;
        const ms = now - new Date(p.birth_date);
        return ms / (365.25 * 24 * 60 * 60 * 1000);
    }).filter(a => a !== null);
    if (!ages.length) return null;
    return (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1);
}

function renderPositions(picks, year) {
    const byPos = { QB:[], RB:[], WR:[], TE:[], K:[] };
    picks.forEach(p => {
        const pos = (p.position||"").toUpperCase();
        if (byPos[pos]) byPos[pos].push(p);
    });
    const total = picks.length;

    const POSITIONS = ["QB","RB","WR","TE","K"];
    const posBoxes = POSITIONS.map(pos => ({
        label: pos,
        n: byPos[pos].length,
        age: calcAvgAge(byPos[pos]),
        bg: PICK_BG[pos],
        fg: PICK_FG[pos],
    }));
    const allAge = calcAvgAge(picks);

    const el = document.getElementById("position-stats");
    el.style.cssText = "flex:1;min-width:0;";
    el.innerHTML = `
        <div style="display:flex;gap:6px;width:100%;">
            ${posBoxes.map(({label, n, age, bg, fg}) => `
                <div style="background:${bg};border-radius:8px;padding:8px 6px;text-align:center;flex:1;min-width:0;">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(0,0,0,0.45);margin-bottom:3px;">${label}</div>
                    <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.75);line-height:1.1;">${n}</div>
                    ${age != null ? `<div style="font-size:9px;font-weight:600;color:rgba(0,0,0,0.4);margin-top:3px;">avg ${age}</div>` : ""}
                </div>`).join("")}
            <div style="background:#e2e8f0;border-radius:8px;padding:8px 6px;text-align:center;flex:1;min-width:0;">
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(0,0,0,0.35);margin-bottom:3px;">Total</div>
                <div style="font-size:20px;font-weight:800;color:rgba(0,0,0,0.6);line-height:1.1;">${total}</div>
                ${allAge != null ? `<div style="font-size:9px;font-weight:600;color:rgba(0,0,0,0.35);margin-top:3px;">avg ${allAge}</div>` : ""}
            </div>
        </div>`;
}

// ── Pick card ─────────────────────────────────────────────────────────────────

function renderPickCard(p, roundNum) {
    if (!p) {
        return `<div style="height:${CARD_H}px;background:#1a1c21;border-radius:8px;border:1px dashed #2d3139;box-sizing:border-box;"></div>`;
    }

    const pos     = (p.position || "").toUpperCase();
    const bg      = pickBg(pos);
    const fg      = pickFg(pos);
    const traded  = p.original_owner && p.original_owner !== p.picked_by;
    const label   = `${roundNum}.${p._pick_in_round}`;
    const name    = abbrevName(p.player);

    // pts from player stats
    const pid  = playerNameMap[p.player];
    const pts  = pid && playerStats[pid] ? playerStats[pid].pts_half_ppr : null;
    const ptsStr = pts != null ? ` · ${Math.round(pts)}` : "";

    return `<div class="pick-card" data-pick='${JSON.stringify({
        round: String(roundNum), pickNo: String(p._pick_in_round),
        pickedBy: p.picked_by||"", originalOwner: p.original_owner||"",
        player: p.player||"", pos, team: p.team||"", label,
        year: p.season||"",
    }).replace(/'/g,"&#39;")}' style="
        background:${bg};border-radius:8px;padding:7px 8px;
        height:${CARD_H}px;box-sizing:border-box;
        display:flex;flex-direction:column;gap:3px;
        cursor:pointer;transition:filter .12s;
    " onmouseenter="this.style.filter='brightness(.9)'" onmouseleave="this.style.filter=''">

        <!-- Row 1: name (left) + pick number (right) -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:4px;">
            <div style="font-size:12px;font-weight:800;color:rgba(0,0,0,.85);line-height:1.2;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${name}</div>
            <div style="font-size:9px;font-weight:700;color:rgba(0,0,0,0.38);letter-spacing:.02em;flex-shrink:0;white-space:nowrap;">${label}</div>
        </div>

        <!-- Row 2: pos badge + NFL team -->
        <div style="display:flex;align-items:center;gap:4px;">
            <span style="background:${fg};color:#fff;border-radius:3px;padding:1px 5px;
                         font-size:8px;font-weight:800;letter-spacing:.04em;flex-shrink:0;">${pos||"—"}</span>
            <span style="font-size:9px;color:rgba(0,0,0,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${p.team||""}${ptsStr}
            </span>
        </div>

        <!-- Row 3: picker avatar + name (bottom), with → if traded -->
        <div style="margin-top:auto;display:flex;align-items:center;gap:4px;min-width:0;">
            ${traded ? `<span style="font-size:10px;color:rgba(0,0,0,.4);flex-shrink:0;font-weight:700;">→</span>` : ""}
            ${avatarEl(p.picked_by, 14)}
            <span style="font-size:9px;color:rgba(0,0,0,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
                ${p.picked_by||"—"}
            </span>
        </div>
    </div>`;
}

// ── Main board ────────────────────────────────────────────────────────────────

function renderDraft(picks) {
    const container = document.getElementById("draft-container");
    if (!picks || !picks.length) {
        container.innerHTML = `<div class="card">No draft data found.</div>`;
        return;
    }

    // Group by round
    const byRound = {};
    picks.forEach(p => {
        const r = p.round || 0;
        if (!byRound[r]) byRound[r] = [];
        byRound[r].push(p);
    });
    const rounds = Object.keys(byRound).map(Number).sort((a,b) => a-b);

    // Sort each round by pick_no; assign _pick_in_round
    rounds.forEach(r => {
        byRound[r].sort((a,b) => (a.pick_no||0)-(b.pick_no||0));
        byRound[r].forEach((p,i) => { p._pick_in_round = i+1; });
    });

    const nTeams = Math.max(...rounds.map(r => byRound[r].length));

    // Column order = original owners of round-1 picks, in pick order
    const round1 = (byRound[1] || []).slice().sort((a,b) => (a.pick_no||0)-(b.pick_no||0));
    const colTeams = round1.map(p => p.original_owner || p.picked_by);

    // Build grid: grid[round][col] = pick  (snake draft)
    const grid = {};
    rounds.forEach(r => {
        grid[r] = new Array(nTeams).fill(null);
        byRound[r].forEach(p => {
            const i   = p._pick_in_round - 1;                     // 0-indexed position within round
            const col = r % 2 === 1 ? i : (nTeams - 1 - i);      // snake: even rounds reverse
            grid[r][col] = p;
        });
    });

    // ── Column headers ──────────────────────────────────────────────────────
    const headerCells = colTeams.map(team => {
        const u = leagueUsers.find(u => u.username === team);
        const url = u?.avatar_url;
        const letterDiv = `<div style="width:36px;height:36px;border-radius:50%;background:#252830;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#5a6070;">${(team||"?")[0].toUpperCase()}</div>`;
        const avatarHtml = url
            ? `<img src="${url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #2d3139;" onerror="this.outerHTML='${letterDiv.replace(/'/g,"&#39;")}'">`
            : letterDiv;
        return `
            <div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:10px 4px 8px;">
                ${avatarHtml}
                <div style="font-size:10px;font-weight:700;color:#c9cdd4;text-align:center;
                            max-width:${COL_W-8}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${team||"—"}
                </div>
            </div>`;
    }).join("");

    // ── Rows ────────────────────────────────────────────────────────────────
    const rowsHtml = rounds.map(r => {
        const cells = Array.from({length: nTeams}, (_,c) => `<div>${renderPickCard(grid[r][c], r)}</div>`).join("");
        return `
            <div style="display:grid;grid-template-columns:40px repeat(${nTeams},${COL_W}px);gap:5px;margin-bottom:5px;align-items:stretch;">
                <div style="display:flex;align-items:center;justify-content:center;
                            background:#252830;border-radius:6px;font-size:10px;font-weight:700;
                            color:#5a6070;letter-spacing:.04em;min-height:${CARD_H}px;">
                    R${r}
                </div>
                ${cells}
            </div>`;
    }).join("");

    container.innerHTML = `
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px;">
            <div style="min-width:${40 + nTeams * (COL_W + 5)}px;">
                <div style="display:grid;grid-template-columns:40px repeat(${nTeams},${COL_W}px);gap:5px;margin-bottom:2px;">
                    <div></div>
                    ${headerCells}
                </div>
                ${rowsHtml}
            </div>
        </div>`;

    // Click → popover
    container.querySelectorAll(".pick-card").forEach(card => {
        card.addEventListener("click", () => {
            try { openPickPopover(card, JSON.parse(card.getAttribute("data-pick").replace(/&#39;/g,"'"))); }
            catch(e) { console.error(e); }
        });
    });
}

// ── Popover ───────────────────────────────────────────────────────────────────

function ensurePickPopover() {
    if (document.getElementById("pick-popover")) return;
    const pop = document.createElement("div");
    pop.id = "pick-popover";
    pop.style.cssText = `display:none;position:fixed;z-index:9999;background:#13151a;border:1px solid #2d3139;border-radius:12px;width:300px;max-height:min(480px,calc(100vh - 32px));overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,.6);`;
    document.body.appendChild(pop);
    document.addEventListener("click", e => {
        const p = document.getElementById("pick-popover");
        if (p && !e.target.closest(".pick-card") && !p.contains(e.target)) p.style.display = "none";
    });
}

function openPickPopover(el, data) {
    const pop = document.getElementById("pick-popover");
    if (!pop) return;
    const { round, pickNo, pickedBy, originalOwner, player, pos, team, label, year } = data;
    const bg = pickBg(pos);
    const fg = pickFg(pos);
    const traded = originalOwner && originalOwner !== pickedBy;

    // Trade history: only trades where this specific pick changed hands.
    // Match on year + round in asset name, and at least one team is originalOwner or pickedBy.
    const relevantTeams = new Set([originalOwner, pickedBy].filter(Boolean));
    const tradeHistory = [];
    (allTransactions||[]).forEach(t => {
        if (t.type !== "trade") return;
        // Must involve at least one known owner of this pick
        if (!t.teams.some(tm => relevantTeams.has(tm))) return;
        Object.entries(t.assets_received||{}).forEach(([receiver, assets]) => {
            (assets||[]).forEach(a => {
                if ((a.position||"").toUpperCase() !== "PICK") return;
                const n = a.name||"";
                // Match year (if present in name) and round
                const matchesYear = !year || n.includes(year);
                const matchesRound = n.includes(`Round ${round}`) || n.match(new RegExp(`R${round}\\b`));
                if (matchesYear && matchesRound) {
                    tradeHistory.push({ receiver, date: t.created });
                }
            });
        });
    });

    pop.innerHTML = `
        <div style="background:${bg};padding:14px 16px;border-radius:12px 12px 0 0;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                <div>
                    <div style="font-size:10px;font-weight:700;color:rgba(0,0,0,.4);text-transform:uppercase;letter-spacing:.05em;">Pick ${label}</div>
                    <div style="font-size:16px;font-weight:800;color:rgba(0,0,0,.85);margin-top:3px;">${player||"Unknown"}</div>
                    <div style="display:flex;align-items:center;gap:5px;margin-top:5px;">
                        <span style="background:${fg};color:#fff;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:800;">${pos}</span>
                        <span style="font-size:11px;color:rgba(0,0,0,.55);font-weight:600;">${team}</span>
                    </div>
                </div>
                <button onclick="document.getElementById('pick-popover').style.display='none'"
                    style="background:rgba(0,0,0,.1);border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;color:rgba(0,0,0,.5);font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
            </div>
        </div>
        <div style="padding:14px 16px;">
            <div style="display:flex;gap:16px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #2d3139;">
                <div>
                    <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Picked By</div>
                    <div style="display:flex;align-items:center;gap:6px;">${avatarEl(pickedBy,20)}<span style="font-size:13px;font-weight:700;color:#f0f1f3;">${pickedBy||"—"}</span></div>
                </div>
                ${traded ? `<div>
                    <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Original Owner</div>
                    <div style="display:flex;align-items:center;gap:6px;">${avatarEl(originalOwner,20)}<span style="font-size:13px;font-weight:700;color:#f0f1f3;">${originalOwner}</span></div>
                </div>` : ""}
            </div>
            ${tradeHistory.length ? `
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;font-weight:700;margin-bottom:8px;">Trade History</div>
            ${tradeHistory.map(e => `
                <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2d3139;font-size:12px;">
                    <span style="color:#f0f1f3;font-weight:600;">→ ${e.receiver}</span>
                    <span style="color:#5a6070;">${e.date||""}</span>
                </div>`).join("")}` : ""}
        </div>`;

    pop.style.display = "block";
    const rect = el.getBoundingClientRect();
    const popW = 300;
    const popH = Math.min(480, window.innerHeight - 32);
    let left = rect.right + 8;
    if (left + popW > window.innerWidth - 8) left = rect.left - popW - 8;
    if (left < 8) left = 8;
    let top = rect.top;
    if (top + popH > window.innerHeight - 12) top = window.innerHeight - popH - 12;
    if (top < 12) top = 12;
    pop.style.left = `${left}px`;
    pop.style.top  = `${top}px`;
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function load(year) {
    document.getElementById("draft-container").innerHTML = `<div class="card" style="color:var(--text-3);">Loading ${year} draft...</div>`;
    document.getElementById("position-stats").innerHTML = "";
    try {
        const picks = await api.getDraft(year);
        (picks||[]).forEach(p => { p.season = year; });

        // Load player stats for this year if available (2023-2025)
        if (["2023","2024","2025"].includes(year)) {
            const [stats, nameMap] = await Promise.all([
                api.getPlayerStats(year).catch(()=>({})),
                api.getPlayerNameMap().catch(()=>({})),
            ]);
            playerStats   = stats || {};
            playerNameMap = nameMap || {};
        } else {
            playerStats   = {};
            playerNameMap = {};
        }

        renderPositions(picks, year);
        renderDraft(picks);
    } catch(err) {
        console.error("Draft load error:", err);
        document.getElementById("draft-container").innerHTML = `<div class="card">Failed to load draft data for ${year}.</div>`;
    }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    renderNav();
    ensurePickPopover();

    try { allTransactions = await api.getTransactions() || []; } catch { allTransactions = []; }
    try { leagueUsers     = await api.getLeagueUsers()  || []; } catch { leagueUsers = []; }

    const select = document.getElementById("yearSelect");
    load(select.value);
    select.addEventListener("change", () => load(select.value));
});
