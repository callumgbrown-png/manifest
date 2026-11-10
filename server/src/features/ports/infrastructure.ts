import type { FeatureAction } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { reclamationLevel } from "./projects.js";
import { addRep, arrivals, dockedAt, fail, isPort, ownDocked, portName, shipOptions, workShip } from "./shared.js";

const DOCK_COST = 1500, CRANE_COST = 1000, PILOT_FEE = 40, PRIORITY_FEE = 60;

/** 41 dock tiers, 42 faster cranes, 43 dock queues, 55 harbour pilots, 268 harbour master priority berths. */
export const infrastructure: FeatureFactory = (e) => {
  const tiers = new Map<number, number>(), cranes = new Map<number, number>();
  const pilots = new Set<number>(), priority = new Set<number>();
  const docks = (port: number) => 2 + 2 * (tiers.get(port) ?? 0) + 2 * reclamationLevel(e, port);
  /** Ships already docked or heading in, beyond the docks, each add an hour (shared out by the cranes). */
  const queueHours = (port: number) => {
    const using = dockedAt(e, port) + [...e.ships.values()].filter(s => s.dest === port).length;
    const excess = Math.max(0, using - docks(port));
    return Math.min(12, Math.ceil(excess / (1 + (cranes.get(port) ?? 0))));
  };
  return {
    id: "ports.infrastructure", ideas: [41, 42, 43, 55, 268], title: "Docks, cranes and pilots", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "fundDocks" || cmd.action === "fundCranes") {
        if (!isPort(e, cmd.port) || !ownDocked(e, c.id, cmd.port).length) return fail("dock a ship at that port first");
        const docksJob = cmd.action === "fundDocks", map = docksJob ? tiers : cranes;
        const level = map.get(cmd.port) ?? 0, max = docksJob ? 3 : 2;
        if (level >= max) return fail("that port is fully built");
        const cost = (docksJob ? DOCK_COST : CRANE_COST) * (level + 1);
        if (c.cash < cost) return fail("not enough cash");
        c.cash -= cost;
        map.set(cmd.port, level + 1);
        addRep(e, c.id, cmd.port, 20);
        return { ok: true, spent: cost };
      }
      if (cmd.action === "bookPilot" || cmd.action === "bookPriority") {
        const s = workShip(e, c.id, cmd.ship), pilot = cmd.action === "bookPilot";
        if (!s) return fail("choose one of your docked ships");
        const set = pilot ? pilots : priority, fee = pilot ? PILOT_FEE : PRIORITY_FEE;
        if (set.has(s.id)) return fail("already booked for the next arrival");
        if (c.cash < fee) return fail("not enough cash");
        c.cash -= fee;
        set.add(s.id);
        return { ok: true, spent: fee };
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of arrivals(e)) { pilots.delete(s.id); priority.delete(s.id); }
      for (const id of [...pilots, ...priority]) if (!e.ships.has(id)) { pilots.delete(id); priority.delete(id); }
    },
    adjust: {
      travelHours(v, ctx) {
        let hours = v - (cranes.get(ctx.from) ?? 0) - (pilots.has(ctx.ship) ? 1 : 0);
        if (!priority.has(ctx.ship)) hours += queueHours(ctx.dest);
        return Math.max(1, hours);
      },
    },
    cards(company) {
      const c = e.companies.get(company)!;
      const ports = [...new Set(c.ships.map(id => e.ships.get(id)!).filter(s => s.dest === null).map(s => s.port))];
      return ports.map(port => {
        const tier = tiers.get(port) ?? 0, crane = cranes.get(port) ?? 0, ships = ownDocked(e, company, port);
        const actions: FeatureAction[] = [];
        if (tier < 3) actions.push({ label: `Fund dock tier ${tier + 1} (${DOCK_COST * (tier + 1)})`, command: { type: "feature", module: "ports.infrastructure", action: "fundDocks", port } });
        if (crane < 2) actions.push({ label: `Fund faster cranes (${CRANE_COST * (crane + 1)})`, command: { type: "feature", module: "ports.infrastructure", action: "fundCranes", port } });
        if (ships.length) {
          actions.push({ label: `Book a harbour pilot (${PILOT_FEE})`, command: { type: "feature", module: "ports.infrastructure", action: "bookPilot" }, fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] });
          actions.push({ label: `Harbour master priority berth (${PRIORITY_FEE})`, command: { type: "feature", module: "ports.infrastructure", action: "bookPriority" }, fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] });
        }
        return { title: `Harbour works · ${portName(e, port)}`, actions,
          detail: `${docks(port)} docks, crane level ${crane}. Arrivals now queue ${queueHours(port)} h. A pilot saves an hour on your next arrival; a priority berth skips the queue.` };
      });
    },
    world() { return { docks: e.map.ports.map(p => docks(p.id)), cranes: e.map.ports.map(p => cranes.get(p.id) ?? 0) }; },
    view(company) { const mine = (id: number) => e.ships.get(id)?.owner === company; return { pilots: [...pilots].filter(mine), priority: [...priority].filter(mine) }; },
  };
};
