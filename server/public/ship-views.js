// Outlined ships: W, SW, S, SE, E, NE, N, NW. Rows: empty, fuel, grain, ore, machinery. Bounds preserve sheet spacing.
window.ManifestShipSprites = (() => {
  const atlas = new Image();
  const headingIndex = angle => ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  atlas.src = 'img/ships-outlined-transparent.png';
  const columns = [4,3,2,1,0,7,6,5];
  // [source x, y, width, height, hull centre x, y]. Every frame shares one scale.
  const frames = [
    [[29,64,305,126,182,141.5],[375,28,220,187,485,144.5],[666,28,109,196,720.5,149],[848,28,220,187,958,144.5],[1110,64,304,126,1261.5,153],[1459,64,205,142,1561.5,135],[1729,49,118,182,1788,149.5],[1917,64,206,143,2020,135]],
    [[29,299,305,125,181.5,375.5],[375,263,220,187,485,380],[666,264,110,196,720.5,385],[848,263,220,188,958,380],[1110,299,304,125,1262,379.5],[1459,299,205,143,1561.5,371],[1729,282,118,184,1788,383],[1918,299,205,143,2020,370.5]],
    [[29,535,305,126,181.5,612],[375,499,220,187,485,615.5],[666,499,110,196,721,621],[848,499,220,187,958,615.5],[1110,535,304,126,1261.5,615.5],[1459,534,205,144,1561.5,610.5],[1729,515,118,185,1788,617],[1918,534,205,144,2020,607]],
    [[29,771,305,126,181.5,848],[375,735,220,187,485,851.5],[666,735,110,196,721,857],[848,735,220,187,958,851.5],[1110,771,304,126,1261.5,851.5],[1459,770,205,144,1561.5,846.5],[1729,751,118,185,1788,853],[1918,770,205,144,2020,843]],
    [[29,1007,305,126,181.5,1084],[375,971,220,187,485,1087.5],[666,971,110,196,721,1093],[848,971,220,187,958,1087.5],[1110,1007,304,126,1261.5,1087.5],[1459,1006,205,144,1561.5,1082.5],[1729,987,118,185,1788,1089],[1918,1006,205,144,2020,1079]]
  ];
  function draw(ctx, x, y, size, angle, cargo = null) {
    if (!atlas.complete || !atlas.naturalWidth) return false;
    const col = columns[headingIndex(angle)];
    const row = { fuel: 1, grain: 2, ore: 3, machinery: 4 }[cargo] ?? 0;
    const [sx, sy, sw, sh, cx, cy] = frames[row][col];
    const scale = size / 305;
    const dw = sw * scale, dh = sh * scale;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlas, sx, sy, sw, sh,
      x + (sx-cx)*scale, y + (sy-cy)*scale, dw, dh);
    ctx.restore();
    return true;
  }
  return { draw, headingIndex };
})();
