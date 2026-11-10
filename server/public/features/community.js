// Client code for the community feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, command, toast, render, esc, fmt, ctx, P, shipPos, $).
// - Community panel (button under the map's zoom controls): locker preview, unlock codes, port dedications,
//   invite tag, wiki, speedrun and tester boards, share-my-fleet image, public stats and links.
// - Map: other companies' and your own cosmetics (wake style and colour, mast flag), your home port's banner and crane.
// - Audio: your horn sounds when one of your ships leaves port (mute switch in the panel; WebAudio, no files).
(() => {
  const ID = id => `community.${id}`;
  const on = id => ManifestHooks.enabled(ID(id));
  const mine = id => me?.featureData?.[ID(id)];
  const pub = id => world?.featureData?.[ID(id)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`community.${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`community.${k}`, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  const GOODS = ["grain", "fuel", "ore", "machinery"];
  const send = (module, action, fields = {}, done) => command({ type: "feature", module: ID(module), action, ...fields }, done);

  // ---------------------------------------------------------------- codes: only a hash leaves the browser
  // Must match server/src/features/community/content.ts (normaliseCode, codeProof).
  async function codeProof(code) {
    const norm = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`manifest-code-v1:${norm}`));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // ---------------------------------------------------------------- drawing helpers (shared by map, preview, share card)
  function drawFlag(c, item, x, y, w, h) {
    const [a, b = a] = item?.colors ?? ["#2c6fb7", "#f4f1e8"];
    c.save(); c.fillStyle = a; c.fillRect(x, y, w, h); c.fillStyle = b;
    switch (item?.style) {
      case "diagonal": c.beginPath(); c.moveTo(x, y + h); c.lineTo(x + w, y); c.lineTo(x + w, y + h); c.fill(); break;
      case "border": c.fillRect(x, y, w, h); c.fillStyle = a; c.fillRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6); break;
      case "quarter": c.fillRect(x, y, w / 2, h / 2); break;
      case "cross": c.fillRect(x + w * 0.4, y, w * 0.2, h); c.fillRect(x, y + h * 0.4, w, h * 0.2); break;
      case "swallow": c.fillStyle = "rgba(0,0,0,0)"; c.globalCompositeOperation = "destination-out"; c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w * 0.7, y + h / 2); c.lineTo(x + w, y + h); c.fill(); c.globalCompositeOperation = "source-over"; c.fillStyle = b; c.fillRect(x, y + h * 0.35, w * 0.6, h * 0.3); break;
      default: c.fillRect(x, y + h / 2, w, h / 2);
    }
    c.restore();
  }
  function drawShip(c, look, x, y, s) {
    const [hull, trim] = look.skin?.colors ?? ["#c9d3da", "#0a1620"];
    c.save(); c.translate(x, y); c.scale(s, s);
    // wake
    const wake = look.wake;
    if (wake) { c.strokeStyle = wake.colors[0]; c.lineWidth = 3; c.setLineDash(wake.style === "dotted" ? [3, 4] : []);
      c.beginPath(); c.moveTo(-60, 6); c.lineTo(-130, wake.style === "double" ? -2 : 6); if (wake.style === "double") { c.moveTo(-60, 10); c.lineTo(-130, 18); } c.stroke(); c.setLineDash([]); }
    // hull
    c.fillStyle = hull; c.beginPath(); c.moveTo(-60, -6); c.lineTo(60, -6); c.lineTo(48, 14); c.lineTo(-56, 14); c.closePath(); c.fill();
    c.fillStyle = trim; c.fillRect(-58, 8, 110, 4);
    const pat = look.pattern;
    if (pat) { c.fillStyle = pat.colors[0];
      if (pat.style === "chevron") for (let i = -40; i < 40; i += 16) { c.beginPath(); c.moveTo(i, -4); c.lineTo(i + 6, 3); c.lineTo(i, 10); c.lineTo(i + 3, 3); c.fill(); }
      else if (pat.style === "checker") for (let i = -54; i < 50; i += 8) c.fillRect(i, (i / 8) % 2 ? -4 : 2, 4, 5);
      else if (pat.style === "dazzle") for (let i = -50; i < 50; i += 18) { c.beginPath(); c.moveTo(i, -6); c.lineTo(i + 12, -6); c.lineTo(i + 2, 12); c.fill(); }
      else if (pat.style === "dots" || pat.style === "waves") for (let i = -50; i < 46; i += 10) { c.beginPath(); c.arc(i, 3, 2, 0, 7); c.fill(); }
      else c.fillRect(-56, 1, 104, 3);
    }
    // superstructure and funnel
    c.fillStyle = "#e8eef2"; c.fillRect(-40, -20, 30, 14);
    const [f1, f2 = f1] = look.funnel?.colors ?? ["#151515", "#151515"];
    c.fillStyle = f1; c.fillRect(-30, -36, 12, 16); c.fillStyle = f2;
    if (look.funnel?.style === "twin") { c.fillRect(-30, -32, 12, 2); c.fillRect(-30, -27, 12, 2); } else if (look.funnel?.style !== "plain") c.fillRect(-30, -31, 12, 4);
    // mast and flag
    c.fillStyle = "#8aa3b5"; c.fillRect(20, -40, 2, 34);
    drawFlag(c, look.flag, 22, -40, 16, 10);
    if (look.logo) { c.fillStyle = look.logo.colors[0]; c.font = "bold 10px sans-serif"; c.fillText(LOGO_GLYPH[look.logo.style] ?? "*", 30, 6); }
    c.restore();
  }
  const LOGO_GLYPH = { anchor: "⚓", gull: "v", star: "★", wheel: "☸", fish: "≻", cog: "⚙", compass: "✦", crown: "♛", heart: "♥", handshake: "∞", stopwatch: "◷" };

  // ---------------------------------------------------------------- map layer
  ManifestHooks.on("draw", () => {
    if (!world || !on("locker")) return;
    const looks = pub("locker") || {};
    for (const s of world.ships) {
      const look = looks[s.owner];
      if (!look || s.dest === null) continue;
      const pos = shipPos(s), [x, y] = P(pos);
      if (look.wake) {
        const col = look.wake.colors[0], back = (k) => [x - Math.cos(pos.angle) * k, y - Math.sin(pos.angle) * k];
        ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = look.wake.style === "glow" ? 4 : 2;
        if (look.wake.style === "glow") { ctx.shadowColor = col; ctx.shadowBlur = 8; }
        if (look.wake.style === "dotted" || look.wake.style === "sparkle") ctx.setLineDash([2, 4]);
        if (look.wake.style === "rainbow") { const [ex, ey] = back(26), g = ctx.createLinearGradient(x, y, ex, ey);
          ["#e05a6a", "#f0c64a", "#5fd3a8", "#4cc3d9", "#7b5cc4"].forEach((c, i) => g.addColorStop(i / 4, c)); ctx.strokeStyle = g; }
        const [ex, ey] = back(26); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
        if (look.wake.style === "sparkle") { ctx.fillStyle = col; const t = performance.now() / 300; for (let i = 1; i < 4; i++) { const [sx, sy] = back(i * 7); ctx.fillRect(sx + Math.sin(t + i) * 2, sy, 1.5, 1.5); } }
        ctx.restore();
      }
      if (look.flag) drawFlag(ctx, look.flag, x + 3, y - 14, 7, 5);
    }
    // Your home port: banner and crane colours.
    const myLook = me && looks[me.id];
    if (myLook && (myLook.banner || myLook.crane)) {
      const port = world.ports[me.home], [px, py] = P(port);
      if (myLook.banner) { ctx.fillStyle = "#8aa3b5"; ctx.fillRect(px - 16, py - 22, 1.5, 16); drawFlag(ctx, myLook.banner, px - 14.5, py - 22, 6, 9); }
      if (myLook.crane) { const [a, b] = myLook.crane.colors; ctx.strokeStyle = a; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px + 13, py - 4); ctx.lineTo(px + 13, py - 18); ctx.lineTo(px + 22, py - 18); ctx.stroke(); ctx.strokeStyle = b; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px + 21, py - 18); ctx.lineTo(px + 21, py - 12); ctx.stroke(); }
    }
  });

  // ---------------------------------------------------------------- horn sounds
  let audio = null;
  function horn(style) {
    if (store.get("muted", false)) return;
    try { audio ??= new AudioContext(); } catch { return; }
    const tones = { classic: [[196, 0, 0.5], [262, 0.5, 0.5]], foghorn: [[82, 0, 1.4]], toot: [[392, 0, 0.12], [392, 0.2, 0.12]],
      steam: [[880, 0, 0.6], [988, 0, 0.6]], chime: [[1046, 0, 0.3], [1318, 0.25, 0.3], [1568, 0.5, 0.4]] }[style] ?? [[196, 0, 0.5]];
    const t0 = audio.currentTime;
    for (const [f, at, len] of tones) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = style === "chime" ? "sine" : "sawtooth"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(0.06, t0 + at + 0.03); g.gain.linearRampToValueAtTime(0, t0 + at + len);
      o.connect(g).connect(audio.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.05);
    }
  }
  const atSea = new Map();
  ManifestHooks.on("state", (w, m) => {
    if (!m?.ships) return;
    const style = w?.featureData?.[ID("locker")]?.[m.id]?.horn?.style;
    for (const s of m.ships) {
      if (atSea.has(s.id) && !atSea.get(s.id) && s.dest !== null && style) horn(style);
      atSea.set(s.id, s.dest !== null);
    }
  });

  // ---------------------------------------------------------------- Community panel
  let panel = null, section = store.get("section", "locker");
  const SECTIONS = [["locker", "Locker", "locker"], ["codes", "Codes", "codes"], ["dedicate", "Dedicate", "dedications"], ["invite", "Invite", "referrals"],
    ["wiki", "Wiki", "wiki"], ["boards", "Boards", null], ["share", "Share", "share-fleet"], ["links", "Links", null]];

  function ensureButton() {
    if ($("communityButton") || !document.body) return;
    const b = document.createElement("button");
    b.id = "communityButton"; b.className = "secondary"; b.textContent = "Community"; b.title = "Cosmetics, codes, wiki and more";
    b.setAttribute("aria-haspopup", "dialog");
    Object.assign(b.style, { position: "fixed", left: "12px", bottom: "12px", zIndex: 30 });
    b.addEventListener("click", () => open(true));
    document.body.appendChild(b);
  }
  function open(show) {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "communityPanel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Community");
      Object.assign(panel.style, { position: "fixed", left: "12px", bottom: "56px", width: "min(420px, calc(100vw - 24px))", maxHeight: "70vh", overflow: "auto",
        background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: "10px", padding: "12px", zIndex: 31, boxShadow: "0 8px 30px rgba(0,0,0,.4)" });
      panel.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });
      document.body.appendChild(panel);
    }
    panel.hidden = !show;
    if (show) { draw(); panel.querySelector("button")?.focus(); } else $("communityButton")?.focus();
  }
  const visible = () => panel && !panel.hidden;

  function draw() {
    if (!visible()) return;
    const tabs = SECTIONS.filter(([, , mod]) => !mod || on(mod));
    if (!tabs.some(t => t[0] === section)) section = tabs[0]?.[0] ?? "links";
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong>Community</strong>
      <span><label style="font-size:12px"><input type="checkbox" id="cmMute" ${store.get("muted", false) ? "checked" : ""}> Mute horns</label>
      <button class="link" id="cmClose" aria-label="Close">✕</button></span></div>
      <div role="tablist" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${tabs.map(([k, label]) =>
        `<button role="tab" class="${k === section ? "" : "secondary"}" data-sec="${k}" aria-selected="${k === section}" style="padding:4px 8px">${label}</button>`).join("")}</div>
      <div id="cmBody">${me || ["boards", "links", "wiki"].includes(section) ? body() : "<p>Sign in to use this.</p>"}</div>`;
    panel.querySelector("#cmClose").onclick = () => open(false);
    panel.querySelector("#cmMute").onchange = e => store.set("muted", e.target.checked);
    panel.querySelectorAll("[data-sec]").forEach(b => b.onclick = () => { section = b.dataset.sec; store.set("section", section); draw(); });
    wire();
  }

  const portOptions = () => world.ports.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("");
  function body() {
    switch (section) {
      case "locker": {
        const v = mine("locker"); if (!v) return "<p>Locker unavailable.</p>";
        return `<canvas id="cmPreview" width="360" height="120" style="width:100%;background:var(--sea);border-radius:8px"></canvas>
          <p class="quiet" style="font-size:12px">You own ${v.owned.length} cosmetics. Change them in Opportunities → Cosmetic locker; they only change looks.
          ${v.naming ? `<br>Dedication tokens: ${v.naming}.` : ""}${v.points ? ` Tester points: ${v.points}.` : ""}</p>
          ${(pub("seasonal") ?? []).length ? `<p><strong>Claim now:</strong> ${pub("seasonal").map(s => esc(s.name)).join(", ")} (see Opportunities)</p>` : ""}`;
      }
      case "codes":
        return `<p style="font-size:13px">Got a code from a supporter pack, the soundtrack, a Discord event or a bug report? Enter it here.
          Only a fingerprint of the code is sent, never the code itself.</p>
          <form id="cmCode"><input id="cmCodeIn" autocomplete="off" maxlength="40" placeholder="ABCD-EFGH-JKLM" aria-label="Unlock code" style="width:60%"> <button>Redeem</button></form>
          ${(mine("codes")?.lastGrant ?? []).length ? `<p>Last unlocked: ${mine("codes").lastGrant.map(esc).join(", ")}</p>` : ""}`;
      case "dedicate": {
        const tokens = mine("locker")?.naming ?? 0, list = pub("dedications") ?? [];
        return `<p style="font-size:13px">A dedication token names a quay at a port for the season. You have ${tokens}.</p>
          ${tokens ? `<form id="cmDedicate"><select id="cmDedPort" aria-label="Port">${portOptions()}</select>
            <input id="cmDedName" maxlength="24" placeholder="Quay name" aria-label="Quay name"> <button>Dedicate</button></form>` : ""}
          ${list.length ? `<ul>${list.map(d => `<li>${esc(world.ports[d.port]?.name)}: <strong>${esc(d.name)}</strong> (${esc(d.by)})</li>`).join("")}</ul>` : "<p>No dedications yet.</p>"}`;
      }
      case "invite": {
        const v = mine("referrals"); if (!v) return "";
        return `<p>Your invite tag: <strong style="font-family:var(--mono, monospace)">${esc(v.tag)}</strong>
          <button class="secondary" id="cmCopyTag" style="padding:2px 8px">Copy</button></p>
          <p style="font-size:13px">Friends who enter it before their first finished voyage count once they finish three. Qualified: ${v.qualified}. Rewards are cosmetic.</p>
          ${v.invitedBy ? `<p>Invited by ${esc(v.invitedBy)}.</p>` : v.canEnter ? `<form id="cmTag"><input id="cmTagIn" maxlength="12" placeholder="SHIP-ABC234" aria-label="Friend's tag"> <button>Enter</button></form>` : ""}`;
      }
      case "wiki": return wikiBody();
      case "boards": {
        const runs = pub("speedruns"), testers = pub("testers");
        return (runs ? `<h4>Speedruns</h4>${runs.map(r => `<p><strong>${esc(r.name)}</strong> — ${esc(r.goal)} (par ${r.par} h)<br>${r.best.length
          ? r.best.map((b, i) => `${i + 1}. ${esc(b.name)} ${b.hours} h`).join(" · ") : "<span class='quiet'>No times yet</span>"}</p>`).join("")}` : "")
          + (testers ? `<h4>Testers</h4>${testers.length ? `<ol>${testers.map(t => `<li>${esc(t.name)} — ${t.points} pts</li>`).join("")}</ol>` : "<p>No tester points yet.</p>"}` : "")
          + (pub("stats") ? `<p><a href="features/community-stats.html" target="_blank" rel="noopener">Public season stats</a></p>` : "");
      }
      case "share":
        return `<canvas id="cmShare" width="600" height="315" style="width:100%;border-radius:8px"></canvas>
          <p><button id="cmShareSave">Download image</button> <button class="secondary" id="cmShareCopy">Copy image</button></p>`;
      case "links": {
        const links = pub("links") ?? [];
        return links.length ? `<ul>${links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></li>`).join("")}</ul>
          <p class="quiet" style="font-size:12px">Purchases happen on those sites, never in the game. Supporters receive an unlock code.</p>` : "<p>No links yet.</p>";
      }
    }
    return "";
  }

  // Wiki: facts from the game's own data, plus player tips.
  let wikiPage = store.get("wikiPage", "guide:starting");
  const GUIDES = { starting: "Getting started", trading: "Trading", orders: "Buy and sell orders", pirates: "Pirates", seasons: "Seasons" };
  const GUIDE_TEXT = {
    starting: "Buy cargo where it is produced (cheap), sail it to a port that consumes it (dear), and sell. Fuel and port fees come off every voyage.",
    trading: "Prices move with stock: every tonne you sell pushes the price down there, every tonne bought pushes it up. Watch inbound cargo before you commit.",
    orders: "Buy and sell orders wait at a port and fill while you are away. Buy orders hold your cash in escrow.",
    pirates: "Pirates raid loaded ships at sea. Ports near your home are safer; police patrol some lanes.",
    seasons: "A season lasts a fixed number of days. The leaderboard ranks net worth; everything resets for the next season.",
  };
  function wikiFacts(page) {
    const [kind, key] = page.split(":");
    if (kind === "guide") return `<h4>${esc(GUIDES[key])}</h4><p>${esc(GUIDE_TEXT[key])}</p>`;
    if (kind === "port") { const p = world.ports[+key]; if (!p) return "";
      return `<h4>${esc(p.name)}</h4><p>Produces: ${p.produces.map(esc).join(", ") || "nothing"}. Consumes: ${p.consumes.map(esc).join(", ") || "nothing"}.</p>
        <p>Prices now: ${GOODS.map((g, i) => `${g} ${fmt(p.prices[i])}`).join(", ")}.</p>`; }
    if (kind === "good") { const g = world.goods[+key], band = world.rules.bands[g];
      return `<h4>${esc(g)}</h4><p>Price limits ${fmt(band.floor)}–${fmt(band.ceiling)}. Made at: ${world.ports.filter(p => p.produces.includes(g)).map(p => esc(p.name)).join(", ") || "nowhere"}.</p>`; }
    if (kind === "ship") { const s = world.rules.shipTypes[key]; if (!s) return "";
      return `<h4>${esc(key)}</h4><p>Hold ${fmt(s.capacity)} t, speed ${s.speed_per_hour}/h, ${s.fuel_per_100_distance} fuel per 100, price ${fmt(s.price)}, upkeep ${fmt(s.upkeep)} a day.</p>`; }
    return "";
  }
  function wikiBody() {
    const pages = [...Object.entries(GUIDES).map(([k, n]) => [`guide:${k}`, `Guide: ${n}`]), ...world.ports.map((p, i) => [`port:${i}`, `Port: ${p.name}`]),
      ...world.goods.map((g, i) => [`good:${i}`, `Good: ${g}`]), ...Object.keys(world.rules.shipTypes).map(t => [`ship:${t}`, `Ship: ${t}`])];
    const tips = pub("wiki")?.pages?.[wikiPage] ?? [];
    const outside = (pub("links") ?? []).find(l => l.key === "wiki");
    return `<select id="cmWikiPage" aria-label="Wiki page" style="width:100%">${pages.map(([k, n]) => `<option value="${k}" ${k === wikiPage ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      ${wikiFacts(wikiPage)}
      <h4>Player tips</h4>${tips.length ? tips.map(t => `<p style="font-size:13px">“${esc(t.text)}” — ${esc(t.by)} (${t.votes} ▲)
        ${me ? `<button class="link" data-vote="${t.id}">▲ Helpful</button> <button class="link" data-flag="${t.id}">Flag</button>` : ""}</p>`).join("") : "<p class='quiet'>No tips yet.</p>"}
      ${me ? `<form id="cmTip"><input id="cmTipIn" maxlength="140" placeholder="Add a tip (plain text, 140 characters)" aria-label="Tip" style="width:75%"> <button>Add</button></form>` : ""}
      ${outside ? `<p><a href="${esc(outside.url)}" target="_blank" rel="noopener noreferrer">Full community wiki</a></p>` : ""}`;
  }

  function wire() {
    const q = s => panel.querySelector(s);
    const preview = q("#cmPreview");
    if (preview) { const c = preview.getContext("2d"); c.clearRect(0, 0, 360, 120); drawShip(c, pub("locker")?.[me.id] ?? {}, 200, 70, 1.2); }
    q("#cmCode")?.addEventListener("submit", async e => {
      e.preventDefault(); const code = q("#cmCodeIn").value.trim(); if (!code) return;
      if (!crypto?.subtle) return toast("Codes need a secure (https) connection.", true);
      send("codes", "redeem", { proof: await codeProof(code) }, () => { toast("Code accepted"); q("#cmCodeIn").value = ""; });
    });
    q("#cmDedicate")?.addEventListener("submit", e => { e.preventDefault(); send("dedications", "dedicate", { port: +q("#cmDedPort").value, name: q("#cmDedName").value }, () => toast("Quay dedicated")); });
    q("#cmTag")?.addEventListener("submit", e => { e.preventDefault(); send("referrals", "enterTag", { tag: q("#cmTagIn").value }, () => toast("Thanks! Your friend will be credited.")); });
    q("#cmCopyTag")?.addEventListener("click", () => navigator.clipboard?.writeText(mine("referrals").tag).then(() => toast("Tag copied")));
    q("#cmWikiPage")?.addEventListener("change", e => { wikiPage = e.target.value; store.set("wikiPage", wikiPage); draw(); });
    q("#cmTip")?.addEventListener("submit", e => { e.preventDefault(); send("wiki", "tip", { page: wikiPage, text: q("#cmTipIn").value }, () => toast("Tip added")); });
    panel.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => send("wiki", "vote", { tip: +b.dataset.vote }));
    panel.querySelectorAll("[data-flag]").forEach(b => b.onclick = () => send("wiki", "flag", { tip: +b.dataset.flag }, () => toast("Flagged for review")));
    const share = q("#cmShare");
    if (share) {
      drawShareCard(share);
      q("#cmShareSave").onclick = () => { const a = document.createElement("a"); a.download = "my-manifest-fleet.png"; a.href = share.toDataURL("image/png"); a.click(); };
      q("#cmShareCopy").onclick = () => share.toBlob(b => navigator.clipboard?.write?.([new ClipboardItem({ "image/png": b })]).then(() => toast("Image copied"), () => toast("Copy not supported here", true)));
    }
  }

  // Idea 188: the share card (1200x630 aspect, drawn at 600x315).
  function drawShareCard(cv) {
    const v = mine("share-fleet"); if (!v) return;
    const c = cv.getContext("2d"), look = v.look ?? {};
    const g = c.createLinearGradient(0, 0, 0, 315); g.addColorStop(0, "#0e2130"); g.addColorStop(1, "#0a1620");
    c.fillStyle = g; c.fillRect(0, 0, 600, 315);
    const [plateBg, plateInk] = look.plate?.colors ?? ["#0a1620", "#e8eef2"];
    c.fillStyle = plateBg; c.fillRect(24, 22, 552, 46); c.strokeStyle = plateInk; c.strokeRect(24.5, 22.5, 551, 45);
    c.fillStyle = plateInk; c.font = "bold 24px sans-serif"; c.fillText(v.name, 38, 54);
    if (look.flag) drawFlag(c, look.flag, 530, 33, 32, 22);
    c.fillStyle = "#e8eef2"; c.font = "15px sans-serif";
    c.fillText(`Day ${v.day} of ${v.seasonDays} · home port ${v.home}`, 30, 98);
    c.font = "bold 30px sans-serif"; c.fillText(`Net worth ${fmt(v.worth)}`, 30, 140);
    c.font = "15px sans-serif"; c.fillStyle = "#8aa3b5";
    const counts = {}; for (const s of v.ships) counts[s.type] = (counts[s.type] ?? 0) + 1;
    c.fillText(`Fleet: ${Object.entries(counts).map(([t, n]) => `${n} ${t}${n > 1 ? "s" : ""}`).join(", ")}`, 30, 168);
    c.fillText(`Last ${v.recentVoyages} voyages: ${v.recentProfit >= 0 ? "+" : ""}${fmt(v.recentProfit)} profit`, 30, 190);
    v.ships.slice(0, 4).forEach((s, i) => drawShip(c, look, 110 + i * 130, 260, 0.75));
    if (look.badge) { c.fillStyle = look.badge.colors[0]; c.font = "bold 13px sans-serif"; c.fillText(`★ ${look.badge.name}`, 420, 98); }
    c.fillStyle = "#5d788c"; c.font = "12px sans-serif"; c.fillText("MANIFEST — a shipping trade game", 400, 305);
  }

  ManifestHooks.on("state", () => { ensureButton(); if (visible() && !panel.contains(document.activeElement?.tagName === "INPUT" ? document.activeElement : null)) draw(); });
  if (typeof window !== "undefined") window.ManifestCommunity = { codeProof, drawShip, drawFlag };
})();
