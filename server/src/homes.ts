// Home ports. Every company has one, for good: where it starts, its safe harbour (see piracy.ts) and where it
// buys ships. Homes are picked so they are spread out and each has a fair trade nearby.
import type { Engine } from "./engine.js";
import { startPool } from "./bots.js";

/** Choose a home for a new company. Candidates are the start pool (ports where a trip pays now, so the home has
 *  a fair trade nearby; this reuses pickStartPort's rule). Among them: the ports with the fewest companies already
 *  homed there come first, then the ones farthest by sea from the homes already taken. One of the best three
 *  is picked at random so the order isn't predictable. */
export function pickHome(engine: Engine, random: (n: number) => number): number {
  const pool = startPool(engine);
  const taken = new Map<number, number>();
  for (const c of engine.companies.values()) taken.set(c.home, (taken.get(c.home) ?? 0) + 1);
  const homes = [...taken.keys()];
  const apart = (p: number) => homes.length ? Math.min(...homes.map(h => (h === p ? 0 : engine.dist[p][h]))) : Infinity;
  const ranked = pool
    .map(p => ({ p, used: taken.get(p) ?? 0, apart: apart(p) }))
    .sort((a, b) => a.used - b.used || b.apart - a.apart || a.p - b.p);
  const best = ranked.slice(0, Math.min(3, ranked.length));
  return best[random(best.length)].p;
}
