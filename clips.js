import { renderNav } from "./components/nav.js";

renderNav();

const POS_COLORS = { QB:"#e74c82", RB:"#3ecf8e", WR:"#4299e1", TE:"#f6ad55", K:"#9f7aea", DEF:"#94a3b8" };

async function init() {
    const container = document.getElementById("clips-container");

    let clips;
    try {
        const res = await fetch("clips.json?v=" + Date.now());
        clips = await res.json();
    } catch(e) {
        container.innerHTML = `<p style="color:#e74c82;">Failed to load clips: ${e.message}</p>`;
        return;
    }

    if (!clips.length) {
        container.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:#5a6070;">
            <div style="font-size:32px;margin-bottom:16px;">🎬</div>
            <div style="font-size:16px;font-weight:700;color:#8b9099;margin-bottom:8px;">No clips yet</div>
            <div style="font-size:13px;line-height:1.7;">
                Add X video posts to <code style="background:#1e2027;padding:2px 6px;border-radius:4px;color:#a78bfa;">clips.json</code>.<br>
                Each entry: <code style="background:#1e2027;padding:2px 6px;border-radius:4px;color:#a78bfa;">{"url": "https://x.com/.../status/...", "player": "Name", "position": "WR", "label": "OTA Day 1"}</code>
            </div>
        </div>`;
        return;
    }

    // Unique players for filter
    const players = ["all", ...new Set(clips.map(c => c.player).filter(Boolean))].sort((a,b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b));
    let activePlayer = "all";

    function render() {
        const visible = activePlayer === "all" ? clips : clips.filter(c => c.player === activePlayer);

        // Rebuild the grid with blockquotes
        grid.innerHTML = visible.map((c, i) => {
            const pos = c.position || "";
            const posColor = POS_COLORS[pos] || "#5a6070";
            const tweetUrl = (c.url || "").replace("https://x.com/", "https://twitter.com/");
            return `
            <div class="clip-card">
                <div class="clip-header">
                    ${pos ? `<span class="clip-pos" style="background:${posColor}">${pos}</span>` : ""}
                    ${c.player ? `<span class="clip-player">${c.player}</span>` : ""}
                    ${c.label ? `<span class="clip-label">${c.label}</span>` : ""}
                </div>
                <blockquote class="twitter-tweet" data-theme="dark" data-dnt="true">
                    <a href="${tweetUrl}"></a>
                </blockquote>
            </div>`;
        }).join("");

        // Re-trigger Twitter widget rendering for new blockquotes
        if (window.twttr && window.twttr.widgets) {
            window.twttr.widgets.load(grid);
        }
    }

    container.innerHTML = `
    <style>
        .clips-filter { display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap; align-items:center; }
        .clip-filter-btn {
            background: var(--card-bg);
            border: 1.5px solid var(--border);
            border-radius: 999px;
            padding: 6px 14px;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-3);
            cursor: pointer;
            font-family: inherit;
            transition: border-color .15s, color .15s, background .15s;
            white-space: nowrap;
        }
        .clip-filter-btn:hover { color: var(--text-1); border-color: var(--text-4); }
        .clip-filter-btn.active { color: var(--text-1); border-color: var(--accent); background: var(--card-el); }

        .clips-grid {
            columns: 3;
            column-gap: 16px;
        }
        .clip-card {
            break-inside: avoid;
            margin-bottom: 20px;
        }
        .clip-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }
        .clip-pos {
            font-size: 10px;
            font-weight: 800;
            color: #fff;
            border-radius: 4px;
            padding: 2px 7px;
            letter-spacing: .03em;
        }
        .clip-player {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-1);
        }
        .clip-label {
            font-size: 11px;
            color: var(--text-3);
            background: var(--card-el);
            border-radius: 4px;
            padding: 2px 7px;
        }
        /* Twitter embed overrides for dark bg */
        .twitter-tweet { margin: 0 !important; }

        @media (max-width: 900px) { .clips-grid { columns: 2; } }
        @media (max-width: 500px) { .clips-grid { columns: 1; } }
    </style>

    <div class="clips-filter" id="clips-filter"></div>
    <div class="clips-grid" id="clips-grid"></div>`;

    const filterBar = document.getElementById("clips-filter");
    const grid      = document.getElementById("clips-grid");

    // Build filter buttons
    filterBar.innerHTML = players.map(p => `
        <button class="clip-filter-btn${p === "all" ? " active" : ""}" data-player="${p}">
            ${p === "all" ? "All Players" : p}
        </button>`).join("");

    filterBar.addEventListener("click", e => {
        const btn = e.target.closest(".clip-filter-btn");
        if (!btn) return;
        activePlayer = btn.dataset.player;
        filterBar.querySelectorAll(".clip-filter-btn").forEach(b =>
            b.classList.toggle("active", b.dataset.player === activePlayer));
        render();
    });

    render();
}

init();
