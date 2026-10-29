// Manifest game server: HTTP for the client files and admin API, WebSockets for play,
// SQLite (built into Node) for accounts and the append-only event log.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join, dirname, extname, normalize, sep } from "node:path";
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
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30);   // log in again after this
const LOGIN_FAILS = Number(process.env.LOGIN_FAILS ?? 10);     // failed logins per address per 15 minutes
const SIGNUPS = Number(process.env.SIGNUPS_PER_HOUR ?? 10);    // new companies per address per hour
// Behind Caddy or another proxy, the player's address is the last X-Forwarded-For entry.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
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

// Recent hourly prices for the client's trend lines. Not stored: rebuilt while replaying the log.
const HISTORY_HOURS = 72;
let history: { tick: number; prices: number[][] }[] = [];
function recordPrices() {
  const prices = engine.stock.map((_, p) => [0, 1].map(g => Math.round(engine.price(p, g) * 100) / 100));
  if (history.at(-1)?.tick === engine.tick) history.pop();
  history.push({ tick: engine.tick, prices });
  if (history.length > HISTORY_HOURS) history.shift();
}
recordPrices();

let replayed = 0;
for (const row of db.prepare("SELECT kind, payload FROM events ORDER BY id").all() as { kind: string; payload: string }[]) {
  if (row.kind === "tick") { engine.advance(); recordPrices(); }
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
  const row = db.prepare("SELECT company, created FROM sessions WHERE token = ?").get(String(token ?? "")) as { company: number; created: string } | undefined;
  if (!row) return undefined;
  if (Date.now() - Date.parse(row.created) > SESSION_DAYS * 86_400_000) { endSession(token); return undefined; }
  return row.company;
}

function endSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(String(token ?? ""));
}

/** Counts events per address in a sliding window, to slow down password guessing and sign-up spam. */
class Limiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  private recent(key: string) {
    const now = Date.now(), list = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  blocked(key: string) { return this.recent(key).length >= this.max; }
  /** Minutes until the oldest hit leaves the window. */
  wait(key: string) { const l = this.recent(key); return l.length ? Math.ceil((this.windowMs - (Date.now() - l[0])) / 60_000) : 0; }
  hit(key: string) { const l = this.recent(key); l.push(Date.now()); this.hits.set(key, l); }
}
const failedLogins = new Limiter(LOGIN_FAILS, 15 * 60_000);
const signups = new Limiter(SIGNUPS, 60 * 60_000);

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
  // One bad request must never take the game down.
  try { handle(req, res); } catch (e) {
    console.error("request failed:", req.url, e);
    if (!res.headersSent) json(res, 500, { error: "server error" }); else res.end();
  }
});

function handle(req: IncomingMessage, res: ServerResponse) {
  let url: URL;
  try { url = new URL(req.url ?? "/", "http://x"); } catch { return json(res, 400, { error: "bad url" }); }
  if (url.pathname === "/api/health") return json(res, 200, { ok: true, tick: engine.tick });
  if (url.pathname === "/api/seasons") {
    const rows = db.prepare("SELECT id, ended, results FROM seasons ORDER BY id DESC").all() as { id: number; ended: string; results: string }[];
    return json(res, 200, rows.map(r => ({ id: r.id, ended: r.ended, top: (JSON.parse(r.results) as unknown[]).slice(0, 10) })));
  }
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
        const parsed = JSON.parse(body || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(res, 400, { error: "send a JSON object" });
        const { tax, upkeep, portFee } = parsed;
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
  let path = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname === "/seasons" ? "/seasons.html" : url.pathname;
  path = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, path);
  // Only plain files inside public/ (a directory like "//" used to crash the server).
  if (!file.startsWith(PUBLIC + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

// ------------------------------------------------------------ websockets

interface Client { ws: WebSocket; ip: string; company?: number; token?: string; recent: number[] }
const clients = new Set<Client>();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", (ws, req) => {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",").pop()!.trim() : "";
  const client: Client = { ws, ip: forwarded || req.socket.remoteAddress || "?", recent: [] };
  clients.add(client);
  send(client, { type: "static", dist: engine.dist.map(r => r.map(d => Math.round(d))) });
  send(client, { type: "history", history });
  send(client, { type: "state", world: publicView(), me: null });
  ws.on("close", () => clients.delete(client));
  // Without this, an oversized or broken frame throws and kills the whole server.
  ws.on("error", () => ws.terminate());
  ws.on("message", raw => {
    const now = Date.now();
    client.recent = client.recent.filter(t => now - t < 1000);
    if (client.recent.length >= 10) return send(client, { type: "error", error: "Slow down" });
    client.recent.push(now);
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    try { onMessage(client, msg); } catch (e) {
      console.error("message failed:", e);
      send(client, { type: "error", error: "Something went wrong" });
    }
  });
});

function onMessage(client: Client, msg: any) {
  if (msg.type === "register" || msg.type === "login") {
    const limiter = msg.type === "register" ? signups : failedLogins;
    if (limiter.blocked(client.ip)) {
      const what = msg.type === "register" ? "Too many new companies" : "Too many failed log-ins";
      return send(client, { type: "authError", error: `${what} from your connection. Try again in ${limiter.wait(client.ip)} minutes.` });
    }
    const r = msg.type === "register" ? register(msg.name, msg.password) : login(msg.name, msg.password);
    if (msg.type === "register" ? !("error" in r) : "error" in r) limiter.hit(client.ip);
    if ("error" in r) return send(client, { type: "authError", error: r.error });
    client.company = companyForToken(r.token);
    client.token = r.token;
    send(client, { type: "auth", token: r.token });
    if (msg.type === "register") broadcastSoon(); else sendState(client);
    return;
  }
  if (msg.type === "resume") {
    client.company = companyForToken(msg.token);
    if (!client.company) return send(client, { type: "authError", error: "Session expired, please log in" });
    client.token = String(msg.token);
    return sendState(client);
  }
  if (msg.type === "logout") {
    // Ends this session everywhere: the saved token stops working.
    if (client.token) endSession(client.token);
    client.company = client.token = undefined;
    send(client, { type: "loggedOut" });
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
}

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
    history = [];
    recordPrices();
    const accounts = db.prepare("SELECT name FROM accounts ORDER BY rowid").all() as { name: string }[];
    const update = db.prepare("UPDATE accounts SET company = ? WHERE name = ?");
    for (const a of accounts) {
      const r = commit({ type: "register", name: a.name, startPort: randomInt(engine.n) });
      if (r.ok) update.run(r.id!, a.name);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  ensureBots();
  for (const c of clients) {
    c.company = c.token = undefined;
    send(c, { type: "history", history });
    send(c, { type: "authError", error: "A new season has started. Log in again." });
  }
  broadcastSoon();
  return { ok: true, season: seasonId + 1 };
}

// ------------------------------------------------------------ clock

let lastSeasonOver = engine.seasonOver;
setInterval(() => {
  if (!engine.seasonOver) {
    engine.advance();
    insertEvent.run(new Date().toISOString(), "tick", "{}");
    recordPrices();
    runBots(engine, botIds, commit);
  }
  if (engine.seasonOver && !lastSeasonOver) console.log("Season over. Final standings:", finalStandings().slice(0, 5));
  lastSeasonOver = engine.seasonOver;
  broadcastSoon();
}, TICK_MS);

server.listen(PORT, () => {
  const port = (server.address() as { port: number }).port;   // PORT=0 picks a free port (used by tests)
  console.log(`Manifest running on http://localhost:${port} (tick every ${TICK_MS} ms)`);
});
