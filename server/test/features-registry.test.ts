import { test } from "node:test";
import assert from "node:assert/strict";
import { FeatureRegistry } from "../src/features/registry.ts";
import { FEATURE_FACTORIES } from "../src/features/index.ts";
import { desiredFeatures } from "../src/features/config.ts";
import type { FeatureModule } from "../src/features/types.ts";
import { featureWorld } from "./feature-helpers.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function withTestModule(module: FeatureModule) {
  const w = featureWorld();
  (w.e as unknown as { features: FeatureRegistry }).features = new FeatureRegistry(w.e, [() => module]);
  return w;
}

test("modules are off until switched on, and off modules change nothing", () => {
  const w = withTestModule({ id: "test.fuel", ideas: [], title: "Test", economy: true, adjust: { fuel: v => v * 2, upkeep: v => v + 7 } });
  const c = w.company("A");
  const before = w.e.upkeepDue(c);
  assert.equal(w.e.features.adjust("fuel", 10, { ship: 1, from: 0, dest: 1 }), 10);
  w.apply({ type: "setFeatures", enabled: ["test.fuel"] });
  assert.equal(w.e.features.adjust("fuel", 10, { ship: 1, from: 0, dest: 1 }), 20);
  assert.equal(w.e.upkeepDue(c), before + 7);
  w.apply({ type: "setFeatures", enabled: [] });
  assert.equal(w.e.upkeepDue(c), before);
});

test("feature commands reach only switched-on modules", () => {
  let calls = 0;
  const w = withTestModule({ id: "test.ping", ideas: [], title: "Ping", economy: false, apply: () => { calls++; return { ok: true }; },
    cards: () => [{ title: "Ping", detail: "x", actions: [{ label: "Ping", command: { type: "feature", module: "test.ping", action: "ping" } }] }] });
  const c = w.company("A");
  assert.equal(w.act(c, "test.ping", "ping").ok, false);
  w.apply({ type: "setFeatures", enabled: ["test.ping"] });
  assert.equal(w.act(c, "test.ping", "ping").ok, true);
  assert.equal(calls, 1);
  assert.equal(w.e.features.cards(c.id)["test.ping"].cards.length, 1);
  assert.equal(w.run({ type: "setFeatures", enabled: ["nope"] }).ok, false);
});

test("hooks change sailing costs and capacity only while a module is on", () => {
  const w = withTestModule({ id: "test.hooks", ideas: [], title: "Hooks", economy: true,
    adjust: { travelHours: v => v + 5, portFee: () => 0, capacity: v => v + 10, tradeTax: () => 0 } });
  const c = w.company("A");
  const s = w.e.ships.get(c.ships[0])!;
  const dest = w.reachable(s.port);
  const base = w.e.voyageQuote({ type: "sail", company: c.id, ship: s.id, dest });
  const cap = w.e.expansionCapacity(s);
  w.apply({ type: "setFeatures", enabled: ["test.hooks"] });
  const hooked = w.e.voyageQuote({ type: "sail", company: c.id, ship: s.id, dest });
  assert.ok(base.ok && hooked.ok);
  assert.equal(hooked.quote.hours, base.quote.hours + 5);
  assert.equal(hooked.quote.portFee, 0);
  assert.equal(w.e.expansionCapacity(s), cap + 10);
});

test("every registered module has a unique id, ideas and a config switch", () => {
  const ids = new Set<string>();
  const w = featureWorld();
  for (const make of FEATURE_FACTORIES) {
    const m = make(w.e);
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.match(m.id, /^[a-z]+\.[a-z0-9-]+$/);
    assert.ok(m.ideas.length > 0, `${m.id} lists no ideas`);
  }
});

test("config files pick switched-on modules; FEATURES env overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "features-"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ _comment: "x", "a.one": true, "a.two": false }));
  const known = ["a.one", "a.two", "b.three"];
  assert.deepEqual(desiredFeatures(dir, known), ["a.one"]);
  assert.deepEqual(desiredFeatures(dir, known, "all"), known);
  assert.deepEqual(desiredFeatures(dir, known, "none"), []);
  assert.deepEqual(desiredFeatures(dir, known, "-a.one,+b.three"), ["b.three"]);
});
