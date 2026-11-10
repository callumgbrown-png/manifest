// art.portlife: how busy and how grown each harbour looks. Counts dockings (cosmetic only) so the client can animate
// cranes while ships work a port, stack more containers, add warehouses as a port grows, and dress each island in
// its own biome.
import type { FeatureFactory } from "../types.js";
import { BIOMES, biomeOf, shipWatcher } from "./shared.js";

/** Dockings needed for growth stages 1, 2 and 3. */
export const GROWTH = [5, 20, 60];
const BUSY_HOURS = 6;

export const portlife: FeatureFactory = (e) => {
  const watch = shipWatcher(e);
  let arrivals: number[] = [];
  let recent: number[][] = [];   // per port: ticks of recent arrivals
  let biome: number[] = [];
  return {
    id: "art.portlife",
    ideas: [163, 444, 445, 459, 460],
    title: "Harbour life (cranes, containers, growth, biomes)",
    economy: false,
    enable() {
      watch.reset();
      arrivals = e.map.ports.map(() => 0);
      recent = e.map.ports.map(() => []);
      biome = e.map.ports.map((_, p) => biomeOf(e, p));
    },
    advance() {
      for (const a of watch.step().arrivals) {
        if (!(a.port in arrivals)) continue;
        arrivals[a.port]++;
        recent[a.port].push(e.tick);
      }
      for (const r of recent) while (r.length && r[0] <= e.tick - BUSY_HOURS) r.shift();
    },
    world() {
      return {
        stage: arrivals.map(n => GROWTH.filter(g => n >= g).length),
        busy: recent.map(r => Math.min(9, r.length)),
        biome,
        biomes: BIOMES,
      };
    },
  };
};
