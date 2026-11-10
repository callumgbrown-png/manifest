import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function world() {
  const e = new Engine(rules, map);
  const apply = (command: Command) => {
    const result = e.applyLive(command);
    assert.ok(result.ok, JSON.stringify(result));
    return result;
  };
  const company = (name: string) => e.companies.get(apply({ type: "register", name, startPort: 0 }).id!)!;
  return { e, apply, company };
}

test("legacy voyages replay before activation and new fees are fixed at dispatch", () => {
  const { e, apply, company } = world();
  const c = company("Merchant");
  const ship = e.ships.get(c.ships[0])!;
  const dest = e.dist[0].findIndex((d, i) => i !== 0 && Number.isFinite(d));
  const sail = (destination: number) => apply({ type: "sail", company: c.id, ship: ship.id, dest: destination });
  sail(dest);
  apply({ type: "activateMaritimeRules" });
  const initialFee = e.rules.fees.port_fee_per_docking;
  const arrive = () => { while (ship.dest !== null) e.advance(); };
  arrive();
  assert.equal(e.trips.get(c.id)!.at(-1)!.costs!.portFees, initialFee);
  for (let count = 0; count < 4; count++) { sail(ship.port === dest ? 0 : dest); arrive(); }
  assert.ok(e.trips.get(c.id)!.at(-1)!.costs!.portFees > initialFee);
});

test("emergency credit is once per season, is a liability and repays from surplus after grace", () => {
  const { e, apply, company } = world();
  const c = company("Merchant");
  apply({ type: "activateMaritimeRules" });
  c.cash = 200;
  const before = e.netWorth(c);
  apply({ type: "emergencyCredit", company: c.id });
  assert.equal(e.netWorth(c), before);
  assert.equal(e.apply({ type: "emergencyCredit", company: c.id }).ok, false);
  assert.ok(e.maritime.grace(c));
  c.cash += 10000;
  while (e.tick < 47) e.advance();
  assert.equal(e.maritime.view(c)!.loan!.balance, 1000);
  e.advance();
  assert.equal(e.maritime.view(c)!.loan!.balance, 0);
  assert.equal(e.maritime.grace(c), false);
});

test("futures collateral cannot be drawn twice and settlement is deterministic", () => {
  const run = () => {
    const { e, apply, company } = world();
    const c = company("Speculator");
    apply({ type: "activateMaritimeRules" });
    const worth = e.netWorth(c), cash = c.cash;
    apply({ type: "machineryFuture", company: c.id, side: "long" });
    assert.equal(e.netWorth(c), worth);
    assert.equal(e.apply({ type: "machineryFuture", company: c.id, side: "short" }).ok, false);
    for (let i = 0; i < 24; i++) e.advance();
    assert.equal(e.maritime.view(c)!.future, undefined);
    assert.ok(Math.abs(c.cash - cash) <= e.maritime.view(c)!.futureMargin);
    return c.cash;
  };
  assert.equal(run(), run());
});

test("an escort moves both ships together and releases escrow after docking", () => {
  const { e, apply, company } = world();
  const merchant = company("Merchant"), helper = company("Privateer");
  apply({ type: "activateMaritimeRules" });
  helper.cash += 20000;
  const guard = apply({ type: "buyShip", company: helper.id, port: 0, shipType: "pirate" }).id!;
  const s = e.ships.get(merchant.ships[0])!, p = e.ships.get(guard)!;
  const dest = e.dist[0].findIndex((d, i) => i !== 0 && Number.isFinite(d));
  const worth = e.netWorth(merchant);
  apply({ type: "offerEscort", company: merchant.id, ship: s.id, dest });
  assert.equal(e.netWorth(merchant), worth);
  apply({ type: "acceptEscort", company: helper.id, ship: guard, target: s.id });
  assert.ok(e.maritime.protected(s));
  assert.equal(s.arriveTick, p.arriveTick);
  const cash = helper.cash, fee = e.maritime.fee(helper, 0, dest);
  while (s.dest !== null) e.advance();
  assert.equal(p.port, dest);
  assert.ok(!e.maritime.protected(s));
  assert.ok(Math.abs(helper.cash - (cash + 200 - fee)) < 1e-8);
});

test("insured raid loss is bounded and stolen goods can only be fenced at the haven", () => {
  const { e, apply, company } = world();
  const merchant = company("Merchant"), pirate = company("Pirate");
  apply({ type: "activateMaritimeRules" });
  pirate.cash += 20000;
  const p = e.ships.get(apply({ type: "buyShip", company: pirate.id, port: 0, shipType: "pirate" }).id!)!;
  const s = e.ships.get(merchant.ships[0])!;
  s.good = 0; s.qty = 100; s.cost = 1000;
  apply({ type: "insureCargo", company: merchant.id, ship: s.id });
  const cash = merchant.cash;
  p.good = 0; p.qty = 25; p.cost = 250;
  s.qty -= 25; s.cost -= 250;
  e.maritime.raid(p, s, 0, 25, 250, true);
  assert.equal(merchant.cash - cash, 187.5);
  assert.equal(e.apply({ type: "sell", company: pirate.id, ship: p.id }).ok, false);
  const before = e.stock[0][0];
  assert.equal(apply({ type: "fenceCargo", company: pirate.id, ship: p.id }).sold, 25);
  assert.equal(e.stock[0][0], before);
  assert.equal(p.qty, 0);
  assert.equal(e.maritime.view(merchant)!.bounties[0].amount, 180);
});

test("a rescue charter dispatches cargo and guarantees enough on delivery to restart", () => {
  const { e, apply, company } = world();
  const c = company("Merchant");
  apply({ type: "activateMaritimeRules" });
  c.cash = 100;
  const ship = e.ships.get(c.ships[0])!;
  assert.ok(e.maritime.view(c)!.consignment);
  apply({ type: "emergencyConsignment", company: c.id });
  assert.notEqual(ship.dest, null);
  assert.ok(ship.qty > 0);
  assert.equal(e.apply({ type: "emergencyCredit", company: c.id }).ok, false);
  while (ship.dest !== null) e.advance();
  assert.equal(ship.qty, 0);
  const trip = e.trips.get(c.id)!.at(-1)!;
  assert.ok(trip.earned >= trip.spent + 99);
});

test("a harbor upgrade consumes cash and machinery and quotes lower arrival fees", () => {
  const { e, apply, company } = world();
  const c = company("Sponsor");
  apply({ type: "activateMaritimeRules" });
  const ship = e.ships.get(c.ships[0])!;
  ship.good = 3; ship.qty = 20; ship.cost = 1000;
  const base = e.maritime.fee(c, 1, 0);
  const cash = c.cash;
  apply({ type: "upgradeHarbor", company: c.id, ship: ship.id });
  assert.equal(ship.qty, 10);
  assert.equal(c.cash, cash - 1000);
  assert.equal(e.maritime.fee(c, 1, 0), base * 0.95);
  assert.equal(e.apply({ type: "upgradeHarbor", company: c.id, ship: ship.id }).ok, false);
});

test("a reserved return order stays funded and settles at arrival", () => {
  const { e, apply, company } = world();
  const c = company("Carrier"), buyer = company("Buyer");
  apply({ type: "activateMaritimeRules" });
  const ship = e.ships.get(c.ships[0])!;
  const dest = e.dist[0].findIndex((d, i) => i !== 0 && Number.isFinite(d));
  apply({ type: "sail", company: c.id, ship: ship.id, dest });
  while (ship.dest !== null) e.advance();
  e.stock[dest][0] = e.targets[0] * 4;
  const price = e.rules.commodities.grain.ceiling;
  const order = apply({ type: "placeOrder", company: buyer.id, port: 0, good: "grain", qty: 50, price }).id!;
  const reservation = apply({ type: "reserveBackhaul", company: c.id, ship: ship.id, order, qty: 30 }).id!;
  assert.equal(e.orders.get(order)!.qty, 20);
  assert.equal(e.apply({ type: "cancelOrder", company: buyer.id, order: reservation }).ok, false);
  while (ship.dest !== null) e.advance();
  assert.equal(ship.qty, 0);
  assert.equal(e.orders.has(reservation), false);
  assert.ok(Math.abs(e.trips.get(c.id)!.at(-1)!.earned - 30 * price * (1 - e.rules.fees.trade_tax_rate)) < 1e-8);
});
