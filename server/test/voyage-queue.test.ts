import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function opening() {
  const engine = new Engine(rules, map);
  assert.ok(engine.apply({ type: "register", name: "Fleet", startPort: 0 }).ok);
  const company = [...engine.companies.values()][0];
  const ship = engine.ships.get(company.ships[0])!;
  const destination = engine.dist[0].findIndex((distance, port) => port !== 0 && Number.isFinite(distance));
  assert.ok(destination > 0);
  const queue = { type: "setVoyageQueue" as const, company: company.id, ship: ship.id };
  return { engine, company, ship, destination, queue };
}

test("queued trade sells cargo and dispatches the next leg during tick replay", () => {
  const run = () => {
    const { engine, company, ship, destination, queue } = opening();
    assert.ok(engine.apply({ ...queue, legs: [
      { dest: destination, buy: { good: "grain", qty: 10 }, maxSpend: 10000, minProceeds: 0 },
      { dest: 0, maxSpend: 10000, minProceeds: 0 },
    ] }).ok);
    engine.advance();
    assert.equal(ship.dest, destination);
    assert.equal(ship.qty, 10);
    while (engine.tick < ship.arriveTick - 1) engine.advance();
    engine.advance();
    assert.equal(ship.dest, 0);
    assert.equal(ship.qty, 0);
    while (ship.dest !== null) engine.advance();
    assert.equal(engine.voyageQueues.size, 0);
    return { cash: company.cash, trips: engine.trips.get(company.id) };
  };
  assert.deepEqual(run(), run());
});

test("queue stops at the spending or sale limit and can be cancelled", () => {
  const { engine, company, ship, destination, queue } = opening();
  assert.ok(engine.apply({ ...queue, legs: [{ dest: destination, maxSpend: 1, minProceeds: 0 }] }).ok);
  const cash = company.cash;
  engine.advance();
  assert.match(engine.voyageQueues.get(ship.id)?.paused ?? "", /spending limit/);
  assert.equal(company.cash, cash);
  assert.equal(ship.dest, null);
  assert.ok(engine.apply({ ...queue, legs: [{ dest: destination, buy: { good: "grain", qty: 10 }, maxSpend: 10000, minProceeds: 9000 }] }).ok);
  engine.advance();
  assert.equal(ship.dest, destination);
  while (ship.dest !== null) engine.advance();
  assert.match(engine.voyageQueues.get(ship.id)?.paused ?? "", /minimum proceeds/);
  assert.equal(ship.qty, 10);
  assert.ok(engine.apply({ ...queue, legs: [] }).ok);
  assert.equal(engine.voyageQueues.size, 0);
  assert.ok(engine.applyLive({ type: "sell", company: company.id, ship: ship.id }).ok);
});

test("autonomous dispatch charges 10 credits within the spending limit after maritime activation", () => {
  const control = opening();
  control.engine.advance();
  const quoted = control.engine.voyageQuote({ type: "sail", company: control.company.id,
    ship: control.ship.id, dest: control.destination });
  assert.ok(quoted.ok && "quote" in quoted);
  const { fuelCost, portFee, profit } = quoted.quote;
  const testDispatch = (activate: boolean, cap: number) => {
    const game = opening();
    if (activate) assert.ok(game.engine.apply({ type: "activateMaritimeRules" }).ok);
    assert.ok(game.engine.apply({ ...game.queue, legs: [{ dest: game.destination, maxSpend: cap, minProceeds: 0 }] }).ok);
    const before = game.company.cash;
    game.engine.advance();
    return { ...game, spent: before - game.company.cash, trip: game.engine.openTrip(game.company.id, game.ship.id) };
  };

  const limit = fuelCost + portFee + 5;
  const legacy = testDispatch(false, limit);
  assert.equal(legacy.ship.dest, legacy.destination);
  assert.ok(Math.abs(legacy.spent - fuelCost) < 1e-8);
  assert.equal(legacy.trip?.costs?.dispatch, undefined);

  const paused = testDispatch(true, limit);
  assert.match(paused.engine.voyageQueues.get(paused.ship.id)?.paused ?? "", /spending limit/);
  assert.equal(paused.spent, 0);
  assert.equal(paused.ship.dest, null);

  const departed = testDispatch(true, limit + 10);
  assert.equal(departed.ship.dest, departed.destination);
  assert.ok(Math.abs(departed.spent - fuelCost - 10) < 1e-8);
  assert.equal(departed.trip?.costs?.dispatch, 10);
  assert.equal(departed.trip?.spent, fuelCost + 10);
  assert.equal(departed.trip?.estimate?.profit, profit - 10);
});
