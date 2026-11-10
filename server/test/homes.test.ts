import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateRandomSeason } from "../src/random-season.ts";
import { Engine, type Command } from "../src/engine.ts";
import { pickHome } from "../src/homes.ts";
import { bestStartTrip, botName } from "../src/bots.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const lcg = (seed: number) => { let r = seed; return (n: number) => { r = (r * 48271) % 2147483647; return r % n; }; };

async function world(seed: string, companies: number, random = lcg(7)) {
  const e = new Engine(rules, await generateRandomSeason({ seed }), 60);
  const log: Command[] = [];
  const startTrips: number[] = [];
  for (let i = 0; i < companies; i++) {
    const home = pickHome(e, random);
    startTrips.push(bestStartTrip(e, home));
    const cmd: Command = { type: "register", name: botName(i), startPort: home };
    e.apply(cmd); log.push(cmd);
  }
  return { e, log, startTrips };
}

test("every company has one permanent home port, which is where its first ship starts", async () => {
  const { e } = await world("home-1", 30);
  for (const c of e.companies.values()) {
    assert.ok(Number.isInteger(c.home) && c.home >= 0 && c.home < e.n);
    assert.equal(e.ships.get(c.ships[0])!.port, c.home, "the first ship starts at home");
  }
  // Homes don't move when ships sail, trade or are bought.
  const c = [...e.companies.values()][0], home = c.home, ship = e.ships.get(c.ships[0])!;
  const dest = [...Array(e.n).keys()].find(p => p !== home && Number.isFinite(e.dist[home][p]))!;
  assert.ok(e.apply({ type: "sail", company: c.id, ship: ship.id, dest }).ok);
  while (e.ships.get(ship.id)!.dest !== null) e.advance();
  assert.equal(e.companies.get(c.id)!.home, home);
});

test("homes are spread out: few companies share a port, and the homes sit farther apart than random ports would", async () => {
  const { e } = await world("home-2", 30);
  const homes = [...e.companies.values()].map(c => c.home);
  const perPort = new Map<number, number>();
  for (const h of homes) perPort.set(h, (perPort.get(h) ?? 0) + 1);
  // Homes come from the better-paying half of the ports (a fair trade nearby), so 30 companies share some.
  assert.ok(Math.max(...perPort.values()) <= 3, `at most 3 companies share a home port (got ${Math.max(...perPort.values())})`);
  // Distance from each distinct home port to the nearest other home port (by sea).
  const nearest = (hs: number[]) => { const u = [...new Set(hs)]; return u.map(h => Math.min(...u.filter(o => o !== h).map(o => e.dist[h][o]))).reduce((a, b) => a + b) / u.length; };
  const random = lcg(99); const baseline: number[] = [];
  for (let k = 0; k < 20; k++) baseline.push(nearest(homes.map(() => random(e.n))));
  const meanRandom = baseline.reduce((a, b) => a + b) / baseline.length;
  assert.ok(nearest(homes) > meanRandom, `homes' nearest-neighbour distance ${nearest(homes).toFixed(0)} beats random ${meanRandom.toFixed(0)}`);
});

test("each home has a fair trade nearby: a trip pays from it when trips pay anywhere", async () => {
  const { startTrips } = await world("home-3", 30);
  assert.ok(startTrips.every(v => v > 0), `every home had a paying first trip (${startTrips.filter(v => v <= 0).length} did not)`);
});

test("homes come back the same when the event log is replayed", async () => {
  const { e, log } = await world("home-4", 20);
  const again = new Engine(rules, e.map as any, 60);
  for (const cmd of log) again.apply(cmd);
  assert.deepEqual([...again.companies.values()].map(c => c.home), [...e.companies.values()].map(c => c.home));
});
