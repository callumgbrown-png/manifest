import { randomBytes } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';

export type Seed = string | number;
export type Good = 'grain' | 'fuel';
export enum Tile { LAND = 0, SHALLOW_COAST = 1, OPEN_WATER = 2 }

export interface Settings {
  width: number;
  height: number;
  cellSize: number;
  minPortDistance: number;
}

export interface Port {
  id: number;
  name: string;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  coastDirection: { dx: number; dy: number }; // Points toward adjacent LAND.
  produces: Good[];
  consumes: Good[];
}

export interface GeneratedMap extends Settings {
  generatorVersion: 1;
  seed: Seed; // Persist the successful candidate seed, not just the initial seed.
  cols: number;
  rows: number;
  tiles: Uint8Array;
  ports: Port[];
}

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  width: 1000, height: 700, cellSize: 4, minPortDistance: 56,
});

export const NOISE = Object.freeze({
  largeScale: 420, mediumScale: 190, detailScale: 80,
  landThreshold: 0.02,
});
const PORT_COUNT = 40;
const MIN_PRODUCERS = Math.ceil(PORT_COUNT * 0.35); // 14 of each good.
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function seedKey(seed: Seed): string {
  if (typeof seed !== 'string' && typeof seed !== 'number') throw new Error('Invalid seed type');
  if (typeof seed === 'number' && !Number.isFinite(seed)) {
    throw new Error('Numeric seeds must be finite');
  }
  return `${typeof seed}:${seed}`; // Numeric 7 and string "7" remain distinct.
}

// FNV-1a and Mulberry32: deterministic seeds and sampling, not cryptography.
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function randomStream(seed: string): () => number {
  let state = hashString(seed);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

function lattice(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Smooth, seeded 2D value noise. Large wavelengths favour shared landmasses;
// the low-amplitude final octave only roughens their coastlines.
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const u = smooth(x - ix), v = smooth(y - iy);
  const a = lattice(ix, iy, seed), b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed), d = lattice(ix + 1, iy + 1, seed);
  return ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v) * 2 - 1;
}

function checkedSettings(overrides: Partial<Settings>): Settings {
  const settings = { ...DEFAULTS, ...overrides };
  const { width, height, cellSize, minPortDistance } = settings;
  if (![width, height, cellSize].every(n => Number.isSafeInteger(n) && n > 0) ||
      width % cellSize || height % cellSize ||
      !Number.isFinite(minPortDistance) || minPortDistance <= 0 ||
      width / cellSize < 3 || height / cellSize < 3) {
    throw new Error('Invalid map settings');
  }
  // Prevent accidental multi-gigabyte allocations from bad configuration.
  if ((width / cellSize) * (height / cellSize) > 1_000_000) {
    throw new Error('Navigation grid exceeds one million cells');
  }
  return settings;
}

const isWater = (tile: number) => tile === Tile.SHALLOW_COAST || tile === Tile.OPEN_WATER;

function adjacentLand(map: Pick<GeneratedMap, 'tiles' | 'cols' | 'rows'>, x: number, y: number) {
  return DIRECTIONS.filter(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < map.cols && ny < map.rows &&
      map.tiles[ny * map.cols + nx] === Tile.LAND;
  });
}

/**
 * Identify the largest boundary-connected water component, excluding lakes.
 * Four-way BFS agrees with an eight-way A* that forbids diagonal corner cuts.
 * Each tile is visited at most once. A typed queue avoids Array.shift().
 */
export function oceanMask(map: Pick<GeneratedMap, 'tiles' | 'cols' | 'rows'>): Uint8Array {
  const { cols, rows, tiles } = map;
  const seen = new Uint8Array(tiles.length);
  const queue = new Int32Array(tiles.length);
  let best = new Int32Array(0);

  for (let start = 0; start < tiles.length; start++) {
    if (seen[start] || !isWater(tiles[start])) continue;
    let head = 0, tail = 1, touchesBoundary = false;
    queue[0] = start;
    seen[start] = 1;

    while (head < tail) {
      const index = queue[head++], x = index % cols, y = Math.floor(index / cols);
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) touchesBoundary = true;
      for (const [dx, dy] of DIRECTIONS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (!seen[next] && isWater(tiles[next])) {
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (touchesBoundary && tail > best.length) best = queue.slice(0, tail);
  }

  const mask = new Uint8Array(tiles.length);
  for (const index of best) mask[index] = 1;
  return mask;
}

/**
 * Build one deterministic candidate. A candidate may contain fewer than 40
 * ports if spacing/coast constraints cannot be met; validation then rejects it.
 * Terrain is never modified to rescue a failed candidate or drain its lakes.
 */
export function generateCandidate(seed: Seed, overrides: Partial<Settings> = {}): GeneratedMap {
  const settings = checkedSettings(overrides);
  const { width, height, cellSize, minPortDistance } = settings;
  const cols = width / cellSize, rows = height / cellSize;
  const tiles = new Uint8Array(cols * rows);
  const key = seedKey(seed), noiseSeed = hashString(`${key}:terrain`);
  const random = randomStream(`${key}:ports`);

  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const px = (x + 0.5) * cellSize, py = (y + 0.5) * cellSize;
    let elevation = noise(px / NOISE.largeScale, py / NOISE.largeScale, noiseSeed) * 0.72 +
      noise(px / NOISE.mediumScale, py / NOISE.mediumScale, noiseSeed + 1) * 0.22 +
      noise(px / NOISE.detailScale, py / NOISE.detailScale, noiseSeed + 2) * 0.06 - NOISE.landThreshold;

    // An ocean rim prevents the world boundary from sealing off all open sea.
    const edge = Math.min(px, py, width - px, height - py);
    const inlandWeight = smooth((edge - 12) / 70);
    elevation = elevation * inlandWeight - 0.7 * (1 - inlandWeight);
    tiles[y * cols + x] = elevation > 0 ? Tile.LAND : Tile.OPEN_WATER;
  }

  const map: GeneratedMap = { ...settings, generatorVersion: 1, seed, cols, rows, tiles, ports: [] };
  // Classify water next to land. Changing WATER to SHALLOW doesn't affect
  // later neighbour tests because only LAND counts as land.
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const index = y * cols + x;
    if (tiles[index] !== Tile.LAND && adjacentLand(map, x, y).length) tiles[index] = Tile.SHALLOW_COAST;
  }

  const ocean = oceanMask(map);
  const candidates: number[] = [];
  for (let index = 0; index < tiles.length; index++) {
    if (tiles[index] === Tile.SHALLOW_COAST && ocean[index]) candidates.push(index);
  }
  shuffle(candidates, random);

  // Spatial buckets make placement checks local rather than comparing every
  // coastal candidate against every already selected port.
  const buckets = new Map<string, Port[]>();
  const distanceSquared = minPortDistance * minPortDistance;
  for (const index of candidates) {
    const gridX = index % cols, gridY = Math.floor(index / cols);
    const x = (gridX + 0.5) * cellSize, y = (gridY + 0.5) * cellSize;
    const bx = Math.floor(x / minPortDistance), by = Math.floor(y / minPortDistance);
    let tooClose = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const other of buckets.get(`${bx + dx}:${by + dy}`) ?? []) {
        if ((other.x - x) ** 2 + (other.y - y) ** 2 < distanceSquared) tooClose = true;
      }
    }
    if (tooClose) continue;

    const land = adjacentLand(map, gridX, gridY);
    const [dx, dy] = land[Math.floor(random() * land.length)];
    const port: Port = {
      id: map.ports.length, name: `Harbour ${String(map.ports.length + 1).padStart(2, '0')}`,
      x, y, gridX, gridY, coastDirection: { dx, dy }, produces: [], consumes: [],
    };
    map.ports.push(port);
    const bucketKey = `${bx}:${by}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    buckets.get(bucketKey)!.push(port);
    if (map.ports.length === PORT_COUNT) break;
  }

  // Randomize economic roles independently of geographic selection order.
  // 16 grain producers, 16 fuel producers, 8 consumers: 40% availability each.
  // Opposite-good consumption creates destinations instead of supply only.
  const roles = [...map.ports];
  shuffle(roles, random);
  roles.forEach((port, index) => {
    if (index < 16) { port.produces = ['grain']; port.consumes = ['fuel']; }
    else if (index < 32) { port.produces = ['fuel']; port.consumes = ['grain']; }
    else port.consumes = ['grain', 'fuel'];
  });
  return map;
}

/** Independently validate the candidate; never trust the placement algorithm. */
export function validateMap(map: GeneratedMap, overrides: Partial<Settings> = {}): boolean {
  const expected = checkedSettings(overrides);
  if (!map || map.generatorVersion !== 1 ||
      (typeof map.seed !== 'string' && typeof map.seed !== 'number') ||
      (typeof map.seed === 'number' && !Number.isFinite(map.seed)) ||
      map.width !== expected.width || map.height !== expected.height ||
      map.cellSize !== expected.cellSize || map.minPortDistance !== expected.minPortDistance ||
      map.cols !== expected.width / expected.cellSize || map.rows !== expected.height / expected.cellSize ||
      !(map.tiles instanceof Uint8Array) || map.tiles.length !== map.cols * map.rows ||
      !Array.isArray(map.ports) || map.ports.length !== PORT_COUNT) return false;
  for (const tile of map.tiles) if (tile !== Tile.LAND && !isWater(tile)) return false;

  const ocean = oceanMask(map);
  let grain = 0, fuel = 0;
  for (let i = 0; i < map.ports.length; i++) {
    const port = map.ports[i];
    // Sequential IDs preserve Manifest's current ID-as-array-index convention.
    if (!port || port.id !== i || !Number.isInteger(port.gridX) || !Number.isInteger(port.gridY) ||
        port.gridX < 0 || port.gridY < 0 || port.gridX >= map.cols || port.gridY >= map.rows ||
        !Number.isFinite(port.x) || !Number.isFinite(port.y) ||
        Math.abs(port.x - (port.gridX + 0.5) * map.cellSize) > 1e-6 ||
        Math.abs(port.y - (port.gridY + 0.5) * map.cellSize) > 1e-6) return false;

    const index = port.gridY * map.cols + port.gridX;
    if (map.tiles[index] !== Tile.SHALLOW_COAST || !ocean[index]) return false;
    const land = adjacentLand(map, port.gridX, port.gridY);
    const direction = port.coastDirection;
    if (!direction || !land.some(([dx, dy]) => dx === direction.dx && dy === direction.dy)) return false;
    if (!Array.isArray(port.produces) || !Array.isArray(port.consumes) ||
        [...port.produces, ...port.consumes].some(g => g !== 'grain' && g !== 'fuel')) return false;

    grain += port.produces.includes('grain') ? 1 : 0;
    fuel += port.produces.includes('fuel') ? 1 : 0;
    for (let j = 0; j < i; j++) {
      if (Math.hypot(port.x - map.ports[j].x, port.y - map.ports[j].y) < expected.minPortDistance) return false;
    }
  }
  return grain >= MIN_PRODUCERS && fuel >= MIN_PRODUCERS;
}

export interface PipelineOptions {
  seed?: Seed;
  settings?: Partial<Settings>;
  maxAttempts?: number;
  budgetMs?: number;
  signal?: AbortSignal;
  onRejected?: (seed: Seed, attempt: number) => void;
}

/**
 * Retry rejected seeds without recursive calls or an unbounded busy loop.
 * A fixed initial seed produces the same candidate sequence. Omit it for a
 * cryptographically random season seed. Yield between failures for other I/O.
 */
export async function generateVerifiedMap(options: PipelineOptions = {}): Promise<GeneratedMap> {
  const settings = checkedSettings(options.settings ?? {});
  const root = options.seed ?? randomBytes(16).toString('hex');
  const key = seedKey(root), maxAttempts = options.maxAttempts ?? 128;
  const budgetMs = options.budgetMs ?? 10_000, started = performance.now();
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error('Invalid generation limits');
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    options.signal?.throwIfAborted();
    if (performance.now() - started >= budgetMs) break;
    const seed: Seed = attempt === 0 ? root : `${key}:retry:${attempt}`;
    const candidate = generateCandidate(seed, settings);
    if (validateMap(candidate, settings)) return candidate;
    options.onRejected?.(seed, attempt + 1);
    await yieldToEventLoop();
  }
  throw new Error(`No valid map within ${maxAttempts} attempts / ${budgetMs}ms; no map was saved`);
}

/** Save only a verified candidate. Activate it in the season-transition
 * transaction AFTER building and checking its A* route graph. This staging
 * table deliberately does not overwrite an active season or its event log. */
export function saveVerifiedMap(db: DatabaseSync, map: GeneratedMap, settings: Partial<Settings> = {}): number {
  if (!validateMap(map, settings)) throw new Error('Refusing to save an invalid map');
  db.exec(`CREATE TABLE IF NOT EXISTS generated_maps (
    id INTEGER PRIMARY KEY, seed_json TEXT NOT NULL,
    generator_version INTEGER NOT NULL, map_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  const { tiles, ...metadata } = map;
  const payload = JSON.stringify({ ...metadata, tilesBase64: Buffer.from(tiles).toString('base64') });
  const result = db.prepare(`INSERT INTO generated_maps
    (seed_json, generator_version, map_json, created_at) VALUES (?, ?, ?, ?)`)
    .run(JSON.stringify(map.seed), map.generatorVersion, payload, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function loadVerifiedMap(db: DatabaseSync, id: number, settings: Partial<Settings> = {}): GeneratedMap {
  const row = db.prepare('SELECT map_json FROM generated_maps WHERE id=?').get(id) as { map_json: string } | undefined;
  if (!row) throw new Error('Saved map not found');
  const { tilesBase64, ...metadata } = JSON.parse(row.map_json);
  if (typeof tilesBase64 !== 'string') throw new Error('Missing saved terrain');
  const map: GeneratedMap = { ...metadata, tiles: Uint8Array.from(Buffer.from(tilesBase64, 'base64')) };
  if (!validateMap(map, settings)) throw new Error('Saved map failed validation');
  return map;
}
