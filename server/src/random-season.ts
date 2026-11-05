import { createHash } from 'node:crypto';
import {
  generateVerifiedMap, validateMap, Tile,
  type GeneratedMap, type Seed, type Settings,
} from './map-generation-pipeline.js';
import {
  findWaterPath, simplifyWaterPath, canSailStraight, serializeGrid, decodeGrid,
  type NavigationMap, type Grid,
} from './navigation.js';

interface Generation extends Omit<GeneratedMap, 'tiles' | 'ports'> { tilesBase64: string }
export interface RandomSeasonMap extends NavigationMap {
  ports: GeneratedMap['ports'];
  generation: Generation;
}

/** A minimum spanning tree guarantees a connected port graph; nearby extra
 * links provide route choices. Euclidean distance selects graph edges only:
 * every edge's actual geometry and distance are then computed through water. */
function portEdges(ports: GeneratedMap['ports']): Array<{ a: number; b: number }> {
  const edges = new Map<string, { a: number; b: number }>();
  const add = (a: number, b: number) => {
    if (a > b) [a, b] = [b, a];
    edges.set(`${a}:${b}`, { a, b });
  };
  const distance = (a: number, b: number) => Math.hypot(ports[a].x - ports[b].x, ports[a].y - ports[b].y);
  const connected = new Set([0]);
  while (connected.size < ports.length) {
    let best = Infinity, from = -1, to = -1;
    for (const a of connected) for (let b = 0; b < ports.length; b++) {
      if (!connected.has(b) && distance(a, b) < best) {
        best = distance(a, b); from = a; to = b;
      }
    }
    if (to < 0) throw new Error('Cannot connect port graph');
    add(from, to); connected.add(to);
  }
  for (const a of ports) {
    const nearby = ports.filter(b => b.id !== a.id)
      .sort((b, c) => distance(a.id, b.id) - distance(a.id, c.id));
    for (const b of nearby.slice(0, 3)) add(a.id, b.id);
  }
  return [...edges.values()].sort((a, b) => a.a - b.a || a.b - b.b);
}

function gridFor(map: GeneratedMap): Grid {
  return {
    width: map.width, height: map.height, cellSize: map.cellSize,
    cols: map.cols, rows: map.rows,
    // Use EXACTLY the accepted terrain. Do not regenerate noise or dredge it.
    water: Uint8Array.from(map.tiles, tile => tile === Tile.LAND ? 0 : 1),
  };
}

/** This second gate checks the final snapshot, including pathfinding output,
 * before main.ts is allowed to replace the active SQLite map. */
export function validateSeasonMap(map: RandomSeasonMap): boolean {
  if (!map.generation || !map.terrain || !map.ports || !map.routes) return false;
  const { tilesBase64, ...metadata } = map.generation;
  const candidate: GeneratedMap = {
    ...metadata, ports: map.ports,
    tiles: Uint8Array.from(Buffer.from(tilesBase64, 'base64')),
  };
  const policy: Settings = {
    width: metadata.width, height: metadata.height,
    cellSize: metadata.cellSize, minPortDistance: metadata.minPortDistance,
  };
  if (!validateMap(candidate, policy)) return false;
  const grid = gridFor(candidate), stored = decodeGrid(map.terrain);
  if (stored.width !== grid.width || stored.height !== grid.height ||
      stored.cellSize !== grid.cellSize || stored.cols !== grid.cols || stored.rows !== grid.rows ||
      !Buffer.from(stored.water).equals(Buffer.from(grid.water))) return false;

  const neighbours = map.ports.map(() => [] as number[]), edgeKeys = new Set<string>();
  for (const route of map.routes) {
    const { a, b, distance, waypoints } = route;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 ||
        a >= map.ports.length || b >= map.ports.length || a === b ||
        !Number.isFinite(distance) || distance <= 0 || !waypoints || waypoints.length < 2) return false;
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    const first = waypoints[0], last = waypoints[waypoints.length - 1];
    if (first.x !== map.ports[a].x || first.y !== map.ports[a].y ||
        last.x !== map.ports[b].x || last.y !== map.ports[b].y) return false;
    let measured = 0;
    for (let i = 0; i < waypoints.length; i++) {
      const p = waypoints[i];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 ||
          p.x >= grid.width || p.y >= grid.height) return false;
      if (!i) continue;
      const previous = waypoints[i - 1];
      if (!canSailStraight(grid, previous, p) || !canSailStraight(grid, p, previous)) return false;
      measured += Math.hypot(p.x - previous.x, p.y - previous.y);
    }
    if (Math.abs(measured - distance) > 1e-7) return false;
    neighbours[a].push(b); neighbours[b].push(a);
  }
  const connected = new Set([0]), queue = [0];
  for (let i = 0; i < queue.length; i++) for (const next of neighbours[queue[i]]) {
    if (!connected.has(next)) { connected.add(next); queue.push(next); }
  }
  return connected.size === map.ports.length;
}

export async function generateRandomSeason(options: {
  seed?: Seed; settings?: Partial<Settings>; maxAttempts?: number;
  names?: string[]; budgetMs?: number;
} = {}): Promise<RandomSeasonMap> {
  const candidate = await generateVerifiedMap(options);
  // Existing fictional names remain useful, while their positions and roles
  // change independently each season. IDs still match engine array indices.
  const ports = candidate.ports.map((p, i) => ({ ...p, name: options.names?.[i] ?? p.name }));
  const grid = gridFor(candidate);
  const routes = portEdges(ports).map(({ a, b }) => {
    const raw = findWaterPath(grid, ports[a], ports[b]);
    if (!raw) throw new Error(`No water route between ${a} and ${b}`);
    const waypoints = simplifyWaterPath(grid, raw).map(({ x, y }) => ({ x, y }));
    let distance = 0;
    for (let i = 1; i < waypoints.length; i++) {
      distance += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].y - waypoints[i - 1].y);
    }
    return { a, b, distance, waypoints };
  });
  const { tiles, ports: ignoredPorts, ...metadata } = candidate;
  const hash = createHash('sha256').update(JSON.stringify(candidate.seed)).digest('hex');
  const snapshot = {
    seed: parseInt(hash.slice(0, 8), 16), ports, routes, terrain: serializeGrid(grid),
    generation: { ...metadata, tilesBase64: Buffer.from(tiles).toString('base64') },
  };
  const result = {
    ...snapshot,
    navigationId: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 20),
  };
  if (!validateSeasonMap(result)) throw new Error('Final season map failed verification');
  return result;
}
