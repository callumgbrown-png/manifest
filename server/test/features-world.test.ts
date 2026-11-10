// Tests for the world feature modules (ideas 96-110, 241-260 and 321-340). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import type { Company, Ship } from "../src/engine.ts";
import type { Pt } from "../src/geo.ts";
import { regions, slotsBetween, calendar, quarterHours, portRegion, regionOf, headlines } from "../src/features/world/shared.ts";
import { weatherBetween, stormDelay, visibleWeather } from "../src/features/world/weather-model.ts";
import { currents, highways, icebergs, reefs } from "../src/features/world/sea-routes.ts";
import { ghosts, ghostWindow } from "../src/features/world/sightings.ts";
import { digSites, islands, wreckSites, DISCOVERY_BONUS } from "../src/features/world/exploration.ts";
import { emergeTick, newIsland, TSUNAMI_SPEC, tsunami, volcano } from "../src/features/world/disasters.ts";
import { CHART_PRICE, BEACON_PRICE, PING_PRICE, LICENCE_PRICE, MAX_BUOYS, BUOY_HOURS, FOG_COLS, ferryLanes } from "../src/features/world/navigation.ts";
import { RESCUE_SPEC, rescueSite, REGATTA_SPEC, regattaCourse, ENTRY_HOURS, harvestWindow, FAIR_SPEC, fairPort, QUARANTINE_SPEC, quarantine, ANNIVERSARY_HOURS } from "../src/features/world/events.ts";
import { SHORTAGE_SPEC, SHORTAGE_STOCK, WEDDING_SPEC, wedding, WEDDING_PREMIUM, WAR_SPEC, war, KRAKEN_SPEC, KRAKEN_PURSE, GOAL_TONNES, GOAL_BONUS, GOAL_PER_TONNE, saleWeek } from "../src/features/world/economy-events.ts";

const ALL_WORLD = Object.keys(JSON.parse(readFileSync(new URL("../../config/features/world.json", import.meta.url), "utf8"))).filter(k => k.startsWith("world."));
type W = ReturnType<typeof featureWorld>;
const firstShip = (w: W, c: Company): Ship => w.e.ships.get(c.ships[0])!;
const wd = (w: W, id: string) => w.e.features.world()[id] as any;
const vw = (w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as any;
/** Puts a ship at sea at (nearly) a map point, on whichever lane passes closest, so "alongside" checks can be tested. */
function parkAt(w: W, s: Ship, p: Pt) {
  let best = { d: Infinity, a: 0, b: 0, f: 0 };
  for (const r of w.e.map.routes) for (const [a, b] of [[r.a, r.b], [r.b, r.a]]) {
    const poly = w.e.piracy.geo.voyage(a, b);
    for (let f = 0; f <= 1; f += 0.002) { const q = w.e.piracy.geo.at(poly, f), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < best.d) best = { d, a, b, f }; }
  }
  s.port = best.a; s.dest = best.b; s.departTick = w.e.tick - Math.round(best.f * 1000); s.arriveTick = s.departTick + 1000;
}
const dock = (s: Ship, port: number) => { s.port = port; s.dest = null; };
const slotFrom = (spec: Parameters<typeof slotsBetween>[0], from = 0) => slotsBetween(spec, from, from + 5000)[0];

test("every world idea has a module, and the switch file matches", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("world."));
  const ideas = new Set(mods.flatMap(m => m.ideas));
  for (const i of [...Array(15).keys()].map(i => 96 + i).concat([...Array(20).keys()].map(i => 241 + i), [...Array(20).keys()].map(i => 321 + i))) assert.ok(ideas.has(i), `idea ${i}`);
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/world.json", import.meta.url), "utf8"));
  assert.deepEqual(mods.map(m => m.id).sort(), Object.keys(cfg).filter(k => k !== "_comment").sort());
  for (const m of mods) assert.equal(cfg[m.id], !m.economy, m.id);
  // Assignment ON ideas whose money/time effect is split off.
  for (const id of ["world.storm-closures", "world.currents-effects", "world.disaster-effects", "world.quarantine-effects"]) assert.equal(cfg[id], false);
});

test("sea chart names six regions and shows who owns ships at sea", () => {
  const w = featureWorld(["world.chart", "world.map-tools"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(wd(w, "world.chart").regions.length, 6);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) }).ok, true);
  assert.equal(wd(w, "world.chart").owners[c.id], "A");
  assert.equal(wd(w, "world.map-tools").scale, w.e.piracy.geo.scale);
});

test("weather forecasts storms ahead, hurricanes a day ahead, and tracks the season", () => {
  const w = featureWorld(["world.weather"]);
  const storms = weatherBetween(w.e, 0, 2000).filter(x => x.kind !== "fog");
  assert.ok(storms.length > 5);
  for (const s of storms) assert.equal(s.starts - s.warnFrom, s.kind === "hurricane" ? 24 : 12);
  const s = storms[2];
  w.e.tick = s.warnFrom - 1;
  assert.ok(!visibleWeather(w.e).some(x => x.id === s.id));
  w.e.tick = s.warnFrom;
  assert.ok(wd(w, "world.weather").weather.some((x: { id: string }) => x.id === s.id));
  w.e.tick = quarterHours(w.e) * 3;
  assert.equal(wd(w, "world.weather").seasonName, "winter");
  assert.match(w.e.features.cards(0)["world.weather"].cards[0].detail, /winter/);
});

test("storm closures add the hours a voyage spends in a storm, only when switched on", () => {
  const w = featureWorld([]);
  let found: { a: number; b: number; t: number; d: number } | undefined;
  for (const st of weatherBetween(w.e, 0, 1000).filter(x => x.kind !== "fog")) {
    for (const r of w.e.map.routes) { const d = stormDelay(w.e, r.a, r.b, st.starts, 10); if (d > 0) { found = { a: r.a, b: r.b, t: st.starts, d }; break; } }
    if (found) break;
  }
  assert.ok(found);
  w.e.tick = found.t;
  const ctx = { ship: 0, from: found.a, dest: found.b };
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 10);
  w.apply({ type: "setFeatures", enabled: ["world.storm-closures"] });
  assert.equal(w.e.features.adjust("travelHours", 10, ctx), 10 + found.d);
});

test("currents are charted (on) and change sailing time only with the effects module", () => {
  const w = featureWorld(["world.currents"]);
  assert.deepEqual(wd(w, "world.currents").currents, currents(w.e));
  const c = currents(w.e).find(x => { const p = w.e.piracy.geo.lanePath(x.a, x.b); return p.length === 2; })!;
  assert.ok(c);
  assert.equal(w.e.features.adjust("travelHours", 100, { ship: 0, from: c.a, dest: c.b }), 100);
  w.apply({ type: "setFeatures", enabled: ["world.currents", "world.currents-effects"] });
  assert.equal(w.e.features.adjust("travelHours", 100, { ship: 0, from: c.a, dest: c.b }), 90);
  assert.equal(w.e.features.adjust("travelHours", 100, { ship: 0, from: c.b, dest: c.a }), 110);
});

test("icebergs only bite in winter", () => {
  const w = featureWorld(["world.icebergs"]);
  const pairs = w.e.map.routes.map(r => ({ ship: 0, from: r.a, dest: r.b }));
  assert.ok(pairs.every(p => w.e.features.adjust("travelHours", 10, p) === 10), "no ice in spring");
  w.e.tick = quarterHours(w.e) * 3 + 1;
  assert.equal(icebergs(w.e).active, true);
  assert.ok(pairs.every(p => [10, 12].includes(w.e.features.adjust("travelHours", 10, p))));
});

test("reefs and highways change voyage hours", () => {
  const w = featureWorld(["world.reefs"]);
  assert.equal(reefs(w.e).length, 4);
  const sums = w.e.map.routes.map(r => w.e.features.adjust("travelHours", 10, { ship: 0, from: r.a, dest: r.b }) - 10);
  assert.ok(sums.some(x => x > 0) && sums.every(x => x >= 0 && x <= 4));
  const h = featureWorld(["world.highways"]);
  const hw = highways(h.e)[0];
  assert.equal(highways(h.e).length, 6);
  assert.ok(h.e.features.adjust("travelHours", 100, { ship: 0, from: hw.a, dest: hw.b }) < 100);
});

test("the news ticker collects headlines from switched-on modules only", () => {
  const w = featureWorld(["world.news"]);
  w.hours(60);
  assert.equal(wd(w, "world.news").headlines.length, 0);
  w.apply({ type: "setFeatures", enabled: ["world.news", "world.regatta", "world.weather"] });
  w.hours(Math.max(0, slotFrom(REGATTA_SPEC).starts - ENTRY_HOURS - w.e.tick));
  const h = wd(w, "world.news").headlines as { text: string; tick: number }[];
  assert.ok(h.some(x => /Regatta/.test(x.text)), JSON.stringify(h));
  assert.ok(h.every(x => x.tick <= w.e.tick));
  assert.match(w.e.features.cards(0)["world.news"].cards[0].detail, /•/);
});

test("sea legends: monster sightings and the Halloween ghost fleet's lanterns", () => {
  const w = featureWorld(["world.sightings"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) }).ok, true);
  const rnd = w.e.features.random;
  w.e.features.random = () => 0;
  w.hours(1);
  w.e.features.random = rnd;
  assert.equal(vw(w, c, "world.sightings").sightings, 1);
  assert.equal(wd(w, "world.sightings").ghosts.length, 0);
  const win = ghostWindow(w.e);
  w.e.tick = win.starts;
  parkAt(w, s, ghosts(w.e, win.starts + 1)[0]);
  w.hours(1);
  assert.equal(wd(w, "world.sightings").ghosts.length, 5);
  assert.ok(vw(w, c, "world.sightings").lanterns >= 1);
});

test("exploration: dive on wrecks, follow treasure maps, sight uncharted islands", () => {
  const w = featureWorld(["world.exploration"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "world.exploration", "explore", { ship: s.id, wreck: 0 }).ok, false, "docked, not alongside");
  parkAt(w, s, wreckSites(w.e)[0]);
  assert.equal(w.act(c, "world.exploration", "explore", { ship: s.id, wreck: 9 }).ok, false);
  const rnd = w.e.features.random;
  w.e.features.random = () => 0;     // always a map
  assert.equal(w.act(c, "world.exploration", "explore", { ship: s.id, wreck: 0 }).ok, true);
  w.e.features.random = rnd;
  assert.equal(w.act(c, "world.exploration", "explore", { ship: s.id, wreck: 0 }).ok, false, "searched already");
  const v = vw(w, c, "world.exploration");
  assert.equal(v.relics.length, 1);
  assert.equal(v.maps[0].map, 0);
  const far = digSites(w.e)[0];
  assert.equal(w.act(c, "world.exploration", "dig", { ship: s.id, map: 1 }).ok, false, "no such map");
  parkAt(w, s, far);
  assert.equal(w.act(c, "world.exploration", "dig", { ship: s.id, map: 0 }).ok, true);
  assert.equal(vw(w, c, "world.exploration").trophies.length, 1);
  assert.equal(wd(w, "world.exploration").islands.length, 0, "islands hidden until sighted");
  parkAt(w, s, islands(w.e)[0]);
  w.hours(1);
  const isl = wd(w, "world.exploration").islands;
  assert.ok(isl.length >= 1 && isl[0].by === "A");
});

test("first-discovery bounty pays once per island (economy)", () => {
  const w = featureWorld(["world.discovery-bonus"]);
  const a = w.company("A"), b = w.company("B"), sa = firstShip(w, a), sb = firstShip(w, b);
  parkAt(w, sa, islands(w.e)[1]);
  const before = a.cash;
  w.hours(1);
  assert.ok(a.cash >= before + DISCOVERY_BONUS);
  const after = b.cash;
  parkAt(w, sb, islands(w.e)[1]);
  w.hours(1);
  assert.equal(vw(w, a, "world.discovery-bonus").bounties >= 1, true);
  assert.ok(b.cash <= after, "second finder gets nothing for the same island");
});

test("volcano erupts and grows; a new island rises and is named by the first ship alongside", () => {
  const w = featureWorld(["world.disasters"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(volcano(w.e, 0).eruptions, 0);
  assert.ok(volcano(w.e, 1300).eruptions >= 2);
  assert.equal(wd(w, "world.disasters").island, null);
  w.e.tick = emergeTick(w.e);
  parkAt(w, s, newIsland(w.e));
  assert.equal(w.act(c, "world.disasters", "name", { ship: s.id, name: 42 }).ok, false);
  assert.equal(w.act(c, "world.disasters", "name", { ship: s.id, name: "Stupid Rock" }).ok, false, "blocked word");
  assert.equal(w.act(c, "world.disasters", "name", { ship: s.id, name: "Fireheart" }).ok, true);
  assert.equal(w.act(c, "world.disasters", "name", { ship: s.id, name: "Other" }).ok, false);
  assert.equal(wd(w, "world.disasters").island.name, "Fireheart");
});

test("tsunamis hold departures from the swept region (economy)", () => {
  const w = featureWorld(["world.disaster-effects"]);
  const slot = slotFrom(TSUNAMI_SPEC);
  w.e.tick = slot.starts;
  const t = tsunami(w.e)!;
  const port = w.e.map.ports.find(p => portRegion(w.e, p.id) === t.region && w.e.dist[p.id].some((d, j) => j !== p.id && Number.isFinite(d)));
  assert.ok(port);
  const dest = w.reachable(port.id);
  assert.ok(w.e.features.adjust("travelHours", 10, { ship: 0, from: port.id, dest }) >= 13);
});

test("waypoints are validated and saved per company", () => {
  const w = featureWorld(["world.waypoints"]);
  const c = w.company("A");
  assert.equal(w.act(c, "world.waypoints", "set", { points: [{ x: 10, y: 10 }, { x: 200, y: 300 }] }).ok, true);
  assert.equal(vw(w, c, "world.waypoints").points.length, 2);
  assert.equal(w.act(c, "world.waypoints", "set", { points: [{ x: -1, y: 10 }] }).ok, false);
  assert.equal(w.act(c, "world.waypoints", "set", { points: [{ x: "1", y: 10 }] }).ok, false);
  assert.equal(w.act(c, "world.waypoints", "set", { points: Array(9).fill({ x: 1, y: 1 }) }).ok, false);
  assert.equal(w.act(c, "world.waypoints", "set", { points: "no" }).ok, false);
  assert.equal(w.act(c, "world.waypoints", "clear").ok, true);
  assert.equal(vw(w, c, "world.waypoints").points.length, 0);
});

test("fog of war lifts around your ships; sea charts lift a whole region (economy)", () => {
  const w = featureWorld(["world.fog-of-war", "world.sea-charts"]);
  const c = w.company("A"), s = firstShip(w, c);
  const seen = () => (vw(w, c, "world.fog-of-war").seen as string[]).join("").split("").filter(x => x === "1").length;
  const start = seen();
  assert.ok(start >= 1 && start <= 9);
  w.hours(1);
  parkAt(w, s, wreckSites(w.e)[3]);
  w.hours(1);
  const sailed = seen();
  assert.ok(sailed >= start);
  const cash = c.cash;
  assert.equal(w.act(c, "world.sea-charts", "buy", { region: 7 }).ok, false);
  assert.equal(w.act(c, "world.sea-charts", "buy", { region: 4 }).ok, true);
  assert.equal(c.cash, cash - CHART_PRICE);
  assert.equal(w.act(c, "world.sea-charts", "buy", { region: 4 }).ok, false);
  assert.ok(seen() >= sailed + FOG_COLS);
});

test("buoys: three at a time, labelled from the list, gone after three days", () => {
  const w = featureWorld(["world.buoys"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "world.buoys", "drop", { ship: s.id, label: 99 }).ok, false);
  for (let i = 0; i < MAX_BUOYS; i++) assert.equal(w.act(c, "world.buoys", "drop", { ship: s.id, label: i }).ok, true);
  assert.equal(w.act(c, "world.buoys", "drop", { ship: s.id, label: 0 }).ok, false);
  const b = wd(w, "world.buoys").buoys;
  assert.equal(b.length, MAX_BUOYS);
  assert.equal(b[0].by, "A");
  const other = w.company("B");
  assert.equal(w.act(other, "world.buoys", "remove", { buoy: b[0].id }).ok, false);
  assert.equal(w.act(c, "world.buoys", "remove", { buoy: b[0].id }).ok, true);
  w.hours(BUOY_HOURS);
  assert.equal(wd(w, "world.buoys").buoys.length, 0);
});

test("beacons cost money and speed night arrivals (economy)", () => {
  const w = featureWorld(["world.beacons"]);
  const c = w.company("A"), s = firstShip(w, c);
  const cash = c.cash;
  assert.equal(w.act(c, "world.beacons", "build", { ship: s.id }).ok, true);
  assert.equal(c.cash, cash - BEACON_PRICE);
  assert.equal(w.act(c, "world.beacons", "build", { ship: s.id }).ok, false);
  const from = w.reachable(s.port);
  let night = 0; while (!calendar(w.e, night + 5).night) night++;
  w.e.tick = night;
  assert.equal(w.e.features.adjust("travelHours", 5, { ship: s.id, from, dest: s.port }), 4);
  let day = 0; while (calendar(w.e, day + 5).night) day++;
  w.e.tick = day;
  assert.equal(w.e.features.adjust("travelHours", 5, { ship: s.id, from, dest: s.port }), 5);
});

test("a radar ping lists nearby vessels for a fee (economy)", () => {
  const w = featureWorld(["world.radar-ping"]);
  const a = w.company("A"), b = w.company("B"), sa = firstShip(w, a), sb = firstShip(w, b);
  parkAt(w, sb, wreckSites(w.e)[2]);
  parkAt(w, sa, wreckSites(w.e)[2]);
  const cash = a.cash;
  assert.equal(w.act(a, "world.radar-ping", "ping", { ship: sb.id }).ok, false, "not your ship");
  assert.equal(w.act(a, "world.radar-ping", "ping", { ship: sa.id }).ok, true);
  assert.equal(a.cash, cash - PING_PRICE);
  assert.ok(vw(w, a, "world.radar-ping").contacts.some((x: { ship: number }) => x.ship === sb.id));
  w.hours(6);
  assert.equal(vw(w, a, "world.radar-ping"), null);
});

test("ferries speed short island hops for a fee (economy)", () => {
  const w = featureWorld(["world.ferries"]);
  const f = ferryLanes(w.e)[0];
  assert.ok(f);
  assert.equal(w.e.features.adjust("travelHours", 8, { ship: 0, from: f.a, dest: f.b }), 6);
  assert.equal(w.e.features.adjust("portFee", 10, { ship: 0, company: 0, from: f.a, dest: f.b }), 50);
});

test("fast-travel licences: bought per lane, 20% quicker for the holder (economy)", () => {
  const w = featureWorld(["world.licences"]);
  const c = w.company("A"), s = firstShip(w, c), o = w.company("B");
  const r = w.e.map.routes[0];
  assert.equal(w.act(c, "world.licences", "buy", { route: -1 }).ok, false);
  const cash = c.cash;
  assert.equal(w.act(c, "world.licences", "buy", { route: 0 }).ok, true);
  assert.equal(c.cash, cash - LICENCE_PRICE);
  assert.equal(w.act(c, "world.licences", "buy", { route: 0 }).ok, false);
  assert.equal(w.e.features.adjust("travelHours", 10, { ship: s.id, from: r.b, dest: r.a }), 8);
  assert.equal(w.e.features.adjust("travelHours", 10, { ship: firstShip(w, o).id, from: r.b, dest: r.a }), 10);
  w.act(c, "world.licences", "buy", { route: 1 }); w.act(c, "world.licences", "buy", { route: 2 });
  assert.equal(w.act(c, "world.licences", "buy", { route: 3 }).ok, false, "three at most");
});

test("distress beacons are answered by other captains; stricken crews are rescued", () => {
  const w = featureWorld(["world.rescue"]);
  const a = w.company("A"), b = w.company("B"), sa = firstShip(w, a), sb = firstShip(w, b);
  assert.equal(w.act(a, "world.rescue", "distress", { ship: sa.id }).ok, false, "docked");
  parkAt(w, sa, wreckSites(w.e)[1]);
  assert.equal(w.act(a, "world.rescue", "distress", { ship: sa.id }).ok, true);
  assert.equal(w.act(a, "world.rescue", "distress", { ship: sa.id }).ok, false);
  assert.equal(wd(w, "world.rescue").beacons.length, 1);
  assert.equal(w.act(b, "world.rescue", "answer", { ship: sb.id, beacon: sa.id }).ok, false, "too far");
  parkAt(w, sb, wreckSites(w.e)[1]);
  assert.equal(w.act(a, "world.rescue", "answer", { ship: sa.id, beacon: sa.id }).ok, false, "own beacon");
  assert.equal(w.act(b, "world.rescue", "answer", { ship: sb.id, beacon: sa.id }).ok, true);
  assert.equal(vw(w, b, "world.rescue").medals, 1);
  const slot = slotFrom(RESCUE_SPEC);
  w.e.tick = slot.starts;
  parkAt(w, sb, rescueSite(w.e, slot.index));
  assert.equal(wd(w, "world.rescue").stricken.length, 1);
  assert.equal(w.act(b, "world.rescue", "rescue", { ship: sb.id }).ok, true);
  assert.equal(w.act(b, "world.rescue", "rescue", { ship: sb.id }).ok, false);
  assert.equal(vw(w, b, "world.rescue").medals, 2);
});

test("regatta: enter at the start port, sail to the finish, win gold", () => {
  const w = featureWorld(["world.regatta"]);
  const c = w.company("A"), s = firstShip(w, c);
  const slot = slotFrom(REGATTA_SPEC), k = regattaCourse(w.e, slot.index);
  w.e.tick = slot.starts - ENTRY_HOURS + 1;
  assert.equal(w.act(c, "world.regatta", "enter", { ship: s.id }).ok, false, "not at the start");
  dock(s, k.from);
  assert.equal(w.act(c, "world.regatta", "enter", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "world.regatta", "enter", { ship: s.id }).ok, false, "one entry");
  w.hours(slot.starts - w.e.tick);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: k.to }).ok, true);
  for (let i = 0; i < 100 && s.dest !== null; i++) w.hours(1);
  w.hours(1);
  assert.ok(w.e.tick < slot.ends, "finished inside the race window");
  assert.deepEqual(vw(w, c, "world.regatta").trophies, [1, 0, 0]);
  assert.equal(wd(w, "world.regatta").race.finish[0].by, "A");
});

test("festivals: harvest ribbon, trade fair best in show, weekly anniversary badge", () => {
  const w = featureWorld(["world.festivals"]);
  const c = w.company("A"), s = firstShip(w, c);
  const h = harvestWindow(w.e), hungry = w.e.map.ports.find(p => p.consumes.includes("grain"))!;
  w.e.tick = h.starts;
  dock(s, hungry.id);
  assert.equal(w.act(c, "world.festivals", "harvest", { ship: s.id }).ok, false, "no grain");
  s.good = 0; s.qty = 10;
  assert.equal(w.act(c, "world.festivals", "harvest", { ship: s.id }).ok, true);
  assert.equal(w.act(c, "world.festivals", "harvest", { ship: s.id }).ok, false);
  const fair = slotFrom(FAIR_SPEC);
  w.e.tick = fair.starts;
  dock(s, fairPort(w.e, fair.index));
  assert.equal(w.act(c, "world.festivals", "exhibit", { ship: s.id }).ok, true);
  w.hours(fair.ends - w.e.tick + 1);
  const v = vw(w, c, "world.festivals");
  assert.equal(v.ribbons, 2);
  assert.equal(v.bestInShow, 1);
  const w2 = featureWorld(["world.festivals"]);
  const c2 = w2.company("B");
  w2.hours(ANNIVERSARY_HOURS + 1);
  assert.equal(vw(w2, c2, "world.festivals").anniversaries, 1);
});

test("quarantine flags ships that dock at the port; inspection delay only with effects on", () => {
  const w = featureWorld(["world.quarantine"]);
  const c = w.company("A"), s = firstShip(w, c);
  const slot = slotFrom(QUARANTINE_SPEC);
  w.e.tick = slot.starts;
  const q = quarantine(w.e)!;
  dock(s, q.port);
  w.hours(1);
  assert.ok(wd(w, "world.quarantine").flagged.includes(s.id));
  const from = w.reachable(q.port);
  assert.equal(w.e.features.adjust("travelHours", 2, { ship: s.id, from, dest: q.port }), 2);
  w.apply({ type: "setFeatures", enabled: ["world.quarantine", "world.quarantine-effects"] });
  assert.equal(w.e.features.adjust("travelHours", 2, { ship: s.id, from, dest: q.port }), 6);
});

test("market events move fuel stocks and taxes (economy)", () => {
  const w = featureWorld(["world.market-events"]);
  const slot = slotFrom(SHORTAGE_SPEC, 1);
  w.e.tick = slot.starts - 1;
  w.e.advance(); // advance() would also run the economy; compare one port's fuel against a twin world
  const twin = featureWorld([]);
  twin.e.tick = slot.starts - 1; twin.e.advance();
  assert.ok(Math.abs(w.e.stock[0][1] - twin.e.stock[0][1] * SHORTAGE_STOCK) < 1e-6 * Math.max(1, twin.e.stock[0][1]) + 1);
  assert.ok(w.e.features.adjust("tradeTax", 0.05, { port: 0, good: 1, side: "buy" }) >= 0.2 - 1e-9);
  w.e.tick = saleWeek(w.e).starts;
  assert.equal(w.e.features.adjust("tradeTax", 0.05, { port: 0, good: 2, side: "buy" }), 0);
});

test("royal wedding pays a premium for the ordered good (economy)", () => {
  const w = featureWorld(["world.mega-orders"]);
  const c = w.company("A"), s = firstShip(w, c);
  const slot = slotFrom(WEDDING_SPEC);
  w.e.tick = slot.starts;
  const order = wedding(w.e)!;
  dock(s, order.port); s.good = order.good; s.qty = 50; s.cost = 0;
  const value = w.e.sellValue(order.port, order.good, 50), cash = c.cash;
  assert.equal(w.act(c, "world.mega-orders", "wedding", { ship: s.id }).ok, true);
  assert.equal(c.cash, cash + Math.round(value * WEDDING_PREMIUM));
  assert.equal(s.qty, 0);
  assert.equal(wd(w, "world.mega-orders").wedding.left, 250);
  assert.equal(w.act(c, "world.mega-orders", "gift", { ship: s.id, qty: 5 }).ok, false);
});

test("wars raise fees and delay voyages between the warring regions (economy)", () => {
  const w = featureWorld(["world.conflicts"]);
  const slot = slotFrom(WAR_SPEC);
  w.e.tick = slot.starts;
  const wr = war(w.e)!;
  const pa = w.e.map.ports.find(p => regionOf(w.e, p) === wr.a), pb = w.e.map.ports.find(p => regionOf(w.e, p) === wr.b);
  assert.notEqual(wr.a, wr.b);
  assert.ok(pa && pb);
  const fee = w.e.features.adjust("portFee", 100, { ship: 0, company: 0, from: pa.id, dest: pb.id });
  assert.ok(fee === 150 || fee === 300);
  assert.equal(w.e.features.adjust("travelHours", 10, { ship: 0, from: pa.id, dest: pb.id }), 13);
});

test("the kraken: fight alongside, share the purse when it sinks (economy)", () => {
  const w = featureWorld(["world.kraken"]);
  const c = w.company("A"), s = firstShip(w, c);
  const slot = slotFrom(KRAKEN_SPEC);
  w.e.tick = slot.starts;
  const k = wd(w, "world.kraken");
  assert.equal(w.act(c, "world.kraken", "fight", { ship: s.id }).ok, false, "not alongside");
  parkAt(w, s, k);
  const cash = c.cash;
  for (let i = 0; i < 30 && wd(w, "world.kraken").hp > 0; i++) {
    assert.equal(w.act(c, "world.kraken", "fight", { ship: s.id }).ok, true);
    assert.equal(w.act(c, "world.kraken", "fight", { ship: s.id }).ok, false, "reloading");
    w.e.tick++;
    parkAt(w, s, k);
  }
  assert.equal(wd(w, "world.kraken").hp, 0);
  assert.equal(c.cash, cash + KRAKEN_PURSE);
});

test("shared goals: contributions count and the bonus pays when the goal is met (economy)", () => {
  const w = featureWorld(["world.coop-goals"]);
  const c = w.company("A"), s = firstShip(w, c);
  const good = 0; // week 0 is grain
  assert.equal(w.act(c, "world.coop-goals", "contribute", { ship: s.id, qty: 10 }).ok, false, "empty hold");
  s.good = good; s.qty = GOAL_TONNES; s.cost = 0;
  assert.equal(w.act(c, "world.coop-goals", "contribute", { ship: s.id, qty: 0 }).ok, false);
  assert.equal(w.act(c, "world.coop-goals", "contribute", { ship: s.id, qty: 100 }).ok, true);
  assert.equal(wd(w, "world.coop-goals").tonnes, 100);
  const cash = c.cash, value = w.e.sellValue(s.port, good, GOAL_TONNES - 100);
  assert.equal(w.act(c, "world.coop-goals", "contribute", { ship: s.id, qty: GOAL_TONNES - 100 }).ok, true);
  assert.equal(c.cash, cash + Math.round(value) + GOAL_BONUS + GOAL_PER_TONNE * GOAL_TONNES);
  assert.equal(wd(w, "world.coop-goals").done, true);
});

test("headlines from every world module are well formed", () => {
  const w = featureWorld(ALL_WORLD);
  w.company("A");
  w.hours(400);
  for (const h of headlines(w.e)) { assert.equal(typeof h.text, "string"); assert.ok(Number.isInteger(h.tick)); }
  for (const id of ALL_WORLD) assert.doesNotThrow(() => w.e.features.cards(0));
  assert.equal(regions(w.e).length, 6);
});

test("every world module together replays to the same state", () => {
  assertReplays(ALL_WORLD, w => {
    const a = w.company("A"), b = w.company("B");
    const sa = firstShip(w, a), sb = firstShip(w, b);
    w.act(a, "world.waypoints", "set", { points: [{ x: 20, y: 30 }] });
    w.act(a, "world.buoys", "drop", { ship: sa.id, label: 1 });
    w.act(b, "world.sea-charts", "buy", { region: 2 });
    w.act(b, "world.licences", "buy", { route: 0 });
    w.act(a, "world.beacons", "build", { ship: sa.id });
    w.run({ type: "sail", company: a.id, ship: sa.id, dest: w.reachable(sa.port) });
    w.hours(3);
    w.act(a, "world.rescue", "distress", { ship: sa.id });
    w.act(a, "world.radar-ping", "ping", { ship: sa.id });
    w.run({ type: "sail", company: b.id, ship: sb.id, dest: w.reachable(sb.port) });
    w.hours(250);
  });
});
