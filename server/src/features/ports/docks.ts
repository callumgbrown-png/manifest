import type { Engine } from "../../engine.js";
import type { FeatureAction } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { reclamationLevel } from "./projects.js";
import { action, addRep, arrivals, dockedAt, dockedPorts, fail, isPort, ownDocked, portName, shared, shipOptions, workShip } from "./shared.js";

export const DOCK_COST = 1500, PRIORITY_FEE = 60, BASE_DOCKS = 2;

/** Docks at a port: two to start, two per funded tier, two per level of land reclamation. */
export const docksAt = (tiers: Map<number, number>, e: Engine, port: number) =>
  BASE_DOCKS + 2 * (tiers.get(port) ?? 0) + 2 * reclamationLevel(e, port);

/** 41 dock tiers, 43 dock queues, 268 harbour master priority berths. Economy: costs money and changes travel time. */
export const docks: FeatureFactory = (e) => {
  const id = "ports.docks";
  const tiers = new Map<number, number>();
  const priority = new Set<number>();
  /** Ships docked or heading in beyond the docks each add an hour, shared out by the port's cranes. Max 12 h. */
  const queueHours = (port: number) => {
    let inbound = 0;
    for (const s of e.ships.values()) if (s.dest === port) inbound++;
    const excess = Math.max(0, dockedAt(e, port) + inbound - docksAt(tiers, e, port));
    return Math.min(12, Math.ceil(excess / (1 + (shared(e).cranes.get(port) ?? 0))));
  };
  return {
    id, ideas: [41, 43, 268], title: "Docks and the harbour master", economy: true,
    queueHours,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "fundDocks") {
        if (!isPort(e, cmd.port) || !ownDocked(e, c.id, cmd.port).length) return fail("dock a ship at that port first");
        const level = tiers.get(cmd.port) ?? 0;
        if (level >= 3) return fail("that port has all its docks");
        const cost = DOCK_COST * (level + 1);
        if (c.cash < cost) return fail("not enough cash");
        c.cash -= cost;
        tiers.set(cmd.port, level + 1);
        addRep(e, c.id, cmd.port, 20);
        return { ok: true, spent: cost };
      }
      if (cmd.action === "bookPriority") {
        const s = workShip(e, c.id, cmd.ship);
        if (!s) return fail("choose one of your docked ships");
        if (priority.has(s.id)) return fail("already booked for the next arrival");
        if (c.cash < PRIORITY_FEE) return fail("not enough cash");
        c.cash -= PRIORITY_FEE;
        priority.add(s.id);
        return { ok: true, spent: PRIORITY_FEE };
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of arrivals(e)) priority.delete(s.id);
      for (const sid of priority) if (!e.ships.has(sid)) priority.delete(sid);
    },
    adjust: {
      travelHours: (v, ctx) => priority.has(ctx.ship) ? v : v + queueHours(ctx.dest),
    },
    cards(company) {
      return dockedPorts(e, company).map(port => {
        const tier = tiers.get(port) ?? 0, ships = ownDocked(e, company, port);
        const actions: FeatureAction[] = [];
        if (tier < 3) actions.push(action(id, `Fund dock tier ${tier + 1} (${DOCK_COST * (tier + 1)})`, "fundDocks", { port }));
        if (ships.length) actions.push({ ...action(id, `Harbour master priority berth (${PRIORITY_FEE})`, "bookPriority"), fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] });
        return { title: `Docks · ${portName(e, port)}`, actions,
          detail: `${docksAt(tiers, e, port)} docks. Arrivals now queue ${queueHours(port)} h (more cranes share the wait out). A priority berth skips the queue on your next arrival.` };
      });
    },
    world() { return { docks: e.map.ports.map(p => docksAt(tiers, e, p.id)), queue: e.map.ports.map(p => queueHours(p.id)) }; },
    view(company) { return { priority: [...priority].filter(s => e.ships.get(s)?.owner === company) }; },
  } as ReturnType<FeatureFactory> & { queueHours(port: number): number };
};
