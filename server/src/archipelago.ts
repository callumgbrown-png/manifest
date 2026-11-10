// Archipelago layout: a handful of small land masses plus a few isolated islands in open ocean, instead of
// the noise-made continents the generator used to produce. Everything here is deterministic given `random`.
//
// HOW TO TUNE (all sizes are for a 2000 x 1400 world and scale with the world):
//   MASS_RADIUS      how big each land mass is (radius of its main lobe cluster)
//   ISLAND_RADIUS    how big each isolated island is
//   EDGE_MARGIN      empty ocean kept around the world's border
//   MASS_GAP         least open water between two land masses
//   ISLAND_GAP       least open water between an island and anything else
//   islandPortQuota  ports per island (the biggest two get 2, the rest 1)

export interface Lobe { x: number; y: number; r: number }
export interface Body {
  kind: 'mass' | 'island';
  lobes: Lobe[];
  cx: number; cy: number;
  /** Outer radius, used only for spacing while placing. */
  reach: number;
}

export const MASS_RADIUS: readonly [number, number] = [185, 225];
export const ISLAND_RADIUS: readonly [number, number] = [64, 90];
export const EDGE_MARGIN = 140;
export const MASS_GAP = 260;
export const ISLAND_GAP = 135;

/** Island ports: the two largest islands hold 2 harbours each, any others 1 (default 3 islands = 5 ports). */
export const islandPortQuota = (rank: number): number => (rank < 2 ? 2 : 1);

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
function lattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), u = smooth(x - ix), v = smooth(y - iy);
  const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed), c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
  return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) * 2 - 1;
}

/** Edge-to-edge open water between two bodies (negative = they overlap). */
const gapBetween = (a: Body, b: Body) => Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.reach - b.reach;

/**
 * Place `masses` land masses and `islands` islands. Masses spread out first (best-candidate sampling keeps
 * them far apart); islands then go into the emptiest ocean between them.
 */
export function planArchipelago(width: number, height: number, masses: number, islands: number, random: () => number): Body[] {
  const base = Math.min(width, height) / 1400;
  const margin = EDGE_MARGIN * base;
  const bodies: Body[] = [];
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);

  const place = (make: () => Body, minGap: number, tries: number) => {
    let best: Body | null = null, bestScore = -Infinity;
    for (let t = 0; t < tries; t++) {
      const b = make();
      const score = bodies.length ? Math.min(...bodies.map(o => gapBetween(b, o))) : 0;
      if (score > bestScore) { bestScore = score; best = b; }
      if (bodies.length === 0) break;   // first body: any position will do
    }
    void minGap;   // spacing is maximised, not enforced here; validateMap rejects layouts that came out too tight
    bodies.push(best!);
  };

  const makeMass = (): Body => {
    const R = between(...MASS_RADIUS) * base, reach = R * 1.15;
    const cx = between(margin + reach, width - margin - reach), cy = between(margin + reach, height - margin - reach);
    const lobes: Lobe[] = [{ x: cx, y: cy, r: R * 0.62 }];
    const n = 4 + Math.floor(random() * 3), a0 = random() * Math.PI * 2;
    for (let i = 0; i < n - 1; i++) {
      const a = a0 + (i * Math.PI * 2) / (n - 1) + (random() - 0.5) * 0.7, off = R * between(0.45, 0.65);
      lobes.push({ x: cx + Math.cos(a) * off, y: cy + Math.sin(a) * off, r: R * between(0.32, 0.46) });
    }
    return { kind: 'mass', lobes, cx, cy, reach };
  };
  for (let i = 0; i < masses; i++) place(makeMass, MASS_GAP * base, 400);

  const makeIsland = (): Body => {
    const r = between(...ISLAND_RADIUS) * base, reach = r * 1.35, m = 110 * base + reach;
    const cx = between(m, width - m), cy = between(m, height - m);
    const lobes: Lobe[] = [{ x: cx, y: cy, r }];
    const extra = 1 + Math.floor(random() * 2), a0 = random() * Math.PI * 2;
    for (let i = 0; i < extra; i++) {
      const a = a0 + i * 2.4;
      lobes.push({ x: cx + Math.cos(a) * r * 0.6, y: cy + Math.sin(a) * r * 0.6, r: r * between(0.45, 0.6) });
    }
    return { kind: 'island', lobes, cx, cy, reach };
  };
  for (let i = 0; i < islands; i++) place(makeIsland, ISLAND_GAP * base, 600);
  return bodies;
}

/** > 0 means land. A lobe is a soft disc; noise roughens the coast so shores aren't circles. */
export function elevationAt(bodies: readonly Body[], x: number, y: number, noiseSeed: number): number {
  let v = -1;
  for (const b of bodies) {
    if (Math.hypot(x - b.cx, y - b.cy) > b.reach * 1.4) continue;
    for (const l of b.lobes) v = Math.max(v, 1 - Math.hypot(x - l.x, y - l.y) / l.r);
  }
  if (v < -0.6) return v;
  return v + noise(x / 70, y / 70, noiseSeed) * 0.16 + noise(x / 28, y / 28, noiseSeed + 1) * 0.07;
}

/** 4-connected components of cells where isLand(i) is true. labels[i] = component id, or -1 for other cells. */
export function components(cols: number, rows: number, isLand: (i: number) => boolean) {
  const labels = new Int32Array(cols * rows).fill(-1), sizes: number[] = [];
  const queue = new Int32Array(cols * rows);
  for (let s = 0; s < labels.length; s++) {
    if (labels[s] !== -1 || !isLand(s)) continue;
    const id = sizes.length; let head = 0, tail = 1; queue[0] = s; labels[s] = id;
    while (head < tail) {
      const i = queue[head++], x = i % cols, y = (i - x) / cols;
      if (x > 0 && labels[i - 1] === -1 && isLand(i - 1)) { labels[i - 1] = id; queue[tail++] = i - 1; }
      if (x < cols - 1 && labels[i + 1] === -1 && isLand(i + 1)) { labels[i + 1] = id; queue[tail++] = i + 1; }
      if (y > 0 && labels[i - cols] === -1 && isLand(i - cols)) { labels[i - cols] = id; queue[tail++] = i - cols; }
      if (y < rows - 1 && labels[i + cols] === -1 && isLand(i + cols)) { labels[i + cols] = id; queue[tail++] = i + cols; }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

/** Smallest land component kept (cells). Anything smaller is a speck of coast noise and is washed away. */
export const MIN_BODY_CELLS = 40;

/**
 * Tidy raw terrain in place: wash away specks smaller than MIN_BODY_CELLS and turn enclosed lakes into land,
 * so the world is exactly its masses and islands. `land` is 1 for land, 0 for water.
 */
export function tidyTerrain(land: Uint8Array, cols: number, rows: number): void {
  const specks = components(cols, rows, i => land[i] === 1);
  for (let i = 0; i < land.length; i++) if (land[i] === 1 && specks.sizes[specks.labels[i]] < MIN_BODY_CELLS) land[i] = 0;
  const water = components(cols, rows, i => land[i] === 0);
  const touchesEdge = new Uint8Array(water.sizes.length);
  for (let i = 0; i < land.length; i++) {
    const id = water.labels[i]; if (id < 0) continue;
    const x = i % cols, y = (i - x) / cols;
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchesEdge[id] = 1;
  }
  for (let i = 0; i < land.length; i++) if (land[i] === 0 && !touchesEdge[water.labels[i]]) land[i] = 1;
}
