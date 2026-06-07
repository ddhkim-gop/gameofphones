const D = window.__STATIC_DATA__;
const _cache = {};
async function fetchJSON(url) {
    if (_cache[url]) return _cache[url];
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
    const j = await r.json();
    _cache[url] = j;
    return j;
}
export const api = {
    async getDraft(year)       { return D.draft[year] || []; },
    async getRosters(year)     { return D.rosters || []; },
    async getUsers(year)       { return D.users || []; },
    async getLeagueUsers()     {
        // Filter out co-managers (in league but never a roster owner)
        const rosterOwners = new Set((D.rosters || []).map(r => r.owner).filter(Boolean));
        return (D.league_users || []).filter(u => rosterOwners.has(u.username));
    },
    async getTransactions()    { return D.transactions || []; },
    async getStandings()       { return D.standings || []; },
    async getHeadToHead()      { return D.head_to_head || []; },
    async getPlayerStats(year) { return fetchJSON(`data/${year}/player_season_stats.json`); },
    async getMatchups(year)    { return fetchJSON(`data/${year}/matchups.json`); },
    async getSeasonHistory()   { return D.season_history || {}; },
    async getTradedPicks()     { return D.traded_picks || []; },
    async getDivisions()       { return D.divisions || {}; },
    async getPlayerNameMap()   { return D.player_name_map || {}; },
};
