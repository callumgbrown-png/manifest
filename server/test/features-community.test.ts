// Tests for the community feature modules (ideas 173-195 and 501-550). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { cleanName, cleanText, codeProof, getCatalogue, getLinks, sha256, storedHash, useContent } from "../src/features/community/content.ts";
import { MAX_FAILS_PER_DAY } from "../src/features/community/codes.ts";
import { PORT_PRICE, SHIP_PRICE } from "../src/features/community/naming.ts";
import { referralTag } from "../src/features/community/referrals.ts";
import { STATS_EVERY } from "../src/features/community/stats.ts";
import type { Company } from "../src/engine.ts";

const ALL = ["community.locker", "community.codes", "community.seasonal", "community.shop", "community.dedications", "community.naming",
  "community.share-fleet", "community.stats", "community.speedruns", "community.testers", "community.referrals", "community.wiki", "community.links"];
type W = ReturnType<typeof featureWorld>;
const viewOf = <T>(w: W, c: Company, id: string) => w.e.features.view(c.id)[id] as T;
const worldOf = <T>(w: W, id: string) => w.e.features.world()[id] as T;

// Test codes: plain code -> salted hash entry, as tools/community/make-codes.mjs writes them.
function codeEntry(code: string, grants: string[], uses = 1, salt = "00112233445566778899aabb") {
  return { label: code, salt, hash: storedHash(salt, codeProof(code)), grants, uses };
}
const CODES = { codes: [
  codeEntry("FOUNDER-ONE", ["pack:pack.founder"]),
  codeEntry("CHARITY", ["pack:pack.charity"], 2),
  codeEntry("TESTER-PTS", ["points:5", "pack:pack.playtester"], 10),
  codeEntry("DISCORD-EARLY", ["naming:1", "item:badge.race-winner"], 5),
] };
useContent({ codes: CODES });

/** Sail one delivery: buy cargo where the ship is, sail to a neighbour, wait until it docks. */
function deliver(w: W, c: Company, dest?: number) {
  const s = w.e.ships.get(c.ships[0])!;
  const to = dest ?? w.reachable(s.port);
  const r = w.run({ type: "sail", company: c.id, ship: s.id, dest: to, buy: { good: "grain", qty: 50 } });
  assert.ok(r.ok, JSON.stringify(r));
  while (w.e.ships.get(s.id)!.dest !== null) w.hours(1);
  w.run({ type: "sell", company: c.id, ship: s.id });
  return to;
}

test("every community idea has a module or a ready-to-use document, and the switch file matches", () => {
  const w = featureWorld();
  const assigned = readFileSync(new URL("../../docs/features/assignments/community.txt", import.meta.url), "utf8")
    .split("\n").map(l => /^(\d+)\./.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.equal(assigned.length, 73);
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("community."));
  assert.deepEqual(mods.map(m => m.id).sort(), [...ALL].sort());
  const covered = new Set(mods.flatMap(m => m.ideas));
  const index = readFileSync(new URL("../../docs/community/README.md", import.meta.url), "utf8");
  for (const [, idea, file] of index.matchAll(/^\| (\d+) \| .*?\| \[[^\]]+\]\(([^)]+)\)/gm)) {
    assert.ok(existsSync(new URL(`../../docs/community/${file}`, import.meta.url)), file);
    covered.add(Number(idea));
  }
  for (const i of assigned) assert.ok(covered.has(i), `idea ${i}`);
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/community.json", import.meta.url), "utf8"));
  for (const m of mods) assert.equal(cfg[m.id], !m.economy, m.id);
  assert.equal(Object.keys(cfg).filter(k => !k.startsWith("_")).length, mods.length);
});

test("the shipped catalogue and links load without dropping entries", () => {
  const raw = JSON.parse(readFileSync(new URL("../../config/content/community/cosmetics.json", import.meta.url), "utf8"));
  const cat = getCatalogue();
  assert.equal(cat.items.size, raw.items.length);
  assert.equal(cat.packs.size, raw.packs.length);
  assert.deepEqual(getLinks(), {}, "all links are empty placeholders");
});

test("locker: free items equip, locked items and wrong slots are refused, the look is public", () => {
  const w = featureWorld(["community.locker"]);
  const c = w.company("A");
  assert.equal(w.act(c, "community.locker", "equip", { slot: "flag", item: "flag.house-green" }).ok, true);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "flag", item: "flag.founder" }).ok, false, "code-only");
  assert.equal(w.act(c, "community.locker", "equip", { slot: "skin", item: "flag.house-green" }).ok, false, "wrong slot");
  assert.equal(w.act(c, "community.locker", "equip", { slot: "hat", item: "x" }).ok, false);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "flag", item: 7 }).ok, false);
  assert.equal(w.act(c, "community.locker", "claimPennant").ok, false, "no pennant");
  const look = worldOf<Record<number, Record<string, { name: string }>>>(w, "community.locker");
  assert.equal(look[c.id].flag.name, "House green");
  assert.equal(w.act(c, "community.locker", "equip", { slot: "flag", item: "none" }).ok, true);
  assert.deepEqual(worldOf(w, "community.locker"), {});
  assert.ok(w.e.features.cards(c.id)["community.locker"].cards[0].actions!.length >= 5);
});

test("codes: the proof unlocks the pack once, wrong codes are rate limited, use limits hold", () => {
  const w = featureWorld(["community.locker", "community.codes"]);
  const a = w.company("A"), b = w.company("B");
  assert.equal(w.act(a, "community.codes", "redeem", { proof: codeProof("founder-one") }).ok, true, "case and dashes do not matter");
  assert.equal(w.act(a, "community.locker", "equip", { slot: "skin", item: "skin.founder" }).ok, true);
  assert.equal(w.act(a, "community.codes", "redeem", { proof: codeProof("FOUNDER-ONE") }).ok, false, "only once");
  assert.equal(w.act(b, "community.codes", "redeem", { proof: codeProof("FOUNDER-ONE") }).ok, false, "single-use code is used up");
  assert.equal(w.act(b, "community.codes", "redeem", { proof: "FOUNDER-ONE" }).ok, false, "plain codes are not accepted");
  for (let i = 0; i < MAX_FAILS_PER_DAY - 1; i++) w.act(b, "community.codes", "redeem", { proof: sha256(`nope${i}`) });
  assert.match(String((w.act(b, "community.codes", "redeem", { proof: codeProof("CHARITY") }) as { error: string }).error), /tomorrow/);
  w.hours(24);
  assert.equal(w.act(b, "community.codes", "redeem", { proof: codeProof("CHARITY") }).ok, true);
  assert.deepEqual(viewOf<{ lastGrant: string[] }>(w, b, "community.codes").lastGrant, ["Lighthouse (charity)", "Charity heart", "Charity sailor"]);
});

test("seasonal and limited skins can be claimed only in their days, limited ones only while stock lasts", () => {
  useContent({ cosmetics: { items: [
    { id: "skin.now", slot: "skin", name: "Now", colors: ["#111111"], source: "seasonal", days: [1, 2] },
    { id: "skin.later", slot: "skin", name: "Later", colors: ["#111111"], source: "seasonal", days: [10, 12] },
    { id: "skin.rare", slot: "skin", name: "Rare", colors: ["#111111"], source: "limited", days: [1, 3], limit: 1 },
  ] } });
  try {
    const w = featureWorld(["community.seasonal", "community.locker"]);
    const a = w.company("A"), b = w.company("B");
    assert.equal(w.act(a, "community.seasonal", "claim", { item: "skin.now" }).ok, true);
    assert.equal(w.act(a, "community.seasonal", "claim", { item: "skin.now" }).ok, false, "already owned");
    assert.equal(w.act(a, "community.seasonal", "claim", { item: "skin.later" }).ok, false, "not yet");
    assert.equal(w.act(a, "community.seasonal", "claim", { item: "skin.rare" }).ok, true);
    assert.equal(w.act(b, "community.seasonal", "claim", { item: "skin.rare" }).ok, false, "run claimed out");
    w.hours(48);
    assert.equal(w.act(b, "community.seasonal", "claim", { item: "skin.now" }).ok, false, "season over");
    assert.equal(w.act(a, "community.locker", "equip", { slot: "skin", item: "skin.rare" }).ok, true);
  } finally { useContent({ cosmetics: JSON.parse(readFileSync(new URL("../../config/content/community/cosmetics.json", import.meta.url), "utf8")), codes: CODES }); }
});

test("shop (economy): buying a pack takes credits and unlocks every item", () => {
  const w = featureWorld(["community.shop", "community.locker"]);
  const c = w.company("A"), cash = c.cash;
  assert.equal(w.act(c, "community.shop", "buy", { item: "pack.archipelago-flags" }).ok, true);
  assert.equal(c.cash, cash - 700);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "flag", item: "flag.volcano" }).ok, true);
  assert.equal(w.act(c, "community.shop", "buy", { item: "pack.archipelago-flags" }).ok, false, "already owned");
  assert.equal(w.act(c, "community.shop", "buy", { item: "skin.founder" }).ok, false, "not for sale");
  c.cash = 10;
  assert.equal(w.act(c, "community.shop", "buy", { item: "skin.ironclad" }).ok, false);
});

test("dedications use tokens from codes; names are filtered; one dedication per port", () => {
  const w = featureWorld(["community.codes", "community.dedications"]);
  const a = w.company("A"), b = w.company("B");
  assert.equal(w.act(a, "community.dedications", "dedicate", { port: 1, name: "Harbour Quay" }).ok, false, "no token");
  w.act(a, "community.codes", "redeem", { proof: codeProof("DISCORD-EARLY") });
  w.act(b, "community.codes", "redeem", { proof: codeProof("DISCORD-EARLY") });
  assert.equal(w.act(a, "community.dedications", "dedicate", { port: 1, name: "www.spam.com" }).ok, false);
  assert.equal(w.act(a, "community.dedications", "dedicate", { port: 99, name: "Quay" }).ok, false);
  assert.equal(w.act(a, "community.dedications", "dedicate", { port: 1, name: "Anna's Quay" }).ok, true);
  assert.equal(w.act(b, "community.dedications", "dedicate", { port: 1, name: "Bob's Quay" }).ok, false, "taken");
  assert.deepEqual(worldOf<{ name: string }[]>(w, "community.dedications").map(d => d.name), ["Anna's Quay"]);
  assert.equal(w.act(a, "community.dedications", "dedicate", { port: 2, name: "Second" }).ok, false, "token spent");
});

test("paid naming (economy) charges credits for ships and ports", () => {
  const w = featureWorld(["community.naming"]);
  const c = w.company("A"), cash = c.cash, s = c.ships[0];
  assert.equal(w.act(c, "community.naming", "nameShip", { ship: s, name: "Sea Biscuit" }).ok, true);
  assert.equal(w.act(c, "community.naming", "nameShip", { ship: 9999, name: "Sea Biscuit" }).ok, false);
  assert.equal(w.act(c, "community.naming", "namePort", { port: 0, name: "Founders Pier" }).ok, true);
  assert.equal(c.cash, cash - SHIP_PRICE - PORT_PRICE);
  assert.deepEqual(worldOf<{ ships: Record<number, string> }>(w, "community.naming").ships, { [s]: "Sea Biscuit" });
});

test("share my fleet sends only the company's own snapshot", () => {
  const w = featureWorld(["community.share-fleet", "community.locker"]);
  const c = w.company("Acme"); w.company("Other");
  w.act(c, "community.locker", "equip", { slot: "logo", item: "logo.gull" });
  const v = viewOf<{ name: string; ships: unknown[]; look: Record<string, { name: string }>; worth: number }>(w, c, "community.share-fleet");
  assert.equal(v.name, "Acme");
  assert.equal(v.ships.length, c.ships.length);
  assert.equal(v.look.logo.name, "Gull");
  assert.ok(v.worth > 0);
  assert.equal(w.e.features.world()["community.share-fleet"], undefined);
});

test("public stats count deliveries and rank companies", () => {
  const w = featureWorld(["community.stats"]);
  const a = w.company("A"); w.company("B");
  deliver(w, a);
  w.hours(STATS_EVERY);
  const s = worldOf<{ companies: number; voyages: number; tonnes: number; top: { name: string }[]; busiest: unknown[] }>(w, "community.stats");
  assert.equal(s.companies, 2);
  assert.equal(s.voyages, 1);
  assert.equal(s.tonnes, 50);
  assert.equal(s.top.length, 2);
  assert.equal(s.busiest.length, 1);
  assert.ok(existsSync(new URL("../public/features/community-stats.html", import.meta.url)));
});

test("speedruns time a challenge, post the best time and grant cosmetics", () => {
  const w = featureWorld(["community.speedruns", "community.locker"]);
  const c = w.company("A");
  assert.equal(w.act(c, "community.speedruns", "start", { challenge: "nope" }).ok, false);
  assert.equal(w.act(c, "community.speedruns", "start", { challenge: "tour5" }).ok, true);
  assert.equal(w.act(c, "community.speedruns", "start", { challenge: "grow50" }).ok, false, "one at a time");
  assert.equal(w.act(c, "community.speedruns", "abandon").ok, true);
  assert.equal(w.act(c, "community.speedruns", "start", { challenge: "fleet" }).ok, true);
  w.e.addExpansionShip(c, c.home, "coaster"); w.e.addExpansionShip(c, c.home, "coaster");
  w.hours(1);
  const board = worldOf<{ id: string; best: { name: string; hours: number }[] }[]>(w, "community.speedruns");
  assert.deepEqual(board.find(b => b.id === "fleet")!.best, [{ name: "A", hours: 1 }]);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "badge", item: "badge.speedrunner" }).ok, true);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "wake", item: "wake.gold" }).ok, true, "beat par");
});

test("testers: structured reports with a daily cap; points from codes unlock bug-hunter rewards and the board", () => {
  const w = featureWorld(["community.testers", "community.codes", "community.locker"]);
  const c = w.company("A");
  assert.equal(w.act(c, "community.testers", "report", { kind: "prices", port: 2 }).ok, true);
  assert.equal(w.act(c, "community.testers", "report", { kind: "lasers" }).ok, false);
  assert.equal(w.act(c, "community.testers", "report", { kind: "map", port: 500 }).ok, false);
  assert.equal(w.act(c, "community.testers", "report", { kind: "map", ship: 9999 }).ok, false);
  w.act(c, "community.testers", "report", { kind: "map" }); w.act(c, "community.testers", "report", { kind: "other" });
  assert.equal(w.act(c, "community.testers", "report", { kind: "other" }).ok, false, "daily cap");
  w.act(c, "community.codes", "redeem", { proof: codeProof("TESTER-PTS") });
  w.hours(1);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "badge", item: "badge.bug-hunter-2" }).ok, true);
  assert.equal(w.act(c, "community.locker", "equip", { slot: "wake", item: "wake.lighthouse" }).ok, false, "needs 15");
  assert.deepEqual(worldOf(w, "community.testers"), [{ name: "A", points: 5 }]);
});

test("referrals count only after the new company finishes three voyages", () => {
  const w = featureWorld(["community.referrals", "community.locker"]);
  const host = w.company("Host"), guest = w.company("Guest");
  assert.match(referralTag(host.id), /^SHIP-[A-Z2-9]{6}$/);
  assert.equal(w.act(guest, "community.referrals", "enterTag", { tag: "SHIP-??????" }).ok, false);
  assert.equal(w.act(host, "community.referrals", "enterTag", { tag: referralTag(host.id) }).ok, false, "self");
  assert.equal(w.act(guest, "community.referrals", "enterTag", { tag: referralTag(host.id).toLowerCase() }).ok, true);
  assert.equal(w.act(guest, "community.referrals", "enterTag", { tag: referralTag(host.id) }).ok, false, "only once");
  assert.equal(w.act(host, "community.referrals", "enterTag", { tag: referralTag(guest.id) }).ok, false, "no swaps");
  let at = guest.home;
  for (let i = 0; i < 3; i++) {
    w.hours(1);
    assert.equal(viewOf<{ qualified: number }>(w, host, "community.referrals").qualified, 0);
    at = deliver(w, guest, i % 2 ? guest.home : w.reachable(at));
  }
  w.hours(1);
  assert.equal(viewOf<{ qualified: number }>(w, host, "community.referrals").qualified, 1);
  assert.equal(w.act(host, "community.locker", "equip", { slot: "flag", item: "flag.shipmates" }).ok, true);
  assert.equal(w.act(guest, "community.locker", "equip", { slot: "flag", item: "flag.shipmates" }).ok, true);
});

test("wiki tips are filtered, voted, flagged out of sight and capped per day", () => {
  const w = featureWorld(["community.wiki"]);
  const a = w.company("A"), b = w.company("B"), c = w.company("C"), d = w.company("D");
  assert.equal(w.act(a, "community.wiki", "tip", { page: "port:1", text: "Grain is cheap here early in the season." }).ok, true);
  assert.equal(w.act(a, "community.wiki", "tip", { page: "port:999", text: "Nowhere port is lovely." }).ok, false);
  assert.equal(w.act(a, "community.wiki", "tip", { page: "good:0", text: "visit my site spam.com now" }).ok, false);
  assert.equal(w.act(a, "community.wiki", "tip", { page: "good:0", text: "call me on 07700 900123 ok" }).ok, false);
  assert.equal(w.act(a, "community.wiki", "tip", { page: "ship:coaster", text: "short" }).ok, false);
  const tip = (worldOf<{ pages: Record<string, { id: number }[]> }>(w, "community.wiki").pages["port:1"])[0].id;
  assert.equal(w.act(a, "community.wiki", "vote", { tip }).ok, false, "own tip");
  assert.equal(w.act(b, "community.wiki", "vote", { tip }).ok, true);
  assert.equal(w.act(b, "community.wiki", "vote", { tip }).ok, false, "once");
  for (const x of [b, c, d]) w.act(x, "community.wiki", "flag", { tip });
  assert.deepEqual(worldOf<{ pages: object }>(w, "community.wiki").pages, {});
  w.act(a, "community.wiki", "tip", { page: "guide:trading", text: "Buy where it is made, sell where it is used." });
  w.act(a, "community.wiki", "tip", { page: "guide:pirates", text: "Stay near your home port at first." });
  assert.equal(w.act(a, "community.wiki", "tip", { page: "guide:orders", text: "Orders fill while you sleep." }).ok, false, "daily cap");
  assert.ok(cleanText("Fuel sells well at the northern ports!"));
  assert.equal(cleanName("Essex Traders"), "Essex Traders");
});

test("links show only configured https links", () => {
  useContent({ links: { discord: "https://discord.gg/example", itch: "https://example.itch.io/manifest" } });
  try {
    const w = featureWorld(["community.links"]);
    assert.deepEqual(worldOf<{ key: string }[]>(w, "community.links").map(l => l.key), ["discord", "itch"]);
  } finally { useContent({ links: {} }); }
});

test("replays: every community module on together ends in the same state", () => {
  assertReplays(ALL, w => {
    const a = w.company("A"), b = w.company("B");
    w.act(a, "community.codes", "redeem", { proof: codeProof("DISCORD-EARLY") });
    w.act(a, "community.dedications", "dedicate", { port: 3, name: "Early Quay" });
    w.act(a, "community.locker", "equip", { slot: "badge", item: "badge.race-winner" });
    w.act(b, "community.shop", "buy", { item: "wake.sparkle" });
    w.act(b, "community.locker", "equip", { slot: "wake", item: "wake.sparkle" });
    w.act(b, "community.referrals", "enterTag", { tag: referralTag(a.id) });
    w.act(a, "community.speedruns", "start", { challenge: "deliver500" });
    w.act(b, "community.wiki", "tip", { page: "ship:freighter", text: "The freighter is the best all-rounder." });
    w.act(a, "community.testers", "report", { kind: "display" });
    w.act(b, "community.seasonal", "claim", { item: "skin.spring-tide" });
    w.act(b, "community.naming", "nameShip", { ship: b.ships[0], name: "Lucky" });
    deliver(w, a);
    w.hours(30);
  });
});
