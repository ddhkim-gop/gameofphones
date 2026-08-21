// Shared player-card popover.
// Extracted from teams.js so both the Teams grid (teams.js) and the single-team
// page (team.js) can open the same card. Pure helpers (posColor, pvLookup,
// posRankStr, calcAgeDecimal) and page data (statsCache, transactions, YEARS)
// are injected per open() call via ctx, since each page owns its own caches.

const espnIdCache = {};
const SOURCE_LABEL = { rotoballer: "RotoBaller", rotowire: "RotoWire", fantasy_pros: "FantasyPros" };

export function ensurePlayerCardPopover() {
    if (document.getElementById("player-popover")) return;
    const pop = document.createElement("div");
    pop.id = "player-popover";
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

async function lookupEspnId(name, teamAbbrev) {
    if (espnIdCache[name] !== undefined) return espnIdCache[name];
    try {
        const r = await fetch(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(name)}&limit=5&type=athlete&sport=football`);
        const d = await r.json();
        const items = d.items || [];
        const match = items.find(i => i.displayName?.toLowerCase() === name.toLowerCase()) || items[0];
        if (match?.id) {
            espnIdCache[name] = Number(match.id);
            return espnIdCache[name];
        }
        // Search returned nothing — fall back to fetching the NFL team roster.
        // Newer rookies often aren't in the ESPN search index yet.
        if (teamAbbrev) {
            const rr = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamAbbrev.toLowerCase()}/roster`);
            const rd = await rr.json();
            const allAthletes = (rd.athletes || []).flatMap(g => g.items || []);
            const nameLower = name.toLowerCase();
            const found = allAthletes.find(a =>
                (a.displayName || "").toLowerCase() === nameLower ||
                (a.fullName || "").toLowerCase() === nameLower
            );
            if (found?.id) {
                espnIdCache[name] = Number(found.id);
                return espnIdCache[name];
            }
        }
        espnIdCache[name] = null;
        return null;
    } catch {
        espnIdCache[name] = null;
        return null;
    }
}

function renderSleeperNews(newsItems, injuries) {
    let html = "";

    // ESPN injury banner (from athleteData) takes precedence as an alert
    injuries.forEach(inj => {
        html += `<div class="pc-news-item">
            <div class="pc-news-headline" style="color:#fbbf24;">⚠ ${inj.shortComment || "Injury Update"}</div>
            ${inj.longComment ? `<div class="pc-news-impact"><span class="pc-impact-label">Impact:</span> ${inj.longComment}</div>` : ""}
            <div class="pc-news-date">${formatDate(inj.date)}</div>
        </div>`;
    });

    if (injuries.length && newsItems.length) {
        html += `<hr style="border:none;border-top:1px solid #2d3139;margin:10px 0;">`;
    }

    // Show top 5 Sleeper news items (already player-specific, no filtering needed)
    newsItems.slice(0, 5).forEach(item => {
        const m = item.metadata || {};
        const title = m.title || "";
        const desc = m.description || "";
        const analysis = m.analysis || "";
        const src = SOURCE_LABEL[item.source] || item.source || "";
        const date = item.published ? new Date(item.published).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "";
        const url = m.url || "";
        const headlineHtml = url
            ? `<a href="${url}" target="_blank" rel="noopener" style="color:#f0f1f3;text-decoration:none;">${title}</a>`
            : title;
        html += `<div class="pc-news-item">
            <div class="pc-news-headline">${headlineHtml}</div>
            ${desc ? `<div class="pc-news-impact">${desc}</div>` : ""}
            ${analysis ? `<div class="pc-news-impact" style="color:#5a6070;margin-top:3px;">${analysis}</div>` : ""}
            <div class="pc-news-date">${src ? `<span style="color:#4299e1;font-weight:600;">${src}</span> · ` : ""}${date}</div>
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

    if (!element) return; // re-clamp calls may pass null once content settles

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

// ctx: { posColor, pvLookup, posRankStr, calcAgeDecimal, statsCache, transactions, YEARS }
export async function openPlayerCard(element, player, ctx) {
    ensurePlayerCardPopover();
    const { posColor, pvLookup, posRankStr, calcAgeDecimal } = ctx;
    const statsCache = ctx.statsCache || {};
    const allTransactions = ctx.transactions || [];
    const YEARS = ctx.YEARS || [];

    const popover = document.getElementById("player-popover");
    const body = document.getElementById("popover-body");
    if (!popover || !body) return;

    const pid = player.player_id;
    const pos = player.position || "";
    const posClr = posColor(pos);
    const pv = pvLookup(player.name);
    const heightStr = player.height
        ? `${Math.floor(Number(player.height) / 12)}'${Number(player.height) % 12}"`
        : "—";

    const headshotUrl = player.espn_id
        ? `https://a.espncdn.com/i/headshots/nfl/players/full/${player.espn_id}.png`
        : `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;

    // Transaction history for this player
    const playerTxRows = [];
    const playerName = player.name;

    // Check draft history
    const draftArchive = window.__STATIC_DATA__?.draft || {};
    Object.entries(draftArchive).forEach(([dYear, picks]) => {
        (picks || []).forEach(pk => {
            if (pk.player === playerName) {
                const rd = pk.round ? `R${pk.round}` : "";
                playerTxRows.push({ date: `${dYear} Draft`, label: "Draft", detail: `${pk.picked_by}${rd ? " · " + rd : ""}`, season: dYear, sortKey: dYear });
            }
        });
    });

    // Check waiver/FA/trade transactions
    (allTransactions || []).forEach(t => {
        if (t.status === "failed") return;
        if (t.type !== "waiver" && t.type !== "free_agent" && t.type !== "trade") return;
        let label = "", detail = "";
        if (t.type === "trade") {
            Object.entries(t.assets_received || {}).forEach(([rcvTeam, assets]) => {
                if ((assets || []).some(a => a.name === playerName)) {
                    label = "Trade"; detail = rcvTeam;
                }
            });
        } else {
            if ((t.added || []).some(a => a.name === playerName)) {
                label = t.type === "waiver" ? "Waiver" : "Add";
                detail = (t.teams || [])[0] || "";
            } else if ((t.dropped || []).some(a => a.name === playerName)) {
                label = "Released"; detail = (t.teams || [])[0] || "";
            }
        }
        if (label) playerTxRows.push({ date: t.created || "", label, detail, season: t.season || "", sortKey: t.created || "" });
    });
    // Convert date strings like "Jun 04, 2026 • 12:14 PM PT" or year strings "2023"
    // to timestamps for proper chronological sort (localeCompare sorts month names alphabetically)
    function toTimestamp(key) {
        if (!key) return 0;
        if (/^\d{4}$/.test(key)) return new Date(key + '-01-01').getTime(); // just a year
        return new Date(key.replace(' •', ',').replace(/\s+PT$/, '')) || 0;
    }
    playerTxRows.sort((a, b) => toTimestamp(b.sortKey) - toTimestamp(a.sortKey)); // newest first

    const labelColor = { Draft: "#a78bfa", Trade: "#4299e1", Waiver: "#3ecf8e", Add: "#3ecf8e", Released: "#e74c82" };
    const txHistoryHtml = playerTxRows.length
        ? playerTxRows.map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #2d3139;font-size:11px;">
                <div style="display:flex;align-items:center;gap:7px;">
                    <span style="background:${labelColor[r.label]||'#5a6070'}22;color:${labelColor[r.label]||'#8b9099'};font-weight:700;font-size:10px;padding:2px 6px;border-radius:4px;flex-shrink:0;">${r.label}</span>
                    <span style="color:#8b9099;">${r.detail}</span>
                </div>
                <span style="color:#5a6070;white-space:nowrap;margin-left:8px;">${r.date}</span>
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

        ${pv.apy ? (() => {
            const fmt = v => v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1).replace(/\.0$/,'')}M` : `$${Math.round(v/1000)}K`;
            const gtdPct = pv.total_value ? Math.round((pv.guaranteed / pv.total_value) * 100) : null;
            const yrs = pv.years || '?';
            const span = pv.year_signed ? `${yrs} yr (${pv.year_signed}–${pv.year_end})` : `${yrs} yr`;
            const curYear = 2026;
            const remYrs = pv.year_end ? Math.max(0, pv.year_end - curYear + 1) : null;
            const remMoney = (remYrs !== null && pv.apy) ? pv.apy * remYrs : null;
            const remStr = remMoney !== null ? `${fmt(remMoney)}<span style="font-size:10px;color:#5a6070;font-weight:400;margin-left:4px;">(${remYrs} yr${remYrs !== 1 ? 's' : ''})</span>` : '—';
            return `<div class="pc-section">
                <div class="pc-section-title">Contract</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;">
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Total Value</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${fmt(pv.total_value)}</div></div>
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Years</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${span}</div></div>
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Guaranteed</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${fmt(pv.guaranteed)}</div></div>
                    <div><div style="font-size:10px;color:#5a6070;margin-bottom:2px;">Remaining</div><div style="font-size:13px;font-weight:700;color:#c9cdd4;">${remStr}</div></div>
                </div>
            </div>`;
        })() : ''}

        <div class="pc-section" id="espn-stats-rank-placeholder"></div>

        <div class="pc-section" id="espn-stats-section">
            <div style="display:flex;gap:6px;margin-bottom:10px;">
                <button id="pc-tab-stats" style="background:#252830;border:1px solid #3d4350;color:#f0f1f3;font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;cursor:pointer;font-family:inherit;">Career Stats</button>
                <button id="pc-tab-gamelogs" style="background:none;border:1px solid #2d3139;color:#5a6070;font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;cursor:pointer;font-family:inherit;">Game Logs</button>
            </div>
            <div id="espn-stats">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;">Career</div>
                    <select id="pc-stats-year" style="background:#252830;border:1px solid #2d3139;border-radius:6px;color:#f0f1f3;font-size:12px;padding:3px 8px;cursor:pointer;">
                        <option value="all">All</option>
                        <option value="2025">2025</option>
                        <option value="2024">2024</option>
                        <option value="2023">2023</option>
                        <option value="2022">2022</option>
                        <option value="2021">2021</option>
                    </select>
                </div>
                <div id="pc-stats-body"><div style="color:#5a6070;font-size:12px;">Loading...</div></div>
            </div>
            <div id="espn-gamelogs" style="display:none;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;">Season</div>
                    <select id="pc-gamelog-year" style="background:#252830;border:1px solid #2d3139;border-radius:6px;color:#f0f1f3;font-size:12px;padding:3px 8px;cursor:pointer;">
                        <option value="2025">2025</option>
                        <option value="2024">2024</option>
                        <option value="2023">2023</option>
                        <option value="2022">2022</option>
                    </select>
                </div>
                <div id="pc-gamelog-body"><div style="color:#5a6070;font-size:12px;">Loading...</div></div>
            </div>
        </div>

        <div class="pc-section">
            <div class="pc-section-title">Transaction History</div>
            ${txHistoryHtml}
        </div>

        <div class="pc-section" id="espn-news">
            <div class="pc-section-title">Latest News</div>
            <div style="color:#5a6070;font-size:12px;">Loading...</div>
        </div>
    `;

    popover.style.display = "flex";
    positionPopover(popover, element);

    // Wire up tab buttons (module scope — can't use onclick attributes)
    document.getElementById("pc-tab-stats")?.addEventListener("click", () => switchPcTab("stats"));
    document.getElementById("pc-tab-gamelogs")?.addEventListener("click", () => switchPcTab("gamelogs"));
    document.getElementById("pc-gamelog-year")?.addEventListener("change", () => loadGameLog());
    document.getElementById("pc-stats-year")?.addEventListener("change", () => renderStatsForYear());

    // Store identifiers on popover for async tab handlers
    popover.dataset.pos = pos;
    popover.dataset.espnId = player.espn_id || "";
    popover.dataset.playerId = pid || "";

    // Kick off global NFL news fetch immediately (cached after first call)
    const espnId = player.espn_id || await lookupEspnId(player.name, player.team);
    if (espnId) popover.dataset.espnId = espnId;

    if (!player.espn_id && espnId) {
        const img = popover.querySelector(".pc-headshot");
        if (img) img.src = `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
    }

    try {
        // Fetch ESPN stats + injury data, and Sleeper news in parallel.
        const sleeperId = player.player_id;
        const [statsData, athleteData, sleeperNews] = await Promise.all([
            espnId ? fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}/stats`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
            espnId ? fetch(`https://site.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`).then(r => r.json()).catch(() => ({})) : Promise.resolve({}),
            sleeperId ? fetch(`https://api.sleeper.com/players/nfl/${sleeperId}/news`).then(r => r.json()).catch(() => []) : Promise.resolve([]),
        ]);

        const statsBodyEl = document.getElementById("pc-stats-body");

        if (espnId) {
            const categories = statsData.categories || [];
            const catPriority = { QB:"Passing", RB:"Rushing", WR:"Receiving", TE:"Receiving", K:"Scoring" };
            const cat = categories.find(c => c.displayName === catPriority[pos]) || categories[0];

            // Build a map of season year → position rank from local statsCache
            const rankByYear = {};
            for (const yr of YEARS) {
                const stat = statsCache?.[yr]?.[pid];
                if (stat?.rank > 0) rankByYear[yr] = `${stat.position || player.position}${stat.rank}`;
            }

            // Remove the rank placeholder div now that we have data
            const rankPlaceholder = document.getElementById("espn-stats-rank-placeholder");
            if (rankPlaceholder) rankPlaceholder.remove();

            if (cat && cat.statistics?.length) {
                const keyStats = { QB:[0,2,4,6,7,10], RB:[0,1,2,4,5,6], WR:[0,1,2,3,4,5], TE:[0,1,2,3,4,5], K:[0,1,2,3] };
                const indices = keyStats[pos] || [0,1,2,3,4];
                const labels = indices.map(i => cat.labels?.[i]).filter(Boolean);
                const allSeasons = [...cat.statistics].reverse().slice(0, 8);
                const totals = indices.map(i => cat.totals?.[i] ?? "—").join("</td><td>");

                // Store on popover for year filter re-render
                popover._statsData = { cat, indices, labels, allSeasons, totals, rankByYear };

                // Populate year dropdown options based on available seasons
                const yearSel = document.getElementById("pc-stats-year");
                if (yearSel) {
                    const existingYears = new Set([...yearSel.options].map(o => o.value));
                    allSeasons.forEach(s => {
                        const yr = s.season?.year ? String(s.season.year) : "";
                        if (yr && !existingYears.has(yr)) {
                            const opt = document.createElement("option");
                            opt.value = yr; opt.textContent = yr;
                            yearSel.appendChild(opt);
                        }
                    });
                }

                renderStatsForYear();
            } else {
                if (statsBodyEl) statsBodyEl.innerHTML = `<div style="color:#5a6070;font-size:12px;">No stats available</div>`;
            }
        } else {
            const rp = document.getElementById("espn-stats-rank-placeholder");
            if (rp) rp.remove();
            if (statsBodyEl) statsBodyEl.innerHTML = `<div style="color:#5a6070;font-size:12px;">Not available</div>`;
        }

        const injuries = athleteData.athlete?.injuries || [];
        document.getElementById("espn-news").innerHTML = `
            <div class="pc-section-title">Latest News</div>
            ${renderSleeperNews(sleeperNews, injuries)}`;

        // Re-clamp position after content loaded (height changed)
        positionPopover(popover, element);

    } catch (e) {
        console.error("Player card fetch error:", e);
        const sb = document.getElementById("pc-stats-body");
        if (sb) sb.innerHTML = `<div style="color:#5a6070;font-size:12px;">Failed to load</div>`;
        document.getElementById("espn-news").innerHTML = `<div class="pc-section-title">Latest News</div><div style="color:#5a6070;font-size:12px;">Failed to load</div>`;
    }
}

function renderStatsForYear() {
    const popover = document.getElementById("player-popover");
    const statsBodyEl = document.getElementById("pc-stats-body");
    if (!popover || !statsBodyEl || !popover._statsData) return;

    const { cat, indices, labels, allSeasons, totals, rankByYear } = popover._statsData;
    const yearSel = document.getElementById("pc-stats-year");
    const selectedYear = yearSel ? yearSel.value : "all";

    let seasons = allSeasons;
    if (selectedYear !== "all") {
        seasons = allSeasons.filter(s => s.season?.year ? String(s.season.year) === selectedYear : false);
    }

    if (!seasons.length) {
        statsBodyEl.innerHTML = `<div style="color:#5a6070;font-size:12px;">No data for ${selectedYear}</div>`;
        return;
    }

    const showCareer = selectedYear === "all";
    const rows = seasons.map(s => {
        const yr = s.season?.year ? String(s.season.year) : "";
        const rank = rankByYear[yr] ? `<td style="font-weight:700;color:#f0f1f3;">${rankByYear[yr]}</td>` : `<td style="color:#5a6070;">—</td>`;
        const vals = indices.map(i => s.stats?.[i] ?? "—").join("</td><td>");
        return `<tr><td>${s.season?.displayName ?? ""}</td>${rank}<td>${vals}</td></tr>`;
    }).join("");

    const yearCol = showCareer ? `<th style="text-align:left;">Year</th>` : `<th style="text-align:left;">Year</th>`;
    statsBodyEl.innerHTML = `
        <div style="overflow-x:auto;">
            <table class="pc-stats-table">
                <thead><tr>${yearCol}<th>Rank</th>${labels.map(l => `<th>${l}</th>`).join("")}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function switchPcTab(tab) {
    const statsEl = document.getElementById("espn-stats");
    const logsEl  = document.getElementById("espn-gamelogs");
    const btnS    = document.getElementById("pc-tab-stats");
    const btnG    = document.getElementById("pc-tab-gamelogs");
    if (!statsEl || !logsEl) return;
    const isStats = tab === "stats";
    statsEl.style.display  = isStats ? "" : "none";
    logsEl.style.display   = isStats ? "none" : "";
    if (btnS) { btnS.style.background = isStats ? "#252830" : "none"; btnS.style.color = isStats ? "#f0f1f3" : "#5a6070"; btnS.style.borderColor = isStats ? "#3d4350" : "#2d3139"; }
    if (btnG) { btnG.style.background = isStats ? "none" : "#252830"; btnG.style.color = isStats ? "#5a6070" : "#f0f1f3"; btnG.style.borderColor = isStats ? "#2d3139" : "#3d4350"; }
    if (!isStats) loadGameLog();
}

async function loadGameLog() {
    const body    = document.getElementById("pc-gamelog-body");
    const yearSel = document.getElementById("pc-gamelog-year");
    const pop     = document.getElementById("player-popover");
    if (!body || !yearSel || !pop) return;

    const playerId = pop.dataset.playerId;
    const pos      = pop.dataset.pos || "";
    const year     = yearSel.value;

    if (!playerId) { body.innerHTML = `<div style="color:#5a6070;font-size:12px;">No player ID available.</div>`; return; }
    body.innerHTML = `<div style="color:#5a6070;font-size:12px;">Loading...</div>`;

    // Columns per position — Pts + Rank first, then stats
    const STAT_COLS = {
        QB: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "_cmp_att",          label: "Cmp/Att", combo: ["pass_cmp","pass_att"] },
            { key: "pass_yd",           label: "Yds"  },
            { key: "pass_td",           label: "TD"   },
            { key: "pass_int",          label: "INT"  },
            { key: "rush_yd",           label: "Ru"   },
        ],
        RB: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "rush_att",          label: "Car"  },
            { key: "rush_yd",           label: "RuYd" },
            { key: "rec_tgt",           label: "Tgt"  },
            { key: "rec",               label: "Rec"  },
            { key: "rec_yd",            label: "ReYd" },
        ],
        WR: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "rec_tgt",           label: "Tgt"  },
            { key: "rec",               label: "Rec"  },
            { key: "rec_yd",            label: "Yds"  },
            { key: "rec_td",            label: "TD"   },
        ],
        TE: [
            { key: "pts_half_ppr",      label: "Pts" },
            { key: "pos_rank_half_ppr", label: "Rnk", isRank: true },
            { key: "rec_tgt",           label: "Tgt"  },
            { key: "rec",               label: "Rec"  },
            { key: "rec_yd",            label: "Yds"  },
            { key: "rec_td",            label: "TD"   },
        ],
        K: [
            { key: "pts_std",           label: "Pts"  },
            { key: "pos_rank_std",      label: "Rnk", isRank: true },
            { key: "_fg",               label: "FG",  combo: ["fgm","fga"] },
            { key: "xpm",               label: "XPM"  },
        ],
    };
    const cols = STAT_COLS[pos] || STAT_COLS.WR;

    try {
        const fetches = Array.from({ length: 18 }, (_, i) => {
            const wk = i + 1;
            return fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${wk}`)
                .then(r => r.json())
                .then(d => ({ week: wk, stats: d[playerId] || null }))
                .catch(() => ({ week: wk, stats: null }));
        });
        const weeks = await Promise.all(fetches);
        const played = weeks.filter(w => w.stats && (w.stats.gp > 0 || w.stats.gms_active > 0));

        if (!played.length) {
            body.innerHTML = `<div style="color:#5a6070;font-size:12px;">No game data for ${year}.</div>`;
        } else {
            const fmt = v => v == null ? "—" : Number.isInteger(v) ? v : parseFloat(v.toFixed(1));
            const cellVal = (col, stats) => {
                if (col.combo) return `${fmt(stats[col.combo[0]] ?? null)}/${fmt(stats[col.combo[1]] ?? null)}`;
                const v = stats[col.key];
                return v != null ? fmt(v) : "—";
            };
            const rankColor = v => {
                if (!v) return "#5a6070";
                if (v <= 5)  return "#3ecf8e";
                if (v <= 12) return "#4299e1";
                if (v <= 24) return "#f6ad55";
                return "#e74c82";
            };
            const headers = cols.map(c => `<th style="white-space:nowrap;">${c.label}</th>`).join("");
            const rows = played.map(({ week, stats }) => {
                const vals = cols.map(c => {
                    if (c.isRank) {
                        const v = stats[c.key];
                        return `<td style="font-weight:700;color:${rankColor(v)};">${v != null ? v : "—"}</td>`;
                    }
                    return `<td>${cellVal(c, stats)}</td>`;
                }).join("");
                return `<tr><td style="font-weight:600;color:#f0f1f3;white-space:nowrap;">Wk ${week}</td>${vals}</tr>`;
            }).join("");
            // Totals (skip rank col)
            const totals = cols.map(c => {
                if (c.isRank) return `<td>—</td>`;
                if (c.combo) {
                    const s0 = played.reduce((s,w)=>s+(w.stats[c.combo[0]]||0),0);
                    const s1 = played.reduce((s,w)=>s+(w.stats[c.combo[1]]||0),0);
                    return `<td style="font-weight:700;">${fmt(s0)}/${fmt(s1)}</td>`;
                }
                const sum = played.reduce((s,w)=>s+(w.stats[c.key]||0),0);
                return `<td style="font-weight:700;">${fmt(sum)}</td>`;
            }).join("");
            body.innerHTML = `<div style="overflow-x:auto;">
                <style>
                    #pc-gamelog-body table { font-size:11px; }
                    #pc-gamelog-body th, #pc-gamelog-body td { padding:4px 5px; }
                </style>
                <table class="pc-stats-table">
                    <thead><tr><th style="text-align:left;">Wk</th>${headers}</tr></thead>
                    <tbody>${rows}<tr><td style="font-weight:700;color:#f0f1f3;">Tot</td>${totals}</tr></tbody>
                </table></div>`;
        }
    } catch(e) {
        body.innerHTML = `<div style="color:#5a6070;font-size:12px;">Failed to load game log.</div>`;
    }
    const pop2 = document.getElementById("player-popover");
    if (pop2) positionPopover(pop2, null);
}
