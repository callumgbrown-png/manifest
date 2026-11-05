import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRandomSeason, validateSeasonMap } from '../src/random-season.ts';
import { decodeGrid } from '../src/navigation.ts';
import { Engine } from '../src/engine.ts';
import { readFileSync } from 'node:fs';

test('10 random layouts have verified coasts, economies and connected safe A* graphs', async () => {
  const hashes = new Set<string>();
  const rules = JSON.parse(readFileSync(new URL('../../config/rules.json', import.meta.url), 'utf8'));
  for (let seed = 0; seed < 10; seed++) {
    const map = await generateRandomSeason({ seed });
    assert.equal(validateSeasonMap(map), true);
    hashes.add(map.navigationId);
    assert.equal(map.ports.length, 40);
    assert.ok(map.routes.length >= 39);
    const engine = new Engine(rules, map, 60);
    for (const row of engine.dist) assert.ok(row.every(Number.isFinite));
    const grid = decodeGrid(map.terrain!);
    for (const port of map.ports) assert.equal(grid.water[port.gridY * grid.cols + port.gridX], 1);
  }
  assert.equal(hashes.size, 10);
});

test('complete snapshots reproduce from seed, and corrupted route/terrain output is rejected', async () => {
  const map = await generateRandomSeason({ seed: 'final-snapshot-test' });
  assert.deepEqual(await generateRandomSeason({ seed: 'final-snapshot-test' }), map);
  const distance = structuredClone(map);
  distance.routes[0].distance += 1;
  assert.equal(validateSeasonMap(distance), false);
  const wrongEnd = structuredClone(map);
  wrongEnd.routes[0].waypoints![0].x += 2;
  assert.equal(validateSeasonMap(wrongEnd), false);
  const terrain = structuredClone(map);
  const bytes = Buffer.from(terrain.terrain!.waterBase64, 'base64');
  bytes[0] = bytes[0] ? 0 : 1;
  terrain.terrain!.waterBase64 = bytes.toString('base64');
  assert.equal(validateSeasonMap(terrain), false);
  const disconnected = structuredClone(map);
  disconnected.routes = disconnected.routes.filter(r => r.a !== 0 && r.b !== 0);
  assert.equal(validateSeasonMap(disconnected), false);
});
