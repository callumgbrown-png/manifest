// World difficulty presets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const presets = rules.difficulty.presets;

test("a new world starts at the default difficulty, matching the base rules", () => {
  const e = new Engine(rules, map);
  assert.equal(e.difficulty, rules.difficulty.default);
  const { botMinProfit, ...normal } = presets.normal;
  assert.equal(botMinProfit, 0);
  assert.deepEqual(normal, { tax: rules.fees.trade_tax_rate, portFee: rules.fees.port_fee_per_docking, upkeep: rules.ship.upkeep_per_day });
});

test("each preset sets tax, port fee and upkeep for everyone", () => {
  for (const level of ["easy", "normal", "hard"]) {
    const e = new Engine(rules, map);
    assert.ok(e.apply({ type: "setDifficulty", level }).ok);
    assert.equal(e.difficulty, level);
    assert.equal(e.rules.fees.trade_tax_rate, presets[level].tax);
    assert.equal(e.rules.fees.port_fee_per_docking, presets[level].portFee);
    assert.equal(e.rules.ship.upkeep_per_day, presets[level].upkeep);
    assert.equal(e.metrics().difficulty, level);
  }
  assert.ok(presets.easy.tax < presets.normal.tax && presets.normal.tax < presets.hard.tax);
});

test("easy makes bots pickier, leaving smaller margins for players", () => {
  const e = new Engine(rules, map);
  assert.equal(e.botMinProfit, 0);
  e.apply({ type: "setDifficulty", level: "easy" });
  assert.equal(e.botMinProfit, presets.easy.botMinProfit);
  assert.ok(e.botMinProfit > 0);
});

test("easy makes the same trade pay more than hard", () => {
  const run = (level: string) => {
    const e = new Engine(rules, map);
    e.apply({ type: "setDifficulty", level });
    const c = e.companies.get((e.apply({ type: "register", name: "A", startPort: 0 }) as any).id)!;
    const s = e.ships.get(c.ships[0])!;
    s.good = 0; s.qty = 100;
    const before = c.cash;
    e.apply({ type: "sell", company: c.id, ship: s.id });
    return c.cash - before;
  };
  assert.ok(run("easy") > run("normal") && run("normal") > run("hard"));
});

test("unknown levels are refused; hand edits show as custom; matching a preset names it again", () => {
  const e = new Engine(rules, map);
  for (const level of ["impossible", "", "__proto__", "toString", 3 as any]) assert.equal(e.apply({ type: "setDifficulty", level }).ok, false, String(level));
  assert.equal(e.difficulty, "normal");
  e.apply({ type: "adminSet", tax: 0.05 });
  assert.equal(e.difficulty, "custom");
  e.apply({ type: "adminSet", tax: presets.easy.tax, portFee: presets.easy.portFee, upkeep: presets.easy.upkeep });
  assert.equal(e.difficulty, "easy");
});

test("difficulty can be changed after the season ends, and replays exactly", () => {
  const e = new Engine(rules, map);
  e.tick = e.seasonHours;
  assert.ok(e.apply({ type: "setDifficulty", level: "hard" }).ok);
  const cmds = [{ type: "register", name: "A", startPort: 1 }, { type: "setDifficulty", level: "easy" }] as const;
  const a = new Engine(rules, map), b = new Engine(rules, map);
  for (const c of cmds) { a.apply(c as any); b.apply(c as any); }
  assert.deepEqual(a.rules, b.rules);
  assert.equal(a.difficulty, "easy");
});
