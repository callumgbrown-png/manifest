import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const tax = rules.fees.trade_tax_rate;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function setup() {
  const e = new Engine(rules, map);
  const A = e.companies.get((e.apply({ type: "register", name: "A", startPort: 0 }) as any).id)!;
  const B = e.companies.get((e.apply({ type: "register", name: "B", startPort: 0 }) as any).id)!;
  const sa = e.ships.get(A.ships[0])!, sb = e.ships.get(B.ships[0])!;
  sa.good = 1; sa.qty = 100; sa.cost = 5000;   // A carries 100 fuel bought for 5000
  return { e, A, B, sa, sb };
}

test("listing cargo frees the ship and keeps net worth", () => {
  const { e, A, sa } = setup();
  const worth = e.netWorth(A);
  const r = e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 60, price: 70 });
  assert.ok(r.ok);
  assert.equal(sa.qty, 40);
  assert.ok(near(sa.cost, 2000));
  const o = e.orders.get((r as any).id)!;
  assert.equal(o.side, "sell"); assert.equal(o.qty, 60); assert.ok(near(o.cost!, 3000));
  assert.ok(near(e.netWorth(A), worth));
});

test("another player buys from a sell order onto their ship", () => {
  const { e, A, B, sa, sb } = setup();
  const id = (e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 100, price: 70 }) as any).id;
  const cashA = A.cash, cashB = B.cash;
  assert.ok(e.apply({ type: "buyFromOrder", company: B.id, ship: sb.id, order: id, qty: 30 }).ok);
  assert.ok(near(B.cash, cashB - 30 * 70));
  assert.ok(near(A.cash, cashA + 30 * 70 * (1 - tax)));
  assert.equal(sb.qty, 30); assert.equal(sb.good, 1);
  assert.equal(e.orders.get(id)!.qty, 70);
  assert.equal(e.apply({ type: "buyFromOrder", company: A.id, ship: sa.id, order: id, qty: 1 }).ok, false, "can't buy own goods");
});

test("a new sell order fills against a higher buy order straight away", () => {
  const { e, A, B, sa } = setup();
  assert.ok(e.apply({ type: "placeOrder", company: B.id, port: 0, good: "fuel", qty: 50, price: 80 }).ok);
  const cashA = A.cash;
  const r = e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 100, price: 75 });
  assert.ok(near(A.cash, cashA + 50 * 80 * (1 - tax)), "filled at the buyer's price");
  assert.equal((r as any).sold, 50, "the result says how much sold at once");
  assert.ok(near((r as any).earned, 50 * 80 * (1 - tax)), "and what it earned after tax");
  const rest = e.orders.get((r as any).id)!;
  assert.equal(rest.qty, 50, "remaining 50 listed");
  assert.equal([...e.orders.values()].filter(o => o.side === "buy").length, 0);
});

test("a new buy order fills against a cheaper sell order", () => {
  const { e, A, B, sa } = setup();
  e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 100, price: 60 });
  const cashB = B.cash;
  const r = e.apply({ type: "placeOrder", company: B.id, port: 0, good: "fuel", qty: 40, price: 65 });
  assert.deepEqual(r, { ok: true, bought: 40, spent: 2400 });
  assert.ok(near(B.cash, cashB - 40 * 60), "paid the seller's price");
});

test("cancelling a sell order needs a docked ship with room", () => {
  const { e, A, sa } = setup();
  const id = (e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 100, price: 70 }) as any).id;
  sa.port = 5;
  assert.equal(e.apply({ type: "cancelOrder", company: A.id, order: id }).ok, false);
  sa.port = 0;
  assert.ok(e.apply({ type: "cancelOrder", company: A.id, order: id }).ok);
  assert.equal(sa.qty, 100); assert.ok(near(sa.cost, 5000));
});

test("money is conserved apart from tax across a full trade cycle", () => {
  const { e, A, B, sa, sb } = setup();
  const before = A.cash + B.cash;
  const id = (e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 100, price: 70 }) as any).id;
  e.apply({ type: "buyFromOrder", company: B.id, ship: sb.id, order: id, qty: 100 });
  assert.ok(near(A.cash + B.cash, before - 100 * 70 * tax));
});

test("a buy order that crosses listings says how much it bought at once and what that cost", () => {
  const { e, A, B, sa } = setup();
  e.apply({ type: "placeSell", company: A.id, ship: sa.id, qty: 30, price: 60 });
  const cash = B.cash;
  // Wants 50 at up to 70: buys the 30 listed at 60 straight away, the other 20 wait as an order.
  const r = e.apply({ type: "placeOrder", company: B.id, port: sa.port, good: "fuel", qty: 50, price: 70 }) as any;
  assert.ok(r.ok);
  assert.equal(r.bought, 30); assert.ok(near(r.spent, 30 * 60));
  assert.equal(e.orders.get(r.id)!.qty, 20, "the rest is a buy order");
  assert.ok(near(B.cash, cash - 30 * 60 - 20 * 70));
  // Fully filled from a listing: no order left, so the result has no id.
  const t = setup();
  t.e.apply({ type: "placeSell", company: t.A.id, ship: t.sa.id, qty: 10, price: 55 });
  const r2 = t.e.apply({ type: "placeOrder", company: t.B.id, port: t.sa.port, good: "fuel", qty: 10, price: 60 }) as any;
  assert.equal(r2.id, undefined); assert.equal(r2.bought, 10); assert.ok(near(r2.spent, 550));
  // Nothing to cross: a plain order, no bought/spent.
  const r3 = e.apply({ type: "placeOrder", company: B.id, port: sa.port, good: "grain", qty: 5, price: 20 }) as any;
  assert.ok(r3.id); assert.equal(r3.bought, undefined);
});
