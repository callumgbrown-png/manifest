// Pixel-art port icons with resource-production sprites, drawn on the map canvas.
//
//   ManifestPortSprites.ready()                      -> true once the port atlas has loaded
//   ManifestPortSprites.layout(port, x, y, scale)    -> where everything goes (no drawing; easy to test)
//   ManifestPortSprites.draw(ctx, port, x, y, scale, glow) -> draws the port, then its resources to the right
//
// `port` is a Manifest world port ({ produces: ["grain", ...] }); toPortData() maps it onto the
// generic schema { id, name, position, producesResource, resourceType } used by the standalone demo.
//
// Placement is NOT decided here: harbours.js works out, in world space and from the land mask, where each quay and each
// land building goes. This file only turns those placements into screen rectangles and draws them.
//
// HOW TO ADJUST (everything is in the blocks below):
//   • Asset paths      -> SPRITES   (change `src` / `json`; `prefix` is the frame-name prefix inside the JSON)
//   • Sizes / padding  -> LAYOUT    (all ratios are relative to the PORT icon, so zoom can never misalign them)
//   • New resource     -> add a SPRITES entry whose key is the good's name (it appears when a port produces it)
window.ManifestPortSprites = (() => {
  'use strict';
  const BASE = 'img/sprites/buildings/';

  /** good name -> sprite atlas. The game's four goods use the pack's four production buildings. */
  const SPRITES = {
    port:      { src: BASE + 'port_atlas.png',           json: BASE + 'port_atlas.json',           prefix: 'port' },
    grain:     { src: BASE + 'wheat_field_atlas.png',    json: BASE + 'wheat_field_atlas.json',    prefix: 'wheat_field' },
    fuel:      { src: BASE + 'oil_pumpjack_atlas.png',   json: BASE + 'oil_pumpjack_atlas.json',   prefix: 'oil_pumpjack' },
    ore:       { src: BASE + 'mine_headframe_atlas.png', json: BASE + 'mine_headframe_atlas.json', prefix: 'mine_headframe' },
    machinery: { src: BASE + 'factory_atlas.png',        json: BASE + 'factory_atlas.json',        prefix: 'factory' },
  };

  // World sizes, in map units at the original 1000 x 700 scale (multiplied by the world's size factor K).
  // One dock size for every harbour, and one building width per good, keep proportions the same at every zoom.
  const WORLD = {
    dockW: 26,                                                   // the quay's width
    industryW: { grain: 11, fuel: 9, ore: 10, machinery: 12 },   // building widths; heights follow each sprite's shape
  };
  const LAYOUT = {
    minDockPx: 30, maxDockPx: 130,   // on-screen quay width limits, so it stays clickable when zoomed out and crisp when zoomed in
    minBuildingPx: 13,               // smaller than this a building is not drawn; the goods badge by the label stands in for it
    tapPx: 30,                       // minimum click/tap target around a harbour, in screen pixels
    frames: [1, 3, 5, 7],            // the four three-quarter views of the quay: one per way the open water can lie
  };

  const atlases = {};       // key -> { img, frame, bounds, centroid, openSide }, filled as files arrive
  let started = false;
  let dockFrames = null, dockRefW = 1;    // port quay frames with the extra data above, one per LAYOUT.frames entry

  const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src; });

  /** Opaque bounds, centre of mass, and (for the quay) which side its open water lies on, all from the pixels. */
  function analyse(img, f) {
    const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    const d = g.getImageData(0, 0, f.w, f.h).data;
    let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (d[(y * f.w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; sy += y; n++;
    }
    if (x1 < 0) return { bounds: { x: 0, y: 0, w: f.w, h: f.h }, centroid: { x: f.w / 2, y: f.h / 2 }, openSide: { x: 0, y: 1 } };
    const bounds = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, centroid = { x: sx / n, y: sy / n };
    // The quay is an L: its mass sits on the two arms, so the bounding box's centre lies towards the open (water) corner.
    let ox = bounds.x + bounds.w / 2 - centroid.x, oy = bounds.y + bounds.h / 2 - centroid.y; const m = Math.hypot(ox, oy) || 1;
    return { bounds, centroid, openSide: { x: ox / m, y: oy / m } };
  }

  function load() {
    if (started) return; started = true;
    for (const [key, c] of Object.entries(SPRITES)) {
      Promise.all([loadImage(c.src), fetch(c.json).then(r => r.json())]).then(([img, json]) => {
        const frameFor = dir => { const name = Object.keys(json.frames).find(n => n.startsWith(`${c.prefix}_${dir}_`)); if (!name) throw new Error('no frame for ' + c.prefix); return json.frames[name].frame; };
        if (key === 'port') {
          dockFrames = LAYOUT.frames.map(dir => ({ dir, img, frame: frameFor(dir), ...analyse(img, frameFor(dir)) }));
          dockRefW = Math.max(...dockFrames.map(f => f.bounds.w));   // one scale for every orientation
          atlases.port = dockFrames[0];
        } else { const frame = frameFor(0); atlases[key] = { img, frame, ...analyse(img, frame) }; }
      }).catch(err => console.warn('port sprite unavailable:', key, err.message));   // the map falls back to its simple shapes
    }
  }
  load();

  const ready = () => !!atlases.port;

  /** Manifest world port -> generic port record (id, name, position, producesResource, resourceType). */
  function toPortData(p) {
    const goods = (p.produces ?? []).filter(g => SPRITES[g] && g !== 'port');
    return { id: p.id, name: p.name, position: { x: p.x, y: p.y }, producesResource: goods.length > 0, resourceType: goods[0] ?? 'none', resources: goods };
  }

  /** The building sizes harbours.js needs, in world units (K = world size factor). */
  function specs(K) {
    const industry = {};
    for (const [g, w] of Object.entries(WORLD.industryW)) { const a = atlases[g]; if (a) industry[g] = { w: w * K, h: w * K * a.bounds.h / a.bounds.w }; }
    const q = dockFrames?.[0];
    return { dock: { w: WORLD.dockW * K, h: q ? WORLD.dockW * K * q.bounds.h / dockRefW : WORLD.dockW * K * 0.8 }, industry };
  }

  /** The quay frame whose open side best faces `water` (a unit vector). */
  function pickDock(water) {
    let best = dockFrames[0], bd = -2;
    for (const f of dockFrames) { const d = f.openSide.x * water.x + f.openSide.y * water.y; if (d > bd) { bd = d; best = f; } }
    return best;
  }

  /**
   * Screen rectangles for one port from its world placement. `P` maps world points to the screen, `scale` is the map's
   * screen scale (view.scale). Returns null until loaded, or for a world without a land mask (then draw the old shape).
   */
  function layout(p, pl, P, scale, K = 1, L = LAYOUT) {
    if (!dockFrames || !pl?.dock) return null;
    const f = pickDock(pl.water), pxW = Math.max(L.minDockPx, Math.min(L.maxDockPx, pl.dock.w * scale));
    const k = pxW / dockRefW;                                  // sprite pixels -> screen pixels, identical for every frame
    const [cx, cy] = P({ x: pl.dock.cx, y: pl.dock.cy });   // where the quay's centre of mass goes
    const dock = { x: cx - (f.centroid.x - f.bounds.x) * k, y: cy - (f.centroid.y - f.bounds.y) * k, w: f.bounds.w * k, h: f.bounds.h * k, f, k };
    const industry = [];
    for (const b of pl.industry) {
      const a = atlases[b.good]; if (!a) continue;
      const w = b.w * scale, h = b.h * scale;
      if (w < L.minBuildingPx) continue;                     // too small to read: the badge stands in for it
      const [bx, by] = P(b);
      industry.push({ good: b.good, x: bx - w / 2, y: by - h, w, h, atlas: a });
    }
    const all = [dock, ...industry];
    const x0 = Math.min(...all.map(r => r.x)), y0 = Math.min(...all.map(r => r.y)), x1 = Math.max(...all.map(r => r.x + r.w)), y1 = Math.max(...all.map(r => r.y + r.h));
    const [bx, by] = P(pl.berth), tap = L.tapPx / 2;
    const box = { x: Math.min(x0, bx - tap), y: Math.min(y0, by - tap), w: 0, h: 0 };
    box.w = Math.max(x1, bx + tap) - box.x; box.h = Math.max(y1, by + tap) - box.y;
    return { dock, industry, berth: { x: bx, y: by }, box, parts: all };
  }

  function blit(ctx, r, d) {
    const { img, bounds: b, frame: f } = d;
    ctx.imageSmoothingEnabled = r.w < b.w;           // shrinking: smooth; enlarging: keep the pixels crisp
    if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, f.x + b.x, f.y + b.y, b.w, b.h, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
  }

  /** Draws the quay and its land buildings (buildings behind, the quay in front). Returns the layout, or null. */
  function draw(ctx, l) {
    if (!l) return null;
    ctx.save();
    for (const r of [...l.industry].sort((a, b) => a.y + a.h - (b.y + b.h))) blit(ctx, r, r.atlas);
    blit(ctx, l.dock, l.dock.f);
    ctx.restore();
    return l;
  }

  return { ready, layout, draw, specs, toPortData, SPRITES, LAYOUT, WORLD };
})();
