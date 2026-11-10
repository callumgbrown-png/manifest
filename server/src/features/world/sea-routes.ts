// Sea features that change sailing time. Every module here is economy: true and ships switched off.
import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { bounds, calendar, hash, polyNear, seaPoint, voyagePoly } from "./shared.js";

/** The lanes a voyage sails, with their lengths. */
function legs(e: Engine, from: number, dest: number) {
  const path = e.piracy.geo.lanePath(from, dest), out: { a: number; b: number; route: number; distance: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const route = e.map.routes.findIndex(r => (r.a === path[i - 1] && r.b === path[i]) || (r.b === path[i - 1] && r.a === path[i]));
    if (route >= 0) out.push({ a: path[i - 1], b: path[i], route, distance: e.map.routes[route].distance });
  }
  return out;
}
const total = (l: { distance: number }[]) => l.reduce((s, x) => s + x.distance, 0) || 1;

/** Idea 98: about four lanes in ten carry a current; sailing with it is 10% quicker, against it 10% slower. */
export function currents(e: Engine) {
  return e.map.routes.flatMap((r, i) => hash(77, i) < 0.4 ? [hash(77, i, 1) < 0.5 ? { route: i, a: r.a, b: r.b } : { route: i, a: r.b, b: r.a }] : []);
}
/** Idea 98, content half: the currents drawn on the chart (on). The speed change is world.currents-effects (off). */
export const currentsChart: FeatureFactory = (e) => ({
  id: "world.currents", ideas: [98], title: "Ocean currents", economy: false,
  world: () => ({ currents: currents(e) }),
  cards: () => [{ title: "Ocean currents", detail: `${currents(e).length} lanes carry a current, drawn as arrows on the chart. Sail with the arrows when you can.` }],
});
export const currentsEffects: FeatureFactory = (e) => ({
  id: "world.currents-effects", ideas: [98], title: "Ocean currents: sailing time", economy: true,
  adjust: {
    travelHours(v, ctx) {
      const flow = new Map(currents(e).map(c => [c.route, c]));
      const l = legs(e, ctx.from, ctx.dest);
      let net = 0;
      for (const leg of l) { const c = flow.get(leg.route); if (c) net += c.a === leg.a ? -leg.distance : leg.distance; }
      return Math.max(1, Math.round(v * (1 + 0.1 * net / total(l))));
    },
  },
});

/** Idea 100: in winter, icebergs drift into the far north (the top sixth of the map); voyages there take 2 hours more. */
export function icebergs(e: Engine) {
  const { w, h } = bounds(e), band = h / 6;
  return { band, active: calendar(e).season === 3, bergs: [0, 1, 2, 3, 4].map(i => ({ x: Math.round(w * (0.1 + 0.8 * hash(88, i))), y: Math.round(band * (0.2 + 0.6 * hash(88, i, 1))) })) };
}
export const icebergsModule: FeatureFactory = (e) => ({
  id: "world.icebergs", ideas: [100], title: "Icebergs in the far north", economy: true,
  world: () => icebergs(e),
  adjust: {
    travelHours(v, ctx) {
      const ice = icebergs(e);
      return ice.active && voyagePoly(e, ctx.from, ctx.dest).points.some(p => p.y < ice.band) ? v + 2 : v;
    },
  },
});

/** Idea 246: four reefs near harbour mouths; each one a voyage passes adds an hour of careful pilotage. */
export const reefs = (e: Engine) => [0, 1, 2, 3].map(i => ({ id: `reef-${i}`, ...seaPoint(e, 600 + i, 0.12, 0.25), r: 14 }));
export const reefsModule: FeatureFactory = (e) => ({
  id: "world.reefs", ideas: [246], title: "Reef hazards", economy: true,
  world: () => ({ reefs: reefs(e) }),
  adjust: { travelHours: (v, ctx) => v + reefs(e).filter(r => polyNear(e, voyagePoly(e, ctx.from, ctx.dest), r, r.r)).length },
});

/** Idea 245: the six lanes joining the busiest junctions are buoyed highways, 15% quicker to sail. */
export function highways(e: Engine) {
  const degree = e.map.ports.map(p => e.map.routes.filter(r => r.a === p.id || r.b === p.id).length);
  return e.map.routes.map((r, i) => ({ i, a: r.a, b: r.b, score: degree[r.a] + degree[r.b] }))
    .sort((x, y) => y.score - x.score || x.i - y.i).slice(0, 6).map(r => ({ route: r.i, a: r.a, b: r.b }));
}
export const highwaysModule: FeatureFactory = (e) => ({
  id: "world.highways", ideas: [245], title: "Shipping-lane highways", economy: true,
  world: () => ({ highways: highways(e) }),
  adjust: {
    travelHours(v, ctx) {
      const fast = new Set(highways(e).map(h => h.route)), l = legs(e, ctx.from, ctx.dest);
      const share = l.filter(x => fast.has(x.route)).reduce((s, x) => s + x.distance, 0) / total(l);
      return Math.max(1, Math.round(v * (1 - 0.15 * share)));
    },
  },
});
