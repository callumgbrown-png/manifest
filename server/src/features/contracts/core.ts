// Shared helpers and cross-module state for the contracts category (contracts, pirates and police, NPCs).
// State shared between modules lives in one object per engine (a WeakMap), so a fresh engine (a replay) starts empty.
// It changes only inside module enable/apply/advance calls. Randomness: roll() hashes, never Math.random or the clock.
import { readFileSync } from "node:fs";
import { GOODS, type Engine, type Result, type Ship } from "../../engine.js";
import type { FeatureField } from "../../expansion-cards.js";
import type { Pt } from "../../geo.js";
import { roll } from "../../piracy.js";

export { roll };
export type { Pt };
export const fail = (error: string): Result => ({ ok: false, error });
export const ok: Result = { ok: true };
export const GOOD_NAMES = GOODS as readonly string[];

/** An integer in [min, max] (rejects strings, floats, NaN). */
export function whole(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}
export const day = (e: Engine) => Math.floor(e.tick / 24);
export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `port ${p}`;
export const money = (n: number) => Math.round(n).toLocaleString("en-IE");

/** Reads config/content/contracts/<name>.json; falls back to built-in data if the file is missing or broken. */
export function content<T>(name: string, fallback: T): T {
  try { return JSON.parse(readFileSync(new URL(`../../../../config/content/contracts/${name}.json`, import.meta.url), "utf8")) as T; }
  catch { return fallback; }
}

/** One of the company's ships, docked, not run by a voyage queue. */
export function dockedShip(e: Engine, company: number, id: unknown): Ship | string {
  const s = whole(id, 1, Number.MAX_SAFE_INTEGER) ? e.ships.get(id) : undefined;
  if (!s || s.owner !== company) return "choose one of your ships";
  if (s.dest !== null) return "that ship is at sea";
  if (e.voyageQueues.has(s.id)) return "that ship is run by a voyage queue";
  return s;
}
export function ownShip(e: Engine, company: number, id: unknown): Ship | string {
  const s = whole(id, 1, Number.MAX_SAFE_INTEGER) ? e.ships.get(id) : undefined;
  return s && s.owner === company ? s : "choose one of your ships";
}

/** Take cargo off a ship (delivered to a client, lost or seized). Returns the cargo's cost basis removed. */
export function unload(e: Engine, s: Ship, qty: number, paid = 0): number {
  const q = Math.min(qty, s.qty);
  if (q <= 0) return 0;
  const basis = s.qty > 0 ? s.cost * q / s.qty : 0;
  s.qty -= q; s.cost = Math.max(0, s.cost - basis);
  if (s.qty <= 0) { s.qty = 0; s.cost = 0; s.good = null; }
  e.maritime.cargoMoved(s, q);
  e.maritime.dockedCargoChanged(s);
  e.recordSpecialSale(s, paid);
  return basis;
}

/** Hours a freighter needs between two ports (contract deadlines are quoted for a freighter). */
export const freighterHours = (e: Engine, a: number, b: number) => e.voyageHours(a, b, "freighter");
export const reachable = (e: Engine, a: number, b: number) => a !== b && Number.isFinite(e.dist[a][b]);
export const position = (e: Engine, s: Ship): Pt => e.piracy.position(s);
export const dist = (e: Engine, a: Pt, b: Pt) => e.piracy.geo.dist(a, b);

/** A point a fraction f along the sea lanes from port a to port b. */
export function lanePoint(e: Engine, a: number, b: number, f: number): Pt {
  return e.piracy.geo.at(e.piracy.geo.voyage(a, b), f);
}
/** A deterministic route (pair of connected ports) chosen by hash. */
export function pickRoute(e: Engine, ...salt: number[]): { a: number; b: number } {
  const r = e.map.routes[Math.floor(roll(...salt) * e.map.routes.length)];
  return { a: r.a, b: r.b };
}

/** Ports that produce / consume a good. */
export const producers = (e: Engine, g: number) => e.map.ports.filter(p => p.produces.includes(GOODS[g])).map(p => p.id);
export const consumers = (e: Engine, g: number) => e.map.ports.filter(p => p.consumes.includes(GOODS[g])).map(p => p.id);

/** Remote ports (fewest lanes, then lowest id): hideouts, island tribes. */
export function remotePorts(e: Engine, count: number, skip = 0): number[] {
  const degree = e.map.ports.map(() => 0);
  for (const r of e.map.routes) { degree[r.a]++; degree[r.b]++; }
  return e.map.ports.map(p => p.id).sort((a, b) => degree[a] - degree[b] || roll(0x4849, a) - roll(0x4849, b)).slice(skip, skip + count);
}

export function shipOptions(ships: Ship[]): FeatureField["options"] {
  return ships.map(s => ({ value: s.id, label: `Ship ${s.id} (${s.type}${s.qty > 0 && s.good !== null ? `, ${Math.round(s.qty)} ${GOOD_NAMES[s.good]}` : ", empty"})` }));
}
export function companyShips(e: Engine, company: number): Ship[] {
  return (e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)).filter((s): s is Ship => !!s);
}

// ------------------------------------------------------------ shared state

export const FACTIONS = ["guild", "syndicate", "navy", "tribes"] as const;
export type Faction = (typeof FACTIONS)[number];
export interface NewsItem { id: number; tick: number; kind: string; text: string; port?: number }

export interface Shared {
  /** Contract reputation: +1 per contract finished on time, -1 per failed or abandoned one. */
  rep: Map<number, number>;
  /** Wanted heat from offences seen by these modules (smuggling, inspections, fake distress); decays hourly. */
  heat: Map<number, number>;
  /** Companies flying the black flag (opt-in pirate role) and the tick they last changed it. */
  pirates: Set<number>;
  flagChanged: Map<number, number>;
  /** Faction standing per company, -100 to 100, in FACTIONS order. */
  standing: Map<number, number[]>;
  /** Sea news for the ledger, newest last. */
  news: NewsItem[];
  newsSeq: number;
  /** Ship -> smuggled package aboard (contract id). */
  contraband: Map<number, { contract: number; owner: number }>;
  /** Ship -> deck gun level (1 to 3). */
  guns: Map<number, number>;
  /** Ship -> hired escort for the voyage that departed at departTick. */
  escorts: Map<number, { departTick: number; owner: number }>;
  /** Ship -> convoy membership for the voyage that departed at departTick. */
  convoys: Map<number, { convoy: number; departTick: number; dest: number }>;
  /** Ship -> tick until which pirates know where it is (fake distress trap). */
  exposed: Map<number, number>;
  /** Company -> tick until which inspectors look the other way (bribe). */
  waived: Map<number, number>;
  /** Titles earned (legends, old captain, stranger), per company. */
  titles: Map<number, string[]>;
}

const SHARED = new WeakMap<Engine, Shared>();
export function shared(e: Engine): Shared {
  let s = SHARED.get(e);
  if (!s) {
    s = { rep: new Map(), heat: new Map(), pirates: new Set(), flagChanged: new Map(), standing: new Map(), news: [], newsSeq: 0,
      contraband: new Map(), guns: new Map(), escorts: new Map(), convoys: new Map(), exposed: new Map(), waived: new Map(), titles: new Map() };
    SHARED.set(e, s);
  }
  return s;
}

export const repOf = (e: Engine, c: number) => shared(e).rep.get(c) ?? 0;
export function addRep(e: Engine, c: number, by: number) { const s = shared(e); s.rep.set(c, Math.max(-20, Math.min(100, repOf(e, c) + by))); }
export const heatOf = (e: Engine, c: number) => shared(e).heat.get(c) ?? 0;
export function addHeat(e: Engine, c: number, by: number) {
  const s = shared(e), v = Math.max(0, Math.min(100, heatOf(e, c) + by));
  if (v > 0) s.heat.set(c, v); else s.heat.delete(c);
}
/** Wanted stars 0 to 5 from police notoriety plus module heat. */
export function stars(e: Engine, c: number): number {
  return Math.min(5, Math.floor((e.piracy.notorietyOf(c) + heatOf(e, c)) / 20));
}
export function standingOf(e: Engine, c: number): number[] { return shared(e).standing.get(c) ?? FACTIONS.map(() => 0); }
/** Faction standing changes only while the factions module is on. */
export function addStanding(e: Engine, c: number, f: Faction, by: number) {
  if (!e.features.enabled("contracts.factions") || !e.companies.has(c)) return;
  const row = [...standingOf(e, c)], i = FACTIONS.indexOf(f);
  row[i] = Math.max(-100, Math.min(100, row[i] + by));
  shared(e).standing.set(c, row);
}
export function standingTier(v: number): string {
  return v >= 60 ? "Honoured" : v >= 20 ? "Friendly" : v > -20 ? "Neutral" : v > -60 ? "Wary" : "Hostile";
}
export function title(e: Engine, c: number, t: string): boolean {
  const s = shared(e), list = s.titles.get(c) ?? [];
  if (list.includes(t)) return false;
  s.titles.set(c, [...list, t].slice(-12));
  return true;
}

const NEWS_KEPT = 40;
export function news(e: Engine, kind: string, text: string, port?: number) {
  const s = shared(e);
  s.news.push({ id: ++s.newsSeq, tick: e.tick, kind, text: text.slice(0, 200), ...(port !== undefined ? { port } : {}) });
  if (s.news.length > NEWS_KEPT) s.news.splice(0, s.news.length - NEWS_KEPT);
}

/** Per-company short notice list kept by a module (newest last). */
export class Notices {
  private readonly m = new Map<number, { tick: number; text: string }[]>();
  constructor(private readonly keep = 6) {}
  add(e: Engine, company: number, text: string) {
    const list = this.m.get(company) ?? [];
    list.push({ tick: e.tick, text: text.slice(0, 200) });
    this.m.set(company, list.slice(-this.keep));
  }
  of(company: number) { return this.m.get(company) ?? []; }
}

// ------------------------------------------------------------ deterministic world places

/** Pirate zones for a given day: three circles centred on hashed lane points; they move every day. */
export function pirateZones(e: Engine, d = day(e)): { id: number; x: number; y: number; r: number }[] {
  if (!e.map.routes.length) return [];
  return [0, 1, 2].map(z => {
    const { a, b } = pickRoute(e, 0x5a4f4e45, d, z);
    const p = lanePoint(e, a, b, 0.3 + 0.4 * roll(0x5a4f, d, z));
    return { id: z, x: Math.round(p.x), y: Math.round(p.y), r: 70 * (e.map.worldScale ?? 1) };
  });
}
export function inZone(e: Engine, p: Pt): number {
  for (const z of pirateZones(e)) if (Math.hypot(z.x - p.x, z.y - p.y) <= z.r) return z.id;
  return -1;
}
export const hideouts = (e: Engine) => remotePorts(e, 3);
export const tribePorts = (e: Engine) => remotePorts(e, 3, 3);

/** The pirate boss event: appears every fifth day for two days, sailing a hashed voyage. */
export function bossNow(e: Engine, tick = e.tick): { event: number; x: number; y: number; until: number; from: number; to: number } | null {
  const d = Math.floor(tick / 24), event = Math.floor(d / 5);
  if (d % 5 < 2 || d % 5 > 3 || e.n < 2) return null;
  const { a, b } = pickRoute(e, 0x424f5353, event);
  const start = (event * 5 + 2) * 24, f = (tick - start) / 48;
  const p = lanePoint(e, a, b, f);
  return { event, x: p.x, y: p.y, until: start + 48, from: a, to: b };
}
/** The naval blockade: every seventh day, one port, for 36 hours. */
export function blockadeNow(e: Engine, tick = e.tick): { port: number; until: number } | null {
  const week = Math.floor(tick / 168), start = week * 168 + 72;
  if (tick < start || tick >= start + 36 || e.n < 2) return null;
  return { port: Math.floor(roll(0x424c4b44, week) * e.n), until: start + 36 };
}
