import type { Engine } from "../../engine.js";
import type { Pt } from "../../geo.js";
import type { FeatureFactory } from "../types.js";
import { dist, regions, round1, scale } from "./shared.js";

/** Narrow straits: places where three or more lanes squeeze through the same stretch of water, away from harbours. */
const strait = new WeakMap<object, (Pt & { lanes: number })[]>();
export function straits(e: Engine) {
  const cached = strait.get(e.map);
  if (cached) return cached;
  const k = scale(e), cell = 30 * k, step = 6 * k, buckets = new Map<string, { routes: Set<number>; sx: number; sy: number; n: number }>();
  e.map.routes.forEach((r, i) => {
    const pts = r.waypoints ?? [e.map.ports[r.a], e.map.ports[r.b]];
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1], b = pts[j], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let t = 0; t <= n; t++) {
        const x = a.x + (b.x - a.x) * t / n, y = a.y + (b.y - a.y) * t / n, key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
        const bk = buckets.get(key) ?? { routes: new Set<number>(), sx: 0, sy: 0, n: 0 };
        bk.routes.add(i); bk.sx += x; bk.sy += y; bk.n++;
        buckets.set(key, bk);
      }
    }
  });
  const found: (Pt & { lanes: number })[] = [];
  const candidates = [...buckets.values()].filter(b => b.routes.size >= 3)
    .map(b => ({ ...round1({ x: b.sx / b.n, y: b.sy / b.n }), lanes: b.routes.size }))
    .filter(p => e.map.ports.every(port => dist(e, port, p) > 45))
    .sort((a, b) => b.lanes - a.lanes || a.x - b.x || a.y - b.y);
  for (const c of candidates) if (found.length < 6 && found.every(f => dist(e, f, c) > 90)) found.push(c);
  strait.set(e.map, found);
  return found;
}

/** Named sea regions, narrow straits and who owns the ships at sea (company names only, for the live ships layer). */
export const chart: FeatureFactory = (e) => ({
  id: "world.chart", ideas: [247, 249, 257], title: "Sea chart", economy: false,
  world() {
    const owners: Record<number, string> = {};
    let n = 0;
    for (const s of e.ships.values()) {
      if (s.dest === null || owners[s.owner] || n >= 200) continue;
      const c = e.companies.get(s.owner);
      if (c) { owners[s.owner] = c.name; n++; }
    }
    return { regions: regions(e).map(({ ports: _p, ...r }) => r), straits: straits(e), owners };
  },
  cards() {
    const r = regions(e);
    const s = straits(e);
    return [{ title: "Sea chart", detail: [`${r.length} named sea regions: ${r.map(x => x.name).join(", ")}.`,
      s.length ? `${s.length} narrow straits are marked; traffic bunches up there, so pirates and storms bite harder.` : "No narrow straits on this map."].join("\n") }];
  },
});

/** Client map tools: layer toggles, a distance ruler, hazard-avoiding routes and shareable route codes. */
export const mapTools: FeatureFactory = (e) => ({
  id: "world.map-tools", ideas: [252, 253, 255, 256], title: "Map tools", economy: false,
  world: () => ({ scale: scale(e) }),
});
