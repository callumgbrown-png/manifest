import type { FeatureAction } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { GOOD, action, addRep, arrivals, day, dockedPorts, exhibit, fail, isPort, ownDocked, portName, shared, shipOptions, takeCargo, workShip } from "./shared.js";

export const CRANE_MACHINERY = 10, MAX_CRANES = 2, PILOTS_PER_DAY = 3;

/** 42 faster cranes (built with donated machinery, no money), 55 harbour pilots (free, three per port per day).
 *  The time they save is in ports.harbour-effects (economy, off). Here a pilot also earns a little standing. */
export const cranes: FeatureFactory = (e) => {
  const id = "ports.cranes";
  const levels = shared(e).cranes, pilots = shared(e).pilots;
  const progress = new Map<number, number>();            // port -> machinery delivered toward the next level
  const booked = new Map<number, { day: number; n: number }>();
  const pilotsLeft = (port: number) => { const b = booked.get(port); return PILOTS_PER_DAY - (b && b.day === day(e) ? b.n : 0); };
  return {
    id, ideas: [42, 55], title: "Cranes and harbour pilots", economy: false,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "donate") {
        if (!isPort(e, cmd.port)) return fail("choose a port");
        const level = levels.get(cmd.port) ?? 0;
        if (level >= MAX_CRANES) return fail("that port has its fastest cranes");
        const s = workShip(e, c.id, cmd.ship, cmd.port);
        if (!s || s.good !== GOOD.machinery || s.qty < 1) return fail("dock a ship carrying machinery at that port");
        const need = CRANE_MACHINERY * (level + 1) - (progress.get(cmd.port) ?? 0);
        const qty = Math.min(need, s.qty);
        takeCargo(e, s, qty);
        addRep(e, c.id, cmd.port, qty);
        if (qty === need) {
          levels.set(cmd.port, level + 1);
          progress.delete(cmd.port);
          exhibit(e, "cranes", c.id, `${c.name} completed crane level ${level + 1} at ${portName(e, cmd.port)}`);
        } else progress.set(cmd.port, (progress.get(cmd.port) ?? 0) + qty);
        return { ok: true, sold: qty };
      }
      if (cmd.action === "pilot") {
        const s = workShip(e, c.id, cmd.ship);
        if (!s) return fail("choose one of your docked ships");
        if (pilots.has(s.id)) return fail("a pilot is already booked for that ship");
        if (pilotsLeft(s.port) <= 0) return fail("all pilots here are booked today");
        const b = booked.get(s.port);
        booked.set(s.port, { day: day(e), n: b && b.day === day(e) ? b.n + 1 : 1 });
        pilots.add(s.id);
        return { ok: true };
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of arrivals(e)) if (pilots.delete(s.id)) addRep(e, s.owner, s.port, 1);
      for (const sid of pilots) if (!e.ships.has(sid)) pilots.delete(sid);
    },
    cards(company) {
      return dockedPorts(e, company).map(port => {
        const level = levels.get(port) ?? 0, ships = ownDocked(e, company, port);
        const machinery = ships.filter(s => s.good === GOOD.machinery && s.qty > 0);
        const actions: FeatureAction[] = [];
        if (level < MAX_CRANES && machinery.length) actions.push({ ...action(id, "Donate machinery for cranes", "donate", { port }), fields: [{ key: "ship", label: "Ship", options: shipOptions(machinery) }] });
        const free = ships.filter(s => !pilots.has(s.id));
        if (free.length && pilotsLeft(port) > 0) actions.push({ ...action(id, "Book a harbour pilot", "pilot"), fields: [{ key: "ship", label: "Ship", options: shipOptions(free) }] });
        const need = level < MAX_CRANES ? ` Next level needs ${CRANE_MACHINERY * (level + 1) - (progress.get(port) ?? 0)} t of machinery.` : "";
        return { title: `Cranes and pilots · ${portName(e, port)}`, actions,
          detail: `Crane level ${level} of ${MAX_CRANES}.${need} ${pilotsLeft(port)} pilots free today; a pilot guides your next arrival in.` };
      });
    },
    world() { return { cranes: e.map.ports.map(p => levels.get(p.id) ?? 0) }; },
    view(company) { return { pilots: [...pilots].filter(s => e.ships.get(s)?.owner === company) }; },
  };
};

/** Economy side of 42 and 55: each crane level saves an hour leaving its port; a pilot saves an hour arriving. */
export const harbourEffects: FeatureFactory = (e) => ({
  id: "ports.harbour-effects", ideas: [42, 55], title: "Crane and pilot time savings", economy: true,
  adjust: {
    travelHours(v, ctx) {
      if (!e.features.enabled("ports.cranes")) return v;
      const saved = (shared(e).cranes.get(ctx.from) ?? 0) + (shared(e).pilots.has(ctx.ship) ? 1 : 0);
      return Math.max(1, v - saved);
    },
  },
  cards: () => [{ title: "Crane and pilot time savings", detail: "Each crane level saves an hour when you sail from that port. A booked pilot saves an hour on arrival." }],
});
