import { GOODS, type Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, addRep, arrivals, dockedPorts, fail, hash, integer, portName, sites } from "./shared.js";

export const customsPorts = (e: Engine) => sites(e, 37, 0.3);
export const DUTY = 0.02, DECLARE_WITHIN = 12;

/** 49 customs offices: a 2% duty on trade at customs ports, on top of the usual tax. Economy. */
export const customs: FeatureFactory = (e) => ({
  id: "ports.customs", ideas: [49], title: "Customs offices", economy: true,
  adjust: { tradeTax: (v, ctx) => customsPorts(e).includes(ctx.port) ? v + DUTY : v },
  cards: (company) => {
    const here = dockedPorts(e, company).filter(p => customsPorts(e).includes(p));
    return here.length ? [{ title: "Customs duty", detail: `${here.map(p => portName(e, p)).join(", ")} charge ${DUTY * 100}% duty on every purchase and sale.` }] : [];
  },
  world: () => ({ ports: customsPorts(e) }),
});

/** 270 a customs queue: loaded ships arriving at a customs port line up to declare their cargo. Declaring within
 *  12 hours earns standing; ships left waiting get a random inspection note. No money or time changes. */
export const customsQueue: FeatureFactory = (e) => {
  const id = "ports.customs-queue";
  const queue: { ship: number; port: number; since: number; good: number; qty: number }[] = [];
  const honest = new Map<number, number>();               // company -> prompt declarations
  const notes: { tick: number; company: number; text: string }[] = [];
  return {
    id, ideas: [270], title: "Customs queue", economy: false,
    apply(cmd) {
      if (cmd.action !== "declare") return fail("unknown action");
      if (!integer(cmd.ship)) return fail("choose a ship");
      const i = queue.findIndex(q => q.ship === cmd.ship);
      const s = e.ships.get(cmd.ship);
      if (i < 0 || !s || s.owner !== cmd.company) return fail("that ship is not waiting at customs");
      const q = queue[i];
      queue.splice(i, 1);
      honest.set(cmd.company, (honest.get(cmd.company) ?? 0) + 1);
      addRep(e, cmd.company, q.port, 2);
      return { ok: true };
    },
    advance() {
      const ports = customsPorts(e);
      for (const s of arrivals(e)) if (s.qty > 0 && s.good !== null && ports.includes(s.port)) queue.push({ ship: s.id, port: s.port, since: e.tick, good: s.good, qty: s.qty });
      for (let i = queue.length - 1; i >= 0; i--) {
        const q = queue[i], s = e.ships.get(q.ship);
        if (!s || s.dest !== null || s.port !== q.port) { queue.splice(i, 1); continue; }   // sailed on undeclared
        if (e.tick - q.since < DECLARE_WITHIN) continue;
        queue.splice(i, 1);
        if (hash(47, q.ship, e.tick) < 0.5) {
          notes.push({ tick: e.tick, company: s.owner, text: `Customs at ${portName(e, q.port)} opened ship #${q.ship}: ${q.qty} t of ${GOODS[q.good]}, all in order, but the officers were not pleased to wait.` });
          if (notes.length > 40) notes.shift();
        }
      }
    },
    cards(company) {
      const mine = queue.filter(q => e.ships.get(q.ship)?.owner === company);
      if (!mine.length) return [];
      return [{ title: "Waiting at customs", detail: `Declare within ${DECLARE_WITHIN} hours of arriving for +2 standing.`,
        actions: mine.map(q => action(id, `Declare #${q.ship} (${q.qty} t ${GOODS[q.good]}) at ${portName(e, q.port)}, ${DECLARE_WITHIN - (e.tick - q.since)} h left`, "declare", { ship: q.ship })) }];
    },
    view: (company) => ({ waiting: queue.filter(q => e.ships.get(q.ship)?.owner === company).map(q => ({ ship: q.ship, port: q.port, since: q.since })),
      declared: honest.get(company) ?? 0, notes: notes.filter(n => n.company === company).slice(-5) }),
    world: () => ({ ports: customsPorts(e), lines: customsPorts(e).map(p => queue.filter(q => q.port === p).length) }),
  };
};
