// Every engine rule and every refusal, one test per feature.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const tax = rules.fees.trade_tax_rate;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const err = (r: any) => (r.ok ? "ok" : r.error);
const neighbour = (p: number) => { const r = map.routes.find((r: any) => r.a === p || r.b === p); return r.a === p ? r.b : r.a; };

function world(companies = 2, port = 0, expected?: number) {
  const e = new Engine(rules, map, expected);
  const cs = Array.from({ length: companies }, (_, i) => e.companies.get((e.apply({ type: "register", name: `C${i}`, startPort: port }) as any).id)!);
  const ship = (c: (typeof cs)[number], i = 0) => e.ships.get(c.ships[i])!;
  return { e, cs, ship };
}
const hours = (e: Engine, h: number) => { for (let i = 0; i < h; i++) e.advance(); };

describe("companies", () => {
  test("start with the configured cash and one docked, empty ship", () => {
    const { e, cs, ship } = world(1, 7);
    assert.equal(cs[0].cash, rules.company.start_cash);
    assert.equal(cs[0].ships.length, rules.company.start_ships);
    assert.deepEqual({ ...ship(cs[0]) }, { id: ship(cs[0]).id, owner: cs[0].id, port: 7, dest: null, departTick: 0, arriveTick: 0, good: null, qty: 0, cost: 0 });
    assert.equal(e.netWorth(cs[0]), rules.company.start_cash + rules.ship.price / 2);
  });

  test("start port must be a real port number", () => {
    const e = new Engine(rules, map);
    for (const p of [-1, e.n, 1.5, "3", null, NaN]) assert.equal(err(e.apply({ type: "register", name: "X", startPort: p as any })), "bad start port", String(p));
  });
});

describe("sailing", () => {
  test("sailing empty only costs fuel at the local price, and uses up the port's fuel", () => {
    const { e, cs, ship } = world(1);
    const d = neighbour(0), fuel = e.fuelNeeded(0, d), stock = e.stock[0][1];
    const expected = fuel * e.price(0, 1, stock - fuel / 2);
    assert.ok(e.apply({ type: "sail", company: cs[0].id, ship: ship(cs[0]).id, dest: d }).ok);
    assert.ok(near(cs[0].cash, rules.company.start_cash - expected));
    assert.ok(near(e.stock[0][1], stock - fuel));
    assert.equal(ship(cs[0]).qty, 0);
  });

  test("fuel runs out at the ceiling price when the port is empty", () => {
    const { e, cs, ship } = world(1);
    e.stock[0][1] = 0;
    const d = neighbour(0);
    e.apply({ type: "sail", company: cs[0].id, ship: ship(cs[0]).id, dest: d });
    assert.ok(near(cs[0].cash, rules.company.start_cash - e.fuelNeeded(0, d) * rules.commodities.fuel.ceiling));
    assert.equal(e.stock[0][1], 0);
  });

  test("loading cargo charges the sliding price plus tax and takes stock", () => {
    const { e, cs, ship } = world(1);
    const d = neighbour(0), stock = e.stock[0][0];
    const cargo = e.buyCost(0, 0, 80).cost * (1 + tax);
    assert.ok(e.apply({ type: "sail", company: cs[0].id, ship: ship(cs[0]).id, dest: d, buy: { good: "grain", qty: 80.9 } }).ok);
    const s = ship(cs[0]);
    assert.equal(s.qty, 80, "quantity rounds down");
    assert.equal(s.good, 0);
    assert.ok(near(s.cost, cargo));
    assert.equal(e.stock[0][0], stock - 80);
    assert.ok(e.buyCost(0, 0, 80).cost > 80 * e.price(0, 0, stock + 1000), "buying pushes the price up");
  });

  test("voyage time comes from the sea-route distance and speed, at least one hour", () => {
    const { e, cs, ship } = world(1);
    const far = e.dist[0].indexOf(Math.max(...e.dist[0]));
    assert.ok(e.dist[0][far] > map.routes.find((r: any) => r.a === 0 || r.b === 0).distance, "multi-hop route");
    e.apply({ type: "sail", company: cs[0].id, ship: ship(cs[0]).id, dest: far });
    const s = ship(cs[0]);
    assert.equal(s.arriveTick - s.departTick, Math.ceil(e.dist[0][far] / rules.ship.speed_per_hour));
    assert.equal(e.voyageHours(0, 0), 1);
  });

  test("a company's last ship can always sail: fuel it can't afford goes on credit", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0], s = ship(c), d = neighbour(0);
    c.cash = 50;
    const fuel = e.fuelNeeded(0, d) * e.price(0, 1, e.stock[0][1] - e.fuelNeeded(0, d) / 2);
    assert.ok(fuel > 50);
    assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: d }).ok);
    assert.ok(near(c.cash, 50 - fuel));
    // Loaded trips work too, as long as the cargo itself is paid for.
    hours(e, e.voyageHours(0, d));
    c.cash = 200;
    const unit = e.price(d, 0) * (1 + tax);
    const qty = Math.floor(150 / unit);
    assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: 0, buy: { good: "grain", qty } }).ok);
    assert.ok(c.cash < 200 - qty * unit + 1);
    // With a spare ship there's no credit: the company can scrap or sell to raise cash.
    const two = world(1);
    two.cs[0].cash = rules.ship.price; two.e.apply({ type: "buyShip", company: two.cs[0].id, port: 0 });
    two.cs[0].cash = 50;
    assert.equal(err(two.e.apply({ type: "sail", company: two.cs[0].id, ship: two.ship(two.cs[0]).id, dest: d })), "not enough cash");
  });

  test("docking charges the port fee", () => {
    const { e, cs, ship } = world(1);
    const d = neighbour(0);
    e.apply({ type: "sail", company: cs[0].id, ship: ship(cs[0]).id, dest: d });
    const cash = cs[0].cash;
    hours(e, e.voyageHours(0, d));
    assert.equal(ship(cs[0]).port, d);
    assert.equal(cs[0].cash, cash - rules.fees.port_fee_per_docking);
  });

  test("refusals: bad destination, already loaded, short stock, short cash; nothing is charged", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0], s = ship(c), d = neighbour(0);
    const sail = (extra: any) => err(e.apply({ type: "sail", company: c.id, ship: s.id, dest: d, ...extra }));
    for (const dest of [0, -1, e.n, 2.5, String(d), null]) assert.equal(sail({ dest }), "bad destination", String(dest));
    assert.equal(sail({ buy: { good: "gold", qty: 5 } }), "bad cargo");
    assert.equal(sail({ buy: { good: "grain", qty: 0 } }), "bad cargo");
    assert.equal(sail({ buy: { good: "grain", qty: rules.ship.capacity + 1 } }), "over capacity");
    e.stock[0][0] = 10;
    assert.equal(sail({ buy: { good: "grain", qty: 11 } }), "not enough stock at this port");
    c.cash = 5;
    assert.equal(sail({ buy: { good: "grain", qty: 1 } }), "not enough cash", "cargo is never on credit");
    c.cash = 10000; s.good = 0; s.qty = 5;
    assert.equal(sail({ buy: { good: "grain", qty: 5 } }), "ship already loaded; sell first");
    assert.equal(c.cash, 10000);
    assert.equal(s.dest, null);
    assert.equal(err(e.apply({ type: "sail", company: c.id, ship: 9999, dest: d })), "not your ship");
  });
});

describe("selling", () => {
  test("can't sell an empty ship or one at sea", () => {
    const { e, cs, ship } = world(1);
    const s = ship(cs[0]);
    assert.equal(err(e.apply({ type: "sell", company: cs[0].id, ship: s.id })), "nothing to sell");
    s.good = 0; s.qty = 10; s.dest = 3;
    assert.equal(err(e.apply({ type: "sell", company: cs[0].id, ship: s.id })), "ship is at sea");
  });

  test("selling more lowers the price you get per unit", () => {
    const e = new Engine(rules, map);
    assert.ok(e.sellValue(0, 0, 100) / 100 < e.price(0, 0));
    assert.ok(e.sellValue(0, 0, 10) / 10 > e.sellValue(0, 0, 100) / 100);
  });

  test("filling a buy order only works for the same port and good, and never your own", () => {
    const { e, cs, ship } = world(2);
    const [A, B] = cs;
    const id = (e.apply({ type: "placeOrder", company: A.id, port: 0, good: "fuel", qty: 50, price: 60 }) as any).id;
    const sb = ship(B), sa = ship(A);
    sb.good = 0; sb.qty = 50;
    assert.equal(err(e.apply({ type: "sell", company: B.id, ship: sb.id, order: id })), "order doesn't match this ship");
    sb.good = 1; sb.port = 3;
    assert.equal(err(e.apply({ type: "sell", company: B.id, ship: sb.id, order: id })), "order doesn't match this ship");
    sa.good = 1; sa.qty = 10;
    assert.equal(err(e.apply({ type: "sell", company: A.id, ship: sa.id, order: id })), "can't fill your own order");
    assert.equal(err(e.apply({ type: "sell", company: B.id, ship: sb.id, order: 12345 })), "order doesn't match this ship");
  });

  test("part-filling an order keeps the rest of the cargo and its share of the cost", () => {
    const { e, cs, ship } = world(2);
    const [A, B] = cs;
    const id = (e.apply({ type: "placeOrder", company: A.id, port: 0, good: "fuel", qty: 30, price: 60 }) as any).id;
    const sb = ship(B);
    sb.good = 1; sb.qty = 100; sb.cost = 5000;
    const stock = e.stock[0][1];
    assert.ok(e.apply({ type: "sell", company: B.id, ship: sb.id, order: id }).ok);
    assert.equal(sb.qty, 70); assert.ok(near(sb.cost, 3500)); assert.equal(sb.good, 1);
    assert.ok(!e.orders.has(id));
    assert.equal(e.stock[0][1], stock, "goods delivered to a player don't enter the market");
  });
});

describe("ships", () => {
  test("buying a ship needs cash, a docked ship at that port and room in the fleet", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0];
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 0 })), "not enough cash");
    c.cash = 1e6;
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 5 })), "you need a ship docked at that port");
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: "0" as any })), "bad port");
    const r = e.apply({ type: "buyShip", company: c.id, port: 0 });
    assert.ok(r.ok);
    assert.equal(c.cash, 1e6 - rules.ship.price);
    assert.equal(e.ships.get((r as any).id)!.port, 0);
    while (c.ships.length < rules.company.max_ships) assert.ok(e.apply({ type: "buyShip", company: c.id, port: 0 }).ok);
    assert.equal(err(e.apply({ type: "buyShip", company: c.id, port: 0 })), "fleet is at its maximum");
    // A ship at sea doesn't count as docked.
    const { e: e2, cs: cs2, ship: ship2 } = world(1);
    cs2[0].cash = 1e6;
    e2.apply({ type: "sail", company: cs2[0].id, ship: ship2(cs2[0]).id, dest: neighbour(0) });
    assert.equal(err(e2.apply({ type: "buyShip", company: cs2[0].id, port: 0 })), "you need a ship docked at that port");
    assert.equal(err(e2.apply({ type: "buyShip", company: 999, port: 0 })), "no company");
  });

  test("scrapping refunds half the price; must keep one ship, docked and empty", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0];
    assert.equal(err(e.apply({ type: "scrapShip", company: c.id, ship: c.ships[0] })), "you must keep one ship");
    c.cash = rules.ship.price;
    e.apply({ type: "buyShip", company: c.id, port: 0 });
    const s2 = ship(c, 1);
    s2.good = 0; s2.qty = 5;
    assert.equal(err(e.apply({ type: "scrapShip", company: c.id, ship: s2.id })), "ship must be docked and empty");
    s2.qty = 0; s2.good = null;
    assert.ok(e.apply({ type: "scrapShip", company: c.id, ship: s2.id }).ok);
    assert.equal(c.cash, rules.ship.price / 2);
    assert.equal(c.ships.length, 1);
    assert.ok(!e.ships.has(s2.id));
  });

  test("upkeep is charged once a day for each ship after the first", () => {
    const { e, cs } = world(1);
    const c = cs[0];
    c.cash = rules.ship.price * 2 + 100000;
    e.apply({ type: "buyShip", company: c.id, port: 0 });
    e.apply({ type: "buyShip", company: c.id, port: 0 });
    const cash = c.cash;
    hours(e, 23);
    assert.equal(c.cash, cash, "nothing before the day ends");
    e.advance();
    assert.equal(c.cash, cash - 2 * rules.ship.upkeep_per_day);
  });

  test("a company in debt loses an idle empty spare ship, never one at sea or loaded", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0];
    c.cash = rules.ship.price;
    e.apply({ type: "buyShip", company: c.id, port: 0 });
    const s1 = ship(c, 0), s2 = ship(c, 1);
    s1.good = 0; s1.qty = 10;      // loaded
    s2.dest = 3; s2.arriveTick = 9999;   // at sea
    c.cash = -1;
    hours(e, 24);
    assert.equal(c.ships.length, 2, "nothing idle to scrap");
    s2.dest = null;
    hours(e, 24);
    assert.equal(c.ships.length, 1);
    assert.equal(c.ships[0], s1.id, "the loaded ship is kept");
  });
});

describe("buy orders", () => {
  test("limits: quantity 1–1000, price inside the band, enough cash, at most 10 open", () => {
    const { e, cs } = world(1);
    const c = cs[0];
    const place = (o: any) => err(e.apply({ type: "placeOrder", company: c.id, port: 0, good: "grain", qty: 10, price: 20, ...o }));
    assert.equal(place({ qty: 0 }), "quantity must be 1 to 1000");
    assert.equal(place({ qty: 1001 }), "quantity must be 1 to 1000");
    assert.equal(place({ price: rules.commodities.grain.ceiling + 0.01 }), "price must be between 10 and 40");
    assert.equal(place({ price: rules.commodities.grain.floor - 1 }), "price must be between 10 and 40");
    assert.equal(place({ good: "gold" }), "bad order");
    assert.equal(place({ port: e.n }), "bad port");
    assert.equal(place({ port: "1" }), "bad port");
    assert.equal(place({ qty: 1000, price: 40 }), "not enough cash to cover the order");
    for (let i = 0; i < 10; i++) assert.equal(place({ qty: 1, price: 10 }), "ok");
    assert.equal(place({ qty: 1, price: 10 }), "you can have at most 10 open orders");
    assert.equal(c.cash, rules.company.start_cash - 10 * 10);
  });

  test("a filled buy order delivers nothing to the buyer: net worth drops by the price paid (the Orders tab says so)", () => {
    const { e, cs, ship } = world(2);
    const [A, B] = cs;
    const worth0 = e.netWorth(A);
    const id = (e.apply({ type: "placeOrder", company: A.id, port: 0, good: "grain", qty: 10, price: 20 }) as any).id;
    assert.ok(near(e.netWorth(A), worth0), "escrow still counts while the order is open");
    Object.assign(ship(B), { good: 0, qty: 10, cost: 100 });
    assert.equal(err(e.apply({ type: "sell", company: B.id, ship: ship(B).id, order: id })), "ok");
    assert.ok(near(e.netWorth(A), worth0 - 200));
    assert.ok(A.ships.every(s => e.ships.get(s)!.qty === 0), "no goods arrive on the buyer's ships");
  });

  test("prices round to the cent and escrow matches what's held", () => {
    const { e, cs } = world(1);
    const r = e.apply({ type: "placeOrder", company: cs[0].id, port: 0, good: "grain", qty: 3, price: 20.123 });
    assert.equal(e.orders.get((r as any).id)!.price, 20.12);
    assert.ok(near(cs[0].cash, rules.company.start_cash - 3 * 20.12));
    assert.ok(near(e.metrics().escrow, 60));
    assert.ok(near(e.netWorth(cs[0]), rules.company.start_cash + rules.ship.price / 2), "escrow still counts toward net worth");
  });

  test("a buy order sweeps the cheapest sell orders first and rests the remainder", () => {
    const { e, cs, ship } = world(3);
    const [A, B, C] = cs;
    for (const [c, price] of [[B, 70], [C, 60]] as const) {
      const s = ship(c); s.good = 1; s.qty = 20; s.cost = 1000;
      assert.ok(e.apply({ type: "placeSell", company: c.id, ship: s.id, qty: 20, price }).ok);
    }
    const [cashA, cashB, cashC] = [A.cash, B.cash, C.cash];
    const r = e.apply({ type: "placeOrder", company: A.id, port: 0, good: "fuel", qty: 30, price: 75 });
    assert.ok(near(C.cash - cashC, 20 * 60 * (1 - tax)), "cheapest seller filled in full");
    assert.ok(near(B.cash - cashB, 10 * 70 * (1 - tax)));
    assert.ok(near(cashA - A.cash, 20 * 60 + 10 * 70));
    assert.equal((r as any).id, undefined, "fully filled, nothing rests");
    const left = [...e.orders.values()];
    assert.equal(left.length, 1); assert.equal(left[0].owner, B.id); assert.equal(left[0].qty, 10);
    assert.ok(near(left[0].cost!, 500), "seller's remaining cost basis shrinks with the fill");
  });

  test("a buy order never fills against your own listing", () => {
    const { e, cs, ship } = world(1);
    const s = ship(cs[0]); s.good = 1; s.qty = 20; s.cost = 1000;
    e.apply({ type: "placeSell", company: cs[0].id, ship: s.id, qty: 20, price: 40 });
    const r = e.apply({ type: "placeOrder", company: cs[0].id, port: 0, good: "fuel", qty: 20, price: 80 });
    assert.ok((r as any).id, "rests instead");
    assert.equal(e.orders.size, 2);
  });

  test("only the owner can cancel; cancelling refunds what's left", () => {
    const { e, cs } = world(2);
    const id = (e.apply({ type: "placeOrder", company: cs[0].id, port: 0, good: "grain", qty: 10, price: 20 }) as any).id;
    assert.equal(err(e.apply({ type: "cancelOrder", company: cs[1].id, order: id })), "not your order");
    assert.ok(e.apply({ type: "cancelOrder", company: cs[0].id, order: id }).ok);
    assert.equal(cs[0].cash, rules.company.start_cash);
    assert.equal(err(e.apply({ type: "cancelOrder", company: cs[0].id, order: id })), "not your order");
  });
});

describe("sell listings", () => {
  test("limits: real cargo, quantity up to the load, price inside the band, docked", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0], s = ship(c);
    const list = (o: any) => err(e.apply({ type: "placeSell", company: c.id, ship: s.id, qty: 10, price: 50, ...o }));
    assert.equal(list({}), "nothing to sell");
    s.good = 1; s.qty = 20; s.cost = 1000;
    assert.equal(list({ qty: 21 }), "quantity must be between 1 and the cargo on board");
    assert.equal(list({ qty: 0 }), "quantity must be between 1 and the cargo on board");
    assert.equal(list({ price: 91 }), "price must be between 30 and 90");
    s.dest = 4;
    assert.equal(list({}), "ship is at sea");
    s.dest = null;
    assert.equal(list({ qty: 20 }), "ok");
    assert.equal(s.qty, 0); assert.equal(s.good, null); assert.equal(s.cost, 0);
  });

  test("a listing sells to the highest buy orders first, at their price", () => {
    const { e, cs, ship } = world(3);
    const [A, B, C] = cs;
    e.apply({ type: "placeOrder", company: B.id, port: 0, good: "fuel", qty: 10, price: 70 });
    e.apply({ type: "placeOrder", company: C.id, port: 0, good: "fuel", qty: 10, price: 80 });
    const s = ship(A); s.good = 1; s.qty = 15; s.cost = 750;
    const cash = A.cash;
    assert.deepEqual(e.apply({ type: "placeSell", company: A.id, ship: s.id, qty: 15, price: 65 }), { ok: true });
    assert.ok(near(A.cash - cash, (10 * 80 + 5 * 70) * (1 - tax)));
    const left = [...e.orders.values()];
    assert.equal(left.length, 1); assert.equal(left[0].owner, B.id); assert.equal(left[0].qty, 5);
  });

  test("buying from a listing: same port, same good, room on board, enough cash, not your own", () => {
    const { e, cs, ship } = world(2);
    const [A, B] = cs;
    const sa = ship(A); sa.good = 1; sa.qty = 100; sa.cost = 5000;
    const id = (e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 100, price: 60 }) as any).id;
    const sb = ship(B);
    const buy = (qty: number) => err(e.apply({ type: "buyFromOrder", company: B.id, ship: sb.id, order: id, qty }));
    assert.equal(buy(101), "quantity must be between 1 and the amount listed");
    assert.equal(buy(0), "quantity must be between 1 and the amount listed");
    sb.good = 0; sb.qty = 10;
    assert.equal(buy(5), "ship is carrying a different good");
    sb.good = 1; sb.qty = 95;
    assert.equal(buy(10), "over capacity");
    sb.qty = 0; sb.good = null; sb.port = 9;
    assert.equal(buy(5), "your ship must be docked at that port");
    sb.port = 0; B.cash = 10;
    assert.equal(buy(5), "not enough cash");
    assert.equal(err(e.apply({ type: "buyFromOrder", company: B.id, ship: sb.id, order: 777, qty: 1 })), "no such sell order");
    // Buy orders can't be bought from.
    const bo = (e.apply({ type: "placeOrder", company: A.id, port: 0, good: "grain", qty: 1, price: 10 }) as any).id;
    B.cash = 1e5;
    assert.equal(err(e.apply({ type: "buyFromOrder", company: B.id, ship: sb.id, order: bo, qty: 1 })), "no such sell order");
    // Topping up a ship already carrying the same good adds to its cost basis.
    sb.good = 1; sb.qty = 10; sb.cost = 400;
    assert.equal(buy(90), "ok");
    assert.equal(sb.qty, 100); assert.ok(near(sb.cost, 400 + 90 * 60));
    assert.equal(e.orders.get(id)!.qty, 10);
  });

  test("cancelling a listing puts the goods back on the ship you choose", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0];
    c.cash = rules.ship.price * 2;
    e.apply({ type: "buyShip", company: c.id, port: 0 });
    const [s1, s2] = [ship(c, 0), ship(c, 1)];
    s1.good = 1; s1.qty = 50; s1.cost = 2500;
    const id = (e.apply({ type: "placeSell", company: c.id, ship: s1.id, qty: 50, price: 80 }) as any).id;
    s1.good = 0; s1.qty = 10;   // first ship now carries grain: can't take fuel back
    assert.ok(e.apply({ type: "cancelOrder", company: c.id, order: id, ship: s2.id }).ok);
    assert.equal(s2.qty, 50); assert.equal(s2.good, 1); assert.ok(near(s2.cost, 2500));
  });

  test("listing and cancelling keep net worth the same", () => {
    const { e, cs, ship } = world(1);
    const s = ship(cs[0]); s.good = 1; s.qty = 60; s.cost = 3000;
    const w = e.netWorth(cs[0]);
    const id = (e.apply({ type: "placeSell", company: cs[0].id, ship: s.id, qty: 25, price: 80 }) as any).id;
    assert.ok(near(e.netWorth(cs[0]), w));
    e.apply({ type: "cancelOrder", company: cs[0].id, order: id });
    assert.ok(near(e.netWorth(cs[0]), w));
    assert.equal(s.qty, 60);
  });

  test("sell listings and buy orders share the 10-order limit", () => {
    const { e, cs, ship } = world(1);
    const c = cs[0], s = ship(c);
    for (let i = 0; i < 9; i++) e.apply({ type: "placeOrder", company: c.id, port: 1, good: "grain", qty: 1, price: 10 });
    s.good = 1; s.qty = 10; s.cost = 100;
    assert.ok(e.apply({ type: "placeSell", company: c.id, ship: s.id, qty: 5, price: 80 }).ok);
    assert.equal(err(e.apply({ type: "placeSell", company: c.id, ship: s.id, qty: 5, price: 80 })), "you can have at most 10 open orders");
    assert.equal(s.qty, 5, "a refused listing leaves the cargo on board");
  });
});

describe("markets", () => {
  test("producers fill up, consumers drain, stock stays between 0 and the cap", () => {
    const { e } = world(2);
    const prod = map.ports.findIndex((p: any) => p.produces.includes("grain") && !p.consumes.includes("grain"));
    const cons = map.ports.findIndex((p: any) => p.consumes.includes("grain") && !p.produces.includes("grain"));
    const [p0, c0] = [e.stock[prod][0], e.stock[cons][0]];
    hours(e, 10);
    assert.ok(e.stock[prod][0] > p0); assert.ok(e.stock[cons][0] < c0);
    e.stock[prod][0] = 1e9; e.stock[cons][0] = 0;
    e.advance();
    assert.ok(e.stock[prod][0] <= rules.markets.target_stock * e.scale * rules.markets.max_stock_multiple);
    assert.equal(e.stock[cons][0], 0);
  });

  test("seasons open with producers stocked up and consumers short, so trade pays at once", () => {
    const e = new Engine(rules, map, 60);
    const target = rules.markets.target_stock * e.scale, sp = rules.markets.start_spread;
    assert.ok(sp > 0);
    map.ports.forEach((p: any, i: number) => ["grain", "fuel"].forEach((g, j) => {
      const makes = p.produces.includes(g), needs = p.consumes.includes(g);
      const want = target * (1 + (makes && !needs ? sp : 0) - (needs && !makes ? sp : 0));
      assert.ok(near(e.stock[i][j], want), `${p.name} ${g}`);
    }));
    // Some full load bought at a producer and sold at a consumer makes money in hour one.
    let best = -Infinity;
    for (let a = 0; a < e.n; a++) for (let b = 0; b < e.n; b++) for (const g of [0, 1]) {
      if (a === b) continue;
      const q = rules.ship.capacity;
      const profit = e.sellValue(b, g, q) * (1 - tax) - e.buyCost(a, g, q).cost * (1 + tax)
        - e.fuelNeeded(a, b) * e.price(a, 1) - rules.fees.port_fee_per_docking;
      best = Math.max(best, profit);
    }
    assert.ok(best > 0, `best opening trade ${best.toFixed(0)}`);
  });

  test("market size is fixed for the season by the expected number of companies", () => {
    const small = new Engine(rules, map, 30), big = new Engine(rules, map, 300), none = new Engine(rules, map);
    assert.ok(near(big.scale, 1)); assert.equal(none.scale, 1);
    assert.ok(near(small.scale, (30 / 300) ** rules.markets.scale_exponent));
    assert.ok(small.stock[0][0] < big.stock[0][0]);
    assert.ok(new Engine(rules, map, 0.0001).scale >= rules.markets.min_scale);
    // Registering more companies than expected doesn't change the size.
    for (let i = 0; i < 5; i++) small.apply({ type: "register", name: "x" + i, startPort: 0 });
    assert.ok(near(small.scale, (30 / 300) ** rules.markets.scale_exponent));
  });

  test("price is the ceiling when empty, the floor at twice the target, and never outside", () => {
    const e = new Engine(rules, map, 60);
    const target = rules.markets.target_stock * e.scale;
    assert.equal(e.price(0, 1, 0), rules.commodities.fuel.ceiling);
    assert.ok(near(e.price(0, 1, 2 * target), rules.commodities.fuel.floor));
    assert.ok(near(e.price(0, 1, target), (rules.commodities.fuel.floor + rules.commodities.fuel.ceiling) / 2));
    assert.equal(e.price(0, 1, -50), rules.commodities.fuel.ceiling);
  });
});

describe("public information and metrics", () => {
  test("inbound shows cargo and empty ships heading to each port", () => {
    const { e, cs, ship } = world(2);
    const d = neighbour(0);
    e.apply({ type: "sail", company: cs[0].id, ship: ship(cs[0]).id, dest: d, buy: { good: "fuel", qty: 40 } });
    e.apply({ type: "sail", company: cs[1].id, ship: ship(cs[1]).id, dest: d });
    const ib = e.inbound();
    assert.deepEqual(ib.cargo[d], [0, 40]);
    assert.equal(ib.emptyShips[d], 1);
    assert.equal(ib.emptyShips[0], 0);
  });

  test("metrics count companies, ships, money, escrow and debt", () => {
    const { e, cs } = world(3);
    e.apply({ type: "placeOrder", company: cs[0].id, port: 0, good: "grain", qty: 10, price: 20 });
    cs[2].cash = -100;
    const m = e.metrics();
    assert.equal(m.companies, 3); assert.equal(m.ships, 3); assert.equal(m.day, 1);
    assert.equal(m.escrow, 200);
    assert.equal(m.moneySupply, Math.round(2 * rules.company.start_cash - 200 - 100));
    assert.equal(m.inDebt, 1);
    assert.ok(m.top1pctShare > 0 && m.top1pctShare < 1);
    hours(e, 24);
    assert.equal(e.metrics().day, 2);
  });
});

describe("admin controls", () => {
  test("new tax applies to the next trade", () => {
    const { e, cs, ship } = world(1);
    assert.ok(e.apply({ type: "adminSet", tax: 0 }).ok);
    const s = ship(cs[0]); s.good = 0; s.qty = 10;
    const expected = e.sellValue(0, 0, 10);
    const cash = cs[0].cash;
    e.apply({ type: "sell", company: cs[0].id, ship: s.id });
    assert.ok(near(cs[0].cash - cash, expected));
  });

  test("one bad value refuses the whole change", () => {
    const e = new Engine(rules, map);
    for (const bad of [{ tax: 0.31 }, { tax: "0.1" }, { tax: null }, { tax: NaN }, { upkeep: -1 }, { upkeep: Infinity }, { portFee: "5" }, { tax: 0.1, portFee: -1 }])
      assert.equal(e.apply({ type: "adminSet", ...(bad as any) }).ok, false, JSON.stringify(bad));
    assert.equal(e.rules.fees.trade_tax_rate, rules.fees.trade_tax_rate);
    assert.equal(e.rules.fees.port_fee_per_docking, rules.fees.port_fee_per_docking);
    assert.equal(e.rules.ship.upkeep_per_day, rules.ship.upkeep_per_day);
  });

  test("admin changes don't leak into the shared rules object", () => {
    const e = new Engine(rules, map);
    e.apply({ type: "adminSet", tax: 0.2 });
    assert.equal(rules.fees.trade_tax_rate, tax);
    assert.equal(new Engine(rules, map).rules.fees.trade_tax_rate, tax);
  });
});

describe("season", () => {
  test("every player command is refused after the last hour", () => {
    const { e, cs, ship } = world(2);
    const id = (e.apply({ type: "placeOrder", company: cs[0].id, port: 0, good: "grain", qty: 1, price: 10 }) as any).id;
    e.tick = e.seasonHours;
    const s = ship(cs[0]).id;
    const cmds: Command[] = [
      { type: "register", name: "Late", startPort: 0 }, { type: "sail", company: cs[0].id, ship: s, dest: 1 },
      { type: "sell", company: cs[0].id, ship: s }, { type: "buyShip", company: cs[0].id, port: 0 },
      { type: "scrapShip", company: cs[0].id, ship: s }, { type: "placeOrder", company: cs[0].id, port: 0, good: "grain", qty: 1, price: 10 },
      { type: "placeSell", company: cs[0].id, ship: s, qty: 1, price: 10 }, { type: "buyFromOrder", company: cs[1].id, ship: ship(cs[1]).id, order: id, qty: 1 },
      { type: "cancelOrder", company: cs[0].id, order: id },
    ];
    for (const c of cmds) assert.equal(err(e.apply(c)), "the season has ended", c.type);
    const stock = JSON.stringify(e.stock);
    e.advance();
    assert.equal(JSON.stringify(e.stock), stock, "markets frozen");
  });
});

test("replaying a long mixed history gives exactly the same world", () => {
  const cmds: (Command | "tick")[] = [];
  const push = (...c: (Command | "tick")[]) => cmds.push(...c);
  push({ type: "register", name: "A", startPort: 0 }, { type: "register", name: "B", startPort: 0 });
  push({ type: "placeOrder", company: 3, port: 0, good: "fuel", qty: 30, price: 75 });
  push({ type: "sail", company: 1, ship: 2, dest: neighbour(0), buy: { good: "fuel", qty: 60 } }, ...Array(10).fill("tick"));
  push({ type: "sail", company: 1, ship: 2, dest: 0 }, ...Array(10).fill("tick"));
  push({ type: "sell", company: 1, ship: 2, order: 5 }, { type: "placeSell", company: 1, ship: 2, qty: 20, price: 80 });
  push({ type: "adminSet", tax: 0.05 }, ...Array(30).fill("tick"), { type: "sell", company: 1, ship: 2 });
  const run = () => {
    const e = new Engine(rules, map, 60);
    const results = cmds.map(c => (c === "tick" ? (e.advance(), null) : e.apply(c)));
    return JSON.stringify([results, e.tick, e.stock, [...e.companies.values()], [...e.ships.values()], [...e.orders.values()]]);
  };
  const a = run();
  assert.equal(a, run());
  assert.ok(!a.includes('"ok":false'), "every command in the script succeeded: " + a.slice(0, 400));
});
