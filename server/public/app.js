// Manifest browser client. Plain JavaScript, no build step.
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("en-IE");
const GOOD_NAMES = ["grain", "fuel"];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let dist = null;
let ws, world = null, me = null, tab = "port", selectedPort = null, tickAt = Date.now(), reqId = 0;
const pendingReq = new Map();

// ------------------------------------------------------------ connection

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    $("conn").textContent = "live"; $("conn").classList.add("live");
    const token = store.get("token");
    if (token) ws.send(JSON.stringify({ type: "resume", token }));
    else showAuth(true);
  };
  ws.onclose = () => {
    $("conn").textContent = "reconnecting"; $("conn").classList.remove("live");
    pendingReq.clear();   // replies to commands sent on the old connection will never come
    setTimeout(connect, 2000);
  };
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "static") { dist = msg.dist; return; }
    if (msg.type === "history") { hist = msg.history.slice(); return; }
    if (msg.type === "state") {
      if (!world || msg.world.tick !== world.tick) tickAt = Date.now();
      const firstLogin = !me && msg.me;
      const before = me;
      world = msg.world; me = msg.me;
      if (before && me && before.id === me.id) { noteDockings(before); noteForcedSales(before); }
      noteprices();
      if ((selectedPort === null || firstLogin) && me?.ships?.length) selectedPort = me.ships[0].dest ?? me.ships[0].port;
      if (selectedPort === null) selectedPort = 0;
      render();
      if (guidePending && me) { guidePending = false; openGuide(); }
    } else if (msg.type === "auth") {
      store.set("token", msg.token); showAuth(false);
      if (authMode === "register" && !store.get("guideSeen")) guidePending = true;
    } else if (msg.type === "authError") {
      store.set("token", null); showAuth(true); $("authError").textContent = msg.error;
    } else if (msg.type === "result") {
      const cb = pendingReq.get(msg.reqId); pendingReq.delete(msg.reqId);
      if (!msg.ok) toast(msg.error, true); else if (cb) cb();
    } else if (msg.type === "loggedOut") location.reload();
    else if (msg.type === "error") toast(msg.error, true);
  };
}

/** Tell the player when one of their ships docks: a toast, plus a browser notification if they
 *  turned those on and the tab isn't in view. */
function noteDockings(before) {
  const docked = me.ships.filter(s => s.dest === null && before.ships.some(b => b.id === s.id && b.dest !== null));
  // Watching the port a ship just left (nothing of yours docked there now)? Follow it to where it
  // docked, so its Sell button is in view instead of "None of your ships are docked here".
  const watching = tab === "port" && !me.ships.some(s => s.dest === null && s.port === selectedPort)
    && !(document.activeElement?.matches("input, select") && $("panel").contains(document.activeElement)) && !pointerInPanel;
  const follow = watching && docked.find(s => before.ships.find(b => b.id === s.id).port === selectedPort);
  if (follow) selectedPort = follow.port;
  for (const s of docked) {
    const text = `Ship ${s.id} docked at ${world.ports[s.port].name}${s.qty > 0 ? ` with ${s.qty} ${GOOD_NAMES[s.good]}` : ""}`;
    toast(text);
    if (store.get("notify") && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification("Manifest", { body: text, tag: `dock-${s.id}` }); } catch {}
    }
  }
}
/** Spare ships the game sold because cash was below zero at the daily upkeep. Without this the
 *  ship just vanished from the fleet with no explanation. */
function forcedSaleText(f) {
  return `Ship ${f.ship} was sold at ${world.ports[f.port].name} for ${fmt(f.paid)} at the start of day ${Math.floor(f.tick / 24) + 1}: your cash was ${fmt(f.cashBefore)} after the daily upkeep, and a company below zero sells an idle spare ship.`;
}
function noteForcedSales(before) {
  const seen = Math.max(-1, ...(before.forcedSales ?? []).map(f => f.tick));
  for (const f of (me.forcedSales ?? []).filter(f => f.tick > seen)) {
    toast(forcedSaleText(f), "warn");
    if (store.get("notify") && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification("Manifest", { body: forcedSaleText(f), tag: `sold-${f.ship}` }); } catch {}
    }
  }
}
function notifyHtml() {
  if (!("Notification" in window)) return "";
  const on = store.get("notify") && Notification.permission === "granted";
  if (Notification.permission === "denied") return `<div class="est">Dock alerts are blocked in your browser settings for this site.</div>`;
  return `<div class="row"><button class="secondary" data-act="notify">${on ? "Turn off dock alerts" : "Alert me when ships dock"}</button>
    <span class="quiet">${on ? "On: you'll get a browser notification while this tab is open in the background." : "Works while this tab is open, even in the background."}</span></div>`;
}

/** Send a message if connected; otherwise say so instead of dropping it silently. */
function send(msg) {
  if (ws?.readyState !== WebSocket.OPEN) {
    toast("Not connected to the server, so nothing was done. Reconnecting; try again in a moment.", "bad");
    return false;
  }
  ws.send(JSON.stringify(msg));
  return true;
}

function command(cmd, onOk) {
  const id = ++reqId;
  if (send({ type: "cmd", reqId: id, cmd })) pendingReq.set(id, () => { if (cmd.ship !== undefined) clearForm(cmd.ship); onOk?.(); render(); });
}

/** kind: falsy for done (tick), true or "bad" for an error, "warn" for done-but-careful. */
function toast(text, kind = false) {
  const t = $("toast"); t.textContent = text; t.className = "toast" + (kind === "warn" ? " warn" : kind ? " bad" : "");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add("hidden"), 3500);
}

// ------------------------------------------------------------ auth

function showAuth(on) { $("auth").classList.toggle("hidden", !on); }
let authMode = "login";
document.querySelectorAll("#authForm button").forEach(b => b.addEventListener("click", () => { authMode = b.dataset.mode; }));
$("authForm").addEventListener("submit", e => {
  e.preventDefault();
  $("authError").textContent = "";
  if (!send({ type: authMode, name: $("authName").value, password: $("authPass").value })) $("authError").textContent = "Not connected to the server yet. Try again in a moment.";
});
$("logout").addEventListener("click", () => {
  store.set("token", null);
  // Tell the server to end the session, then start over; reload anyway if it doesn't answer.
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "logout" }));
  setTimeout(() => location.reload(), 300);
});

// ------------------------------------------------------------ first-time guide

// Shown once to a new company (remembered in this browser), and any time from "How to play"
// (sign-in card) or "Help" (header).
let guidePending = false, guideAt = 0;
function guideSteps() {
  const ship = me?.ships?.length === 1 ? me.ships[0] : null, here = ship && ship.dest === null ? world?.ports[ship.port] : null;
  return [
    ["Your ship", here
      ? `This is your company: one ship, docked at ${esc(here.name)}. It's the green ring on the map, and its card is on the Port and Fleet tabs. Your first ship costs nothing to keep.`
      : "You start with one ship, shown with a green ring on the map. Its card, on the Port and Fleet tabs, is where you trade and sail. Your first ship costs nothing to keep."],
    ["Buy where it's cheap", "Each port makes some goods and needs others. Where a good is made, stock is high and the price is low. On your ship's card, pick grain or fuel to load and how much."],
    ["Sail where it's needed", "Tap a port on the map, or pick one from the list, to set the destination. The estimate counts fuel, the port fee and how prices move as you trade. \"Best trips from here\" fills in the most profitable ones for you."],
    ["Sell, and grow", "When your ship docks, sell to the market or fill another player's order. Use the profit to buy more ships. The company with the highest net worth when the season ends wins."],
  ];
}
function openGuide() { guideAt = 0; showGuideStep(); $("guide").classList.remove("hidden"); $("guideNext").focus(); }
function closeGuide() { $("guide").classList.add("hidden"); store.set("guideSeen", "1"); }
function showGuideStep() {
  const steps = guideSteps(), [title, text] = steps[guideAt];
  $("guideStep").textContent = `Step ${guideAt + 1} of ${steps.length}`;
  $("guideTitle").textContent = title;
  $("guideText").innerHTML = text;
  document.querySelector(".guideDots").innerHTML = steps.map((_, i) => `<i class="${i === guideAt ? "on" : ""}"></i>`).join("");
  $("guideBack").disabled = guideAt === 0;
  $("guideNext").textContent = guideAt === steps.length - 1 ? "Start trading" : "Next";
}
$("guideNext").addEventListener("click", () => {
  if (guideAt === guideSteps().length - 1) return closeGuide();
  guideAt++; showGuideStep();
});
$("guideBack").addEventListener("click", () => { if (guideAt > 0) { guideAt--; showGuideStep(); } });
$("guideSkip").addEventListener("click", closeGuide);
$("howToPlay").addEventListener("click", openGuide);
$("help").addEventListener("click", openGuide);
document.addEventListener("keydown", e => {
  if ($("guide").classList.contains("hidden")) return;
  if (e.key === "Escape") return closeGuide();
  if (e.key !== "Tab") return;
  // The guide is a modal: keep Tab and Shift+Tab inside it instead of wandering to the page behind.
  const els = [...$("guide").querySelectorAll("button")].filter(b => !b.disabled);
  const i = els.indexOf(document.activeElement);
  e.preventDefault();
  els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus();
});

// ------------------------------------------------------------ routes and voyages (display only; the server decides)

// Shortest sea paths between ports, so ships follow the real lanes instead of cutting across.
let lanes = null;   // { d: distance matrix, next: next-hop matrix }
function buildLanes() {
  const n = world.ports.length;
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const next = Array.from({ length: n }, () => Array(n).fill(-1));
  for (const r of world.routes) { d[r.a][r.b] = d[r.b][r.a] = r.distance; next[r.a][r.b] = r.b; next[r.b][r.a] = r.a; }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
    if (d[i][k] + d[k][j] < d[i][j]) { d[i][j] = d[i][k] + d[k][j]; next[i][j] = next[i][k]; }
  lanes = { d, next };
}
function lanePath(a, b) {
  const path = [a];
  for (let cur = a, guard = 0; cur !== b && guard < 64; guard++) { cur = lanes.next[cur][b]; if (cur < 0) return [a, b]; path.push(cur); }
  return path;
}
/** Where a ship is now: a point on its lane and the direction it's heading. */
function shipPos(s) {
  const a = world.ports[s.port];
  if (s.dest === null) return { x: a.x, y: a.y, angle: -Math.PI / 2, path: null, f: 1 };
  const total = Math.max(1, s.arriveTick - s.departTick);
  const elapsed = world.tick - s.departTick + Math.min(1, (Date.now() - tickAt) / world.tickMs);
  const f = Math.max(0, Math.min(1, elapsed / total));
  const path = lanePath(s.port, s.dest).map(i => world.ports[i]);
  const segs = path.slice(1).map((q, i) => Math.hypot(q.x - path[i].x, q.y - path[i].y));
  let left = f * segs.reduce((x, y) => x + y, 0);
  for (let i = 0; i < segs.length; i++) {
    const p = path[i], q = path[i + 1];
    if (left <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? Math.min(1, left / segs[i]) : 1;
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, angle: Math.atan2(q.y - p.y, q.x - p.x), path, seg: i, f };
    }
    left -= segs[i];
  }
  return { x: a.x, y: a.y, angle: 0, path, f };
}
function distance(a, b) {
  // Real sea-route distance from the server; straight line only until it arrives.
  if (dist) return dist[a][b];
  const p = world.ports[a], q = world.ports[b];
  return Math.hypot(p.x - q.x, p.y - q.y);
}
function hoursLeft(s) { return Math.max(0, s.arriveTick - world.tick); }

// ------------------------------------------------------------ price history

let hist = [];   // [{ tick, prices: [port][good] }], last 72 hours
function noteprices() {
  if (!world) return;
  if (hist.length && hist.at(-1).tick === world.tick) hist.pop();
  hist.push({ tick: world.tick, prices: world.ports.map(p => p.prices) });
  if (hist.length > 72) hist.shift();
}
function series(port, g) { return hist.map(h => h.prices[port]?.[g]).filter(v => v !== undefined); }
function sparkline(port, g) {
  const v = series(port, g);
  if (v.length < 2) return `<svg class="spark" viewBox="0 0 74 22"><line x1="2" y1="11" x2="72" y2="11" stroke="var(--line-strong)" stroke-dasharray="2 3"/></svg>`;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => [2 + (i / (v.length - 1)) * 68, 19 - ((x - lo) / span) * 16]);
  const d = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts.at(-1);
  return `<svg class="spark" viewBox="0 0 74 22" aria-label="Price over the last ${v.length} hours"><polyline points="${d}" fill="none" stroke="var(--${GOOD_NAMES[g]})" stroke-width="1.5" stroke-linejoin="round" opacity=".9"/><circle cx="${lx}" cy="${ly}" r="2.2" fill="var(--${GOOD_NAMES[g]})"/></svg>`;
}
/** Price change over the last day (or as far back as we have), as a small arrow. */
function trend(port, g) {
  const v = series(port, g);
  if (v.length < 2) return "";
  const then = v[Math.max(0, v.length - 25)], now = v.at(-1), pct = (now - then) / then * 100;
  if (Math.abs(pct) < 0.5) return `<span class="trend quiet" title="Steady over the last day">●</span>`;
  return `<span class="trend quiet" title="${pct > 0 ? "Up" : "Down"} ${Math.abs(pct).toFixed(1)}% over the last day">${pct > 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(0)}%</span>`;
}

// ------------------------------------------------------------ map

const canvas = $("map"), ctx = canvas.getContext("2d");
let view = { scale: 1, ox: 0, oy: 0 };     // screen = o + map * scale
const cam = { z: 1, cx: 500, cy: 350 };     // zoom and the map point at the centre
let W = 0, H = 0, fit = 1, hovered = null;
const MAP_W = 1000, MAP_H = 700;
const C = {};   // colours from the stylesheet, read once
function readColours() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["line", "line-strong", "ink", "quiet", "grain", "fuel", "other", "mine", "sea", "sea-deep", "bg"]) C[k] = cs.getPropertyValue("--" + k).trim();
}
readColours();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const P = p => [view.ox + p.x * view.scale, view.oy + p.y * view.scale];
const toMap = (sx, sy) => ({ x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale });
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

function layout() {
  const dpr = window.devicePixelRatio || 1;
  W = canvas.clientWidth; H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fit = Math.min(W / MAP_W, H / MAP_H) * 0.94;
  cam.z = clamp(cam.z, 1, 5);
  const hw = W / 2 / (fit * cam.z), hh = H / 2 / (fit * cam.z);
  cam.cx = hw * 2 >= MAP_W ? MAP_W / 2 : clamp(cam.cx, hw, MAP_W - hw);
  cam.cy = hh * 2 >= MAP_H ? MAP_H / 2 : clamp(cam.cy, hh, MAP_H - hh);
  view = { scale: fit * cam.z, ox: W / 2 - cam.cx * fit * cam.z, oy: H / 2 - cam.cy * fit * cam.z };
  // The zoom buttons and legend sit on top of the map; keep labels out from under them.
  const key = `${W}x${H}`;
  if (key !== overlaysKey) {
    overlaysKey = key;
    const c = canvas.getBoundingClientRect();
    overlays = [...document.querySelectorAll(".mapTools, .legend")].map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left - c.left - 4, y: r.top - c.top - 4, w: r.width + 8, h: r.height + 8 };
    });
  }
}
let overlays = [], overlaysKey = "";
function zoomAt(sx, sy, z) {
  const m = toMap(sx, sy);
  cam.z = clamp(z, 1, 5);
  cam.cx = m.x - (sx - W / 2) / (fit * cam.z);
  cam.cy = m.y - (sy - H / 2) / (fit * cam.z);
  layout();
}

// The sea, coast shading and lanes only change when the view does, so they're drawn once into a cache.
const bg = document.createElement("canvas"), bgx = bg.getContext("2d");
let bgKey = "";
function drawBackground() {
  const dpr = window.devicePixelRatio || 1;
  const key = [W, H, dpr, view.scale.toFixed(4), view.ox.toFixed(1), view.oy.toFixed(1)].join();
  if (key === bgKey) return;
  bgKey = key;
  bg.width = canvas.width; bg.height = canvas.height;
  const g = bgx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grad = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
  grad.addColorStop(0, "#123047"); grad.addColorStop(0.6, C.sea); grad.addColorStop(1, C["sea-deep"]);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // Chart grid.
  g.lineWidth = 1;
  for (let x = 0; x <= MAP_W; x += 50) {
    g.strokeStyle = x % 250 === 0 ? "rgba(140,190,220,.07)" : "rgba(140,190,220,.03)";
    const sx = Math.round(view.ox + x * view.scale) + 0.5; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, H); g.stroke();
  }
  for (let y = 0; y <= MAP_H; y += 50) {
    g.strokeStyle = y % 250 === 0 ? "rgba(140,190,220,.07)" : "rgba(140,190,220,.03)";
    const sy = Math.round(view.oy + y * view.scale) + 0.5; g.beginPath(); g.moveTo(0, sy); g.lineTo(W, sy); g.stroke();
  }
  // Shallow water around each harbour.
  for (const p of world.ports) {
    const [x, y] = P(p), r = 46 * view.scale;
    const sh = g.createRadialGradient(x, y, 0, x, y, r);
    sh.addColorStop(0, "rgba(120,190,215,.10)"); sh.addColorStop(1, "rgba(120,190,215,0)");
    g.fillStyle = sh; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Shipping lanes.
  g.strokeStyle = "rgba(140,190,220,.20)"; g.lineWidth = 1.2; g.setLineDash([]);
  for (const r of world.routes) {
    const [x1, y1] = P(world.ports[r.a]), [x2, y2] = P(world.ports[r.b]);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  // Compass (skipped on small screens, where it would sit on top of ports).
  if (W < 600) return;
  const cx = W - 34, cy = H - 40;
  g.strokeStyle = "rgba(140,190,220,.25)"; g.fillStyle = "rgba(140,190,220,.35)"; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx + 4, cy); g.lineTo(cx, cy + 4); g.lineTo(cx - 4, cy); g.closePath(); g.fill();
  g.font = "600 9px IBM Plex Sans, sans-serif"; g.textAlign = "center"; g.fillText("N", cx, cy - 22); g.textAlign = "left";
}

function portColour(p) { return p.produces.includes("grain") ? C.grain : p.produces.includes("fuel") ? C.fuel : C.other; }
function portShape(c, p, x, y, r) {
  c.beginPath();
  if (p.produces.includes("fuel") && !p.produces.includes("grain")) { c.moveTo(x, y - r * 1.25); c.lineTo(x + r * 1.25, y); c.lineTo(x, y + r * 1.25); c.lineTo(x - r * 1.25, y); c.closePath(); }
  else c.arc(x, y, r, 0, Math.PI * 2);
}

function drawMap() {
  if (!world) return;
  if (!lanes || lanes.n !== world.ports.length) { buildLanes(); lanes.n = world.ports.length; }
  layout();
  drawBackground();
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bg, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const now = performance.now();
  const focus = hovered ?? selectedPort;
  const myShips = me?.ships ?? [];
  const mine = new Set(myShips.map(s => s.id));

  // Lanes out of the focused port, with sailing times. Their boxes keep port labels clear of them.
  const placed = overlays.slice();
  if (focus !== null) {
    ctx.strokeStyle = rgba(C.ink, 0.38); ctx.lineWidth = 1.6;
    for (const r of world.routes) {
      if (r.a !== focus && r.b !== focus) continue;
      const [x1, y1] = P(world.ports[r.a]), [x2, y2] = P(world.ports[r.b]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (view.scale > 0.55) {
        const h = Math.ceil(r.distance / world.rules.speed) + "h", mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        ctx.font = "600 10px IBM Plex Mono, monospace";
        const tw = ctx.measureText(h).width + 8;
        ctx.fillStyle = "rgba(10,22,32,.85)"; ctx.fillRect(mx - tw / 2, my - 8, tw, 15);
        placed.push({ x: mx - tw / 2, y: my - 8, w: tw, h: 15 });
        ctx.fillStyle = C.quiet; ctx.textAlign = "center"; ctx.fillText(h, mx, my + 3); ctx.textAlign = "left";
      }
    }
  }

  // Your voyages: the rest of the lane ahead, dashed.
  const positions = new Map(world.ships.filter(s => s.dest !== null || mine.has(s.id)).map(s => [s.id, shipPos(s)]));
  ctx.setLineDash([5, 5]); ctx.lineDashOffset = -now / 60; ctx.strokeStyle = rgba(C.mine, 0.75); ctx.lineWidth = 1.6;
  for (const s of myShips) {
    const pos = positions.get(s.id);
    if (!pos?.path) continue;
    ctx.beginPath(); ctx.moveTo(...P(pos));
    for (let i = pos.seg + 1; i < pos.path.length; i++) ctx.lineTo(...P(pos.path[i]));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The trip in the open sail form: its lane, dotted, and a ring on the destination.
  const plan = planCard(), planShipObj = plan && myShips.find(s => s.id === Number(plan.dataset.ship));
  const planVal = plan ? plan.querySelector("[data-field=dest]").value : "";
  const planDest = planVal === "" ? null : Number(planVal);
  if (planShipObj && planDest !== null && planDest !== planShipObj.port && world.ports[planDest]) {
    ctx.setLineDash([2, 5]); ctx.strokeStyle = rgba(C.mine, 0.9); ctx.lineWidth = 2.2; ctx.lineCap = "round";
    ctx.beginPath(); lanePath(planShipObj.port, planDest).forEach((i, k) => ctx[k ? "lineTo" : "moveTo"](...P(world.ports[i]))); ctx.stroke();
    ctx.setLineDash([]); ctx.lineCap = "butt";
  }

  // Ports.
  const r0 = clamp(4.2 * Math.sqrt(cam.z) * Math.max(0.8, Math.min(1.15, fit * 1.4)), 3.5, 9);
  const docked = new Map();
  for (const s of myShips) if (s.dest === null) docked.set(s.port, (docked.get(s.port) ?? 0) + 1);
  const destinations = new Set(myShips.filter(s => s.dest !== null).map(s => s.dest));
  for (const p of world.ports) {
    const [x, y] = P(p), col = portColour(p);
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r0 * 3.2);
    halo.addColorStop(0, rgba(col, 0.28)); halo.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r0 * 3.2, 0, Math.PI * 2); ctx.fill();
    const big = p.id === selectedPort || p.id === hovered;
    portShape(ctx, p, x, y, big ? r0 * 1.3 : r0);
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = "rgba(10,22,32,.9)"; ctx.lineWidth = 1.5; ctx.stroke();
    if (docked.has(p.id) || destinations.has(p.id)) {
      ctx.strokeStyle = C.mine; ctx.lineWidth = 2; ctx.setLineDash(docked.has(p.id) ? [] : [3, 3]);
      ctx.beginPath(); ctx.arc(x, y, r0 * 2.1, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (p.id === planDest && planShipObj) {
      ctx.strokeStyle = C.mine; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r0 * 2.6, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.id === selectedPort) {
      const pulse = (now % 1800) / 1800;
      ctx.strokeStyle = rgba(C.ink, 0.9 * (1 - pulse)); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, r0 * (1.8 + pulse * 2.4), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r0 * 1.75, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Labels, placed so they don't overlap; important ones first.
  const fontSize = clamp(10.5 + (cam.z - 1) * 0.8, 10.5, 13);
  const order = [...world.ports].sort((a, b) => weight(b) - weight(a));
  function weight(p) { return (p.id === selectedPort ? 100 : 0) + (p.id === planDest ? 95 : 0) + (p.id === hovered ? 90 : 0) + (docked.has(p.id) ? 50 : 0) + (destinations.has(p.id) ? 40 : 0) + (p.produces.length ? 2 : 0); }
  const dots = world.ports.map(p => { const [x, y] = P(p); return { x: x - r0 - 1, y: y - r0 - 1, w: 2 * r0 + 2, h: 2 * r0 + 2 }; });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const p of order) {
    const strong = weight(p) >= 40;
    ctx.font = `${strong ? 600 : 400} ${fontSize}px IBM Plex Sans, sans-serif`;
    const [x, y] = P(p), w = ctx.measureText(p.name).width, h = fontSize + 2, gap = r0 + 5;
    const spots = [[x + gap, y - h / 2], [x - gap - w, y - h / 2], [x - w / 2, y - gap - h], [x - w / 2, y + gap]];
    const spot = spots.map(([sx, sy]) => ({ x: sx, y: sy, w, h })).find(b =>
      b.x > 2 && b.y > 2 && b.x + b.w < W - 2 && b.y + b.h < H - 2 && !placed.some(o => hit(o, b)) && !dots.some((d, i) => i !== p.id && hit(d, b)));
    if (!spot) continue;
    placed.push(spot);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,22,32,.85)"; ctx.lineJoin = "round";
    ctx.strokeText(p.name, spot.x, spot.y + h - 4);
    ctx.fillStyle = strong ? C.ink : rgba(C.quiet, 0.95);
    ctx.fillText(p.name, spot.x, spot.y + h - 4);
  }

  // Ships at sea (others small and pale; yours bright, with a wake).
  for (const s of world.ships) {
    const pos = positions.get(s.id);
    if (!pos) continue;
    const own = mine.has(s.id);
    if (s.dest === null) continue;   // docked ships show as the ring around their port
    const [x, y] = P(pos), size = own ? 7.5 : 5;
    if (own) {
      const wake = ctx.createLinearGradient(x, y, x - Math.cos(pos.angle) * 22, y - Math.sin(pos.angle) * 22);
      wake.addColorStop(0, rgba(C.mine, 0.6)); wake.addColorStop(1, rgba(C.mine, 0));
      ctx.strokeStyle = wake; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(pos.angle) * 22, y - Math.sin(pos.angle) * 22); ctx.stroke(); ctx.lineCap = "butt";
      ctx.shadowColor = C.mine; ctx.shadowBlur = 10;
    }
    const img = shipSprite(s);
    if (img) {
      // Side-view sprite: flipped to face the way the ship is sailing, never upside down.
      const w = own ? 34 : 24, h = w * img.height / img.width;
      ctx.save(); ctx.translate(x, y);
      if (Math.cos(pos.angle) < 0) ctx.scale(-1, 1);
      ctx.globalAlpha = own ? 1 : 0.7; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, -w / 2, -h * 0.65, w, h);
      ctx.restore(); ctx.shadowBlur = 0;
      continue;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(pos.angle);
    ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.75, size * 0.62); ctx.lineTo(-size * 0.4, 0); ctx.lineTo(-size * 0.75, -size * 0.62); ctx.closePath();
    ctx.fillStyle = own ? C.mine : s.qty > 0 ? "rgba(232,238,242,.85)" : "rgba(232,238,242,.5)"; ctx.fill();
    ctx.restore(); ctx.shadowBlur = 0;
  }
}

// Ship sprites by cargo; until they load, ships draw as arrows.
const SPRITES = Object.fromEntries(["empty", "grain", "fuel"].map(k => { const im = new Image(); im.src = `img/ship-${k}.png`; return [k, im]; }));
function shipSprite(s) {
  const im = SPRITES[s.qty > 0 && s.good !== null ? GOOD_NAMES[s.good] : "empty"];
  return im.complete && im.naturalWidth ? im : null;
}

function portAt(sx, sy) {
  let best = null, bd = 18;
  for (const p of world.ports) {
    const [x, y] = P(p), d = Math.hypot(x - sx, y - sy);
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}
function showTip(id, sx, sy) {
  const tip = $("tip");
  if (id === null) { tip.classList.add("hidden"); return; }
  const p = world.ports[id];
  const role = [p.produces.length ? `makes ${p.produces.join(", ")}` : "", p.consumes.length ? `needs ${p.consumes.join(", ")}` : ""].filter(Boolean).join(" · ") || "quiet port";
  const mineHere = (me?.ships ?? []).filter(s => s.dest === null && s.port === id).length;
  tip.innerHTML = `<b>${esc(p.name)}</b><span class="quiet">${esc(role)}</span>
    ${GOOD_NAMES.map((g, i) => `<div class="tipRow"><span><i class="shape ${g}"></i>${g}</span><span>${p.prices[i].toFixed(2)}</span></div>`).join("")}
    ${mineHere ? `<div class="tipRow"><span class="pos">${mineHere} of your ships here</span></div>` : ""}`;
  tip.classList.remove("hidden");
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = clamp(sx + 14, 6, W - tw - 6) + "px";
  tip.style.top = clamp(sy - th - 10, 6, H - th - 6) + "px";
}

// While a docked ship's sail form is showing, tapping a port picks it as the destination.
// The ship whose form you last touched wins; tapping the same port again (or the ship's own port) opens it.
let activeShip = null;
function planCard() {
  if (!me || world.seasonOver) return null;
  const cards = [...$("panel").querySelectorAll(".shipCard[data-ship]")].filter(c => c.querySelector("[data-field=dest]"));
  return cards.find(c => Number(c.dataset.ship) === activeShip) ?? cards[0] ?? null;
}
function pickDestination(id) {
  const card = planCard();
  if (!card) return false;
  const s = me.ships.find(x => x.id === Number(card.dataset.ship));
  const sel = card.querySelector("[data-field=dest]");
  if (!s || s.port === id || sel.value === String(id) || ![...sel.options].some(o => o.value === String(id))) return false;
  sel.value = String(id); formState.set(formKey(sel), sel.value);
  activeShip = s.id;
  const summary = estimate(card);
  // Bring the Set sail button into view inside the side panel, but never scroll the page itself:
  // on a phone that pushed the map (and the route just drawn on it) off the screen after every tap.
  const y = window.scrollY;
  card.querySelector("[data-act=sail]")?.scrollIntoView({ block: "nearest" });
  if (window.scrollY !== y) window.scrollTo(window.scrollX, y);
  toast(`Ship ${s.id} → ${world.ports[id].name} (≈${Math.ceil(distance(s.port, id) / world.rules.speed)} h): ${summary}. Tap it again to open the port.`, summary.startsWith("makes") ? false : "warn");
  return true;
}

// Drag to pan, wheel or pinch to zoom, click a port to open it (or to pick it as a destination, above).
const pointers = new Map();
let drag = null, pinch = null;
canvas.addEventListener("pointerdown", e => {
  if (!world) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY, cx: cam.cx, cy: cam.cy, moved: false };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z };
    if (drag) drag.moved = true;
  }
});
canvas.addEventListener("pointermove", e => {
  if (!world) return;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
    return;
  }
  if (drag && pointers.size === 1) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; canvas.classList.add("drag"); showTip(null); }
    if (drag.moved) { cam.cx = drag.cx - dx / view.scale; cam.cy = drag.cy - dy / view.scale; layout(); }
    return;
  }
  if (e.pointerType === "mouse") {
    hovered = portAt(e.offsetX, e.offsetY);
    canvas.classList.toggle("hot", hovered !== null);
    showTip(hovered, e.offsetX, e.offsetY);
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && pointers.size === 0) {
    if (!drag.moved && e.type === "pointerup") {
      const id = portAt(e.offsetX, e.offsetY);
      if (id !== null && !pickDestination(id)) { selectedPort = id; tab = "port"; render(); }
    }
    drag = null; canvas.classList.remove("drag");
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => { if (!drag) { hovered = null; showTip(null); canvas.classList.remove("hot"); } });
canvas.addEventListener("wheel", e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, cam.z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
$("zoomIn").addEventListener("click", () => zoomAt(W / 2, H / 2, cam.z * 1.5));
$("zoomOut").addEventListener("click", () => zoomAt(W / 2, H / 2, cam.z / 1.5));
$("zoomReset").addEventListener("click", () => { cam.z = 1; layout(); });
(function loop() { drawMap(); requestAnimationFrame(loop); })();

// ------------------------------------------------------------ panels

document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));

function render() {
  if (!world) return;
  document.querySelectorAll("#tabs button").forEach(b => { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-selected", String(b.dataset.tab === tab)); });
  $("hName").textContent = me?.name ?? "–";
  $("hCash").textContent = me ? fmt(me.cash) : "–";
  $("hCash").classList.toggle("neg", !!me && me.cash < 0);
  showDelta();
  const level = world.rules.difficulty;
  $("diff").className = `pill diff ${level ?? "hidden"}`;
  $("diff").textContent = level ? `${level[0].toUpperCase()}${level.slice(1)} world` : "";
  $("seasonFill").style.width = `${Math.min(100, world.tick / world.seasonHours * 100)}%`;
  const counts = { fleet: me?.ships.length, orders: me ? world.orders.filter(o => o.owner === me.id).length : 0 };
  document.querySelectorAll("#tabs button").forEach(b => {
    const n = counts[b.dataset.tab];
    let badge = b.querySelector(".count");
    if (!n) { badge?.remove(); return; }
    if (!badge) { badge = document.createElement("span"); badge.className = "count"; b.append(badge); }
    badge.textContent = n;
  });
  $("hWorth").textContent = me ? fmt(me.worth) : "–";
  const days = world.seasonHours / 24;
  $("hClock").textContent = world.seasonOver ? "Season over"
    : `Day ${Math.floor(world.tick / 24) + 1} of ${days}, ${String(world.tick % 24).padStart(2, "0")}:00`;
  $("seasonBanner").classList.toggle("hidden", !world.seasonOver);
  if (world.seasonOver) {
    const top = world.leaderboard[0];
    $("seasonBanner").innerHTML = `<b>The season has ended.</b> ${top ? `${esc(top.name)} finished first with ${fmt(top.worth)}.` : ""} Trading is closed until the next season starts.`;
  }
  // Don't rebuild the panel while the player is typing in it or pressing one of its buttons:
  // rebuilding mid-click swapped the button out from under the mouse and the click was lost.
  const focused = document.activeElement;
  const editing = focused && $("panel").contains(focused) && /INPUT|SELECT/.test(focused.tagName);
  if (editing || pointerInPanel) {
    if (editing && !renderPending) focused.addEventListener("blur", () => setTimeout(render, 0), { once: true });
    renderPending = true;
    return;
  }
  renderPending = false;
  // Keyboard players: keep focus on the same button after the rebuild instead of dropping it to the page.
  const refocus = focused && focused !== document.body && $("panel").contains(focused) ? focusKey(focused) : null;
  const html = { port: portPanel, fleet: fleetPanel, orders: ordersPanel, board: boardPanel }[tab]();
  $("panel").innerHTML = html;
  restoreForm();
  bindPanel();
  if (scrollToBuy) { scrollToBuy = false; document.querySelector("[data-field=buyShipRow]")?.scrollIntoView({ block: "center" }); }
  if (refocus) {
    const els = [...$("panel").querySelectorAll("button, input, select, a[href]")];
    const el = els.find(x => focusKey(x) === refocus) ?? els.find(x => focusKey(x, true) === focusKey(focused, true));
    el?.focus({ preventScroll: true });
  }
}
/** Identifies a panel control across rebuilds. loose: only the action and ship, for when a
 *  suggested trip's details changed (e.g. a new quantity) but it is still the same kind of button. */
function focusKey(el, loose = false) {
  const d = el.dataset;
  if (loose) return `${el.tagName}|${d.act ?? ""}|${d.ship ?? ""}|${d.order ?? ""}`;
  return `${el.tagName}|${el.id}|${JSON.stringify(Object.entries(d).sort())}|${Object.keys(d).length || el.id ? "" : el.textContent.trim()}`;
}

// What the player has typed or picked survives the panel being rebuilt by live updates.
let renderPending = false, pointerInPanel = false, scrollToBuy = false;   // scrollToBuy: "Buy a ship at X" on the Fleet tab
const formState = new Map();
const formKey = el => `${el.closest("[data-ship]")?.dataset.ship ?? ""}:${el.dataset.field ?? el.id}`;
$("panel").addEventListener("pointerdown", () => { pointerInPanel = true; });
$("panel").addEventListener("focusin", e => { const c = e.target.closest?.(".shipCard[data-ship]"); if (c) activeShip = Number(c.dataset.ship); });
$("panel").addEventListener("pointerdown", e => { const c = e.target.closest?.(".shipCard[data-ship]"); if (c) activeShip = Number(c.dataset.ship); });
// Clicks fire right after pointerup, so wait a moment before allowing a rebuild.
window.addEventListener("pointerup", () => setTimeout(() => { pointerInPanel = false; if (renderPending) render(); }, 0), true);
$("panel").addEventListener("input", e => { if (e.target.matches("input, select")) formState.set(formKey(e.target), e.target.value); });
function restoreForm() {
  $("panel").querySelectorAll("input, select").forEach(el => {
    const v = formState.get(formKey(el));
    if (v === undefined) return;
    if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v)) return;
    el.value = v;
  });
}
/** Forget the form for a ship once its command succeeds, so it shows fresh defaults. */
function clearForm(ship) { for (const k of formState.keys()) if (k.startsWith(`${ship}:`)) formState.delete(k); }

// A green or red "+1,234" next to your cash whenever it changes.
let lastCash = null, lastCompany = null;
function showDelta() {
  if (!me) { lastCash = null; return; }
  if (lastCompany !== me.id) { lastCompany = me.id; lastCash = me.cash; return; }
  const d = me.cash - lastCash;
  lastCash = me.cash;
  if (!d) return;
  const el = $("hDelta");
  el.textContent = `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`;
  el.className = `delta show ${d > 0 ? "pos" : "neg"}`;
  clearTimeout(showDelta.timer);
  showDelta.timer = setTimeout(() => el.classList.remove("show"), 2500);
}

function portPanel() {
  const p = world.ports[selectedPort];
  const chips = [...p.produces.map(g => `<span class="tag ${g}">Produces ${g}</span>`), ...p.consumes.map(g => `<span class="tag">Needs ${g}</span>`)];
  // Stock bars are scaled to the fullest port for that good, so you can compare ports at a glance.
  const most = [0, 1].map(g => Math.max(1, ...world.ports.map(q => q.stock[g])));
  const rows = GOOD_NAMES.map((g, i) => `<tr><td><span class="tag ${g}">${g}</span></td>
    <td class="num">${p.prices[i].toFixed(2)}${trend(p.id, i)}</td>
    <td class="sparkCell">${sparkline(p.id, i)}</td>
    <td class="num">${fmt(p.stock[i])}<div class="bar ${g}"><i style="width:${Math.min(100, p.stock[i] / most[i] * 100).toFixed(0)}%"></i></div></td>
    <td class="num">${fmt(p.inbound[i])}</td></tr>`).join("");
  const orders = world.orders.filter(o => o.port === p.id);
  const docked = (me?.ships ?? []).filter(s => s.dest === null && s.port === p.id);
  const coming = (me?.ships ?? []).filter(s => s.dest === p.id);
  // On a phone your ship's buttons come first, above the market, so you can act without scrolling.
  const shipsFirst = docked.length > 0 && window.matchMedia("(max-width: 860px)").matches;
  const shipsHtml = `<h3>Your ships here</h3>
    ${docked.length ? docked.map(shipCard).join("") : `<div class="empty">None of your ships are docked here.${me ? ` ${whereShipsAre()}` : ""}</div>`}
    ${me && docked.length && !world.seasonOver && me.ships.length < world.rules.maxShips ? buyShipHtml() : ""}`;
  return `
    <h2>${esc(p.name)}</h2><div class="chips">${chips.join("") || `<span class="quiet">A quiet port</span>`}</div>
    ${shipsFirst ? shipsHtml : ""}
    <h3>Market</h3>
    <table class="market"><tr><th>Good</th><th class="num">Price</th><th class="sparkCell">Trend</th><th class="num">Stock</th><th class="num">Inbound</th></tr>${rows}</table>
    <div class="est">${p.emptyInbound ? `${p.emptyInbound} empty ship${p.emptyInbound === 1 ? "" : "s"} heading here to load.` : "No empty ships heading here to load."} ${p.inbound.some(q => q > 0) ? `The inbound ${[0, 1].filter(g => p.inbound[g] > 0).map(g => GOOD_NAMES[g]).join(" and ")} will push ${p.inbound.filter(q => q > 0).length > 1 ? "those prices" : "its price"} down when it lands.` : "No cargo is heading here either."}</div>
    <h3>Player orders here</h3>
    ${orders.length ? `<table><tr><th>Player</th><th>Wants to</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${orders.map(o => `<tr${me && o.owner === me.id ? ' class="me"' : ""}><td>${esc(o.ownerName)}</td><td>${o.side === "sell" ? "sell" : "buy"}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="quiet">None yet.</div>`}
    ${shipsFirst ? "" : shipsHtml}`;
}

/** For a port where none of your ships are docked: where they are instead, so a player who has just
 *  set sail (the panel stays on the port they left) isn't told to go and find a ship. */
function whereShipsAre() {
  const lines = me.ships.slice(0, 3).map(s => s.dest !== null
    ? `Ship ${s.id} is sailing to ${esc(world.ports[s.dest].name)}, ${hoursLeft(s) > 0 ? `arriving in ${hoursLeft(s)} h` : "arriving now"}.`
    : `Ship ${s.id} is docked at ${esc(world.ports[s.port].name)}.`);
  if (me.ships.length > 3) lines.push(`${me.ships.length - 3} more on the Fleet tab.`);
  const ports = [...new Set(me.ships.filter(s => s.dest === null).map(s => s.port))].slice(0, 3);
  const links = ports.map(id => `<button class="link" data-act="openPort" data-port="${id}">Open ${esc(world.ports[id].name)} →</button>`).join(" ");
  return `${lines.join(" ")} ${links ? `<div class="row">${links}</div>` : "Tap its port on the map or use the Fleet tab to see it."}`;
}

function shipCard(s) {
  const cargo = s.qty > 0 ? `<span class="tag ${GOOD_NAMES[s.good]}">${s.qty} ${GOOD_NAMES[s.good]}</span>` : `<span class="tag">empty</span>`;
  if (s.dest !== null) {
    const total = Math.max(1, s.arriveTick - s.departTick), done = Math.min(1, (world.tick - s.departTick) / total);
    return `<div class="shipCard"><div class="top"><b>Ship ${s.id}</b>${cargo}</div>
      <div class="quiet">Sailing to ${esc(world.ports[s.dest].name)}, arrives in ${hoursLeft(s)} h</div>
      <div class="voyage"><span>${esc(world.ports[s.port].name)}</span><span>${Math.round(done * 100)}%</span><span>${esc(world.ports[s.dest].name)}</span></div>
      <div class="bar mine"><i style="width:${(done * 100).toFixed(0)}%"></i></div></div>`;
  }
  const port = world.ports[s.port];
  if (world.seasonOver) {
    return `<div class="shipCard"><div class="top"><b>Ship ${s.id}</b>${cargo}</div>
      <div class="quiet">Docked at ${esc(port.name)}. Trading is closed until the next season starts.</div></div>`;
  }
  const matching = world.orders.filter(o => o.side === "buy" && o.port === s.port && o.good === s.good && o.owner !== me.id);
  const forSale = world.orders.filter(o => o.side === "sell" && o.port === s.port && o.owner !== me.id
    && (s.qty === 0 || o.good === s.good) && s.qty < world.rules.capacity);
  const dests = world.ports.filter(p => p.id !== s.port).sort((a, b) => a.name.localeCompare(b.name));
  // The form starts on the best trip, or the best port to sail to when nothing pays here,
  // never on whichever port happens to come first alphabetically.
  const trips = bestTrips(s), move = trips.length || s.qty > 0 ? null : bestMove(s) ?? chainMove(s);
  const plan = trips[0] ? { dest: trips[0].dest, good: s.qty > 0 ? "" : GOOD_NAMES[trips[0].g], qty: trips[0].qty }
    : move ? { dest: move.dest, good: "", qty: world.rules.capacity }
    : { dest: null, good: "", qty: world.rules.capacity };   // nothing worth doing: don't pick a trip for them
  return `<div class="shipCard" data-ship="${s.id}">
    <div class="top"><b>Ship ${s.id}</b>${cargo}</div>
    <div class="quiet">Docked at ${esc(port.name)}</div>
    ${s.qty > 0 ? `<div class="row"><button data-act="sell" data-ship="${s.id}">Sell ${s.qty} ${GOOD_NAMES[s.good]} here for ${fmt(saleNet(s))}</button>
      ${matching.map(o => `<button class="secondary" data-act="fill" data-ship="${s.id}" data-order="${o.id}">Fill ${esc(o.ownerName)}'s order: ${Math.min(o.qty, s.qty)} for ${fmt(Math.min(o.qty, s.qty) * o.price * (1 - world.rules.tax))}</button>`).join("")}</div>
      <div class="est" data-field="saleNote">${saleNote(s)}</div>
      <div class="row labelled"><label class="mini">Quantity<input data-field="sellQty" type="number" min="1" max="${s.qty}" value="${s.qty}" style="width:80px"></label>
        <label class="mini">Price each<input data-field="sellPrice" type="number" step="0.5" value="${(port.prices[s.good] * 1.15).toFixed(1)}" style="width:90px"></label>
        <button class="secondary" data-act="listSell" data-ship="${s.id}">List for sale here</button></div>
      <div class="est" data-field="listNote">Listing leaves the goods at this port for other players to buy, and frees your ship. Players can buy ${GOOD_NAMES[s.good]} from the market here for about ${(buyCost(s.port, s.good, s.qty) * (1 + world.rules.tax) / s.qty).toFixed(2)} each with tax, so a listing above that rarely sells. You get your price less ${Math.round(world.rules.tax * 1000) / 10}% tax.</div>` : ""}
    ${forSale.length ? `<h3>For sale here</h3>${forSale.map(o => listingHtml(s, o)).join("")}` : ""}
    ${tripsHtml(s, trips, move)}
    <label>Destination <span class="quiet">(or tap a port on the map)</span><select data-field="dest">${plan.dest === null ? `<option value="" selected disabled>Choose where to sail…</option>` : ""}${dests.map(p => `<option value="${p.id}"${p.id === plan.dest ? " selected" : ""}>${esc(p.name)} (≈${Math.ceil(distance(s.port, p.id) / world.rules.speed)} h)</option>`).join("")}</select></label>
    ${s.qty === 0 ? `<div class="row" style="margin-top:4px">
      <select data-field="good" style="width:auto"><option value="">Sail empty</option>${GOOD_NAMES.map((g, i) => `<option value="${g}"${g === plan.good ? " selected" : ""}>Load ${g} at ${port.prices[i].toFixed(2)}</option>`).join("")}</select>
      <input data-field="qty" type="number" min="1" max="${world.rules.capacity}" value="${plan.qty}" style="width:90px"></div>` : ""}
    <div class="est big" data-field="estimate"></div>
    <div class="row"><button data-act="sail" data-ship="${s.id}">Set sail</button>
      ${me.ships.length > 1 && s.qty === 0 ? `<button class="link" data-act="${scrapAsk === s.id ? "scrapKeep" : "scrap"}" data-ship="${s.id}">${scrapAsk === s.id ? "Keep it" : `Scrap for ${fmt(world.rules.shipPrice / 2)}`}</button>` : ""}</div>
    ${me.ships.length > 1 && s.qty === 0 && scrapAsk === s.id ? scrapConfirmHtml(s) : ""}
  </div>`;
}

/** Scrapping can't be undone, so the first tap only asks (a stray tap on a phone cost a 12,000 ship). */
let scrapAsk = null;
function scrapConfirmHtml(s) {
  const price = world.rules.shipPrice;
  return `<div class="est warn" data-field="scrapNote">Scrapping Ship ${s.id} pays ${fmt(price / 2)} and can't be undone: a new ship costs ${fmt(price)}.
    It saves ${fmt(world.rules.upkeep)} a day in upkeep. Your net worth stays the same, since ships count at half their price.</div>
    <div class="row"><button class="secondary" data-act="scrap" data-ship="${s.id}">Yes, scrap Ship ${s.id} for ${fmt(price / 2)}</button></div>`;
}

// ---- trade maths, mirroring the server's sliding prices (engine.ts) so estimates are honest
function priceAt(g, stock) {
  const b = world.rules.bands[GOOD_NAMES[g]], T = world.rules.target;
  return b.floor + (b.ceiling - b.floor) * clamp(1 - stock / (2 * T), 0, 1);
}
/** Cost of buying qty at a port: each unit costs more as the stock runs down. */
function buyCost(port, g, qty, stock = world.ports[port].stock[g]) {
  const have = Math.min(qty, Math.max(0, stock));
  return have * priceAt(g, stock - have / 2) + (qty - have) * world.rules.bands[GOOD_NAMES[g]].ceiling;
}
/** What qty fetches at a port once the cargo already sailing there has landed. */
function sellValue(port, g, qty, withInbound = true) {
  const p = world.ports[port], stock = p.stock[g] + (withInbound ? p.inbound[g] : 0);
  return qty * priceAt(g, stock + qty / 2);
}
function fuelCost(from, to, g = -1, qty = 0) {
  const need = distance(from, to) * world.rules.fuelPer100 / 100;
  const stock = world.ports[from].stock[1] - (g === 1 ? qty : 0);
  return buyCost(from, 1, need, stock);
}
/** Profit of a trip after tax, fuel and the port fee. A loaded ship is compared with selling here now. */
function tripProfit(s, dest, g, qty) {
  const tax = world.rules.tax, fuel = fuelCost(s.port, dest, s.qty > 0 ? -1 : g, s.qty > 0 ? 0 : qty);
  const sell = g >= 0 && qty > 0 ? sellValue(dest, g, qty) * (1 - tax) : 0;
  const cost = s.qty > 0 ? sellValue(s.port, g, qty, false) * (1 - tax) : g >= 0 && qty > 0 ? buyCost(s.port, g, qty) * (1 + tax) : 0;
  return { profit: sell - cost - fuel - world.rules.portFee, fuel, hours: Math.max(1, Math.ceil(distance(s.port, dest) / world.rules.speed)) };
}
/** Whether a voyage of this many hours, starting `delay` hours from now, docks while trading is
 *  still open. A ship docking on the last hour (or later) can't sell: the season is over by then. */
function landsInSeason(hours, delay = 0) { return world.tick + delay + hours < world.seasonHours; }
/** Trips from where a docked ship is now, by profit per hour (the raw ranking). Trips that would
 *  dock after the season ends are left out: their cargo could never be sold. */
/** Cash the advice leaves unspent. With spare ships it also keeps a day's upkeep and a port fee per
 *  ship: if cash is below zero when upkeep is charged, the engine sells an idle spare ship at half
 *  price, and spending every last credit on cargo walked straight into that (a scripted player who
 *  bought a second ship at about 14,000 cash lost it that way five times in one season). */
function cashReserve() {
  const n = me.ships.length;
  return 300 + (n > 1 ? world.rules.upkeep * (n - 1) + world.rules.portFee * n : 0);
}
function rawTrips(s, n = 3, delay = 0, cash = me.cash) {
  const cap = world.rules.capacity, here = world.ports[s.port], out = [];
  const goods = s.qty > 0 ? [s.good] : [0, 1];
  for (const g of goods) {
    const qty = s.qty > 0 ? s.qty : Math.floor(Math.min(cap, here.stock[g], Math.max(0, cash - cashReserve()) / (here.prices[g] * (1 + world.rules.tax) * 1.1)));
    if (qty < 10) continue;
    for (const p of world.ports) {
      if (p.id === s.port) continue;
      const t = tripProfit(s, p.id, g, qty);
      if (t.profit > 0 && landsInSeason(t.hours, delay)) out.push({ dest: p.id, g, qty, ...t });
    }
  }
  return out.sort((a, b) => b.profit / b.hours - a.profit / a.hours).slice(0, n);
}
/** The best few trips, counting where each one leaves the ship: a trip to a port with a good next
 *  trip beats a slightly richer one to a dead end. In a season playtest this took players who follow
 *  the advice from a median of about 17,000 to about 26,000 net worth. */
const AFTER_HOURS = 6;   // how many hours of the next step to count
function bestTrips(s, n = 3) {
  const scored = rawTrips(s, 12).map(t => {
    const [next] = rawTrips({ ...s, port: t.dest, qty: 0 }, 1, t.hours);
    const move = next ? null : bestMove({ ...s, port: t.dest, qty: 0 }, t.hours);
    const after = next ? next.profit / next.hours : move ? move.score : 0;
    return { ...t, next, onward: move, score: (t.profit + after * AFTER_HOURS) / (t.hours + AFTER_HOURS) };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, n);
}

/** Another of your ships already sailing empty to this port to load there, if any. Empty moves to
 *  it are left out: with two ships docked together, both were told the same move (sail empty to X,
 *  then load grain for Y), and the second one to follow it paid more for the load and sold it for
 *  less. A playthrough with two ships did this time and again (two -579 empty trips side by side). */
function ownEmptyHeading(s, port) {
  return me.ships.find(o => o.id !== s.id && o.dest === port && o.qty === 0) ?? null;
}
/** Says which ports the move advice left out because another of your empty ships is going there. */
function takenNote(s) {
  const taken = me.ships.filter(o => o.id !== s.id && o.dest !== null && o.qty === 0 && o.dest !== s.port);
  if (s.qty > 0 || !taken.length) return "";
  const list = taken.map(o => `${esc(world.ports[o.dest].name)} (Ship ${o.id})`).join(", ");
  return `<div class="est quiet" data-field="takenNote">Not suggesting a move to ${list}: ${taken.length === 1 ? "that ship is" : "those ships are"} already sailing there empty to load, and a second load from the same port costs more and sells for less.</div>`;
}

/** When no trip pays from here: the port whose best trip, minus the cost of sailing there empty, pays most per hour. */
function bestMove(s, delay = 0) {
  let best = null;
  for (const p of world.ports) {
    if (p.id === s.port || ownEmptyHeading(s, p.id)) continue;
    const go = tripProfit(s, p.id, -1, 0);
    const [next] = rawTrips({ ...s, port: p.id, qty: 0 }, 1, delay + go.hours);
    if (!next) continue;
    const net = next.profit + go.profit;   // go.profit is minus fuel and the port fee
    const score = net / (go.hours + next.hours);
    if (net >= 50 && (!best || score > best.score)) best = { dest: p.id, score, cost: -go.profit, hours: go.hours, next };
  }
  return best;
}

/** When no single empty move pays: an empty move whose next two trips together clear +50. A ship at
 *  a dead-end port (Dunness, say) can sit there for weeks with no one-step move paying, because the
 *  first trip from the nearest busy port doesn't cover the long sail out; the second one does. A test
 *  ship waited from day 25 to the end of the season that way. Season playtest (normal, 4 h check-ins,
 *  players taking the best trips): median 19,660 without this, 28,357 with it; lowest 16,429 vs 20,066. */
function chainMove(s) {
  let best = null;
  for (const p of world.ports) {
    if (p.id === s.port || ownEmptyHeading(s, p.id)) continue;
    const go = tripProfit(s, p.id, -1, 0);
    const [next] = rawTrips({ ...s, port: p.id, qty: 0 }, 1, go.hours, me.cash + go.profit);
    if (!next) continue;
    const [then] = rawTrips({ ...s, port: next.dest, qty: 0 }, 1, go.hours + next.hours, me.cash + go.profit + next.profit);
    if (!then) continue;
    const net = go.profit + next.profit + then.profit, score = net / (go.hours + next.hours + then.hours);
    if (net >= 50 && (!best || score > best.score)) best = { dest: p.id, score, cost: -go.profit, hours: go.hours, next, then };
  }
  return best;
}

/** The empty move that comes closest to paying (largest net, even below zero), for when bestMove
 *  finds none. A test player sat 8 game days at one port told only "waiting costs nothing", with
 *  no idea how far off the nearest paying trip was or why moving there didn't count. */
function closestMove(s) {
  let best = null;
  for (const p of world.ports) {
    if (p.id === s.port || ownEmptyHeading(s, p.id)) continue;
    const go = tripProfit(s, p.id, -1, 0);
    const [next] = rawTrips({ ...s, port: p.id, qty: 0 }, 1, go.hours);
    if (next && (!best || next.profit + go.profit > best.net)) best = { dest: p.id, net: next.profit + go.profit, cost: -go.profit, hours: go.hours, next };
  }
  return best;
}
function closestMoveText(s) {
  const m = closestMove(s);
  if (!m) return "";
  const net = Math.round(m.net), sign = net >= 0 ? `only +${fmt(net)}` : `<b class="neg">−${fmt(-net)}</b>`;
  return ` Nearest option: sail empty to ${esc(world.ports[m.dest].name)} (${m.hours} h, about ${fmt(m.cost)} in fuel and fees), then load ${GOOD_NAMES[m.next.g]} for ${esc(world.ports[m.next.dest].name)} (+${fmt(m.next.profit)}): ${sign} overall at today's prices.`;
}

/** Whether an empty ship with this company's cash (or `cash`) could make a paying trip from any port
 *  at all. Early in a Hard season none does, and saying so beats implying the problem is where you are. */
function paysAnywhere(s, cash = me.cash) {
  return world.ports.some(p => rawTrips({ ...s, port: p.id, qty: 0 }, 1, 0, cash).length > 0);
}
/** Why an empty ship has no trip when trips do pay for a company with money: its cash is too low.
 *  Cargo must be paid for in cash (only a last ship's fuel goes on credit, engine.ts sail), so a
 *  one-ship company below zero can never load again this season; it used to be told "every company
 *  is waiting, check back in a few hours", and would have waited forever. Null if cash isn't why. */
function cashAdvice(s) {
  if (s.qty > 0 || paysAnywhere(s) || !paysAnywhere(s, 1e9)) return null;
  const listed = world.orders.some(o => o.owner === me.id && o.side === "sell");
  if (me.cash > 0) return `Trips are paying, but with ${fmt(me.cash)} cash you can't buy a load worth sailing (the advice keeps ${fmt(cashReserve())} in hand for fees and fuel). You can still load a few by hand below; the estimate says whether it pays.`;
  if (me.ships.length > 1) return `Your cash is ${fmt(me.cash)}, so this ship can't buy cargo or fuel: only a company's last ship can sail on credit. Scrap a spare ship (${fmt(world.rules.shipPrice / 2)}) to raise cash${listed ? ", or wait for the goods you listed to sell" : ""}.`;
  return `Your cash is ${fmt(me.cash)}, so you can't buy cargo: it must be paid for in cash, and only fuel goes on credit. ${listed
    ? "The goods you listed for sale are your way back: when someone buys them, the money comes to you."
    : "Nothing earns money without cargo, and sailing empty only adds to the debt, so this company can't trade again this season. Every company starts fresh next season."}`;
}

/** One listing in "For sale here": what it costs in total, how many you can take (room and cash),
 *  and whether the market here is cheaper, so a player never pays over the odds without knowing. */
function listingHtml(s, o) {
  const g = GOOD_NAMES[o.good], tax = world.rules.tax;
  const room = Math.min(o.qty, world.rules.capacity - s.qty);
  const qty = Math.min(room, Math.floor(Math.max(0, me.cash) / o.price + 1e-9));
  const head = `<span>${o.qty} ${g} from ${esc(o.ownerName)} at ${o.price.toFixed(2)} each</span>`;
  if (qty < 1) return `<div class="row">${head}<button class="secondary" disabled>Buy</button></div>
    <div class="est">Not enough cash: one costs ${o.price.toFixed(2)} and you have ${fmt(me.cash)}.</div>`;
  const cost = qty * o.price, market = buyCost(s.port, o.good, qty) * (1 + tax);
  const diff = Math.round(market - cost);
  const vs = diff > 0 ? `That's <b class="pos">${fmt(diff)} less</b> than buying ${qty} from the market here (about ${fmt(market)} with tax).`
    : diff < 0 ? `Buying ${qty} from the market here costs about ${fmt(market)} with tax, <b class="neg">${fmt(-diff)} less</b> than this listing.`
    : `About the same as buying ${qty} from the market here.`;
  const part = qty < room ? ` You can afford ${qty} of ${room}.` : "";
  return `<div class="row">${head}<button class="secondary" data-act="buyOrder" data-ship="${s.id}" data-order="${o.id}" data-qty="${qty}">Buy ${qty} for ${fmt(cost)}</button></div>
    <div class="est${diff < 0 ? " warn" : ""}" data-field="listingNote">${vs}${part}</div>`;
}
/** What selling a ship's whole cargo to this port's market pays, after tax (the server's sliding price). */
function saleNet(s) { return sellValue(s.port, s.good, s.qty, false) * (1 - world.rules.tax); }
/** One line under the sell button so the sum adds up: price, tax, and profit against what was paid. */
function saleNote(s) {
  const net = saleNet(s), gain = net - s.cost, tax = Math.round(world.rules.tax * 1000) / 10;
  return `About ${(net / s.qty).toFixed(2)} each after ${tax}% tax (the price slides as you sell). You paid ${fmt(s.cost)}, so this sale `
    + (Math.abs(gain) < 0.5 ? "breaks even." : gain > 0 ? `makes <b class="pos">+${fmt(gain)}</b>.` : `loses <b class="neg">${fmt(-gain)}</b>.`);
}

/** At the very end of a season: is selling a cargo here worth more than keeping it? Unsold cargo
 *  counts in net worth at what was paid for it (engine netWorth). */
function endCargoAdvice(s) {
  const sell = sellValue(s.port, s.good, s.qty, false) * (1 - world.rules.tax);
  return sell >= s.cost
    ? `Selling here now adds about ${fmt(sell - s.cost)} to your net worth; unsold cargo only counts at what you paid for it.`
    : `Selling here now would lower your net worth by about ${fmt(s.cost - sell)}: unsold cargo counts at what you paid for it, so keeping it is fine.`;
}
function tripsHtml(s, trips = bestTrips(s), move = null) {
  if (!trips.length && move?.then) return `<h3>Best trips from here</h3><div class="est">No trip pays from here right now. Your best move:</div>
    <div class="trips"><button class="trip move secondary" data-act="plan" data-ship="${s.id}" data-dest="${move.dest}" data-good="">
      <span>Sail empty → ${esc(world.ports[move.dest].name)}, then load ${GOOD_NAMES[move.next.g]} for ${esc(world.ports[move.next.dest].name)}, then ${GOOD_NAMES[move.then.g]} for ${esc(world.ports[move.then.dest].name)}</span>
      <span class="num"><b class="pos">+${fmt(move.next.profit + move.then.profit - move.cost)}</b> · ${move.hours + move.next.hours + move.then.hours} h</span></button></div>
    <div class="est" data-field="chainNote">Getting there costs about ${fmt(move.cost)} in fuel and fees. The first trip from there pays about +${fmt(move.next.profit)}, which doesn't cover that on its own, and the one after about +${fmt(move.then.profit)} (today's prices). No empty move pays back with just one trip, and waiting here for prices to change can take days.</div>${takenNote(s)}`;
  if (!trips.length && move) return `<h3>Best trips from here</h3><div class="est">No trip pays from here right now. Your best move:</div>
    <div class="trips"><button class="trip move secondary" data-act="plan" data-ship="${s.id}" data-dest="${move.dest}" data-good="">
      <span>Sail empty → ${esc(world.ports[move.dest].name)}, then load ${GOOD_NAMES[move.next.g]} for ${esc(world.ports[move.next.dest].name)}</span>
      <span class="num"><b class="pos">+${fmt(move.next.profit - move.cost)}</b> · ${move.hours + move.next.hours} h</span></button></div>
    <div class="est">Getting there costs about ${fmt(move.cost)} in fuel and fees; the trip from there pays about +${fmt(move.next.profit)} at today's prices.</div>${takenNote(s)}`;
  const left = world.seasonHours - world.tick;
  const soonest = Math.min(...world.ports.filter(p => p.id !== s.port).map(p => Math.max(1, Math.ceil(distance(s.port, p.id) / world.rules.speed))));
  if (!trips.length && !landsInSeason(soonest)) return `<h3>Best trips from here</h3><div class="est">The season ends in ${left} h, too soon for any voyage from here to dock in time. ${s.qty > 0 ? endCargoAdvice(s) : "Your ship can stay where it is."}</div>`;
  const broke = !trips.length && cashAdvice(s);
  if (broke) return `<h3>Best trips from here</h3><div class="est warn" data-field="cashAdvice">${broke}</div>`;
  if (!trips.length) return `<h3>Best trips from here</h3><div class="est">${s.qty > 0 ? "Nowhere pays more than selling here right now."
    : paysAnywhere(s) ? `No trip pays from here right now, and no empty move to another port earns at least +50 after its fuel and fees.${closestMoveText(s)} Waiting costs nothing; prices move every hour.`
    : "No trip pays anywhere on the map right now, so every company is waiting. Prices drift apart as ports make and use goods; waiting costs nothing, so check back in a few hours."}</div>${takenNote(s)}`;
  return `<h3>Best trips from here</h3><div class="trips">${trips.map(t => `<button class="trip secondary" data-act="plan" data-ship="${s.id}" data-dest="${t.dest}" data-good="${s.qty > 0 ? "" : GOOD_NAMES[t.g]}" data-qty="${t.qty}">
      <span>${s.qty > 0 ? "Sell" : `Load ${t.qty}`} <span class="tag ${GOOD_NAMES[t.g]}">${GOOD_NAMES[t.g]}</span> → ${esc(world.ports[t.dest].name)}</span>
      <span class="num"><b class="pos">+${fmt(t.profit)}</b> · ${t.hours} h</span>
      ${t.next ? `<span class="then">then +${fmt(t.next.profit)} from there</span>` : t.onward ? `<span class="then">then +${fmt(t.onward.next.profit - t.onward.cost)} after a ${t.onward.hours} h empty hop to ${esc(world.ports[t.onward.dest].name)}</span>` : `<span class="then">nothing pays from there yet</span>`}</button>`).join("")}</div>
    ${trips.length > 1 ? `<div class="est quiet" data-field="tripsNote">Ranked by what each trip earns an hour, counting the next trip from where it ends, so a smaller trip to a busy port can come first.</div>` : ""}`;
}

/** Why the server would refuse this trip for lack of cash (engine.ts sail), or null if it's affordable.
 *  Cargo must always be paid for; fuel too, unless this is the company's last ship (then it goes on credit). */
function cashShortfall(s, dest, g, qty, fuel) {
  const loading = s.qty === 0 && g >= 0 && qty > 0;
  if (loading && (qty > world.rules.capacity || qty > world.ports[s.port].stock[g])) return null;   // refused for another reason
  const last = me.ships.length === 1, have = last ? Math.max(0, me.cash) : me.cash;
  const cost = n => buyCost(s.port, g, n) * (1 + world.rules.tax) + (last ? 0 : fuelCost(s.port, dest, g, n));
  const need = loading ? cost(qty) : last ? 0 : fuel;
  if (need <= have) return null;
  const what = loading ? (last ? "the cargo costs" : "cargo and fuel cost") : "the fuel costs";
  let text = `${what} about ${fmt(need)} and you have ${fmt(me.cash)}.`;
  let n = 0;
  if (loading) { let lo = 0, hi = qty; while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (cost(m) <= have) lo = m; else hi = m - 1; } n = lo; }
  if (n > 0) text += ` You can afford about ${n} ${GOOD_NAMES[g]}.`;
  else if (last) text += me.cash > 0 ? " Sail empty instead: your last ship's fuel can go on credit." : " Cargo must be paid for in cash; only fuel goes on credit.";
  else text += ` Only a company's last ship can sail on credit: sell cargo or scrap a spare ship (${fmt(world.rules.shipPrice / 2)}) first.`;
  return text;
}
/** Why the server would refuse loading `qty` of good `g` onto empty ship `s`, or null if it wouldn't. */
function loadProblem(s, g, qty) {
  const cap = world.rules.capacity, stock = Math.floor(world.ports[s.port].stock[g]);
  if (!(qty >= 1)) return `Enter how many ${GOOD_NAMES[g]} to load (1 to ${cap}), or choose Sail empty.`;
  if (qty > cap) return `Your ship holds ${cap} at most.`;
  if (qty > stock) return `This port only has ${fmt(stock)} ${GOOD_NAMES[g]} in stock.`;
  return null;
}
function estimate(card) {
  const s = me.ships.find(x => x.id === Number(card.dataset.ship));
  const destVal = card.querySelector("[data-field=dest]").value;
  const sailBtn = card.querySelector("[data-act=sail]");
  if (destVal === "") {
    if (sailBtn) sailBtn.disabled = true;
    card.querySelector("[data-field=estimate]").innerHTML = "Waiting is free: prices move every hour, so check back soon. Or pick a port above if you want to move anyway.";
    return;
  }
  if (sailBtn) sailBtn.disabled = false;
  const dest = Number(destVal);
  const goodSel = card.querySelector("[data-field=good]");
  const g = s.qty > 0 ? s.good : (goodSel?.value ? GOOD_NAMES.indexOf(goodSel.value) : -1);
  const qtyInput = card.querySelector("[data-field=qty]");
  if (qtyInput) qtyInput.disabled = g < 0;   // nothing to count when sailing empty
  const qty = s.qty > 0 ? s.qty : Math.floor(Number(qtyInput?.value || 0));
  // The server refuses these loads; say why here and keep "Set sail" off, instead of a bare
  // "bad cargo" or "over capacity" after the click (and an estimate for cargo that won't fit).
  const bad = s.qty === 0 && g >= 0 ? loadProblem(s, g, qty) : null;
  if (bad) {
    if (sailBtn) sailBtn.disabled = true;
    card.querySelector("[data-field=estimate]").innerHTML = `<b class="neg">${bad}</b>`;
    return (bad.charAt(0).toLowerCase() + bad.slice(1)).replace(/\.$/, "");
  }
  const there = world.ports[dest];
  const t = tripProfit(s, dest, g, qty);
  let text = `Fuel ≈ ${fmt(t.fuel)}, port fee ${world.rules.portFee}.`;
  if (g < 0 || qty <= 0) text = `Sailing empty costs about <b class="neg">${fmt(t.fuel + world.rules.portFee)}</b> (fuel ${fmt(t.fuel)}, port fee ${world.rules.portFee}).`;
  const late = !landsInSeason(t.hours);
  if (me.ships.length === 1 && t.fuel > me.cash) text += " You can't cover the fuel, so it goes on credit (your cash goes below zero).";
  // The server refuses a trip whose cargo (and, unless this is your last ship, fuel) costs more
  // than your cash; say so before the click instead of after it.
  const short = cashShortfall(s, dest, g, qty, t.fuel);
  if (short) text = `<b class="neg">Not enough cash: ${short}</b> ` + text;
  if (g >= 0 && qty > 0) {
    const verb = t.profit >= 0 ? "makes" : "loses";
    text += s.qty > 0
      ? ` Compared with selling here now, sailing there ${verb} <b class="${t.profit >= 0 ? "pos" : "neg"}">${fmt(Math.abs(t.profit))}</b>.`
      : ` This trip ${verb} about <b class="${t.profit >= 0 ? "pos" : "neg"}">${fmt(Math.abs(t.profit))}</b> (${fmt(Math.abs(t.profit) / t.hours)} an hour).`;
    text += ` Counts the price moving as you buy and sell${there.inbound[g] > 0 ? `, and the ${fmt(there.inbound[g])} ${GOOD_NAMES[g]} already heading there` : ""}.`;
  }
  if (late) text = `<b class="neg">This ship would dock after the season ends</b> (≈${t.hours} h; ${Math.max(0, world.seasonHours - world.tick)} h left), so ${g >= 0 && qty > 0 ? "the cargo could never be sold: it only counts at what you paid for it, and the fuel is lost" : "the fuel would be wasted"}. ` + text;
  card.querySelector("[data-field=estimate]").innerHTML = text;
  // A one-line version for the toast when a destination is tapped on the map.
  if (late) return "docks after the season ends";
  if (short) return "not enough cash";
  if (g < 0 || qty <= 0) return `sailing empty costs about ${fmt(t.fuel + world.rules.portFee)}`;
  return `${t.profit >= 0 ? "makes" : "loses"} about ${fmt(Math.abs(t.profit))}`;
}

function fleetPanel() {
  if (!me) return `<div class="empty">Log in to see your fleet.</div>`;
  const atSea = me.ships.filter(s => s.dest !== null).length;
  const cargo = me.ships.reduce((a, s) => a + (s.qty > 0 ? s.cost : 0), 0);
  return `<h2>${esc(me.name)}</h2>
    <div class="quiet">${me.ships.length} of ${world.rules.maxShips} ships. Every ship after the first costs ${fmt(world.rules.upkeep)} a day.</div>
    <div class="bar mine" style="height:6px;margin-top:8px"><i style="width:${me.ships.length / world.rules.maxShips * 100}%"></i></div>
    <div class="tiles">
      <div><span>At sea</span><b>${atSea}</b></div><div><span>Docked</span><b>${me.ships.length - atSea}</b></div>
      <div><span>Cargo (cost)</span><b>${fmt(cargo)}</b></div><div><span>Net worth</span><b>${fmt(me.worth)}</b></div>
    </div>
    <div class="quiet" data-field="worthSum">${worthSum(cargo)}</div>
    <h3>Ships</h3>${(me.forcedSales ?? []).slice().reverse().map(f => `<div class="est warn" data-field="forcedSale">${forcedSaleText(f)}</div>`).join("")}
    ${me.ships.map(shipCard).join("")}
    ${fleetBuyHtml()}
    ${notifyHtml()}
    ${worthChart()}
    ${tripLog()}`;
}

/** Ships are bought at a port where one of yours is docked (engine buyShip), which the Fleet tab
 *  never said: point to those ports' Port tab, where the buy button and its warnings are. */
function fleetBuyHtml() {
  if (world.seasonOver) return "";
  const price = world.rules.shipPrice, n = me.ships.length, max = world.rules.maxShips;
  if (n >= max) return `<div class="quiet" data-field="fleetBuy">Your fleet is full: ${max} ships is the most a company can have.</div>`;
  const ports = [...new Set(me.ships.filter(s => s.dest === null).map(s => s.port))];
  const why = `A new ship costs ${fmt(price)} and is bought at a port where one of your ships is docked.`;
  if (!ports.length) return `<div class="quiet" data-field="fleetBuy">${why} All your ships are at sea, so wait until one docks.</div>`;
  const short = me.cash < price ? ` You need ${fmt(price - me.cash)} more cash.` : "";
  return `<div class="quiet" data-field="fleetBuy">${why}${short}</div>
    <div class="row">${ports.map(id => `<button class="link" data-act="goPort" data-port="${id}">Buy a ship at ${esc(world.ports[id].name)} →</button>`).join(" ")}</div>`;
}

/** How net worth is made up (engine netWorth), so it adds up for a player who sees only cash and cargo. */
function worthSum(cargo) {
  const ships = me.ships.length * world.rules.shipPrice / 2;
  const orders = world.orders.filter(o => o.owner === me.id)
    .reduce((a, o) => a + (o.side === "buy" ? o.qty * o.price : o.cost ?? 0), 0);
  const n = me.ships.length;
  return `Net worth ${fmt(me.worth)} = cash ${fmt(me.cash)} + ${n} ship${n === 1 ? "" : "s"} at half price ${fmt(ships)}`
    + ` + cargo at cost ${fmt(cargo)}${orders ? ` + open orders ${fmt(orders)}` : ""}.`;
}

/** Net worth at the start of each day this season, with today's value as the last point. */
function worthChart() {
  const pts = [...(me.worthLog ?? []), me.worth];
  if (pts.length < 2) return "";
  const w = 360, h = 90, lo = Math.min(...pts), hi = Math.max(...pts), span = Math.max(1, hi - lo);
  const xy = pts.map((v, i) => [i / (pts.length - 1) * w, h - 6 - (v - lo) / span * (h - 12)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const change = pts[pts.length - 1] - pts[0];
  return `<h3>Net worth this season</h3>
    <div class="quiet">${fmt(pts[0])} → <b>${fmt(me.worth)}</b> <span class="${change >= 0 ? "pos" : "neg"}">(${change >= 0 ? "+" : "−"}${fmt(Math.abs(change))})</span></div>
    <svg class="worthChart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Net worth by day">
      <path d="${line}L${w},${h}L0,${h}Z" class="area"/><path d="${line}" class="line"/></svg>
    <div class="axis"><span>Day 1</span><span>${world.seasonOver ? `Day ${Math.round(world.seasonHours / 24)}` : "Today"}</span></div>`;
}

function tripLog() {
  const trips = me.trips ?? [];
  if (!trips.length) return `<h3>Trip log</h3><div class="empty">Your finished trips and their profit will show here.</div>`;
  const rows = trips.map(t => {
    const what = t.good === null ? "empty" : `${t.qty} ${GOOD_NAMES[t.good]}`;
    const profit = t.earned - t.spent;
    const result = t.open
      ? `<span class="quiet">${me.ships.some(x => x.id === t.ship && x.dest !== null) ? "at sea" : t.good === null ? "docked" : "not sold yet"}</span>`
      : t.good === null ? `<span class="neg">−${fmt(t.spent)}</span>`
      : `<b class="${profit >= 0 ? "pos" : "neg"}">${profit >= 0 ? "+" : "−"}${fmt(Math.abs(profit))}</b>${t.listed ? ` <span class="quiet" title="Part of the cargo was listed for sale, so it isn't counted">*</span>` : ""}`;
    return `<tr><td class="num">${Math.floor(t.departTick / 24) + 1}</td><td>${esc(world.ports[t.from].name)} → ${esc(world.ports[t.to].name)}</td><td>${what}</td><td class="num">${result}</td></tr>`;
  }).join("");
  const done = trips.filter(t => !t.open), total = done.reduce((a, t) => a + t.earned - t.spent, 0);
  return `<h3>Trip log</h3>
    <table class="trips-log"><tr><th class="num">Day</th><th>Route</th><th>Cargo</th><th class="num">Profit</th></tr>${rows}</table>
    ${done.length ? `<div class="est">Last ${done.length} finished trip${done.length === 1 ? "" : "s"}: <b class="${total >= 0 ? "pos" : "neg"}">${total >= 0 ? "+" : "−"}${fmt(Math.abs(total))}</b> after cargo, fuel, fees and tax.${trips.some(t => t.listed) ? " * Listed cargo isn't counted until it sells." : ""}</div>` : ""}`;
}

/** What a buy order costs if it fills completely: the goods don't come back to you. The server
 *  refuses an order your cash doesn't cover (engine.ts placeOrder), so say that before the click. */
function orderCostText(qty, price) {
  const total = Math.floor(qty) * price;
  if (total > 0 && me && total > me.cash) return `Not enough cash: this order needs ${fmt(total)} to cover it and you have ${fmt(me.cash)}.`;
  return total > 0 ? `If it fills, this costs you ${fmt(total)}.` : "";
}
function ordersPanel() {
  const mine = me ? world.orders.filter(o => o.owner === me.id) : [];
  const others = world.orders.filter(o => !me || o.owner !== me.id);
  const b = world.rules.bands;
  return `<h2>Orders</h2>
    <div class="quiet">A buy order pays other players to deliver goods to a port; your cash is held until one fills it. To sell at your own price, use "List for sale" on a docked ship with cargo. Orders that cross fill automatically.</div>
    <div class="est warn">Goods delivered to your buy order are used up at that port. They don't come to you, so a filled order costs you its full price and doesn't add to your net worth.</div>
    ${me && world.seasonOver ? `<div class="est">Trading is closed until the next season starts.</div>` : ""}
    ${me && !world.seasonOver ? `<h3>Post an order</h3>
    <div class="row"><select id="oPort">${world.ports.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${p.id === selectedPort ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="row labelled"><label class="mini">Good<select id="oGood" style="width:auto">${GOOD_NAMES.map(g => `<option>${g}</option>`).join("")}</select></label>
      <label class="mini">Quantity<input id="oQty" type="number" min="1" max="1000" value="100" style="width:90px"></label>
      <label class="mini">Price each<input id="oPrice" type="number" step="0.5" value="30" style="width:90px"></label>
      <button data-act="placeOrder">Post</button></div>
    <div class="est">Grain ${b.grain.floor}–${b.grain.ceiling}, fuel ${b.fuel.floor}–${b.fuel.ceiling} per unit. <span id="oCost">${orderCostText(100, 30)}</span></div>` : ""}
    <h3>Your orders</h3>
    ${mine.length ? `<table><tr><th>Port</th><th>Order</th><th class="num">Qty</th><th class="num">Price</th><th></th></tr>${mine.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${o.side === "sell" ? "selling" : "buying"} ${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td><td>${world.seasonOver ? "" : `<button class="link" data-act="cancelOrder" data-order="${o.id}">Cancel</button>`}</td></tr>`).join("")}</table>` : `<div class="empty">You have no open orders.</div>`}
    <h3>All open orders</h3>
    ${others.length ? `<table><tr><th>Port</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${others.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td>${o.side === "sell" ? "for sale" : "wanted"}: ${GOOD_NAMES[o.good]}</td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="empty">No other open orders.</div>`}`;
}

/** "Buy a ship" when you can afford one; otherwise say how much more cash it needs instead of a button that only errors. */
function buyShipHtml() {
  const price = world.rules.shipPrice;
  // Ships count at half their price in net worth (engine netWorth), so a new ship drops your net
  // worth at once; without saying so, the net-worth chart's sudden fall looks like a loss.
  // Upkeep is charged at the start of each day; a company below zero then has an idle spare ship
  // sold for half its price. Buying with little cash left (cargo soon eats the rest) walks into that.
  const left = me.cash - price, upkeep = world.rules.upkeep * me.ships.length;   // upkeep once the new ship is in
  const load = Math.min(...[0, 1].map(g => buyCost(selectedPort, g, world.rules.capacity) * (1 + world.rules.tax)));
  const tight = left < load + upkeep;
  if (me.cash >= price) return `<div class="row" data-field="buyShipRow"><button data-act="buyShip">Buy a ship here (${fmt(price)})</button></div>
    <div class="est${tight ? " warn" : ""}" data-field="buyShipNote">${tight ? `You'd have ${fmt(left)} cash left, less than one full load here (about ${fmt(load)}) plus a day's upkeep (${fmt(upkeep)}). ` : ""}Upkeep for every ship after the first (${fmt(world.rules.upkeep)} a day each) is charged at the start of each day; if your cash is below zero then, an idle spare ship is sold for ${fmt(price / 2)}, half what you paid. Ships count at half their price, so your net worth drops by ${fmt(price / 2)} at first; the extra ship has to earn it back.</div>`;
  return `<div class="row" data-field="buyShipRow"><button disabled>Buy a ship here (${fmt(price)})</button><span class="quiet">You need ${fmt(price - me.cash)} more cash.</span></div>`;
}
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function boardPanel() {
  const top = Math.max(1, world.leaderboard[0]?.worth ?? 1);
  // Bars show the spread between companies, not distance from zero (everyone starts near 16,000).
  const low = Math.min(...world.leaderboard.map(c => c.worth)), span = Math.max(1, top - low);
  const barW = w => (15 + 85 * (w - low) / span).toFixed(0);
  const listed = me && world.leaderboard.some(c => c.id === me.id);
  // Companies with the same net worth share a place (1, 2, 2, 4), matching the "You" card.
  const rankOf = i => 1 + world.leaderboard.findIndex(c => c.worth === world.leaderboard[i].worth);
  return `<h2>Leaderboard</h2><div class="quiet">Ranked by net worth: cash, half the value of ships, cargo and open orders. Companies marked bot are computer traders that keep the markets moving. <a href="/seasons">Past seasons</a></div>
    ${me && me.rank ? `<div class="youRank"><span>You</span><b>${me.tied ? "joint " : ""}${ordinal(me.rank)}</b><span>of ${me.companies}</span><span class="num">${fmt(me.worth)}</span>
      <span class="quiet">${me.rank === 1 ? "You're in the lead." : `${fmt(top - me.worth)} behind the leader`}</span></div>` : ""}
    <h3>Top companies</h3>
    <table><tr><th>#</th><th>Company</th><th class="num">Ships</th><th class="num">Net worth</th></tr>
    ${world.leaderboard.map((c, i) => [c, rankOf(i)]).map(([c, r]) => `<tr${me && c.id === me.id ? ' class="me"' : ""}><td><span class="rank${r <= 3 ? " r" + r : ""}">${r}</span></td>
      <td>${esc(c.name)}${c.bot ? ' <span class="tag">bot</span>' : ""}${me && c.id === me.id ? ' <span class="tag mine">you</span>' : ""}<div class="bar${me && c.id === me.id ? " mine" : ""}"><i style="width:${barW(c.worth)}%"></i></div></td>
      <td class="num">${c.ships}</td><td class="num">${fmt(c.worth)}</td></tr>`).join("")}
    ${me && !listed && me.rank ? `<tr class="me notListed"><td><span class="rank">${me.rank}</span></td><td>${esc(me.name)} <span class="tag mine">you</span></td>
      <td class="num">${me.ships.length}</td><td class="num">${fmt(me.worth)}</td></tr>` : ""}</table>
    ${me && !listed && me.rank ? `<div class="est">${me.tied
      ? `You share ${ordinal(me.rank)} place with ${me.tied} other ${me.tied === 1 ? "company" : "companies"}; only the top ${world.leaderboard.length} rows are listed, so you're shown at the end.`
      : `You're outside the top ${world.leaderboard.length}, so you're shown at the end.`}</div>` : ""}`;
}

function bindPanel() {
  document.querySelectorAll(".shipCard[data-ship]").forEach(card => {
    if (!card.querySelector("[data-field=dest]")) return;
    card.querySelectorAll("select, input").forEach(el => el.addEventListener("input", () => estimate(card)));
    estimate(card);
  });
  if ($("oCost")) {   // after restoreForm, so it matches what the player typed
    const cost = () => {
      const qty = Number($("oQty").value), price = Number($("oPrice").value), short = Math.floor(qty) * price > me.cash;
      $("oCost").textContent = orderCostText(qty, price);
      $("oCost").classList.toggle("neg", short);
      document.querySelector("[data-act=placeOrder]").disabled = short;
    };
    for (const id of ["oQty", "oPrice"]) $(id).addEventListener("input", cost);
    cost();
  }
  document.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => {
    const act = btn.dataset.act, ship = Number(btn.dataset.ship);
    if (act === "notify") {
      if (store.get("notify") && Notification.permission === "granted") { store.set("notify", null); render(); }
      else Notification.requestPermission().then(p => { if (p === "granted") { store.set("notify", true); toast("Dock alerts on"); } render(); });
    }
    if (act === "sell") command({ type: "sell", ship }, () => toast("Sold"));
    if (act === "fill") command({ type: "sell", ship, order: Number(btn.dataset.order) }, () => toast("Order filled"));
    if (act === "scrap") {
      if (scrapAsk !== ship) { scrapAsk = ship; render(); }
      else { scrapAsk = null; command({ type: "scrapShip", ship }, () => toast(`Ship ${ship} scrapped for ${fmt(world.rules.shipPrice / 2)}`)); }
    }
    if (act === "openPort") { selectedPort = Number(btn.dataset.port); tab = "port"; render(); }
    if (act === "goPort") { selectedPort = Number(btn.dataset.port); tab = "port"; scrollToBuy = true; render(); }
    if (act === "scrapKeep") { scrapAsk = null; render(); }
    if (act === "buyShip") command({ type: "buyShip", port: selectedPort }, () => toast("New ship bought"));
    if (act === "cancelOrder") command({ type: "cancelOrder", order: Number(btn.dataset.order) }, () => toast("Order cancelled"));
    if (act === "listSell") {
      const card = btn.closest(".shipCard");
      command({ type: "placeSell", ship, qty: Number(card.querySelector("[data-field=sellQty]").value),
        price: Number(card.querySelector("[data-field=sellPrice]").value) }, () => toast("Listed for sale"));
    }
    if (act === "buyOrder") command({ type: "buyFromOrder", ship, order: Number(btn.dataset.order), qty: Number(btn.dataset.qty) }, () => toast("Bought"));
    if (act === "placeOrder") command({ type: "placeOrder", port: Number($("oPort").value), good: $("oGood").value,
      qty: Number($("oQty").value), price: Number($("oPrice").value) }, () => toast("Order posted"));
    if (act === "plan") {
      // Fill the sail form with this trip; the player still presses Set sail.
      const card = btn.closest(".shipCard"), set = (field, v) => {
        const el = card.querySelector(`[data-field=${field}]`);
        if (!el) return;
        el.value = v; formState.set(formKey(el), v);
      };
      set("dest", btn.dataset.dest);
      set("good", btn.dataset.good ?? "");
      if (btn.dataset.qty) set("qty", btn.dataset.qty);
      estimate(card);
      card.querySelector("[data-act=sail]").focus();
    }
    if (act === "sail") {
      const card = btn.closest(".shipCard");
      const dest = Number(card.querySelector("[data-field=dest]").value);
      const good = card.querySelector("[data-field=good]")?.value;
      const qty = Number(card.querySelector("[data-field=qty]")?.value || 0);
      command({ type: "sail", ship, dest, ...(good ? { buy: { good, qty } } : {}) }, () => toast(`Sailing to ${world.ports[dest].name}`));
    }
  }));
}

connect();
