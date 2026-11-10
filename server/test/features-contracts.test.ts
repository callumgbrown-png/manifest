// Tests for the contracts feature modules (ideas 61-95 and 301-320). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import type { Company, Ship } from "../src/engine.ts";
import {
  addHeat, addRep, blockadeNow, bossNow, deliveryPay, heatOf, hideouts, namedPirates, news, pickRoute, pirateZones, repOf, roll, shared, stars,
  standingOf, tribePorts, type Contract,
} from "../src/features/contracts/core.ts";
import { GUN_PRICE, protection } from "../src/features/contracts/pirates.ts";
import { coastStations, inspectionChance, inspectorPorts, search } from "../src/features/contracts/law.ts";
import { captainPort, ghostNow, mayorWish, mechanicPorts, merchantsToday, npcTraffic, RIDDLES, strangerPort, traderPort } from "../src/features/contracts/npcs.ts";

type W = ReturnType<typeof featureWorld>;
const CFG = JSON.parse(readFileSync(new URL("../../config/features/contracts.json", import.meta.url), "utf8"));
const ALL = Object.keys(CFG).filter(k => k.startsWith("contracts."));
const IDEAS = [...Array.from({ length: 35 }, (_, i) => 61 + i), ...Array.from({ length: 20 }, (_, i) => 301 + i)];

const ship = (w: W, c: Company, i = 0): Ship => w.e.ships.get(c.ships[i])!;
const dock = (s: Ship, port: number) => { s.port = port; s.dest = null; };
const load = (s: Ship, good: number, qty: number) => { s.good = good; s.qty = qty; s.cost = qty * 10; };
/** Put a ship at sea on the lane a -> b, a fraction f along it at tick `at`. */
const placeAt = (s: Ship, a: number, b: number, f: number, at: number) => { s.port = a; s.dest = b; s.departTick = at - Math.round(f * 100); s.arriveTick = s.departTick + 100; };
/** Make the engine dock a ship at `port` during the next hour. */
const arriveNext = (w: W, s: Ship, port: number, hours = 6) => { s.dest = port; s.departTick = w.e.tick + 1 - hours; s.arriveTick = w.e.tick + 1; w.hours(1); };
const view = (w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as any;
const worldOf = (w: W, id: string) => w.e.features.world()[id] as any;
const book = (w: W, id: string) => (w.e.features.modules.get(id) as any).book;
/** Dock a ship at a contract's destination with its cargo aboard. */
const readyFor = (s: Ship, c: Contract) => { dock(s, c.to); load(s, c.good, c.qty); };

test("every contracts idea has a module, and the switch file lists every module (economy off)", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("contracts."));
  const ideas = new Set(mods.flatMap(m => m.ideas));
  for (const i of IDEAS) assert.ok(ideas.has(i), `idea ${i}`);
  for (const i of ideas) assert.ok(IDEAS.includes(i), `stray idea ${i}`);
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL].sort());
  for (const m of mods) assert.equal(CFG[m.id], !m.economy, m.id);
  // Assignment: these ideas are economy (off); 81, 83, 85-87, 89-92, 94, 95 and 302-318, 320 content (on).
  for (const id of ["contracts.convoys", "contracts.black-flag", "contracts.wanted", "contracts.inspections", "contracts.stranger"]) assert.equal(CFG[id], true, id);
  for (const id of ["contracts.timed", "contracts.ambush", "contracts.rival-companies", "contracts.travelling-merchants", "contracts.news-ledger"]) assert.equal(CFG[id], false, id);
});

// ------------------------------------------------------------ delivery contracts

test("timed contracts: accept, deliver at the destination, and input checks", () => {
  const w = featureWorld(["contracts.timed"]);
  const c = w.company("A"), s = ship(w, c);
  const b = book(w, "contracts.timed");
  assert.equal(b.offers.length, 3);
  const job: Contract = b.offers[0];
  assert.equal(w.act(c, "contracts.timed", "accept", { contract: 99999 }).ok, false);
  assert.equal(w.act(c, "contracts.timed", "accept", { contract: job.id }).ok, true);
  assert.equal(w.act(c, "contracts.timed", "deliver", { contract: job.id, ship: s.id }).ok, false, "not there yet");
  readyFor(s, job);
  assert.equal(w.act(c, "contracts.timed", "deliver", { contract: job.id, ship: "1" }).ok, false);
  const cash = c.cash;
  const r = w.act(c, "contracts.timed", "deliver", { contract: job.id, ship: s.id });
  assert.equal(r.ok, true);
  assert.equal(Math.round(c.cash - cash), job.reward);
  assert.equal(s.qty, 0);
  assert.equal(repOf(w.e, c.id), 1);
});

test("rush contracts pay a big premium and fail when the deadline passes", () => {
  const w = featureWorld(["contracts.rush"]);
  const c = w.company("A");
  const job: Contract = book(w, "contracts.rush").offers[0];
  assert.ok(job.reward >= job.qty * w.e.price(job.to, job.good) * 1.7);
  w.act(c, "contracts.rush", "accept", { contract: job.id });
  w.hours(job.deadline - w.e.tick + 1);
  assert.equal(book(w, "contracts.rush").taken.size, 0);
  assert.equal(repOf(w.e, c.id), -1);
});

test("the daily board posts five jobs and replaces them each morning", () => {
  const w = featureWorld(["contracts.board"]);
  w.company("A");
  const first = book(w, "contracts.board").offers.map((o: Contract) => o.id);
  assert.equal(first.length, 5);
  w.hours(24 - (w.e.tick % 24));
  const next = book(w, "contracts.board").offers.map((o: Contract) => o.id);
  assert.equal(next.length, 5);
  assert.ok(next.every((id: number) => !first.includes(id)));
});

test("government contracts need a licence (reputation 3, no wanted stars)", () => {
  const w = featureWorld(["contracts.government"]);
  const c = w.company("A");
  const id = book(w, "contracts.government").offers[0].id;
  assert.match(String((w.act(c, "contracts.government", "accept", { contract: id }) as any).error), /reputation/);
  addRep(w.e, c.id, 3);
  addHeat(w.e, c.id, 40);
  assert.match(String((w.act(c, "contracts.government", "accept", { contract: id }) as any).error), /wanted/);
  shared(w.e).heat.delete(c.id);
  assert.equal(w.act(c, "contracts.government", "accept", { contract: id }).ok, true);
});

test("exclusive contracts are for reputation 8 and pay double", () => {
  const w = featureWorld(["contracts.exclusive"]);
  const c = w.company("A");
  const job: Contract = book(w, "contracts.exclusive").offers[0];
  assert.ok(job.reward >= job.qty * w.e.price(job.to, job.good) * 1.9);
  assert.equal(w.act(c, "contracts.exclusive", "accept", { contract: job.id }).ok, false);
  addRep(w.e, c.id, 8);
  assert.equal(w.act(c, "contracts.exclusive", "accept", { contract: job.id }).ok, true);
});

test("late penalties allow late delivery at reduced pay; without them it is refused", () => {
  const w = featureWorld(["contracts.timed"]);
  const c = w.company("A"), s = ship(w, c);
  const job: Contract = book(w, "contracts.timed").offers[0];
  w.act(c, "contracts.timed", "accept", { contract: job.id });
  const held: Contract = book(w, "contracts.timed").taken.get(job.id);
  held.deadline = w.e.tick - 7;   // 7 h late
  readyFor(s, held);
  assert.equal(deliveryPay(w.e, held), null);
  assert.equal(w.act(c, "contracts.timed", "deliver", { contract: job.id, ship: s.id }).ok, false);
  w.apply({ type: "setFeatures", enabled: ["contracts.timed", "contracts.late-penalty"] });
  assert.equal(deliveryPay(w.e, held), Math.round(held.reward * 0.8));
  const cash = c.cash;
  assert.equal(w.act(c, "contracts.timed", "deliver", { contract: job.id, ship: s.id }).ok, true);
  assert.equal(Math.round(c.cash - cash), Math.round(held.reward * 0.8));
  assert.ok(worldOf(w, "contracts.late-penalty").grace > 0);
});

test("milk runs pay at each stop, in order", () => {
  const w = featureWorld(["contracts.milk-run"]);
  const c = w.company("A"), s = ship(w, c);
  const run = view(w, c, "contracts.milk-run").offers[0];
  assert.ok(run.stops.length >= 2);
  assert.equal(w.act(c, "contracts.milk-run", "accept", { contract: run.id }).ok, true);
  load(s, run.good, 100);
  dock(s, run.stops[1].port);
  assert.equal(w.act(c, "contracts.milk-run", "stop", { contract: run.id, ship: s.id }).ok, false, "wrong order");
  for (const stop of run.stops) {
    dock(s, stop.port);
    const cash = c.cash;
    assert.equal(w.act(c, "contracts.milk-run", "stop", { contract: run.id, ship: s.id }).ok, true);
    assert.ok(c.cash > cash);
  }
  assert.equal(view(w, c, "contracts.milk-run").held.length, 0);
});

test("community contracts are filled by many companies and pay a bonus when complete", () => {
  const w = featureWorld(["contracts.community"]);
  const a = w.company("A"), b = w.company("B", 1);
  const pool = worldOf(w, "contracts.community").open;
  for (const c of [a, b]) { const s = ship(w, c); dock(s, pool.port); load(s, pool.good, 100); }
  assert.equal(w.act(a, "contracts.community", "contribute", { ship: ship(w, a).id, qty: 1.5 }).ok, false);
  assert.equal(w.act(a, "contracts.community", "contribute", { ship: ship(w, a).id }).ok, true);
  assert.equal(worldOf(w, "contracts.community").open.contributors, 1);
  for (let i = 0; i < 2; i++) { load(ship(w, a), pool.good, 100); w.act(a, "contracts.community", "contribute", { ship: ship(w, a).id }); }
  const before = b.cash;
  assert.equal(w.act(b, "contracts.community", "contribute", { ship: ship(w, b).id }).ok, true);
  assert.equal(worldOf(w, "contracts.community").open, null, "target met");
  assert.ok(b.cash > before);
  assert.equal(worldOf(w, "contracts.community").history.length, 1);
});

test("emergency relief wants grain or fuel and pays a premium per tonne", () => {
  const w = featureWorld(["contracts.relief"]);
  const c = w.company("A"), s = ship(w, c);
  const pool = worldOf(w, "contracts.relief").open;
  assert.ok([0, 1].includes(pool.good));
  dock(s, pool.port); load(s, pool.good, 10);
  const cash = c.cash;
  assert.equal(w.act(c, "contracts.relief", "contribute", { ship: s.id }).ok, true);
  assert.ok(c.cash - cash >= 10 * w.e.price(pool.port, pool.good) * 1.5);
});

test("story chains move chapter by chapter and end with a title", () => {
  const w = featureWorld(["contracts.story"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.act(c, "contracts.story", "start", { story: 7 }).ok, false);
  assert.equal(w.act(c, "contracts.story", "start", { story: 0 }).ok, true);
  for (let ch = 0; ch < 4; ch++) {
    const p = view(w, c, "contracts.story").progress;
    assert.equal(p.chapter, ch);
    readyFor(s, p.job);
    assert.equal(w.act(c, "contracts.story", "deliver", { ship: s.id }).ok, true);
  }
  assert.deepEqual(view(w, c, "contracts.story").finished, [0]);
  assert.ok(shared(w.e).titles.get(c.id)?.includes("The Lighthouse Keeper"));
  assert.equal(w.act(c, "contracts.story", "start", { story: 0 }).ok, false, "told already");
});

test("passengers board at their port and pay when the ship docks at theirs", () => {
  const w = featureWorld(["contracts.passengers"]);
  const c = w.company("A"), s = ship(w, c);
  const fare = view(w, c, "contracts.passengers").offers[0];
  assert.equal(w.act(c, "contracts.passengers", "board", { contract: fare.id, ship: s.id }).ok, s.port === fare.from);
  dock(s, fare.from);
  if (!view(w, c, "contracts.passengers").aboard.length) assert.equal(w.act(c, "contracts.passengers", "board", { contract: fare.id, ship: s.id }).ok, true);
  const cash = c.cash;
  arriveNext(w, s, fare.to);
  assert.ok(c.cash - cash > fare.fare - 100, "fare minus port fee");
  assert.equal(view(w, c, "contracts.passengers").carried, fare.people);
});

test("auctions: the lowest bid wins and becomes a contract at that price", () => {
  const w = featureWorld(["contracts.auctions"]);
  const a = w.company("A"), b = w.company("B", 1);
  const t = worldOf(w, "contracts.auctions").open;
  assert.equal(w.act(a, "contracts.auctions", "bid", { amount: t.ceiling + 1 }).ok, false);
  assert.equal(w.act(a, "contracts.auctions", "bid", { amount: t.ceiling - 10 }).ok, true);
  assert.equal(w.act(b, "contracts.auctions", "bid", { amount: t.ceiling - 20 }).ok, true);
  w.hours(t.closes - w.e.tick);
  const held = view(w, b, "contracts.auctions").held;
  assert.equal(held.length, 1);
  assert.equal(held[0].reward, t.ceiling - 20);
  assert.equal(view(w, a, "contracts.auctions").held.length, 0);
  assert.equal(worldOf(w, "contracts.auctions").results.length, 1);
});

// ------------------------------------------------------------ voyage jobs

test("escort missions pay when the escorting ship docks at the destination", () => {
  const w = featureWorld(["contracts.escort"]);
  const c = w.company("A"), s = ship(w, c);
  const job = view(w, c, "contracts.escort").offers[0];
  assert.equal(w.act(c, "contracts.escort", "accept", { contract: job.id }).ok, true);
  assert.equal(w.act(c, "contracts.escort", "accept", { contract: view(w, c, "contracts.escort").offers[0].id }).ok, false, "one at a time");
  dock(s, job.from); s.departTick = w.e.tick; s.dest = job.to; s.arriveTick = w.e.tick + 5;
  w.hours(1);
  assert.equal(view(w, c, "contracts.escort").held.ship, s.id);
  const cash = c.cash;
  w.hours(5);
  assert.equal(view(w, c, "contracts.escort").held, null);
  assert.ok(c.cash > cash);
});

test("smuggling pays on arrival, and an inspection seizes the crate", () => {
  const w = featureWorld(["contracts.smuggling"]);
  const c = w.company("A"), s = ship(w, c);
  const job = view(w, c, "contracts.smuggling").offers[0];
  assert.equal(w.act(c, "contracts.smuggling", "load", { contract: job.id, ship: s.id }).ok, s.port === job.from);
  dock(s, job.from);
  if (!shared(w.e).contraband.has(s.id)) assert.equal(w.act(c, "contracts.smuggling", "load", { contract: job.id, ship: s.id }).ok, true);
  const cash = c.cash;
  arriveNext(w, s, job.to);
  assert.ok(c.cash > cash);
  assert.ok(heatOf(w.e, c.id) > 0);
  assert.equal(view(w, c, "contracts.smuggling").runs, 1);
  // A second crate, found by customs.
  w.hours(24);
  const job2 = view(w, c, "contracts.smuggling").offers[0];
  dock(s, job2.from);
  assert.equal(w.act(c, "contracts.smuggling", "load", { contract: job2.id, ship: s.id }).ok, true);
  assert.equal(search(w.e, s, "test"), true);
  w.hours(1);
  assert.equal(view(w, c, "contracts.smuggling").held, null);
});

test("wreck salvage pays when a ship has sailed the wreck's lane", () => {
  const w = featureWorld(["contracts.salvage"]);
  const c = w.company("A"), s = ship(w, c);
  const job = view(w, c, "contracts.salvage").offers[0];
  assert.ok(worldOf(w, "contracts.salvage").wrecks.length >= 1);
  assert.equal(w.act(c, "contracts.salvage", "accept", { contract: job.id }).ok, true);
  dock(s, job.to); s.dest = job.from; s.departTick = w.e.tick; s.arriveTick = w.e.tick + 4;
  const cash = c.cash;
  w.hours(5);
  assert.ok(c.cash > cash);
  assert.equal(view(w, c, "contracts.salvage").held, null);
});

// ------------------------------------------------------------ pirates

test("pirate zones move daily and slow voyages through them only when switched on", () => {
  const w = featureWorld(["contracts.pirate-zones"]);
  w.company("A");
  const z = worldOf(w, "contracts.pirate-zones");
  assert.equal(z.zones.length, 3);
  assert.notDeepEqual(z.zones, z.tomorrow);
  let changed = 0, same = 0;
  for (let a = 0; a < w.e.n; a++) for (let b = 0; b < w.e.n; b++) {
    if (a === b || !Number.isFinite(w.e.dist[a][b])) continue;
    const h = w.e.features.adjust("travelHours", 20, { ship: 1, from: a, dest: b });
    if (h === 22) changed++; else if (h === 20) same++;
  }
  assert.ok(changed > 0 && same > 0);
});

/** Park a loaded ship in the middle of today's first pirate zone (for the next hour). */
function parkInZone(w: W, s: Ship) {
  const t = w.e.tick + 1, d = Math.floor(t / 24);
  const { a, b } = pickRoute(w.e, 0x5a4f4e45, d, 0);
  placeAt(s, a, b, 0.3 + 0.4 * roll(0x5a4f, d, 0), t);
}

test("ambushes strike loaded ships in pirate zones; protection lowers the odds", () => {
  const w = featureWorld(["contracts.ambush", "contracts.deck-guns", "contracts.escort-hire"]);
  const c = w.company("A"), s = ship(w, c);
  load(s, 3, 100);
  parkInZone(w, s);
  const amb = w.e.features.modules.get("contracts.ambush") as any;
  w.e.tick++; const base = amb.chanceFor(s);
  shared(w.e).guns.set(s.id, 2);
  assert.ok(amb.chanceFor(s) < base);
  shared(w.e).guns.delete(s.id); w.e.tick--;
  let lost = false;
  for (let h = 0; h < 2000 && !lost; h++) { load(s, 3, 100); parkInZone(w, s); w.hours(1); lost = s.qty < 100; }
  assert.ok(lost, "an ambush happened");
  assert.ok(shared(w.e).tally.ambushes >= 1);
});

test("ransom: a stopped ship makes no headway until it pays or fights", () => {
  const w = featureWorld(["contracts.ambush", "contracts.ransom"]);
  const c = w.company("A"), s = ship(w, c);
  for (let h = 0; h < 2000 && !view(w, c, "contracts.ransom").holds.length; h++) { load(s, 3, 100); parkInZone(w, s); w.hours(1); }
  const hold = view(w, c, "contracts.ransom").holds[0];
  assert.ok(hold);
  const arrive = s.arriveTick;
  w.hours(1);
  assert.equal(s.arriveTick, arrive + 1, "held");
  assert.equal(w.act(c, "contracts.ransom", "pay", { ship: 12345 }).ok, false);
  const cash = c.cash;
  assert.equal(w.act(c, "contracts.ransom", "pay", { ship: s.id }).ok, true);
  assert.equal(Math.round(cash - c.cash), hold.demand);
  assert.equal(view(w, c, "contracts.ransom").holds.length, 0);
  assert.equal(shared(w.e).tally.ransoms, 1);
});

test("cargo insurance charges a premium and pays 80% of losses on that voyage", () => {
  const w = featureWorld(["contracts.cargo-insurance"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.act(c, "contracts.cargo-insurance", "insure", { ship: s.id }).ok, false, "empty");
  load(s, 3, 50);
  const cash = c.cash;
  assert.equal(w.act(c, "contracts.cargo-insurance", "insure", { ship: s.id }).ok, true);
  assert.ok(c.cash < cash);
  placeAt(s, s.port, w.reachable(s.port), 0, w.e.tick + 1);
  w.hours(1);
  shared(w.e).losses.push({ ship: s.id, owner: c.id, amount: 1000, kind: "test", tick: w.e.tick });
  const before = c.cash;
  w.hours(1);
  assert.equal(Math.round(c.cash - before), 800);
  assert.equal(view(w, c, "contracts.cargo-insurance").paid, 800);
});

test("hired escorts cost money and protect the next voyage only", () => {
  const w = featureWorld(["contracts.escort-hire"]);
  const c = w.company("A"), s = ship(w, c);
  const cash = c.cash;
  assert.equal(w.act(c, "contracts.escort-hire", "hire", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "contracts.escort-hire", "hire", { ship: s.id }).ok, false);
  assert.ok(c.cash <= cash - 120);
  placeAt(s, s.port, w.reachable(s.port), 0, w.e.tick + 1);
  w.hours(1);
  assert.equal(protection(w.e, s).escorted, true);
  assert.ok(protection(w.e, s).mult < 0.5);
  s.arriveTick = w.e.tick + 1;
  w.hours(1);
  assert.equal(s.dest, null);
  assert.deepEqual(view(w, c, "contracts.escort-hire").escorted, []);
});

test("player convoys: ships leaving together are protected and the trip is logged", () => {
  const w = featureWorld(["contracts.convoys"]);
  const a = w.company("A"), b = w.company("B", 0);
  const sa = ship(w, a), sb = ship(w, b), dest = w.reachable(sa.port);
  assert.equal(w.act(a, "contracts.convoys", "form", { ship: sa.id, dest: sa.port }).ok, false);
  const r = w.act(a, "contracts.convoys", "form", { ship: sa.id, dest });
  assert.equal(r.ok, true);
  assert.equal(w.act(b, "contracts.convoys", "join", { convoy: r.id, ship: sb.id }).ok, true);
  assert.equal(w.act(b, "contracts.convoys", "join", { convoy: r.id, ship: sb.id }).ok, false, "already in");
  for (const s of [sa, sb]) { s.dest = dest; s.departTick = w.e.tick; s.arriveTick = w.e.tick + 6; }
  w.hours(1);
  assert.equal(protection(w.e, sa).inConvoy, true);
  assert.equal(protection(w.e, sb).inConvoy, true);
  w.hours(6);
  assert.equal(view(w, a, "contracts.convoys").trips, 1);
  assert.equal(view(w, b, "contracts.convoys").trips, 1);
  assert.equal(protection(w.e, sa).inConvoy, false);
});

test("deck guns cost more per level and stop at level 3", () => {
  const w = featureWorld(["contracts.deck-guns"]);
  const c = w.company("A"), s = ship(w, c);
  const cash = c.cash;
  for (let i = 1; i <= 3; i++) assert.equal(w.act(c, "contracts.deck-guns", "upgrade", { ship: s.id }).ok, true);
  assert.equal(Math.round(cash - c.cash), GUN_PRICE * 6);
  assert.equal(w.act(c, "contracts.deck-guns", "upgrade", { ship: s.id }).ok, false);
  assert.equal(view(w, c, "contracts.deck-guns")[s.id], 3);
  assert.equal(w.act(c, "contracts.deck-guns", "remove", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "contracts.deck-guns", "upgrade", { ship: 999 }).ok, false);
});

test("bounties: hunt a named pirate from a ship close by", () => {
  const w = featureWorld(["contracts.bounties"]);
  const c = w.company("A"), s = ship(w, c);
  shared(w.e).guns.set(s.id, 3);
  assert.equal(w.act(c, "contracts.bounties", "hunt", { pirate: 0, ship: s.id }).ok, false, "docked");
  let caught = false;
  for (let d = 0; d < 30 && !caught; d++) {
    const p = namedPirates(w.e).find(x => x.at && !((shared(w.e).sunk.get(x.id) ?? -1) >= Math.floor(w.e.tick / 24)))!;
    placeAt(s, p.at!.from, p.at!.to, p.at!.f, w.e.tick);
    const r = w.act(c, "contracts.bounties", "hunt", { pirate: p.id, ship: s.id }) as any;
    assert.equal(r.ok, true, JSON.stringify(r));
    caught = r.result === "caught";
    assert.equal(w.act(c, "contracts.bounties", "hunt", { pirate: p.id, ship: s.id }).ok, false, "once a day");
    w.hours(24);
  }
  assert.ok(caught);
  assert.equal(view(w, c, "contracts.bounties").claimed, 1);
});

test("the piracy ledger publishes the tally and recent sea news", () => {
  const w = featureWorld(["contracts.news-ledger"]);
  w.company("A");
  news(w.e, "test", "A sea serpent was seen.");
  const l = worldOf(w, "contracts.news-ledger");
  assert.equal(l.news.at(-1).text, "A sea serpent was seen.");
  assert.equal(l.tally.ambushes, 0);
});

// ------------------------------------------------------------ law

test("the black flag is opt-in, has a cooldown and shows on the world list", () => {
  const w = featureWorld(["contracts.black-flag"]);
  const c = w.company("A");
  assert.equal(w.act(c, "contracts.black-flag", "lower").ok, false);
  assert.equal(w.act(c, "contracts.black-flag", "raise").ok, true);
  assert.deepEqual(worldOf(w, "contracts.black-flag").pirates, ["A"]);
  assert.equal(w.act(c, "contracts.black-flag", "lower").ok, false, "cooldown");
  w.hours(24);
  assert.equal(w.act(c, "contracts.black-flag", "lower").ok, true);
  assert.equal(view(w, c, "contracts.black-flag").flying, false);
});

test("wanted stars come from heat and notoriety and cool over time", () => {
  const w = featureWorld(["contracts.wanted"]);
  const c = w.company("A");
  addHeat(w.e, c.id, 45);
  assert.equal(stars(w.e, c.id), 2);
  w.hours(1);
  assert.equal(view(w, c, "contracts.wanted").stars, 2);
  assert.deepEqual(worldOf(w, "contracts.wanted").mostWanted, [{ name: "A", stars: 2 }]);
  w.hours(20);
  assert.equal(stars(w.e, c.id), 1);
});

test("patrols: routes are public and you may report a pirate ship you can see", () => {
  const w = featureWorld(["contracts.patrols", "contracts.black-flag"]);
  const a = w.company("A"), b = w.company("B", 1);
  assert.ok(worldOf(w, "contracts.patrols").loops.length >= 1);
  w.act(b, "contracts.black-flag", "raise");
  const sb = ship(w, b), sa = ship(w, a), to = w.reachable(sa.port);
  placeAt(sa, sa.port, to, 0.5, w.e.tick); placeAt(sb, sa.port, to, 0.5, w.e.tick);
  assert.equal(w.act(a, "contracts.patrols", "report", { ship: 999 }).ok, false);
  assert.equal(w.act(a, "contracts.patrols", "report", { ship: sb.id }).ok, true);
  assert.ok(heatOf(w.e, b.id) >= 5);
  assert.equal(w.act(a, "contracts.patrols", "report", { ship: sb.id }).ok, false, "once a day");
});

test("inspections: wanted ships are searched more, hideouts never", () => {
  const w = featureWorld(["contracts.inspections"]);
  const c = w.company("A"), s = ship(w, c);
  const port = [...Array(w.e.n).keys()].find(p => !hideouts(w.e).includes(p))!;
  dock(s, port);
  const base = inspectionChance(w.e, s);
  addHeat(w.e, c.id, 60);
  assert.ok(inspectionChance(w.e, s) > base);
  dock(s, hideouts(w.e)[0]);
  assert.equal(inspectionChance(w.e, s), 0);
  // Over many dockings, some get searched.
  dock(s, port);
  for (let i = 0; i < 40; i++) { arriveNext(w, s, w.reachable(s.port), 2); addHeat(w.e, c.id, 3); }
  assert.ok(view(w, c, "contracts.inspections").searched > 0);
});

test("bribes buy 48 hours without inspections (or get refused)", () => {
  const w = featureWorld(["contracts.bribes"]);
  const c = w.company("A"), s = ship(w, c);
  let taken = false;
  for (let i = 0; i < 10 && !taken; i++) { const r = w.act(c, "contracts.bribes", "bribe") as any; assert.equal(r.ok, true); taken = r.result === "taken"; if (!taken) w.hours(1); }
  assert.ok(taken);
  assert.equal(inspectionChance(w.e, s), 0);
  assert.equal(w.act(c, "contracts.bribes", "bribe").ok, false, "already waived");
  w.hours(49);
  assert.ok(inspectionChance(w.e, s) > 0 || hideouts(w.e).includes(s.port));
});

test("hideouts let black-flag captains cool off faster", () => {
  const w = featureWorld(["contracts.hideouts", "contracts.black-flag"]);
  const c = w.company("A"), s = ship(w, c);
  w.act(c, "contracts.black-flag", "raise");
  addHeat(w.e, c.id, 50);
  dock(s, hideouts(w.e)[0]);
  w.hours(10);
  assert.ok(heatOf(w.e, c.id) <= 50 - 10 * 2 + 0.01);
  assert.deepEqual(worldOf(w, "contracts.hideouts").ports, hideouts(w.e));
});

test("the pirate boss sails every fifth day and hunters may sink it", () => {
  const w = featureWorld(["contracts.pirate-boss"]);
  const c = w.company("A"), s = ship(w, c);
  while (!bossNow(w.e)) w.hours(1);
  const b = bossNow(w.e)!;
  const f = (w.e.tick - (b.event * 5 + 2) * 24) / 48;
  placeAt(s, b.from, b.to, f, w.e.tick);
  assert.equal(w.act(c, "contracts.pirate-boss", "join", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "contracts.pirate-boss", "join", { ship: s.id }).ok, false);
  s.arriveTick = w.e.tick + 1000;
  w.hours(b.until - w.e.tick + 1);
  assert.equal(worldOf(w, "contracts.pirate-boss").results.length, 1);
});

test("distress signals: answer real ones for reputation, false ones are traps", () => {
  const w = featureWorld(["contracts.fake-distress", "contracts.black-flag"]);
  const c = w.company("A"), s = ship(w, c);
  while (!worldOf(w, "contracts.fake-distress").signals.length) w.hours(1);
  const sig = worldOf(w, "contracts.fake-distress").signals[0];
  // The signal was spawned this hour, on the lane and fraction hashed from this tick.
  const route = pickRoute(w.e, 0x44495354, w.e.tick);
  const f = 0.2 + 0.6 * roll(0x44495354, w.e.tick, 1);
  placeAt(s, route.a, route.b, f, w.e.tick);
  const r = w.act(c, "contracts.fake-distress", "answer", { signal: sig.id, ship: s.id }) as any;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.result === "rescue" ? view(w, c, "contracts.fake-distress").saves === 1 : (shared(w.e).exposed.get(s.id) ?? 0) > w.e.tick);
  assert.equal(w.act(c, "contracts.fake-distress", "answer", { signal: sig.id, ship: s.id }).ok, false);
  assert.equal(w.act(c, "contracts.fake-distress", "broadcast", { ship: s.id }).ok, false, "black flag only");
  w.act(c, "contracts.black-flag", "raise");
  assert.equal(w.act(c, "contracts.fake-distress", "broadcast", { ship: s.id }).ok, true);
  assert.ok(heatOf(w.e, c.id) >= 7);
});

test("coast guard: stranded ships can call for help; the fuel top-up is a separate economy switch", () => {
  const w = featureWorld(["contracts.coast-guard"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(coastStations(w.e).length, 3);
  assert.equal(w.act(c, "contracts.coast-guard", "call", { ship: s.id }).ok, false, "not stranded");
  c.cash = 0;
  const r = w.act(c, "contracts.coast-guard", "call", { ship: s.id }) as any;
  assert.equal(r.ok, true); assert.equal(r.paid, 0); assert.equal(c.cash, 0);
  assert.equal(w.act(c, "contracts.coast-guard", "call", { ship: s.id }).ok, false, "72 h");
  w.apply({ type: "setFeatures", enabled: ["contracts.coast-guard", "contracts.coast-guard-effects"] });
  w.hours(72); c.cash = 0;
  const r2 = w.act(c, "contracts.coast-guard", "call", { ship: s.id }) as any;
  assert.equal(r2.ok, true); assert.ok(r2.paid > 0); assert.ok(c.cash > 0);
});

test("pardons wipe notoriety for reformed pirates", () => {
  const w = featureWorld(["contracts.pardon", "contracts.black-flag"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.act(c, "contracts.pardon", "apply").ok, false, "nothing to pardon");
  w.act(c, "contracts.black-flag", "raise");
  w.hours(25);
  w.act(c, "contracts.black-flag", "lower");
  w.e.piracy.setNotoriety(c.id, 30);
  w.hours(72);
  assert.equal(w.act(c, "contracts.pardon", "apply").ok, false, "deliveries needed");
  for (let i = 0; i < 3; i++) { load(s, 0, 20); arriveNext(w, s, w.reachable(s.port)); }
  shared(w.e).heat.delete(c.id);
  assert.equal(w.act(c, "contracts.pardon", "apply").ok, true);
  assert.equal(w.e.piracy.notorietyOf(c.id), 0);
  assert.ok(shared(w.e).titles.get(c.id)?.includes("Pardoned"));
});

test("naval blockades search every ship docking at the blockaded port", () => {
  const w = featureWorld(["contracts.blockade"]);
  const c = w.company("A"), s = ship(w, c);
  while (!blockadeNow(w.e)) w.hours(1);
  const port = blockadeNow(w.e)!.port;
  dock(s, w.reachable(port));
  shared(w.e).contraband.set(s.id, { contract: 1, owner: c.id });
  arriveNext(w, s, port);
  assert.equal(shared(w.e).contraband.has(s.id), false);
  assert.ok(heatOf(w.e, c.id) >= 15);
  assert.equal(worldOf(w, "contracts.blockade").blockade.port, port);
});

// ------------------------------------------------------------ NPCs

test("rival NPC shipping lines move market stock between ports", () => {
  const w = featureWorld(["contracts.rival-companies"]);
  w.company("A");
  w.hours(120);
  const r = worldOf(w, "contracts.rival-companies").rivals;
  assert.equal(r.length, 3);
  assert.ok(r.some((x: any) => x.moved > 0));
});

test("faction: the merchant guild rewards this week's charter", () => {
  const w = featureWorld(["contracts.guild"]);
  const c = w.company("A"), s = ship(w, c);
  const ch = view(w, c, "contracts.guild").charter;
  dock(s, w.reachable(ch.port)); load(s, ch.good, 20);
  arriveNext(w, s, ch.port);
  assert.equal(standingOf(w.e, c.id)[0], 10);
  assert.equal(view(w, c, "contracts.guild").met, true);
});

test("faction: the syndicate takes respects at hideouts", () => {
  const w = featureWorld(["contracts.syndicate"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.act(c, "contracts.syndicate", "respects", { ship: s.id }).ok, hideouts(w.e).includes(s.port));
  dock(s, hideouts(w.e)[0]);
  if (standingOf(w.e, c.id)[1] === 0) assert.equal(w.act(c, "contracts.syndicate", "respects", { ship: s.id }).ok, true);
  assert.equal(standingOf(w.e, c.id)[1], 3);
  assert.equal(w.act(c, "contracts.syndicate", "respects", { ship: s.id }).ok, false);
});

test("faction: the navy turns against the black flag", () => {
  const w = featureWorld(["contracts.navy", "contracts.black-flag"]);
  const c = w.company("A"), s = ship(w, c);
  w.act(c, "contracts.black-flag", "raise");
  assert.equal(standingOf(w.e, c.id)[2], -20);
  w.hours(24);
  assert.equal(standingOf(w.e, c.id)[2], -21);
  assert.equal(w.act(c, "contracts.navy", "patrol", { ship: s.id }).ok, false);
  assert.equal(view(w, c, "contracts.navy").tier, "Wary");
});

test("faction: island tribes value gifts", () => {
  const w = featureWorld(["contracts.tribes"]);
  const c = w.company("A"), s = ship(w, c);
  dock(s, tribePorts(w.e)[0]);
  assert.equal(w.act(c, "contracts.tribes", "gift", { ship: s.id, qty: 4 }).ok, false, "empty hold");
  load(s, 0, 30);
  assert.equal(w.act(c, "contracts.tribes", "gift", { ship: s.id, qty: 40 }).ok, false);
  assert.equal(w.act(c, "contracts.tribes", "gift", { ship: s.id, qty: 10 }).ok, true);
  assert.equal(standingOf(w.e, c.id)[3], 5);
  assert.equal(s.qty, 20);
  assert.equal(w.act(c, "contracts.tribes", "gift", { ship: s.id, qty: 2 }).ok, false, "enough for today");
});

test("the wandering trader gives a curio and a whisper once a day", () => {
  const w = featureWorld(["contracts.wandering-trader"]);
  const c = w.company("A"), s = ship(w, c);
  dock(s, traderPort(w.e));
  assert.equal(w.act(c, "contracts.wandering-trader", "visit").ok, true);
  assert.equal(w.act(c, "contracts.wandering-trader", "visit").ok, false);
  assert.equal(view(w, c, "contracts.wandering-trader").curios.length, 1);
  assert.equal(worldOf(w, "contracts.wandering-trader").port, traderPort(w.e));
});

test("the ghost ship appears some nights and answers a hail", () => {
  const w = featureWorld(["contracts.ghost-ship"]);
  const c = w.company("A"), s = ship(w, c);
  while (!ghostNow(w.e)) w.hours(1);
  const g = ghostNow(w.e)!;
  placeAt(s, g.from, g.to, (w.e.tick % 24) / 5, w.e.tick);
  assert.equal(w.act(c, "contracts.ghost-ship", "hail", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "contracts.ghost-ship", "hail", { ship: s.id }).ok, false);
  assert.equal(view(w, c, "contracts.ghost-ship").lanterns, 1);
});

test("NPC ferries, fishermen and a cruise liner sail the map; fishermen share tips", () => {
  const w = featureWorld(["contracts.npc-traffic"]);
  const c = w.company("A"), s = ship(w, c);
  const t = worldOf(w, "contracts.npc-traffic");
  assert.equal(t.ferries.length, 2); assert.equal(t.fishing.length, 4); assert.ok(t.liner);
  w.hours(3);
  assert.notDeepEqual(worldOf(w, "contracts.npc-traffic").fishing, t.fishing);
  dock(s, npcTraffic(w.e).fishing[0].port);
  assert.equal(w.act(c, "contracts.npc-traffic", "ask", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "contracts.npc-traffic", "ask", { ship: s.id }).ok, false);
});

test("the old captain hands out errands one at a time", () => {
  const w = featureWorld(["contracts.old-captain"]);
  const c = w.company("A"), s = ship(w, c);
  dock(s, w.reachable(captainPort(w.e)));
  assert.equal(w.act(c, "contracts.old-captain", "talk").ok, false);
  dock(s, captainPort(w.e));
  assert.equal(w.act(c, "contracts.old-captain", "talk").ok, true);
  assert.equal(view(w, c, "contracts.old-captain").step, 1);
  assert.equal(w.act(c, "contracts.old-captain", "talk").ok, false, "do the errand first");
});

test("Captain Vex learns your favourite route and races you on it", () => {
  const w = featureWorld(["contracts.rival-ai"]);
  const c = w.company("A"), s = ship(w, c);
  const a = s.port, b = w.reachable(a);
  for (let i = 0; i < 3; i++) {
    dock(s, a); s.dest = b; s.departTick = w.e.tick; s.arriveTick = w.e.tick + 2;
    w.hours(3);
  }
  const v = view(w, c, "contracts.rival-ai");
  assert.equal(v.favourite, `${a}-${b}`);
  assert.ok(v.won + v.lost >= 1);
});

test("named pirates roam with personalities and warn nearby ships", () => {
  const w = featureWorld(["contracts.named-pirates"]);
  const c = w.company("A"), s = ship(w, c);
  const ps = worldOf(w, "contracts.named-pirates").pirates;
  assert.equal(ps.length, 5);
  const p = namedPirates(w.e, w.e.tick + 1)[0];
  placeAt(s, p.at!.from, p.at!.to, p.at!.f, w.e.tick + 1);
  w.hours(1);
  assert.ok(view(w, c, "contracts.named-pirates").notes.some((n: any) => n.text.includes(p.name)));
  assert.equal(w.act(c, "contracts.named-pirates", "parley", { pirate: 0, ship: s.id }).ok, false, "black flag only");
});

test("legendary captains count voyages, ports and tonnes", () => {
  const w = featureWorld(["contracts.legends"]);
  const c = w.company("A"), s = ship(w, c);
  load(s, 0, 40);
  arriveNext(w, s, w.reachable(s.port));
  const v = view(w, c, "contracts.legends");
  assert.equal(v.voyages, 1); assert.equal(v.ports, 1); assert.equal(v.tonnes, 40);
});

test("port mayors grant favour for their wished-for cargo", () => {
  const w = featureWorld(["contracts.mayors"]);
  const c = w.company("A"), s = ship(w, c);
  const port = w.reachable(s.port);
  load(s, mayorWish(w.e, port), 10);
  arriveNext(w, s, port);
  assert.equal(view(w, c, "contracts.mayors")[port], 1);
  assert.equal(worldOf(w, "contracts.mayors").mayors.length, w.e.n);
});

test("journalists write up sea news and interviews", () => {
  const w = featureWorld(["contracts.journalists"]);
  const c = w.company("A");
  assert.equal(w.act(c, "contracts.journalists", "interview", { tone: "rude" }).ok, false);
  assert.equal(w.act(c, "contracts.journalists", "interview", { tone: "humble" }).ok, true);
  assert.equal(w.act(c, "contracts.journalists", "interview", { tone: "boast" }).ok, false, "once a day");
  assert.match(worldOf(w, "contracts.journalists").articles.at(-1).text, /^A thanks/);
});

test("inspectors move daily and make inspections likelier where they stand", () => {
  const w = featureWorld(["contracts.inspections"]);
  const c = w.company("A"), s = ship(w, c);
  const port = inspectorPorts(w.e).find(p => !hideouts(w.e).includes(p));
  if (port === undefined) return;
  dock(s, port);
  const without = inspectionChance(w.e, s);
  w.apply({ type: "setFeatures", enabled: ["contracts.inspections", "contracts.inspectors"] });
  assert.ok(inspectionChance(w.e, s) > without);
  assert.deepEqual(worldOf(w, "contracts.inspectors").today, inspectorPorts(w.e));
});

test("mechanics service ships; the upkeep deal is a separate economy switch", () => {
  const w = featureWorld(["contracts.mechanics"]);
  const c = w.company("A"), s = ship(w, c);
  c.cash += 50000;
  w.apply({ type: "buyShip", company: c.id, port: s.port, shipType: "freighter" } as any);
  dock(s, mechanicPorts(w.e)[0]);
  assert.equal(w.act(c, "contracts.mechanics", "checkup", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "contracts.mechanics", "checkup", { ship: s.id }).ok, false);
  assert.deepEqual(view(w, c, "contracts.mechanics").serviced, [s.id]);
  const before = w.e.upkeepDue(c);
  w.apply({ type: "setFeatures", enabled: ["contracts.mechanics", "contracts.mechanics-effects"] });
  assert.ok(w.e.upkeepDue(c) < before || before === 0);
});

test("travelling merchants sell cargo below the local price", () => {
  const w = featureWorld(["contracts.travelling-merchants"]);
  const c = w.company("A"), s = ship(w, c);
  const m = merchantsToday(w.e)[0];
  dock(s, m.port);
  assert.equal(w.act(c, "contracts.travelling-merchants", "buy", { merchant: 0, ship: s.id, qty: 500 }).ok, false);
  const cash = c.cash, price = w.e.price(m.port, m.good);
  const r = w.act(c, "contracts.travelling-merchants", "buy", { merchant: 0, ship: s.id, qty: 10 }) as any;
  assert.equal(r.ok, true);
  assert.equal(s.good, m.good); assert.equal(s.qty, 10);
  assert.ok(Math.abs((cash - c.cash) - 10 * price * 0.85) < 1);
});

test("the mystery stranger asks riddles, one answer per appearance", () => {
  const w = featureWorld(["contracts.stranger"]);
  const c = w.company("A"), s = ship(w, c);
  dock(s, strangerPort(w.e));
  assert.equal(w.act(c, "contracts.stranger", "answer", { choice: 9 }).ok, false);
  const r = w.act(c, "contracts.stranger", "answer", { choice: RIDDLES[0].a }) as any;
  assert.equal(r.correct, true);
  assert.equal(w.act(c, "contracts.stranger", "answer", { choice: RIDDLES[1].a }).ok, false, "wait for the next appearance");
  assert.equal(view(w, c, "contracts.stranger").solved, 1);
});

// ------------------------------------------------------------ everything together

test("every contracts module together replays exactly", () => {
  assertReplays(ALL, (w) => {
    const a = w.company("A"), b = w.company("B", 1);
    w.act(b, "contracts.black-flag", "raise");
    const job = book(w, "contracts.timed").offers[0];
    w.act(a, "contracts.timed", "accept", { contract: job.id });
    w.act(a, "contracts.deck-guns", "upgrade", { ship: a.ships[0] });
    w.act(a, "contracts.auctions", "bid", { amount: worldOf(w, "contracts.auctions").open.ceiling - 5 });
    w.act(a, "contracts.journalists", "interview", { tone: "mysterious" });
    for (let h = 0; h < 200; h++) {
      w.hours(1);
      if (h % 25 === 0) for (const c of [a, b]) for (const id of c.ships) {
        const s = w.e.ships.get(id)!;
        if (s.dest === null) w.run({ type: "sail", company: c.id, ship: id, dest: w.reachable(s.port) });
      }
      if (h % 40 === 0) w.e.features.cards(a.id);
    }
  });
});
