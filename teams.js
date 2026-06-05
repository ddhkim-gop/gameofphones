import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const YEARS = ["2023", "2024", "2025", "2026"];
let statsCache = {};
const espnIdCache = {};

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();
    ensurePopover();

    const container = document.getElementById("teams-container");
    container.innerHTML = "Loading...";

    const rosters = await api.getRosters("2026");
    await loadPlayerStats();

    container.innerHTML = "";

    (rosters || []).forEach(team => {
        const card = document.createElement("div");
        card.className = "card";

        const title = document.createElement("h3");
        title.textContent = team.owner || `Roster ${team.roster_id}`;
        card.appendChild(title);

        (team.players || []).forEach(p => {
            if (!p || !p.name) return;

            const row = document.createElement("div");
            row.className = "player";
            row.innerHTML = `
                <span>${p.name}</span>
                <span>${p.position || ""}</span>
            `;

            row.addEventListener("click", (e) => {
                openPopover(e.currentTarget, p);
            });

            card.appendChild(row);
        });

        container.appendChild(card);
    });
}

async function loadPlayerStats() {
    for (const year of YEARS) {
        try {
            statsCache[year] = await api.getPlayerStats(year);
        } catch {
            statsCache[year] = {};
        }
    }
}

function ensurePopover() {
    if (document.getElementById("player-popover")) return;

    const pop = document.createElement("div");
    pop.id = "player-popover";
    pop.innerHTML = `<div id="popover-body"></div>`;
    document.body.appendChild(pop);

    document.addEventListener("click", (e) => {
        const popover = document.getElementById("player-popover");
        if (!popover) return;
        const clickedPlayer = e.target.closest(".player");
        const clickedPopover = popover.contains(e.target);
        if (!clickedPlayer && !clickedPopover) {
            popover.style.display = "none";
        }
    });
}

function posColor(pos) {
    const colors = { QB: "#e74c3c", RB: "#2ecc71", WR: "#3498db", TE: "#f39c12", K: "#9b59b6" };
    return colors[pos] || "#95a5a6";
}

function statusBadge(status, injury) {
    if (!injury && (!status || status === "Active")) return "";
    const s = injury || status;
    const color = s === "Questionable" ? "#f39c12" : s === "Out" ? "#e74c3c" : s === "IR" ? "#c0392b" : "#95a5a6";
    return `<span style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:8px;">${s}</span>`;
}

function formatDate(str) {
    if (!str) return "";
    return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function lookupEspnId(name) {
    if (espnIdCache[name] !== undefined) return espnIdCache[name];
    try {
        const r = await fetch(
            `https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=athlete&sport=football`
        );
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

async function openPopover(element, player) {
    const popover = document.getElementById("player-popover");
    const body = document.getElementById("popover-body");
    if (!popover || !body) return;

    const pid = player.player_id;
    const pos = player.position || "";
    const posClr = posColor(pos);
    const heightStr = player.height
        ? `${Math.floor(Number(player.height) / 12)}'${Number(player.height) % 12}"`
        : "-";

    const headshotUrl = player.espn_id
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espn_id}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;

    // PPR rank history — only years with pts > 0
    let historyRows = "";
    for (const year of YEARS) {
        const stat = statsCache?.[year]?.[pid];
        if (stat && stat.pts_half_ppr > 0) {
            historyRows += `
                <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:12px;">
                    <span style="color:#6b7280;width:40px;">${year}</span>
                    <span style="font-weight:600;">${stat.position}${stat.rank}</span>
                    <span style="color:#374151;">${stat.pts_half_ppr?.toFixed(1) ?? 0} pts</span>
                </div>
            `;
        }
    }

    body.innerHTML = `
        <style>
            #player-popover {
                width: 360px;
                max-height: 85vh;
                overflow-y: auto;
                padding: 0 !important;
                border-radius: 12px !important;
            }
            .pc-header {
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                padding: 16px;
                border-radius: 12px 12px 0 0;
                display: flex;
                gap: 12px;
                align-items: center;
            }
            .pc-headshot {
                width: 72px; height: 72px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid ${posClr};
                flex-shrink: 0;
                background: #2d3748;
            }
            .pc-name { color: #fff; font-size: 17px; font-weight: 800; margin-bottom: 4px; }
            .pc-sub { color: #9ca3af; font-size: 12px; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
            .pc-pos-badge { background:${posClr}; color:#fff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; }
            .pc-bio {
                display: grid; grid-template-columns: repeat(4,1fr);
                border-bottom: 1px solid #e5e7eb;
            }
            .pc-bio-item { padding:10px 6px; text-align:center; border-right:1px solid #e5e7eb; overflow:hidden; }
            .pc-bio-item:last-child { border-right:none; }
            .pc-bio-label { font-size:9px; text-transform:uppercase; letter-spacing:0.05em; color:#9ca3af; margin-bottom:2px; white-space:nowrap; }
            .pc-bio-val { font-size:12px; font-weight:700; color:#111827; white-space:nowrap; }
            .pc-section { padding:12px 16px; border-bottom:1px solid #e5e7eb; }
            .pc-section-title { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#9ca3af; margin-bottom:8px; font-weight:700; }
            .pc-stats-table { width:100%; border-collapse:collapse; font-size:11px; }
            .pc-stats-table th { color:#9ca3af; text-align:center; padding:4px 6px; border-bottom:1px solid #f3f4f6; font-weight:600; }
            .pc-stats-table td { text-align:center; padding:5px 6px; border-bottom:1px solid #f3f4f6; }
            .pc-stats-table td:first-child { text-align:left; font-weight:600; color:#374151; }
            .pc-stats-table tr:last-child td { font-weight:700; background:#f9fafb; }
            .pc-news-item { margin-bottom:12px; }
            .pc-news-headline { font-size:13px; font-weight:700; color:#111827; margin-bottom:3px; line-height:1.4; }
            .pc-news-desc { font-size:12px; color:#6b7280; line-height:1.5; }
            .pc-news-date { font-size:10px; color:#9ca3af; margin-top:3px; }
            .pc-injury-short { font-size:12px; font-weight:600; color:#111827; margin-bottom:3px; line-height:1.4; }
            .pc-injury-long { font-size:11px; color:#6b7280; line-height:1.5; }
        </style>

        <button onclick="document.getElementById('player-popover').style.display='none'" style="position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.15);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;z-index:1;">✕</button>
        <div class="pc-header" style="position:relative;">
            <img class="pc-headshot" src="${headshotUrl}"
                onerror="this.src='https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg'" />
            <div style="flex:1;min-width:0;">
                <div class="pc-name">${player.name}${statusBadge(player.status, player.injury_status)}</div>
                <div class="pc-sub">
                    <span class="pc-pos-badge">${pos}</span>
                    <span>${player.team || ""}</span>
                    ${player.college ? `<span>• ${player.college}</span>` : ""}
                </div>
            </div>
        </div>

        <div class="pc-bio">
            <div class="pc-bio-item"><div class="pc-bio-label">Age</div><div class="pc-bio-val">${player.age ?? "-"}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Height</div><div class="pc-bio-val">${heightStr}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Weight</div><div class="pc-bio-val">${player.weight ? player.weight + " lbs" : "-"}</div></div>
            <div class="pc-bio-item"><div class="pc-bio-label">Exp</div><div class="pc-bio-val">${player.years_exp ?? "-"} yr</div></div>
        </div>

        ${historyRows ? `
        <div class="pc-section">
            <div class="pc-section-title">0.5 PPR Position Rank</div>
            ${historyRows}
        </div>` : ""}

        <div class="pc-section" id="espn-stats">
            <div class="pc-section-title">Career Stats</div>
            <div style="color:#9ca3af;font-size:12px;">Loading...</div>
        </div>

        <div class="pc-section" id="espn-news" style="border-bottom:none;">
            <div class="pc-section-title">Latest News</div>
            <div style="color:#9ca3af;font-size:12px;">Loading...</div>
        </div>
    `;

    // Position popover
    const rect = element.getBoundingClientRect();
    popover.style.display = "block";
    popover.style.position = "fixed";
    popover.style.top = `${Math.min(rect.top, window.innerHeight - 520)}px`;
    popover.style.left = `${rect.right + 12}px`;
    if (rect.right + 12 + 360 > window.innerWidth) {
        popover.style.left = `${rect.left - 372}px`;
    }

    // Resolve ESPN ID
    const espnId = player.espn_id || await lookupEspnId(player.name);

    if (!espnId) {
        document.getElementById("espn-stats").innerHTML = `<div class="pc-section-title">Career Stats</div><div style="color:#9ca3af;font-size:12px;">Not available</div>`;
        document.getElementById("espn-news").innerHTML = `<div class="pc-section-title">Latest News</div><div style="color:#9ca3af;font-size:12px;">Not available</div>`;
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

        // Career Stats
        const statsEl = document.getElementById("espn-stats");
        const categories = statsData.categories || [];
        const catPriority = { QB: "Passing", RB: "Rushing", WR: "Receiving", TE: "Receiving", K: "Scoring" };
        const cat = categories.find(c => c.displayName === catPriority[pos]) || categories[0];

        if (cat && cat.statistics?.length) {
            const keyStats = {
                QB: [0, 2, 4, 6, 7, 10],
                RB: [0, 1, 2, 4, 5, 6],
                WR: [0, 1, 2, 3, 4, 5],
                TE: [0, 1, 2, 3, 4, 5],
                K:  [0, 1, 2, 3],
            };
            const indices = keyStats[pos] || [0, 1, 2, 3, 4];
            const labels = indices.map(i => cat.labels?.[i]).filter(Boolean);
            const seasons = [...cat.statistics].reverse().slice(0, 8);

            const rows = seasons.map(s => {
                const vals = indices.map(i => s.stats?.[i] ?? "-").join("</td><td>");
                return `<tr><td>${s.season?.displayName ?? ""}</td><td>${vals}</td></tr>`;
            }).join("");

            const totals = indices.map(i => cat.totals?.[i] ?? "-").join("</td><td>");

            statsEl.innerHTML = `
                <div class="pc-section-title">${cat.displayName} — Career</div>
                <div style="overflow-x:auto;">
                    <table class="pc-stats-table">
                        <thead><tr>
                            <th style="text-align:left;">Year</th>
                            ${labels.map(l => `<th>${l}</th>`).join("")}
                        </tr></thead>
                        <tbody>
                            ${rows}
                            <tr><td>Career</td><td>${totals}</td></tr>
                        </tbody>
                    </table>
                </div>
            `;
        } else {
            statsEl.innerHTML = `<div class="pc-section-title">Career Stats</div><div style="color:#9ca3af;font-size:12px;">No stats available</div>`;
        }

        // News
        const newsEl = document.getElementById("espn-news");
        const articles = newsData.articles || [];
        const injuries = athleteData.athlete?.injuries || [];

        let newsHtml = "";

        injuries.forEach(inj => {
            newsHtml += `
                <div class="pc-news-item">
                    <div class="pc-injury-short">${inj.shortComment || ""}</div>
                    <div class="pc-injury-long">${inj.longComment || ""}</div>
                    <div class="pc-news-date">${formatDate(inj.date)}</div>
                </div>
                <hr style="border:none;border-top:1px solid #f3f4f6;margin:8px 0;">
            `;
        });

        articles.slice(0, 4).forEach(a => {
            newsHtml += `
                <div class="pc-news-item">
                    <div class="pc-news-headline">${a.headline || ""}</div>
                    <div class="pc-news-desc">${a.description || ""}</div>
                    <div class="pc-news-date">${formatDate(a.published)}</div>
                </div>
            `;
        });

        newsEl.innerHTML = `
            <div class="pc-section-title">Latest News</div>
            ${newsHtml || '<div style="color:#9ca3af;font-size:12px;">No recent news</div>'}
        `;

    } catch (e) {
        console.error("ESPN fetch error:", e);
        document.getElementById("espn-stats").innerHTML = `<div class="pc-section-title">Career Stats</div><div style="color:#9ca3af;font-size:12px;">Failed to load</div>`;
        document.getElementById("espn-news").innerHTML = `<div class="pc-section-title">Latest News</div><div style="color:#9ca3af;font-size:12px;">Failed to load</div>`;
    }
}

init();