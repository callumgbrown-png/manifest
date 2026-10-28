import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function setup() {
  const e = new Engine(rules, map);
  const a = e.apply({ type: "register", name: "Alpha", startPort: 0 });
  const b = e.apply({ type: "register", name: "Beta", startPort: 1 });
  assert.ok(a.ok && b.ok);
  const A = e.companies.get((a as any).id)!;
  const B = e.companies.get((b as any).id)!;
  return { e, A, B, shipA: e.ships.get(A.ships[0])!, shipB: e.ships.get(B.ships[0])! };
}
const neighbour = (e: Engine, p: number) => map.routes.find((r: any) => r.a === p || r.b === p)!;

test("price falls as stock rises and stays inside the band", () => {
  const e = new Engine(rules, map);
  assert.ok(e.price(0, 0, 0) === rules.commodities.grain.ceiling);
  assert.ok(e.price(0, 0, 1e9) === rules.commodities.grain.floor);
  assert.ok(e.price(0, 0, 1000) > e.price(0, 0, 4000));
});

test("sailing with cargo charges cargo and fuel, and the ship arrives on time", () => {
  const { e, A, shipA } = setup();
  const r = neighbour(e, 0); const dest = r.a === 0 ? r.b : r.a;
  const cash0 = A.cash;
  const res = e.apply({ type: "sail", company: A.id, ship: shipA.id, dest, buy: { good: "grain", qty: 50 } });
  assert.deepEqual(res, { ok: true });
  assert.ok(A.cash < cash0);
  assert.equal(shipA.qty, 50);
  const hours = e.voyageHours(0, dest);
  for (let i = 0; i < hours - 1; i++) e.advance();
  assert.notEqual(shipA.dest, null);
  e.advance();
  assert.equal(shipA.dest, null);
  assert.equal(shipA.port, dest);
});

test("cannot sail while at sea, overload, or spend money you don't have", () => {
  const { e, A, shipA } = setup();
  const r = neighbour(e, 0); const dest = r.a === 0 ? r.b : r.a;
  assert.equal((e.apply({ type: "sail", company: A.id, ship: shipA.id, dest, buy: { good: "grain", qty: 9999 } }) as any).error, "over capacity");
  A.cash = 1;
  assert.equal((e.apply({ type: "sail", company: A.id, ship: shipA.id, dest, buy: { good: "fuel", qty: 100 } }) as any).error, "not enough cash");
  A.cash = 100000;
  assert.ok(e.apply({ type: "sail", company: A.id, ship: shipA.id, dest }).ok);
  assert.equal((e.apply({ type: "sail", company: A.id, ship: shipA.id, dest: 0 }) as any).error, "ship is at sea");
});

test("you can't command another company's ship", () => {
  const { e, A, shipB } = setup();
  assert.equal((e.apply({ type: "sail", company: A.id, ship: shipB.id, dest: 5 }) as any).error, "not your ship");
});

test("market sale pays the seller minus tax and adds stock", () => {
  const { e, A, shipA } = setup();
  shipA.good = 0; shipA.qty = 100; shipA.cost = 1000;
  const stock0 = e.stock[0][0], cash0 = A.cash;
  const expected = e.sellValue(0, 0, 100) * (1 - rules.fees.trade_tax_rate);
  assert.ok(e.apply({ type: "sell", company: A.id, ship: shipA.id }).ok);
  assert.equal(e.stock[0][0], stock0 + 100);
  assert.ok(Math.abs(A.cash - cash0 - expected) < 1e-6);
  assert.equal(shipA.qty, 0);
});

test("buy orders hold cash in escrow, fill from another player, and refund on cancel", () => {
  const { e, A, B, shipB } = setup();
  const cashA = A.cash;
  const o = e.apply({ type: "placeOrder", company: A.id, port: 1, good: "fuel", qty: 60, price: 70 });
  assert.ok(o.ok);
  assert.equal(A.cash, cashA - 60 * 70);
  shipB.good = 1; shipB.qty = 40; shipB.cost = 400;
  const cashB = B.cash;
  assert.ok(e.apply({ type: "sell", company: B.id, ship: shipB.id, order: (o as any).id }).ok);
  assert.ok(Math.abs(B.cash - cashB - 40 * 70 * (1 - rules.fees.trade_tax_rate)) < 1e-6);
  assert.equal(e.orders.get((o as any).id)!.qty, 20);
  assert.ok(e.apply({ type: "cancelOrder", company: A.id, order: (o as any).id }).ok);
  assert.equal(A.cash, cashA - 40 * 70);
});

test("orders outside the price band are refused", () => {
  const { e, A } = setup();
  assert.equal(e.apply({ type: "placeOrder", company: A.id, port: 1, good: "grain", qty: 10, price: 5 }).ok, false);
});

test("first ship is upkeep-free; extra ships pay upkeep; debt scraps a spare ship", () => {
  const { e, A } = setup();
  A.cash = rules.ship.price;
  assert.ok(e.apply({ type: "buyShip", company: A.id, port: 0 }).ok);
  assert.equal(A.ships.length, 2);
  A.cash = 0;
  for (let i = 0; i < 24; i++) e.advance();
  assert.equal(A.ships.length, 1, "spare ship scrapped");
  assert.equal(A.cash, -rules.ship.upkeep_per_day + rules.ship.price * 0.5);
  const before = A.cash;
  for (let i = 0; i < 24; i++) e.advance();
  assert.equal(A.cash, before, "single ship costs no upkeep");
});

test("replaying the same commands gives the same world", () => {
  const cmds: (Command | "tick")[] = [
    { type: "register", name: "A", startPort: 3 },
    { type: "register", name: "B", startPort: 7 },
    "tick",
    { type: "sail", company: 1, ship: 2, dest: neighbourOf(3), buy: { good: "grain", qty: 80 } },
    ...Array(30).fill("tick"),
    { type: "sell", company: 1, ship: 2 },
  ];
  const run = () => {
    const e = new Engine(rules, map);
    for (const c of cmds) c === "tick" ? e.advance() : e.apply(c);
    return JSON.stringify([e.stock, [...e.companies.values()], [...e.ships.values()]]);
  };
  assert.equal(run(), run());
});

function neighbourOf(p: number) {
  const r = map.routes.find((r: any) => r.a === p || r.b === p);
  return r.a === p ? r.b : r.a;
}
