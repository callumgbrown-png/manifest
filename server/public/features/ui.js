// Client code for the ui feature modules (ideas 146-160, 421-440, 481-500). Uses ManifestHooks (features/api.js)
// and app.js globals (world, me, command, toast, render, $, esc, fmt, cam, view, layout, ctx, P, shipPos, tab,
// selectedPort, readColours). It only shows what the server sent and sends normal commands; the server decides.
// Every feature checks ManifestHooks.enabled("<module id>"), so switching a module off on the server hides it here.
(() => {
  const on = id => ManifestHooks.enabled(id);
  const mine = id => me?.featureData?.[id];
  const shared = id => world?.featureData?.[id];
  const pref = {
    get(k, d) { try { const v = localStorage.getItem("manifest-ui:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("manifest-ui:" + k, JSON.stringify(v)); } catch { /* private window: settings last this visit */ } },
  };
  const portName = id => world?.ports?.[id]?.name ?? `port ${id}`;
  const goodName = g => (typeof g === "number" ? GOOD_NAMES[g] : g) ?? "empty";
  const act = (module, action, fields = {}, done) => command({ type: "feature", module, action, ...fields }, done);
  const money = n => (n < 0 ? "−" : "") + fmt(Math.abs(n));
  const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? "");
  const settings = {
    theme: pref.get("theme", "harbour"), palette: pref.get("palette", "standard"), colourBlind: pref.get("colourBlind", "off"),
    textScale: pref.get("textScale", 100), reducedMotion: pref.get("reducedMotion", matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
    lowSpec: pref.get("lowSpec", false), calm: pref.get("calm", false), remindMinutes: pref.get("remindMinutes", 60),
    lang: pref.get("lang", "en"), streamer: pref.get("streamer", false), minimap: pref.get("minimap", true),
    heatGood: pref.get("heatGood", null), mobile: pref.get("mobile", true),
  };
  const save = (k, v) => { settings[k] = v; pref.set(k, v); applyLook(); };

  // ------------------------------------------------------------------ styles
  const css = document.createElement("style");
  css.textContent = `
  .ui-win { position: fixed; z-index: 40; min-width: 260px; max-width: min(560px, calc(100vw - 32px)); max-height: 70vh; display: flex; flex-direction: column;
    background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--radius); box-shadow: var(--shadow); }
  .ui-win > header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--line); cursor: default; user-select: none; height: auto; }
  .ui-win.drag > header { cursor: move; }
  .ui-win > header b { flex: 1; font-size: 13px; }
  .ui-win > .ui-body { overflow: auto; padding: 10px 12px; font-size: 13px; }
  .ui-win table { width: 100%; border-collapse: collapse; } .ui-win th, .ui-win td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .ui-win th[data-sort] { cursor: pointer; } .ui-win th[data-sort]:hover { color: var(--accent); }
  .ui-bar { display: inline-block; width: 60px; height: 7px; border-radius: 4px; background: var(--sea-deep); overflow: hidden; vertical-align: middle; }
  .ui-bar > i { display: block; height: 100%; background: var(--accent); }
  .shipCard .ui-bar { width: 100%; margin-top: 6px; }
  .ui-tools { position: absolute; left: 10px; top: 10px; display: flex; gap: 6px; z-index: 5; flex-wrap: wrap; max-width: 60%; }
  .ui-tools button { padding: 5px 9px; font-size: 12px; }
  .ui-headbtn { margin-left: 4px; }
  #ui-minimap { position: absolute; right: 10px; bottom: 10px; width: 160px; height: 112px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--sea-deep); z-index: 5; cursor: pointer; }
  .ui-strip { position: absolute; left: 50%; transform: translateX(-50%); bottom: 54px; z-index: 6; max-width: min(520px, 80%); background: var(--panel); border: 1px solid var(--accent);
    border-radius: 8px; padding: 8px 12px; font-size: 13px; box-shadow: var(--shadow); }
  .ui-tipbox { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: var(--bg); }
  .ui-tipbox div { max-width: 420px; padding: 0 16px; text-align: center; } .ui-tipbox b { display: block; font-size: 18px; margin-bottom: 8px; }
  .ui-extra { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 4px; font-size: 12px; }
  .ui-badge { background: var(--bad); color: #fff; border-radius: 9px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
  .ui-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  body.ui-photo header, body.ui-photo aside, body.ui-photo .legend, body.ui-photo .mapTools, body.ui-photo .ui-tools, body.ui-photo #ui-minimap,
  body.ui-photo .ui-strip, body.ui-photo .ui-win, body.ui-photo #tip { display: none !important; }
  body.ui-photo .mapWrap { position: fixed; inset: 0; z-index: 30; }
  body.ui-photo .mapWrap::after { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 160px rgba(0,0,0,.6); }
  body.ui-calm #hDelta, body.ui-calm [data-tab="board"], body.ui-calm .seasonBar { display: none !important; }
  body.ui-calm .toast.warn, body.ui-calm .toast.bad { filter: saturate(.4); }
  body.ui-reduced *, body.ui-reduced *::before, body.ui-reduced *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
  body.ui-lowspec * { box-shadow: none !important; text-shadow: none !important; backdrop-filter: none !important; }
  @media (pointer: coarse) { body.ui-touch button { min-height: 40px; min-width: 40px; } body.ui-touch input, body.ui-touch select { min-height: 40px; } }
  @media (max-width: 760px) {
    body.ui-mobile aside { position: fixed; left: 0; right: 0; bottom: 0; max-height: 55vh; z-index: 20; border-top: 1px solid var(--line-strong); background: var(--panel); }
    body.ui-mobile aside.ui-folded #panel { display: none; }
    body.ui-mobile .ui-win { left: 8px !important; right: 8px; top: auto !important; bottom: 8px; max-width: none; }
  }
  /* Theme packs (152, 440). The game's own look is "harbour" (dark). */
  :root[data-ui-theme="light"] { --bg: #eef3f6; --sea: #d8e6ee; --sea-deep: #c9dbe5; --panel: #ffffff; --panel-2: #f2f6f8; --line: #c9d6de; --line-strong: #9fb4c2;
    --ink: #10212c; --quiet: #4b6474; --faint: #7d93a1; --accent: #0f8a63; --mine: #0f8a63; --good: #0f8a63; --bad: #c0392b; }
  :root[data-ui-theme="midnight"] { --bg: #05080d; --sea: #070d16; --sea-deep: #04070c; --panel: #0b1220; --panel-2: #101a2c; --line: #1a2840; --line-strong: #263a5a; --accent: #7aa2ff; --mine: #7aa2ff; }
  :root[data-ui-theme="parchment"] { --bg: #efe4cc; --sea: #d9c9a3; --sea-deep: #cdb98e; --panel: #f7efdc; --panel-2: #efe2c4; --line: #c8b48a; --line-strong: #a38d62;
    --ink: #3a2a14; --quiet: #6b5636; --faint: #8f7a55; --accent: #8a4b14; --mine: #8a4b14; --good: #3f7a2a; --bad: #a3271b; }
  :root[data-ui-theme="tropical"] { --bg: #062a2c; --sea: #0a3d40; --sea-deep: #073133; --panel: #0c3a3d; --panel-2: #11484b; --line: #1d5c5f; --line-strong: #2a7a7d; --accent: #ffcf5a; --mine: #ffcf5a; }
  :root[data-ui-theme="contrast"] { --bg: #000; --sea: #000; --sea-deep: #000; --panel: #000; --panel-2: #111; --line: #fff; --line-strong: #fff; --ink: #fff; --quiet: #fff; --faint: #ddd; --accent: #ffff00; --mine: #ffff00; }
  :root[data-ui-theme] header { background: linear-gradient(180deg, var(--panel-2), var(--bg)); }
  :root[data-ui-theme] nav { background: var(--panel-2); }
  :root[data-ui-theme="light"] button:not(.secondary):not(.link):not(.tool):not(nav button), :root[data-ui-theme="parchment"] button:not(.secondary):not(.link):not(.tool):not(nav button) { color: #fff; }
  :root[data-ui-theme] .legend, :root[data-ui-theme] .tool { background: color-mix(in srgb, var(--panel) 88%, transparent); border-color: var(--line); }
  /* Colour palettes (496) and colour-blind modes (159): the goods' colours. Shapes already differ. */
  :root[data-ui-palette="vivid"] { --grain: #ffd23f; --fuel: #ff5d3d; --ore: #b8c4d0; --machinery: #c77dff; }
  :root[data-ui-palette="pastel"] { --grain: #f3dca0; --fuel: #f2a99a; --ore: #c3cbd4; --machinery: #d5c0f5; }
  :root[data-ui-cb="deuteranopia"], :root[data-ui-cb="protanopia"] { --grain: #f0e442; --fuel: #0072b2; --ore: #bbbbbb; --machinery: #cc79a7; --good: #56b4e9; --bad: #e69f00; --mine: #56b4e9; }
  :root[data-ui-cb="tritanopia"] { --grain: #ff6b6b; --fuel: #2ec4b6; --ore: #bbbbbb; --machinery: #ffd166; --good: #2ec4b6; --bad: #ff6b6b; }
  `;
  document.head.append(css);
  const live = document.createElement("div");   // 490: announcements for screen readers
  live.className = "ui-sr"; live.setAttribute("aria-live", "polite"); live.setAttribute("role", "status");
  document.body.append(live);
  const announce = text => { if (on("ui.accessibility")) { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 30); } };

  // ------------------------------------------------------------------ look: themes, palettes, scaling, motion (152 159 440 488 489 494 496 497 153)
  function applyLook() {
    const root = document.documentElement, b = document.body;
    const themesOn = on("ui.themes");
    const set = (k, v) => { if (v) root.dataset[k] = v; else delete root.dataset[k]; };
    set("uiTheme", themesOn && settings.theme !== "harbour" ? settings.theme : "");
    set("uiPalette", themesOn && settings.palette !== "standard" ? settings.palette : "");
    set("uiCb", on("ui.colour-blind") && settings.colourBlind !== "off" ? settings.colourBlind : "");
    const scale = on("ui.accessibility") ? settings.textScale / 100 : 1;
    for (const el of document.querySelectorAll("header, aside, .toast, .ui-win")) el.style.zoom = scale === 1 ? "" : String(scale);
    b.classList.toggle("ui-reduced", on("ui.accessibility") && settings.reducedMotion);
    b.classList.toggle("ui-lowspec", on("ui.low-spec") && settings.lowSpec);
    b.classList.toggle("ui-calm", on("ui.calm") && settings.calm);
    b.classList.toggle("ui-touch", on("ui.input"));
    b.classList.toggle("ui-mobile", on("ui.mobile") && settings.mobile);
    try { readColours(); bgKey = ""; islandKey = ""; } catch { /* before the map is ready */ }
  }

  // 494 low-spec: draw the map at about 20 frames a second and at 1x pixel density.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  let lastFrame = 0;
  window.requestAnimationFrame = fn => nativeRaf(t => {
    if (on("ui.low-spec") && settings.lowSpec && t - lastFrame < 48) return window.requestAnimationFrame(fn);
    lastFrame = t; fn(t);
  });
  const nativeDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio") ?? Object.getOwnPropertyDescriptor(Window.prototype, "devicePixelRatio");
  try {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true,
      get() { const real = nativeDpr?.get ? nativeDpr.get.call(window) : 1; return on("ui.low-spec") && settings.lowSpec ? 1 : real; } });
  } catch { /* some browsers lock it */ }

  // ------------------------------------------------------------------ windows (422)
  const wins = new Map();
  function openWin(id, title, body, opts = {}) {
    let w = wins.get(id);
    if (!w) {
      w = document.createElement("section");
      w.className = "ui-win"; w.setAttribute("role", "dialog"); w.setAttribute("aria-label", title); w.dataset.win = id;
      w.innerHTML = `<header><b></b><button class="link" data-close aria-label="Close">✕</button></header><div class="ui-body"></div>`;
      const pos = pref.get("win:" + id, { x: 80 + wins.size * 24, y: 90 + wins.size * 24 });
      w.style.left = Math.min(pos.x, innerWidth - 280) + "px"; w.style.top = Math.min(pos.y, innerHeight - 120) + "px";
      w.querySelector("[data-close]").onclick = () => closeWin(id);
      const head = w.querySelector("header");
      head.addEventListener("pointerdown", ev => {
        if (!on("ui.windows") || ev.target.closest("button")) return;
        const sx = ev.clientX - w.offsetLeft, sy = ev.clientY - w.offsetTop;
        head.setPointerCapture(ev.pointerId);
        const move = m => { w.style.left = Math.max(0, Math.min(innerWidth - 80, m.clientX - sx)) + "px"; w.style.top = Math.max(0, Math.min(innerHeight - 40, m.clientY - sy)) + "px"; };
        const up = () => { head.removeEventListener("pointermove", move); pref.set("win:" + id, { x: w.offsetLeft, y: w.offsetTop }); };
        head.addEventListener("pointermove", move); head.addEventListener("pointerup", up, { once: true });
      });
      w.addEventListener("pointerdown", () => { for (const o of wins.values()) o.style.zIndex = "40"; w.style.zIndex = "41"; });
      document.body.append(w); wins.set(id, w);
    }
    w.classList.toggle("drag", on("ui.windows"));
    w.querySelector("header b").textContent = title;
    w.querySelector(".ui-body").innerHTML = body;
    w._refresh = opts.refresh ?? w._refresh;
    opts.bind?.(w.querySelector(".ui-body"));
    applyLook(); translate(w);
    return w;
  }
  function closeWin(id) { wins.get(id)?.remove(); wins.delete(id); }
  const isOpen = id => wins.has(id);
  const toggleWin = (id, fn) => (isOpen(id) ? closeWin(id) : fn());
  function refreshWins() {
    for (const [id, w] of wins) {
      if (w.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) continue;
      try { w._refresh?.(); } catch (err) { console.error("ui window", id, err); }
    }
  }
  const bindActs = (root, handlers) => root.querySelectorAll("[data-ui]").forEach(el => {
    el.addEventListener(el.tagName === "SELECT" ? "change" : "click", ev => handlers[el.dataset.ui]?.(el, ev));
  });
  const portOptions = (sel = null) => (world?.ports ?? []).map((p, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");
  const goodOptions = (sel = null) => GOOD_NAMES.map(g => `<option${g === sel ? " selected" : ""}>${g}</option>`).join("");
  const shipOptions = (filter = () => true) => (me?.ships ?? []).filter(filter).map(s => `<option value="${s.id}">Ship ${s.id} (${className(s.type)}) at ${esc(portName(s.port))}</option>`).join("");
  const bar = f => `<span class="ui-bar" title="${Math.round(f * 100)}% full"><i style="width:${Math.round(Math.min(1, Math.max(0, f)) * 100)}%"></i></span>`;

  // ------------------------------------------------------------------ toolbar and header buttons
  const tools = document.createElement("div");
  tools.className = "ui-tools";
  document.querySelector(".mapWrap")?.append(tools);
  const headBtns = document.createElement("span");
  $("help")?.before(headBtns);
  function toolbar() {
    const p = mine("ui.presets");
    const b = [];
    if (on("ui.dashboard")) b.push(["dash", "Dashboard", "d"]);
    if (on("ui.planner") && p?.planner !== false) b.push(["plan", "Plan", "r"]);
    if (on("ui.cargo-manifest")) b.push(["manifest", "Manifest", "c"]);
    if (on("ui.fleet-table")) b.push(["fleet", "Fleet table", "t"]);
    if (on("ui.ledger")) b.push(["ledger", "Ledger", "l"]);
    if (on("ui.alerts") || on("ui.watchlist")) b.push(["prices", "Prices", "w"]);
    if (on("ui.saved-routes") || on("ui.auto-trade")) b.push(["routes", "Routes", "o"]);
    if (on("ui.heatmap")) b.push(["heat", settings.heatGood ? `Heat: ${settings.heatGood}` : "Heatmap", "h"]);
    if (on("ui.map-nav")) b.push(["search", "Find port", "/"], ["zoomfleet", "My fleet", "f"]);
    if (on("ui.capture")) b.push(["shot", "Screenshot", ""], ["photo", "Photo", "p"]);
    const key = b.map(x => x.join()).join("|");
    if (tools.dataset.key !== key) {
      tools.dataset.key = key;
      tools.innerHTML = b.map(([id, label, k]) => `<button class="secondary" data-tool="${id}" title="${esc(label)}${k ? ` (${k})` : ""}">${esc(label)}</button>`).join("");
      tools.querySelectorAll("[data-tool]").forEach(el => el.onclick = () => runTool(el.dataset.tool));
      translate(tools);
    }
    const hb = [];
    if (on("ui.undo") && mine("ui.undo")?.count) hb.push(`<button class="link ui-headbtn" data-head="undo" title="Undo: ${esc(mine("ui.undo").last)} (u)">Undo</button>`);
    if (on("ui.notifications")) { const n = mine("ui.notifications")?.unread ?? 0; hb.push(`<button class="link ui-headbtn" data-head="bell" title="Notifications">Notices${n ? `<span class="ui-badge">${n}</span>` : ""}</button>`); }
    if (on("ui.wiki")) hb.push(`<button class="link ui-headbtn" data-head="wiki" title="Glossary and wiki (g)">Wiki</button>`);
    hb.push(`<button class="link ui-headbtn" data-head="settings" title="Display and accessibility settings (,)">Settings</button>`);
    const hkey = hb.join("");
    if (headBtns.dataset.key !== hkey) {
      headBtns.dataset.key = hkey; headBtns.innerHTML = hkey;
      headBtns.querySelectorAll("[data-head]").forEach(el => el.onclick = () => runTool(el.dataset.head));
      translate(headBtns);
    }
  }
  function runTool(id) {
    ({
      dash: () => toggleWin("dash", dashboardWin), plan: () => toggleWin("plan", plannerWin), manifest: () => toggleWin("manifest", manifestWin),
      fleet: () => toggleWin("fleet", fleetWin), ledger: () => toggleWin("ledger", ledgerWin), prices: () => toggleWin("prices", pricesWin),
      routes: () => toggleWin("routes", routesWin), heat: cycleHeat, search: () => toggleWin("search", searchWin), zoomfleet: zoomToFleet,
      shot: screenshot, photo: () => photoMode(!document.body.classList.contains("ui-photo")),
      undo: () => act("ui.undo", "undo", {}, () => toast("Undone")), bell: () => toggleWin("bell", bellWin), wiki: () => toggleWin("wiki", wikiWin),
      settings: () => toggleWin("settings", settingsWin), keys: () => toggleWin("keys", keysWin),
    })[id]?.();
  }

  // ------------------------------------------------------------------ route planner and calculator (146 147 425)
  let calc = { ship: null, dest: null, good: "", qty: 10, key: null };
  function plannerWin() {
    const routes = mine("ui.planner")?.routes ?? {};
    const best = on("ui.best-trade") ? mine("ui.best-trade")?.best : null;
    const rows = Object.entries(routes).flatMap(([ship, list]) => list.map(r => `<tr><td>Ship ${ship}</td><td>${esc(r.good ?? "carry on")} ${r.good ? r.qty : ""}</td>
      <td>${esc(portName(r.dest))}</td><td class="num">${r.hours} h</td><td class="num">${money(r.fuelCost)}</td><td class="num pos">${money(r.profit)}</td><td class="num">${r.perHour}/h</td>
      <td><button class="secondary" data-ui="go" data-ship="${ship}" data-dest="${r.dest}" data-good="${r.good ?? ""}" data-qty="${r.qty}">Sail</button></td></tr>`)).join("");
    const q = calc.key ? voyageQuotes.get(calc.key)?.response : null;
    const quote = q?.ok === false ? `<p class="neg">${esc(q.error)}</p>` : q?.quote ? `<p>About <b>${q.quote.hours} h</b>. Cargo ${money(q.quote.cargoCost)}, fuel ${money(q.quote.fuelCost)},
      port fee ${money(q.quote.portFee)}, sale ${money(q.quote.revenue)} → <b class="${q.quote.profit >= 0 ? "pos" : "neg"}">${money(q.quote.profit)}</b> profit.</p>` : `<p class="quiet">Pick a ship and a port for a live quote.</p>`;
    openWin("plan", "Route planner", `
      ${best ? `<p><b>Best trade right now:</b> ship ${best.ship} takes ${esc(best.good ?? "its cargo")} to ${esc(portName(best.dest))}, about ${money(best.profit)} in ${best.hours} h.</p>` : ""}
      ${rows ? `<table><tr><th>Ship</th><th>Cargo</th><th>To</th><th>Time</th><th>Fuel</th><th>Profit</th><th>Per hour</th><th></th></tr>${rows}</table>`
        : `<p class="quiet">No profitable voyage for your docked ships right now (or they are all at sea).</p>`}
      <h4>Fuel, time and profit calculator</h4>
      <div class="row labelled"><label class="mini grow">Ship<select data-ui="cship">${shipOptions(s => s.dest === null)}</select></label>
      <label class="mini grow">To<select data-ui="cdest">${portOptions(calc.dest)}</select></label></div>
      <div class="row labelled"><label class="mini grow">Buy<select data-ui="cgood"><option value="">nothing (carry what's aboard)</option>${goodOptions(calc.good)}</select></label>
      <label class="mini">Tonnes<input data-ui="cqty" type="number" min="1" value="${calc.qty}"></label><button data-ui="quote">Quote</button></div>
      <div data-quote>${quote}</div>`, {
      refresh: plannerWin,
      bind: body => {
        const shipSel = body.querySelector("[data-ui=cship]");
        if (calc.ship !== null) shipSel.value = String(calc.ship);
        bindActs(body, {
          go: el => command({ type: "sail", company: me.id, ship: +el.dataset.ship, dest: +el.dataset.dest, ...(el.dataset.good ? { buy: { good: el.dataset.good, qty: +el.dataset.qty } } : {}) },
            () => toast(`Ship ${el.dataset.ship} sails for ${portName(+el.dataset.dest)}`)),
          quote: () => {
            calc = { ship: +shipSel.value, dest: +body.querySelector("[data-ui=cdest]").value, good: body.querySelector("[data-ui=cgood]").value,
              qty: Math.max(1, Math.floor(+body.querySelector("[data-ui=cqty]").value || 1)) };
            if (!calc.ship) return toast("Dock a ship first", true);
            const cmd = { type: "sail", company: me.id, ship: calc.ship, dest: calc.dest, ...(calc.good ? { buy: { good: calc.good, qty: calc.qty } } : {}) };
            calc.key = "ui-calc:" + JSON.stringify(cmd);
            const id = ++reqId;
            if (send({ type: "quoteVoyage", reqId: id, cmd })) quoteRequests.set(id, { key: calc.key, ship: -1 });
            setTimeout(() => isOpen("plan") && plannerWin(), 400);
          },
        });
      },
    });
  }

  // ------------------------------------------------------------------ cargo manifest (155)
  function manifestWin() {
    const m = mine("ui.cargo-manifest");
    if (!m) return;
    const rows = m.lines.map(l => `<tr><td>Ship ${l.ship}</td><td>${esc(className(l.type))}</td>
      <td>${l.dest === null ? esc(portName(l.at)) : `→ ${esc(portName(l.dest))} (${l.arriveIn} h)`}</td>
      <td>${l.good ? `<i class="shape ${l.good}"></i>${l.qty} ${l.good}` : `<span class="quiet">empty</span>`}</td><td>${bar(l.fill)}</td>
      <td class="num">${l.good ? money(l.paid) : ""}</td><td class="num">${l.valueHere === null ? "" : money(l.valueHere)}</td>
      <td>${l.bestPort === null ? "" : `${esc(portName(l.bestPort))} <span class="num">${money(l.bestValue)}</span>`}</td></tr>`).join("");
    openWin("manifest", "Cargo manifest", `<table><tr><th>Ship</th><th>Class</th><th>Where</th><th>Cargo</th><th>Hold</th><th>Paid</th><th>Worth there</th><th>Best port</th></tr>${rows}</table>
      <p class="quiet">${m.totals.tonnes} of ${m.totals.capacity} tonnes carried. Cargo paid ${money(m.totals.paid)}, worth ${money(m.totals.value)} where it is (after tax).</p>`, { refresh: manifestWin });
  }

  // ------------------------------------------------------------------ fleet table, sorting, cargo filters, fill bars (428 431 432 433 434 423)
  const fleetView = { sort: pref.get("fleetSort", "id"), dir: pref.get("fleetDir", 1), cargo: pref.get("fleetCargo", "any"), status: pref.get("fleetStatus", "any") };
  function fleetWin() {
    const idle = on("ui.idle-ships") ? mine("ui.idle-ships") ?? {} : {};
    let ships = (me?.ships ?? []).map(s => ({ id: s.id, type: s.type, where: s.dest === null ? portName(s.port) : `→ ${portName(s.dest)}`, atSea: s.dest !== null,
      cargo: s.qty > 0 ? goodName(s.good) : "empty", qty: s.qty, fill: s.capacity ? s.qty / s.capacity : 0, idle: idle[s.id] ?? null, eta: s.dest === null ? 0 : s.arriveTick - world.tick }));
    if (fleetView.cargo !== "any") ships = ships.filter(s => s.cargo === fleetView.cargo);
    if (fleetView.status !== "any") ships = ships.filter(s => (fleetView.status === "sea") === s.atSea);
    const k = fleetView.sort;
    ships.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : a.id - b.id) * fleetView.dir);
    const th = (key, label) => `<th data-sort="${key}">${label}${k === key ? (fleetView.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
    const rows = ships.map(s => `<tr><td>Ship ${s.id}</td><td>${esc(className(s.type))}</td><td>${esc(s.where)}${s.atSea ? ` <span class="quiet">${s.eta} h</span>` : ""}</td>
      <td>${s.cargo === "empty" ? `<span class="quiet">empty</span>` : `<i class="shape ${s.cargo}"></i>${Math.round(s.qty)} ${s.cargo}`}</td><td>${bar(s.fill)}</td>
      <td>${s.idle !== null && s.idle >= 6 ? `<span class="neg" title="Docked and empty">idle ${s.idle} h</span>` : ""}</td>
      <td><button class="link" data-ui="open" data-ship="${s.id}">Open</button></td></tr>`).join("");
    const sel = (ui, val, opts) => `<select data-ui="${ui}">${opts.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    openWin("fleet", "Fleet overview", `<div class="row labelled"><label class="mini grow">Cargo${sel("fcargo", fleetView.cargo, [["any", "any"], ["empty", "empty"], ...GOOD_NAMES.map(g => [g, g])])}</label>
      <label class="mini grow">Status${sel("fstatus", fleetView.status, [["any", "any"], ["port", "in port"], ["sea", "at sea"]])}</label>
      ${on("ui.quick-sell") ? `<button class="secondary" data-ui="sellall" title="Sell the cargo on every docked ship at the market price">Quick-sell all</button>` : ""}</div>
      <table><tr>${th("id", "Ship")}${th("type", "Class")}${th("where", "Where")}${th("cargo", "Cargo")}${th("fill", "Hold")}${th("idle", "")}<th></th></tr>${rows}</table>
      <p class="quiet">${ships.length} of ${me?.ships.length ?? 0} ships shown.</p>`, {
      refresh: fleetWin,
      bind: body => {
        body.querySelectorAll("[data-sort]").forEach(h => h.onclick = () => {
          fleetView.dir = fleetView.sort === h.dataset.sort ? -fleetView.dir : 1; fleetView.sort = h.dataset.sort;
          pref.set("fleetSort", fleetView.sort); pref.set("fleetDir", fleetView.dir); fleetWin();
        });
        bindActs(body, {
          fcargo: el => { fleetView.cargo = el.value; pref.set("fleetCargo", el.value); fleetWin(); },
          fstatus: el => { fleetView.status = el.value; pref.set("fleetStatus", el.value); fleetWin(); },
          open: el => { const s = me.ships.find(x => x.id === +el.dataset.ship); if (!s) return; selectedPort = s.dest ?? s.port; tab = "port"; render(); centreOn(world.ports[selectedPort]); },
          sellall: () => act("ui.quick-sell", "sellAll", {}, r => toast(`Sold ${r.sold} holds for ${fmt(r.earned)}`)),
        });
      },
    });
  }
  /** 434 fill bars and 424 repeat buttons on the panel's ship cards. */
  function decorateShipCards() {
    const repeat = on("ui.repeat-route") ? mine("ui.repeat-route") ?? {} : {};
    document.querySelectorAll("#panel .shipCard[data-ship]").forEach(card => {
      const s = me?.ships.find(x => x.id === Number(card.dataset.ship));
      if (!s || card.querySelector(".ui-extra")) return;
      const extra = document.createElement("div"); extra.className = "ui-extra";
      let html = "";
      if (on("ui.fleet-table") && s.capacity) html += `${bar(s.qty / s.capacity)} <span class="quiet">${Math.round(s.qty)} / ${s.capacity} t</span>`;
      const r = repeat[s.id];
      if (r) html += ` <button class="secondary" data-repeat="${s.id}" title="Sail to ${esc(portName(r.dest))} again${r.good ? ` with ${r.qty} ${r.good}` : ""}">↻ Repeat to ${esc(portName(r.dest))}</button>`;
      if (!html) return;
      extra.innerHTML = html; card.append(extra);
      extra.querySelector("[data-repeat]")?.addEventListener("click", () => act("ui.repeat-route", "repeat", { ship: s.id }, () => toast(`Ship ${s.id} repeats its last route`)));
    });
  }

  // ------------------------------------------------------------------ ledger and CSV export (157 436)
  function ledgerWin() {
    const l = mine("ui.ledger");
    if (!l) return;
    const label = r => r.kind === "trip" ? `Ship ${r.ship}: ${r.good ? `${r.qty} ${r.good}` : "empty"} ${esc(portName(r.from))} → ${esc(portName(r.to))}`
      : r.kind === "upkeep" ? "Daily fleet upkeep" : `Forced sale of ship ${r.ship}`;
    const rows = [...l.rows].reverse().slice(0, 60).map(r => `<tr><td class="num">Day ${Math.floor(r.tick / 24) + 1} ${String(r.tick % 24).padStart(2, "0")}:00</td><td>${label(r)}</td>
      <td class="num ${r.amount >= 0 ? "pos" : "neg"}">${money(r.amount)}</td></tr>`).join("");
    openWin("ledger", "Profit and loss", `<p>Trips <b class="num">${money(l.totals.trips)}</b> · Upkeep <b class="num">${money(l.totals.upkeep)}</b> · Forced sales <b class="num">${money(l.totals.forcedSales)}</b>
      · Net <b class="num ${l.totals.net >= 0 ? "pos" : "neg"}">${money(l.totals.net)}</b></p>
      <div class="row"><button class="secondary" data-ui="csv">Export CSV</button><span class="quiet">${l.count} entries since the ledger started</span></div>
      <table><tr><th>When</th><th>What</th><th>Amount</th></tr>${rows}</table>`, {
      refresh: ledgerWin,
      bind: body => bindActs(body, { csv: () => {
        const head = "tick,day,kind,ship,from,to,good,qty,spent,earned,amount";
        const q = v => (v === undefined || v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        const lines = l.rows.map(r => [r.tick, Math.floor(r.tick / 24) + 1, r.kind, r.ship, r.from === undefined ? "" : portName(r.from), r.to === undefined ? "" : portName(r.to),
          r.good, r.qty, r.spent, r.earned, r.amount].map(q).join(","));
        download(`manifest-ledger-${(me?.name ?? "company").replace(/\W+/g, "-")}.csv`, new Blob([[head, ...lines].join("\n")], { type: "text/csv" }));
      } }),
    });
  }
  function download(name, blob) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------ price alerts and watchlist (426 427)
  const firedSeen = new Set(pref.get("alertsSeen", []));
  function pricesWin() {
    const alerts = on("ui.alerts") ? mine("ui.alerts") ?? [] : null, watch = on("ui.watchlist") ? mine("ui.watchlist") ?? [] : null;
    const spark = s => { if (!s?.length) return ""; const lo = Math.min(...s), hi = Math.max(...s), w = 60, h = 16;
      return `<svg width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.2" points="${s.map((v, i) => `${(i / Math.max(1, s.length - 1)) * w},${h - 1 - ((v - lo) / Math.max(0.01, hi - lo)) * (h - 2)}`).join(" ")}"/></svg>`; };
    openWin("prices", "Prices", `
      ${watch ? `<h4>Watchlist</h4>${watch.length ? `<table>${watch.map(x => `<tr><td>${esc(portName(x.port))}</td><td><i class="shape ${x.good}"></i>${x.good}</td><td class="num">${x.now.toFixed(2)}</td>
        <td class="num ${x.change > 0 ? "pos" : x.change < 0 ? "neg" : ""}">${x.change > 0 ? "+" : ""}${x.change.toFixed(2)}</td><td>${spark(x.spark)}</td>
        <td><button class="link" data-ui="unwatch" data-port="${x.port}" data-good="${x.good}">Remove</button></td></tr>`).join("")}</table>` : `<p class="quiet">Nothing watched yet.</p>`}` : ""}
      ${alerts ? `<h4>Price alerts</h4>${alerts.length ? `<table>${alerts.map(a => `<tr><td>${esc(portName(a.port))}</td><td>${a.good} ${a.side} ${a.price}</td><td class="num">now ${a.now}</td>
        <td>${a.fired !== null ? `<b class="pos">went off</b>` : `<span class="quiet">waiting</span>`}</td><td><button class="link" data-ui="unalert" data-id="${a.id}">Remove</button></td></tr>`).join("")}</table>
        ${alerts.some(a => a.fired !== null) ? `<button class="link" data-ui="clearfired">Clear the ones that went off</button>` : ""}` : `<p class="quiet">No alerts.</p>`}` : ""}
      <h4>Add</h4><div class="row labelled"><label class="mini grow">Port<select data-f="port">${portOptions(selectedPort)}</select></label><label class="mini grow">Good<select data-f="good">${goodOptions()}</select></label></div>
      <div class="row labelled">${watch ? `<button class="secondary" data-ui="watch">Watch</button>` : ""}
      ${alerts ? `<label class="mini">When<select data-f="side"><option>above</option><option>below</option></select></label><label class="mini">Price<input data-f="price" type="number" step="0.5" min="0.01" value="30"></label>
      <button data-ui="alert">Alert me</button>` : ""}</div>`, {
      refresh: pricesWin,
      bind: body => {
        const f = k => body.querySelector(`[data-f=${k}]`)?.value;
        bindActs(body, {
          watch: () => act("ui.watchlist", "watch", { port: +f("port"), good: f("good") }, () => toast("Watching")),
          unwatch: el => act("ui.watchlist", "unwatch", { port: +el.dataset.port, good: el.dataset.good }),
          alert: () => act("ui.alerts", "add", { port: +f("port"), good: f("good"), side: f("side"), price: +f("price") }, () => toast("Alert set")),
          unalert: el => act("ui.alerts", "remove", { id: +el.dataset.id }),
          clearfired: () => act("ui.alerts", "clearFired"),
        });
      },
    });
  }
  function checkAlerts() {
    if (!on("ui.alerts")) return;
    for (const a of mine("ui.alerts") ?? []) if (a.fired !== null && !firedSeen.has(a.id)) {
      firedSeen.add(a.id); pref.set("alertsSeen", [...firedSeen].slice(-50));
      const text = `Price alert: ${a.good} at ${portName(a.port)} is ${a.side} ${a.price} (now ${a.now})`;
      toast(text, "warn"); announce(text);
    }
  }

  // ------------------------------------------------------------------ saved and auto-trade routes (148 149)
  function routesWin() {
    const saved = on("ui.saved-routes") ? mine("ui.saved-routes") : null, loops = on("ui.auto-trade") ? mine("ui.auto-trade") ?? [] : null;
    openWin("routes", "Routes", `
      ${saved ? `<h4>Saved routes</h4>${saved.routes.length ? `<table>${saved.routes.map(r => `<tr><td>${esc(portName(r.from))} → ${esc(portName(r.dest))}</td><td>${r.good ? `${r.qty} ${r.good}` : "carry"}</td>
        <td><select data-run="${r.id}"><option value="">Run on…</option>${shipOptions(s => s.dest === null && s.port === r.from)}</select></td><td><button class="link" data-ui="del" data-id="${r.id}">Delete</button></td></tr>`).join("")}</table>` : `<p class="quiet">None saved.</p>`}
        <div class="row labelled"><label class="mini grow">From<select data-f="from">${portOptions(selectedPort)}</select></label><label class="mini grow">To<select data-f="dest">${portOptions()}</select></label></div>
        <div class="row labelled"><label class="mini grow">Buy<select data-f="good"><option value="">nothing</option>${goodOptions()}</select></label><label class="mini">Tonnes<input data-f="qty" type="number" min="1" value="50"></label>
        <button class="secondary" data-ui="save">Save (${saved.routes.length}/${saved.max})</button></div>` : ""}
      ${loops ? `<h4>Auto-trade</h4><p class="quiet">A docked ship sails out and back on the voyage queue, buying what you choose at each end, as many times as you say.</p>
        ${loops.map(l => `<p>Ship ${l.ship}: ${l.legs.map(x => esc(portName(x.dest))).join(" → ")}, ${l.left} more loops ${l.stopped ? `<span class="neg">stopped: ${esc(l.stopped)}</span>` : ""}
          <button class="link" data-ui="stop" data-ship="${l.ship}">Stop</button></p>`).join("")}
        <div class="row labelled"><label class="mini grow">Ship<select data-f="aship">${shipOptions(s => s.dest === null)}</select></label><label class="mini grow">Out to<select data-f="afar">${portOptions()}</select></label></div>
        <div class="row labelled"><label class="mini">Buy out<select data-f="aout"><option value="">nothing</option>${goodOptions()}</select></label><label class="mini">Buy back<select data-f="aback"><option value="">nothing</option>${goodOptions()}</select></label>
        <label class="mini">Tonnes<input data-f="aqty" type="number" min="1" value="50"></label><label class="mini">Loops<input data-f="aloops" type="number" min="1" max="20" value="3"></label>
        <button data-ui="start">Start</button></div>` : ""}`, {
      refresh: routesWin,
      bind: body => {
        const f = k => body.querySelector(`[data-f=${k}]`)?.value;
        body.querySelectorAll("[data-run]").forEach(sel => sel.onchange = () => sel.value && act("ui.saved-routes", "run", { id: +sel.dataset.run, ship: +sel.value }, () => toast("Route started")));
        bindActs(body, {
          save: () => act("ui.saved-routes", "save", { from: +f("from"), dest: +f("dest"), good: f("good") || null, qty: Math.floor(+f("qty")) }, () => toast("Route saved")),
          del: el => act("ui.saved-routes", "delete", { id: +el.dataset.id }),
          stop: el => act("ui.auto-trade", "stop", { ship: +el.dataset.ship }),
          start: () => {
            const ship = me.ships.find(s => s.id === +f("aship"));
            if (!ship) return toast("Choose a docked ship", true);
            const qty = Math.floor(+f("aqty")), cap = Math.max(100, me.cash);
            const leg = (dest, good) => ({ dest, maxSpend: cap, minProceeds: 0, ...(good ? { good, qty } : {}) });
            act("ui.auto-trade", "start", { ship: ship.id, loops: Math.floor(+f("aloops")), legs: [leg(+f("afar"), f("aout")), leg(ship.port, f("aback"))] }, () => toast("Auto-trade started"));
          },
        });
      },
    });
  }

  // ------------------------------------------------------------------ notifications (151)
  function bellWin() {
    const n = mine("ui.notifications");
    if (!n) return;
    const text = x => x.kind === "docked" ? `Ship ${x.ship} docked at ${portName(x.port)}${x.qty ? ` with ${Math.round(x.qty)} ${goodName(x.good)}` : ""}`
      : x.kind === "fill" ? `Order filled: ${x.qty} ${goodName(x.good)} at ${portName(x.port)} (${fmt(x.amount)})`
      : x.kind === "forcedSale" ? `Ship ${x.ship} was sold to cover debt (${fmt(x.amount)})` : `Voyage queue on ship ${x.ship} paused: ${x.text}`;
    openWin("bell", "Notifications", n.notices.length ? `<ul>${[...n.notices].reverse().map(x => `<li><span class="quiet num">D${Math.floor(x.tick / 24) + 1} ${String(x.tick % 24).padStart(2, "0")}:00</span> ${esc(text(x))}</li>`).join("")}</ul>`
      : `<p class="quiet">Nothing yet.</p>`, { refresh: bellWin });
    if (n.unread) act("ui.notifications", "read");
  }

  // ------------------------------------------------------------------ dashboard (421) with widgets from the other modules
  const WIDGET = {
    cash: () => `<b>Cash</b> ${money(me.cash)} · worth ${money(me.worth)}`,
    fleet: () => { const sea = me.ships.filter(s => s.dest !== null).length; return `<b>Fleet</b> ${me.ships.length} ships, ${sea} at sea, ${me.ships.length - sea} in port`; },
    cargo: () => { const m = mine("ui.cargo-manifest"); return m ? `<b>Cargo</b> ${m.totals.tonnes}/${m.totals.capacity} t, worth ${money(m.totals.value)}` : ""; },
    ledger: () => { const l = mine("ui.ledger"); return l ? `<b>Ledger</b> net ${money(l.totals.net)} (trips ${money(l.totals.trips)}, upkeep ${money(l.totals.upkeep)})` : ""; },
    alerts: () => { const a = mine("ui.alerts"); return a ? `<b>Alerts</b> ${a.filter(x => x.fired !== null).length} went off of ${a.length}` : ""; },
    watchlist: () => { const w = mine("ui.watchlist"); return w?.length ? `<b>Watching</b> ${w.slice(0, 4).map(x => `${esc(portName(x.port))} ${x.good} ${x.now.toFixed(1)}`).join(", ")}` : ""; },
    planner: () => { const r = Object.values(mine("ui.planner")?.routes ?? {}).flat().sort((a, b) => b.perHour - a.perHour)[0];
      return r ? `<b>Next voyage</b> ship ${r.ship} → ${esc(portName(r.dest))}, ${money(r.profit)} in ${r.hours} h` : ""; },
    summary: () => { const d = mine("ui.daily-summary"); return d ? `<b>Yesterday</b> ${d.trips} trips, worth ${money(d.worthEnd - d.worthStart)}` : ""; },
    idle: () => { const i = Object.entries(mine("ui.idle-ships") ?? {}).filter(([, h]) => h >= 6); return i.length ? `<b class="neg">Idle</b> ${i.map(([s, h]) => `ship ${s} (${h} h)`).join(", ")}` : ""; },
    hints: () => { const h = mine("ui.hints")?.[0]; return h && mine("ui.presets")?.hints !== false ? `<b>Hint</b> ${esc(h.text)}` : ""; },
  };
  let dashEditing = false;
  function dashboardWin() {
    const d = mine("ui.dashboard");
    if (!d || !me) return;
    const body = dashEditing
      ? `<p class="quiet">Tick the widgets you want and use the arrows to order them.</p>${[...d.widgets, ...d.available.filter(w => !d.widgets.includes(w))].map(w => `<div class="row" style="margin-top:4px">
          <label class="mini" style="flex-direction:row;gap:6px"><input type="checkbox" data-w="${w}" ${d.widgets.includes(w) ? "checked" : ""} style="width:auto">${w}</label>
          <button class="link" data-ui="up" data-w="${w}">▲</button><button class="link" data-ui="down" data-w="${w}">▼</button></div>`).join("")}
          <div class="row"><button data-ui="savedash">Save</button><button class="secondary" data-ui="resetdash">Default</button><button class="link" data-ui="canceldash">Cancel</button></div>`
      : d.widgets.map(w => WIDGET[w]?.()).filter(Boolean).map(x => `<p>${x}</p>`).join("") + `<button class="link" data-ui="editdash">Customise</button>`;
    openWin("dash", "Dashboard", body, {
      refresh: () => { if (!dashEditing) dashboardWin(); },
      bind: b => {
        const order = () => [...b.querySelectorAll("input[data-w]")].filter(i => i.checked).map(i => i.dataset.w);
        const move = (w, dir) => { const rows = [...b.querySelectorAll(".row")].filter(r => r.querySelector("input[data-w]")); const i = rows.findIndex(r => r.querySelector(`input[data-w="${w}"]`));
          const j = i + dir; if (j < 0 || j >= rows.length) return; dir < 0 ? rows[j].before(rows[i]) : rows[j].after(rows[i]); };
        bindActs(b, { editdash: () => { dashEditing = true; dashboardWin(); }, canceldash: () => { dashEditing = false; dashboardWin(); },
          up: el => move(el.dataset.w, -1), down: el => move(el.dataset.w, 1),
          savedash: () => act("ui.dashboard", "set", { widgets: order() }, () => { dashEditing = false; toast("Dashboard saved"); }),
          resetdash: () => act("ui.dashboard", "reset", {}, () => { dashEditing = false; }) });
      },
    });
  }

  // ------------------------------------------------------------------ daily summary popup (435)
  function dailyPopup() {
    const d = on("ui.daily-summary") ? mine("ui.daily-summary") : null;
    if (!d || !me || (on("ui.calm") && settings.calm)) return;
    const key = `day:${world.navigationId}:${me.id}`;
    if (pref.get(key, 0) >= d.day) return;
    pref.set(key, d.day);
    const dw = d.worthEnd - d.worthStart;
    openWin("daily", `Day ${d.day} summary`, `<p>${d.trips} deliveries made ${money(d.tripProfit)}.</p><p>Cash ${money(d.cashStart)} → ${money(d.cashEnd)}.</p>
      <p>Net worth ${money(d.worthStart)} → <b class="${dw >= 0 ? "pos" : "neg"}">${money(d.worthEnd)}</b> (${dw >= 0 ? "+" : ""}${money(dw)}).</p><button data-ui="ok">Back to work</button>`,
      { bind: b => bindActs(b, { ok: () => closeWin("daily") }) });
    announce(`Day ${d.day} summary: net worth ${dw >= 0 ? "up" : "down"} ${fmt(Math.abs(dw))}`);
  }

  // ------------------------------------------------------------------ tutorial strip, starter pennant, hints (481 482 483 499 486)
  const strip = document.createElement("div");
  strip.className = "ui-strip hidden"; strip.setAttribute("role", "status");
  document.querySelector(".mapWrap")?.append(strip);
  function tutorialStrip() {
    const t = on("ui.tutorial") ? mine("ui.tutorial") : null;
    const preset = mine("ui.presets");
    if (!t || t.skipped || !t.next || (preset && preset.preset === "expert")) { strip.classList.add("hidden"); return; }
    const g = t.guide;
    strip.innerHTML = `<b>Step ${t.done + 1} of ${t.total}: ${esc(t.next.title)}</b><br>${esc(t.next.text)}
      ${g ? `<br><span class="pos">Try: ship ${g.ship} takes ${g.good ? `${g.qty} ${g.good}` : "its cargo"} to ${esc(portName(g.dest))} (≈${g.hours} h, ≈${money(g.profit)}).</span>
        <button class="secondary" data-g="1">Do it</button>` : ""} <button class="link" data-skip="1">Skip</button>`;
    strip.classList.remove("hidden");
    strip.querySelector("[data-skip]").onclick = () => act("ui.tutorial", "skip");
    const go = strip.querySelector("[data-g]");
    if (go) go.onclick = () => command({ type: "sail", company: me.id, ship: g.ship, dest: g.dest, ...(g.good ? { buy: { good: g.good, qty: g.qty } } : {}) }, () => toast("Your first delivery is under way"));
    translate(strip);
  }
  function drawPennants() {
    const pen = on("ui.starter-bonus") ? shared("ui.starter-bonus")?.pennants : null;
    if (!pen?.includes(me?.id)) return;
    ctx.save(); ctx.fillStyle = "#e5b84b"; ctx.strokeStyle = "rgba(0,0,0,.5)";
    for (const s of me.ships) {
      const p = shipPos(s); const [x, y] = P(p);
      ctx.beginPath(); ctx.moveTo(x + 8, y - 18); ctx.lineTo(x + 8, y - 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 8, y - 18); ctx.lineTo(x + 16, y - 15); ctx.lineTo(x + 8, y - 12); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ minimap (150)
  const mini = document.createElement("canvas");
  mini.id = "ui-minimap"; mini.width = 320; mini.height = 224; mini.setAttribute("aria-label", "Minimap: click to move the view"); mini.className = "hidden";
  document.querySelector(".mapWrap")?.append(mini);
  let miniFrame = 0;
  function drawMinimap() {
    const show = on("ui.minimap") && settings.minimap && !!world?.ports;
    mini.classList.toggle("hidden", !show);
    if (!show || (miniFrame++ % (settings.lowSpec ? 30 : 10))) return;
    const m = mini.getContext("2d"), k = Math.min(mini.width / MAP_W, mini.height / MAP_H);
    m.fillStyle = C["sea-deep"] || "#0a1924"; m.fillRect(0, 0, mini.width, mini.height);
    for (const p of world.ports) { m.fillStyle = C[portMain(p) ?? "other"] || "#7a98ae"; m.fillRect(p.x * k - 2, p.y * k - 2, 4, 4); }
    m.fillStyle = C.mine || "#5fd3a8";
    for (const s of me?.ships ?? []) { const q = shipPos(s); m.beginPath(); m.arc(q.x * k, q.y * k, 3.5, 0, Math.PI * 2); m.fill(); }
    const tl = toMap(0, 0), br = toMap(W, H);
    m.strokeStyle = C.ink || "#fff"; m.lineWidth = 2; m.strokeRect(tl.x * k, tl.y * k, (br.x - tl.x) * k, (br.y - tl.y) * k);
  }
  mini.addEventListener("click", ev => {
    const k = Math.min(mini.width / MAP_W, mini.height / MAP_H), r = mini.getBoundingClientRect();
    centreOn({ x: (ev.clientX - r.left) * (mini.width / r.width) / k, y: (ev.clientY - r.top) * (mini.height / r.height) / k }, Math.max(cam.z, 2));
  });
  function centreOn(p, z = Math.max(cam.z, 2.5)) { if (!p) return; cam.z = z; cam.cx = p.x; cam.cy = p.y; layout(); }

  // ------------------------------------------------------------------ heatmap (156)
  function cycleHeat() {
    const order = [null, ...GOOD_NAMES];
    save("heatGood", order[(order.indexOf(settings.heatGood) + 1) % order.length]);
    toast(settings.heatGood ? `Price heatmap: ${settings.heatGood} (blue cheap, red dear)` : "Heatmap off");
    toolbar();
  }
  function drawHeat() {
    if (!on("ui.heatmap") || !settings.heatGood || !world?.ports) return;
    const g = GOOD_NAMES.indexOf(settings.heatGood);
    const prices = world.ports.map(p => p.prices[g]), lo = Math.min(...prices), hi = Math.max(...prices);
    ctx.save();
    for (const p of world.ports) {
      const f = hi > lo ? (p.prices[g] - lo) / (hi - lo) : 0.5;
      const [x, y] = P(p), r = 26 * Math.max(1, view.scale * 0.8);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const col = `hsla(${Math.round(220 - 220 * f)}, 85%, 55%,`;
      grad.addColorStop(0, col + "0.55)"); grad.addColorStop(1, col + "0)");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ port search and zoom to fleet (429 430)
  function searchWin() {
    openWin("search", "Find a port", `<input data-q placeholder="Type a port name" aria-label="Port name" autocomplete="off"><div data-res style="margin-top:8px"></div>`, {
      bind: b => {
        const q = b.querySelector("[data-q]"), res = b.querySelector("[data-res]");
        const draw = () => {
          const t = q.value.trim().toLowerCase();
          const hits = (world?.ports ?? []).map((p, i) => ({ p, i })).filter(x => !t || x.p.name.toLowerCase().includes(t)).slice(0, 12);
          res.innerHTML = hits.map(x => `<button class="link" data-port="${x.i}" style="display:block">${esc(x.p.name)} <span class="quiet">${esc([x.p.produces.length ? "makes " + x.p.produces.join(", ") : "", x.p.consumes.length ? "needs " + x.p.consumes.join(", ") : ""].filter(Boolean).join(" · "))}</span></button>`).join("") || `<p class="quiet">No port by that name.</p>`;
          res.querySelectorAll("[data-port]").forEach(el => el.onclick = () => goPort(+el.dataset.port));
        };
        q.addEventListener("input", draw);
        q.addEventListener("keydown", ev => { if (ev.key === "Enter") res.querySelector("[data-port]")?.click(); if (ev.key === "Escape") closeWin("search"); });
        draw(); setTimeout(() => q.focus(), 0);
      },
    });
  }
  function goPort(i) { selectedPort = i; tab = "port"; closeWin("search"); render(); centreOn(world.ports[i]); }
  function zoomToFleet() {
    if (!me?.ships.length) return;
    const pts = me.ships.map(shipPos);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const z = Math.min(5, Math.max(1, Math.min(MAP_W / Math.max(60, (maxX - minX) * 1.4), MAP_H / Math.max(60, (maxY - minY) * 1.4))));
    centreOn({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, z);
  }

  // ------------------------------------------------------------------ screenshot, photo and streamer modes (437 438 439)
  function screenshot() {
    canvas.toBlob(b => b && download(`manifest-day${Math.floor((world?.tick ?? 0) / 24) + 1}.png`, b), "image/png");
  }
  function photoMode(onNow) {
    document.body.classList.toggle("ui-photo", onNow);
    layout();
    if (onNow) toast("Photo mode: drag and zoom to frame the shot. P takes a screenshot; Esc leaves.");
  }
  function streamerNames() {
    if (!on("ui.capture") || !settings.streamer || !world) return;
    const names = new Map();
    (world.leaderboard ?? []).forEach((r, i) => { if (r.name) names.set(r.name, r.id === me?.id ? "You" : `Company ${i + 1}`); });
    if (me?.name) names.set(me.name, "You");
    if (!names.size) return;
    const re = new RegExp([...names.keys()].sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    for (const root of [$("panel"), document.querySelector("header"), $("tip"), $("seasonBanner"), ...wins.values()]) {
      if (!root) continue;
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, m => names.get(m)); }
    }
  }

  // ------------------------------------------------------------------ rich tooltips (158)
  const tipObs = new MutationObserver(() => {
    const tip = $("tip");
    if (tip.classList.contains("hidden") || tip.querySelector(".ui-extra") || !world) return;
    streamerNames();
    if (!on("ui.tooltips") || mine("ui.presets")?.tooltips === "plain") return;
    const name = tip.querySelector("b")?.textContent;
    const id = world.ports.findIndex(p => p.name === name);
    if (id < 0) return;
    const rows = GOOD_NAMES.map((g, gi) => {
      let best = -1;
      world.ports.forEach((p, i) => { if (i !== id && (best < 0 || p.prices[gi] > world.ports[best].prices[gi])) best = i; });
      const here = world.ports[id].prices[gi], there = world.ports[best]?.prices[gi] ?? here;
      let tr = ""; try { tr = trend(id, gi) ?? ""; } catch { /* no history yet */ }
      return there > here * 1.05 ? `<div class="tipRow"><span>${g} sells for ${there.toFixed(1)} at ${esc(world.ports[best].name)}</span><span class="pos">+${(there - here).toFixed(1)}</span></div>` : (typeof tr === "string" && tr ? `<div class="tipRow"><span>${g}</span><span>${tr}</span></div>` : "");
    }).join("");
    const watched = (mine("ui.watchlist") ?? []).filter(w => w.port === id).map(w => w.good);
    const docked = (me?.ships ?? []).filter(s => s.dest !== null && s.dest === id).length;
    const extra = document.createElement("div"); extra.className = "ui-extra";
    extra.innerHTML = rows + (watched.length ? `<div class="tipRow"><span>★ watching ${watched.join(", ")}</span></div>` : "") +
      (docked ? `<div class="tipRow"><span class="pos">${docked} of your ships heading here</span></div>` : "") +
      (dist && me ? `<div class="tipRow quiet"><span>${Math.round(dist[me.home]?.[id] ?? 0)} sea miles from your home port</span></div>` : "");
    if (extra.innerHTML) tip.append(extra);
  });
  if ($("tip")) tipObs.observe($("tip"), { childList: true, attributes: true, attributeFilter: ["class"] });

  // ------------------------------------------------------------------ glossary and wiki (484 500)
  const GLOSSARY = [
    ["Net worth", "Cash plus what your ships and their cargo would fetch. The leaderboard ranks by it."],
    ["Hold", "How many tonnes a ship can carry. Coasters hold least, bulkers most."],
    ["Producer", "A port that makes a good. Its stock grows, so the good is cheap there."],
    ["Consumer", "A port that uses a good up. Its stock shrinks, so the good fetches more there."],
    ["Trade tax", () => `A ${Math.round((world?.rules?.tax ?? 0.07) * 100)}% tax on every purchase and sale.`],
    ["Port fee", "A fee paid on arrival at a port, set by the server."],
    ["Fuel", "Ships burn fuel on every voyage. You buy it at the port you leave, at that port's fuel price."],
    ["Upkeep", "A daily charge for every ship after your first freighter."],
    ["Voyage queue", "A list of up to three legs a ship sails by itself, buying and selling within limits you set."],
    ["Order", "A buy or sell offer you leave at a port for other players to fill."],
    ["Season", "A fixed number of game days. When it ends, trading stops and the leaderboard is final."],
    ["Game hour", "The world moves one hour at a time: prices, production and ships all advance together."],
    ["Spread", "The gap between a good's cheapest and dearest port. Bigger spreads mean bigger margins."],
    ["Idle ship", "A ship docked with an empty hold and no queue. It costs upkeep and earns nothing."],
  ];
  const WIKI = [
    ["Your first delivery", "Pick a good your home port makes (it's cheap there). Load as much as you can afford, choose a port that needs it, and set sail. When you arrive, sell. Check the estimate before you sail: fuel and fees are real costs."],
    ["How prices move", "Every port has stock of each good. Buying lowers the stock and raises the price; selling does the opposite. Producers refill stock over time, consumers use it up, so prices drift back after a big trade."],
    ["Ships", "Coasters are cheap and nimble, freighters are the all-rounders, bulkers carry the most but cost more to run. Buy ships at your home port."],
    ["Fuel and distance", "Fuel burned grows with distance and ship size. A short trip with a full hold usually beats a long trip with a half-empty one."],
    ["Orders", "Leave a buy order where a good is dear to catch sellers, or a sell order where it is scarce. Orders fill when other players trade with them."],
    ["Debt", "If cash goes below zero, daily upkeep can force the sale of a spare ship. Keep a cushion."],
    ["Seasons and the leaderboard", "Each season everyone starts fresh. Net worth at the end decides the winners."],
    ["Shortcuts", "Press ? in game for the keyboard shortcuts."],
  ];
  function wikiWin(query = "") {
    const t = query.toLowerCase();
    const val = v => (typeof v === "function" ? v() : v);
    const g = GLOSSARY.filter(([k, v]) => !t || k.toLowerCase().includes(t) || val(v).toLowerCase().includes(t));
    const w = WIKI.filter(([k, v]) => !t || k.toLowerCase().includes(t) || v.toLowerCase().includes(t));
    openWin("wiki", "Glossary and wiki", `<input data-q placeholder="Search" aria-label="Search the wiki" value="${esc(query)}">
      ${w.map(([k, v]) => `<details><summary><b>${esc(k)}</b></summary><p>${esc(v)}</p></details>`).join("")}
      <h4>Glossary</h4><dl>${g.map(([k, v]) => `<dt><b>${esc(k)}</b></dt><dd class="quiet" style="margin:0 0 6px">${esc(val(v))}</dd>`).join("")}</dl>`, {
      bind: b => { const q = b.querySelector("[data-q]"); q.addEventListener("change", () => wikiWin(q.value)); q.addEventListener("keydown", ev => ev.key === "Enter" && wikiWin(q.value)); },
    });
  }
  /** 158 + 484: glossary words in the panel get a tooltip with their meaning. */
  function glossaryTitles() {
    if (!on("ui.wiki") && !on("ui.tooltips")) return;
    for (const el of document.querySelectorAll("#panel h3, #panel h4, #panel label, #panel th, header .stat > span")) {
      if (el.title) continue;
      const hit = GLOSSARY.find(([k]) => el.textContent.toLowerCase().includes(k.toLowerCase()));
      if (hit) el.title = typeof hit[1] === "function" ? hit[1]() : hit[1];
    }
  }

  // ------------------------------------------------------------------ languages and community packs (160 495)
  const LANGS = {
    en: "English",
    es: { name: "Español", "Port": "Puerto", "Fleet": "Flota", "Orders": "Órdenes", "Opportunities": "Oportunidades", "Leaderboard": "Clasificación", "Company": "Empresa", "Cash": "Dinero",
      "Net worth": "Patrimonio", "Season clock": "Reloj de temporada", "Help": "Ayuda", "Log out": "Salir", "Settings": "Ajustes", "Dashboard": "Panel", "Plan": "Planificar",
      "Manifest": "Manifiesto", "Fleet table": "Tabla de flota", "Ledger": "Libro", "Prices": "Precios", "Routes": "Rutas", "Find port": "Buscar puerto", "My fleet": "Mi flota",
      "Screenshot": "Captura", "Photo": "Foto", "Wiki": "Wiki", "Undo": "Deshacer", "Notices": "Avisos", "Set sail": "Zarpar", "Sell": "Vender", "Buy": "Comprar", "Skip": "Saltar", "Close": "Cerrar" },
    fr: { name: "Français", "Port": "Port", "Fleet": "Flotte", "Orders": "Ordres", "Opportunities": "Opportunités", "Leaderboard": "Classement", "Company": "Compagnie", "Cash": "Trésorerie",
      "Net worth": "Valeur nette", "Season clock": "Horloge de saison", "Help": "Aide", "Log out": "Déconnexion", "Settings": "Réglages", "Dashboard": "Tableau de bord", "Plan": "Planifier",
      "Manifest": "Manifeste", "Fleet table": "Tableau de flotte", "Ledger": "Registre", "Prices": "Prix", "Routes": "Routes", "Find port": "Trouver un port", "My fleet": "Ma flotte",
      "Screenshot": "Capture", "Photo": "Photo", "Wiki": "Wiki", "Undo": "Annuler", "Notices": "Avis", "Set sail": "Appareiller", "Sell": "Vendre", "Buy": "Acheter", "Skip": "Passer", "Close": "Fermer" },
    de: { name: "Deutsch", "Port": "Hafen", "Fleet": "Flotte", "Orders": "Aufträge", "Opportunities": "Chancen", "Leaderboard": "Rangliste", "Company": "Reederei", "Cash": "Kasse",
      "Net worth": "Nettowert", "Season clock": "Saisonuhr", "Help": "Hilfe", "Log out": "Abmelden", "Settings": "Einstellungen", "Dashboard": "Übersicht", "Plan": "Planen",
      "Manifest": "Ladeliste", "Fleet table": "Flottentabelle", "Ledger": "Kassenbuch", "Prices": "Preise", "Routes": "Routen", "Find port": "Hafen suchen", "My fleet": "Meine Flotte",
      "Screenshot": "Bildschirmfoto", "Photo": "Foto", "Wiki": "Wiki", "Undo": "Rückgängig", "Notices": "Meldungen", "Set sail": "Ablegen", "Sell": "Verkaufen", "Buy": "Kaufen", "Skip": "Überspringen", "Close": "Schließen" },
    pt: { name: "Português", "Port": "Porto", "Fleet": "Frota", "Orders": "Ordens", "Opportunities": "Oportunidades", "Leaderboard": "Classificação", "Company": "Empresa", "Cash": "Caixa",
      "Net worth": "Patrimônio", "Season clock": "Relógio da temporada", "Help": "Ajuda", "Log out": "Sair", "Settings": "Definições", "Dashboard": "Painel", "Plan": "Planear",
      "Manifest": "Manifesto", "Fleet table": "Tabela da frota", "Ledger": "Livro", "Prices": "Preços", "Routes": "Rotas", "Find port": "Procurar porto", "My fleet": "A minha frota",
      "Screenshot": "Captura", "Photo": "Foto", "Wiki": "Wiki", "Undo": "Desfazer", "Notices": "Avisos", "Set sail": "Zarpar", "Sell": "Vender", "Buy": "Comprar", "Skip": "Saltar", "Close": "Fechar" },
    ga: { name: "Gaeilge", "Port": "Calafort", "Fleet": "Cabhlach", "Orders": "Orduithe", "Opportunities": "Deiseanna", "Leaderboard": "Clár na gceannairí", "Company": "Comhlacht", "Cash": "Airgead",
      "Net worth": "Glanfhiúchas", "Help": "Cabhair", "Log out": "Logáil amach", "Settings": "Socruithe", "Prices": "Praghsanna", "Set sail": "Seol", "Sell": "Díol", "Buy": "Ceannaigh", "Close": "Dún" },
  };
  const packs = {};
  async function loadPack(code) {
    if (LANGS[code] || packs[code] || !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code)) return;
    try { const r = await fetch(`features/lang/${code}.json`); if (r.ok) { const j = await r.json(); if (j && typeof j === "object") packs[code] = j; translateAll(); } } catch { /* no pack */ }
  }
  const dict = () => (settings.lang === "en" || !on("ui.languages") ? null : LANGS[settings.lang] ?? packs[settings.lang] ?? null);
  const original = new WeakMap();
  function translate(root) {
    const d = dict();
    if (!root) return;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const src = original.get(n) ?? n.nodeValue, key = src.trim();
      if (!key || key.length > 40) continue;
      const out = d && typeof d[key] === "string" ? src.replace(key, d[key]) : src;
      if (out !== n.nodeValue) { if (!original.has(n)) original.set(n, n.nodeValue); n.nodeValue = out; }
    }
  }
  function translateAll() {
    document.documentElement.lang = on("ui.languages") ? settings.lang : "en";
    for (const el of [document.querySelector("header"), $("tabs"), $("panel"), tools, strip, ...wins.values()]) translate(el);
  }

  // ------------------------------------------------------------------ settings window (152 159 160 439 440 486 488 489 494 496 497 498 150 153)
  function settingsWin() {
    const sel = (key, opts) => `<select data-set="${key}">${opts.map(([v, l]) => `<option value="${v}"${String(settings[key]) === String(v) ? " selected" : ""}>${l}</option>`).join("")}</select>`;
    const box = (key, label) => `<label class="mini" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" data-set="${key}" ${settings[key] ? "checked" : ""} style="width:auto">${label}</label>`;
    const p = mine("ui.presets");
    const parts = [];
    if (on("ui.themes")) parts.push(`<label>Theme${sel("theme", [["harbour", "Harbour (dark)"], ["light", "Light"], ["midnight", "Midnight"], ["parchment", "Parchment"], ["tropical", "Tropical"], ["contrast", "High contrast"]])}</label>`,
      `<label>Goods colours${sel("palette", [["standard", "Standard"], ["vivid", "Vivid"], ["pastel", "Pastel"]])}</label>`);
    if (on("ui.colour-blind")) parts.push(`<label>Colour-blind mode${sel("colourBlind", [["off", "Off"], ["deuteranopia", "Red-green (deuteranopia)"], ["protanopia", "Red-green (protanopia)"], ["tritanopia", "Blue-yellow (tritanopia)"]])}</label>`);
    if (on("ui.accessibility")) parts.push(`<label>Text size${sel("textScale", [[90, "90%"], [100, "100%"], [115, "115%"], [130, "130%"], [150, "150%"]])}</label>`, box("reducedMotion", "Reduced motion"));
    if (on("ui.languages")) parts.push(`<label>Language${sel("lang", [...Object.entries(LANGS).map(([c, d]) => [c, typeof d === "string" ? d : d.name]), ...Object.entries(packs).map(([c, d]) => [c, d.name ?? c])])}</label>
      <label>Community pack code<input data-pack placeholder="e.g. nl, pl, it" maxlength="8"></label>`);
    if (on("ui.minimap")) parts.push(box("minimap", "Show the minimap"));
    if (on("ui.low-spec")) parts.push(box("lowSpec", "Low-spec mode (fewer frames, sharper battery life)"));
    if (on("ui.capture")) parts.push(box("streamer", "Streamer mode (hide company names)"));
    if (on("ui.mobile")) parts.push(box("mobile", "Phone layout (panel as a bottom sheet)"));
    if (on("ui.calm")) parts.push(box("calm", "Calm mode (no leaderboard, cash flashes or popups)"),
      `<label>Break reminder${sel("remindMinutes", [[0, "Off"], [30, "Every 30 minutes"], [60, "Every hour"], [90, "Every 90 minutes"], [120, "Every 2 hours"]])}</label>`);
    if (p) parts.push(`<label>Help level (your screen only)<select data-preset>${["guided", "standard", "expert"].map(x => `<option${x === p.preset ? " selected" : ""}>${x}</option>`).join("")}</select></label>`);
    if (on("ui.tutorial") && mine("ui.tutorial")?.skipped) parts.push(`<button class="secondary" data-ui="retut">Restart the tutorial</button>`);
    if (on("ui.shortcuts")) parts.push(`<p><button class="link" data-ui="keys">Keyboard shortcuts (?)</button></p>`);
    if (on("ui.pwa") && installPrompt) parts.push(`<button data-ui="install">Install Manifest as an app</button>`);
    openWin("settings", "Settings", parts.join("") || `<p class="quiet">No display options are switched on.</p>`, {
      bind: b => {
        b.querySelectorAll("[data-set]").forEach(el => el.addEventListener("change", () => {
          const k = el.dataset.set, v = el.type === "checkbox" ? el.checked : /^\d+$/.test(el.value) ? +el.value : el.value;
          save(k, v);
          if (k === "lang") { loadPack(v); translateAll(); }
          if (k === "lowSpec") layout();
          if (k === "remindMinutes") remindAt = Date.now() + v * 60000;
        }));
        b.querySelector("[data-pack]")?.addEventListener("change", ev => { const c = ev.target.value.trim(); loadPack(c).then(() => { if (packs[c]) { save("lang", c); settingsWin(); translateAll(); } else toast("No language pack with that code yet", true); }); });
        b.querySelector("[data-preset]")?.addEventListener("change", ev => act("ui.presets", "set", { preset: ev.target.value }, () => toast(`Help level: ${ev.target.value}`)));
        bindActs(b, { keys: () => runTool("keys"), retut: () => act("ui.tutorial", "restart"), install: () => { installPrompt?.prompt(); installPrompt = null; } });
      },
    });
  }

  // ------------------------------------------------------------------ keyboard shortcuts (154)
  const KEYS = [["1–5", "Port, Fleet, Orders, Opportunities, Leaderboard"], ["+ / −", "Zoom in / out"], ["0", "Show the whole map"], ["f", "Zoom to your fleet"],
    ["/", "Find a port"], ["d", "Dashboard"], ["r", "Route planner"], ["c", "Cargo manifest"], ["t", "Fleet table"], ["l", "Ledger"], ["w", "Prices and watchlist"],
    ["o", "Routes"], ["h", "Cycle the price heatmap"], ["m", "Minimap on/off"], ["p", "Photo mode (P again: screenshot)"], ["u", "Undo"], ["g", "Wiki"], [",", "Settings"], ["?", "This list"], ["Esc", "Close windows / leave photo mode"]];
  function keysWin() { openWin("keys", "Keyboard shortcuts", `<table>${KEYS.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join("")}</table>`); }
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") {
      if (document.body.classList.contains("ui-photo")) return photoMode(false);
      const last = [...wins.keys()].pop(); if (last) closeWin(last);
      return;
    }
    if (!on("ui.shortcuts") || typing() || ev.ctrlKey || ev.metaKey || ev.altKey || !$("guide")?.classList.contains("hidden") || !$("auth")?.classList.contains("hidden")) return;
    const tabs = ["port", "fleet", "orders", "opportunities", "board"];
    if (/^[1-5]$/.test(ev.key)) { document.querySelector(`#tabs [data-tab="${tabs[+ev.key - 1]}"]:not([hidden])`)?.click(); return; }
    const photo = document.body.classList.contains("ui-photo");
    const map = { "+": () => zoomAt(W / 2, H / 2, cam.z * 1.5), "=": () => zoomAt(W / 2, H / 2, cam.z * 1.5), "-": () => zoomAt(W / 2, H / 2, cam.z / 1.5), "0": () => { cam.z = 1; layout(); },
      f: () => on("ui.map-nav") && zoomToFleet(), "/": () => on("ui.map-nav") && runTool("search"), d: () => runTool("dash"), r: () => runTool("plan"), c: () => runTool("manifest"),
      t: () => runTool("fleet"), l: () => runTool("ledger"), w: () => runTool("prices"), o: () => runTool("routes"), h: () => on("ui.heatmap") && cycleHeat(),
      m: () => on("ui.minimap") && save("minimap", !settings.minimap), p: () => on("ui.capture") && (photo ? screenshot() : photoMode(true)),
      u: () => on("ui.undo") && runTool("undo"), g: () => on("ui.wiki") && runTool("wiki"), ",": () => runTool("settings"), "?": () => runTool("keys") };
    const fn = map[ev.key];
    if (fn) { ev.preventDefault(); fn(); }
  });

  // ------------------------------------------------------------------ controller and touch (491 492)
  let padPrev = [];
  function pollPad() {
    if (!on("ui.input") || !navigator.getGamepads) return;
    const pad = [...navigator.getGamepads()].find(Boolean);
    if (!pad) return;
    const [lx = 0, ly = 0] = pad.axes, dead = v => (Math.abs(v) < 0.15 ? 0 : v);
    if (dead(lx) || dead(ly)) { cam.cx += dead(lx) * 8 / cam.z; cam.cy += dead(ly) * 8 / cam.z; layout(); }
    const pressed = pad.buttons.map(b => b.pressed), edge = i => pressed[i] && !padPrev[i];
    if (pressed[7]) zoomAt(W / 2, H / 2, cam.z * 1.02);   // right trigger
    if (pressed[6]) zoomAt(W / 2, H / 2, cam.z / 1.02);   // left trigger
    const focusables = () => [...document.querySelectorAll("#tabs button:not([hidden]), #panel button, #panel select, #panel input, .ui-win button")];
    const step = d => { const els = focusables(), i = els.indexOf(document.activeElement); els[(i + d + els.length) % els.length]?.focus(); };
    if (edge(12) || edge(14)) step(-1);   // d-pad up / left
    if (edge(13) || edge(15)) step(1);    // d-pad down / right
    if (edge(0)) document.activeElement?.click?.();   // A
    if (edge(1)) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));   // B
    if (edge(4)) document.querySelector("#tabs button.on")?.previousElementSibling?.click();   // LB
    if (edge(5)) document.querySelector("#tabs button.on")?.nextElementSibling?.click();       // RB
    if (edge(3)) zoomToFleet();   // Y
    if (edge(9)) runTool("settings");   // Start
    padPrev = pressed;
  }
  window.addEventListener("gamepadconnected", () => on("ui.input") && toast("Controller connected: left stick pans, triggers zoom, d-pad moves between buttons, A presses, B closes."));
  let lastTap = 0, swipe = null;
  canvas.addEventListener("pointerup", ev => {
    if (!on("ui.input") || ev.pointerType !== "touch") return;
    const now = performance.now();
    if (now - lastTap < 300) zoomAt(ev.offsetX, ev.offsetY, cam.z * 1.8);   // double tap zooms in
    lastTap = now;
  });
  const aside = document.querySelector("aside");
  aside?.addEventListener("touchstart", ev => { swipe = ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null; }, { passive: true });
  aside?.addEventListener("touchend", ev => {
    if (!on("ui.input") || !swipe) return;
    const t = ev.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2 && !typing()) {
      const cur = document.querySelector("#tabs button.on");
      let next = dx < 0 ? cur?.nextElementSibling : cur?.previousElementSibling;
      while (next?.hidden) next = dx < 0 ? next.nextElementSibling : next.previousElementSibling;
      next?.click();
    }
  }, { passive: true });
  // 153 phone layout: tapping the tab bar folds the bottom sheet away so the map is free.
  $("tabs")?.addEventListener("dblclick", () => { if (on("ui.mobile") && settings.mobile) aside.classList.toggle("ui-folded"); });

  // ------------------------------------------------------------------ installable offline-friendly app (493)
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", ev => { if (!on("ui.pwa")) return; ev.preventDefault(); installPrompt = ev; });
  let pwaDone = false;
  function setupPwa() {
    if (pwaDone || !on("ui.pwa")) return;
    pwaDone = true;
    if (!document.querySelector('link[rel="manifest"]')) { const l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.webmanifest"; document.head.append(l); }
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => { /* not over https: plain web page */ });
  }

  // ------------------------------------------------------------------ loading-screen tips (485)
  const TIPS = ["Ports that make a good sell it cheap; ports that need it pay more.", "A full hold on a short trip often beats a long trip half empty.",
    "Fuel is bought where you leave, at that port's price.", "Your ships keep sailing while you're away.", "Every price is set by what players buy and sell.",
    "Prices drift back after a big trade, so a busy route cools down.", "Upkeep is charged daily: an idle ship still costs money.",
    "Buy orders let other players bring cargo to you.", "Check the estimate before you sail: fuel and fees are real costs.", "Press ? for keyboard shortcuts."];
  const tipBox = document.createElement("div");
  tipBox.className = "ui-tipbox hidden"; tipBox.setAttribute("role", "status");
  document.body.append(tipBox);
  function showTipBox() {
    if (!on("ui.tips") && world) return;
    tipBox.innerHTML = `<div><b>Loading the harbour…</b><span class="quiet">Tip: ${esc(TIPS[Math.floor(Math.random() * TIPS.length)])}</span></div>`;
    tipBox.classList.remove("hidden");
  }
  // Tips show on first load (before the server says which modules are on) and again on reconnects if the module is on.
  if (!world) showTipBox();
  setTimeout(() => tipBox.classList.add("hidden"), 8000);
  const connObs = new MutationObserver(() => {
    const state = $("conn").textContent;
    if (state === "reconnecting" && on("ui.tips") && $("auth").classList.contains("hidden")) showTipBox();
    if (state === "live") setTimeout(() => tipBox.classList.add("hidden"), 600);
  });
  if ($("conn")) connObs.observe($("conn"), { childList: true, characterData: true, subtree: true });

  // ------------------------------------------------------------------ session reminders (498)
  const startedAt = Date.now();
  let remindAt = Date.now() + (settings.remindMinutes || 0) * 60000;
  setInterval(() => {
    if (!on("ui.calm") || !settings.remindMinutes || Date.now() < remindAt) return;
    remindAt = Date.now() + settings.remindMinutes * 60000;
    const mins = Math.round((Date.now() - startedAt) / 60000);
    const text = `You've been playing for ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}. Your ships keep sailing while you take a break.`;
    toast(text, "warn"); announce(text);
  }, 30000);

  // ------------------------------------------------------------------ screen reader labels (490)
  let lastCashSaid = null;
  function screenReader() {
    if (!on("ui.accessibility") || !world) return;
    const sea = me ? me.ships.filter(s => s.dest !== null).length : 0;
    canvas.setAttribute("aria-label", `Map of ${world.ports.length} ports. ${me ? `You have ${me.ships.length} ships, ${sea} at sea.` : ""} Selected port: ${portName(selectedPort)}.`);
    canvas.setAttribute("role", "img");
    for (const el of document.querySelectorAll("#panel button, #panel input, #panel select, .ui-win button")) {
      if (el.getAttribute("aria-label") || el.textContent.trim().length > 1 && el.tagName === "BUTTON") continue;
      const label = el.title || el.closest("label")?.textContent?.trim() || el.placeholder || el.dataset.act || el.dataset.field;
      if (label) el.setAttribute("aria-label", label.slice(0, 60));
    }
    if (me) { const c = Math.round(me.cash); if (lastCashSaid !== null && Math.abs(c - lastCashSaid) >= 1) announce(`Cash ${fmt(c)}`); lastCashSaid = c; }
  }

  // ------------------------------------------------------------------ hooks
  ManifestHooks.on("state", () => {
    tipBox.classList.add("hidden");
    toolbar(); applyLook(); setupPwa(); checkAlerts(); dailyPopup(); tutorialStrip(); refreshWins(); screenReader();
  });
  ManifestHooks.on("render", () => { decorateShipCards(); glossaryTitles(); translateAll(); streamerNames(); });
  ManifestHooks.on("draw", () => { if (!world) return; drawHeat(); drawPennants(); drawMinimap(); pollPad(); });
  window.ManifestUI = { openWin, closeWin, settings, runTool };   // for other category scripts and the console
})();
