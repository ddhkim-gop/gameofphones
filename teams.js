import { api } from "./dataService.js?v=20260609a";
import { renderNav } from "./components/nav.js";
import { ensurePlayerCardPopover, openPlayerCard } from "./playerCard.js?v=20260820a";

// Data/helpers the shared player card needs, resolved from this page's caches.
function playerCardCtx() {
    return { posColor, pvLookup, posRankStr, calcAgeDecimal, statsCache, transactions: allTransactions, YEARS };
}

const YEARS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
const FUTURE_YEARS = ["2027", "2028", "2029"];
const ROUNDS = [1, 2, 3];
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

let allTransactions = [];
let playerValuesCache = {};
let playerValuesCacheNorm = {}; // normalized name → key for fuzzy lookup

function normName(n) {
    return n.toLowerCase()
        .replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')
        .replace(/[^a-z\s]/g, '')
        .trim();
}

function pvLookup(name) {
    if (playerValuesCache[name]) return playerValuesCache[name];
    const norm = normName(name);
    const key = playerValuesCacheNorm[norm];
    return key ? playerValuesCache[key] : {};
}

// ESPN team logo URL
function teamLogoUrl(abbrev) {
    if (!abbrev) return null;
    return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbrev.toLowerCase()}.png`;
}

function calcAgeDecimal(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const now = new Date();
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    return ((now - birth) / msPerYear).toFixed(1);
}
let statsCache = {};
let usersMap = {};



const POS_COLORS = {
    QB:  "#e74c82",
    RB:  "#3ecf8e",
    WR:  "#4299e1",
    TE:  "#f6ad55",
    K:   "#9f7aea",
    DEF: "#64748b",
};
function posColor(pos) { return POS_COLORS[(pos||"").toUpperCase()] || "#5a6070"; }

function playerValueScore(p) {
    // Sort by 2025 pts_half_ppr desc; fallback to 2024, then 0
    const pid = p.player_id;
    if (statsCache["2025"]?.[pid]?.pts_half_ppr > 0) return statsCache["2025"][pid].pts_half_ppr;
    if (statsCache["2024"]?.[pid]?.pts_half_ppr > 0) return statsCache["2024"][pid].pts_half_ppr;
    return 0;
}

function posRankStr(p) {
    const pid = p.player_id;
    for (const yr of ["2025", "2024", "2023"]) {
        const s = statsCache[yr]?.[pid];
        if (s?.rank > 0) return `${s.position || p.position}${s.rank}`;
    }
    return null;
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();
    ensurePlayerCardPopover();

    const container = document.getElementById("teams-container");
    container.innerHTML = `<div style="color:#8b9099;padding:20px;">Loading...</div>`;

    const [rosters, tradedPicks, leagueUsers, txData, playerValues] = await Promise.all([
        api.getRosters("2026"),
        api.getTradedPicks(),
        api.getLeagueUsers(),
        api.getTransactions(),
        api.getPlayerValues(),
    ]);
    allTransactions = txData || [];
    playerValuesCache = playerValues || {};
    playerValuesCacheNorm = {};
    for (const key of Object.keys(playerValuesCache)) {
        playerValuesCacheNorm[normName(key)] = key;
    }
    await loadPlayerStats();

    const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url; });

    // Team dropdown
    const INACTIVE_USERS_SET = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
    const activeRosters = (rosters || []).filter(r => r.owner && !INACTIVE_USERS_SET.has(r.owner))
        .sort((a,b) => a.owner.localeCompare(b.owner));
    const dropdownWrap = document.getElementById("teams-dropdown-wrap");
    if (dropdownWrap) {
        const sel = document.createElement("select");
        sel.innerHTML = `<option value="">View a team…</option>` +
            activeRosters.map(r => `<option value="${r.owner}">${r.owner}</option>`).join("");
        sel.addEventListener("change", e => {
            if (e.target.value) window.location.href = `team.html?team=${encodeURIComponent(e.target.value)}`;
        });
        dropdownWrap.appendChild(sel);
    }

    // Compute picks ownership per team
    const ownership = {};
    FUTURE_YEARS.forEach(year => {
        ownership[year] = {};
        ROUNDS.forEach(round => {
            ownership[year][round] = {};
            (rosters || []).forEach(r => {
                const name = r.owner || `Roster ${r.roster_id}`;
                ownership[year][round][name] = name;
            });
        });
    });
    (tradedPicks || []).forEach(p => {
        const year = p.season, round = p.round, original = p.original_owner_name, current = p.owner_name;
        if (ownership[year]?.[round]?.[original] !== undefined) {
            ownership[year][round][original] = current;
        }
    });
    const pickCountByTeam = {};
    FUTURE_YEARS.forEach(year => {
        ROUNDS.forEach(round => {
            Object.entries(ownership[year][round]).forEach(([, current]) => {
                pickCountByTeam[current] = (pickCountByTeam[current] || 0) + 1;
            });
        });
    });

    container.innerHTML = "";

    (rosters || []).forEach(team => {
        const ownerName = team.owner || `Roster ${team.roster_id}`;
        const card = document.createElement("div");
        card.className = "card";
        card.style.cssText = "background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:16px;";

        // Team header with avatar
        const avatarUrl = usersMap[ownerName];

        const activePlayers = (team.players || []).filter(p => p && p.name);
        const playerCount = activePlayers.length;
        const pickCount = pickCountByTeam[ownerName] || 0;

        const ages = activePlayers.map(p => {
            if (p.birth_date) {
                const birth = new Date(p.birth_date);
                return (Date.now() - birth) / (365.25 * 24 * 60 * 60 * 1000);
            }
            return p.age ? Number(p.age) : null;
        }).filter(a => a !== null);
        const avgAge = ages.length ? (ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1) : null;

        const header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #2d3139;";

        // Pick a consistent accent color from the username (same palette Sleeper uses)
        const AVATAR_COLORS_T = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
        const accentColor = AVATAR_COLORS_T[ownerName.split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS_T.length];
        const INACTIVE_USERS_T = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);

        // Build avatar element
        let avatarEl;
        if (INACTIVE_USERS_T.has(ownerName)) {
            avatarEl = document.createElement("span");
            avatarEl.style.cssText = "width:32px;height:32px;border-radius:50%;background:#3a3f4a;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#5a6070;flex-shrink:0;";
            avatarEl.textContent = ownerName[0].toUpperCase();
        } else if (avatarUrl) {
            avatarEl = document.createElement("img");
            avatarEl.src = avatarUrl;
            avatarEl.style.cssText = "width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;";
            avatarEl.addEventListener("error", () => {
                const fb = document.createElement("span");
                fb.style.cssText = `width:32px;height:32px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
                fb.textContent = ownerName[0].toUpperCase();
                avatarEl.replaceWith(fb);
            });
        } else {
            avatarEl = document.createElement("span");
            avatarEl.style.cssText = `width:32px;height:32px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
            avatarEl.textContent = ownerName[0].toUpperCase();
        }

        header.innerHTML = `
            <div style="flex:1;min-width:0;">
                <a href="team.html?team=${encodeURIComponent(ownerName)}" style="font-size:14px;font-weight:700;color:#f0f1f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:none;display:block;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='#f0f1f3'">${ownerName}</a>
                <div style="font-size:11px;color:#5a6070;margin-top:2px;">${playerCount} players · ${pickCount} picks</div>
                ${avgAge ? `<div style="font-size:11px;color:#5a6070;margin-top:1px;">avg age ${avgAge}</div>` : ""}
            </div>`;
        header.prepend(avatarEl);
        card.appendChild(header);

        // Group + sort players
        const grouped = {};
        (team.players || []).forEach(p => {
            if (!p || !p.name) return;
            const pos = p.position || "OTHER";
            if (!grouped[pos]) grouped[pos] = [];
            grouped[pos].push(p);
        });

        // Sort within each position by KTC dynasty value desc, fallback to search_rank
        Object.keys(grouped).forEach(pos => {
            grouped[pos].sort((a, b) => {
                const av = (pvLookup(a.name)?.ktc ?? 0);
                const bv = (pvLookup(b.name)?.ktc ?? 0);
                if (av !== bv) return bv - av;
                return (a.search_rank ?? 999999) - (b.search_rank ?? 999999);
            });
        });

        const sortedPos = POS_ORDER.filter(p => grouped[p])
            .concat(Object.keys(grouped).filter(p => !POS_ORDER.includes(p)));

        sortedPos.forEach(pos => {
            const divider = document.createElement("div");
            divider.className = "position-divider";
            divider.textContent = pos;
            card.appendChild(divider);

            grouped[pos].forEach(p => {
                const row = document.createElement("div");
                row.className = "player";
                row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 8px;margin-top:3px;background:#252830;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:background 0.12s,border-color 0.12s;";

                const badge = document.createElement("span");
                badge.className = "player-pos-badge";
                badge.textContent = p.position || "?";
                badge.style.background = posColor(p.position);
                badge.style.color = "#fff";
                badge.style.cssText = `background:${posColor(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 0;border-radius:4px;flex-shrink:0;letter-spacing:.02em;width:30px;text-align:center;`;

                const nameSpan = document.createElement("span");
                nameSpan.style.cssText = "font-size:13px;font-weight:600;color:#f0f1f3;flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:5px;";
                const nameText = document.createElement("span");
                nameText.textContent = p.name;
                nameText.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
                nameSpan.appendChild(nameText);
                if (p.years_exp === 0) {
                    const rookie = document.createElement("span");
                    rookie.textContent = "R";
                    rookie.style.cssText = "font-size:9px;font-weight:800;color:#fff;background:#f59e0b;border-radius:3px;padding:1px 4px;flex-shrink:0;letter-spacing:.03em;";
                    nameSpan.appendChild(rookie);
                }

                const metaSpan = document.createElement("span");
                metaSpan.style.cssText = "font-size:11px;color:#5a6070;flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:4px;";
                const ageDecimal = calcAgeDecimal(p.birth_date);
                const ageStr = ageDecimal ? ageDecimal : (p.age ? p.age : "");
                if (p.team) {
                    const logoUrl = teamLogoUrl(p.team);
                    const logoEl = document.createElement("img");
                    logoEl.src = logoUrl;
                    logoEl.style.cssText = "width:14px;height:14px;object-fit:contain;flex-shrink:0;";
                    logoEl.onerror = () => { logoEl.replaceWith(document.createTextNode(p.team)); };
                    metaSpan.appendChild(logoEl);
                }
                if (ageStr) metaSpan.appendChild(document.createTextNode(ageStr));

                row.appendChild(badge);
                row.appendChild(nameSpan);
                row.appendChild(metaSpan);

                row.addEventListener("click", (e) => { e.stopPropagation(); openPlayerCard(e.currentTarget, p, playerCardCtx()); });
                row.addEventListener("mouseenter", () => { row.style.background = "#2d3139"; row.style.borderColor = "#3d4350"; });
                row.addEventListener("mouseleave", () => { row.style.background = "#252830"; row.style.borderColor = "transparent"; });
                card.appendChild(row);
            });
        });

        container.appendChild(card);
    });
}

async function loadPlayerStats() {
    for (const year of YEARS) {
        try { statsCache[year] = await api.getPlayerStats(year); }
        catch { statsCache[year] = {}; }
    }
}

init();
