import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

renderNav();

const ROUNDS = [1, 2, 3];
const FUTURE_YEARS = ["2027", "2028", "2029"];

async function init() {
    const container = document.getElementById("content");
    if (!container) return;

    try {
        const [rosters, tradedPicks] = await Promise.all([
            api.getRosters("2026"),
            api.getTradedPicks(),
        ]);

        const teams = (rosters || [])
            .sort((a, b) => a.roster_id - b.roster_id)
            .map(r => r.owner || `Roster ${r.roster_id}`);

        // Start: every team owns all their own picks
        const ownership = {};
        FUTURE_YEARS.forEach(year => {
            ownership[year] = {};
            ROUNDS.forEach(round => {
                ownership[year][round] = {};
                teams.forEach(name => {
                    ownership[year][round][name] = name;
                });
            });
        });

        // Apply trades
        (tradedPicks || []).forEach(p => {
            const year = p.season, round = p.round, original = p.original_owner_name, current = p.owner_name;
            if (ownership[year]?.[round]?.[original] !== undefined) {
                ownership[year][round][original] = current;
            }
        });

        // Build per-team: { year: [ {round, original, own} ] }
        const picksByTeam = {};
        teams.forEach(name => { picksByTeam[name] = {}; FUTURE_YEARS.forEach(y => { picksByTeam[name][y] = []; }); });

        FUTURE_YEARS.forEach(year => {
            ROUNDS.forEach(round => {
                Object.entries(ownership[year][round]).forEach(([original, current]) => {
                    if (!picksByTeam[current]) { picksByTeam[current] = {}; FUTURE_YEARS.forEach(y => { picksByTeam[current][y] = []; }); }
                    picksByTeam[current][year].push({ round, original, own: original === current });
                });
            });
        });

        const rosterByName = {};
        (rosters || []).forEach(r => { rosterByName[r.owner || `Roster ${r.roster_id}`] = r; });

        const cards = teams.map(name => {
            const roster = rosterByName[name];
            const totalPicks = FUTURE_YEARS.reduce((sum, y) => sum + picksByTeam[name][y].length, 0);

            // Build per-year columns — years side by side
            const yearCols = FUTURE_YEARS.map(year => {
                const picks = picksByTeam[name][year].sort((a, b) => a.round - b.round);
                const pickPills = picks.map(p => {
                    const bg = p.own ? "#252830" : "#1e1b33";
                    const color = p.own ? "#c9cdd4" : "#a78bfa";
                    const border = p.own ? "#2d3139" : "#4c3d8a";
                    const label = p.own ? `R${p.round}` : `R${p.round} - ${p.original}`;
                    return `<span style="background:${bg};color:${color};border:1px solid ${border};border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;white-space:nowrap;display:block;" title="${p.own ? "Own pick" : `${p.original}'s pick`}">${label}</span>`;
                }).join("");
                return `<div style="flex:1;min-width:70px;">
                    <div style="font-size:10px;font-weight:700;color:#5a6070;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">${year}</div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        ${pickPills || `<span style="color:#3d4350;font-size:11px;">—</span>`}
                    </div>
                </div>`;
            }).join("");

            const yearRows = `<div style="display:flex;gap:12px;flex-wrap:wrap;">${yearCols}</div>`;

            return `
                <div style="background:var(--card-bg);border:1px solid #2d3139;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.3);">
                    <div style="font-size:14px;font-weight:700;color:#f0f1f3;margin-bottom:4px;">${name}</div>
                    <div style="font-size:11px;color:#5a6070;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #2d3139;">
                        ${roster?.players?.length || 0} players · ${totalPicks} picks
                    </div>
                    <div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;font-weight:700;margin-bottom:8px;">Draft Picks</div>
                    ${yearRows || '<div style="color:#5a6070;font-size:12px;font-style:italic;">No future picks</div>'}
                </div>
            `;
        }).join("");

        container.innerHTML = `
            <style>
                #content {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 16px;
                    align-items: start;
                }
            </style>
            ${cards}
        `;

    } catch (e) {
        console.error(e);
        container.innerHTML = "Failed to load assets.";
    }
}

init();
