// Voyage jobs paid on arrival (ideas 71, 72, 74): escorting a merchant, carrying a smuggled package, recovering a wreck.
// All pay money, so all are economy modules. Arrivals are seen in advance(); departures with DepartureWatch.
import type { FeatureFactory } from "../types.js";
import {
  act, addHeat, addRep, addStanding, companyShips, DepartureWatch, deliveryPay, fail, freighterHours, lanePoint, money, news, Notices, ok,
  ownShip, pickRoute, portName, reachable, shared, shipField, type Pt,
} from "./core.js";

interface Job { id: number; from: number; to: number; pay: number; posted: number; deadline: number; taker?: number; ship?: number; at?: number; where?: Pt }

/** Shared plumbing: offers refreshed every 12 h, at most one held job per company. */
function jobBoard(e: Parameters<FeatureFactory>[0], count: number, make: () => Job | null) {
  let offers: Job[] = [];
  const held = new Map<number, Job>();
  const notes = new Notices();
  return {
    held, notes,
    get offers() { return offers; },
    refill() { offers = offers.filter(o => o.posted + 24 > e.tick); while (offers.length < count) { const j = make(); if (!j) break; offers.push(j); } },
    take(company: number, id: unknown): Job | string {
      const j = offers.find(o => o.id === id);
      if (!j) return "that job is gone";
      if ([...held.values()].some(h => h.taker === company)) return "finish your current job first";
      return j;
    },
    commit(j: Job, company: number) { offers = offers.filter(o => o !== j); j.taker = company; j.at = e.tick; j.deadline += e.tick - j.posted; held.set(j.id, j); },
    mine(company: number) { return [...held.values()].find(h => h.taker === company); },
    expire(onFail: (j: Job) => void) {
      for (const j of [...held.values()]) if (deliveryPay(e, { reward: 1, deadline: j.deadline }) === null) { held.delete(j.id); addRep(e, j.taker!, -1); onFail(j); }
    },
  };
}
const randomTrip = (e: Parameters<FeatureFactory>[0]) => {
  for (let t = 0; t < 8; t++) {
    const a = Math.floor(e.features.random() * e.n), b = Math.floor(e.features.random() * e.n);
    if (reachable(e, a, b)) return { a, b, h: freighterHours(e, a, b) };
  }
  return null;
};

// ------------------------------------------------------------ 71 escort missions

export const escortMissions: FeatureFactory = (e) => {
  const id = "contracts.escort";
  const jobs = jobBoard(e, 3, () => {
    const t = randomTrip(e);
    return t ? { id: ++shared(e).contractSeq, from: t.a, to: t.b, pay: Math.round(80 + t.h * 4), posted: e.tick, deadline: e.tick + t.h + 24 } : null;
  });
  const watch = new DepartureWatch();
  const text = (j: Job) => `merchant ${portName(e, j.from)} → ${portName(e, j.to)} for ${money(j.pay)}`;
  return {
    id, ideas: [71], title: "Escort missions", economy: true,
    enable() { if (!jobs.offers.length) jobs.refill(); },
    apply(cmd) {
      if (cmd.action === "accept") {
        const j = jobs.take(cmd.company, cmd.contract);
        if (typeof j === "string") return fail(j);
        jobs.commit(j, cmd.company);
        return ok;
      }
      if (cmd.action === "drop") {
        const j = jobs.mine(cmd.company);
        if (!j) return fail("you have no escort job");
        jobs.held.delete(j.id); addRep(e, cmd.company, -1);
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of watch.poll(e)) for (const j of jobs.held.values())
        if (j.taker === s.owner && j.ship === undefined && s.port === j.from && s.dest === j.to && s.departTick >= j.at!) j.ship = s.id;
      for (const j of [...jobs.held.values()]) {
        const s = j.ship === undefined ? undefined : e.ships.get(j.ship);
        if (j.ship !== undefined && (!s || s.owner !== j.taker)) { jobs.held.delete(j.id); addRep(e, j.taker!, -1); continue; }
        if (s && s.dest === null && s.port === j.to) {
          jobs.held.delete(j.id);
          const pay = deliveryPay(e, { reward: j.pay, deadline: j.deadline });
          if (pay === null) continue;
          e.companies.get(j.taker!)!.cash += pay;
          addRep(e, j.taker!, 1); addStanding(e, j.taker!, "navy", 2);
          jobs.notes.add(e, j.taker!, `Escorted the ${text(j)}: paid ${money(pay)}.`);
        }
      }
      jobs.expire(j => jobs.notes.add(e, j.taker!, `The ${text(j)} sailed without you.`));
      if (e.tick % 12 === 0) jobs.refill();
    },
    cards(company) {
      const j = jobs.mine(company);
      return [{ title: "Escort missions", detail: `Sail one of your ships alongside a merchant from its port to its destination; you are paid when your ship docks there.${j ? `\nYour job: ${text(j)}${j.ship ? ` (ship ${j.ship} escorting)` : ` — sail any ship from ${portName(e, j.from)} to ${portName(e, j.to)}`}, ${j.deadline - e.tick} h left.` : ""}`
          + jobs.notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: j ? [act(id, "Drop the job (costs reputation)", "drop")] : jobs.offers.map(o => act(id, `Accept: ${text(o)}`, "accept", { contract: o.id })) }];
    },
    view: (company) => ({ offers: jobs.offers, held: jobs.mine(company) ?? null }),
  };
};

// ------------------------------------------------------------ 72 smuggling

export const smuggling: FeatureFactory = (e) => {
  const id = "contracts.smuggling";
  const jobs = jobBoard(e, 2, () => {
    const t = randomTrip(e);
    return t ? { id: ++shared(e).contractSeq, from: t.a, to: t.b, pay: Math.round(300 + t.h * 12), posted: e.tick, deadline: e.tick + Math.ceil(t.h * 1.5) + 12 } : null;
  });
  const runs = new Map<number, number>();
  const text = (j: Job) => `a sealed crate ${portName(e, j.from)} → ${portName(e, j.to)} for ${money(j.pay)}`;
  const clear = (j: Job) => { jobs.held.delete(j.id); if (j.ship !== undefined && shared(e).contraband.get(j.ship)?.contract === j.id) shared(e).contraband.delete(j.ship); };
  return {
    id, ideas: [72], title: "Smuggling contracts", economy: true,
    enable() { if (!jobs.offers.length) jobs.refill(); },
    apply(cmd) {
      if (cmd.action === "load") {
        const j = jobs.take(cmd.company, cmd.contract);
        if (typeof j === "string") return fail(j);
        const s = ownShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (s.dest !== null || s.port !== j.from) return fail(`the crate waits at ${portName(e, j.from)}`);
        if (shared(e).contraband.has(s.id)) return fail("that ship already hides a crate");
        jobs.commit(j, cmd.company);
        j.ship = s.id;
        shared(e).contraband.set(s.id, { contract: j.id, owner: cmd.company });
        return ok;
      }
      if (cmd.action === "dump") {
        const j = jobs.mine(cmd.company);
        if (!j) return fail("you carry no crate");
        clear(j); addStanding(e, cmd.company, "syndicate", -5);
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      const cb = shared(e).contraband;
      for (const j of [...jobs.held.values()]) {
        const s = e.ships.get(j.ship!);
        if (!s || s.owner !== j.taker || cb.get(s.id)?.contract !== j.id) {   // seized by an inspection, sold or lost
          clear(j); addRep(e, j.taker!, -1); addStanding(e, j.taker!, "syndicate", -3);
          jobs.notes.add(e, j.taker!, `The crate for ${portName(e, j.to)} is lost.`); continue;
        }
        if (s.dest === null && s.port === j.to) {
          clear(j);
          const pay = deliveryPay(e, { reward: j.pay, deadline: j.deadline });
          if (pay === null) continue;
          e.companies.get(j.taker!)!.cash += pay;
          runs.set(j.taker!, (runs.get(j.taker!) ?? 0) + 1);
          addHeat(e, j.taker!, 6); addStanding(e, j.taker!, "syndicate", 5);
          jobs.notes.add(e, j.taker!, `Delivered ${text(j)}. No questions asked.`);
          news(e, "smuggling", `Harbour gossip at ${portName(e, j.to)}: a crate came ashore at night and nobody saw a thing.`, j.to);
        }
      }
      jobs.expire(j => { clear(j); jobs.notes.add(e, j.taker!, `The buyer at ${portName(e, j.to)} gave up waiting.`); });
      if (e.tick % 12 === 0) jobs.refill();
    },
    cards(company) {
      const j = jobs.mine(company);
      const ships = companyShips(e, company).filter(s => s.dest === null && !shared(e).contraband.has(s.id));
      return [{ title: "Smuggling", detail: `The syndicate pays well for a crate carried quietly (no hold space). Paid when the ship docks at the destination; an inspection on the way seizes it and raises your wanted heat.${j ? `\nAboard ship ${j.ship}: ${text(j)}, ${j.deadline - e.tick} h left.` : ""} Runs done: ${runs.get(company) ?? 0}.`
          + jobs.notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: j ? [act(id, "Dump the crate overboard", "dump")]
          : jobs.offers.flatMap(o => { const here = ships.filter(s => s.port === o.from); return here.length ? [act(id, `Load: ${text(o)}`, "load", { contract: o.id }, [shipField(here)])] : []; }) }];
    },
    view: (company) => ({ offers: jobs.offers, held: jobs.mine(company) ?? null, runs: runs.get(company) ?? 0 }),
  };
};

// ------------------------------------------------------------ 74 wreck salvage

export const salvage: FeatureFactory = (e) => {
  const id = "contracts.salvage";
  const jobs = jobBoard(e, 2, () => {
    if (!e.map.routes.length) return null;
    const { a, b } = pickRoute(e, 0x53414c56, e.tick, Math.floor(e.features.random() * 1e6));
    const p = lanePoint(e, a, b, 0.5);
    return { id: ++shared(e).contractSeq, from: a, to: b, pay: Math.round(150 + e.features.random() * 350), posted: e.tick, deadline: e.tick + 96, where: { x: Math.round(p.x), y: Math.round(p.y) } };
  });
  const watch = new DepartureWatch();
  const text = (j: Job) => `wreck between ${portName(e, j.from)} and ${portName(e, j.to)}, salvage worth ${money(j.pay)}`;
  return {
    id, ideas: [74], title: "Wreck salvage contracts", economy: true,
    enable() { if (!jobs.offers.length) jobs.refill(); },
    apply(cmd) {
      if (cmd.action === "accept") {
        const j = jobs.take(cmd.company, cmd.contract);
        if (typeof j === "string") return fail(j);
        jobs.commit(j, cmd.company);
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of watch.poll(e)) for (const j of jobs.held.values())
        if (j.taker === s.owner && j.ship === undefined && s.departTick >= j.at! && ((s.port === j.from && s.dest === j.to) || (s.port === j.to && s.dest === j.from))) j.ship = s.id;
      for (const j of [...jobs.held.values()]) {
        const s = j.ship === undefined ? undefined : e.ships.get(j.ship);
        if (s && s.dest === null && s.owner === j.taker) {
          jobs.held.delete(j.id);
          e.companies.get(j.taker!)!.cash += j.pay;
          addRep(e, j.taker!, 1);
          jobs.notes.add(e, j.taker!, `Ship ${s.id} raised the ${text(j)}.`);
          news(e, "salvage", `Divers raised a wreck between ${portName(e, j.from)} and ${portName(e, j.to)}.`);
        }
      }
      jobs.expire(j => jobs.notes.add(e, j.taker!, `Another crew got to the ${text(j)} first.`));
      if (e.tick % 12 === 0) jobs.refill();
    },
    cards(company) {
      const j = jobs.mine(company);
      return [{ title: "Wreck salvage", detail: `Sail a ship along the lane where a wreck lies (either way); salvage is paid when it docks.${j ? `\nYour job: ${text(j)}${j.ship ? ` (ship ${j.ship} on the way)` : ""}, ${j.deadline - e.tick} h left.` : ""}`
          + jobs.notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: j ? [] : jobs.offers.map(o => act(id, `Accept: ${text(o)}`, "accept", { contract: o.id })) }];
    },
    view: (company) => ({ offers: jobs.offers, held: jobs.mine(company) ?? null }),
    world: () => ({ wrecks: [...jobs.offers, ...jobs.held.values()].map(j => j.where) }),
  };
};
