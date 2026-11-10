// Tests for the social feature modules (ideas 111-130 and 341-380). See docs/FEATURES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReplays, featureWorld } from "./feature-helpers.ts";
import { cleanLabel, cleanText, social, trustOf } from "../src/features/social/shared.ts";
import { civ, TERM_HOURS } from "../src/features/social/civic.ts";
import { communityFund } from "../src/features/social/economy.ts";
import type { Company } from "../src/engine.ts";

type W = ReturnType<typeof featureWorld>;
const ids = () => [...featureWorld().e.features.modules.values()].filter(m => m.id.startsWith("social.")).map(m => m.id);
const ALL = ids();
const ok = (r: { ok: boolean }, msg?: string) => assert.equal(r.ok, true, msg ?? JSON.stringify(r));
const no = (r: { ok: boolean }, msg?: string) => assert.equal(r.ok, false, msg ?? JSON.stringify(r));
const world = <T>(w: W, id: string) => w.e.features.world()[`social.${id}`] as T;
const view = <T>(w: W, c: Company, id: string) => w.e.features.view(c.id)[`social.${id}`] as T;
/** A guild with A as leader and the others as members. */
function guild(w: W, leader: Company, ...rest: Company[]) {
  ok(w.act(leader, "social.guilds", "create", { name: "Salt Traders", tag: "SALT" }));
  const gid = social(w.e).memberOf.get(leader.id)!;
  for (const c of rest) { ok(w.act(leader, "social.guilds", "invite", { target: c.id })); ok(w.act(c, "social.guilds", "join", { guild: gid })); }
  return gid;
}
function deliver(w: W, c: Company, dest?: number, ship = c.ships[0], qty = 50) {
  const s = w.e.ships.get(ship)!, to = dest ?? w.reachable(s.port);
  ok(w.run({ type: "sail", company: c.id, ship: s.id, dest: to, buy: { good: "grain", qty } }));
  while (w.e.ships.get(s.id)!.dest !== null) w.hours(1);
  w.run({ type: "sell", company: c.id, ship: s.id });
  return to;
}
const load = (w: W, c: Company, qty = 40, ship = c.ships[0]) => {   // put cargo on a docked ship without sailing
  const s = w.e.ships.get(ship)!; s.good = 0; s.qty = qty; s.cost = qty * 10; return s;
};

test("every social idea 111-130 and 341-380 has a module and the switch file matches", () => {
  const w = featureWorld();
  const mods = [...w.e.features.modules.values()].filter(m => m.id.startsWith("social."));
  const assigned = readFileSync(new URL("../../docs/features/assignments/social.txt", import.meta.url), "utf8").split("\n").map(l => /^(\d+)\./.exec(l)?.[1]).filter(Boolean).map(Number);
  assert.equal(assigned.length, 60);
  const covered = new Set(mods.flatMap(m => m.ideas));
  for (const i of assigned) assert.ok(covered.has(i), `idea ${i}`);
  const cfg = JSON.parse(readFileSync(new URL("../../config/features/social.json", import.meta.url), "utf8"));
  for (const m of mods) assert.equal(cfg[m.id], !m.economy, m.id);
  assert.equal(Object.keys(cfg).filter(k => !k.startsWith("_")).length, mods.length);
  // Ideas the assignment marks as economy are switched off.
  const offIdeas = readFileSync(new URL("../../docs/features/assignments/social.txt", import.meta.url), "utf8").split("\n").filter(l => l.includes("economy flag")).map(l => Number(/^(\d+)/.exec(l)![1]));
  for (const i of offIdeas) assert.ok(mods.some(m => m.economy && m.ideas.includes(i)), `economy idea ${i}`);
});

test("text filter stars rude words, removes contact details and refuses bad names", () => {
  assert.equal(cleanText("meet me at www.example.com", 100), "meet me at [removed]");
  assert.match(cleanText("you are a b1tch", 100)!, /\*{5}/);
  assert.equal(cleanLabel("Essex Shipping"), "Essex Shipping");
  assert.equal(cleanLabel("shit traders"), null);
  assert.equal(cleanText("x".repeat(500), 100), null);
});

test("guilds: create, invite, join, ranks, flag and leadership hand-over", () => {
  const w = featureWorld(["social.guilds"]);
  const a = w.company("A"), b = w.company("B"), c = w.company("C");
  ok(w.act(a, "social.guilds", "create", { name: "North Star", tag: "nstr" }));
  no(w.act(b, "social.guilds", "create", { name: "North Star", tag: "XX" }), "name taken");
  no(w.act(b, "social.guilds", "create", { name: "Ok Name", tag: "TOOLONG" }));
  const gid = social(w.e).memberOf.get(a.id)!;
  no(w.act(b, "social.guilds", "join", { guild: gid }), "invite only");
  ok(w.act(a, "social.guilds", "invite", { target: b.id })); ok(w.act(b, "social.guilds", "join", { guild: gid }));
  no(w.act(b, "social.guilds", "invite", { target: c.id }), "members can't invite");
  ok(w.act(a, "social.guilds", "setRank", { target: b.id, rank: "officer" }));
  ok(w.act(b, "social.guilds", "setFlag", { field: 1, charge: 3 }));
  ok(w.act(a, "social.guilds", "leave"));
  const g = (world<{ members: { name: string; rank: string }[]; flag: string[] }[]>(w, "guilds"))[0];
  assert.deepEqual(g.members, [{ id: b.id, name: "B", rank: "leader" }].map(({ name, rank }) => ({ id: b.id, name, rank })));
  assert.equal(g.flag[0], "#c8432f");
});

test("guild chat is members-only and filtered", () => {
  const w = featureWorld(["social.guilds", "social.guild-chat"]);
  const a = w.company("A"), b = w.company("B"), outsider = w.company("C");
  guild(w, a, b);
  ok(w.act(a, "social.guild-chat", "say", { text: "Grain run at dawn, call 0161 496 0000" }));
  no(w.act(outsider, "social.guild-chat", "say", { text: "hi" }));
  const msgs = view<{ text: string }[]>(w, b, "guild-chat");
  assert.equal(msgs[0].text, "Grain run at dawn, call [removed]");
  assert.deepEqual(view(w, outsider, "guild-chat"), []);
});

test("recruitment board: post, apply, accept becomes an invite", () => {
  const w = featureWorld(["social.guilds", "social.recruitment"]);
  const a = w.company("A"), b = w.company("B");
  const gid = guild(w, a);
  ok(w.act(a, "social.recruitment", "post", { pitch: "Friendly fuel haulers, all time zones" }));
  ok(w.act(b, "social.recruitment", "apply", { guild: gid }));
  ok(w.act(a, "social.recruitment", "accept", { target: b.id }));
  ok(w.act(b, "social.guilds", "join", { guild: gid }));
  assert.equal(world<unknown[]>(w, "recruitment").length, 1);
});

test("guild HQ: leader sets it, members build at the normal price there", () => {
  const w = featureWorld(["social.guilds", "social.guild-hq"]);
  const a = w.company("A"), b = w.company("B");
  guild(w, a, b);
  no(w.act(b, "social.guild-hq", "setHq", { port: 3 }), "leader only");
  ok(w.act(a, "social.guild-hq", "setHq", { port: 3 }));
  no(w.act(a, "social.guild-hq", "setHq", { port: 4 }), "cool-down");
  b.cash = 1e6;
  const cash = b.cash, n = b.ships.length;
  ok(w.act(b, "social.guild-hq", "build", { shipType: "freighter" }));
  assert.equal(b.ships.length, n + 1);
  assert.equal(cash - b.cash, w.e.spec("freighter").price);
  assert.equal(w.e.ships.get(b.ships.at(-1)!)!.port, 3);
  no(w.act(b, "social.guild-hq", "build", { shipType: "pirate" }));
});

test("guild-held ports, contests, missions, tech and the hall of fame follow deliveries", () => {
  const w = featureWorld(["social.guilds", "social.guild-ports", "social.guild-contests", "social.guild-missions", "social.hall-of-fame"]);
  const a = w.company("A"), b = w.company("B");
  const gid = guild(w, a, b), g = social(w.e).guilds.get(gid)!;
  const to = w.reachable(0);
  a.cash = 1e6;
  for (let i = 0; i < 4; i++) { deliver(w, a, to, a.ships[0], 100); deliver(w, a, 0, a.ships[0], 100); }
  w.hours(24 - (w.e.tick % 24));
  assert.ok(world<{ port: number }[]>(w, "guild-ports").length >= 1, "guild holds a port");
  assert.ok((world<{ standings: unknown[] }>(w, "guild-contests")).standings.length === 1);
  assert.ok(world<{ records: unknown[] }>(w, "hall-of-fame").records.length >= 1);
  g.xp = 100;
  no(w.act(b, "social.guild-missions", "research", { tech: "muster" }), "officers only");
  ok(w.act(a, "social.guild-missions", "research", { tech: "charts" }));
  no(w.act(a, "social.guild-missions", "research", { tech: "heraldry" }), "needs muster");
  assert.ok(Array.isArray(view<{ charts: unknown[] }>(w, b, "guild-missions").charts));
  assert.ok(g.fame.length >= 1);
});

test("formations: guildmates leaving together earn guild XP", () => {
  const w = featureWorld(["social.guilds", "social.formations"]);
  const a = w.company("A"), b = w.company("B");
  const gid = guild(w, a, b), to = w.reachable(0);
  ok(w.run({ type: "sail", company: a.id, ship: a.ships[0], dest: to }));
  ok(w.run({ type: "sail", company: b.id, ship: b.ships[0], dest: to }));
  w.hours(1);
  assert.equal(world<{ formed: number }>(w, "formations").formed, 1);
  assert.ok(social(w.e).guilds.get(gid)!.xp > 0);
});

test("shared fleet: a loaned ship changes hands and comes back when the loan ends", () => {
  const w = featureWorld(["social.guilds", "social.shared-fleets"]);
  const a = w.company("A"), b = w.company("B");
  guild(w, a, b);
  const extra = w.e.addExpansionShip(a, 0, "freighter");
  no(w.act(a, "social.shared-fleets", "lend", { ship: extra.id, target: b.id, hours: 999 }));
  ok(w.act(a, "social.shared-fleets", "lend", { ship: extra.id, target: b.id, hours: 2 }));
  assert.equal(extra.owner, b.id);
  w.hours(2);
  assert.equal(extra.owner, a.id);
  assert.ok(a.ships.includes(extra.id) && !b.ships.includes(extra.id));
});

test("reputation: trades let partners rate each other; guild reputation is published", () => {
  const w = featureWorld(["social.trade-window", "social.reputation", "social.guilds"]);
  const a = w.company("A"), b = w.company("B");
  load(w, a);
  ok(w.act(a, "social.trade-window", "offer", { ship: a.ships[0], target: b.id, qty: 20, price: 1000 }));
  ok(w.act(b, "social.trade-window", "accept", { offer: 1, ship: b.ships[0] }));
  const before = trustOf(w.e, a.id);
  ok(w.act(b, "social.reputation", "rate", { target: a.id, score: 1 }));
  no(w.act(b, "social.reputation", "rate", { target: a.id, score: 1 }), "once");
  assert.equal(trustOf(w.e, a.id), before + 2);
  guild(w, a);
  assert.equal(world<{ guilds: unknown[] }>(w, "reputation").guilds.length, 1);
});

test("trade window moves cargo and cash between two ships in the same port", () => {
  const w = featureWorld(["social.trade-window", "social.ledger"]);
  const a = w.company("A"), b = w.company("B");
  const s = load(w, a, 40), t = w.e.ships.get(b.ships[0])!;
  const ca = a.cash, cb = b.cash;
  no(w.act(a, "social.trade-window", "offer", { ship: s.id, target: b.id, qty: 41, price: 10 }), "more than aboard");
  ok(w.act(a, "social.trade-window", "offer", { ship: s.id, target: b.id, qty: 30, price: 900 }));
  no(w.act(a, "social.trade-window", "accept", { offer: 1, ship: s.id }), "not to you");
  ok(w.act(b, "social.trade-window", "accept", { offer: 1, ship: t.id }));
  assert.equal(s.qty, 10); assert.equal(t.qty, 30); assert.equal(t.good, 0);
  assert.equal(a.cash - ca, 900); assert.equal(cb - b.cash, 900);
  assert.equal(world<{ amount: number }[]>(w, "ledger")[0].amount, 900);
});

test("auction house: bids are held, beaten bids refunded, the ship goes to the winner", () => {
  const w = featureWorld(["social.auctions"]);
  const a = w.company("A"), b = w.company("B"), c = w.company("C");
  b.cash = c.cash = 1e6;
  const s = w.e.addExpansionShip(a, 0, "freighter"), price = w.e.spec("freighter").price;
  no(w.act(a, "social.auctions", "list", { ship: s.id, reserve: 1 }), "below the band");
  ok(w.act(a, "social.auctions", "list", { ship: s.id, reserve: price / 2 }));
  const cb = b.cash;
  ok(w.act(b, "social.auctions", "bid", { ship: s.id, amount: price / 2 }));
  no(w.act(c, "social.auctions", "bid", { ship: s.id, amount: price / 2 }), "must beat by 5%");
  ok(w.act(c, "social.auctions", "bid", { ship: s.id, amount: price }));
  assert.equal(b.cash, cb, "refunded");
  const ca = a.cash;
  w.hours(24);
  assert.equal(s.owner, c.id);
  assert.equal(a.cash - ca, price);
});

test("friends: request, accept, visit a friend's fleet", () => {
  const w = featureWorld(["social.friends"]);
  const a = w.company("A"), b = w.company("B");
  no(w.act(a, "social.friends", "visit", { target: b.id }));
  ok(w.act(a, "social.friends", "request", { target: b.id }));
  ok(w.act(b, "social.friends", "accept", { target: a.id }));
  ok(w.act(a, "social.friends", "visit", { target: b.id }));
  const v = view<{ friends: { name: string; fleet: unknown[] }[] }>(w, a, "friends");
  assert.equal(v.friends[0].name, "B"); assert.equal(v.friends[0].fleet.length, 1);
  assert.equal(view<{ visitors: number }>(w, b, "friends").visitors, 1);
});

test("mentors: experienced captains mentor new ones and earn points at milestones", () => {
  const w = featureWorld(["social.mentors"]);
  const m = w.company("Mentor"), n = w.company("New");
  no(w.act(m, "social.mentors", "offer"), "needs voyages");
  w.e.trips.set(m.id, Array.from({ length: 15 }, () => ({ ship: 0, from: 0, to: 1, good: 0, qty: 1, spent: 0, earned: 0, departTick: 0, arriveTick: 0, open: false })));
  ok(w.act(m, "social.mentors", "offer"));
  ok(w.act(n, "social.mentors", "choose", { mentor: m.id }));
  let at = 0;
  for (let i = 0; i < 3; i++) at = deliver(w, n, i % 2 ? 0 : w.reachable(at));
  w.hours(1);
  assert.deepEqual(world(w, "mentors"), [{ name: "Mentor", points: 1 }]);
});

test("megaprojects take donated cargo; the canal's time saving is a separate economy switch", () => {
  const w = featureWorld(["social.megaprojects"]);
  const a = w.company("A", 0);
  const canal = world<{ id: string; port: number; given: number[] }[]>(w, "megaprojects").find(p => p.id === "canal")!;
  const lh = world<{ id: string; port: number }[]>(w, "megaprojects").find(p => p.id === "lighthouse")!;
  const s = w.e.ships.get(a.ships[0])!;
  s.port = lh.port; load(w, a, 40);
  no(w.act(a, "social.megaprojects", "contribute", { project: "canal", ship: s.id, qty: 10 }), "wrong port");
  ok(w.act(a, "social.megaprojects", "contribute", { project: "lighthouse", ship: s.id, qty: 25 }));
  assert.equal(s.qty, 15);
  assert.equal(world<{ id: string; given: number[] }[]>(w, "megaprojects").find(p => p.id === "lighthouse")!.given[0], 25);
  w.apply({ type: "setFeatures", enabled: ["social.megaprojects", "social.megaproject-effects"] });
  assert.equal(w.e.features.adjust("travelHours", 20, { ship: s.id, from: canal.port, dest: 1 }), 20, "canal not built");
});

test("shipping lines publish a timetable and score punctuality", () => {
  const w = featureWorld(["social.shipping-lines"]);
  const a = w.company("A");
  const to = w.reachable(0);
  no(w.act(a, "social.shipping-lines", "open", { ship: a.ships[0], a: 0, b: 0, every: 24 }));
  ok(w.act(a, "social.shipping-lines", "open", { ship: a.ships[0], a: 0, b: to, every: 24 }));
  w.hours(6);
  ok(w.run({ type: "sail", company: a.id, ship: a.ships[0], dest: to }));
  w.hours(1);
  const l = world<{ reliability: number; next: number }[]>(w, "shipping-lines")[0];
  assert.equal(l.reliability, 100);
  assert.equal(l.next, 6 + 24);
});

test("public ledger lists player-to-player money moves", () => {
  const w = featureWorld(["social.ledger", "social.community-fund"]);
  const a = w.company("A");
  ok(w.act(a, "social.community-fund", "donate", { amount: 300 }));
  assert.equal(world<{ note: string }[]>(w, "ledger").at(-1)!.note, "donation to the community fund");
});

test("whistleblower: three independent reports open an investigation; reporters stay hidden", () => {
  const w = featureWorld(["social.whistleblower"]);
  const bad = w.company("Bad"), r = ["R1", "R2", "R3"].map(n => w.company(n));
  no(w.act(r[0], "social.whistleblower", "report", { target: bad.id, kind: "being rude" }));
  r.forEach(c => ok(w.act(c, "social.whistleblower", "report", { target: bad.id, kind: "price fixing" })));
  no(w.act(r[0], "social.whistleblower", "report", { target: bad.id, kind: "price fixing" }), "once");
  const open = world<{ accused: string; kinds: string[] }[]>(w, "whistleblower");
  assert.deepEqual(open.map(o => o.accused), ["Bad"]);
  assert.ok(!JSON.stringify(open).includes("R1"));
});

test("mayors are elected weekly by the companies based at a port", () => {
  const w = featureWorld(["social.mayors"]);
  const a = w.company("A", 2), b = w.company("B", 2), c = w.company("C", 2);
  ok(w.act(a, "social.mayors", "stand")); ok(w.act(b, "social.mayors", "stand"));
  ok(w.act(b, "social.mayors", "vote", { candidate: a.id })); ok(w.act(c, "social.mayors", "vote", { candidate: a.id }));
  no(w.act(c, "social.mayors", "vote", { candidate: c.id }));
  w.hours(TERM_HOURS - w.e.tick);
  assert.equal(civ(w.e).mayors.get(2), a.id);
  ok(w.act(a, "social.mayors", "motto", { text: "Fair winds, fair prices" }));
  assert.equal(world<{ motto: string }[]>(w, "mayors")[0].motto, "Fair winds, fair prices");
});

test("council and laws: elected council proposes, everyone votes, laws are published", () => {
  const w = featureWorld(["social.laws"]);
  const a = w.company("A"), b = w.company("B"), c = w.company("C");
  no(w.act(a, "social.laws", "propose", { law: 0 }), "not on the council");
  ok(w.act(b, "social.laws", "electCouncil", { candidate: a.id })); ok(w.act(c, "social.laws", "electCouncil", { candidate: a.id }));
  w.hours(TERM_HOURS - w.e.tick);
  ok(w.act(a, "social.laws", "propose", { law: 2 }));
  ok(w.act(b, "social.laws", "vote", { proposal: 1, choice: "yes" })); ok(w.act(c, "social.laws", "vote", { proposal: 1, choice: "yes" }));
  w.hours(48);
  assert.deepEqual(world<{ laws: string[] }>(w, "laws").laws, ["Honour every trade window offer you accept"]);
});

test("courts: judges rule and the verdict moves trust, not cash", () => {
  const w = featureWorld(["social.courts"]);
  const p = w.company("P"), d = w.company("D"), others = ["J1", "J2", "J3", "J4"].map(n => w.company(n));
  ok(w.act(p, "social.courts", "file", { kind: "court", target: d.id, charge: "did not honour a deal", statement: "Took my fuel and never paid" }));
  no(w.act(p, "social.courts", "file", { kind: "court", target: d.id, charge: "cheating" }), "one a day");
  ok(w.act(d, "social.courts", "defend", { case: 1, statement: "The fuel was damaged" }));
  const judges = others.filter(j => w.e.features.cards(j.id)["social.courts"].cards[0].actions!.some(x => x.command.case === 1));
  assert.equal(judges.length, 3);
  const cash = d.cash;
  judges.forEach(j => ok(w.act(j, "social.courts", "judge", { case: 1, verdict: "guilty" })));
  assert.equal(world<{ verdict: string }[]>(w, "courts")[0].verdict, "guilty");
  assert.equal(trustOf(w.e, d.id), 42);
  assert.equal(d.cash, cash);
});

test("licences and inspectors: mayors license, the council appoints, inspectors inspect", () => {
  const w = featureWorld(["social.licences"]);
  const mayor = w.company("Mayor"), insp = w.company("Insp"), trader = w.company("Trader");
  civ(w.e).mayors.set(0, mayor.id); civ(w.e).council = [mayor.id];
  ok(w.act(mayor, "social.licences", "issue", { target: trader.id, kind: "pilot" }));
  no(w.act(insp, "social.licences", "issue", { target: trader.id, kind: "pilot" }));
  ok(w.act(mayor, "social.licences", "appoint", { target: insp.id }));
  ok(w.act(insp, "social.licences", "inspect", { ship: trader.ships[0] }));
  no(w.act(insp, "social.licences", "inspect", { ship: trader.ships[0] }), "once a day");
  assert.equal(world<{ inspections: { licensed: boolean }[] }>(w, "licences").inspections[0].licensed, true);
});

test("newspapers: found a paper, publish filtered stories, likes lift the front page", () => {
  const w = featureWorld(["social.newspapers"]);
  const a = w.company("A"), b = w.company("B");
  no(w.act(a, "social.newspapers", "publish", { headline: "Hello there", body: "x".repeat(30) }), "no paper");
  ok(w.act(a, "social.newspapers", "found", { name: "The Harbour Herald" }));
  ok(w.act(a, "social.newspapers", "publish", { headline: "Grain glut at the north quays", body: "Five freighters arrived on the same tide and the price fell by half." }));
  ok(w.act(b, "social.newspapers", "like", { article: 1 }));
  const front = world<{ front: { paper: string; likes: number }[] }>(w, "newspapers").front;
  assert.equal(front[0].paper, "The Harbour Herald"); assert.equal(front[0].likes, 1);
});

test("community votes on map changes, features and a weekly question, with weekly results", () => {
  const w = featureWorld(["social.polls"]);
  const a = w.company("A"), b = w.company("B");
  ok(w.act(a, "social.polls", "vote", { poll: "map", choice: 1 })); ok(w.act(b, "social.polls", "vote", { poll: "map", choice: 1 }));
  ok(w.act(a, "social.polls", "vote", { poll: "feature", choice: 2 }));
  ok(w.act(a, "social.polls", "vote", { poll: "weekly", choice: 0 }));
  no(w.act(a, "social.polls", "vote", { poll: "weekly", choice: 99 }));
  no(w.act(a, "social.polls", "vote", { poll: "nope", choice: 0 }));
  w.hours(168);
  const r = world<{ results: { poll: string; winner: string }[]; week: number }>(w, "polls");
  assert.equal(r.week, 2);
  assert.deepEqual(r.results.map(x => x.poll), ["map", "feature", "weekly"]);
});

// ------------------------------------------------------------ economy modules (switched off)
test("treasury, dividends, roles and the guild bank move money inside a guild", () => {
  const w = featureWorld(["social.guilds", "social.treasury", "social.roles", "social.bank"]);
  const a = w.company("A"), b = w.company("B");
  const gid = guild(w, a, b);
  ok(w.act(b, "social.treasury", "deposit", { amount: 10_000 }));
  no(w.act(b, "social.treasury", "withdraw", { amount: 100 }), "members can't withdraw");
  ok(w.act(a, "social.roles", "set", { perm: "withdraw", rank: "member" }));
  ok(w.act(b, "social.treasury", "withdraw", { amount: 100 }));
  const ca = a.cash;
  ok(w.act(a, "social.treasury", "dividend", { amount: 1000 }));
  assert.equal(a.cash - ca, 500);
  ok(w.act(b, "social.bank", "borrow", { amount: 2000 }));
  assert.equal((view<{ owed: number }>(w, b, "bank")).owed, 2100);
  ok(w.act(b, "social.bank", "repay"));
  assert.equal(social(w.e).treasury.get(gid), 10_000 - 100 - 1000 + 100);
});

test("shares: trade, takeover with a majority, and mergers agreed by both leaders", () => {
  const w = featureWorld(["social.guilds", "social.shares"]);
  const a = w.company("A"), b = w.company("B"), c = w.company("C");
  const g1 = guild(w, a, b);
  ok(w.act(a, "social.shares", "ask", { qty: 50, price: 10 }));
  ok(w.act(b, "social.shares", "buy", { guild: g1, seller: a.id, qty: 50 }));
  ok(w.act(b, "social.shares", "takeover", { guild: g1 }));
  assert.equal(social(w.e).guilds.get(g1)!.members.get(b.id), "leader");
  ok(w.act(c, "social.guilds", "create", { name: "Other Co", tag: "OTH" }));
  const g2 = social(w.e).memberOf.get(c.id)!;
  ok(w.act(c, "social.shares", "merge", { guild: g1 }));
  ok(w.act(b, "social.shares", "merge", { guild: g2 }));
  assert.equal(social(w.e).memberOf.get(c.id), g1);
  assert.equal(social(w.e).guilds.has(g2), false);
});

test("guild contracts pay a member from the treasury on delivery; the warehouse stores cargo at the HQ", () => {
  const w = featureWorld(["social.guilds", "social.treasury", "social.guild-contracts", "social.guild-hq", "social.warehouse"]);
  const a = w.company("A"), b = w.company("B");
  const gid = guild(w, a, b);
  ok(w.act(a, "social.treasury", "deposit", { amount: 5000 }));
  const to = w.reachable(0);
  ok(w.act(a, "social.guild-contracts", "post", { port: to, good: 0, qty: 40, reward: 3000 }));
  ok(w.act(b, "social.guild-contracts", "take", { contract: 1 }));
  const cb = b.cash; deliver(w, b, to);
  w.hours(1);
  assert.ok(b.cash > cb, "reward paid");
  ok(w.act(a, "social.guild-hq", "setHq", { port: 0 }));
  load(w, a, 30);
  ok(w.act(a, "social.warehouse", "store", { ship: a.ships[0], qty: 30 }));
  assert.deepEqual(view(w, b, "warehouse"), [30, 0, 0, 0]);
  void gid;
});

test("wars score deliveries and move a tribute between treasuries", () => {
  const w = featureWorld(["social.guilds", "social.treasury", "social.wars"]);
  const a = w.company("A"), b = w.company("B");
  const ga = guild(w, a);
  ok(w.act(b, "social.guilds", "create", { name: "Rivals Inc", tag: "RIV" }));
  const gb = social(w.e).memberOf.get(b.id)!;
  ok(w.act(b, "social.treasury", "deposit", { amount: 10_000 }));
  ok(w.act(a, "social.wars", "declare", { guild: gb }));
  w.hours(24);
  deliver(w, a);
  w.hours(72);
  assert.equal(social(w.e).treasury.get(ga), 500);
});

test("alliances, rivalries, regional chat, signals, spectators and the news feed", () => {
  const w = featureWorld(["social.guilds", "social.alliances", "social.rivalries", "social.regional-chat", "social.signals", "social.spectator", "social.news-feed"]);
  const a = w.company("A"), b = w.company("B");
  const ga = guild(w, a);
  ok(w.act(b, "social.guilds", "create", { name: "Friends Co", tag: "FRN" }));
  const gb = social(w.e).memberOf.get(b.id)!;
  ok(w.act(a, "social.alliances", "propose", { guild: gb })); ok(w.act(b, "social.alliances", "propose", { guild: ga }));
  assert.equal(world<unknown[]>(w, "alliances").length, 1);
  ok(w.act(a, "social.rivalries", "declare", { target: b.id }));
  assert.equal(view<{ rival: { name: string } }>(w, a, "rivalries").rival.name, "B");
  const region = w.e.ships.get(a.ships[0])!.port % 5;
  ok(w.act(a, "social.regional-chat", "say", { region, text: "anyone selling fuel?" }));
  no(w.act(a, "social.regional-chat", "say", { region: (region + 1) % 5, text: "hi" }));
  ok(w.act(a, "social.signals", "signal", { ship: a.ships[0], signal: 0 }));
  assert.equal(world<Record<number, string>>(w, "signals")[a.ships[0]], "Ahoy!");
  ok(w.act(b, "social.spectator", "watch", { target: a.id }));
  assert.equal(world<{ spectators: number }[]>(w, "spectator")[0].spectators, 1);
  assert.deepEqual(view(w, a, "news-feed"), []);
});

test("hired captains sail the owner's ship with the owner's cash and are paid a daily wage", () => {
  const w = featureWorld(["social.hire-captains"]);
  const o = w.company("Owner"), c = w.company("Captain");
  ok(w.act(o, "social.hire-captains", "hire", { ship: o.ships[0], target: c.id, wage: 100, days: 2 }));
  const oc = o.cash;
  ok(w.act(c, "social.hire-captains", "sail", { ship: o.ships[0], dest: w.reachable(0), good: "grain", qty: 20 }));
  assert.ok(o.cash < oc);
  no(w.act(o, "social.hire-captains", "sail", { ship: o.ships[0], dest: 0 }), "owner is not the captain");
  const cc = c.cash; w.hours(24 - w.e.tick % 24);
  assert.equal(c.cash - cc, 100);
});

test("port tax votes, piracy laws, treaties and lighthouse taxes adjust fees only when switched on", () => {
  const w = featureWorld(["social.tax-votes", "social.piracy-laws", "social.guilds", "social.guild-hq", "social.treaties", "social.lighthouse-taxes"]);
  const m = w.company("Mayor", 1), r = w.company("Res", 1), b = w.company("B");
  civ(w.e).mayors.set(1, m.id); civ(w.e).council = [m.id];
  ok(w.act(m, "social.tax-votes", "propose", { change: 2 }));
  ok(w.act(r, "social.tax-votes", "vote", { choice: "yes" }));
  w.hours(48);
  assert.ok(Math.abs(w.e.features.adjust("tradeTax", 0.05, { port: 1, good: 0, side: "buy" }) - 0.07) < 1e-9);
  ok(w.act(m, "social.piracy-laws", "toggle", { port: 2 }));
  assert.deepEqual(world(w, "piracy-laws"), [2]);
  ok(w.act(m, "social.guilds", "create", { name: "Mayor Line", tag: "MAY" })); ok(w.act(b, "social.guilds", "create", { name: "Bee Line", tag: "BEE" }));
  const gm = social(w.e).memberOf.get(m.id)!, gb = social(w.e).memberOf.get(b.id)!;
  ok(w.act(m, "social.guild-hq", "setHq", { port: 4 }));
  ok(w.act(m, "social.treaties", "propose", { guild: gb })); ok(w.act(b, "social.treaties", "propose", { guild: gm }));
  assert.equal(w.e.features.adjust("portFee", 100, { ship: b.ships[0], company: b.id, from: 0, dest: 4 }), 50);
});

test("fines follow a guilty verdict; naming rights auction feeds the community fund; grants come from it", () => {
  const w = featureWorld(["social.courts", "social.fines", "social.naming-auctions", "social.community-fund"]);
  const p = w.company("P"), d = w.company("D");
  ["J1", "J2", "J3"].forEach(n => w.company(n));
  no(w.act(p, "social.fines", "claim", { target: d.id }));
  ok(w.act(p, "social.courts", "file", { kind: "court", target: d.id, charge: "cheating" }));
  for (const j of [...w.e.companies.values()]) w.act(j, "social.courts", "judge", { case: 1, verdict: "guilty" });
  const before = d.cash;
  ok(w.act(p, "social.fines", "claim", { target: d.id }));
  assert.equal(before - d.cash, Math.min(5000, Math.floor(before * 0.02)));
  ok(w.act(p, "social.naming-auctions", "bid", { port: 3, name: "Pete's Haven", amount: 600 }));
  w.hours(168);
  assert.equal(communityFund(w.e).total, 600);
  civ(w.e).council = [p.id];
  ok(w.act(p, "social.community-fund", "grant", { target: d.id, amount: 500 }));
  no(w.act(p, "social.community-fund", "grant", { target: d.id, amount: 50 }), "once per company");
});

test("replays: every social module on together ends in the same state", () => {
  assertReplays(ALL, w => {
    const a = w.company("A"), b = w.company("B"), c = w.company("C", 1);
    const gid = guild(w, a, b);
    w.act(a, "social.guild-hq", "setHq", { port: 0 });
    w.act(a, "social.guild-chat", "say", { text: "hello crew" });
    w.act(b, "social.treasury", "deposit", { amount: 2000 });
    w.act(c, "social.friends", "request", { target: a.id });
    w.act(a, "social.friends", "accept", { target: c.id });
    w.act(c, "social.mayors", "stand");
    w.act(c, "social.polls", "vote", { poll: "feature", choice: 1 });
    w.act(a, "social.shipping-lines", "open", { ship: a.ships[0], a: 0, b: w.reachable(0), every: 24 });
    w.act(c, "social.courts", "file", { kind: "arbitration", target: b.id, charge: "did not honour a deal" });
    w.act(b, "social.newspapers", "found", { name: "Daily Tide" });
    deliver(w, a);
    w.act(b, "social.guild-missions", "research", { tech: "muster" });
    w.hours(30);
    void gid;
  });
});
