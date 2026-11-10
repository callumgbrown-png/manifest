// Client code for the ports feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, ctx, P, view). Everything here only draws what the server sent; no game state is changed.
(() => {
  const data = id => world?.featureData?.[id];
  const mine = id => me?.featureData?.[id];
  const portById = id => world?.ports?.find(p => p.id === id);
  const BANNER = ["#c0392b", "#2c6fbb", "#2e8b57", "#d4a017", "#e67e22"];

  ManifestHooks.on("draw", () => {
    if (!world?.ports || typeof ctx === "undefined" || typeof P !== "function") return;
    ctx.save();
    // 50 lighthouses: soft rings showing how far a lit lamp lets you see (wider with a lookout or Signal lamps).
    const proj = data("ports.projects");
    if (proj?.lit?.length) {
      const range = (mine("ports.projects")?.sightRange ?? 1) * proj.sightRadius * view.scale;
      ctx.strokeStyle = "rgba(255, 214, 102, 0.45)"; ctx.fillStyle = "rgba(255, 214, 102, 0.06)"; ctx.lineWidth = 1;
      for (const id of proj.lit) {
        const p = portById(id); if (!p) continue;
        const [x, y] = P(p);
        ctx.beginPath(); ctx.arc(x, y, range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // 280 skylines: little towers beside each port, one per prosperity level.
    const sky = data("ports.skyline")?.levels;
    if (sky) {
      ctx.fillStyle = "rgba(70, 80, 100, 0.55)";
      for (const p of world.ports) {
        const lvl = sky[p.id] ?? 0; if (!lvl) continue;
        const [x, y] = P(p);
        for (let i = 0; i < lvl; i++) { const h = 4 + ((i * 7 + p.id) % 5) * 2; ctx.fillRect(x + 9 + i * 4, y - h, 3, h); }
      }
    }
    // 262 stalls: a small coloured pennant per stall.
    for (const s of data("ports.stalls")?.stalls ?? []) {
      const p = portById(s.port); if (!p) continue;
      const [x, y] = P(p);
      ctx.fillStyle = BANNER[s.banner % BANNER.length];
      ctx.beginPath(); ctx.moveTo(x - 10, y - 12); ctx.lineTo(x - 4, y - 10); ctx.lineTo(x - 10, y - 8); ctx.fill();
    }
    // 53 festivals and 54 strikes: a star for a festival, a red bar for a strike.
    ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    for (const f of data("ports.festivals")?.today ?? []) {
      const p = portById(f.port); if (!p) continue;
      const [x, y] = P(p); ctx.fillStyle = "#e6a700"; ctx.fillText("★", x, y - 14);
    }
    for (const s of data("ports.strikes")?.strikes ?? []) {
      const p = portById(s.port); if (!p) continue;
      const [x, y] = P(p); ctx.fillStyle = "#c0392b"; ctx.fillRect(x - 6, y + 9, 12, 3);
    }
    // 276 the cruise liner's port of call.
    const liner = data("ports.cruise")?.liner;
    if (liner !== undefined && liner !== null) { const p = portById(liner); if (p) { const [x, y] = P(p); ctx.fillStyle = "#ffffff"; ctx.fillText("⛴", x + 14, y + 4); } }
    ctx.restore();
  });

  // 272/273 harbour games: show today's puzzle as a picture under the Opportunities card text.
  ManifestHooks.on("render", () => {
    const g = mine("ports.minigames");
    if (!g) return;
    const card = [...document.querySelectorAll("h3, h4, .cardTitle")].find(h => /Cargo yard stacking/.test(h.textContent || ""));
    if (!card || card.parentElement?.querySelector(".portsStackHint")) return;
    const hint = document.createElement("div");
    hint.className = "portsStackHint";
    hint.style.cssText = "display:flex;gap:3px;align-items:flex-end;margin:4px 0";
    for (const w of g.today.boxes) {
      const b = document.createElement("span");
      b.textContent = w; b.title = `${w} t`;
      b.style.cssText = `display:inline-block;width:18px;height:${8 + w * 3}px;background:#8aa;color:#fff;font-size:10px;text-align:center;border-radius:2px`;
      hint.appendChild(b);
    }
    card.after(hint);
  });
})();
