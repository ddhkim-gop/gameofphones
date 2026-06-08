let playersCache = null;

/**
 * Load and cache all players
 */
async function loadCache() {
    if (!playersCache) {
        playersCache = await getPlayers();
    }
    return playersCache;
}

/**
 * Get player by Sleeper player_id
 */
async function findPlayerById(id) {
    const players = await loadCache();
    return players?.[id] || null;
}

/**
 * Search players by name
 */
async function searchPlayers(query) {
    const players = await loadCache();

    if (!query) return [];

    const q = query.toLowerCase();

    return Object.values(players)
        .filter(p =>
            p.full_name?.toLowerCase().includes(q)
        )
        .slice(0, 20);
}

/**
 * Find players by partial name
 */
async function findPlayerByName(query) {
    const players = await loadCache();

    if (!query) return [];

    const q = query.toLowerCase();

    return Object.values(players)
        .filter(p =>
            (p.full_name || "").toLowerCase().includes(q)
        );
}

/**
 * Convert player object → clickable HTML link
 */
function playerLink(player) {
    if (!player || !player.player_id) return "";

    const name = player.full_name || "Unknown Player";

    return `<a href="player.html?player_id=${player.player_id}">${name}</a>`;
}