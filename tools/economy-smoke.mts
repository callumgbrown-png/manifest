import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Engine, GOODS } from "../server/src/engine.ts";
import { generateRandomSeason } from "../server/src/random-season.ts";
import { runBots, botName } from "../server/src/bots.ts";

const rules = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url), "utf8"));
for (const seed of ["industry-smoke-a", "industry-smoke-b"]) {
  const map = await generateRandomSeason({ seed });
  const engine = new Engine(rules, map, 30);
  const bots: number[] = [];
  for (let i = 0; i < 30; i++) {
    const result = engine.apply({ type: "register", name: botName(i), startPort: i % 40 });
    assert.ok(result.ok); bots.push(result.id!);
  }
  let actions = 0;
  while (!engine.seasonOver) {
    runBots(engine, bots, cmd => { const result = engine.apply(cmd); if (result.ok) actions++; return result; });
    engine.advance();
    for (let p = 0; p < engine.n; p++) for (let g = 0; g < GOODS.length; g++) {
      assert.ok(Number.isFinite(engine.stock[p][g]) && engine.stock[p][g] >= 0);
      const band = rules.commodities[GOODS[g]], price = engine.price(p, g);
      assert.ok(price >= band.floor && price <= band.ceiling);
    }
    for (const company of engine.companies.values()) assert.ok(Number.isFinite(company.cash) && Number.isFinite(engine.netWorth(company)));
  }
  console.log(JSON.stringify({ seed, hours: engine.tick, companies: bots.length, successfulActions: actions, finiteStocksAndCash: true, pricesWithinBands: true, metrics: engine.metrics() }));
}
