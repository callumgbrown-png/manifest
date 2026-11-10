// Shared helpers for the economy feature modules. Everything here is deterministic and read-only on the engine,
// except the trip watcher's own bookkeeping, which callers update only from enable/apply/advance.
import { GOODS, type Engine, type Result, type Ship, type Trip } from "../../engine.js";
import type { FeatureAction, FeatureField } from "../../expansion-cards.js";

export const fail = (error: string): Result => ({ ok: false, error });
export const ok: Result = { ok: true };

/** A safe integer in [min, max]. Every numeric command field goes through this. */
export function whole(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const day = (e: Engine) => Math.floor(e.tick / 24);
export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `port ${p}`;

/** A card action that sends { type: "feature", module, action, ...extra }. */
export function action(module: string, label: string, kind: string, extra: Record<string, unknown> = {}, fields?: FeatureField[]): FeatureAction {
  return { label, command: { type: "feature", module, action: kind, ...extra }, ...(fields?.length ? { fields } : {}) };
}

export function qtyField(max: number, value = max, label = "Tonnes"): FeatureField {
  return { key: "qty", label, min: 1, max: Math.max(1, Math.floor(max)), value: Math.max(1, Math.floor(Math.min(max, value))) };
}

export function shipField(e: Engine, ships: Ship[]): FeatureField {
  return { key: "ship", label: "Ship", options: ships.map(s => ({ value: s.id, label: `#${s.id} ${s.type} at ${portName(e, s.port)}` })), value: ships[0]?.id };
}

export function goodField(goods: readonly number[] = GOODS.map((_, g) => g)): FeatureField {
  return { key: "good", label: "Good", options: goods.map(g => ({ value: g, label: GOODS[g] })), value: goods[0] };
}

export function portField(e: Engine, ports: number[], key = "port", label = "Port"): FeatureField {
  return { key, label, options: ports.map(p => ({ value: p, label: portName(e, p) })), value: ports[0] };
}

/** The company's ships docked in port (not pirates). */
export function dockedShips(e: Engine, company: number): Ship[] {
  const c = e.companies.get(company);
  if (!c) return [];
  return c.ships.map(id => e.ships.get(id)).filter((s): s is Ship => !!s && s.dest === null && s.type !== "pirate");
}

/** An owned, docked, non-pirate ship not run by a voyage queue, or undefined. */
export function ownDocked(e: Engine, company: number, id: unknown): Ship | undefined {
  if (!whole(id, 1, Number.MAX_SAFE_INTEGER)) return undefined;
  const s = e.ships.get(id);
  return s && s.owner === company && s.dest === null && s.type !== "pirate" && !e.voyageQueues.has(s.id) ? s : undefined;
}

/** Spare hold space after engine cargo (module cargo already counted through the capacity hook). */
export function freeSpace(e: Engine, s: Ship) { return Math.max(0, e.expansionCapacity(s) - s.qty); }

/** Take qty of a ship's engine cargo off it (processing, recycling, contracts). Returns the cost basis removed. */
export function unloadEngineCargo(e: Engine, s: Ship, qty: number): number {
  const cost = s.qty > 0 ? s.cost * qty / s.qty : 0;
  s.qty -= qty;
  s.cost -= cost;
  if (s.qty <= 0) { s.qty = 0; s.good = null; s.cost = 0; }
  e.maritime.cargoMoved(s, qty);
  e.maritime.dockedCargoChanged(s);
  e.recordSpecialSale(s, cost);
  return cost;
}

/** Put engine cargo on a docked ship (empty or carrying the same good). */
export function loadEngineCargo(e: Engine, s: Ship, good: number, qty: number, cost: number) {
  s.good = good;
  s.qty += qty;
  s.cost += cost;
  e.recordCargoLoaded(s, cost);
}

// ------------------------------------------------------------ geography (derived from the map only)

const regionCache = new WeakMap<Engine, number[]>();
export const REGION_NAMES = ["Northwest Isles", "Northeast Isles", "Southwest Isles", "Southeast Isles"];

/** Island group of each port: the map split at the median x and median y, so each group holds about a quarter. */
export function regions(e: Engine): number[] {
  let r = regionCache.get(e);
  if (!r) {
    const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
    const mx = med(e.map.ports.map(p => p.x)), my = med(e.map.ports.map(p => p.y));
    r = e.map.ports.map(p => (p.x >= mx ? 1 : 0) + (p.y >= my ? 2 : 0));
    regionCache.set(e, r);
  }
  return r;
}

const isolatedCache = new WeakMap<Engine, number[]>();
/** The most remote ports (largest distance to their nearest neighbour), about one in eight. */
export function isolatedPorts(e: Engine): number[] {
  let r = isolatedCache.get(e);
  if (!r) {
    const ports = e.map.ports;
    const gap = ports.map(p => Math.min(...ports.filter(q => q.id !== p.id).map(q => Math.hypot(p.x - q.x, p.y - q.y))));
    r = ports.map(p => p.id).filter(id => e.dist[id].some((d, j) => j !== id && Number.isFinite(d)))
      .sort((a, b) => gap[b] - gap[a] || a - b).slice(0, Math.max(2, Math.round(ports.length / 8))).sort((a, b) => a - b);
    isolatedCache.set(e, r);
  }
  return r;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A fixed, map-derived choice of `count` connected ports for a named purpose (same every replay). */
export function pickPorts(e: Engine, salt: string, count: number, from?: number[]): number[] {
  const pool = (from ?? e.map.ports.map(p => p.id)).filter(id => e.dist[id].some((d, j) => j !== id && Number.isFinite(d)));
  return pool.map(id => ({ id, h: hash(`${salt}:${id}`) })).sort((a, b) => a.h - b.h || a.id - b.id)
    .slice(0, Math.min(count, pool.length)).map(x => x.id).sort((a, b) => a - b);
}

/** Ships at sea per lane ("a-b" with a < b). */
export function laneTraffic(e: Engine): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of e.ships.values()) {
    if (s.dest === null || s.type === "pirate") continue;
    const key = laneKey(s.port, s.dest);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}
export const laneKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Average price of each engine good across all ports. */
export function priceIndex(e: Engine): number[] {
  return GOODS.map((_, g) => { let sum = 0; for (let p = 0; p < e.n; p++) sum += e.price(p, g); return sum / e.n; });
}

// ------------------------------------------------------------ trip watcher

export interface SeenTrip { company: number; trip: Trip }
const tripKey = (t: Trip) => `${t.ship}:${t.departTick}`;

/** Finds trips that started or finished since the last call. Prime it in enable() so switching a module on
 *  mid-season does not reward old voyages. */
export class TripWatcher {
  private opened = new Set<string>();
  private closed = new Set<string>();

  prime(e: Engine) { this.scan(e); }

  scan(e: Engine): { opened: SeenTrip[]; closed: SeenTrip[] } {
    const opened: SeenTrip[] = [], closed: SeenTrip[] = [];
    const nextOpened = new Set<string>(), nextClosed = new Set<string>();
    for (const [company, list] of e.trips) for (const trip of list) {
      const key = `${company}:${tripKey(trip)}`;
      nextOpened.add(key);
      if (!this.opened.has(key)) opened.push({ company, trip });
      if (!trip.open) {
        nextClosed.add(key);
        if (!this.closed.has(key)) closed.push({ company, trip });
      }
    }
    this.opened = nextOpened;
    this.closed = nextClosed;
    return { opened, closed };
  }
}

/** Ships that docked during this tick. */
export function arrivedThisHour(e: Engine): Ship[] {
  return [...e.ships.values()].filter(s => s.dest === null && s.arriveTick === e.tick && s.departTick < e.tick);
}

// ------------------------------------------------------------ small shared bits

export const credits = (n: number) => `${Math.round(n).toLocaleString("en-GB")} cr`;
/** Index of an engine good by name, or undefined (a function, not a table: engine.ts imports this module tree). */
export const goodIndex = (name: string): number | undefined => { const i = (GOODS as readonly string[]).indexOf(name); return i >= 0 ? i : undefined; };
export const isEngineGood = (g: unknown): g is number => whole(g, 0, GOODS.length - 1);
export const cashOf = (e: Engine, company: number) => e.companies.get(company)?.cash ?? 0;

/** Mid-band price of an engine good (used for "how expensive is it now"). */
export function midPrice(e: Engine, g: number) {
  const c = e.rules.commodities[GOODS[g]];
  return (c.floor + c.ceiling) / 2;
}

/** Where a good sits in its price band at a port: 0 = floor, 1 = ceiling. */
export function bandPosition(e: Engine, port: number, g: number) {
  const c = e.rules.commodities[GOODS[g]];
  return (e.price(port, g) - c.floor) / Math.max(1e-9, c.ceiling - c.floor);
}

/** Move port stock without letting it go negative. */
export function shiftStock(e: Engine, port: number, g: number, delta: number) {
  e.stock[port][g] = Math.max(0, e.stock[port][g] + delta);
}

/** Connected ports (have at least one route). */
export function connectedPorts(e: Engine): number[] {
  return e.map.ports.map(p => p.id).filter(id => e.dist[id].some((d, j) => j !== id && Number.isFinite(d)));
}

/** A short per-company notice list (newest last, capped). */
export class Notes {
  private readonly byCompany = new Map<number, string[]>();
  constructor(private readonly keep = 6) {}
  add(company: number, text: string) {
    const list = this.byCompany.get(company) ?? [];
    list.push(text);
    this.byCompany.set(company, list.slice(-this.keep));
  }
  of(company: number) { return this.byCompany.get(company) ?? []; }
}

/** Net worth ranking, richest first (ids). */
export function ranking(e: Engine): number[] {
  return [...e.companies.values()].map(c => ({ id: c.id, w: e.netWorth(c) })).sort((a, b) => b.w - a.w || a.id - b.id).map(x => x.id);
}

/** Sell all of a docked ship's engine cargo outside the market (black market, contracts): proceeds go to the trip. */
export function sellEngineCargoFor(e: Engine, s: Ship, value: number) {
  const c = e.companies.get(s.owner);
  if (c) c.cash += value;
  s.qty = 0; s.good = null; s.cost = 0;
  e.maritime.cargoMoved(s, Infinity);
  e.maritime.dockedCargoChanged(s);
  e.recordSpecialSale(s, value);
}

export const taxRate = (e: Engine) => e.rules.fees.trade_tax_rate;
export const isPort = (e: Engine, p: unknown): p is number => whole(p, 0, e.n - 1);

/** Factories run while the Engine is still being constructed (before map, stock and targets exist), so anything
 *  derived from the map is built on first use. The result depends only on the map, so it replays the same. */
export function lazy<T>(make: () => T): () => T {
  let value: T | undefined, made = false;
  return () => { if (!made) { value = make(); made = true; } return value as T; };
}
