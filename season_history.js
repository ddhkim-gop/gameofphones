import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

renderNav();

let allData = {};
let allSeasons = [];
let allMatchups = {};    // year → matchup data
let allTransactions = []; // flat list

function ordinal(n) {
    const s = ["th","st","nd","rd"];
    const v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
}

const CARD_W = 200;
const CARD_H = 64;
const ROW_H = 100;
const ROUND_W = 260;
const PAD_TOP = 54;
const PAD_LEFT = 20;
const FONT = "font-size:12px;font-family:-apple-system,sans-serif;";

function buildBracketSVG(matches, playoffWeek1 = 15) {
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

    const SVG_CARD    = "#252830";
    const SVG_STROKE  = "#3d4350";
    const SVG_CHAMP   = "#2c2102";
    const SVG_CGOLD   = "#b45309";
    const SVG_TEXT1   = "#f0f1f3";
    const SVG_TEXT2   = "#9aa3b0";
    const SVG_LINE    = "#3d4350";
    const SVG_DIVIDER = "#2d3139";

    let svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="overflow:visible;max-width:100%;background:transparent;">`;

    const cardPositions = {};

    rounds.forEach((round, ri) => {
        const ms = byRound[round];
        const x = PAD_LEFT + ri * ROUND_W;
        const slotsPerCard = maxMatchesR1 / ms.length;
        const weekNum = playoffWeek1 + round - 1;
        const isLast = ri === rounds.length - 1;
        const roundLabel = isLast ? "Finals" : `Round ${ri + 1}`;

        svg += `<text x="${x + CARD_W/2}" y="18" text-anchor="middle"
            style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;fill:${SVG_TEXT2};font-family:-apple-system,sans-serif;">
            ${roundLabel}
        </text>`;
        svg += `<text x="${x + CARD_W/2}" y="34" text-anchor="middle"
            style="font-size:10px;fill:${SVG_TEXT2};opacity:0.65;font-family:-apple-system,sans-serif;">
            (Week ${weekNum})
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
                rx="8" fill="${isChamp ? SVG_CHAMP : SVG_CARD}"
                stroke="${isChamp ? SVG_CGOLD : SVG_STROKE}" stroke-width="${isChamp ? 1.5 : 0.8}"/>`;

            svg += `<line x1="${x+1}" y1="${cardY+CARD_H/2}" x2="${x+CARD_W-1}" y2="${cardY+CARD_H/2}"
                stroke="${SVG_DIVIDER}" stroke-width="0.5"/>`;

            const t1c = t1won ? SVG_TEXT1 : SVG_TEXT2;
            const t1w = t1won ? '700' : '400';
            const t1s = !t1won && m.winner ? 'text-decoration:line-through;' : '';
            svg += `<text x="${x+10}" y="${cardY+17}" dominant-baseline="central"
                style="${FONT}font-weight:${t1w};fill:${t1c};${t1s}">${m.team1 || ''}</text>`;
            if (m.team1_pts != null) {
                svg += `<text x="${x+CARD_W-8}" y="${cardY+17}" text-anchor="end" dominant-baseline="central"
                    style="${FONT}font-weight:${t1w};fill:${t1c};">${m.team1_pts.toFixed(1)}</text>`;
            }

            const t2c = t2won ? SVG_TEXT1 : SVG_TEXT2;
            const t2w = t2won ? '700' : '400';
            const t2s = !t2won && m.winner ? 'text-decoration:line-through;' : '';
            svg += `<text x="${x+10}" y="${cardY+CARD_H-13}" dominant-baseline="central"
                style="${FONT}font-weight:${t2w};fill:${t2c};${t2s}">${m.team2 || ''}</text>`;
            if (m.team2_pts != null) {
                svg += `<text x="${x+CARD_W-8}" y="${cardY+CARD_H-13}" text-anchor="end" dominant-baseline="central"
                    style="${FONT}font-weight:${t2w};fill:${t2c};">${m.team2_pts.toFixed(1)}</text>`;
            }

            if (m.place) {
                // Winner badge
                const bc = m.place === 1 ? '#f59e0b' : m.place === 3 ? '#cd7f32' : '#3d4350';
                svg += `<rect x="${x+CARD_W-34}" y="${cardY-9}" width="32" height="16" rx="8" fill="${bc}"/>`;
                svg += `<text x="${x+CARD_W-18}" y="${cardY-1}" text-anchor="middle" dominant-baseline="central"
                    style="font-size:10px;font-weight:700;fill:#fff;font-family:-apple-system,sans-serif;">${ordinal(m.place)}</text>`;
                // Championship loser gets silver (2nd place)
                if (m.place === 1 && m.loser) {
                    const loserY = m.winner === m.team1 ? cardY + CARD_H - 7 : cardY - 9;
                    svg += `<rect x="${x+CARD_W-34}" y="${loserY}" width="32" height="16" rx="8" fill="#94a3b8"/>`;
                    svg += `<text x="${x+CARD_W-18}" y="${loserY+8}" text-anchor="middle" dominant-baseline="central"
                        style="font-size:10px;font-weight:700;fill:#fff;font-family:-apple-system,sans-serif;">2nd</text>`;
                }
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
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            }
            if (prev2) {
                svg += `<line x1="${prev2.x + CARD_W}" y1="${prev2.cy}" x2="${midX}" y2="${prev2.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            }
            if (prev1 && prev2) {
                // Vertical connecting the two horizontal lines
                svg += `<line x1="${midX}" y1="${prev1.cy}" x2="${midX}" y2="${prev2.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
                // Horizontal from midpoint to next card
                const midY = (prev1.cy + prev2.cy) / 2;
                svg += `<line x1="${midX}" y1="${midY}" x2="${cur.x}" y2="${midY}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            } else if (prev1) {
                svg += `<line x1="${midX}" y1="${prev1.cy}" x2="${cur.x}" y2="${cur.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            }
        });
    });

    svg += `</svg>`;
    return svg;
}

function buildChampPath(winners) {
    const champMatch = winners.find(m => m.place === 1);
    if (!champMatch) return winners.filter(m => !m.place || m.place === 1);

    const champRound = champMatch.round;
    const r3Teams = new Set([champMatch.team1, champMatch.team2]);

    const r2Matches = winners.filter(m =>
        m.round === champRound - 1 && r3Teams.has(m.winner)
    );
    const r2Teams = new Set(r2Matches.flatMap(m => [m.team1, m.team2]));

    const r1Matches = winners.filter(m =>
        m.round === champRound - 2 && r2Teams.has(m.winner)
    );

    // If 2-round bracket (no R1), just return R2 + champ
    return [...(r1Matches.length ? r1Matches : r2Matches), ...(r1Matches.length ? r2Matches : []), champMatch];
}

function renderPlacementCard(m) {
    const placeLabel = m.place ? `${ordinal(m.place)} Place` : "Consolation";
    const t1w = m.winner === m.team1;
    const t2w = m.winner === m.team2;
    const t1style = t1w ? "color:#f0f1f3;font-weight:700;" : (m.winner ? "color:#5a6070;text-decoration:line-through;" : "color:#c9cdd4;");
    const t2style = t2w ? "color:#f0f1f3;font-weight:700;" : (m.winner ? "color:#5a6070;text-decoration:line-through;" : "color:#c9cdd4;");
    return `
        <div style="background:#252830;border:0.8px solid #3d4350;border-radius:8px;padding:10px 14px;min-width:175px;flex:1;max-width:250px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;margin-bottom:8px;">${placeLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;${t1style}">
                <span>${m.team1 || "TBD"}</span>
                ${m.team1_pts != null ? `<span style="flex-shrink:0;margin-left:8px;">${m.team1_pts.toFixed(1)}</span>` : ""}
            </div>
            <div style="height:0.5px;background:#2d3139;margin:6px 0;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;${t2style}">
                <span>${m.team2 || "TBD"}</span>
                ${m.team2_pts != null ? `<span style="flex-shrink:0;margin-left:8px;">${m.team2_pts.toFixed(1)}</span>` : ""}
            </div>
        </div>`;
}

function buildPlacementBracketHtml(winners, champPath) {
    const champPathSet = new Set(champPath.map(m => `${m.round}-${m.team1}-${m.team2}`));
    const maxRound = Math.max(...winners.map(m => m.round));
    const r2All = winners.filter(m => m.round === maxRound - 1);
    const champR2 = r2All.filter(m => champPathSet.has(`${m.round}-${m.team1}-${m.team2}`));
    const consolR2 = r2All.filter(m => !champPathSet.has(`${m.round}-${m.team1}-${m.team2}`));

    const place3 = winners.find(m => m.place === 3);
    const place5 = winners.find(m => m.place === 5);
    const place7 = winners.find(m => m.place === 7);

    if (!place3 && !place5 && !place7) return "";

    const parts = [];

    // 3rd place bracket: champR2 losers → 3rd place
    if (champR2.length && place3) {
        parts.push(`
            <div style="margin-bottom:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">3rd Place</div>
            <div class="bracket-wrap">${buildBracketSVG([...champR2, place3])}</div>
        `);
    } else if (place3) {
        parts.push(renderPlacementCard(place3));
    }

    // 5th place bracket: consolR2 winners → 5th place
    if (consolR2.length && place5) {
        parts.push(`
            <div style="margin-top:18px;margin-bottom:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">5th Place</div>
            <div class="bracket-wrap">${buildBracketSVG([...consolR2, place5])}</div>
        `);
    } else if (place5) {
        parts.push(renderPlacementCard(place5));
    }

    // 7th place: standalone card (consolR2 losers — those games already shown above)
    if (place7) {
        parts.push(`<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">${renderPlacementCard(place7)}</div>`);
    }

    return `
        <div class="sh-section-title" style="margin-top:20px;">Placement Games</div>
        ${parts.join("")}
    `;
}

function buildConsolBracketHtml(losers) {
    if (!losers.length) return "";
    const maxRound = Math.max(...losers.map(m => m.round));
    const r1 = losers.filter(m => m.round < maxRound);
    const place9 = losers.find(m => m.place === 9);
    const place11 = losers.find(m => m.place === 11);

    if (!r1.length && !place9 && !place11) return "";

    const parts = [];

    if (r1.length && place9) {
        parts.push(`
            <div style="margin-bottom:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">9th Place</div>
            <div class="bracket-wrap">${buildBracketSVG([...r1, place9])}</div>
        `);
    } else if (place9) {
        parts.push(renderPlacementCard(place9));
    }

    if (place11) {
        parts.push(`<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">${renderPlacementCard(place11)}</div>`);
    }

    return `
        <div class="sh-section-title" style="margin-top:20px;">Consolation</div>
        ${parts.join("")}
    `;
}

function renderDraftOrder(year) {
    const nextYear = String(Number(year) + 1);
    const draftData = allData[`_draft_${nextYear}`];
    if (!draftData || !draftData.length) return "";

    // Round 1 picks sorted by pick_no = draft order
    const round1 = draftData.filter(p => p.round === 1).sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));
    if (!round1.length) return "";

    const rows = round1.map((p, i) => {
        const original = p.original_owner || "—";
        const pickedBy = p.picked_by || p.original_owner || "—";
        const traded = p.original_owner && p.picked_by && p.original_owner !== p.picked_by;
        return `
        <tr style="border-bottom:1px solid #2d3139;">
            <td style="padding:6px 8px;text-align:center;color:#5a6070;font-size:11px;font-weight:700;">${i + 1}</td>
            <td style="padding:6px 8px;text-align:left;font-weight:600;color:#f0f1f3;font-size:12px;">${original}</td>
            <td style="padding:6px 8px;text-align:right;font-size:11px;${traded ? 'color:#a78bfa;font-weight:600;' : 'color:#5a6070;'}">${traded ? pickedBy : '—'}</td>
        </tr>`;
    }).join("");

    return `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;margin-top:20px;">
            <div class="sh-section-title">${nextYear} Draft Order</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="background:#252830;">
                    <th style="padding:6px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;border-bottom:1px solid #2d3139;width:36px;">#</th>
                    <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;border-bottom:1px solid #2d3139;">Manager</th>
                    <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;border-bottom:1px solid #2d3139;">Picked By</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ── Team recap ────────────────────────────────────────────────────────────────

function generateTeamRecap(teamName, year, s) {
    const standings = s.standings || [];
    const champ     = s.champion;
    const matchups  = allMatchups[year] || {};
    const yearTxs   = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);

    const row = standings.find(t => t.name === teamName);
    if (!row) return `<p style="color:#5a6070;">No data for ${teamName} in ${year}.</p>`;

    const seed = standings.findIndex(t => t.name === teamName) + 1;
    const isChamp = champ === teamName;

    // Collect weekly results (regular season only)
    const weekResults = [];
    for (const [wk, ms] of Object.entries(matchups)) {
        const w = parseInt(wk);
        if (w > 14) continue;
        for (const m of ms) {
            const mine = (m.teams || []).find(t => t.owner === teamName);
            const opp  = (m.teams || []).find(t => t.owner !== teamName);
            if (!mine || !opp) continue;
            weekResults.push({ week: w, pts: mine.points, oppPts: opp.points, opp: opp.owner, won: mine.points > opp.points });
        }
    }
    weekResults.sort((a,b) => a.week - b.week);

    // Streaks
    function longestStreak(arr, won) {
        let best = 0, cur = 0, bestEnd = -1;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].won === won) { cur++; if (cur > best) { best = cur; bestEnd = i; } }
            else cur = 0;
        }
        return { len: best, endIdx: bestEnd };
    }
    const winStreak  = longestStreak(weekResults, true);
    const loseStreak = longestStreak(weekResults, false);

    // Scoring extremes
    const sorted   = [...weekResults].sort((a,b) => b.pts - a.pts);
    const bestWk   = sorted[0];
    const worstWk  = sorted[sorted.length - 1];
    const biggestWin  = [...weekResults].filter(r => r.won).sort((a,b) => (b.pts-b.oppPts)-(a.pts-a.oppPts))[0];
    const closestWin  = [...weekResults].filter(r => r.won).sort((a,b) => (a.pts-a.oppPts)-(b.pts-b.oppPts))[0];
    const worstLoss   = [...weekResults].filter(r => !r.won).sort((a,b) => (b.oppPts-b.pts)-(a.oppPts-a.pts))[0];
    const heartbreaks = weekResults.filter(r => !r.won && r.oppPts - r.pts < 10).sort((a,b) => (a.oppPts-a.pts)-(b.oppPts-b.pts));

    // Phase records
    const early = weekResults.filter(r => r.week <= 5);
    const mid   = weekResults.filter(r => r.week >= 6 && r.week <= 9);
    const late  = weekResults.filter(r => r.week >= 10);
    const phaseRec = arr => `${arr.filter(r=>r.won).length}-${arr.filter(r=>!r.won).length}`;

    // League scoring context
    const allPF = standings.map(t => t.pf);
    const pfRank = [...allPF].sort((a,b) => b-a).indexOf(row.pf) + 1;
    const allPA  = standings.map(t => t.pa);
    const paRank = [...allPA].sort((a,b) => a-b).indexOf(row.pa) + 1;

    // Trades involving this team
    const myTrades = yearTxs.filter(tx => tx.teams.includes(teamName));
    const inSeason  = myTrades.filter(tx => tx.week >= 1);
    const preSeason = myTrades.filter(tx => tx.week === 0);

    const sections = [];

    // ── Regular Season ──────────────────────────────────────────────────────
    let regText = "";

    if (isChamp) {
        regText += `${teamName} were the ${year} champions, capping off a season that the league won't forget. `;
    }

    // Opening record summary
    const recDesc = row.wins >= 10 ? "dominant" : row.wins >= 8 ? "strong" : row.wins >= 6 ? "competitive" : row.wins >= 4 ? "disappointing" : "rough";
    regText += `They put together a ${recDesc} ${row.wins}-${row.losses} record, finishing as the ${ordinal(seed)} seed. `;

    // Scoring context
    if (pfRank === 1) {
        regText += `Their offense was the best in the league — ${row.pf.toFixed(0)} points scored, more than anyone else. `;
    } else if (pfRank <= 3) {
        regText += `They ranked ${ordinal(pfRank)} in scoring with ${row.pf.toFixed(0)} points — one of the more potent offenses in the league. `;
    } else if (pfRank >= standings.length - 1) {
        regText += `Scoring was a problem all year — ${row.pf.toFixed(0)} points put them near the bottom of the league offensively. `;
    }
    if (paRank === 1) {
        regText += `Defensively, they gave up the fewest points in the league (${row.pa.toFixed(0)} PA), which proved crucial to their success. `;
    } else if (paRank >= standings.length - 1) {
        regText += `They also had the misfortune of facing some of the highest-scoring opponents all year — ${row.pa.toFixed(0)} points allowed, worst in the league. `;
    }

    // Phase breakdown
    if (early.length && mid.length && late.length) {
        const earlyRec = phaseRec(early), midRec = phaseRec(mid), lateRec = phaseRec(late);
        const earlyW = early.filter(r=>r.won).length, midW = mid.filter(r=>r.won).length, lateW = late.filter(r=>r.won).length;
        // Find the strongest and weakest phase
        const phases = [{name:"early (Weeks 1–5)", w:earlyW, rec:earlyRec},{name:"mid-season (Weeks 6–9)", w:midW, rec:midRec},{name:"late (Weeks 10–14)", w:lateW, rec:lateRec}];
        const best = phases.reduce((a,b) => b.w > a.w ? b : a);
        const worst = phases.reduce((a,b) => b.w < a.w ? b : a);
        if (best.name !== worst.name) {
            regText += `They were at their best in the ${best.name} (${best.rec}) and struggled most in the ${worst.name} (${worst.rec}). `;
        }
    }

    // Streaks
    if (winStreak.len >= 4) {
        regText += `A ${winStreak.len}-game winning streak mid-season was the clear high point — they looked like a legitimate contender during that run. `;
    } else if (winStreak.len >= 3) {
        regText += `A ${winStreak.len}-game winning streak gave them momentum at key points in the year. `;
    }
    if (loseStreak.len >= 4) {
        regText += `A brutal ${loseStreak.len}-game losing streak threatened to derail their entire season. `;
    } else if (loseStreak.len >= 3) {
        regText += `A ${loseStreak.len}-game skid at one point put real pressure on their season. `;
    }

    sections.push({ title: "Regular Season", text: regText });

    // ── Key Performances ────────────────────────────────────────────────────
    let perfText = "";

    if (bestWk) {
        if (bestWk.won) {
            perfText += `Their best scoring week came in Week ${bestWk.week}, putting up ${bestWk.pts.toFixed(2)} points in a win over ${bestWk.opp}. `;
        } else {
            perfText += `Bizarrely, their highest-scoring week (Week ${bestWk.week}, ${bestWk.pts.toFixed(2)} pts) still ended in a loss — ${bestWk.opp} had the nerve to put up ${bestWk.oppPts.toFixed(2)}. `;
        }
    }
    if (worstWk) {
        if (!worstWk.won) {
            perfText += `Their worst output was Week ${worstWk.week} — just ${worstWk.pts.toFixed(2)} points, a ${(worstWk.oppPts - worstWk.pts).toFixed(2)}-point loss to ${worstWk.opp}. `;
        } else {
            perfText += `Even in their lowest-scoring week (Week ${worstWk.week}, ${worstWk.pts.toFixed(2)} pts), they scraped out a win against ${worstWk.opp}. `;
        }
    }
    if (biggestWin) {
        perfText += `Most dominant performance: Week ${biggestWin.week}, where they blew out ${biggestWin.opp} by ${(biggestWin.pts - biggestWin.oppPts).toFixed(2)} points. `;
    }
    if (heartbreaks.length > 0) {
        const hb = heartbreaks[0];
        perfText += `Toughest loss: Week ${hb.week}, dropped a razor-thin game to ${hb.opp} by just ${(hb.oppPts - hb.pts).toFixed(2)} points. `;
    }
    if (closestWin && closestWin !== biggestWin && (!heartbreaks.length || heartbreaks[0].week !== closestWin.week)) {
        perfText += `They also pulled off a nail-biter in Week ${closestWin.week}, edging ${closestWin.opp} by ${(closestWin.pts - closestWin.oppPts).toFixed(2)} points. `;
    }
    if (worstLoss && heartbreaks.length === 0) {
        perfText += `Worst defeat: Week ${worstLoss.week}, a ${(worstLoss.oppPts - worstLoss.pts).toFixed(2)}-point blowout loss to ${worstLoss.opp}. `;
    }

    if (perfText) sections.push({ title: "Key Performances", text: perfText });

    // ── Transactions ────────────────────────────────────────────────────────
    if (myTrades.length > 0) {
        let txText = "";

        if (preSeason.length > 0) {
            txText += `Before the season even started, ${teamName} were already active. `;
            for (const tx of preSeason.slice(0, 2)) {
                const other = tx.teams.find(t => t !== teamName);
                const iGet  = (tx.assets_received[teamName] || []);
                const gotPlayers = iGet.filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
                const gotPicks   = iGet.filter(a => a.position === "PICK").map(a => `<em>${a.name}</em>`);
                const got = [...gotPlayers, ...gotPicks].join(", ");
                if (got) txText += `They brought in ${got} from ${other} in a pre-season deal. `;
            }
        }

        for (const tx of inSeason.slice(0, 4)) {
            const other = tx.teams.find(t => t !== teamName);
            const iGet  = (tx.assets_received[teamName] || []);
            const iGive = (tx.assets_received[other] || []);
            const gotPlayers  = iGet.filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
            const gotPicks    = iGet.filter(a => a.position === "PICK").map(a => `<em>${a.name}</em>`);
            const gavePlayers = iGive.filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
            const gavePicks   = iGive.filter(a => a.position === "PICK").map(a => `<em>${a.name}</em>`);
            const got  = [...gotPlayers, ...gotPicks].join(", ");
            const gave = [...gavePlayers, ...gavePicks].join(", ");
            if (got && gave) {
                txText += `Week ${tx.week}: acquired ${got} from ${other} in exchange for ${gave}. `;
            } else if (got) {
                txText += `Week ${tx.week}: received ${got} from ${other}. `;
            }
        }

        if (myTrades.length > 4) {
            txText += `In total, ${teamName} made ${myTrades.length} trades this season — one of the most active rosters in the league. `;
        } else if (myTrades.length === 1) {
            txText += `That was their only trade of the season. `;
        }

        sections.push({ title: "Transactions", text: txText });
    } else {
        sections.push({ title: "Transactions", text: `${teamName} made no trades this season, riding their draft through the entire year.` });
    }

    return sections.map(sec => `
        <div style="margin-bottom:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:6px;">${sec.title}</div>
            <p style="font-size:13px;line-height:1.75;color:#c9cdd4;margin:0;">${sec.text}</p>
        </div>`).join("");
}

// ── Season recap (structured paragraphs) ─────────────────────────────────────

function generateSeasonRecap(year, s) {
    const standings = s.standings || [];
    const winners   = s.winners_bracket || [];
    const champ     = s.champion;
    if (!champ || !standings.length) return "";

    const matchups      = allMatchups[year] || {};
    const yearTxs       = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);
    const inSeasonTrades = yearTxs.filter(tx => tx.week >= 1).sort((a,b) => a.week - b.week);
    const preSeasonTrades = yearTxs.filter(tx => tx.week === 0);

    const seed1     = standings[0];
    const champIdx  = standings.findIndex(t => t.name === champ);
    const champSeed = champIdx + 1;
    const champRow  = standings[champIdx] || {};
    const mostPF    = standings.reduce((a, b) => b.pf > a.pf ? b : a, standings[0]);
    const leastPF   = standings.reduce((a, b) => b.pf < a.pf ? b : a, standings[0]);
    const mostPA    = standings.reduce((a, b) => b.pa > a.pa ? b : a, standings[0]);
    const leastPA   = standings.reduce((a, b) => b.pa < a.pa ? b : a, standings[0]);
    const champMatch = winners.find(m => m.place === 1);
    const second    = champMatch?.loser;

    // Collect all regular-season games for league-wide stats
    const allGames = [];
    for (const [wk, ms] of Object.entries(matchups)) {
        const w = parseInt(wk);
        if (w > 14) continue;
        for (const m of ms) {
            const [t1, t2] = m.teams || [];
            if (!t1 || !t2) continue;
            const winner = t1.points > t2.points ? t1 : t2;
            const loser  = t1.points > t2.points ? t2 : t1;
            allGames.push({ week: w, winner, loser, margin: winner.points - loser.points });
        }
    }
    const closestGame  = [...allGames].sort((a,b) => a.margin - b.margin)[0];
    const biggestBlowout = [...allGames].sort((a,b) => b.margin - a.margin)[0];
    const highestScoring = [...allGames].sort((a,b) => b.winner.points - a.winner.points)[0];

    // Per-team record tracking for narrative context
    const teamRecords = {};
    for (const t of standings) teamRecords[t.name] = { wins: 0, losses: 0 };
    for (const g of allGames) {
        if (teamRecords[g.winner.owner]) teamRecords[g.winner.owner].wins++;
        if (teamRecords[g.loser.owner])  teamRecords[g.loser.owner].losses++;
    }

    const sections = [];

    // ── Regular Season ──────────────────────────────────────────────────────
    let regText = "";

    if (seed1.name === champ) {
        regText += `<strong>${champ}</strong> were the story of the ${year} season — they set the pace in the regular season at ${seed1.wins}-${seed1.losses} and never let anyone forget who the best team was. `;
    } else {
        regText += `<strong>${seed1.name}</strong> had the best record in ${year} at ${seed1.wins}-${seed1.losses} and looked like the team to beat all year. <strong>${champ}</strong> came in as the ${ordinal(champSeed)} seed but proved that regular season records only tell part of the story. `;
    }

    // Scoring leaders
    if (mostPF.name === champ) {
        regText += `${champ} were also the most productive offense in the league, putting up ${mostPF.pf.toFixed(0)} points — more than anyone else. `;
    } else if (mostPF.name === seed1.name) {
        regText += `${seed1.name} backed up their record with the league's best offense — ${mostPF.pf.toFixed(0)} points scored, pulling away from the field. `;
    } else {
        regText += `<strong>${mostPF.name}</strong> was the highest-scoring team in the league at ${mostPF.pf.toFixed(0)} points, even if their record didn't always reflect it. `;
    }

    // Defensive/luck narrative
    if (leastPA.name !== mostPF.name) {
        regText += `<strong>${leastPA.name}</strong> had the good fortune of facing the weakest opponents week to week, allowing just ${leastPA.pa.toFixed(0)} points all season. `;
    }
    if (mostPA.name !== leastPF.name) {
        regText += `On the other end, <strong>${mostPA.name}</strong> couldn't catch a break — they gave up ${mostPA.pa.toFixed(0)} points, the most in the league. `;
    }

    // Bottom of standings
    const lastPlace = standings[standings.length - 1];
    if (lastPlace && lastPlace.name !== champ && lastPlace.wins <= 4) {
        regText += `<strong>${lastPlace.name}</strong> had a season to forget, finishing last at ${lastPlace.wins}-${lastPlace.losses}. `;
    }

    sections.push({ title: "Regular Season", text: regText });

    // ── Memorable Moments ───────────────────────────────────────────────────
    if (allGames.length > 0) {
        let momText = "";

        if (closestGame) {
            momText += `The closest game of the entire season came in Week ${closestGame.week}: <strong>${closestGame.winner.owner}</strong> survived a scare against <strong>${closestGame.loser.owner}</strong>, winning by just ${closestGame.margin.toFixed(2)} points (${closestGame.winner.points.toFixed(2)}–${closestGame.loser.points.toFixed(2)}). `;
        }
        if (biggestBlowout && biggestBlowout !== closestGame) {
            momText += `The most lopsided result of the year was Week ${biggestBlowout.week}, where <strong>${biggestBlowout.winner.owner}</strong> demolished <strong>${biggestBlowout.loser.owner}</strong> by ${biggestBlowout.margin.toFixed(2)} points. `;
        }
        if (highestScoring && highestScoring.winner.points > 180) {
            momText += `The single highest score of the season came from <strong>${highestScoring.winner.owner}</strong> in Week ${highestScoring.week} — ${highestScoring.winner.points.toFixed(2)} points, an eye-opening performance that put the rest of the league on notice. `;
        }

        // Find any team that went on a significant streak
        const streaks = {};
        for (const t of standings) {
            let cur = 0, best = 0;
            const games = allGames.filter(g => g.winner.owner === t.name || g.loser.owner === t.name)
                .sort((a,b) => a.week - b.week);
            for (const g of games) {
                if (g.winner.owner === t.name) { cur++; best = Math.max(best, cur); } else cur = 0;
            }
            if (best >= 5) streaks[t.name] = best;
        }
        for (const [team, len] of Object.entries(streaks)) {
            momText += `<strong>${team}</strong> put together a ${len}-game winning streak at one point — one of the most dominant runs of the ${year} season. `;
        }

        if (momText) sections.push({ title: "Memorable Moments", text: momText });
    }

    // ── Transactions ────────────────────────────────────────────────────────
    const allTrades = [...preSeasonTrades, ...inSeasonTrades];
    if (allTrades.length > 0) {
        let txText = "";

        // Champion's key moves
        const champTrades = inSeasonTrades.filter(tx => tx.teams.includes(champ));
        if (champTrades.length > 0) {
            const ct = champTrades[0];
            const gets = (ct.assets_received[champ] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            const from = ct.teams.find(t => t !== champ);
            if (gets.length) {
                txText += `<strong>${champ}</strong> made a move that defined their season: in Week ${ct.week} they acquired ${gets.slice(0,3).join(", ")} from ${from}${gets.length > 3 ? " along with other pieces" : ""}. `;
            }
        }

        // Biggest blockbuster overall
        const biggest = [...inSeasonTrades].sort((a,b) => {
            const pa = Object.values(a.assets_received).flat().filter(x => x.position !== "PICK").length;
            const pb = Object.values(b.assets_received).flat().filter(x => x.position !== "PICK").length;
            return pb - pa;
        })[0];
        if (biggest && !biggest.teams.includes(champ)) {
            const [bA, bB] = biggest.teams;
            const getA = (biggest.assets_received[bA] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            const getB = (biggest.assets_received[bB] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            if (getA.length + getB.length >= 3) {
                txText += `The biggest deal of the year came in Week ${biggest.week}: <strong>${bA}</strong> and <strong>${bB}</strong> swapped ${getB.slice(0,3).join(", ")} for ${getA.slice(0,3).join(", ")}${getA.length > 3 ? " and more" : ""}. `;
            }
        }

        // Pre-season activity
        if (preSeasonTrades.length > 0) {
            const activePre = new Set(preSeasonTrades.flatMap(t => t.teams));
            txText += `Even before the season kicked off, ${preSeasonTrades.length} pre-season trade${preSeasonTrades.length > 1 ? "s" : ""} involving ${[...activePre].join(", ")} signaled an active year ahead. `;
        }

        // Trade volume summary
        const activeTraders = new Set(inSeasonTrades.flatMap(tx => tx.teams));
        const tradeCounts = {};
        for (const tx of inSeasonTrades) for (const t of tx.teams) tradeCounts[t] = (tradeCounts[t] || 0) + 1;
        const mostActive = Object.entries(tradeCounts).sort((a,b) => b[1]-a[1])[0];
        if (mostActive && mostActive[1] >= 3) {
            txText += `<strong>${mostActive[0]}</strong> was the most trade-active team all season with ${mostActive[1]} deals. `;
        }
        txText += `All told, ${inSeasonTrades.length} in-season trade${inSeasonTrades.length !== 1 ? "s" : ""} involving ${activeTraders.size} teams reshaped the landscape throughout ${year}.`;

        sections.push({ title: "Transactions", text: txText });
    }

    return sections.map(sec => `
        <div style="margin-bottom:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:6px;">${sec.title}</div>
            <p style="font-size:13px;line-height:1.75;color:#c9cdd4;margin:0;">${sec.text}</p>
        </div>`).join("");
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

    // Determine 2nd and 3rd place from bracket
    const champMatch  = winners.find(m => m.place === 1);
    const secondPlace = champMatch?.loser  || null;
    const thirdMatch  = winners.find(m => m.place === 3);
    const thirdPlace  = thirdMatch?.winner || null;

    function rowClass(name) {
        if (name === champ)        return "champ-row";
        if (name === secondPlace)  return "silver-row";
        if (name === thirdPlace)   return "bronze-row";
        if (playoffTeams.has(name)) return "playoff-row";
        return "";
    }
    function rowTrophy(name) {
        if (name === champ)       return " 🏆";
        if (name === secondPlace) return " 🥈";
        if (name === thirdPlace)  return " 🥉";
        return "";
    }

    const standingsHtml = `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;">
            <div class="sh-section-title">Regular Season</div>
            <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
            <table class="sh-table" style="min-width:260px;">
                <thead><tr>
                    <th style="width:20px;text-align:left;">#</th>
                    <th style="text-align:left;">Team</th>
                    <th>W</th><th>L</th><th>PF</th><th>PA</th>
                </tr></thead>
                <tbody>
                    ${standings.map((t, i) => `
                        <tr class="${rowClass(t.name)}">
                            <td class="rank">${i+1}</td>
                            <td style="text-align:left;font-weight:600;">${t.name}${rowTrophy(t.name)}</td>
                            <td>${t.wins}</td><td>${t.losses}</td>
                            <td>${Math.round(t.pf)}</td><td>${Math.round(t.pa)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
            </div>
        </div>
    `;

    const champPath = buildChampPath(winners);
    const placementHtml = winners.length ? buildPlacementBracketHtml(winners, champPath) : "";
    const consolHtml    = losers.length  ? buildConsolBracketHtml(losers) : "";

    const bracketHtml = `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;margin-top:20px;">
            <div class="sh-section-title">Playoff Bracket</div>
            <div class="bracket-wrap">${buildBracketSVG(champPath)}</div>
            ${placementHtml}
            ${consolHtml}
        </div>
    `;

    const champBadge = champ ? `<div class="sh-champion">🏆 ${champ}</div>` : "";
    const draftOrderHtml = renderDraftOrder(year);
    const teamList = standings.map(t => t.name);

    // Pre-generate all summary content (season + each team)
    const seasonHtml = generateSeasonRecap(year, s);
    window._shRecaps = window._shRecaps || {};
    window._shRecaps[`${year}__season`] = seasonHtml;
    teamList.forEach(name => {
        window._shRecaps[`${year}__${name}`] = generateTeamRecap(name, year, s);
    });

    const recapCard = seasonHtml ? `
        <div class="card" style="padding:16px 20px;background:#1e2027;border-color:#2d3139;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
                <div class="sh-section-title" style="margin:0;">Summary</div>
                <select style="font-size:12px;padding:4px 8px;" onchange="(function(sel){
                    var year='${year}', val=sel.value;
                    var key=year+'__'+val;
                    var el=document.getElementById('sh-recap-${year}');
                    if(el && window._shRecaps && window._shRecaps[key]) el.innerHTML=window._shRecaps[key];
                })(this)">
                    <option value="season">Season Summary</option>
                    ${teamList.map(t => `<option value="${t}">${t}</option>`).join("")}
                </select>
            </div>
            <div id="sh-recap-${year}">${seasonHtml}</div>
        </div>` : "";

    return `
        <div class="sh-year" data-year="${year}">
            <div class="sh-year-header">
                <div class="sh-year-title">${year}</div>
                ${champBadge}
            </div>
            <div class="sh-grid">
                <div>
                    ${standingsHtml}
                    ${draftOrderHtml}
                </div>
                ${recapCard}
            </div>
            ${bracketHtml}
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

    [allData, allTransactions] = await Promise.all([
        api.getSeasonHistory(),
        api.getTransactions(),
    ]);
    allSeasons = Object.keys(allData).filter(y => allData[y].champion).sort().reverse();

    // Load next-year draft data + matchups for each completed season
    await Promise.all(allSeasons.flatMap(year => {
        const nextYear = String(Number(year) + 1);
        return [
            api.getDraft(nextYear).then(picks => {
                if (picks && picks.length) allData[`_draft_${nextYear}`] = picks;
            }).catch(() => {}),
            api.getMatchups(year).then(mu => {
                if (mu) allMatchups[year] = mu;
            }).catch(() => {}),
        ];
    }));

    container.innerHTML = `
    <style>
        #history-container { max-width: 1100px; }
        .sh-year { margin-bottom: 52px; }
        .sh-year-header {
            display:flex; align-items:center; gap:16px;
            margin-bottom:20px; padding-bottom:14px;
            border-bottom:2px solid #2d3139;
        }
        .sh-year-title { font-size:24px; font-weight:800; color:#f0f1f3; }
        .sh-champion {
            background:linear-gradient(135deg,#292202,#3b2f02);
            border:1px solid #b45309; border-radius:999px;
            padding:4px 14px; font-size:13px; font-weight:700; color:#fbbf24;
        }
        .sh-grid { display:grid; grid-template-columns:280px 1fr; gap:20px; align-items:start; min-width:0; }
        .sh-grid > * { min-width:0; }
        .sh-section-title {
            font-size:10px; text-transform:uppercase; letter-spacing:0.07em;
            color:#5a6070; font-weight:700; margin-bottom:10px;
        }
        .sh-table { width:100%; border-collapse:collapse; font-size:12px; }
        .sh-table th {
            text-align:center; font-size:10px; text-transform:uppercase;
            letter-spacing:0.05em; color:#5a6070; padding:6px 6px;
            border-bottom:1px solid #2d3139; font-weight:600; white-space:nowrap;
            background:#252830;
        }
        .sh-table td {
            padding:6px 6px; text-align:center;
            border-bottom:1px solid #2d3139; color:#c9cdd4; white-space:nowrap;
        }
        .rank { color:#5a6070; font-size:11px; }
        .sh-table tr:hover td { background:#252830; }
        .playoff-row td { background:#1c1704 !important; }
        .champ-row td { background:#2c2102 !important; font-weight:700; color:#fbbf24 !important; }
        .silver-row td { background:#1a1f2e !important; font-weight:700; color:#c8d6e5 !important; }
        .bronze-row td { background:#1e1a10 !important; font-weight:700; color:#cd9b5a !important; }
        .bracket-wrap { overflow-x:auto; padding-bottom:8px; -webkit-overflow-scrolling:touch; }
        @media (max-width:800px) { .sh-grid { grid-template-columns:1fr; } }
    </style>

    <div class="filter-bar" style="margin-bottom:24px;">
        <select id="sh-select">
            <option value="all">All Years</option>
            ${allSeasons.map(y => `<option value="${y}">${y}</option>`).join("")}
        </select>
    </div>

    <div id="sh-board"></div>
    `;

    document.getElementById("sh-select").addEventListener("change", e => render(e.target.value));
    render("all");
}

init();