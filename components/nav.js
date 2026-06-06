export function renderNav() {
    const el = document.getElementById("nav");
    if (!el) return;

    const page = location.pathname.split("/").pop() || "index.html";
    const teamsPages = ["teams.html", "assets.html"];
    const teamsActive = teamsPages.includes(page);

    el.innerHTML = `
        <nav class="card">
            <a href="index.html">Home</a>
            <a href="draft.html">Draft</a>
            <a href="standings.html">Standings</a>
            <div class="nav-dropdown${teamsActive ? " active" : ""}">
                <span class="nav-dropdown-label">Teams ▾</span>
                <div class="nav-dropdown-menu">
                    <a href="teams.html">Rosters</a>
                    <a href="assets.html">Picks</a>
                </div>
            </div>
            <a href="transactions.html">Transactions</a>
            <a href="head_to_head.html">H2H</a>
            <a href="season_history.html">History</a>
        </nav>
        <style>
            .nav-dropdown { position: relative; display: inline-block; }
            .nav-dropdown-label {
                cursor: pointer;
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                color: var(--text-3, #8b9099);
                white-space: nowrap;
                transition: color 0.15s, background 0.15s;
                user-select: none;
                font-family: inherit;
            }
            .nav-dropdown.active .nav-dropdown-label { color: var(--text-1, #f0f1f3); font-weight: 700; }
            .nav-dropdown:hover .nav-dropdown-label { color: var(--text-1, #f0f1f3); background: var(--card-el, #252830); }
            .nav-dropdown-menu {
                display: none;
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                background: #1e2027;
                border: 1px solid #2d3139;
                border-radius: 10px;
                padding: 6px;
                z-index: 1000;
                min-width: 120px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            }
            .nav-dropdown:hover .nav-dropdown-menu { display: flex; flex-direction: column; gap: 2px; }
            .nav-dropdown-menu a {
                padding: 7px 12px !important;
                border-radius: 6px !important;
                font-size: 13px !important;
                white-space: nowrap;
            }
            .nav-dropdown-menu a:hover { background: #252830; }
        </style>
    `;
}
