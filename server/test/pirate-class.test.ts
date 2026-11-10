import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const err = (r: any) => (r.ok ? "" : r.error);
function world(edit?: (r: any) => void) {
  const r = structuredClone(rules); edit?.(r);
  const e = new Engine(r, map, 60);
  const home = 0, away = 1;
  const c = (e.apply({ type: "register", name: "Corsair Co", startPort: home }) as any).id;
  return { e, c, home, away };
}

test("the pirate class is the fastest and smallest, and costs more per unit of hold", () => {
  const { e } = world();
  const p = e.spec("pirate"), all = ["coaster", "freighter", "bulker"].map(t => e.spec(t as any));
  assert.ok(all.every(s => p.speed_per_hour > s.speed_per_hour), "faster than every trading class");
  assert.ok(all.every(s => p.capacity < s.capacity), "smaller hold than every trading class");
  assert.ok(all.every(s => p.price / p.capacity > s.price / s.capacity), "dear per unit of hold");
  assert.ok(p.price <= rules.company.start_cash, "a new company can afford one");
});

test("a pirate ship is bought at your home port, and nowhere else", () => {
  const { e, c, home, away } = world();
  const co = e.companies.get(c)!;
  co.cash = 30000;
  // Dock another ship away from home: still not allowed there.
  e.apply({ type: "buyShip", company: c, port: home, shipType: "coaster" });
  const second = co.ships[1];
  e.apply({ type: "sail", company: c, ship: second, dest: away });
  while (e.ships.get(second)!.dest !== null) e.advance();
  assert.equal(err(e.apply({ type: "buyShip", company: c, port: away, shipType: "pirate" })), "pirate ships are sold only at your home port");
  const cashBefore = co.cash;
  const bought = e.apply({ type: "buyShip", company: c, port: home, shipType: "pirate" });
  assert.ok(bought.ok);
  const ship = e.ships.get((bought as any).id)!;
  assert.equal(ship.type, "pirate");
  assert.equal(ship.port, home);
  assert.equal(co.cash, cashBefore - rules.ship_types.pirate.price);
});

test("a pirate ship counts toward the fleet limit, upkeep and net worth like any other ship", () => {
  const { e, c, home } = world();
  const co = e.companies.get(c)!; co.cash = 100000;
  const before = e.netWorth(co), upkeepBefore = e.upkeepDue(co);
  assert.ok(e.apply({ type: "buyShip", company: c, port: home, shipType: "pirate" }).ok);
  assert.equal(e.upkeepDue(co) - upkeepBefore, e.spec("pirate").upkeep);
  assert.equal(e.netWorth(co), before - rules.ship_types.pirate.price / 2, "worth drops by half the price, as for any ship");
  for (let i = 0; i < 3; i++) e.apply({ type: "buyShip", company: c, port: home, shipType: "pirate" });
  assert.equal(err(e.apply({ type: "buyShip", company: c, port: home, shipType: "pirate" })), "fleet is at its maximum");
});

test("with pirates switched off, the class cannot be bought and nothing else changes", () => {
  const { e, c, home } = world(r => { r.pirates.enabled = false; });
  e.companies.get(c)!.cash = 30000;
  assert.equal(err(e.apply({ type: "buyShip", company: c, port: home, shipType: "pirate" })), "there are no pirate ships in this world");
  assert.ok(e.apply({ type: "buyShip", company: c, port: home, shipType: "bulker" }).ok);
  // An old rules file without the section behaves the same.
  const old = structuredClone(rules); delete old.pirates; delete old.police; delete old.ship_types.pirate;
  const e2 = new Engine(old, map, 60);
  const c2 = (e2.apply({ type: "register", name: "Old Rules", startPort: 0 }) as any).id;
  e2.companies.get(c2)!.cash = 30000;
  assert.equal(err(e2.apply({ type: "buyShip", company: c2, port: 0, shipType: "pirate" })), "there are no pirate ships in this world");
});
