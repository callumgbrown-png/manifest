// Helpers shared by the art category's server modules: content files, text fill-in, hashing and a ship watcher.
import { readFileSync } from "node:fs";
import { GOODS, type Engine } from "../../engine.js";

const cache = new Map<string, unknown>();
/** Reads config/content/art/<name>.json once (original writing for lore, voices, news, quests, eggs). */
export function content<T>(name: string): T {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../../../../config/content/art/${name}.json`, import.meta.url), "utf8")));
  return cache.get(name) as T;
}

/** Replaces {key} with vars[key]; unknown keys are left as they are. */
export const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** A small deterministic integer hash (no randomness: the same inputs give the same output everywhere). */
export function hash(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) { h = Math.imul(h ^ (v | 0), 16777619); h ^= h >>> 13; }
  return h >>> 0;
}
export const pick = <T>(list: T[], h: number): T => list[h % list.length];

export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `port ${p}`;
export const goodName = (g: number | null) => (g === null || g < 0 ? "" : GOODS[g] ?? "");
export const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
export const day = (tick: number) => Math.floor(tick / 24) + 1;

export const BIOMES = ["tropic", "temperate", "boreal", "arid", "volcanic"] as const;
/** Island biome for a port: north boreal, south tropic, with arid and volcanic islands mixed in by hash. */
export function biomeOf(e: Engine, p: number): number {
  const ys = e.map.ports.map(q => q.y), lo = Math.min(...ys), hi = Math.max(...ys);
  const t = hi > lo ? (e.map.ports[p].y - lo) / (hi - lo) : 0.5, h = hash(p, 77) % 100;
  if (h < 12) return 4;                     // volcanic
  if (t < 0.3) return h < 30 ? 1 : 2;       // north: pine coast, some green hills
  if (t > 0.7) return h < 35 ? 3 : 0;       // south: palm reef, some red cliffs
  return h < 20 ? 3 : 1;                    // middle: green hills, some red cliffs
}

export interface ShipEvent { ship: number; owner: number; port: number; other: number; good: number | null; qty: number }
/**
 * Watches ships hour by hour. Arrivals happen only inside Engine.advance, before feature modules advance, so every
 * docking is seen in the hour it happens. Call reset() in enable() and step() in advance().
 */
export function shipWatcher(e: Engine) {
  const last = new Map<number, { dest: number | null; port: number; owner: number }>();
  const reset = () => { last.clear(); for (const s of e.ships.values()) last.set(s.id, { dest: s.dest, port: s.port, owner: s.owner }); };
  function step() {
    const arrivals: ShipEvent[] = [], departures: ShipEvent[] = [], captured: ShipEvent[] = [], gone: ShipEvent[] = [];
    for (const s of e.ships.values()) {
      const was = last.get(s.id);
      if (was && was.dest !== null && s.dest === null) arrivals.push({ ship: s.id, owner: s.owner, port: s.port, other: was.port, good: s.good, qty: Math.round(s.qty) });
      // A ship bought since the last look that is already under way left port this hour or the last.
      if ((was ? was.dest === null : s.departTick >= e.tick - 1) && s.dest !== null) departures.push({ ship: s.id, owner: s.owner, port: s.port, other: s.dest, good: s.good, qty: Math.round(s.qty) });
      if (was && was.owner !== s.owner) captured.push({ ship: s.id, owner: s.owner, port: s.port, other: was.owner, good: s.good, qty: Math.round(s.qty) });
    }
    for (const [id, was] of last) if (!e.ships.has(id)) gone.push({ ship: id, owner: was.owner, port: was.port, other: was.port, good: null, qty: 0 });
    reset();
    return { arrivals, departures, captured, gone };
  }
  return { reset, step };
}
