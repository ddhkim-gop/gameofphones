const D = window.__STATIC_DATA__;
export const api = {
    async getDraft(year)       { return D.draft[year] || []; },
    async getRosters(year)     { return D.rosters || []; },
    async getUsers(year)       { return D.users || []; },
    async getLeagueUsers()     { return D.league_users || []; },
    async getTransactions()    { return D.transactions || []; },
    async getStandings()       { return D.standings || []; },
    async getHeadToHead()      { return D.head_to_head || []; },
    async getPlayerStats(year) { return {}; },
    async getSeasonHistory()   { return D.season_history || {}; },
    async getTradedPicks()     { return D.traded_picks || []; },
    async getDivisions()       { return D.divisions || {}; },
};
