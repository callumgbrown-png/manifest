// Module goods: cargo types the engine's fixed GOODS list doesn't have (timber, wine, mail, flour...).
// They live in feature state, not in Ship.good: each ship has a small "special hold" of lots, shared by every
// economy module, and each module charges the hold space of the goods it owns through the capacity hook.
// Each module keeps its own side market (stock per port) for the goods it owns.
import type { Engine, Ship } from "../../engine.js";

export interface Lot {
  qty: number;
  /** What the owner paid for the lot (cost basis). */
  cost: number;
  /** Tick it was loaded. */
  tick: number;
  /** Mystery crates: value per unit, hidden until sold. */
  value?: number;
  /** Mail: where it must go, by when, and what it pays. */
  dest?: number; due?: number; pay?: number;
}

const holdsByEngine = new WeakMap<Engine, Map<number, Map<string, Lot>>>();

/** Every ship's special hold (ship id -> good key -> lot). */
export function holds(e: Engine) {
  let h = holdsByEngine.get(e);
  if (!h) { h = new Map(); holdsByEngine.set(e, h); }
  return h;
}

export function lotOf(e: Engine, ship: number, good: string): Lot | undefined { return holds(e).get(ship)?.get(good); }

export function addLot(e: Engine, ship: number, good: string, qty: number, cost: number, extra: Partial<Lot> = {}) {
  const h = holds(e);
  let hold = h.get(ship);
  if (!hold) { hold = new Map(); h.set(ship, hold); }
  const lot = hold.get(good);
  if (lot) { lot.qty += qty; lot.cost += cost; }
  else hold.set(good, { qty, cost, tick: e.tick, ...extra });
}

/** Remove qty from a lot; returns the cost basis removed (0 if there was no lot). */
export function takeLot(e: Engine, ship: number, good: string, qty: number): number {
  const hold = holds(e).get(ship);
  const lot = hold?.get(good);
  if (!hold || !lot) return 0;
  const n = Math.min(qty, lot.qty);
  const cost = lot.qty > 0 ? lot.cost * n / lot.qty : 0;
  lot.qty -= n;
  lot.cost -= cost;
  if (lot.qty <= 1e-9) hold.delete(good);
  if (!hold.size) holds(e).delete(ship);
  return cost;
}

/** Drop lots on ships that no longer exist (scrapped or sold). */
export function sweepHolds(e: Engine, goods: Iterable<string>) {
  for (const [ship, hold] of holds(e)) {
    if (e.ships.has(ship)) continue;
    for (const g of goods) hold.delete(g);
    if (!hold.size) holds(e).delete(ship);
  }
}

/** Hold space used on one ship by the given goods. */
export function spaceUsed(e: Engine, ship: number, space: Map<string, number>): number {
  const hold = holds(e).get(ship);
  if (!hold) return 0;
  let used = 0;
  for (const [good, lot] of hold) { const s = space.get(good); if (s !== undefined) used += lot.qty * s; }
  return used;
}

/** A plain-data snapshot of one ship's hold, for views. */
export function holdView(e: Engine, ship: Ship, goods: Set<string>) {
  const hold = holds(e).get(ship.id);
  if (!hold) return [];
  return [...hold].filter(([g]) => goods.has(g)).map(([good, lot]) => ({ ship: ship.id, good, qty: Math.round(lot.qty * 10) / 10,
    cost: Math.round(lot.cost), ...(lot.dest !== undefined ? { dest: lot.dest, due: lot.due, pay: lot.pay } : {}) }));
}

// ------------------------------------------------------------ side market

export interface SideGood {
  key: string;
  name: string;
  floor: number;
  ceiling: number;
  /** Hold space per unit (cars take 3). */
  space?: number;
  /** Stock at which the price is mid-band. */
  target?: number;
  producers: number[];
  consumers: number[];
  prodPerHour?: number;
  consPerHour?: number;
}

/** A small market per module good, priced like the engine's: ceiling when empty, floor at twice the target. */
export class SideMarket {
  readonly stock = new Map<string, number[]>();
  readonly goods = new Map<string, SideGood>();

  constructor(private readonly e: Engine, goods: SideGood[]) {
    for (const g of goods) {
      this.goods.set(g.key, g);
      const t = g.target ?? 400;
      this.stock.set(g.key, e.map.ports.map(p => t * (g.producers.includes(p.id) ? 1.3 : g.consumers.includes(p.id) ? 0.6 : 1)));
    }
  }

  price(port: number, key: string, stock = this.stock.get(key)![port]): number {
    const g = this.goods.get(key)!, t = g.target ?? 400;
    const frac = Math.min(1, Math.max(0, 1 - stock / (2 * t)));
    return g.floor + (g.ceiling - g.floor) * frac;
  }

  buyCost(port: number, key: string, qty: number) {
    const s = this.stock.get(key)![port];
    return qty * this.price(port, key, s - qty / 2);
  }

  sellValue(port: number, key: string, qty: number) {
    const s = this.stock.get(key)![port];
    return qty * this.price(port, key, s + qty / 2);
  }

  add(port: number, key: string, qty: number) {
    const arr = this.stock.get(key)!;
    arr[port] = Math.max(0, arr[port] + qty);
  }

  /** Hourly: producers make, consumers use, every port drifts slowly back towards its target. */
  step() {
    for (const [key, arr] of this.stock) {
      const g = this.goods.get(key)!, t = g.target ?? 400;
      const prod = g.prodPerHour ?? t / 50, cons = g.consPerHour ?? t / 70;
      for (let p = 0; p < arr.length; p++) {
        let s = arr[p];
        if (g.producers.includes(p)) s += prod;
        if (g.consumers.includes(p)) s -= cons;
        s += (t - s) * 0.01;
        arr[p] = Math.max(0, Math.min(t * 3, s));
      }
    }
  }

  prices(key: string) { return this.stock.get(key)!.map((_, p) => Math.round(this.price(p, key) * 100) / 100); }
}
