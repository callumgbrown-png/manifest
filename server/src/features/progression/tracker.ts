import { GOODS, type Engine, type Trip } from "../../engine.js";
import { isBot } from "../../bots.js";
import type { Condition } from "./content.js";

/** Career numbers for one company this season, observed hourly from engine state (trip log, ships, net worth). */
export interface Stats {
  founded: number;
  voyages: number; deliveries: number; emptyRuns: number; losses: number; shortVoyages: number;
  profit: number; bestTrip: number; distance: number; cargo: number; hoursAtSea: number;
  peakShips: number; peakWorth: number;
  goodUnits: number[]; goodDeliveries: number[];
  ports: Set<number>; shipTypes: Set<string>;
  routes: Map<string, number>;
  usedQueue: boolean;
}

/** A trip that finished this hour, with its company. */
export interface Finished { company: number; trip: Trip; profit: number; distance: number }

const HOUR_KEYS = ["voyages", "deliveries", "emptyRuns", "losses", "shortVoyages", "profit", "bestTrip", "distance", "cargo",
  "hoursAtSea", "peakShips", "peakWorth"] as const;

/** Shared by every progression module on one engine. Updated at most once per game hour, from any module's advance(). */
export class Tracker {
  readonly stats = new Map<number, Stats>();
  /** Bonus experience from quests, achievements, puzzles... (captain levels add trip-based experience on top). */
  readonly bonusXp = new Map<number, number>();
  /** Cosmetics unlocked this season: "skin:gold", "title:voyager", "badge:x". */
  readonly cosmetics = new Map<number, Set<string>>();
  /** New Game+ stars: progression targets scale up with each. */
  readonly stars = new Map<number, number>();
  /** Hardcore companies whose run has ended: their progression stops. */
  readonly fallen = new Set<number>();
  /** Tutorial steps done, for New Game+ eligibility. */
  readonly tutorialDone = new Set<number>();
  finished: Finished[] = [];
  private readonly seen = new WeakSet<Trip>();
  private readonly closed = new WeakSet<Trip>();
  private lastTick = -1;

  constructor(private readonly e: Engine) {}

  of(company: number): Stats {
    let s = this.stats.get(company);
    if (!s) {
      s = { founded: this.e.tick, voyages: 0, deliveries: 0, emptyRuns: 0, losses: 0, shortVoyages: 0, profit: 0, bestTrip: 0,
        distance: 0, cargo: 0, hoursAtSea: 0, peakShips: 0, peakWorth: 0, goodUnits: GOODS.map(() => 0),
        goodDeliveries: GOODS.map(() => 0), ports: new Set(), shipTypes: new Set(), routes: new Map(), usedQueue: false };
      const c = this.e.companies.get(company);
      if (c) { s.ports.add(c.home); s.peakWorth = Math.round(this.e.netWorth(c)); s.peakShips = c.ships.length; }
      this.stats.set(company, s);
    }
    return s;
  }

  /** Call at the start of every progression module's advance(); runs once per tick. */
  update(): void {
    const e = this.e;
    if (this.lastTick === e.tick) return;
    this.lastTick = e.tick;
    this.finished = [];
    for (const c of e.companies.values()) {
      const s = this.of(c.id);
      if (this.fallen.has(c.id)) continue;
      for (const trip of e.trips.get(c.id) ?? []) {
        if (!this.seen.has(trip)) { this.seen.add(trip); s.voyages++; }
        if (trip.open || trip.listed || this.closed.has(trip)) continue;
        this.closed.add(trip);
        const distance = Number.isFinite(e.dist[trip.from]?.[trip.to]) ? e.dist[trip.from][trip.to] : 0;
        const profit = Math.round(trip.earned - trip.spent);
        s.distance += distance;
        if (distance < 120) s.shortVoyages++;
        if (trip.good === null || trip.qty <= 0) { s.emptyRuns++; continue; }
        s.deliveries++; s.cargo += trip.qty; s.profit += profit;
        s.goodUnits[trip.good] += trip.qty; s.goodDeliveries[trip.good]++;
        s.bestTrip = Math.max(s.bestTrip, profit);
        if (profit < 0) s.losses++;
        const route = `${trip.from}-${trip.to}`;
        s.routes.set(route, (s.routes.get(route) ?? 0) + 1);
        this.finished.push({ company: c.id, trip, profit, distance });
      }
      for (const id of c.ships) {
        const ship = e.ships.get(id);
        if (!ship) continue;
        s.shipTypes.add(ship.type);
        if (ship.dest === null) s.ports.add(ship.port); else s.hoursAtSea++;
        if (e.voyageQueues.get(id)?.company === c.id) s.usedQueue = true;
      }
      s.peakShips = Math.max(s.peakShips, c.ships.length);
      s.peakWorth = Math.max(s.peakWorth, Math.round(e.netWorth(c)));
    }
  }

  award(company: number, xp: number) {
    if (this.fallen.has(company) || !(xp > 0)) return;
    this.bonusXp.set(company, (this.bonusXp.get(company) ?? 0) + Math.round(xp));
  }

  unlock(company: number, cosmetic: string) {
    const set = this.cosmetics.get(company) ?? new Set<string>();
    set.add(cosmetic);
    this.cosmetics.set(company, set);
  }

  /** Experience: trip-based plus bonus. */
  xp(company: number): number {
    const s = this.stats.get(company);
    const base = s ? s.deliveries * 10 + Math.floor(s.distance / 50) + Math.floor(Math.max(0, s.profit) / 100) : 0;
    return base + (this.bonusXp.get(company) ?? 0);
  }

  level(company: number): number { return levelFor(this.xp(company)); }

  starsOf(company: number): number { return this.stars.get(company) ?? 0; }

  isBot(company: number): boolean { const c = this.e.companies.get(company); return !c || isBot(c.name); }

  /** A plain copy of the counters, for baselines. */
  snapshot(company: number): Record<string, number> {
    const s = this.of(company), out: Record<string, number> = {};
    for (const k of HOUR_KEYS) out[k] = s[k];
    out.portsVisited = s.ports.size;
    out.goodsDelivered = s.goodUnits.filter(n => n > 0).length;
    out.level = this.level(company);
    out.xp = this.xp(company);
    GOODS.forEach((g, i) => { out[`goodUnits.${g}`] = s.goodUnits[i]; out[`goodDeliveries.${g}`] = s.goodDeliveries[i]; });
    return out;
  }

  value(company: number, stat: string): number { return this.snapshot(company)[stat] ?? 0; }

  met(company: number, cond: Condition): boolean {
    const snap = this.snapshot(company);
    const value = snap[cond.stat] ?? 0;
    if (!cond.per) return value >= cond.atLeast;
    const per = snap[cond.per] ?? 0;
    return per >= (cond.min ?? 1) && per > 0 && value / per >= cond.atLeast;
  }

  /** 0..1 progress towards a plain condition. */
  progress(company: number, cond: Condition): number {
    if (cond.per) return this.met(company, cond) ? 1 : 0;
    return cond.atLeast <= 0 ? 1 : Math.min(1, this.value(company, cond.stat) / cond.atLeast);
  }

  /** Plain JSON for views and replay checks. */
  view(company: number) {
    const s = this.of(company);
    return { ...this.snapshot(company), ports: [...s.ports].sort((a, b) => a - b), shipTypes: [...s.shipTypes].sort(),
      goodUnits: s.goodUnits, goodDeliveries: s.goodDeliveries, founded: s.founded, usedQueue: s.usedQueue };
  }
}

/** Level L needs 50 * L * (L - 1) experience; capped at 50. */
export function levelFor(xp: number): number {
  let level = 1;
  while (level < 50 && xp >= 50 * (level + 1) * level) level++;
  return level;
}
export const xpForLevel = (level: number) => 50 * level * (level - 1);

const trackers = new WeakMap<Engine, Tracker>();
export function tracker(e: Engine): Tracker {
  let t = trackers.get(e);
  if (!t) { t = new Tracker(e); trackers.set(e, t); }
  return t;
}

/** Deterministic hash of integers to [0, 1) (no shared random state, so selection order never matters). */
export function hash(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) { h ^= p | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 13; }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export const int = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
export const str = (v: unknown, allowed: readonly string[]): string | undefined =>
  typeof v === "string" && allowed.includes(v) ? v : undefined;
export const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
export const DAY = 24, WEEK = 168;
