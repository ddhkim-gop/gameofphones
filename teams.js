import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const YEARS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
const FUTURE_YEARS = ["2027", "2028", "2029"];
const ROUNDS = [1, 2, 3];
const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

let allTransactions = [];

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
const espnIdCache = {};

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
    ensurePopover();

    const container = document.getElementById("teams-container");
    container.innerHTML = `<div style="color:#8b9099;padding:20px;">Loading...</div>`;

    const [rosters, tradedPicks, leagueUsers, txData] = await Promise.all([
        api.getRosters("2026"),
        api.getTradedPicks(),
        api.getLeagueUsers(),
        api.getTransactions(),
    ]);
    allTransactions = txData || [];
    await loadPlayerStats();

    const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.username === "Paul_Yoon" ? PAUL_YOON_AVATAR : u.avatar_url; });

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
        const AVATAR_COLORS = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
        const accentColor = AVATAR_COLORS[ownerName.split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];

        // Build avatar via DOM (never via innerHTML) so styles are never re-parsed
        const avatarEl = document.createElement(avatarUrl ? "img" : "span");
        avatarEl.style.cssText = "width:32px;height:32px;border-radius:50%;flex-shrink:0;";
        if (avatarUrl) {
            avatarEl.src = avatarUrl;
            avatarEl.style.objectFit = "cover";
            avatarEl.addEventListener("error", () => {
                const fb = document.createElement("span");
                fb.style.cssText = `width:32px;height:32px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
                fb.textContent = ownerName[0].toUpperCase();
                avatarEl.replaceWith(fb);
            });
        } else {
            avatarEl.style.cssText = `width:32px;height:32px;border-radius:50%;background:${accentColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;`;
            avatarEl.textContent = ownerName[0].toUpperCase();
        }

        header.innerHTML = `
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ownerName}</div>
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

        // Sort within each position by search_rank (ADP proxy), fallback to value score
        Object.keys(grouped).forEach(pos => {
            grouped[pos].sort((a, b) => {
                const ra = a.search_rank ?? 999999;
                const rb = b.search_rank ?? 999999;
                if (ra !== rb) return ra - rb;
                return playerValueScore(b) - playerValueScore(a);
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
                badge.style.cssText = `background:${posColor(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;flex-shrink:0;letter-spacing:.02em;`;

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

                row.addEventListener("click", (e) => { e.stopPropagation(); openPopover(e.currentTarget, p); });
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

function ensurePopover() {
    if (document.getElementById("player-popover")) return;
    const pop = document.createElement("div");
    pop.id = "player-popover";
    // Outer: fixed container, no overflow (keeps close button from scrolling)
    // Inner: scrollable body
    pop.innerHTML = `
        <button id="popover-close" onclick="document.getElementById('player-popover').style.display='none'"
            style="position:absolute;top:10px;right:10px;z-index:10;
                   background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);
                   color:#8b9099;width:26px;height:26px;border-radius:50%;cursor:pointer;
                   font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
        <div id="popover-body" style="font-size:13px;line-height:1.5;overflow-y:auto;min-height:0;flex:1;border-radius:12px;"></div>`;
    pop.style.cssText = `
        position:fixed;z-index:9999;
        background:#13151a;border:1px solid #2d3139;
        border-radius:12px;overflow:hidden;
        flex-direction:column;
        box-shadow:0 10px 40px rgba(0,0,0,0.6);
    `;
    pop.style.display = "none";
    document.body.appendChild(pop);

    document.addEventListener("click", (e) => {
        const pop = document.getElementById("player-popover");
        if (pop && !e.target.closest(".player") && !pop.contains(e.target)) {
            pop.style.display = "none";
        }
    });
}

function formatDate(str) {
    if (!str) return "";
    return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function lookupEspnId(name) {
    if (espnIdCache[name] !== undefined) return espnIdCache[name];
    try {
        const r = await fetch(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=athlete&sport=football`);
        const d = await r.json();
        const items = d.items || [];
        const match = items.find(i => i.displayName?.toLowerCase() === name.toLowerCase()) || items[0];
        const id = match?.id ? Number(match.id) : null;
        espnIdCache[name] = id;
        return id;
    } catch {
        espnIdCache[name] = null;
        return null;
    }
}

function renderNews(articles, injuries, playerName) {
    // Filter articles to only those mentioning the player by (last) name
    const lastName = playerName ? playerName.split(" ").slice(-1)[0].toLowerCase() : null;
    const relevant = lastName
        ? articles.filter(a => {
            const text = ((a.headline || "") + " " + (a.description || "")).toLowerCase();
            return text.includes(lastName);
          })
        : articles;
    // Fall back to all articles if filtering leaves nothing
    const filtered = relevant.length > 0 ? relevant : articles;
    let html = "";

    injuries.forEach(inj => {
        html += `<div class="pc-news-item">
            <div class="pc-news-headline" style="color:#fbbf24;">⚠ ${inj.shortComment || "Injury Update"}</div>
            ${inj.longComment ? `<div class="pc-news-impact"><span class="pc-impact-label">Impact:</span> ${inj.longComment}</div>` : ""}
            <div class="pc-news-date">${formatDate(inj.date)}</div>
        </div>`;
    });

    if (injuries.length && articles.length) {
        html += `<hr style="border:none;border-top:1px solid #2d3139;margin:10px 0;">`;
    }

    filtered.slice(0, 5).forEach(a => {
        html += `<div class="pc-news-item">
            <div class="pc-news-headline">${a.headline || ""}</div>
            ${a.description ? `<div class="pc-news-impact"><span class="pc-impact-label">Impact:</span> ${a.description}</div>` : ""}
            <div class="pc-news-date">${formatDate(a.published)}</div>
        </div>`;
    });

    if (!html) return `<div style="color:#5a6070;font-size:12px;">No recent news</div>`;
    return html;
}

function positionPopover(popover, element) {
    const isMobile = window.innerWidth < 600;

    if (isMobile) {
        // CSS handles centering via media query — clear any JS-set overrides
        popover.style.left = "";
        popover.style.top = "";
        popover.style.transform = "";
        popover.style.width = "";
        popover.style.maxHeight = "";
        return;
    }

    // Desktop: anchor to clicked element
    const rect = element.getBoundingClientRect();
    const popW = 370;
    popover.style.width = `${popW}px`;
    popover.style.transform = "";

    // Horizontal: prefer right, fall back to left
    let left = rect.right + 12;
    if (left + popW > window.innerWidth - 8) left = rect.left - popW - 12;
    if (left < 8) left = 8;

    // Vertical: clamp so it fits within viewport
    const maxH = Math.min(window.innerHeight - 48, 600);
    popover.style.maxHeight = `${maxH}px`;
    let top = rect.top;
    if (top + maxH > window.innerHeight - 12) top = window.innerHeight - maxH - 12;
    if (top < 12) top = 12;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

async function openPopover(element, player) {
    const popover = document.getElementById("player-popover");
    const body = document.getElementById("popover-body");
    if (!popover || !body) return;

    const pid = player.player_id;
    const pos = player.position || "";
    const posClr = posColor(pos);
    const heightStr = player.height
        ? `${Math.floor(Number(player.height) / 12)}'${Number(player.height) % 12}"`
        : "—";

    const headshotUrl = player.espn_id
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espn_id}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;

    // Transaction history for this player
    const playerTxRows = [];
    (allTransactions || []).forEach(t => {
        if (t.type !== "waiver" && t.type !== "free_agent" && t.type !== "trade") return;
        const playerName = player.name;
        let action = "", team = "";
        if (t.type === "trade") {
            Object.entries(t.assets_received || {}).forEach(([rcvTeam, assets]) => {
                if ((assets || []).some(a => a.name === playerName)) {
                    action = "trade → "; team = rcvTeam;
                }
            });
        } else {
            if ((t.added || []).some(a => a.name === playerName)) {
                action = t.type === "waiver" ? "waiver ↑" : "FA ↑";
                team = (t.teams || [])[0] || "";
            } else if ((t.dropped || []).some(a => a.name === playerName)) {
                action = "dropped ↓";
                team = (t.teams || [])[0] || "";
            }
        }
        if (action) playerTxRows.push({ date: t.created || "", action, team, season: t.season || "" });
    });
    playerTxRows.sort((a, b) => a.date.localeCompare(b.date));

    const txHistoryHtml = playerTxRows.length
        ? playerTxRows.map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #2d3139;font-size:11px;">
                <span style="color:#f0f1f3;font-weight:600;">${r.action} <span style="color:#8b9099;font-weight:400;">${r.team}</span></span>
                <span style="color:#5a6070;">${r.date}</span>
            </div>`).join("")
        : `<div style="color:#5a6070;font-size:12px;">No transaction history</div>`;

    body.innerHTML = `
        <style>
            .pc-header { background:linear-gradient(135deg,#1e2027 0%,#252830 100%); padding:16px; border-radius:12px 12px 0 0; display:flex; gap:12px; align-items:center; position:relative; border-bottom:1px solid #2d3139; }
            .pc-close { position:absolute;top:10px;right:10px; background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1); color:#8b9099;width:26px;height:26px;border-radius:50%;cursor:pointer; font-size:13px;display:flex;align-items:center;justify-content:center; }
            .pc-close:hover { background:rgba(255,255,255,0.15);color:#f0f1f3; }
            .pc-headshot { width:68px;height:68px;border-radius:50%;object-fit:cover;border:2px solid ${posClr};flex-shrink:0;background:#252830; }
            .pc-name { color:#f0f1f3;font-size:17px;font-weight:800;margin-bottom:5px;line-height:1.2; }
            .pc-sub { color:#8b9099;font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap; }
            .pc-pos-badge { background:${posClr};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px; }
            .pc-bio { display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #2d3139;background:#1e2027; }
            .pc-bio-item { padding:10px 6px;text-align:center;border-right:1px solid #2d3139;overflow:hidden; }
            .pc-bio-item:last-child { border-right:none; }
            .pc-bio-label { font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:3px;white-space:nowrap; }
            .pc-bio-val { font-size:13px;font-weight:700;color:#f0f1f3;white-space:nowrap; }
            .pc-section { padding:12px 16px;border-bottom:1px solid #2d3139;background:#13151a; }
            .pc-section:last-child { border-bottom:none;border-radius:0 0 12px 12px; }
            .pc-section-title { font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:10px;font-weight:700; }
            .pc-stats-table { width:100%;border-collapse:collapse;font-size:11px; }
            .pc-stats-table th { color:#5a6070;text-align:center;padding:4px 6px;border-bottom:1px solid #2d3139;font-weight:600; }
            .pc-stats-table td { text-align:center;padding:5px 6px;border-bottom:1px solid #2d3139;color:#c9cdd4; }
            .pc-stats-table td:first-child { text-align:left;font-weight:600;color:#f0f1f3; }
            .pc-stats-table tr:last-child td { font-weight:700;background:#1e2027;color:#f0f1f3; }
            .pc-news-item { margin-bottom:14px; }
            .pc-news-item:last-child { margin-bottom:0; }
            .pc-news-headline { font-size:13px;font-weight:700;color:#f0f1f3;margin-bottom:4px;line-height:1.4; }
            .pc-news-impact { font-size:12px;color:#8b9099;line-height:1.5;margin-bottom:3px; }
            .pc-impact-label { font-weight:700;color:#5a6070;text-transform:uppercase;font-size:10px;letter-spacing:.04em;margin-right:4px; }
            .pc-news-date { font-size:10px;color:#5a6070; }
        </style>

        <div class="pc-header" style="padding-right:42px;"><!-- close btn is outside scroll area -->
            <img class="pc-headshot" src="${headshotUrl}"
                onerror="this.src='https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg'" />
            <div style="flex:1;min-width:0;">
                <div class="pc-name">${player.name}</div>
                <div class="pc-sub">
                    <span class="pc-pos-badge">${pos}</span>
                    <span>${player.team || ""}</span>
                    ${player.birth_date || player.age ? `<span>· Age ${calcAgeDecimal(player.birth_date) || player.age}</span>` : ""}
                    ${player.college ? `<span>· ${player.college}</span>` : ""}
                </div>
            </div>
        </div>

        <div class="pc-bio">
            <div class="pc-bio-item"><div class="pc-bio-label">Rank</div><div class="pc-bio-val" style="color:${posClr};">${posRankStr(player) ?? "—"}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Age</div><div class="pc-bio-val">${calcAgeDecimal(player.birth_date) ?? player.age ?? "—"}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Height</div><div class="pc-bio-val">${heightStr}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Weight</div><div class="pc-bio-val">${player.weight ? player.weight + " lbs" : "—"}</div></div>
        </div>

        <div class="pc-section" id="espn-stats-rank-placeholder"></div>

        <div class="pc-section" id="espn-stats">
            <div class="pc-section-title">Career Stats</div>
            <div style="color:#5a6070;font-size:12px;">Loading...</div>
        </div>

        <div class="pc-section" id="espn-news">
            <div class="pc-section-title">Latest News</div>
            <div style="color:#5a6070;font-size:12px;">Loading...</div>
        </div>

        <div class="pc-section">
            <div class="pc-section-title">Transaction History</div>
            ${txHistoryHtml}
        </div>
    `;

    popover.style.display = "flex";
    positionPopover(popover, element);

    const espnId = player.espn_id || await lookupEspnId(player.name);

    if (!espnId) {
        const rp = document.getElementById("espn-stats-rank-placeholder");
        if (rp) rp.remove();
        document.getElementById("espn-stats").innerHTML = `<div class="pc-section-title">Career Stats</div><div style="color:#5a6070;font-size:12px;">Not available</div>`;
        document.getElementById("espn-news").innerHTML = `<div class="pc-section-title">Latest News</div><div style="color:#5a6070;font-size:12px;">Not available</div>`;
        return;
    }

    if (!player.espn_id && espnId) {
        const img = popover.querySelector(".pc-headshot");
        if (img) img.src = `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
    }

    try {
        const [statsData, newsData, athleteData] = await Promise.all([
            fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}/stats`).then(r => r.json()),
            fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?athlete=${espnId}`).then(r => r.json()),
            fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`).then(r => r.json()),
        ]);

        const statsEl = document.getElementById("espn-stats");
        const categories = statsData.categories || [];
        const catPriority = { QB:"Passing", RB:"Rushing", WR:"Receiving", TE:"Receiving", K:"Scoring" };
        const cat = categories.find(c => c.displayName === catPriority[pos]) || categories[0];

        // Build a map of season year → position rank from local statsCache
        const rankByYear = {};
        for (const yr of YEARS) {
            const stat = statsCache?.[yr]?.[pid];
            if (stat?.rank > 0) rankByYear[yr] = `${stat.position || p.position}${stat.rank}`;
        }

        // Remove the rank placeholder div now that we have data
        const rankPlaceholder = document.getElementById("espn-stats-rank-placeholder");
        if (rankPlaceholder) rankPlaceholder.remove();

        if (cat && cat.statistics?.length) {
            const keyStats = { QB:[0,2,4,6,7,10], RB:[0,1,2,4,5,6], WR:[0,1,2,3,4,5], TE:[0,1,2,3,4,5], K:[0,1,2,3] };
            const indices = keyStats[pos] || [0,1,2,3,4];
            const labels = indices.map(i => cat.labels?.[i]).filter(Boolean);
            const seasons = [...cat.statistics].reverse().slice(0, 8);
            const rows = seasons.map(s => {
                const yr = s.season?.year ? String(s.season.year) : "";
                const rank = rankByYear[yr] ? `<td style="font-weight:700;color:#f0f1f3;">${rankByYear[yr]}</td>` : `<td style="color:#5a6070;">—</td>`;
                const vals = indices.map(i => s.stats?.[i] ?? "—").join("</td><td>");
                return `<tr><td>${s.season?.displayName ?? ""}</td>${rank}<td>${vals}</td></tr>`;
            }).join("");
            const totals = indices.map(i => cat.totals?.[i] ?? "—").join("</td><td>");

            statsEl.innerHTML = `
                <div class="pc-section-title">${cat.displayName} — Career</div>
                <div style="overflow-x:auto;">
                    <table class="pc-stats-table">
                        <thead><tr><th style="text-align:left;">Year</th><th>Rank</th>${labels.map(l => `<th>${l}</th>`).join("")}</tr></thead>
                        <tbody>${rows}<tr><td>Career</td><td>—</td><td>${totals}</td></tr></tbody>
                    </table>
                </div>`;
        } else {
            statsEl.innerHTML = `<div class="pc-section-title">Career Stats</div><div style="color:#5a6070;font-size:12px;">No stats available</div>`;
        }

        const articles = newsData.articles || [];
        const injuries = athleteData.athlete?.injuries || [];
        document.getElementById("espn-news").innerHTML = `
            <div class="pc-section-title">Latest News</div>
            ${renderNews(articles, injuries, player.name)}`;

        // Re-clamp position after content loaded (height changed)
        positionPopover(popover, element);

    } catch (e) {
        console.error("ESPN fetch error:", e);
        document.getElementById("espn-stats").innerHTML = `<div class="pc-section-title">Career Stats</div><div style="color:#5a6070;font-size:12px;">Failed to load</div>`;
        document.getElementById("espn-news").innerHTML = `<div class="pc-section-title">Latest News</div><div style="color:#5a6070;font-size:12px;">Failed to load</div>`;
    }
}

init();
