import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

renderNav();

let allData = {};
let allSeasons = [];

function ordinal(n) {
    const s = ["th","st","nd","rd"];
    const v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
}

const CARD_W = 190;
const CARD_H = 60;
const ROW_H = 72;
const ROUND_W = 230;
const PAD_TOP = 36;
const PAD_LEFT = 20;
const FONT = "font-size:12px;font-family:-apple-system,sans-serif;";

function buildBracketSVG(matches) {
    if (!matches || !matches.length) return "";

    const byRound = {};
    matches.forEach(m => {
        if (!byRound[m.round]) byRound[m.round] = [];
        byRound[m.round].push(m);
    });

    const rounds = Object.keys(byRound).sort((a,b) => Number(a)-Number(b)).map(Number);
    const maxMatchesR1 = byRound[rounds[0]].length;

    const totalH = PAD_TOP + maxMatchesR1 * ROW_H + 20;
    const totalW = PAD_LEFT + rounds.length * ROUND_W + 20;

    const roundNames = { 1: "Quarterfinals", 2: "Semifinals", 3: "Championship" };

    let svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="overflow:visible;max-width:100%;">`;

    const cardPositions = {};

    rounds.forEach((round, ri) => {
        const ms = byRound[round];
        const x = PAD_LEFT + ri * ROUND_W;
        const slotsPerCard = maxMatchesR1 / ms.length;

        svg += `<text x="${x + CARD_W/2}" y="20" text-anchor="middle"
            style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;fill:#9ca3af;font-family:-apple-system,sans-serif;">
            ${roundNames[round] || `Round ${round}`}
        </text>`;

        ms.forEach((m, mi) => {
            const slotTop = PAD_TOP + mi * slotsPerCard * ROW_H;
            const slotBot = slotTop + slotsPerCard * ROW_H;
            const cy = (slotTop + slotBot) / 2;
            const cardY = cy - CARD_H / 2;

            if (!cardPositions[round]) cardPositions[round] = {};
            cardPositions[round][mi] = { x, y: cardY, cy };

            const t1won = m.winner === m.team1;
            const t2won = m.winner === m.team2;
            const isChamp = m.place === 1;

            svg += `<rect x="${x}" y="${cardY}" width="${CARD_W}" height="${CARD_H}"
                rx="8" fill="${isChamp ? '#fffbeb' : '#f9fafb'}"
                stroke="${isChamp ? '#fcd34d' : '#e5e7eb'}" stroke-width="${isChamp ? 1.5 : 0.8}"/>`;

            svg += `<line x1="${x+1}" y1="${cardY+CARD_H/2}" x2="${x+CARD_W-1}" y2="${cardY+CARD_H/2}"
                stroke="#e5e7eb" stroke-width="0.5"/>`;

            const t1c = t1won ? '#111827' : '#9ca3af';
            const t1w = t1won ? '700' : '400';
            const t1s = !t1won && m.winner ? 'text-decoration:line-through;' : '';
            svg += `<text x="${x+10}" y="${cardY+17}" dominant-baseline="central"
                style="${FONT}font-weight:${t1w};fill:${t1c};${t1s}">${m.team1 || ''}</text>`;
            if (m.team1_pts != null) {
                svg += `<text x="${x+CARD_W-8}" y="${cardY+17}" text-anchor="end" dominant-baseline="central"
                    style="${FONT}font-weight:${t1w};fill:${t1c};">${m.team1_pts.toFixed(1)}</text>`;
            }

            const t2c = t2won ? '#111827' : '#9ca3af';
            const t2w = t2won ? '700' : '400';
            const t2s = !t2won && m.winner ? 'text-decoration:line-through;' : '';
            svg += `<text x="${x+10}" y="${cardY+CARD_H-13}" dominant-baseline="central"
                style="${FONT}font-weight:${t2w};fill:${t2c};${t2s}">${m.team2 || ''}</text>`;
            if (m.team2_pts != null) {
                svg += `<text x="${x+CARD_W-8}" y="${cardY+CARD_H-13}" text-anchor="end" dominant-baseline="central"
                    style="${FONT}font-weight:${t2w};fill:${t2c};">${m.team2_pts.toFixed(1)}</text>`;
            }

            if (m.place) {
                const bc = m.place === 1 ? '#f59e0b' : m.place === 3 ? '#b45309' : '#6b7280';
                svg += `<rect x="${x+CARD_W-34}" y="${cardY-9}" width="32" height="16" rx="8" fill="${bc}"/>`;
                svg += `<text x="${x+CARD_W-18}" y="${cardY-1}" text-anchor="middle" dominant-baseline="central"
                    style="font-size:10px;font-weight:700;fill:#fff;font-family:-apple-system,sans-serif;">${ordinal(m.place)}</text>`;
            }
        });
    });

    // Straight connector lines: horizontal from card right edge, vertical to align, horizontal to next card
    rounds.forEach((round, ri) => {
        if (ri === 0) return;
        const prevRound = rounds[ri - 1];
        const curMatches = byRound[round];

        curMatches.forEach((cm, cmi) => {
            const cur = cardPositions[round]?.[cmi];
            if (!cur) return;

            const prev1 = cardPositions[prevRound]?.[cmi * 2];
            const prev2 = cardPositions[prevRound]?.[cmi * 2 + 1];

            const midX = cur.x - (ROUND_W - CARD_W) / 2;

            if (prev1) {
                // Horizontal from prev card to midX
                svg += `<line x1="${prev1.x + CARD_W}" y1="${prev1.cy}" x2="${midX}" y2="${prev1.cy}"
                    stroke="#d1d5db" stroke-width="1"/>`;
            }
            if (prev2) {
                svg += `<line x1="${prev2.x + CARD_W}" y1="${prev2.cy}" x2="${midX}" y2="${prev2.cy}"
                    stroke="#d1d5db" stroke-width="1"/>`;
            }
            if (prev1 && prev2) {
                // Vertical connecting the two horizontal lines
                svg += `<line x1="${midX}" y1="${prev1.cy}" x2="${midX}" y2="${prev2.cy}"
                    stroke="#d1d5db" stroke-width="1"/>`;
                // Horizontal from midpoint to next card
                const midY = (prev1.cy + prev2.cy) / 2;
                svg += `<line x1="${midX}" y1="${midY}" x2="${cur.x}" y2="${midY}"
                    stroke="#d1d5db" stroke-width="1"/>`;
            } else if (prev1) {
                svg += `<line x1="${midX}" y1="${prev1.cy}" x2="${cur.x}" y2="${cur.cy}"
                    stroke="#d1d5db" stroke-width="1"/>`;
            }
        });
    });

    svg += `</svg>`;
    return svg;
}

function renderSeason(year) {
    const s = allData[year];
    if (!s) return "";
    const standings = s.standings || [];
    const winners = s.winners_bracket || [];
    const losers = s.losers_bracket || [];
    const champ = s.champion;

    const playoffTeams = new Set();
    winners.forEach(m => { playoffTeams.add(m.team1); playoffTeams.add(m.team2); });

    const standingsHtml = `
        <div class="card" style="padding:14px;">
            <div class="sh-section-title">Regular Season</div>
            <table class="sh-table">
                <thead><tr>
                    <th style="width:20px;text-align:left;">#</th>
                    <th style="text-align:left;">Team</th>
                    <th>W</th><th>L</th><th>PF</th><th>PA</th>
                </tr></thead>
                <tbody>
                    ${standings.map((t, i) => `
                        <tr class="${t.name === champ ? 'champ-row' : playoffTeams.has(t.name) ? 'playoff-row' : ''}">
                            <td class="rank">${i+1}</td>
                            <td style="text-align:left;font-weight:600;">${t.name}${t.name === champ ? ' 🏆' : ''}</td>
                            <td>${t.wins}</td><td>${t.losses}</td>
                            <td>${t.pf}</td><td>${t.pa}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;

    const bracketHtml = `
        <div class="card" style="padding:14px;">
            <div class="sh-section-title">Playoff Bracket</div>
            <div class="bracket-wrap">${buildBracketSVG(winners)}</div>
            ${losers.length ? `
                <div class="sh-section-title" style="margin-top:24px;">Consolation Bracket</div>
                <div class="bracket-wrap" style="max-height:200px;">${buildBracketSVG(losers)}</div>
            ` : ""}
        </div>
    `;

    const champBadge = champ ? `<div class="sh-champion">🏆 ${champ}</div>` : "";

    return `
        <div class="sh-year" data-year="${year}">
            <div class="sh-year-header">
                <div class="sh-year-title">${year}</div>
                ${champBadge}
            </div>
            <div class="sh-grid">
                ${standingsHtml}
                ${bracketHtml}
            </div>
        </div>
    `;
}

function render(filterYear) {
    const board = document.getElementById("sh-board");
    const years = filterYear === "all" ? allSeasons : [filterYear];
    board.innerHTML = years.map(renderSeason).join("");
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    const container = document.getElementById("history-container");

    allData = await api.getSeasonHistory();
    allSeasons = Object.keys(allData).filter(y => allData[y].champion).sort().reverse();

    container.innerHTML = `
    <style>
        #history-container { max-width: 1100px; }
        .sh-year { margin-bottom: 52px; }
        .sh-year-header {
            display:flex; align-items:center; gap:16px;
            margin-bottom:20px; padding-bottom:14px;
            border-bottom:2px solid #e5e7eb;
        }
        .sh-year-title { font-size:24px; font-weight:800; color:#111827; }
        .sh-champion {
            background:linear-gradient(135deg,#fef9c3,#fde68a);
            border:1px solid #fcd34d; border-radius:999px;
            padding:4px 14px; font-size:13px; font-weight:700; color:#92400e;
        }
        .sh-grid { display:grid; grid-template-columns:280px 1fr; gap:20px; align-items:start; }
        .sh-section-title {
            font-size:11px; text-transform:uppercase; letter-spacing:0.06em;
            color:#9ca3af; font-weight:700; margin-bottom:10px;
        }
        .sh-table { width:100%; border-collapse:collapse; font-size:12px; }
        .sh-table th {
            text-align:center; font-size:10px; text-transform:uppercase;
            letter-spacing:0.05em; color:#9ca3af; padding:5px 6px;
            border-bottom:1px solid #e5e7eb; font-weight:600; white-space:nowrap;
        }
        .sh-table td {
            padding:6px 6px; text-align:center;
            border-bottom:1px solid #f3f4f6; color:#374151; white-space:nowrap;
        }
        .rank { color:#9ca3af; font-size:11px; }
        .sh-table tr:hover td { background:#f9fafb; }
        .playoff-row td { background:#fffbeb !important; }
        .champ-row td { background:#fef3c7 !important; font-weight:700; }
        .bracket-wrap { overflow-x:auto; padding-bottom:8px; -webkit-overflow-scrolling:touch; }
        @media (max-width:800px) { .sh-grid { grid-template-columns:1fr; } }
    </style>

    <div class="filter-bar" style="margin-bottom:24px;">
        <select id="sh-select">
            <option value="all">All Seasons</option>
            ${allSeasons.map(y => `<option value="${y}">${y}</option>`).join("")}
        </select>
    </div>

    <div id="sh-board"></div>
    `;

    document.getElementById("sh-select").addEventListener("change", e => render(e.target.value));
    render("all");
}

init();