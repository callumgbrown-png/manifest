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
      world = msg.world; me = msg.me;
      noteprices();
      if ((selectedPort === null || firstLogin) && me?.ships?.length) selectedPort = me.ships[0].dest ?? me.ships[0].port;
      if (selectedPort === null) selectedPort = 0;
      render();
    } else if (msg.type === "auth") {
      store.set("token", msg.token); showAuth(false);
    } else if (msg.type === "authError") {
      store.set("token", null); showAuth(true); $("authError").textContent = msg.error;
    } else if (msg.type === "result") {
      const cb = pendingReq.get(msg.reqId); pendingReq.delete(msg.reqId);
      if (!msg.ok) toast(msg.error, true); else if (cb) cb();
    } else if (msg.type === "loggedOut") location.reload();
    else if (msg.type === "error") toast(msg.error, true);
  };
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
  function weight(p) { return (p.id === selectedPort ? 100 : 0) + (p.id === hovered ? 90 : 0) + (docked.has(p.id) ? 50 : 0) + (destinations.has(p.id) ? 40 : 0) + (p.produces.length ? 2 : 0); }
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
    ctx.save(); ctx.translate(x, y); ctx.rotate(pos.angle);
    ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.75, size * 0.62); ctx.lineTo(-size * 0.4, 0); ctx.lineTo(-size * 0.75, -size * 0.62); ctx.closePath();
    ctx.fillStyle = own ? C.mine : s.qty > 0 ? "rgba(232,238,242,.85)" : "rgba(232,238,242,.5)"; ctx.fill();
    ctx.restore(); ctx.shadowBlur = 0;
  }
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

// Drag to pan, wheel or pinch to zoom, click a port to open it.
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
      if (id !== null) { selectedPort = id; tab = "port"; render(); }
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
  return `
    <h2>${esc(p.name)}</h2><div class="chips">${chips.join("") || `<span class="quiet">A quiet port</span>`}</div>
    <h3>Market</h3>
    <table class="market"><tr><th>Good</th><th class="num">Price</th><th class="sparkCell">Trend</th><th class="num">Stock</th><th class="num">Inbound</th></tr>${rows}</table>
    <div class="est">${p.emptyInbound} empty ship${p.emptyInbound === 1 ? "" : "s"} heading here to load. Inbound cargo will push prices down when it lands.</div>
    <h3>Player orders here</h3>
    ${orders.length ? `<table><tr><th>Player</th><th>Wants to</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${orders.map(o => `<tr${me && o.owner === me.id ? ' class="me"' : ""}><td>${esc(o.ownerName)}</td><td>${o.side === "sell" ? "sell" : "buy"}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="quiet">None yet.</div>`}
    <h3>Your ships here</h3>
    ${docked.length ? docked.map(shipCard).join("") : `<div class="empty">None of your ships are docked here.${coming.length ? ` ${coming.length === 1 ? "One is" : coming.length + " are"} on the way.` : me ? " Pick a port with your ship from the map or the Fleet tab." : ""}</div>`}
    ${me && docked.length && !world.seasonOver && me.ships.length < world.rules.maxShips ? `<div class="row"><button data-act="buyShip">Buy a ship here (${fmt(world.rules.shipPrice)})</button></div>` : ""}`;
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
  return `<div class="shipCard" data-ship="${s.id}">
    <div class="top"><b>Ship ${s.id}</b>${cargo}</div>
    <div class="quiet">Docked at ${esc(port.name)}</div>
    ${s.qty > 0 ? `<div class="row"><button data-act="sell" data-ship="${s.id}">Sell to market at ${port.prices[s.good].toFixed(2)}</button>
      ${matching.map(o => `<button class="secondary" data-act="fill" data-ship="${s.id}" data-order="${o.id}">Fill ${esc(o.ownerName)}'s order at ${o.price.toFixed(2)}</button>`).join("")}</div>
      <div class="row"><input data-field="sellQty" type="number" min="1" max="${s.qty}" value="${s.qty}" style="width:80px" title="Quantity">
        <input data-field="sellPrice" type="number" step="0.5" value="${(port.prices[s.good] * 1.15).toFixed(1)}" style="width:90px" title="Your price per unit">
        <button class="secondary" data-act="listSell" data-ship="${s.id}">List for sale here</button></div>
      <div class="est">Listing leaves the goods at this port for other players to buy, and frees your ship.</div>` : ""}
    ${forSale.length ? `<h3>For sale here</h3>${forSale.map(o => `<div class="row"><span>${o.qty} ${GOOD_NAMES[o.good]} from ${esc(o.ownerName)} at ${o.price.toFixed(2)}</span>
      <button class="secondary" data-act="buyOrder" data-ship="${s.id}" data-order="${o.id}" data-qty="${Math.min(o.qty, world.rules.capacity - s.qty)}">Buy ${Math.min(o.qty, world.rules.capacity - s.qty)}</button></div>`).join("")}` : ""}
    <label>Destination<select data-field="dest">${dests.map(p => `<option value="${p.id}">${esc(p.name)} (≈${Math.ceil(distance(s.port, p.id) / world.rules.speed)} h)</option>`).join("")}</select></label>
    ${s.qty === 0 ? `<div class="row" style="margin-top:4px">
      <select data-field="good" style="width:auto"><option value="">Sail empty</option>${GOOD_NAMES.map((g, i) => `<option value="${g}">Load ${g} at ${port.prices[i].toFixed(2)}</option>`).join("")}</select>
      <input data-field="qty" type="number" min="1" max="${world.rules.capacity}" value="${world.rules.capacity}" style="width:90px"></div>` : ""}
    <div class="est big" data-field="estimate"></div>
    <div class="row"><button data-act="sail" data-ship="${s.id}">Set sail</button>
      ${me.ships.length > 1 && s.qty === 0 ? `<button class="link" data-act="scrap" data-ship="${s.id}">Scrap for ${fmt(world.rules.shipPrice / 2)}</button>` : ""}</div>
  </div>`;
}

function estimate(card) {
  const s = me.ships.find(x => x.id === Number(card.dataset.ship));
  const dest = Number(card.querySelector("[data-field=dest]").value);
  const goodSel = card.querySelector("[data-field=good]");
  const g = s.qty > 0 ? s.good : (goodSel?.value ? GOOD_NAMES.indexOf(goodSel.value) : -1);
  const qty = s.qty > 0 ? s.qty : Number(card.querySelector("[data-field=qty]")?.value || 0);
  const here = world.ports[s.port], there = world.ports[dest];
  const fuel = distance(s.port, dest) * world.rules.fuelPer100 / 100 * here.prices[1];
  let text = `Fuel ≈ ${fmt(fuel)}, port fee ${world.rules.portFee}.`;
  if (me.ships.length === 1 && fuel > me.cash) text += " You can't cover the fuel, so it goes on credit (your cash goes below zero).";
  if (g >= 0 && qty > 0) {
    const buy = s.qty > 0 ? 0 : qty * here.prices[g] * (1 + world.rules.tax);
    const sell = qty * there.prices[g] * (1 - world.rules.tax);
    const profit = sell - buy - fuel - world.rules.portFee;
    text += ` At today's prices this trip ${profit >= 0 ? "makes" : "loses"} <b class="${profit >= 0 ? "pos" : "neg"}">${fmt(Math.abs(profit))}</b>. ${fmt(there.inbound[g])} ${GOOD_NAMES[g]} is already heading there.`;
  }
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
    <h3>Ships</h3>${me.ships.map(shipCard).join("")}`;
}

function ordersPanel() {
  const mine = me ? world.orders.filter(o => o.owner === me.id) : [];
  const others = world.orders.filter(o => !me || o.owner !== me.id);
  const b = world.rules.bands;
  return `<h2>Orders</h2>
    <div class="quiet">Post a price you'll pay for goods delivered to a port; your cash is held until it fills. To sell at your own price, use "List for sale" on a docked ship with cargo. Orders that cross fill automatically.</div>
    ${me && world.seasonOver ? `<div class="est">Trading is closed until the next season starts.</div>` : ""}
    ${me && !world.seasonOver ? `<h3>Post an order</h3>
    <div class="row"><select id="oPort">${world.ports.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${p.id === selectedPort ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="row"><select id="oGood" style="width:auto">${GOOD_NAMES.map(g => `<option>${g}</option>`).join("")}</select>
      <input id="oQty" type="number" min="1" max="1000" value="100" style="width:90px" title="Quantity">
      <input id="oPrice" type="number" step="0.5" value="30" style="width:90px" title="Price per unit">
      <button data-act="placeOrder">Post</button></div>
    <div class="est">Grain ${b.grain.floor}–${b.grain.ceiling}, fuel ${b.fuel.floor}–${b.fuel.ceiling} per unit.</div>` : ""}
    <h3>Your orders</h3>
    ${mine.length ? `<table>${mine.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${o.side === "sell" ? "selling" : "buying"} ${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td><td>${world.seasonOver ? "" : `<button class="link" data-act="cancelOrder" data-order="${o.id}">Cancel</button>`}</td></tr>`).join("")}</table>` : `<div class="empty">You have no open orders.</div>`}
    <h3>All open orders</h3>
    ${others.length ? `<table><tr><th>Port</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${others.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td>${o.side === "sell" ? "for sale" : "wanted"}: ${GOOD_NAMES[o.good]}</td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="empty">No other open orders.</div>`}`;
}

function boardPanel() {
  const top = Math.max(1, world.leaderboard[0]?.worth ?? 1);
  // Bars show the spread between companies, not distance from zero (everyone starts near 16,000).
  const low = Math.min(...world.leaderboard.map(c => c.worth)), span = Math.max(1, top - low);
  const barW = w => (15 + 85 * (w - low) / span).toFixed(0);
  const listed = me && world.leaderboard.some(c => c.id === me.id);
  return `<h2>Leaderboard</h2><div class="quiet">Ranked by net worth: cash, half the value of ships, cargo and open orders. Companies marked bot are computer traders that keep the markets moving. <a href="/seasons">Past seasons</a></div>
    <h3>Top companies</h3>
    <table><tr><th>#</th><th>Company</th><th class="num">Ships</th><th class="num">Net worth</th></tr>
    ${world.leaderboard.map((c, i) => `<tr${me && c.id === me.id ? ' class="me"' : ""}><td><span class="rank${i < 3 ? " r" + (i + 1) : ""}">${i + 1}</span></td>
      <td>${esc(c.name)}${c.bot ? ' <span class="tag">bot</span>' : ""}${me && c.id === me.id ? ' <span class="tag mine">you</span>' : ""}<div class="bar${me && c.id === me.id ? " mine" : ""}"><i style="width:${barW(c.worth)}%"></i></div></td>
      <td class="num">${c.ships}</td><td class="num">${fmt(c.worth)}</td></tr>`).join("")}</table>
    ${me && !listed ? `<div class="est big">You're outside the top ${world.leaderboard.length} with ${fmt(me.worth)}. The leader has ${fmt(top)}.</div>` : ""}`;
}

function bindPanel() {
  document.querySelectorAll(".shipCard[data-ship]").forEach(card => {
    if (!card.querySelector("[data-field=dest]")) return;
    card.querySelectorAll("select, input").forEach(el => el.addEventListener("input", () => estimate(card)));
    estimate(card);
  });
  document.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => {
    const act = btn.dataset.act, ship = Number(btn.dataset.ship);
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
