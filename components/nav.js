export function renderNav() {
    const el = document.getElementById("nav");
    if (!el) return;
    el.innerHTML = `<nav class="card"><a href="index.html">Home</a><a href="draft.html">Draft</a><a href="standings.html">Standings</a><a href="teams.html">Teams</a><a href="assets.html">Assets</a><a href="transactions.html">Transactions</a><a href="head_to_head.html">H2H</a><a href="season_history.html">History</a></nav>`;
}
