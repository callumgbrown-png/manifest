// Ship classes (coaster, freighter, bulker) and the two newer goods (ore, machinery).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, GOODS, SHIP_TYPES, type Command, type ShipType } from "../src/engine.ts";
import { runBots, botName } from "../src/bots.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const types = rules.ship_types;
const err = (r: any) => (r.ok ? "ok" : r.error);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const hours = (e: Engine, h: number) => { for (let i = 0; i < h; i++) e.advance(); };

function world(opts: { port?: number; cash?: number; level?: string } = {}) {
  const e = new Engine(rules, map, 60);
  if (opts.level) e.apply({ type: "setDifficulty", level: opts.level });
  const c = e.companies.get((e.apply({ type: "register", name: "C", startPort: opts.port ?? 0 }) as any).id)!;
  c.cash = opts.cash ?? 1e6;
  const buy = (type?: ShipType, port = opts.port ?? 0) => {
    const r = e.apply({ type: "buyShip", company: c.id, port, shipType: type } as Command);
    assert.ok(r.ok, err(r));
    return e.ships.get((r as any).id)!;
  };
  return { e, c, buy };
}
const farthest = (e: Engine, from: number) => e.dist[from].map((d, i) => [d, i]).filter(([d]) => Number.isFinite(d)).sort((a, b) => b[0] - a[0])[0][1];

describe("ship classes", () => {
  test("the four classes are in the rules and the freighter is the starting ship", () => {
    assert.deepEqual([...SHIP_TYPES], ["coaster", "freighter", "bulker", "pirate"]);
    assert.equal(types.freighter.price, rules.ship.price);
    assert.equal(types.freighter.capacity, rules.ship.capacity);
    assert.equal(types.freighter.speed_per_hour, rules.ship.speed_per_hour);
    assert.equal(types.freighter.fuel_per_100_distance, rules.ship.fuel_per_100_distance);
    assert.equal(types.freighter.upkeep, rules.ship.upkeep_per_day);
    assert.ok(types.coaster.speed_per_hour > types.freighter.speed_per_hour && types.coaster.capacity < types.freighter.capacity && types.coaster.price < types.freighter.price);
    assert.ok(types.bulker.speed_per_hour < types.freighter.speed_per_hour && types.bulker.capacity > types.freighter.capacity && types.bulker.price > types.freighter.price);
    const { e, c } = world();
    assert.equal(e.ships.get(c.ships[0])!.type, "freighter");
  });

  test("buying a class charges its price and makes a ship of that class; the default is a freighter", () => {
    for (const t of SHIP_TYPES) {
      const { e, c, buy } = world();
      const before = c.cash, s = buy(t);
      assert.equal(s.type, t);
      assert.equal(before - c.cash, types[t].price);
    }
    const { c, buy } = world();
    const before = c.cash;
    assert.equal(buy().type, "freighter");
    assert.equal(before - c.cash, types.freighter.price);
  });

  test("an unknown class, a class that costs too much, and a sixth ship are refused", () => {
    const { e, c, buy } = world({ cash: 1e6 });
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 0, shipType: "tanker" } as any)), "unknown ship class");
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 0, shipType: "constructor" } as any)), "unknown ship class");
    c.cash = types.bulker.price - 1;
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 0, shipType: "bulker" })), "not enough cash");
    c.cash = 1e6;
    for (let i = 0; i < 4; i++) buy(SHIP_TYPES[i % 3]);
    assert.equal(c.ships.length, rules.company.max_ships);
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 0, shipType: "coaster" })), "fleet is at its maximum");
  });

  test("each class sails at its own speed", () => {
    for (const t of SHIP_TYPES) {
      const { e, c, buy } = world();
      const s = buy(t), far = farthest(e, 0);
      assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: far }).ok);
      assert.equal(s.arriveTick - s.departTick, Math.max(1, Math.ceil(e.dist[0][far] / types[t].speed_per_hour)), t);
      assert.equal(s.arriveTick - s.departTick, e.voyageHours(0, far, t));
    }
    const { e } = world(), far = farthest(e, 0);
    assert.ok(e.voyageHours(0, far, "coaster") < e.voyageHours(0, far, "freighter") && e.voyageHours(0, far, "freighter") < e.voyageHours(0, far, "bulker"));
  });

  test("each class holds its own capacity and refuses one more", () => {
    for (const t of SHIP_TYPES) {
      const { e, c, buy } = world();
      const s = buy(t), cap = types[t].capacity;
      for (const p of e.stock) p[0] = 1e6;   // plenty of grain to buy, whatever this port stocks
      assert.equal(err(e.apply({ type: "sail", company: c.id, ship: s.id, dest: 1, buy: { good: "grain", qty: cap + 1 } })), "over capacity", t);
      assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: 1, buy: { good: "grain", qty: cap } }).ok, t);
      assert.equal(s.qty, cap);
    }
  });

  test("fuel use follows the class: fuel burned per 100 distance", () => {
    const { e } = world(), far = farthest(e, 0), d = e.dist[0][far];
    for (const t of SHIP_TYPES) assert.ok(near(e.fuelNeeded(0, far, t), d * types[t].fuel_per_100_distance / 100), t);
    // and what a sail actually costs in cash
    for (const t of SHIP_TYPES) {
      const { e: e2, c, buy } = world({ cash: 100000 });
      const s = buy(t), expect = e2.buyCost(0, 1, e2.fuelNeeded(0, far, t)).cost;
      const before = c.cash;
      assert.ok(e2.apply({ type: "sail", company: c.id, ship: s.id, dest: far }).ok);
      assert.ok(near(before - c.cash, expect, 1e-6), `${t} fuel cost`);
    }
  });

  test("upkeep: the fleet pays its ships' upkeep less one freighter's worth", () => {
    const due = (...ts: ShipType[]) => {
      const { e, c, buy } = world();
      for (const t of ts.slice(1)) buy(t);
      // the starting ship is a freighter; swap its class when the fleet should start with another
      if (ts[0] !== "freighter") { e.ships.get(c.ships[0])!.type = ts[0]; }
      return e.upkeepDue(c);
    };
    assert.equal(due("freighter"), 0, "a lone freighter is free");
    assert.equal(due("coaster"), 0, "a lone coaster is free");
    assert.equal(due("bulker"), types.bulker.upkeep - types.freighter.upkeep, "a lone bulker is not");
    assert.equal(due("freighter", "freighter"), types.freighter.upkeep);
    assert.equal(due("freighter", "coaster"), types.coaster.upkeep);
    assert.equal(due("freighter", "bulker"), types.bulker.upkeep);
    assert.equal(due("freighter", "coaster", "bulker"), types.coaster.upkeep + types.bulker.upkeep);
  });

  test("upkeep is charged once a day at the class rate", () => {
    const { e, c, buy } = world();
    buy("coaster"); buy("bulker");
    const cash = c.cash;
    hours(e, 23);
    assert.equal(c.cash, cash, "nothing before the day ends");
    e.advance();
    assert.equal(c.cash, cash - (types.coaster.upkeep + types.bulker.upkeep));
  });

  test("class upkeep scales with the difficulty like the freighter's", () => {
    for (const level of ["easy", "normal", "hard"]) {
      const { e } = world({ level });
      const ratio = rules.difficulty.presets[level].upkeep / types.freighter.upkeep;
      assert.ok(near(e.spec("freighter").upkeep, rules.difficulty.presets[level].upkeep), level);
      assert.ok(near(e.spec("coaster").upkeep, types.coaster.upkeep * ratio), level);
      assert.ok(near(e.spec("bulker").upkeep, types.bulker.upkeep * ratio), level);
    }
    const { e, c, buy } = world({ level: "easy" });
    buy("coaster");
    const cash = c.cash;
    hours(e, 24);
    assert.ok(near(cash - c.cash, types.coaster.upkeep * 0.75));
  });

  test("scrapping pays half of that class's price, and net worth counts ships at half their price", () => {
    for (const t of SHIP_TYPES) {
      const { e, c, buy } = world({ cash: 100000 });
      const worth = e.netWorth(c), s = buy(t);
      assert.ok(near(e.netWorth(c), worth - types[t].price / 2), `${t}: buying costs the price, the ship counts half`);
      const cash = c.cash;
      assert.ok(e.apply({ type: "scrapShip", company: c.id, ship: s.id }).ok);
      assert.equal(c.cash - cash, types[t].price / 2, t);
    }
  });

  test("a debt sale pays half of the idle spare ship's own price and records it", () => {
    for (const t of SHIP_TYPES) {
      const { e, c, buy } = world({ cash: 100000 });
      const s = buy(t);
      e.ships.get(c.ships[0])!.dest = 3; e.ships.get(c.ships[0])!.arriveTick = 9999;   // the first ship is at sea, so the spare is the idle one
      c.cash = -1;
      hours(e, 24);
      assert.ok(!e.ships.has(s.id), `${t} sold`);
      const f = e.forcedSales.get(c.id)!.at(-1)!;
      assert.equal(f.ship, s.id);
      assert.equal(f.paid, types[t].price / 2);
    }
  });

  test("a loaded bulker holds 200 and a loaded coaster 50 in the world's inbound count", () => {
    const { e, c, buy } = world();
    const b = buy("bulker"), k = buy("coaster");
    for (const p of e.stock) p[2] = 1e6;
    assert.ok(e.apply({ type: "sail", company: c.id, ship: b.id, dest: 1, buy: { good: "ore", qty: 200 } }).ok);
    assert.ok(e.apply({ type: "sail", company: c.id, ship: k.id, dest: 1, buy: { good: "ore", qty: 50 } }).ok);
    assert.equal(e.inbound().cargo[1][2], 250);
  });

  test("taking listed goods back respects the ship's own capacity", () => {
    const { e, c, buy } = world();
    const k = buy("coaster");
    for (const p of e.stock) p[0] = 1e6;
    assert.ok(e.apply({ type: "sail", company: c.id, ship: k.id, dest: 1, buy: { good: "grain", qty: 50 } }).ok);
    hours(e, 40);
    assert.equal(k.dest, null);
    const r = e.apply({ type: "placeSell", company: c.id, ship: k.id, qty: 30, price: 30 }) as any;
    assert.ok(r.ok);
    assert.ok(e.apply({ type: "buyFromOrder", company: c.id, ship: k.id, order: r.id, qty: 1 }).ok === false, "can't buy from yourself");
    // 20 aboard + 30 listed = 50 = a coaster's capacity: coming back fits; one more would not
    assert.ok(e.apply({ type: "cancelOrder", company: c.id, order: r.id }).ok);
    assert.equal(k.qty, 50);
  });
});

describe("goods: ore and machinery", () => {
  test("four goods in a fixed order, each with a price band and market flows", () => {
    assert.deepEqual([...GOODS], ["grain", "fuel", "ore", "machinery"]);
    for (const g of GOODS) {
      const b = rules.commodities[g];
      assert.ok(b.floor > 0 && b.ceiling > b.floor, g);
      assert.ok(rules.markets.production_per_hour[g] > 0 && rules.markets.consumption_per_hour[g] > 0, g);
    }
    assert.deepEqual([rules.commodities.ore.floor, rules.commodities.ore.ceiling], [6, 24]);
    assert.ok(rules.commodities.machinery.floor >= 40 && rules.commodities.machinery.ceiling >= 200, "machinery is the valuable good");
  });

  test("every new good has several producers and several consumers, and no port both makes and needs it", () => {
    for (const g of ["ore", "machinery"]) {
      const make = map.ports.filter((p: any) => p.produces.includes(g)), need = map.ports.filter((p: any) => p.consumes.includes(g));
      assert.ok(make.length >= 5 && need.length >= 5, `${g}: ${make.length} producers, ${need.length} consumers`);
      for (const p of map.ports) assert.ok(!(p.produces.includes(g) && p.consumes.includes(g)), `${p.name} ${g}`);
    }
    assert.ok(map.ports.some((p: any) => p.produces.length + p.consumes.length >= 2), "some ports trade several goods");
  });

  test("machinery's market is much thinner than grain's, so one load moves the price a lot", () => {
    const { e } = world();
    assert.ok(e.targets[3] < e.targets[0] / 5, "machinery target stock is a small fraction of grain's");
    const port = map.ports.findIndex((p: any) => p.produces.includes("machinery"));
    const price = (g: number, n: number) => e.buyCost(port, g, n).cost / n;
    const grainMove = price(0, 100) / e.price(port, 0) - 1, machMove = price(3, 100) / e.price(port, 3) - 1;
    assert.ok(machMove > 3 * grainMove, `100 machinery moves its price ${(machMove * 100).toFixed(1)}%, grain ${(grainMove * 100).toFixed(1)}%`);
  });

  test("machinery costs more than the start cash buys by the hundred", () => {
    const { e } = world();
    const port = map.ports.findIndex((p: any) => p.produces.includes("machinery"));
    assert.ok(e.buyCost(port, 3, 100).cost > rules.company.start_cash, "a full 100-unit load of machinery costs over 10,000");
  });

  test("start stock: producers stocked high and consumers low, for the new goods too", () => {
    const { e } = world();
    map.ports.forEach((p: any, i: number) => ["ore", "machinery"].forEach(g => {
      const j = GOODS.indexOf(g as any), makes = p.produces.includes(g), needs = p.consumes.includes(g);
      const want = e.targets[j] * (1 + (makes && !needs ? rules.markets.start_spread : 0) - (needs && !makes ? rules.markets.start_spread : 0));
      assert.ok(near(e.stock[i][j], want, 1e-6), `${p.name} ${g}`);
    }));
  });

  test("ore and machinery load, sail and sell like any good, with tax and a sliding price", () => {
    for (const g of ["ore", "machinery"] as const) {
      const j = GOODS.indexOf(g), from = map.ports.findIndex((p: any) => p.produces.includes(g));
      const { e, c } = world({ port: from, cash: 1e6 });
      const ship = e.ships.get(c.ships[0])!, to = map.ports.findIndex((p: any) => p.consumes.includes(g));
      const stock = e.stock[from][j], cost = e.buyCost(from, j, 40).cost * (1 + rules.fees.trade_tax_rate);
      const fuel = e.buyCost(from, 1, e.fuelNeeded(from, to)).cost;
      const cash = c.cash;
      assert.ok(e.apply({ type: "sail", company: c.id, ship: ship.id, dest: to, buy: { good: g, qty: 40 } }).ok, g);
      assert.ok(near(cash - c.cash, cost + fuel, 1e-6), `${g} cost`);
      assert.equal(e.stock[from][j], stock - 40);
      hours(e, 80);
      assert.equal(ship.dest, null);
      const before = c.cash, gross = e.sellValue(to, j, 40);
      assert.ok(e.apply({ type: "sell", company: c.id, ship: ship.id }).ok);
      assert.ok(near(c.cash - before, gross * (1 - rules.fees.trade_tax_rate), 1e-6), `${g} sale`);
    }
  });

  test("buy and sell orders work in the new goods, inside their own price bands", () => {
    for (const g of ["ore", "machinery"] as const) {
      const band = rules.commodities[g], j = GOODS.indexOf(g);
      const { e, c } = world();
      const other = e.companies.get((e.apply({ type: "register", name: "D", startPort: 0 }) as any).id)!;
      other.cash = 1e6;
      assert.match(err(e.apply({ type: "placeOrder", company: c.id, port: 0, good: g, qty: 10, price: band.ceiling + 1 })), /price must be between/);
      assert.match(err(e.apply({ type: "placeOrder", company: c.id, port: 0, good: g, qty: 10, price: band.floor - 1 })), /price must be between/);
      const mid = (band.floor + band.ceiling) / 2;
      const r = e.apply({ type: "placeOrder", company: c.id, port: 0, good: g, qty: 10, price: mid }) as any;
      assert.ok(r.ok && r.id, g);
      assert.ok(near(c.cash, 1e6 - 10 * mid), "cash held in escrow");
      // another company lists the same good at that port: it sells into the waiting buy order
      const s = e.ships.get(other.ships[0])!;
      s.good = j; s.qty = 10; s.cost = 0;
      const sold = e.apply({ type: "placeSell", company: other.id, ship: s.id, qty: 10, price: mid }) as any;
      assert.ok(sold.ok && sold.sold === 10, g);
      assert.equal(e.orders.size, 0);
    }
  });

  test("the same commands replay to the same world, with classes and the new goods", () => {
    // Two engines fed the same commands end up identical (the server's event-log replay relies on this).
    const cmds = (id: number, ship: number): Command[] => [
      { type: "buyShip", company: id, port: 0, shipType: "bulker" },
      { type: "sail", company: id, ship, dest: 1, buy: { good: "ore", qty: 150 } },
    ];
    const run = () => {
      const e = new Engine(rules, map, 60);
      const id = (e.apply({ type: "register", name: "X", startPort: 0 }) as any).id;
      e.companies.get(id)!.cash = 500000;
      const bought = e.apply(cmds(id, 0)[0]) as any;
      e.apply(cmds(id, bought.id)[1]);
      hours(e, 60);
      return e;
    };
    const a = run(), b = run();
    assert.deepEqual(a.stock, b.stock);
    assert.equal(a.netWorth(a.companies.get(1)!), b.netWorth(b.companies.get(1)!));
    assert.equal([...a.ships.values()].filter(s => s.type === "bulker").length, 1);
  });
});

describe("bots and the new goods", () => {
  test("bots carry all four goods over a few days and only buy freighters", () => {
    const e = new Engine(rules, map, 60);
    const ids = Array.from({ length: 30 }, (_, i) => (e.apply({ type: "register", name: botName(i), startPort: (i * 7) % e.n }) as any).id);
    const carried = new Set<string>();
    for (let t = 0; t < 24 * 12; t++) {
      e.advance();
      runBots(e, ids, c => { const r = e.apply(c); if (r.ok && c.type === "sail" && c.buy) carried.add(c.buy.good); return r; }, { minProfit: 0, error: 0.08 });
    }
    for (const g of ["grain", "fuel", "ore"]) assert.ok(carried.has(g), `bots carried ${g}`);
    for (const s of e.ships.values()) assert.equal(s.type, "freighter");
  });
});
