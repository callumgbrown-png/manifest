import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";
import { recoveryView } from "../src/recovery.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
function setup() {
  const e = new Engine(rules, map);
  const result = e.apply({ type: "register", name: "Recovery", startPort: 0 });
  assert.ok(result.ok);
  const c = e.companies.get(result.id!)!;
  return { e, c, s: e.ships.get(c.ships[0])! };
}

test("guidance leaves positive-cash state and command results unchanged", () => {
  const { e, c, s } = setup();
  const before = JSON.stringify([c, s, e.stock]);
  assert.equal(recoveryView(e, c.id).active, false);
  assert.equal(JSON.stringify([c, s, e.stock]), before);
  assert.deepEqual(e.apply({ type: "sail", company: c.id, ship: s.id, dest: 1 }), { ok: true });
});

test("detects fractional debt and explains when no cash recovery exists", () => {
  const { e, c } = setup();
  c.cash = -0.01;
  const r = recoveryView(e, c.id);
  assert.equal(r.active, true);
  assert.equal(r.cash, -0.01);
  assert.deepEqual(r.options, []);
  assert.match(r.explanation, /Waiting alone does not clear debt/);
});

test("cargo suggestion matches the actual after-tax sale, even in debt", () => {
  const { e, c, s } = setup();
  c.cash = -298; s.good = 0; s.qty = 100;
  const option = recoveryView(e, c.id).options[0];
  assert.equal(option.kind, "sell");
  assert.equal(option.amount, e.sellValue(s.port, 0, 100) * (1 - e.rules.fees.trade_tax_rate));
  assert.ok(e.apply({ type: "sell", company: c.id, ship: s.id }).ok);
  assert.equal(c.cash, option.cashAfter);
  assert.equal(recoveryView(e, c.id).active, false);
});

test("only docked empty spare ships are suggested, and scrapping pays the quote", () => {
  const { e, c, s } = setup();
  c.cash = 50000;
  const bought = e.apply({ type: "buyShip", company: c.id, port: 0, shipType: "coaster" });
  assert.ok(bought.ok);
  const spare = e.ships.get(bought.id!)!;
  c.cash = -298;
  const quote = recoveryView(e, c.id).options.find(o => o.ship === spare.id)!;
  assert.equal(quote.amount, 3500);
  assert.equal(quote.cashAfter, 3202);
  spare.qty = 1; spare.good = 0;
  assert.equal(recoveryView(e, c.id).options.some(o => o.ship === spare.id && o.kind === "scrap"), false);
  assert.equal(e.apply({ type: "scrapShip", company: c.id, ship: spare.id }).ok, false);
  spare.qty = 0; spare.good = null; spare.dest = 1;
  assert.equal(recoveryView(e, c.id).options.some(o => o.ship === spare.id), false);
  assert.equal(e.apply({ type: "scrapShip", company: c.id, ship: spare.id }).ok, false);
  spare.dest = null;
  assert.ok(e.apply({ type: "scrapShip", company: c.id, ship: spare.id }).ok);
  assert.equal(c.cash, quote.cashAfter);
  assert.equal(e.apply({ type: "scrapShip", company: c.id, ship: s.id }).ok, false);
});

test("cash shortfall quotes respect last-ship fuel credit and multi-ship fuel costs", () => {
  const { e, c, s } = setup();
  const cmd: Command = { type: "sail", company: c.id, ship: s.id, dest: 1, buy: { good: "fuel", qty: 50 } };
  const cargo = e.buyCost(0, 1, 50).cost * (1 + e.rules.fees.trade_tax_rate);
  c.cash = 1;
  assert.equal(e.apply(cmd).ok, false);
  assert.equal(recoveryView(e, c.id, cmd).shortfall, cargo - 1);
  c.cash = 50000;
  assert.ok(e.apply({ type: "buyShip", company: c.id, port: 0 }).ok);
  const need = e.cashRequired(cmd)!;
  assert.ok(need > cargo);
  c.cash = need - 1;
  assert.equal(e.apply(cmd).ok, false);
  assert.equal(recoveryView(e, c.id, cmd).shortfall, 1);
  c.cash = need;
  assert.ok(e.apply(cmd).ok);
  assert.ok(Math.abs(c.cash) < 1e-8);
});

test("escrow refunds and pending listings are distinct from instant cargo sales", () => {
  const { e, c, s } = setup();
  assert.ok(e.apply({ type: "placeOrder", company: c.id, port: 0, good: "grain", qty: 10, price: 10 }).ok);
  s.good = 0; s.qty = 10;
  assert.ok(e.apply({ type: "placeSell", company: c.id, ship: s.id, qty: 10, price: 40 }).ok);
  c.cash = -298;
  const r = recoveryView(e, c.id);
  assert.equal(r.options.find(o => o.kind === "refund")!.amount, 100);
  assert.equal(r.options.find(o => o.kind === "listing")!.immediate, false);
  assert.equal(r.options.find(o => o.kind === "listing")!.amount, 400 * (1 - e.rules.fees.trade_tax_rate));
  e.tick = e.seasonHours;
  assert.deepEqual(recoveryView(e, c.id).options, []);
  assert.match(recoveryView(e, c.id).explanation, /season has ended/);
});
