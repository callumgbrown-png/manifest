// Client code for the economy feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, canvas). It only shows what the server sent:
//   idea 10  economy.price-ticker: a scrolling commodity-index strip under the map, with any market news
//            (rumours, crashes, embargoes, harvest phase) from switched-on economy modules.
//   idea 2   economy.price-history: small price charts for the ports in me.featureData["economy.price-history"].
(() => {
  const data = id => (typeof world === "undefined" ? null : world?.featureData?.[id]);
  const mine = id => (typeof me === "undefined" ? null : me?.featureData?.[id]);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const GOODS = ["grain", "fuel", "ore", "machinery"];
  const COLORS = ["#b8860b", "#c0392b", "#7f8c8d", "#2c7fb8"];
  const portName = id => world?.ports?.find(p => p.id === Number(id))?.name ?? `port ${id}`;

  function tickerHtml() {
    const t = data("economy.price-ticker");
    if (!t) return "";
    const items = t.items.map(i => `${esc(i.good)} ${i.index.toFixed(1)} <span style="color:${i.change >= 0 ? "#1a7f37" : "#b42318"}">${i.change >= 0 ? "▲" : "▼"}${Math.abs(i.change).toFixed(1)}%</span>`);
    const news = [t.headline];
    const crash = data("economy.crashes"); if (crash?.text) news.push(crash.text);
    const emb = data("economy.embargoes"); if (emb?.text) news.push(emb.text);
    for (const r of data("economy.rumours")?.rumours?.slice(-2) ?? []) news.push(r.text);
    const harvest = data("economy.harvests"); if (harvest) news.push(`Grain: ${harvest.phase}`);
    const caps = data("economy.price-caps"); if (caps?.emergency?.length) news.push(`Emergency caps on ${caps.emergency.join(", ")}`);
    return `<strong>Index</strong> ${items.join(" · ")} <span style="opacity:.75">| ${esc(news.join("  •  "))}</span>`;
  }

  function sparkline(series, color, w = 120, h = 28) {
    const vals = series.filter(v => Number.isFinite(v));
    if (vals.length < 2) return "";
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 1 - (v - lo) / span * (h - 2)).toFixed(1)}`).join(" ");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="price trend"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  function historyHtml() {
    const h = mine("economy.price-history");
    if (!h?.ports) return "";
    const rows = Object.entries(h.ports).slice(0, 4).map(([port, goods]) =>
      `<div style="margin:4px 0"><div style="font-weight:600">${esc(portName(port))}</div>${goods.map((series, g) =>
        `<div style="display:flex;align-items:center;gap:6px"><span style="width:70px">${GOODS[g]}</span>${sparkline(series, COLORS[g])}<span>${series[series.length - 1].toFixed(1)}</span></div>`).join("")}</div>`);
    return `<details id="economyHistory" ${historyOpen ? "open" : ""}><summary>Price history (last ${Math.max(0, (Object.values(h.ports)[0]?.[0]?.length ?? 1) - 1)} days)</summary>${rows.join("")}</details>`;
  }
  let historyOpen = false;
  document.addEventListener("toggle", ev => { if (ev.target?.id === "economyHistory") historyOpen = ev.target.open; }, true);

  ManifestHooks.on("render", () => {
    const host = typeof canvas !== "undefined" ? canvas?.parentElement : null;
    if (!host) return;
    let bar = document.getElementById("economyStrip");
    const html = `${tickerHtml()}${historyHtml()}`;
    if (!html) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "economyStrip";
      bar.setAttribute("aria-live", "polite");
      bar.style.cssText = "font-size:12px;padding:3px 6px;background:rgba(255,255,255,0.85);overflow-x:auto";
      host.appendChild(bar);
    }
    if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
  });
})();
