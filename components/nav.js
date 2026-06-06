export function renderNav() {
    const el = document.getElementById("nav");
    if (!el) return;

    const page = location.pathname.split("/").pop() || "index.html";
    const teamsActive = ["teams.html", "assets.html"].includes(page);
    const matchupsActive = ["matchups.html", "matchup_recap.html"].includes(page);
    const txActive = ["transactions.html", "trade_analyzer.html"].includes(page);

    function cur(p) { return page === p ? ' class="current"' : ""; }

    el.innerHTML = `
        <style>
            .nav-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 12px;
                position: relative;
                overflow: visible !important;
            }
            /* Desktop links row */
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

            /* Hamburger button — hidden on desktop */
            .nav-hamburger {
                display: none;
                background: none;
                border: none;
                cursor: pointer;
                padding: 8px;
                color: var(--text-3, #8b9099);
                font-size: 22px;
                line-height: 1;
                border-radius: 8px;
            }
            .nav-hamburger:hover { background: #252830; color: #f0f1f3; }

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

            /* Mobile */
            @media (max-width: 680px) {
                .nav-card {
                    flex-direction: column;
                    align-items: stretch;
                    padding: 4px 8px;
                    gap: 0;
                }
                .nav-links { display: none; }
                .nav-hamburger {
                    display: block;
                    align-self: flex-start;
                }

                /* Open: nav-links become a stacked list inside the card (no absolute, no clipping) */
                .nav-card.mobile-open .nav-links {
                    display: flex;
                    flex-direction: column;
                    align-items: stretch;
                    gap: 2px;
                    padding: 6px 0 4px;
                    border-top: 1px solid #2d3139;
                    margin-top: 4px;
                }
                .nav-card.mobile-open .nav-links a,
                .nav-card.mobile-open .nav-dropdown-label {
                    font-size: 15px;
                    padding: 12px 14px;
                    border-radius: 8px;
                    display: block;
                    width: 100%;
                    box-sizing: border-box;
                }
                .nav-card.mobile-open .nav-dropdown {
                    display: block;
                    width: 100%;
                }
                /* Sub-items always visible inline on mobile */
                .nav-card.mobile-open .nav-dropdown-menu {
                    position: static;
                    display: block !important;
                    padding: 0;
                }
                .nav-card.mobile-open .nav-dropdown-menu-inner {
                    background: #252830;
                    border: none;
                    box-shadow: none;
                    border-radius: 8px;
                    padding: 4px 4px 4px 16px;
                    margin-top: 2px;
                }
                .nav-card.mobile-open .nav-dropdown-menu a {
                    font-size: 14px !important;
                    padding: 10px 12px !important;
                    min-height: 0;
                    color: var(--text-3, #8b9099);
                }
                .nav-card.mobile-open .nav-dropdown-menu a:hover,
                .nav-card.mobile-open .nav-dropdown-menu a:active { color: #f0f1f3; background: #1e2027; }
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
                <div class="nav-dropdown${matchupsActive ? " active" : ""}" data-dropdown="matchups">
                    <span class="nav-dropdown-label">Matchups ▾</span>
                    <div class="nav-dropdown-menu">
                        <div class="nav-dropdown-menu-inner">
                            <a href="matchups.html">Scores</a>
                            <a href="matchup_recap.html">Recap</a>
                        </div>
                    </div>
                </div>
                <a href="head_to_head.html"${cur("head_to_head.html")}>H2H</a>
                <a href="season_history.html"${cur("season_history.html")}>History</a>
            </div>
            <button class="nav-hamburger" id="nav-hamburger" aria-label="Menu">☰</button>
        </nav>
    `;

    const navCard = el.querySelector("#nav-card");
    const hamburger = el.querySelector("#nav-hamburger");
    const dropdowns = el.querySelectorAll(".nav-dropdown");

    // Hamburger toggle
    hamburger.addEventListener("click", e => {
        e.stopPropagation();
        navCard.classList.toggle("mobile-open");
        hamburger.textContent = navCard.classList.contains("mobile-open") ? "✕" : "☰";
    });

    // Desktop dropdown toggle (click-based, works on touch too)
    dropdowns.forEach(dd => {
        const label = dd.querySelector(".nav-dropdown-label");
        label.addEventListener("click", e => {
            // On mobile the menu is always visible inline — nothing to toggle
            if (window.innerWidth <= 680) return;
            e.stopPropagation();
            const isOpen = dd.classList.contains("open");
            dropdowns.forEach(d => d.classList.remove("open"));
            if (!isOpen) dd.classList.add("open");
        });
    });

    // Close desktop dropdowns and mobile menu when clicking outside
    document.addEventListener("click", () => {
        dropdowns.forEach(d => d.classList.remove("open"));
        navCard.classList.remove("mobile-open");
        hamburger.textContent = "☰";
    });
}
