// Player-to-player features: the trade window (117), the auction house (118), friends and fleet visits (121, 122),
// mentors (123), co-op megaprojects (126), player-run shipping lines (127), the public ledger (379) and the
// whistleblower box (380). Money moves only between players at prices they choose; nothing is created.
import type { Engine, Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, addTrust, cannotTransfer, companyOptions, DailyLimit, fail, finishedVoyages, hasRoom, isCompany, isInt, isPort,
  name, OK, pay, portName, record, social, transferShip, trustOf } from "./shared.js";

const GOODS = ["grain", "fuel", "ore", "machinery"];
const ownDocked = (e: Engine, company: number, ship: unknown): Ship | undefined => {
  const s = typeof ship === "number" ? e.ships.get(ship) : undefined;
  return s && s.owner === company && s.dest === null && s.type !== "pirate" ? s : undefined;
};
/** Take qty off a docked ship (it stays in the books as a sale for `revenue`). */
export function unload(e: Engine, s: Ship, qty: number, revenue: number) {
  s.cost *= (s.qty - qty) / s.qty;
  s.qty -= qty;
  if (s.qty <= 0) { s.qty = 0; s.good = null; s.cost = 0; }
  e.recordSpecialSale(s, revenue);
  e.maritime.dockedCargoChanged(s);
}
function load(e: Engine, s: Ship, good: number, qty: number, cost: number) {
  s.good = good; s.qty += qty; s.cost += cost;
  e.recordCargoLoaded(s, cost);
}

// ------------------------------------------------------------ 117 trade window
export const OFFER_HOURS = 12;
interface Offer { id: number; from: number; to: number; ship: number; qty: number; price: number; expires: number }
export const tradeWindowModule: FeatureFactory = (e) => {
  const id = "social.trade-window";
  const offers = new Map<number, Offer>();
  let next = 1;
  const valid = (o: Offer) => { const s = e.ships.get(o.ship); return !!s && s.owner === o.from && s.dest === null && s.qty >= o.qty && e.tick < o.expires && e.companies.has(o.to); };
  return {
    id, ideas: [117], title: "Trade window", economy: false,
    apply(cmd) {
      switch (cmd.action) {
        case "offer": {
          const s = ownDocked(e, cmd.company, cmd.ship);
          if (!s || s.qty <= 0 || s.good === null) return fail("choose one of your docked ships with cargo");
          if (!isCompany(e, cmd.target) || cmd.target === cmd.company) return fail("choose another company");
          if (!isInt(cmd.qty, 1, Math.floor(s.qty))) return fail("offer between 1 tonne and what is aboard");
          if (!isInt(cmd.price, 0, 10_000_000)) return fail("set a whole-number price");
          if ([...offers.values()].filter(o => o.from === cmd.company).length >= 5) return fail("at most 5 open offers");
          offers.set(next, { id: next, from: cmd.company, to: cmd.target, ship: s.id, qty: cmd.qty, price: cmd.price, expires: e.tick + OFFER_HOURS });
          return { ok: true, id: next++ };
        }
        case "accept": {
          const o = typeof cmd.offer === "number" ? offers.get(cmd.offer) : undefined;
          if (!o || o.to !== cmd.company) return fail("no such offer");
          if (!valid(o)) { offers.delete(o.id); return fail("the offer has lapsed"); }
          const from = e.ships.get(o.ship)!, into = ownDocked(e, cmd.company, cmd.ship);
          if (!into || into.port !== from.port) return fail(`receive it on one of your ships docked at ${portName(e, from.port)}`);
          if (into.qty > 0 && into.good !== from.good) return fail("that ship carries a different good");
          if (into.qty + o.qty > e.expansionCapacity(into)) return fail("not enough room aboard");
          if (e.companies.get(cmd.company)!.cash < o.price) return fail("not enough cash");
          const good = from.good!;
          pay(e, cmd.company, o.from, o.price, "trade", `${o.qty} t ${GOODS[good]} at ${portName(e, from.port)}`);
          unload(e, from, o.qty, o.price);
          load(e, into, good, o.qty, o.price);
          offers.delete(o.id);
          addTrust(e, o.from, 1); addTrust(e, cmd.company, 1);
          return { ok: true, spent: o.price };
        }
        case "decline": case "cancel": {
          const o = typeof cmd.offer === "number" ? offers.get(cmd.offer) : undefined;
          if (!o || (cmd.action === "decline" ? o.to : o.from) !== cmd.company) return fail("no such offer");
          offers.delete(o.id);
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    advance() { for (const o of [...offers.values()]) if (!valid(o)) offers.delete(o.id); },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const cargo = c.ships.map(i => e.ships.get(i)!).filter(s => s.dest === null && s.qty > 0 && s.good !== null && s.type !== "pirate");
      const incoming = [...offers.values()].filter(o => o.to === company && valid(o));
      const mine = [...offers.values()].filter(o => o.from === company);
      const describe = (o: Offer) => { const s = e.ships.get(o.ship)!; return `${o.qty} t ${GOODS[s.good ?? 0]} at ${portName(e, s.port)} for ${o.price.toLocaleString("en-GB")}`; };
      return [{ title: "Trade window", detail: "Sell cargo straight to another company, ship to ship in the same port, at a price you agree."
        + (incoming.length ? `\nOffers to you:\n${incoming.map(o => `${name(e, o.from)}: ${describe(o)}`).join("\n")}` : "")
        + (mine.length ? `\nYour offers:\n${mine.map(o => `to ${name(e, o.to)}: ${describe(o)}`).join("\n")}` : ""),
        actions: [
          ...(cargo.length ? [{ ...action(id, "Offer cargo", "offer"), fields: [
            { key: "ship", label: "From ship", options: cargo.map(s => ({ value: s.id, label: `${s.id}: ${Math.floor(s.qty)} t ${GOODS[s.good!]} at ${portName(e, s.port)}` })) },
            { key: "target", label: "To", options: companyOptions(e, company) }, { key: "qty", label: "Tonnes", min: 1, value: 50 }, { key: "price", label: "Price", min: 0, value: 5000 }] }] : []),
          ...incoming.slice(0, 4).flatMap(o => {
            const port = e.ships.get(o.ship)!.port, ships = c.ships.map(i => e.ships.get(i)!).filter(s => s.dest === null && s.port === port && s.type !== "pirate");
            return [{ ...action(id, `Accept from ${name(e, o.from)}`, "accept", { offer: o.id }), fields: [{ key: "ship", label: "Into ship", options: ships.map(s => ({ value: s.id, label: `${s.type} ${s.id}` })) }] },
              action(id, `Decline from ${name(e, o.from)}`, "decline", { offer: o.id })];
          }),
          ...mine.map(o => action(id, `Cancel offer to ${name(e, o.to)}`, "cancel", { offer: o.id })),
        ] }];
    },
  };
};

// ------------------------------------------------------------ 118 auction house (ships)
export const AUCTION_HOURS = 24, MIN_SHARE = 0.25, MAX_SHARE = 3;
interface Auction { ship: number; seller: number; reserve: number; ends: number; bid: number; bidder: number | null }
export const auctionsModule: FeatureFactory = (e) => {
  const id = "social.auctions";
  const auctions = new Map<number, Auction>();
  const refund = (a: Auction) => { if (a.bidder !== null) { const b = e.companies.get(a.bidder); if (b) b.cash += a.bid; } };
  return {
    id, ideas: [118], title: "Auction house", economy: false,
    apply(cmd) {
      if (cmd.action === "list") {
        const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
        const why = cannotTransfer(e, s, cmd.company);
        if (why) return fail(why);
        if (auctions.has(s!.id)) return fail("already on auction");
        const price = e.spec(s!.type).price;
        if (!isInt(cmd.reserve, Math.ceil(price * MIN_SHARE), Math.floor(price * MAX_SHARE))) return fail(`reserve between ${Math.ceil(price * MIN_SHARE)} and ${Math.floor(price * MAX_SHARE)}`);
        auctions.set(s!.id, { ship: s!.id, seller: cmd.company, reserve: cmd.reserve, ends: e.tick + AUCTION_HOURS, bid: 0, bidder: null });
        return OK;
      }
      if (cmd.action === "bid") {
        const a = typeof cmd.ship === "number" ? auctions.get(cmd.ship) : undefined;
        if (!a) return fail("no such auction");
        if (a.seller === cmd.company) return fail("you can't bid on your own ship");
        const min = a.bidder === null ? a.reserve : Math.ceil(a.bid * 1.05);
        if (!isInt(cmd.amount, min, 1e9)) return fail(`bid at least ${min}`);
        const c = e.companies.get(cmd.company)!;
        const owed = a.bidder === cmd.company ? cmd.amount - a.bid : cmd.amount;
        if (c.cash < owed) return fail("not enough cash (bids are held until the auction ends)");
        if (a.bidder === cmd.company) c.cash -= owed; else { refund(a); c.cash -= cmd.amount; }
        a.bid = cmd.amount; a.bidder = cmd.company;
        if (a.ends - e.tick < 2) a.ends = e.tick + 2;   // no last-second sniping
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const a of [...auctions.values()]) {
        if (e.tick < a.ends) continue;
        auctions.delete(a.ship);
        const s = e.ships.get(a.ship), seller = e.companies.get(a.seller);
        if (a.bidder === null) continue;
        if (!s || !seller || cannotTransfer(e, s, a.seller) || !e.companies.has(a.bidder) || !hasRoom(e, a.bidder)) { refund(a); continue; }
        transferShip(e, s, a.bidder);
        seller.cash += a.bid;
        record(e, "auction", a.bidder, a.seller, a.bid, `${s.type} ${s.id} at auction`);
      }
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const mine = c.ships.map(i => e.ships.get(i)!).filter(s => !cannotTransfer(e, s, company) && !auctions.has(s.id));
      const open = [...auctions.values()].filter(a => a.seller !== company && e.ships.has(a.ship));
      return [{ title: "Auction house", detail: `Ships go to the highest bid after ${AUCTION_HOURS} hours. Bids are held and refunded if beaten.`
        + (open.length ? `\n${open.map(a => { const s = e.ships.get(a.ship)!; return `${s.type} ${s.id} at ${portName(e, s.port)}: ${a.bidder === null ? `reserve ${a.reserve}` : `bid ${a.bid}`}, ends hour ${a.ends}`; }).join("\n")}` : ""),
        actions: [
          ...(mine.length ? [{ ...action(id, "Auction a ship", "list"), fields: [{ key: "ship", label: "Ship", options: mine.map(s => ({ value: s.id, label: `${s.type} ${s.id}` })) }, { key: "reserve", label: "Reserve", value: e.spec("freighter").price }] }] : []),
          ...open.slice(0, 6).map(a => ({ ...action(id, `Bid on ship ${a.ship}`, "bid", { ship: a.ship }), fields: [{ key: "amount", label: "Bid", value: a.bidder === null ? a.reserve : Math.ceil(a.bid * 1.05) }] })),
        ] }];
    },
    world() { return [...auctions.values()].map(a => ({ ship: a.ship, seller: name(e, a.seller), type: e.ships.get(a.ship)?.type, bid: a.bid, reserve: a.reserve, ends: a.ends, leader: a.bidder === null ? null : name(e, a.bidder) })); },
  };
};

// ------------------------------------------------------------ 121, 122 friends and fleet visits
export const friendsModule: FeatureFactory = (e) => {
  const id = "social.friends";
  const friends = new Map<number, Set<number>>(), requests = new Map<number, Set<number>>();   // to -> from
  const visits = new Map<number, { from: number; tick: number }[]>();
  const set = (m: Map<number, Set<number>>, k: number) => m.get(k) ?? m.set(k, new Set()).get(k)!;
  const areFriends = (a: number, b: number) => !!friends.get(a)?.has(b);
  return {
    id, ideas: [121, 122], title: "Friends", economy: false,
    apply(cmd) {
      const t = cmd.target;
      if (!isCompany(e, t) || t === cmd.company) return fail("choose another company");
      switch (cmd.action) {
        case "request":
          if (areFriends(cmd.company, t)) return fail("already friends");
          if (set(friends, cmd.company).size >= 50) return fail("your friend list is full");
          if (requests.get(cmd.company)?.has(t)) { requests.get(cmd.company)!.delete(t); set(friends, cmd.company).add(t); set(friends, t).add(cmd.company); return OK; }
          set(requests, t).add(cmd.company);
          return OK;
        case "accept":
          if (!requests.get(cmd.company)?.has(t)) return fail("no request from them");
          requests.get(cmd.company)!.delete(t); set(friends, cmd.company).add(t); set(friends, t).add(cmd.company);
          return OK;
        case "decline": return requests.get(cmd.company)?.delete(t) ? OK : fail("no request from them");
        case "remove": if (!areFriends(cmd.company, t)) return fail("not friends"); friends.get(cmd.company)!.delete(t); friends.get(t)!.delete(cmd.company); return OK;
        case "visit": {
          if (!areFriends(cmd.company, t)) return fail("you can visit friends' fleets");
          const list = visits.get(t) ?? [];
          if (list.some(v => v.from === cmd.company && e.tick - v.tick < 6)) return fail("you visited a moment ago");
          list.push({ from: cmd.company, tick: e.tick }); if (list.length > 20) list.shift();
          visits.set(t, list);
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    cards(company) {
      const reqs = [...(requests.get(company) ?? [])].filter(c => e.companies.has(c));
      const mine = [...(friends.get(company) ?? [])].filter(c => e.companies.has(c));
      return [{ title: "Friends", detail: (mine.length ? `Friends: ${mine.map(c => name(e, c)).join(", ")}` : "No friends added yet.")
        + (visits.get(company)?.length ? `\nRecent visitors: ${[...new Set(visits.get(company)!.slice(-5).map(v => name(e, v.from)))].join(", ")}` : ""),
        actions: [{ ...action(id, "Add a friend", "request"), fields: [{ key: "target", label: "Company", options: companyOptions(e, company).filter(o => !mine.includes(o.value)) }] },
          ...reqs.slice(0, 4).flatMap(c => [action(id, `Accept ${name(e, c)}`, "accept", { target: c }), action(id, `Decline ${name(e, c)}`, "decline", { target: c })]),
          ...mine.slice(0, 6).map(c => action(id, `Visit ${name(e, c)}'s fleet`, "visit", { target: c }))] }];
    },
    view(company) {
      const mine = [...(friends.get(company) ?? [])].filter(c => e.companies.has(c));
      return { friends: mine.map(c => { const f = e.companies.get(c)!; return { id: c, name: f.name, home: f.home,
        fleet: f.ships.map(i => e.ships.get(i)!).map(s => ({ id: s.id, type: s.type, port: s.port, dest: s.dest, good: s.good, qty: Math.round(s.qty) })) }; }),
        requests: [...(requests.get(company) ?? [])].map(c => name(e, c)), visitors: (visits.get(company) ?? []).length };
    },
  };
};

// ------------------------------------------------------------ 123 mentors
export const MENTOR_VOYAGES = 15, NEW_VOYAGES = 3, MILESTONES = [3, 10, 25];
export const mentorsModule: FeatureFactory = (e) => {
  const id = "social.mentors";
  const offering = new Set<number>(), mentorOf = new Map<number, number>(), reached = new Map<number, number>(), points = new Map<number, number>();
  return {
    id, ideas: [123], title: "Mentors", economy: false,
    apply(cmd) {
      if (cmd.action === "offer") {
        if (finishedVoyages(e, cmd.company) < MENTOR_VOYAGES) return fail(`mentors need ${MENTOR_VOYAGES} finished voyages`);
        if (offering.has(cmd.company)) offering.delete(cmd.company); else offering.add(cmd.company);
        return OK;
      }
      if (cmd.action === "choose") {
        if (mentorOf.has(cmd.company)) return fail("you already have a mentor");
        if (finishedVoyages(e, cmd.company) > NEW_VOYAGES) return fail("mentors are for new captains");
        if (typeof cmd.mentor !== "number" || !offering.has(cmd.mentor) || !e.companies.has(cmd.mentor) || cmd.mentor === cmd.company) return fail("choose a mentor from the list");
        if ([...mentorOf.values()].filter(m => m === cmd.mentor).length >= 5) return fail("that mentor has a full crew");
        mentorOf.set(cmd.company, cmd.mentor);
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const [mentee, mentor] of mentorOf) {
        const done = finishedVoyages(e, mentee), r = reached.get(mentee) ?? 0;
        const next = MILESTONES.filter(m => done >= m).length;
        if (next > r) { reached.set(mentee, next); points.set(mentor, (points.get(mentor) ?? 0) + (next - r)); addTrust(e, mentor, next - r); }
      }
    },
    cards(company) {
      const mentor = mentorOf.get(company), crew = [...mentorOf].filter(([, m]) => m === company).map(([c]) => name(e, c));
      const avail = [...offering].filter(c => c !== company && e.companies.has(c));
      if (mentor !== undefined) return [{ title: "Mentor", detail: `Your mentor is ${name(e, mentor)}. Ask them anything in chat; they earn mentor points as you reach ${MILESTONES.join(", ")} voyages.` }];
      const canChoose = finishedVoyages(e, company) <= NEW_VOYAGES && avail.length;
      return [{ title: "Mentors", detail: (crew.length ? `You mentor: ${crew.join(", ")}. Mentor points: ${points.get(company) ?? 0}.` : "")
        + (canChoose ? `\nNew captain? Pick a mentor: ${avail.map(c => name(e, c)).join(", ")}` : ""),
        actions: [...(finishedVoyages(e, company) >= MENTOR_VOYAGES ? [action(id, offering.has(company) ? "Stop offering to mentor" : "Offer to mentor", "offer")] : []),
          ...(canChoose ? [{ ...action(id, "Choose a mentor", "choose"), fields: [{ key: "mentor", label: "Mentor", options: avail.map(c => ({ value: c, label: `${name(e, c)} (trust ${trustOf(e, c)})` })) }] }] : [])] }];
    },
    world() { return [...points].filter(([c]) => e.companies.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, p]) => ({ name: name(e, c), points: p })); },
  };
};

// ------------------------------------------------------------ 126 megaprojects (+ effects, economy)
export const PROJECTS = [
  { id: "canal", name: "The Great Canal", needs: [0, 0, 3000, 2000] as number[], does: "cuts sailing time 10% on every lane touching its port" },
  { id: "lighthouse", name: "The Grand Lighthouse", needs: [1500, 1500, 0, 1000] as number[], does: "a landmark that lights the whole coast" },
];
interface Project { id: string; port: number; given: number[]; by: Map<number, number>; done: number | null }
const projects = new WeakMap<Engine, Project[]>();
const projectsOf = (e: Engine) => {
  let p = projects.get(e);
  if (!p) { p = PROJECTS.map((x, i) => ({ id: x.id, port: (Math.floor(e.n / 2) + i * 7) % e.n, given: [0, 0, 0, 0], by: new Map(), done: null })); projects.set(e, p); }
  return p;
};
export const megaprojectsModule: FeatureFactory = (e) => {
  const id = "social.megaprojects";
  return {
    id, ideas: [126], title: "Co-op megaprojects", economy: false,
    apply(cmd) {
      if (cmd.action !== "contribute") return fail("unknown action");
      const p = projectsOf(e).find(x => x.id === cmd.project), def = PROJECTS.find(x => x.id === cmd.project);
      if (!p || !def) return fail("no such project");
      if (p.done !== null) return fail("that project is finished");
      const s = ownDocked(e, cmd.company, cmd.ship);
      if (!s || s.port !== p.port || s.good === null || s.qty <= 0) return fail(`bring a loaded ship to ${portName(e, p.port)}`);
      const left = def.needs[s.good] - p.given[s.good];
      if (left <= 0) return fail(`the project doesn't need more ${GOODS[s.good]}`);
      if (!isInt(cmd.qty, 1, Math.floor(s.qty))) return fail("give between 1 tonne and what is aboard");
      const q = Math.min(cmd.qty, left), good = s.good;
      unload(e, s, q, 0);
      p.given[good] += q; p.by.set(cmd.company, (p.by.get(cmd.company) ?? 0) + q);
      if (def.needs.every((n, g) => p.given[g] >= n)) { p.done = e.tick; record(e, "project", null, null, 0, `${def.name} completed at ${portName(e, p.port)}`); }
      return { ok: true, sold: q };
    },
    cards(company) {
      const c = e.companies.get(company);
      return projectsOf(e).map(p => {
        const def = PROJECTS.find(x => x.id === p.id)!;
        const ships = (c?.ships ?? []).map(i => e.ships.get(i)!).filter(s => s.dest === null && s.port === p.port && s.good !== null && s.qty > 0 && def.needs[s.good] > p.given[s.good]);
        return { title: def.name, detail: `At ${portName(e, p.port)}: ${def.does}. ` + (p.done !== null ? `Completed at hour ${p.done}.`
          : `Needs ${def.needs.map((n, g) => n ? `${GOODS[g]} ${p.given[g]}/${n}` : "").filter(Boolean).join(", ")}. Donated cargo is used up.`),
          actions: ships.map(s => ({ ...action(id, `Give cargo from ship ${s.id}`, "contribute", { project: p.id, ship: s.id }), fields: [{ key: "qty", label: "Tonnes", min: 1, max: Math.floor(s.qty), value: Math.floor(s.qty) }] })) };
      });
    },
    world() {
      return projectsOf(e).map(p => ({ id: p.id, name: PROJECTS.find(x => x.id === p.id)!.name, port: p.port, given: p.given, needs: PROJECTS.find(x => x.id === p.id)!.needs, done: p.done,
        top: [...p.by].filter(([c]) => e.companies.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, q]) => ({ name: name(e, c), tonnes: q })) }));
    },
  };
};
export const CANAL_FACTOR = 0.9;
export const megaprojectEffectsModule: FeatureFactory = (e) => ({
  id: "social.megaproject-effects", ideas: [126], title: "Megaproject effects", economy: true,
  adjust: {
    travelHours(v, ctx) {
      const canal = projectsOf(e).find(p => p.id === "canal");
      return canal && canal.done !== null && (ctx.from === canal.port || ctx.dest === canal.port) ? Math.max(1, Math.round(v * CANAL_FACTOR)) : v;
    },
  },
});

// ------------------------------------------------------------ 127 shipping lines
interface Line { id: number; owner: number; name: string; ship: number; a: number; b: number; every: number; first: number; due: number; onTime: number; late: number }
export const LINE_GRACE = 2;
export const shippingLinesModule: FeatureFactory = (e) => {
  const id = "social.shipping-lines";
  const lines = new Map<number, Line>();
  let next = 1;
  return {
    id, ideas: [127], title: "Shipping lines", economy: false,
    apply(cmd) {
      if (cmd.action === "open") {
        const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
        if (!s || s.owner !== cmd.company || s.type === "pirate") return fail("choose one of your ships");
        if ([...lines.values()].some(l => l.ship === s.id)) return fail("that ship already runs a line");
        if (!isPort(e, cmd.a) || !isPort(e, cmd.b) || cmd.a === cmd.b || !Number.isFinite(e.dist[cmd.a][cmd.b])) return fail("choose two connected ports");
        if (!isInt(cmd.every, 12, 168)) return fail("departures every 12-168 hours");
        const lname = typeof cmd.name === "string" && cmd.name.trim() ? cmd.name.trim().replace(/[^A-Za-z0-9 '&.-]/g, "").slice(0, 24) : `${portName(e, cmd.a)}-${portName(e, cmd.b)} Line`;
        const first = e.tick + 6;
        lines.set(next, { id: next, owner: cmd.company, name: lname, ship: s.id, a: cmd.a, b: cmd.b, every: cmd.every, first, due: first, onTime: 0, late: 0 });
        return { ok: true, id: next++ };
      }
      if (cmd.action === "close") {
        const l = typeof cmd.line === "number" ? lines.get(cmd.line) : undefined;
        if (!l || l.owner !== cmd.company) return fail("not your line");
        lines.delete(l.id);
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const l of [...lines.values()]) {
        const s = e.ships.get(l.ship);
        if (!s || s.owner !== l.owner) { lines.delete(l.id); continue; }
        const departed = s.dest !== null && s.departTick >= l.due - LINE_GRACE && s.departTick <= e.tick && (s.dest === l.a || s.dest === l.b);
        if (departed) { if (s.departTick <= l.due + LINE_GRACE) { l.onTime++; addTrust(e, l.owner, 0.5); } else l.late++; l.due += l.every; }
        else if (e.tick > l.due + LINE_GRACE + l.every) { l.late++; l.due += l.every; addTrust(e, l.owner, -0.5); }
      }
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const mine = [...lines.values()].filter(l => l.owner === company);
      const free = c.ships.map(i => e.ships.get(i)!).filter(s => s.type !== "pirate" && !mine.some(l => l.ship === s.id));
      return [{ title: "Shipping lines", detail: "Publish a timetable for a ship between two ports. Punctual departures (±2 h) build trust and show on the public timetable."
        + (mine.length ? `\n${mine.map(l => `${l.name}: next departure hour ${l.due}, ${l.onTime} on time / ${l.late} late`).join("\n")}` : ""),
        actions: [...(free.length ? [{ ...action(id, "Open a line", "open"), fields: [{ key: "ship", label: "Ship", options: free.map(s => ({ value: s.id, label: `${s.type} ${s.id}` })) },
          { key: "a", label: "From", options: portOptions(e) }, { key: "b", label: "To", value: 1, options: portOptions(e) }, { key: "every", label: "Every (hours)", min: 12, max: 168, value: 48 }] }] : []),
          ...mine.map(l => action(id, `Close ${l.name}`, "close", { line: l.id }))] }];
    },
    world() { return [...lines.values()].map(l => ({ id: l.id, name: l.name, operator: name(e, l.owner), a: l.a, b: l.b, every: l.every, next: l.due,
      reliability: l.onTime + l.late ? Math.round(100 * l.onTime / (l.onTime + l.late)) : null })); },
  };
};
const portOptions = (e: Engine) => e.map.ports.map((p, i) => ({ value: i, label: p.name }));

// ------------------------------------------------------------ 379 public ledger
export const ledgerModule: FeatureFactory = (e) => ({
  id: "social.ledger", ideas: [379], title: "Public ledger", economy: false,
  world() {
    return social(e).ledger.slice(-50).map(l => ({ tick: l.tick, kind: l.kind, from: l.from === null ? null : name(e, l.from), to: l.to === null ? null : name(e, l.to), amount: l.amount, note: l.note }));
  },
});

// ------------------------------------------------------------ 380 whistleblower
export const WB_KINDS = ["multiple accounts", "price fixing", "exploiting a bug", "harassment", "broken agreement"] as const;
export const WB_THRESHOLD = 3;
export const whistleblowerModule: FeatureFactory = (e) => {
  const id = "social.whistleblower";
  const reports = new Map<number, Map<number, string>>();   // accused -> reporter -> kind (never shown)
  const opened: { accused: number; kinds: string[]; tick: number }[] = [];
  const limit = new DailyLimit(e, 2);
  return {
    id, ideas: [380], title: "Whistleblower box", economy: false,
    apply(cmd) {
      if (cmd.action !== "report") return fail("unknown action");
      if (!isCompany(e, cmd.target) || cmd.target === cmd.company) return fail("choose a company");
      if (!(WB_KINDS as readonly string[]).includes(cmd.kind as string)) return fail("choose what you saw");
      const m = reports.get(cmd.target) ?? new Map<number, string>();
      if (m.has(cmd.company)) return fail("you already reported them");
      if (!limit.take(cmd.company)) return fail("two reports a day at most");
      m.set(cmd.company, cmd.kind as string); reports.set(cmd.target, m);
      if (m.size === WB_THRESHOLD) opened.push({ accused: cmd.target, kinds: [...new Set(m.values())], tick: e.tick });
      return OK;
    },
    cards(company) {
      return [{ title: "Whistleblower box", detail: `Report suspected cheating in confidence. Your name is never shown. When ${WB_THRESHOLD} different companies report the same company, an investigation opens for the inspectors and the server admin.`,
        actions: [{ ...action(id, "Report", "report"), fields: [{ key: "target", label: "Company", options: companyOptions(e, company) }, { key: "kind", label: "What", options: WB_KINDS.map(k => ({ value: k, label: k })) }] }] }];
    },
    world() { return opened.slice(-20).map(o => ({ accused: name(e, o.accused), kinds: o.kinds, day: Math.floor(o.tick / 24) + 1 })); },
  };
};

