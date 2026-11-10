// Tests for the economy feature modules (ideas 1-20, 201-220 and 281-300). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import type { Company, Ship } from "../src/engine.ts";
import { CARGO, type CargoApi } from "../src/features/economy/cargo.ts";
import { CHAINS } from "../src/features/economy/chains.ts";
import { addLot, lotOf } from "../src/features/economy/specialty.ts";
import { bulkDiscount, RENT_PER_TONNE_HOUR } from "../src/features/economy/trading.ts";
import { BALLAST_FUEL, freightRate, TOLL } from "../src/features/economy/lanes.ts";
import { harvestPhase, GRAIN_SPOIL_PER_HOUR, MFG_HOURS } from "../src/features/economy/production.ts";
import { LOAN_RATE_PER_DAY } from "../src/features/economy/finance.ts";
import { PRESTIGE } from "../src/features/economy/policy.ts";
import { regions } from "../src/features/economy/util.ts";

type World = ReturnType<typeof featureWorld>;
const CFG = JSON.parse(readFileSync(new URL("../../config/features/economy.json", import.meta.url), "utf8")) as Record<string, unknown>;
const ALL = Object.keys(CFG).filter(k => k.startsWith("economy."));
const ON = ["economy.price-history", "economy.price-ticker", "economy.chain-bread", "economy.cargo-electronics"];

const GRAIN = 0, FUEL = 1, ORE = 2, MACHINERY = 3;
const ship = (w: World, c: Company): Ship => w.e.ships.get(c.ships[0])!;
const load = (s: Ship, good: number, qty: number, cost = qty * 10) => { s.good = good; s.qty = qty; s.cost = cost; };
const mod = <T>(w: World, id: string) => w.e.features.modules.get(id) as unknown as T;
const worldOf = <T>(w: World, id: string) => w.e.features.world()[id] as T;
const viewOf = <T>(w: World, c: Company, id: string) => w.e.features.view(c.id)[id] as T;
const err = (r: unknown) => String((r as { error?: string }).error);
/** Sail laden to the first reachable port, sell there, and let the hour pass so trip watchers see it. */
function tradeTrip(w: World, c: Company, s: Ship, dest = w.reachable(s.port)) {
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "grain", qty: 20 } }).ok, true);
  while (s.dest !== null) w.hours(1);
  assert.equal(w.run({ type: "sell", company: c.id, ship: s.id }).ok, true);
  w.hours(1);
}

test("every economy idea has a module, and the switch file lists every module (economy off)", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("economy."));
  const ideas = new Set(mods.flatMap(m => m.ideas));
  const assigned = readFileSync(new URL("../../docs/features/assignments/economy.txt", import.meta.url), "utf8")
    .split("\n").map(l => /^(\d+)\./.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.equal(assigned.length, 60);
  for (const i of assigned) assert.ok(ideas.has(i), `idea ${i} has no module`);
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL].sort());
  for (const m of mods) assert.equal(CFG[m.id], !m.economy, m.id);
  assert.deepEqual(mods.filter(m => !m.economy).map(m => m.id).sort(), [...ON].sort());
});

// ------------------------------------------------------------ market

test("price history keeps a daily series and can watch any port", () => {
  const w = featureWorld(["economy.price-history"]);
  const c = w.company("A");
  w.hours(48);
  const v = viewOf<{ watching: number; ports: Record<number, number[][]> }>(w, c, "economy.price-history");
  assert.equal(v.watching, c.home);
  assert.equal(v.ports[c.home][GRAIN].length, 3 + 1);   // start, day 1, day 2, now
  assert.equal(w.act(c, "economy.price-history", "watch", { port: 3 }).ok, true);
  assert.ok(viewOf<{ ports: Record<number, unknown> }>(w, c, "economy.price-history").ports[3]);
  assert.equal(w.act(c, "economy.price-history", "watch", { port: 999 }).ok, false);
  assert.equal(w.act(c, "economy.price-history", "watch", { port: "3" }).ok, false);
});

test("the commodity index ticker reports a day's change", () => {
  const w = featureWorld(["economy.price-ticker"]);
  w.hours(2);
  for (let p = 0; p < w.e.n; p++) w.e.stock[p][FUEL] = 0;
  const t = worldOf<{ items: { good: string; change: number }[]; headline: string }>(w, "economy.price-ticker");
  assert.equal(t.items.length, 4);
  assert.ok(t.items[FUEL].change > 10);
  assert.match(t.headline, /fuel up/);
});

test("demand curves: cheap goods are used up faster at consumer ports", () => {
  const port = 4;   // consumes grain
  const run = (on: boolean) => {
    const w = featureWorld(on ? ["economy.demand-curves"] : []);
    w.e.stock[port][GRAIN] = w.e.targets[GRAIN] * 1.8;
    w.hours(1);
    return w.e.stock[port][GRAIN];
  };
  assert.ok(run(true) < run(false));
});

test("saturation: a flood of cargo drops the price further, then recovers", () => {
  const run = (on: boolean, hours: number) => {
    const w = featureWorld(on ? ["economy.saturation"] : []);
    w.hours(1);
    w.e.stock[3][ORE] = w.e.targets[ORE] * 0.6;   // a dear market...
    w.hours(1);
    w.e.stock[3][ORE] += w.e.targets[ORE] * 0.5;  // ...flooded by a big sale
    w.hours(hours);
    return w.e.price(3, ORE);
  };
  assert.ok(run(true, 1) < run(false, 1));
  assert.ok(run(true, 60) - run(false, 60) > run(true, 1) - run(false, 1), "glut drains away");
});

test("rumours are posted daily", () => {
  const w = featureWorld(["economy.rumours"]);
  w.hours(24 * 3);
  const r = worldOf<{ rumours: { text: string }[] }>(w, "economy.rumours").rumours;
  assert.equal(r.length, 3);
  assert.match(r[0].text, /about to/);
});

test("a market crash floods every port with one good", () => {
  const w = featureWorld(["economy.crashes"]);
  const before = w.e.price(5, GRAIN);
  mod<{ crash(g: number): void }>(w, "economy.crashes").crash(GRAIN);
  assert.ok(w.e.price(5, GRAIN) < before);
  assert.match(worldOf<{ text: string }>(w, "economy.crashes").text, /grain/);
});

test("price caps release reserves in an emergency", () => {
  const w = featureWorld(["economy.price-caps"]);
  for (let p = 0; p < w.e.n; p++) w.e.stock[p][FUEL] = 0;
  w.hours(1);
  assert.deepEqual(worldOf<{ emergency: string[] }>(w, "economy.price-caps").emergency, ["fuel"]);
  assert.ok(w.e.stock[0][FUEL] > 0);
});

// ------------------------------------------------------------ trading desks

test("the bulk desk sells big lots at a discount", () => {
  const w = featureWorld(["economy.bulk-discounts"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(bulkDiscount(100), 0.1);
  const list = w.e.buyCost(s.port, GRAIN, 100).cost * (1 + w.e.tradeRate(s.port, GRAIN, "buy", 0.07));
  const r = w.act(c, "economy.bulk-discounts", "buy", { ship: s.id, good: GRAIN, qty: 100 }) as { spent: number };
  assert.ok(Math.abs(r.spent - list * 0.9) < 0.01);
  assert.equal(s.qty, 100);
  assert.equal(w.act(c, "economy.bulk-discounts", "buy", { ship: s.id, good: GRAIN, qty: 50 }).ok, false, "hold full");
  assert.equal(w.act(c, "economy.bulk-discounts", "buy", { ship: s.id, good: 7, qty: 50 }).ok, false);
  assert.equal(w.act(c, "economy.bulk-discounts", "buy", { ship: 999, good: GRAIN, qty: 50 }).ok, false);
});

test("black-market ports buy cargo at odd prices, sometimes raided", () => {
  const w = featureWorld(["economy.black-market"]);
  const c = w.company("A"), s = ship(w, c);
  const { ports, factors } = worldOf<{ ports: number[]; factors: number[][] }>(w, "economy.black-market");
  assert.equal(ports.length, 3);
  assert.ok(factors.flat().every(f => f >= 0.5 && f <= 1.9));
  s.port = ports.includes(0) ? ports.find(p => p !== 0)! : 0;
  if (ports.includes(s.port)) s.port = w.e.n - 1;
  load(s, GRAIN, 50);
  if (!ports.includes(s.port)) assert.equal(w.act(c, "economy.black-market", "fence", { ship: s.id }).ok, false);
  s.port = ports[0];
  const cash = c.cash;
  assert.equal(w.act(c, "economy.black-market", "fence", { ship: s.id }).ok, true);
  assert.equal(s.qty, 0);
  assert.ok(c.cash >= cash);
});

test("futures lock a price; delivered on time they pay, missed they forfeit the margin", () => {
  const w = featureWorld(["economy.futures"]);
  const c = w.company("A"), s = ship(w, c);
  const price = w.e.price(s.port, GRAIN);
  const r = w.act(c, "economy.futures", "open", { good: GRAIN, port: s.port, qty: 50, days: 2 }) as { id: number; spent: number };
  assert.equal(r.spent, Math.ceil(price * 50 * 0.2));
  w.e.stock[s.port][GRAIN] = 0;   // price jumps: the contract keeps the old price
  load(s, GRAIN, 60);
  const cash = c.cash;
  assert.equal(w.act(c, "economy.futures", "deliver", { contract: r.id, ship: s.id }).ok, true);
  assert.ok(Math.abs(c.cash - cash - (Math.round(price * 100) / 100 * 50 + r.spent)) < 0.01);
  assert.equal(s.qty, 10);
  const lost = w.act(c, "economy.futures", "open", { good: ORE, port: 3, qty: 20, days: 2 }) as { spent: number };
  const before = c.cash;
  w.hours(49);
  assert.equal(c.cash, before);
  assert.equal(viewOf<{ open: unknown[] }>(w, c, "economy.futures").open.length, 0);
  assert.ok(lost.spent > 0);
  assert.equal(w.act(c, "economy.futures", "open", { good: GRAIN, port: 0, qty: 5, days: 2 }).ok, false);
  assert.equal(w.act(c, "economy.futures", "open", { good: GRAIN, port: 0, qty: 50, days: 30 }).ok, false);
});

test("warehouses store cargo for rent and give it back", () => {
  const w = featureWorld(["economy.warehouses"]);
  const c = w.company("A"), s = ship(w, c);
  load(s, ORE, 100, 800);
  assert.equal(w.act(c, "economy.warehouses", "store", { ship: s.id, qty: 40 }).ok, true);
  assert.equal(s.qty, 60);
  const cash = c.cash;
  w.hours(10);
  assert.ok(Math.abs(cash - c.cash - 40 * RENT_PER_TONNE_HOUR * 10) < 1e-6);
  assert.equal(w.act(c, "economy.warehouses", "withdraw", { ship: s.id, good: ORE, qty: 41 }).ok, false);
  assert.equal(w.act(c, "economy.warehouses", "withdraw", { ship: s.id, good: ORE, qty: 40 }).ok, true);
  assert.equal(s.qty, 100);
  assert.equal(w.act(c, "economy.warehouses", "store", { ship: s.id, qty: 0 }).ok, false);
});

test("speculation positions follow the price index", () => {
  const w = featureWorld(["economy.speculation"]);
  const c = w.company("A");
  const r = w.act(c, "economy.speculation", "open", { good: GRAIN, side: "long", stake: 1000 }) as { id: number };
  assert.equal(r.id, 1);
  for (let p = 0; p < w.e.n; p++) w.e.stock[p][GRAIN] *= 1.5;   // grain index falls
  const cash = c.cash;
  const out = w.act(c, "economy.speculation", "close", { position: r.id }) as { earned: number };
  assert.ok(out.earned < 1000 && c.cash === cash + out.earned);
  assert.equal(w.act(c, "economy.speculation", "open", { good: GRAIN, side: "sideways", stake: 1000 }).ok, false);
  assert.equal(w.act(c, "economy.speculation", "close", { position: 1 }).ok, false);
});

// ------------------------------------------------------------ lanes and borders

test("tariffs charge laden ships crossing island groups", () => {
  const w = featureWorld(["economy.tariffs"]);
  const c = w.company("A"), s = ship(w, c);
  const r = regions(w.e), other = r.findIndex(x => x !== r[0]), same = r.findIndex((x, i) => i > 0 && x === r[0]);
  const fee = (dest: number) => w.e.features.adjust("portFee", 25, { ship: s.id, company: c.id, from: 0, dest });
  assert.equal(fee(other), 25, "empty ships pay no tariff");
  load(s, GRAIN, 50, 1000);
  assert.equal(fee(other), 25 + 50);
  assert.equal(fee(same), 25);
});

test("embargoes fine laden ships between the embargoed groups", () => {
  const w = featureWorld(["economy.embargoes"]);
  const c = w.company("A"), s = ship(w, c);
  const r = regions(w.e), dest = r.findIndex(x => x !== r[0]);
  mod<{ set(a: number, b: number, d: number): void }>(w, "economy.embargoes").set(r[0], r[dest], 2);
  load(s, GRAIN, 50, 1000);
  assert.equal(w.e.features.adjust("portFee", 25, { ship: s.id, company: c.id, from: 0, dest }), 25 + 300);
  assert.match(worldOf<{ text: string }>(w, "economy.embargoes").text, /Embargo/);
  w.hours(49);
  assert.equal(w.e.features.adjust("portFee", 25, { ship: s.id, company: c.id, from: 0, dest }), 25);
});

test("currencies add an exchange fee where the money is weak or strong", () => {
  const w = featureWorld(["economy.currencies"]);
  const rates = mod<{ rates: number[] }>(w, "economy.currencies").rates;
  const port = 0, g = regions(w.e)[port];
  rates[g] = 0.8;
  assert.ok(Math.abs(w.e.tradeRate(port, GRAIN, "sell", 0.07) - 0.17) < 1e-9);
  assert.equal(w.e.tradeRate(port, GRAIN, "buy", 0.07), 0.07);
  w.hours(24 * 5);
  assert.ok(rates.every(x => x >= 0.8 && x <= 1.25));
});

test("toll gates go up on the busiest lanes", () => {
  const w = featureWorld(["economy.tolls"]);
  const a = w.company("A"), b = w.company("B");
  const dest = w.reachable(0);
  for (const c of [a, b]) { const s = ship(w, c); s.dest = dest; s.departTick = 0; s.arriveTick = 10_000; }
  w.hours(24);
  assert.deepEqual(worldOf<{ lanes: string[] }>(w, "economy.tolls").lanes, [`0-${dest}`]);
  assert.equal(w.e.features.adjust("portFee", 25, { ship: ship(w, a).id, company: a.id, from: dest, dest: 0 }), 25 + TOLL);
});

test("freight rates pay a bonus on quiet lanes", () => {
  const w = featureWorld(["economy.freight-rates"]);
  const c = w.company("A"), s = ship(w, c), dest = w.reachable(0);
  assert.equal(freightRate(0), 1.3);
  assert.equal(freightRate(20), 0.6);
  assert.equal(w.e.features.adjust("portFee", 25, { ship: s.id, company: c.id, from: 0, dest }), 25);
  load(s, GRAIN, 100);
  assert.ok(w.e.features.adjust("portFee", 25, { ship: s.id, company: c.id, from: 0, dest }) < 25);
});

test("a backhaul on the return lane earns a bonus", () => {
  const w = featureWorld(["economy.backhaul"]);
  const c = w.company("A"), s = ship(w, c), home = s.port, dest = w.reachable(home);
  tradeTrip(w, c, s, dest);
  assert.equal(viewOf<{ paid: number }>(w, c, "economy.backhaul").paid, 0);
  tradeTrip(w, c, s, home);
  assert.ok(viewOf<{ paid: number }>(w, c, "economy.backhaul").paid > 0);
});

test("empty legs burn less fuel and show what they cost", () => {
  const w = featureWorld(["economy.empty-legs"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.e.features.adjust("fuel", 10, { ship: s.id, from: 0, dest: 1 }), 10 * BALLAST_FUEL);
  load(s, GRAIN, 10);
  assert.equal(w.e.features.adjust("fuel", 10, { ship: s.id, from: 0, dest: 1 }), 10);
  s.port = w.reachable(0);
  assert.match(w.e.features.cards(c.id)["economy.empty-legs"].cards[0].detail, /sailing home empty/);
});

test("the first company to trade a new lane gets a subsidy", () => {
  const w = featureWorld(["economy.subsidies"]);
  const c = w.company("A"), s = ship(w, c);
  tradeTrip(w, c, s);
  assert.match(w.e.features.cards(c.id)["economy.subsidies"].cards[0].detail, /subsidy/);
  assert.equal(worldOf<{ opened: number }>(w, "economy.subsidies").opened, 1);
});

// ------------------------------------------------------------ policy

test("cartels hold back supply and can be broken up", () => {
  const port = 4;
  const run = (join: boolean) => {
    const w = featureWorld(["economy.cartels"]);
    const a = w.company("A"), b = w.company("B");
    if (join) {
      assert.equal(w.act(a, "economy.cartels", "join", { good: GRAIN }).ok, true);
      assert.equal(w.act(a, "economy.cartels", "join", { good: FUEL }).ok, false, "one cartel at a time");
      assert.equal(w.act(b, "economy.cartels", "join", { good: GRAIN }).ok, true);
    }
    w.hours(5);
    return { stock: w.e.stock[port][GRAIN], w, a };
  };
  assert.ok(run(true).stock < run(false).stock);
  const { w, a } = run(true);
  assert.equal(w.act(a, "economy.cartels", "leave").ok, true);
  assert.equal(w.act(a, "economy.cartels", "leave").ok, false);
  assert.equal(w.act(a, "economy.cartels", "join", { good: 9 }).ok, false);
});

test("antitrust fines a company that owns most of the wealth", () => {
  const w = featureWorld(["economy.antitrust"]);
  const a = w.company("A"); w.company("B"); w.company("C");
  a.cash = 500_000;
  w.hours(18);
  const cases = worldOf<{ cases: { company: number }[] }>(w, "economy.antitrust").cases;
  assert.equal(cases.length, 1);
  assert.equal(cases[0].company, a.id);
  assert.equal(a.cash, 500_000 * 0.97);
});

test("the wealth tax takes from the richest and funds festivals", () => {
  const w = featureWorld(["economy.wealth-tax"]);
  const a = w.company("A");
  a.cash = 5_000_000;
  w.hours(24);
  assert.ok(a.cash < 5_000_000);
  const v = worldOf<{ fund: number; festivals: unknown[] }>(w, "economy.wealth-tax");
  assert.equal(v.festivals.length, 1);
  assert.ok(v.fund >= 0);
});

test("money sinks: prestige items and harbour dues", () => {
  const w = featureWorld(["economy.money-sinks"]);
  const c = w.company("A");
  assert.equal(w.act(c, "economy.money-sinks", "buy", { item: "pennant" }).ok, true);
  assert.equal(c.cash, 10_000 - PRESTIGE.pennant.cost);
  assert.equal(w.act(c, "economy.money-sinks", "buy", { item: "pennant" }).ok, false);
  assert.equal(w.act(c, "economy.money-sinks", "buy", { item: "yacht" }).ok, false);
  c.cash = 200_000;
  w.hours(24);
  assert.ok(viewOf<{ dues: number }>(w, c, "economy.money-sinks").dues > 0);
});

// ------------------------------------------------------------ finance

test("port-bank loans charge interest and must stay within the limit", () => {
  const w = featureWorld(["economy.loans"]);
  const c = w.company("A");
  assert.equal(w.act(c, "economy.loans", "borrow", { amount: 7000 }).ok, false, "limit is half the fleet's value");
  assert.equal(w.act(c, "economy.loans", "borrow", { amount: 4000 }).ok, true);
  assert.equal(c.cash, 14_000);
  w.hours(24);
  const owed = viewOf<{ owed: number }>(w, c, "economy.loans").owed;
  assert.ok(Math.abs(owed - 4000 * (1 + LOAN_RATE_PER_DAY)) < 0.01);
  assert.equal(w.act(c, "economy.loans", "repay", { amount: 10_000 }).ok, true);
  assert.equal(viewOf<{ owed: number }>(w, c, "economy.loans").owed, 0);
  assert.equal(w.act(c, "economy.loans", "repay", { amount: 1 }).ok, false);
});

test("a company deep in debt can restart once with a safety net", () => {
  const w = featureWorld(["economy.safety-net"]);
  const c = w.company("A");
  assert.match(err(w.act(c, "economy.safety-net", "declare")), /debt/);
  c.cash = 100_000;
  assert.equal(w.run({ type: "buyShip", company: c.id, port: c.home }).ok, true);
  c.cash = -50_000;
  assert.equal(w.act(c, "economy.safety-net", "declare").ok, true);
  assert.equal(c.ships.length, 1);
  assert.equal(c.cash, 2500);
  c.cash = -50_000;
  assert.match(err(w.act(c, "economy.safety-net", "declare")), /already/);
});

// ------------------------------------------------------------ production

test("grain harvests flood farm ports, lean weeks drain them", () => {
  assert.equal(harvestPhase(0), "harvest");
  assert.equal(harvestPhase(24 * 5), "growing");
  assert.equal(harvestPhase(24 * 8), "lean");
  const run = (on: boolean) => { const w = featureWorld(on ? ["economy.harvests"] : []); w.hours(3); return w.e.stock[2][GRAIN]; };
  assert.ok(run(true) > run(false));
});

test("mines and wells run down; investment refills them and pays dividends", () => {
  const w = featureWorld(["economy.depletion"]);
  const c = w.company("A");
  w.hours(100);
  const site = worldOf<{ sites: { port: number; good: number; reserve: number }[] }>(w, "economy.depletion").sites[0];
  assert.equal(site.reserve, 0.9);
  assert.equal(w.act(c, "economy.depletion", "invest", { site: `${site.port}:${site.good}`, amount: 2000 }).ok, true);
  const after = worldOf<{ sites: { reserve: number }[] }>(w, "economy.depletion").sites[0].reserve;
  assert.equal(after, 1);
  const cash = c.cash;
  w.hours(1);
  assert.ok(c.cash > cash, "dividend");
  assert.equal(w.act(c, "economy.depletion", "invest", { site: "0:0", amount: 2000 }).ok, false);
  assert.equal(w.act(c, "economy.depletion", "invest", { site: `${site.port}:${site.good}`, amount: 5 }).ok, false);
});

test("oil output moves weekly within its band", () => {
  const w = featureWorld(["economy.oil-output"]);
  const seen = new Set<number>();
  for (let week = 0; week < 5; week++) { w.hours(24 * 7); seen.add(worldOf<{ level: number }>(w, "economy.oil-output").level); }
  assert.ok([...seen].every(l => l >= 0.6 && l <= 1.4));
  assert.ok(seen.size > 1);
});

test("cargo grades are set when a cargo sails", () => {
  const w = featureWorld(["economy.quality-grades"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(0), buy: { good: "grain", qty: 20 } }).ok, true);
  w.hours(1);
  const v = viewOf<{ ship: number; grade: string }[]>(w, c, "economy.quality-grades");
  assert.equal(v.length, 1);
  assert.match(v[0].grade, /^[ABC]$/);
  while (s.dest !== null) w.hours(1);
  w.run({ type: "sell", company: c.id, ship: s.id });
  w.hours(1);
  assert.equal(viewOf<unknown[]>(w, c, "economy.quality-grades").length, 0);
});

test("brands cost a fee and grow with deliveries", () => {
  const w = featureWorld(["economy.branded-goods"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.act(c, "economy.branded-goods", "register", { good: GRAIN }).ok, true);
  assert.equal(c.cash, 5000);
  assert.equal(w.act(c, "economy.branded-goods", "register", { good: FUEL }).ok, false);
  tradeTrip(w, c, s);
  assert.ok(viewOf<{ reputation: number }>(w, c, "economy.branded-goods").reputation > 0);
});

test("manufacturing contracts turn ore into machinery after a day", () => {
  const w = featureWorld(["economy.manufacturing"]);
  const c = w.company("A"), s = ship(w, c);
  s.port = 8;   // a machinery port
  load(s, ORE, 100, 600);
  const r = w.act(c, "economy.manufacturing", "commission", { ship: s.id, qty: 100 }) as { id: number };
  assert.equal(s.qty, 0);
  assert.match(err(w.act(c, "economy.manufacturing", "collect", { ship: s.id, job: r.id })), /not ready/);
  w.hours(MFG_HOURS);
  assert.equal(w.act(c, "economy.manufacturing", "collect", { ship: s.id, job: r.id }).ok, true);
  assert.equal(s.good, MACHINERY);
  assert.equal(s.qty, 50);
  s.port = 0;
  load(s, ORE, 100);
  assert.equal(w.act(c, "economy.manufacturing", "commission", { ship: s.id, qty: 100 }).ok, false, "no factory at port 0");
});

test("recycling breaks machinery into ore", () => {
  const w = featureWorld(["economy.recycling"]);
  const c = w.company("A"), s = ship(w, c);
  const yards = worldOf<{ yards: number[] }>(w, "economy.recycling").yards;
  s.port = yards[0];
  assert.equal(w.act(c, "economy.recycling", "recycle", { ship: s.id }).ok, false);
  load(s, MACHINERY, 20, 2000);
  assert.equal(w.act(c, "economy.recycling", "recycle", { ship: s.id }).ok, true);
  assert.equal(s.good, ORE);
  assert.equal(s.qty, 24);
});

test("grain spoils at sea", () => {
  const w = featureWorld(["economy.spoilage"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(0), buy: { good: "grain", qty: 50 } }).ok, true);
  w.hours(2);
  assert.ok(Math.abs(s.qty - 50 * (1 - GRAIN_SPOIL_PER_HOUR) ** 2) < 1e-9);
});

// ------------------------------------------------------------ production chains (11-15)

for (const def of CHAINS) {
  test(`chain ${def.key}: process every stage and sell the product`, () => {
    const id = `economy.chain-${def.key}`;
    const w = featureWorld([id]);
    const c = w.company("A"), s = ship(w, c);
    const works = worldOf<{ works: number[][] }>(w, id).works;
    const first = def.stages[0].input, engine = ["grain", "fuel", "ore", "machinery"].indexOf(first);
    if (engine >= 0) load(s, engine, 80, 800); else addLot(w.e, s.id, first, 80, 800);
    def.stages.forEach((st, i) => {
      s.port = works[i][0];
      const have = engine >= 0 && i === 0 ? s.qty : lotOf(w.e, s.id, st.input)!.qty;
      const qty = Math.floor(have);
      const cash = c.cash;
      assert.equal(w.act(c, id, "process", { ship: s.id, stage: i, qty }).ok, true, `${def.key} stage ${i}`);
      assert.ok(Math.abs(lotOf(w.e, s.id, st.output)!.qty - qty * st.ratio) < 1e-9);
      assert.ok(Math.abs(cash - c.cash - (def.key === "bread" ? 0 : qty * st.ratio * st.fee)) < 1e-6, "fee waived only for bread");
    });
    const product = def.stages[def.stages.length - 1].output, cash = c.cash;
    assert.equal(w.act(c, id, "sell", { ship: s.id, good: product }).ok, true);
    assert.ok(c.cash > cash);
    assert.equal(w.act(c, id, "process", { ship: s.id, stage: 99, qty: 1 }).ok, false);
    assert.equal(w.act(c, id, "sell", { ship: s.id, good: "gold" }).ok, false);
  });
}

// ------------------------------------------------------------ specialty cargo (16, 281-300)

for (const def of CARGO) {
  test(`cargo ${def.key}: load at a producer, sell, validation`, () => {
    const id = `economy.cargo-${def.key}`;
    const w = featureWorld([id]);
    const c = w.company("A"), s = ship(w, c);
    c.cash = 1_000_000;
    const api = mod<CargoApi>(w, id);
    if (!def.mail) {
      const notProducer = w.e.map.ports.map(p => p.id).find(p => !api.producers.includes(p))!;
      s.port = notProducer;
      assert.equal(w.act(c, id, "buy", { ship: s.id, qty: 5 }).ok, false, "only producers load it");
    }
    s.port = api.producers[0];
    if (def.license) {
      assert.match(err(w.act(c, id, "buy", { ship: s.id, qty: 5 })), /licence/);
      assert.equal(w.act(c, id, "license").ok, true);
    }
    assert.equal(w.act(c, id, "buy", { ship: s.id, qty: 0 }).ok, false);
    assert.equal(w.act(c, id, "buy", { ship: s.id, qty: 5.5 }).ok, false);
    assert.equal(w.act(c, id, "buy", { ship: 999, qty: 5 }).ok, false);
    assert.equal(w.act(c, id, "buy", { ship: s.id, qty: 5 }).ok, true);
    assert.equal(w.e.expansionCapacity(s), 100 - 5 * (def.space ?? 1), "the cargo takes hold space");
    const lot = lotOf(w.e, s.id, def.key)!;
    if (def.mail) {
      assert.match(err(w.act(c, id, "sell", { ship: s.id })), /mail is for/);
      s.port = lot.dest!;
    } else s.port = api.consumers[0];
    const cash = c.cash;
    assert.equal(w.act(c, id, "sell", { ship: s.id }).ok, true);
    assert.ok(c.cash > cash);
    assert.equal(lotOf(w.e, s.id, def.key), undefined);
    assert.equal(w.act(c, id, "sell", { ship: s.id }).ok, false);
  });
}

test("specialty cargo rules: perishing, breakage at sea and feed costs", () => {
  const w = featureWorld(["economy.cargo-produce", "economy.cargo-glassware", "economy.cargo-livestock"]);
  const c = w.company("A"), s = ship(w, c);
  addLot(w.e, s.id, "produce", 10, 100);
  addLot(w.e, s.id, "glassware", 10, 100);
  addLot(w.e, s.id, "livestock", 10, 100);
  w.hours(1);
  assert.ok(lotOf(w.e, s.id, "produce")!.qty < 10, "produce rots even in port");
  assert.equal(lotOf(w.e, s.id, "glassware")!.qty, 10, "glass only breaks at sea");
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(0) }).ok, true);
  const cash = c.cash;
  w.hours(1);
  assert.ok(lotOf(w.e, s.id, "glassware")!.qty < 10);
  assert.ok(c.cash < cash, "livestock is fed at sea");
});

test("mystery crates hide their value until sold", () => {
  const w = featureWorld(["economy.cargo-mystery"]);
  const c = w.company("A"), s = ship(w, c);
  s.port = mod<CargoApi>(w, "economy.cargo-mystery").producers[0];
  assert.equal(w.act(c, "economy.cargo-mystery", "buy", { ship: s.id, qty: 10 }).ok, true);
  assert.equal(c.cash, 10_000 - 600);
  const view = JSON.stringify(viewOf(w, c, "economy.cargo-mystery"));
  assert.ok(!/value/.test(view), "value is not sent to the client");
});

// ------------------------------------------------------------ replay

test("all economy modules together replay exactly", () => {
  assertReplays(ALL, w => {
    const a = w.company("A"), b = w.company("B", 5), c = w.company("C", 10);
    const s = ship(w, a);
    w.act(a, "economy.loans", "borrow", { amount: 2000 });
    w.act(b, "economy.cartels", "join", { good: GRAIN });
    w.act(c, "economy.cartels", "join", { good: GRAIN });
    w.act(a, "economy.speculation", "open", { good: FUEL, side: "short", stake: 500 });
    w.act(b, "economy.futures", "open", { good: ORE, port: 3, qty: 20, days: 3 });
    w.act(c, "economy.money-sinks", "buy", { item: "pennant" });
    w.act(a, "economy.branded-goods", "register", { good: GRAIN });
    for (let round = 0; round < 6; round++) {
      for (const co of [a, b, c]) {
        const sh = ship(w, co);
        if (sh.dest !== null) continue;
        if (sh.qty > 0) w.run({ type: "sell", company: co.id, ship: sh.id });
        w.run({ type: "sail", company: co.id, ship: sh.id, dest: w.reachable(sh.port), buy: { good: "grain", qty: 30 } });
      }
      w.hours(30);
    }
    w.act(a, "economy.speculation", "close", { position: 1 });
    w.act(a, "economy.loans", "repay", { amount: 3000 });
    const mystery = mod<CargoApi>(w, "economy.cargo-mystery");
    if (s.dest === null && mystery.producers.includes(s.port)) w.act(a, "economy.cargo-mystery", "buy", { ship: s.id, qty: 2 });
    w.act(b, "economy.cargo-mail", "buy", { ship: ship(w, b).id, qty: 3 });
    w.hours(24 * 8);
  });
});
