async function renderTeam() {
    const container = document.getElementById("team-container");
    if (!container) return;

    const params = new URLSearchParams(window.location.search);
    const teamId = params.get("team_id");

    if (!teamId) {
        container.innerHTML = "No team selected";
        return;
    }

    container.innerHTML = "Loading team...";

    try {
        const [rosters, players] = await Promise.all([
            fetch("data/rosters.json").then(r => r.json()),
            getPlayers()
        ]);

        const team = rosters[teamId];

        if (!team) {
            container.innerHTML = "Team not found";
            return;
        }

        container.innerHTML = `
            <h2>${team.name}</h2>
            <ul>
                ${(team.players || []).map(id => {
                    const p = players[id];
                    return `<li>${p ? p.full_name : "Unknown Player"}</li>`;
                }).join("")}
            </ul>
        `;

    } catch (err) {
        console.error(err);
        container.innerHTML = "Error loading team.";
    }
}

document.addEventListener("DOMContentLoaded", renderTeam);