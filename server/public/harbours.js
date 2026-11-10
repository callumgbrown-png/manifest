// Where each harbour and its land industry go, in WORLD space, from the season's land mask.
//
//   ManifestHarbours.build(ports, terrain, specs) -> Map(port id -> placement)
//
// Everything is anchored to the port's authoritative point (the berth, in water, where ships dock and where
// every route starts) and to the coast beside it, so nothing moves while the map is panned or zoomed.
// `specs` gives world-unit sizes: { dock: {w, h}, industry: { grain: {w, h}, fuel, ore, machinery } }.
//
// placement = {
//   berth:  {x, y}            the port point itself (water): ships dock here
//   land:   {x, y}            unit vector from the berth towards the nearest land
//   water:  {x, y}            unit vector towards open water (-land)
//   dock:   {x, y, w, h}      world rectangle of the quay: its centre sits on the shoreline
//   shore:  {x, y}            first land point along `land`
//   industry: [{good, x, y, w, h}]  buildings with their BASE-CENTRE point at (x, y); null-free: a good that finds no
//                             room on land is simply left out and shown as a badge only
//   onLand: boolean           false when the world has no land mask (legacy maps): callers fall back to badges
// }
//
// To nudge one port by hand, add it to OVERRIDES: { dockShift: [dx, dy], industry: { grain: [x, y] } } in world units.
window.ManifestHarbours = (() => {
  'use strict';
  const OVERRIDES = {};   // port id -> { dockShift?: [dx, dy], industry?: { good: [x, y] } }   (empty: the mask decides)

  function decode(t) {
    const raw = atob(t.waterBase64), water = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) water[i] = raw.charCodeAt(i);
    return { cols: t.cols, rows: t.rows, cell: t.cellSize, water };
  }
  const isLand = (g, x, y) => {
    const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
    return cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows && g.water[cy * g.cols + cx] === 0;
  };
  /** Fraction of a rectangle's sample points that are land (samples every half cell). */
  function landShare(g, x0, y0, x1, y1) {
    const step = g.cell / 2; let n = 0, land = 0;
    for (let y = y0; y <= y1 + 1e-6; y += step) for (let x = x0; x <= x1 + 1e-6; x += step) { n++; if (isLand(g, x, y)) land++; }
    return n ? land / n : 0;
  }
  const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

  /** Direction from the berth to the nearest land, and how far it is. The server's coastDirection is the first guess;
   *  if it doesn't actually reach land (or reaches it late) the 16 compass points are tried instead. */
  function landward(g, p) {
    const reach = d => { for (let r = 0; r <= 60; r += 1) if (isLand(g, p.x + d.x * r, p.y + d.y * r)) return r; return Infinity; };
    const cands = [];
    const cd = p.coastDirection, len = cd ? Math.hypot(cd.dx, cd.dy) : 0;
    if (len > 1e-6) cands.push({ x: cd.dx / len, y: cd.dy / len });
    for (let i = 0; i < 16; i++) cands.push({ x: Math.cos(i * Math.PI / 8), y: Math.sin(i * Math.PI / 8) });
    let best = null;
    for (const [i, d] of cands.entries()) {
      const r = reach(d);
      if (i === 0 && r <= 14) return { dir: d, dist: r };   // the server's direction is good: keep it
      if (!best || r < best.dist) best = { dir: d, dist: r };
    }
    return best.dist === Infinity ? null : best;
  }

  function build(ports, terrain, specs) {
    const out = new Map();
    if (!terrain) {
      for (const p of ports) out.set(p.id, { berth: { x: p.x, y: p.y }, land: { x: 0, y: 1 }, water: { x: 0, y: -1 }, dock: null, shore: { x: p.x, y: p.y }, industry: [], onLand: false });
      return out;
    }
    const g = decode(terrain), taken = [];
    const { dock } = specs;
    // 1. Docks first, for every port, so industry can never take a quay's place.
    for (const p of ports) {
      const l = landward(g, p), ov = OVERRIDES[p.id] ?? {};
      const land = l?.dir ?? { x: 0, y: 1 }, d = l?.dist ?? 3;
      const shore = { x: p.x + land.x * d, y: p.y + land.y * d };
      // The quay's centre sits just inland of the shoreline, so its water side reaches into the sea and the berth.
      const inset = dock.w * 0.16, c = { x: shore.x + land.x * inset + (ov.dockShift?.[0] ?? 0), y: shore.y + land.y * inset + (ov.dockShift?.[1] ?? 0) };
      const rect = { x: c.x - dock.w / 2, y: c.y - dock.h / 2, w: dock.w, h: dock.h };
      taken.push({ port: p.id, rect });
      out.set(p.id, { berth: { x: p.x, y: p.y }, land, water: { x: -land.x, y: -land.y }, dock: { ...rect, cx: c.x, cy: c.y }, shore, industry: [], onLand: l !== null });
    }
    // 2. Industry on land, inland of the quay: the whole base must be land, the whole sprite mostly land, and clear of everything placed.
    for (const p of ports) {
      const pl = out.get(p.id), ov = OVERRIDES[p.id] ?? {};
      if (!pl.onLand) continue;
      const u = { x: -pl.land.y, y: pl.land.x };   // along the coast
      for (const good of p.produces ?? []) {
        const b = specs.industry[good]; if (!b) continue;
        const fix = ov.industry?.[good];
        const tryAt = (x, y) => {
          const sprite = { x: x - b.w / 2, y: y - b.h, w: b.w, h: b.h }, base = { x: x - b.w / 2, y: y - b.h * 0.2, w: b.w, h: b.h * 0.2 };
          if (landShare(g, base.x - 2, base.y - 1, base.x + base.w + 2, base.y + base.h + 1) < 1) return false;   // base fully on land, with margin
          if (landShare(g, sprite.x, sprite.y, sprite.x + sprite.w, sprite.y + sprite.h) < 0.8) return false;     // body mostly on land
          if (taken.some(t => overlap(t.rect, sprite, 3))) return false;
          taken.push({ port: p.id, rect: sprite }); pl.industry.push({ good, x, y, w: b.w, h: b.h }); return true;
        };
        if (fix && tryAt(fix[0], fix[1])) continue;
        // Beside the quay along the coast first, then further inland: the base just behind the shoreline.
        const dShore = Math.hypot(pl.shore.x - p.x, pl.shore.y - p.y);
        search: for (const step of [0, 1, 2, 3, 4, 5, 6, 8]) for (const lat of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
          const along = lat * (pl.dock.w * 0.5 + b.w * 0.65), inland = dShore + b.h * (0.12 + step * 0.3);
          if (tryAt(p.x + pl.land.x * inland + u.x * along, p.y + pl.land.y * inland + u.y * along)) break search;
        }
      }
    }
    return out;
  }
  return { build, OVERRIDES };
})();
