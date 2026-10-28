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
    if (msg.type === "state") {
      if (!world || msg.world.tick !== world.tick) tickAt = Date.now();
      const firstLogin = !me && msg.me;
      world = msg.world; me = msg.me;
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
    } else if (msg.type === "error") toast(msg.error, true);
  };
}

function command(cmd, onOk) {
  const id = ++reqId;
  if (onOk) pendingReq.set(id, onOk);
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
$("logout").addEventListener("click", () => { store.set("token", null); location.reload(); });

// ------------------------------------------------------------ game maths (display only; the server decides)

function shipPos(s) {
  const a = world.ports[s.port];
  if (s.dest === null) return { x: a.x, y: a.y };
  const b = world.ports[s.dest];
  const total = Math.max(1, s.arriveTick - s.departTick);
  const elapsed = world.tick - s.departTick + Math.min(1, (Date.now() - tickAt) / world.tickMs);
  const f = Math.max(0, Math.min(1, elapsed / total));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
function distance(a, b) {
  // Real sea-route distance from the server; straight line only until it arrives.
  if (dist) return dist[a][b];
  const p = world.ports[a], q = world.ports[b];
  return Math.hypot(p.x - q.x, p.y - q.y);
}
function hoursLeft(s) { return Math.max(0, s.arriveTick - world.tick); }

// ------------------------------------------------------------ map

const canvas = $("map"), ctx = canvas.getContext("2d");
let view = { scale: 1, ox: 0, oy: 0 };

function drawMap() {
  if (!world) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const scale = Math.min(w / 1000, h / 700) * 0.94;
  view = { scale, ox: (w - 1000 * scale) / 2, oy: (h - 700 * scale) / 2 };
  const P = p => [view.ox + p.x * scale, view.oy + p.y * scale];
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  ctx.strokeStyle = css("--line"); ctx.lineWidth = 1;
  for (const r of world.routes) {
    const [x1, y1] = P(world.ports[r.a]), [x2, y2] = P(world.ports[r.b]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  for (const p of world.ports) {
    const [x, y] = P(p);
    ctx.fillStyle = p.produces.includes("grain") ? css("--grain") : p.produces.includes("fuel") ? css("--fuel") : css("--other");
    ctx.beginPath(); ctx.arc(x, y, p.id === selectedPort ? 8 : 5.5, 0, Math.PI * 2); ctx.fill();
    if (p.id === selectedPort) { ctx.strokeStyle = css("--ink"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; }
    ctx.fillStyle = css("--quiet"); ctx.font = "11px IBM Plex Sans, sans-serif";
    ctx.fillText(p.name, x + 9, y + 4);
  }
  const mine = new Set((me?.ships ?? []).map(s => s.id));
  for (const s of world.ships) {
    if (s.dest === null && !mine.has(s.id)) continue;
    const [x, y] = P(shipPos(s));
    ctx.fillStyle = mine.has(s.id) ? css("--mine") : "rgba(232,238,242,.45)";
    ctx.beginPath(); ctx.arc(x, y, mine.has(s.id) ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

canvas.addEventListener("click", e => {
  if (!world) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let best = null, bd = 18;
  for (const p of world.ports) {
    const d = Math.hypot(view.ox + p.x * view.scale - mx, view.oy + p.y * view.scale - my);
    if (d < bd) { bd = d; best = p.id; }
  }
  if (best !== null) { selectedPort = best; tab = "port"; render(); }
});
(function loop() { drawMap(); requestAnimationFrame(loop); })();

// ------------------------------------------------------------ panels

document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; render(); }));

function render() {
  if (!world) return;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("hName").textContent = me?.name ?? "–";
  $("hCash").textContent = me ? fmt(me.cash) : "–";
  $("hWorth").textContent = me ? fmt(me.worth) : "–";
  const days = world.seasonHours / 24;
  $("hClock").textContent = world.seasonOver ? "Season over"
    : `Day ${Math.floor(world.tick / 24) + 1} of ${days}, ${String(world.tick % 24).padStart(2, "0")}:00`;
  $("seasonBanner").classList.toggle("hidden", !world.seasonOver);
  if (world.seasonOver) {
    const top = world.leaderboard[0];
    $("seasonBanner").innerHTML = `<b>The season has ended.</b> ${top ? `${esc(top.name)} finished first with ${fmt(top.worth)}.` : ""} Trading is closed until the next season starts.`;
  }
  // Don't wipe a form the player is filling in; refresh it once they leave the field.
  const focused = document.activeElement;
  if (focused && $("panel").contains(focused) && /INPUT|SELECT/.test(focused.tagName)) {
    focused.addEventListener("blur", () => setTimeout(render, 0), { once: true });
    return;
  }
  const html = { port: portPanel, fleet: fleetPanel, orders: ordersPanel, board: boardPanel }[tab]();
  $("panel").innerHTML = html;
  bindPanel();
}

function portPanel() {
  const p = world.ports[selectedPort];
  const role = [p.produces.length ? `Produces ${p.produces.join(", ")}` : "", p.consumes.length ? `needs ${p.consumes.join(", ")}` : ""].filter(Boolean).join("; ");
  const rows = GOOD_NAMES.map((g, i) => `<tr><td><span class="tag ${g}">${g}</span></td><td class="num">${p.prices[i].toFixed(2)}</td><td class="num">${fmt(p.stock[i])}</td><td class="num">${fmt(p.inbound[i])}</td></tr>`).join("");
  const orders = world.orders.filter(o => o.port === p.id);
  const docked = (me?.ships ?? []).filter(s => s.dest === null && s.port === p.id);
  return `
    <h2>${esc(p.name)}</h2><div class="quiet">${esc(role) || "A quiet port"}</div>
    <h3>Market</h3>
    <table><tr><th>Good</th><th class="num">Price</th><th class="num">Stock</th><th class="num">Inbound</th></tr>${rows}</table>
    <div class="est">${p.emptyInbound} empty ship${p.emptyInbound === 1 ? "" : "s"} heading here to load. Inbound cargo will push prices down when it lands.</div>
    <h3>Buy orders here</h3>
    ${orders.length ? `<table><tr><th>Buyer</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${orders.map(o => `<tr><td>${esc(o.ownerName)}</td><td>${GOOD_NAMES[o.good]}</td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="quiet">None yet.</div>`}
    <h3>Your ships here</h3>
    ${docked.length ? docked.map(shipCard).join("") : `<div class="quiet">None of your ships are docked here.</div>`}
    ${me && docked.length && me.ships.length < world.rules.maxShips ? `<div class="row"><button data-act="buyShip">Buy a ship here (${fmt(world.rules.shipPrice)})</button></div>` : ""}`;
}

function shipCard(s) {
  const cargo = s.qty > 0 ? `<span class="tag ${GOOD_NAMES[s.good]}">${s.qty} ${GOOD_NAMES[s.good]}</span>` : `<span class="tag">empty</span>`;
  if (s.dest !== null) {
    return `<div class="shipCard"><div class="top"><b>Ship ${s.id}</b>${cargo}</div>
      <div class="quiet">Sailing to ${esc(world.ports[s.dest].name)}, arrives in ${hoursLeft(s)} h</div></div>`;
  }
  const port = world.ports[s.port];
  const matching = world.orders.filter(o => o.port === s.port && o.good === s.good && o.owner !== me.id);
  const dests = world.ports.filter(p => p.id !== s.port).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="shipCard" data-ship="${s.id}">
    <div class="top"><b>Ship ${s.id}</b>${cargo}</div>
    <div class="quiet">Docked at ${esc(port.name)}</div>
    ${s.qty > 0 ? `<div class="row"><button data-act="sell" data-ship="${s.id}">Sell to market at ${port.prices[s.good].toFixed(2)}</button>
      ${matching.map(o => `<button class="secondary" data-act="fill" data-ship="${s.id}" data-order="${o.id}">Fill ${esc(o.ownerName)}'s order at ${o.price.toFixed(2)}</button>`).join("")}</div>` : ""}
    <label>Destination<select data-field="dest">${dests.map(p => `<option value="${p.id}">${esc(p.name)} (≈${Math.ceil(distance(s.port, p.id) / world.rules.speed)} h)</option>`).join("")}</select></label>
    ${s.qty === 0 ? `<div class="row" style="margin-top:4px">
      <select data-field="good" style="width:auto"><option value="">Sail empty</option>${GOOD_NAMES.map((g, i) => `<option value="${g}">Load ${g} at ${port.prices[i].toFixed(2)}</option>`).join("")}</select>
      <input data-field="qty" type="number" min="1" max="${world.rules.capacity}" value="${world.rules.capacity}" style="width:90px"></div>` : ""}
    <div class="est" data-field="estimate"></div>
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
  if (g >= 0 && qty > 0) {
    const buy = s.qty > 0 ? 0 : qty * here.prices[g] * (1 + world.rules.tax);
    const sell = qty * there.prices[g] * (1 - world.rules.tax);
    const profit = sell - buy - fuel - world.rules.portFee;
    text += ` At today's prices this trip ${profit >= 0 ? "makes" : "loses"} <b class="${profit >= 0 ? "pos" : "neg"}">${fmt(Math.abs(profit))}</b>. ${fmt(there.inbound[g])} ${GOOD_NAMES[g]} is already heading there.`;
  }
  card.querySelector("[data-field=estimate]").innerHTML = text;
}

function fleetPanel() {
  if (!me) return `<div class="quiet">Log in to see your fleet.</div>`;
  return `<h2>${esc(me.name)}</h2>
    <div class="quiet">${me.ships.length} of ${world.rules.maxShips} ships. Every ship after the first costs ${fmt(world.rules.upkeep)} a day.</div>
    <h3>Ships</h3>${me.ships.map(shipCard).join("")}`;
}

function ordersPanel() {
  const mine = me ? world.orders.filter(o => o.owner === me.id) : [];
  const others = world.orders.filter(o => !me || o.owner !== me.id);
  const b = world.rules.bands;
  return `<h2>Buy orders</h2>
    <div class="quiet">Post a price you'll pay for goods delivered to a port. Your cash is held until the order is filled or cancelled.</div>
    ${me ? `<h3>Post an order</h3>
    <div class="row"><select id="oPort">${world.ports.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${p.id}" ${p.id === selectedPort ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
    <div class="row"><select id="oGood" style="width:auto">${GOOD_NAMES.map(g => `<option>${g}</option>`).join("")}</select>
      <input id="oQty" type="number" min="1" max="1000" value="100" style="width:90px" title="Quantity">
      <input id="oPrice" type="number" step="0.5" value="30" style="width:90px" title="Price per unit">
      <button data-act="placeOrder">Post</button></div>
    <div class="est">Grain ${b.grain.floor}–${b.grain.ceiling}, fuel ${b.fuel.floor}–${b.fuel.ceiling} per unit.</div>` : ""}
    <h3>Your orders</h3>
    ${mine.length ? `<table>${mine.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td>${GOOD_NAMES[o.good]}</td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td><td><button class="link" data-act="cancelOrder" data-order="${o.id}">Cancel</button></td></tr>`).join("")}</table>` : `<div class="quiet">None.</div>`}
    <h3>All open orders</h3>
    ${others.length ? `<table><tr><th>Port</th><th>Good</th><th class="num">Qty</th><th class="num">Price</th></tr>${others.map(o => `<tr><td>${esc(world.ports[o.port].name)}</td><td>${GOOD_NAMES[o.good]}</td><td class="num">${o.qty}</td><td class="num">${o.price.toFixed(2)}</td></tr>`).join("")}</table>` : `<div class="quiet">No open orders.</div>`}`;
}

function boardPanel() {
  return `<h2>Leaderboard</h2><div class="quiet">Ranked by net worth: cash, half the value of ships, cargo and open orders. Companies marked bot are computer traders that keep the markets moving.</div>
    <h3>Top companies</h3>
    <table><tr><th>#</th><th>Company</th><th class="num">Ships</th><th class="num">Net worth</th></tr>
    ${world.leaderboard.map((c, i) => `<tr${me && c.id === me.id ? ' style="color:var(--mine)"' : ""}><td>${i + 1}</td><td>${esc(c.name)}${c.bot ? ' <span class="tag">bot</span>' : ""}</td><td class="num">${c.ships}</td><td class="num">${fmt(c.worth)}</td></tr>`).join("")}</table>`;
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

window.addEventListener("resize", drawMap);
connect();
