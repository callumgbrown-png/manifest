// Client code for the social feature modules. Uses ManifestHooks (features/api.js) and app.js globals
// (world, me, command, toast, esc, fmt, ctx, P, shipPos, $).
// Most social actions are cards in the Opportunities tab. This file adds what cards can't do (typed text: guild
// names, chat, recruitment pitches, newspaper stories, mottos, court statements) in a Social panel, and draws
// guild flags at guild-held ports and HQs, formations, megaproject sites and signals on the map.
(() => {
  const ID = id => `social.${id}`;
  const on = id => ManifestHooks.enabled(ID(id));
  const pub = id => world?.featureData?.[ID(id)];
  const mine = id => me?.featureData?.[ID(id)];
  const send = (module, action, fields = {}, done) => command({ type: "feature", module: ID(module), action, ...fields }, done);

  // ---------------------------------------------------------------- map layer
  ManifestHooks.on("draw", () => {
    if (!world) return;
    const guilds = new Map((pub("guilds") ?? []).map(g => [g.id, g]));
    const flag = (g, x, y) => { ctx.fillStyle = "#8aa3b5"; ctx.fillRect(x, y, 1.5, 12); ctx.fillStyle = g.flag[0]; ctx.fillRect(x + 1.5, y, 9, 6); ctx.fillStyle = g.flag[1]; ctx.fillRect(x + 1.5, y + 3, 9, 3); };
    for (const h of pub("guild-ports") ?? []) { const g = guilds.get(h.guild), p = world.ports[h.port]; if (!g || !p) continue; const [x, y] = P(p); flag(g, x + 8, y - 22); }
    for (const g of guilds.values()) if (g.hq !== null && world.ports[g.hq]) {
      const [x, y] = P(world.ports[g.hq]); ctx.strokeStyle = g.flag[0]; ctx.lineWidth = 1.5; ctx.strokeRect(x - 9, y - 9, 18, 18);
    }
    for (const p of pub("megaprojects") ?? []) { const port = world.ports[p.port]; if (!port) continue; const [x, y] = P(port);
      ctx.font = "11px sans-serif"; ctx.fillStyle = p.done !== null ? "#f0c64a" : "#8aa3b5"; ctx.fillText(p.done !== null ? "★" : "⚒", x - 18, y - 8); }
    const signals = pub("signals") ?? {};
    const formation = new Set((pub("formations")?.active ?? []).flatMap(f => f.ships));
    for (const s of world.ships) {
      if (s.dest === null || (!signals[s.id] && !formation.has(s.id))) continue;
      const [x, y] = P(shipPos(s));
      if (formation.has(s.id)) { ctx.strokeStyle = "rgba(95,211,168,.7)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (signals[s.id]) { ctx.font = "600 10px sans-serif"; ctx.fillStyle = "#e8eef2"; ctx.fillText(signals[s.id], x + 8, y - 8); }
    }
  });

  // ---------------------------------------------------------------- Social panel
  let panel = null, section = "guild";
  const SECTIONS = [["guild", "Guild", "guilds"], ["chat", "Chat", "guild-chat"], ["news", "News", "newspapers"], ["civic", "Port & courts", null], ["public", "Public", null]];
  function ensureButton() {
    if ($("socialButton") || !document.body || !SECTIONS.some(([, , m]) => !m || on(m))) return;
    const b = document.createElement("button");
    b.id = "socialButton"; b.className = "secondary"; b.textContent = "Social"; b.setAttribute("aria-haspopup", "dialog");
    Object.assign(b.style, { position: "fixed", left: "120px", bottom: "12px", zIndex: 30 });
    b.onclick = () => open(true);
    document.body.appendChild(b);
  }
  function open(show) {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "socialPanel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Social");
      Object.assign(panel.style, { position: "fixed", left: "12px", bottom: "56px", width: "min(440px, calc(100vw - 24px))", maxHeight: "70vh", overflow: "auto",
        background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: "10px", padding: "12px", zIndex: 31, boxShadow: "0 8px 30px rgba(0,0,0,.4)" });
      panel.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });
      document.body.appendChild(panel);
    }
    panel.hidden = !show;
    if (show) { const other = document.getElementById("communityPanel"); if (other) other.hidden = true; draw(); } else $("socialButton")?.focus();
  }
  const typing = () => panel && panel.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  function draw() {
    if (!panel || panel.hidden) return;
    const tabs = SECTIONS.filter(([, , m]) => !m || on(m));
    if (!tabs.some(t => t[0] === section)) section = tabs[0][0];
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:8px"><strong>Social</strong><button class="link" id="soClose" aria-label="Close">✕</button></div>
      <div role="tablist" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === section}" class="${k === section ? "" : "secondary"}" data-sec="${k}" style="padding:4px 8px">${l}</button>`).join("")}</div>
      <div>${me ? body() : "<p>Sign in to take part.</p>"}</div>
      <p class="quiet" style="font-size:12px">Buttons for most actions are in Opportunities. Text you write is filtered; contact details are removed.</p>`;
    panel.querySelector("#soClose").onclick = () => open(false);
    panel.querySelectorAll("[data-sec]").forEach(b => b.onclick = () => { section = b.dataset.sec; draw(); });
    wire();
  }
  const form = (id, inputs, label) => `<form id="${id}" style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${inputs}<button>${label}</button></form>`;
  const input = (id, ph, max, w = "60%") => `<input id="${id}" maxlength="${max}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" style="width:${w}">`;
  function body() {
    switch (section) {
      case "guild": {
        const v = mine("guilds");
        if (!v?.guild) return `<p>Start a guild with friends: shared flag, chat, HQ, missions, contests.</p>${form("soCreate", input("soName", "Guild name", 24, "55%") + input("soTag", "TAG", 4, "18%"), "Create")}`;
        const g = (pub("guilds") ?? []).find(x => x.id === v.guild);
        const officer = v.rank !== "member";
        return `<p><strong>${esc(g?.name)} [${esc(g?.tag)}]</strong>, you are ${esc(v.rank)}. XP ${g?.xp ?? 0}.</p>
          <ul>${(g?.members ?? []).map(m => `<li>${esc(m.name)}: ${esc(m.rank)}</li>`).join("")}</ul>
          ${officer && on("recruitment") ? `<p>Recruitment pitch:</p>${form("soPitch", input("soPitchIn", "What your guild is like", 160, "70%"), "Post")}` : ""}`;
      }
      case "chat": {
        const msgs = mine("guild-chat") ?? [];
        return `<div style="max-height:240px;overflow:auto;font-size:13px">${msgs.map(m => `<p style="margin:2px 0"><strong>${esc(m.from)}:</strong> ${esc(m.text)}</p>`).join("") || "<p class='quiet'>No messages yet.</p>"}</div>
          ${form("soSay", input("soSayIn", "Message your guild", 200, "75%"), "Send")}`;
      }
      case "news": {
        const n = pub("newspapers") ?? { front: [], papers: [] };
        const mineP = n.papers.find(p => p.owner === me.name);
        return `${n.front.map(a => `<article style="margin-bottom:10px"><strong>${esc(a.headline)}</strong><br><span class="quiet" style="font-size:12px">${esc(a.paper)}, day ${a.day} · ${a.likes} ♥</span>
            <p style="font-size:13px;margin:4px 0">${esc(a.body)}</p>${a.by !== me.name ? `<button class="link" data-like="${a.id}">♥ Like</button>` : ""}</article>`).join("") || "<p>No stories yet.</p>"}
          ${mineP ? `<h4>Write for ${esc(mineP.paper)}</h4><form id="soPublish">${input("soHead", "Headline", 80, "100%")}<textarea id="soBody" maxlength="800" rows="4" style="width:100%" aria-label="Story"></textarea><button>Publish</button></form>`
            : form("soFound", input("soPaper", "Newspaper name", 30), "Found a paper")}`;
      }
      case "civic": {
        const mayors = pub("mayors") ?? [], cases = (pub("courts") ?? []).filter(k => !k.verdict && k.accused === me.name);
        const iAmMayor = mayors.some(m => m.mayor === me.name);
        return `${mayors.length ? `<h4>Mayors</h4><ul>${mayors.map(m => `<li>${esc(world.ports[m.port]?.name)}: ${esc(m.mayor)}${m.motto ? ` — “${esc(m.motto)}”` : ""}</li>`).join("")}</ul>` : ""}
          ${iAmMayor && on("mayors") ? form("soMotto", input("soMottoIn", "Port motto", 80), "Set motto") : ""}
          ${(pub("laws")?.laws ?? []).length ? `<h4>Laws</h4><ul>${pub("laws").laws.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
          ${cases.map(k => `<h4>Case ${k.id} against you: ${esc(k.charge)}</h4>${form(`soDefend${k.id}`, input(`soDef${k.id}`, "Your defence", 300, "70%"), "Submit")}`).join("")}`;
      }
      case "public": {
        const ledger = pub("ledger") ?? [], lines = pub("shipping-lines") ?? [], polls = pub("polls");
        return `${lines.length ? `<h4>Timetables</h4><ul>${lines.map(l => `<li>${esc(l.name)} (${esc(l.operator)}): ${esc(world.ports[l.a]?.name)} ⇄ ${esc(world.ports[l.b]?.name)} every ${l.every} h, next hour ${l.next}${l.reliability !== null ? `, ${l.reliability}% on time` : ""}</li>`).join("")}</ul>` : ""}
          ${polls ? `<h4>This week's question: ${esc(polls.question)}</h4>${polls.polls.map(p => `<p style="font-size:12px">${esc(p.poll)}: ${p.tally.map(t => `${esc(t.choice)} ${t.votes}`).join(" · ")}</p>`).join("")}` : ""}
          ${ledger.length ? `<h4>Public ledger</h4><ul style="font-size:12px">${ledger.slice(-12).reverse().map(l => `<li>Day ${Math.floor(l.tick / 24) + 1}: ${esc(l.note)}${l.amount ? ` (${fmt(l.amount)})` : ""}</li>`).join("")}</ul>` : ""}`;
      }
    }
    return "";
  }
  function wire() {
    const q = s => panel.querySelector(s);
    const sub = (sel, fn) => q(sel)?.addEventListener("submit", e => { e.preventDefault(); fn(); });
    sub("#soCreate", () => send("guilds", "create", { name: q("#soName").value, tag: q("#soTag").value }, () => toast("Guild created")));
    sub("#soPitch", () => send("recruitment", "post", { pitch: q("#soPitchIn").value }, () => toast("Posted")));
    sub("#soSay", () => send("guild-chat", "say", { text: q("#soSayIn").value }, () => { q("#soSayIn").value = ""; }));
    sub("#soFound", () => send("newspapers", "found", { name: q("#soPaper").value }, () => toast("Paper founded")));
    sub("#soPublish", () => send("newspapers", "publish", { headline: q("#soHead").value, body: q("#soBody").value }, () => toast("Published")));
    sub("#soMotto", () => send("mayors", "motto", { text: q("#soMottoIn").value }, () => toast("Motto set")));
    panel.querySelectorAll("form[id^=soDefend]").forEach(f => f.addEventListener("submit", e => { e.preventDefault(); const id = +f.id.slice(8);
      send("courts", "defend", { case: id, statement: q(`#soDef${id}`).value }, () => toast("Defence submitted")); }));
    panel.querySelectorAll("[data-like]").forEach(b => b.onclick = () => send("newspapers", "like", { article: +b.dataset.like }));
  }
  ManifestHooks.on("state", () => { ensureButton(); if (!typing()) draw(); });
})();
