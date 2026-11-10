// Delivery contracts (ideas 61-70, 73, 75). All of them pay money, so all are economy modules (off until approved).
// Offers are drafted with e.features.random() inside enable/advance, so a replay drafts the same jobs.
// A contract is delivered by a docked ship at the destination carrying the cargo; the cargo leaves the hold and the
// reward is paid instead of a market sale (recorded as a special sale for the trip log).
import { GOODS, type Engine } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import {
  act, addRep, addStanding, companyShips, ContractBook, consumers, day, deliveryPay, fail, freighterHours, goodName, LATE_GRACE,
  money, Notices, ok, ownShip, portName, reachable, repOf, shared, shipField, stars, title, unload, valueReward, whole, type Contract,
} from "./core.js";

/** A plain offer board: `count` offers refilled each day, drafted with the given premium and time allowance. */
function boardModule(o: { id: string; ideas: number[]; title: string; label: string; count: number; premium: number; hoursFactor: number;
  extra: number; detail: string; replaceDaily?: boolean; gate?: (e: Engine, company: number, c: Contract) => string | null }): FeatureFactory {
  return (e) => {
    const book = new ContractBook(e, o.id);
    const refill = () => {
      if (o.replaceDaily) book.offers = [];
      while (book.offers.length < o.count) {
        const c = book.draft(o.label, o.premium, o.hoursFactor, o.extra);
        if (!c) break;
        book.offers.push(c);
      }
    };
    const mod: FeatureModule & { book: ContractBook } = {
      id: o.id, ideas: o.ideas, title: o.title, economy: true, book,
      enable() { if (!book.offers.length) refill(); },
      apply(cmd) {
        if (cmd.action === "accept") return book.accept(cmd.company, cmd.contract, o.gate ? c => o.gate!(e, cmd.company, c) : undefined);
        return book.standard(cmd) ?? fail("unknown action");
      },
      advance() { book.expire(); if (e.tick % 24 === 0) refill(); },
      cards(company) {
        const why = o.gate && book.offers[0] ? o.gate(e, company, book.offers[0]) : null;
        return [{ title: o.title, detail: `${o.detail}${why ? `\nYou can't take these yet: ${why}.` : ""}\nCompleted: ${book.done.get(company) ?? 0}.`
          + book.notes.of(company).map(n => `\n• ${n.text}`).join(""), actions: book.actions(company, why ? [] : book.offers) }];
      },
      view: (company) => book.view(company),
      world: () => ({ offers: book.offers.length }),
    };
    return mod;
  };
}

export const timed = boardModule({ id: "contracts.timed", ideas: [61], title: "Timed delivery contracts", label: "Timed delivery", count: 3,
  premium: 1.3, hoursFactor: 2, extra: 24, detail: "Carry a cargo between two ports before the deadline for 30% over its market value. The clock starts when you accept." });

export const rush = boardModule({ id: "contracts.rush", ideas: [62], title: "Rush contracts", label: "Rush job", count: 2,
  premium: 1.8, hoursFactor: 1.25, extra: 4, detail: "Urgent jobs with tight deadlines: 80% over market value if you make it in time." });

export const board = boardModule({ id: "contracts.board", ideas: [69], title: "Daily contract board", label: "Board job", count: 5,
  premium: 1.15, hoursFactor: 3, extra: 48, replaceDaily: true,
  detail: "Five easy jobs posted every morning; untaken ones are replaced the next day. 15% over market value, generous deadlines." });

export const government = boardModule({ id: "contracts.government", ideas: [66], title: "Government contracts", label: "Government job", count: 2,
  premium: 1.5, hoursFactor: 2, extra: 24,
  detail: "Well-paid state jobs (50% over value). You need a shipping licence: reputation 3 or more and no wanted stars.",
  gate: (e, company) => repOf(e, company) < 3 ? "reputation 3 needed" : stars(e, company) > 0 ? "no wanted stars allowed" : null });

export const exclusive = boardModule({ id: "contracts.exclusive", ideas: [67], title: "Exclusive contracts", label: "Exclusive job", count: 1,
  premium: 2, hoursFactor: 2, extra: 12, detail: "Prestige work for trusted captains only (reputation 8+): double the cargo's value.",
  gate: (e, company) => repOf(e, company) < 8 ? "reputation 8 needed" : null });

// ------------------------------------------------------------ 70 late penalties

export const latePenalty: FeatureFactory = () => ({
  id: "contracts.late-penalty", ideas: [70], title: "Late-delivery penalties", economy: true,
  cards: () => [{ title: "Late deliveries", detail: `While this rule is on, a contract may still be delivered up to ${LATE_GRACE} h after its deadline: pay drops 10% for every 6 h late (never below 30%). A contract never delivered costs a penalty of 10% of its reward and 1 reputation.` }],
  world: () => ({ grace: LATE_GRACE, stepHours: 6, stepCut: 0.1, floor: 0.3, failPenalty: 0.1 }),
});

// ------------------------------------------------------------ 63 milk runs

interface MilkRun { id: number; good: number; from: number; stops: { port: number; qty: number; done: boolean }[]; perTonne: number; posted: number; deadline: number; taker?: number }
export const milkRun: FeatureFactory = (e) => {
  const id = "contracts.milk-run";
  let offers: MilkRun[] = [];
  const held = new Map<number, MilkRun>();
  const notes = new Notices();
  const draft = (): MilkRun | null => {
    const r = () => e.features.random();
    for (let t = 0; t < 8; t++) {
      const good = Math.floor(r() * GOODS.length), cons = consumers(e, good);
      if (cons.length < 2) continue;
      const from = Math.floor(r() * e.n);
      const pool = cons.filter(p => p !== from && Number.isFinite(e.dist[from][p]));
      if (pool.length < 2) continue;
      const n = Math.min(pool.length, 2 + Math.floor(r() * 2)), stops: MilkRun["stops"] = [];
      while (stops.length < n) { const p = pool.splice(Math.floor(r() * pool.length), 1)[0]; stops.push({ port: p, qty: 15 + Math.floor(r() * 16), done: false }); }
      let hours = 0, at = from;
      for (const s of stops) { if (!reachable(e, at, s.port)) break; hours += freighterHours(e, at, s.port) + 4; at = s.port; }
      const avg = stops.reduce((a, s) => a + e.price(s.port, good), 0) / stops.length;
      return { id: ++shared(e).contractSeq, good, from, stops, perTonne: Math.round(avg * 1.35 * 100) / 100, posted: e.tick, deadline: e.tick + Math.ceil(hours * 1.6) + 24 };
    }
    return null;
  };
  const refill = () => { while (offers.length < 2) { const m = draft(); if (!m) break; offers.push(m); } };
  const text = (m: MilkRun) => `${goodName(m.good)} via ${m.stops.map(s => `${portName(e, s.port)} ${s.qty} t${s.done ? " ✓" : ""}`).join(" → ")}, ${money(m.perTonne)}/t`;
  return {
    id, ideas: [63], title: "Milk runs", economy: true,
    enable() { if (!offers.length) refill(); },
    apply(cmd) {
      if (cmd.action === "accept") {
        const m = offers.find(o => o.id === cmd.contract);
        if (!m) return fail("that run is no longer on offer");
        if ([...held.values()].some(h => h.taker === cmd.company)) return fail("finish your current milk run first");
        offers = offers.filter(o => o !== m);
        m.deadline += e.tick - m.posted; m.taker = cmd.company; held.set(m.id, m);
        return ok;
      }
      if (cmd.action === "drop") {
        const m = typeof cmd.contract === "number" ? held.get(cmd.contract) : undefined;
        if (!m || m.taker !== cmd.company) return fail("you hold no such run");
        held.delete(m.id); addRep(e, cmd.company, -1);
        return ok;
      }
      if (cmd.action !== "stop") return fail("unknown action");
      const m = typeof cmd.contract === "number" ? held.get(cmd.contract) : undefined;
      if (!m || m.taker !== cmd.company) return fail("you hold no such run");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      const stop = m.stops.find(x => !x.done)!;
      if (s.dest !== null || s.port !== stop.port) return fail(`the next stop is ${portName(e, stop.port)}`);
      if (s.good !== m.good || s.qty < stop.qty) return fail(`the ship needs ${stop.qty} t of ${goodName(m.good)}`);
      const full = Math.round(stop.qty * m.perTonne * 100) / 100;
      const pay = deliveryPay(e, { reward: full, deadline: m.deadline });
      if (pay === null) return fail("the run has run out of time");
      unload(e, s, stop.qty, pay);
      e.companies.get(cmd.company)!.cash += pay;
      stop.done = true;
      if (m.stops.every(x => x.done)) { held.delete(m.id); addRep(e, cmd.company, 1); addStanding(e, cmd.company, "guild", 3); notes.add(e, cmd.company, `Milk run finished: ${text(m)}.`); }
      return { ok: true, earned: pay };
    },
    advance() {
      for (const m of [...held.values()]) if (e.tick > m.deadline + (e.features.enabled("contracts.late-penalty") ? LATE_GRACE : 0)) {
        held.delete(m.id); addRep(e, m.taker!, -1); notes.add(e, m.taker!, `Milk run ran out of time: ${text(m)}.`);
      }
      if (e.tick % 24 === 0) { offers = offers.filter(o => o.posted + 24 > e.tick); refill(); }
    },
    cards(company) {
      const mine = [...held.values()].find(h => h.taker === company);
      const actions = mine ? (() => {
        const stop = mine.stops.find(x => !x.done)!;
        const ships = companyShips(e, company).filter(s => s.dest === null && s.port === stop.port && s.good === mine.good && s.qty >= stop.qty);
        return [...(ships.length ? [act(id, `Unload at ${portName(e, stop.port)}`, "stop", { contract: mine.id }, [shipField(ships)])] : []),
          act(id, "Drop the run (costs reputation)", "drop", { contract: mine.id })];
      })() : offers.map(o => act(id, `Accept: ${text(o)}`, "accept", { contract: o.id }));
      return [{ title: "Milk runs", detail: `Load one good and drop part of it at two or three ports in order. Each stop pays on the spot.${mine ? `\nYour run: ${text(mine)}; ${mine.deadline - e.tick} h left.` : ""}`
        + notes.of(company).map(n => `\n• ${n.text}`).join(""), actions }];
    },
    view: (company) => ({ offers, held: [...held.values()].filter(h => h.taker === company), notes: notes.of(company) }),
  };
};

// ------------------------------------------------------------ 64 community and 65 relief: pooled deliveries

interface Pool { id: number; port: number; good: number; target: number; filled: number; perTonne: number; until: number; by: Map<number, number>; kind: string }
function pooled(o: { id: string; ideas: number[]; title: string; every: number; hours: number; target: number; premium: number; bonus: number; goods?: () => number[];
  detail: string; kind: string }): FeatureFactory {
  return (e) => {
    let pool: Pool | null = null;
    const history: { port: number; good: number; filled: number; target: number }[] = [];
    const notes = new Notices();
    const open = () => {
      const r = () => e.features.random();
      const goods = o.goods?.() ?? GOODS.map((_, i) => i);
      const good = goods[Math.floor(r() * goods.length)];
      const cons = consumers(e, good);
      const port = cons.length ? cons[Math.floor(r() * cons.length)] : Math.floor(r() * e.n);
      pool = { id: ++shared(e).contractSeq, port, good, target: o.target, filled: 0, perTonne: Math.round(e.price(port, good) * o.premium * 100) / 100, until: e.tick + o.hours, by: new Map(), kind: o.kind };
    };
    const close = () => {
      if (!pool) return;
      const p = pool;
      if (p.filled >= p.target && o.bonus > 0) {
        const bonus = p.target * p.perTonne * o.bonus;
        for (const [c, q] of p.by) { const co = e.companies.get(c); if (co) { co.cash += bonus * q / p.filled; notes.add(e, c, `${o.title} completed at ${portName(e, p.port)}: bonus ${money(bonus * q / p.filled)}.`); } }
      }
      for (const c of p.by.keys()) addRep(e, c, 1);
      history.push({ port: p.port, good: p.good, filled: p.filled, target: p.target });
      if (history.length > 5) history.shift();
      pool = null;
    };
    return {
      id: o.id, ideas: o.ideas, title: o.title, economy: true,
      enable() { if (!pool) open(); },
      apply(cmd) {
        if (cmd.action !== "contribute") return fail("unknown action");
        const p = pool;
        if (!p || e.tick >= p.until || p.filled >= p.target) return fail("nothing is being collected right now");
        const s = ownShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (s.dest !== null || s.port !== p.port) return fail(`the ship must be docked at ${portName(e, p.port)}`);
        if (s.good !== p.good || s.qty < 1) return fail(`the ship carries no ${goodName(p.good)}`);
        if (cmd.qty !== undefined && !whole(cmd.qty, 1, 100000)) return fail("give a whole number of tonnes");
        const q = Math.floor(Math.min(s.qty, p.target - p.filled, typeof cmd.qty === "number" ? cmd.qty : Infinity));
        if (q < 1) return fail("nothing to hand over");
        const pay = Math.round(q * p.perTonne * 100) / 100;
        unload(e, s, q, pay);
        e.companies.get(cmd.company)!.cash += pay;
        p.filled += q; p.by.set(cmd.company, (p.by.get(cmd.company) ?? 0) + q);
        if (p.filled >= p.target) close();
        return { ok: true, earned: pay };
      },
      advance() {
        if (pool && e.tick >= pool.until) close();
        if (!pool && e.tick % o.every === 0) open();
      },
      cards(company) {
        const p = pool;
        if (!p) return [{ title: o.title, detail: `${o.detail}\nNothing is being collected right now.` }];
        const ships = companyShips(e, company).filter(s => s.dest === null && s.port === p.port && s.good === p.good && s.qty >= 1);
        return [{ title: o.title, detail: `${o.detail}\nNow: ${portName(e, p.port)} needs ${p.target} t of ${goodName(p.good)} (${Math.floor(p.filled)} in), ${money(p.perTonne)}/t, ${p.until - e.tick} h left. Your share: ${p.by.get(company) ?? 0} t.`
          + notes.of(company).map(n => `\n• ${n.text}`).join(""),
          actions: ships.length ? [act(o.id, "Hand over cargo", "contribute", {}, [shipField(ships), { key: "qty", label: "Tonnes", min: 1, max: 1000, value: Math.floor(ships[0].qty) }])] : [] }];
      },
      view: (company) => ({ share: pool?.by.get(company) ?? 0, notes: notes.of(company) }),
      world: () => ({ open: pool ? { port: pool.port, good: pool.good, target: pool.target, filled: pool.filled, until: pool.until, contributors: pool.by.size } : null, history }),
    };
  };
}

export const community = pooled({ id: "contracts.community", ideas: [64], title: "Community contracts", every: 72, hours: 72, target: 400, premium: 1.2, bonus: 0.15,
  kind: "community", detail: "A big order every three days that the whole sea fills together. Each tonne pays 20% over market; if the target is met, a 15% bonus is shared by tonnes given." });

export const relief = pooled({ id: "contracts.relief", ideas: [65], title: "Emergency relief", every: 48, hours: 36, target: 150, premium: 1.6, bonus: 0,
  goods: () => (["grain", "fuel"] as const).map(n => (GOODS as readonly string[]).indexOf(n)).filter(i => i >= 0),
  kind: "relief", detail: "A port in trouble needs grain or fuel fast. Every tonne delivered pays 60% over market until the need is met." });

// ------------------------------------------------------------ 68 story chains

export const STORIES = [
  { name: "The Lighthouse Keeper", chapters: ["Oil for the lamp", "Timber for the stairs", "Food for the long winter", "Glass for the great lens"] },
  { name: "The Drowned Bell", chapters: ["A diver's supplies", "Ropes and winches", "The salvage crew's wages in kind", "Bringing the bell home"] },
  { name: "The Orphan Fleet", chapters: ["Rations for the boatyard", "Iron for the keels", "Fuel for the first voyage", "A launch-day feast"] },
];
export const storyChains: FeatureFactory = (e) => {
  const id = "contracts.story";
  const progress = new Map<number, { story: number; chapter: number; job: Contract | null }>();
  const finished = new Map<number, number[]>();
  const book = new ContractBook(e, id, 1);
  const chapterJob = (company: number, story: number, chapter: number): Contract | null => {
    const c = book.draft(`${STORIES[story].name}, chapter ${chapter + 1}: ${STORIES[story].chapters[chapter]}`, 1.4 + 0.1 * chapter, 2.5, 36);
    if (!c) return null;
    c.taker = company; c.accepted = e.tick;
    book.taken.set(c.id, c);
    return c;
  };
  return {
    id, ideas: [68], title: "Story contracts", economy: true,
    apply(cmd) {
      const p = progress.get(cmd.company);
      if (cmd.action === "start") {
        if (!whole(cmd.story, 0, STORIES.length - 1)) return fail("choose a story");
        if (p) return fail("finish your current story first");
        if ((finished.get(cmd.company) ?? []).includes(cmd.story)) return fail("you have already told that story");
        const job = chapterJob(cmd.company, cmd.story, 0);
        if (!job) return fail("no suitable job on this map");
        progress.set(cmd.company, { story: cmd.story, chapter: 0, job });
        return ok;
      }
      if (cmd.action === "deliver") {
        if (!p?.job) return fail("you are not in a story");
        const r = book.deliver(cmd.company, p.job.id, cmd.ship);
        if (!r.ok) return r;
        if (p.chapter + 1 >= STORIES[p.story].chapters.length) {
          finished.set(cmd.company, [...(finished.get(cmd.company) ?? []), p.story]);
          progress.delete(cmd.company);
          title(e, cmd.company, STORIES[p.story].name);
          addRep(e, cmd.company, 2);
        } else { p.chapter++; p.job = chapterJob(cmd.company, p.story, p.chapter); }
        return r;
      }
      if (cmd.action === "abandon") {
        if (!p) return fail("you are not in a story");
        if (p.job) book.taken.delete(p.job.id);
        progress.delete(cmd.company); addRep(e, cmd.company, -1);
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      for (const c of book.expire()) {
        const p = progress.get(c.taker!);
        if (p?.job?.id === c.id) p.job = chapterJob(c.taker!, p.story, p.chapter);   // the chapter is offered again
      }
    },
    cards(company) {
      const p = progress.get(company), done = finished.get(company) ?? [];
      if (!p) return [{ title: "Story contracts", detail: `Four-chapter tales told one delivery at a time; the last chapter earns the story's title.${done.length ? `\nFinished: ${done.map(i => STORIES[i].name).join(", ")}.` : ""}`,
        actions: STORIES.map((s, i) => ({ s, i })).filter(x => !done.includes(x.i)).map(x => act(id, `Begin "${x.s.name}"`, "start", { story: x.i })) }];
      const ships = p.job ? companyShips(e, company).filter(s => s.dest === null && s.port === p.job!.to && s.good === p.job!.good && s.qty >= p.job!.qty) : [];
      return [{ title: `Story: ${STORIES[p.story].name}`, detail: p.job ? `${p.job.label}\n${book.describe(p.job)}` : "No job could be drafted for this chapter; try again tomorrow.",
        actions: [...(ships.length ? [act(id, "Deliver this chapter", "deliver", {}, [shipField(ships)])] : []), act(id, "Abandon the story", "abandon")] }];
    },
    view: (company) => ({ progress: progress.get(company) ?? null, finished: finished.get(company) ?? [] }),
  };
};

// ------------------------------------------------------------ 73 passengers

interface Fare { id: number; from: number; to: number; people: number; fare: number; posted: number; deadline: number; ship?: number; owner?: number }
export const passengers: FeatureFactory = (e) => {
  const id = "contracts.passengers";
  let offers: Fare[] = [];
  const aboard = new Map<number, Fare>();   // ship -> fare
  const carried = new Map<number, number>();
  const notes = new Notices();
  const draft = (): Fare | null => {
    const r = () => e.features.random();
    for (let t = 0; t < 8; t++) {
      const from = Math.floor(r() * e.n), to = Math.floor(r() * e.n);
      if (!reachable(e, from, to)) continue;
      const people = 10 + Math.floor(r() * 41), h = freighterHours(e, from, to);
      return { id: ++shared(e).contractSeq, from, to, people, fare: Math.round(people * (6 + h * 0.8)), posted: e.tick, deadline: e.tick + Math.ceil(h * 1.8) + 12 };
    }
    return null;
  };
  const refill = () => { while (offers.length < 4) { const f = draft(); if (!f) break; offers.push(f); } };
  const text = (f: Fare) => `${f.people} passengers ${portName(e, f.from)} → ${portName(e, f.to)} for ${money(f.fare)}`;
  return {
    id, ideas: [73], title: "Ferry and passenger contracts", economy: true,
    enable() { if (!offers.length) refill(); },
    apply(cmd) {
      if (cmd.action !== "board") return fail("unknown action");
      const f = offers.find(o => o.id === cmd.contract);
      if (!f) return fail("those passengers have found another ship");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest !== null || s.port !== f.from) return fail(`the ship must be docked at ${portName(e, f.from)}`);
      if (aboard.has(s.id)) return fail("that ship already has passengers aboard");
      if (s.type === "pirate") return fail("no one boards a pirate ship willingly");
      offers = offers.filter(o => o !== f);
      f.ship = s.id; f.owner = cmd.company; f.deadline += e.tick - f.posted;
      aboard.set(s.id, f);
      return ok;
    },
    advance() {
      for (const [ship, f] of [...aboard]) {
        const s = e.ships.get(ship);
        if (!s || s.owner !== f.owner) { aboard.delete(ship); continue; }
        if (deliveryPay(e, { reward: 1, deadline: f.deadline }) === null && !(s.dest === null && s.port === f.to)) {
          aboard.delete(ship); addRep(e, f.owner!, -1);
          notes.add(e, f.owner!, `Passengers for ${portName(e, f.to)} gave up and went ashore.`); continue;
        }
        if (s.dest === null && s.port === f.to) {
          aboard.delete(ship);
          const pay = deliveryPay(e, { reward: f.fare, deadline: f.deadline });
          if (pay === null) { addRep(e, f.owner!, -1); notes.add(e, f.owner!, `Passengers reached ${portName(e, f.to)} too late and refused to pay.`); continue; }
          e.companies.get(f.owner!)!.cash += pay;
          e.recordSpecialSale(s, 0);
          carried.set(f.owner!, (carried.get(f.owner!) ?? 0) + f.people);
          addRep(e, f.owner!, e.tick <= f.deadline ? 1 : 0);
          notes.add(e, f.owner!, `${text(f)}: fares paid ${money(pay)}.`);
        }
      }
      if (e.tick % 12 === 0) { offers = offers.filter(o => o.posted + 24 > e.tick); refill(); }
    },
    cards(company) {
      const ships = companyShips(e, company).filter(s => s.dest === null && !aboard.has(s.id) && s.type !== "pirate");
      const mine = [...aboard.values()].filter(f => f.owner === company);
      return [{ title: "Passengers", detail: `Passengers take no hold space. Board them at their port; the fare is paid when that ship docks at their destination.${mine.length ? `\nAboard: ${mine.map(f => `ship ${f.ship}: ${text(f)}, ${f.deadline - e.tick} h left`).join("; ")}` : ""}\nCarried so far: ${carried.get(company) ?? 0}.`
        + notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: offers.flatMap(f => { const here = ships.filter(s => s.port === f.from); return here.length ? [act(id, `Board: ${text(f)}`, "board", { contract: f.id }, [shipField(here)])] : []; }) }];
    },
    view: (company) => ({ offers, aboard: [...aboard.values()].filter(f => f.owner === company), carried: carried.get(company) ?? 0 }),
  };
};

// ------------------------------------------------------------ 75 auctions

interface Tender { job: Contract; ceiling: number; closes: number; bids: Map<number, { amount: number; tick: number }> }
export const auctions: FeatureFactory = (e) => {
  const id = "contracts.auctions";
  let tender: Tender | null = null;
  const book = new ContractBook(e, id, 2);
  const results: { job: number; winner: string; amount: number }[] = [];
  const open = () => {
    const job = book.draft("Tendered job", 1.6, 2, 24);
    if (job) tender = { job, ceiling: job.reward, closes: e.tick + 12, bids: new Map() };
  };
  const close = () => {
    const t = tender!;
    tender = null;
    const best = [...t.bids].filter(([c]) => e.companies.has(c)).sort((a, b) => a[1].amount - b[1].amount || a[1].tick - b[1].tick || a[0] - b[0])[0];
    if (!best) return;
    const [company, bid] = best;
    t.job.reward = bid.amount; t.job.taker = company; t.job.accepted = e.tick; t.job.deadline += e.tick - t.job.posted;
    book.taken.set(t.job.id, t.job);
    book.notes.add(e, company, `You won the tender with a bid of ${money(bid.amount)}: ${book.describe(t.job)}.`);
    results.push({ job: t.job.id, winner: e.companies.get(company)!.name, amount: bid.amount });
    if (results.length > 5) results.shift();
  };
  return {
    id, ideas: [75], title: "Contract auctions", economy: true,
    enable() { if (!tender) open(); },
    apply(cmd) {
      if (cmd.action === "bid") {
        const t = tender;
        if (!t) return fail("no tender is open");
        const floor = Math.ceil(t.ceiling * 0.5);
        if (!whole(cmd.amount, floor, t.ceiling)) return fail(`bid a whole amount between ${floor} and ${t.ceiling}`);
        if (book.mine(cmd.company).length >= 2) return fail("finish a won contract before bidding again");
        t.bids.set(cmd.company, { amount: cmd.amount, tick: e.tick });
        return ok;
      }
      if (cmd.action === "deliver" || cmd.action === "abandon") return book.standard(cmd)!;
      return fail("unknown action");
    },
    advance() {
      book.expire();
      if (tender && e.tick >= tender.closes) close();
      if (!tender && e.tick % 12 === 0) open();
    },
    cards(company) {
      const t = tender, mine = t?.bids.get(company);
      return [{ title: "Contract auctions", detail: `Shippers post a job with a top price; captains bid what they would do it for and the lowest bid wins when bidding closes (ties go to the earliest).${t ? `\nOpen: ${book.describe(t.job)} — top price ${money(t.ceiling)}, ${t.bids.size} bids, closes in ${t.closes - e.tick} h.${mine ? ` Your bid: ${money(mine.amount)}.` : ""}` : ""}`
          + book.notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: [...(t ? [act(id, "Place a bid", "bid", {}, [{ key: "amount", label: "Your price", min: Math.ceil(t.ceiling * 0.5), max: t.ceiling, value: Math.round(t.ceiling * 0.9) }])] : []),
          ...book.actions(company, [])] }];
    },
    view: (company) => ({ ...book.view(company), bid: tender?.bids.get(company)?.amount ?? null }),
    world: () => ({ open: tender ? { closes: tender.closes, ceiling: tender.ceiling, bids: tender.bids.size } : null, results }),
  };
};

