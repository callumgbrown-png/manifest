// Tests for the ports feature modules (ideas 41-60 and 261-280). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { GOODS, type Company, type Ship } from "../src/engine.ts";
import { shared, sites } from "../src/features/ports/shared.ts";
import { CRANE_MACHINERY } from "../src/features/ports/cranes.ts";
import { fuelFactor, shipyardPorts, repairYardPorts, REPAIR_HOURS, BUILD_HOURS } from "../src/features/ports/fuel-yards.ts";
import { customsPorts, DUTY } from "../src/features/ports/customs.ts";
import { festivalsOn } from "../src/features/ports/festivals.ts";
import { airfields, parcelOf, AIR_HOURS } from "../src/features/ports/airfreight.ts";
import { fishPorts, FISHING_HOURS } from "../src/features/ports/market-services.ts";
import { chandleryPorts, cruisePorts, linerAt, TOUR_HOURS } from "../src/features/ports/town.ts";
import { breakerPorts, institutePorts, navalBases } from "../src/features/ports/institutions.ts";
import { boxesFor, craneFor, craneScore, stackScore } from "../src/features/ports/minigames.ts";

const cfg = JSON.parse(readFileSync(new URL("../../config/features/ports.json", import.meta.url), "utf8"));
const ALL_PORTS = Object.keys(cfg).filter(k => k.startsWith("ports."));
const IDEAS = [...Array.from({ length: 20 }, (_, i) => 41 + i), ...Array.from({ length: 20 }, (_, i) => 261 + i)];
type W = ReturnType<typeof featureWorld>;
const firstShip = (w: W, c: Company): Ship => w.e.ships.get(c.ships[0])!;
const GOOD = (name: string) => GOODS.indexOf(name as typeof GOODS[number]);
/** Gives a docked ship some cargo directly (tests only). */
function cargo(s: Ship, good: string, qty: number) { s.good = GOOD(good); s.qty = qty; s.cost = qty * 10; }
const view = (w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as any;
const world = (w: W, id: string) => w.e.features.world()[id] as any;
/** Hours until the next sailing from a ship arrives. */
function sailAndArrive(w: W, c: Company, s: Ship, dest = w.reachable(s.port)) {
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest }).ok, true);
  w.hours(s.arriveTick - w.e.tick);
  assert.equal(s.dest, null);
  return dest;
}

test("every ports idea 41-60 and 261-280 has a module, and the switch file matches", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("ports."));
  const ideas = new Set(mods.flatMap(m => m.ideas));
  for (const i of IDEAS) assert.ok(ideas.has(i), `idea ${i}`);
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL_PORTS].sort());
  for (const m of mods) assert.equal(cfg[m.id], !m.economy, m.id);
});

test("docks: funding a tier adds docks, priority berths cost money and skip the queue", () => {
  const w = featureWorld(["ports.docks"]);
  const c = w.company("A"), s = firstShip(w, c);
  const before = world(w, "ports.docks").docks[s.port];
  c.cash = 100_000;
  assert.equal(w.act(c, "ports.docks", "fundDocks", { port: s.port }).ok, true);
  assert.equal(world(w, "ports.docks").docks[s.port], before + 2);
  assert.equal(w.act(c, "ports.docks", "fundDocks", { port: 9999 }).ok, false);
  const cash = c.cash;
  assert.equal(w.act(c, "ports.docks", "bookPriority", { ship: s.id }).ok, true);
  assert.equal(c.cash, cash - 60);
  assert.equal(w.act(c, "ports.docks", "bookPriority", { ship: s.id }).ok, false, "only once");
  assert.equal(w.act(c, "ports.docks", "bookPriority", { ship: "1" }).ok, false);
});

test("docks: a crowded port adds queue hours", () => {
  const w = featureWorld(["ports.docks"]);
  const cs = ["A", "B", "C"].map(n => w.company(n));
  const port = firstShip(w, cs[0]).port;
  const other = w.reachable(port);
  const ctx = { ship: firstShip(w, cs[0]).id, from: other, dest: port };
  assert.ok(w.e.features.adjust("travelHours", 10, ctx) > 10, "six ships in a two-dock port queue");
});

test("cranes: machinery donations build crane levels; pilots are free and limited; effects save time only when on", () => {
  const w = featureWorld(["ports.cranes"]);
  const c = w.company("A"), s = firstShip(w, c);
  const cash = c.cash;
  cargo(s, "machinery", CRANE_MACHINERY);
  assert.equal(w.act(c, "ports.cranes", "donate", { port: s.port, ship: s.id }).ok, true);
  assert.equal(world(w, "ports.cranes").cranes[s.port], 1);
  assert.equal(s.qty, 0);
  assert.equal(c.cash, cash, "no money changes hands");
  assert.equal(w.act(c, "ports.cranes", "donate", { port: s.port, ship: s.id }).ok, false, "empty ship");
  assert.equal(w.act(c, "ports.cranes", "pilot", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "ports.cranes", "pilot", { ship: s.id }).ok, false);
  const ctx = { ship: s.id, from: s.port, dest: w.reachable(s.port) };
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 10);
  w.apply({ type: "setFeatures", enabled: ["ports.cranes", "ports.harbour-effects"] });
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 8);
});

test("ownership: a charter costs money, sets visitors' fees and pays the owner", () => {
  const w = featureWorld(["ports.ownership"]);
  const a = w.company("A"), b = w.company("B");
  const port = firstShip(w, a).port;
  a.cash = 10_000;
  assert.equal(w.act(a, "ports.ownership", "buyCharter", { port }).ok, true);
  assert.equal(w.act(b, "ports.ownership", "buyCharter", { port }).ok, false);
  assert.equal(w.act(a, "ports.ownership", "setFee", { port, rate: 151 }).ok, false);
  assert.equal(w.act(a, "ports.ownership", "setFee", { port, rate: 150 }).ok, true);
  assert.equal(w.e.features.adjust("portFee", 100, { ship: 0, company: b.id, from: 1, dest: port }), 150);
  assert.equal(w.e.features.adjust("portFee", 100, { ship: 0, company: a.id, from: 1, dest: port }), 50);
});

test("fuel stations: price factor by port and day changes fuel", () => {
  const w = featureWorld(["ports.fuel-stations"]);
  const f = fuelFactor(w.e, 0);
  assert.ok(f >= 0.85 && f <= 1.2);
  assert.equal(w.e.features.adjust("fuel", 100, { ship: 1, from: 0, dest: 1 }), 100 * f);
});

test("shipyards: order a hull at a yard, it launches after the build time", () => {
  const w = featureWorld(["ports.shipyards"]);
  const yard = shipyardPorts(w.e)[0];
  const c = w.company("A", yard);
  c.cash = 100_000;
  const n = c.ships.length;
  assert.equal(w.act(c, "ports.shipyards", "order", { port: yard, shipType: "warship" }).ok, false);
  assert.equal(w.act(c, "ports.shipyards", "order", { port: yard, shipType: "freighter" }).ok, true);
  w.hours(BUILD_HOURS - 1);
  assert.equal(c.ships.length, n);
  w.hours(1);
  assert.equal(c.ships.length, n + 1);
});

test("repair yards: an overhaul takes yard time and is abandoned if the ship sails", () => {
  const w = featureWorld(["ports.repair-yards"]);
  const yard = repairYardPorts(w.e)[0];
  const c = w.company("A", yard), s = firstShip(w, c);
  assert.equal(w.act(c, "ports.repair-yards", "overhaul", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "ports.repair-yards", "overhaul", { ship: s.id }).ok, false);
  w.hours(REPAIR_HOURS);
  assert.equal(view(w, c, "ports.repair-yards").serviced.length, 1);
  const t = w.e.ships.get(c.ships[1] ?? c.ships[0])!;
  if (t.id !== s.id) {
    assert.equal(w.act(c, "ports.repair-yards", "overhaul", { ship: t.id }).ok, true);
    sailAndArrive(w, c, t);
    assert.equal(view(w, c, "ports.repair-yards").jobs.length, 0);
  }
});

test("customs: duty at customs ports; the queue rewards prompt declarations", () => {
  const w = featureWorld(["ports.customs", "ports.customs-queue", "ports.reputation"]);
  const cp = customsPorts(w.e);
  assert.equal(w.e.features.adjust("tradeTax", 0.05, { port: cp[0], good: 0, side: "buy" }), 0.05 + DUTY);
  const from = w.e.map.ports.findIndex((_, i) => !cp.includes(i) && cp.some(p => Number.isFinite(w.e.dist[i][p])));
  const c = w.company("A", from), s = firstShip(w, c);
  const dest = cp.find(p => Number.isFinite(w.e.dist[from][p]))!;
  c.cash = 100_000;
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "grain", qty: 5 } }).ok
    || w.run({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "fuel", qty: 5 } }).ok, true);
  w.hours(s.arriveTick - w.e.tick);
  assert.equal(view(w, c, "ports.customs-queue").waiting.length, 1);
  assert.equal(w.act(c, "ports.customs-queue", "declare", { ship: s.id }).ok, true);
  assert.equal(view(w, c, "ports.customs-queue").declared, 1);
  assert.equal(w.act(c, "ports.customs-queue", "declare", { ship: s.id }).ok, false);
});

test("projects: donations finish a lighthouse; the keeper wants fuel", () => {
  const w = featureWorld(["ports.projects", "ports.museum"]);
  const lh = [...shared(w.e).projects.values()].find(p => p.kind === "lighthouse")!;
  const c = w.company("A", lh.port), s = firstShip(w, c);
  cargo(s, "fuel", lh.need);
  assert.equal(w.act(c, "ports.projects", "donate", { project: lh.key, ship: s.id }).ok, true);
  assert.ok(world(w, "ports.projects").lit.includes(lh.port));
  assert.equal(w.act(c, "ports.projects", "donate", { project: "nope", ship: s.id }).ok, false);
  assert.ok(world(w, "ports.museum").exhibits.length >= 1);
});

test("project effects: a finished channel shortens its lane only when switched on", () => {
  const w = featureWorld(["ports.projects", "ports.project-effects"]);
  const ch = [...shared(w.e).projects.values()].find(p => p.kind === "channel");
  if (!ch) return;
  ch.level = 1;
  assert.equal(w.e.features.adjust("travelHours", 20, { ship: 1, from: ch.port, dest: ch.port2! }), 17);
});

test("reputation: arrivals earn standing", () => {
  const w = featureWorld(["ports.reputation"]);
  const c = w.company("A"), s = firstShip(w, c);
  const dest = sailAndArrive(w, c, s);
  const rep = view(w, c, "ports.reputation").rep as { port: number; points: number }[];
  assert.ok(rep.find(r => r.port === dest)!.points >= 1);
  assert.equal(world(w, "ports.reputation").hubs.length, w.e.map.ports.length);
});

test("festivals: a calendar, a parade once a day; effects eat the featured good's stock", () => {
  const w = featureWorld(["ports.festivals", "ports.festival-effects"]);
  const f = festivalsOn(w.e)[0];
  const c = w.company("A", f.port);
  assert.equal(w.act(c, "ports.festivals", "parade").ok, true);
  assert.equal(w.act(c, "ports.festivals", "parade").ok, false);
  const stockBefore = w.e.stock[f.port][f.good];
  w.e.features.modules.get("ports.festival-effects")!.advance!();
  assert.ok(w.e.stock[f.port][f.good] < stockBefore || stockBefore === 0);
});

test("airfreight: collect today's parcel and deliver it by sea; effects fly machinery for a fee", () => {
  const w = featureWorld(["ports.airfreight", "ports.airfreight-effects"]);
  const p = parcelOf(w.e)!;
  const a = w.company("A", p.from);
  assert.equal(w.act(a, "ports.airfreight", "pickup").ok, true);
  assert.equal(w.act(a, "ports.airfreight", "pickup").ok, false);
  const s = firstShip(w, a);
  if (Number.isFinite(w.e.dist[p.from][p.to])) {
    sailAndArrive(w, a, s, p.to);
    assert.equal(view(w, a, "ports.airfreight").delivered, 1);
  }
  const [x, y] = airfields(w.e);
  const b = w.company("B", x), d = w.company("D", y);
  void d;
  const src = firstShip(w, b);
  cargo(src, "machinery", 8);
  // b has no ship at y: the target must be b's own ship there.
  assert.equal(w.act(b, "ports.airfreight-effects", "fly", { ship: src.id, to: y, target: firstShip(w, d).id, qty: 5 }).ok, false);
  const helper = w.e.addExpansionShip(b, y, "freighter");
  const cash = b.cash;
  assert.equal(w.act(b, "ports.airfreight-effects", "fly", { ship: src.id, to: y, target: helper.id, qty: 6 }).ok, false);
  assert.equal(w.act(b, "ports.airfreight-effects", "fly", { ship: src.id, to: y, target: helper.id, qty: 5 }).ok, true);
  assert.equal(b.cash, cash - 100);
  w.hours(AIR_HOURS);
  assert.equal(helper.qty, 5);
  assert.equal(src.qty, 3);
});

test("warehouses: store cargo ashore, pay rent, load it back", () => {
  const w = featureWorld(["ports.warehouses"]);
  const c = w.company("A"), s = firstShip(w, c);
  cargo(s, "grain", 20);
  assert.equal(w.act(c, "ports.warehouses", "store", { ship: s.id, qty: 21, district: "quayside" }).ok, false);
  assert.equal(w.act(c, "ports.warehouses", "store", { ship: s.id, qty: 20, district: "moon" }).ok, false);
  assert.equal(w.act(c, "ports.warehouses", "store", { ship: s.id, qty: 20, district: "quayside" }).ok, true);
  assert.equal(s.qty, 0);
  const cash = c.cash;
  w.hours(24 - (w.e.tick % 24));
  assert.ok(c.cash < cash, "rent paid");
  assert.equal(w.act(c, "ports.warehouses", "load", { lot: 0, ship: s.id }).ok, true);
  assert.equal(s.qty, 20);
});

test("fish market: an empty ship fishes for six hours and earns money", () => {
  const w = featureWorld(["ports.fish-market"]);
  const c = w.company("A", fishPorts(w.e)[0]), s = firstShip(w, c);
  const cash = c.cash;
  assert.equal(w.act(c, "ports.fish-market", "fish", { ship: s.id }).ok, true);
  w.hours(FISHING_HOURS);
  assert.ok(c.cash > cash);
});

test("rumour board: a paid tip names the best market", () => {
  const w = featureWorld(["ports.rumours"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "ports.rumours", "buy", { port: s.port, good: "spice" }).ok, false);
  const cash = c.cash;
  assert.equal(w.act(c, "ports.rumours", "buy", { port: s.port, good: "grain" }).ok, true);
  assert.equal(c.cash, cash - 50);
  assert.match(view(w, c, "ports.rumours")[0].text, /grain fetches/);
});

test("strikes: struck ports delay arrivals unless you pay wages or join the union", () => {
  const w = featureWorld(["ports.strikes"]);
  const c = w.company("A");
  let tries = 0;
  while (!world(w, "ports.strikes").strikes.length && tries++ < 400) w.hours(1);
  const strike = world(w, "ports.strikes").strikes[0];
  assert.ok(strike, "a strike happens within a few days");
  const ctx = { ship: firstShip(w, c).id, from: 0, dest: strike.port };
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 16);
  assert.equal(w.act(c, "ports.strikes", "join").ok, true);
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 10);
  assert.ok(w.e.features.adjust("upkeep", 0, { company: c.id }) > 0);
  const d = w.company("D", strike.port);
  d.cash = 10_000;
  assert.equal(w.act(d, "ports.strikes", "payWages", { port: strike.port }).ok, true);
  assert.equal(world(w, "ports.strikes").strikes.length, 0);
});

test("tavern: free gossip and a hired hand per ship", () => {
  const w = featureWorld(["ports.tavern"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "ports.tavern", "hire", { ship: s.id, crew: 99 }).ok, false);
  assert.equal(w.act(c, "ports.tavern", "hire", { ship: s.id, crew: 0 }).ok, true);
  assert.equal(w.act(c, "ports.tavern", "hire", { ship: s.id, crew: 1 }).ok, false);
  assert.match(w.e.features.cards(c.id)["ports.tavern"].cards[0].detail, /Sailors say/);
  assert.equal(w.act(c, "ports.tavern", "dismiss", { ship: s.id }).ok, true);
});

test("stalls: open up to three, each earns daily standing", () => {
  const w = featureWorld(["ports.stalls", "ports.reputation"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "ports.stalls", "open", { port: s.port, banner: 0 }).ok, true);
  assert.equal(w.act(c, "ports.stalls", "open", { port: s.port, banner: 0 }).ok, false);
  w.hours(24);
  assert.ok(view(w, c, "ports.reputation").rep[0].points >= 1);
  assert.equal(world(w, "ports.stalls").stalls.length, 1);
});

test("chandlery: top up stores at a chandlery port", () => {
  const w = featureWorld(["ports.chandlery"]);
  const c = w.company("A", chandleryPorts(w.e)[0]), s = firstShip(w, c);
  assert.equal(w.act(c, "ports.chandlery", "stock", { ship: s.id }).ok, true);
  assert.equal(view(w, c, "ports.chandlery")[0].stores, 10);
});

test("cruise: welcome the liner once; harbour tours earn standing", () => {
  const w = featureWorld(["ports.cruise"]);
  const c = w.company("A", linerAt(w.e)!), s = firstShip(w, c);
  assert.ok(cruisePorts(w.e).includes(s.port));
  assert.equal(w.act(c, "ports.cruise", "welcome").ok, true);
  assert.equal(w.act(c, "ports.cruise", "welcome").ok, false);
  assert.equal(w.act(c, "ports.cruise", "tour", { ship: s.id }).ok, true);
  w.hours(TOUR_HOURS);
  assert.equal(view(w, c, "ports.cruise").tours, 1);
});

test("bank: savings goal and statements; deposits earn interest only in the economy module", () => {
  const w = featureWorld(["ports.bank", "ports.bank-effects"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ports.bank", "setGoal", { goal: -5 }).ok, false);
  assert.equal(w.act(c, "ports.bank", "setGoal", { goal: 50_000 }).ok, true);
  assert.equal(view(w, c, "ports.bank").goal, 50_000);
  const cash = c.cash;
  assert.equal(w.act(c, "ports.bank-effects", "deposit", { amount: 1000 }).ok, true);
  assert.equal(c.cash, cash - 1000);
  w.hours(24);
  assert.ok(view(w, c, "ports.bank-effects").deposit >= 1002);
  assert.equal(w.act(c, "ports.bank-effects", "withdraw", { amount: 999_999 }).ok, false);
  assert.equal(w.act(c, "ports.bank-effects", "withdraw", { amount: 1000 }).ok, true);
});

test("insurance office: risk ratings for every port", () => {
  const w = featureWorld(["ports.insurance-office"]);
  const c = w.company("A");
  const risk = world(w, "ports.insurance-office").risk as number[];
  assert.equal(risk.length, w.e.map.ports.length);
  assert.ok(risk.every(r => r >= 0 && r <= 3));
  assert.equal(w.e.features.cards(c.id)["ports.insurance-office"].cards.length, 1);
});

test("weather station: forecasts, longer with Tide tables", () => {
  const w = featureWorld(["ports.weather", "ports.research"]);
  const c = w.company("A");
  assert.equal(view(w, c, "ports.weather").days, 2);
  shared(w.e).research.set(c.id, new Set(["tides"]));
  assert.equal(view(w, c, "ports.weather").days, 3);
  assert.equal(world(w, "ports.weather").today.length, w.e.map.ports.length);
});

test("research: donated cargo earns points that unlock topics", () => {
  const w = featureWorld(["ports.research"]);
  const c = w.company("A", institutePorts(w.e)[0]), s = firstShip(w, c);
  cargo(s, "machinery", 20);
  assert.equal(w.act(c, "ports.research", "donate", { ship: s.id }).ok, true);
  assert.equal(view(w, c, "ports.research").points, 40);
  assert.equal(w.act(c, "ports.research", "study", { topic: "signals" }).ok, false);
  assert.equal(w.act(c, "ports.research", "study", { topic: "tides" }).ok, true);
  assert.deepEqual(view(w, c, "ports.research").topics, ["tides"]);
});

test("shipbreaking: retire a ship at a breaker's yard for the usual scrap price", () => {
  const w = featureWorld(["ports.shipbreaking", "ports.museum"]);
  const c = w.company("A", breakerPorts(w.e)[0]);
  if (c.ships.length < 2) w.e.addExpansionShip(c, breakerPorts(w.e)[0], "freighter");
  const n = c.ships.length, cash = c.cash;
  assert.equal(w.act(c, "ports.shipbreaking", "break", { ship: c.ships[n - 1] }).ok, true);
  assert.equal(c.ships.length, n - 1);
  assert.ok(c.cash > cash);
  assert.match(world(w, "ports.museum").exhibits.at(-1).text, /broken up/);
});

test("naval base: a bulletin and a daily report", () => {
  const w = featureWorld(["ports.naval-base"]);
  const c = w.company("A", navalBases(w.e)[0]);
  assert.equal(w.act(c, "ports.naval-base", "report").ok, true);
  assert.equal(w.act(c, "ports.naval-base", "report").ok, false);
  assert.match(w.e.features.cards(c.id)["ports.naval-base"].cards[0].detail, /Patrol bulletin/);
});

test("museum and skyline: deliveries grow skylines", () => {
  const w = featureWorld(["ports.skyline", "ports.museum"]);
  const c = w.company("A"), s = firstShip(w, c);
  c.cash = 100_000;
  const dest = w.reachable(s.port);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "grain", qty: 60 } }).ok
    || w.run({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "fuel", qty: 60 } }).ok, true);
  w.hours(s.arriveTick - w.e.tick);
  assert.ok(world(w, "ports.skyline").levels[dest] >= 1);
  assert.equal(w.e.features.cards(c.id)["ports.museum"].cards.length, 1);
});

test("minigames: stacking and crane scores, three tries a day, records kept", () => {
  assert.equal(stackScore([9, 8, 7, 6, 5, 4, 3, 2], [0, 1, 2, 0, 1, 2, 0, 1]), 95);
  assert.equal(stackScore([1, 9, 1, 1, 1, 1, 1, 1], [0, 0, 1, 1, 1, 2, 2, 2]), 85);
  assert.equal(craneScore([5, 5], [1, -1], [4, 6]), 100);
  const w = featureWorld(["ports.minigames", "ports.museum"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ports.minigames", "stack", { columns: [0, 1] }).ok, false);
  assert.equal(w.act(c, "ports.minigames", "stack", { columns: [0, 1, 2, 0, 1, 2, 0, 3] }).ok, false);
  assert.equal(w.act(c, "ports.minigames", "stack", { c0: 0, c1: 1, c2: 2, c3: 0, c4: 1, c5: 2, c6: 0, c7: 1 }).ok, true);
  const d = Math.floor(w.e.tick / 24), p = craneFor(c.id, d);
  assert.equal(w.act(c, "ports.minigames", "crane", { drops: p.targets.map((t, i) => Math.max(0, Math.min(20, t - p.wind[i]))) }).ok, true);
  assert.ok(view(w, c, "ports.minigames").crane >= 90);
  assert.equal(boxesFor(c.id, d).length, 8);
  w.act(c, "ports.minigames", "stack", { columns: [0, 0, 0, 0, 0, 0, 0, 0] });
  w.act(c, "ports.minigames", "stack", { columns: [0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(w.act(c, "ports.minigames", "stack", { columns: [0, 0, 0, 0, 0, 0, 0, 0] }).ok, false, "three tries");
  assert.ok(world(w, "ports.minigames").records.crane >= 90);
});

test("site lists are deterministic and non-empty", () => {
  const a = featureWorld(), b = featureWorld();
  for (const salt of [11, 31, 37, 43, 61, 89, 103, 107, 137, 139, 149]) {
    assert.deepEqual(sites(a.e, salt, 0.3), sites(b.e, salt, 0.3));
    assert.ok(sites(a.e, salt, 0.3).length >= 1);
  }
});

test("every ports module gives cards, views and world data without throwing", () => {
  const w = featureWorld(ALL_PORTS);
  const c = w.company("A");
  w.hours(30);
  const cards = w.e.features.cards(c.id);
  assert.ok(Object.keys(cards).length >= 15);
  w.e.features.view(c.id);
  JSON.stringify(w.e.features.world());
});

test("every ports module together replays exactly", () => {
  assertReplays(ALL_PORTS, w => {
    const a = w.company("A"), b = w.company("B", w.reachable(0));
    const s = firstShip(w, a), t = firstShip(w, b);
    a.cash += 0;
    w.act(a, "ports.cranes", "pilot", { ship: s.id });
    w.act(a, "ports.tavern", "hire", { ship: s.id, crew: 4 });
    w.act(b, "ports.stalls", "open", { port: t.port, banner: 1 });
    w.act(b, "ports.strikes", "join");
    w.act(a, "ports.bank-effects", "deposit", { amount: 500 });
    w.act(a, "ports.minigames", "stack", { columns: [0, 1, 2, 0, 1, 2, 0, 1] });
    w.act(b, "ports.festivals", "parade");
    w.act(a, "ports.docks", "bookPriority", { ship: s.id });
    w.act(b, "ports.rumours", "buy", { port: t.port, good: "fuel" });
    w.run({ type: "sail", company: a.id, ship: s.id, dest: w.reachable(s.port), buy: { good: "grain", qty: 10 } });
    w.run({ type: "sail", company: b.id, ship: t.id, dest: w.reachable(t.port) });
    w.hours(100);
    w.act(a, "ports.customs-queue", "declare", { ship: s.id });
    w.hours(50);
  });
});
