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
const PAD_TOP = 40;
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

        svg += `<text x="${x + CARD_W/2}" y="20" text-anchor="middle"
            style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;fill:${SVG_TEXT2};font-family:-apple-system,sans-serif;">
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
    const winners   = s.winners_bracket || [];
    const losers    = s.losers_bracket  || [];
    const champ     = s.champion;
    const matchups  = allMatchups[year] || {};
    const yearTxs   = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);

    const row = standings.find(t => t.name === teamName);
    if (!row) return `<p style="color:#5a6070;">No data for ${teamName} in ${year}.</p>`;

    const seed = standings.findIndex(t => t.name === teamName) + 1;
    const allBracket = [...winners, ...losers];
    const playoffTeams = new Set([...winners, ...losers].flatMap(m => [m.team1, m.team2]));
    const madePlayoffs = playoffTeams.has(teamName);

    // Collect weekly results
    const weekResults = [];
    for (const [wk, ms] of Object.entries(matchups)) {
        const w = parseInt(wk);
        if (w > 14) continue; // regular season only
        for (const m of ms) {
            const mine = (m.teams || []).find(t => t.owner === teamName);
            const opp  = (m.teams || []).find(t => t.owner !== teamName);
            if (!mine || !opp) continue;
            weekResults.push({ week: w, pts: mine.points, oppPts: opp.points, opp: opp.owner, won: mine.points > opp.points });
        }
    }
    weekResults.sort((a,b) => a.week - b.week);

    const wins   = weekResults.filter(r => r.won).length;
    const losses = weekResults.filter(r => !r.won).length;

    // Streaks
    function longestStreak(arr, won) {
        let best = 0, cur = 0;
        for (const r of arr) { if (r.won === won) { cur++; best = Math.max(best, cur); } else cur = 0; }
        return best;
    }
    const bestWinStreak  = longestStreak(weekResults, true);
    const bestLoseStreak = longestStreak(weekResults, false);

    // Best/worst weeks
    const sorted  = [...weekResults].sort((a,b) => b.pts - a.pts);
    const bestWk  = sorted[0];
    const worstWk = sorted[sorted.length - 1];
    const biggestWin  = [...weekResults].filter(r => r.won).sort((a,b) => (b.pts-b.oppPts)-(a.pts-a.oppPts))[0];
    const closestWin  = [...weekResults].filter(r => r.won).sort((a,b) => (a.pts-a.oppPts)-(b.pts-b.oppPts))[0];

    // Phase records
    const early = weekResults.filter(r => r.week <= 5);
    const mid   = weekResults.filter(r => r.week >= 6 && r.week <= 9);
    const late  = weekResults.filter(r => r.week >= 10);
    const phaseRec = arr => `${arr.filter(r=>r.won).length}-${arr.filter(r=>!r.won).length}`;

    // Trades involving this team
    const myTrades = yearTxs.filter(tx => tx.teams.includes(teamName));
    const inSeason = myTrades.filter(tx => tx.week >= 1);
    const preSeason = myTrades.filter(tx => tx.week === 0);

    // Playoff results
    const myPlayoffGames = allBracket.filter(m => m.team1 === teamName || m.team2 === teamName)
        .sort((a,b) => a.round - b.round);
    const champMatch = winners.find(m => m.place === 1);
    const thirdMatch = winners.find(m => m.place === 3);
    const isChamp    = champ === teamName;
    const isSecond   = champMatch?.loser === teamName;
    const isThird    = thirdMatch?.winner === teamName;

    const sections = [];

    // ── Regular Season ──────────────────────────────────────────────────────
    let regText = `${teamName} finished the ${year} regular season ${row.wins}-${row.losses} (${ordinal(seed)} seed), scoring ${row.pf.toFixed(0)} points and allowing ${row.pa.toFixed(0)}.`;

    if (early.length && mid.length && late.length) {
        regText += ` Their season broke down as: ${phaseRec(early)} in weeks 1–5, ${phaseRec(mid)} in weeks 6–9, and ${phaseRec(late)} in weeks 10–14.`;
    }

    if (bestWinStreak >= 4) regText += ` A ${bestWinStreak}-game winning streak was a highlight of their year.`;
    if (bestLoseStreak >= 4) regText += ` They also endured a ${bestLoseStreak}-game skid that tested their playoff hopes.`;

    sections.push({ title: "Regular Season", text: regText });

    // ── Key Performances ────────────────────────────────────────────────────
    let perfText = "";
    if (bestWk) perfText += `Best scoring week was Week ${bestWk.week} — ${bestWk.pts.toFixed(2)} points${bestWk.won ? ` (W vs ${bestWk.opp})` : ` (still lost to ${bestWk.opp} who put up ${bestWk.oppPts.toFixed(2)})`}.`;
    if (worstWk) perfText += ` Their lowest output came in Week ${worstWk.week} with just ${worstWk.pts.toFixed(2)} points${worstWk.won ? `, still enough to beat ${worstWk.opp}` : `, a ${(worstWk.oppPts - worstWk.pts).toFixed(2)}-point loss to ${worstWk.opp}`}.`;
    if (biggestWin) perfText += ` Most dominant win: Week ${biggestWin.week} over ${biggestWin.opp} by ${(biggestWin.pts - biggestWin.oppPts).toFixed(2)} points.`;
    if (closestWin && closestWin !== biggestWin) perfText += ` Closest win: Week ${closestWin.week} over ${closestWin.opp} by just ${(closestWin.pts - closestWin.oppPts).toFixed(2)} points.`;

    if (perfText) sections.push({ title: "Key Performances", text: perfText });

    // ── Transactions ────────────────────────────────────────────────────────
    if (myTrades.length > 0) {
        const txLines = [];
        for (const tx of [...preSeason, ...inSeason].slice(0, 5)) {
            const iGet = (tx.assets_received[teamName] || []);
            const iGive = (tx.assets_received[tx.teams.find(t => t !== teamName)] || []);
            const gotPlayers = iGet.filter(a => a.position !== "PICK").map(a => a.name);
            const gotPicks   = iGet.filter(a => a.position === "PICK").map(a => a.name);
            const gavePlayers = iGive.filter(a => a.position !== "PICK").map(a => a.name);
            const gavePicks   = iGive.filter(a => a.position === "PICK").map(a => a.name);
            const other = tx.teams.find(t => t !== teamName);
            const wkLabel = tx.week === 0 ? "Pre-season" : `Week ${tx.week}`;
            const got  = [...gotPlayers, ...gotPicks.map(p => `<em>${p}</em>`)].join(", ");
            const gave = [...gavePlayers, ...gavePicks.map(p => `<em>${p}</em>`)].join(", ");
            txLines.push(`${wkLabel}: received ${got || "—"} from ${other} in exchange for ${gave || "—"}.`);
        }
        sections.push({ title: "Transactions", text: txLines.join(" ") });
    }

    // ── Playoffs ────────────────────────────────────────────────────────────
    if (madePlayoffs || myPlayoffGames.length > 0) {
        let playoffText = "";
        if (!madePlayoffs) {
            playoffText = `${teamName} missed the playoffs, finishing ${row.wins}-${row.losses}.`;
        } else {
            if (isChamp) playoffText += `${teamName} won it all in ${year}. `;
            else if (isSecond) playoffText += `${teamName} reached the championship but fell short of the title. `;
            else if (isThird) playoffText += `${teamName} finished 3rd after a strong playoff run. `;
            else playoffText += `${teamName} made the playoffs but were eliminated before the final. `;

            for (const pg of myPlayoffGames) {
                const myPts  = pg.team1 === teamName ? pg.team1_pts : pg.team2_pts;
                const oppPts = pg.team1 === teamName ? pg.team2_pts : pg.team1_pts;
                const oppName = pg.team1 === teamName ? pg.team2 : pg.team1;
                const roundNames = { 1: "Round 1", 2: "Semifinals", 3: "Championship/3rd Place" };
                const result = myPts > oppPts ? "defeated" : "lost to";
                playoffText += `${roundNames[pg.round] || `Round ${pg.round}`}: ${result} ${oppName} (${myPts.toFixed(2)}–${oppPts.toFixed(2)}). `;
            }
        }
        sections.push({ title: "Playoffs", text: playoffText });
    } else {
        sections.push({ title: "Playoffs", text: `${teamName} did not qualify for the ${year} playoffs.` });
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

    const matchups  = allMatchups[year] || {};
    const yearTxs   = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);
    const inSeasonTrades = yearTxs.filter(tx => tx.week >= 1).sort((a,b) => a.week - b.week);

    const seed1      = standings[0];
    const champIdx   = standings.findIndex(t => t.name === champ);
    const champSeed  = champIdx + 1;
    const champRow   = standings[champIdx] || {};
    const mostPF     = standings.reduce((a, b) => b.pf > a.pf ? b : a, standings[0]);
    const leastPA    = standings.reduce((a, b) => b.pa < a.pa ? b : a, standings[0]);
    const champMatch  = winners.find(m => m.place === 1);
    const second     = champMatch?.loser;
    const thirdMatch  = winners.find(m => m.place === 3);
    const third      = thirdMatch?.winner;
    const semiMatches = winners.filter(m => m.round === 2);
    const qfMatches   = winners.filter(m => m.round === 1);

    const playoffTeams = new Set();
    winners.forEach(m => { playoffTeams.add(m.team1); playoffTeams.add(m.team2); });

    const sections = [];

    // ── Regular Season ──────────────────────────────────────────────────────
    const seed1Row = standings[0];
    let regText = "";
    if (seed1.name === champ) {
        regText += `<strong>${champ}</strong> were the class of the ${year} league from wire to wire. They led the regular season ${seed1Row.wins}-${seed1Row.losses}, claimed the top seed, and backed it up with a championship run.`;
    } else {
        regText += `<strong>${seed1.name}</strong> dominated the ${year} regular season at ${seed1Row.wins}-${seed1Row.losses} — but the trophy went elsewhere. <strong>${champ}</strong> came in as the ${ordinal(champSeed)} seed and pulled off a championship run that no one can dispute.`;
    }
    if (mostPF.name === seed1.name) {
        regText += ` ${seed1.name} were also the most explosive offense, leading the league with ${mostPF.pf.toFixed(0)} points scored.`;
    } else if (mostPF.name !== champ) {
        regText += ` ${mostPF.name} led all teams in scoring (${mostPF.pf.toFixed(0)} PF) without making a deep playoff run — the classic case of points not equaling wins.`;
    }
    const playoffList  = standings.filter(t => playoffTeams.has(t.name));
    const bubbleTeams  = standings.filter(t => !playoffTeams.has(t.name));
    if (playoffList.length >= 4) {
        regText += ` The playoff field: ${playoffList.map(t => t.name).join(", ")}.`;
        if (bubbleTeams.length) {
            const missed = bubbleTeams.slice(0,2).map(t => `${t.name} (${t.wins}-${t.losses})`).join(" and ");
            regText += ` Left out: ${missed}.`;
        }
    }
    sections.push({ title: "Regular Season", text: regText });

    // ── Late-Season Battles ─────────────────────────────────────────────────
    if (Object.keys(matchups).length > 0) {
        const lateGames = [];
        for (const w of ["11","12","13","14"]) {
            for (const m of (matchups[w] || [])) {
                const [t1, t2] = m.teams || [];
                if (!t1 || !t2) continue;
                const margin = Math.abs(t1.points - t2.points);
                const winner = t1.points > t2.points ? t1 : t2;
                const loser  = t1.points > t2.points ? t2 : t1;
                const eitherInPlayoffs = playoffTeams.has(winner.owner) || playoffTeams.has(loser.owner);
                lateGames.push({ week: parseInt(w), margin, winner, loser, eitherInPlayoffs });
            }
        }

        let lateText = "";
        const byTightness = [...lateGames].sort((a,b) => a.margin - b.margin);
        if (byTightness.length) {
            const t = byTightness[0];
            const note = t.eitherInPlayoffs ? " — a result with direct playoff seeding implications" : "";
            lateText += `The tightest game of the stretch run came in Week ${t.week}: <strong>${t.winner.owner}</strong> edged <strong>${t.loser.owner}</strong> by just ${t.margin.toFixed(2)} points (${t.winner.points.toFixed(2)}–${t.loser.points.toFixed(2)})${note}.`;
        }
        const topSeedLoss = lateGames.find(g => g.loser.owner === seed1.name);
        if (topSeedLoss && seed1.name !== champ) {
            lateText += ` Even ${seed1.name} weren't immune — they dropped a Week ${topSeedLoss.week} game to ${topSeedLoss.winner.owner} (${topSeedLoss.winner.points.toFixed(2)}–${topSeedLoss.loser.points.toFixed(2)}).`;
        }
        const bigWin = [...lateGames].sort((a,b) => b.winner.points - a.winner.points)[0];
        if (bigWin && bigWin.winner.points > 185) {
            lateText += ` <strong>${bigWin.winner.owner}</strong> posted the week's highest score in Week ${bigWin.week} — ${bigWin.winner.points.toFixed(2)} points in a dominant ${bigWin.margin.toFixed(2)}-point win over ${bigWin.loser.owner}.`;
        }
        if (lateText) sections.push({ title: "Late-Season Battles", text: lateText });
    }

    // ── Transactions ────────────────────────────────────────────────────────
    if (inSeasonTrades.length > 0) {
        let txText = "";
        const champTrades = inSeasonTrades.filter(tx => tx.teams.includes(champ));
        if (champTrades.length > 0) {
            const ct = champTrades[0];
            const gets = (ct.assets_received[champ] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            const from = ct.teams.find(t => t !== champ);
            if (gets.length) txText += `${champ}'s key in-season move: Week ${ct.week}, they acquired ${gets.slice(0,3).join(", ")} from ${from}${gets.length > 3 ? " among others" : ""} — a deal that fueled their playoff push.`;
        }
        const biggest = [...inSeasonTrades].sort((a,b) => {
            const pa = Object.values(a.assets_received).flat().filter(x => x.position !== "PICK").length;
            const pb = Object.values(b.assets_received).flat().filter(x => x.position !== "PICK").length;
            return pb - pa;
        })[0];
        if (biggest && !biggest.teams.includes(champ)) {
            const [bA, bB] = biggest.teams;
            const getA = (biggest.assets_received[bA] || []).filter(x => x.position !== "PICK").map(x => x.name);
            const getB = (biggest.assets_received[bB] || []).filter(x => x.position !== "PICK").map(x => x.name);
            if (getA.length + getB.length >= 3) {
                txText += ` Biggest blockbuster (Week ${biggest.week}): <strong>${bB}</strong> sent ${getB.slice(0,3).join(", ")} to <strong>${bA}</strong> in exchange for ${getA.slice(0,3).join(", ")}${getA.length > 3 ? " and more" : ""}.`;
            }
        }
        const activeTraders = new Set(inSeasonTrades.flatMap(tx => tx.teams));
        txText += ` Overall, ${inSeasonTrades.length} in-season trade${inSeasonTrades.length > 1 ? "s" : ""} involving ${activeTraders.size} teams reshaped rosters before the postseason.`;
        sections.push({ title: "Transactions", text: txText });
    }

    // ── Playoffs ────────────────────────────────────────────────────────────
    let playoffText = "";
    if (qfMatches.length > 0) {
        const qfLines = qfMatches.map(m =>
            `${m.winner} def. ${m.loser} (${Math.max(m.team1_pts,m.team2_pts).toFixed(2)}–${Math.min(m.team1_pts,m.team2_pts).toFixed(2)})`);
        playoffText += `<strong>Round 1:</strong> ${qfLines.join(" &nbsp;·&nbsp; ")}.`;
    }
    if (semiMatches.length > 0) {
        const semiUpsets = semiMatches.filter(m => {
            const ws = standings.findIndex(t => t.name === m.winner) + 1;
            const ls = standings.findIndex(t => t.name === m.loser)  + 1;
            return ws > ls && ws > 0 && ls > 0;
        });
        const semiLines = semiMatches.map(m => {
            const upset = semiUpsets.includes(m);
            return `${m.winner} def. ${m.loser} (${Math.max(m.team1_pts,m.team2_pts).toFixed(2)}–${Math.min(m.team1_pts,m.team2_pts).toFixed(2)})${upset ? " 🚨" : ""}`;
        });
        playoffText += ` <strong>Semifinals:</strong> ${semiLines.join(" &nbsp;·&nbsp; ")}.${semiUpsets.length ? " (🚨 = upset)" : ""}`;
    }
    if (champMatch) {
        const champPts  = champMatch.team1 === champ ? champMatch.team1_pts : champMatch.team2_pts;
        const secondPts = champMatch.team1 === champ ? champMatch.team2_pts : champMatch.team1_pts;
        const margin    = Math.abs(champPts - secondPts);
        const tone      = margin < 10 ? "a narrow" : margin > 40 ? "a dominant" : "a convincing";
        playoffText += ` <strong>Championship:</strong> <strong>${champ}</strong> defeated <strong>${second}</strong> in ${tone} title game, ${champPts.toFixed(2)}–${secondPts.toFixed(2)}.`;
    }
    if (third) {
        const tf = winners.find(m => m.place === 3);
        if (tf) playoffText += ` <strong>3rd Place:</strong> ${third} over ${tf.loser} (${Math.max(tf.team1_pts,tf.team2_pts).toFixed(2)}–${Math.min(tf.team1_pts,tf.team2_pts).toFixed(2)}).`;
    }
    if (playoffText) sections.push({ title: "Playoffs", text: playoffText });

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
            <table class="sh-table">
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
                            <td>${t.pf}</td><td>${t.pa}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;

    const bracketHtml = `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;">
            <div class="sh-section-title">Playoff Bracket</div>
            <div class="bracket-wrap">${buildBracketSVG(winners)}</div>
            ${losers.length ? `
                <div class="sh-section-title" style="margin-top:24px;">Consolation Bracket</div>
                <div class="bracket-wrap" style="max-height:200px;">${buildBracketSVG(losers)}</div>
            ` : ""}
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
        <div class="card" style="padding:16px 20px;background:#1e2027;border-color:#2d3139;margin-top:20px;">
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
                <div style="min-width:0;overflow:hidden;">
                    ${standingsHtml}
                    ${draftOrderHtml}
                </div>
                ${bracketHtml}
            </div>
            ${recapCard}
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
        .sh-grid > * { min-width:0; overflow:hidden; }
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