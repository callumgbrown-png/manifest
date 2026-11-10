// Ships on the map. Placeholder VECTOR shapes turn smoothly through any angle; Dave's pixel-art atlas
// (8 outlined directions: W, SW, S, SE, E, NE, N, NW) is kept as the fallback: setMode('atlas'), or
// ?ships=atlas in the address, or automatically if a vector shape can't be drawn.
window.ManifestShipSprites = (() => {
  const atlas = new Image();
  const headingIndex = angle => ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  atlas.src = 'img/ships-outlined-transparent.png';
  const columns = [4,3,2,1,0,7,6,5];
  // Pixel-art sheets with 8 headings, atlas columns N, NE, E, SE, S, SW, W, NW (police boat, pirate speedboat).
  // HULL_PX is the hull length in atlas pixels, so `size` (the hull length on screen) scales every sheet alike.
  // If the files don't load, that class keeps its vector shape.
  function sheet(dir, name, HULL_PX) {
    const s = { img: new Image(), cell: null, HULL_PX };
    s.img.src = `img/sprites/ships/${dir}/${name}_atlas.png`;
    fetch(`img/sprites/ships/${dir}/${name}_atlas.json`).then(r => r.json()).then(j => { s.cell = j.meta.cell; }).catch(() => {});
    return s;
  }
  const sheets = { police: sheet('police_boat', 'police_boat', 71), pirate: sheet('pirate_speedboat', 'pirate_speedboat', 58) };
  /** Frame column for a canvas angle (0 = east, clockwise): headingIndex counts from east, the sheets from north. */
  const sheetColumn = angle => (headingIndex(angle) + 2) % 8;
  function drawSheet(sh, ctx, x, y, size, angle) {
    if (!sh.cell || !sh.img.complete || !sh.img.naturalWidth) return false;
    const col = sheetColumn(angle), { w, h } = sh.cell, k = size / sh.HULL_PX;
    ctx.save();
    ctx.imageSmoothingEnabled = k < 1; if (k < 1) ctx.imageSmoothingQuality = 'high';   // shrink smoothly, enlarge crisply
    ctx.drawImage(sh.img, col * w, 0, w, h, Math.round(x - w * k / 2), Math.round(y - h * k / 2), w * k, h * k);   // one shared pivot: the cell centre
    ctx.restore();
    return true;
  }
  function makeSheet(name, frames) {
    const img = new Image();
    img.src = `img/sprites/ships/${name}.png`;
    return { img, frames };
  }
  // The frame order follows the canvas compass, starting east and turning clockwise.
  const speedboats = {
    pirate: makeSheet('blue-speedboat-pirate', [[913, 539, 391, 210, 196.0, 129.5], [1388, 86, 334, 264, 168.5, 140.5], [133, 24, 178, 380, 89.5, 213.5], [491, 52, 338, 298, 169.0, 172.5], [910, 90, 394, 227, 197.5, 139.0], [1388, 554, 328, 238, 165.0, 118.5], [133, 462, 178, 364, 89.5, 206.5], [485, 489, 347, 305, 168.0, 184.5]]),
    police: makeSheet('police-boat', [[911, 560, 394, 193, 197.0, 111.5], [1389, 87, 348, 269, 174.0, 149.5], [131, 66, 183, 344, 91.5, 187.0], [486, 81, 345, 275, 172.5, 152.5], [904, 120, 401, 200, 200.5, 115.0], [1390, 554, 334, 246, 167.0, 138.0], [130, 509, 184, 323, 92.0, 176.5], [480, 554, 342, 246, 171.0, 138.0]])
  };
  function drawSpeedboat(ctx, type, x, y, size, angle) {
    const sheet = speedboats[type];
    if (!sheet?.img.complete || !sheet.img.naturalWidth) return false;
    const [sx, sy, sw, sh, cx, cy] = sheet.frames[headingIndex(angle)];
    const scale = size / 400;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet.img, sx, sy, sw, sh, x - cx * scale, y - cy * scale, sw * scale, sh * scale);
    ctx.restore();
    return true;
  }
  // [source x, y, width, height, hull centre x, y]. Every frame shares one scale.
  const frames = [
    [[29,64,305,126,182,141.5],[375,28,220,187,485,144.5],[666,28,109,196,720.5,149],[848,28,220,187,958,144.5],[1110,64,304,126,1261.5,153],[1459,64,205,142,1561.5,135],[1729,49,118,182,1788,149.5],[1917,64,206,143,2020,135]],
    [[29,299,305,125,181.5,375.5],[375,263,220,187,485,380],[666,264,110,196,720.5,385],[848,263,220,188,958,380],[1110,299,304,125,1262,379.5],[1459,299,205,143,1561.5,371],[1729,282,118,184,1788,383],[1918,299,205,143,2020,370.5]],
    [[29,535,305,126,181.5,612],[375,499,220,187,485,615.5],[666,499,110,196,721,621],[848,499,220,187,958,615.5],[1110,535,304,126,1261.5,615.5],[1459,534,205,144,1561.5,610.5],[1729,515,118,185,1788,617],[1918,534,205,144,2020,607]]
  ];
  // ---- vector placeholders (bow points along +x at angle 0; size is the hull length in pixels)
  const CARGO = { grain: '#e5b84b', fuel: '#e0694f', ore: '#9aa7b3', machinery: '#b48cf0' };
  let mode = /[?&]ships=atlas\b/.test(globalThis.location?.search ?? '') ? 'atlas' : 'vector';
  const setMode = m => { mode = m === 'atlas' ? 'atlas' : 'vector'; };
  const getMode = () => mode;
  /** hull outline per class, in units of the hull length (half-beam, bow, stern) */
  const HULLS = {
    coaster: { beam: 0.15, bow: 0.5, bridge: -0.3 },
    freighter: { beam: 0.18, bow: 0.5, bridge: -0.32 },
    bulker: { beam: 0.24, bow: 0.5, bridge: -0.36 },
    pirate: { beam: 0.12, bow: 0.55, bridge: -0.2 },
    police: { beam: 0.14, bow: 0.52, bridge: -0.1 },
  };
  function drawVector(ctx, x, y, size, angle, cargo, type) {
    const h = HULLS[type] || HULLS.freighter, L = size, b = h.beam * L;
    const hull = type === 'pirate' ? '#2a2327' : type === 'police' ? '#27405c' : '#dfe8ee';
    const trim = type === 'pirate' ? '#c0392b' : type === 'police' ? '#6fb6ff' : '#0a1620';
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(h.bow * L, 0);
    ctx.quadraticCurveTo(0.3 * L, b, 0.15 * L, b);
    ctx.lineTo(-0.45 * L, b); ctx.lineTo(-0.5 * L, b * 0.55); ctx.lineTo(-0.5 * L, -b * 0.55); ctx.lineTo(-0.45 * L, -b);
    ctx.lineTo(0.15 * L, -b);
    ctx.quadraticCurveTo(0.3 * L, -b, h.bow * L, 0);
    ctx.closePath();
    ctx.fillStyle = hull; ctx.fill();
    ctx.lineWidth = Math.max(1, L * 0.05); ctx.strokeStyle = trim; ctx.lineJoin = 'round'; ctx.stroke();
    if (cargo && CARGO[cargo]) { ctx.fillStyle = CARGO[cargo]; ctx.fillRect(-0.28 * L, -b * 0.62, 0.42 * L, b * 1.24); }
    ctx.fillStyle = trim; ctx.fillRect(h.bridge * L - 0.05 * L, -b * 0.5, 0.1 * L, b);   // bridge
    if (type === 'pirate') {   // a small flag: a placeholder for the pirate art
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-0.2 * L, -b * 1.5); ctx.lineTo(0.1 * L, -b * 1.2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    return true;
  }

  function draw(ctx, x, y, size, angle, cargo = null, type = 'freighter') {
    if (drawSpeedboat(ctx, type, x, y, size, angle)) return true;
    if (sheets[type] && drawSheet(sheets[type], ctx, x, y, size, angle)) return true;
    if (mode === 'vector' || type === 'pirate' || type === 'police') {
      try { return drawVector(ctx, x, y, size, angle, cargo, type); } catch { /* fall through to the atlas */ }
    }
    if (!atlas.complete || !atlas.naturalWidth) return false;
    const col = columns[headingIndex(angle)];
    const row = cargo === 'fuel' ? 1 : cargo === 'grain' ? 2 : 0;
    const [sx, sy, sw, sh, cx, cy] = frames[row][col];
    const scale = size / 305;
    const dw = sw * scale, dh = sh * scale;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlas, sx, sy, sw, sh,
      x + (sx-cx)*scale, y + (sy-cy)*scale, dw, dh);
    ctx.restore();
    return true;
  }
  return { draw, drawVector, headingIndex, sheetColumn, setMode, getMode, sheets };
})();
