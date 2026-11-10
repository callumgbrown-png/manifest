// Where ships are on the map, worked out on the server the same way the client draws them: a voyage follows the
// shortest chain of sea lanes, each lane a polyline of waypoints, and a ship's place is the fraction of the trip done.
// Only used for the pirate and police rules (range checks); trade maths still uses the lane distances in engine.dist.
import type { MapData } from "./engine.js";

export interface Pt { x: number; y: number }
export interface Poly { points: Pt[]; lengths: number[]; total: number }

function prepare(points: Pt[]): Poly {
  const clean = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  const lengths = clean.slice(1).map((p, i) => Math.hypot(p.x - clean[i].x, p.y - clean[i].y));
  return { points: clean, lengths, total: lengths.reduce((a, b) => a + b, 0) };
}

export class Geo {
  private readonly next: number[][];
  private readonly lanes = new Map<string, Poly>();
  private readonly voyages = new Map<string, Poly>();
  /** Linear world scale: map-unit lengths are divided by it so ranges mean what they did on the original map. */
  readonly scale: number;

  /** Distance between two map points in ORIGINAL economy units (what pirate range, safe radius and police catch range use). */
  dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y) / this.scale; }

  constructor(private readonly map: MapData) {
    this.scale = map.worldScale ?? 1;
    const n = map.ports.length;
    const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
    this.next = Array.from({ length: n }, () => Array<number>(n).fill(-1));
    const byId = new Map(map.ports.map(p => [p.id, p]));
    for (const r of map.routes) {
      d[r.a][r.b] = d[r.b][r.a] = r.distance; this.next[r.a][r.b] = r.b; this.next[r.b][r.a] = r.a;
      const pts = r.waypoints ?? [byId.get(r.a)!, byId.get(r.b)!];
      this.lanes.set(`${r.a}:${r.b}`, prepare(pts));
      this.lanes.set(`${r.b}:${r.a}`, prepare([...pts].reverse()));
    }
    // The same loop order as the client's buildLanes, so both choose the same chain of lanes.
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
      if (d[i][k] + d[k][j] < d[i][j]) { d[i][j] = d[i][k] + d[k][j]; this.next[i][j] = this.next[i][k]; }
  }

  /** The ports a trip from a to b passes through, a and b included ([] if there is no route). */
  lanePath(a: number, b: number): number[] {
    const path = [a];
    for (let cur = a, guard = 0; cur !== b && guard < 64; guard++) { cur = this.next[cur][b]; if (cur < 0) return []; path.push(cur); }
    return path;
  }

  voyage(a: number, b: number): Poly {
    const key = `${a}:${b}`;
    let v = this.voyages.get(key);
    if (!v) {
      const ids = this.lanePath(a, b), pts: Pt[] = [];
      for (let i = 1; i < ids.length; i++) {
        const lane = this.lanes.get(`${ids[i - 1]}:${ids[i]}`)!;
        pts.push(...(pts.length ? lane.points.slice(1) : lane.points));
      }
      v = prepare(pts.length ? pts : [this.map.ports[a], this.map.ports[b]]);
      this.voyages.set(key, v);
    }
    return v;
  }

  /** The point a fraction f (0 to 1) of the way along a voyage. */
  at(poly: Poly, f: number): Pt {
    const { points, lengths, total } = poly;
    let left = Math.max(0, Math.min(1, f)) * total;
    for (let i = 0; i < lengths.length; i++) {
      if (left <= lengths[i] || i === lengths.length - 1) {
        const a = points[i], b = points[i + 1], t = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      left -= lengths[i];
    }
    return { x: points[0].x, y: points[0].y };
  }
}
