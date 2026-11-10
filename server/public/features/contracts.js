// Client code for the contracts feature modules (contracts, pirates and police, NPCs). Uses ManifestHooks
// (features/api.js) and app.js globals (world, me, ctx, P, view). It only draws what the server sent.
(() => {
  const data = id => world?.featureData?.[id];
  const portById = id => world?.ports?.find(p => p.id === id);
  const glyph = (pt, text, color, dx = 0, dy = 0, size = 12) => {
    const [x, y] = P(pt);
    ctx.font = `${size}px sans-serif`; ctx.textAlign = "center"; ctx.fillStyle = color;
    ctx.fillText(text, x + dx, y + dy);
  };
  const atPort = (id, text, color, dx, dy) => { const p = portById(id); if (p) glyph(p, text, color, dx, dy); };

  ManifestHooks.on("draw", () => {
    if (!world?.ports || typeof ctx === "undefined" || typeof P !== "function") return;
    ctx.save();
    // 76 pirate zones: red dashed circles (tomorrow's faintly).
    const zones = data("contracts.pirate-zones");
    if (zones) {
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
      for (const [list, alpha] of [[zones.tomorrow, 0.18], [zones.zones, 0.6]]) {
        ctx.strokeStyle = `rgba(192, 57, 43, ${alpha})`; ctx.fillStyle = `rgba(192, 57, 43, ${alpha / 6})`;
        for (const z of list ?? []) { const [x, y] = P(z); ctx.beginPath(); ctx.arc(x, y, z.r * view.scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      }
      ctx.setLineDash([]);
    }
    // 89 hideouts (skull), 92 coast-guard stations (cross), 95 blockade (anchor ring).
    for (const id of data("contracts.hideouts")?.ports ?? []) atPort(id, "☠", "#222", 0, -14);
    for (const id of data("contracts.coast-guard")?.stations ?? []) atPort(id, "✚", "#c0392b", -12, -10);
    const bl = data("contracts.blockade")?.blockade;
    if (bl) { const p = portById(bl.port); if (p) { const [x, y] = P(p); ctx.strokeStyle = "#1f3a93"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke(); } }
    // 90 the pirate boss and 313 named pirates.
    const boss = data("contracts.pirate-boss")?.boss;
    if (boss) glyph(boss, "🏴‍☠️", "#000", 0, 5, 18);
    for (const p of data("contracts.named-pirates")?.pirates ?? []) { glyph(p, "⚑", "#8e1b1b", 0, 4, 13); glyph(p, p.name, "rgba(80,20,20,0.8)", 0, 16, 9); }
    // 307 ghost ship, 91 distress signals, 74 wrecks.
    const ghost = data("contracts.ghost-ship")?.ghost;
    if (ghost) { ctx.globalAlpha = 0.55; glyph(ghost, "⛵", "#9fd8ff", 0, 5, 16); ctx.globalAlpha = 1; }
    for (const s of data("contracts.fake-distress")?.signals ?? []) {
      const [x, y] = P(s), pulse = 6 + (Date.now() / 120) % 10;
      ctx.strokeStyle = "rgba(230, 126, 34, 0.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, pulse, 0, Math.PI * 2); ctx.stroke();
    }
    for (const w of data("contracts.salvage")?.wrecks ?? []) if (w) glyph(w, "⚓", "rgba(90,90,90,0.8)", 0, 4, 11);
    // 308-310 sea traffic, 86 police boats.
    const t = data("contracts.npc-traffic");
    if (t) {
      for (const f of t.ferries ?? []) if (f) glyph(f, "⛴", "#2c6fbb", 0, 4, 11);
      if (t.liner) glyph(t.liner, "🛳", "#fff", 0, 5, 15);
      for (const f of t.fishing ?? []) glyph(f, "🐟", "#2e8b57", 0, 3, 9);
    }
    for (const p of data("contracts.patrols")?.police ?? []) glyph(p, "★", "#1f3a93", 0, 4, 10);
    // 306 trader, 311 old captain, 320 stranger, 81 forming convoys.
    const tr = data("contracts.wandering-trader"); if (tr) atPort(tr.port, "⚖", "#7d5a00", 12, -10);
    const oc = data("contracts.old-captain"); if (oc) atPort(oc.port, "⚓", "#5d4037", 12, 12);
    const st = data("contracts.stranger"); if (st) atPort(st.port, "?", "#6c3483", -12, 12);
    for (const c of data("contracts.convoys") ?? []) if (!c.sailed) atPort(c.port, `⛟${c.ships}`, "#2e8b57", 0, 22);
    ctx.restore();
  });
})();
