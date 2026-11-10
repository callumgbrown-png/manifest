import type { Engine, ShipType } from "../../engine.js";
import { SHIP_TYPES } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, addRep, day, dockedPorts, exhibit, fail, hash, isPort, ownDocked, peer, portName, shipOptions, sites, workShip } from "./shared.js";

/** Today's fuel price factor at a port: 0.85 to 1.20, the same for every server and replay. */
export const fuelFactor = (e: Engine, port: number) => Math.round((0.85 + 0.35 * hash(41, port, day(e))) * 100) / 100;

/** 46 fuel stations with variable prices. Fuel bought when leaving a port costs that port's factor. Economy. */
export const fuelStations: FeatureFactory = (e) => ({
  id: "ports.fuel-stations", ideas: [46], title: "Fuel stations", economy: true,
  adjust: { fuel: (v, ctx) => v * fuelFactor(e, ctx.from) },
  cards(company) {
    const ports = dockedPorts(e, company);
    if (!ports.length) return [];
    return [{ title: "Fuel prices today", detail: ports.map(p => `${portName(e, p)}: ${Math.round(fuelFactor(e, p) * 100)}% of the usual price`).join("\n") + "\nPrices change at midnight. Fill up where it is cheap." }];
  },
  world: () => ({ factor: e.map.ports.map(p => fuelFactor(e, p.id)) }),
});

export const BUILD_HOURS = 48, BUILD_SHARE = 0.9;
export const shipyardPorts = (e: Engine) => sites(e, 31, 0.3);

/** 47 shipyards that build ships: order a hull at a yard for 90% of the list price; it launches after 48 hours. Economy. */
export const shipyards: FeatureFactory = (e) => {
  const id = "ports.shipyards";
  const orders: { company: number; port: number; type: ShipType; due: number }[] = [];
  const buildable = (t: unknown): t is ShipType => typeof t === "string" && (SHIP_TYPES as readonly string[]).includes(t) && t !== "pirate"
    && (t === "freighter" || !!e.rules.ship_types?.[t as ShipType]);
  return {
    id, ideas: [47], title: "Shipyards", economy: true,
    apply(cmd) {
      if (cmd.action !== "order") return fail("unknown action");
      const c = e.companies.get(cmd.company)!;
      if (!isPort(e, cmd.port) || !shipyardPorts(e).includes(cmd.port)) return fail("there is no shipyard there");
      if (!ownDocked(e, c.id, cmd.port).length) return fail("dock a ship at the yard first");
      if (!buildable(cmd.shipType)) return fail("the yard cannot build that");
      const pending = orders.filter(o => o.company === c.id).length;
      if (c.ships.length + pending >= e.rules.company.max_ships) return fail("fleet is at its maximum");
      if (pending >= 2) return fail("the yards are already building two hulls for you");
      const price = Math.round(e.spec(cmd.shipType).price * BUILD_SHARE);
      if (c.cash < price) return fail("not enough cash");
      c.cash -= price;
      orders.push({ company: c.id, port: cmd.port, type: cmd.shipType, due: e.tick + BUILD_HOURS });
      return { ok: true, spent: price };
    },
    advance() {
      for (let i = orders.length - 1; i >= 0; i--) {
        const o = orders[i];
        if (o.due > e.tick) continue;
        orders.splice(i, 1);
        const c = e.companies.get(o.company);
        if (!c || c.ships.length >= e.rules.company.max_ships) { if (c) c.cash += Math.round(e.spec(o.type).price * BUILD_SHARE); continue; }
        e.addExpansionShip(c, o.port, o.type);
        addRep(e, c.id, o.port, 5);
        exhibit(e, "launch", c.id, `${c.name} launched a new ${o.type} at ${portName(e, o.port)}`);
      }
    },
    cards(company) {
      const yards = shipyardPorts(e).filter(p => dockedPorts(e, company).includes(p));
      const mine = orders.filter(o => o.company === company);
      const types = SHIP_TYPES.filter(buildable);
      const cards = yards.map(port => ({ title: `Shipyard · ${portName(e, port)}`,
        detail: `Build a hull here for ${Math.round(BUILD_SHARE * 100)}% of the list price. It launches in ${BUILD_HOURS} hours.`,
        actions: [{ ...action(id, "Order a ship", "order", { port }), fields: [{ key: "shipType", label: "Class", options: types.map(t => ({ value: t, label: `${t} (${Math.round(e.spec(t).price * BUILD_SHARE)})` })) }] }] }));
      if (mine.length) cards.push({ title: "Ships on the slipway", detail: mine.map(o => `${o.type} at ${portName(e, o.port)}: ${o.due - e.tick} h left`).join("\n"), actions: [] });
      return cards;
    },
    view: (company) => orders.filter(o => o.company === company).map(o => ({ port: o.port, type: o.type, due: o.due })),
    world: () => ({ yards: shipyardPorts(e) }),
  };
};

export const REPAIR_HOURS = 12;
export const repairYardPorts = (e: Engine) => sites(e, 43, 0.35);
interface WearPeer { condition(ship: number): number; repairTo?(ship: number, to: number): void }

/** 48 repair yards: a free hull survey and a 12-hour overhaul (yard time, no money). The overhaul restores hull
 *  condition when ships.wear is on and offers repairTo; otherwise it is a service record and a little standing. */
export const repairYards: FeatureFactory = (e) => {
  const id = "ports.repair-yards";
  const jobs = new Map<number, { port: number; due: number }>();
  const serviced = new Map<number, number>();             // ship -> tick of last overhaul
  return {
    id, ideas: [48], title: "Repair yards", economy: false,
    apply(cmd) {
      const s = workShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your docked ships");
      if (cmd.action === "overhaul") {
        if (!repairYardPorts(e).includes(s.port)) return fail("there is no repair yard here");
        if (jobs.has(s.id)) return fail("that ship is already in the yard");
        if ((serviced.get(s.id) ?? -1e9) > e.tick - 72) return fail("that ship was overhauled in the last three days");
        jobs.set(s.id, { port: s.port, due: e.tick + REPAIR_HOURS });
        return { ok: true };
      }
      if (cmd.action === "cancel") return jobs.delete(s.id) ? { ok: true } : fail("that ship is not in the yard");
      return fail("unknown action");
    },
    advance() {
      for (const [sid, job] of jobs) {
        const s = e.ships.get(sid);
        if (!s || s.dest !== null || s.port !== job.port) { jobs.delete(sid); continue; }    // sailed: job abandoned
        if (job.due > e.tick) continue;
        jobs.delete(sid);
        serviced.set(sid, e.tick);
        peer<WearPeer>(e, "ships.wear")?.repairTo?.(sid, 100);
        addRep(e, s.owner, s.port, 2);
      }
    },
    cards(company) {
      const yards = repairYardPorts(e);
      const wear = peer<WearPeer>(e, "ships.wear");
      return dockedPorts(e, company).filter(p => yards.includes(p)).map(port => {
        const ships = ownDocked(e, company, port).filter(s => !jobs.has(s.id));
        const survey = ownDocked(e, company, port).map(s => `#${s.id}: ${wear ? `hull ${Math.round(wear.condition(s.id))}%` : "sound"}${jobs.has(s.id) ? ` (in the yard, ${jobs.get(s.id)!.due - e.tick} h)` : ""}`);
        return { title: `Repair yard · ${portName(e, port)}`,
          detail: `Free survey: ${survey.join(", ") || "no ships"}. An overhaul takes ${REPAIR_HOURS} hours in port; sailing early abandons it.`,
          actions: ships.length ? [{ ...action(id, "Start an overhaul", "overhaul"), fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] }] : [] };
      });
    },
    view: (company) => ({ jobs: [...jobs].filter(([s]) => e.ships.get(s)?.owner === company).map(([ship, j]) => ({ ship, due: j.due })),
      serviced: [...serviced].filter(([s]) => e.ships.get(s)?.owner === company).map(([ship, tick]) => ({ ship, tick })) }),
    world: () => ({ yards: repairYardPorts(e) }),
  };
};
