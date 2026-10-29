// Manifest game server: HTTP for the client files and admin API, WebSockets for play,
// SQLite (built into Node) for accounts and the append-only event log.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Engine, GOODS, type Command } from "./engine.js";
import { runBots, botName, isBot } from "./bots.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUBLIC = join(HERE, "..", "public");
const PORT = Number(process.env.PORT ?? 8080);
const TICK_MS = Number(process.env.TICK_MS ?? 3_600_000);   // 1 game hour = 1 real hour by default
const BOTS = Number(process.env.BOTS ?? 30);   // bot companies kept in the world
// Market size for the season, set from how many companies you expect (players + bots).
const EXPECTED = Number(process.env.EXPECTED_COMPANIES ?? 60);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";
const DB_PATH = process.env.DB_PATH ?? join(ROOT, "data", "manifest.db");

const rules = JSON.parse(readFileSync(join(ROOT, "config", "rules.json"), "utf8"));
const map = JSON.parse(readFileSync(join(ROOT, rules.map.file), "utf8"));

// ------------------------------------------------------------ storage + replay

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS accounts (name TEXT PRIMARY KEY COLLATE NOCASE, salt TEXT NOT NULL, hash TEXT NOT NULL, company INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, ended TEXT NOT NULL, results TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS archived_events (season INTEGER NOT NULL, id INTEGER NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, company INTEGER NOT NULL, created TEXT NOT NULL);
`);
const insertEvent = db.prepare("INSERT INTO events (at, kind, payload) VALUES (?, ?, ?)");

let engine = new Engine(rules, map, EXPECTED);
let replayed = 0;
for (const row of db.prepare("SELECT kind, payload FROM events ORDER BY id").all() as { kind: string; payload: string }[]) {
  if (row.kind === "tick") engine.advance();
  else engine.apply(JSON.parse(row.payload) as Command);
  replayed++;
}
console.log(`Replayed ${replayed} events; game is at day ${engine.metrics().day}, hour ${engine.tick % 24}; market scale ${engine.scale.toFixed(2)} for ${EXPECTED} expected companies`);

let botIds: number[] = [];
function ensureBots() {
  botIds = [...engine.companies.values()].filter(c => isBot(c.name)).map(c => c.id);
  for (let i = botIds.length; i < BOTS && !engine.seasonOver; i++) {
    const r = commit({ type: "register", name: botName(i), startPort: randomInt(engine.n) });
    if (r.ok) botIds.push(r.id!);
  }
}
ensureBots();

function commit(cmd: Command) {
  const res = engine.apply(cmd);
  if (res.ok) insertEvent.run(new Date().toISOString(), cmd.type, JSON.stringify(cmd));
  return res;
}

// ------------------------------------------------------------ accounts

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}

function register(name: string, password: string): { token: string } | { error: string } {
  name = String(name ?? "").trim();
  if (!/^[A-Za-z0-9 _.-]{3,24}$/.test(name)) return { error: "Company name must be 3-24 letters, numbers or spaces" };
  if (String(password ?? "").length < 8) return { error: "Password must be at least 8 characters" };
  if (db.prepare("SELECT 1 FROM accounts WHERE name = ?").get(name)) return { error: "That name is taken" };
  const res = commit({ type: "register", name, startPort: randomInt(engine.n) });
  if (!res.ok) return { error: res.error };
  const salt = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO accounts (name, salt, hash, company) VALUES (?, ?, ?, ?)").run(name, salt, hashPassword(password, salt), res.id!);
  return { token: newSession(res.id!) };
}

function login(name: string, password: string): { token: string } | { error: string } {
  const row = db.prepare("SELECT salt, hash, company FROM accounts WHERE name = ?").get(String(name ?? "")) as
    { salt: string; hash: string; company: number } | undefined;
  if (!row) return { error: "Wrong name or password" };
  const a = Buffer.from(hashPassword(String(password ?? ""), row.salt), "hex"), b = Buffer.from(row.hash, "hex");
  if (!timingSafeEqual(a, b)) return { error: "Wrong name or password" };
  return { token: newSession(row.company) };
}

function newSession(company: number) {
  const token = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, company, created) VALUES (?, ?, ?)").run(token, company, new Date().toISOString());
  return token;
}

function companyForToken(token: string): number | undefined {
  const row = db.prepare("SELECT company FROM sessions WHERE token = ?").get(String(token ?? "")) as { company: number } | undefined;
  return row?.company;
}

// ------------------------------------------------------------ views

function publicView() {
  const inbound = engine.inbound();
  return {
    tick: engine.tick,
    tickMs: TICK_MS,
    goods: GOODS,
    rules: {
      shipPrice: engine.rules.ship.price, capacity: engine.rules.ship.capacity, speed: engine.rules.ship.speed_per_hour,
      fuelPer100: engine.rules.ship.fuel_per_100_distance, upkeep: engine.rules.ship.upkeep_per_day,
      tax: engine.rules.fees.trade_tax_rate, portFee: engine.rules.fees.port_fee_per_docking,
      maxShips: engine.rules.company.max_ships, bands: engine.rules.commodities,
    },
    ports: map.ports.map((p: any, i: number) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, produces: p.produces, consumes: p.consumes,
      prices: [0, 1].map(g => round2(engine.price(i, g))),
      stock: engine.stock[i].map(Math.round),
      inbound: inbound.cargo[i].map(Math.round),
      emptyInbound: inbound.emptyShips[i],
    })),
    routes: map.routes,
    ships: [...engine.ships.values()].map(s => ({
      id: s.id, owner: s.owner, port: s.port, dest: s.dest, departTick: s.departTick, arriveTick: s.arriveTick,
      good: s.good, qty: Math.round(s.qty),
    })),
    orders: [...engine.orders.values()].map(o => ({ ...o, ownerName: engine.companies.get(o.owner)?.name })),
    seasonHours: engine.seasonHours,
    seasonOver: engine.seasonOver,
    leaderboard: [...engine.companies.values()]
      .map(c => ({ id: c.id, name: c.name, bot: isBot(c.name), worth: Math.round(engine.netWorth(c)), ships: c.ships.length }))
      .sort((a, b) => b.worth - a.worth).slice(0, 20),
  };
}

function privateView(company: number) {
  const c = engine.companies.get(company);
  if (!c) return null;
  return {
    id: c.id, name: c.name, cash: Math.round(c.cash), worth: Math.round(engine.netWorth(c)),
    ships: c.ships.map(id => { const s = engine.ships.get(id)!; return { ...s, cost: Math.round(s.cost) }; }),
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ------------------------------------------------------------ http

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function isAdmin(req: IncomingMessage) {
  const given = String(req.headers["x-admin-token"] ?? "");
  return ADMIN_TOKEN.length >= 16 && given.length === ADMIN_TOKEN.length && timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_TOKEN));
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/health") return json(res, 200, { ok: true, tick: engine.tick });
  if (url.pathname === "/api/admin/metrics") {
    if (!isAdmin(req)) return json(res, 403, { error: "admin token required" });
    return json(res, 200, engine.metrics());
  }
  if (url.pathname === "/api/admin/set" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 403, { error: "admin token required" });
    let body = "";
    req.on("data", d => { body += d; if (body.length > 10_000) req.destroy(); });
    req.on("end", () => {
      try {
        const { tax, upkeep, portFee } = JSON.parse(body || "{}");
        const r = commit({ type: "adminSet", tax, upkeep, portFee });
        broadcastSoon();
        json(res, r.ok ? 200 : 400, r);
      } catch { json(res, 400, { error: "bad json" }); }
    });
    return;
  }
  if (url.pathname === "/api/admin/new-season" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 403, { error: "admin token required" });
    return json(res, 200, newSeason());
  }
  // Static files
  let path = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname;
  path = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, path);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});

// ------------------------------------------------------------ websockets

interface Client { ws: WebSocket; company?: number; recent: number[] }
const clients = new Set<Client>();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", ws => {
  const client: Client = { ws, recent: [] };
  clients.add(client);
  send(client, { type: "static", dist: engine.dist.map(r => r.map(d => Math.round(d))) });
  send(client, { type: "state", world: publicView(), me: null });
  ws.on("close", () => clients.delete(client));
  ws.on("message", raw => {
    const now = Date.now();
    client.recent = client.recent.filter(t => now - t < 1000);
    if (client.recent.length >= 10) return send(client, { type: "error", error: "Slow down" });
    client.recent.push(now);
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }

    if (msg.type === "register" || msg.type === "login") {
      const r = msg.type === "register" ? register(msg.name, msg.password) : login(msg.name, msg.password);
      if ("error" in r) return send(client, { type: "authError", error: r.error });
      client.company = companyForToken(r.token);
      send(client, { type: "auth", token: r.token });
      if (msg.type === "register") broadcastSoon(); else sendState(client);
      return;
    }
    if (msg.type === "resume") {
      client.company = companyForToken(msg.token);
      if (!client.company) return send(client, { type: "authError", error: "Session expired, please log in" });
      return sendState(client);
    }
    if (msg.type === "cmd") {
      if (!client.company) return send(client, { type: "result", reqId: msg.reqId, ok: false, error: "Log in first" });
      const allowed = ["sail", "sell", "buyShip", "scrapShip", "placeOrder", "placeSell", "buyFromOrder", "cancelOrder"];
      if (!msg.cmd || !allowed.includes(msg.cmd.type)) return send(client, { type: "result", reqId: msg.reqId, ok: false, error: "Unknown command" });
      const cmd = { ...msg.cmd, company: client.company } as Command;  // never trust a company id from the client
      const r = commit(cmd);
      send(client, { type: "result", reqId: msg.reqId, ...r });
      if (r.ok) broadcastSoon();
    }
  });
});

function send(c: Client, msg: unknown) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}
function sendState(c: Client, world = publicView()) {
  send(c, { type: "state", world, me: c.company ? privateView(c.company) : null });
}
let pending: NodeJS.Timeout | null = null;
function broadcastSoon() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const world = publicView();
    for (const c of clients) sendState(c, world);
  }, 150);
}

// ------------------------------------------------------------ seasons

function finalStandings() {
  return [...engine.companies.values()]
    .map(c => ({ name: c.name, bot: isBot(c.name), worth: Math.round(engine.netWorth(c)) }))
    .sort((a, b) => b.worth - a.worth);
}

/** Archive this season, then start a fresh world. Accounts carry over with new companies. */
function newSeason() {
  const seasonId = Number((db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM seasons").get() as { n: number }).n);
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO seasons (id, ended, results) VALUES (?, ?, ?)").run(seasonId, new Date().toISOString(), JSON.stringify(finalStandings()));
    db.prepare("INSERT INTO archived_events SELECT ?, id, at, kind, payload FROM events").run(seasonId);
    db.exec("DELETE FROM events; DELETE FROM sessions;");
    engine = new Engine(rules, map, EXPECTED);
    const accounts = db.prepare("SELECT name FROM accounts ORDER BY rowid").all() as { name: string }[];
    const update = db.prepare("UPDATE accounts SET company = ? WHERE name = ?");
    for (const a of accounts) {
      const r = commit({ type: "register", name: a.name, startPort: randomInt(engine.n) });
      if (r.ok) update.run(r.id!, a.name);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  ensureBots();
  for (const c of clients) { c.company = undefined; send(c, { type: "authError", error: "A new season has started. Log in again." }); }
  broadcastSoon();
  return { ok: true, season: seasonId + 1 };
}

// ------------------------------------------------------------ clock

let lastSeasonOver = engine.seasonOver;
setInterval(() => {
  if (!engine.seasonOver) {
    engine.advance();
    insertEvent.run(new Date().toISOString(), "tick", "{}");
    runBots(engine, botIds, commit);
  }
  if (engine.seasonOver && !lastSeasonOver) console.log("Season over. Final standings:", finalStandings().slice(0, 5));
  lastSeasonOver = engine.seasonOver;
  broadcastSoon();
}, TICK_MS);

server.listen(PORT, () => console.log(`Manifest running on http://localhost:${PORT} (tick every ${TICK_MS} ms)`));
