import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

function setup() {
  const engine = new Engine(rules, map);
  assert.ok(engine.apply({ type: "activateMaritimeRules" }).ok);
  assert.ok(engine.apply({ type: "register", name: "Covered Freight", startPort: 0 }).ok);
  const company = [...engine.companies.values()][0];
  const ship = engine.ships.get(company.ships[0])!;
  const cmd: Extract<Command, { type: "sail" }> = {
    type: "sail", company: company.id, ship: ship.id,
    dest: engine.dist[0].findIndex((distance, port) => port !== 0 && Number.isFinite(distance)),
    buy: { good: "grain", qty: 20 },
    protection: { insurance: true, convoy: true },
  };
  return { engine, company, ship, cmd };
}

test("a single dispatch buys cargo, books both protections and charges the quoted costs", () => {
  const run = () => {
    const { engine, company, ship, cmd } = setup();
    const base = engine.voyageQuote({ ...cmd, protection: undefined });
    const protectedQuote = engine.voyageQuote(cmd);
    assert.ok(base.ok && "quote" in base);
    assert.ok(protectedQuote.ok && "quote" in protectedQuote);
    const quote = protectedQuote.quote;
    assert.ok(quote.insurancePremium >= 10 && quote.convoyFee >= 20);
    const charge = quote.insurancePremium + quote.convoyFee;
    assert.equal(quote.cashAfterDeparture, base.quote.cashAfterDeparture - charge);
    assert.equal(quote.profit, base.quote.profit - charge);
    assert.ok(engine.applyLive(cmd).ok);
    assert.equal(company.cash, quote.cashAfterDeparture);
    assert.equal(ship.qty, cmd.buy!.qty);
    assert.equal(engine.trips.get(company.id)?.at(-1)?.costs?.protection, charge);
    assert.ok(engine.maritime.protected(ship));
    assert.ok(engine.maritime.view(company)?.ships[0].insurance);
    while (ship.dest !== null) engine.advance();
    assert.equal(engine.maritime.view(company)?.ships[0].insurance, false);
    assert.equal(engine.maritime.view(company)?.ships[0].convoy, false);
    return { cash: company.cash, trips: engine.trips.get(company.id) };
  };
  assert.deepEqual(run(), run());
});

test("last-ship fuel can be financed but cargo and both protections require available cash", () => {
  const { engine, company, ship, cmd } = setup();
  const result = engine.voyageQuote(cmd);
  assert.ok(result.ok && "quote" in result);
  const { requiredCash } = result.quote;
  const stock = engine.stock.map(row => row.slice());
  company.cash = requiredCash - 1;
  assert.deepEqual(engine.applyLive(cmd), { ok: false, error: "not enough cash" });
  assert.equal(engine.cashRequired(cmd), requiredCash);
  assert.deepEqual(engine.stock, stock);
  assert.equal(ship.dest, null);
  assert.equal(ship.qty, 0);
  assert.equal(company.cash, requiredCash - 1);
  assert.equal(engine.maritime.view(company)?.ships[0].insurance, false);
  company.cash = requiredCash;
  assert.ok(engine.applyLive(cmd).ok);
  assert.ok(company.cash < 0, "only fuel went on credit");
});

test("unladen ships and malformed flags are refused without moving the ship", () => {
  const { engine, ship, cmd } = setup();
  assert.equal(engine.applyLive({ ...cmd, buy: undefined }).ok, false);
  assert.equal(engine.applyLive({ ...cmd, protection: { insurance: "true" } } as unknown as Command).ok, false);
  assert.equal(ship.dest, null);
});

test("standalone protection for a docked hold cannot be transferred to a new load", () => {
  const { engine, company, ship, cmd } = setup();
  ship.qty = 10;
  ship.good = 0;
  ship.cost = 100;
  assert.ok(engine.applyLive({ type: "bookConvoy", company: company.id, ship: ship.id }).ok);
  assert.ok(engine.applyLive({ type: "insureCargo", company: company.id, ship: ship.id }).ok);
  assert.ok(engine.applyLive({ type: "sell", company: company.id, ship: ship.id }).ok);
  assert.ok(engine.applyLive({ ...cmd, protection: undefined }).ok);
  assert.equal(engine.maritime.protected(ship), false);
  assert.equal(engine.maritime.view(company)?.ships[0].insurance, false);
});
