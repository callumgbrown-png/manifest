import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, GOODS, type Command, type MapData, type Rules } from "../src/engine.ts";
import type { GuildBackhaulCommand } from "../src/guild-freight.ts";

const rules: Rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map: MapData = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function returning(activeRules = rules, activeMap = map) {
  const engine = new Engine(activeRules, activeMap);
  const apply = (cmd: Command) => {
    const result = engine.applyLive(cmd);
    assert.ok(result.ok, JSON.stringify(result));
    return result;
  };
  apply({ type: "activateMaritimeRules" });
  const company = engine.companies.get(apply({ type: "register", name: "Merchant", startPort: 0 }).id!)!;
  const ship = engine.ships.get(company.ships[0])!;
  const dest = engine.dist[0].findIndex((d, port) => port !== 0 && Number.isFinite(d));
  const arrive = () => { while (ship.dest !== null) engine.advance(); };
  apply({ type: "sail", company: company.id, ship: ship.id, dest });
  arrive();
  const dispatch = () => {
    const offer = engine.guildFreight.view(company, ship).offer;
    assert.ok(offer);
    const cmd: GuildBackhaulCommand = { type: "dispatchGuildBackhaul", company: company.id, ship: ship.id, dest: offer.dest,
      good: offer.good, qty: offer.qty, maxSpend: offer.cost, minProceeds: offer.proceeds };
    return { offer, cmd };
  };
  return { engine, apply, company, ship, arrive, dispatch };
}

test("guild dispatch protects quoted limits and pays the fixed amount only at full delivery", () => {
  const { engine, apply, company, ship, arrive, dispatch } = returning();
  const { offer, cmd } = dispatch();
  const cash = company.cash;
  assert.equal(engine.applyLive({ ...cmd, maxSpend: offer.cost - 1 }).ok, false);
  assert.equal(engine.applyLive({ ...cmd, minProceeds: offer.proceeds + 1 }).ok, false);
  assert.equal(company.cash, cash);
  assert.equal(ship.dest, null);
  apply(cmd);
  assert.equal(ship.dest, offer.dest);
  assert.equal(ship.qty, offer.qty);
  assert.equal(engine.guildFreight.view(company, ship).delivery?.proceeds, offer.proceeds);
  const trip = engine.openTrip(company.id, ship.id)!;
  assert.equal(trip.earned, 0);
  arrive();
  assert.equal(ship.qty, 0);
  assert.equal(trip.earned, offer.proceeds);
  assert.ok(company.cash > cash);
  assert.equal(engine.guildFreight.view(company, ship).offer, undefined);
  assert.equal(engine.guildFreight.view(company, ship).delivery, undefined);
});

test("guild does not pay for a short load and makes way for private buy orders", () => {
  const { engine, apply, company, ship, arrive, dispatch } = returning();
  const { offer, cmd } = dispatch();
  const buyer = apply({ type: "register", name: "Buyer", startPort: offer.dest }).id!;
  const good = "machinery";
  engine.stock[ship.port][GOODS.indexOf(good)] = engine.targets[GOODS.indexOf(good)] * 2;
  const order = apply({ type: "placeOrder", company: buyer, port: offer.dest, good, qty: 30,
    price: engine.rules.commodities[good].ceiling }).id!;
  assert.equal(engine.guildFreight.view(company, ship).offer, undefined);
  apply({ type: "cancelOrder", company: buyer, order });
  const current = dispatch();
  assert.equal(cmd.dest, current.cmd.dest);
  apply(current.cmd);
  ship.qty--;
  const trip = engine.openTrip(company.id, ship.id)!;
  arrive();
  assert.equal(trip.earned, 0);
  assert.equal(ship.qty, current.offer.qty - 1);
  assert.equal(engine.guildFreight.view(company, ship).delivery, undefined);
});

test("guild can spend at most its seasonal budget and reopens after the company cooldown", () => {
  const smallRules = structuredClone(rules);
  smallRules.company.start_cash = 700;
  const smallMap = { ports: map.ports.slice(0, 2), routes: [{ a: 0, b: 1, distance: 1 }] };
  const { engine, apply, company, ship, arrive, dispatch } = returning(smallRules, smallMap);
  let paid = 0;
  let deliveries = 0;
  while (engine.guildFreight.view(company, ship).offer) {
    assert.ok(deliveries < 20);
    const { offer, cmd } = dispatch();
    apply(cmd);
    arrive();
    paid += offer.proceeds;
    deliveries++;
    const ready = engine.tick + 24;
    while (engine.tick < ready) engine.advance();
  }
  assert.ok(deliveries > 1, "successful arrivals reopen after the cooldown");
  assert.ok(paid <= smallRules.company.start_cash * smallMap.ports.length);
  assert.ok(paid > 1200, "offers stop because the remaining budget is too small");
});
