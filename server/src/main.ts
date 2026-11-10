// Manifest game server: HTTP for the client files and admin API, WebSockets for play,
// SQLite (built into Node) for accounts and the append-only event log.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual, randomInt } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Engine, GOODS, SHIP_TYPES, type Command } from "./engine.js";
import { runBots, botName, isBot } from "./bots.js";
import { pickHome } from "./homes.js";
import { runPirateBots } from "./piratebots.js";
import { addCoasts, type CoastDirection } from "./coasts.js";
import { type NavigationMap } from "./navigation.js";
import { generateRandomSeason, type RandomSeasonMap } from "./random-season.js";
import { recoveryView } from "./recovery.js";
import { SeasonLeaderboards } from "./leaderboards.js";
import { EXPANSION_SCENARIOS, type ExpansionScenario } from "./scenario-expansion.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PUBLIC = join(HERE, "..", "public");
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST || undefined;
const DEBUG_CREDITS = process.env.DEBUG_CREDITS === "1" && HOST === "127.0.0.1";
const TICK_MS = Number(process.env.TICK_MS ?? 3_600_000);   // 1 game hour = 1 real hour by default
const BOTS = Number(process.env.BOTS ?? 30);   // bot companies kept in the world
// Market size for the season, set from how many companies you expect (players + bots).
const EXPECTED = Number(process.env.EXPECTED_COMPANIES ?? 60);
// Difficulty for new seasons (easy, normal or hard); the admin page can change it at any time.
const DIFFICULTY = process.env.DIFFICULTY;
const EXPANSION = process.env.GAMEPLAY_EXPANSION !== "0";
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
  CREATE TABLE IF NOT EXISTS port_coasts (
    port_id INTEGER PRIMARY KEY, dx REAL NOT NULL, dy REAL NOT NULL,
    CHECK (dx*dx + dy*dy > 0.000001)
  );
  CREATE TABLE IF NOT EXISTS world_map (id INTEGER PRIMARY KEY CHECK(id=1), map_json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS archived_maps (season INTEGER PRIMARY KEY, map_json TEXT NOT NULL);
`);
const coastRows = db.prepare("SELECT port_id, dx, dy FROM port_coasts").all();
const coastOverrides = new Map<number, CoastDirection>(coastRows.map(row => [
  Number(row.port_id), { dx: Number(row.dx), dy: Number(row.dy) }
]));
const coastalPorts = addCoasts(map.ports, map.routes, coastOverrides);
const configuredMap = { ...map, ports: coastalPorts };
async function createSeasonMap(season:number) {
  return generateRandomSeason({
    seed: process.env.MAP_SEED === undefined ? undefined : `${process.env.MAP_SEED}:season:${season}`,
    // Defaults (2000 x 1400 archipelago, 5 land masses + 3 islands, minPortDistance 112) live in map-generation-pipeline.ts.
    settings: process.env.MAP_MIN_PORT_DISTANCE === undefined ? {} : { minPortDistance: Number(process.env.MAP_MIN_PORT_DISTANCE) },
    maxAttempts: Number(process.env.MAP_MAX_ATTEMPTS ?? 128),
    names: map.ports.map((p:any)=>p.name),
  });
}
const savedMap = db.prepare("SELECT map_json FROM world_map WHERE id=1").get() as {map_json:string}|undefined;
let activeMap:NavigationMap;
if(savedMap) activeMap=JSON.parse(savedMap.map_json);
else {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM events").get() as {n:number};
  // Existing event logs retain their original distances until a new season.
  activeMap=existing.n ? {...configuredMap,navigationId:'legacy-v1'} : await createSeasonMap(1);
  db.prepare("INSERT INTO world_map(id,map_json) VALUES(1,?)").run(JSON.stringify(activeMap));
}
const insertEvent = db.prepare("INSERT INTO events (at, kind, payload) VALUES (?, ?, ?)");

let engine = new Engine(rules, activeMap, EXPECTED);
let leaderboards = new SeasonLeaderboards(engine);

// Recent hourly prices for the client's trend lines. Not stored: rebuilt while replaying the log.
const HISTORY_HOURS = 72;
let history: { tick: number; prices: number[][] }[] = [];
function recordPrices() {
  const prices = engine.stock.map((_, p) => GOODS.map((_, g) => Math.round(engine.price(p, g) * 100) / 100));
  if (history.at(-1)?.tick === engine.tick) history.pop();
  history.push({ tick: engine.tick, prices });
  if (history.length > HISTORY_HOURS) history.shift();
}
recordPrices();

let replayed = 0;
for (const row of db.prepare("SELECT kind, payload FROM events ORDER BY id").all() as { kind: string; payload: string }[]) {
  if (row.kind === "tick") { leaderboards.advance(); recordPrices(); }
  else if (engine.apply(JSON.parse(row.payload) as Command).ok) leaderboards.observe();
  replayed++;
}
console.log(`Replayed ${replayed} events; game is at day ${engine.metrics().day}, hour ${engine.tick % 24}; market scale ${engine.scale.toFixed(2)} for ${EXPECTED} expected companies`);
if ('generation' in activeMap) {
  console.log(`Map seed: ${JSON.stringify((activeMap as RandomSeasonMap).generation.seed)}; map ${activeMap.navigationId}`);
}

// A brand-new world starts at the chosen difficulty (recorded in the log like any admin change).
if (replayed === 0 && DIFFICULTY) startDifficulty();
if (!engine.maritime.enabled && !engine.seasonOver) commit({ type: "activateMaritimeRules" });
if (EXPANSION && !engine.expansionEnabled && !engine.seasonOver) commit({ type: "activateExpansion" });
function startDifficulty() {
  if (!DIFFICULTY) return;
  const r = commit({ type: "setDifficulty", level: DIFFICULTY });
  if (!r.ok) console.error(`DIFFICULTY=${DIFFICULTY} ignored: ${r.error}`);
}

/** The difficulty a new season starts on: the DIFFICULTY env if it names a preset, else the rules' default. */
function nextSeasonDifficulty(): string {
  const presets = rules.difficulty?.presets ?? {};
  return DIFFICULTY && Object.hasOwn(presets, DIFFICULTY) ? DIFFICULTY : rules.difficulty?.default ?? "normal";
}

let botIds: number[] = [];
function ensureBots() {
  botIds = [...engine.companies.values()].filter(c => isBot(c.name)).map(c => c.id);
  for (let i = botIds.length; i < BOTS && !engine.seasonOver; i++) {
    const r = commit({ type: "register", name: botName(i), startPort: pickHome(engine, randomInt) });
    if (r.ok) botIds.push(r.id!);
  }
}
ensureBots();

function commit(cmd: Command) {
  const res = engine.applyLive(cmd);
  if (res.ok) {
    insertEvent.run(new Date().toISOString(), cmd.type, JSON.stringify(cmd));
    leaderboards.observe();
  }
  return res;
}

// ------------------------------------------------------------ accounts

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}

function register(name: string, password: string): { token: string } | { error: string } {
  name = String(name ?? "").trim();
  if (!/^[A-Za-z0-9 _.-]{3,24}$/.test(name)) return { error: "Company name must be 3-24 letters, numbers, spaces, dots, dashes or underscores" };
  if (!/[A-Za-z0-9]/.test(name)) return { error: "Company name needs at least one letter or number" };
  // Pages collapse runs of spaces, so "Acme  Freight" would look exactly like "Acme Freight".
  if (/  /.test(name)) return { error: "Company name can't have two spaces in a row" };
  if (String(password ?? "").length < 8) return { error: "Password must be at least 8 characters" };
  if (db.prepare("SELECT 1 FROM accounts WHERE name = ?").get(name)) return { error: "That name is taken" };
  const res = commit({ type: "register", name, startPort: pickHome(engine, randomInt) });
  if (!res.ok) return { error: res.error };
  const salt = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO accounts (name, salt, hash, company) VALUES (?, ?, ?, ?)").run(name, salt, hashPassword(password, salt), res.id!);
  return { token: newSession(res.id!) };
}

function login(name: string, password: string): { token: string } | { error: string } {
  // Sign-up trims the name, so log-in must too (phone keyboards often add a trailing space).
  const row = db.prepare("SELECT salt, hash, company FROM accounts WHERE name = ?").get(String(name ?? "").trim()) as
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
  const boards = leaderboards.publicBoards();
  const inbound = engine.inbound();
  const homes = activeMap.ports.map(() => 0);
  for (const c of engine.companies.values()) homes[c.home]++;
  return {
    tick: engine.tick,
    tickMs: TICK_MS,
    mapSeed: activeMap.seed ?? 7,
    navigationId: activeMap.navigationId,
    goods: GOODS,
    rules: {
      shipPrice: engine.rules.ship.price, capacity: engine.rules.ship.capacity, speed: engine.rules.ship.speed_per_hour,
      fuelPer100: engine.rules.ship.fuel_per_100_distance, upkeep: engine.rules.ship.upkeep_per_day,
      tax: engine.rules.fees.trade_tax_rate, portFee: engine.rules.fees.port_fee_per_docking,
      maxShips: engine.rules.company.max_ships, bands: engine.rules.commodities,
      target: engine.target, targets: engine.targets, difficulty: engine.difficulty,
      shipTypes: Object.fromEntries(SHIP_TYPES.filter(t => t !== "pirate" || engine.piratesOn).map(t => [t, engine.spec(t)])),
      pirates: engine.piratesOn ? { enabled: true, homeOnly: engine.rules.pirates!.buy_at_home_only !== false, protectOnlyShip: engine.rules.pirates!.protect_only_ship !== false, failedRaidCost: engine.rules.pirates!.failed_raid_cost, range: engine.rules.pirates!.range, cooldownHours: engine.rules.pirates!.cooldown_hours, homeSafeRadius: engine.rules.pirates!.home_safe_radius, notorietyMax: engine.rules.pirates!.notoriety.max, fineBelow: engine.rules.police!.fine_below, lockoutBelow: engine.rules.police!.lockout_below, lockoutHours: engine.rules.police!.lockout_hours } : { enabled: false },
    },
    ports: activeMap.ports.map((p: any, i: number) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, produces: p.produces, consumes: p.consumes,
      coastDirection: p.coastDirection,
      prices: GOODS.map((_, g) => round2(engine.price(i, g))),
      stock: engine.stock[i].map(Math.round),
      inbound: inbound.cargo[i].map(Math.round),
      emptyInbound: inbound.emptyShips[i],
      outlook: engine.marketOutlook(i),
      homes: homes[i],   // how many companies have this as their home port
      harborLevel: engine.maritime.harborLevel(i),
    })),
    police: engine.police.ships.map(p => ({ id: p.id, port: p.port, dest: p.dest, departTick: p.departTick, arriveTick: p.arriveTick })),
    opportunityMarkers: engine.expansionEnabled ? [...engine.piracyExpansion.markers(), ...engine.explorationExpansion.markers()] : [],
    routes: activeMap.routes.map(({a,b,distance})=>({a,b,distance})),
    ships: [...engine.ships.values()].map(s => ({
      id: s.id, owner: s.owner, port: s.port, type: s.type, dest: s.dest, departTick: s.departTick, arriveTick: s.arriveTick,
      good: s.good, qty: Math.round(s.qty),
      convoyPrize: engine.maritime.convoyPrize(s) || undefined,
    })),
    orders: [...engine.orders.values()].map(o => ({ ...o, ownerName: engine.companies.get(o.owner)?.name })),
    seasonHours: engine.seasonHours,
    seasonOver: engine.seasonOver,
    leaderboard: boards[0].rows,
    fleetLeaderboards: ["0", "1", "2"].map(id => boards.find(board => board.id === id)!.rows),
    boards,
    weeklyLeaders: leaderboards.weekly,
  };
}

function privateView(company: number) {
  const c = engine.companies.get(company);
  if (!c) return null;
  const worth = Math.round(engine.netWorth(c));
  const placements = leaderboards.placements(c.id);
  const division = ["0", "1", "2"].find(id => placements[id])!;

  return {
    id: c.id, name: c.name, cash: Math.round(c.cash), worth, home: c.home,
    recovery: recoveryView(engine, company),
    debugCredits: DEBUG_CREDITS && !engine.seasonOver,
    maritime: engine.maritime.view(c),
    expansion: engine.expansionEnabled ? {
      ports: engine.portExpansion.cards(c.id),
      trade: engine.tradeExpansion.cards(c.id),
      piracy: engine.piracyExpansion.cards(c.id),
      exploration: engine.explorationExpansion.cards(c.id),
      fleet: engine.fleetExpansion.cards(c.id),
      season: engine.scenarioExpansion.cards(c.id),
    } : undefined,
    upkeepDue: engine.upkeepDue(c),
    maritimeAssets: engine.maritime.assets(c),
    dockingFees: Object.fromEntries([...new Set(c.ships.map(id => engine.ships.get(id)!)
      .filter(ship => ship.dest === null).map(ship => ship.port))]
      .map(from => [from, activeMap.ports.map(port => round2(engine.maritime.fee(c, from, port.id)))])),
    // A pirate ship also carries what it can raid right now (worked out by the server) and how long it must lie low.
    ships: c.ships.map(id => {
      const s = engine.ships.get(id)!;
      const pirate = s.type === "pirate" && engine.piratesOn;
      return {
        ...s, cost: Math.round(s.cost), capacity: engine.expansionCapacity(s), guildFreight: engine.guildFreight.view(c, s),
        voyageQueue: engine.voyageQueues.get(id)?.company === c.id ? engine.voyageQueues.get(id) : undefined,
        ...(pirate ? { raidReadyIn: Math.max(0, (engine.piracy.cooldown.get(s.id) ?? 0) - engine.tick),
          raidTargets: s.dest === null ? [] : engine.piracy.targetsFor(s, true) } : {}),
      };
    }),
    notoriety: Math.round(engine.piracy.notorietyOf(c.id)),
    lockedOutHours: engine.piracy.lockoutHours(c.id),
    notices: engine.piracy.notices.get(c.id) ?? [],
    // Your place on the leaderboard even outside the top 20, out of all companies.
    // Compared on rounded net worth, as shown, so equal-looking companies share a place.
    division: { id: Number(division), ...placements[division] },
    placements,
    ...placements.all,
    trips: (engine.trips.get(c.id) ?? []).slice(-15).reverse()
      .map(t => ({ ...t, spent: Math.round(t.spent), earned: Math.round(t.earned) })),
    worthLog: engine.worthLog.get(c.id) ?? [],
    forcedSales: (engine.forcedSales.get(c.id) ?? []).map(f => ({ ...f, cashBefore: Math.round(f.cashBefore) })),
    orderFills: (engine.orderFills.get(c.id) ?? []).map(f => ({ ...f, amount: Math.round(f.amount) })),
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
    return json(res, 200, rows.map(r => {
      const saved = JSON.parse(r.results);
      return { id: r.id, ended: r.ended, top: (Array.isArray(saved) ? saved : saved.standings).slice(0, 10),
        ...(Array.isArray(saved) ? {} : { honours: saved.honours }) };
    }));
  }
  if (url.pathname === "/api/admin/metrics") {
    if (!isAdmin(req)) return json(res, 403, { error: "admin token required" });
    return json(res, 200, { ...engine.metrics(), nextSeasonDifficulty: nextSeasonDifficulty() });
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
  if (url.pathname === "/api/admin/difficulty" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 403, { error: "admin token required" });
    let body = "";
    req.on("data", d => { body += d; if (body.length > 1000) req.destroy(); });
    req.on("end", () => {
      try {
        const r = commit({ type: "setDifficulty", level: JSON.parse(body || "{}")?.level });
        broadcastSoon();
        json(res, r.ok ? 200 : 400, r);
      } catch { json(res, 400, { error: "bad json" }); }
    });
    return;
  }
  if (url.pathname === "/api/admin/new-season" && req.method === "POST") {
    if (!isAdmin(req)) return json(res, 403, { error: "admin token required" });
    if (seasonTransition) return json(res,409,{error:'A new season is already being prepared'});
    let body = "";
    req.on("data", chunk => { body += chunk; if (body.length > 1000) req.destroy(); });
    req.on("end", () => {
      let scenario: ExpansionScenario;
      try {
        scenario = JSON.parse(body || "{}")?.scenario ?? "classic";
        if (!EXPANSION_SCENARIOS.includes(scenario) || (!EXPANSION && scenario !== "classic"))
          return json(res, 400, { error: "Choose an available season mode." });
      } catch { return json(res, 400, { error: "Bad JSON." }); }
      if (seasonTransition) return json(res,409,{error:'A new season is already being prepared'});
      void newSeason(scenario).then(result=>json(res,200,result)).catch(error=>{
      console.error('New season generation failed:',error);
      json(res,503,{error:'Map verification failed. The current season has been preserved.'});
      });
    });
    return;
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

interface Client { ws: WebSocket; ip: string; company?: number; token?: string; recent: number[]; quoteRecent: number[]; answered: Map<number, any> }
const clients = new Set<Client>();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });

wss.on("connection", (ws, req) => {
  const forwarded = TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",").pop()!.trim() : "";
  const client: Client = { ws, ip: forwarded || req.socket.remoteAddress || "?", recent: [], quoteRecent: [], answered: new Map() };
  clients.add(client);
  sendStatic(client);
  send(client, { type: "history", history });
  send(client, { type: "state", world: publicView(), me: null });
  ws.on("close", () => clients.delete(client));
  // Without this, an oversized or broken frame throws and kills the whole server.
  ws.on("error", () => ws.terminate());
  ws.on("message", raw => {
    const now = Date.now();
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    // Read-only UI quotes must not exhaust the player's trading-command allowance.
    if (msg.type === "quoteVoyage") {
      client.quoteRecent = client.quoteRecent.filter(t => now - t < 1000);
      if (client.quoteRecent.length >= 10) return send(client, { type: "voyageQuote", reqId: msg.reqId, ok: false, error: "Wait a moment for a fresh quote." });
      client.quoteRecent.push(now);
      try { onMessage(client, msg); } catch { send(client, { type: "voyageQuote", reqId: msg.reqId, ok: false, error: "Choose a valid voyage." }); }
      return;
    }
    client.recent = client.recent.filter(t => now - t < 1000);
    if (client.recent.length >= 10) return send(client, { type: "error", error: "Slow down" });
    client.recent.push(now);
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
    // Other tabs or windows open on the same session are logged out too, or they
    // could keep trading on a session the player has just ended.
    const token = client.token;
    if (token) endSession(token);
    for (const c of clients) {
      if (c !== client && (!token || c.token !== token)) continue;
      c.company = c.token = undefined;
      send(c, { type: "loggedOut" });
      sendState(c);
    }
    return;
  }
  if (msg.type === "quoteVoyage") {
    if (!client.company) return send(client, { type: "voyageQuote", reqId: msg.reqId, ok: false, error: "Log in first" });
    if (!msg.cmd || typeof msg.cmd !== "object") return send(client, { type: "voyageQuote", reqId: msg.reqId, ok: false, error: "Choose a voyage" });
    const cmd = { ...msg.cmd, type: "sail", company: client.company } as Extract<Command, { type: "sail" }>;
    return send(client, { type: "voyageQuote", reqId: msg.reqId, ...engine.voyageQuote(cmd) });
  }
  if (msg.type === "cmd") {
    if (!client.company) return send(client, { type: "result", reqId: msg.reqId, ok: false, error: "Log in first" });
    const allowed = ["sail", "sell", "buyShip", "scrapShip", "placeOrder", "placeSell", "buyFromOrder", "cancelOrder", "raid", "setVoyageQueue",
      "emergencyCredit", "emergencyConsignment", "insureCargo", "bookConvoy", "machineryFuture", "fenceCargo", "fundBounty", "buyPennant",
      "offerEscort", "acceptEscort", "reserveBackhaul", "dispatchGuildBackhaul", "upgradeHarbor", "expansion"];
    if (!msg.cmd || !(allowed.includes(msg.cmd.type) || (DEBUG_CREDITS && msg.cmd.type === "debugCredits")))
      return send(client, { type: "result", reqId: msg.reqId, ok: false, error: "Unknown command" });
    // A request id seen before on this connection (a retry or a double click) is answered with the first result, never run twice:
    // buying a ship, sailing or listing goods must happen exactly once.
    if (typeof msg.reqId === "number" && client.answered.has(msg.reqId)) return send(client, client.answered.get(msg.reqId));
    const cmd = { ...msg.cmd, company: client.company } as Command;  // never trust a company id from the client
    const r = commit(cmd);
    const recovery = !r.ok && r.error.startsWith("not enough cash") ? recoveryView(engine, client.company, cmd) : undefined;
    const reply = { type: "result", reqId: msg.reqId, ...r, ...(recovery ? { recovery } : {}) };
    if (typeof msg.reqId === "number") { client.answered.set(msg.reqId, reply); if (client.answered.size > 64) client.answered.delete(client.answered.keys().next().value!); }
    send(client, reply);
    if (r.ok) broadcastSoon();
  }
}

function send(c: Client, msg: unknown) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
}
function sendState(c: Client, world = publicView()) {
  send(c, { type: "state", world, me: c.company ? privateView(c.company) : null });
}
function sendStatic(c:Client) {
  send(c,{type:'static',dist:engine.dist,navigation:{
    id:activeMap.navigationId,terrain:activeMap.terrain??null,routes:activeMap.routes,
    generation: 'generation' in activeMap ? {
      seed:(activeMap as RandomSeasonMap).generation.seed,version:(activeMap as RandomSeasonMap).generation.generatorVersion
    } : null
  }});
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
let seasonTransition = false;
async function newSeason(scenario: ExpansionScenario) {
  seasonTransition = true;
  try {
  const seasonId = Number((db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM seasons").get() as { n: number }).n);
  const nextMap=await createSeasonMap(seasonId+1);
  const previousEngine=engine, previousMap=activeMap, previousHistory=history, previousLeaderboards=leaderboards;
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO seasons (id, ended, results) VALUES (?, ?, ?)").run(seasonId, new Date().toISOString(),
      JSON.stringify({ standings: finalStandings(), honours: leaderboards.honours() }));
    db.prepare("INSERT INTO archived_events SELECT ?, id, at, kind, payload FROM events").run(seasonId);
    db.prepare("INSERT INTO archived_maps(season,map_json) VALUES(?,?)").run(seasonId,JSON.stringify(activeMap));
    db.prepare("UPDATE world_map SET map_json=? WHERE id=1").run(JSON.stringify(nextMap));
    db.exec("DELETE FROM events; DELETE FROM sessions;");
    activeMap=nextMap;
    engine = new Engine(rules, activeMap, EXPECTED);
    leaderboards = new SeasonLeaderboards(engine);
    startDifficulty();
    commit({ type: "activateMaritimeRules" });
    if (EXPANSION) {
      const activation = commit({ type: "activateExpansion", scenario });
      if (!activation.ok) throw new Error(activation.error);
    }
    history = [];
    recordPrices();
    const accounts = db.prepare("SELECT name FROM accounts ORDER BY rowid").all() as { name: string }[];
    const update = db.prepare("UPDATE accounts SET company = ? WHERE name = ?");
    for (const a of accounts) {
      const r = commit({ type: "register", name: a.name, startPort: pickHome(engine, randomInt) });
      if (r.ok) update.run(r.id!, a.name);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK"); engine=previousEngine; activeMap=previousMap; history=previousHistory; leaderboards=previousLeaderboards;
    throw e;
  }
  ensureBots();
  for (const c of clients) {
    c.company = c.token = undefined;
    sendStatic(c);
    send(c, { type: "history", history });
    send(c, { type: "authError", error: "A new season has started. Log in again." });
  }
  broadcastSoon();
  return { ok: true, season: seasonId + 1 };
  } finally { seasonTransition=false; }
}

// ------------------------------------------------------------ clock

server.listen({ port: PORT, host: HOST });
await once(server, "listening");
const port = (server.address() as { port: number }).port;   // PORT=0 picks a free port (used by tests)
const displayHost = HOST?.includes(":") ? `[${HOST}]` : HOST ?? "localhost";
console.log(`Manifest running on http://${displayHost}:${port} (tick every ${TICK_MS} ms)`);

let lastSeasonOver = engine.seasonOver;
setInterval(() => {
  if (!engine.seasonOver) {
    leaderboards.advance();
    insertEvent.run(new Date().toISOString(), "tick", "{}");
    recordPrices();
    runPirateBots(engine, botIds, commit);   // first: a pirate bot buys its ship at home before its freighters sail off
    runBots(engine, botIds, commit, { minProfit: engine.botMinProfit, error: engine.botError });
  }
  if (engine.seasonOver && !lastSeasonOver) console.log("Season over. Final standings:", finalStandings().slice(0, 5));
  lastSeasonOver = engine.seasonOver;
  broadcastSoon();
}, TICK_MS);
