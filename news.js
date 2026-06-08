import { renderNav } from "./components/nav.js";

renderNav();

const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#94a3b8" };

async function init() {
    const container = document.getElementById("news-container");

    let data;
    try {
        const res = await fetch("news.json?v=" + Date.now());
        data = await res.json();
    } catch(e) {
        container.innerHTML = `<p style="color:#e74c82;">Failed to load news: ${e.message}</p>`;
        return;
    }

    const articles = data.articles || [];
    const players  = [...new Set(articles.map(a => a.player))].sort();

    // ── State ──────────────────────────────────────────────────────────────
    let filterPlayer = "all";
    let filterSearch = "";

    // ── Render ─────────────────────────────────────────────────────────────
    function filtered() {
        return articles.filter(a => {
            if (filterPlayer !== "all" && a.player !== filterPlayer) return false;
            if (filterSearch) {
                const q = filterSearch.toLowerCase();
                if (!a.title.toLowerCase().includes(q) &&
                    !a.player.toLowerCase().includes(q) &&
                    !a.source.toLowerCase().includes(q)) return false;
            }
            return true;
        });
    }

    function render() {
        const list = filtered();

        const cards = list.length === 0
            ? `<div style="color:#5a6070;padding:40px 0;text-align:center;font-size:14px;">No articles found.</div>`
            : list.map(a => {
                const posColor = POS_COLORS[a.position] || "#5a6070";
                return `
                <a href="${a.link}" target="_blank" rel="noopener" class="news-card">
                    <div class="news-card-meta">
                        <span class="news-pos-badge" style="background:${posColor}">${a.position}</span>
                        <span class="news-player">${a.player}</span>
                        ${a.team ? `<span class="news-team">${a.team}</span>` : ''}
                        <span class="news-dot">·</span>
                        <span class="news-source">${a.source}</span>
                        <span class="news-dot">·</span>
                        <span class="news-date">${a.date}</span>
                    </div>
                    <div class="news-title">${a.title}</div>
                </a>`;
            }).join("");

        document.getElementById("news-list").innerHTML = cards;
        document.getElementById("news-count").textContent =
            `${list.length} article${list.length !== 1 ? "s" : ""}`;
    }

    // ── Shell ───────────────────────────────────────────────────────────────
    container.innerHTML = `
    <style>
        .news-filter-bar {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }
        #news-search {
            font-family: inherit;
            font-size: 13px;
            font-weight: 500;
            padding: 7px 14px;
            border-radius: 999px;
            border: 1.5px solid var(--border);
            background: var(--card-bg);
            color: var(--text-1);
            outline: none;
            flex: 1;
            min-width: 160px;
            max-width: 280px;
            transition: border-color 0.15s;
        }
        #news-search:focus { border-color: var(--accent); }
        #news-search::placeholder { color: var(--text-4); }

        .news-card {
            display: block;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 8px;
            text-decoration: none;
            transition: border-color 0.15s, background 0.15s;
        }
        .news-card:hover {
            border-color: var(--accent);
            background: #252830;
        }
        .news-card-meta {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        }
        .news-pos-badge {
            font-size: 10px;
            font-weight: 800;
            color: #fff;
            border-radius: 4px;
            padding: 2px 6px;
            letter-spacing: 0.03em;
            flex-shrink: 0;
        }
        .news-player {
            font-size: 12px;
            font-weight: 700;
            color: var(--text-1);
        }
        .news-team {
            font-size: 11px;
            color: var(--text-4);
            background: var(--card-el);
            border-radius: 4px;
            padding: 1px 6px;
        }
        .news-dot { color: var(--text-4); font-size: 11px; }
        .news-source {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-3);
        }
        .news-date {
            font-size: 11px;
            color: var(--text-4);
            margin-left: auto;
        }
        .news-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-2);
            line-height: 1.5;
        }
        .news-card:hover .news-title { color: var(--text-1); }

        .news-fetched {
            font-size: 11px;
            color: var(--text-4);
            margin-left: auto;
        }

        @media (max-width: 600px) {
            .news-date { margin-left: 0; }
            #news-search { max-width: 100%; }
        }
    </style>

    <div class="news-filter-bar">
        <select id="news-player-filter">
            <option value="all">All Players</option>
            ${players.map(p => `<option value="${p}">${p}</option>`).join("")}
        </select>
        <input type="text" id="news-search" placeholder="Search headlines…">
        <span id="news-count" style="font-size:12px;color:var(--text-4);flex-shrink:0;"></span>
        <span class="news-fetched">Updated ${data.fetched}</span>
    </div>

    <div id="news-list"></div>`;

    // Events
    document.getElementById("news-player-filter").addEventListener("change", e => {
        filterPlayer = e.target.value;
        render();
    });
    document.getElementById("news-search").addEventListener("input", e => {
        filterSearch = e.target.value.trim();
        render();
    });

    render();
}

init();
