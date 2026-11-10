// Shared helpers and cross-module state for the ports feature modules.
// State is keyed by engine and only changed from module enable/apply/advance, so replays stay exact.
import { readFileSync } from "node:fs";
import { GOODS, type Engine, type Result, type Ship } from "../../engine.js";

export const content = JSON.parse(readFileSync(new URL("../../../../config/content/ports/ports.json", import.meta.url), "utf8")) as {
  hubs: Record<string, string>;
  reputationTiers: { min: number; name: string }[];
  festivals: string[];
  crew: { name: string; role: string; perk: string; text: string }[];
  banners: string[];
  research: { id: string; name: string; points: number; text: string }[];
  weather: string[];
};

export const fail = (error: string): Result => ({ ok: false, error });
export const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
export const inRange = (v: unknown, lo: number, hi: number): v is number => integer(v) && v >= lo && v <= hi;
export const GOOD = { grain: 0, fuel: 1, ore: 2, machinery: 3 } as const;

/** Deterministic hash of integers to [0, 1): same inputs, same answer, on every server and replay. */
export function hash(...nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) { h ^= n | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}

export interface Exhibit { tick: number; kind: string; company: number; text: string }
export interface Project { key: string; kind: "lighthouse" | "reclamation" | "rail" | "channel"; port: number; port2?: number;
  good: number; need: number; left: number; level: number; maxLevel: number; contributors: Map<number, number> }

interface PortsShared {
  rep: Map<number, Map<number, number>>;
  projects: Map<string, Project>;
  museum: Exhibit[];
  crew: Map<number, number>;                // ship -> crew index (ports.tavern)
  research: Map<number, Set<string>>;       // company -> unlocked topics
  records: Map<string, { company: number; score: number }>;
  /** Crane level per port (ports.cranes owns it; ports.docks and ports.harbour-effects read it). */
  cranes: Map<number, number>;
  /** Pilots booked for a ship's next arrival (ports.cranes owns it). */
  pilots: Set<number>;
}
const store = new WeakMap<Engine, PortsShared>();
export function shared(e: Engine): PortsShared {
  let s = store.get(e);
  if (!s) store.set(e, s = { rep: new Map(), projects: new Map(), museum: [], crew: new Map(), research: new Map(), records: new Map(), cranes: new Map(), pilots: new Set() });
  return s;
}

export function addRep(e: Engine, company: number, port: number, n: number) {
  if (!e.companies.has(company) || !(n > 0)) return;
  const m = shared(e).rep.get(company) ?? new Map<number, number>();
  m.set(port, (m.get(port) ?? 0) + n);
  shared(e).rep.set(company, m);
}
export const repOf = (e: Engine, company: number, port: number) => shared(e).rep.get(company)?.get(port) ?? 0;
export function tierOf(points: number) {
  let name = content.reputationTiers[0].name;
  for (const t of content.reputationTiers) if (points >= t.min) name = t.name;
  return name;
}
/** Reputation only gates anything while the reputation module is on. */
export const repAtLeast = (e: Engine, company: number, port: number, min: number) =>
  !e.features.enabled("ports.reputation") || repOf(e, company, port) >= min;

export function exhibit(e: Engine, kind: string, company: number, text: string) {
  const m = shared(e).museum;
  m.push({ tick: e.tick, kind, company, text: text.slice(0, 120) });
  if (m.length > 60) m.shift();
}
export const hasResearch = (e: Engine, company: number, id: string) =>
  e.features.enabled("ports.research") && !!shared(e).research.get(company)?.has(id);
export const crewPerk = (e: Engine, ship: number) => {
  if (!e.features.enabled("ports.tavern")) return undefined;
  const i = shared(e).crew.get(ship);
  return i === undefined ? undefined : content.crew[i]?.perk;
};

export const connected = (e: Engine) => e.map.ports.filter(p => e.dist[p.id].some((d, o) => o !== p.id && Number.isFinite(d))).map(p => p.id);
/** A deterministic set of ports for a building: about `share` of connected ports, at least `min`. */
export function sites(e: Engine, salt: number, share: number, min = 1): number[] {
  const all = connected(e);
  const ranked = [...all].sort((a, b) => hash(salt, a) - hash(salt, b));
  const picked = ranked.filter(p => hash(salt, p) < share);
  return (picked.length >= min ? picked : ranked.slice(0, min)).sort((a, b) => a - b);
}

/** Ships that docked during this tick's arrivals (call from advance). */
export const arrivals = (e: Engine) => [...e.ships.values()].filter(s => s.dest === null && s.arriveTick === e.tick && s.departTick < s.arriveTick);
export const dockedAt = (e: Engine, port: number) => [...e.ships.values()].filter(s => s.dest === null && s.port === port).length;
export const day = (e: Engine) => Math.floor(e.tick / 24);
export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `Port ${p}`;
export const isPort = (e: Engine, p: unknown): p is number => inRange(p, 0, e.n - 1);
export const clock = (tick: number) => `Day ${Math.floor(tick / 24) + 1}, ${String(tick % 24).padStart(2, "0")}:00`;

/** One of the company's own ships, docked (optionally at `port`) and free to work. */
export function workShip(e: Engine, company: number, raw: unknown, port?: number): Ship | undefined {
  if (!integer(raw)) return undefined;
  const s = e.ships.get(raw);
  if (!s || s.owner !== company || s.dest !== null || s.type === "pirate" || e.voyageQueues.has(s.id) || e.maritime.hasLoot(s)) return undefined;
  if (port !== undefined && s.port !== port) return undefined;
  if (e.piracy.lockoutHours(company) > 0) return undefined;
  return s;
}
export const ownDocked = (e: Engine, company: number, port: number) =>
  (e.companies.get(company)?.ships ?? []).map(id => workShip(e, company, id, port)).filter((s): s is Ship => !!s);
export const shipOptions = (ships: Ship[]) => ships.map(s => ({ value: s.id, label: `#${s.id} ${s.type}${s.qty ? ` · ${s.qty} ${GOODS[s.good!]}` : " · empty"}` }));

/** Removes cargo from a docked ship without selling it (donations, transfers). */
export function takeCargo(e: Engine, s: Ship, qty: number) {
  const fraction = qty / s.qty;
  s.qty -= qty;
  s.cost *= 1 - fraction;
  if (!s.qty) { s.good = null; s.cost = 0; }
  e.maritime.cargoMoved(s, qty);
  e.maritime.dockedCargoChanged(s);
  e.recordSpecialSale(s, 0);
}
/** Market stock change, kept inside the market's bounds. */
export function nudgeStock(e: Engine, port: number, good: number, by: number) {
  const max = e.targets[good] * e.rules.markets.max_stock_multiple;
  e.stock[port][good] = Math.max(0, Math.min(max, e.stock[port][good] + by));
}

/** Ports where the company has a ship docked and free to work. */
export const dockedPorts = (e: Engine, company: number) =>
  [...new Set((e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)).filter((s): s is Ship => !!s && s.dest === null).map(s => s.port))].sort((a, b) => a - b);
export const goodIndex = (v: unknown) => typeof v === "string" ? (GOODS as readonly string[]).indexOf(v) : integer(v) && v >= 0 && v < GOODS.length ? v : -1;
export const action = (module: string, label: string, act: string, extra: Record<string, unknown> = {}) =>
  ({ label, command: { type: "feature", module, action: act, ...extra } });
/** Another module, only while it is switched on (duck-typed so categories stay independent). */
export function peer<T>(e: Engine, id: string): T | undefined {
  return e.features.enabled(id) ? e.features.modules.get(id) as unknown as T : undefined;
}
/** Records a minigame score; keeps the best per game. Returns true for a new record. */
export function record(e: Engine, game: string, company: number, score: number): boolean {
  const r = shared(e).records.get(game);
  if (r && r.score >= score) return false;
  shared(e).records.set(game, { company, score });
  return true;
}
/** Puts cargo on a docked ship (empty, or already carrying the same good) without buying it. */
export function loadCargo(e: Engine, s: Ship, good: number, qty: number, cost: number) {
  s.good = good;
  s.qty += qty;
  s.cost += cost;
  e.recordCargoLoaded(s, cost);
}
