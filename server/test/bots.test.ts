import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine } from "../src/engine.ts";
import { runBots, botName, isBot } from "../src/bots.ts";

const rules = JSON.parse(readFileSync(new URL("../../config/rules.json", import.meta.url), "utf8"));
const map = JSON.parse(readFileSync(new URL("../../config/map.json", import.meta.url), "utf8"));

test("bot names are unique and can't be taken by players", () => {
  const names = Array.from({ length: 120 }, (_, i) => botName(i));
  assert.equal(new Set(names).size, 120);
  assert.ok(names.every(isBot));
  assert.ok(!/^[A-Za-z0-9 _.-]{3,24}$/.test(names[0]), "player name rule rejects bot names");
});

test("30 bots trade a full season without going broke or breaking the economy", () => {
  const e = new Engine(rules, map, 30);
  const ids: number[] = [];
  for (let i = 0; i < 30; i++) ids.push((e.apply({ type: "register", name: botName(i), startPort: (i * 7) % e.n }) as any).id);
  const start = e.metrics().moneySupply;
  let commands = 0;
  const commit = (c: any) => { commands++; return e.apply(c); };
  while (!e.seasonOver) { e.advance(); runBots(e, ids, commit); }
  const m = e.metrics();
  assert.ok(commands > 1000, `bots were active (${commands} commands)`);
  assert.equal(m.inDebt, 0, "no bot in debt");
  // Known: small worlds drift down about 1% a day (see NEXT_STEPS.md). Guard against runaway either way.
  assert.ok(m.moneySupply > start * 0.4 && m.moneySupply < start * 2, `money supply sane: ${start} -> ${m.moneySupply}`);
  assert.ok(m.top1pctShare < 0.2);
});

test("after the season ends, the clock stops and trading is refused", () => {
  const e = new Engine(rules, map);
  const id = (e.apply({ type: "register", name: "A", startPort: 0 }) as any).id;
  e.tick = e.seasonHours - 1;
  e.advance();
  assert.ok(e.seasonOver);
  e.advance();
  assert.equal(e.tick, e.seasonHours);
  const ship = e.companies.get(id)!.ships[0];
  assert.equal((e.apply({ type: "sail", company: id, ship, dest: 1 }) as any).error, "the season has ended");
  assert.ok(e.apply({ type: "adminSet", tax: 0.05 }).ok, "admin can still adjust");
});

test("misjudging bots earn less than perfect ones, and still stay out of debt", () => {
  const season = (error: number) => {
    const e = new Engine(rules, map, 30);
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) ids.push((e.apply({ type: "register", name: botName(i), startPort: (i * 7) % e.n }) as any).id);
    let trips = 0;
    const commit = (c: any) => { if (c.type === "sail" && c.buy) trips++; return e.apply(c); };
    while (!e.seasonOver) { e.advance(); runBots(e, ids, commit, { minProfit: 0, error }); }
    const worth = ids.reduce((t, id) => t + e.companies.get(id)!.cash, 0);
    return { worth, trips, inDebt: e.metrics().inDebt };
  };
  const perfect = season(0), sloppy = season(rules.difficulty.presets.easy.botError);
  assert.ok(sloppy.trips > 500, `misjudging bots still trade (${sloppy.trips} loaded trips)`);
  assert.equal(sloppy.inDebt, 0, "no bot in debt");
  assert.ok(sloppy.worth < perfect.worth, `misjudging bots earn less: ${sloppy.worth} vs ${perfect.worth}`);
});

test("difficulty presets set how far off bots' price guesses are", () => {
  const e = new Engine(rules, map);
  assert.equal(e.botError, rules.difficulty.presets.normal.botError);
  e.apply({ type: "setDifficulty", level: "easy" });
  assert.equal(e.botError, rules.difficulty.presets.easy.botError);
  e.apply({ type: "setDifficulty", level: "hard" });
  assert.ok(e.botError < rules.difficulty.presets.easy.botError);
});
