import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  generateCandidate, generateVerifiedMap, validateMap, saveVerifiedMap,
  loadVerifiedMap, Tile, type GeneratedMap,
} from '../src/map-generation-pipeline.ts';

let valid: GeneratedMap;
test('generates a reproducible verified map with 40 separated ocean-side ports', async () => {
  valid = await generateVerifiedMap({ seed: 'Manifest-test', budgetMs: 20_000 });
  assert.equal(validateMap(valid), true);
  assert.equal(valid.ports.length, 40);
  assert.deepEqual(generateCandidate(valid.seed), valid);
  assert.deepEqual(await generateVerifiedMap({ seed: 'Manifest-test', budgetMs: 20_000 }), valid);
  for (const good of ['grain', 'fuel'] as const) {
    assert.equal(valid.ports.filter(port => port.produces.includes(good)).length, 16);
  }
});

test('rejects an isolated coastal harbour inside a landlocked pocket', () => {
  const map = structuredClone(valid), port = map.ports[0];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = port.gridX + dx, y = port.gridY + dy;
    if (x >= 0 && y >= 0 && x < map.cols && y < map.rows) map.tiles[y * map.cols + x] = Tile.LAND;
  }
  map.tiles[port.gridY * map.cols + port.gridX] = Tile.SHALLOW_COAST;
  const x = port.gridX - port.coastDirection.dx;
  const y = port.gridY - port.coastDirection.dy;
  map.tiles[y * map.cols + x] = Tile.SHALLOW_COAST;
  assert.equal(validateMap(map), false);
});

test('rejects insufficient grain or fuel production', () => {
  for (const missing of ['grain', 'fuel'] as const) {
    const map = structuredClone(valid);
    for (const port of map.ports) port.produces = port.produces.filter(g => g !== missing);
    assert.equal(validateMap(map), false);
  }
});

test('rejects overlapping ports, bad coast vectors, missing ports, land and invalid coordinates', () => {
  const overlap = structuredClone(valid);
  Object.assign(overlap.ports[1], {
    x: overlap.ports[0].x, y: overlap.ports[0].y,
    gridX: overlap.ports[0].gridX, gridY: overlap.ports[0].gridY,
    coastDirection: overlap.ports[0].coastDirection,
  });
  assert.equal(validateMap(overlap), false);
  const direction = structuredClone(valid);
  direction.ports[0].coastDirection = { dx: 0, dy: 0 };
  assert.equal(validateMap(direction), false);
  const missing = structuredClone(valid); missing.ports.pop();
  assert.equal(validateMap(missing), false);
  const land = structuredClone(valid), p = land.ports[0];
  land.tiles[p.gridY * land.cols + p.gridX] = Tile.LAND;
  assert.equal(validateMap(land), false);
  const coordinates = structuredClone(valid); coordinates.ports[0].x = NaN;
  assert.equal(validateMap(coordinates), false);
});

test('retry sequence is bounded when placement is impossible', async () => {
  const rejected: Array<string | number> = [];
  await assert.rejects(generateVerifiedMap({
    seed: 'impossible', settings: { minPortDistance: 2000 }, maxAttempts: 2,
    budgetMs: 20_000, onRejected: seed => rejected.push(seed),
  }), /No valid map/);
  assert.deepEqual(rejected, ['impossible', 'string:impossible:retry:1']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateVerifiedMap({ signal: controller.signal }), { name: 'AbortError' });
});

test('SQLite stores and reloads validated maps and refuses invalid writes', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const broken = structuredClone(valid); broken.ports.pop();
    assert.throws(() => saveVerifiedMap(db, broken), /invalid map/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='generated_maps'").get()!.n, 0);
    const id = saveVerifiedMap(db, valid);
    assert.deepEqual(loadVerifiedMap(db, id), valid);
    const count = db.prepare('SELECT COUNT(*) AS n FROM generated_maps').get()!.n;
    assert.throws(() => saveVerifiedMap(db, broken));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM generated_maps').get()!.n, count);
  } finally { db.close(); }
});

test('20 different initial seeds produce independently valid, varied layouts', async () => {
  const layouts = new Set<string>(), started = performance.now();
  for (let seed = 0; seed < 20; seed++) {
    const map = await generateVerifiedMap({ seed, budgetMs: 20_000 });
    assert.equal(validateMap(map), true);
    layouts.add(JSON.stringify(map.ports.map(p => [p.x, p.y])));
  }
  assert.equal(layouts.size, 20);
  console.log(`Verified 20 different layouts in ${(performance.now() - started).toFixed(0)}ms`);
});
