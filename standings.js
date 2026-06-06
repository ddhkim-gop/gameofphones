import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

let standings = null;
let transactions = null;
let history = null;
let leagueUsers = [];
let divisionsData = {};
let allPlayerStats = {};
let allDraftData = {};
let playerNameMap = {};
let currentView = "all_time";
let currentPage = "standings"; // "standings" | "report_card"

const FAAB_BUDGET = 100;
const YEARS = ["2026", "2025", "2024", "2023"];
const STAT_YEARS = ["2023", "2024", "2025"]; // completed seasons with full stats

function computeFaabRemaining(year) {
    const spent = {};
    const result = {};
    const waivers = (transactions || [])
        .filter(t => t.season === year && t.type === "waiver" && t.status === "complete" && (t.waiver_bid || t.faab))
        .sort((a, b) => BigInt(a.transaction_id) < BigInt(b.transaction_id) ? -1 : 1);
    waivers.forEach(t => {
        const team = (t.teams || [])[0];
        if (!team) return;
        if (spent[team] === undefined) spent[team] = 0;
        spent[team] += (t.waiver_bid || t.faab || 0);
        result[team] = FAAB_BUDGET - spent[team];
    });
    return result;
}

function avatarEl(name, size) {
    const sz = size || 24;
    const u = leagueUsers.find(u => u.username === name);
    const url = u?.avatar_url;
    if (url) {
        return `<img src="${url}" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`;
    }
    return `<span style="width:${sz}px;height:${sz}px;border-radius:50%;background:#252830;display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.45)}px;font-weight:700;color:#5a6070;flex-shrink:0;">${(name||"?")[0].toUpperCase()}</span>`;
}

function buildTxStats(txData) {
    const stats = {};
    (txData || []).forEach(t => {
        if (t.status === "failed") return;
        if (t.type === "commissioner") return;
        const year = t.season;
        if (!stats[year]) stats[year] = {};
        (t.teams || []).forEach(name => {
            if (!stats[year][name]) stats[year][name] = { total: 0, trades: 0, waivers: 0, fa: 0 };
            stats[year][name].total++;
            if (t.type === "trade")       stats[year][name].trades++;
            if (t.type === "waiver")      stats[year][name].waivers++;
            if (t.type === "free_agent")  stats[year][name].fa++;
        });
    });
    return stats;
}

function buildPlayoffRecords(historyData, year) {
    const records = {};
    const season = (historyData || {})[year] || {};
    function processMatch(m) {
        if (!m.winner || !m.loser) return;
        if (!records[m.winner]) records[m.winner] = { wins: 0, losses: 0 };
        if (!records[m.loser])  records[m.loser]  = { wins: 0, losses: 0 };
        records[m.winner].wins++;
        records[m.loser].losses++;
    }
    (season.winners_bracket || []).forEach(processMatch);
    (season.losers_bracket  || []).forEach(processMatch);
    return records;
}

function buildAllTimePlayoffRecords(historyData) {
    const records = {};
    Object.values(historyData || {}).forEach(season => {
        function processMatch(m) {
            if (!m.winner || !m.loser) return;
            if (!records[m.winner]) records[m.winner] = { wins: 0, losses: 0 };
            if (!records[m.loser])  records[m.loser]  = { wins: 0, losses: 0 };
            records[m.winner].wins++;
            records[m.loser].losses++;
        }
        (season.winners_bracket || []).forEach(processMatch);
        (season.losers_bracket  || []).forEach(processMatch);
    });
    return records;
}

function buildAllTime(standingsData, txStats) {
    const combined = {};
    const seasonCounts = {};

    YEARS.forEach(year => {
        (standingsData[year] || []).forEach(row => {
            if (!combined[row.name]) {
                combined[row.name] = {
                    name: row.name, wins: 0, losses: 0, pf: 0, pa: 0,
                    total: 0, trades: 0, waivers: 0, fa: 0, highestPF: 0
                };
                seasonCounts[row.name] = 0;
            }
            const c = combined[row.name];
            c.wins    += row.wins;
            c.losses  += row.losses;
            c.pf      += row.pf;
            c.pa      += row.pa;
            c.highestPF = Math.max(c.highestPF, row.pf);
            seasonCounts[row.name]++;

            const tx = txStats[year]?.[row.name] || {};
            c.total   += tx.total   || 0;
            c.trades  += tx.trades  || 0;
            c.waivers += tx.waivers || 0;
            c.fa      += tx.fa      || 0;
        });
    });

    return Object.values(combined).map(r => ({
        ...r,
        seasons: seasonCounts[r.name] || 1,
        avgPF: r.pf / (seasonCounts[r.name] || 1),
    })).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
}

// ── Report Card logic ──────────────────────────────────────────────────────

function buildDraftGrades() {
    // Returns { year: { manager: avgSurplusPoints } }
    const result = {};
    STAT_YEARS.forEach(year => {
        const yearDraft = allDraftData[year] || [];
        if (!yearDraft.length) return;
        const stats = allPlayerStats[year] || {};

        const picks = yearDraft.map(pick => {
            const pid = playerNameMap[pick.player];
            const pts = pid && stats[pid] ? stats[pid].pts_half_ppr : null;
            return { ...pick, pts };
        });

        // Average pts per round
        const roundAvg = {};
        picks.forEach(p => {
            if (p.pts == null) return;
            if (!roundAvg[p.round]) roundAvg[p.round] = { sum: 0, count: 0 };
            roundAvg[p.round].sum += p.pts;
            roundAvg[p.round].count++;
        });
        Object.keys(roundAvg).forEach(r => {
            roundAvg[r].avg = roundAvg[r].sum / roundAvg[r].count;
        });

        // Per-team surplus: actual pts - expected pts for that round
        const teamSurplus = {};
        picks.forEach(p => {
            if (p.pts == null) return;
            const expected = roundAvg[p.round]?.avg || 0;
            if (!teamSurplus[p.picked_by]) teamSurplus[p.picked_by] = { sum: 0, count: 0 };
            teamSurplus[p.picked_by].sum += p.pts - expected;
            teamSurplus[p.picked_by].count++;
        });
        result[year] = {};
        Object.entries(teamSurplus).forEach(([team, d]) => {
            result[year][team] = d.count > 0 ? d.sum / d.count : 0;
        });
    });
    return result;
}

function buildTradeGrades() {
    // Returns { manager: { totalNetValue, count } }
    const result = {};
    (transactions || [])
        .filter(t => t.type === "trade" && t.status === "complete" && STAT_YEARS.includes(t.season))
        .forEach(t => {
            const stats = allPlayerStats[t.season] || {};
            t.teams.forEach(team => {
                if (!result[team]) result[team] = { totalNetValue: 0, count: 0 };
                const received = (t.assets_received?.[team] || []).filter(a => a.position !== "PICK");
                const given = t.teams
                    .filter(ot => ot !== team)
                    .flatMap(ot => (t.assets_received?.[ot] || []).filter(a => a.position !== "PICK"));

                const ptsFor = (arr) => arr.reduce((sum, p) => {
                    const pid = playerNameMap[p.name];
                    return sum + (pid && stats[pid] ? stats[pid].pts_half_ppr : 0);
                }, 0);

                const ptsReceived = ptsFor(received);
                const ptsGiven = ptsFor(given);
                const total = received.length + given.length;
                const net = total > 0 ? (ptsReceived - ptsGiven) / total : 0;
                result[team].totalNetValue += net;
                result[team].count++;
            });
        });
    return result;
}

function buildWaiverGrades() {
    // Returns { manager: { hits, total } } — "hit" = waiver add scored above median
    const claims = [];
    (transactions || [])
        .filter(t => t.type === "waiver" && t.status === "complete" && STAT_YEARS.includes(t.season))
        .forEach(t => {
            const stats = allPlayerStats[t.season] || {};
            const team = (t.teams || [])[0];
            if (!team) return;
            (t.added || []).forEach(p => {
                if (p.position === "K" || p.position === "DEF") return;
                const pid = playerNameMap[p.name];
                const pts = pid && stats[pid] ? stats[pid].pts_half_ppr : null;
                claims.push({ team, pts });
            });
        });

    const validPts = claims.filter(c => c.pts != null).map(c => c.pts).sort((a, b) => a - b);
    const median = validPts.length ? validPts[Math.floor(validPts.length / 2)] : 0;

    const result = {};
    claims.forEach(({ team, pts }) => {
        if (!result[team]) result[team] = { hits: 0, total: 0 };
        result[team].total++;
        if (pts != null && pts > median) result[team].hits++;
    });
    return result;
}

function computeManagerStats() {
    const draftGrades = buildDraftGrades();
    const tradeGrades = buildTradeGrades();
    const waiverGrades = buildWaiverGrades();
    const managers = {};

    YEARS.forEach(year => {
        const seasonStandings = (standings || {})[year] || [];
        const season = (history || {})[year] || {};
        const winners = season.winners_bracket || [];
        const champMatch = winners.find(m => m.place === 1);
        const champ = champMatch?.winner;
        const finalist = champMatch?.loser;
        const playoffTeams = new Set(winners.flatMap(m => [m.winner, m.loser].filter(Boolean)));

        seasonStandings.forEach((row, idx) => {
            const name = row.name;
            if (!managers[name]) {
                managers[name] = {
                    name, seasons: 0,
                    totalWins: 0, totalLosses: 0, totalPF: 0, totalPA: 0,
                    championships: 0, finals: 0, playoffAppearances: 0,
                    seeds: [], pyLuck: 0,
                    draftSurpluses: [],
                    tradeValue: 0, tradeCount: 0,
                    waiverHits: 0, waiverTotal: 0,
                };
            }
            const m = managers[name];
            m.seasons++;
            m.totalWins    += row.wins;
            m.totalLosses  += row.losses;
            m.totalPF      += row.pf;
            m.totalPA      += row.pa;
            if (name === champ)    m.championships++;
            if (name === finalist) m.finals++;
            if (playoffTeams.has(name)) m.playoffAppearances++;
            m.seeds.push(idx + 1);

            // Pythagorean luck (actual wins vs expected from PF/PA ratio)
            const games = row.wins + row.losses;
            const pyWins = games > 0 ? (row.pf ** 2) / (row.pf ** 2 + row.pa ** 2) * games : 0;
            m.pyLuck += row.wins - pyWins;

            // Draft surplus for this year
            const ds = draftGrades[year]?.[name];
            if (ds !== undefined) m.draftSurpluses.push(ds);
        });
    });

    // Merge trade and waiver grades
    Object.values(managers).forEach(m => {
        const tg = tradeGrades[m.name];
        if (tg) { m.tradeValue = tg.totalNetValue; m.tradeCount = tg.count; }
        const wg = waiverGrades[m.name];
        if (wg) { m.waiverHits = wg.hits; m.waiverTotal = wg.total; }
    });

    return Object.values(managers);
}

function normalize(val, min, max) {
    if (max === min) return 50;
    return Math.max(0, Math.min(100, (val - min) / (max - min) * 100));
}

function scoreToGrade(score) {
    if (score >= 93) return "A+";
    if (score >= 90) return "A";
    if (score >= 87) return "A-";
    if (score >= 83) return "B+";
    if (score >= 80) return "B";
    if (score >= 77) return "B-";
    if (score >= 73) return "C+";
    if (score >= 70) return "C";
    if (score >= 67) return "C-";
    if (score >= 60) return "D";
    return "F";
}

function gradeColor(grade) {
    if (!grade || grade === "—") return "#5a6070";
    const g = grade[0];
    if (g === "A") return "#3ecf8e";
    if (g === "B") return "#60a5fa";
    if (g === "C") return "#fbbf24";
    if (g === "D") return "#f97316";
    return "#f87171";
}

function computeGrades(allManagers) {
    const pick = (fn) => allManagers.map(fn);

    const playoffRates  = pick(m => m.seasons > 0 ? m.playoffAppearances / m.seasons : 0);
    const winRates      = pick(m => (m.totalWins + m.totalLosses) > 0 ? m.totalWins / (m.totalWins + m.totalLosses) : 0);
    const champRates    = pick(m => m.seasons > 0 ? m.championships / m.seasons : 0);
    const avgSeeds      = pick(m => m.seeds.length > 0 ? m.seeds.reduce((a,b) => a+b) / m.seeds.length : 12);
    const pyLucks       = pick(m => m.pyLuck);
    const draftScores   = pick(m => m.draftSurpluses.length > 0 ? m.draftSurpluses.reduce((a,b) => a+b) / m.draftSurpluses.length : 0);
    const tradeScores   = pick(m => m.tradeCount > 0 ? m.tradeValue / m.tradeCount : 0);
    const waiverRates   = pick(m => m.waiverTotal > 0 ? m.waiverHits / m.waiverTotal : 0);

    const mm = arr => [Math.min(...arr), Math.max(...arr)];
    const [prMin, prMax] = mm(playoffRates);
    const [wrMin, wrMax] = mm(winRates);
    const [crMin, crMax] = mm(champRates);
    const [asMin, asMax] = mm(avgSeeds);
    const [plMin, plMax] = mm(pyLucks);
    const [dsMin, dsMax] = mm(draftScores);
    const [tsMin, tsMax] = mm(tradeScores);
    const [waMin, waMax] = mm(waiverRates);

    return allManagers.map((m, i) => {
        const playoffScore  = normalize(playoffRates[i], prMin, prMax);
        const winScore      = normalize(winRates[i], wrMin, wrMax);
        const champScore    = normalize(champRates[i], crMin, crMax);
        const seedScore     = normalize(-avgSeeds[i], -asMax, -asMin); // lower seed = better
        const luckScore     = normalize(pyLucks[i], plMin, plMax);
        const draftScore    = normalize(draftScores[i], dsMin, dsMax);
        const tradeScore    = normalize(tradeScores[i], tsMin, tsMax);
        const waiverScore   = normalize(waiverRates[i], waMin, waMax);

        const hasDraft  = m.draftSurpluses.length > 0;
        const hasTrade  = m.tradeCount > 0;
        const hasWaiver = m.waiverTotal > 0;

        const composite =
            playoffScore * 0.15 +
            winScore     * 0.10 +
            champScore   * 0.30 +
            seedScore    * 0.15 +
            (hasDraft  ? draftScore  : 50) * 0.15 +
            (hasTrade  ? tradeScore  : 50) * 0.05 +
            (hasWaiver ? waiverScore : 50) * 0.05 +
            luckScore    * 0.05;

        return {
            ...m,
            playoffRate:   playoffRates[i],
            winRate:       winRates[i],
            avgSeed:       avgSeeds[i],
            draftSurpAvg:  draftScores[i],
            tradeValueAvg: tradeScores[i],
            waiverRate:    waiverRates[i],
            composite,
            grade:        scoreToGrade(composite),
            draftGrade:   hasDraft  ? scoreToGrade(draftScore)  : "—",
            tradeGrade:   hasTrade  ? scoreToGrade(tradeScore)  : "—",
            waiverGrade:  hasWaiver ? scoreToGrade(waiverScore) : "—",
        };
    });
}

function metricCell(label, value, color) {
    const c = color || "#f0f1f3";
    return `
        <div style="background:#252830;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:4px;">${label}</div>
            <div style="font-size:16px;font-weight:700;color:${c};">${value}</div>
        </div>
    `;
}

function gradeCell(label, grade) {
    const c = gradeColor(grade);
    return `
        <div style="background:#252830;border-radius:8px;padding:10px 12px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:4px;">${label}</div>
            <div style="font-size:20px;font-weight:800;color:${c};">${grade || "—"}</div>
        </div>
    `;
}

function gradeWeightRow(label, pct, desc) {
    const barW = Math.round(pct * 3.5); // max 70px for 20%
    return `
        <div style="background:#252830;border-radius:8px;padding:10px 12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                <span style="font-size:12px;font-weight:700;color:#c9cdd4;">${label}</span>
                <span style="font-size:12px;font-weight:800;color:#3ecf8e;">${pct}%</span>
            </div>
            <div style="height:4px;background:#1e2027;border-radius:2px;margin-bottom:6px;">
                <div style="height:4px;width:${barW}px;max-width:100%;background:#3ecf8e;border-radius:2px;"></div>
            </div>
            <div style="font-size:10px;color:#5a6070;">${desc}</div>
        </div>
    `;
}

function renderReportCard() {
    const allManagers = computeManagerStats();
    const withGrades = computeGrades(allManagers).sort((a, b) => b.composite - a.composite);

    let html = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">`;

    withGrades.forEach(m => {
        const playoffPct  = (m.playoffRate * 100).toFixed(0) + "%";
        const winPct      = (m.winRate * 100).toFixed(1) + "%";
        const avgSeedStr  = m.avgSeed.toFixed(1);
        const pfPerGame   = (m.totalWins + m.totalLosses) > 0
            ? (m.totalPF / (m.totalWins + m.totalLosses)).toFixed(1) : "—";
        const pyLuck      = m.pyLuck.toFixed(1);
        const pyLuckStr   = m.pyLuck >= 0 ? `+${pyLuck}` : pyLuck;
        const pyLuckColor = m.pyLuck > 2 ? "#3ecf8e" : m.pyLuck < -2 ? "#f87171" : "#c9cdd4";
        const playoffColor = m.playoffRate >= 0.75 ? "#3ecf8e" : m.playoffRate >= 0.5 ? "#60a5fa" : "#f87171";

        const gc = gradeColor(m.grade);
        const champBadge = m.championships > 0
            ? `<div style="background:#2c2102;border:0.8px solid #b45309;border-radius:8px;padding:6px 12px;margin-bottom:12px;font-size:12px;color:#fbbf24;font-weight:700;">🏆 ${m.championships} Championship${m.championships > 1 ? "s" : ""}</div>`
            : "";

        html += `
            <div class="card" style="padding:20px;background:#1e2027;border-color:#2d3139;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                    ${avatarEl(m.name, 40)}
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:700;color:#f0f1f3;">${m.name}</div>
                        <div style="font-size:11px;color:#5a6070;">${m.seasons} season${m.seasons !== 1 ? "s" : ""} · ${m.totalWins}W-${m.totalLosses}L</div>
                    </div>
                    <div style="text-align:center;background:${gc}1a;border:1.5px solid ${gc};border-radius:10px;padding:6px 14px;flex-shrink:0;">
                        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:${gc};opacity:0.8;margin-bottom:2px;">Overall</div>
                        <div style="font-size:24px;font-weight:800;color:${gc};line-height:1;">${m.grade}</div>
                    </div>
                </div>
                ${champBadge}
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2d3139;">Category Grades</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
                    ${gradeCell("Draft", m.draftGrade)}
                    ${gradeCell("Trades", m.tradeGrade)}
                    ${gradeCell("Waivers", m.waiverGrade)}
                </div>
                <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #2d3139;">Season Stats</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    ${metricCell("Playoff Rate", playoffPct, playoffColor)}
                    ${metricCell("Win Rate", winPct)}
                    ${metricCell("Avg Seed", avgSeedStr)}
                    ${metricCell("Finals", m.finals > 0 ? m.finals + "×" : "—")}
                    ${metricCell("PF/Game", pfPerGame)}
                    ${metricCell("Luck Index", pyLuckStr, pyLuckColor)}
                </div>
            </div>
        `;
    });

    html += `</div>
        <div style="margin-top:24px;background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:18px 20px;">
            <div style="font-size:13px;font-weight:700;color:#f0f1f3;margin-bottom:14px;">How the Overall Grade is computed</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:16px;">
                ${gradeWeightRow("Championship Rate", 30, "Championships ÷ seasons played")}
                ${gradeWeightRow("Avg Seed", 15, "Lower regular season finish = better")}
                ${gradeWeightRow("Playoff Rate", 15, "Playoff appearances ÷ seasons played")}
                ${gradeWeightRow("Draft Grade", 15, "Avg pts of picks vs round expectation")}
                ${gradeWeightRow("Win Rate", 10, "All-time regular season W/(W+L)")}
                ${gradeWeightRow("Trade Grade", 5, "Net pts received vs given per player")}
                ${gradeWeightRow("Waiver Hit Rate", 5, "% of adds scoring above median claim")}
                ${gradeWeightRow("Luck (inverse)", 5, "Rewards luck-adjusted performance")}
            </div>
            <div style="font-size:11px;color:#5a6070;line-height:1.6;border-top:1px solid #2d3139;padding-top:12px;">
                All metrics are normalized across the 12 managers so grades are relative, not absolute — someone always gets an A and someone always gets an F.
                Draft, Trade, and Waiver grades use completed seasons only (2023–2025).
                Luck Index = actual wins − Pythagorean expected wins (PF²÷(PF²+PA²)).
            </div>
        </div>
    `;
    return html;
}

// ── Standings table logic ──────────────────────────────────────────────────

function renderTable(rows, txStats, year, playoffRecords, isAllTime) {
    if (!rows || !rows.length) return `<div class="s-empty">No data for this period.</div>`;

    const yearTx = txStats[year] || {};

    const enriched = rows.map((r, i) => {
        const tx = yearTx[r.name] || {};
        return {
            rank:     i + 1,
            name:     r.name,
            wins:     r.wins,
            losses:   r.losses,
            ties:     r.ties || 0,
            pf:       r.pf,
            pa:       r.pa,
            avgPF:    r.avgPF,
            highestPF: r.highestPF,
            seasons:  r.seasons,
            total:    r.total   ?? tx.total   ?? 0,
            trades:   r.trades  ?? tx.trades  ?? 0,
            waivers:  r.waivers ?? tx.waivers ?? 0,
            fa:       r.fa      ?? tx.fa      ?? 0,
            playoff:  playoffRecords[r.name] || null,
        };
    });

    const faabByTeam = (!isAllTime) ? computeFaabRemaining(year) : {};

    const allTimeExtraCols = isAllTime ? `
        <th>Avg PF</th>
        <th>Best PF</th>
        <th>Playoff W-L</th>
        <th>Seasons</th>
    ` : `<th>Playoff W-L</th><th>FAAB Left</th>`;

    let html = `
        <div class="s-table-wrap">
        <table class="s-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th class="left">Team</th>
                    <th>RS W</th>
                    <th>RS L</th>
                    <th>PF</th>
                    <th>PA</th>
                    <th>+/-</th>
                    ${allTimeExtraCols}
                    <th>Transactions</th>
                    <th>Trades</th>
                    <th>Waivers</th>
                    <th>FA</th>
                </tr>
            </thead>
            <tbody>
    `;

    enriched.forEach(r => {
        const diff = (r.pf - r.pa).toFixed(1);
        const diffColor = r.pf > r.pa ? "#3ecf8e" : "#f87171";
        const playoffStr = r.playoff ? `${r.playoff.wins}-${r.playoff.losses}` : "—";
        const faabLeft = faabByTeam[r.name];
        const faabStyle = faabLeft != null && faabLeft < 20 ? "color:#f87171;font-weight:700;" : "";

        const extraCols = isAllTime ? `
            <td class="num">${r.avgPF != null ? r.avgPF.toFixed(1) : "—"}</td>
            <td class="num">${r.highestPF != null ? r.highestPF.toFixed(1) : "—"}</td>
            <td class="num">${playoffStr}</td>
            <td class="num" style="color:#5a6070;">${r.seasons ?? "—"}</td>
        ` : `<td class="num">${playoffStr}</td><td class="num" style="${faabStyle}">${faabLeft != null ? `$${faabLeft}` : "—"}</td>`;

        html += `
            <tr>
                <td class="rank">${r.rank}</td>
                <td class="team-name">
                    <div style="display:flex;align-items:center;gap:8px;">
                        ${avatarEl(r.name, 26)}
                        <span>${r.name}</span>
                    </div>
                </td>
                <td class="num wins">${r.wins}</td>
                <td class="num losses">${r.losses}</td>
                <td class="num">${r.pf.toFixed(1)}</td>
                <td class="num">${r.pa.toFixed(1)}</td>
                <td class="num" style="color:${diffColor};font-weight:700;">${diff > 0 ? "+" : ""}${diff}</td>
                ${extraCols}
                <td class="num">${r.total}</td>
                <td class="num">${r.trades}</td>
                <td class="num">${r.waivers}</td>
                <td class="num">${r.fa}</td>
            </tr>
        `;
    });

    html += `</tbody></table></div>`;
    return html;
}

function renderDivisions(allRows, txStats, year, playoffRecords) {
    const divMap = divisionsData[year] || {};
    const hasDivs = Object.keys(divMap).length > 0;

    if (!hasDivs) {
        return renderTable(allRows, txStats, year, playoffRecords, false);
    }

    const div1 = allRows.filter(r => divMap[r.name] === 1).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    const div2 = allRows.filter(r => divMap[r.name] === 2).sort((a, b) => b.wins - a.wins || b.pf - a.pf);
    const unassigned = allRows.filter(r => divMap[r.name] == null);

    const DIV_LABEL = `
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
            color:#5a6070;padding:10px 12px 6px;margin-top:12px;border-bottom:1px solid #2d3139;">
    `;

    let html = "";
    if (div1.length) html += `${DIV_LABEL}Division 1</div>` + renderTable(div1, txStats, year, playoffRecords, false);
    if (div2.length) html += `${DIV_LABEL}Division 2</div>` + renderTable(div2, txStats, year, playoffRecords, false);
    if (unassigned.length) html += `${DIV_LABEL}Other</div>` + renderTable(unassigned, txStats, year, playoffRecords, false);
    return html;
}

function render() {
    const board = document.getElementById("s-board");
    const label = document.getElementById("s-label");
    const yearSelect = document.getElementById("s-select");

    if (currentPage === "report_card") {
        if (yearSelect) yearSelect.style.display = "none";
        label.textContent = "Manager Report Card";
        board.innerHTML = renderReportCard();
        return;
    }

    if (yearSelect) yearSelect.style.display = "";
    const txStats = buildTxStats(transactions);

    if (currentView === "all_time") {
        label.textContent = "All Years Standings";
        const rows = buildAllTime(standings, txStats);
        const playoffRecords = buildAllTimePlayoffRecords(history);
        board.innerHTML = renderTable(rows, {}, "all_time", playoffRecords, true);
    } else {
        label.textContent = `${currentView} Season`;
        const rows = standings[currentView] || [];
        const playoffRecords = buildPlayoffRecords(history, currentView);
        board.innerHTML = renderDivisions(rows, txStats, currentView, playoffRecords);
    }
}

function switchPage(page) {
    currentPage = page;
    document.querySelectorAll(".page-tab").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`tab-${page}`);
    if (activeBtn) activeBtn.classList.add("active");
    render();
}

window.switchPage = switchPage;

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    renderNav();

    const container = document.getElementById("standings-container");

    container.innerHTML = `
    <style>
        #standings-container { max-width: 1050px; margin: 0; }

        .s-label {
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 16px;
            color: #f0f1f3;
        }

        .s-table-wrap { overflow-x: auto; }

        .s-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            background: #1e2027;
            border-radius: 12px;
            overflow: hidden;
        }
        .s-table thead th {
            text-align: center;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #5a6070;
            padding: 10px 10px;
            border-bottom: 1px solid #2d3139;
            white-space: nowrap;
            background: #252830;
            font-weight: 700;
        }
        .s-table thead th.left { text-align: left; }

        .s-table tbody tr {
            border-bottom: 1px solid #2d3139;
            transition: background 0.1s;
        }
        .s-table tbody tr:last-child { border-bottom: none; }
        .s-table tbody tr:hover { background: #252830; }

        .s-table td {
            padding: 10px 10px;
            text-align: center;
            vertical-align: middle;
        }

        td.rank {
            font-size: 12px;
            color: #5a6070;
            font-weight: 700;
            width: 32px;
        }
        td.team-name {
            text-align: left;
            font-weight: 700;
            font-size: 14px;
            color: #f0f1f3;
            white-space: nowrap;
        }
        td.wins   { color: #3ecf8e; font-weight: 700; }
        td.losses { color: #f87171; font-weight: 700; }
        td.num    { color: #c9cdd4; }

        .s-empty {
            color: #5a6070;
            padding: 40px 0;
            text-align: center;
        }

        .page-tab {
            background: none;
            border: none;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            color: #8b9099;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            font-family: inherit;
        }
        .page-tab:hover { color: #f0f1f3; background: #1e2027; }
        .page-tab.active { color: #f0f1f3; background: #1e2027; }
    </style>

    <div class="s-controls" id="s-controls"></div>
    <div class="s-label" id="s-label"></div>
    <div id="s-board">Loading...</div>
    `;

    try {
        const [
            standingsData, txData, historyData, usersData, divsData,
            nameMap,
            stats2023, stats2024, stats2025,
            draft2023, draft2024, draft2025,
        ] = await Promise.all([
            api.getStandings(),
            api.getTransactions(),
            api.getSeasonHistory(),
            api.getLeagueUsers(),
            api.getDivisions(),
            api.getPlayerNameMap(),
            api.getPlayerStats("2023"),
            api.getPlayerStats("2024"),
            api.getPlayerStats("2025"),
            api.getDraft("2023"),
            api.getDraft("2024"),
            api.getDraft("2025"),
        ]);

        standings     = standingsData;
        transactions  = txData;
        history       = historyData;
        leagueUsers   = usersData;
        divisionsData = divsData;
        playerNameMap = nameMap;
        allPlayerStats["2023"] = stats2023;
        allPlayerStats["2024"] = stats2024;
        allPlayerStats["2025"] = stats2025;
        allDraftData["2023"] = draft2023;
        allDraftData["2024"] = draft2024;
        allDraftData["2025"] = draft2025;

        const controls = document.getElementById("s-controls");
        controls.innerHTML = `
            <div class="filter-bar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
                <div style="display:flex;background:#252830;border-radius:10px;padding:3px;gap:2px;">
                    <button class="page-tab active" id="tab-standings" onclick="switchPage('standings')">Standings</button>
                    <button class="page-tab" id="tab-report_card" onclick="switchPage('report_card')">Manager Report Card</button>
                </div>
                <select id="s-select">
                    <option value="all_time" selected>All Years</option>
                    <option value="2026">2026</option>
                    <option value="2025">2025</option>
                    <option value="2024">2024</option>
                    <option value="2023">2023</option>
                </select>
            </div>
        `;
        document.getElementById("s-select").addEventListener("change", (e) => {
            currentView = e.target.value;
            render();
        });
        render();

    } catch (err) {
        console.error(err);
        document.getElementById("s-board").innerHTML = "Failed to load standings.";
    }
}

init();
