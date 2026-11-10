import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type MapData, type Command } from "../src/engine.ts";
import { generateRandomSeason, validateSeasonMap } from "../src/random-season.ts";
import { startServer, Client, cleanup } from "./helpers.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const legacy = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
function setup(map: MapData = legacy) {
  const engine = new Engine(rules, map);
  const result = engine.apply({ type: "register", name: "Insight", startPort: 0 });
  assert.ok(result.ok);
  const company = engine.companies.get(result.id!)!;
  return { engine, company, ship: engine.ships.get(company.ships[0])! };
}
function industrial() {
  const map = structuredClone(legacy) as MapData;
  map.ports[0].produces = ["machinery"];
  map.ports[0].consumes = ["ore"];
  map.ports[1].produces = ["ore"];
  map.industry = { version: 1, orePerMachinery: 2, factories: [0], mines: [1] };
  return setup(map);
}

test("voyage quotes do not mutate state and match authoritative departure charges", () => {
  const { engine: e, company: c, ship: s } = setup();
  const cmd: Extract<Command, { type: "sail" }> = { type: "sail", company: c.id, ship: s.id, dest: 1, buy: { good: "fuel", qty: 30 } };
  const before = JSON.stringify([c, s, e.stock, [...e.trips]]);
  const result = e.voyageQuote(cmd);
  assert.ok(result.ok && "quote" in result);
  const q = result.quote;
  assert.equal(JSON.stringify([c, s, e.stock, [...e.trips]]), before);
  assert.ok(Math.abs(q.cargoBase + q.purchaseTax - q.cargoCost) < 1e-8);
  assert.ok(e.apply(cmd).ok);
  assert.equal(c.cash, q.cashAfterDeparture);
  const trip = e.trips.get(c.id)![0];
  assert.equal(trip.costs!.cargo, q.cargoCost);
  assert.equal(trip.costs!.fuel, q.fuelCost);
  assert.equal(trip.estimate!.profit, q.profit);
  e.apply({ type: "adminSet", portFee: 55 });
  while (s.dest !== null) e.advance();
  assert.equal(trip.costs!.portFees, 55);
  assert.equal(trip.spent, trip.costs!.cargo + trip.costs!.fuel + trip.costs!.portFees);
  assert.ok(e.apply({ type: "sell", company: c.id, ship: s.id }).ok);
  assert.equal(trip.open, false);
  assert.equal(trip.estimate!.profit, q.profit, "the departure estimate remains fixed after actual costs change");
});

test("quotes enforce ownership, cargo limits and affordability without granting credit for cargo", () => {
  const { engine: e, company: c, ship: s } = setup();
  const base = { type: "sail" as const, company: c.id, ship: s.id, dest: 1 };
  assert.equal(e.voyageQuote({ ...base, company: 999 }).ok, false);
  assert.equal(e.voyageQuote({ ...base, buy: { good: "grain", qty: 101 } }).ok, false);
  c.cash = -298;
  const empty = e.voyageQuote(base);
  assert.ok(empty.ok && "quote" in empty && empty.quote.affordable);
  const cargo = e.voyageQuote({ ...base, buy: { good: "grain", qty: 10 } });
  assert.ok(cargo.ok && "quote" in cargo && !cargo.quote.affordable);
  assert.equal(e.apply({ ...base, buy: { good: "grain", qty: 10 } }).ok, false);
});

test("carrying cargo onward includes earlier voyage costs in the comparable estimate", () => {
  const { engine: e, company: c, ship: s } = setup();
  assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: 1, buy: { good: "grain", qty: 20 } }).ok);
  while (s.dest !== null) e.advance();
  const trip = e.trips.get(c.id)![0];
  const quoted = e.voyageQuote({ type: "sail", company: c.id, ship: s.id, dest: 0 });
  assert.ok(quoted.ok && "quote" in quoted);
  assert.ok(quoted.quote.priorCosts > 0);
  assert.equal(quoted.quote.priorCosts, trip.spent - s.cost);
  assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: 0 }).ok);
  assert.equal(trip.estimate!.profit, quoted.quote.profit);
});

test("six-hour forecasts match actual market ticks with no future trades", () => {
  const { engine: e } = industrial();
  const before = JSON.stringify(e.stock);
  const forecasts = e.map.ports.map((_, port) => e.marketOutlook(port));
  assert.equal(JSON.stringify(e.stock), before);
  for (let i = 0; i < 6; i++) e.advance();
  for (let p = 0; p < e.n; p++) for (let g = 0; g < 4; g++) {
    assert.equal(forecasts[p].goods[g].projectedStock, e.stock[p][g]);
    assert.equal(forecasts[p].goods[g].projectedPrice, e.price(p, g));
  }
});

test("arrivals are a conditional sale scenario and do not become stock automatically", () => {
  const { engine: e, ship: s } = setup();
  s.dest = 1; s.arriveTick = 3; s.good = 0; s.qty = 50;
  const outlook = e.marketOutlook(1);
  assert.equal(outlook.goods[0].inbound, 50);
  assert.ok(outlook.goods[0].priceIfInboundSold <= outlook.goods[0].projectedPrice);
  for (let i = 0; i < 6; i++) e.advance();
  assert.equal(e.stock[1][0], outlook.goods[0].projectedStock);
  assert.equal(s.qty, 50);
});

test("factories require ore, convert exactly two per machinery, and respect storage", () => {
  const { engine: e } = industrial();
  e.stock[0][2] = 0; e.stock[0][3] = 0;
  e.advance();
  assert.equal(e.stock[0][3], 0);
  e.stock[0][2] = 0.01;
  e.advance();
  assert.equal(e.stock[0][2], 0);
  assert.equal(e.stock[0][3], 0.005);
  e.stock[0][2] = 50;
  e.stock[0][3] = e.targets[3] * e.rules.markets.max_stock_multiple;
  e.advance();
  assert.equal(e.stock[0][2], 50, "full storage must not waste ore");
  assert.equal(e.marketOutlook(0).factory!.outputPerHour, 0);
});

test("existing maps retain their independent machinery production and replay deterministically", () => {
  const map = structuredClone(legacy) as MapData;
  map.ports[0].produces = ["machinery"]; map.ports[0].consumes = ["ore"];
  const a = setup(map), b = setup(structuredClone(map));
  a.engine.stock[0][2] = b.engine.stock[0][2] = 0;
  for (let h = 0; h < 48; h++) { a.engine.advance(); b.engine.advance(); }
  assert.deepEqual(a.engine.stock, b.engine.stock);
  assert.ok(a.engine.stock[0][3] > a.engine.targets[3], "legacy machinery does not acquire an ore requirement");
});

test("a real ore delivery restarts factory output after the cargo is sold", () => {
  const { engine: e } = industrial();
  e.stock[0][2] = 0; e.stock[0][3] = 0;
  const registered = e.apply({ type: "register", name: "Ore Carrier", startPort: 1 });
  assert.ok(registered.ok);
  const company = e.companies.get(registered.id!)!, ship = e.ships.get(company.ships[0])!;
  assert.ok(e.apply({ type: "sail", company: company.id, ship: ship.id, dest: 0, buy: { good: "ore", qty: 20 } }).ok);
  while (ship.dest !== null) e.advance();
  assert.equal(e.stock[0][3], 0, "cargo at the dock is not factory stock");
  assert.ok(e.apply({ type: "sell", company: company.id, ship: ship.id }).ok);
  assert.equal(e.stock[0][2], 20);
  e.advance();
  assert.ok(e.stock[0][3] > 0);
  assert.ok(Math.abs(20 - e.stock[0][2] - e.stock[0][3] * 2) < 1e-8);
});

test("new seasons persist deterministic mines and factories and reject invalid industrial roles", async () => {
  const map = await generateRandomSeason({ seed: "industrial-insights" });
  assert.equal(map.industry!.mines.length, 4);
  assert.equal(map.industry!.factories.length, 4);
  assert.equal(validateSeasonMap(map), true);
  assert.deepEqual(await generateRandomSeason({ seed: "industrial-insights" }), map);
  const malformed = structuredClone(map);
  malformed.industry!.factories[0] = malformed.industry!.mines[0];
  assert.equal(validateSeasonMap(malformed), false);
});

test("quote protocol authenticates the ship owner and never executes a voyage", async () => {
  const server = await startServer({ MAP_SEED: "quote-protocol" });
  const client = new Client(server);
  try {
    const unauth = client.next(m => m.type === "voyageQuote");
    await client.ready;
    client.send({ type: "quoteVoyage", reqId: 1, cmd: {} });
    assert.equal((await unauth).ok, false);
    await client.auth("register", "Quote Protocol");
    const state = await client.state(m => !!m.me);
    const ship = state.me.ships[0];
    const next = client.next(m => m.type === "voyageQuote");
    client.send({ type: "quoteVoyage", reqId: 2, cmd: { ship: ship.id, dest: ship.port === 0 ? 1 : 0, company: 99999 } });
    const quoted = await next;
    assert.equal(quoted.ok, true, "authenticated company replaces the supplied company ID");
    assert.equal((await client.state()).me.ships[0].dest, null);
    assert.equal((await client.state()).me.cash, 10000);
  } finally { client.close(); await server.stop(); cleanup(server); }
});
