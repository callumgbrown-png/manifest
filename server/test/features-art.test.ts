// Tests for the art feature modules (ideas 161-172 and 441-480). See docs/FEATURES.md and docs/features/reports/art.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { DAMAGE_HOURS } from "../src/features/art/combat.ts";
import { CHART_PIECES } from "../src/features/art/quests.ts";
import type { Company, Ship } from "../src/engine.ts";

const ALL_ART = ["art.scene", "art.portlife", "art.flags", "art.combat", "art.music", "art.sound", "art.news", "art.lore",
  "art.relics", "art.diary", "art.chatter", "art.mystery", "art.rivals", "art.legend", "art.eggs", "art.cameo"];

type W = ReturnType<typeof featureWorld>;
const firstShip = (w: W, c: Company): Ship => w.e.ships.get(c.ships[0])!;
/** Sail a docked ship to `dest` and wait until it docks. */
function sailTo(w: W, c: Company, s: Ship, dest: number) {
  const r = w.run({ type: "sail", company: c.id, ship: s.id, dest });
  assert.ok(r.ok, JSON.stringify(r));
  w.hours(Math.max(1, s.arriveTick - w.e.tick) + 1);
  assert.equal(s.dest, null);
  assert.equal(s.port, dest);
}
const world = (w: W, id: string) => w.e.features.world()[id] as any;
const view = (w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as any;

test("every art idea 161-172 and 441-480 has a module, and the switch file matches", () => {
  const w = featureWorld();
  const ideas = new Set<number>();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("art."));
  mods.forEach(m => m.ideas.forEach(i => ideas.add(i)));
  const assigned = readFileSync(new URL("../../docs/features/assignments/art.txt", import.meta.url), "utf8")
    .split("\n").map(l => /^(\d+)\./.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.equal(assigned.length, 52);
  for (const i of assigned) assert.ok(ideas.has(i), `idea ${i}`);
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL_ART].sort());
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/art.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(cfg).filter(k => k !== "_comment").sort(), [...ALL_ART].sort());
  for (const m of mods) { assert.equal(cfg[m.id], !m.economy, m.id); assert.equal(m.economy, false, m.id); }
});

test("scene shares the clock, the season and passing squalls", () => {
  const w = featureWorld(["art.scene"]);
  w.hours(5);
  const s = world(w, "art.scene");
  assert.equal(s.hour, 5);
  assert.equal(s.seasonName, "spring");
  w.hours(400);
  const later = world(w, "art.scene");
  assert.ok(later.squalls.length <= 3);
  for (const q of later.squalls) assert.ok(q.end > w.e.tick && q.r > 0 && q.strength >= 1 && q.strength <= 3);
});

test("portlife counts dockings for busy cranes and growth, and gives every island a biome", () => {
  const w = featureWorld(["art.portlife"]);
  const c = w.company("A"), s = firstShip(w, c), dest = w.reachable(s.port);
  sailTo(w, c, s, dest);
  const p = world(w, "art.portlife");
  assert.equal(p.biome.length, w.e.map.ports.length);
  assert.ok(p.busy[dest] >= 1 || w.e.tick - s.arriveTick >= 6);
  assert.equal(p.stage[dest], 0);
});

test("flags have a default, take valid choices and refuse bad ones", () => {
  const w = featureWorld(["art.flags"]);
  const c = w.company("A");
  const def = view(w, c, "art.flags").flag;
  assert.equal(def.length, 4);
  assert.notEqual(def[1], def[2]);
  assert.equal(w.act(c, "art.flags", "set", { pattern: 2, c1: 0, c2: 3, c3: 5 }).ok, true);
  assert.deepEqual(view(w, c, "art.flags").flag, [2, 0, 3, 5]);
  assert.equal(w.act(c, "art.flags", "set", { pattern: 2, c1: 1, c2: 1, c3: 5 }).ok, false);
  assert.equal(w.act(c, "art.flags", "set", { pattern: 99, c1: 0, c2: 1, c3: 2 }).ok, false);
  assert.equal(w.act(c, "art.flags", "set", { pattern: "x", c1: 0, c2: 1, c3: 2 }).ok, false);
  assert.deepEqual(world(w, "art.flags").custom, { [c.id]: [2, 0, 3, 5] });
});

test("combat shows damage after an attack, an explosion on capture and a sinking when a ship is lost", () => {
  const w = featureWorld(["art.combat"]);
  const a = w.company("A"), b = w.company("B"), s = firstShip(w, a);
  w.e.piracy.note(a.id, "raided", `B attacked your ship ${s.id} near somewhere and was beaten off.`);
  w.hours(1);
  assert.deepEqual(world(w, "art.combat").damaged.map((d: any) => d.ship), [s.id]);
  w.hours(DAMAGE_HOURS);
  assert.deepEqual(world(w, "art.combat").damaged, []);
  s.owner = b.id;            // as a capture would
  w.hours(1);
  assert.equal(world(w, "art.combat").fx[0].kind, "explosion");
  w.e.ships.delete(s.id);    // as a sinking or confiscation would
  w.hours(1);
  assert.ok(world(w, "art.combat").fx.some((f: any) => f.kind === "sinking" && f.ship === s.id));
  w.hours(5);
  assert.deepEqual(world(w, "art.combat").fx, []);
});

test("music gives every harbour a regional theme and shares pirate and shanty moods", () => {
  const w = featureWorld(["art.music"]);
  const c = w.company("A");
  const m = world(w, "art.music");
  assert.equal(m.region.length, w.e.map.ports.length);
  for (const r of m.region) assert.ok(m.themes[r]);
  assert.deepEqual(view(w, c, "art.music"), { home: m.region[c.home], pirate: false, shanty: false });
});

test("sound cues horns for departures and arrivals, then lets them fade", () => {
  const w = featureWorld(["art.sound"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.run({ type: "sail", company: c.id, ship: s.id, dest: w.reachable(s.port) }).ok, true);
  w.hours(1);
  assert.ok(world(w, "art.sound").cues.some((q: any) => q.kind === "horn-out" && q.ship === s.id));
  w.hours(Math.max(1, s.arriveTick - w.e.tick));
  assert.ok(world(w, "art.sound").cues.some((q: any) => q.kind === "horn-in" && q.ship === s.id));
  w.hours(3);
  assert.deepEqual(world(w, "art.sound").cues, []);
  assert.ok(Array.isArray(world(w, "art.sound").sirens));
});

test("news prints a headline with an illustration for a price spike, and a quiet one on a dull day", () => {
  const w = featureWorld(["art.news"]);
  w.company("A");
  w.hours(24);
  const quiet = world(w, "art.news").headlines;
  assert.ok(quiet.length >= 1);
  for (const h of quiet) assert.ok(h.art && h.text.length > 0);
  w.e.stock[0][0] = 0;       // empty grain at port 0: the price jumps
  w.hours(6);
  const h = world(w, "art.news").headlines.at(-1);
  assert.equal(h.kind, "spike");
  assert.match(h.text, /GRAIN/);
});

test("lore opens the founding story and each island's page when you first dock there", () => {
  const w = featureWorld(["art.lore"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.hours(1);
  const v = view(w, c, "art.lore");
  assert.equal(v.founding.length, 5);
  assert.deepEqual(v.islands.map((i: any) => i.port), [c.home]);
  const dest = w.reachable(s.port);
  sailTo(w, c, s, dest);
  const after = view(w, c, "art.lore").islands;
  assert.equal(after.length, 2);
  assert.ok(after.every((i: any) => i.text.includes(i.name)));
});

test("relics and bottles turn up as ships dock, each relic only once", () => {
  const w = featureWorld(["art.relics"]);
  const c = w.company("A"), s = firstShip(w, c);
  const home = s.port, other = w.reachable(home);
  for (let i = 0; i < 40; i++) sailTo(w, c, s, i % 2 ? home : other);
  const v = view(w, c, "art.relics");
  assert.ok(v.relics.length + v.bottles.length > 0);
  assert.equal(new Set(v.relics.map((r: any) => r.id)).size, v.relics.length);
});

test("the diary writes departures and arrivals, and a quiet line on a still day", () => {
  const w = featureWorld(["art.diary"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.hours(24);
  assert.match(view(w, c, "art.diary").pages[0].text, /^Day 1\./);
  sailTo(w, c, s, w.reachable(s.port));
  const pages = view(w, c, "art.diary").pages.map((p: any) => p.text).join("\n");
  assert.match(pages, new RegExp(`Ship ${s.id}`));
});

test("chatter fills the radio and every captain barks a line", () => {
  const w = featureWorld(["art.chatter"]);
  const c = w.company("A"), s = firstShip(w, c);
  w.hours(30);
  const radio = world(w, "art.chatter").radio;
  assert.ok(radio.length > 0 && radio.length <= 6);
  assert.ok(radio.every((r: any) => !/\{\w+\}/.test(r.text)));
  assert.equal(typeof view(w, c, "art.chatter").barks[s.id], "string");
});

test("the lost-cargo mystery leads chapter by chapter from port to port", () => {
  const w = featureWorld(["art.mystery"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "art.mystery", "dance").ok, false);
  assert.equal(w.act(c, "art.mystery", "start").ok, true);
  assert.equal(w.act(c, "art.mystery", "start").ok, false);
  for (let ch = 0; ch < 5; ch++) {
    const v = view(w, c, "art.mystery");
    assert.equal(v.chapter, ch);
    assert.notEqual(v.port, s.port);
    sailTo(w, c, s, v.port);
  }
  const done = view(w, c, "art.mystery");
  assert.equal(done.done, true);
  assert.equal(done.title, "Finder of the Marigold");
});

test("rivals get a story about the company just above or below them", () => {
  const w = featureWorld(["art.rivals"]);
  const a = w.company("A"), b = w.company("B");
  w.hours(6);
  const va = view(w, a, "art.rivals"), vb = view(w, b, "art.rivals");
  assert.equal(va.rival, b.id);
  assert.equal(vb.rival, a.id);
  assert.equal(va.story[0].beat, "top");
  assert.equal(vb.story[0].beat, "spotted");
  assert.match(vb.story[0].text, /A/);
  b.cash += 1e6;
  w.hours(6);
  assert.equal(view(w, b, "art.rivals").story[0].beat, "overtook");
  assert.equal(view(w, a, "art.rivals").story[0].beat, "lost");
});

test("the legendary ship quest collects chart pieces and shares sightings", () => {
  const w = featureWorld(["art.legend"]);
  const c = w.company("A"), s = firstShip(w, c);
  assert.equal(w.act(c, "art.legend", "start").ok, true);
  assert.equal(w.act(c, "art.legend", "start").ok, false);
  const ports: number[] = view(w, c, "art.legend").ports;
  assert.equal(new Set(ports).size, CHART_PIECES);
  assert.ok(!ports.includes(c.home));
  for (const p of ports) sailTo(w, c, s, p);
  assert.equal(view(w, c, "art.legend").have.length, CHART_PIECES);
  assert.match(w.e.features.cards(c.id)["art.legend"].cards[0].title, /whole|found/);
  let seen = false;
  for (let i = 0; i < 300 && !seen; i++) { w.hours(1); seen = !!world(w, "art.legend").sighting; }
  assert.ok(seen, "she is sighted sooner or later");
});

test("easter eggs answer the right words and refuse anything but letters", () => {
  const w = featureWorld(["art.eggs"]);
  const c = w.company("A");
  assert.equal(w.act(c, "art.eggs", "shout", { word: "Goat" }).ok, true);
  assert.equal(view(w, c, "art.eggs").found, 1);
  assert.match(view(w, c, "art.eggs").last, /goat/);
  assert.equal(w.act(c, "art.eggs", "shout", { word: "goat" }).ok, true);
  assert.equal(view(w, c, "art.eggs").found, 1, "found once");
  assert.equal(w.act(c, "art.eggs", "shout", { word: "nothing here" }).ok, true);
  assert.equal(w.act(c, "art.eggs", "shout", { word: "<script>" }).ok, false);
  assert.equal(w.act(c, "art.eggs", "shout", { word: 12 }).ok, false);
  assert.equal(w.act(c, "art.eggs", "shout", { word: "a".repeat(31) }).ok, false);
});

test("the cameo ship wanders the lanes and says something new at each harbour", () => {
  const w = featureWorld(["art.cameo"]);
  const start = world(w, "art.cameo");
  assert.equal(start.name, "MV Placeholder");
  w.hours(1);
  assert.notEqual(world(w, "art.cameo").dest, null);
  w.hours(200);
  const later = world(w, "art.cameo");
  assert.ok(later.arriveTick > start.arriveTick);
  assert.equal(typeof later.line, "string");
});

test("every art module together replays exactly", () => {
  assertReplays(ALL_ART, w => {
    const a = w.company("A"), b = w.company("B", 1);
    const s = w.e.ships.get(a.ships[0])!;
    w.act(a, "art.flags", "set", { pattern: 1, c1: 2, c2: 3, c3: 4 });
    w.act(a, "art.mystery", "start");
    w.act(b, "art.legend", "start");
    w.act(b, "art.eggs", "shout", { word: "kraken" });
    for (let i = 0; i < 6; i++) {
      const dest = i % 2 ? a.home : w.reachable(a.home);
      if (w.run({ type: "sail", company: a.id, ship: s.id, dest }).ok) w.hours(Math.max(1, s.arriveTick - w.e.tick) + 1);
    }
    w.hours(48);
  });
});
