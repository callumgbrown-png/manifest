// Tests for the platform feature modules (ideas 196-200 and 551-600). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { GOODS, type Company, type Ship } from "../src/engine.ts";
import { checkInvariants } from "../src/features/platform/integrity.ts";
import { isBlocked } from "../src/features/platform/moderation.ts";
import { newbieZone } from "../src/features/platform/protection.ts";
import { cleanText, flagsOf, gini } from "../src/features/platform/shared.ts";
import { balanceReport, healthScore, idleHours } from "../src/features/platform/analytics.ts";
import { adminData, selfTest, stateDigest, variantOf } from "../src/features/platform/ops.ts";
import { classify, PERSONAS } from "../src/features/platform/personas.ts";
import { DRAGON_FRIEND, EXOTIC_REFIT_HOURS, spaceport } from "../src/features/platform/wonders.ts";

const ALL = Object.keys(JSON.parse(readFileSync(new URL("../../config/features/platform.json", import.meta.url), "utf8"))).filter(k => !k.startsWith("_"));
type W = ReturnType<typeof featureWorld>;
const ship = (w: W, c: Company): Ship => w.e.ships.get(c.ships[0])!;
const view = <T>(w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as T;
const worldData = <T>(w: W, id: string) => w.e.features.world()[id] as T;
const admin = <T>(w: W, id: string) => (w.e.features.modules.get(id) as unknown as { admin(): T }).admin();
/** Sails a company's first ship one hop with cargo and waits until it docks. */
function arriveWithCargo(w: W, c: Company, qty = 30) {
  const s = ship(w, c), dest = w.reachable(s.port);
  const g = GOODS.findIndex((_, i) => w.e.stock[s.port][i] >= qty);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest, buy: { good: GOODS[g], qty } }).ok, true);
  w.hours(s.arriveTick - w.e.tick);
  assert.equal(s.dest, null);
  return { s, dest, g };
}

test("every platform idea 196-200 and 551-600 has a module, and the switch file matches", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("platform."));
  const ideas = new Set(mods.flatMap(m => m.ideas));
  for (let i = 196; i <= 200; i++) assert.ok(ideas.has(i), `idea ${i}`);
  for (let i = 551; i <= 600; i++) assert.ok(ideas.has(i), `idea ${i}`);
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/platform.json", import.meta.url), "utf8"));
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL].sort());
  for (const m of mods) assert.equal(cfg[m.id], !m.economy, m.id);
  for (const id of ["platform.newbie-zones", "platform.catch-up", "platform.wealth-limits", "platform.exotic-craft-effects", "platform.player-contracts"])
    assert.equal(w.e.features.modules.get(id)!.economy, true, id);
});

test("audit: invariants hold in a normal world and a broken one is caught", () => {
  const w = featureWorld(["platform.audit"]);
  const c = w.company("A");
  arriveWithCargo(w, c);
  assert.deepEqual(checkInvariants(w.e), []);
  assert.equal(worldData<{ violations24h: number }>(w, "platform.audit").violations24h, 0);
  ship(w, c).qty = -5;
  assert.ok(checkInvariants(w.e).some(v => v.kind === "cargo"));
  w.hours(1);
  assert.equal(worldData<{ violations24h: number }>(w, "platform.audit").violations24h, 1);
});

test("anomaly alerts flag a cash jump, and fair play keeps the company off the leaderboard; brackets by age", () => {
  const w = featureWorld(["platform.anomaly", "platform.fair-play"]);
  const a = w.company("Honest"), b = w.company("Lucky");
  w.hours(1);
  b.cash += 1_000_000;
  w.hours(1);
  assert.ok(flagsOf(w.e, b.id).some(f => f.reason === "cash-jump"));
  const fp = worldData<{ leaderboard: { id: number }[]; excluded: number; brackets: Record<string, number> }>(w, "platform.fair-play");
  assert.ok(fp.leaderboard.some(r => r.id === a.id));
  assert.ok(!fp.leaderboard.some(r => r.id === b.id));
  assert.equal(fp.excluded, 1);
  assert.equal(view<{ bracket: string }>(w, a, "platform.fair-play").bracket, "rookie");
});

test("multi-account check flags two companies trading off-market three times in a week", () => {
  const w = featureWorld(["platform.multi-account"]);
  const a = w.company("Main"), b = w.company("Alt");
  for (let round = 0; round < 3; round++) {
    const { s, g } = arriveWithCargo(w, a, 20);
    const band = w.e.rules.commodities[GOODS[g]], market = w.e.price(s.port, g);
    const price = Math.max(band.floor, Math.round(market * 0.4 * 100) / 100);
    assert.ok(Math.abs(price - market) / market > 0.3, "test needs an off-market price");
    const order = w.run({ type: "placeSell", company: a.id, ship: s.id, qty: s.qty, price });
    assert.equal(order.ok, true, JSON.stringify(order));
    w.hours(1);
    const bs = ship(w, b);
    bs.port = s.port; bs.qty = 0; bs.good = null;
    assert.equal(w.run({ type: "buyFromOrder", company: b.id, ship: bs.id, order: (order as { id: number }).id, qty: 20 }).ok, true);
    w.hours(1);
    bs.qty = 0; bs.good = null;   // pass the cargo on so the next round starts empty
    if (round < 2) assert.ok(!flagsOf(w.e, a.id).some(f => f.reason === "linked-trading"));
  }
  assert.ok(flagsOf(w.e, a.id).some(f => f.reason === "linked-trading"));
  assert.ok(flagsOf(w.e, b.id).some(f => f.reason === "linked-trading"));
});

test("activity watch counts a company's actions per hour and flags bursts", () => {
  const w = featureWorld(["platform.activity-watch"]);
  const c = w.company("A");
  w.hours(1);
  const s = ship(w, c);
  w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) });
  w.hours(1);
  assert.equal(view<{ actionsLastHour: number }>(w, c, "platform.activity-watch").actionsLastHour, 1);
  c.cash += 1_000_000;
  const port = c.home, good = w.e.map.ports[port].consumes[0] ?? GOODS[0];
  const band = w.e.rules.commodities[good];
  for (let i = 0; i < 16; i++) w.run({ type: "placeOrder", company: c.id, port, good, qty: 1, price: band.floor + i * 0.01 });
  w.hours(1);
  const n = view<{ actionsLastHour: number }>(w, c, "platform.activity-watch").actionsLastHour;
  assert.equal(flagsOf(w.e, c.id).some(f => f.reason === "action-burst"), n > 15);
});

test("bug reports validate input, filter text and are limited to 3 a day", () => {
  const w = featureWorld(["platform.bug-report"]);
  const c = w.company("A");
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "lasers" }).ok, false);
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "prices", text: 42 }).ok, false);
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "prices", text: "price went weird, mail me at me@example.com you idiot" }).ok, true);
  const r = admin<{ reports: { text: string; snapshot: { ships: unknown[] } }[] }>(w, "platform.bug-report").reports[0];
  assert.ok(!r.text.includes("@") && !r.text.includes("idiot"));
  assert.equal(r.snapshot.ships.length, 1);
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "map" }).ok, true);
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "map" }).ok, true);
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "map" }).ok, false);
  w.hours(24);
  assert.equal(w.act(c, "platform.bug-report", "report", { kind: "map" }).ok, true);
  assert.equal(cleanText("call +44 7700 900123 or visit www.x.com"), "call [removed]or visit [removed]");
});

test("three player reports cost reputation; an appeal lifts it after three quiet days", () => {
  const w = featureWorld(["platform.reports"]);
  const target = w.company("Target"), r1 = w.company("R1"), r2 = w.company("R2"), r3 = w.company("R3");
  assert.equal(w.act(r1, "platform.reports", "report", { target: target.id, reason: "cheating" }).ok, false, "new companies wait a day");
  w.hours(25);   // companies are first seen at the first hour
  assert.equal(w.act(r1, "platform.reports", "report", { target: r1.id, reason: "cheating" }).ok, false);
  assert.equal(w.act(r1, "platform.reports", "report", { target: target.id, reason: "bribery" }).ok, false);
  for (const r of [r1, r2, r3]) assert.equal(w.act(r, "platform.reports", "report", { target: target.id, reason: "cheating" }).ok, true);
  assert.equal(w.act(r1, "platform.reports", "report", { target: target.id, reason: "cheating" }).ok, false, "no repeats");
  assert.equal(view<{ reputation: number }>(w, target, "platform.reports").reputation, 90);
  assert.ok(flagsOf(w.e, target.id).some(f => f.reason === "player-reports"));
  assert.equal(w.act(target, "platform.reports", "appeal", { text: "short" }).ok, false);
  assert.equal(w.act(target, "platform.reports", "appeal", { text: "We trade fairly, please check our logs." }).ok, true);
  assert.equal(w.act(target, "platform.reports", "appeal", { text: "We trade fairly, please check our logs." }).ok, false);
  w.hours(72);
  const v = view<{ reputation: number; appeal: string }>(w, target, "platform.reports");
  assert.equal(v.appeal, "lifted");
  assert.equal(v.reputation, 100);
});

test("mute and block lists, used by other modules", () => {
  const w = featureWorld(["platform.chat-safety"]);
  const a = w.company("A"), b = w.company("B");
  assert.equal(w.act(a, "platform.chat-safety", "block", { target: a.id }).ok, false);
  assert.equal(w.act(a, "platform.chat-safety", "block", { target: "B" }).ok, false);
  assert.equal(w.act(a, "platform.chat-safety", "mute", { target: b.id }).ok, true);
  assert.equal(w.act(a, "platform.chat-safety", "block", { target: b.id }).ok, true);
  assert.equal(isBlocked(w.e, a.id, b.id), true);
  assert.equal(isBlocked(w.e, b.id, a.id), false);
  assert.equal(w.act(a, "platform.chat-safety", "unblock", { target: b.id }).ok, true);
  assert.equal(w.act(a, "platform.chat-safety", "unblock", { target: b.id }).ok, false);
  assert.deepEqual(view(w, a, "platform.chat-safety"), { muted: [b.id], blocked: [] });
});

test("newbie zones (economy) waive fees and cut fuel inside the zone for 72 hours", () => {
  const w = featureWorld(["platform.newbie-zones"]);
  const c = w.company("A"), s = ship(w, c);
  const zone = newbieZone(w.e, c.id), inside = zone.find(p => p !== c.home)!;
  assert.ok(zone.includes(c.home));
  assert.equal(w.e.features.adjust("portFee", 50, { ship: s.id, company: c.id, from: c.home, dest: inside }), 0);
  assert.equal(w.e.features.adjust("fuel", 100, { ship: s.id, from: c.home, dest: inside }), 75);
  const outside = w.e.map.ports.map(p => p.id).find(p => !zone.includes(p));
  if (outside !== undefined) assert.equal(w.e.features.adjust("portFee", 50, { ship: s.id, company: c.id, from: c.home, dest: outside }), 50);
  w.hours(73);
  assert.equal(w.e.features.adjust("portFee", 50, { ship: s.id, company: c.id, from: c.home, dest: inside }), 50);
});

test("beginner raid protection covers new and small companies", () => {
  const w = featureWorld(["platform.pirate-shield"]);
  const c = w.company("A");
  w.hours(1);
  const map = (w.e.piracy as unknown as { cargoRaidProtection: Map<number, number> }).cargoRaidProtection;
  assert.ok((map.get(c.ships[0]) ?? 0) > w.e.tick);
  assert.equal(view<{ protected: boolean }>(w, c, "platform.pirate-shield").protected, true);
  c.cash += 1_000_000;
  w.hours(80);
  assert.equal(view<{ protected: boolean }>(w, c, "platform.pirate-shield").protected, false);
});

test("catch-up and wealth limits (economy) adjust upkeep by standing", () => {
  const w = featureWorld(["platform.catch-up", "platform.wealth-limits"]);
  const poor = w.company("Poor"), mid1 = w.company("Mid1"), mid2 = w.company("Mid2"), rich = w.company("Rich");
  poor.cash = 100; rich.cash += 1_000_000;
  w.hours(1);
  assert.equal(view<{ active: boolean }>(w, poor, "platform.catch-up").active, true);
  assert.equal(w.e.features.adjust("upkeep", 100, { company: mid1.id }), 100);
  assert.ok(view<{ surcharge: number }>(w, rich, "platform.wealth-limits").surcharge > 0);
  assert.ok(view<{ surcharge: number }>(w, rich, "platform.wealth-limits").surcharge <= 5000);
  assert.equal(view<{ surcharge: number }>(w, mid2, "platform.wealth-limits").surcharge, 0);
  assert.equal(w.e.features.adjust("upkeep", 100, { company: poor.id }), 50);
});

test("economy health score, Gini tracker and balance report", () => {
  assert.equal(gini([1, 1, 1, 1]), 0);
  assert.ok(gini([0, 0, 0, 100]) > 0.7);
  assert.equal(healthScore({ gini: 0, inDebtShare: 0, atBand: 0, activeShare: 1 }), 100);
  assert.equal(healthScore({ gini: 1, inDebtShare: 1, atBand: 1, activeShare: 0 }), 0);
  const w = featureWorld(["platform.economy-health"]);
  w.company("A"); const b = w.company("B");
  b.cash += 200_000;
  w.hours(3);
  const h = worldData<{ score: number; gini: number; trend: number[] }>(w, "platform.economy-health");
  assert.ok(h.score >= 0 && h.score <= 100 && h.gini > 0.3);
  assert.equal(h.trend.length, 4);
  const lines = admin<{ report: string[] }>(w, "platform.economy-health").report;
  assert.match(lines[0], /^Health \d+\/100/);
  assert.deepEqual(balanceReport([]), ["no samples yet"]);
});

test("churn: idle hours grow, and a returning player gets a welcome-back summary", () => {
  const w = featureWorld(["platform.churn"]);
  const c = w.company("A");
  w.hours(13);
  assert.equal(idleHours(w.e, c.id), 12, "first seen at the first hour");
  assert.notEqual(view<{ welcomeBack: unknown }>(w, c, "platform.churn").welcomeBack, null);
  const s = ship(w, c);
  w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) });
  w.hours(1);
  assert.equal(view<{ welcomeBack: unknown }>(w, c, "platform.churn").welcomeBack, null);
  w.hours(60);
  assert.equal(admin<{ high: { id: number; risk: string }[] }>(w, "platform.churn").high.find(x => x.id === c.id)?.risk, "high");
});

test("route heatmap and telemetry count voyages without naming anyone", () => {
  const w = featureWorld(["platform.route-heatmap", "platform.telemetry"]);
  const c = w.company("Secret Name Ltd"), s = ship(w, c), from = s.port, dest = w.reachable(from);
  w.hours(1);
  w.run({ type: "sail", company: c.id, ship: s.id, dest });
  w.hours(1);
  assert.deepEqual(worldData<{ routes: unknown[] }>(w, "platform.route-heatmap").routes, [{ a: Math.min(from, dest), b: Math.max(from, dest), n: 1 }]);
  const t = worldData<{ last24h: { voyages: number } }>(w, "platform.telemetry");
  assert.equal(t.last24h.voyages, 1);
  assert.ok(!JSON.stringify(admin(w, "platform.telemetry")).includes("Secret"));
});

test("hourly AI-readable reports", () => {
  const w = featureWorld(["platform.bot-reports"]);
  w.company("A");
  w.hours(2);
  const a = admin<{ latest: { format: string; summary: string; tick: number }; reports: unknown[] }>(w, "platform.bot-reports");
  assert.equal(a.latest.format, "manifest-bot-report/1");
  assert.equal(a.latest.tick, 2);
  assert.match(a.latest.summary, /^Day 1, hour 2/);
  assert.equal(a.reports.length, 2);
});

test("A/B experiments give stable variants; feature flags are listed", () => {
  const x = { id: "t", variants: ["a", "b"], share: 100 };
  assert.equal(variantOf(x, 5), variantOf(x, 5));
  assert.equal(variantOf({ ...x, share: 0 }, 5), null);
  const seen = new Set(Array.from({ length: 50 }, (_, i) => variantOf(x, i + 1)));
  assert.deepEqual([...seen].sort(), ["a", "b"]);
  const w = featureWorld(["platform.experiments"]);
  const c = w.company("A");
  const v = view<{ variants: Record<string, string | null> }>(w, c, "platform.experiments").variants;
  assert.ok("advice-panel-order" in v);
  assert.deepEqual(worldData<{ flags: string[] }>(w, "platform.experiments").flags, ["platform.experiments"]);
  assert.ok(admin<{ experiments: { results: unknown[] }[] }>(w, "platform.experiments").experiments.length >= 1);
});

test("checkpoints: identical worlds have identical digests, and a change shows", () => {
  const make = () => { const w = featureWorld(["platform.checkpoints"]); w.company("A"); w.hours(5); return w; };
  const a = make(), b = make();
  assert.equal(stateDigest(a.e), stateDigest(b.e));
  assert.deepEqual(worldData(a, "platform.checkpoints"), worldData(b, "platform.checkpoints"));
  [...b.e.companies.values()][0].cash += 1;
  assert.notEqual(stateDigest(a.e), stateDigest(b.e));
  assert.equal(admin<{ checkpoints: unknown[] }>(a, "platform.checkpoints").checkpoints.length, 6);
});

test("self-test replays a fixed scenario twice and finds no problems", () => {
  const w = featureWorld(["platform.self-test"]);
  assert.deepEqual(selfTest(w.e.rules, w.e.map, 10), []);
  assert.deepEqual(worldData(w, "platform.self-test"), { tick: 0, passed: true });
});

test("admin console gathers admin data only from switched-on modules; debug overlay numbers", () => {
  const w = featureWorld(["platform.admin-console", "platform.audit", "platform.debug-overlay"]);
  w.company("A");
  const d = adminData(w.e);
  assert.deepEqual(Object.keys(d).sort(), ["platform.admin-console", "platform.audit"]);
  assert.equal((d["platform.admin-console"] as { featuresOn: number }).featuresOn, 3);
  assert.equal(worldData<{ ships: number }>(w, "platform.debug-overlay").ships, 1);
});

test("personas: policies play without errors and live players are sorted into a style", () => {
  assert.deepEqual(PERSONAS.map(p => p.idea).sort(), [572, 573, 574, 575, 576]);
  assert.equal(classify({ voyages: 2, ports: new Set([1]), orders: 0, raids: 3, activeHours: 2, hours: 10, profitPerVoyage: 0 }, 20).style, "pirate");
  assert.equal(classify({ voyages: 10, ports: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), orders: 0, raids: 0, activeHours: 2, hours: 10, profitPerVoyage: 0 }, 20).style, "explorer");
  assert.equal(classify({ voyages: 0, ports: new Set(), orders: 0, raids: 0, activeHours: 0, hours: 40, profitPerVoyage: 0 }, 20).style, "casual");
  const w = featureWorld(["platform.personas"]);
  const players = PERSONAS.map((p, i) => ({ p, c: w.company(`P${i}`, i), mem: new Map<string, number>() }));
  for (let h = 0; h < 30; h++) {
    for (const { p, c, mem } of players) if (h % p.every === 0) p.act(w.e, c.id, cmd => w.e.applyLive(cmd), mem);
    w.hours(1);
  }
  for (const { c } of players) assert.ok(PERSONAS.some(p => p.id === view<{ style: string }>(w, c, "platform.personas").style));
  const total = Object.values(worldData<{ styles: Record<string, number> }>(w, "platform.personas").styles).reduce((a, b) => a + b, 0);
  assert.equal(total, players.length);
});

test("exotic refits: submarines dodge cargo raids, airship speed only with the effects module", () => {
  const w = featureWorld(["platform.exotic-craft"]);
  const c = w.company("A"), s = ship(w, c);
  assert.equal(w.act(c, "platform.exotic-craft", "refit", { ship: s.id, kind: "spaceship" }).ok, false);
  assert.equal(w.act(c, "platform.exotic-craft", "refit", { ship: 9999, kind: "submarine" }).ok, false);
  assert.equal(w.act(c, "platform.exotic-craft", "refit", { ship: s.id, kind: "submarine" }).ok, true);
  w.hours(EXOTIC_REFIT_HOURS);
  assert.deepEqual(worldData(w, "platform.exotic-craft"), { [s.id]: "submarine" });
  w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) });
  w.hours(1);
  const map = (w.e.piracy as unknown as { cargoRaidProtection: Map<number, number> }).cargoRaidProtection;
  assert.ok((map.get(s.id) ?? 0) > w.e.tick);
  w.hours(s.arriveTick - w.e.tick);
  s.port = c.home;
  assert.equal(w.act(c, "platform.exotic-craft", "refit", { ship: s.id, kind: "airship" }).ok, true);
  w.hours(EXOTIC_REFIT_HOURS);
  const ctx = { ship: s.id, from: 0, dest: 1 };
  assert.equal(w.e.features.adjust("travelHours", 20, ctx), 20);
  w.apply({ type: "setFeatures", enabled: ["platform.exotic-craft", "platform.exotic-craft-effects"] });
  assert.equal(w.e.features.adjust("travelHours", 20, ctx), 15);
  assert.equal(w.e.features.adjust("fuel", 10, ctx), 14);
  assert.equal(w.act(c, "platform.exotic-craft", "restore", { ship: s.id }).ok, true);
  assert.equal(w.e.features.adjust("travelHours", 20, ctx), 20);
});

test("space shipping counts normal sales at the spaceport toward a rocket", () => {
  const w = featureWorld(["platform.space-shipping"]);
  const c = w.company("A"), s = ship(w, c);
  const sp = worldData<{ spaceport: number; good: string; need: number }>(w, "platform.space-shipping");
  assert.equal(sp.spaceport, spaceport(w.e));
  s.port = sp.spaceport; s.good = GOODS.indexOf(sp.good as never); s.qty = 50; s.cost = 0;
  w.hours(1);
  const cash = c.cash;
  assert.equal(w.run({ type: "sell", company: c.id, ship: s.id }).ok, true);
  assert.ok(c.cash > cash, "the sale itself is unchanged");
  w.hours(1);
  assert.equal(view<{ contributed: number }>(w, c, "platform.space-shipping").contributed, 50);
  assert.equal(worldData<{ loaded: number }>(w, "platform.space-shipping").loaded, 50);
});

test("mysterious places: floating city stamps, ghost lanterns and the underwater port", () => {
  const w = featureWorld(["platform.mystery-places", "platform.exotic-craft"]);
  const c = w.company("A"), s = ship(w, c);
  const city = worldData<{ city: number }>(w, "platform.mystery-places").city;
  s.port = city;
  assert.equal(w.act(c, "platform.mystery-places", "city", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "platform.mystery-places", "city", { ship: s.id }).ok, false, "one stamp per stop");
  let ghost: { port: number } | null = null;
  for (let h = 0; h < 600 && !ghost; h++) { w.hours(1); ghost = worldData<{ ghost: { port: number } | null }>(w, "platform.mystery-places").ghost; }
  assert.ok(ghost, "a ghost port appears within 600 hours");
  s.port = ghost!.port;
  assert.equal(w.act(c, "platform.mystery-places", "ghost", { ship: s.id }).ok, true);
  assert.equal(view<{ lanterns: number }>(w, c, "platform.mystery-places").lanterns, 1);
  assert.equal(w.act(c, "platform.mystery-places", "dive", { ship: s.id }).ok, false, "only submarines dive");
  s.port = c.home;
  w.act(c, "platform.mystery-places", "noop");
  assert.equal(w.act(c, "platform.exotic-craft", "refit", { ship: s.id, kind: "submarine" }).ok, true);
  w.hours(EXOTIC_REFIT_HOURS);
  let found = false;
  for (let p = 0; p < w.e.n && !found; p++) { s.port = p; found = w.act(c, "platform.mystery-places", "dive", { ship: s.id }).ok; }
  assert.ok(found);
  assert.equal(typeof view<{ underwater: number }>(w, c, "platform.mystery-places").underwater, "number");
});

test("time rifts open, can be stepped through once, and give an era relic", () => {
  const w = featureWorld(["platform.time-rifts"]);
  const c = w.company("A"), s = ship(w, c);
  let rift: { port: number; era: string } | null = null;
  for (let h = 0; h < 200 && !rift; h++) { w.hours(1); rift = worldData(w, "platform.time-rifts"); }
  assert.ok(rift);
  s.port = (rift!.port + 1) % w.e.n;
  assert.equal(w.act(c, "platform.time-rifts", "step", { ship: s.id }).ok, false);
  s.port = rift!.port;
  assert.equal(w.act(c, "platform.time-rifts", "step", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "platform.time-rifts", "step", { ship: s.id }).ok, false);
  assert.deepEqual(view<{ relics: string[] }>(w, c, "platform.time-rifts").relics, [rift!.era]);
});

test("the dragon appears only in fantasy mode and can be befriended once per stop", () => {
  const w = featureWorld(["platform.dragon"]);
  const c = w.company("A"), s = ship(w, c);
  assert.deepEqual(view(w, c, "platform.dragon"), { on: false });
  assert.equal(w.act(c, "platform.dragon", "befriend", { ship: s.id }).ok, false);
  assert.equal(w.act(c, "platform.dragon", "fantasy", { on: "yes" }).ok, false);
  assert.equal(w.act(c, "platform.dragon", "fantasy", { on: true }).ok, true);
  for (let i = 0; i < DRAGON_FRIEND; i++) {
    s.port = view<{ port: number }>(w, c, "platform.dragon").port;
    assert.equal(w.act(c, "platform.dragon", "befriend", { ship: s.id }).ok, true);
    assert.equal(w.act(c, "platform.dragon", "befriend", { ship: s.id }).ok, false);
    w.hours(12);
  }
  assert.equal(view<{ rider: boolean }>(w, c, "platform.dragon").rider, true);
});

test("cooperative fleet battles: players commit docked ships and share the victory", () => {
  const w = featureWorld(["platform.fleet-battles"]);
  const cs = ["A", "B", "C", "D"].map(n => w.company(n));
  for (const c of cs) for (let i = 0; i < 2; i++) { c.cash += 100_000; w.run({ type: "buyShip", company: c.id, port: c.home, shipType: "freighter" }); }
  let armada: { port: number } | null = null;
  for (let h = 0; h < 100 && !armada; h++) { w.hours(1); armada = worldData<{ armada: { port: number } | null }>(w, "platform.fleet-battles").armada; }
  assert.ok(armada);
  const first = ship(w, cs[0]);
  first.port = (armada!.port + 1) % w.e.n;
  assert.equal(w.act(cs[0], "platform.fleet-battles", "commit", { ship: first.id }).ok, false, "must be at the battle");
  for (const c of cs) for (const id of c.ships) {
    const s = w.e.ships.get(id)!; s.port = armada!.port;
    assert.equal(w.act(c, "platform.fleet-battles", "commit", { ship: id }).ok, true);
  }
  assert.equal(w.act(cs[0], "platform.fleet-battles", "commit", { ship: first.id }).ok, false, "no double commit");
  w.hours(6);
  assert.equal(worldData<{ armada: unknown }>(w, "platform.fleet-battles").armada, null);
  assert.ok(cs.every(c => view<{ honours: number }>(w, c, "platform.fleet-battles").honours === 1));
});

test("player contracts (economy): escrow, accept, deliver, expiry refund and blocks", () => {
  const w = featureWorld(["platform.player-contracts", "platform.chat-safety"]);
  const a = w.company("Poster"), b = w.company("Hauler"), x = w.company("Blocked");
  const good = GOODS[0], band = w.e.rules.commodities[good], port = a.home;
  const reward = Math.ceil(20 * band.floor) + 100;
  assert.equal(w.act(a, "platform.player-contracts", "post", { port, good, qty: 20, reward: 1, hours: 24 }).ok, false, "reward too low");
  assert.equal(w.act(a, "platform.player-contracts", "post", { port: -1, good, qty: 20, reward, hours: 24 }).ok, false);
  assert.equal(w.act(a, "platform.player-contracts", "post", { port, good: "gold", qty: 20, reward, hours: 24 }).ok, false);
  const cashBefore = a.cash;
  const r = w.act(a, "platform.player-contracts", "post", { port, good, qty: 20, reward, hours: 24 });
  assert.equal(r.ok, true);
  const id = (r as { id: number }).id;
  assert.equal(a.cash, cashBefore - reward);
  w.act(a, "platform.chat-safety", "block", { target: x.id });
  assert.equal(w.act(x, "platform.player-contracts", "accept", { contract: id }).ok, false);
  assert.equal(w.act(a, "platform.player-contracts", "accept", { contract: id }).ok, false);
  assert.equal(w.act(b, "platform.player-contracts", "accept", { contract: id }).ok, true);
  const s = ship(w, b);
  s.port = port;
  assert.equal(w.act(b, "platform.player-contracts", "deliver", { contract: id, ship: s.id }).ok, false, "no cargo yet");
  s.good = 0; s.qty = 25;
  const bCash = b.cash, stock = w.e.stock[port][0];
  assert.equal(w.act(b, "platform.player-contracts", "deliver", { contract: id, ship: s.id }).ok, true);
  assert.equal(b.cash, bCash + reward);
  assert.equal(s.qty, 5);
  assert.equal(w.e.stock[port][0], stock + 20);
  const r2 = w.act(a, "platform.player-contracts", "post", { port, good, qty: 20, reward, hours: 12 });
  const before = a.cash;
  w.hours(12);
  assert.equal(a.cash, before + reward, "expired contract refunded");
  assert.equal(w.act(b, "platform.player-contracts", "accept", { contract: (r2 as { id: number }).id }).ok, false);
});

test("the whole platform category replays exactly with every module on", () => {
  assertReplays(ALL, w => {
    const a = w.company("A"), b = w.company("B");
    w.hours(25);
    w.act(a, "platform.bug-report", "report", { kind: "ships", text: "stuck" });
    w.act(b, "platform.reports", "report", { target: a.id, reason: "other" });
    w.act(a, "platform.chat-safety", "mute", { target: b.id });
    w.act(a, "platform.dragon", "fantasy", { on: true });
    const s = w.e.ships.get(a.ships[0])!;
    w.act(a, "platform.exotic-craft", "refit", { ship: s.id, kind: "airship" });
    w.hours(13);
    w.run({ type: "sail", company: a.id, ship: s.id, dest: w.reachable(s.port) });
    w.act(b, "platform.player-contracts", "post", { port: b.home, good: GOODS[0], qty: 10, reward: Math.ceil(10 * w.e.rules.commodities[GOODS[0]].floor) + 10, hours: 48 });
    w.hours(60);
  });
});
