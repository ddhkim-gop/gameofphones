import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

const YEARS = ["2023", "2024", "2025", "2026"];
let standingsData = null;
let historyData = null;
let rostersData = null;
let statsCache = {};
let usersMap = {};
let transactionsData = [];
let selectedYear = "all_time";

function avatarEl(url, name, size) {
    const sz = size || 24;
    if (url) {
        return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='<span style=\\'width:${sz}px;height:${sz}px;border-radius:50%;background:#252830;display:inline-flex;align-items:center;justify-content:center;font-size:${sz*0.45}px;font-weight:700;color:#5a6070;\\'>${(name||"?")[0].toUpperCase()}</span>'">`;
    }
    return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#252830;display:inline-flex;align-items:center;justify-content:center;font-size:${sz*0.45}px;font-weight:700;color:#5a6070;flex-shrink:0;">${(name||"?")[0].toUpperCase()}</span>`;
}

function buildAllTimeRows() {
    const combined = {};
    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(r => {
            if (!combined[r.name]) combined[r.name] = { name:r.name, wins:0, losses:0, pf:0, pa:0, seasons:0, highestPF:0 };
            const c = combined[r.name];
            c.wins += r.wins; c.losses += r.losses;
            c.pf += r.pf; c.pa += r.pa;
            c.highestPF = Math.max(c.highestPF, r.pf);
            c.seasons++;
        });
    });
    return Object.values(combined)
        .map(c => ({ ...c, avgPF: c.seasons > 0 ? c.pf / c.seasons : 0 }))
        .sort((a,b) => b.wins - a.wins || b.pf - a.pf);
}

function buildPlayoffRecords(year) {
    const records = {};
    const seasons = year === "all_time"
        ? Object.values(historyData || {})
        : [(historyData || {})[year] || {}];
    seasons.forEach(s => {
        [...(s.winners_bracket || []), ...(s.losers_bracket || [])].forEach(m => {
            if (!m.winner || !m.loser) return;
            if (!records[m.winner]) records[m.winner] = { wins:0, losses:0 };
            if (!records[m.loser])  records[m.loser]  = { wins:0, losses:0 };
            records[m.winner].wins++; records[m.loser].losses++;
        });
    });
    return records;
}

// Compute FAAB remaining for a given year per team
function computeFaabRemaining(year) {
    const BUDGET = 100;
    const spent = {};
    const result = {};
    const waivers = (transactionsData || [])
        .filter(t => t.season === year && t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waivers.forEach(t => {
        const team = (t.teams || [])[0];
        if (!team) return;
        if (spent[team] === undefined) spent[team] = 0;
        spent[team] += (t.waiver_bid || t.faab || 0);
        result[team] = BUDGET - spent[team];
    });
    return result;
}

// Best player on each team's current roster
function bestPlayerForTeam(teamName) {
    const teamRosters = rostersData?.["2026"] || [];
    const roster = teamRosters.find(r => r.owner === teamName);
    if (!roster) return null;
    let best = null, bestScore = -1;
    (roster.players || []).forEach(p => {
        if (!p?.player_id) return;
        const pid = p.player_id;
        const score = statsCache["2025"]?.[pid]?.pts_half_ppr || statsCache["2024"]?.[pid]?.pts_half_ppr || 0;
        if (score > bestScore) { bestScore = score; best = p; }
    });
    return best;
}

function renderStandingsTable(rows, playoffRec, isAllTime, faabRemaining) {
    const extraHeaders = isAllTime
        ? `<th style="${TH}">Avg PF</th><th style="${TH}">Best PF</th>`
        : "";
    const faabHeader = !isAllTime ? `<th style="${TH}">FAAB Left</th>` : "";

    const header = `
        <tr style="background:#252830;">
            <th style="${TH}">#</th>
            <th style="${TH};text-align:left;min-width:140px;">Team</th>
            <th style="${TH}">RS W</th>
            <th style="${TH}">RS L</th>
            <th style="${TH}">PF</th>
            <th style="${TH}">PA</th>
            <th style="${TH}">+/-</th>
            ${extraHeaders}
            <th style="${TH}">PO W-L</th>
            ${faabHeader}
            <th style="${TH}">Top Player</th>
        </tr>`;

    const body = rows.map((r, i) => {
        const diff = (r.pf - r.pa).toFixed(1);
        const diffColor = r.pf >= r.pa ? "#3ecf8e" : "#f87171";
        const po = playoffRec[r.name];
        const poStr = po ? `${po.wins}-${po.losses}` : "—";
        const av = usersMap[r.name];
        const extraCells = isAllTime
            ? `<td style="${TD}">${r.avgPF.toFixed(1)}</td><td style="${TD}">${r.highestPF.toFixed(1)}</td>`
            : "";
        const faabLeft = !isAllTime ? faabRemaining?.[r.name] : undefined;
        const faabCell = !isAllTime
            ? `<td style="${TD};${faabLeft != null && faabLeft < 20 ? 'color:#f87171;font-weight:700;' : ''}">${faabLeft != null ? `$${faabLeft}` : "—"}</td>`
            : "";
        const bp = bestPlayerForTeam(r.name);
        const bpCell = bp
            ? `<td style="${TD};text-align:left;font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${bp.name}">${bp.name}</td>`
            : `<td style="${TD}">—</td>`;

        return `<tr style="border-bottom:1px solid #2d3139;">
            <td style="${TD};color:#5a6070;font-weight:700;">${i+1}</td>
            <td style="${TD};text-align:left;">
                <div style="display:flex;align-items:center;gap:8px;">
                    ${avatarEl(av, r.name, 26)}
                    <span style="font-weight:700;color:#f0f1f3;">${r.name}</span>
                </div>
            </td>
            <td style="${TD};color:#3ecf8e;font-weight:700;">${r.wins}</td>
            <td style="${TD};color:#f87171;font-weight:700;">${r.losses}</td>
            <td style="${TD}">${r.pf.toFixed(1)}</td>
            <td style="${TD}">${r.pa.toFixed(1)}</td>
            <td style="${TD};color:${diffColor};font-weight:700;">${diff > 0 ? "+" : ""}${diff}</td>
            ${extraCells}
            <td style="${TD}">${poStr}</td>
            ${faabCell}
            ${bpCell}
        </tr>`;
    }).join("");

    return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#1e2027;border-radius:12px;overflow:hidden;min-width:520px;">
            <thead>${header}</thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
}

const TH = "padding:10px 12px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;font-weight:700;white-space:nowrap;border-bottom:1px solid #2d3139;";
const TD = "padding:10px 12px;text-align:center;color:#c9cdd4;white-space:nowrap;";

function updateStandings() {
    const isAllTime = selectedYear === "all_time";
    const rows = isAllTime ? buildAllTimeRows() : (standingsData[selectedYear] || []);
    const playoffRec = buildPlayoffRecords(selectedYear);
    const faabRemaining = !isAllTime ? computeFaabRemaining(selectedYear) : {};
    document.getElementById("home-standings-table").innerHTML = renderStandingsTable(rows, playoffRec, isAllTime, faabRemaining);
}

// ── League Rules ──────────────────────────────────────────────

const PAYOUTS = [
    { bracket:"Playoff",     rank:"1st",  prize:"$250", pick:"12th (1st overall)" },
    { bracket:"Playoff",     rank:"2nd",  prize:"$100", pick:"11th" },
    { bracket:"Playoff",     rank:"3rd",  prize:"$50",  pick:"10th" },
    { bracket:"Playoff",     rank:"4th",  prize:"—",    pick:"9th" },
    { bracket:"Playoff",     rank:"5th–8th", prize:"—", pick:"5–8*" },
    { bracket:"Consolation", rank:"9th",  prize:"—",    pick:"4th" },
    { bracket:"Consolation", rank:"10th", prize:"—",    pick:"3rd" },
    { bracket:"Consolation", rank:"11th", prize:"—",    pick:"2nd" },
    { bracket:"Consolation", rank:"12th", prize:"—",    pick:"1st (last overall)" },
];

function buildFeesTable() {
    // Compute fees per user based on which years they appear in standings
    const userYears = {};
    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(r => {
            if (!userYears[r.name]) userYears[r.name] = [];
            userYears[r.name].push(year);
        });
    });

    // First year in 2023 = $100 entry, subsequent years = $50
    const feeRows = Object.entries(userYears)
        .map(([name, years]) => {
            const sortedYears = years.sort();
            const entryYear = sortedYears[0];
            const entryFee = entryYear === "2023" ? 100 : 100; // $100 entry fee always
            const annualFees = (sortedYears.length - 1) * 50;
            const totalPaid = entryFee + annualFees;
            const yearBadges = sortedYears.map(y =>
                `<span style="background:#252830;color:#8b9099;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;">${y}</span>`
            ).join(" ");
            const av = usersMap[name];
            return { name, sortedYears, totalPaid, yearBadges, av, joinYear: entryYear };
        })
        .sort((a, b) => b.totalPaid - a.totalPaid || a.name.localeCompare(b.name));

    const totalPool = feeRows.reduce((s, r) => s + r.totalPaid, 0);

    const rows = feeRows.map(r => `
        <tr style="border-bottom:1px solid #2d3139;">
            <td style="${TD};text-align:left;">
                <div style="display:flex;align-items:center;gap:8px;">
                    ${avatarEl(r.av, r.name, 22)}
                    <span style="font-weight:600;color:#f0f1f3;font-size:12px;">${r.name}</span>
                </div>
            </td>
            <td style="${TD}">${r.joinYear}</td>
            <td style="${TD}">${r.sortedYears.length}</td>
            <td style="${TD};display:flex;flex-wrap:wrap;gap:3px;justify-content:center;">${r.yearBadges}</td>
            <td style="${TD};color:#3ecf8e;font-weight:700;">$${r.totalPaid}</td>
        </tr>`).join("");

    return `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-top:16px;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #2d3139;">
                Fee History
                <span style="float:right;color:#fbbf24;font-size:11px;text-transform:none;letter-spacing:0;">Total Collected: $${totalPool}</span>
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:400px;">
                    <thead>
                        <tr style="background:#252830;">
                            ${["Manager","Joined","Seasons","Years Active","Total Paid"].map(h => `<th style="${TH}">${h}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
}

function renderRules() {
    const bracketColor = b => b === "Playoff" ? "#5a5be6" : "#8b9099";

    const payoutRows = PAYOUTS.map(p => `
        <tr style="border-bottom:1px solid #2d3139;">
            <td style="${TD};text-align:left;">
                <span style="background:${bracketColor(p.bracket)};color:#fff;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700;">${p.bracket}</span>
            </td>
            <td style="${TD};font-weight:700;color:#f0f1f3;">${p.rank}</td>
            <td style="${TD};color:${p.prize !== "—" ? "#3ecf8e" : "#5a6070"};font-weight:${p.prize !== "—" ? "700" : "400"};">${p.prize}</td>
            <td style="${TD};">${p.pick}</td>
        </tr>`).join("");

    return `
    <div style="margin-bottom:32px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;" class="rules-grid">
            <!-- Finance card -->
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:10px;padding:16px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #2d3139;">Finance</div>
                ${[
                    ["Entry Fee", "Year 1: $100 · Annually: $50"],
                    ["Total Dues", "$600 / year"],
                    ["Annual Payout", "$400"],
                    ["Side Pot", "$200 / year"],
                ].map(([label, val]) => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #2d3139;font-size:13px;">
                        <span style="color:#8b9099;">${label}</span>
                        <span style="font-weight:600;color:#f0f1f3;">${val}</span>
                    </div>`).join("")}
                <div style="margin-top:10px;padding:8px 10px;background:#252830;border-radius:8px;font-size:11px;color:#8b9099;line-height:1.5;">
                    Side pot is claimed when a manager wins the title <strong style="color:#fbbf24;">2× in any 3-year window</strong>. Pot then restarts at $0.
                </div>
            </div>

            <!-- Payout table card -->
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:10px;padding:16px;">
                <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #2d3139;">Payout + Draft Order</div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:320px;">
                        <thead>
                            <tr style="background:#252830;">
                                ${["Bracket","Rank","Prize","Draft Pick"].map(h => `<th style="${TH}">${h}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>${payoutRows}</tbody>
                    </table>
                </div>
                <div style="margin-top:10px;font-size:11px;color:#8b9099;line-height:1.5;">
                    * Seeds 5–8: winner of those games earns the higher draft pick. Consolation bracket is best-ball.
                </div>
            </div>
        </div>
        <div id="home-fees-table"></div>
    </div>`;
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("home-container");

    container.innerHTML = `
    <style>
        #home-container { max-width: 1100px; }
        .rules-grid { grid-template-columns: 1fr 1fr; }
        @media (max-width: 700px) {
            .rules-grid { grid-template-columns: 1fr !important; }
        }
    </style>
    <div id="home-rules"><div style="color:#5a6070;padding:20px 0;">Loading...</div></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#5a6070;font-weight:700;">Standings</div>
        <select id="home-year-select">
            <option value="all_time" selected>All Years</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
        </select>
    </div>
    <div id="home-standings-table" style="color:#5a6070;padding:20px 0;">Loading...</div>`;

    try {
        const [standings, history, leagueUsers, transactions, rosters2026] = await Promise.all([
            api.getStandings(),
            api.getSeasonHistory(),
            api.getLeagueUsers(),
            api.getTransactions(),
            api.getRosters("2026"),
        ]);

        standingsData = standings;
        historyData = history;
        transactionsData = transactions || [];
        rostersData = { "2026": rosters2026 || [] };
        (leagueUsers || []).forEach(u => { usersMap[u.username] = u.avatar_url; });

        // Load recent stats for best player column
        try {
            const [s25, s24] = await Promise.all([
                api.getPlayerStats("2025"),
                api.getPlayerStats("2024"),
            ]);
            statsCache["2025"] = s25 || {};
            statsCache["2024"] = s24 || {};
        } catch { /* stats optional */ }

        document.getElementById("home-year-select").addEventListener("change", e => {
            selectedYear = e.target.value;
            updateStandings();
        });

        document.getElementById("home-rules").innerHTML = renderRules();
        document.getElementById("home-fees-table").innerHTML = buildFeesTable();
        updateStandings();

    } catch (err) {
        console.error(err);
        container.innerHTML = `<div style="color:#f87171;padding:20px;">Failed to load home data.</div>`;
    }
}

init();
