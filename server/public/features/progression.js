// Client code for the progression feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, ctx, P, command, toast, $). It only shows what the server sent; every action is a server command.
(() => {
  const data = id => world?.featureData?.[id];
  const mine = id => me?.featureData?.[id];
  const portAt = id => world?.ports?.[id];
  const GOODS = ["grain", "fuel", "ore", "machinery"];

  // ---------------------------------------------------------------- 413-417 world preset palette and names
  let themeKey = "";
  function applyTheme() {
    const p = data("progression.world-presets");
    const canvas = document.getElementById("map");
    const key = p ? `${p.id}` : "";
    if (canvas && key !== themeKey) { canvas.style.filter = p?.filter || ""; themeKey = key; }
    const labels = p?.labels ?? {};
    const keys = Object.keys(labels);
    const panel = document.getElementById("panel");
    if (!keys.length || !panel) return;
    const re = new RegExp(`\\b(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest("input, select, textarea")) continue;
      const next = n.nodeValue.replace(re, m => labels[m] ?? m);
      if (next !== n.nodeValue) n.nodeValue = next;
    }
  }

  // ---------------------------------------------------------------- 138, 391, 399 header badge
  function badge() {
    const lv = mine("progression.captain-levels");
    const name = document.getElementById("hName");
    if (!name) return;
    let b = document.getElementById("progBadge");
    if (!lv) { b?.remove(); return; }
    if (!b) { b = document.createElement("small"); b.id = "progBadge"; b.className = "quiet"; b.style.marginLeft = "6px"; name.after(b); }
    const stars = mine("progression.new-game-plus")?.stars ?? 0;
    const title = data("progression.titles")?.[me?.id];
    const mode = mine("progression.run-modes")?.mode;
    b.textContent = `Lv ${lv.level} ${lv.rank}${stars ? ` ${"★".repeat(stars)}` : ""}${title ? ` · ${title}` : ""}${mode && mode !== "standard" ? ` · ${mode}` : ""}`;
    b.title = `${lv.xp} experience; next level at ${lv.nextLevel}`;
  }

  ManifestHooks.on("state", () => { applyTheme(); badge(); maybeDownload(); });
  ManifestHooks.on("render", () => { applyTheme(); badge(); addEditorButton(); });

  // ---------------------------------------------------------------- map drawing: 139 remote islands, 404 daily route, 143 skins
  ManifestHooks.on("draw", () => {
    if (!world?.ports || typeof ctx === "undefined" || typeof P !== "function") return;
    ctx.save();
    const remote = data("progression.remote-islands");
    if (remote) {
      const open = mine("progression.remote-islands")?.unlocked;
      for (const id of remote.ports ?? []) {
        const p = portAt(id); if (!p) continue;
        const [x, y] = P(p);
        ctx.strokeStyle = open ? "rgba(46, 139, 87, 0.9)" : "rgba(120, 120, 120, 0.7)";
        ctx.setLineDash(open ? [] : [3, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (!open) { ctx.font = "10px sans-serif"; ctx.fillStyle = "rgba(90,90,90,0.9)"; ctx.textAlign = "center"; ctx.fillText(`Lv ${remote.level}`, x, y - 19); }
      }
    }
    const route = data("progression.daily-route");
    if (route) {
      const a = portAt(route.from), b = portAt(route.to);
      if (a && b) {
        const [x1, y1] = P(a), [x2, y2] = P(b);
        ctx.strokeStyle = "rgba(224, 177, 60, 0.85)"; ctx.setLineDash([2, 6]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = "13px sans-serif"; ctx.fillStyle = "#e0b13c"; ctx.textAlign = "center"; ctx.fillText("★", (x1 + x2) / 2, (y1 + y2) / 2 - 4);
      }
    }
    const skins = data("progression.skins");
    if (skins && typeof shipPos === "function") {
      for (const s of world.ships ?? []) {
        const colour = skins[s.owner];
        if (!colour || s.dest === null) continue;
        const [x, y] = P(shipPos(s));
        ctx.fillStyle = colour; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x, y - 17); ctx.lineTo(x + 7, y - 14); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  });

  // ---------------------------------------------------------------- 418, 419 map editor and gallery download
  let wantDownload = null;
  function save(name, obj) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
    a.download = `${String(name).replace(/[^\w-]+/g, "_") || "map"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function maybeDownload() {
    const picked = mine("progression.map-sharing")?.picked;
    if (picked && picked.id !== wantDownload?.done && wantDownload?.id === picked.id) { save(picked.map.name, picked.map); wantDownload = { done: picked.id }; }
  }

  function addEditorButton() {
    if (!ManifestHooks.enabled("progression.map-sharing") || document.getElementById("mapEditorBtn")) return;
    const zoom = document.getElementById("zoomReset");
    if (!zoom) return;
    const btn = document.createElement("button");
    btn.id = "mapEditorBtn"; btn.className = "tool"; btn.title = "Map editor"; btn.setAttribute("aria-label", "Open the map editor"); btn.textContent = "✎";
    btn.addEventListener("click", openEditor);
    zoom.after(btn);
  }

  function openEditor() {
    const W = 1000, H = 720;
    const state = { name: "My archipelago", ports: [], routes: [], sel: null };
    const wrap = document.createElement("div");
    wrap.className = "auth"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Map editor");
    wrap.innerHTML = `<div class="card" style="max-width:960px;width:95vw">
      <h2>Map editor</h2>
      <p class="quiet">Click the sea to add a port. Click two ports to join them with a route. Shift-click a port to change what it produces, Alt-click to change what it consumes. Every good needs a producer and a consumer.</p>
      <label>Map name <input data-k="name" maxlength="40"></label>
      <canvas width="${W}" height="${H}" style="width:100%;background:#16324a;border-radius:6px;cursor:crosshair"></canvas>
      <p data-k="msg" class="quiet" role="status"></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button data-k="share">Share to the gallery</button>
        <button data-k="export" class="secondary">Download JSON</button>
        <label class="secondary">Open JSON <input data-k="import" type="file" accept="application/json" hidden></label>
        <span style="flex:1"></span>
        <label>Gallery <select data-k="gallery"></select></label>
        <button data-k="get" class="secondary">Download from gallery</button>
        <button data-k="close" class="link">Close</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const $k = k => wrap.querySelector(`[data-k="${k}"]`), canvas = wrap.querySelector("canvas"), g = canvas.getContext("2d");
    const msg = t => { $k("msg").textContent = t; };
    $k("name").value = state.name;
    $k("name").addEventListener("input", e => { state.name = e.target.value; });
    const gallery = data("progression.map-sharing") ?? [];
    $k("gallery").innerHTML = gallery.map(m => `<option value="${m.id}"></option>`).join("");
    [...$k("gallery").options].forEach((o, i) => { o.textContent = `${gallery[i].name} by ${gallery[i].author} (${gallery[i].ports} ports${gallery[i].rating ? `, ${gallery[i].rating}★` : ""})`; });
    const point = ev => { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height }; };
    const hit = pt => state.ports.findIndex(p => Math.hypot(p.x - pt.x, p.y - pt.y) < 14);
    const cycle = list => { const i = list.length ? GOODS.indexOf(list[list.length - 1]) + 1 : 0; return i >= GOODS.length ? [] : [GOODS[i]]; };
    function draw() {
      g.clearRect(0, 0, W, H);
      g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 2;
      for (const r of state.routes) { const a = state.ports[r.a], b = state.ports[r.b]; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      state.ports.forEach((p, i) => {
        g.fillStyle = i === state.sel ? "#e0b13c" : "#e8e2d0"; g.beginPath(); g.arc(p.x, p.y, 7, 0, Math.PI * 2); g.fill();
        g.font = "12px sans-serif"; g.textAlign = "center"; g.fillText(p.name, p.x, p.y - 12);
        g.font = "10px sans-serif"; g.fillStyle = "#9fd8ff"; g.fillText(`+${p.produces.join(",") || "-"} / -${p.consumes.join(",") || "-"}`, p.x, p.y + 20);
      });
    }
    canvas.addEventListener("click", ev => {
      const pt = point(ev), i = hit(pt);
      if (i >= 0 && ev.shiftKey) { state.ports[i].produces = cycle(state.ports[i].produces); return draw(); }
      if (i >= 0 && ev.altKey) { state.ports[i].consumes = cycle(state.ports[i].consumes); return draw(); }
      if (i >= 0) {
        if (state.sel === null) state.sel = i;
        else if (state.sel !== i) {
          const a = Math.min(state.sel, i), b = Math.max(state.sel, i);
          if (!state.routes.some(r => r.a === a && r.b === b)) state.routes.push({ a, b, distance: Math.round(Math.hypot(state.ports[a].x - state.ports[b].x, state.ports[a].y - state.ports[b].y) * 10) / 10 });
          state.sel = null;
        } else state.sel = null;
        return draw();
      }
      if (state.ports.length >= 60) return msg("A map has at most 60 ports.");
      const name = (prompt("Port name (letters, numbers, spaces)", `Port ${state.ports.length + 1}`) || "").trim().slice(0, 24);
      if (!name) return;
      state.ports.push({ name, x: Math.round(pt.x * 10) / 10, y: Math.round(pt.y * 10) / 10, produces: [], consumes: [] });
      draw();
    });
    const asMap = () => ({ name: state.name, ports: state.ports.map((p, id) => ({ id, ...p })), routes: state.routes });
    $k("export").addEventListener("click", () => save(state.name, asMap()));
    $k("import").addEventListener("change", async ev => {
      try {
        const m = JSON.parse(await ev.target.files[0].text());
        state.name = m.name || state.name; state.ports = (m.ports || []).map(p => ({ name: p.name, x: p.x, y: p.y, produces: p.produces || [], consumes: p.consumes || [] }));
        state.routes = (m.routes || []).map(r => ({ a: r.a, b: r.b, distance: r.distance })); $k("name").value = state.name; draw(); msg("Loaded.");
      } catch { msg("That file is not a map."); }
    });
    $k("share").addEventListener("click", () => command({ type: "feature", module: "progression.map-sharing", action: "share", map: asMap() }, () => msg("Shared to the gallery.")));
    $k("get").addEventListener("click", () => {
      const id = Number($k("gallery").value);
      if (!Number.isInteger(id)) return;
      wantDownload = { id };
      command({ type: "feature", module: "progression.map-sharing", action: "pick", map: id }, () => msg("Downloading..."));
    });
    $k("close").addEventListener("click", () => wrap.remove());
    wrap.addEventListener("keydown", ev => { if (ev.key === "Escape") wrap.remove(); });
    draw();
    $k("name").focus();
  }
})();
