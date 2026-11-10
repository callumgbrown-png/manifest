// Ideas 239 and 240: a logbook of each ship's journeys and ship rating stats. Read-only for the economy.
import { GOODS, type Engine, type Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { note, portName, prune, shared, shipName, VoyageWatch } from "./shared.js";

interface Stats { voyages: number; distance: number; tonnes: number; hoursAtSea: number; since: number }

/** Ratings out of 5 stars from the class spec and the ship's record (capacity read through any enabled hooks). */
export function ratings(e: Engine, s: Ship, st?: Stats) {
  const spec = e.spec(s.type), all = ["coaster", "freighter", "bulker"].map(t => e.spec(t as Ship["type"]));
  const cap = e.expansionCapacity(s);
  const star = (v: number, lo: number, hi: number) => Math.max(1, Math.min(5, Math.round(1 + 4 * (v - lo) / Math.max(1e-9, hi - lo))));
  const fuelPerTonne = spec.fuel_per_100_distance / Math.max(1, spec.capacity);
  const effs = all.map(x => x.fuel_per_100_distance / Math.max(1, x.capacity));
  const condition = shared(e).condition.get(s.id) ?? 100;
  return {
    speed: star(spec.speed_per_hour, Math.min(...all.map(x => x.speed_per_hour)), Math.max(...all.map(x => x.speed_per_hour))),
    hold: star(cap, Math.min(...all.map(x => x.capacity)), Math.max(...all.map(x => x.capacity))),
    economy: star(-fuelPerTonne, -Math.max(...effs), -Math.min(...effs)),
    reliability: star(condition, 40, 100),
    experience: star(st?.voyages ?? 0, 0, 30),
  };
}

export const logbook: FeatureFactory = (e) => {
  const stats = new Map<number, Stats>();
  const watch = new VoyageWatch();
  const stat = (id: number) => { let s = stats.get(id); if (!s) stats.set(id, s = { voyages: 0, distance: 0, tonnes: 0, hoursAtSea: 0, since: e.tick }); return s; };
  return {
    id: "ships.logbook", ideas: [239, 240], title: "Ship logbooks and ratings", economy: false,
    advance() {
      watch.step(e, {
        depart: (s, from) => {
          stat(s.id);
          note(e, s.id, `Left ${portName(e, from)} for ${portName(e, s.dest!)}${s.qty > 0 && s.good !== null ? ` with ${Math.round(s.qty)} t of ${GOODS[s.good]}` : " in ballast"}, due in ${s.arriveTick - s.departTick} h.`);
        },
        arrive: (s, from) => {
          const st = stat(s.id);
          st.voyages++;
          const d = e.dist[from]?.[s.port];
          if (Number.isFinite(d)) st.distance += d;
          if (s.qty > 0) st.tonnes += s.qty;
          note(e, s.id, `Arrived at ${portName(e, s.port)} from ${portName(e, from)}.`);
        },
        owner: (s) => note(e, s.id, `Changed hands: now sails for ${e.companies.get(s.owner)?.name ?? "a new owner"}.`),
      });
      for (const s of e.ships.values()) if (s.dest !== null) stat(s.id).hoursAtSea++;
      if (e.tick % 24 === 0) { prune(e, stats); prune(e, shared(e).log); }
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return c.ships.map(id => e.ships.get(id)!).filter(Boolean).map(s => ({
        ship: s.id, name: shipName(e, s.id), stats: stats.get(s.id) ?? null, ratings: ratings(e, s, stats.get(s.id)),
        log: shared(e).log.get(s.id) ?? [],
      }));
    },
  };
};
