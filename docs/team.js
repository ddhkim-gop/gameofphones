import { api } from "./dataService.js?v=20260609a";
import { renderNav } from "./components/nav.js";

renderNav();

const INACTIVE_USERS = new Set(['edgxrjiang', 'riqi', 'shmyung', 'urmummma', 'JUNNNNAY']);
const FUTURE_YEARS = ["2027", "2028", "2029"];
const ROUNDS = [1, 2, 3];
const PAUL_YOON_AVATAR = "https://sleepercdn.com/images/v4/avatars/avatar_default_blue.webp";
const AVATAR_COLORS = ["#5a5be6","#e74c82","#3ecf8e","#f6ad55","#4299e1","#9f7aea","#ed64a6","#38b2ac"];
const POS_ORDER = ["QB","RB","WR","TE","K","DEF"];

function posColor(pos) {
    return {QB:"#e74c82",RB:"#3ecf8e",WR:"#4299e1",TE:"#f6ad55",K:"#9f7aea",DEF:"#38b2ac"}[pos] || "#5a6070";
}
function accentFor(name) {
    return AVATAR_COLORS[name.split("").reduce((s,c)=>s+c.charCodeAt(0),0) % AVATAR_COLORS.length];
}
function ordinal(n) {
    const s=["th","st","nd","rd"], v=n%100;
    return n+(s[(v-20)%10]||s[v]||s[0]);
}

async function init() {
    const params = new URLSearchParams(window.location.search);
    const teamName = params.get("team");
    const container = document.getElementById("team-container");
    if (!container) return;

    if (!teamName) {
        container.innerHTML = `<p style="color:#5a6070;padding:20px;">No team specified.</p>`;
        return;
    }

    container.innerHTML = `<p style="color:#5a6070;padding:20px;">Loading...</p>`;

    try {
        const [rosters, leagueUsers, tradedPicks, allTransactions, seasonHistory,
               draft2023, draft2024, draft2025, draft2026, playerValues] = await Promise.all([
            api.getRosters("2026"),
            api.getLeagueUsers(),
            api.getTradedPicks(),
            api.getTransactions(),
            api.getSeasonHistory(),
            api.getDraft("2023"),
            api.getDraft("2024"),
            api.getDraft("2025"),
            api.getDraft("2026"),
            api.getPlayerValues(),
        ]);
        const draftByYear = { "2023": draft2023, "2024": draft2024, "2025": draft2025, "2026": draft2026 };

        // Avatar
        (leagueUsers || []).forEach(u => {
            if (u.username === "Paul_Yoon") u.avatar_url = PAUL_YOON_AVATAR;
        });
        const userObj = (leagueUsers || []).find(u => u.username === teamName);
        const avatarUrl = userObj?.avatar_url;
        const accent = accentFor(teamName);

        // ── Compute cross-season stats ────────────────────────────────────────
        const HIST_YEARS = ["2023","2024","2025"];
        let totalRegWins = 0, totalRegLosses = 0;
        let playoffApps = 0, championships = 0, firstRdByes = 0;
        let playoffWins = 0, playoffLosses = 0;
        const tradesBySeason = {};
        let seasonsPlayed = 0;

        for (const yr of HIST_YEARS) {
            const s = seasonHistory[yr];
            if (!s) continue;
            const standing = (s.standings || []).find(t => t.name === teamName);
            if (!standing) continue;
            seasonsPlayed++;
            totalRegWins   += standing.wins   || 0;
            totalRegLosses += standing.losses || 0;

            const bracket = s.winners_bracket || [];
            const inBracket = bracket.some(m => m.team1 === teamName || m.team2 === teamName);
            if (inBracket) playoffApps++;
            if (s.champion === teamName) championships++;

            // First-round bye: not in round 1 but appears in round 2+
            const round1Teams = new Set(bracket.filter(m => m.round === 1).flatMap(m => [m.team1, m.team2]));
            const round2Teams = new Set(bracket.filter(m => m.round >= 2).flatMap(m => [m.team1, m.team2]));
            if (!round1Teams.has(teamName) && round2Teams.has(teamName)) firstRdByes++;

            // Playoff record
            bracket.forEach(m => {
                if (m.winner === teamName) playoffWins++;
                if (m.loser  === teamName) playoffLosses++;
            });
        }

        // Trades by season
        ["2023","2024","2025","2026"].forEach(yr => {
            tradesBySeason[yr] = allTransactions.filter(tx =>
                tx.type === "trade" && tx.season === yr &&
                (tx.teams || []).includes(teamName)
            ).length;
        });
        const totalTrades = Object.values(tradesBySeason).reduce((s,v)=>s+v,0);

        // Transactions (non-trade: waiver + FA) by season
        const txBySeason = {};
        ["2023","2024","2025","2026"].forEach(yr => {
            txBySeason[yr] = allTransactions.filter(tx =>
                (tx.type === "waiver" || tx.type === "free_agent") &&
                tx.season === yr && tx.status === "complete" &&
                (tx.teams || []).includes(teamName)
            ).length;
        });
        const totalTx = Object.values(txBySeason).reduce((s,v)=>s+v,0);

        // Transaction rank per season
        const txRankBySeason = {};
        ["2023","2024","2025","2026"].forEach(yr => {
            const counts = {};
            allTransactions.filter(tx =>
                (tx.type === "waiver" || tx.type === "free_agent") &&
                tx.season === yr && tx.status === "complete"
            ).forEach(tx => { (tx.teams || []).forEach(t => { counts[t] = (counts[t]||0) + 1; }); });
            const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
            const idx = sorted.findIndex(([t]) => t === teamName);
            txRankBySeason[yr] = idx >= 0 ? idx + 1 : null;
        });

        // Top trade partners (all years)
        const partnerCount = {};
        allTransactions.filter(tx => tx.type === "trade" && (tx.teams || []).includes(teamName))
            .forEach(tx => {
                (tx.teams || []).forEach(t => {
                    if (t !== teamName) partnerCount[t] = (partnerCount[t]||0) + 1;
                });
            });
        const topPartners = Object.entries(partnerCount).sort((a,b)=>b[1]-a[1]).slice(0,6);

        // ── Current roster ────────────────────────────────────────────────────
        const myRoster = (rosters || []).find(r => r.owner === teamName);
        const players  = myRoster?.players || [];

        // Group + sort players
        const grouped = {};
        players.filter(p => p && p.name).forEach(p => {
            const pos = p.position || "OTHER";
            if (!grouped[pos]) grouped[pos] = [];
            grouped[pos].push(p);
        });
        Object.keys(grouped).forEach(pos => {
            grouped[pos].sort((a,b) => {
                const av = (playerValues[a.name]?.ktc ?? 0);
                const bv = (playerValues[b.name]?.ktc ?? 0);
                if (av !== bv) return bv - av; // KTC descending
                return (a.search_rank??999999) - (b.search_rank??999999);
            });
        });
        const sortedPos = POS_ORDER.filter(p => grouped[p])
            .concat(Object.keys(grouped).filter(p => !POS_ORDER.includes(p)));

        // ── Current picks ─────────────────────────────────────────────────────
        // Build ownership map from traded picks
        const ownership = {};
        FUTURE_YEARS.forEach(year => {
            ownership[year] = {};
            ROUNDS.forEach(round => {
                ownership[year][round] = {};
                (rosters || []).forEach(r => {
                    const name = r.owner || `Roster ${r.roster_id}`;
                    ownership[year][round][name] = name; // default: own pick
                });
            });
        });
        (tradedPicks || []).forEach(p => {
            const yr = p.season, rd = p.round, orig = p.original_owner_name, curr = p.owner_name;
            if (ownership[yr]?.[rd]?.[orig] !== undefined) {
                ownership[yr][rd][orig] = curr;
            }
        });

        // My picks: picks currently owned by me
        const myPicks = [];
        FUTURE_YEARS.forEach(year => {
            ROUNDS.forEach(round => {
                Object.entries(ownership[year][round]).forEach(([orig, curr]) => {
                    if (curr === teamName) myPicks.push({ year, round, orig, isOwn: orig === teamName });
                });
            });
        });

        // ── Render ────────────────────────────────────────────────────────────
        const playoffRate = seasonsPlayed ? Math.round(playoffApps / seasonsPlayed * 100) : 0;
        const regPct = (totalRegWins + totalRegLosses) > 0
            ? (totalRegWins / (totalRegWins + totalRegLosses) * 100).toFixed(1)
            : null;

        // Avatar element html
        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.outerHTML='<span style=\\'width:56px;height:56px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;\\'>${teamName[0].toUpperCase()}</span>'">`
            : `<span style="width:56px;height:56px;border-radius:50%;background:${accent};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0;">${teamName[0].toUpperCase()}</span>`;

        function statBlock(label, value, sub) {
            return `<div style="display:flex;flex-direction:column;gap:2px;min-width:0;overflow:hidden;">
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;white-space:nowrap;">${label}</div>
                <div style="display:flex;align-items:baseline;gap:4px;white-space:nowrap;">
                    <span style="font-size:17px;font-weight:800;color:${value === '0' || value === '0%' ? '#3ecf8e' : '#f0f1f3'};white-space:nowrap;">${value}</span>
                    ${sub ? `<span style="font-size:10px;color:#5a6070;white-space:nowrap;">${sub}</span>` : ''}
                </div>
            </div>`;
        }

        // Trade rank per season
        const tradeRankBySeason = {};
        ["2023","2024","2025","2026"].forEach(yr => {
            const teamTradeCounts = {};
            allTransactions.filter(tx => tx.type === "trade" && tx.season === yr)
                .forEach(tx => { (tx.teams || []).forEach(t => { teamTradeCounts[t] = (teamTradeCounts[t]||0) + 0.5; }); });
            Object.keys(teamTradeCounts).forEach(t => { teamTradeCounts[t] = Math.round(teamTradeCounts[t]); });
            const sorted = Object.entries(teamTradeCounts).sort((a,b) => b[1]-a[1]);
            const idx = sorted.findIndex(([t]) => t === teamName);
            tradeRankBySeason[yr] = idx >= 0 ? idx + 1 : null;
        });

        // Transaction bars
        const maxTx = Math.max(...Object.values(txBySeason), 1);
        const txBars = ["2026","2025","2024","2023"].map(yr => {
            const n = txBySeason[yr] || 0;
            const pct = Math.round(n / maxTx * 100);
            const rank = txRankBySeason[yr];
            const rankHtml = rank ? `<div style="font-size:10px;color:#5a6070;width:28px;text-align:right;flex-shrink:0;">#${rank}</div>` : `<div style="width:28px;"></div>`;
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <div style="font-size:12px;color:#8b9099;width:32px;flex-shrink:0;">${yr}</div>
                <div style="flex:1;background:#2d3139;border-radius:3px;height:8px;">
                    <div style="width:${pct}%;background:#4299e1;height:8px;border-radius:3px;transition:width .3s;"></div>
                </div>
                <div style="font-size:12px;color:#8b9099;width:16px;text-align:right;flex-shrink:0;">${n}</div>
                ${rankHtml}
            </div>`;
        }).join("");

        // Trade bars
        const maxTrades = Math.max(...Object.values(tradesBySeason), 1);
        const tradeBars = ["2026","2025","2024","2023"].map(yr => {
            const n = tradesBySeason[yr] || 0;
            const pct = Math.round(n / maxTrades * 100);
            const rank = tradeRankBySeason[yr];
            const rankHtml = rank ? `<div style="font-size:10px;color:#5a6070;width:28px;text-align:right;flex-shrink:0;">#${rank}</div>` : `<div style="width:28px;"></div>`;
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <div style="font-size:12px;color:#8b9099;width:32px;flex-shrink:0;">${yr}</div>
                <div style="flex:1;background:#2d3139;border-radius:3px;height:8px;">
                    <div style="width:${pct}%;background:#3ecf8e;height:8px;border-radius:3px;transition:width .3s;"></div>
                </div>
                <div style="font-size:12px;color:#8b9099;width:16px;text-align:right;flex-shrink:0;">${n}</div>
                ${rankHtml}
            </div>`;
        }).join("");

        // Partner rows
        const partnerAvatars = {};
        (leagueUsers || []).forEach(u => { partnerAvatars[u.username] = u.avatar_url; });
        const partnerRows = topPartners.map(([partner, count]) => {
            const pAvatar = partnerAvatars[partner];
            const pAccent = accentFor(partner);
            const pAvatarHtml = pAvatar
                ? `<img src="${pAvatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'">`
                : `<span style="width:32px;height:32px;border-radius:50%;background:${pAccent};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;">${partner[0].toUpperCase()}</span>`;
            return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #2d3139;">
                ${pAvatarHtml}
                <span style="font-size:13px;font-weight:600;color:#f0f1f3;flex:1;">${partner}</span>
                <span style="font-size:12px;color:#5a6070;">${count} trade${count===1?'':'s'}</span>
            </div>`;
        }).join("");

        // KTC value color helper
        function ktcColor(v) {
            if (v >= 8000) return "#3ecf8e";
            if (v >= 6000) return "#4299e1";
            if (v >= 4000) return "#a78bfa";
            if (v >= 2000) return "#f6ad55";
            return "#5a6070";
        }
        function fmtApy(apy) {
            if (!apy) return null;
            if (apy >= 1000000) return `$${(apy/1000000).toFixed(1).replace(/\.0$/,'')}M`;
            if (apy >= 1000) return `$${Math.round(apy/1000)}K`;
            return `$${apy}`;
        }

        // Roster rows
        const rosterHtml = sortedPos.map(pos => {
            const header = `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin:12px 0 4px;">${pos}</div>`;
            const rows = grouped[pos].map(p => {
                const badge = `<span style="background:${posColor(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 0;border-radius:4px;width:30px;text-align:center;flex-shrink:0;">${p.position||'?'}</span>`;
                const rookieBadge = p.years_exp === 0 ? `<span style="font-size:9px;font-weight:700;color:#f6ad55;background:rgba(246,173,85,.15);padding:1px 5px;border-radius:3px;">R</span>` : '';
                const teamLogo = p.team ? `<img src="https://sleepercdn.com/images/team_logos/nfl/${p.team.toLowerCase()}.jpg" style="width:18px;height:18px;object-fit:contain;opacity:.8;" onerror="this.style.display='none'">` : '';
                const ageStr = p.birth_date ? (() => { const b = new Date(p.birth_date); return ((Date.now()-b)/(365.25*24*60*60*1000)).toFixed(1); })() : (p.age || '');
                return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#252830;border-radius:8px;margin-bottom:3px;">
                    ${badge}
                    <span style="font-size:13px;font-weight:600;color:#f0f1f3;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}${rookieBadge}</span>
                    ${teamLogo}
                    ${ageStr ? `<span style="font-size:11px;color:#5a6070;flex-shrink:0;">${ageStr}</span>` : ''}
                </div>`;
            }).join("");
            return header + rows;
        }).join("");

        // Picks html
        const pickLabel = (yr, rd, orig, isOwn) => {
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:#252830;border-radius:8px;margin-bottom:3px;overflow:hidden;">
                <span style="background:#5a5be6;color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;white-space:nowrap;flex-shrink:0;">${yr} R${rd}</span>
                <span style="font-size:12px;font-weight:600;color:#f0f1f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">${isOwn ? 'Own pick' : orig + "'s pick"}</span>
            </div>`;
        };

        // Build picks grouped by year+round, with headers and empty spacers
        const ordinal = r => r === 1 ? '1st' : r === 2 ? '2nd' : '3rd';
        let picksHtml = '';
        FUTURE_YEARS.forEach(yr => {
            ROUNDS.forEach(rd => {
                const slotPicks = myPicks.filter(p => p.year === yr && p.round === rd);
                picksHtml += `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin:10px 0 3px;">${yr} · ${ordinal(rd)} Round</div>`;
                if (slotPicks.length) {
                    picksHtml += slotPicks.map(p => pickLabel(p.year, p.round, p.orig, p.isOwn)).join('');
                } else {
                    picksHtml += `<div style="height:28px;"></div>`;
                }
            });
        });

        // ── Draft Analysis ────────────────────────────────────────────────────
        const currentRosterNames = new Set((rosters.find(r=>r.owner===teamName)?.players||[]).map(p=>p.name));

        // Build set of all player names ever transacted by this team
        const tradedAwayNames = new Set();
        const droppedNames2 = new Set();
        allTransactions.forEach(tx => {
            if (!(tx.teams||[]).includes(teamName)) return;
            if (tx.type === "trade") {
                Object.entries(tx.assets_received || {}).forEach(([rcv, assets]) => {
                    if (rcv !== teamName) {
                        (assets||[]).forEach(a => { if (a.name) tradedAwayNames.add(a.name); });
                    }
                });
            } else if (tx.type === "waiver" || tx.type === "free_agent") {
                (tx.dropped||[]).forEach(a => { if (a.name) droppedNames2.add(a.name); });
            }
        });

        function playerStatus(name) {
            if (currentRosterNames.has(name)) return "roster";
            if (tradedAwayNames.has(name)) return "traded";
            return "dropped";
        }

        function posColor2(pos) {
            return {QB:"#e74c82",RB:"#3ecf8e",WR:"#4299e1",TE:"#f6ad55",K:"#9f7aea",DEF:"#38b2ac"}[pos] || "#5a6070";
        }

        // Draft tier labels for startup (2023) vs rookie drafts
        function startupTier(round) {
            if (round <= 3) return {label:"Franchise Core", color:"#f6ad55"};
            if (round <= 8) return {label:"Starter", color:"#3ecf8e"};
            if (round <= 15) return {label:"Depth", color:"#4299e1"};
            return {label:"Late Flier", color:"#5a6070"};
        }
        function rookieTier(round, pickInRound, totalTeams) {
            const pct = pickInRound / totalTeams;
            if (round === 1 && pct <= 0.33) return {label:"Top Pick", color:"#f6ad55"};
            if (round === 1 && pct <= 0.67) return {label:"Mid 1st", color:"#a78bfa"};
            if (round === 1) return {label:"Late 1st", color:"#4299e1"};
            if (round === 2) return {label:"2nd Round", color:"#3ecf8e"};
            return {label:"3rd Round", color:"#8b9099"};
        }

        function revisitedGrade(picks) {
            if (!picks.length) return null;
            const statuses = picks.map(p => playerStatus(p.player));
            const onRoster = statuses.filter(s => s === "roster").length;
            const pct = onRoster / picks.length;
            if (pct >= 0.75) return {grade:"A", color:"#3ecf8e"};
            if (pct >= 0.5)  return {grade:"B", color:"#a78bfa"};
            if (pct >= 0.25) return {grade:"C", color:"#f6ad55"};
            return {grade:"D", color:"#e74c82"};
        }

        function recapScore(picks, isStartup) {
            if (!picks.length) return null;
            // Weight: 60% roster retention, 40% pick position value
            const statuses = picks.map(p => playerStatus(p.player));
            const onRoster = statuses.filter(s => s === "roster").length;
            const retentionPct = onRoster / picks.length;
            // Pick position value: avg of (1 - pickInRound/totalTeams) across all picks
            const totalTeams = 12;
            let pickVal = 0;
            picks.forEach(p => {
                const pickInRound = ((p.pick_no - 1) % totalTeams) + 1;
                pickVal += 1 - (pickInRound - 1) / totalTeams;
            });
            pickVal = pickVal / picks.length;
            const raw = retentionPct * 0.6 + pickVal * 0.4;
            return Math.round(raw * 10 * 10) / 10; // 0-10
        }

        function buildDraftYearHtml(year) {
            const allPicks = (draftByYear[year] || []).filter(p => p.picked_by === teamName);
            if (!allPicks.length) return `<div style="color:#5a6070;font-size:13px;padding:12px 0;">No picks in this draft.</div>`;
            const isStartup = year === "2023";
            const totalTeams = 12;
            const revisitYear = parseInt(year) + 2;
            const canRevisit = revisitYear <= 2026; // current season

            // Group by round
            const byRound = {};
            allPicks.forEach(p => {
                if (!byRound[p.round]) byRound[p.round] = [];
                byRound[p.round].push(p);
            });

            // Status counts
            const onRoster = allPicks.filter(p => playerStatus(p.player) === "roster").length;
            const traded = allPicks.filter(p => playerStatus(p.player) === "traded").length;
            const dropped = allPicks.filter(p => playerStatus(p.player) === "dropped").length;
            const hitRate = Math.round(onRoster / allPicks.length * 100);

            // Pick rows
            const pickRows = Object.keys(byRound).sort((a,b)=>+a-+b).map(rd => {
                const roundPicks = byRound[rd];
                const tier = isStartup ? startupTier(+rd) : rookieTier(+rd, ((roundPicks[0].pick_no-1)%totalTeams)+1, totalTeams);
                const roundHeader = `<div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px;">
                    <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;">Round ${rd}</span>
                    <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${tier.color}22;color:${tier.color};">${tier.label}</span>
                </div>`;
                const rows = roundPicks.map(p => {
                    const pickInRound = ((p.pick_no - 1) % totalTeams) + 1;
                    const status = playerStatus(p.player);
                    const statusBadge = status === "roster"
                        ? `<span style="font-size:10px;font-weight:700;color:#3ecf8e;background:#3ecf8e18;padding:2px 6px;border-radius:4px;white-space:nowrap;">On Roster</span>`
                        : status === "traded"
                        ? `<span style="font-size:10px;font-weight:700;color:#4299e1;background:#4299e118;padding:2px 6px;border-radius:4px;white-space:nowrap;">Traded</span>`
                        : `<span style="font-size:10px;font-weight:700;color:#5a6070;background:#2d3139;padding:2px 6px;border-radius:4px;white-space:nowrap;">Released</span>`;
                    const wasTraded = p.traded ? `<span style="font-size:10px;color:#f6ad55;margin-left:4px;" title="Pick was traded">↔</span>` : '';
                    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#252830;border-radius:8px;margin-bottom:3px;">
                        <span style="background:${posColor2(p.position)};color:#fff;font-size:10px;font-weight:800;padding:2px 0;border-radius:4px;width:30px;text-align:center;flex-shrink:0;">${p.position||'?'}</span>
                        <span style="font-size:12px;font-weight:600;color:#f0f1f3;flex:1;">${p.player}${wasTraded}</span>
                        <span style="font-size:11px;color:#5a6070;flex-shrink:0;">${year.slice(2)}.${String(pickInRound).padStart(2,'0')}</span>
                        ${statusBadge}
                    </div>`;
                }).join("");
                return roundHeader + rows;
            }).join("");

            // Recap summary text
            const topPicks = allPicks.filter(p => isStartup ? p.round <= 3 : p.round === 1);
            const topOnRoster = topPicks.filter(p => playerStatus(p.player) === "roster");
            const recapText = isStartup
                ? `Selected ${allPicks.length} players across ${Object.keys(byRound).length} rounds. Early picks (R1–R3): ${topPicks.map(p=>p.player).join(", ") || "none"}. ${topOnRoster.length} of ${topPicks.length} top picks remain on the roster today.`
                : `Selected ${allPicks.length} rookie${allPicks.length!==1?'s':''} — ${allPicks.map(p=>`${p.player} (${p.position})`).join(", ")}. ${onRoster} of ${allPicks.length} are still on the roster.`;
            const score = recapScore(allPicks, isStartup);

            // Revisited section
            let revisitedHtml = '';
            if (canRevisit) {
                const grade = revisitedGrade(allPicks);
                const revisitedText = isStartup
                    ? `${revisitYear - parseInt(year)} years on: ${onRoster} of ${allPicks.length} drafted players remain (${hitRate}% retention). ${traded} were traded for value, ${dropped} were released.`
                    : `${revisitYear - parseInt(year)} years after this rookie draft: ${onRoster} of ${allPicks.length} are still contributing. ${traded > 0 ? traded + " were traded away." : ""} ${dropped > 0 ? dropped + " were released." : ""}`.trim();
                const gColor = grade ? grade.color : "#5a6070";
                revisitedHtml = `
                <div style="background:#252830;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-top:16px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
                        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">Draft Revisited · ${revisitYear}</div>
                        ${grade ? `<span style="font-size:28px;font-weight:900;color:${gColor};">${grade.grade}</span>` : ''}
                    </div>
                    <div style="display:flex;gap:24px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #2d3139;">
                        <div><div style="font-size:22px;font-weight:800;color:#3ecf8e;">${onRoster}</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">On Roster</div></div>
                        <div><div style="font-size:22px;font-weight:800;color:#4299e1;">${traded}</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Traded</div></div>
                        <div><div style="font-size:22px;font-weight:800;color:#5a6070;">${dropped}</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Released</div></div>
                        <div><div style="font-size:22px;font-weight:800;color:#f0f1f3;">${hitRate}%</div><div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Retention</div></div>
                    </div>
                    <div style="font-size:13px;color:#c9cdd4;line-height:1.7;">${revisitedText}</div>
                </div>`;
            }

            const scoreColor = score >= 7 ? "#3ecf8e" : score >= 5 ? "#f6ad55" : "#e74c82";
            const recapCard = `
            <div style="background:#252830;border:1px solid #2d3139;border-radius:10px;padding:16px;margin-bottom:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">Draft Recap</div>
                    ${score !== null ? `<div style="display:flex;align-items:baseline;gap:4px;"><span style="font-size:26px;font-weight:900;color:${scoreColor};">${score}</span><span style="font-size:13px;color:#5a6070;font-weight:600;">/10</span></div>` : ''}
                </div>
                <div style="font-size:13px;color:#c9cdd4;line-height:1.7;">${recapText}</div>
            </div>`;

            return isStartup
                ? `${recapCard}${pickRows}${revisitedHtml}`
                : `${pickRows}${recapCard}${revisitedHtml}`;
        }

        const draftYears = ["2026","2025","2024","2023"];
        const activeYears = draftYears.filter(yr => (draftByYear[yr]||[]).some(p => p.picked_by === teamName));

        const draftSections = activeYears.map((yr, i) =>
            `<div class="draft-tab-content" id="draft-tab-${yr}" style="display:${i===0?'block':'none'};">${buildDraftYearHtml(yr)}</div>`
        ).join('');

        const draftTabButtons = activeYears.map((yr, i) =>
            `<button data-year="${yr}" onclick="switchDraftTab(this)" class="draft-tab-btn${i===0?' draft-tab-active':''}" style="background:none;border:none;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:#8b9099;transition:background .15s,color .15s;">${yr}</button>`
        ).join('');

        // ── Compact draft summary card (for col 3) ───────────────────────────
        const draftSummaryRows = draftYears.map(yr => {
            const allPicks = (draftByYear[yr] || []).filter(p => p.picked_by === teamName);
            if (!allPicks.length) return '';
            const isStartup = yr === "2023";
            const score = recapScore(allPicks, isStartup);
            const scoreColor = score >= 7 ? "#3ecf8e" : score >= 5 ? "#f6ad55" : "#e74c82";
            const revisitYear = parseInt(yr) + 2;
            const canRevisit = revisitYear <= 2026;
            const grade = canRevisit ? revisitedGrade(allPicks) : null;
            const onRosterCnt = allPicks.filter(p => playerStatus(p.player) === "roster").length;
            const retentionPct = Math.round(onRosterCnt / allPicks.length * 100);
            return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #2d3139;">
                <div style="font-size:13px;font-weight:700;color:#f0f1f3;width:36px;flex-shrink:0;">${yr}</div>
                <div style="font-size:11px;color:#5a6070;flex:1;">${isStartup ? "Startup" : "Rookie"}</div>
                ${score !== null ? `<div style="display:flex;align-items:baseline;gap:2px;">
                    <span style="font-size:18px;font-weight:900;color:${scoreColor};">${score}</span>
                    <span style="font-size:11px;color:#5a6070;">/10</span>
                </div>` : '<div style="font-size:13px;color:#5a6070;">—</div>'}
                ${grade ? `<div style="font-size:20px;font-weight:900;color:${grade.color};width:24px;text-align:right;">${grade.grade}</div>` : `<div style="font-size:13px;color:#5a6070;width:24px;text-align:right;">—</div>`}
                <div style="font-size:11px;color:#5a6070;width:38px;text-align:right;flex-shrink:0;">${retentionPct}%</div>
            </div>`;
        }).filter(Boolean).join('');

        const draftSummaryCard = draftSummaryRows ? `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Draft Summary</div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:4px;padding-bottom:6px;border-bottom:1px solid #2d3139;">
            <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;width:42px;text-align:right;">Score</div>
            <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;width:24px;text-align:right;">Grade</div>
            <div style="font-size:10px;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;width:38px;text-align:right;">Keep%</div>
          </div>
          ${draftSummaryRows}
        </div>` : '';

        const draftHtml = draftTabButtons ? `
        <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;margin-top:16px;">
            <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:14px;">Draft History</div>
            <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #2d3139;padding-bottom:12px;">
                ${draftTabButtons}
            </div>
            <style>
                .draft-tab-btn:hover { color:#f0f1f3 !important; background:#252830 !important; }
                .draft-tab-active { color:#f0f1f3 !important; background:#252830 !important; }
            </style>
            ${draftSections}
        </div>` : '';

        container.innerHTML = `
        <style>
          .team-page-outer { max-width:960px; }
          .team-page-wrap { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; align-items:start; }
          @media (max-width:750px) { .team-page-wrap { grid-template-columns:1fr 1fr; } }
          @media (max-width:500px) { .team-page-wrap { grid-template-columns:1fr; } }
          .team-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
          .team-col-equal { display:flex; flex-direction:column; min-width:0; align-self:stretch; }
          .team-col-equal .equal-card { flex:1; }
          .team-stats-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px 8px; }
          @media (max-width:400px) { .team-stats-grid { grid-template-columns:1fr 1fr; } }
          .team-header-wrap { display:flex; align-items:center; gap:14px; margin-bottom:20px; flex-wrap:wrap; }
        </style>

        <div class="team-page-outer">
        <!-- Back nav -->
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;">
          <a href="teams.html#rosters" style="background:#1e2027;border:1px solid #2d3139;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;color:#8b9099;text-decoration:none;" onmouseover="this.style.color='#f0f1f3';this.style.background='#252830'" onmouseout="this.style.color='#8b9099';this.style.background='#1e2027'">Rosters</a>
          <a href="teams.html#picks" style="background:#1e2027;border:1px solid #2d3139;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;color:#8b9099;text-decoration:none;" onmouseover="this.style.color='#f0f1f3';this.style.background='#252830'" onmouseout="this.style.color='#8b9099';this.style.background='#1e2027'">Picks</a>
        </div>
        <div class="filter-bar" style="margin-bottom:20px;">
          <select onchange="if(this.value)window.location.href='team.html?team='+encodeURIComponent(this.value)">
            <option value="">View a team…</option>
            ${(rosters||[]).filter(r=>r.owner&&!INACTIVE_USERS.has(r.owner)).sort((a,b)=>a.owner.localeCompare(b.owner)).map(r=>`<option value="${r.owner}"${r.owner===teamName?' selected':''}>${r.owner}</option>`).join('')}
          </select>
        </div>
        <!-- Header -->
        <div class="team-header-wrap">
          ${avatarHtml}
          <div>
            <div style="font-size:22px;font-weight:800;color:#f0f1f3;">${teamName}</div>
            ${seasonsPlayed ? `<div style="font-size:12px;color:#5a6070;margin-top:3px;">${seasonsPlayed} season${seasonsPlayed!==1?'s':''} played</div>` : ''}
          </div>
        </div>

        <div class="team-page-wrap">

          <!-- COL 1: Roster -->
          <div class="team-col-equal">
            <div class="equal-card" style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:4px;">Current Roster</div>
              <div style="font-size:12px;color:#5a6070;margin-bottom:8px;">${players.length} players</div>
              ${rosterHtml}
            </div>
          </div>

          <!-- COL 2: Draft Picks -->
          <div class="team-col-equal">
            <div class="equal-card" style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:4px;">Draft Picks</div>
              <div style="font-size:12px;color:#5a6070;margin-bottom:8px;">${myPicks.length} picks</div>
              ${picksHtml}
            </div>
          </div>

          <!-- COL 3: Stats + activity + partners -->
          <div class="team-col">

            <!-- Stat grid -->
            <div class="team-stats-grid" style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:16px;">
              ${statBlock("Championships", String(championships))}
              ${statBlock("Playoff Apps", String(playoffApps))}
              ${statBlock("Reg. Season", `${totalRegWins}–${totalRegLosses}`, regPct ? `${regPct}%` : '')}
              ${statBlock("Playoffs", `${playoffWins}–${playoffLosses}`, playoffApps ? `${Math.round(playoffWins/(playoffWins+playoffLosses||1)*100)}%` : '')}
              ${statBlock("Playoff Rate", `${playoffRate}%`)}
              ${statBlock("First Rd Byes", String(firstRdByes))}
            </div>

            <!-- Transaction activity -->
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Transactions by season</div>
                <div style="font-size:12px;color:#5a6070;">${totalTx} moves</div>
              </div>
              ${txBars}
            </div>

            <!-- Trade activity -->
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Trade activity by season</div>
                <div style="font-size:12px;color:#5a6070;">${totalTrades} trades</div>
              </div>
              ${tradeBars}
            </div>

            <!-- Top trade partners -->
            ${topPartners.length ? `
            <div style="background:#1e2027;border:1px solid #2d3139;border-radius:12px;padding:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <div style="font-size:14px;font-weight:700;color:#f0f1f3;">Top trade partners</div>
                <div style="font-size:12px;color:#5a6070;">${Object.keys(partnerCount).length} teams</div>
              </div>
              ${partnerRows}
            </div>` : ''}

            ${draftSummaryCard}

          </div><!-- /col 3 -->
        </div><!-- /team-page-wrap -->

        ${draftHtml}

        </div><!-- /team-page-outer -->`;

    } catch(err) {
        console.error(err);
        container.innerHTML = `<p style="color:#e74c82;padding:20px;">Error loading team: ${err.message}</p>`;
    }
}

init();

window.switchDraftTab = function(btn) {
    const yr = btn.dataset.year;
    document.querySelectorAll('.draft-tab-content').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.draft-tab-btn').forEach(b => b.classList.remove('draft-tab-active'));
    const target = document.getElementById('draft-tab-' + yr);
    if (target) target.style.display = 'block';
    btn.classList.add('draft-tab-active');
};
