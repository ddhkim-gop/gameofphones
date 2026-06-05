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

        // Build name list from rosters
        const teams = (rosters || [])
            .sort((a, b) => a.roster_id - b.roster_id)
            .map(r => r.owner || `Roster ${r.roster_id}`);

        const rosterByName = {};
        (rosters || []).forEach(r => {
            rosterByName[r.owner || `Roster ${r.roster_id}`] = r;
        });

        // Start: every team owns all their own picks
        // pick_ownership[season][round][original_owner] = current_owner
        const ownership = {};
        FUTURE_YEARS.forEach(year => {
            ownership[year] = {};
            ROUNDS.forEach(round => {
                ownership[year][round] = {};
                teams.forEach(name => {
                    ownership[year][round][name] = name; // owns own pick by default
                });
            });
        });

        // Apply trades — override ownership
        (tradedPicks || []).forEach(p => {
            const year = p.season;
            const round = p.round;
            const original = p.original_owner_name;
            const current = p.owner_name;

            if (ownership[year]?.[round]?.[original] !== undefined) {
                ownership[year][round][original] = current;
            }
        });

        // Build per-team pick list
        const picksByTeam = {};
        teams.forEach(name => { picksByTeam[name] = []; });

        FUTURE_YEARS.forEach(year => {
            ROUNDS.forEach(round => {
                Object.entries(ownership[year][round]).forEach(([original, current]) => {
                    if (!picksByTeam[current]) picksByTeam[current] = [];
                    picksByTeam[current].push({
                        season: year,
                        round,
                        original,
                        own: original === current
                    });
                });
            });
        });

        // Render cards
        const cards = teams.map(name => {
            const picks = picksByTeam[name] || [];
            const roster = rosterByName[name];

            const picksHtml = picks.map(p => `
                <div class="pick-row ${p.own ? "own-pick" : "traded-pick"}">
                    <span class="pick-label">${p.season} Rd ${p.round}</span>
                    ${!p.own ? `<span class="pick-from"> — from ${p.original}</span>` : ""}
                </div>
            `).join("");

            return `
                <div class="asset-card">
                    <div class="asset-body">
                        <h3>${name}</h3>
                        <div class="section-label">Draft Picks</div>
                        ${picksHtml || '<div class="muted">No picks</div>'}
                    </div>
                    <div class="asset-footer">
                        Players: ${roster?.players?.length || 0} • Picks: ${picks.length}
                    </div>
                </div>
            `;
        }).join("");

        container.innerHTML = `
            <style>
                #content {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                    gap: 16px;
                    align-items: stretch;
                }
                .asset-card {
                    background: var(--card-bg, #fff);
                    border-radius: 8px;
                    padding: 16px;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                }
                .asset-body { flex: 1; }
                .asset-footer {
                    margin-top: 12px;
                    padding-top: 8px;
                    border-top: 1px solid #e5e7eb;
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #9ca3af;
                }
                .section-label {
                    font-size: 12px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #9ca3af;
                    margin-bottom: 6px;
                    margin-top: 8px;
                }
                .pick-row { font-size: 13px; padding: 2px 0; }
                .pick-label { font-weight: 600; }
                .own-pick .pick-label { color: #374151; }
                .traded-pick .pick-label { color: #7c3aed; }
                .pick-from { color: #6b7280; font-size: 12px; }
                .muted { color: #9ca3af; font-style: italic; font-size: 13px; }
            </style>
            ${cards}
        `;

    } catch (e) {
        console.error(e);
        container.innerHTML = "Failed to load assets.";
    }
}

init();