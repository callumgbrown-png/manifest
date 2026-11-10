import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, type Command } from "../src/engine.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));
const err = (r: any) => (r.ok ? "" : r.error);

/** A pirate company A and a trading company B with two ships. B's second ship has just sailed from port h,
 *  A's pirate is docked at h, and B's home is far away, so the target is in range and outside B's safe waters. */
function scene(edit?: (r: any) => void, opts: { cargo?: number } = {}) {
  const r = structuredClone(rules); edit?.(r);
  const e = new Engine(r, map, 60);
  const log: Command[] = [];
  const run = (c: Command) => { const res = e.apply(c); if (res.ok) log.push(c); return res; };
  const adv = () => { e.advance(); log.push({ type: "tick" } as any); };
  const h = 0;
  const dest = [...Array(e.n).keys()].filter(p => p !== h && Number.isFinite(e.dist[h][p])).sort((a, b) => e.dist[h][b] - e.dist[h][a])[2];
  const g = [...Array(e.n).keys()].sort((a, b) => e.dist[h][b] - e.dist[h][a])[0];   // B's home: the port farthest from h
  const A = (run({ type: "register", name: "Corsair Co", startPort: h }) as any).id;
  const B = (run({ type: "register", name: "Honest Haulage", startPort: g }) as any).id;
  for (const id of [A, B]) e.companies.get(id)!.cash = 60000;
  // B's first ship sails home -> h, then B buys a second ship at h and loads it for a trip to `dest`.
  const b1 = e.companies.get(B)!.ships[0];
  run({ type: "sail", company: B, ship: b1, dest: h });
  while (e.ships.get(b1)!.dest !== null) adv();
  const b2 = (run({ type: "buyShip", company: B, port: h, shipType: "freighter" }) as any).id;
  const pirate = (run({ type: "buyShip", company: A, port: h, shipType: "pirate" }) as any).id;
  const loaded = run({ type: "sail", company: B, ship: b2, dest, buy: { good: "grain", qty: opts.cargo ?? 100 } });
  assert.ok(loaded.ok, err(loaded));
  adv();   // one hour out: about 40 units from h
  return { e, run, adv, log, A, B, h, g, dest, b1, b2, pirate, rules: r };
}
const always = (r: any) => { r.pirates.base_chance = 1; r.pirates.min_chance = 1; r.pirates.max_chance = 1; r.pirates.capture_margin = 2; };
const never = (r: any) => { r.pirates.base_chance = 0; r.pirates.speed_weight = 0; r.pirates.min_chance = 0; r.pirates.max_chance = 0; };

test("a won raid takes the cargo the pirate's hold has room for, adds notoriety and a cooldown, and tells both sides", () => {
  const s = scene(always);
  const cargoBefore = s.e.ships.get(s.b2)!.qty, costBefore = s.e.ships.get(s.b2)!.cost;
  assert.equal(cargoBefore, 100);
  const r = s.run({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }) as any;
  assert.equal(r.ok, true, err(r));
  assert.equal(r.outcome, "won");
  assert.equal(r.loot, 30, "takes what fits in a 30-unit hold");
  const p = s.e.ships.get(s.pirate)!, v = s.e.ships.get(s.b2)!;
  assert.equal(p.qty, 30); assert.equal(p.good, 0);
  assert.equal(v.qty, 70, "the victim keeps the rest");
  assert.ok(Math.abs(p.cost + v.cost - costBefore) < 1e-6, "the cargo's cost moves with it; none is created or lost");
  assert.equal(s.e.piracy.notorietyOf(s.A), 25);
  assert.equal(s.e.piracy.cooldown.get(s.pirate), s.e.tick + 12);
  assert.match(s.e.piracy.notices.get(s.B)![0].text, /Corsair Co raided your ship .* took 30 grain/);
  assert.match(s.e.piracy.notices.get(s.A)![0].text, /took 30 grain/);
});

test("a decisive win captures the whole ship, cargo and all, into the pirate's fleet", () => {
  const s = scene(r => { always(r); r.pirates.capture_margin = 0; });
  const r = s.run({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }) as any;
  assert.equal(r.outcome, "captured");
  assert.equal(s.e.ships.get(s.b2)!.owner, s.A);
  assert.ok(s.e.companies.get(s.A)!.ships.includes(s.b2));
  assert.ok(!s.e.companies.get(s.B)!.ships.includes(s.b2));
  assert.equal(s.e.companies.get(s.B)!.ships.length, 1, "the victim keeps its other ship");
  assert.equal(s.e.ships.get(s.b2)!.qty, 100, "the cargo goes with the ship");
  // The captured ship carries on to its port, now under the pirate's flag, and the pirate can sell the cargo.
  while (s.e.ships.get(s.b2)!.dest !== null) s.e.advance();
  assert.ok(s.e.apply({ type: "sell", company: s.A, ship: s.b2 }).ok);
  assert.match(s.e.piracy.notices.get(s.B)![0].text, /captured your ship/);
});

test("a capture needs room in the pirate's fleet: at the fleet limit the pirate loots instead", () => {
  const s = scene(r => { always(r); r.pirates.capture_margin = 0; });
  const co = s.e.companies.get(s.A)!;
  while (co.ships.length < s.rules.company.max_ships) assert.ok(s.run({ type: "buyShip", company: s.A, port: s.h, shipType: "coaster" }).ok);
  const r = s.run({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }) as any;
  assert.equal(r.outcome, "won");
  assert.equal(s.e.ships.get(s.b2)!.owner, s.B);
});

test("a lost raid costs the pirate its repair money and still adds notoriety", () => {
  const s = scene(never);
  const cash = s.e.companies.get(s.A)!.cash;
  const r = s.run({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }) as any;
  assert.equal(r.outcome, "lost");
  assert.equal(s.e.companies.get(s.A)!.cash, cash - 300);
  assert.equal(s.e.ships.get(s.b2)!.qty, 100);
  assert.equal(s.e.piracy.notorietyOf(s.A), 25);
  assert.match(s.e.piracy.notices.get(s.B)![0].text, /beaten off/);
});

test("the fight formula: faster pirates win more often, bigger holds resist, and the result is kept between min and max", () => {
  const s = scene();
  const pirate = s.e.ships.get(s.pirate)!;
  const make = (type: string) => ({ ...s.e.ships.get(s.b2)!, type }) as any;
  const R = s.rules.pirates;
  const expected = (type: string) => {
    const v = s.e.spec(type as any), p = s.e.spec("pirate");
    return Math.min(R.max_chance, Math.max(R.min_chance, R.base_chance + R.speed_weight * (1 - v.speed_per_hour / p.speed_per_hour) - R.size_weight * Math.max(0, v.capacity / p.capacity - 1)));
  };
  for (const t of ["coaster", "freighter", "bulker"]) assert.ok(Math.abs(s.e.piracy.chance(pirate, make(t)) - expected(t)) < 1e-12, `${t} matches the written formula`);
  assert.ok(s.e.piracy.chance(pirate, make("coaster")) < s.e.piracy.chance(pirate, make("freighter")), "a slow freighter is easier prey than a quick coaster");
  for (const t of ["coaster", "freighter", "bulker"]) { const c = s.e.piracy.chance(pirate, make(t)); assert.ok(c >= R.min_chance && c <= R.max_chance); }
});

test("the rules: who can be raided, and by whom", () => {
  const s = scene(always);
  const go = (over: Partial<{ company: number; ship: number; target: number }> = {}) => s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2, ...over });
  assert.equal(err(go({ ship: s.e.companies.get(s.A)!.ships[0] })), "only a pirate ship can raid");
  assert.equal(err(go({ company: s.B })), "not your ship");
  assert.equal(err(go({ target: s.pirate })), "you can't raid your own ship");
  assert.equal(err(go({ target: s.b1 })), "a ship in port can't be raided", "a docked ship is safe in port");
  assert.equal(err(go({ target: 9999 })), "no such ship");
  // A company's only ship: scrap B's spare and the lone ship can't be raided even at sea.
  const only = scene(always);
  const b1 = only.e.ships.get(only.b1)!;
  assert.ok(only.e.apply({ type: "scrapShip", company: only.B, ship: only.b1 }).ok);
  assert.equal(err(only.e.apply({ type: "raid", company: only.A, ship: only.pirate, target: only.b2 })), "a company's only ship can't be raided");
  assert.ok(b1);
  // One raid, then the pirate must rest.
  assert.ok(go().ok);
  assert.equal(err(go()), "this ship is lying low for 12 more hours");
  for (let i = 0; i < 11; i++) s.e.advance();
  assert.match(err(go()), /lying low for 1 more hours/);
  s.e.advance();
  assert.notEqual(err(go()), "this ship is lying low for 12 more hours");
});

test("safe harbour: a ship near its owner's home port can't be raided, and nobody is attacked inside a port", () => {
  const s = scene(always);
  const v = s.e.companies.get(s.B)!;
  v.home = s.h;   // move B's home to where its ship just left: it is within the safe radius
  assert.match(err(s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 })), /safe waters around its owner's home port/);
  v.home = s.g;   // home far away again: the same ship is fair game
  assert.ok(s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }).ok);
});

test("range: a target farther than the raid range can't be hit", () => {
  const s = scene(always);
  for (let i = 0; i < 4 && s.e.ships.get(s.b2)!.dest !== null; i++) s.e.advance();   // it sails on; the pirate stays docked
  const left = s.e.ships.get(s.b2)!.dest !== null;
  if (left) assert.match(err(s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 })), /out of range/);
});

test("pirates don't raid pirates, and a locked-out company can't raid", () => {
  const s = scene(always);
  const C = (s.run({ type: "register", name: "Other Pirates", startPort: s.h }) as any).id;
  s.e.companies.get(C)!.cash = 60000;
  const p2 = (s.run({ type: "buyShip", company: C, port: s.h, shipType: "pirate" }) as any).id;
  assert.equal(err(s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: p2 })), "pirates don't raid each other");
  s.e.piracy.lockout.set(s.A, s.e.tick + 5);
  assert.equal(err(s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 })), "your company is locked out of ports for 5 more hours");
});

test("with pirates off, raiding is refused", () => {
  const off = structuredClone(rules); off.pirates.enabled = false;
  const e = new Engine(off, map, 60);
  const a = (e.apply({ type: "register", name: "No Pirates", startPort: 0 }) as any).id;
  assert.equal(err(e.apply({ type: "raid", company: a, ship: e.companies.get(a)!.ships[0], target: 1 })), "there are no pirates in this world");
});

test("notoriety rises with each raid and falls slowly with time", () => {
  const s = scene(always);
  assert.ok(s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }).ok);
  assert.equal(s.e.piracy.notorietyOf(s.A), 25);
  for (let i = 0; i < 25; i++) s.e.advance();
  assert.ok(Math.abs(s.e.piracy.notorietyOf(s.A) - (25 - 25 * 0.4)) < 1e-9, "0.4 a hour");
  for (let i = 0; i < 40; i++) s.e.advance();
  assert.equal(s.e.piracy.notorietyOf(s.A), 0, "back to nothing after about two and a half days");
  // Never above the maximum.
  s.e.piracy.addNotoriety(s.A, 500);
  assert.equal(s.e.piracy.notorietyOf(s.A), 100);
});

test("targetsFor lists what the Raid button may hit, with the chance", () => {
  const s = scene();
  const list = s.e.piracy.targetsFor(s.e.ships.get(s.pirate)!);
  assert.deepEqual(list.map(t => t.ship), [s.b2]);
  assert.equal(list[0].ownerName, "Honest Haulage");
  assert.equal(list[0].chance, Math.round(s.e.piracy.chance(s.e.ships.get(s.pirate)!, s.e.ships.get(s.b2)!) * 100) / 100);
});

test("raids replay exactly: the same commands give the same fights, losses and notices", () => {
  // Real chances this time. Raid whenever the pirate may, over a long voyage cycle, then replay the log.
  const s = scene(r => { r.pirates.cooldown_hours = 1; r.pirates.range = 500; r.pirates.home_safe_radius = 1; r.pirates.capture_margin = 2; });
  let wins = 0, losses = 0;
  for (let i = 0; i < 200; i++) {
    const t = s.e.ships.get(s.b2);
    if (t && t.dest === null && s.e.companies.get(s.B)!.ships.includes(s.b2)) { s.run({ type: "sail", company: s.B, ship: s.b2, dest: s.dest === t.port ? s.h : s.dest, buy: { good: "grain", qty: 40 } }); }
    const r = s.e.apply({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 });
    if (r.ok) { s.log.push({ type: "raid", company: s.A, ship: s.pirate, target: s.b2 }); if (r.outcome === "lost") losses++; else wins++; }
    s.adv();
    const pr = s.e.ships.get(s.pirate)!;
    if (pr.dest === null && pr.qty > 0) { const sell = { type: "sell", company: s.A, ship: s.pirate } as Command; if (s.e.apply(sell).ok) s.log.push(sell); }
  }
  assert.ok(wins > 0 && losses > 0, `both outcomes happen with the real formula (wins ${wins}, losses ${losses})`);
  // Replay: ticks advance the engine, everything else is a command.
  const r2 = structuredClone(s.rules);
  const again = new Engine(r2, map, 60);
  // (The scene hands both companies 60,000 right after they register; there is no command for that, so do it here.)
  let registered = 0;
  for (const c of s.log) {
    if ((c as any).type === "tick") again.advance(); else again.apply(c);
    if (c.type === "register" && ++registered === 2) for (const co of again.companies.values()) co.cash = 60000;
  }
  const snap = (e: Engine) => JSON.stringify({
    cash: [...e.companies.values()].map(c => [c.id, Math.round(c.cash * 100), c.ships]),
    ships: [...e.ships.values()].map(x => [x.id, x.owner, x.qty, Math.round(x.cost * 100)]),
    noto: [...e.piracy.notoriety.entries()].map(([k, v]) => [k, Math.round(v * 1000)]),
    notices: [...e.piracy.notices.entries()],
  });
  assert.equal(snap(again), snap(s.e));
});

test("an underway pirate can raid a solo merchant's cargo with a cap and protection", () => {
  const s = scene(r => { always(r); r.pirates.capture_margin = 0; });
  assert.ok(s.run({ type: "scrapShip", company: s.B, ship: s.b1 }).ok);
  const raid = { type: "raid" as const, company: s.A, ship: s.pirate, target: s.b2, cargoOnly: true };
  assert.match(err(s.e.applyLive(raid)), /underway/);
  assert.ok(s.run({ type: "sail", company: s.A, ship: s.pirate, dest: s.dest }).ok);
  assert.ok(s.e.piracy.targetsFor(s.e.ships.get(s.pirate)!, true).some(t => t.ship === s.b2 && t.cargoOnly));
  const result = s.e.applyLive(raid);
  assert.ok(result.ok);
  assert.equal(result.outcome, "won");
  assert.equal(result.loot, 25);
  assert.equal(s.e.ships.get(s.b2)!.owner, s.B);
  assert.equal(s.e.ships.get(s.b2)!.qty, 75);
  assert.ok(!s.e.piracy.targetsFor(s.e.ships.get(s.pirate)!, true).some(t => t.ship === s.b2));
});
