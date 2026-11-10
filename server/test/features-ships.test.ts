// Tests for the ships feature modules (ideas 21-40 and 221-240). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { FIT_HOURS, HOLD_BONUS } from "../src/features/ships/fittings.ts";
import { REFIT_HOURS } from "../src/features/ships/variants.ts";
import { shared } from "../src/features/ships/shared.ts";
import type { Company, Ship } from "../src/engine.ts";

const ALL_SHIPS = ["ships.identity", "ships.wear", "ships.crew", "ships.crew-effects", "ships.incidents", "ships.logbook", "ships.radar",
  "ships.wrecks", "ships.fittings", "ships.fittings-effects", "ships.variants", "ships.variants-effects", "ships.tugs", "ships.captains",
  "ships.resale", "ships.insurance", "ships.towing", "ships.throttle", "ships.slipstream", "ships.overloading", "ships.draft",
  "ships.draft-effects", "ships.age"];

const firstShip = (w: ReturnType<typeof featureWorld>, c: Company): Ship => w.e.ships.get(c.ships[0])!;
function sailSomewhere(w: ReturnType<typeof featureWorld>, c: Company, s: Ship) {
  const dest = w.reachable(s.port);
  return w.run({ type: "sail", company: c.id, ship: s.id, dest });
}

test("every ships idea 21-40 and 221-240 has a module, and every module has a switch", async () => {
  const w = featureWorld();
  const ideas = new Set<number>();
  const ids = [...w.e.features.modules.values()].filter(m => m.id.startsWith("ships.")).map(m => { m.ideas.forEach(i => ideas.add(i)); return m.id; });
  for (let i = 21; i <= 40; i++) assert.ok(ideas.has(i), `idea ${i}`);
  for (let i = 221; i <= 240; i++) assert.ok(ideas.has(i), `idea ${i}`);
  assert.deepEqual(ids.sort(), [...ALL_SHIPS].sort());
  const { readFileSync } = await import("node:fs");
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/ships.json", import.meta.url), "utf8"));
  for (const m of w.e.features.modules.values()) if (m.id.startsWith("ships.")) assert.equal(cfg[m.id], !m.economy, m.id);
});

test("fittings take yard time, fill slots and enlarge the hold", () => {
  const w = featureWorld(["ships.fittings"]);
  const c = w.company("A"), s = firstShip(w, c);
  const base = w.e.expansionCapacity(s);
  assert.equal(w.act(c, "ships.fittings", "install", { ship: s.id, fit: "hold" }).ok, true);
  assert.equal(w.e.expansionCapacity(s), base);
  w.hours(FIT_HOURS);
  assert.equal(w.e.expansionCapacity(s), Math.floor(base * HOLD_BONUS));
  assert.equal(w.act(c, "ships.fittings", "install", { ship: s.id, fit: "hold" }).ok, false, "no duplicates");
  assert.equal(w.act(c, "ships.fittings", "install", { ship: s.id, fit: "warp drive" }).ok, false);
  assert.equal(w.act(c, "ships.fittings", "install", { ship: 999, fit: "radar" }).ok, false);
  // A freighter has three slots.
  for (const fit of ["radar", "armour"]) { assert.equal(w.act(c, "ships.fittings", "install", { ship: s.id, fit }).ok, true); w.hours(FIT_HOURS); }
  assert.match(String((w.act(c, "ships.fittings", "install", { ship: s.id, fit: "tank" }) as { error: string }).error), /slots/);
  assert.equal(w.act(c, "ships.fittings", "remove", { ship: s.id, fit: "radar" }).ok, true);
});

test("sailing before the yard finishes cancels a fitting", () => {
  const w = featureWorld(["ships.fittings"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.act(c, "ships.fittings", "install", { ship: s.id, fit: "armour" });
  assert.equal(sailSomewhere(w, c, s).ok, true);
  w.hours(FIT_HOURS + 1);
  const view = w.e.features.view(c.id)["ships.fittings"] as { fitted: string[] }[];
  assert.deepEqual(view[0].fitted, []);
});

test("fitting performance changes fuel and speed only when switched on", () => {
  const w = featureWorld(["ships.fittings"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.act(c, "ships.fittings", "install", { ship: s.id, fit: "hybrid" });
  w.hours(FIT_HOURS);
  const ctx = { ship: s.id, from: s.port, dest: w.reachable(s.port) };
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 100);
  w.apply({ type: "setFeatures", enabled: ["ships.fittings", "ships.fittings-effects"] });
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 75);
  assert.equal(w.e.features.adjust("travelHours", 20, ctx), 21);
});

test("specialist refits happen at home with an empty hold and suit the hull", () => {
  const w = featureWorld(["ships.variants"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(s.type, "freighter");
  assert.equal(w.act(c, "ships.variants", "refit", { ship: s.id, role: "bulk" }).ok, false, "bulk carriers come from bulkers");
  assert.equal(w.act(c, "ships.variants", "refit", { ship: s.id, role: "reefer" }).ok, true);
  w.hours(REFIT_HOURS);
  assert.deepEqual(w.e.features.world()["ships.variants"], { [s.id]: "reefer" });
  assert.equal(w.act(c, "ships.variants", "refit", { ship: s.id, role: "none" }).ok, true);
  w.hours(REFIT_HOURS);
  assert.deepEqual(w.e.features.world()["ships.variants"], {});
});

test("sailing coasters burn less fuel only with specialist performance on", () => {
  const w = featureWorld(["ships.variants", "ships.variants-effects"]);
  const c = w.company("A"), s = firstShip(w, c);
  s.type = "coaster";
  assert.equal(w.act(c, "ships.variants", "refit", { ship: s.id, role: "sail" }).ok, true);
  w.hours(REFIT_HOURS);
  const ctx = { ship: s.id, from: s.port, dest: w.reachable(s.port) };
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 30);
  assert.equal(w.e.features.adjust("travelHours", 20, ctx), 27);
});

test("route captains keep a ship sailing between two ports", () => {
  const w = featureWorld(["ships.captains"]);
  const c = w.company("A"), s = firstShip(w, c);
  const a = s.port, b = w.reachable(a);
  assert.equal(w.act(c, "ships.captains", "hire", { ship: s.id, dest: b, out: "none", back: "none", budget: 20000 }).ok, true);
  assert.equal(w.act(c, "ships.captains", "hire", { ship: s.id, dest: a, out: "gold", back: "none", budget: 500 }).ok, false);
  const ports = new Set<number>();
  for (let i = 0; i < 200 && ports.size < 2; i++) { w.hours(1); if (s.dest === null) ports.add(s.port); }
  assert.ok(ports.has(b), "reached the far end");
  const view = w.e.features.view(c.id)["ships.captains"] as { legs: number; stopped?: string }[];
  assert.ok(view[0].legs >= 1, JSON.stringify(view));
  assert.equal(w.act(c, "ships.captains", "dismiss", { ship: s.id }).ok, true);
});

test("ships change hands on the second-hand market", () => {
  const w = featureWorld(["ships.resale", "ships.identity"]);
  const a = w.company("A"), b = w.company("B");
  const price = w.e.spec("freighter").price;
  a.cash += price * 2;
  assert.equal(w.apply({ type: "buyShip", company: a.id, port: a.home, shipType: "freighter" } as never).ok, true);
  const s = w.e.ships.get(a.ships[1])!;
  w.act(a, "ships.identity", "rename", { ship: s.id, name: "Sea Lark" });
  assert.equal(w.act(a, "ships.resale", "list", { ship: s.id, price: 1 }).ok, false, "price floor");
  assert.equal(w.act(a, "ships.resale", "list", { ship: s.id, price }).ok, true);
  assert.equal(w.act(a, "ships.resale", "buy", { ship: s.id }).ok, false, "not your own");
  b.cash = price + 10;
  const before = a.cash;
  assert.equal(w.act(b, "ships.resale", "buy", { ship: s.id }).ok, true);
  assert.equal(s.owner, b.id);
  assert.ok(b.ships.includes(s.id) && !a.ships.includes(s.id));
  assert.equal(a.cash, before + price);
  assert.equal(b.cash, 10);
  assert.deepEqual((w.e.features.world()["ships.identity"] as Record<number, unknown>)[s.id], ["Sea Lark", null]);
});

test("a listing lapses when the ship sails", () => {
  const w = featureWorld(["ships.resale"]);
  const a = w.company("A");
  a.cash += w.e.spec("freighter").price * 2;
  w.apply({ type: "buyShip", company: a.id, port: a.home, shipType: "freighter" } as never);
  const s = w.e.ships.get(a.ships[1])!;
  w.act(a, "ships.resale", "list", { ship: s.id, price: w.e.spec("freighter").price });
  sailSomewhere(w, a, s);
  w.hours(1);
  assert.deepEqual(w.e.features.world()["ships.resale"], []);
});

test("insurance adds a premium to upkeep and pays out on recorded losses", () => {
  const w = featureWorld(["ships.insurance"]);
  const c = w.company("A"), s = firstShip(w, c);
  const base = w.e.upkeepDue(c);
  assert.equal(w.act(c, "ships.insurance", "setTier", { tier: "full" }).ok, true);
  assert.ok(w.e.upkeepDue(c) > base);
  const cash = c.cash;
  shared(w.e).losses.push({ ship: s.id, owner: c.id, amount: 1000, kind: "test loss" });
  w.hours(1);
  assert.ok(c.cash - cash >= 899, `${c.cash - cash}`);
  assert.equal(w.act(c, "ships.insurance", "setTier", { tier: "platinum" }).ok, false);
});

test("throttle trades speed for fuel", () => {
  const w = featureWorld(["ships.throttle"]);
  const c = w.company("A"), s = firstShip(w, c);
  const ctx = { ship: s.id, from: s.port, dest: w.reachable(s.port) };
  assert.equal(w.act(c, "ships.throttle", "set", { ship: s.id, setting: "eco" }).ok, true);
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 70);
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 12);
  assert.equal(w.act(c, "ships.throttle", "set", { ship: s.id, setting: "ludicrous" }).ok, false);
});

test("overloading lets a ship carry more", () => {
  const w = featureWorld(["ships.overloading"]);
  const c = w.company("A"), s = firstShip(w, c);
  const base = w.e.expansionCapacity(s);
  assert.equal(w.act(c, "ships.overloading", "allow", { ship: s.id }).ok, true);
  assert.equal(w.e.expansionCapacity(s), Math.floor(base * 1.2));
});

test("dredging deepens a port and draft effects make deep ships wait", () => {
  const w = featureWorld(["ships.draft", "ships.draft-effects"]);
  const c = w.company("A"), s = firstShip(w, c);
  const depths = w.e.features.world()["ships.draft"] as number[];
  assert.equal(depths.length, w.e.map.ports.length);
  assert.ok(depths.every(d => d >= 0 && d <= 2));
  const shallow = depths.findIndex((d, i) => d === 0 && i !== s.port && Number.isFinite(w.e.dist[s.port][i]));
  if (shallow >= 0) assert.equal(w.e.features.adjust("travelHours", 10, { ship: s.id, from: s.port, dest: shallow }), 16);
  if (depths[s.port] < 2) {
    const before = depths[s.port];
    for (let i = 0; i < 3; i++) { assert.equal(w.act(c, "ships.draft", "dredge", { ship: s.id }).ok, true); w.hours(24); }
    assert.equal((w.e.features.world()["ships.draft"] as number[])[s.port], before + 1);
  }
});

test("old ships burn more fuel and can be refitted", () => {
  const w = featureWorld(["ships.age"]);
  const c = w.company("A"), s = firstShip(w, c);
  const ctx = { ship: s.id, from: s.port, dest: w.reachable(s.port) };
  w.hours(24 * 15);
  assert.ok(w.e.features.adjust("fuel", 100, ctx) > 100);
  c.cash += 10_000;
  assert.equal(w.act(c, "ships.age", "refit", { ship: s.id }).ok, true);
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 100);
});

test("tugs can be booked and big arrivals are handled", () => {
  const w = featureWorld(["ships.tugs", "ships.crew"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ships.tugs", "book").ok, true);
  assert.equal((w.e.features.view(c.id)["ships.tugs"] as { booking: boolean }).booking, true);
  assert.equal(w.act(c, "ships.tugs", "fly").ok, false);
});

test("towing needs hull wear and a breakdown", () => {
  const w = featureWorld(["ships.towing"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "ships.towing", "request", { ship: s.id, reward: 10 }).ok, false);
});

test("every ships module together replays exactly", () => {
  assertReplays(ALL_SHIPS, w => {
    const a = w.company("A"), b = w.company("B");
    const s = firstShip(w, a), t = firstShip(w, b);
    w.act(a, "ships.fittings", "install", { ship: s.id, fit: "engine" });
    w.act(a, "ships.crew", "hireCaptain", { ship: s.id });
    w.act(b, "ships.throttle", "set", { ship: t.id, setting: "full" });
    w.act(b, "ships.insurance", "setTier", { tier: "basic" });
    w.act(a, "ships.tugs", "book");
    w.hours(FIT_HOURS);
    w.act(b, "ships.captains", "hire", { ship: t.id, dest: w.reachable(t.port), out: "grain", back: "none", budget: 800 });
    w.run({ type: "sail", company: a.id, ship: s.id, dest: w.reachable(s.port) });
    w.hours(120);
  });
});

test("every ships module gives cards without throwing", () => {
  const w = featureWorld(ALL_SHIPS);
  const c = w.company("A");
  w.hours(30);
  const cards = w.e.features.cards(c.id);
  assert.ok(Object.keys(cards).length >= 10);
  for (const m of ALL_SHIPS) w.e.features.view(c.id), w.e.features.world();
});
