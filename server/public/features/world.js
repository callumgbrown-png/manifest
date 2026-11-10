// Client code for the world feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, ctx, canvas, P, toMap, view, command, toast, voyageGeometry, ManifestNavigation).
// Everything here only draws what the server sent, plus purely local tools (layer toggles, ruler, route codes).
(() => {
  const data = id => world?.featureData?.[id];
  const mine = id => me?.featureData?.[id];
  const K = () => data("world.map-tools")?.scale ?? (typeof WORLD_K === "number" ? WORLD_K : 1);
  const portById = id => world?.ports?.find(p => p.id === id);
  const LAYERS = { weather: "Weather", hazards: "Hazards", legends: "Legends and wrecks", events: "Events", players: "Buoys and beacons", fog: "Fog of war", labels: "Region names", night: "Day and night" };
  let layers = Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]));
  try { layers = { ...layers, ...JSON.parse(localStorage.getItem("manifest.world.layers") || "{}") }; } catch { /* storage unavailable */ }
  const saveLayers = () => { try { localStorage.setItem("manifest.world.layers", JSON.stringify(layers)); } catch { /* ignore */ } };
  let ruler = [];          // up to two map points (alt-click)
  let safeRoute = null;    // points of a hazard-avoiding route between two ports

  const circle = (p, r, fill, stroke) => {
    const [x, y] = P(p);
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, r * K() * view.scale), 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  };
  const glyph = (p, text, color, dy = 0, size = 13) => { const [x, y] = P(p); ctx.font = `${size}px sans-serif`; ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(text, x, y + dy); };

  // 255: shortest route on the lane graph that avoids lanes under a storm or hurricane.
  function hazardFreeRoute(from, to) {
    const storms = (data("world.weather")?.weather ?? []).filter(w => w.kind !== "fog");
    const blocked = r => storms.some(w => {
      const g = voyageGeometry(r.a, r.b);
      return g.points.some(p => Math.hypot(p.x - w.x, p.y - w.y) <= w.r * K());
    });
    const n = world.ports.length, d = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
    const edges = world.routes.filter(r => !blocked(r));
    d[from] = 0;
    for (;;) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0 || u === to) break;
      done[u] = true;
      for (const r of edges) { const v = r.a === u ? r.b : r.b === u ? r.a : -1; if (v >= 0 && d[u] + r.distance < d[v]) { d[v] = d[u] + r.distance; prev[v] = u; } }
    }
    if (d[to] === Infinity) return null;
    const ids = [to]; while (ids[0] !== from) ids.unshift(prev[ids[0]]);
    const pts = [];
    for (let i = 1; i < ids.length; i++) { const g = voyageGeometry(ids[i - 1], ids[i]).points; pts.push(...(pts.length ? g.slice(1) : g)); }
    return pts;
  }
  const nearestPort = p => world.ports.reduce((best, q) => Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? q : best, world.ports[0]);

  ManifestHooks.on("draw", () => {
    if (!world?.ports || typeof ctx === "undefined" || typeof P !== "function") return;
    ctx.save();
    ctx.lineWidth = 1;
    const wx = data("world.weather"), chart = data("world.chart");
    // 257 region names, 247 straits
    if (layers.labels && chart) {
      ctx.font = "italic 13px serif"; ctx.textAlign = "center"; ctx.fillStyle = "rgba(30, 50, 80, 0.35)";
      for (const r of chart.regions) { const [x, y] = P(r); ctx.fillText(r.name, x, y); }
      for (const s of chart.straits) circle(s, 10, null, "rgba(200, 120, 40, 0.6)");
    }
    // 98 currents: an arrow along the lane midpoint
    if (layers.hazards) for (const c of data("world.currents")?.currents ?? []) {
      try {
        const g = voyageGeometry(c.a, c.b), m = ManifestNavigation.position(g, 0.5), [x, y] = P(m);
        ctx.save(); ctx.translate(x, y); ctx.rotate(m.angle); ctx.strokeStyle = "rgba(40, 110, 200, 0.6)";
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(4, -3); ctx.moveTo(8, 0); ctx.lineTo(4, 3); ctx.stroke(); ctx.restore();
      } catch { /* lane not known yet */ }
    }
    // 96/97/101/103 weather systems and whirlpools
    if (layers.weather && wx) {
      for (const w of wx.weather) {
        const forecast = w.starts > world.tick;
        const fill = w.kind === "fog" ? "rgba(220, 225, 230, 0.45)" : w.kind === "hurricane" ? "rgba(120, 40, 120, 0.22)" : "rgba(60, 70, 90, 0.22)";
        ctx.setLineDash(forecast ? [4, 4] : []);
        circle(w, w.r, forecast ? null : fill, w.kind === "fog" ? "rgba(200,200,210,0.7)" : "rgba(60,60,80,0.6)");
        ctx.setLineDash([]);
        if (w.kind !== "fog") glyph(w, w.kind === "hurricane" ? "🌀" : "⛈", "#333", 4);
      }
      for (const p of wx.whirlpools) { circle(p, p.r, "rgba(30, 90, 140, 0.15)", "rgba(30, 90, 140, 0.5)"); circle(p, p.r / 2, null, "rgba(30, 90, 140, 0.5)"); }
    }
    // 100 icebergs, 246 reefs, 245 highways (economy modules: drawn only when switched on)
    if (layers.hazards) {
      const ice = data("world.icebergs"); if (ice?.active) for (const b of ice.bergs) glyph(b, "▲", "rgba(200, 230, 255, 0.95)", 4, 11);
      for (const r of data("world.reefs")?.reefs ?? []) circle(r, r.r, "rgba(220, 120, 80, 0.15)", "rgba(220, 120, 80, 0.6)");
      const k = data("world.kraken"); if (k && k.hp > 0) glyph(k, "🦑", "#7b2d8b", 6, 20);
    }
    // 104/336 legends, 105/106/107 exploration, 108/327/332 disasters
    if (layers.legends) {
      for (const s of data("world.sightings")?.sightings ?? []) glyph(s, "🐉", "rgba(30, 120, 70, 0.6)", 4, 12);
      for (const g of data("world.sightings")?.ghosts ?? []) glyph(g, "👻", "rgba(200, 220, 255, 0.85)", 4, 14);
      const ex = data("world.exploration");
      for (const w of ex?.wrecks ?? []) glyph(w, "⚓", "rgba(90, 70, 50, 0.8)", 4, 12);
      for (const i of ex?.islands ?? []) { circle(i, 9, "rgba(170, 150, 100, 0.9)", "rgba(110, 90, 60, 0.9)"); glyph(i, i.name, "#4a3b22", -12, 10); }
      for (const m of mine("world.exploration")?.maps ?? []) glyph(m, "✕", "#c0392b", 5, 16);
      const ds = data("world.disasters");
      if (ds?.volcano) {
        const v = ds.volcano, [x, y] = P(v);
        ctx.strokeStyle = "rgba(200, 60, 20, 0.6)";
        for (let i = 0; i < Math.min(6, v.eruptions); i++) { ctx.beginPath(); ctx.arc(x, y, 14 + i * 3, 0, Math.PI * 2); ctx.stroke(); }
        if (v.erupting) glyph(v, "🌋", "#c0392b", -14, 16);
      }
      if (ds?.island) { circle(ds.island, 10, "rgba(80, 70, 60, 0.9)", "rgba(200, 80, 20, 0.8)"); glyph(ds.island, ds.island.name, "#3b2b1b", -14, 10); }
      if (ds?.tsunami && chart) { const r = chart.regions[ds.tsunami.region]; if (r) glyph(r, "🌊 tsunami", "rgba(20, 80, 160, 0.8)", 18, 13); }
    }
    // 321 regatta, 322/329 festivals, 325 quarantine, 328 rescue, 330/337 orders, 326/331 conflicts
    if (layers.events) {
      const race = data("world.regatta")?.race;
      if (race) {
        try { ctx.strokeStyle = "rgba(230, 160, 0, 0.8)"; ctx.setLineDash([6, 4]); ManifestNavigation.stroke(ctx, voyageGeometry(race.from, race.to).points, P); ctx.setLineDash([]); } catch { /* ignore */ }
        const a = portById(race.from), b = portById(race.to); if (a) glyph(a, "🏁", "#000", -16); if (b) glyph(b, "🏆", "#000", -16);
      }
      const fest = data("world.festivals");
      for (const id of fest?.harvest?.ports ?? []) { const p = portById(id); if (p) glyph(p, "🌾", "#a67c00", -16); }
      if (fest?.fair) { const p = portById(fest.fair.port); if (p) glyph(p, "🎪", "#000", -16); }
      const q = data("world.quarantine")?.port; if (q) { const p = portById(q.port); if (p) { const [x, y] = P(p); ctx.fillStyle = "#f1c40f"; ctx.fillRect(x + 8, y - 20, 8, 6); } }
      for (const s of data("world.rescue")?.stricken ?? []) glyph(s, "🆘", "#c0392b", 4, 13);
      const wed = data("world.mega-orders")?.wedding; if (wed) { const p = portById(wed.port); if (p) glyph(p, "💍", "#000", -16); }
    }
    // 248 buoys, 251 distress beacons, 244 beacons, 241 waypoints
    if (layers.players) {
      for (const b of data("world.buoys")?.buoys ?? []) { glyph(b, "◉", "#e74c3c", 4, 12); glyph(b, b.label, "rgba(60,30,30,0.8)", -8, 9); }
      for (const b of data("world.rescue")?.beacons ?? []) { const on = Math.floor(Date.now() / 400) % 2; if (on) circle(b, 14, null, "rgba(255, 50, 50, 0.9)"); }
      for (const b of data("world.beacons")?.beacons ?? []) { const p = portById(b.port); if (p) glyph(p, "✦", "#f5c542", -14, 14); }
    }
    const wp = mine("world.waypoints")?.points ?? [];
    if (wp.length) {
      ctx.strokeStyle = "rgba(20, 20, 20, 0.6)"; ctx.setLineDash([3, 5]);
      ManifestNavigation.stroke(ctx, wp, P); ctx.setLineDash([]);
      wp.forEach((p, i) => glyph(p, String(i + 1), "#111", 4, 11));
    }
    // 242 fog of war: shade unvisited cells
    const fog = mine("world.fog-of-war");
    if (layers.fog && fog && typeof MAP_W === "number") {
      const cw = MAP_W / fog.cols, ch = MAP_H / fog.rows;
      ctx.fillStyle = "rgba(25, 30, 40, 0.35)";
      fog.seen.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === "0") { const [sx, sy] = P({ x: x * cw, y: y * ch }); ctx.fillRect(sx, sy, cw * view.scale + 1, ch * view.scale + 1); } });
    }
    // 102 day and night, 334 eclipse
    if (layers.night && wx) {
      const h = wx.hour, dark = wx.eclipse?.active ? 0.45 : h >= 21 || h < 5 ? 0.28 : h === 20 || h === 5 ? 0.14 : 0;
      if (dark) { ctx.fillStyle = `rgba(10, 15, 45, ${dark})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    }
    // 253 ruler and 255 safe route
    if (ruler.length) {
      ctx.strokeStyle = "#d35400"; ctx.lineWidth = 2;
      ManifestNavigation.stroke(ctx, ruler, P);
      if (ruler.length === 2) {
        const d = Math.hypot(ruler[1].x - ruler[0].x, ruler[1].y - ruler[0].y) / K(), [x, y] = P({ x: (ruler[0].x + ruler[1].x) / 2, y: (ruler[0].y + ruler[1].y) / 2 });
        ctx.font = "12px sans-serif"; ctx.fillStyle = "#d35400"; ctx.fillText(`${Math.round(d)} miles`, x, y - 6);
      }
    }
    if (safeRoute) { ctx.strokeStyle = "rgba(39, 174, 96, 0.85)"; ctx.lineWidth = 3; ManifestNavigation.stroke(ctx, safeRoute, P); }
    ctx.restore();
  });

  // Shift-click: add a waypoint (241). Alt-click: ruler points (253); a ruler between two ports also plots a storm-free route (255).
  canvas?.addEventListener("click", ev => {
    if (!world || typeof toMap !== "function") return;
    const rect = canvas.getBoundingClientRect(), p = toMap(ev.clientX - rect.left, ev.clientY - rect.top);
    if (ev.shiftKey && ManifestHooks.enabled("world.waypoints")) {
      const pts = [...(mine("world.waypoints")?.points ?? []), { x: Math.round(p.x), y: Math.round(p.y) }].slice(-8);
      command({ type: "feature", module: "world.waypoints", action: "set", points: pts });
    } else if (ev.altKey && ManifestHooks.enabled("world.map-tools")) {
      ruler = ruler.length >= 2 ? [p] : [...ruler, p];
      safeRoute = null;
      if (ruler.length === 2) {
        const a = nearestPort(ruler[0]), b = nearestPort(ruler[1]);
        if (a.id !== b.id) { safeRoute = hazardFreeRoute(a.id, b.id); if (!safeRoute) toast("No storm-free route right now."); }
      }
    }
  });

  // 110 ticker, 252 layer toggles, 256 route codes: a small strip under the map.
  ManifestHooks.on("render", () => {
    const host = canvas?.parentElement;
    if (!host) return;
    let bar = document.getElementById("worldStrip");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "worldStrip";
      bar.style.cssText = "font-size:12px;padding:3px 6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:rgba(255,255,255,0.85)";
      host.appendChild(bar);
    }
    const news = data("world.news")?.headlines ?? [];
    const toggles = ManifestHooks.enabled("world.map-tools") ? Object.entries(LAYERS).map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" ${layers[k] ? "checked" : ""}> ${esc(label)}</label>`).join(" ") : "";
    const codes = ManifestHooks.enabled("world.map-tools") && ManifestHooks.enabled("world.waypoints") ? `<button type="button" data-world="copy">Copy route code</button><button type="button" data-world="paste">Load route code</button>` : "";
    const html = `${news.length ? `<span aria-live="polite" style="flex:1 1 100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📰 ${esc(news.map(h => h.text).join("  •  "))}</span>` : ""}${toggles}${codes}`;
    if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
  });
  document.addEventListener("change", ev => {
    const k = ev.target?.dataset?.layer;
    if (k && k in layers) { layers[k] = ev.target.checked; saveLayers(); }
  });
  document.addEventListener("click", async ev => {
    const act = ev.target?.dataset?.world;
    if (!act) return;
    if (act === "copy") {
      const pts = mine("world.waypoints")?.points ?? [];
      const code = "MFR1-" + btoa(JSON.stringify(pts.map(p => [Math.round(p.x), Math.round(p.y)])));
      try { await navigator.clipboard.writeText(code); toast("Route code copied."); } catch { prompt("Route code:", code); }
    } else if (act === "paste") {
      const code = prompt("Paste a route code:") || "";
      try {
        if (!code.startsWith("MFR1-")) throw new Error("bad prefix");
        const pts = JSON.parse(atob(code.slice(5))).slice(0, 8).map(([x, y]) => ({ x: Number(x), y: Number(y) }));
        command({ type: "feature", module: "world.waypoints", action: "set", points: pts });
      } catch { toast("That is not a route code.", true); }
    }
  });
})();
