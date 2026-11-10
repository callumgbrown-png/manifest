// art.combat: what fights and losses look like. Ships that were attacked show damage for a day, captures flash an
// explosion where they happened, and ships that leave the game at sea go down with a sinking animation.
// Purely cosmetic: nothing here changes cargo, money or travel.
import type { FeatureFactory } from "../types.js";
import { shipWatcher } from "./shared.js";

/** Hours a ship shows damage after an attack. */
export const DAMAGE_HOURS = 24;
/** Hours an explosion or sinking stays in the list the client animates. */
export const FX_HOURS = 3;
export interface Fx { kind: "explosion" | "sinking"; ship: number; x: number; y: number; tick: number }

export const combat: FeatureFactory = (e) => {
  const watch = shipWatcher(e);
  const damaged = new Map<number, number>();   // ship -> tick the damage fades
  let fx: Fx[] = [];
  let seen = 0;                                 // highest piracy notice id handled
  const where = (ship: number) => {
    const s = e.ships.get(ship);
    if (!s) return null;
    const p = e.piracy.position(s);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  return {
    id: "art.combat", ideas: [441, 443, 455], title: "Battle damage, explosions and sinkings", economy: false,
    enable() {
      watch.reset(); damaged.clear(); fx = [];
      seen = 0;
      for (const list of e.piracy.notices.values()) for (const n of list) seen = Math.max(seen, n.id);
    },
    advance() {
      // Attacks: piracy notices name the ship that was hit ("... your ship 12 ...").
      let top = seen;
      for (const list of e.piracy.notices.values()) for (const n of list) {
        if (n.id <= seen) continue;
        top = Math.max(top, n.id);
        if (n.kind !== "raided" && n.kind !== "raid-lost" && n.kind !== "captured" && n.kind !== "raid-captured") continue;
        const m = /ship (\d+)/.exec(n.text);
        if (m && e.ships.has(Number(m[1]))) damaged.set(Number(m[1]), e.tick + DAMAGE_HOURS);
      }
      seen = top;
      const step = watch.step();
      for (const c of step.captured) {
        damaged.set(c.ship, e.tick + DAMAGE_HOURS);
        const p = where(c.ship);
        if (p) fx.push({ kind: "explosion", ship: c.ship, ...p, tick: e.tick });
      }
      for (const g of step.gone) {
        damaged.delete(g.ship);
        const port = e.map.ports[g.port];
        if (port) fx.push({ kind: "sinking", ship: g.ship, x: port.x, y: port.y, tick: e.tick });
      }
      for (const [s, until] of damaged) if (until <= e.tick || !e.ships.has(s)) damaged.delete(s);
      fx = fx.filter(f => f.tick > e.tick - FX_HOURS).slice(-12);
    },
    world() {
      return { damaged: [...damaged].map(([ship, until]) => ({ ship, hours: until - e.tick })), fx: fx.map(f => ({ ...f })) };
    },
  };
};
