// Manifest browser client. Plain JavaScript, no build step.
"use strict";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString("en-IE");
const GOOD_NAMES = ["grain", "fuel", "ore", "machinery"];
const ALL_GOODS = GOOD_NAMES.map((_, g) => g);
const SHIP_CLASSES = ["coaster", "freighter", "bulker"];
const CLASS_NAME = { coaster: "Coaster", freighter: "Freighter", bulker: "Bulker", pirate: "Pirate Speedboat" };
const className = c => CLASS_NAME[c] ?? c;
let buyLock = false, justBought = null;   // buyLock: a purchase is on its way, so a second click can't send another
/** Classes this player can buy at the open port: pirate ships are sold only at your home port. */
function buyableClasses() { return world.rules.pirates?.enabled && me && (selectedPort === me.home || world.rules.pirates.homeOnly === false) ? [...SHIP_CLASSES, "pirate"] : SHIP_CLASSES; }
let buyClass = "freighter";   // the class the Buy a ship control is set to

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let dist = null;
let serverNavigation = null;
let ws, world = null, me = null, tab = "port", selectedPort = null, tickAt = Date.now(), reqId = 0;
const pendingReq = new Map();
let recoveryFailure = null;
let recoveryReason = null, recoveryContext = null;
const voyageQuotes = new Map();
const quoteRequests = new Map();

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
    quoteRequests.clear(); voyageQuotes.clear(); buyLock = false;
    setTimeout(connect, 2000);
  };
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "static") {
      dist = msg.dist; serverNavigation = msg.navigation ?? null;
      if (serverNavigation?.terrain) { MAP_W = serverNavigation.terrain.width; MAP_H = serverNavigation.terrain.height; } else { MAP_W = 1000; MAP_H = 700; }
      WORLD_K = MAP_W / 1000;
      lanes = null; voyageCache.clear(); islandKey = ""; bgKey = "";
      return;
    }
    if (msg.type === "history") { hist = msg.history.slice(); return; }
    if (msg.type === "state") {
      if (!world || msg.world.tick !== world.tick) tickAt = Date.now();
      const firstLogin = !me && msg.me;
      const before = me;
      const geometryChanged = !world || world.navigationId !== msg.world.navigationId;
      world = msg.world; me = msg.me;
      if (!me || !before || me.id !== before.id || me.recovery?.cash !== before.recovery?.cash) { recoveryFailure = null; recoveryReason = null; }
      if (serverNavigation && serverNavigation.id === world.navigationId) world.routes = serverNavigation.routes;
      if (geometryChanged) {
        lanes = null; voyageCache.clear(); formState.clear();
        activeShip = null; selectedPort = null;
      }
      ensureIslandBuffer(world);
      if (before && me && before.id === me.id) { noteDockings(before); noteForcedSales(before); noteOrderFills(before); }
      noteprices();
      if ((selectedPort === null || firstLogin) && me?.ships?.length) selectedPort = me.ships[0].dest ?? me.ships[0].port;
      if (selectedPort === null) selectedPort = 0;
      render();
      if (guidePending && me) { guidePending = false; openGuide(); }
    } else if (msg.type === "voyageQuote") {
      const pending = quoteRequests.get(msg.reqId); quoteRequests.delete(msg.reqId);
      if (pending) {
        voyageQuotes.set(pending.key, { response: msg, at: Date.now() });
        const card = document.querySelector(`.shipCard[data-ship="${pending.ship}"]`);
        if (card?.dataset.quoteKey === pending.key) showVoyageQuote(card, msg);
      }
    } else if (msg.type === "auth") {
      store.set("token", msg.token); showAuth(false);
      if (authMode === "register" && !store.get("guideSeen")) guidePending = true;
    } else if (msg.type === "authError") {
      store.set("token", null); showAuth(true); $("authError").textContent = msg.error;
    } else if (msg.type === "result") {
      const cb = pendingReq.get(msg.reqId); pendingReq.delete(msg.reqId);
      buyLock = false;
      if (!msg.ok) {
        if (msg.recovery) { recoveryFailure = msg.recovery; render(); }
        toast(msg.recovery?.shortfall > 0 ? `You are short of ${fmt(Math.ceil(msg.recovery.shortfall))} cash. See recovery options.` : msg.error, true);
      } else { recoveryFailure = null; if (cb) cb(msg); }
    } else if (msg.type === "loggedOut") location.reload();
    else if (msg.type === "error") toast(msg.error, true);
  };
}

/** Tell the player when one of their ships docks: a toast, plus a browser notification if they
 *  turned those on and the tab isn't in view. */
function noteDockings(before) {
  const docked = me.ships.filter(s => s.dest === null && before.ships.some(b => b.id === s.id && b.dest !== null));
  // Watching the port a ship just left (nothing of yours docked there now)? Follow it to where it
  // docked, so its Sell button is in view instead of "None of your ships are docked here". Also on the
  // Fleet and Leaderboard tabs, so opening Port later shows the docked ship, not the port it left
  // (not on Orders, whose port box starts on the selected port).
  const watching = tab !== "orders" && !me.ships.some(s => s.dest === null && s.port === selectedPort)
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
/** Orders of yours another company filled since the last update. A listing's money arrives on its
 *  own (often while the player is elsewhere), so without this cash just jumped with no reason given. */
function orderFillText(f) {
  const where = world.ports[f.port].name, what = `${f.qty} ${GOOD_NAMES[f.good]}`;
  return f.side === "sell"
    ? `Your listing at ${where} sold ${what} for ${fmt(f.amount)} after tax${f.left > 0 ? `; ${f.left} still listed` : ""}.`
    : `Your buy order at ${where} was filled: ${what} delivered for ${fmt(f.amount)}${f.left > 0 ? `; ${f.left} still wanted` : ""}.`;
}
function noteOrderFills(before) {
  const seen = Math.max(0, ...(before.orderFills ?? []).map(f => f.id));
  for (const f of (me.orderFills ?? []).filter(f => f.id > seen)) {
    toast(orderFillText(f));
    if (store.get("notify") && "Notification" in window && Notification.permission === "granted" && document.hidden) {
      try { new Notification("Manifest", { body: orderFillText(f), tag: `order-${f.order}` }); } catch {}
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
  if (send({ type: "cmd", reqId: id, cmd })) pendingReq.set(id, res => { if (cmd.ship !== undefined) clearForm(cmd.ship); onOk?.(res); render(); });
}

/** What happened to a new listing: goods can sell at once to buy orders already waiting at the port. */
function listedText(res) {
  if (!res?.sold) return "Listed for sale";
  const sold = `Sold ${res.sold} at once to a waiting buy order for ${fmt(res.earned)} after tax`;
  return res.id ? `${sold}; the rest is listed for sale` : sold;
}

/** What happened to a new buy order: it can buy at once from listings already at the port, and those
 *  goods are used up there, so "Order posted" with no order on the list and less cash looked like a bug. */
function orderPostedText(res, port, good) {
  if (!res?.bought) return "Order posted";
  const bought = `Bought ${res.bought} ${good} at once from a listing at ${world.ports[port].name} for ${fmt(res.spent)} (used up there)`;
  return res.id ? `${bought}; the rest is posted as a buy order` : bought;
}

/** kind: falsy for done (tick), true or "bad" for an error, "warn" for done-but-careful. */
function toast(text, kind = false) {
  const t = $("toast"); t.textContent = text; t.className = "toast" + (kind === "warn" ? " warn" : kind ? " bad" : "");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add("hidden"), 3500);
}

// ------------------------------------------------------------ auth

function showAuth(on) {
  $("auth").classList.toggle("hidden", !on);
  // Keep keyboard and screen-reader users on the sign-in card, not the game behind it.
  for (const el of document.querySelectorAll("header, #seasonBanner, main")) el.inert = on;
}
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
    ["Buy where it's cheap", "Each port makes some goods and needs others. Where a good is made, stock is high and the price is low. On your ship's card, pick what to load (grain, fuel, ore or machinery) and how much; cheap bulk goods suit big ships, valuable machinery suits small, fast ones."],
    ["Sail where it's needed", "Tap a port on the map, or pick one from the list, to set the destination. The estimate counts fuel, the port fee and how prices move as you trade. \"Best trips from here\" fills in the most profitable ones for you."],
    ["Sell, and grow", "When your ship docks, sell to the market or fill another player's order. Use the profit to buy more ships: coasters are fast and small, bulkers slow and big. The company with the highest net worth when the season ends wins."],
  ];
}
let guideOpener = null;   // where focus goes back to when the guide closes
function openGuide() {
  const a = document.activeElement;
  guideOpener = a && a !== document.body && !$("guide").contains(a) ? a : null;
  guideAt = 0; showGuideStep(); $("guide").classList.remove("hidden"); $("guideNext").focus();
}
function closeGuide() {
  $("guide").classList.add("hidden"); store.set("guideSeen", "1");
  // Back to the button that opened it, or (shown at sign-up, or that button is now hidden) to the open tab.
  const back = guideOpener?.isConnected && guideOpener.offsetParent ? guideOpener : document.querySelector("#tabs button.on");
  guideOpener = null; back?.focus();
}
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
let routeIndex = new Map();
const voyageCache = new Map();
function buildLanes() {
  routeIndex = ManifestNavigation.routeIndex(world.routes, world.ports);
  voyageCache.clear();
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
  for (let cur = a, guard = 0; cur !== b && guard < 64; guard++) { cur = lanes.next[cur][b]; if (cur < 0) return []; path.push(cur); }
  return path;
}
function voyageGeometry(a,b) {
  const key = `${a}:${b}`;
  if (!voyageCache.has(key)) voyageCache.set(key, ManifestNavigation.voyage(lanePath(a,b),routeIndex));
  return voyageCache.get(key);
}
/** Where a ship is now: a point on its lane and the direction it's heading. */
function shipPos(s) {
  const a = world.ports[s.port];
  if (s.dest === null) return { x: a.x, y: a.y, angle: -Math.PI / 2, path: null, f: 1 };
  const total = Math.max(1, s.arriveTick - s.departTick);
  const elapsed = world.tick - s.departTick + Math.min(1, (Date.now() - tickAt) / world.tickMs);
  const f = Math.max(0, Math.min(1, elapsed / total));
  return {...ManifestNavigation.position(voyageGeometry(s.port,s.dest),f),f};
}
/** Stats of a ship class (or of a ship, by its type); the server sends them in world.rules.shipTypes. */
function spec(s) {
  const t = world.rules.shipTypes;
  const base = t[(typeof s === "string" ? s : s?.type) || "freighter"] || t.freighter;
  const capacity = s?.capacity ?? me?.ships.find(ship => ship.id === s?.id)?.capacity;
  return capacity === undefined ? base : { ...base, capacity };
}
/** The daily upkeep the server charges (engine upkeepDue): every ship's upkeep less one freighter's worth. */
function upkeepDue(ships) { return Math.max(0, ships.reduce((a, s) => a + spec(s).upkeep, 0) - spec("freighter").upkeep); }
/** Half of what the cheapest spare ship paid: what a "scrap a spare ship" hint can quote without picking one. */
function spareScrap() { return Math.min(...me.ships.map(s => spec(s).price / 2)); }
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
// World size in map units. Original worlds are 1000 x 700; new archipelago worlds are 2000 x 1400 (4x the area).
// Both are read from the server's terrain, so the same client draws either. WORLD_K = linear size vs the original,
// used to keep icons, grid and harbour glow the same size on screen whatever the world size.
let MAP_W = 1000, MAP_H = 700, WORLD_K = 1;
const portBoxes = new Map();   // port id -> screen rectangle of its sprite group, refilled every frame
const shipBoxes = [];          // docked ships drawn at their berth this frame: { id, port, x, y, w, h }, for clicking
let harbours = null, harbourKey = "";   // world-space harbour placements from the land mask (harbours.js)
/** Build (once per world and sprite load) where every quay and land building goes. */
function ensureHarbours() {
  if (!world || !window.ManifestPortSprites?.ready()) return;
  const terrain = serverNavigation && serverNavigation.id === world.navigationId ? serverNavigation.terrain : null;
  const key = `${world.navigationId}|${WORLD_K}|${terrain ? 1 : 0}|${world.ports.length}`;
  if (key === harbourKey) return;
  harbourKey = key;
  harbours = ManifestHarbours.build(world.ports, terrain, ManifestPortSprites.specs(WORLD_K));
}
/** Hull length on screen for a ship class: grows with the map like the quays do, within readable limits. */
function shipPx(cs) { return Math.max(20 * cs, Math.min(80 * cs, 13 * WORLD_K * cs * view.scale)); }
const GOOD_GLYPH = { grain: "circle", fuel: "diamond", ore: "square", machinery: "triangle" };
/** A compact goods badge: the good's colour AND shape (circle grain, diamond fuel, square ore, triangle machinery). */
function drawGlyph(c, good, x, y, r) {
  c.beginPath();
  const g = GOOD_GLYPH[good];
  if (g === "diamond") { c.moveTo(x, y - r * 1.2); c.lineTo(x + r * 1.2, y); c.lineTo(x, y + r * 1.2); c.lineTo(x - r * 1.2, y); c.closePath(); }
  else if (g === "square") c.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (g === "triangle") { c.moveTo(x, y - r * 1.15); c.lineTo(x + r * 1.1, y + r * 0.85); c.lineTo(x - r * 1.1, y + r * 0.85); c.closePath(); }
  else c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = C[good]; c.fill(); c.lineWidth = 1; c.strokeStyle = "rgba(10,22,32,.95)"; c.stroke();
}
const C = {};   // colours from the stylesheet, read once
function readColours() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["line", "line-strong", "ink", "quiet", "grain", "fuel", "ore", "machinery", "other", "mine", "sea", "sea-deep", "bg"]) C[k] = cs.getPropertyValue("--" + k).trim();
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
let islandBuffer = null, islandKey = "";
function ensureIslandBuffer(state) {
  const terrain = serverNavigation && serverNavigation.id === state.navigationId ? serverNavigation.terrain : null;
  const key = terrain ? state.navigationId : ManifestIslands.geometryKey(state, MAP_W, MAP_H);
  if (key === islandKey) return;
  islandBuffer = terrain ? ManifestNavigation.terrainBuffer(terrain)
    : ManifestIslands.createLayer(state.ports, state.routes, MAP_W, MAP_H, state.mapSeed ?? 7).canvas;
  islandKey = key;
  bgKey = "";
}
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
  if (islandBuffer) {
    g.imageSmoothingEnabled = false;   // crisp coast edges, like the pixel-art sprites on top of them
    g.drawImage(islandBuffer, view.ox, view.oy,
      MAP_W * view.scale, MAP_H * view.scale);
  }
  // Chart grid.
  g.lineWidth = 1;
  for (let x = 0; x <= MAP_W; x += 50 * WORLD_K) {
    g.strokeStyle = Math.round(x / WORLD_K) % 250 === 0 ? "rgba(140,190,220,.04)" : "rgba(140,190,220,.015)";
    const sx = Math.round(view.ox + x * view.scale) + 0.5; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, H); g.stroke();
  }
  for (let y = 0; y <= MAP_H; y += 50 * WORLD_K) {
    g.strokeStyle = Math.round(y / WORLD_K) % 250 === 0 ? "rgba(140,190,220,.04)" : "rgba(140,190,220,.015)";
    const sy = Math.round(view.oy + y * view.scale) + 0.5; g.beginPath(); g.moveTo(0, sy); g.lineTo(W, sy); g.stroke();
  }
  // Shallow water around each harbour.
  for (const p of world.ports) {
    const [x, y] = P(p), r = 46 * WORLD_K * view.scale;
    const sh = g.createRadialGradient(x, y, 0, x, y, r * 0.7);
    sh.addColorStop(0, "rgba(120,190,215,.05)"); sh.addColorStop(1, "rgba(120,190,215,0)");
    g.fillStyle = sh; g.beginPath(); g.arc(x, y, r * 0.7, 0, Math.PI * 2); g.fill();
  }
  // Shipping lanes.
  g.strokeStyle = "rgba(140,190,220,.11)"; g.lineWidth = 1; g.setLineDash([]);   // background lanes stay faint; the focused port's lanes are drawn bright on top
  g.lineJoin = "round"; g.lineCap = "round";
  for (const r of world.routes) {
    ManifestNavigation.stroke(g, routeIndex.get(`${r.a}:${r.b}`).points, P);
  }
  // Compass (skipped on small screens, where it would sit on top of ports).
  if (W < 600) return;
  const cx = W - 34, cy = H - 40;
  g.strokeStyle = "rgba(140,190,220,.25)"; g.fillStyle = "rgba(140,190,220,.35)"; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, 14, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx + 4, cy); g.lineTo(cx, cy + 4); g.lineTo(cx - 4, cy); g.closePath(); g.fill();
  g.font = "600 9px IBM Plex Sans, sans-serif"; g.textAlign = "center"; g.fillText("N", cx, cy - 22); g.textAlign = "left";
}

/** A port's main good: the first of grain, fuel, ore, machinery it makes. */
function portMain(p) { return GOOD_NAMES.find(g => p.produces.includes(g)) ?? null; }
function portColour(p) { const g = portMain(p); return g ? C[g] : C.other; }
function portShape(c, p, x, y, r) {
  c.beginPath();
  // Grain is a circle, fuel a diamond, ore a square, machinery a triangle: the map reads without colour.
  const m = portMain(p);
  if (m === "fuel") { c.moveTo(x, y - r * 1.25); c.lineTo(x + r * 1.25, y); c.lineTo(x, y + r * 1.25); c.lineTo(x - r * 1.25, y); c.closePath(); }
  else if (m === "ore") c.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (m === "machinery") { c.moveTo(x, y - r * 1.2); c.lineTo(x + r * 1.15, y + r * 0.85); c.lineTo(x - r * 1.15, y + r * 0.85); c.closePath(); }
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
  // The hour boxes are drawn after your voyages and planned route, so those lines never hide them.
  const placed = overlays.slice(), hourLabels = [];
  // Sailing times are for your ship docked at the focused port (the one whose form is open), else a freighter.
  const laneShip = myShips.find(s => s.id === activeShip && s.dest === null && s.port === focus) ?? myShips.find(s => s.dest === null && s.port === focus);
  const laneSpeed = spec(laneShip).speed_per_hour;
  if (focus !== null) {
    ctx.strokeStyle = rgba(C.ink, 0.38); ctx.lineWidth = 1.6;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.font = "600 10px IBM Plex Mono, monospace";
    for (const r of world.routes) {
      if (r.a !== focus && r.b !== focus) continue;
      const geometry = routeIndex.get(`${r.a}:${r.b}`);
      ManifestNavigation.stroke(ctx, geometry.points, P);
      if (view.scale * WORLD_K > 0.55) {
        const h = Math.ceil(r.distance / laneSpeed) + "h";
        const [mx,my] = P(ManifestNavigation.position(geometry,.5));
        const tw = ctx.measureText(h).width + 8, box = { x: mx - tw / 2, y: my - 8, w: tw, h: 15 };
        placed.push(box); hourLabels.push({ text: h, x: mx, y: my, box });
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
    ManifestNavigation.stroke(ctx, voyageGeometry(planShipObj.port,planDest).points, P);
    ctx.setLineDash([]); ctx.lineCap = "butt";
  }
  ctx.font = "600 10px IBM Plex Mono, monospace"; ctx.textAlign = "center";
  for (const l of hourLabels) {
    ctx.fillStyle = "rgba(10,22,32,.92)"; ctx.fillRect(l.box.x, l.box.y, l.box.w, l.box.h);
    ctx.fillStyle = C.quiet; ctx.fillText(l.text, l.x, l.y + 3);
  }
  ctx.textAlign = "left";

  // Ports.
  const r0 = clamp(4.2 * Math.sqrt(cam.z) * Math.max(0.8, Math.min(1.15, fit * 1.4)), 3.5, 9);
  const docked = new Map();
  for (const s of myShips) if (s.dest === null) docked.set(s.port, [...(docked.get(s.port) ?? []), s]);
  const destinations = new Set(myShips.filter(s => s.dest !== null).map(s => s.dest));
  // Each harbour is a quay anchored to the coast beside its berth, with its land industry inland (harbours.js, from the
  // land mask; drawn by port-sprites.js). Until the sprites load, or in a world with no land mask, the old coloured
  // shapes are drawn. `portBoxes` (quay + buildings + a minimum tap target) is also used by label placement and clicking.
  ensureHarbours();
  portBoxes.clear(); shipBoxes.length = 0;
  const layouts = new Map();
  for (const p of world.ports) {
    const [x, y] = P(p), col = portColour(p), pl = harbours?.get(p.id);
    const lay = window.ManifestPortSprites?.ready() && pl ? ManifestPortSprites.layout(p, pl, P, view.scale, WORLD_K) : null;
    layouts.set(p.id, lay);
    if (lay) portBoxes.set(p.id, lay.box);
    const u = lay ? Math.max(r0, lay.dock.w * 0.3) : r0;   // ring size: tracks the quay when there is one
    const big = p.id === selectedPort || p.id === hovered;
    if (big && !lay) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, u * 2.4);
      halo.addColorStop(0, rgba(col, 0.16)); halo.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, u * 2.4, 0, Math.PI * 2); ctx.fill();
    }
    if (lay) {
      // A thin tie from the quay to each building keeps the association clear when the building stands a little inland.
      ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      for (const b of lay.industry) { ctx.strokeStyle = rgba(C[b.good], 0.6); ctx.beginPath(); ctx.moveTo(lay.dock.x + lay.dock.w / 2, lay.dock.y + lay.dock.h * 0.55); ctx.lineTo(b.x + b.w / 2, b.y + b.h); ctx.stroke(); }
      ctx.restore();
      ManifestPortSprites.draw(ctx, lay);
    } else {
      portShape(ctx, p, x, y, big ? r0 * 1.3 : r0);
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = "rgba(10,22,32,.9)"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (docked.has(p.id) || destinations.has(p.id)) {
      ctx.strokeStyle = C.mine; ctx.lineWidth = 2; ctx.setLineDash(docked.has(p.id) ? [] : [3, 3]);
      ctx.beginPath(); ctx.arc(x, y, u * 2.1, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (p.id === planDest && planShipObj) {
      ctx.strokeStyle = C.mine; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, u * 2.6, 0, Math.PI * 2); ctx.stroke();
    }
    if (p.id === selectedPort) {
      const pulse = (now % 1800) / 1800;
      ctx.strokeStyle = rgba(C.ink, 0.9 * (1 - pulse)); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, u * (1.8 + pulse * 2.4), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, u * 1.75, 0, Math.PI * 2); ctx.stroke();
    } else if (p.id === hovered) {
      ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, u * 1.75, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // Your ships in port, at the berth: side by side along the quay with a stack count past three, each one clickable.
  const portShipBoxes = new Map();   // port id -> boxes of the ships drawn there (labels keep clear of them)
  for (const [portId, list] of docked) {
    const pl = harbours?.get(portId), p = world.ports[portId], [bx, by] = P(p);
    const size = shipPx(0.9) * 0.9, shown = list.slice(0, 3), gap = size * 0.75;
    const wx = pl ? pl.water.x : 0, wy = pl ? pl.water.y : -1, ax = -wy, ay = wx;   // out to sea, and along the coast
    const out = (layouts.get(portId) ? 0.55 : 0.9) * size;
    const boxes = [];
    shown.forEach((s, i) => {
      const off = (i - (shown.length - 1) / 2) * gap, x = bx + wx * out + ax * off, y = by + wy * out + ay * off;
      const cs = SPRITE_SCALE[s.type || "freighter"] / 0.9, face = headings.get(s.id)?.a ?? Math.atan2(-wy, -wx);   // keep the last heading; first sight: bow to the quay
      ctx.save();
      if (s.id === activeShip) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, size * 0.62, 0, Math.PI * 2); ctx.stroke(); }
      ctx.shadowColor = C.mine; ctx.shadowBlur = 8;
      const cargo = s.qty > 0 && s.good !== null ? GOOD_NAMES[s.good] : null;
      if (!ManifestShipSprites.draw(ctx, x, y, size * cs, face, cargo, s.type || "freighter")) { ctx.fillStyle = C.mine; ctx.beginPath(); ctx.arc(x, y, size * 0.3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      const hitW = Math.max(26, size);
      const box = { id: s.id, port: portId, x: x - hitW / 2, y: y - hitW / 2, w: hitW, h: hitW };
      shipBoxes.push(box); boxes.push(box);
    });
    if (list.length > shown.length) {   // stack indicator
      const x = bx + wx * out + ax * ((shown.length) / 2 * gap + 4), y = by + wy * out + ay * ((shown.length) / 2 * gap + 4);
      ctx.font = "600 10px IBM Plex Mono, monospace"; const t = `+${list.length - shown.length}`, tw = ctx.measureText(t).width + 8;
      ctx.fillStyle = "rgba(10,22,32,.92)"; ctx.fillRect(x - tw / 2, y - 8, tw, 16); ctx.strokeStyle = C.mine; ctx.lineWidth = 1; ctx.strokeRect(x - tw / 2 + .5, y - 7.5, tw - 1, 15);
      ctx.fillStyle = C.ink; ctx.textAlign = "center"; ctx.fillText(t, x, y + 4); ctx.textAlign = "left";
      boxes.push({ x: x - tw / 2, y: y - 8, w: tw, h: 16 });
    }
    portShipBoxes.set(portId, boxes);
  }

  // Your home base: a flag on the port (a placeholder shape; Dave draws the final one).
  if (me && world.ports[me.home]) {
    const [hx, hy] = P(world.ports[me.home]), f = clamp(r0 * 1.0, 4, 9), hl = layouts.get(me.home);
    // With a sprite the pole stands on the quay's top-left corner; otherwise just above the dot.
    const fx = hl ? hl.dock.x + 4 : hx, fy = hl ? hl.dock.y + 6 : hy - r0 * 1.4;
    ctx.save(); ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(10,22,32,.95)"; ctx.fillStyle = C.mine;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - f * 2.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx, fy - f * 2.6); ctx.lineTo(fx + f * 1.9, fy - f * 1.9); ctx.lineTo(fx, fy - f * 1.2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Labels with goods badges, placed so they never overlap and always stay inside the map; important ones first.
  // Placement is redone every frame, so panning and zooming re-flow it; the harbours themselves never move.
  const fontSize = clamp(10.5 + (cam.z - 1) * 0.8, 10.5, 13);
  const order = [...world.ports].sort((a, b) => weight(b) - weight(a));
  function weight(p) { return (p.id === selectedPort ? 100 : 0) + (p.id === planDest ? 95 : 0) + (p.id === hovered ? 90 : 0) + (docked.has(p.id) ? 50 : 0) + (destinations.has(p.id) ? 40 : 0) + (me && p.id === me.home ? 30 : 0) + (p.produces.length ? 2 : 0); }
  const dots = world.ports.map(p => { const b = portBoxes.get(p.id); if (b) return { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }; const [x, y] = P(p); return { x: x - r0 - 1, y: y - r0 - 1, w: 2 * r0 + 2, h: 2 * r0 + 2 }; });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Ships at sea and in port are obstacles for the ordinary labels (the strong ones are placed first and win).
  const shipObstacles = [...shipBoxes];
  for (const s of world.ships) { if (s.dest === null) continue; const [sx, sy] = P(positions.get(s.id) ?? { x: -999, y: -999 }); shipObstacles.push({ x: sx - 9, y: sy - 9, w: 18, h: 18 }); }
  let obstaclesAdded = false;
  for (const p of order) {
    const strong = weight(p) >= 40;
    if (!strong && !obstaclesAdded) { placed.push(...shipObstacles); obstaclesAdded = true; }
    ctx.font = `${strong ? 600 : 400} ${fontSize}px IBM Plex Sans, sans-serif`;
    const [x, y] = P(p);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;   // off the map view: no label (only labels of visible ports slide inside)
    const tw = ctx.measureText(p.name).width, badgeW = p.produces.length ? p.produces.length * 12 + 2 : 0;
    const w = tw + (badgeW ? badgeW + 3 : 0), h = fontSize + 2, gap = r0 + 5;
    const bb = portBoxes.get(p.id);   // with sprites, labels go outside the whole quay + buildings group
    const raw = bb
      ? [[bb.x + bb.w + 4, y - h / 2], [bb.x - 4 - w, y - h / 2], [x - w / 2, bb.y - 3 - h], [x - w / 2, bb.y + bb.h + 3]]
      : [[x + gap, y - h / 2], [x - gap - w, y - h / 2], [x - w / 2, y - gap - h], [x - w / 2, y + gap]];
    // Near an edge a label slides back inside the map instead of being cut off or dropped.
    const spots = raw.map(([sx, sy]) => ({ x: clamp(sx, 3, Math.max(3, W - 3 - w)), y: clamp(sy, 3, Math.max(3, H - 3 - h)), w, h }));
    const spot = spots.find(b => !placed.some(o => hit(o, b)) && !dots.some((d, i) => i !== p.id && hit(d, b)));
    if (!spot) continue;
    placed.push(spot);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,22,32,.85)"; ctx.lineJoin = "round";
    ctx.strokeText(p.name, spot.x, spot.y + h - 4);
    ctx.fillStyle = strong ? C.ink : rgba(C.quiet, 0.95);
    ctx.fillText(p.name, spot.x, spot.y + h - 4);
    p.produces.forEach((g, i) => drawGlyph(ctx, g, spot.x + tw + 3 + 6 + i * 12, spot.y + h / 2 + 0.5, 4));
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
    ctx.save(); ctx.globalAlpha = own ? 1 : 0.7;
    const cargo = s.qty > 0 && s.good !== null ? GOOD_NAMES[s.good] : null;
    const cs = SPRITE_SCALE[s.type || "freighter"];
    let drawn = false;
    const heading = smoothAngle(s.id, pos.angle, now);   // turns through corners, not in jumps
    if (s.type !== "pirate" && window.ManifestShipSprites.getMode() === "atlas" && (cargo === "ore" || cargo === "machinery")) {
      // Atlas fallback: these two cargoes have only a side-view sprite, flipped to face the way the ship sails.
      const img = shipSprite(s);
      if (img) {
        const w = 32 * cs * 1.1, h = w * img.height / img.width;
        ctx.translate(x, y); if (Math.cos(heading) < 0) ctx.scale(-1, 1);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(img, -w / 2, -h * 0.65, w, h); drawn = true;
      }
    } else drawn = window.ManifestShipSprites.draw(ctx, x, y, shipPx(cs), heading, cargo, s.type || "freighter");
    ctx.restore();
    if (drawn) {
      ctx.shadowBlur = 0;
      continue;
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(pos.angle);
    ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.75, size * 0.62); ctx.lineTo(-size * 0.4, 0); ctx.lineTo(-size * 0.75, -size * 0.62); ctx.closePath();
    ctx.fillStyle = own ? C.mine : s.qty > 0 ? "rgba(232,238,242,.85)" : "rgba(232,238,242,.5)"; ctx.fill();
    ctx.restore(); ctx.shadowBlur = 0;
  }

  // Police patrols: always drawn, with a ring so they stand out from traders and pirates.
  for (const p of world.police ?? []) {
    if (p.dest === null) continue;
    const pos = shipPos(p), [x, y] = P(pos);
    const heading = smoothAngle(`p${p.id}`, pos.angle, now);
    ctx.save();
    ctx.strokeStyle = "#7fb2ff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
    window.ManifestShipSprites.draw(ctx, x, y, shipPx(SPRITE_SCALE.police), heading, null, "police");
    ctx.restore();
  }
  for (const marker of world.opportunityMarkers ?? []) {
    const [x, y] = P(marker);
    ctx.save();
    ctx.fillStyle = C.grain;
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y + 5);
    ctx.lineTo(x - 5, y);
    ctx.closePath();
    ctx.fill();
    ctx.font = "600 10px IBM Plex Sans, sans-serif";
    ctx.strokeStyle = C.sea;
    ctx.lineWidth = 3;
    ctx.strokeText(marker.label, x + 8, y + 3);
    ctx.fillText(marker.label, x + 8, y + 3);
    ctx.restore();
  }
}

// Side-view sprites for ore and machinery (the 8-direction atlas covers the other cargoes).
const SPRITES = Object.fromEntries(["empty", "grain", "fuel", "ore", "machinery"].map(k => { const im = new Image(); im.src = `img/ship-${k}.png`; return [k, im]; }));
/** Hull size on the map by class (all classes share the sprites). */
const SPRITE_SCALE = { coaster: 0.75, freighter: 1, bulker: 1.3, pirate: 0.8, police: 0.9 };
// A ship's drawn heading eases toward the lane's direction, the short way round, so corners are smooth turns.
const headings = new Map();
function smoothAngle(id, target, now) {
  const h = headings.get(id);
  if (!h) { headings.set(id, { a: target, t: now }); return target; }
  const dt = Math.min(0.25, (now - h.t) / 1000); h.t = now;
  let d = target - h.a; d = Math.atan2(Math.sin(d), Math.cos(d));
  h.a += d * Math.min(1, dt * 8);
  return h.a;
}
function shipSprite(s) {
  const im = SPRITES[s.qty > 0 && s.good !== null ? GOOD_NAMES[s.good] : "empty"];
  return im.complete && im.naturalWidth ? im : null;
}

function portAt(sx, sy) {
  let best = null, bd = 18;
  for (const p of world.ports) {
    const [x, y] = P(p), b = portBoxes.get(p.id);
    // Anywhere on the icon or its resource sprites counts (a hit inside always beats a near miss).
    const inside = b && sx >= b.x - 3 && sx <= b.x + b.w + 3 && sy >= b.y - 3 && sy <= b.y + b.h + 3;
    const d = inside ? Math.hypot(x - sx, y - sy) * 0.001 - 1 : Math.hypot(x - sx, y - sy);
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
    ${me && me.home === id ? `<div class="tipRow"><span class="pos">⚑ Your home base: safe harbour</span></div>` : ""}
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
  toast(`Ship ${s.id} → ${world.ports[id].name} (≈${Math.ceil(distance(s.port, id) / spec(s).speed_per_hour)} h): ${summary}. Tap it again to open the port.`, summary.startsWith("makes") ? false : "warn");
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
      const sb = shipBoxes.find(b => b.id !== undefined && e.offsetX >= b.x && e.offsetX <= b.x + b.w && e.offsetY >= b.y && e.offsetY <= b.y + b.h);
      if (sb) { activeShip = sb.id; selectedPort = sb.port; tab = "port"; render(); document.querySelector(`.shipCard[data-ship="${sb.id}"]`)?.scrollIntoView({ block: "nearest" }); }
      else { const id = portAt(e.offsetX, e.offsetY);
        if (id !== null && !pickDestination(id)) { selectedPort = id; tab = "port"; render(); } }
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
// Tabs pattern: arrow keys (and Home/End) move between tabs and open them; Tab goes on to the panel.
$("tabs").addEventListener("keydown", e => {
  const btns = [...document.querySelectorAll("#tabs button:not([hidden])")], i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  const j = e.key === "ArrowRight" ? (i + 1) % btns.length : e.key === "ArrowLeft" ? (i - 1 + btns.length) % btns.length
    : e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1 : -1;
  if (j < 0) return;
  e.preventDefault();
  tab = btns[j].dataset.tab; render(); btns[j].focus();
});

function render() {
  if (!world) return;
  document.querySelector('[data-tab="opportunities"]').hidden = !me?.expansion;
  if (tab === "opportunities" && !me?.expansion) tab = "port";
  document.querySelectorAll("#tabs button").forEach(b => { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-selected", String(b.dataset.tab === tab)); b.tabIndex = b.dataset.tab === tab ? 0 : -1; });
  $("hName").textContent = me?.name ?? "–";
  $("hCash").textContent = me ? fmt(me.cash) : "–";
  $("hCash").classList.toggle("neg", !!me && me.cash < 0);
  showDelta();
  const level = world.rules.difficulty;
  $("diff").className = `pill diff ${level ?? "hidden"}`;
  $("diff").textContent = level ? `${level[0].toUpperCase()}${level.slice(1)} world` : "";
  $("seasonFill").style.width = `${Math.min(100, world.tick / world.seasonHours * 100)}%`;
  const counts = { port: me && selectedPort !== null ? me.ships.filter(s => s.dest === null && s.port === selectedPort).length : 0, fleet: me?.ships.length, orders: me ? world.orders.filter(o => o.owner === me.id).length : 0 };
  document.querySelectorAll("#tabs button").forEach(b => {
    const n = counts[b.dataset.tab];
    let badge = b.querySelector(".count");
    if (!n) { badge?.remove(); return; }
    if (!badge) { badge = document.createElement("span"); badge.className = "count"; b.append(badge); }
    badge.textContent = n;
    badge.setAttribute("aria-label", b.dataset.tab === "port" ? `${n} of your ships docked here` : b.dataset.tab === "fleet" ? `${n} ships` : `${n} open orders`);
    badge.title = badge.getAttribute("aria-label");
  });
  $("hWorth").textContent = me ? fmt(me.worth) : "–";
  const days = world.seasonHours / 24;
  $("hClock").closest(".stat").title = `One game hour passes every ${world.tickMs >= 60000 ? Math.round(world.tickMs / 60000) + " minute(s)" : Math.round(world.tickMs / 1000) + " second(s)"} of real time. The season lasts ${days} game days; prices, production and voyages all move on this clock.`;
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
  const context = tab === "port" ? `port:${selectedPort}` : tab;
  if (recoveryContext !== context) {
    recoveryContext = context;
    recoveryReason = null;
    recoveryFailure = null;
    $("panel").scrollTop = 0;
  }
  const html = { port: portPanel, fleet: fleetPanel, orders: ordersPanel, board: boardPanel, opportunities: opportunitiesPanel }[tab]();
  const disclosures = new Map([...$("panel").querySelectorAll("details[data-detail]")].map(el => [detailKey(el), el.open]));
  $("panel").innerHTML = recoveryHtml() + html;
  restoreForm();
  bindPanel();
  if (tab === "opportunities") bindOpportunities();
  $("panel").querySelectorAll("details[data-detail]").forEach(el => { if (disclosures.has(detailKey(el))) el.open = disclosures.get(detailKey(el)); });
  if (scrollToBuy) { scrollToBuy = false; document.querySelector("[data-field=buyShipRow]")?.scrollIntoView({ block: "center" }); }
  if (refocus) {
    const els = [...$("panel").querySelectorAll("button, input, select, a[href]")];
    const el = els.find(x => focusKey(x) === refocus) ?? els.find(x => focusKey(x, true) === focusKey(focused, true));
    el?.focus({ preventScroll: true });
  }
}

const opportunitySections = {
  ports: "Ports and markets", trade: "Shipping business", fleet: "Fleet and company",
  piracy: "Piracy and patrols", exploration: "Offshore jobs", season: "Season rules",
};
let opportunitySection = "ports";

function opportunityInput(field) {
  const name = esc(field.key);
  if (field.options) return `<label>${esc(field.label)}<select name="${name}" required>${field.options.map((option, index) =>
    `<option value="${index}"${option.value === field.value ? " selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;
  const bound = (key) => field[key] === undefined ? "" : ` ${key}="${esc(field[key])}"`;
  return `<label>${esc(field.label)}<input name="${name}" type="number" step="any" value="${esc(field.value)}"${bound("min")}${bound("max")} required></label>`;
}

function opportunitiesPanel() {
  const cards = me.expansion[opportunitySection] ?? [];
  return `<h2>Opportunities</h2><label class="opportunityCategory">Browse<select id="opportunitySection">${Object.entries(opportunitySections).map(([key, title]) =>
    `<option value="${key}"${key === opportunitySection ? " selected" : ""}>${esc(title)}</option>`).join("")}</select></label>
    ${cards.length ? cards.map((card, cardIndex) => `<section class="est opportunityCard">
      <h3>${esc(card.title)}</h3><p>${esc(card.detail)}</p>${(card.actions ?? []).map((action, actionIndex) =>
        `<form class="opportunityAction" data-card="${cardIndex}" data-action="${actionIndex}">${(action.fields ?? []).map(opportunityInput).join("")}
          <button type="submit" class="secondary"${world.seasonOver ? " disabled" : ""}>${esc(action.label)}</button></form>`).join("")}</section>`).join("")
      : '<p class="quiet">There are no opportunities in this category right now.</p>'}`;
}

function bindOpportunities() {
  const cards = me.expansion[opportunitySection] ?? [];
  $("opportunitySection").onchange = (event) => {
    opportunitySection = event.target.value;
    event.target.blur();
    render();
    $("opportunitySection")?.focus();
  };
  $("panel").querySelectorAll(".opportunityAction").forEach(form => {
    form.onsubmit = event => {
      event.preventDefault();
      const action = cards[Number(form.dataset.card)]?.actions?.[Number(form.dataset.action)];
      if (!action) return;
      const fields = new FormData(form);
      const payload = { ...action.command };
      for (const field of action.fields ?? []) {
        const index = Number(fields.get(field.key));
        payload[field.key] = field.options ? field.options[index]?.value : index;
      }
      command(payload, () => toast("Order accepted"));
    };
  });
}
function detailKey(el) { return `${el.closest(".shipCard")?.dataset.ship ?? ""}:${el.dataset.detail}`; }
/** Quotes come from the server; these links open existing controls for review. */
function recoveryHtml(reason = recoveryReason) {
  const r = me?.recovery ? { ...me.recovery, active: me.recovery.active || !!recoveryFailure, shortfall: recoveryFailure?.shortfall ?? 0 } : null;
  if (!me || !r || (!r.active && !reason)) return "";
  const title = r.shortfall > 0 ? `You are short of ${fmt(Math.ceil(r.shortfall))} cash.`
    : r.cash < 0 ? `Your cash is ${fmt(r.cash)}. You need approximately ${fmt(-r.cash)} cash to reach zero.`
    : "This action needs more cash.";
  const recommended = r.options.find(o => o.immediate && (r.cash < 0 || o.kind !== "scrap"));
  return `<section id="recovery" class="est warn" aria-labelledby="recoveryTitle">
    <h2 id="recoveryTitle">Cash recovery</h2><p>${esc(title)}</p>
    ${reason ? `<p>${esc(reason)}</p>` : ""}
    <p>${esc(r.explanation)}</p>
    ${recommended ? `<p><b>Recommended next step: ${esc(recommended.label.toLowerCase())}.</b></p>` : ""}
    ${r.options.map(o => `<div class="recoveryOption"><b>${esc(o.label)}</b><br>
      ${o.immediate ? "Would give you" : "Could give you"} approximately ${fmt(o.amount)} cash${o.kind === "arrival" ? ", after the arrival fee" : ""}.
      After this action, you would have approximately ${fmt(o.cashAfter)} cash.
      ${!o.immediate ? "Timing and proceeds are uncertain; fleet upkeep may also be charged while you wait." : ""}
      <button class="link" data-act="recoveryOpen" data-target="${o.kind === "listing" || o.kind === "refund" ? "orders" : "fleet"}" ${o.ship !== undefined ? `data-ship="${o.ship}"` : ""}>Review ${o.kind === "scrap" ? "scrap option" : o.kind === "refund" || o.kind === "listing" ? "order" : "ship"}</button></div>`).join("")}
    <p class="quiet">Estimates use current prices. Review the live quote before acting. Scrapping pays half price, is permanent, and requires an empty docked spare ship. Debt can trigger a spare-ship sale at daily upkeep.</p>
  </section>`;
}

function showRecoveryReason(reason) {
  recoveryReason = reason;
  const existing = $("recovery");
  const html = recoveryHtml(reason);
  if (existing) existing.outerHTML = html;
  else $("panel").insertAdjacentHTML("afterbegin", html);
}

// Delegation keeps links working when a form updates the explanation in place.
$("panel").addEventListener("click", e => {
  const help = e.target.closest('[data-act="recoveryHelp"]');
  if (help) { showRecoveryReason(help.dataset.reason); return; }
  const button = e.target.closest('[data-act="recoveryOpen"]');
  if (!button) return;
  tab = button.dataset.target;
  render();
  if (button.dataset.ship) document.querySelector(`.shipCard[data-ship="${Number(button.dataset.ship)}"]`)?.scrollIntoView({ block: "center" });
});
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
$("panel").addEventListener("change", e => { if (e.target.matches("[data-field=shipClass]")) { buyClass = e.target.value; render(); } });
$("panel").addEventListener("input", e => {
  if (e.target.matches("input, select")) formState.set(formKey(e.target), e.target.type === "checkbox" ? e.target.checked : e.target.value);
});
function restoreForm() {
  $("panel").querySelectorAll("input, select").forEach(el => {
    const v = formState.get(formKey(el));
    if (v === undefined) return;
    if (el.tagName === "SELECT" && ![...el.options].some(o => o.value === v)) return;
    if (el.type === "checkbox") el.checked = v;
    else el.value = v;
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

let selectedGood = null;   // the good whose trade card is open on the Port tab
const tradeQty = new Map();   // `${port}:${good}:${ship}` -> the quantity typed
/** One line per ship of yours at this port: class, hold, cargo, and whether it can sail. */
function shipSummaryHtml(p) {
  if (!me) return "";
  const here = me.ships.filter(s => s.dest === null && s.port === p.id), coming = me.ships.filter(s => s.dest === p.id);
  if (!here.length && !coming.length) return "";
  return `<h3>Your ships</h3><ul class="shipSum">${here.map(s => `<li${s.id === activeShip ? ' class="on"' : ""}><b>Ship ${s.id}</b> ${esc(className(s.type))} · cargo ${s.qty}/${spec(s).capacity}${s.qty > 0 ? ` ${GOOD_NAMES[s.good]}` : ""} · <span class="pos">docked, ready to sail</span> <span class="quiet">(fuel is bought when it sails)</span></li>`).join("")}
    ${coming.map(s => `<li><b>Ship ${s.id}</b> ${esc(className(s.type))} · arriving in ${hoursLeft(s)} h${s.qty > 0 ? ` with ${s.qty} ${GOOD_NAMES[s.good]}` : ""}</li>`).join("")}</ul>`;
}
/** The most of a good this ship could load: its hold, the stock, and what the cash covers (cargo plus tax). */
function maxLoad(s, g) {
  const stock = Math.floor(world.ports[s.port].stock[g]), cap = Math.min(spec(s).capacity, stock);
  let lo = 0, hi = cap; const cost = n => buyCost(s.port, g, n) * (1 + world.rules.tax);
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (cost(m) <= me.cash) lo = m; else hi = m - 1; }
  return { cap, afford: lo };
}
function tradeShip() {
  const here = (me?.ships ?? []).filter(s => s.dest === null && s.port === selectedPort);
  return here.find(s => s.id === activeShip) ?? here[0] ?? null;
}
/** The trade card for the selected good: price, stock, cargo held, quantity, total, actions, and why anything is blocked (from live state; the server still validates). */
function goodTradeHtml(p) {
  if (selectedGood === null) return "";
  const g = selectedGood, name = GOOD_NAMES[g], s = tradeShip();
  return `<div class="goodTrade" id="goodTrade" data-good="${g}"><div class="gtHead"><b><span class="tag ${name}">${name}</span> at ${esc(p.name)}</b><button class="link" data-act="closeGood" aria-label="Close trade card">Close</button></div>
    <dl class="gtFacts"><dt>Market price</dt><dd>${p.prices[g].toFixed(2)}</dd><dt>In stock</dt><dd>${fmt(p.stock[g])}</dd>
      <dt>Held on ${s ? `Ship ${s.id}` : "your ships here"}</dt><dd>${s ? (s.qty > 0 ? `${s.qty} ${GOOD_NAMES[s.good]}` : "nothing") : "–"}</dd></dl>
    ${s && !world.seasonOver ? `<label class="mini">Quantity to load<input data-field="goodQty" type="number" min="1" max="${spec(s).capacity}" value="${currentTradeQty(s, g)}" style="width:100px"></label>` : ""}
    <div id="tradeCalc">${tradeCalcHtml(p)}</div></div>`;
}
function currentTradeQty(s, g) {
  const k = `${s.port}:${g}:${s.id}`;
  if (tradeQty.has(k)) return tradeQty.get(k);
  const m = maxLoad(s, g); return Math.max(1, Math.min(m.cap, m.afford || m.cap));
}
/** The part of the trade card that depends on the quantity: totals, blocked reasons, actions, destination comparison. */
function tradeCalcHtml(p) {
  const g = selectedGood, name = GOOD_NAMES[g], s = tradeShip();
  if (world.seasonOver) return `<div class="est">Trading is closed until the next season starts.</div>`;
  if (!me) return `<div class="est">Log in to trade.</div>`;
  if (!s) return `<div class="est warn" data-field="tradeWhy">Dock a ship here to buy cargo.${me.ships.some(x => x.dest !== null) ? ` ${whereShipsAre()}` : ""}</div>`;
  const out = [];
  if (s.qty > 0 && s.good === g) {
    const net = saleNet(s);
    out.push(`<div class="est">Selling all ${s.qty} ${name} here pays about <b>${fmt(net)}</b> after tax (you paid ${fmt(s.cost)}).</div>
      <div class="row"><button data-act="sell" data-ship="${s.id}">Sell ${s.qty} ${name} for ${fmt(net)}</button></div>`);
  }
  if (s.qty > 0) {
    out.push(`<div class="est warn" data-field="tradeWhy">No free cargo space: Ship ${s.id} already carries ${s.qty} ${GOOD_NAMES[s.good]}. ${s.good === g ? "Sell it here, or carry it to another port." : `Sell it first to load ${name}.`}</div>`);
    return out.join("");
  }
  const qty = Math.floor(Number(tradeQty.get(`${s.port}:${g}:${s.id}`) ?? currentTradeQty(s, g))), m = maxLoad(s, g), cap = spec(s).capacity;
  const bad = !(qty >= 1) ? "Enter a quantity of at least 1." : qty > cap ? `Ship ${s.id} holds ${cap} at most.` : qty > Math.floor(p.stock[g]) ? `Only ${fmt(Math.floor(p.stock[g]))} ${name} in stock here.` : null;
  const cost = bad ? 0 : buyCost(s.port, g, qty) * (1 + world.rules.tax);
  const short = !bad && cost > me.cash;
  out.push(`<div class="gtTotal">${bad ? `<span class="neg">${esc(bad)}</span>` : `Total for ${qty}: <b>${fmt(cost)}</b> <span class="quiet">(about ${(cost / qty).toFixed(2)} each with ${Math.round(world.rules.tax * 1000) / 10}% tax; the price slides as you buy)</span>`}</div>`);
  if (short) out.push(`<div class="est warn" data-field="tradeWhy">Insufficient cash for this quantity: you have ${fmt(me.cash)}.${m.afford >= 1 ? ` <button class="link" data-act="useMax" data-qty="${m.afford}">Use the most you can afford (${m.afford})</button>` : ` You can't afford even one; sell cargo or scrap a spare ship (see recovery options).`}</div>`);
  out.push(`<div class="row"><button data-act="planLoad" data-ship="${s.id}" data-good="${name}" data-qty="${qty}"${bad || short ? " disabled" : ""}>Load ${bad ? "" : qty + " "}${name}, then choose a destination</button></div>
    <div class="est quiet small">Cargo is paid for at the moment the ship sails, at the price then. Nothing is bought until you press Dispatch ship.</div>`);
  // Destination comparison for this load: the best few ports by estimated profit (same maths as the sail estimate).
  if (!bad && !short) {
    const opts = world.ports.filter(q => q.id !== s.port).map(q => ({ dest: q.id, ...tripProfit(s, q.id, g, qty) })).filter(o => landsInSeason(o.hours)).sort((a, b) => b.profit - a.profit).slice(0, 4);
    out.push(`<h3>Where to sell ${qty} ${name}</h3><table class="dests"><tr><th>Destination</th><th class="num">Time</th><th class="num">Est. profit</th><th></th></tr>${opts.map(o => `<tr><td>${esc(world.ports[o.dest].name)}</td><td class="num">${o.hours} h</td><td class="num ${o.profit >= 0 ? "pos" : "neg"}">${o.profit >= 0 ? "+" : "−"}${fmt(Math.abs(o.profit))}</td><td><button class="link" data-act="plan" data-ship="${s.id}" data-dest="${o.dest}" data-good="${name}" data-qty="${qty}">Plan</button></td></tr>`).join("")}</table>
      <div class="est quiet small">Estimates at today's prices after fuel, the port fee and tax; prices can change before arrival.</div>`);
  }
  return out.join("");
}

function portPanel() {
  const p = world.ports[selectedPort];
  const chips = [...(me && me.home === p.id ? [`<span class="tag home" title="Your home port: where you started, a safe harbour where no pirate can attack, and where you buy pirate ships.">⚑ Your home base</span>`] : []),
    ...p.produces.map(g => `<span class="tag ${g}">Produces ${g}</span>`), ...p.consumes.map(g => `<span class="tag">Needs ${g}</span>`),
    ...(p.homes ? [`<span class="tag">Home of ${p.homes} ${p.homes === 1 ? "company" : "companies"}</span>`] : [])];
  // Stock bars are scaled to the fullest port for that good, so you can compare ports at a glance.
  const most = ALL_GOODS.map(g => Math.max(1, ...world.ports.map(q => q.stock[g])));
  const rows = GOOD_NAMES.map((g, i) => { const due = nextDelivery(p.id, i); return `<tr class="goodRow${selectedGood === i ? " sel" : ""}" data-good="${i}" tabindex="0" role="button" aria-pressed="${selectedGood === i}" aria-label="Trade ${g}: price ${p.prices[i].toFixed(2)}, stock ${fmt(p.stock[i])}">
    <td><span class="tag ${g}">${g}</span></td>
    <td class="num">${p.prices[i].toFixed(2)}${trend(p.id, i)}</td>
    <td class="sparkCell">${sparkline(p.id, i)}</td>
    <td class="num">${fmt(p.stock[i])}<div class="bar ${g}"><i style="width:${Math.min(100, p.stock[i] / most[i] * 100).toFixed(0)}%"></i></div></td>
    <td class="num">${fmt(p.inbound[i])}${due ? `<div class="quiet small">first in ${due.h} h</div>` : ""}</td></tr>`; }).join("");
  const orders = world.orders.filter(o => o.port === p.id);
  const docked = (me?.ships ?? []).filter(s => s.dest === null && s.port === p.id);
  const coming = (me?.ships ?? []).filter(s => s.dest === p.id);
  // On a phone your ship's buttons come first, above the market, so you can act without scrolling.
  const shipsFirst = docked.length > 0;
  const shipsHtml = `<h3>Your ships here</h3>
    ${docked.length ? docked.map(shipCard).join("") : `<div class="empty">None of your ships are docked here.${me ? ` ${whereShipsAre()}` : ""}</div>`}
    ${me && docked.length && !world.seasonOver && me.ships.length < world.rules.maxShips ? buyShipHtml() : ""}
    ${me && world.rules.pirates?.enabled && p.id !== me.home && !world.seasonOver ? `<div class="est" data-field="pirateYard">The Pirate Speedboat (${fmt(spec("pirate").price)}) is sold only at your home port, ${esc(world.ports[me.home].name)}. <button class="link" data-act="openPort" data-port="${me.home}">Open it →</button> or see the Fleet tab's Shipyard.</div>` : ""}`;
  return `
    <h2>${esc(p.name)}</h2><div class="chips">${chips.join("") || `<span class="quiet">A quiet port</span>`}</div>
    ${p.harborLevel ? `<p class="quiet">Harbor level ${p.harborLevel} · base docking fee reduced by ${p.harborLevel * 5}%</p>` : ""}
    ${me ? `<div class="row"><button class="link" data-act="watchPort" data-port="${p.id}" aria-pressed="${watchedPorts().some(w => w.port === p.id)}">${watchedPorts().some(w => w.port === p.id) ? "Unwatch port" : "Watch port"}</button><span class="quiet">${watchedPorts().length} of 5 watched</span></div>` : ""}
    ${shipsFirst ? shipsHtml : ""}
    ${shipSummaryHtml(p)}
    <h3>Market</h3>
    <table class="market"><tr><th>Good</th><th class="num" title="One market price for buying and selling; it slides with stock, and tax applies to each trade">Market price</th><th class="sparkCell">Last 72 h</th><th class="num">In stock</th><th class="num" title="Cargo already sailing here">Arriving</th></tr>${rows}</table>
    <div class="est quiet small">Select a good to trade it. One price applies to buying and selling; it moves as you trade, and ${Math.round(world.rules.tax * 1000) / 10}% tax is charged on each sale and purchase.</div>
    ${goodTradeHtml(p)}
    ${outlookHtml(p)}
    <div class="est">${p.emptyInbound ? `${p.emptyInbound} empty ship${p.emptyInbound === 1 ? "" : "s"} heading here to load.` : "No empty ships heading here to load."} ${p.inbound.some(q => q > 0) ? `If sold, the inbound ${ALL_GOODS.filter(g => p.inbound[g] > 0).map(g => GOOD_NAMES[g]).join(" and ")} will push ${p.inbound.filter(q => q > 0).length > 1 ? "those prices" : "its price"} down.` : "No cargo is heading here either."}</div>
    <h3>Player orders here</h3>
    ${orders.length ? `<table><tr><th>Player</th><th>Wants to</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${orders.map(o => `<tr${me && o.owner === me.id ? ' class="me"' : ""}><td>${esc(o.ownerName)}</td><td>${o.side === "sell" ? "sell" : "buy"}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="quiet">None yet.</div>`}
    ${shipsFirst ? "" : shipsHtml}`;
}

/** Hours until the next of your-or-anyone's loaded ships docks at a port with this good (arrival times are public), or null. */
function nextDelivery(portId, g) {
  const due = world.ships.filter(x => x.dest === portId && x.good === g && x.qty > 0).map(x => ({ h: Math.max(0, x.arriveTick - world.tick), qty: x.qty })).sort((a, b) => a.h - b.h)[0];
  return due ?? null;
}
/** A short forecast table (good, expected stock change, expected price, next delivery); per-good sentences and the method sit behind disclosures. */
function outlookHtml(port) {
  const outlook = port.outlook;
  if (!outlook) return "";
  if (!outlook.hours) return '<div class="est">The season has ended. Market forecasts are closed.</div>';
  const factory = outlook.factory;
  const rows = outlook.goods.map((flow, g) => {
    const d = flow.changePerHour, steady = Math.abs(d) < 0.005, due = nextDelivery(port.id, g);
    return `<tr><td><span class="tag ${GOOD_NAMES[g]}">${GOOD_NAMES[g]}</span></td>
      <td class="num">${steady ? "steady" : `${d > 0 ? "▲ +" : "▼ −"}${Math.abs(d).toFixed(2)}/h`}</td>
      <td class="num">${flow.projectedPrice.toFixed(2)}</td>
      <td class="num">${due ? `${fmt(due.qty)} in ${due.h} h` : "–"}</td></tr>`;
  }).join("");
  return `<h3>Forecast, next ${outlook.hours} game hours</h3>
    <table class="forecast"><tr><th>Good</th><th class="num">Stock</th><th class="num">Price</th><th class="num">Next delivery</th></tr>${rows}</table>
    <details class="marketOutlook" data-detail="outlook-${port.id}"><summary>Details for each good</summary>
      <ul>${outlook.goods.map((flow, g) => `<li><b>${GOOD_NAMES[g]}</b>: ${Math.abs(flow.changePerHour) < 0.005 ? "stock steady" : `stock ${flow.changePerHour > 0 ? "rising" : "falling"} ≈ ${Math.abs(flow.changePerHour).toFixed(2)}/hour`}; price ≈ ${flow.projectedPrice.toFixed(2)}.
        ${flow.inbound > 0 ? `${fmt(flow.inbound)} arriving within this window; price could be ≈ ${flow.priceIfInboundSold.toFixed(2)} if all that cargo is sold.` : "No cargo due within this window."}</li>`).join("")}</ul><p class="quiet">Arriving cargo stays on ships until sold.</p></details>
    <details class="forecastInfo" data-detail="outlookinfo-${port.id}"><summary>How this forecast works</summary>
      ${factory ? `<p class="est" data-field="factory">Factory: ${factory.orePerMachinery} ore makes 1 machinery. Output ≈ ${factory.outputPerHour.toFixed(2)} machinery/hour, capacity ${factory.capacityPerHour.toFixed(2)}. ${factory.outputPerHour < factory.capacityPerHour - 0.001 ? "Ore or storage space is limiting output." : "Ore is available for the current output."}</p>` : ""}
      <p class="quiet">Expected stock change and price use current production, consumption and company activity; they are estimates. Future trades can change them. Arriving cargo stays on ships until sold, so a delivery lowers the price only when it is sold.</p></details>`;
}

function watchKey() { return me && world ? `manifest-watch:${world.navigationId}:${me.id}` : null; }
function watchedPorts() {
  try {
    const data = JSON.parse(store.get(watchKey()) ?? "[]");
    return Array.isArray(data) ? data.filter((w, i) => w && Number.isInteger(w.port) && world.ports[w.port] && Array.isArray(w.prices) && w.prices.length === GOOD_NAMES.length && w.prices.every(Number.isFinite) && data.findIndex(v => v?.port === w.port) === i).slice(0, 5) : [];
  } catch { return []; }
}
function watchlistHtml() {
  const watched = watchedPorts();
  return `<section class="watchlist"><h3>Watched ports</h3><p class="quiet">Saved in this browser for your company and season. Watch up to 5 ports from the Port tab.</p>
    ${watched.length ? watched.map(w => {
      const p = world.ports[w.port];
      const changes = p.prices.map((price, g) => ({ g, delta: price - w.prices[g] })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const change = changes[0], flow = p.outlook?.goods[change.g];
      return `<div class="watchRow"><button class="link" data-act="openPort" data-port="${p.id}">${esc(p.name)} →</button>
        <span>${Math.abs(change.delta) < 0.005 ? "Prices unchanged since your saved visit." : `${GOOD_NAMES[change.g]} ${change.delta > 0 ? "up" : "down"} ${Math.abs(change.delta).toFixed(2)} since your saved visit.`}
        ${flow ? `Next ${p.outlook.hours} h: ≈ ${flow.projectedPrice.toFixed(2)}.` : ""}</span>
        <button class="link" data-act="watchPort" data-port="${p.id}">Unwatch</button></div>`;
    }).join("") : '<div class="quiet">No watched ports yet.</div>'}</section>`;
}
function saveWatchVisit() {
  if (!watchKey()) return;
  store.set(watchKey(), JSON.stringify(watchedPorts().map(w => ({ port: w.port, prices: world.ports[w.port].prices }))));
}
window.addEventListener("pagehide", saveWatchVisit);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveWatchVisit(); });

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

function maritimeShipHtml(s) {
  const service = me.maritime?.ships.find(item => item.id === s.id);
  if (!service || world.seasonOver) return "";
  const eligible = world.rules.pirates?.enabled && s.type !== "pirate" && s.qty > 0 && s.dest !== null && s.departTick === world.tick;
  if (!eligible && !service.insurance && !service.convoy && !service.stolen && !service.canUpgrade) return "";
  return `<div class="row">
    ${service.insurance ? '<span class="quiet">Cargo insured</span>' : eligible ? `<button class="secondary" data-act="insureCargo" data-ship="${s.id}">Insure cargo · ${fmt(service.premium)}</button>` : ""}
    ${service.convoy ? '<span class="quiet">Naval escort booked</span>' : eligible ? `<button class="secondary" data-act="bookConvoy" data-ship="${s.id}">Book naval escort · ${fmt(service.convoyFee)}</button>` : ""}
    ${service.fence ? `<button class="secondary" data-act="fenceCargo" data-ship="${s.id}">Fence ${service.fence.qty} stolen cargo · ${fmt(service.fence.value)}</button>`
      : service.stolen ? '<span class="quiet">Stolen cargo can only be sold at your home haven.</span>' : ""}
    ${service.canUpgrade ? `<button class="secondary" data-act="upgradeHarbor" data-ship="${s.id}">Upgrade harbor · 1,000 + 10 machinery</button>` : ""}
  </div>`;
}

function maritimeHtml() {
  const m = me.maritime;
  if (!m) return "";
  return `<details data-detail="maritime-services">
    <summary>Maritime services</summary>
    <p class="quiet">Fleet tariff multiplier adds up to ${Math.round(m.tariffRate * 100)}% per fleet tier. Repeating the same lane within 48 game hours increases docking fees for cash-rich companies.</p>
    ${m.credit && !world.seasonOver ? `<p>One interest-free advance per season. Automatic repayment from surplus cash begins after a 48-hour liquidation grace period.</p>
      <button class="secondary" data-act="emergencyCredit">Draw ${fmt(m.credit)} emergency credit</button>
      ${m.consignment ? `<button class="secondary" data-act="emergencyConsignment">Take rescue charter · ${m.consignment.qty} grain to ${esc(world.ports[m.consignment.port].name)}</button>` : ""}` : ""}
    ${m.loan ? `<p>Emergency credit balance ${fmt(m.loan.balance)}. ${m.loan.graceUntil > world.tick ? `Grace ends in ${m.loan.graceUntil - world.tick} game hours.` : "Repaid from surplus cash."}</p>` : ""}
    <h3>Machinery futures</h3>
    <p class="quiet">World index ${fmt(m.machineryIndex)}. Contracts settle after 24 game hours. Maximum loss is the margin.</p>
    ${m.future ? `<p>${m.future.side === "long" ? "Long" : "Short"} at ${fmt(m.future.entry)} · ${m.future.settles - world.tick} hours to settlement · ${fmt(m.future.margin)} margin</p>`
      : m.futureAvailable && !world.seasonOver ? `<div class="row"><button class="secondary" data-act="machineryFuture" data-side="long">Go long · ${fmt(m.futureMargin)}</button>
        <button class="secondary" data-act="machineryFuture" data-side="short">Go short · ${fmt(m.futureMargin)}</button></div>` : ""}
    <h3>Privateer bounties</h3>
    ${m.bounties.length ? `<ul>${m.bounties.map(b => `<li>${esc(b.company)} · ${fmt(b.amount)}
      ${b.canFund && !world.seasonOver ? `<button class="link" data-act="fundBounty" data-target="${b.id}">Contribute 200</button>` : ""}</li>`).join("")}</ul>` : '<p class="quiet">No wanted pirates at the moment.</p>'}
    <h3>Player escort contracts</h3>
    ${m.escorts.length ? `<ul>${m.escorts.map(o => {
      const escort = me.ships.find(s => s.type === "pirate" && s.dest === null && s.port === o.from && !s.qty && !s.voyageQueue);
      return `<li>${esc(o.name)} · ${esc(world.ports[o.from].name)} → ${esc(world.ports[o.dest].name)} · ${fmt(o.pay)}
        ${escort && o.owner !== me.id && !world.seasonOver ? `<button class="link" data-act="acceptEscort" data-ship="${escort.id}" data-target="${o.target}">Escort now</button>` : ""}</li>`;
    }).join("")}</ul>` : '<p class="quiet">No open contracts. Post an offer from a ship’s dispatch card.</p>'}
    ${m.pennant ? '<p>⚑ Admiralty pennant registered</p>' : !world.seasonOver ? `<button class="secondary" data-act="buyPennant">Buy company pennant · ${fmt(m.pennantPrice)}</button>` : ""}
    ${m.notices.length ? `<ul>${m.notices.slice().reverse().map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
  </details>`;
}

function voyageQueueHtml(ship) {
  if (world.seasonOver) return "";
  const queue = ship.voyageQueue;
  const ports = [...world.ports].sort((a, b) => a.name.localeCompare(b.name));
  const rows = Array.from({ length: 3 }, (_, i) => {
    const leg = queue?.legs[i];
    return `<fieldset data-queue-leg><legend>Leg ${i + 1}</legend>
      <label>Destination <select data-queue="dest"><option value="">Unused</option>${ports.map(p => `<option value="${p.id}"${p.id === leg?.dest ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label>Cargo <select data-queue="good"><option value="">Sail empty</option>${GOOD_NAMES.map(g => `<option value="${g}"${leg?.buy?.good === g ? " selected" : ""}>${g}</option>`).join("")}</select></label>
      <label>Quantity <input data-queue="qty" type="number" min="1" max="${spec(ship).capacity}" value="${leg?.buy?.qty ?? spec(ship).capacity}"></label>
      <label>Maximum spend <input data-queue="maxSpend" type="number" min="1" step="0.01" value="${leg?.maxSpend ?? ""}"></label>
      <label>Minimum net sale <input data-queue="minProceeds" type="number" min="0" step="0.01" value="${leg?.minProceeds ?? 0}"></label>
    </fieldset>`;
  }).join("");
  return `<details class="voyageQueue" data-detail="queue-${ship.id}">
    <summary>Voyage queue${queue ? ` · ${queue.paused ? "paused" : queue.legs.length + " pending"}` : ""}</summary>
    <p class="quiet">Plan up to three legs. Each dispatch checks cash and the spending limit, including fuel, docking, and a 10-credit dispatch fee. Queued cargo sells on arrival only if it meets the minimum net sale. The queue runs while you are offline.</p>
    ${queue?.paused ? `<p class="est warn">${esc(queue.paused)}</p>` : ""}
    ${queue?.sale && !queue.paused ? '<p class="quiet">A queued cargo sale is pending.</p>' : ""}
    ${rows}
    <div class="row"><button type="button" data-act="saveQueue" data-ship="${ship.id}">Save voyage queue</button>
    ${queue ? `<button type="button" class="secondary" data-act="cancelQueue" data-ship="${ship.id}">Cancel queue</button>` : ""}</div>
  </details>`;
}

function returnLoadsHtml(ship) {
  if (ship.qty > 0) return "";
  const last = me.trips.find(t => t.ship === ship.id && t.to === ship.port && t.arriveTick <= world.tick);
  if (!last || last.from === ship.port) return "";
  const port = world.ports[ship.port], dest = world.ports[last.from];
  const offers = [];
  for (const good of ALL_GOODS) {
    const order = world.orders.filter(o => o.side === "buy" && !o.reservation && o.owner !== me.id && o.port === dest.id && o.good === good)
      .sort((a, b) => b.price - a.price)[0];
    const limit = Math.min(spec(ship).capacity, port.stock[good],
      Math.floor(Math.max(0, me.cash - cashReserve()) / (port.prices[good] * (1 + world.rules.tax) * 1.1)));
    for (const buyer of [null, order].filter(value => value !== undefined)) {
      const qty = Math.floor(Math.min(limit, buyer?.qty ?? limit));
      if (qty < 1) continue;
      const trip = tripProfit(ship, dest.id, good, qty);
      const cost = buyCost(port.id, good, qty) * (1 + world.rules.tax) + trip.fuel + trip.portFee;
      const revenue = buyer ? qty * buyer.price * (1 - world.rules.tax) : sellValue(dest.id, good, qty) * (1 - world.rules.tax);
      if (cost > me.cash || revenue <= cost || !landsInSeason(trip.hours)) continue;
      offers.push({ good, qty, hours: trip.hours, profit: revenue - cost, buyer });
    }
  }
  const best = offers.sort((a, b) => b.profit - a.profit).slice(0, 4);
  const guild = ship.guildFreight?.offer;
  return `<details data-detail="return-${ship.id}"><summary>Return-load board · ${esc(dest.name)}</summary>
    <p class="quiet">Funded orders and guild contracts dispatch immediately and pay on delivery. Market offers are estimates.</p>
    ${guild ? `<div class="row">
      <span>${guild.qty} ${esc(guild.good)} · ${guild.hours} h · costs up to ${fmt(guild.cost)} · pays ${fmt(guild.proceeds)} for the full load</span>
      <button type="button" class="secondary" data-act="dispatchGuildBackhaul" data-ship="${ship.id}" data-good="${guild.good}"
        data-qty="${guild.qty}" data-dest="${guild.dest}" data-cost="${guild.cost}" data-proceeds="${guild.proceeds}">Dispatch guild return load</button>
    </div>` : ""}
    ${best.length ? best.map(o => `<div class="row">
      <span>${o.qty} ${GOOD_NAMES[o.good]} · ${o.hours} h · about +${fmt(o.profit)} · ${o.buyer ? "funded buy order" : "port market"}</span>
      <button type="button" class="secondary" data-act="planReturn" data-ship="${ship.id}" data-good="${GOOD_NAMES[o.good]}" data-qty="${o.qty}" data-dest="${dest.id}">Review return voyage</button>
      ${o.buyer && me.maritime && !ship.voyageQueue ? `<button type="button" class="secondary" data-act="reserveBackhaul" data-ship="${ship.id}" data-order="${o.buyer.id}" data-qty="${o.qty}">Reserve and dispatch</button>` : ""}
    </div>`).join("") : guild ? "" : '<p class="quiet">No paying return load at current prices.</p>'}
  </details>`;
}

function shipCard(s) {
  const cargo = s.qty > 0 ? `<span class="tag ${GOOD_NAMES[s.good]}">${s.qty} ${GOOD_NAMES[s.good]}</span>` : `<span class="tag">empty</span>`;
  const protection = me.maritime?.ships.find(item => item.id === s.id);
  const stolen = protection?.stolen;
  if (s.dest !== null) {
    const total = Math.max(1, s.arriveTick - s.departTick), done = Math.min(1, (world.tick - s.departTick) / total);
    return `<div class="shipCard"><div class="top"><b>Ship ${s.id}</b><span class="cls">${esc(s.type)}</span>${cargo}</div>
      <div class="quiet">Sailing to ${esc(world.ports[s.dest].name)}, arrives in ${hoursLeft(s)} h</div>${raidHtml(s)}
      <div class="voyage"><span>${esc(world.ports[s.port].name)}</span><span>${Math.round(done * 100)}%</span><span>${esc(world.ports[s.dest].name)}</span></div>
      <div class="bar mine"><i style="width:${(done * 100).toFixed(0)}%"></i></div>${maritimeShipHtml(s)}${voyageQueueHtml(s)}</div>`;
  }
  const port = world.ports[s.port];
  if (world.seasonOver) {
    return `<div class="shipCard"><div class="top"><b>Ship ${s.id}</b><span class="cls">${esc(s.type)}</span>${cargo}</div>
      <div class="quiet">Docked at ${esc(port.name)}. Trading is closed until the next season starts.</div></div>`;
  }
  const matching = world.orders.filter(o => o.side === "buy" && !o.reservation && o.port === s.port && o.good === s.good && o.owner !== me.id);
  const forSale = world.orders.filter(o => o.side === "sell" && o.port === s.port && o.owner !== me.id
    && (s.qty === 0 || o.good === s.good) && s.qty < spec(s).capacity);
  const dests = world.ports.filter(p => p.id !== s.port).sort((a, b) => a.name.localeCompare(b.name));
  // The form starts on the best trip, or the best port to sail to when nothing pays here,
  // never on whichever port happens to come first alphabetically.
  const trips = bestTrips(s), move = trips.length || s.qty > 0 ? null : bestMove(s) ?? chainMove(s);
  const plan = trips[0] ? { dest: trips[0].dest, good: s.qty > 0 ? "" : GOOD_NAMES[trips[0].g], qty: trips[0].qty }
    : move ? { dest: move.dest, good: "", qty: spec(s).capacity }
    : { dest: null, good: "", qty: spec(s).capacity };   // nothing worth doing: don't pick a trip for them
  const fresh = justBought && justBought.id === s.id && Date.now() < justBought.until;
  return `<div class="shipCard${fresh ? " fresh" : ""}" data-ship="${s.id}">
    <div class="top"><b>Ship ${s.id}</b><span class="cls">${esc(s.type === "pirate" ? className(s.type) : s.type)}</span>${fresh ? `<span class="tag mine">new</span>` : ""}${cargo}</div>
    <div class="quiet">Docked at ${esc(port.name)} · ${classLine(s)}</div>${raidHtml(s)}
    ${s.qty > 0 && !stolen ? `<div class="row"><button data-act="sell" data-ship="${s.id}">Sell ${s.qty} ${GOOD_NAMES[s.good]} here for ${fmt(saleNet(s))}</button>
      ${matching.map(o => `<button class="secondary" data-act="fill" data-ship="${s.id}" data-order="${o.id}">Fill ${esc(o.ownerName)}'s order: ${Math.min(o.qty, s.qty)} for ${fmt(Math.min(o.qty, s.qty) * o.price * (1 - world.rules.tax))}</button>`).join("")}</div>
      <div class="est" data-field="saleNote">${saleNote(s)}</div>
      <div class="row labelled"><label class="mini">Quantity<input data-field="sellQty" type="number" min="1" max="${s.qty}" value="${s.qty}" style="width:80px"></label>
        <label class="mini">Price each<input data-field="sellPrice" type="number" step="0.5" value="${listPrice(s).toFixed(1)}" style="width:90px"></label>
        <button class="secondary" data-act="listSell" data-ship="${s.id}">List for sale here</button></div>
      <div class="est" data-field="listNote">Listing leaves the goods at this port for other players to buy, and frees your ship. Players can buy ${GOOD_NAMES[s.good]} from the market here for about ${marketBuyUnit(s).toFixed(2)} each with tax, so a listing above that rarely sells; the price box starts just under it. You get your price less ${Math.round(world.rules.tax * 1000) / 10}% tax.</div>` : ""}
    ${forSale.length ? `<h3>For sale here</h3>${forSale.map(o => listingHtml(s, o)).join("")}` : ""}
    ${tripsHtml(s, trips, move)}
    <label>Destination <span class="quiet">(or tap a port on the map)</span><select data-field="dest">${plan.dest === null ? `<option value="" selected disabled>Choose where to sail…</option>` : ""}${dests.map(p => `<option value="${p.id}"${p.id === plan.dest ? " selected" : ""}>${esc(p.name)} (≈${Math.ceil(distance(s.port, p.id) / spec(s).speed_per_hour)} h)</option>`).join("")}</select></label>
    ${s.qty === 0 ? `<div class="row" style="margin-top:4px">
      <select data-field="good" aria-label="Cargo to load" style="width:auto"><option value="">Sail empty</option>${GOOD_NAMES.map((g, i) => `<option value="${g}"${g === plan.good ? " selected" : ""}>Load ${g} at ${port.prices[i].toFixed(2)}</option>`).join("")}</select>
      <input data-field="qty" type="number" aria-label="Quantity to load" min="1" max="${spec(s).capacity}" value="${plan.qty}" style="width:90px"></div>` : ""}
    ${protection && world.rules.pirates?.enabled && s.type !== "pirate" ? `<div class="row">
      ${protection.insurance ? "" : '<label class="mini"><input type="checkbox" data-field="insureVoyage"> Insure this voyage</label>'}
      ${protection.convoy ? "" : '<label class="mini"><input type="checkbox" data-field="escortVoyage"> Book a naval escort</label>'}</div>` : ""}
    <div class="est big" data-field="estimate"></div>
    <div class="voyageCosts" data-field="voyageCosts"></div>
    <div class="row"><button data-act="sail" data-ship="${s.id}">Dispatch ship</button>
      ${me.maritime && s.type !== "pirate" && !s.voyageQueue ? `<button class="secondary" data-act="offerEscort" data-ship="${s.id}">Offer escort · 200</button>` : ""}
      ${me.ships.length > 1 && s.qty === 0 ? `<button class="link" data-act="${scrapAsk === s.id ? "scrapKeep" : "scrap"}" data-ship="${s.id}">${scrapAsk === s.id ? "Keep it" : `Scrap for ${fmt(spec(s).price / 2)}`}</button>` : ""}</div>
    ${me.ships.length > 1 && s.qty === 0 && scrapAsk === s.id ? scrapConfirmHtml(s) : ""}
    ${returnLoadsHtml(s)}
    ${maritimeShipHtml(s)}
    ${voyageQueueHtml(s)}
  </div>`;
}

/** The Raid section of a pirate ship's card: ships in range, the odds the server worked out, one button each. */
function raidHtml(s) {
  if (s.type !== "pirate" || !world.rules.pirates?.enabled || world.seasonOver) return "";
  if (s.dest === null) return '<div class="raidBox"><h3>Raid</h3><p class="quiet">Set sail to raid eligible ships. Police can intercept wanted pirates at sea.</p></div>';
  const locked = me.lockedOutHours > 0, wait = s.raidReadyIn > 0;
  const targets = (s.raidTargets ?? []).slice(0, 4);
  const why = locked ? `Your company is locked out for ${me.lockedOutHours} more hours.` : wait ? `This ship is lying low for ${s.raidReadyIn} more hours.` : "";
  const rows = targets.map(t => `<div class="raidRow"><span>Ship ${t.ship} of ${esc(t.ownerName)}, ${t.qty > 0 ? `${t.qty} ${GOOD_NAMES[t.good]}` : "empty"}, ${t.distance} away. Chance ${Math.round(t.chance * 100)}%.${t.convoyPrize ? ` NPC convoy prize ${fmt(t.convoyPrize)}.` : ""}</span>
      <button class="danger" data-act="raid" data-ship="${s.id}" data-target="${t.ship}" data-cargo-only="${Boolean(t.cargoOnly)}"${locked || wait ? " disabled" : ""} aria-label="Raid ship ${t.ship} of ${esc(t.ownerName)}, ${Math.round(t.chance * 100)} percent chance">${t.cargoOnly ? "Raid cargo only" : "Raid"}</button></div>`).join("");
  return `<div class="raidBox" data-field="raid"><h3>Raid</h3>
    ${why ? `<div class="est warn">${why}</div>` : ""}
    ${rows || `<div class="quiet">No ship is in range (${world.rules.pirates.range}) that can be raided. Look for ships out at sea, away from their own home port.</div>`}</div>`;
}
function raidResultText(res) {
  const pct = Math.round((res.chance ?? 0) * 100);
  if (res.outcome === "captured") return `Raid won, the whole ship is yours (${pct}% chance)`;
  if (res.outcome === "won") return `Raid won: ${res.loot ?? 0} units of cargo taken (${pct}% chance)`;
  return `Raid failed (${pct}% chance); repairs cost ${fmt(world.rules.pirates.failedRaidCost ?? 0)}`;
}
/** Notoriety bar, lockout, recent notices and the short explainer: shown only in worlds with pirates. */
function pirateStatusHtml() {
  const R = world.rules.pirates;
  if (!R?.enabled) return "";
  const max = R.notorietyMax, n = me.notoriety ?? 0;
  const tier = n >= R.lockoutBelow ? "Police will confiscate or lock you out if they catch you" : n >= R.fineBelow ? "Police will lock you out of sailing if they catch you" : n > 0 ? "Police will fine you if they catch you" : "Clean";
  const notices = (me.notices ?? []).slice().reverse();
  return `<h3>Notoriety</h3>
    <div class="quiet" data-field="notoriety">${n} of ${max}. ${tier}.</div>
    <div class="bar notoBar" role="meter" aria-label="Notoriety" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${n}"><i style="width:${Math.min(100, n / max * 100)}%"></i></div>
    ${me.lockedOutHours > 0 ? `<div class="est warn" data-field="lockout">The police have locked your company out of sailing for ${me.lockedOutHours} more hours.</div>` : ""}
    ${notices.length ? `<h3>Notices</h3><ul class="notices" data-field="notices">${notices.map(x => `<li class="${esc(x.kind)}">Day ${Math.floor(x.tick / 24) + 1}: ${esc(x.text)}</li>`).join("")}</ul>` : ""}
    <details class="howPirates"><summary>How pirates work</summary>
      <p>A pirate ship is fast with a small hold and is bought at your home port. While underway, press Raid on a ship at sea within ${R.range} of yours. The odds depend on how much faster you are and how big their hold is.</p>
      <p>A win takes cargo, or a clean win takes the ship. A loss costs repairs. Each raid adds notoriety, which fades with time; police ships patrol and catch notorious companies with a fine, a lockout from sailing, or confiscation of a ship.</p>
      <p>You cannot raid a ship in port, or a ship near its own home port (within ${R.homeSafeRadius}). Raids on single-ship companies take at most a quarter of the cargo and never capture the ship. A successful cargo raid protects that ship for 24 hours. Questions: <a href="https://discord.gg/zZDk58ZyD" target="_blank" rel="noopener">our Discord</a>.</p></details>`;
}

/** One line of a ship's class: what it holds and how fast it sails. */
function classLine(s) { const c = spec(s); return `holds ${c.capacity}, ${c.speed_per_hour} per hour`; }
/** Price each the market here charges a buyer for this load, with tax. */
function marketBuyUnit(s) { return buyCost(s.port, s.good, s.qty) * (1 + world.rules.tax) / s.qty; }
/** Starting price for "List for sale": the highest half step below what buying the same load from the
 *  market here costs, so the listing undercuts the market. It used to start at 1.15× the price, above
 *  that, at a price the note beside it said "rarely sells". */
function listPrice(s) { return Math.max(0.5, Math.ceil(marketBuyUnit(s) * 2 - 1) / 2); }
/** Scrapping can't be undone, so the first tap only asks (a stray tap on a phone cost a 12,000 ship). */
let scrapAsk = null;
function scrapConfirmHtml(s) {
  const price = spec(s).price;
  return `<div class="est warn" data-field="scrapNote">Scrapping Ship ${s.id} pays ${fmt(price / 2)} and can't be undone: a new ship like it costs ${fmt(price)}.
    It saves ${fmt(upkeepDue(me.ships) - upkeepDue(me.ships.filter(x => x !== s)))} a day in upkeep. Your net worth stays the same, since ships count at half their price.</div>
    <div class="row"><button class="secondary" data-act="scrap" data-ship="${s.id}">Yes, scrap Ship ${s.id} for ${fmt(price / 2)}</button></div>`;
}

// ---- trade maths, mirroring the server's sliding prices (engine.ts) so estimates are honest
function priceAt(g, stock) {
  const b = world.rules.bands[GOOD_NAMES[g]], T = world.rules.targets[g];
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
function fuelCost(from, to, g = -1, qty = 0, ship = null) {
  const need = distance(from, to) * spec(ship).fuel_per_100_distance / 100;
  const stock = world.ports[from].stock[1] - (g === 1 ? qty : 0);
  return buyCost(from, 1, need, stock);
}
/** Profit of a trip after tax, fuel and the port fee. A loaded ship is compared with selling here now. */
function tripProfit(s, dest, g, qty) {
  const tax = world.rules.tax, fuel = fuelCost(s.port, dest, s.qty > 0 ? -1 : g, s.qty > 0 ? 0 : qty, s);
  const sell = g >= 0 && qty > 0 ? sellValue(dest, g, qty) * (1 - tax) : 0;
  const cost = s.qty > 0 ? sellValue(s.port, g, qty, false) * (1 - tax) : g >= 0 && qty > 0 ? buyCost(s.port, g, qty) * (1 + tax) : 0;
  const portFee = me?.dockingFees?.[s.port]?.[dest] ?? world.rules.portFee;
  return { profit: sell - cost - fuel - portFee, fuel, portFee, hours: Math.max(1, Math.ceil(distance(s.port, dest) / spec(s).speed_per_hour)) };
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
  return 300 + (n > 1 ? upkeepDue(me.ships) + world.rules.portFee * n : 0);
}
function rawTrips(s, n = 3, delay = 0, cash = me.cash) {
  const cap = spec(s).capacity, here = world.ports[s.port], out = [];
  const goods = s.qty > 0 ? [s.good] : ALL_GOODS;
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
  if (me.ships.length > 1) return `Your cash is ${fmt(me.cash)}, so this ship can't buy cargo or fuel: only a company's last ship can sail on credit. Scrap a spare ship (${fmt(spareScrap())}) to raise cash${listed ? ", or wait for the goods you listed to sell" : ""}.`;
  return `Your cash is ${fmt(me.cash)}, so you can't buy cargo: it must be paid for in cash, and only fuel goes on credit. ${listed
    ? "The goods you listed for sale are your way back: when someone buys them, the money comes to you."
    : "Nothing earns money without cargo, and sailing empty only adds to the debt, so this company can't trade again this season. Every company starts fresh next season."}`;
}

/** One listing in "For sale here": what it costs in total, how many you can take (room and cash),
 *  and whether the market here is cheaper, so a player never pays over the odds without knowing. */
function listingHtml(s, o) {
  const g = GOOD_NAMES[o.good], tax = world.rules.tax;
  const room = Math.min(o.qty, spec(s).capacity - s.qty);
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
  const soonest = Math.min(...world.ports.filter(p => p.id !== s.port).map(p => Math.max(1, Math.ceil(distance(s.port, p.id) / spec(s).speed_per_hour))));
  if (!trips.length && !landsInSeason(soonest)) return `<h3>Best trips from here</h3><div class="est">The season ends in ${left} h, too soon for any voyage from here to dock in time. ${s.qty > 0 ? endCargoAdvice(s) : "Your ship can stay where it is."}</div>`;
  const broke = !trips.length && cashAdvice(s);
  if (broke) return `<h3>Best trips from here</h3><div class="est warn" data-field="cashAdvice">${broke}</div>`;
  if (!trips.length) return `<h3>Best trips from here</h3><div class="est">${s.qty > 0 ? "Nowhere pays more than selling here right now."
    : paysAnywhere(s) ? `No trip pays from here right now, and no empty move to another port earns at least +50 after its fuel and fees.${closestMoveText(s)} ${waitingCost()} Prices move every hour.`
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
  if (loading && (qty > spec(s).capacity || qty > world.ports[s.port].stock[g])) return null;   // refused for another reason
  const last = me.ships.length === 1, have = last ? Math.max(0, me.cash) : me.cash;
  const cost = n => buyCost(s.port, g, n) * (1 + world.rules.tax) + (last ? 0 : fuelCost(s.port, dest, g, n, s));
  const need = loading ? cost(qty) : last ? 0 : fuel;
  if (need <= have) return null;
  const what = loading ? (last ? "the cargo costs" : "cargo and fuel cost") : "the fuel costs";
  let text = `You are short of ${fmt(Math.ceil(need - have))} cash: ${what} about ${fmt(need)} and you have ${fmt(me.cash)}.`;
  let n = 0;
  if (loading) { let lo = 0, hi = qty; while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (cost(m) <= have) lo = m; else hi = m - 1; } n = lo; }
  if (n > 0) text += ` You can afford about ${n} ${GOOD_NAMES[g]}.`;
  else if (last) text += me.cash > 0 ? " Sail empty instead: your last ship's fuel can go on credit." : " Cargo must be paid for in cash; only fuel goes on credit.";
  else text += ` Only a company's last ship can sail on credit: sell cargo or scrap a spare ship (${fmt(spareScrap())}) first.`;
  return text;
}
/** Why the server would refuse loading `qty` of good `g` onto empty ship `s`, or null if it wouldn't. */
function loadProblem(s, g, qty) {
  const cap = spec(s).capacity, stock = Math.floor(world.ports[s.port].stock[g]);
  if (!(qty >= 1)) return `Enter how many ${GOOD_NAMES[g]} to load (1 to ${cap}), or choose Sail empty.`;
  if (qty > cap) return `Your ship holds ${cap} at most.`;
  if (qty > stock) return `This port only has ${fmt(stock)} ${GOOD_NAMES[g]} in stock.`;
  return null;
}
/** What the sail form says before a destination is picked. A loaded ship has cargo to sell, so
 *  "waiting is free" (meant for an empty ship with nothing worth doing) would point the wrong way.
 *  Nor does "prices move every hour, check back soon" help a ship held back by cash (cashAdvice):
 *  a company below zero sat under "this company can't trade again this season" and was told to
 *  check back soon or move anyway, though moving only adds fuel to the debt. */
function waitingCost() {
  const daily = upkeepDue(me.ships);
  return daily > 0 ? `Fleet upkeep continues at ${fmt(daily)} per day.` : "Your fleet has no daily upkeep.";
}
function noDestText(s) {
  if (s.qty > 0) return `Selling here pays best right now: use the Sell button above. Or pick a port above to carry your ${GOOD_NAMES[s.good]} there instead.`;
  if (cashAdvice(s)) return me.cash > 0
    ? "Pick a port above and load what you can afford; the estimate shows whether it pays."
    : me.ships.length > 1 ? "This ship can't sail until your cash is back above zero."
    : `${waitingCost()} Sailing empty puts its fuel on credit, adding to the debt, and earns nothing back.`;
  return `${waitingCost()} Check back as prices change, or choose a destination above.`;
}
function estimate(card) {
  const s = me.ships.find(x => x.id === Number(card.dataset.ship));
  const destVal = card.querySelector("[data-field=dest]").value;
  const sailBtn = card.querySelector("[data-act=sail]");
  const goodSel = card.querySelector("[data-field=good]");
  const hasCargo = s.qty > 0 || Boolean(goodSel?.value);
  card.querySelectorAll('[data-field="insureVoyage"], [data-field="escortVoyage"]').forEach(input => { input.disabled = !hasCargo; });
  if (destVal === "") {
    card.dataset.quoteKey = "";
    card.querySelector('[data-field="voyageCosts"]').innerHTML = "";
    if (sailBtn) sailBtn.disabled = true;
    card.querySelector("[data-field=estimate]").innerHTML = noDestText(s);
    return;
  }
  if (sailBtn) sailBtn.disabled = false;
  const dest = Number(destVal);
  const g = s.qty > 0 ? s.good : (goodSel?.value ? GOOD_NAMES.indexOf(goodSel.value) : -1);
  const qtyInput = card.querySelector("[data-field=qty]");
  if (qtyInput) qtyInput.disabled = g < 0;   // nothing to count when sailing empty
  const qty = s.qty > 0 ? s.qty : Math.floor(Number(qtyInput?.value || 0));
  // The server refuses these loads; say why here and keep "Set sail" off, instead of a bare
  // "bad cargo" or "over capacity" after the click (and an estimate for cargo that won't fit).
  const bad = s.qty === 0 && g >= 0 ? loadProblem(s, g, qty) : null;
  if (bad) {
    card.dataset.quoteKey = "";
    card.querySelector('[data-field="voyageCosts"]').innerHTML = "";
    if (sailBtn) sailBtn.disabled = true;
    card.querySelector("[data-field=estimate]").innerHTML = `<b class="neg">${bad}</b>`;
    return (bad.charAt(0).toLowerCase() + bad.slice(1)).replace(/\.$/, "");
  }
  const there = world.ports[dest];
  const t = tripProfit(s, dest, g, qty);
  let text = `Fuel ≈ ${fmt(t.fuel)}, port fee ${fmt(t.portFee)}.`;
  if (g < 0 || qty <= 0) text = `Sailing empty costs about <b class="neg">${fmt(t.fuel + t.portFee)}</b> (fuel ${fmt(t.fuel)}, port fee ${fmt(t.portFee)}).`;
  const late = !landsInSeason(t.hours);
  if (me.ships.length === 1 && t.fuel > me.cash) text += " You can't cover the fuel, so it goes on credit (your cash goes below zero).";
  // The server refuses a trip whose cargo (and, unless this is your last ship, fuel) costs more
  // than your cash; say so before the click instead of after it.
  const short = cashShortfall(s, dest, g, qty, t.fuel);
  card.dataset.cashProblem = short ?? "";
  if (short) { if (sailBtn) sailBtn.disabled = true; }
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
  const protection = selectedProtection(card);
  requestVoyageQuote(card, s, dest, g, qty, protection);
  // A one-line version for the toast when a destination is tapped on the map.
  if (late) return "docks after the season ends";
  if (short) return "not enough cash";
  if (g < 0 || qty <= 0) return `sailing empty costs about ${fmt(t.fuel + t.portFee)}`;
  return `${t.profit >= 0 ? "makes" : "loses"} about ${fmt(Math.abs(t.profit))}`;
}

function selectedProtection(card) {
  const chosen = field => card.querySelector(`[data-field="${field}"]:checked:not(:disabled)`) !== null;
  const insurance = chosen("insureVoyage"), convoy = chosen("escortVoyage");
  return insurance || convoy ? { insurance, convoy } : undefined;
}

function requestVoyageQuote(card, ship, dest, good, qty, protection) {
  const buy = ship.qty === 0 && good >= 0 ? { good: GOOD_NAMES[good], qty } : undefined;
  const cmd = { ship: ship.id, dest, ...(buy ? { buy } : {}), ...(protection ? { protection } : {}) };
  const key = JSON.stringify([world.navigationId, me.id, ship.port, ship.cost, cmd]);
  card.dataset.quoteKey = key;
  const cached = voyageQuotes.get(key);
  if (cached) showVoyageQuote(card, cached.response);
  else {
    setVoyageCosts(card, '<span class="quiet">Getting voyage costs…</span>');
    if (protection) card.querySelector("[data-act=sail]").disabled = true;
  }
  if (cached && Date.now() - cached.at < 5000 || [...quoteRequests.values()].some(p => p.key === key)) return;
  // Keep only recent form variants so typing does not accumulate quotes indefinitely.
  if (voyageQuotes.size > 50) voyageQuotes.delete(voyageQuotes.keys().next().value);
  const id = ++reqId;
  if (send({ type: "quoteVoyage", reqId: id, cmd })) quoteRequests.set(id, { key, ship: ship.id });
}
function showVoyageQuote(card, response) {
  setVoyageCosts(card, voyageCostsHtml(response));
  if (!selectedProtection(card)) return;
  const q = response.quote;
  card.querySelector("[data-act=sail]").disabled = !response.ok || !q.affordable;
  if (!response.ok) return;
  const estimate = card.querySelector("[data-field=estimate]");
  const late = !landsInSeason(q.hours) ? '<b class="neg">This ship would dock after the season ends.</b> ' : "";
  const short = q.affordable ? "" : '<b class="neg">You cannot cover the departure costs in cash.</b> ';
  estimate.innerHTML = `${late}${short}Protection costs ${fmt(q.insurancePremium + q.convoyFee)}. Expected trip profit ${fmt(q.profit)}. Cash after departure ${fmt(q.cashAfterDeparture)}.`;
}
function setVoyageCosts(card, html) {
  const element = card.querySelector('[data-field="voyageCosts"]');
  const previous = element.querySelector("details")?.open;
  element.innerHTML = html;
  const details = element.querySelector("details");
  if (details && previous !== undefined) details.open = previous;
}
function voyageCostsHtml(response) {
  if (!response.ok) return `<p class="quiet">${esc(response.error)}</p>`;
  const q = response.quote;
  return `<details data-detail="voyage-costs"><summary>Voyage cost breakdown</summary><dl class="costBreakdown">
    <dt>Cargo purchase</dt><dd>${fmt(q.cargoBase)}</dd><dt>Purchase tax</dt><dd>${fmt(q.purchaseTax)}</dd>
    ${q.cargoBasis && !q.cargoCost ? `<dt>Cargo already paid for</dt><dd>${fmt(q.cargoBasis)}</dd>` : ""}
    ${q.priorCosts ? `<dt>Earlier costs on this trip</dt><dd>${fmt(q.priorCosts)}</dd>` : ""}
    ${q.priorRevenue ? `<dt>Earlier sale proceeds</dt><dd>${fmt(q.priorRevenue)}</dd>` : ""}
    <dt>Fuel</dt><dd>${fmt(q.fuelCost)}</dd><dt>Arrival port fee</dt><dd>${fmt(q.portFee)}</dd>
    ${q.insurancePremium ? `<dt>Cargo insurance</dt><dd>${fmt(q.insurancePremium)}</dd>` : ""}
    ${q.convoyFee ? `<dt>Naval escort</dt><dd>${fmt(q.convoyFee)}</dd>` : ""}
    <dt>Expected sale, after ${fmt(q.saleTax)} tax</dt><dd>${fmt(q.revenue)}</dd>
    <dt>Expected trip profit</dt><dd>${fmt(q.profit)}</dd><dt>Cash just after departure</dt><dd>${fmt(q.cashAfterDeparture)}</dd></dl>
    <p class="quiet">Quoted at game hour ${q.tick}. Sale uses today's prices and cargo due before you arrive; production, future trades and fees may change the result.</p>
    <p class="quiet">Fleet upkeep during this voyage ≈ ${fmt(q.fleetUpkeep)} across your company, shown separately from trip profit to avoid charging it to multiple ships. No cargo sale is assumed until you sell.</p></details>`;
}

function fleetPanel() {
  if (!me) return `<div class="empty">Log in to see your fleet.</div>`;
  const atSea = me.ships.filter(s => s.dest !== null).length;
  const cargo = me.ships.reduce((a, s) => a + (s.qty > 0 ? s.cost : 0), 0);
  return `<h2>${me.maritime?.pennant ? "⚑ " : ""}${esc(me.name)}</h2>
    <div class="quiet">${me.ships.length} of ${world.rules.maxShips} ships. Current daily upkeep ${fmt(me.upkeepDue ?? upkeepDue(me.ships))}, including fleet tariffs. One freighter's base upkeep is free.</div>
    <div class="bar mine" style="height:6px;margin-top:8px"><i style="width:${me.ships.length / world.rules.maxShips * 100}%"></i></div>
    <div class="tiles">
      <div><span>At sea</span><b>${atSea}</b></div><div><span>Docked</span><b>${me.ships.length - atSea}</b></div>
      <div><span>Cargo (cost)</span><b>${fmt(cargo)}</b></div><div><span>Net worth</span><b>${fmt(me.worth)}</b></div>
    </div>
    <div class="quiet" data-field="worthSum">${worthSum(cargo)}</div>
    ${me.debugCredits && !world.seasonOver ? '<div class="row"><button class="secondary" data-act="debugCredits">Debug +100,000 credits</button></div>' : ""}
    ${watchlistHtml()}
    ${maritimeHtml()}
    <h3>Ships</h3>${(me.forcedSales ?? []).slice().reverse().map(f => `<div class="est warn" data-field="forcedSale">${forcedSaleText(f)}</div>`).join("")}
    ${me.ships.map(shipCard).join("")}
    ${shipyardHtml()}
    ${pirateStatusHtml()}
    ${notifyHtml()}
    ${worthChart()}
    ${tripLog()}`;
}

/** The ship's picture: the pirate speedboat's own sprite sheet (east-facing frame), the usual hull for the rest. */
function shipArtHtml(c) {
  return c === "pirate"
    ? `<span class="shipArt pirate" role="img" aria-label="Pirate speedboat: a blue speedboat flying a skull-and-crossbones flag"></span>`
    : `<img class="shipArt" src="img/ship-empty.png" alt="" width="56">`;
}
/** What a class can do in this game, from the real rules (nothing the game doesn't do). */
function shipRoleText(c) {
  if (c !== "pirate") return CLASS_ADVICE[c];
  const R = world.rules.pirates;
  return `The fastest and smallest hull. It can raid other companies' ships at sea within ${R.range} of it (the odds are shown first), then lies low for ${R.cooldownHours} hours. Every raid adds notoriety, and police patrols chase notorious companies with fines, lockouts or confiscation. Raiding is the Raid button on its card, in the Fleet tab. It can also carry cargo like any ship, but only ${spec(c).capacity} of it.`;
}
/** Can this company buy this class now, and if not, exactly why. `ports` are where it could be bought. */
function shipyardStatus(c) {
  const price = spec(c).price, max = world.rules.maxShips;
  const dockedAt = [...new Set(me.ships.filter(s => s.dest === null).map(s => s.port))];
  if (world.seasonOver) return { ports: [], why: "Trading is closed until the next season starts." };
  if (me.ships.length >= max) return { ports: [], why: `Your fleet is full: ${max} ships is the most a company can have. Scrap a spare ship to make room.` };
  const ports = c === "pirate" && world.rules.pirates?.homeOnly !== false ? dockedAt.filter(id => id === me.home) : dockedAt;
  if (c === "pirate" && !ports.length) return { ports, home: me.home, why: `Pirate speedboats are sold only at your home port, ${world.ports[me.home].name}, and one of your ships must be docked there.${dockedAt.length ? "" : " All your ships are at sea."}` };
  if (!ports.length) return { ports, why: "A ship is bought at a port where one of your ships is docked. All your ships are at sea, so wait until one docks." };
  if (me.cash < price) return { ports, short: price - me.cash, why: `You need ${fmt(price - me.cash)} more cash (it costs ${fmt(price)}; you have ${fmt(me.cash)}).` };
  return { ports, why: "" };
}
/** The Fleet tab's shipyard: every class on sale in this world, with its picture, price, stats and whether (and where) you can buy it. */
function shipyardHtml() {
  if (!me) return "";
  const classes = world.rules.pirates?.enabled ? [...SHIP_CLASSES, "pirate"] : SHIP_CLASSES;
  return `<h3>Shipyard</h3>${fleetBuyHtml()}<div class="yard">${classes.map(c => {
    const k = spec(c), st = shipyardStatus(c), cls = c === "pirate" ? " pirateCard" : "";
    const stats = `<dl class="yardStats"><dt>Price</dt><dd>${fmt(k.price)}</dd><dt>Holds</dt><dd>${k.capacity}</dd><dt>Speed</dt><dd>${k.speed_per_hour}/h</dd><dt>Fuel</dt><dd>${k.fuel_per_100_distance}/100</dd><dt>Upkeep</dt><dd>${fmt(k.upkeep)}/day</dd></dl>`;
    const buy = st.ports.length && !st.why ? `<div class="row">${st.ports.map(id => `<button data-act="buyShipAt" data-port="${id}" data-class="${c}"${buyLock ? " disabled" : ""}>Buy ${esc(className(c))} at ${esc(world.ports[id].name)} (${fmt(k.price)})</button>`).join(" ")}</div>`
      : `<div class="est warn" data-field="yardWhy-${c}">${esc(st.why)}${st.home !== undefined ? ` <button class="link" data-act="openPort" data-port="${st.home}">Open ${esc(world.ports[st.home].name)} →</button>` : ""}
          ${st.short ? `<button class="link" data-act="recoveryHelp" data-reason="You are short of ${fmt(Math.ceil(st.short))} cash for a ${esc(className(c))}.">Recovery options</button>` : ""}</div>`;
    return `<div class="yardCard${cls}" data-yard="${c}"><div class="yardTop">${shipArtHtml(c)}<div><b>${esc(className(c))}</b>${stats}</div></div>
      <p class="quiet">${esc(shipRoleText(c))}</p>${buy}</div>`;
  }).join("")}</div>
  <div class="quiet">Upkeep is charged each day for every ship, less one freighter's worth that is free across the fleet. A new ship counts at half its price in your net worth.</div>`;
}

/** Ships are bought at a port where one of yours is docked (engine buyShip), which the Fleet tab
 *  never said: point to those ports' Port tab, where the buy button and its warnings are. */
function fleetBuyHtml() {
  if (world.seasonOver) return "";
  const price = spec(buyClass).price, n = me.ships.length, max = world.rules.maxShips;
  if (n >= max) return `<div class="quiet" data-field="fleetBuy">Your fleet is full: ${max} ships is the most a company can have.</div>`;
  const ports = [...new Set(me.ships.filter(s => s.dest === null).map(s => s.port))];
  const why = `A new ship costs ${fmt(spec("coaster").price)} (coaster), ${fmt(spec("freighter").price)} (freighter) or ${fmt(spec("bulker").price)} (bulker) and is bought at a port where one of your ships is docked.`;
  if (!ports.length) return `<div class="quiet" data-field="fleetBuy">${why} All your ships are at sea, so wait until one docks.</div>`;
  const short = me.cash < price ? ` You need ${fmt(price - me.cash)} more cash for a ${buyClass}.` : "";
  return `<div class="quiet" data-field="fleetBuy">${why}${short}</div>
    <div class="row">${ports.map(id => `<button class="link" data-act="goPort" data-port="${id}">Buy a ship at ${esc(world.ports[id].name)} →</button>`).join(" ")}</div>`;
}

/** How net worth is made up (engine netWorth), so it adds up for a player who sees only cash and cargo. */
function worthSum(cargo) {
  const ships = me.ships.reduce((a, s) => a + spec(s).price / 2, 0);
  const orders = world.orders.filter(o => o.owner === me.id)
    .reduce((a, o) => a + (o.side === "buy" ? o.qty * o.price : o.cost ?? 0), 0);
  const n = me.ships.length;
  return `Net worth ${fmt(me.worth)} = cash ${fmt(me.cash)} + ${n} ship${n === 1 ? "" : "s"} at half price ${fmt(ships)}`
    + ` + cargo at cost ${fmt(cargo)}${orders ? ` + open orders ${fmt(orders)}` : ""}`
    + `${me.maritimeAssets ? ` ${me.maritimeAssets < 0 ? "−" : "+"} net maritime balances ${fmt(Math.abs(me.maritimeAssets))}` : ""}.`;
}

/** The day a net-worth log starts on: it has the founding value, then one value at the start of each
 * day since, so a company founded mid-season starts on its own day, not Day 1. */
function worthStartDay(logLength, tick) {
  return Math.max(1, Math.floor(tick / 24) + 1 - (logLength - 1));
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
    <div class="axis"><span>Day ${worthStartDay(pts.length - 1, world.tick)}</span><span>${world.seasonOver ? `Day ${Math.round(world.seasonHours / 24)}` : "Today"}</span></div>`;
}

function tripLog() {
  const trips = me.trips ?? [];
  if (!trips.length) return `<h3>Trip log</h3><div class="empty">Your finished trips and their profit will show here.</div>`;
  const rows = trips.map(t => {
    const what = t.good === null ? "empty" : `${t.qty} ${GOOD_NAMES[t.good]}`;
    const profit = t.earned - t.spent;
    const result = t.open
      ? `<span class="quiet">${me.ships.some(x => x.id === t.ship && x.dest !== null) ? "at sea" : t.good === null ? "docked" : world.seasonOver ? "unsold at season end" : "not sold yet"}</span>`
      : t.listed ? `<span class="quiet" title="Some of this cargo is listed for sale. The profit shows once it has all sold (or you take it back).">listed for sale</span>`
      : t.good === null ? `<span class="neg">−${fmt(t.spent)}</span>`
      : `<b class="${profit >= 0 ? "pos" : "neg"}">${profit >= 0 ? "+" : "−"}${fmt(Math.abs(profit))}</b>`;
    const detail = t.costs ? `<details class="tripReview" data-detail="trip-${t.ship}-${t.departTick}"><summary>Costs and result</summary>
      <p>Cargo ${fmt(t.costs.cargo)} · Fuel ${fmt(t.costs.fuel)} · Port fees ${fmt(t.costs.portFees)}${t.costs.protection ? ` · Protection ${fmt(t.costs.protection)}` : ""}${t.costs.dispatch ? ` · Dispatch ${fmt(t.costs.dispatch)}` : ""}. Received after sale tax: ${fmt(t.earned)}.</p>
      ${t.estimate ? `<p>Departure estimate: ${fmt(t.estimate.profit)} profit, with ${fmt(t.estimate.revenue)} sale proceeds.
      ${!t.open && !t.listed ? `Actual profit: ${fmt(profit)} (${fmt(profit - t.estimate.profit)} compared with the estimate). Sale prices, buyer orders, fees and additional stops can change the result.` : "The result is pending until all cargo is sold."}</p>` : "<p>The cargo changed after departure, so the original estimate is no longer comparable.</p>"}
      <p class="quiet">Company upkeep is separate from trip profit.</p></details>` : "";
    return `<tr><td class="num">${Math.floor(t.departTick / 24) + 1}</td><td>${esc(world.ports[t.from].name)} → ${esc(world.ports[t.to].name)}${detail}</td><td>${what}</td><td class="num">${result}</td></tr>`;
  }).join("");
  const done = trips.filter(t => !t.open && !t.listed), total = done.reduce((a, t) => a + t.earned - t.spent, 0);
  return `<h3>Trip log</h3>
    <table class="trips-log"><tr><th class="num">Day</th><th>Route</th><th>Cargo</th><th class="num">Profit</th></tr>${rows}</table>
    ${done.length ? `<div class="est">Last ${done.length} finished trip${done.length === 1 ? "" : "s"}: <b class="${total >= 0 ? "pos" : "neg"}">${total >= 0 ? "+" : "−"}${fmt(Math.abs(total))}</b> after cargo, fuel, fees and tax.${trips.some(t => t.listed) ? " Trips with cargo listed for sale are added once it has all sold." : ""}</div>` : ""}`;
}

/** What a buy order costs if it fills completely: the goods don't come back to you. The server
 *  refuses an order your cash doesn't cover (engine.ts placeOrder), so say that before the click. */
function orderCostText(qty, price, good = "grain") {
  const band = world.rules.bands[good];
  if (!(Math.floor(qty) >= 1 && Math.floor(qty) <= 1000)) return "Quantity must be 1 to 1000.";
  if (band && !(price >= band.floor && price <= band.ceiling)) return `Price for ${good} must be between ${band.floor} and ${band.ceiling}.`;
  const total = Math.floor(qty) * price;
  if (total > 0 && me && total > me.cash) return `Not enough cash: this order needs ${fmt(total)} to cover it and you have ${fmt(me.cash)}.`;
  return total > 0 ? `If it fills, this costs you ${fmt(total)}.` : "";
}
/** A buy order can always be cancelled; a listing only when one of your ships is docked at its port
 *  with room to take the goods back (engine cancelOrder), otherwise the Cancel button only errors. */
function canTakeBack(o) {
  return o.side === "buy" || me.ships.some(s => s.dest === null && s.port === o.port
    && (s.qty === 0 || s.good === o.good) && s.qty + o.qty <= spec(s).capacity);
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
    <div class="row"><label class="mini grow">Port<select id="oPort">${world.ports.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${p.id === selectedPort ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label></div>
    <div class="row labelled"><label class="mini">Good<select id="oGood" style="width:auto">${GOOD_NAMES.map(g => `<option>${g}</option>`).join("")}</select></label>
      <label class="mini">Quantity<input id="oQty" type="number" min="1" max="1000" value="100" style="width:90px"></label>
      <label class="mini">Price each<input id="oPrice" type="number" step="0.5" value="30" style="width:90px"></label>
      <button data-act="placeOrder">Post</button></div>
    <div class="est">Grain ${b.grain.floor}–${b.grain.ceiling}, fuel ${b.fuel.floor}–${b.fuel.ceiling} per unit. <span id="oCost">${orderCostText(100, 30)}</span></div>` : ""}
    <h3>Your orders</h3>
    ${mine.length ? `<table><tr><th>Port</th><th>Order</th><th class="num">Qty</th><th class="num">Price</th><th></th></tr>${mine.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td><span class="tag ${GOOD_NAMES[o.good]}">${o.side === "sell" ? "selling" : "buying"} ${GOOD_NAMES[o.good]}</span></td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td><td>${world.seasonOver ? "" : o.reservation ? '<span class="quiet">Reserved for delivery</span>' : canTakeBack(o) ? `<button class="link" data-act="cancelOrder" data-order="${o.id}">Cancel</button>`
      : `<span class="quiet" data-field="takeBack">Dock a ship with room here to cancel</span>`}</td></tr>`).join("")}</table>` : `<div class="empty">You have no open orders.</div>`}
    <h3>All open orders</h3>
    ${others.length ? `<table><tr><th>Port</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${others.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td>${o.side === "sell" ? "for sale" : "wanted"}: ${GOOD_NAMES[o.good]}</td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="empty">No other open orders.</div>`}`;
}

/** What each class is for, in a line, so the choice isn't a guess. */
const CLASS_ADVICE = {
  coaster: "Fast and small: best on short hops, in thin markets like machinery, and when cash is tight.",
  freighter: "The all-rounder, and the ship you start with.",
  bulker: "Slow and big: best for cheap bulk goods (grain, ore, fuel) between big producers and consumers. Too big for thin machinery markets.",
  pirate: "The fastest and smallest ship, sold only at your home port. It earns by raiding other companies' ships at sea, which brings notoriety and the police; see How pirates work in the Fleet tab.",
};
function classNote(c) {
  const k = spec(c);
  return `${CLASS_ADVICE[c]} Holds ${k.capacity}, sails ${k.speed_per_hour} a hour, burns ${k.fuel_per_100_distance} fuel per 100 distance, upkeep ${fmt(k.upkeep)} a day.`;
}
/** "Buy a ship" when you can afford one; otherwise say how much more cash it needs instead of a button that only errors. */
function buyShipHtml() {
  if (!buyableClasses().includes(buyClass)) buyClass = "freighter";
  const price = spec(buyClass).price;
  // Ships count at half their price in net worth (engine netWorth), so a new ship drops your net
  // worth at once; without saying so, the net-worth chart's sudden fall looks like a loss.
  // Upkeep is charged at the start of each day; a company below zero then has an idle spare ship
  // sold for half its price. Buying with little cash left (cargo soon eats the rest) walks into that.
  const left = me.cash - price, upkeep = upkeepDue([...me.ships, { type: buyClass }]);   // upkeep once the new ship is in
  const load = Math.min(...[0, 1].map(g => buyCost(selectedPort, g, spec(buyClass).capacity) * (1 + world.rules.tax)));
  const tight = left < load + upkeep;
  const picker = `<div class="row labelled"><label class="mini">Ship class<select data-field="shipClass" aria-label="Ship class to buy">${buyableClasses().map(c => `<option value="${c}"${c === buyClass ? " selected" : ""}>${c === "pirate" ? className(c) : c} · ${fmt(spec(c).price)}</option>`).join("")}</select></label></div>
    <div class="est" data-field="classNote">${classNote(buyClass)}</div>`;
  if (me.cash >= price) return `${picker}<div class="row" data-field="buyShipRow"><button data-act="buyShip">Buy a ship here (${fmt(price)})</button></div>
    <div class="est${tight ? " warn" : ""}" data-field="buyShipNote">${tight ? `You'd have ${fmt(left)} cash left, less than one full load here (about ${fmt(load)}) plus a day's upkeep (${fmt(upkeep)}). ` : ""}Upkeep is charged at the start of each day for every ship, less one freighter's worth that is free across the fleet; if your cash is below zero then, an idle spare ship is sold for ${fmt(price / 2)}, half what you paid. Ships count at half their price, so your net worth drops by ${fmt(price / 2)} at first; the extra ship has to earn it back.</div>`;
  return `${picker}<div class="row" data-field="buyShipRow"><button disabled>Buy a ship here (${fmt(price)})</button><span class="quiet">You need ${fmt(price - me.cash)} more cash.</span><button class="link" data-act="recoveryHelp" data-reason="You are short of ${fmt(Math.ceil(price - me.cash))} cash for a ${buyClass}.">Recovery options</button></div>`;
}
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
let boardDivision = "all";
function boardPanel() {
  const boards = world.boards;
  const selected = boards.find(board => board.id === boardDivision) ?? boards[0];
  const board = selected.rows, placement = me?.placements?.[selected.id];
  const rank = placement?.rank, tied = placement?.tied, companies = placement?.companies;
  const options = filter => boards.filter(filter).map(({ id, label }) =>
    `<option value="${esc(id)}"${id === selected.id ? " selected" : ""}>${esc(label)}</option>`).join("");
  const selector = `<label class="mini">Compare companies <select id="boardDivision">
    ${options(b => b.id === "all")}
    <optgroup label="Fleet size">${options(b => /^[0-2]$/.test(b.id))}</optgroup>
    <optgroup label="Fleet capacity">${options(b => b.id.startsWith("hold-"))}</optgroup>
    <optgroup label="Capital">${options(b => b.id.startsWith("capital-"))}</optgroup>
    <optgroup label="Special categories">${options(b => !/^(all|[0-2]|hold-|capital-)/.test(b.id))}</optgroup>
    </select></label>`;

  const top = board[0]?.score ?? 0;
  // Bars show the spread between companies, not distance from zero (everyone starts near 16,000).
  const low = Math.min(top, ...board.map(c => c.score)), span = Math.max(1, top - low);
  const barW = w => (15 + 85 * (w - low) / span).toFixed(0);
  const scoreText = n => selected.measure === "Units per fleet-hour" ? n.toFixed(2) : fmt(n);
  const listed = me && board.some(c => c.id === me.id);
  const rankOf = i => 1 + board.findIndex(c => c.score === board[i].score);
  const weekly = world.weeklyLeaders;
  return `<h2>Leaderboard</h2>${selector}<p class="quiet">${esc(selected.description)}</p><div class="quiet">Companies marked bot are computer traders. <a href="/seasons">Past seasons</a></div>
    ${me && rank ? `<div class="youRank"><span>You</span><b>${tied ? "joint " : ""}${ordinal(rank)}</b><span>of ${companies}</span><span class="num">${scoreText(placement.score)}</span>
      <span class="quiet">${rank === 1 ? "You're in the lead." : `${scoreText(top - placement.score)} behind the leader`}</span></div>` : ""}
    ${weekly?.leaders.length ? `<details data-detail="weekly-leaders"><summary>Week ${weekly.week} fleet milestones</summary><ul>${weekly.leaders.map(l =>
      `<li>${esc(l.division)} · ${l.names.map(esc).join(", ")}</li>`).join("")}</ul></details>` : ""}
    <h3>Top companies</h3>
    ${!board.length ? `<p class="quiet">No companies currently qualify for this board.</p>` : ""}
    <table><tr><th>#</th><th>Company</th><th class="num">Ships</th><th class="num">${esc(selected.measure)}</th></tr>
    ${board.map((c, i) => [c, rankOf(i)]).map(([c, r]) => `<tr${me && c.id === me.id ? ' class="me"' : ""}><td><span class="rank${r <= 3 ? " r" + r : ""}">${r}</span></td>
      <td>${esc(c.name)}${c.bot ? ' <span class="tag">bot</span>' : ""}${me && c.id === me.id ? ' <span class="tag mine">you</span>' : ""}<div class="bar${me && c.id === me.id ? " mine" : ""}"><i style="width:${barW(c.score)}%"></i></div></td>
      <td class="num">${c.ships}</td><td class="num">${scoreText(c.score)}</td></tr>`).join("")}
    ${me && !listed && rank ? `<tr class="me notListed"><td><span class="rank">${rank}</span></td><td>${esc(me.name)} <span class="tag mine">you</span></td>
      <td class="num">${me.ships.length}</td><td class="num">${scoreText(placement.score)}</td></tr>` : ""}</table>
    ${me && !listed && rank ? `<div class="est">${tied
      ? `You share ${ordinal(rank)} place with ${tied} other ${tied === 1 ? "company" : "companies"}; only the top ${board.length} rows are listed, so you're shown at the end.`
      : `You're outside the top ${board.length}, so you're shown at the end.`}</div>` : ""}`;
}

/** The buttons inside the trade card's calculated part (re-bound whenever the quantity changes it). */
function bindTradeCalc() {
  const box = $("tradeCalc"); if (!box) return;
  box.querySelectorAll("[data-act=useMax]").forEach(b => b.addEventListener("click", () => {
    const s = tradeShip(); tradeQty.set(`${s.port}:${selectedGood}:${s.id}`, b.dataset.qty);
    const q = document.querySelector("[data-field=goodQty]"); q.value = b.dataset.qty; q.dispatchEvent(new Event("input"));
  }));
  box.querySelectorAll("[data-act=sell]").forEach(b => b.addEventListener("click", () => command({ type: "sell", ship: Number(b.dataset.ship) }, () => toast("Sold"))));
  box.querySelectorAll("[data-act=plan], [data-act=planLoad]").forEach(b => b.addEventListener("click", () => planFromTrade(b)));
}
/** Fill the ship's sail form with the chosen good and quantity (and destination), then bring it into view; the player still presses Set sail. */
function planFromTrade(btn) {
  const card = document.querySelector(`.shipCard[data-ship="${btn.dataset.ship}"]`); if (!card) return;
  const set = (field, v) => { const el = card.querySelector(`[data-field=${field}]`); if (!el) return; el.value = v; formState.set(formKey(el), v); };
  set("good", btn.dataset.good); set("qty", btn.dataset.qty);
  if (btn.dataset.dest) set("dest", btn.dataset.dest);
  activeShip = Number(btn.dataset.ship); estimate(card);
  card.scrollIntoView({ block: "nearest" });
  (btn.dataset.dest ? card.querySelector("[data-act=sail]") : card.querySelector("[data-field=dest]"))?.focus({ preventScroll: true });
}
function bindPanel() {
  $("boardDivision")?.addEventListener("change", event => {
    boardDivision = event.target.value;
    event.target.blur();
    render();
    $("boardDivision")?.focus();
  });

  document.querySelectorAll(".shipCard[data-ship]").forEach(card => {
    if (!card.querySelector("[data-field=dest]")) return;
    card.querySelectorAll("select:not([data-queue]), input:not([data-queue])").forEach(el => el.addEventListener("input", () => {
      const result = estimate(card);
      if (result === "not enough cash") showRecoveryReason(card.dataset.cashProblem);
      else { recoveryReason = null; if (!recoveryFailure && !me?.recovery?.active) $("recovery")?.remove(); }
    }));
    estimate(card);
  });
  if ($("oCost")) {   // after restoreForm, so it matches what the player typed
    const cost = () => {
      const qty = Number($("oQty").value), price = Number($("oPrice").value), good = $("oGood").value;
      const text = orderCostText(qty, price, good), bad = !text.startsWith("If it fills");
      $("oCost").textContent = text;
      $("oCost").classList.toggle("neg", bad);
      document.querySelector("[data-act=placeOrder]").disabled = bad;
    };
    for (const id of ["oQty", "oPrice", "oGood"]) $(id).addEventListener("input", cost);
    cost();
  }
  document.querySelectorAll(".goodRow").forEach(row => {
    const pick = () => { selectedGood = selectedGood === Number(row.dataset.good) ? null : Number(row.dataset.good); render(); document.getElementById("goodTrade")?.scrollIntoView({ block: "nearest" }); };
    row.addEventListener("click", pick);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  });
  const gq = document.querySelector("[data-field=goodQty]");
  if (gq) gq.addEventListener("input", () => {
    const s = tradeShip(); if (!s) return;
    tradeQty.set(`${s.port}:${selectedGood}:${s.id}`, gq.value);
    $("tradeCalc").innerHTML = tradeCalcHtml(world.ports[selectedPort]); bindTradeCalc();
  });
  bindTradeCalc();
  document.querySelectorAll("[data-act]:not(#tradeCalc *)").forEach(btn => btn.addEventListener("click", () => {
    const act = btn.dataset.act, ship = Number(btn.dataset.ship);
    if (act === "debugCredits") {
      command({ type: "debugCredits" }, () => toast("Added 100,000 credits"));
      return;
    }
    if (act === "dispatchGuildBackhaul") {
      command({ type: act, ship, dest: Number(btn.dataset.dest), good: btn.dataset.good, qty: Number(btn.dataset.qty),
        maxSpend: Number(btn.dataset.cost), minProceeds: Number(btn.dataset.proceeds) }, () => toast("Guild return load dispatched"));
      return;
    }
    if (act === "reserveBackhaul") {
      command({ type: act, ship, order: Number(btn.dataset.order), qty: Number(btn.dataset.qty) }, () => toast("Funded return load dispatched"));
      return;
    }
    if (["emergencyCredit", "emergencyConsignment", "insureCargo", "bookConvoy", "machineryFuture", "fenceCargo", "fundBounty", "buyPennant", "offerEscort", "acceptEscort", "upgradeHarbor"].includes(act)) {
      const dest = btn.closest(".shipCard")?.querySelector("[data-field=dest]")?.value;
      command({ type: act, ship, dest: dest ? Number(dest) : null, target: Number(btn.dataset.target), side: btn.dataset.side }, () => toast("Maritime service confirmed"));
      return;
    }
    if (act === "planReturn") { planFromTrade(btn); return; }
    if (act === "saveQueue") {
      const legs = [...btn.closest(".voyageQueue").querySelectorAll("[data-queue-leg]")].flatMap(row => {
        const value = field => row.querySelector(`[data-queue="${field}"]`).value;
        if (value("dest") === "") return [];
        const good = value("good");
        return [{
          dest: Number(value("dest")), maxSpend: Number(value("maxSpend")), minProceeds: Number(value("minProceeds")),
          ...(good ? { buy: { good, qty: Number(value("qty")) } } : {}),
        }];
      });
      if (!legs.length) { toast("Choose at least one destination.", true); return; }
      command({ type: "setVoyageQueue", ship, legs }, () => toast("Voyage queue saved"));
      return;
    }
    if (act === "cancelQueue") {
      command({ type: "setVoyageQueue", ship, legs: [] }, () => toast("Voyage queue cancelled"));
      return;
    }

    if (act === "watchPort") {
      const port = Number(btn.dataset.port), watched = watchedPorts();
      const exists = watched.some(w => w.port === port);
      if (!exists && watched.length >= 5) return toast("You can watch 5 ports. Unwatch one first.", true);
      store.set(watchKey(), JSON.stringify(exists ? watched.filter(w => w.port !== port) : [...watched, { port, prices: world.ports[port].prices }]));
      render();
    }
    if (act === "closeGood") { selectedGood = null; render(); }
    if (act === "notify") {
      if (store.get("notify") && Notification.permission === "granted") { store.set("notify", null); render(); }
      else Notification.requestPermission().then(p => { if (p === "granted") { store.set("notify", true); toast("Dock alerts on"); } render(); });
    }
    if (act === "sell") command({ type: "sell", ship }, () => toast("Sold"));
    if (act === "fill") command({ type: "sell", ship, order: Number(btn.dataset.order) }, () => toast("Order filled"));
    if (act === "scrap") {
      if (scrapAsk !== ship) { scrapAsk = ship; render(); }
      else { scrapAsk = null; const back = spec(me.ships.find(x => x.id === ship) ?? "freighter").price / 2; command({ type: "scrapShip", ship }, () => toast(`Ship ${ship} scrapped for ${fmt(back)}`)); }
    }
    if (act === "openPort") { selectedPort = Number(btn.dataset.port); tab = "port"; render(); }
    if (act === "goPort") { selectedPort = Number(btn.dataset.port); tab = "port"; scrollToBuy = true; render(); }
    if (act === "raid") command({ type: "raid", ship, target: Number(btn.dataset.target), cargoOnly: btn.dataset.cargoOnly === "true" }, res => toast(raidResultText(res), res.outcome === "lost" ? "bad" : false));
    if (act === "scrapKeep") { scrapAsk = null; render(); }
    if (act === "buyShip" || act === "buyShipAt") {
      if (buyLock) return;   // a purchase is already on its way
      const port = act === "buyShipAt" ? Number(btn.dataset.port) : selectedPort, cls = act === "buyShipAt" ? btn.dataset.class : buyClass, price = spec(cls).price;
      buyLock = true; btn.disabled = true;
      command({ type: "buyShip", port, shipType: cls }, res => {
        // Take the player to the new ship: its port, the Port tab, and its card highlighted.
        selectedPort = port; tab = "port"; activeShip = res.id; justBought = { id: res.id, until: Date.now() + 6000 };
        setTimeout(() => document.querySelector(`.shipCard[data-ship="${res.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
        toast(`${className(cls)} bought at ${world.ports[port].name} for ${fmt(price)}. Ship ${res.id} is docked there.`);
      });
      setTimeout(() => { buyLock = false; }, 4000);   // never leave the button locked if no reply comes
    }
    if (act === "cancelOrder") command({ type: "cancelOrder", order: Number(btn.dataset.order) }, () => toast("Order cancelled"));
    if (act === "listSell") {
      const card = btn.closest(".shipCard");
      command({ type: "placeSell", ship, qty: Number(card.querySelector("[data-field=sellQty]").value),
        price: Number(card.querySelector("[data-field=sellPrice]").value) }, res => toast(listedText(res)));
    }
    if (act === "buyOrder") command({ type: "buyFromOrder", ship, order: Number(btn.dataset.order), qty: Number(btn.dataset.qty) }, () => toast("Bought"));
    if (act === "placeOrder") {
      const port = Number($("oPort").value), good = $("oGood").value;
      command({ type: "placeOrder", port, good, qty: Number($("oQty").value), price: Number($("oPrice").value) },
        res => toast(orderPostedText(res, port, good)));
    }
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
      const protection = selectedProtection(card);
      command({ type: "sail", ship, dest, ...(good ? { buy: { good, qty } } : {}), ...(protection ? { protection } : {}) }, () => toast(`Sailing to ${world.ports[dest].name}`));
    }
  }));
}

connect();
