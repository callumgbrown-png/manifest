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
      if (before && me && before.id === me.id) noteDockings(before);
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
  for (const s of docked) {
    const text = `Ship ${s.id} docked at ${world.ports[s.port].name}${s.qty > 0 ? ` with ${s.qty} ${GOOD_NAMES[s.good]}` : ""}`;
    toast(text);
    if (store.get("notify") && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification("Manifest", { body: text, tag: `dock-${s.id}` }); } catch {}
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

function command(cmd, onOk) {
  const id = ++reqId;
  pendingReq.set(id, () => { if (cmd.ship !== undefined) clearForm(cmd.ship); onOk?.(); render(); });
  ws.send(JSON.stringify({ type: "cmd", reqId: id, cmd }));
}

function toast(text, bad = false) {
  const t = $("toast"); t.textContent = text; t.className = "toast" + (bad ? " bad" : "");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add("hidden"), 3500);
}

// ------------------------------------------------------------ auth

function showAuth(on) { $("auth").classList.toggle("hidden", !on); }
let authMode = "login";
document.querySelectorAll("#authForm button").forEach(b => b.addEventListener("click", () => { authMode = b.dataset.mode; }));
$("authForm").addEventListener("submit", e => {
  e.preventDefault();
  $("authError").textContent = "";
  ws.send(JSON.stringify({ type: authMode, name: $("authName").value, password: $("authPass").value }));
});
$("logout").addEventListener("click", () => {
  store.set("token", null);
  // Tell the server to end the session, then start over; reload anyway if it doesn't answer.
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "logout" }));
  setTimeout(() => location.reload(), 300);
});

// ------------------------------------------------------------ first-time guide

// Shown once to a new company (remembered in this browser), and any time from "How to play".
let guidePending = false, guideAt = 0;
function guideSteps() {
  const ship = me?.ships?.[0], here = ship && ship.dest === null ? world?.ports[ship.port] : null;
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
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("guide").classList.contains("hidden")) closeGuide(); });

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
  estimate(card);
  card.querySelector("[data-act=sail]")?.scrollIntoView({ block: "nearest" });
  toast(`Ship ${s.id} → ${world.ports[id].name} (≈${Math.ceil(distance(s.port, id) / world.rules.speed)} h). Tap it again to open the port.`);
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
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("hName").textContent = me?.name ?? "–";
  $("hCash").textContent = me ? fmt(me.cash) : "–";
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
  const html = { port: portPanel, fleet: fleetPanel, orders: ordersPanel, board: boardPanel }[tab]();
  $("panel").innerHTML = html;
  restoreForm();
  bindPanel();
}

// What the player has typed or picked survives the panel being rebuilt by live updates.
let renderPending = false, pointerInPanel = false;
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
    ${docked.length ? docked.map(shipCard).join("") : `<div class="empty">None of your ships are docked here.${coming.length ? ` ${coming.length === 1 ? "One is" : coming.length + " are"} on the way.` : me ? " Pick a port with your ship from the map or the Fleet tab." : ""}</div>`}
    ${me && docked.length && !world.seasonOver && me.ships.length < world.rules.maxShips ? buyShipHtml() : ""}`;
  return `
    <h2>${esc(p.name)}</h2><div class="chips">${chips.join("") || `<span class="quiet">A quiet port</span>`}</div>
    ${shipsFirst ? shipsHtml : ""}
    <h3>Market</h3>
    <table class="market"><tr><th>Good</th><th class="num">Price</th><th class="sparkCell">Trend</th><th class="num">Stock</th><th class="num">Inbound</th></tr>${rows}</table>
    <div class="est">${p.emptyInbound ? `${p.emptyInbound} empty ship${p.emptyInbound === 1 ? "" : "s"} heading here to load.` : "No empty ships heading here to load."} Inbound cargo will push prices down when it lands.</div>
    <h3>Player orders here</h3>
    ${orders.length ? `<table><tr><th>Player</th><th>Wants to</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${orders.map(o => `<tr${me && o.owner === me.id ? ' class="me"' : ""}><td>${esc(o.ownerName)}</td><td>${o.side === "sell" ? "sell" : "buy"}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="quiet">None yet.</div>`}
    ${shipsFirst ? "" : shipsHtml}`;
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
  const trips = bestTrips(s), move = trips.length || s.qty > 0 ? null : bestMove(s);
  const plan = trips[0] ? { dest: trips[0].dest, good: s.qty > 0 ? "" : GOOD_NAMES[trips[0].g], qty: trips[0].qty }
    : move ? { dest: move.dest, good: "", qty: world.rules.capacity }
    : { dest: null, good: "", qty: world.rules.capacity };   // nothing worth doing: don't pick a trip for them
  return `<div class="shipCard" data-ship="${s.id}">
    <div class="top"><b>Ship ${s.id}</b>${cargo}</div>
    <div class="quiet">Docked at ${esc(port.name)}</div>
    ${s.qty > 0 ? `<div class="row"><button data-act="sell" data-ship="${s.id}">Sell to market at ${port.prices[s.good].toFixed(2)}</button>
      ${matching.map(o => `<button class="secondary" data-act="fill" data-ship="${s.id}" data-order="${o.id}">Fill ${esc(o.ownerName)}'s order at ${o.price.toFixed(2)}</button>`).join("")}</div>
      <div class="row labelled"><label class="mini">Quantity<input data-field="sellQty" type="number" min="1" max="${s.qty}" value="${s.qty}" style="width:80px"></label>
        <label class="mini">Price each<input data-field="sellPrice" type="number" step="0.5" value="${(port.prices[s.good] * 1.15).toFixed(1)}" style="width:90px"></label>
        <button class="secondary" data-act="listSell" data-ship="${s.id}">List for sale here</button></div>
      <div class="est">Listing leaves the goods at this port for other players to buy, and frees your ship.</div>` : ""}
    ${forSale.length ? `<h3>For sale here</h3>${forSale.map(o => `<div class="row"><span>${o.qty} ${GOOD_NAMES[o.good]} from ${esc(o.ownerName)} at ${o.price.toFixed(2)}</span>
      <button class="secondary" data-act="buyOrder" data-ship="${s.id}" data-order="${o.id}" data-qty="${Math.min(o.qty, world.rules.capacity - s.qty)}">Buy ${Math.min(o.qty, world.rules.capacity - s.qty)}</button></div>`).join("")}` : ""}
    ${tripsHtml(s, trips, move)}
    <label>Destination <span class="quiet">(or tap a port on the map)</span><select data-field="dest">${plan.dest === null ? `<option value="" selected disabled>Choose where to sail…</option>` : ""}${dests.map(p => `<option value="${p.id}"${p.id === plan.dest ? " selected" : ""}>${esc(p.name)} (≈${Math.ceil(distance(s.port, p.id) / world.rules.speed)} h)</option>`).join("")}</select></label>
    ${s.qty === 0 ? `<div class="row" style="margin-top:4px">
      <select data-field="good" style="width:auto"><option value="">Sail empty</option>${GOOD_NAMES.map((g, i) => `<option value="${g}"${g === plan.good ? " selected" : ""}>Load ${g} at ${port.prices[i].toFixed(2)}</option>`).join("")}</select>
      <input data-field="qty" type="number" min="1" max="${world.rules.capacity}" value="${plan.qty}" style="width:90px"></div>` : ""}
    <div class="est big" data-field="estimate"></div>
    <div class="row"><button data-act="sail" data-ship="${s.id}">Set sail</button>
      ${me.ships.length > 1 && s.qty === 0 ? `<button class="link" data-act="scrap" data-ship="${s.id}">Scrap for ${fmt(world.rules.shipPrice / 2)}</button>` : ""}</div>
  </div>`;
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
function rawTrips(s, n = 3, delay = 0) {
  const cap = world.rules.capacity, here = world.ports[s.port], out = [];
  const goods = s.qty > 0 ? [s.good] : [0, 1];
  for (const g of goods) {
    const qty = s.qty > 0 ? s.qty : Math.floor(Math.min(cap, here.stock[g], Math.max(0, me.cash - 300) / (here.prices[g] * (1 + world.rules.tax) * 1.1)));
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

/** When no trip pays from here: the port whose best trip, minus the cost of sailing there empty, pays most per hour. */
function bestMove(s, delay = 0) {
  let best = null;
  for (const p of world.ports) {
    if (p.id === s.port) continue;
    const go = tripProfit(s, p.id, -1, 0);
    const [next] = rawTrips({ ...s, port: p.id, qty: 0 }, 1, delay + go.hours);
    if (!next) continue;
    const net = next.profit + go.profit;   // go.profit is minus fuel and the port fee
    const score = net / (go.hours + next.hours);
    if (net >= 50 && (!best || score > best.score)) best = { dest: p.id, score, cost: -go.profit, hours: go.hours, next };
  }
  return best;
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
  if (!trips.length && move) return `<h3>Best trips from here</h3><div class="est">No trip pays from here right now. Your best move:</div>
    <div class="trips"><button class="trip move secondary" data-act="plan" data-ship="${s.id}" data-dest="${move.dest}" data-good="">
      <span>Sail empty → ${esc(world.ports[move.dest].name)}, then load ${GOOD_NAMES[move.next.g]} for ${esc(world.ports[move.next.dest].name)}</span>
      <span class="num"><b class="pos">+${fmt(move.next.profit - move.cost)}</b> · ${move.hours + move.next.hours} h</span></button></div>
    <div class="est">Getting there costs about ${fmt(move.cost)} in fuel and fees; the trip from there pays about +${fmt(move.next.profit)} at today's prices.</div>`;
  const left = world.seasonHours - world.tick;
  const soonest = Math.min(...world.ports.filter(p => p.id !== s.port).map(p => Math.max(1, Math.ceil(distance(s.port, p.id) / world.rules.speed))));
  if (!trips.length && !landsInSeason(soonest)) return `<h3>Best trips from here</h3><div class="est">The season ends in ${left} h, too soon for any voyage from here to dock in time. ${s.qty > 0 ? endCargoAdvice(s) : "Your ship can stay where it is."}</div>`;
  if (!trips.length) return `<h3>Best trips from here</h3><div class="est">${s.qty > 0 ? "Nowhere pays more than selling here right now." : "No trip pays right now at these prices, from here or one hop away. Waiting costs nothing; prices move every hour."}</div>`;
  return `<h3>Best trips from here</h3><div class="trips">${trips.map(t => `<button class="trip secondary" data-act="plan" data-ship="${s.id}" data-dest="${t.dest}" data-good="${s.qty > 0 ? "" : GOOD_NAMES[t.g]}" data-qty="${t.qty}">
      <span>${s.qty > 0 ? "Sell" : `Load ${t.qty}`} <span class="tag ${GOOD_NAMES[t.g]}">${GOOD_NAMES[t.g]}</span> → ${esc(world.ports[t.dest].name)}</span>
      <span class="num"><b class="pos">+${fmt(t.profit)}</b> · ${t.hours} h</span>
      ${t.next ? `<span class="then">then +${fmt(t.next.profit)} from there</span>` : t.onward ? `<span class="then">then a short hop to more trips</span>` : `<span class="then">nothing pays from there yet</span>`}</button>`).join("")}</div>`;
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
  else if (last) text += " Sail empty instead: your last ship's fuel can go on credit.";
  else text += ` Only a company's last ship can sail on credit: sell cargo or scrap a spare ship (${fmt(world.rules.shipPrice / 2)}) first.`;
  return text;
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
  const qty = s.qty > 0 ? s.qty : Number(card.querySelector("[data-field=qty]")?.value || 0);
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
      <div><span>Cargo value</span><b>${fmt(cargo)}</b></div><div><span>Net worth</span><b>${fmt(me.worth)}</b></div>
    </div>
    <h3>Ships</h3>${me.ships.map(shipCard).join("")}
    ${notifyHtml()}
    ${worthChart()}
    ${tripLog()}`;
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
    <div class="axis"><span>Day 1</span><span>Today</span></div>`;
}

function tripLog() {
  const trips = me.trips ?? [];
  if (!trips.length) return `<h3>Trip log</h3><div class="empty">Your finished trips and their profit will show here.</div>`;
  const rows = trips.map(t => {
    const what = t.good === null ? "empty" : `${t.qty} ${GOOD_NAMES[t.good]}`;
    const profit = t.earned - t.spent;
    const result = t.open
      ? `<span class="quiet">${t.good === null ? "at sea" : "in progress"}</span>`
      : t.good === null ? `<span class="neg">−${fmt(t.spent)}</span>`
      : `<b class="${profit >= 0 ? "pos" : "neg"}">${profit >= 0 ? "+" : "−"}${fmt(Math.abs(profit))}</b>${t.listed ? ` <span class="quiet" title="Part of the cargo was listed for sale, so it isn't counted">*</span>` : ""}`;
    return `<tr><td class="num">${Math.floor(t.departTick / 24) + 1}</td><td>${esc(world.ports[t.from].name)} → ${esc(world.ports[t.to].name)}</td><td>${what}</td><td class="num">${result}</td></tr>`;
  }).join("");
  const done = trips.filter(t => !t.open), total = done.reduce((a, t) => a + t.earned - t.spent, 0);
  return `<h3>Trip log</h3>
    <table class="trips-log"><tr><th class="num">Day</th><th>Route</th><th>Cargo</th><th class="num">Profit</th></tr>${rows}</table>
    ${done.length ? `<div class="est">Last ${done.length} finished trip${done.length === 1 ? "" : "s"}: <b class="${total >= 0 ? "pos" : "neg"}">${total >= 0 ? "+" : "−"}${fmt(Math.abs(total))}</b> after cargo, fuel, fees and tax.${trips.some(t => t.listed) ? " * Listed cargo isn't counted until it sells." : ""}</div>` : ""}`;
}

/** What a buy order costs if it fills completely: the goods don't come back to you. */
function orderCostText(qty, price) {
  const total = Math.floor(qty) * price;
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
  if (me.cash >= price) return `<div class="row"><button data-act="buyShip">Buy a ship here (${fmt(price)})</button></div>
    <div class="est">Ships count at half their price, so your net worth drops by ${fmt(price / 2)} at first; the extra ship has to earn it back. Every ship after the first costs ${fmt(world.rules.upkeep)} a day.</div>`;
  return `<div class="row"><button disabled>Buy a ship here (${fmt(price)})</button><span class="quiet">You need ${fmt(price - me.cash)} more cash.</span></div>`;
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
    const cost = () => { $("oCost").textContent = orderCostText(Number($("oQty").value), Number($("oPrice").value)); };
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
    if (act === "scrap") command({ type: "scrapShip", ship }, () => toast("Ship scrapped"));
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
