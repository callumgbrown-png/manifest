// Trip log and net-worth history kept by the engine for the Fleet tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function setup() {
  const e = new Engine(rules, map);
  const id = (e.apply({ type: "register", name: "A", startPort: 0 }) as any).id;
  const c = e.companies.get(id)!, s = e.ships.get(c.ships[0])!;
  const dest = e.dist[0].findIndex((d, i) => i !== 0 && Number.isFinite(d));
  return { e, c, s, dest };
}
const sailUntilDocked = (e: Engine, s: any) => { while (s.dest !== null) e.advance(); };

test("a loaded trip records cargo, fuel and port fee spent, and the sale", () => {
  const { e, c, s, dest } = setup();
  const before = c.cash;
  assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "grain", qty: 50 } }).ok);
  let [t] = e.trips.get(c.id)!;
  assert.deepEqual([t.from, t.to, t.good, t.qty, t.open], [0, dest, 0, 50, true]);
  sailUntilDocked(e, s);
  assert.equal(t.open, true, "still open until the cargo is sold");
  assert.ok(e.apply({ type: "sell", company: c.id, ship: s.id }).ok);
  t = e.trips.get(c.id)![0];
  assert.equal(t.open, false);
  assert.ok(Math.abs((t.earned - t.spent) - (c.cash - before)) < 1e-6, "trip profit equals the change in cash");
});

test("an empty trip closes on arrival; carrying cargo on extends the same trip", () => {
  const { e, c, s, dest } = setup();
  e.apply({ type: "sail", company: c.id, ship: s.id, dest });
  sailUntilDocked(e, s);
  assert.equal(e.trips.get(c.id)![0].open, false);
  e.apply({ type: "sail", company: c.id, ship: s.id, dest: 0, buy: { good: "fuel", qty: 30 } });
  sailUntilDocked(e, s);
  const back = e.dist[0].findIndex((d, i) => i !== 0 && i !== dest && Number.isFinite(d));
  assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: back }).ok);
  const list = e.trips.get(c.id)!;
  assert.equal(list.length, 2, "carrying the cargo on doesn't start a new trip");
  assert.equal(list[1].to, back);
});

test("the log keeps only the last 25 trips", () => {
  const { e, c, s, dest } = setup();
  const cmds: any[] = [];
  for (let i = 0; i < 30; i++) {
    const cmd = { type: "sail", company: c.id, ship: s.id, dest: s.port === 0 ? dest : 0 };
    cmds.push(cmd); e.apply(cmd as any); sailUntilDocked(e, s);
  }
  assert.equal(e.trips.get(c.id)!.length, 25);
});

test("net worth is logged at the start of each day", () => {
  const { e, c } = setup();
  for (let h = 0; h < 24 * 3; h++) e.advance();
  const log = e.worthLog.get(c.id)!;
  assert.equal(log.length, 4, "the starting value plus one per day");
  assert.equal(log[0], Math.round(rules.company.start_cash + rules.ship.price / 2));
});

test("cargo bought from another player's listing counts in the trip's cost", () => {
  const { e, c: seller, s: ss, dest } = setup();
  assert.ok(e.apply({ type: "sail", company: seller.id, ship: ss.id, dest, buy: { good: "grain", qty: 40 } }).ok);
  sailUntilDocked(e, ss);
  const order = (e.apply({ type: "placeSell", company: seller.id, ship: ss.id, qty: 40, price: 20 } as any) as any).id;
  assert.ok(order);
  const buyer = e.companies.get((e.apply({ type: "register", name: "B", startPort: dest }) as any).id)!;
  const bs = e.ships.get(buyer.ships[0])!;
  const before = buyer.cash;
  assert.ok(e.apply({ type: "buyFromOrder", company: buyer.id, ship: bs.id, order, qty: 40 } as any).ok);
  assert.ok(e.apply({ type: "sail", company: buyer.id, ship: bs.id, dest: 0 }).ok);
  sailUntilDocked(e, bs);
  assert.ok(e.apply({ type: "sell", company: buyer.id, ship: bs.id }).ok);
  const [t] = e.trips.get(buyer.id)!;
  assert.equal(t.qty, 40);
  assert.ok(Math.abs((t.earned - t.spent) - (buyer.cash - before)) < 1e-6,
    `trip profit ${t.earned - t.spent} should equal the change in cash ${buyer.cash - before}`);
});

test("topping up cargo from a listing mid-trip adds to the open trip's cost", () => {
  const { e, c: seller, s: ss, dest } = setup();
  assert.ok(e.apply({ type: "sail", company: seller.id, ship: ss.id, dest, buy: { good: "grain", qty: 40 } }).ok);
  sailUntilDocked(e, ss);
  const order = (e.apply({ type: "placeSell", company: seller.id, ship: ss.id, qty: 40, price: 20 } as any) as any).id;
  const buyer = e.companies.get((e.apply({ type: "register", name: "B", startPort: 0 }) as any).id)!;
  const bs = e.ships.get(buyer.ships[0])!;
  const before = buyer.cash;
  assert.ok(e.apply({ type: "sail", company: buyer.id, ship: bs.id, dest, buy: { good: "grain", qty: 20 } }).ok);
  sailUntilDocked(e, bs);
  assert.ok(e.apply({ type: "buyFromOrder", company: buyer.id, ship: bs.id, order, qty: 30 } as any).ok);
  assert.ok(e.apply({ type: "sail", company: buyer.id, ship: bs.id, dest: 0 }).ok);
  sailUntilDocked(e, bs);
  assert.ok(e.apply({ type: "sell", company: buyer.id, ship: bs.id }).ok);
  const trips = e.trips.get(buyer.id)!;
  assert.equal(trips.length, 1, "one trip from start to sale");
  assert.ok(Math.abs((trips[0].earned - trips[0].spent) - (buyer.cash - before)) < 1e-6);
});

test("a spare ship sold for debt at the daily upkeep is recorded, so the player can be told", () => {
  const { e, c } = setup();
  c.cash = 20_000;
  assert.ok(e.apply({ type: "buyShip", company: c.id, port: 0 }).ok);
  const both = [...c.ships];
  c.cash = 100;   // less than a day's upkeep for the spare ship
  while (e.tick < 24) e.advance();
  assert.equal(c.ships.length, 1, "spare ship sold");
  const [f] = e.forcedSales.get(c.id)!;
  // Either ship may go (any idle one is sold); the record names the one that went.
  assert.ok(both.includes(f.ship) && !c.ships.includes(f.ship));
  assert.deepEqual({ port: f.port, tick: f.tick, paid: f.paid }, { port: 0, tick: 24, paid: rules.ship.price / 2 });
  assert.equal(f.cashBefore, 100 - rules.ship.upkeep_per_day, "cash after upkeep, before the sale");
  assert.equal(e.forcedSales.get(c.id)!.length, 1, "nothing else sold");
  // A sale the player made themselves is not recorded as forced.
  c.cash = 20_000;
  e.apply({ type: "buyShip", company: c.id, port: 0 });
  e.apply({ type: "scrapShip", company: c.id, ship: c.ships[1] });
  assert.equal(e.forcedSales.get(c.id)!.length, 1);
});

/** A listing's goods came from a trip; when another company buys them (or the seller takes them back),
 *  that trip's profit follows, so the trip log adds up to the change in cash. */
function listed() {
  const { e, c, s, dest } = setup();
  const b = (e.apply({ type: "register", name: "B", startPort: dest }) as any).id;
  const sb = e.ships.get(e.companies.get(b)!.ships[0])!;
  const before = c.cash;
  assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: "grain", qty: 50 } }).ok);
  sailUntilDocked(e, s);
  const price = rules.commodities.grain.ceiling - 1;
  const r = e.apply({ type: "placeSell", company: c.id, ship: s.id, qty: 50, price }) as any;
  assert.ok(r.ok && r.id);
  return { e, c, s, b, sb, before, price, order: r.id as number };
}

test("cargo listed for sale counts in its trip's profit once it sells, and the seller is told", () => {
  const { e, c, b, sb, before, price, order } = listed();
  let t = e.trips.get(c.id)![0];
  assert.deepEqual([t.open, t.listed], [false, true], "fully listed: closed, but marked as listed");
  assert.ok(e.apply({ type: "buyFromOrder", company: b, ship: sb.id, order, qty: 20 }).ok);
  t = e.trips.get(c.id)![0];
  assert.equal(t.listed, true, "30 still listed");
  assert.ok(e.apply({ type: "buyFromOrder", company: b, ship: sb.id, order, qty: 30 }).ok);
  t = e.trips.get(c.id)![0];
  assert.equal(t.listed, undefined, "all sold: the mark goes");
  assert.ok(Math.abs((t.earned - t.spent) - (c.cash - before)) < 1e-6, "trip profit equals the change in cash");
  const fills = e.orderFills.get(c.id)!;
  assert.deepEqual(fills.map(f => [f.side, f.qty, f.left]), [["sell", 20, 30], ["sell", 30, 0]]);
  const tax = rules.fees.trade_tax_rate;
  assert.ok(Math.abs(fills[1].amount - 30 * price * (1 - tax)) < 1e-6, "amount is what the seller got after tax");
  assert.equal(e.orderFills.get(b), undefined, "the buyer isn't told about their own purchase");
});

test("a listing bought by a crossing buy order also counts in the trip; buy-order owners hear about fills", () => {
  const { e, c, b, before, price } = listed();
  assert.ok(e.apply({ type: "placeOrder", company: b, port: e.ships.get(e.companies.get(b)!.ships[0])!.port, good: "grain", qty: 50, price }).ok);
  const t = e.trips.get(c.id)![0];
  assert.equal(t.listed, undefined);
  assert.ok(Math.abs((t.earned - t.spent) - (c.cash - before)) < 1e-6);
  // A buy order resting at a port, filled by a ship selling into it.
  const { e: e2, c: c2, s: s2, dest } = setup();
  const b2 = (e2.apply({ type: "register", name: "B", startPort: dest }) as any).id;
  assert.ok(e2.apply({ type: "placeOrder", company: b2, port: dest, good: "grain", qty: 80, price: 30 }).ok);
  e2.apply({ type: "sail", company: c2.id, ship: s2.id, dest, buy: { good: "grain", qty: 50 } });
  sailUntilDocked(e2, s2);
  const order = [...e2.orders.values()][0].id;
  assert.ok(e2.apply({ type: "sell", company: c2.id, ship: s2.id, order }).ok);
  assert.deepEqual(e2.orderFills.get(b2)!.map(f => [f.side, f.qty, f.left, f.amount]), [["buy", 50, 30, 1500]]);
});

test("taking listed cargo back moves its cost to the ship's next trip", () => {
  const { e, c, s, before, order } = listed();
  assert.ok(e.apply({ type: "cancelOrder", company: c.id, order }).ok);
  const first = e.trips.get(c.id)![0];
  assert.equal(first.listed, undefined);
  const back = e.dist[s.port].findIndex((d, i) => i !== s.port && Number.isFinite(d));
  assert.ok(e.apply({ type: "sail", company: c.id, ship: s.id, dest: back }).ok);
  sailUntilDocked(e, s);
  assert.ok(e.apply({ type: "sell", company: c.id, ship: s.id }).ok);
  const total = e.trips.get(c.id)!.reduce((a, t) => a + t.earned - t.spent, 0);
  assert.ok(Math.abs(total - (c.cash - before)) < 1e-6, "the two trips add up to the change in cash");
  assert.ok(e.trips.get(c.id)![1].spent > first.spent, "the cargo's cost is on the trip that sold it");
});
