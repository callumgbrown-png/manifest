// Shared helpers and per-world state for the ships feature modules.
// Every module owns its own state; this store only holds facts several modules read (ship log, condition, crew),
// keyed by engine so each world (and each replay) starts clean. Each module writes only its own part, inside its
// own apply/advance, so replays stay exact.
import type { Engine, Result, Ship, ShipType } from "../../engine.js";
import type { FeatureAction } from "../../expansion-cards.js";

export const fail = (error: string): Result => ({ ok: false, error });
export const OK: Result = { ok: true };

export interface LogEntry { tick: number; text: string }
export type Trait = "fuel-saver" | "lucky" | "brave";
export interface Crew { size: number; morale: number; captain?: { name: string; trait: Trait }; lowSince?: number }

export interface ShipsShared {
  /** Per-ship journal, newest last (ships.logbook shows it; any module may add lines). */
  log: Map<number, LogEntry[]>;
  /** Hull condition 0..100, owned by ships.wear (others may damage it only while wear is on). */
  condition: Map<number, number>;
  /** Crew per ship, owned by ships.crew. */
  crew: Map<number, Crew>;
  /** Losses for ships.insurance to settle: cargo lost at sea, by owner. */
  losses: { ship: number; owner: number; amount: number; kind: string }[];
}

const store = new WeakMap<Engine, ShipsShared>();
export function shared(e: Engine): ShipsShared {
  let s = store.get(e);
  if (!s) store.set(e, s = { log: new Map(), condition: new Map(), crew: new Map(), losses: [] });
  return s;
}

const LOG_KEPT = 20;
/** Add a line to a ship's logbook. */
export function note(e: Engine, ship: number, text: string) {
  const log = shared(e).log;
  const list = log.get(ship) ?? [];
  list.push({ tick: e.tick, text });
  log.set(ship, list.slice(-LOG_KEPT));
  if (log.size > e.ships.size + 64) prune(e, log);
}

/** A ship the company owns, or undefined (the id field is untrusted). */
export function ownShip(e: Engine, company: number, id: unknown): Ship | undefined {
  if (typeof id !== "number" || !Number.isInteger(id)) return undefined;
  const s = e.ships.get(id);
  return s && s.owner === company ? s : undefined;
}

/** An integer in [min, max], or undefined. */
export function int(x: unknown, min: number, max: number): number | undefined {
  return typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : undefined;
}

export const docked = (s: Ship) => s.dest === null;
export const busy = (e: Engine, s: Ship) => e.voyageQueues.has(s.id);
/** 0 small, 1 medium, 2 large hull. */
export const hullSize = (t: ShipType) => (t === "bulker" ? 2 : t === "freighter" ? 1 : 0);

/** Display name: the player's name for the ship if ships.identity is on, else "Ship <id>". */
export function shipName(e: Engine, id: number): string {
  const m = e.features.enabled("ships.identity") ? e.features.modules.get("ships.identity") as unknown as { nameOf?(id: number): string | undefined } : undefined;
  return m?.nameOf?.(id) ?? `Ship ${id}`;
}

/** Another ships module, only if it is switched on. */
export function peer<T>(e: Engine, id: string): T | undefined {
  return e.features.enabled(id) ? e.features.modules.get(id) as unknown as T : undefined;
}

export const credits = (n: number) => `${Math.ceil(n).toLocaleString("en-GB")} credits`;
export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `port ${p}`;
export function action(module: string, label: string, act: string, fields: Record<string, unknown> = {}): FeatureAction {
  return { label, command: { type: "feature", module, action: act, ...fields } };
}
/** Card field: pick one of the company's ships. */
export function shipField(e: Engine, ships: Ship[]) {
  return { key: "ship", label: "Ship", options: ships.map(s => ({ value: s.id, label: `${shipName(e, s.id)} (${s.type})` })) };
}

/** Sees departures, arrivals, removals and owner changes between hourly advances. */
export interface Seen { port: number; dest: number | null; departTick: number; arriveTick: number; owner: number; type: ShipType }
export class VoyageWatch {
  private seen = new Map<number, Seen>();
  step(e: Engine, on: {
    depart?(s: Ship, from: number): void;
    arrive?(s: Ship, from: number): void;
    gone?(id: number, last: Seen): void;
    owner?(s: Ship, before: number): void;
  }) {
    for (const s of e.ships.values()) {
      const p = this.seen.get(s.id);
      if (p) {
        if (p.owner !== s.owner) on.owner?.(s, p.owner);
        if (p.dest !== null && (s.dest === null || s.departTick !== p.departTick)) on.arrive?.(s, p.port);
        if (s.dest !== null && (p.dest === null || s.departTick !== p.departTick)) on.depart?.(s, s.port);
      }
      this.seen.set(s.id, { port: s.port, dest: s.dest, departTick: s.departTick, arriveTick: s.arriveTick, owner: s.owner, type: s.type });
    }
    for (const [id, last] of this.seen) if (!e.ships.has(id)) { this.seen.delete(id); on.gone?.(id, last); }
  }
}

/** Drop entries for ships that no longer exist. */
export function prune<V>(e: Engine, map: Map<number, V>) { for (const id of map.keys()) if (!e.ships.has(id)) map.delete(id); }
