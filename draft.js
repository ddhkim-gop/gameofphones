import { api } from "./dataService.js";
import { renderNav } from "./components/nav.js";

function el(id) { return document.getElementById(id); }
function safeName(v) { return (v === null || v === undefined || v === "") ? "Unknown" : v; }

function groupByRound(picks) {
    const grouped = {};
    picks.forEach(p => {
        const r = p.round || 0;
        if (!grouped[r]) grouped[r] = [];
        grouped[r].push(p);
    });
    return grouped;
}

function renderPositions(picks) {
    const stats = { QB: 0, RB: 0, WR: 0, TE: 0, OTHER: 0 };
    picks.forEach(p => {
        const pos = (p.position || "OTHER").toUpperCase();
        if (stats[pos] !== undefined) stats[pos]++;
        else stats.OTHER++;
    });
    const total = picks.length || 0;
    el("position-stats").innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;">
            <div class="card" style="padding:6px 12px;"><h4 style="margin:0;font-size:11px;">QB</h4><p style="margin:0;font-size:15px;font-weight:700;">${stats.QB}</p></div>
            <div class="card" style="padding:6px 12px;"><h4 style="margin:0;font-size:11px;">RB</h4><p style="margin:0;font-size:15px;font-weight:700;">${stats.RB}</p></div>
            <div class="card" style="padding:6px 12px;"><h4 style="margin:0;font-size:11px;">WR</h4><p style="margin:0;font-size:15px;font-weight:700;">${stats.WR}</p></div>
            <div class="card" style="padding:6px 12px;"><h4 style="margin:0;font-size:11px;">TE</h4><p style="margin:0;font-size:15px;font-weight:700;">${stats.TE}</p></div>
            <div class="card" style="padding:6px 12px;"><h4 style="margin:0;font-size:11px;">Total</h4><p style="margin:0;font-size:15px;font-weight:700;">${total}</p></div>
        </div>
    `;
}

function renderDraft(picks) {
    const container = el("draft-container");
    if (!picks || !picks.length) {
        container.innerHTML = `<div class="card">No draft data found for this year.</div>`;
        return;
    }
    const grouped = groupByRound(picks);
    let html = `<div class="draft-board">`;
    Object.keys(grouped)
        .sort((a, b) => Number(a) - Number(b))
        .forEach(round => {
            html += `<div class="draft-round"><h3>Round ${round}</h3>`;
            grouped[round]
                .sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0))
                .forEach(p => {
                    html += `
                        <div class="pick-card">
                            <div class="pick-number">#${p.pick_no || "?"}</div>
                            <div class="player-name">${safeName(p.player)}</div>
                            <div class="meta">${safeName(p.position)}${p.team ? " • " + p.team : ""}</div>
                            <div class="owner"><span class="label">Picked by:</span> ${safeName(p.picked_by)}</div>
                            <div class="owner"><span class="label">Original owner:</span> ${safeName(p.original_owner)}</div>
                        </div>
                    `;
                });
            html += `</div>`;
        });
    html += `</div>`;
    container.innerHTML = html;
}

async function load(year) {
    el("draft-container").innerHTML = `<div class="card">Loading ${year} draft...</div>`;
    el("position-stats").innerHTML = "";
    try {
        const picks = await api.getDraft(year);
        renderPositions(picks);
        renderDraft(picks);
    } catch (err) {
        console.error("Draft load error:", err);
        el("draft-container").innerHTML = `<div class="card">Failed to load draft data for ${year}.</div>`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    renderNav();
    const select = el("yearSelect");
    load(select.value);
    select.addEventListener("change", () => load(select.value));
});
