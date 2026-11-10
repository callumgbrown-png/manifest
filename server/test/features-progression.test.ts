// Tests for the progression feature modules (ideas 131-145 and 381-420). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Engine, GOODS, type Company } from "../src/engine.ts";
import { assertReplays, featureWorld, map, rules } from "./feature-helpers.ts";
import { tracker } from "../src/features/progression/tracker.ts";
import { loadContent } from "../src/features/progression/content.ts";
import { shared } from "../src/features/progression/shared.ts";
import { REWARD_PER_XP, TITLE_FEE_CUT } from "../src/features/progression/career.ts";
import { routeForDay, tripMatches } from "../src/features/progression/goals.ts";
import { BLITZ_EVERY, BLITZ_FEE, BLITZ_HOURS, LADDER_DAYS, TOURNAMENT_EVERY, TOURNAMENT_HOURS } from "../src/features/progression/competition.ts";
import { BASE_LICENCES, LICENCE_FINE_MAX, LICENCE_FINE_SHARE, LOGIN_BASE, LOGIN_STREAK_STEP, PRESTIGE_WORTH, REMOTE_LEVEL, remotePorts } from "../src/features/progression/unlocks.ts";
import { MAPS_PER_COMPANY, SANDBOX_CASH, presetMismatches, validateMap } from "../src/features/progression/modes.ts";
import { prepareMap } from "../scripts/use-map.ts";

type W = ReturnType<typeof featureWorld>;
const CFG = JSON.parse(readFileSync(new URL("../../config/features/progression.json", import.meta.url), "utf8"));
const ALL = Object.keys(CFG).filter(k => k.startsWith("progression."));
const IDEAS = [...Array.from({ length: 15 }, (_, i) => 131 + i), ...Array.from({ length: 40 }, (_, i) => 381 + i)];
const view = (w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as any;
const worldOf = (w: W, id: string) => w.e.features.world()[id] as any;
const cards = (w: W, c: Company, id: string) => w.e.features.cards(c.id)[id]?.cards ?? [];

/** The most profitable short lane (producer -> consumer of one good), so tests can make real, paying deliveries. */
const lanes = new WeakMap<Engine, ReturnType<typeof findLane>>();
/** Picked once per world (prices move after trades). */
const lane = (e: Engine) => { let l = lanes.get(e); if (!l) lanes.set(e, l = findLane(e)); return l; };
function findLane(e: Engine) {
  let best: { from: number; to: number; good: number; g: (typeof GOODS)[number]; score: number } | undefined;
  for (let p = 0; p < e.map.ports.length; p++) for (const g of e.map.ports[p].produces) {
    const good = GOODS.indexOf(g as any);
    e.map.ports.forEach((x, q) => {
      if (q === p || !x.consumes.includes(g) || !Number.isFinite(e.dist[p][q])) return;
      const score = (e.price(q, good) - e.price(p, good)) * 40 - e.dist[p][q] * 2;
      if (!best || score > best.score) best = { from: p, to: q, good, g: g as (typeof GOODS)[number], score };
    });
  }
  if (!best) throw new Error("no lane");
  return best;
}
/** Register at the lane's producer. */
const trader = (w: W, name = "A") => w.company(name, lane(w.e).from);
/** One real delivery along the lane and back to the producer, returning the hours it took. */
function deliver(w: W, c: Company, qty = 40) {
  const l = lane(w.e), s = w.e.ships.get(c.ships[0])!;
  if (s.port !== l.from) { w.apply({ type: "sail", company: c.id, ship: s.id, dest: l.from }); w.hours(s.arriveTick - w.e.tick); }
  w.apply({ type: "sail", company: c.id, ship: s.id, dest: l.to, buy: { good: l.g, qty } });
  w.hours(s.arriveTick - w.e.tick);
  w.apply({ type: "sell", company: c.id, ship: s.id });
  w.hours(1);
}

test("every progression idea has a module, and the switch file lists every module (economy off)", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("progression."));
  const ideas = new Set(mods.flatMap(m => m.ideas));
  for (const i of IDEAS) assert.ok(ideas.has(i), `idea ${i}`);
  for (const i of ideas) assert.ok(IDEAS.includes(i), `stray idea ${i}`);
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL].sort());
  for (const m of mods) assert.equal(CFG[m.id], !m.economy, m.id);
  // The assignment's economy ideas each have an economy module.
  for (const i of [133, 134, 135, 140, 141, 145, 381, 382, 387, 388, 389, 400, 405])
    assert.ok(mods.some(m => m.economy && m.ideas.includes(i)), `economy module for idea ${i}`);
});

test("content loads, and data mods add entries but cannot replace or break them", () => {
  const c = loadContent();
  assert.ok(c.achievements.length >= 15 && c.titles.length >= 10 && c.nodes.length >= 10 && c.presets.length >= 10);
  assert.ok(c.achievements.some(a => a.secret) && c.achievements.some(a => a.kind === "goal") && c.achievements.some(a => a.kind === "milestone"));
  assert.ok(c.achievements.some(a => a.kind === "goal" && a.stat === "peakShips" && a.atLeast === 50), "50-ship fleet goal");
  assert.deepEqual(c.mods, [], "the example mod starts with _ and is not loaded");
});

test("captain levels and the rank ladder grow from real deliveries", () => {
  const w = featureWorld(["progression.captain-levels", "progression.rank-ladder"]);
  const a = trader(w), b = trader(w, "B");
  w.hours(1);
  assert.equal(view(w, a, "progression.captain-levels").level, 1);
  deliver(w, a);
  const t = tracker(w.e);
  assert.equal(t.get(a.id).deliveries, 1);
  assert.ok(view(w, a, "progression.captain-levels").xp >= 10);
  t.award(a.id, 5000);
  assert.ok(view(w, a, "progression.captain-levels").level >= 10);
  assert.equal(view(w, a, "progression.rank-ladder").position, 1);
  assert.equal(view(w, b, "progression.rank-ladder").position, 2);
  assert.equal(worldOf(w, "progression.rank-ladder")[0].company, a.id);
});

test("views never create tracker state (a live server reads views at any time)", () => {
  const w = featureWorld(["progression.stats-dashboard"]);
  const a = trader(w);
  view(w, a, "progression.stats-dashboard");
  assert.equal(tracker(w.e).stats.has(a.id), false);
  w.hours(1);
  assert.equal(tracker(w.e).stats.has(a.id), true);
});

test("stats dashboard and collection book record deliveries, ports and goods", () => {
  const w = featureWorld(["progression.stats-dashboard", "progression.collection-book"]);
  const a = trader(w);
  deliver(w, a);
  const stats = view(w, a, "progression.stats-dashboard");
  assert.equal(stats.deliveries, 1);
  assert.equal(stats.topRoutes.length, 1);
  const l = lane(w.e);
  const book = view(w, a, "progression.collection-book");
  assert.notEqual(book.ports[l.to].since, null);
  assert.notEqual(book.goods[l.good].since, null);
  assert.match(cards(w, a, "progression.collection-book")[0].detail, /Goods delivered: 1/);
});

test("achievements: earned once, give experience and skins; secret ones stay hidden", () => {
  const w = featureWorld(["progression.achievements", "progression.skins"]);
  const a = trader(w);
  deliver(w, a);
  const list = view(w, a, "progression.achievements");
  assert.ok(list.find((x: any) => x.id === "first-delivery").earned !== null);
  const secret = list.find((x: any) => x.id === "ghost-ship");
  assert.equal(secret.name, "???");
  const t = tracker(w.e);
  t.of(a.id).bestTrip = 3000;
  w.hours(1);
  assert.ok(view(w, a, "progression.skins").owned.includes("gold"));
  assert.equal(w.act(a, "progression.skins", "wear", { skin: "gold" }).ok, true);
  assert.equal(w.act(a, "progression.skins", "wear", { skin: "rainbow" }).ok, false, "locked");
  assert.equal(w.act(a, "progression.skins", "wear", { skin: 5 }).ok, false);
  assert.equal(worldOf(w, "progression.skins")[a.id], "#e0b13c");
  const xp = t.bonusXp.get(a.id);
  w.hours(3);
  assert.equal(t.bonusXp.get(a.id), xp, "no double award");
});

test("achievement rewards pay cash only for achievements earned while switched on", () => {
  const w = featureWorld(["progression.achievements"]);
  const a = trader(w);
  deliver(w, a);
  w.apply({ type: "setFeatures", enabled: ["progression.achievements", "progression.achievement-rewards"] });
  const cash = a.cash;
  w.hours(1);
  assert.equal(a.cash, cash, "backlog is not paid");
  tracker(w.e).of(a.id).peakShips = 2;   // Growing Fleet: 40 xp
  w.hours(1);
  assert.equal(a.cash, cash + 40 * REWARD_PER_XP);
});

test("titles: earned by stats and playstyle, shown by choice; title perks cut port fees", () => {
  const w = featureWorld(["progression.titles"]);
  const a = trader(w);
  const t = tracker(w.e);
  w.hours(1);
  Object.assign(t.of(a.id), { deliveries: 12, voyages: 12 });
  t.of(a.id).goodDeliveries[0] = 8;
  w.hours(1);
  const v = view(w, a, "progression.titles");
  assert.ok(v.titles.find((x: any) => x.id === "merchant").earned);
  assert.ok(v.titles.find((x: any) => x.id === "grain-baron").earned, "playstyle title");
  assert.ok(!v.titles.find((x: any) => x.id === "magnate").earned);
  assert.equal(w.act(a, "progression.titles", "show", { title: "magnate" }).ok, false);
  assert.equal(w.act(a, "progression.titles", "show", { title: "merchant" }).ok, true);
  assert.equal(worldOf(w, "progression.titles")[a.id], "Merchant");
  const ctx = { ship: a.ships[0], company: a.id, from: 0, dest: 1 };
  assert.equal(w.e.features.adjust("portFee", 100, ctx), 100);
  w.apply({ type: "setFeatures", enabled: ["progression.titles", "progression.title-perks"] });
  assert.equal(w.e.features.adjust("portFee", 100, ctx), 100 * (1 - TITLE_FEE_CUT));
});

test("trophy room and hall of fame collect records", () => {
  const w = featureWorld(["progression.trophy-room", "progression.hall-of-fame", "progression.puzzles"]);
  const a = trader(w);
  assert.equal(w.act(a, "progression.puzzles", "start", { puzzle: "express" }).ok, true);
  deliver(w, a);
  const hall = worldOf(w, "progression.hall-of-fame");
  assert.equal(hall.find((r: any) => r.key === "deliveries").company, a.id);
  assert.ok(Array.isArray(view(w, a, "progression.trophy-room").trophies));
});

test("daily quests and weekly goals: three a day, two a week, deterministic, completed by play", () => {
  const w = featureWorld(["progression.daily-quests", "progression.weekly-goals"]);
  const a = trader(w);
  w.hours(1);
  const daily = view(w, a, "progression.daily-quests"), weekly = view(w, a, "progression.weekly-goals");
  assert.equal(daily.length, 3);
  assert.equal(new Set(daily.map((q: any) => q.id)).size, 3);
  assert.equal(weekly.length, 2);
  const t = tracker(w.e), q = daily[0];
  const s = t.of(a.id) as any;
  if (q.id === "d-ports") s.ports = new Set([...s.ports, 1, 2, 3]);
  else if (q.id.startsWith("d-") && ["grain", "fuel", "ore"].includes(q.id.slice(2))) s.goodUnits[GOODS.indexOf(q.id.slice(2))] += q.target;
  else s[{ "d-deliveries": "deliveries", "d-cargo": "cargo", "d-distance": "distance", "d-profit": "profit" }[q.id as string]!] += q.target;
  w.hours(1);
  assert.equal(view(w, a, "progression.daily-quests")[0].done, true);
  w.hours(24);
  assert.equal(view(w, a, "progression.daily-quests").every((x: any) => !x.done || x.progress >= x.target), true);
  const again = featureWorld(["progression.daily-quests"]), a2 = trader(again);
  again.hours(1);
  assert.deepEqual(view(again, a2, "progression.daily-quests").map((x: any) => x.id), daily.map((x: any) => x.id));
});

test("tutorial chain advances step by step and can be skipped", () => {
  const w = featureWorld(["progression.tutorial"]);
  const a = trader(w), b = trader(w, "B");
  w.hours(1);
  assert.equal(view(w, a, "progression.tutorial").step, 0);
  deliver(w, a);
  assert.ok(view(w, a, "progression.tutorial").step >= 2);
  assert.equal(w.act(b, "progression.tutorial", "skip").ok, true);
  assert.deepEqual(cards(w, b, "progression.tutorial"), []);
});

test("season track unlocks free cosmetic rewards from experience", () => {
  const w = featureWorld(["progression.season-track", "progression.titles"]);
  const a = trader(w);
  tracker(w.e).award(a.id, 1000);   // 200 points
  w.hours(1);
  const v = view(w, a, "progression.season-track");
  assert.equal(v.rewards.filter((r: any) => r.unlocked).length, 2);
  assert.equal(w.act(a, "progression.titles", "show", { title: "voyager" }).ok, true, "track title can be shown");
});

test("daily route: one route a day, completed by delivering it", () => {
  const w = featureWorld(["progression.daily-route"]);
  const a = trader(w);
  const r = routeForDay(w.e, 0)!;
  assert.ok(w.e.map.ports[r.from].produces.includes(GOODS[r.good]));
  assert.ok(w.e.map.ports[r.to].consumes.includes(GOODS[r.good]));
  assert.deepEqual(routeForDay(w.e, 0), r);
  w.hours(1);
  assert.deepEqual(worldOf(w, "progression.daily-route"), { from: r.from, to: r.to, good: GOODS[r.good] });
  assert.equal(view(w, a, "progression.daily-route").done, false);
});

test("puzzles and training missions: start, solve by a matching trip, time limits, validation", () => {
  const w = featureWorld(["progression.puzzles"]);
  const a = trader(w);
  assert.equal(w.act(a, "progression.puzzles", "start", { puzzle: "nope" }).ok, false);
  assert.equal(w.act(a, "progression.puzzles", "start", { puzzle: "train-consumer" }).ok, true);
  assert.equal(w.act(a, "progression.puzzles", "start", { puzzle: "express" }).ok, false, "one at a time");
  deliver(w, a);
  assert.deepEqual(view(w, a, "progression.puzzles").solved, ["train-consumer"]);
  assert.equal(w.act(a, "progression.puzzles", "start", { puzzle: "train-consumer" }).ok, false, "already solved");
  assert.equal(w.act(a, "progression.puzzles", "start", { puzzle: "machinery-margin" }).ok, true);
  w.hours(49);
  assert.equal(view(w, a, "progression.puzzles").active, null, "timed out");
  const f = { company: a.id, profit: 50, distance: 400, trip: { good: 0, qty: 120, from: 0, to: 1, departTick: 0, arriveTick: 5, costs: { fuel: 90, cargo: 0, portFees: 0 } } } as any;
  assert.equal(tripMatches(w.e, f, { minQty: 100, maxFuel: 100 }), true);
  assert.equal(tripMatches(w.e, f, { maxFuel: 80 }), false);
  assert.equal(tripMatches(w.e, f, { minDistance: 300, minProfit: 500 }), false);
});

test("challenge runs fail when a rule is broken", () => {
  const w = featureWorld(["progression.challenges"]);
  const a = trader(w);
  assert.equal(w.act(a, "progression.challenges", "start", { challenge: "one-ship" }).ok, true);
  w.apply({ type: "buyShip", company: a.id, port: a.home, shipType: "coaster" });
  w.hours(1);
  assert.match(view(w, a, "progression.challenges").run.failed, /more than 1/);
  assert.equal(w.act(a, "progression.challenges", "start", { challenge: "wat" }).ok, false);
  assert.equal(w.act(a, "progression.challenges", "start", { challenge: "grain-only" }).ok, true, "a failed run can be replaced");
});

test("co-op campaign: crews pool progress and clear chapters together", () => {
  const w = featureWorld(["progression.coop-campaign"]);
  const a = trader(w), b = trader(w, "B"), c = trader(w, "C");
  w.hours(1);
  const r = w.act(a, "progression.coop-campaign", "found") as { ok: true; id: number };
  assert.equal(w.act(b, "progression.coop-campaign", "join", { crew: r.id }).ok, true);
  assert.equal(w.act(c, "progression.coop-campaign", "join", { crew: 999 }).ok, false);
  assert.equal(w.act(a, "progression.coop-campaign", "found").ok, false, "already in a crew");
  const t = tracker(w.e);
  t.of(a.id).deliveries += 8; t.of(b.id).deliveries += 7;
  w.hours(1);
  assert.equal(view(w, a, "progression.coop-campaign").chapter, 1);
  assert.ok(shared(w.e).trophies.get(b.id)?.some(x => /Chapter 1/.test(x.text)));
  assert.equal(w.act(b, "progression.coop-campaign", "leave").ok, true);
});

test("weekly leaderboards rank players by gains this week and archive the winners", () => {
  const w = featureWorld(["progression.weekly-leaderboards"]);
  const a = trader(w), b = trader(w, "B");
  deliver(w, a);
  const boards = worldOf(w, "progression.weekly-leaderboards").boards;
  assert.equal(boards.deliveries[0].company, a.id);
  w.hours(168 - w.e.tick + 1);
  const last = worldOf(w, "progression.weekly-leaderboards").last;
  assert.equal(last.winners.deliveries[0].company, a.id);
  assert.ok(shared(w.e).trophies.get(a.id)?.length);
  assert.equal(worldOf(w, "progression.weekly-leaderboards").boards.deliveries[0].score, 0, "reset");
  void b;
});

test("seasonal ladder resets each round and pays by tier", () => {
  const w = featureWorld(["progression.seasonal-ladder"]);
  const a = trader(w), b = trader(w, "B");
  w.hours(1);
  tracker(w.e).award(a.id, 500);
  w.hours(1);
  assert.equal(view(w, a, "progression.seasonal-ladder").tier, "Diamond");
  assert.equal(view(w, b, "progression.seasonal-ladder").tier, "Bronze");
  const cash = a.cash;
  w.hours(LADDER_DAYS * 24 - w.e.tick);
  assert.ok(a.cash > cash, "reward paid");
  assert.equal(view(w, a, "progression.seasonal-ladder").score, 0);
});

test("seasons: countdown and final standings with trophies when the season ends", () => {
  const w = featureWorld(["progression.seasons"]);
  const a = trader(w);
  w.hours(1);
  assert.equal(worldOf(w, "progression.seasons").final, null);
  w.e.tick = w.e.seasonHours - 1;
  w.hours(1);
  const final = worldOf(w, "progression.seasons").final;
  assert.equal(final[0].company, a.id);
  assert.ok(shared(w.e).trophies.get(a.id)?.some(x => /Season finished/.test(x.text)));
});

test("tournaments: sign up ahead, score profit in the window, podium trophies", () => {
  const w = featureWorld(["progression.tournaments"]);
  const a = trader(w), b = trader(w, "B");
  w.hours(TOURNAMENT_HOURS + 1);
  assert.equal(w.act(a, "progression.tournaments", "enter").ok, true);
  assert.equal(w.act(a, "progression.tournaments", "enter").ok, false, "only once");
  assert.equal(w.act(b, "progression.tournaments", "enter").ok, true);
  w.hours(TOURNAMENT_EVERY - w.e.tick % TOURNAMENT_EVERY);
  assert.equal(worldOf(w, "progression.tournaments").live, true);
  assert.equal(worldOf(w, "progression.tournaments").entrants, 2);
  deliver(w, a);
  w.hours(TOURNAMENT_EVERY);
  const res = worldOf(w, "progression.tournaments").results;
  assert.equal(res[0].podium[0].company, a.id);
});

test("blitz: entry fee into a pot, paid to the most profit, refunded when alone", () => {
  const w = featureWorld(["progression.blitz"]);
  const a = trader(w);
  const cash = a.cash;
  assert.equal(w.act(a, "progression.blitz", "enter").ok, true);
  assert.equal(a.cash, cash - BLITZ_FEE);
  assert.equal(w.act(a, "progression.blitz", "enter").ok, false);
  w.hours(BLITZ_EVERY + BLITZ_HOURS - w.e.tick + 1);
  assert.equal(Math.round(a.cash), Math.round(cash), "refunded");
});

test("tech tree spends research points in order; bonuses apply only with the economy switch", () => {
  const w = featureWorld(["progression.tech-tree"]);
  const a = trader(w);
  w.hours(1);
  const t = tracker(w.e);
  assert.equal(w.act(a, "progression.tech-tree", "research", { node: "charts-1" }).ok, false, "no points");
  t.of(a.id).deliveries = 10;
  assert.equal(w.act(a, "progression.tech-tree", "research", { node: "engines-1" }).ok, false, "needs charts first");
  assert.equal(w.act(a, "progression.tech-tree", "research", { node: "charts-1" }).ok, true);
  assert.equal(w.act(a, "progression.tech-tree", "research", { node: "charts-1" }).ok, false);
  assert.equal(w.act(a, "progression.tech-tree", "research", { node: "engines-1" }).ok, true);
  assert.equal(view(w, a, "progression.tech-tree").points, 4);
  assert.equal(w.act(a, "progression.tech-tree", "research", { node: { id: "x" } }).ok, false);
  const ctx = { ship: a.ships[0], from: 0, dest: 1 };
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 100);
  w.apply({ type: "setFeatures", enabled: ["progression.tech-tree", "progression.tech-bonuses"] });
  assert.equal(Math.round(w.e.features.adjust("fuel", 100, ctx)), 97);
});

test("licences: base licences, unlicensed deliveries counted; fines only with the economy switch", () => {
  const run = (fines: boolean) => {
    const w = featureWorld(["progression.licences", "progression.tech-tree", ...(fines ? ["progression.licence-fines"] : [])]);
    const a = trader(w);
    deliver(w, a);
    return { w, a, trip: w.e.trips.get(a.id)!.find(t => t.good !== null)! };
  };
  const plain = run(false), fined = run(true), l = lane(plain.w.e);
  const unlicensed = !BASE_LICENCES.includes(`cargo:${l.g}`);
  assert.equal(view(plain.w, plain.a, "progression.licences").breaches, unlicensed ? 1 : 0);
  const fine = unlicensed ? Math.min(LICENCE_FINE_MAX, Math.round(plain.trip.earned * LICENCE_FINE_SHARE)) : 0;
  assert.ok(Math.abs(plain.a.cash - fined.a.cash - fine) < 1e-6);
});

test("remote islands: the far ports unlock at a captain level", () => {
  const w = featureWorld(["progression.remote-islands"]);
  const a = trader(w);
  const remote = remotePorts(w.e.dist);
  assert.ok(remote.length >= 1 && remote.length <= w.e.map.ports.length / 5 + 1);
  w.hours(1);
  assert.equal(view(w, a, "progression.remote-islands").unlocked, false);
  tracker(w.e).award(a.id, 50 * REMOTE_LEVEL * (REMOTE_LEVEL - 1));
  assert.equal(view(w, a, "progression.remote-islands").unlocked, true);
  assert.deepEqual(worldOf(w, "progression.remote-islands").ports, remote);
});

test("skill points: one per level, capped, and only change costs when on", () => {
  const w = featureWorld(["progression.skill-points"]);
  const a = trader(w);
  w.hours(1);
  assert.equal(w.act(a, "progression.skill-points", "spend", { skill: "fuel" }).ok, false, "level 1 has none");
  tracker(w.e).award(a.id, 50 * 7 * 6);   // level 7: six points
  for (let i = 0; i < 5; i++) assert.equal(w.act(a, "progression.skill-points", "spend", { skill: "fuel" }).ok, true);
  assert.equal(w.act(a, "progression.skill-points", "spend", { skill: "fuel" }).ok, false, "max 5");
  assert.equal(w.act(a, "progression.skill-points", "spend", { skill: "warp" }).ok, false);
  assert.equal(Math.round(w.e.features.adjust("fuel", 100, { ship: a.ships[0], from: 0, dest: 1 })), 95);
});

test("cargo and route mastery tiers cut fees and travel time", () => {
  const w = featureWorld(["progression.cargo-mastery", "progression.route-mastery"]);
  const a = trader(w);
  w.hours(1);
  const s = w.e.ships.get(a.ships[0])!, t = tracker(w.e);
  t.of(a.id).goodUnits[0] = 2500;
  s.good = 0; s.qty = 10;
  assert.equal(Math.round(w.e.features.adjust("portFee", 100, { ship: s.id, company: a.id, from: 0, dest: 1 })), 96);
  t.of(a.id).routes.set("0-1", 10);
  assert.equal(Math.round(w.e.features.adjust("travelHours", 100, { ship: s.id, from: 0, dest: 1 })), 96);
  assert.equal(Math.round(w.e.features.adjust("travelHours", 100, { ship: s.id, from: 1, dest: 0 })), 100);
});

test("veteran perks, heirlooms and the captain's legacy need levels", () => {
  const w = featureWorld(["progression.veteran-perks", "progression.heirlooms", "progression.legacy"]);
  const a = trader(w);
  w.hours(1);
  const ctx = { ship: a.ships[0], from: 0, dest: 1 };
  assert.equal(w.e.features.adjust("fuel", 100, ctx), 100);
  assert.equal(w.act(a, "progression.heirlooms", "equip", { item: "compass" }).ok, false);
  assert.equal(w.act(a, "progression.legacy", "retire").ok, false);
  tracker(w.e).award(a.id, 50 * 15 * 14);   // level 15
  assert.equal(w.act(a, "progression.heirlooms", "equip", { item: "compass" }).ok, true);
  assert.equal(w.act(a, "progression.heirlooms", "equip", { item: "chart" }).ok, false, "level 20 heirloom");
  assert.equal(w.act(a, "progression.legacy", "retire").ok, true);
  assert.equal(w.act(a, "progression.legacy", "retire").ok, false, "next at level 20");
  // veteran 3%, compass 3%, legacy 1%
  assert.equal(Math.round(w.e.features.adjust("fuel", 1000, ctx)), Math.round(1000 * 0.97 * 0.97 * 0.99));
});

test("prestige resets cash for a permanent hold bonus", () => {
  const w = featureWorld(["progression.prestige"]);
  const a = trader(w);
  assert.equal(w.act(a, "progression.prestige", "prestige").ok, false);
  a.cash = PRESTIGE_WORTH * 2;
  assert.equal(w.act(a, "progression.prestige", "prestige").ok, true);
  assert.equal(a.cash, rules.company.start_cash);
  assert.equal(w.e.features.adjust("capacity", 100, { ship: a.ships[0] }), 103);
});

test("daily login: once a day, with a growing streak", () => {
  const w = featureWorld(["progression.daily-login"]);
  const a = trader(w);
  const cash = a.cash;
  assert.equal(w.act(a, "progression.daily-login", "claim").ok, true);
  assert.equal(w.act(a, "progression.daily-login", "claim").ok, false);
  w.hours(24);
  assert.equal(w.act(a, "progression.daily-login", "claim").ok, true);
  assert.equal(a.cash, cash + LOGIN_BASE * 2 + LOGIN_STREAK_STEP);
  w.hours(72);
  assert.equal(w.act(a, "progression.daily-login", "claim").ok, true);
  assert.equal(view(w, a, "progression.daily-login").streak, 1, "streak broken");
});

test("offline progress repeats the last profitable run while away", () => {
  const w = featureWorld(["progression.offline-progress"]);
  const a = trader(w);
  deliver(w, a);
  const s = w.e.ships.get(a.ships[0])!;
  const trips = w.e.trips.get(a.id)!.length;
  assert.equal(w.act(a, "progression.offline-progress", "away").ok, true);
  w.hours(1);
  assert.ok(w.e.voyageQueues.has(s.id) || s.dest !== null, "the ship was sent on");
  w.hours(48);
  assert.ok(w.e.trips.get(a.id)!.length > trips);
  assert.equal(w.act(a, "progression.offline-progress", "back").ok, true);
});

test("run modes: chosen in the first day; hardcore runs end on bankruptcy; sandbox funds only when on", () => {
  const w = featureWorld(["progression.run-modes", "progression.captain-levels"]);
  const a = trader(w), b = trader(w, "B"), c = trader(w, "C");
  w.hours(1);
  assert.equal(w.act(a, "progression.run-modes", "choose", { mode: "hardcore" }).ok, true);
  assert.equal(w.act(a, "progression.run-modes", "choose", { mode: "standard" }).ok, false, "hardcore is final");
  assert.equal(w.act(b, "progression.run-modes", "choose", { mode: "sandbox" }).ok, true);
  assert.equal(w.act(c, "progression.run-modes", "choose", { mode: "god" }).ok, false);
  a.cash = -1;
  w.hours(1);
  assert.equal(view(w, a, "progression.run-modes").fallen, true);
  const xp = tracker(w.e).xp(a.id);
  tracker(w.e).award(a.id, 100);
  assert.equal(tracker(w.e).xp(a.id), xp, "a fallen run earns nothing");
  w.hours(24);
  assert.equal(w.act(c, "progression.run-modes", "choose", { mode: "ironman" }).ok, false, "too late");
  assert.ok(b.cash < SANDBOX_CASH);
  w.apply({ type: "setFeatures", enabled: ["progression.run-modes", "progression.sandbox-funds"] });
  w.hours(1);
  assert.equal(b.cash, SANDBOX_CASH);
});

test("New Game+ needs the tutorial and levels, and raises quest targets", () => {
  const w = featureWorld(["progression.new-game-plus", "progression.tutorial", "progression.daily-quests"]);
  const a = trader(w);
  w.hours(1);
  assert.equal(w.act(a, "progression.new-game-plus", "ascend").ok, false);
  const t = tracker(w.e);
  t.tutorialDone.add(a.id);
  t.award(a.id, 50 * 10 * 9);
  const before = view(w, a, "progression.daily-quests")[0].target;
  assert.equal(w.act(a, "progression.new-game-plus", "ascend").ok, true);
  assert.equal(w.act(a, "progression.new-game-plus", "ascend").ok, false, "next star needs level 20");
  w.hours(24);
  const q = view(w, a, "progression.daily-quests")[0];
  const base = loadContent().daily.find(x => x.id === q.id)!.target;
  assert.equal(q.target, Math.ceil(base * 1.5));
  void before;
});

test("world presets: themes, map files and settings warnings", () => {
  const w = featureWorld(["progression.world-presets"]);
  assert.equal(worldOf(w, "progression.world-presets").id, "classic");
  const e = new Engine({ ...rules, progression: { worldPreset: "futuristic" } }, map);
  e.applyLive({ type: "setFeatures", enabled: ["progression.world-presets"] });
  const p = e.features.world()["progression.world-presets"] as any;
  assert.equal(p.id, "futuristic");
  assert.equal(p.labels.Freighter, "Hauler");
  assert.deepEqual(presetMismatches({ pirates: { enabled: true } }, { pirates: { enabled: false } }), ["pirates.enabled should be false (is true)"]);
  for (const name of ["arctic", "mediterranean"]) {
    const m = JSON.parse(readFileSync(new URL(`../../config/maps/${name}.json`, import.meta.url), "utf8"));
    const eng = new Engine(rules, m);
    assert.ok(eng.dist[0].every(Number.isFinite), `${name}: every port reachable`);
    assert.equal(validateMap({ ...m, name }).ok, true, name);
    const prepared = prepareMap(m);
    assert.equal(prepared.navigationId, "legacy-v1");
    assert.equal(prepared.ports.length, m.ports.length);
  }
});

test("map sharing validates maps, limits them, and lets others rate and download", () => {
  const w = featureWorld(["progression.map-sharing"]);
  const a = trader(w), b = trader(w, "B");
  const m = JSON.parse(readFileSync(new URL("../../config/maps/arctic.json", import.meta.url), "utf8"));
  const good = { name: "Frost Run", ports: m.ports, routes: m.routes };
  assert.equal(w.act(a, "progression.map-sharing", "share", { map: { ...good, name: "<script>" } }).ok, false);
  assert.equal(w.act(a, "progression.map-sharing", "share", { map: { ...good, routes: [] } }).ok, false);
  assert.equal(w.act(a, "progression.map-sharing", "share", { map: "x" }).ok, false);
  const r = w.act(a, "progression.map-sharing", "share", { map: good }) as { ok: true; id: number };
  assert.equal(r.ok, true);
  for (let i = 1; i < MAPS_PER_COMPANY; i++) w.act(a, "progression.map-sharing", "share", { map: good });
  assert.equal(w.act(a, "progression.map-sharing", "share", { map: good }).ok, false, "limit");
  assert.equal(w.act(a, "progression.map-sharing", "rate", { map: r.id, stars: 5 }).ok, false, "own map");
  assert.equal(w.act(b, "progression.map-sharing", "rate", { map: r.id, stars: 9 }).ok, false);
  assert.equal(w.act(b, "progression.map-sharing", "rate", { map: r.id, stars: 4 }).ok, true);
  assert.equal(worldOf(w, "progression.map-sharing")[0].rating, 4);
  assert.equal(w.act(b, "progression.map-sharing", "pick", { map: r.id }).ok, true);
  assert.equal(view(w, b, "progression.map-sharing").picked.map.ports.length, m.ports.length);
  assert.equal(w.act(b, "progression.map-sharing", "remove", { map: r.id }).ok, false, "not yours");
  assert.equal(w.act(a, "progression.map-sharing", "remove", { map: r.id }).ok, true);
});

test("mods: data mods load from the mods folder", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "prog-"));
  const src = new URL("../../config/content/progression/", import.meta.url);
  for (const f of readdirSync(src).filter(f => f.endsWith(".json"))) copyFileSync(new URL(f, src), join(dir, f));
  mkdirSync(join(dir, "mods"));
  writeFileSync(join(dir, "mods", "extra.json"), JSON.stringify({ id: "extra", achievements: [
    { id: "mod-a", name: "Mod A", description: "x", kind: "achievement", stat: "voyages", atLeast: 1 },
    { id: "first-delivery", name: "Hijack", description: "x", kind: "achievement", stat: "voyages", atLeast: 0 },
    { id: "BAD ID", name: "x", description: "x", kind: "achievement", stat: "voyages", atLeast: 1 }] }));
  const c = loadContent(pathToFileURL(dir + "/"));
  assert.deepEqual(c.mods, ["extra"]);
  assert.ok(c.achievements.some(a => a.id === "mod-a"));
  assert.equal(c.achievements.find(a => a.id === "first-delivery")!.name, "First Delivery", "mods cannot replace");
  assert.ok(!c.achievements.some(a => a.id === "BAD ID"));
  const w = featureWorld(["progression.mods"]);
  assert.ok(worldOf(w, "progression.mods").counts.achievements >= 15);
});

test("all progression modules together replay to the same state", () => {
  assertReplays(ALL, w => {
    const a = w.company("A", lane(w.e).from), b = w.company("B", lane(w.e).from);
    w.act(a, "progression.run-modes", "choose", { mode: "ironman" });
    w.act(a, "progression.puzzles", "start", { puzzle: "train-consumer" });
    w.act(a, "progression.challenges", "start", { challenge: "no-automation" });
    w.act(b, "progression.tournaments", "enter");
    w.act(a, "progression.tournaments", "enter");
    w.act(a, "progression.blitz", "enter");
    w.act(a, "progression.daily-login", "claim");
    const crew = w.act(a, "progression.coop-campaign", "found") as { id?: number };
    w.act(b, "progression.coop-campaign", "join", { crew: crew.id });
    deliver(w, a);
    deliver(w, a);
    w.act(a, "progression.tech-tree", "research", { node: "licence-grain" });
    w.act(a, "progression.offline-progress", "away");
    w.hours(80);
    w.act(b, "progression.daily-login", "claim");
  });
});
