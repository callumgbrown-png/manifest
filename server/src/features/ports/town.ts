import { GOODS, type Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import {
  action, addRep, arrivals, connected, content, crewPerk, day, dockedPorts, exhibit, fail, hasResearch, hash, inRange,
  isPort, ownDocked, portName, shared, shipOptions, sites, workShip,
} from "./shared.js";

/** Free daily gossip: which port is shortest of a good (stock against its usual level). */
export function gossip(e: Engine, salt: number): string {
  const ports = connected(e);
  if (!ports.length) return "The tavern is quiet tonight.";
  const g = Math.floor(hash(109, day(e), salt) * GOODS.length);
  let worst = ports[0];
  for (const p of ports) if (e.stock[p][g] < e.stock[worst][g]) worst = p;
  return `Sailors say ${portName(e, worst)} is running short of ${GOODS[g]}.`;
}

/** 261 a tavern for rumours and hiring: free gossip each day and a crew member per ship with a small, non-economic perk. */
export const tavern: FeatureFactory = (e) => {
  const id = "ports.tavern";
  const crew = shared(e).crew;
  return {
    id, ideas: [261], title: "Tavern", economy: false,
    apply(cmd) {
      const s = workShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your docked ships");
      if (cmd.action === "hire") {
        if (!inRange(cmd.crew, 0, content.crew.length - 1)) return fail("choose someone in the tavern");
        if (crew.has(s.id)) return fail("that ship already has a hand from the tavern");
        crew.set(s.id, cmd.crew);
        return { ok: true };
      }
      if (cmd.action === "dismiss") return crew.delete(s.id) ? { ok: true } : fail("nobody to dismiss");
      return fail("unknown action");
    },
    advance() { if (e.tick % 24 === 0) for (const sid of crew.keys()) if (!e.ships.has(sid)) crew.delete(sid); },
    cards(company) {
      const ports = dockedPorts(e, company);
      if (!ports.length) return [];
      const own = e.companies.get(company)?.ships ?? [];
      const lines = [gossip(e, 0)];
      if (own.some(sid => crewPerk(e, sid) === "ledger")) lines.push(gossip(e, 1));
      if (hasResearch(e, company, "survey")) lines.push(gossip(e, 2));
      const free = ports.flatMap(p => ownDocked(e, company, p)).filter(s => !crew.has(s.id));
      const hired = own.filter(sid => crew.has(sid)).map(sid => `#${sid}: ${content.crew[crew.get(sid)!].name} (${content.crew[crew.get(sid)!].role})`);
      return [{ title: "The tavern", detail: `${lines.join("\n")}\nFor hire: ${content.crew.map(c => `${c.name}, ${c.role.toLowerCase()}: ${c.text}`).join("; ")}.${hired.length ? `\nAboard: ${hired.join(", ")}` : ""}`,
        actions: free.length ? [{ ...action(id, "Hire a hand", "hire"), fields: [{ key: "ship", label: "Ship", options: shipOptions(free) },
          { key: "crew", label: "Who", options: content.crew.map((c, i) => ({ value: i, label: `${c.name} (${c.role})` })) }] }] : [] }];
    },
    view: (company) => (e.companies.get(company)?.ships ?? []).filter(sid => crew.has(sid)).map(sid => ({ ship: sid, crew: crew.get(sid) })),
  };
};

/** 262 market stalls: set up a stall with a banner at up to three ports. Each stall earns a point of standing daily. */
export const stalls: FeatureFactory = (e) => {
  const id = "ports.stalls";
  const list: { company: number; port: number; banner: number }[] = [];
  return {
    id, ideas: [262], title: "Market stalls", economy: false,
    apply(cmd) {
      if (cmd.action === "open") {
        if (!isPort(e, cmd.port) || !ownDocked(e, cmd.company, cmd.port).length) return fail("dock a ship there first");
        if (!inRange(cmd.banner, 0, content.banners.length - 1)) return fail("choose a banner");
        if (list.some(s => s.company === cmd.company && s.port === cmd.port)) return fail("you already have a stall here");
        if (list.filter(s => s.company === cmd.company).length >= 3) return fail("you can run three stalls");
        list.push({ company: cmd.company, port: cmd.port, banner: cmd.banner });
        return { ok: true };
      }
      if (cmd.action === "close") {
        const i = list.findIndex(s => s.company === cmd.company && s.port === cmd.port);
        if (i < 0) return fail("you have no stall there");
        list.splice(i, 1);
        return { ok: true };
      }
      return fail("unknown action");
    },
    advance() { if (e.tick % 24 === 0) for (const s of list) addRep(e, s.company, s.port, 1); },
    cards(company) {
      const mine = list.filter(s => s.company === company);
      const open = dockedPorts(e, company).filter(p => !mine.some(s => s.port === p));
      return [{ title: "Market stalls", detail: `Your stalls: ${mine.map(s => `${portName(e, s.port)} (${content.banners[s.banner]})`).join(", ") || "none"}. Each stall wins you a point of standing there every day.`,
        actions: [
          ...(mine.length < 3 ? open.map(port => ({ ...action(id, `Open a stall at ${portName(e, port)}`, "open", { port }), fields: [{ key: "banner", label: "Banner", options: content.banners.map((b, i) => ({ value: i, label: b })) }] })) : []),
          ...mine.map(s => action(id, `Close the stall at ${portName(e, s.port)}`, "close", { port: s.port })),
        ] }];
    },
    world: () => ({ stalls: list.map(s => ({ port: s.port, banner: s.banner, owner: e.companies.get(s.company)?.name ?? "?" })) }),
  };
};

export const chandleryPorts = (e: Engine) => sites(e, 103, 0.5);
export const STORES_MAX = 10;

/** 265 a chandlery: keep ships' stores topped up (free, at chandlery ports). Stores run down a day's worth per day at
 *  sea; a well-found ship earns a point of standing when it arrives. */
export const chandlery: FeatureFactory = (e) => {
  const id = "ports.chandlery";
  const stores = new Map<number, number>();
  return {
    id, ideas: [265], title: "Chandlery", economy: false,
    apply(cmd) {
      if (cmd.action !== "stock") return fail("unknown action");
      const s = workShip(e, cmd.company, cmd.ship);
      if (!s || !chandleryPorts(e).includes(s.port)) return fail("choose a ship docked at a chandlery port");
      stores.set(s.id, STORES_MAX);
      return { ok: true };
    },
    advance() {
      for (const s of arrivals(e)) if ((stores.get(s.id) ?? 0) > 0) addRep(e, s.owner, s.port, 1);
      if (e.tick % 24 === 0) for (const [sid, n] of stores) {
        const s = e.ships.get(sid);
        if (!s) stores.delete(sid);
        else if (s.dest !== null) stores.set(sid, Math.max(0, n - 1));
      }
    },
    cards(company) {
      const here = dockedPorts(e, company).filter(p => chandleryPorts(e).includes(p));
      const ships = here.flatMap(p => ownDocked(e, company, p)).filter(s => (stores.get(s.id) ?? 0) < STORES_MAX);
      const lines = (e.companies.get(company)?.ships ?? []).map(sid => `#${sid}: ${stores.get(sid) ?? 0} days of stores`);
      return [{ title: "Chandlery", detail: `${lines.join(", ")}. Chandleries: ${chandleryPorts(e).map(p => portName(e, p)).join(", ")}.`,
        actions: ships.length ? [{ ...action(id, "Top up stores", "stock"), fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] }] : [] }];
    },
    view: (company) => (e.companies.get(company)?.ships ?? []).map(sid => ({ ship: sid, stores: stores.get(sid) ?? 0 })),
  };
};

export const cruisePorts = (e: Engine) => sites(e, 107, 0.25);
export const TOUR_HOURS = 3;
/** Where today's liner calls. */
export const linerAt = (e: Engine, d = day(e)) => { const t = cruisePorts(e); return t.length ? t[Math.floor(hash(113, d) * t.length)] : undefined; };

/** 276 a cruise terminal: a liner calls at one terminal each day. Welcome it once for standing, or take passengers on
 *  a three-hour harbour tour in an empty ship. */
export const cruise: FeatureFactory = (e) => {
  const id = "ports.cruise";
  const welcomed = new Map<number, number>();
  const tours = new Map<number, { port: number; due: number }>();
  const done = new Map<number, number>();
  return {
    id, ideas: [276], title: "Cruise terminal", economy: false,
    apply(cmd) {
      const port = linerAt(e);
      if (port === undefined) return fail("no liner today");
      if (cmd.action === "welcome") {
        if (!ownDocked(e, cmd.company, port).length) return fail(`dock a ship at ${portName(e, port)}`);
        if (welcomed.get(cmd.company) === day(e)) return fail("you welcomed today's liner already");
        welcomed.set(cmd.company, day(e));
        addRep(e, cmd.company, port, 2);
        return { ok: true };
      }
      if (cmd.action === "tour") {
        const s = workShip(e, cmd.company, cmd.ship, port);
        if (!s || s.qty > 0) return fail("choose an empty ship docked where the liner is");
        if (tours.has(s.id)) return fail("that ship is already out on a tour");
        tours.set(s.id, { port, due: e.tick + TOUR_HOURS });
        return { ok: true };
      }
      return fail("unknown action");
    },
    advance() {
      for (const [sid, t] of tours) {
        const s = e.ships.get(sid);
        if (!s || s.dest !== null || s.port !== t.port || s.qty > 0) { tours.delete(sid); continue; }
        if (t.due > e.tick) continue;
        tours.delete(sid);
        addRep(e, s.owner, t.port, 3);
        const n = (done.get(s.owner) ?? 0) + 1;
        done.set(s.owner, n);
        if (n === 10) exhibit(e, "tours", s.owner, `${e.companies.get(s.owner)?.name} ran ten harbour tours`);
      }
    },
    cards(company) {
      const port = linerAt(e);
      if (port === undefined) return [];
      const empty = ownDocked(e, company, port).filter(s => !s.qty && !tours.has(s.id));
      const here = ownDocked(e, company, port).length > 0;
      return [{ title: "Cruise liner", detail: `Today the liner calls at ${portName(e, port)}; tomorrow at ${portName(e, linerAt(e, day(e) + 1)!)}. Tours run ${TOUR_HOURS} hours in an empty ship.`,
        actions: [
          ...(here && welcomed.get(company) !== day(e) ? [action(id, "Welcome the liner", "welcome")] : []),
          ...(empty.length ? [{ ...action(id, "Run a harbour tour", "tour"), fields: [{ key: "ship", label: "Ship", options: shipOptions(empty) }] }] : []),
        ] }];
    },
    view: (company) => ({ tours: done.get(company) ?? 0 }),
    world: () => ({ terminals: cruisePorts(e), liner: linerAt(e) ?? null }),
  };
};
