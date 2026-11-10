// Every feature module from all eleven categories switched on at once: the world still runs and replays exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";

const CATEGORIES = ["ships", "ports", "world", "economy", "contracts", "progression", "ui", "art", "platform", "community", "social"];

test("every module has a switch in its category file, and economy modules ship off", () => {
  const mods = [...featureWorld().e.features.modules.values()];
  for (const m of mods) {
    const cat = m.id.split(".")[0];
    assert.ok(CATEGORIES.includes(cat), m.id);
    const cfg = JSON.parse(readFileSync(new URL(`../../config/features/${cat}.json`, import.meta.url), "utf8"));
    assert.equal(cfg[m.id], !m.economy, m.id);
  }
});

test("all 394 modules on together: a few days of play replay exactly", () => {
  const all = [...featureWorld().e.features.modules.keys()];
  assert.equal(all.length, 394);
  assertReplays(all, w => {
    const a = w.company("A"), b = w.company("B");
    const to = w.reachable(0);
    assert.ok(w.run({ type: "sail", company: a.id, ship: a.ships[0], dest: to, buy: { good: "grain", qty: 40 } }).ok);
    w.run({ type: "sail", company: b.id, ship: b.ships[0], dest: to });
    w.hours(72);
    w.run({ type: "sell", company: a.id, ship: a.ships[0] });
    w.hours(100);
  });
});
