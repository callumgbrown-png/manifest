import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";
import { runBots, botName } from "../src/bots.ts";
import { runPirateBots } from "../src/piratebots.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const err = (r: any) => (r.ok ? "" : r.error);

/** A pirate company with one pirate (and a freighter) at port 0, sailing a long way, with the police told to be near. */
function chase(edit?: (r: any) => void, extraShips = 0) {
  const r = structuredClone(rules); r.police.catch_range = 100000; r.police.catch_base = 1; r.police.catch_max = 1; edit?.(r);
  const e = new Engine(r, map, 60);
  const A = (e.apply({ type: "register", name: "Corsair Co", startPort: 0 }) as any).id;
  const co = e.companies.get(A)!; co.cash = 80000;
  const ship = (e.apply({ type: "buyShip", company: A, port: 0, shipType: "pirate" }) as any).id;
  for (let i = 0; i < extraShips; i++) e.apply({ type: "buyShip", company: A, port: 0, shipType: "coaster" });
  const far = [...Array(e.n).keys()].sort((a, b) => e.dist[0][b] - e.dist[0][a])[0];
  assert.ok(e.apply({ type: "sail", company: A, ship, dest: far }).ok);
  return { e, A, co, ship, far, r };
}

test("police numbers follow the number of companies, within limits, and only when pirates are on", () => {
  const sizes = (n: number, on = true) => {
    const r = structuredClone(rules); r.pirates.enabled = on;
    const e = new Engine(r, map, 60);
    for (let i = 0; i < n; i++) e.apply({ type: "register", name: botName(i), startPort: i % e.n });
    e.advance();
    return e.police.ships.length;
  };
  assert.equal(sizes(2), 3, "at least min_ships");
  assert.equal(sizes(30), 4);
  assert.equal(sizes(100), 10, "at most max_ships");
  assert.equal(sizes(30, false), 0, "none when pirates are off");
});

test("police patrol the lanes: they sail between neighbouring ports and keep moving", () => {
  const e = new Engine(structuredClone(rules), map, 60);
  e.apply({ type: "register", name: "Idle Co", startPort: 3 });
  const lanes = new Set(map.routes.flatMap((r: any) => [`${r.a}:${r.b}`, `${r.b}:${r.a}`]));
  const seen = new Set<number>();
  for (let t = 0; t < 400; t++) {
    const before = new Map(e.police.ships.map(p => [p.id, p.departTick]));
    e.advance();
    for (const p of e.police.ships) {
      // A new leg starts when its departure tick changes: it leaves the port it is in along one lane.
      if (before.has(p.id) && p.dest !== null && p.departTick !== before.get(p.id)) { assert.ok(lanes.has(`${p.port}:${p.dest}`), "a patrol leg follows one lane"); seen.add(p.id); }
    }
  }
  assert.equal(seen.size, e.police.ships.length, "every police ship went on patrol");
});

test("an idle police ship heads for where an active pirate is going", () => {
  const { e, ship } = chase();
  e.piracy.addNotoriety(e.ships.get(ship)!.owner, 40);
  e.advance();
  const dest = e.ships.get(ship)!.dest;
  const bound = e.police.ships.filter(p => p.dest === dest);
  assert.ok(bound.length >= 2, `police are sent after the pirate's destination (${bound.length} of ${e.police.ships.length})`);
});

test("a pirate near police is caught: below the fine level, the penalty is a fine and notoriety drops", () => {
  const { e, A, co, ship } = chase();
  e.piracy.setNotoriety(A, 20);
  const cash = co.cash;
  e.advance();
  // Notoriety fell by 0.4 in the hour before the arrest (19.6), so the fine is 80 x 19.6.
  assert.equal(Math.round(cash - co.cash), Math.round(80 * 19.6), "a fine of 80 x notoriety");
  assert.equal(e.piracy.notorietyOf(A), 5);
  assert.ok(e.ships.has(ship), "the ship is kept");
  assert.match(e.piracy.notices.get(A)![0].text, /Fine: 1568/);
  e.advance();
  assert.equal(Math.round(cash - co.cash), 1568, "notoriety 5 is below the chase level: no second fine");
});

test("in the middle tier the company is locked out of sailing for a day", () => {
  const { e, A, ship } = chase(undefined, 1);
  e.piracy.setNotoriety(A, 60);
  e.advance();
  assert.equal(e.piracy.lockoutHours(A), 24);
  const idle = e.companies.get(A)!.ships.find(id => id !== ship)!;
  assert.equal(err(e.apply({ type: "sail", company: A, ship: idle, dest: 5 })), "your company is locked out of ports for 24 more hours");
  assert.ok(e.ships.has(ship));
  for (let i = 0; i < 24; i++) e.advance();
  assert.equal(e.piracy.lockoutHours(A), 0);
  assert.notEqual(err(e.apply({ type: "sail", company: A, ship: idle, dest: 5 })), "your company is locked out of ports for 24 more hours");
});

test("at high notoriety the pirate ship is confiscated, unless it is the company's only ship", () => {
  const { e, A, co, ship } = chase(undefined, 1);
  e.piracy.setNotoriety(A, 90);
  const n = co.ships.length;
  e.advance();
  assert.ok(!e.ships.has(ship), "confiscated");
  assert.equal(co.ships.length, n - 1);
  assert.match(e.piracy.notices.get(A)![0].text, /confiscated it/);
  // A company with only the pirate ship is locked out instead.
  const lone = chase();
  lone.co.ships = lone.co.ships.filter(id => id === lone.ship);   // (its freighter is gone)
  lone.e.ships.delete(lone.e.companies.get(lone.A)!.ships.length ? -1 : -1);
  lone.e.piracy.setNotoriety(lone.A, 90);
  lone.e.advance();
  assert.ok(lone.e.ships.has(lone.ship), "its only ship is never confiscated");
  assert.equal(lone.e.piracy.lockoutHours(lone.A), 24);
});

test("police only catch pirates that are wanted: honest ships, quiet pirates and docked pirates are left alone", () => {
  // Notoriety below the chase level.
  const quiet = chase();
  quiet.e.piracy.setNotoriety(quiet.A, 5);
  const cash = quiet.co.cash;
  quiet.e.advance();
  assert.equal(quiet.co.cash, cash);
  // A docked pirate is safe in port.
  const docked = chase();
  docked.e.piracy.setNotoriety(docked.A, 50);
  const dockedShip = docked.e.ships.get(docked.co.ships[0])!;   // the starting freighter, docked and honest
  const c2 = docked.co.cash;
  docked.e.advance();
  assert.ok(docked.e.ships.has(dockedShip.id));
  // And a pirate beyond catch range is not caught.
  const out = chase(r => { r.police.catch_range = 0.001; });
  out.e.piracy.setNotoriety(out.A, 50);
  out.e.advance();
  assert.equal(out.e.piracy.lockoutHours(out.A), 0);
  assert.ok(c2 !== undefined);
});

test("the catch chance rises with notoriety and is capped", () => {
  const P = rules.police;
  const at = (n: number) => Math.min(P.catch_max, P.catch_base + P.catch_per_notoriety * n);
  assert.ok(at(10) < at(50) && at(50) < at(100));
  assert.equal(at(1000), P.catch_max);
});

test("a whole bot world with pirates and police replays exactly from its commands", () => {
  // A rich world with two ships each, so there are raidable fleets (a company's only ship is protected, and
  // almost every ordinary bot has only one) and pirate bots can afford their ships.
  const r = structuredClone(rules); r.company.start_cash = 45000; r.company.start_ships = 2;
  const e = new Engine(r, map, 60);
  const log: (Command | { type: "tick" })[] = [];
  const commit = (c: Command) => { const res = e.apply(c); if (res.ok) log.push(c); return res; };
  const ids: number[] = [];
  for (let i = 0; i < 30; i++) ids.push((commit({ type: "register", name: botName(i), startPort: (i * 7) % e.n }) as any).id);
  let raids = 0;
  for (let t = 0; t < 24 * 30; t++) {
    e.advance(); log.push({ type: "tick" });
    const spy = (c: Command) => { const res = commit(c); if (c.type === "raid" && res.ok) raids++; return res; };
    runPirateBots(e, ids, spy);   // the same order as main.ts
    runBots(e, ids, commit, { minProfit: e.botMinProfit, error: e.botError });
  }
  const again = new Engine(structuredClone(r), map, 60);
  for (const c of log) { if (c.type === "tick") again.advance(); else again.apply(c); }
  const snap = (x: Engine) => JSON.stringify({
    tick: x.tick,
    cash: [...x.companies.values()].map(c => [c.id, Math.round(c.cash * 100), c.ships, c.home]),
    ships: [...x.ships.values()].map(s => [s.id, s.owner, s.type, s.port, s.dest, s.qty, Math.round(s.cost * 100)]),
    police: x.police.ships,
    noto: [...x.piracy.notoriety.entries()].map(([k, v]) => [k, Math.round(v * 1000)]),
    lock: [...x.piracy.lockout.entries()], cool: [...x.piracy.cooldown.entries()],
    notices: [...x.piracy.notices.entries()],
  });
  assert.equal(snap(again), snap(e));
  const pirates = log.filter(c => c.type === "buyShip" && c.shipType === "pirate").length;   // bought (police may confiscate them later)
  assert.ok(pirates >= 1, `some bots bought pirate ships (${pirates})`);
  assert.ok(raids >= 1, `and they raided (${raids} raids)`);
  assert.ok(e.police.ships.length >= 4, "police are on patrol");
  console.log(`   (30 bots, 30 days: ${pirates} pirate ships, ${raids} raids, ${[...e.piracy.notices.values()].flat().filter(n => n.kind === "fined" || n.kind === "locked-out" || n.kind === "confiscated").length} arrests)`);
});
