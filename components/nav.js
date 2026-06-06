export function renderNav() {
    const el = document.getElementById("nav");
    if (!el) return;

    const page = location.pathname.split("/").pop() || "index.html";
    const teamsActive = ["teams.html", "assets.html"].includes(page);
    const txActive = ["transactions.html", "trade_analyzer.html"].includes(page);

    function cur(p) { return page === p ? ' class="current"' : ""; }

    el.innerHTML = `
        <style>
            .nav-card {
                display: flex;
                align-items: center;
                padding: 6px 12px;
                position: relative;
                overflow: visible !important;
            }
            .nav-links {
                display: flex;
                align-items: center;
                gap: 2px;
                flex-wrap: nowrap;
            }
            .nav-links a, .nav-dropdown-label {
                padding: 7px 11px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                color: var(--text-3, #8b9099);
                white-space: nowrap;
                transition: color 0.15s, background 0.15s;
                text-decoration: none;
                display: inline-block;
                line-height: 1.4;
            }
            .nav-links a:hover, .nav-links a.current {
                color: var(--text-1, #f0f1f3);
                background: var(--card-el, #252830);
            }
            .nav-links a.current { font-weight: 700; }

            /* Dropdown (desktop) */
            .nav-dropdown { position: relative; display: inline-flex; align-items: center; }
            .nav-dropdown-label {
                cursor: pointer;
                user-select: none;
                font-family: inherit;
            }
            .nav-dropdown.active .nav-dropdown-label { color: var(--text-1, #f0f1f3); font-weight: 700; }
            .nav-dropdown-label:hover { color: var(--text-1, #f0f1f3); background: var(--card-el, #252830); }
            .nav-dropdown-menu {
                display: none;
                position: absolute;
                top: calc(100% + 4px);
                left: 0;
                z-index: 1000;
                min-width: 150px;
            }
            .nav-dropdown-menu-inner {
                background: #1e2027;
                border: 1px solid #2d3139;
                border-radius: 10px;
                padding: 6px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .nav-dropdown.open .nav-dropdown-menu { display: block; }
            .nav-dropdown-menu a {
                padding: 9px 14px !important;
                border-radius: 6px !important;
                font-size: 13px !important;
                white-space: nowrap;
                display: flex !important;
                align-items: center;
                min-height: 40px;
            }
            .nav-dropdown-menu a:hover { background: #252830; }

            /* Mobile: horizontal scrollable tab strip */
            @media (max-width: 680px) {
                .nav-card {
                    padding: 0;
                    overflow-x: auto !important;
                    overflow-y: visible;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                }
                .nav-card::-webkit-scrollbar { display: none; }
                .nav-links {
                    gap: 0;
                    padding: 4px 8px;
                    flex-wrap: nowrap;
                    min-width: max-content;
                }
                .nav-links a, .nav-dropdown-label {
                    font-size: 13px;
                    padding: 7px 10px;
                }
                /* Dropdowns on mobile: fixed below the nav bar (top set by JS) */
                .nav-dropdown-menu {
                    position: fixed;
                    left: 8px;
                    right: 8px;
                    top: 56px;
                    width: auto;
                    min-width: 0;
                    z-index: 2000;
                }
                .nav-dropdown-menu-inner {
                    padding: 8px;
                }
                .nav-dropdown-menu a {
                    font-size: 14px !important;
                    padding: 11px 14px !important;
                }
            }
        </style>
        <nav class="card nav-card" id="nav-card">
            <div class="nav-links" id="nav-links">
                <a href="index.html"${cur("index.html")}>Home</a>
                <a href="draft.html"${cur("draft.html")}>Draft</a>
                <a href="standings.html"${cur("standings.html")}>Standings</a>
                <div class="nav-dropdown${teamsActive ? " active" : ""}" data-dropdown="teams">
                    <span class="nav-dropdown-label">Teams ▾</span>
                    <div class="nav-dropdown-menu">
                        <div class="nav-dropdown-menu-inner">
                            <a href="teams.html">Rosters</a>
                            <a href="assets.html">Picks</a>
                        </div>
                    </div>
                </div>
                <div class="nav-dropdown${txActive ? " active" : ""}" data-dropdown="tx">
                    <span class="nav-dropdown-label">Transactions ▾</span>
                    <div class="nav-dropdown-menu">
                        <div class="nav-dropdown-menu-inner">
                            <a href="transactions.html">Transactions</a>
                            <a href="trade_analyzer.html">Trade Analyzer</a>
                        </div>
                    </div>
                </div>
                <a href="matchups.html"${cur("matchups.html")}>Matchups</a>
                <a href="head_to_head.html"${cur("head_to_head.html")}>H2H</a>
                <a href="season_history.html"${cur("season_history.html")}>History</a>
            </div>
        </nav>
    `;

    const navCard = el.querySelector("#nav-card");
    const dropdowns = el.querySelectorAll(".nav-dropdown");

    // Dropdown toggle (click)
    dropdowns.forEach(dd => {
        const label = dd.querySelector(".nav-dropdown-label");
        label.addEventListener("click", e => {
            e.stopPropagation();
            const isOpen = dd.classList.contains("open");
            dropdowns.forEach(d => d.classList.remove("open"));
            if (!isOpen) {
                dd.classList.add("open");
                if (window.innerWidth <= 680) {
                    const menu = dd.querySelector(".nav-dropdown-menu");
                    const bottom = navCard.getBoundingClientRect().bottom;
                    menu.style.top = bottom + "px";
                }
            }
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener("click", () => {
        dropdowns.forEach(d => d.classList.remove("open"));
    });
}
