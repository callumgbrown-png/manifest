import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRandomSeason, validateSeasonMap } from '../src/random-season.ts';
import { DEFAULTS, Tile } from '../src/map-generation-pipeline.ts';
import { components } from '../src/archipelago.ts';
import { Geo } from '../src/geo.ts';

const ORIGINAL = { width: 1000, height: 700 };

test('the world is exactly 4x the original area, and lanes are priced in original units', () => {
  assert.equal(DEFAULTS.width * DEFAULTS.height, 4 * ORIGINAL.width * ORIGINAL.height);
  assert.equal(DEFAULTS.worldScale ** 2, 4);
  assert.equal(DEFAULTS.minPortDistance, 56 * DEFAULTS.worldScale, 'ports are as far apart in economy units as before');
});

for (const seed of ['archipelago-a', 'archipelago-b', 'archipelago-c']) {
  test(`seed ${seed}: 5 land masses + 3 islands, every one harboured, economy distances unscaled`, async () => {
    const map = await generateRandomSeason({ seed });
    const g = map.generation, tiles = Uint8Array.from(Buffer.from(g.tilesBase64, 'base64'));
    assert.equal(g.width, 2000); assert.equal(g.height, 1400);
    assert.equal(map.ports.length, 40);

    const { labels, sizes } = components(g.cols, g.rows, i => tiles[i] === Tile.LAND);
    assert.equal(sizes.length, 8, 'exactly 8 separate bodies of land');
    const sorted = [...sizes].sort((a, b) => b - a);
    assert.ok(sorted[5] < sorted[4] * 0.45, 'the 3 islands are clearly smaller than the 5 land masses');
    const portsOn = new Map<number, number>();
    for (const p of map.ports) {
      const body = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => labels[(p.gridY + dy) * g.cols + p.gridX + dx]).find(l => l >= 0)!;
      portsOn.set(body, (portsOn.get(body) ?? 0) + 1);
    }
    assert.equal(portsOn.size, 8, 'every land mass and island has at least one port');
    const islandBodies = sizes.map((s, id) => ({ s, id })).sort((a, b) => a.s - b.s).slice(0, 3).map(b => b.id);
    assert.equal(islandBodies.reduce((n, id) => n + (portsOn.get(id) ?? 0), 0), 5, 'islands hold 2 + 2 + 1 ports');

    // Economy: a lane's distance is its sailed map length divided by worldScale, so it matches the old units.
    assert.equal(map.worldScale, 2);
    for (const r of map.routes) {
      let len = 0; for (let i = 1; i < r.waypoints!.length; i++) len += Math.hypot(r.waypoints![i].x - r.waypoints![i - 1].x, r.waypoints![i].y - r.waypoints![i - 1].y);
      assert.ok(Math.abs(len / 2 - r.distance) < 1e-6);
    }
    const d = map.routes.map(r => r.distance).sort((a, b) => a - b);
    assert.ok(d[0] >= 40 && d[d.length - 1] < 400, `lane distances stay in the original range (got ${d[0].toFixed(0)}-${d[d.length - 1].toFixed(0)})`);
    assert.ok(validateSeasonMap(map));
  });
}

test('pirate and police ranges are measured in original units on the bigger map', () => {
  const geo = new Geo({ worldScale: 2, ports: [], routes: [] } as any);
  assert.equal(geo.dist({ x: 0, y: 0 }, { x: 140, y: 0 }), 70);   // 140 map units = 70 original units
  assert.equal(new Geo({ ports: [], routes: [] } as any).dist({ x: 0, y: 0 }, { x: 140, y: 0 }), 140);   // old worlds unchanged
});
