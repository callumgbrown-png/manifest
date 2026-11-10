// Idea 31: radar spots pirate ships near your ships early. Information only: it changes no odds or money.
// A radar fitting (ships.fittings) extends the range.
import type { Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { note, peer, prune, shipName } from "./shared.js";

export const RADAR_RANGE = 110;
export const RADAR_FITTED_RANGE = 180;

export const radar: FeatureFactory = (e) => {
  /** Pirates each of your ships already has on its screen (so a contact is reported once). */
  const tracked = new Map<number, Set<number>>();
  const warnings = new Map<number, { tick: number; ship: number; pirate: number; distance: number }[]>();
  const range = (s: Ship) => peer<{ has(ship: number, fit: string): boolean }>(e, "ships.fittings")?.has(s.id, "radar") ? RADAR_FITTED_RANGE : RADAR_RANGE;
  const contacts = (s: Ship) => {
    if (!e.piratesOn || s.type === "pirate") return [];
    const at = e.piracy.position(s), r = range(s), out: { pirate: number; distance: number }[] = [];
    for (const p of e.ships.values()) {
      if (p.type !== "pirate" || p.owner === s.owner || p.dest === null) continue;
      const d = e.piracy.geo.dist(at, e.piracy.position(p));
      if (d <= r) out.push({ pirate: p.id, distance: Math.round(d) });
    }
    return out.sort((a, b) => a.distance - b.distance);
  };
  return {
    id: "ships.radar", ideas: [31], title: "Radar", economy: false,
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest === null) { tracked.delete(s.id); continue; }
        const now = contacts(s), before = tracked.get(s.id) ?? new Set<number>();
        for (const c of now) if (!before.has(c.pirate)) {
          note(e, s.id, `Radar contact: pirate ship ${c.pirate}, ${c.distance} away.`);
          const list = warnings.get(s.owner) ?? [];
          list.push({ tick: e.tick, ship: s.id, pirate: c.pirate, distance: c.distance });
          warnings.set(s.owner, list.slice(-8));
        }
        tracked.set(s.id, new Set(now.map(c => c.pirate)));
      }
      if (e.tick % 24 === 0) prune(e, tracked);
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return {
        range: RADAR_RANGE,
        ships: c.ships.map(id => e.ships.get(id)!).filter(s => s && s.dest !== null)
          .map(s => ({ ship: s.id, name: shipName(e, s.id), range: range(s), contacts: contacts(s) })),
        warnings: warnings.get(company) ?? [],
      };
    },
  };
};
