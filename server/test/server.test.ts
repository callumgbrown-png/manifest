// End-to-end tests of the real server: HTTP, accounts, WebSocket play, admin, replay and seasons.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { startServer, Client, ADMIN, alive, sleep, cleanup, type Srv } from "./helpers.ts";

const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const neighbour = (p: number) => { const r = map.routes.find((r: any) => r.a === p || r.b === p); return r.a === p ? r.b : r.a; };

/** Raw HTTP so we can send paths fetch() would clean up (like "//" or "/../"). */
function raw(s: Srv, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = request({ host: "localhost", port: s.port, path, method: opts.method ?? "GET", headers: opts.headers }, res => {
      let body = "";
      res.on("data", d => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, type: String(res.headers["content-type"] ?? ""), body }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}
const admin = (s: Srv, path: string, body?: unknown, token = ADMIN) =>
  raw(s, path, { method: body === undefined ? "GET" : "POST", headers: { "x-admin-token": token }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

let n = 0;
const uniq = (p = "Co") => `${p} ${++n}${Date.now() % 1000}`;

describe("HTTP", () => {
  let s: Srv;
  before(async () => { s = await startServer(); });
  after(async () => { await s.stop(); cleanup(s); });

  test("health and static pages", async () => {
    assert.deepEqual(JSON.parse((await raw(s, "/api/health")).body), { ok: true, tick: 0 });
    for (const [path, type, text] of [["/", "text/html", "Manifest"], ["/admin", "text/html", "admin"], ["/seasons", "text/html", "Past seasons"],
      ["/app.js", "text/javascript", "connect()"], ["/style.css", "text/css", ""]]) {
      const r = await raw(s, path);
      assert.equal(r.status, 200, path);
      assert.equal(r.type, type, path);
      assert.ok(r.body.includes(text), path);
    }
    assert.equal((await raw(s, "/nope.html")).status, 404);
  });

  test("files outside public/ can't be read", async () => {
    for (const p of ["/../config/rules.json", "/..%2f..%2fconfig/rules.json", "/%2e%2e/%2e%2e/config/rules.json", "/../../src/main.ts", "/..\\..\\config\\rules.json"]) {
      const r = await raw(s, p);
      assert.notEqual(r.status, 200, p);
      assert.ok(!r.body.includes("trade_tax_rate"), p);
    }
  });

  test("odd request paths don't crash the server", async () => {
    for (const p of ["//", "///x", "/.", "/./", "/%", "/%zz", "/admin/", "/index.html/"]) {
      const r = await raw(s, p);
      assert.ok(r.status === 404 || r.status === 400 || r.status === 200, `${p} -> ${r.status}`);
    }
    await sleep(100);
    assert.ok(alive(s), "server still running:\n" + s.log());
    assert.equal((await raw(s, "/api/health")).status, 200);
  });

  test("new connections get recent price history", async () => {
    const c = new Client(s);
    const h = await c.seen(m => m.type === "history");
    assert.ok(h.history.length >= 1);
    const last = h.history.at(-1);
    assert.equal(last.tick, 0);
    assert.equal(last.prices.length, map.ports.length);
    const st = await c.seen(m => m.type === "state");
    assert.deepEqual(last.prices.map((p: number[]) => p), st.world.ports.map((p: any) => p.prices));
    c.close();
  });

  test("seasons list starts empty", async () => {
    assert.deepEqual(JSON.parse((await raw(s, "/api/seasons")).body), []);
  });
});

describe("admin API", () => {
  let s: Srv;
  before(async () => { s = await startServer(); });
  after(async () => { await s.stop(); cleanup(s); });

  test("needs the right token", async () => {
    assert.equal((await raw(s, "/api/admin/metrics")).status, 403);
    assert.equal((await admin(s, "/api/admin/metrics", undefined, "wrong-token-wrong-token-xx")).status, 403);
    assert.equal((await admin(s, "/api/admin/metrics", undefined, ADMIN.slice(0, -1))).status, 403);
    assert.equal((await admin(s, "/api/admin/set", { tax: 0 }, "nope")).status, 403);
    assert.equal((await admin(s, "/api/admin/new-season", {}, "nope")).status, 403);
    const m = JSON.parse((await admin(s, "/api/admin/metrics")).body);
    assert.equal(m.companies, 0); assert.equal(m.day, 1);
  });

  test("live controls change the rules players see", async () => {
    const r = await admin(s, "/api/admin/set", { tax: 0.05, upkeep: 300, portFee: 10 });
    assert.equal(r.status, 200);
    const m = JSON.parse((await admin(s, "/api/admin/metrics")).body);
    assert.equal(m.tax, 0.05); assert.equal(m.upkeep, 300); assert.equal(m.portFee, 10);
    const c = new Client(s);
    const st = await c.seen(m => m.type === "state");
    assert.equal(st.world.rules.tax, 0.05);
    c.close();
    // Only the fields sent are changed.
    assert.equal((await admin(s, "/api/admin/set", { portFee: 20 })).status, 200);
    const m2 = JSON.parse((await admin(s, "/api/admin/metrics")).body);
    assert.equal(m2.tax, 0.05); assert.equal(m2.portFee, 20);
  });

  test("bad values are refused and change nothing", async () => {
    for (const body of [{ tax: 0.5 }, { tax: -1 }, { tax: "0.05" }, { tax: null }, { upkeep: -5 }, { upkeep: "lots" }, { portFee: -1 }, { portFee: 1e400 }, "not json", "[1,2]", "null"]) {
      const r = await admin(s, "/api/admin/set", body);
      assert.equal(r.status, 400, JSON.stringify(body) + " " + r.body);
    }
    const m = JSON.parse((await admin(s, "/api/admin/metrics")).body);
    assert.equal(m.tax, 0.05); assert.equal(m.upkeep, 300); assert.equal(m.portFee, 20);
    assert.ok(alive(s));
  });

  test("difficulty can be set from the admin API and players see it", async () => {
    assert.equal((await admin(s, "/api/admin/difficulty", { level: "easy" }, "nope")).status, 403);
    assert.equal((await admin(s, "/api/admin/difficulty", { level: "silly" })).status, 400);
    assert.equal((await admin(s, "/api/admin/difficulty", "not json")).status, 400);
    assert.equal((await admin(s, "/api/admin/difficulty", { level: "easy" })).status, 200);
    const m = JSON.parse((await admin(s, "/api/admin/metrics")).body);
    assert.equal(m.difficulty, "easy"); assert.equal(m.tax, 0.05);
    assert.equal(m.nextSeasonDifficulty, "normal", "a change here isn't kept for the next season (no DIFFICULTY env)");
    const c = new Client(s);
    const st = await c.next(m => m.type === "state" && m.world.rules.difficulty === "easy");
    assert.equal(st.world.rules.tax, 0.05);
    assert.ok(st.world.rules.target > 0, "clients get the target stock for honest estimates");
    c.close();
    // Put the earlier test's values back for the tests that follow.
    await admin(s, "/api/admin/set", { tax: 0.05, upkeep: 300, portFee: 20 });
  });

  test("DIFFICULTY sets a new world's difficulty, and survives a restart", async () => {
    const t = await startServer({ DIFFICULTY: "hard" });
    try {
      const m = JSON.parse((await admin(t, "/api/admin/metrics")).body);
      assert.equal(m.difficulty, "hard"); assert.equal(m.tax, 0.09);
      await t.stop();
      const u = await startServer({ DIFFICULTY: "easy" }, t.db);   // existing world: the log wins
      const mu = JSON.parse((await admin(u, "/api/admin/metrics")).body);
      assert.equal(mu.difficulty, "hard");
      assert.equal(mu.nextSeasonDifficulty, "easy", "the admin page says what the next season starts on");
      assert.equal((await admin(u, "/api/admin/new-season", {})).status, 200);
      assert.equal(JSON.parse((await admin(u, "/api/admin/metrics")).body).difficulty, "easy");
      await u.stop();
    } finally { await t.stop(); cleanup(t); }
  });

  test("admin is disabled when ADMIN_TOKEN is short", async () => {
    const t = await startServer({ ADMIN_TOKEN: "short" });
    try {
      assert.equal((await admin(t, "/api/admin/metrics", undefined, "short")).status, 403);
      assert.equal((await raw(t, "/api/admin/metrics", { headers: { "x-admin-token": "" } })).status, 403);
    } finally { await t.stop(); cleanup(t); }
  });
});

describe("accounts", () => {
  let s: Srv;
  before(async () => { s = await startServer(); });
  after(async () => { await s.stop(); cleanup(s); });

  test("sign-up rules", async () => {
    const c = new Client(s);
    for (const [name, pw, err] of [["ab", "password123", /3-24/], ["bad<name>", "password123", /3-24/], ["Way too long a company name here", "password123", /3-24/],
      ["Bot · Freight", "password123", /3-24/], ["Good Name", "short", /8 characters/], [null, "password123", /3-24/]] as const) {
      const r = await c.auth("register", name as any, pw);
      assert.equal(r.type, "authError"); assert.match(r.error, err);
    }
    c.close();
  });

  test("register, then log in elsewhere with the same password; names are unique ignoring case", async () => {
    const a = new Client(s);
    const r = await a.auth("register", "Acme Freight");
    assert.equal(r.type, "auth"); assert.match(r.token, /^[0-9a-f]{48}$/);
    const st = await a.state(m => m.me);
    assert.equal(st.me.name, "Acme Freight"); assert.equal(st.me.cash, 10000); assert.equal(st.me.ships.length, 1);

    const b = new Client(s);
    assert.equal((await b.auth("register", "acme freight")).error, "That name is taken");
    assert.equal((await b.auth("login", "Acme Freight", "wrong-password")).error, "Wrong name or password");
    assert.equal((await b.auth("login", "Nobody Here")).error, "Wrong name or password");
    const l = await b.auth("login", "ACME FREIGHT");
    assert.equal(l.type, "auth");
    assert.equal((await b.state(m => m.me)).me.id, st.me.id);

    // A saved token resumes the session in a new tab.
    const c = new Client(s); await c.ready;
    c.send({ type: "resume", token: r.token });
    assert.equal((await c.next(m => m.type === "state" && m.me)).me.id, st.me.id);
    c.send({ type: "resume", token: "deadbeef" });
    assert.match((await c.next(m => m.type === "authError")).error, /Session expired/);
    a.close(); b.close(); c.close();
  });

  test("a stranger sees the world but can't act", async () => {
    const c = new Client(s);
    const st = await c.seen(m => m.type === "state");
    assert.equal(st.me, null);
    assert.equal(st.world.ports.length, map.ports.length);
    assert.ok((await c.seen(m => m.type === "static")).dist.length === map.ports.length);
    assert.equal((await c.cmd({ type: "sail", ship: 1, dest: 2 })).error, "Log in first");
    c.close();
  });
});

describe("sessions and abuse limits", () => {
  test("logging out ends the session on the server", async () => {
    const s = await startServer();
    try {
      const a = new Client(s);
      const { token } = await a.auth("register", "Leaver Co");
      a.send({ type: "logout" });
      const out = await a.next(m => m.type === "loggedOut");
      const after = a.msgs.slice(a.msgs.indexOf(out) + 1).find(m => m.type === "state") ?? await a.next(m => m.type === "state");
      assert.equal(after.me, null);
      assert.equal((await a.cmd({ type: "sell", ship: 2 })).error, "Log in first");
      const b = new Client(s); await b.ready;
      b.send({ type: "resume", token });
      assert.match((await b.next(m => m.type === "authError")).error, /Session expired/);
      assert.equal((await b.auth("login", "Leaver Co")).type, "auth", "can log in again");
      a.close(); b.close();
    } finally { await s.stop(); cleanup(s); }
  });

  test("logging out also logs out other tabs on the same session, not other sessions", async () => {
    const s = await startServer();
    try {
      const a = new Client(s);
      const { token } = await a.auth("register", "Twotab Co");
      const b = new Client(s); await b.ready;        // a second tab sharing the saved token
      b.send({ type: "resume", token });
      assert.ok((await b.next(m => m.type === "state" && m.me)).me);
      const other = new Client(s);                   // another device: its own session
      await other.auth("login", "Twotab Co");
      a.send({ type: "logout" });
      await a.next(m => m.type === "loggedOut");
      await b.next(m => m.type === "loggedOut");
      assert.equal((await b.cmd({ type: "sell", ship: 2 })).error, "Log in first", "the other tab can't keep trading");
      assert.notEqual((await other.cmd({ type: "sell", ship: 2 })).error, "Log in first", "another device stays logged in");
      a.close(); b.close(); other.close();
    } finally { await s.stop(); cleanup(s); }
  });

  test("sessions expire after SESSION_DAYS", async () => {
    const s = await startServer({ SESSION_DAYS: String(1.5 / 86400) });   // 1.5 seconds
    try {
      const a = new Client(s);
      const { token } = await a.auth("register", "Brief Co");
      const b = new Client(s); await b.ready;
      b.send({ type: "resume", token });
      assert.ok((await b.next(m => m.type === "state" && m.me)).me);
      await sleep(1700);
      const c = new Client(s); await c.ready;
      c.send({ type: "resume", token });
      assert.match((await c.next(m => m.type === "authError")).error, /Session expired/);
      a.close(); b.close(); c.close();
    } finally { await s.stop(); cleanup(s); }
  });

  test("too many failed log-ins from one address are blocked, even across reconnects", async () => {
    const s = await startServer({ LOGIN_FAILS: "3", TRUST_PROXY: "1" });
    try {
      const a = new Client(s, { "x-forwarded-for": "10.0.0.1" });
      await a.auth("register", "Target Co");
      for (let i = 0; i < 3; i++) assert.equal((await a.auth("login", "Target Co", "guess" + i + "xxxx")).error, "Wrong name or password");
      const again = new Client(s, { "x-forwarded-for": "10.0.0.1" });
      assert.match((await again.auth("login", "Target Co")).error, /Too many failed log-ins.*15 minutes/);
      // Someone else (a different address) isn't affected; only the last forwarded address counts.
      const other = new Client(s, { "x-forwarded-for": "10.0.0.1, 10.0.0.2" });
      assert.equal((await other.auth("login", "Target Co")).type, "auth");
      a.close(); again.close(); other.close();
    } finally { await s.stop(); cleanup(s); }
  });

  test("forwarded addresses are ignored unless TRUST_PROXY is set", async () => {
    const s = await startServer({ LOGIN_FAILS: "1" });
    try {
      const a = new Client(s, { "x-forwarded-for": "1.1.1.1" });
      await a.auth("register", "Proxy Co");
      await a.auth("login", "Proxy Co", "wrong-password");
      const b = new Client(s, { "x-forwarded-for": "2.2.2.2" });
      assert.match((await b.auth("login", "Proxy Co")).error, /Too many failed/, "spoofed header doesn't dodge the limit");
      a.close(); b.close();
    } finally { await s.stop(); cleanup(s); }
  });

  test("sign-ups are limited per address", async () => {
    const s = await startServer({ SIGNUPS_PER_HOUR: "2" });
    try {
      const a = new Client(s);
      assert.equal((await a.auth("register", "First Co")).type, "auth");
      assert.equal((await a.auth("register", "Second Co")).type, "auth");
      assert.match((await a.auth("register", "Third Co")).error, /Too many new companies/);
      assert.equal((await a.auth("login", "First Co")).type, "auth", "logging in still works");
      a.close();
    } finally { await s.stop(); cleanup(s); }
  });
});

describe("playing over WebSockets", () => {
  let s: Srv;
  before(async () => { s = await startServer({ TICK_MS: "200" }); });
  after(async () => { await s.stop(); cleanup(s); });

  test("only player commands are accepted, always for your own company", async () => {
    const a = new Client(s); await a.auth("register", uniq("Alpha"));
    const b = new Client(s); await b.auth("register", uniq("Beta"));
    const bShip = (await b.state(m => m.me)).me.ships[0];
    for (const type of ["register", "adminSet", "tick", "constructor", "__proto__"])
      assert.equal((await a.cmd({ type, tax: 0 })).error, "Unknown command", type);
    // Spoofing another company id is ignored: the server uses the logged-in company.
    const r = await a.cmd({ type: "sail", company: (await b.state(m => m.me)).me.id, ship: bShip.id, dest: neighbour(bShip.port) });
    assert.equal(r.error, "not your ship");
    a.close(); b.close();
  });

  test("bad input is refused without breaking the game", async () => {
    const a = new Client(s); await a.auth("register", uniq("Gamma"));
    const me = (await a.state(m => m.me)).me, ship = me.ships[0];
    const dest = neighbour(ship.port);
    for (const cmd of [
      { type: "sail", ship: ship.id, dest: String(dest) },
      { type: "sail", ship: String(ship.id), dest },
      { type: "sail", ship: ship.id, dest: 1.5 },
      { type: "sail", ship: ship.id, dest: -1 },
      { type: "sail", ship: ship.id, dest: 9999 },
      { type: "sail", ship: ship.id, dest: ship.port },
      { type: "sail", ship: ship.id, dest, buy: { good: "gold", qty: 10 } },
      { type: "sail", ship: ship.id, dest, buy: { good: "grain", qty: -10 } },
      { type: "sail", ship: ship.id, dest, buy: { good: "grain", qty: "lots" } },
      { type: "placeOrder", port: String(ship.port), good: "grain", qty: 10, price: 20 },
      { type: "placeOrder", port: "1e0", good: "grain", qty: 10, price: 20 },
      { type: "placeOrder", port: ship.port, good: "grain", qty: 10, price: "cheap" },
      { type: "placeOrder", port: ship.port, good: "toString", qty: 10, price: 20 },
      { type: "buyShip", port: String(ship.port) },
      { type: "sell", ship: ship.id },
      { type: "cancelOrder", order: 1 },
    ]) {
      await sleep(110);   // stay under the 10-messages-a-second limit
      const r = await a.cmd(cmd);
      assert.equal(r.ok, false, JSON.stringify(cmd));
    }
    const after = (await a.state(m => m.me)).me;
    assert.equal(after.cash, me.cash, "nothing was charged");
    assert.equal(after.ships[0].dest, null);
    assert.equal(after.ships[0].port, ship.port);
    a.close();
  });

  test("malformed messages, floods and huge payloads don't take the server down", async () => {
    const a = new Client(s); await a.ready;
    for (const m of ["", "not json", "null", "42", "[]", '"x"', '{"type":"cmd"}', '{"type":"cmd","cmd":null}', '{"type":"cmd","cmd":"sail"}',
      '{"type":"resume"}', '{"type":"resume","token":{"a":1}}', '{"type":"login","name":{"x":1},"password":[1]}']) a.send(m);
    await sleep(1100);   // let the rate limiter forget
    const flood = new Client(s); await flood.ready;
    for (let i = 0; i < 15; i++) flood.send({ type: "cmd", reqId: i, cmd: { type: "sell", ship: 1 } });
    assert.equal((await flood.next(m => m.type === "error")).error, "Slow down");
    const big = new Client(s); await big.ready;
    const closed = new Promise(r => big.ws.once("close", r));
    big.send("x".repeat(20000));
    await closed;
    await sleep(200);
    assert.ok(alive(s), "server still running:\n" + s.log());
    const c = new Client(s);
    assert.equal((await c.auth("register", uniq("After"))).type, "auth");
    a.close(); flood.close(); c.close();
  });

  test("a full trade: load, sail, arrive, pay the port fee, sell; everyone sees it", async () => {
    const a = new Client(s); await a.auth("register", uniq("Trader"));
    const watcher = new Client(s); await watcher.seen(m => m.type === "state");
    const me = (await a.state(m => m.me)).me, ship = me.ships[0];
    const dest = neighbour(ship.port);
    const r = await a.cmd({ type: "sail", ship: ship.id, dest, buy: { good: "grain", qty: 50 } });
    assert.deepEqual(r, { type: "result", reqId: r.reqId, ok: true });
    const sailing = await a.fresh(m => m.me?.ships[0].dest === dest);
    assert.ok(sailing.me.cash < me.cash);
    assert.equal(sailing.me.ships[0].qty, 50);
    // Public view shows the ship and its cargo inbound.
    const pub = await watcher.fresh(m => m.world.ships.some((x: any) => x.id === ship.id && x.dest === dest));
    assert.ok(pub.world.ports[dest].inbound[0] >= 50);
    assert.ok(!("cash" in pub.world.ships[0]), "other companies' cash isn't public");
    // Arrives later; port fee charged on docking.
    const docked = await a.fresh(m => m.me?.ships[0].dest === null, 10000);
    assert.equal(docked.me.ships[0].port, dest);
    assert.equal(docked.me.cash, sailing.me.cash - 25);
    const sold = await a.cmd({ type: "sell", ship: ship.id });
    assert.equal(sold.ok, true);
    const after = await a.fresh(m => m.me?.ships[0].qty === 0);
    assert.ok(after.me.cash > docked.me.cash);
    a.close(); watcher.close();
  });

  test("orders between two players: buy order escrow, fill, list for sale, buy from listing, cancel", async () => {
    const a = new Client(s); await a.auth("register", uniq("Buyer"));
    const b = new Client(s); await b.auth("register", uniq("Seller"));
    const A = (await a.state(m => m.me)).me;
    let B = (await b.state(m => m.me)).me;
    const port = B.ships[0].port;
    // A wants grain at B's port; cash goes into escrow.
    const o = await a.cmd({ type: "placeOrder", port, good: "grain", qty: 30, price: 39 });
    assert.equal(o.ok, true);
    assert.equal((await a.fresh(m => m.me?.cash === A.cash - 30 * 39)).me.worth, A.worth);
    // B loads grain, sails away and back, then fills A's order.
    const away = neighbour(port);
    assert.equal((await b.cmd({ type: "sail", ship: B.ships[0].id, dest: away, buy: { good: "grain", qty: 60 } })).ok, true);
    await b.fresh(m => m.me?.ships[0].dest === null && m.me.ships[0].port === away, 10000);
    assert.equal((await b.cmd({ type: "sail", ship: B.ships[0].id, dest: port })).ok, true);
    B = (await b.fresh(m => m.me?.ships[0].dest === null && m.me.ships[0].port === port, 10000)).me;
    const fill = await b.cmd({ type: "sell", ship: B.ships[0].id, order: o.id });
    assert.equal(fill.ok, true);
    const filled = (await b.fresh(m => m.me?.ships[0].qty === 30)).me;
    assert.ok(Math.abs(filled.cash - (B.cash + 30 * 39 * 0.93)) <= 1);
    assert.ok(!(await b.state()).world.orders.some((x: any) => x.id === o.id), "order fully filled and gone");
    // B lists the remaining 30 grain; the ship is freed.
    const list = await b.cmd({ type: "placeSell", ship: B.ships[0].id, qty: 30, price: 38 });
    assert.equal(list.ok, true);
    const listing = (await b.fresh(m => m.world.orders.some((x: any) => x.id === list.id))).world.orders.find((x: any) => x.id === list.id);
    assert.equal(listing.side, "sell"); assert.equal(listing.ownerName, B.name);
    assert.equal((await b.state(m => m.me?.ships[0].qty === 0)).me.ships[0].qty, 0);
    // A sails a ship to that port and buys 10 from the listing.
    const aShip = (await a.state(m => m.me)).me.ships[0];
    if (aShip.port !== port) {
      assert.equal((await a.cmd({ type: "sail", ship: aShip.id, dest: port })).ok, true);
      await a.fresh(m => m.me?.ships[0].dest === null && m.me.ships[0].port === port, 20000);
    }
    assert.equal((await a.cmd({ type: "buyFromOrder", ship: aShip.id, order: list.id, qty: 10 })).ok, true);
    const aHas = (await a.fresh(m => m.me?.ships[0].qty === 10)).me;
    assert.equal(aHas.ships[0].good, 0);
    // B can't buy their own listing, and cancels the rest back onto their ship.
    assert.equal((await b.cmd({ type: "buyFromOrder", ship: B.ships[0].id, order: list.id, qty: 1 })).error, "can't buy from your own order");
    assert.equal((await b.cmd({ type: "cancelOrder", order: list.id })).ok, true);
    assert.equal((await b.fresh(m => m.me?.ships[0].qty === 20)).me.ships[0].good, 0);
    // A can't cancel B's order.
    assert.equal((await a.cmd({ type: "cancelOrder", order: list.id })).error, "not your order");
    a.close(); b.close();
  });

  test("buying and scrapping ships", async () => {
    const a = new Client(s); await a.auth("register", uniq("Fleet"));
    const me = (await a.state(m => m.me)).me;
    assert.equal((await a.cmd({ type: "buyShip", port: me.ships[0].port })).error, "not enough cash");
    assert.equal((await a.cmd({ type: "scrapShip", ship: me.ships[0].id })).error, "you must keep one ship");
    a.close();
  });

  test("leaderboard lists companies by net worth", async () => {
    const c = new Client(s);
    const st = await c.seen(m => m.type === "state");
    const lb = st.world.leaderboard;
    assert.ok(lb.length > 0 && lb.length <= 20);
    for (let i = 1; i < lb.length; i++) assert.ok(lb[i - 1].worth >= lb[i].worth);
    assert.ok(lb.every((x: any) => x.bot === false));
    c.close();
  });

  test("companies with the same net worth share a place", async () => {
    // Two brand-new companies both have exactly the starting net worth.
    const a = new Client(s); await a.auth("register", uniq("Twin"));
    const b = new Client(s); await b.auth("register", uniq("Twin"));
    const st = await b.state(m => m.me && m.world.leaderboard.some((x: any) => x.id === m.me.id));
    const m = st.me, lb = st.world.leaderboard;
    assert.ok(m.tied >= 1, "the other new company has the same net worth");
    assert.equal(m.rank, 1 + lb.filter((x: any) => x.worth > m.worth).length, "rank counts only richer companies");
    assert.equal(m.rank, 1 + lb.findIndex((x: any) => x.worth === m.worth), "and matches the first row with your net worth");
    a.close(); b.close();
  });
});

describe("restart and seasons", () => {
  test("a restart replays the event log exactly", async () => {
    const s = await startServer({ TICK_MS: "30", BOTS: "4" });
    const a = new Client(s); await a.auth("register", "Replay Co");
    const me = (await a.state(m => m.me)).me;
    await a.cmd({ type: "sail", ship: me.ships[0].id, dest: neighbour(me.ships[0].port), buy: { good: "fuel", qty: 40 } });
    await a.cmd({ type: "placeOrder", port: 3, good: "grain", qty: 20, price: 25 });
    await admin(s, "/api/admin/set", { tax: 0.06 });
    await sleep(400);
    const snapA = await a.state();
    await s.stop(); a.close();
    const t = await startServer({ TICK_MS: "100000000", BOTS: "4" }, s.db);
    try {
      assert.match(t.log(), /Replayed \d+ events/);
      const b = new Client(t);
      await b.auth("login", "Replay Co");
      const st = (await b.state(m => m.me));
      assert.ok(st.world.tick >= snapA.world.tick);
      assert.equal(st.world.rules.tax, 0.06);
      assert.ok(st.world.orders.some((o: any) => o.ownerName === "Replay Co" && o.qty === 20));
      assert.equal(st.world.leaderboard.filter((c: any) => c.bot).length, 4, "bots not duplicated on restart");
      const hist = (await b.seen(m => m.type === "history")).history;
      assert.equal(hist.at(-1).tick, st.world.tick, "price history rebuilt from the log");
      assert.ok(hist.length === Math.min(72, st.world.tick + 1));
      // Restart again with no new activity: identical world.
      const before = JSON.stringify({ ...st.world, tickMs: 0 });
      b.close(); await t.stop();
      const u = await startServer({ TICK_MS: "100000000", BOTS: "4" }, s.db);
      const c = new Client(u);
      const again = await c.seen(m => m.type === "state");
      assert.equal(JSON.stringify({ ...again.world, tickMs: 0 }), before);
      c.close(); await u.stop();
    } finally { await t.stop(); cleanup(s); }
  });

  test("bots trade on the live server", async () => {
    // Default world: 30 bots, markets sized for 60 companies.
    const s = await startServer({ TICK_MS: "4", BOTS: "30" });
    try {
      const c = new Client(s);
      const st = await c.next(m => m.type === "state" && m.world.ships.some((x: any) => x.dest !== null && x.qty > 0), 30000);
      assert.equal(st.world.leaderboard.filter((x: any) => x.bot).length, 20, "leaderboard shows the top 20");
      assert.equal((await c.seen(m => m.type === "state")).world.ships.length, 30);
      c.close();
    } finally { await s.stop(); cleanup(s); }
  });

  test("the season ends on the clock, trading stops, and a new season archives results", async () => {
    const s = await startServer({ TICK_MS: "1", BOTS: "3" });
    try {
      const a = new Client(s); await a.auth("register", "Season One");
      const ended = await a.next(m => m.type === "state" && m.world.seasonOver, 60000);
      assert.equal(ended.world.tick, ended.world.seasonHours);
      assert.equal((await a.cmd({ type: "sell", ship: ended.me.ships[0].id })).error, "the season has ended");
      const b = new Client(s);
      assert.equal((await b.auth("register", "Too Late")).error, "the season has ended");
      // Archive and start over.
      const r = JSON.parse((await admin(s, "/api/admin/new-season", {})).body);
      assert.deepEqual(r, { ok: true, season: 2 });
      assert.match((await a.seen(m => m.type === "authError")).error, /new season/);
      const seasons = JSON.parse((await raw(s, "/api/seasons")).body);
      assert.equal(seasons.length, 1);
      assert.equal(seasons[0].id, 1);
      assert.ok(seasons[0].top.some((x: any) => x.name === "Season One"));
      assert.ok(seasons[0].top.length <= 10);
      // Old sessions are gone; the same account plays on with a fresh company.
      const c = new Client(s); await c.ready;
      c.send({ type: "resume", token: (a.msgs.find(m => m.type === "auth")).token });
      assert.equal((await c.next(m => m.type === "authError")).type, "authError");
      assert.equal((await c.auth("login", "Season One")).type, "auth");
      const st = await c.state(m => m.me);
      assert.equal(st.me.cash, 10000);
      assert.equal(st.world.seasonOver, false);
      assert.equal(st.world.leaderboard.filter((x: any) => x.bot).length, 3);
      a.close(); b.close(); c.close();
    } finally { await s.stop(); cleanup(s); }
  });
});
