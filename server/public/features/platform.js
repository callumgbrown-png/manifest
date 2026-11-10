// Client code for the platform feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, ctx, canvas, P, view, command, toast). It only draws what the server sent:
//   580 route heatmap (map layer), 585 balance dashboard strip, 587 debug overlay (F3 or the strip's "debug" box),
//   199 bug report text box, 591-599 markers for exotic places, the dragon (fantasy mode only) and armadas.
(() => {
  const data = id => (typeof world !== "undefined" ? world?.featureData?.[id] : undefined);
  const mine = id => (typeof me !== "undefined" ? me?.featureData?.[id] : undefined);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const portById = id => world?.ports?.find(p => p.id === id);
  let settings = { heatmap: true, debug: false };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem("manifest.platform") || "{}") }; } catch { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem("manifest.platform", JSON.stringify(settings)); } catch { /* ignore */ } };

  addEventListener("keydown", ev => {
    if (ev.key === "F3" && ManifestHooks.enabled("platform.debug-overlay")) { settings.debug = !settings.debug; save(); ev.preventDefault(); }
  });

  const mark = (port, text, color, dy) => {
    const p = portById(port);
    if (!p) return;
    const [x, y] = P(p);
    ctx.font = "15px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(text, x, y + dy);
  };

  ManifestHooks.on("draw", () => {
    if (!world?.ports || typeof ctx === "undefined" || typeof P !== "function") return;
    ctx.save();
    // 580: busiest lanes this week, thicker and redder with more voyages.
    const heat = data("platform.route-heatmap")?.routes ?? [];
    if (settings.heatmap && heat.length) {
      const top = Math.max(...heat.map(r => r.n));
      for (const r of heat) {
        const a = portById(r.a), b = portById(r.b);
        if (!a || !b) continue;
        const [x1, y1] = P(a), [x2, y2] = P(b), t = r.n / top;
        ctx.strokeStyle = `rgba(${Math.round(120 + 135 * t)}, ${Math.round(140 - 100 * t)}, 60, ${0.15 + 0.45 * t})`;
        ctx.lineWidth = 1 + 5 * t;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    // 593-599: places and events.
    const space = data("platform.space-shipping"), places = data("platform.mystery-places"), rift = data("platform.time-rifts");
    const battle = data("platform.fleet-battles")?.armada, dragon = mine("platform.dragon");
    if (space) mark(space.spaceport, "🚀", "#334", -14);
    if (places?.ghost) mark(places.ghost.port, "👻", "#556", -14);
    if (places) mark(places.city, "🏙", "#246", 22);
    if (mine("platform.mystery-places")?.underwater != null) mark(mine("platform.mystery-places").underwater, "🐚", "#147", 22);
    if (rift) mark(rift.port, "⌛", "#839", -28);
    if (battle) mark(battle.port, "⚔", "#a22", -28);
    if (dragon?.on) mark(dragon.port, "🐉", "#a40", 36);
    // 587: debug overlay.
    const dbg = data("platform.debug-overlay");
    if (settings.debug && dbg) {
      const lines = [`tick ${dbg.tick}  ships ${dbg.ships} (${dbg.atSea} at sea)  orders ${dbg.orders}  features ${dbg.features}`];
      const cp = data("platform.checkpoints")?.latest, st = data("platform.self-test");
      if (cp) lines.push(`checkpoint ${cp.tick} ${cp.digest}  seed ${JSON.stringify(data("platform.checkpoints").seed)}`);
      if (st) lines.push(`self-test ${st.passed ? "passed" : "FAILED"} at ${st.tick}`);
      const ex = mine("platform.experiments")?.variants;
      if (ex) lines.push("experiments " + Object.entries(ex).map(([k, v]) => `${k}=${v ?? "-"}`).join(" "));
      ctx.font = "12px monospace"; ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(8, 8, 8 + 7.3 * Math.max(...lines.map(l => l.length)), 8 + 16 * lines.length);
      ctx.fillStyle = "#cfe"; lines.forEach((l, i) => ctx.fillText(l, 14, 24 + 16 * i));
    }
    ctx.restore();
  });

  ManifestHooks.on("render", () => {
    const host = typeof canvas !== "undefined" ? canvas?.parentElement : null;
    if (!host) return;
    let bar = document.getElementById("platformStrip");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "platformStrip";
      bar.style.cssText = "font-size:12px;padding:3px 6px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:rgba(255,255,255,0.85)";
      host.appendChild(bar);
      bar.addEventListener("change", ev => {
        const k = ev.target?.dataset?.platform;
        if (k) { settings[k] = ev.target.checked; save(); }
      });
      bar.addEventListener("click", ev => {
        if (ev.target?.dataset?.platform !== "bug") return;
        const box = document.getElementById("platformBugText"), kind = document.getElementById("platformBugKind");
        command({ type: "feature", module: "platform.bug-report", action: "report", kind: kind.value, text: box.value.slice(0, 280) });
        box.value = "";
        toast("Bug report sent. Thank you!");
      });
    }
    if (document.activeElement?.id === "platformBugText" || document.activeElement?.id === "platformBugKind") return;   // don't steal focus while typing
    const parts = [];
    const health = data("platform.economy-health");
    if (health) parts.push(`<span title="Economy health (0-100) and wealth inequality (Gini, 0 = equal)">Economy ${health.score}/100 · Gini ${health.gini}</span>`);
    const style = mine("platform.personas");
    if (style) parts.push(`<span title="The play style your company is closest to">Style: ${esc(style.style)}</span>`);
    const wb = mine("platform.churn")?.welcomeBack;
    if (wb && wb.worthNow != null) parts.push(`<b>Welcome back!</b> worth ${Math.round(wb.worthThen ?? 0).toLocaleString()} → ${Math.round(wb.worthNow).toLocaleString()}`);
    const sp = data("platform.space-shipping");
    if (sp) parts.push(`<span title="Sell ${esc(sp.good)} at ${esc(sp.name)} to fill the next rocket">🚀 ${esc(sp.good)} ${sp.loaded}/${sp.need} t · ${sp.launches} launches</span>`);
    const feed = data("platform.fleet-battles")?.feed ?? [];
    if (feed.length) parts.push(`<span>⚔ ${esc(feed.at(-1).text)}</span>`);
    const fair = mine("platform.fair-play");
    if (fair?.bracket) parts.push(`<span title="Event bracket">Bracket: ${esc(fair.bracket)}</span>`);
    if (heatOn()) parts.push(`<label><input type="checkbox" data-platform="heatmap" ${settings.heatmap ? "checked" : ""}> Route heatmap</label>`);
    if (ManifestHooks.enabled("platform.debug-overlay")) parts.push(`<label><input type="checkbox" data-platform="debug" ${settings.debug ? "checked" : ""}> Debug (F3)</label>`);
    const keepText = document.getElementById("platformBugText")?.value ?? "";
    if (ManifestHooks.enabled("platform.bug-report")) parts.push(`<select id="platformBugKind">${["prices", "ships", "orders", "map", "display", "other"].map(k => `<option>${k}</option>`).join("")}</select><input id="platformBugText" maxlength="280" placeholder="Describe a bug" style="width:160px"><button type="button" data-platform="bug">Report bug</button>`);
    bar.innerHTML = parts.join(" ");
    const box = document.getElementById("platformBugText");
    if (box) box.value = keepText;
  });
  const heatOn = () => ManifestHooks.enabled("platform.route-heatmap");
})();
