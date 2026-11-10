// Tests for the ui feature modules (ideas 146-160, 421-440, 481-500). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { STARTER_BONUS } from "../src/features/ui/tracking.ts";
import { CLIENT_SWITCHES } from "../src/features/ui/index.ts";
import { DEFAULT_LAYOUT, TUTORIAL_STEPS } from "../src/features/ui/guidance.ts";
import type { Company, Ship } from "../src/engine.ts";

type W = ReturnType<typeof featureWorld>;
const allUi = () => [...featureWorld().e.features.modules.values()].filter(m => m.id.startsWith("ui.")).map(m => m.id);
const ALL_UI = allUi();
const firstShip = (w: W, c: Company): Ship => w.e.ships.get(c.ships[0])!;
const view = <T>(w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as T;

/** Load the ship with the planner's best cargo and sail it; returns the destination. */
function firstDelivery(w: W, c: Company) {
  const s = firstShip(w, c);
  const routes = (view<{ routes: Record<number, { dest: number; good: string; qty: number }[]> }>(w, c, "ui.planner")).routes[s.id];
  assert.ok(routes?.length, "the planner found a profitable route");
  const r = routes[0];
  w.apply({ type: "sail", company: c.id, ship: s.id, dest: r.dest, buy: { good: r.good, qty: r.qty } } as never);
  for (let i = 0; i < 300 && s.dest !== null; i++) w.hours(1);
  assert.equal(s.dest, null, "arrived");
  w.apply({ type: "sell", company: c.id, ship: s.id } as never);
  return r.dest;
}

test("every ui idea has a module, and the switch file lists every module (economy off)", () => {
  const ideas = new Set<number>();
  const w = featureWorld();
  for (const m of w.e.features.modules.values()) if (m.id.startsWith("ui.")) m.ideas.forEach(i => ideas.add(i));
  const wanted = readFileSync(new URL("../../docs/features/assignments/ui.txt", import.meta.url), "utf8")
    .split("\n").map(l => /^(\d+)\./.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.equal(wanted.length, 55);
  for (const i of wanted) assert.ok(ideas.has(i), `idea ${i}`);
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/ui.json", import.meta.url), "utf8"));
  const listed = Object.keys(cfg).filter(k => !k.startsWith("_")).sort();
  assert.deepEqual(listed, [...ALL_UI].sort());
  for (const m of w.e.features.modules.values()) if (m.id.startsWith("ui.")) assert.equal(cfg[m.id], !m.economy, m.id);
  for (const id of ["ui.saved-routes", "ui.notifications", "ui.mobile", "ui.quick-sell", "ui.best-trade", "ui.starter-bonus-effects"])
    assert.equal(cfg[id], false, `${id} is off as the assignment says`);
});

test("route planner quotes profitable voyages with the server's own maths", () => {
  const w = featureWorld(["ui.planner"]);
  const c = w.company("A", 3), s = firstShip(w, c);
  const r = view<{ routes: Record<number, { profit: number; hours: number; fuelCost: number; perHour: number }[]> }>(w, c, "ui.planner").routes[s.id];
  assert.ok(r.length >= 1 && r.length <= 3);
  for (const x of r) { assert.ok(x.profit > 0 && x.hours > 0 && x.fuelCost >= 0); assert.equal(x.perHour, Math.round(x.profit / x.hours * 100) / 100); }
  assert.ok(r.every((x, i) => i === 0 || r[i - 1].perHour >= x.perHour), "sorted by profit per hour");
});

test("best trade picks the single top voyage", () => {
  const w = featureWorld(["ui.best-trade", "ui.planner"]);
  const c = w.company("A", 3), s = firstShip(w, c);
  const best = view<{ best: { perHour: number } }>(w, c, "ui.best-trade").best;
  assert.equal(best.perHour, view<{ routes: Record<number, { perHour: number }[]> }>(w, c, "ui.planner").routes[s.id][0].perHour);
});

test("saved routes validate, run on a docked ship and can be deleted", () => {
  const w = featureWorld(["ui.saved-routes"]);
  const c = w.company("A"), s = firstShip(w, c);
  const dest = w.reachable(s.port);
  assert.equal(w.act(c, "ui.saved-routes", "save", { from: s.port, dest: s.port, qty: 5 }).ok, false);
  assert.equal(w.act(c, "ui.saved-routes", "save", { from: s.port, dest, good: "gold", qty: 5 }).ok, false);
  assert.equal(w.act(c, "ui.saved-routes", "save", { from: s.port, dest, good: "grain", qty: -1 }).ok, false);
  const saved = w.act(c, "ui.saved-routes", "save", { from: s.port, dest, good: "grain", qty: 5 }) as { ok: true; id: number };
  assert.equal(saved.ok, true);
  assert.equal(w.act(c, "ui.saved-routes", "run", { id: saved.id, ship: 9999 }).ok, false);
  assert.equal(w.act(c, "ui.saved-routes", "run", { id: saved.id, ship: s.id }).ok, true);
  assert.equal(s.dest, dest);
  assert.equal(w.act(c, "ui.saved-routes", "delete", { id: saved.id }).ok, true);
  assert.equal(w.act(c, "ui.saved-routes", "delete", { id: saved.id }).ok, false);
});

test("repeat route sails the ship's last voyage again from the same port", () => {
  const w = featureWorld(["ui.repeat-route", "ui.planner"]);
  const c = w.company("A"), s = firstShip(w, c);
  const home = s.port;
  assert.equal(w.act(c, "ui.repeat-route", "repeat", { ship: s.id }).ok, false, "no earlier voyage");
  const dest = w.reachable(home);
  w.apply({ type: "sail", company: c.id, ship: s.id, dest } as never);
  for (let i = 0; i < 300 && s.dest !== null; i++) w.hours(1);
  w.apply({ type: "sail", company: c.id, ship: s.id, dest: home } as never);
  for (let i = 0; i < 300 && s.dest !== null; i++) w.hours(1);
  assert.deepEqual(view<Record<number, { dest: number }>>(w, c, "ui.repeat-route")[s.id].dest, dest);
  assert.equal(w.act(c, "ui.repeat-route", "repeat", { ship: s.id }).ok, true);
  assert.equal(s.dest, dest);
  assert.equal(w.act(c, "ui.repeat-route", "repeat", { ship: s.id }).ok, false, "at sea");
});

test("auto-trade repeats a round trip through the voyage queue", () => {
  const w = featureWorld(["ui.auto-trade"]);
  const c = w.company("A"), s = firstShip(w, c);
  const home = s.port, far = w.reachable(home);
  const legs = [{ dest: far, maxSpend: 5000, minProceeds: 0 }, { dest: home, maxSpend: 5000, minProceeds: 0 }];
  assert.equal(w.act(c, "ui.auto-trade", "start", { ship: s.id, legs: [legs[0], { dest: far, maxSpend: 1, minProceeds: 0 }], loops: 2 }).ok, false, "must end at home");
  assert.equal(w.act(c, "ui.auto-trade", "start", { ship: s.id, legs, loops: 99 }).ok, false);
  assert.equal(w.act(c, "ui.auto-trade", "start", { ship: s.id, legs: [{ dest: "x" }, legs[1]], loops: 2 }).ok, false);
  assert.equal(w.act(c, "ui.auto-trade", "start", { ship: s.id, legs, loops: 2 }).ok, true);
  let arrivals = 0, at = s.port;
  for (let i = 0; i < 400; i++) { w.hours(1); if (s.port !== at) { arrivals++; at = s.port; } }
  assert.equal(arrivals, 4, "two round trips, then it stops");
  assert.equal(w.act(c, "ui.auto-trade", "stop", { ship: s.id }).ok, false, "finished loops are cleared");
});

test("quick-sell sells every docked hold", () => {
  const w = featureWorld(["ui.quick-sell"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ui.quick-sell", "sellAll").ok, false, "nothing to sell");
  const s = firstShip(w, c);
  s.good = 0; s.qty = 5; s.cost = 10;
  const r = w.act(c, "ui.quick-sell", "sellAll") as { ok: boolean; sold: number };
  assert.equal(r.ok, true); assert.equal(r.sold, 1); assert.equal(s.qty, 0);
});

test("price alerts validate fields and go off when the price crosses", () => {
  const w = featureWorld(["ui.alerts"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ui.alerts", "add", { port: 0, good: "grain", side: "sideways", price: 3 }).ok, false);
  assert.equal(w.act(c, "ui.alerts", "add", { port: 999, good: "grain", side: "above", price: 3 }).ok, false);
  assert.equal(w.act(c, "ui.alerts", "add", { port: 0, good: "grain", side: "above", price: -1 }).ok, false);
  assert.equal(w.act(c, "ui.alerts", "add", { port: 0, good: "grain", side: "above", price: 0.01 }).ok, true);
  assert.equal(w.act(c, "ui.alerts", "add", { port: 0, good: "grain", side: "below", price: 0.01 }).ok, true);
  w.hours(1);
  const list = view<{ fired: number | null; side: string }[]>(w, c, "ui.alerts");
  assert.notEqual(list.find(a => a.side === "above")!.fired, null);
  assert.equal(list.find(a => a.side === "below")!.fired, null);
  assert.equal(w.act(c, "ui.alerts", "clearFired").ok, true);
  assert.equal(view<unknown[]>(w, c, "ui.alerts").length, 1);
});

test("notifications report a ship docking and can be marked read", () => {
  const w = featureWorld(["ui.notifications"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.apply({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) } as never);
  for (let i = 0; i < 300 && s.dest !== null; i++) w.hours(1);
  w.hours(1);
  const v = view<{ notices: { kind: string }[]; unread: number }>(w, c, "ui.notifications");
  assert.ok(v.notices.some(n => n.kind === "docked"));
  assert.ok(v.unread >= 1);
  assert.equal(w.act(c, "ui.notifications", "read").ok, true);
  assert.equal(view<{ unread: number }>(w, c, "ui.notifications").unread, 0);
});

test("the ledger records trips and upkeep", () => {
  const w = featureWorld(["ui.ledger", "ui.planner"]);
  const c = w.company("A", 3);
  firstDelivery(w, c);
  w.hours(2);
  const v = view<{ rows: { kind: string }[]; totals: { trips: number; net: number } }>(w, c, "ui.ledger");
  assert.ok(v.rows.some(r => r.kind === "trip"), JSON.stringify(v.rows));
  assert.ok(v.totals.trips > 0);
});

test("idle-ship warnings count hours spent empty in port", () => {
  const w = featureWorld(["ui.idle-ships"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.hours(5);
  assert.ok(view<Record<number, number>>(w, c, "ui.idle-ships")[s.id] >= 4);
  w.apply({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) } as never);
  w.hours(1);
  assert.equal(view<Record<number, number>>(w, c, "ui.idle-ships")[s.id], undefined);
});

test("the daily summary appears after a game day", () => {
  const w = featureWorld(["ui.daily-summary"]);
  const c = w.company("A");
  assert.equal(view(w, c, "ui.daily-summary"), null);
  w.hours(25);
  const d = view<{ day: number; cashEnd: number }>(w, c, "ui.daily-summary");
  assert.ok(d && d.day >= 1);
});

test("undo takes back alerts, watchlist and dashboard steps but never trades", () => {
  const w = featureWorld(["ui.undo", "ui.alerts", "ui.watchlist", "ui.dashboard"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ui.undo", "undo").ok, false, "nothing yet");
  w.act(c, "ui.alerts", "add", { port: 0, good: "fuel", side: "above", price: 50 });
  w.act(c, "ui.watchlist", "watch", { port: 1, good: "ore" });
  w.act(c, "ui.dashboard", "set", { widgets: ["cash"] });
  assert.equal(view<{ last: string }>(w, c, "ui.undo").last, "change dashboard");
  assert.equal(w.act(c, "ui.undo", "undo").ok, true);
  assert.deepEqual(view<{ widgets: string[] }>(w, c, "ui.dashboard").widgets, DEFAULT_LAYOUT);
  assert.equal(w.act(c, "ui.undo", "undo").ok, true);
  assert.equal(view<unknown[]>(w, c, "ui.watchlist").length, 0);
  assert.equal(w.act(c, "ui.undo", "undo").ok, true);
  assert.equal(view<unknown[]>(w, c, "ui.alerts").length, 0);
  const s = firstShip(w, c);
  w.apply({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) } as never);
  assert.equal(w.act(c, "ui.undo", "undo").ok, false, "sailing is not undoable");
});

test("starter pennant needs a profitable delivery; cash only with the economy switch", () => {
  const w = featureWorld(["ui.starter-bonus", "ui.planner"]);
  const a = w.company("A", 3), b = w.company("B", 29);
  assert.equal(w.act(a, "ui.starter-bonus", "claim").ok, false);
  firstDelivery(w, a);
  const cash = a.cash;
  assert.equal(w.act(a, "ui.starter-bonus", "claim").ok, true);
  assert.equal(a.cash, cash, "no money while the effects module is off");
  assert.equal(w.act(a, "ui.starter-bonus", "claim").ok, false, "once only");
  assert.deepEqual(w.e.features.world()["ui.starter-bonus"], { pennants: [a.id] });
  w.apply({ type: "setFeatures", enabled: ["ui.starter-bonus", "ui.starter-bonus-effects", "ui.planner"] });
  firstDelivery(w, b);
  const before = b.cash;
  assert.equal(w.act(b, "ui.starter-bonus", "claim").ok, true);
  assert.equal(b.cash, before + STARTER_BONUS);
});

test("the cargo manifest values every hold here and at the best port", () => {
  const w = featureWorld(["ui.cargo-manifest"]);
  const c = w.company("A"), s = firstShip(w, c);
  s.good = 0; s.qty = 10; s.cost = 30;
  const v = view<{ lines: { ship: number; good: string; valueHere: number; bestValue: number; fill: number }[]; totals: { tonnes: number } }>(w, c, "ui.cargo-manifest");
  const l = v.lines.find(x => x.ship === s.id)!;
  assert.equal(l.good, "grain");
  assert.ok(l.bestValue >= l.valueHere && l.fill > 0);
  assert.equal(v.totals.tonnes, 10);
});

test("the watchlist validates pairs and tracks a day of prices", () => {
  const w = featureWorld(["ui.watchlist"]);
  const c = w.company("A");
  assert.equal(w.act(c, "ui.watchlist", "watch", { port: -1, good: "ore" }).ok, false);
  assert.equal(w.act(c, "ui.watchlist", "watch", { port: 1, good: "spice" }).ok, false);
  assert.equal(w.act(c, "ui.watchlist", "watch", { port: 1, good: "ore" }).ok, true);
  assert.equal(w.act(c, "ui.watchlist", "watch", { port: 1, good: "ore" }).ok, false, "no duplicates");
  w.hours(30);
  const [x] = view<{ spark: number[]; dayAgo: number }[]>(w, c, "ui.watchlist");
  assert.equal(x.spark.length, 24);
  assert.ok(x.dayAgo > 0);
  assert.equal(w.act(c, "ui.watchlist", "unwatch", { port: 1, good: "ore" }).ok, true);
});

test("the dashboard keeps a validated widget layout", () => {
  const w = featureWorld(["ui.dashboard"]);
  const c = w.company("A");
  assert.deepEqual(view<{ widgets: string[] }>(w, c, "ui.dashboard").widgets, DEFAULT_LAYOUT);
  assert.equal(w.act(c, "ui.dashboard", "set", { widgets: ["cash", "nope"] }).ok, false);
  assert.equal(w.act(c, "ui.dashboard", "set", { widgets: ["cash", "cash"] }).ok, false);
  assert.equal(w.act(c, "ui.dashboard", "set", { widgets: "cash" }).ok, false);
  assert.equal(w.act(c, "ui.dashboard", "set", { widgets: ["ledger", "cash"] }).ok, true);
  assert.deepEqual(view<{ widgets: string[] }>(w, c, "ui.dashboard").widgets, ["ledger", "cash"]);
  assert.equal(w.act(c, "ui.dashboard", "reset").ok, true);
});

test("the tutorial follows real progress and guides the first delivery", () => {
  const w = featureWorld(["ui.tutorial", "ui.planner"]);
  const c = w.company("A", 3);
  const v0 = view<{ done: number; guide: { dest: number } | null }>(w, c, "ui.tutorial");
  assert.equal(v0.done, 0);
  assert.ok(v0.guide, "a concrete first voyage is suggested");
  assert.match(w.e.features.cards(c.id)["ui.tutorial"].cards[0].detail, /Try this/);
  firstDelivery(w, c);
  w.hours(1);
  assert.equal(view<{ done: number }>(w, c, "ui.tutorial").done, TUTORIAL_STEPS.length);
  assert.equal(w.e.features.cards(c.id)["ui.tutorial"], undefined);
  const d = w.company("D");
  assert.equal(w.act(d, "ui.tutorial", "skip").ok, true);
  assert.equal(w.act(d, "ui.tutorial", "skip").ok, false);
  assert.equal(w.act(d, "ui.tutorial", "fly").ok, false);
});

test("difficulty presets only choose how much help the screen gives", () => {
  const w = featureWorld(["ui.presets"]);
  const c = w.company("A");
  assert.equal(view<{ preset: string }>(w, c, "ui.presets").preset, "standard");
  assert.equal(w.act(c, "ui.presets", "set", { preset: "nightmare" }).ok, false);
  assert.equal(w.act(c, "ui.presets", "set", { preset: "toString" }).ok, false);
  const cash = c.cash;
  assert.equal(w.act(c, "ui.presets", "set", { preset: "expert" }).ok, true);
  assert.deepEqual(view<{ preset: string; hints: boolean }>(w, c, "ui.presets"), { preset: "expert", hints: false, planner: false, confirmations: false, tutorial: false, tooltips: "plain" });
  assert.equal(c.cash, cash);
});

test("hints start vague and get one step more specific", () => {
  const w = featureWorld(["ui.hints"]);
  const c = w.company("A");
  const [h] = view<{ key: string; level: number; more: boolean; text: string }[]>(w, c, "ui.hints");
  assert.equal(h.key, "idle"); assert.equal(h.level, 0);
  assert.equal(w.act(c, "ui.hints", "more", { key: "nope" }).ok, false);
  assert.equal(w.act(c, "ui.hints", "more", { key: "idle" }).ok, true);
  const [h2] = view<{ level: number; more: boolean; text: string }[]>(w, c, "ui.hints");
  assert.equal(h2.level, 1); assert.equal(h2.more, false); assert.notEqual(h2.text, h.text);
  assert.equal(w.act(c, "ui.hints", "more", { key: "idle" }).ok, false);
});

test("client-only switches publish a flag so public/features/ui.js can see them", () => {
  const ids = CLIENT_SWITCHES.map(f => f(featureWorld().e).id);
  const w = featureWorld(ids);
  const data = w.e.features.world();
  for (const id of ids) assert.equal(data[id], 1, id);
  const js = readFileSync(new URL("../public/features/ui.js", import.meta.url), "utf8");
  for (const id of ids) assert.ok(js.includes(`"${id}"`), `ui.js uses ${id}`);
  assert.equal(w.e.features.modules.get("ui.mobile")!.economy, true, "assignment marks mobile controls as economy");
});

test("every ui module together replays exactly", () => {
  assertReplays(ALL_UI, w => {
    const a = w.company("A"), b = w.company("B");
    const s = firstShip(w, a), t = firstShip(w, b);
    w.act(a, "ui.alerts", "add", { port: 0, good: "grain", side: "below", price: 100 });
    w.act(a, "ui.watchlist", "watch", { port: 0, good: "fuel" });
    w.act(b, "ui.dashboard", "set", { widgets: ["cash", "cargo"] });
    w.act(b, "ui.presets", "set", { preset: "guided" });
    w.act(a, "ui.hints", "more", { key: "idle" });
    const id = (w.act(a, "ui.saved-routes", "save", { from: s.port, dest: w.reachable(s.port), good: "grain", qty: 5 }) as { id: number }).id;
    w.act(a, "ui.saved-routes", "run", { id, ship: s.id });
    w.act(b, "ui.auto-trade", "start", { ship: t.id, legs: [{ dest: w.reachable(t.port), maxSpend: 3000, minProceeds: 0 }, { dest: t.port, maxSpend: 3000, minProceeds: 0 }], loops: 2 });
    w.act(a, "ui.undo", "undo");
    w.hours(60);
    w.act(a, "ui.quick-sell", "sellAll");
    w.act(a, "ui.repeat-route", "repeat", { ship: s.id });
    w.act(a, "ui.starter-bonus", "claim");
    w.act(a, "ui.notifications", "read");
    w.hours(60);
  });
});

test("every ui module gives views and cards without throwing", () => {
  const w = featureWorld(ALL_UI);
  const c = w.company("A");
  w.hours(30);
  const cards = w.e.features.cards(c.id);
  assert.ok(Object.keys(cards).length >= 2);
  const v = w.e.features.view(c.id);
  assert.ok(Object.keys(v).length >= 15);
  JSON.stringify(w.e.features.world());
});
