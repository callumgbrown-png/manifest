// Shared helpers and per-world state for the progression feature modules.
// Each module writes only its own part of this store, inside its own apply/advance, so replays stay exact.
// Views and cards only read.
import type { Engine, Result } from "../../engine.js";
import type { FeatureAction, FeatureField } from "../../expansion-cards.js";
import { tracker, type Tracker } from "./tracker.js";

export const fail = (error: string): Result => ({ ok: false, error });
export const OK: Result = { ok: true };

export interface Trophy { tick: number; text: string }
export interface ProgressionShared {
  /** Achievements earned (progression.achievements): company -> achievement id -> tick. */
  earned: Map<number, Map<string, number>>;
  /** Titles earned (progression.titles): company -> title ids; and the one each company shows. */
  titles: Map<number, Set<string>>;
  shownTitle: Map<number, string>;
  /** Run mode per company (progression.run-modes): "standard" | "sandbox" | "ironman" | "hardcore" | "tycoon". */
  modes: Map<number, string>;
  /** Trophies for the trophy room, written by whichever module awards them (tournaments, ladders, seasons...). */
  trophies: Map<number, Trophy[]>;
  /** Tech nodes researched (progression.tech-tree). */
  tech: Map<number, Set<string>>;
}

const store = new WeakMap<Engine, ProgressionShared>();
export function shared(e: Engine): ProgressionShared {
  let s = store.get(e);
  if (!s) store.set(e, s = { earned: new Map(), titles: new Map(), shownTitle: new Map(), modes: new Map(), trophies: new Map(), tech: new Map() });
  return s;
}

const TROPHIES_KEPT = 40;
export function addTrophy(e: Engine, company: number, text: string) {
  const s = shared(e), list = s.trophies.get(company) ?? [];
  list.push({ tick: e.tick, text });
  s.trophies.set(company, list.slice(-TROPHIES_KEPT));
}

/** A card action that sends { type: "feature", module, action, ...extra }. */
export function action(module: string, label: string, act: string, extra: Record<string, unknown> = {}, fields?: FeatureField[]): FeatureAction {
  return { label, command: { type: "feature", module, action: act, ...extra }, ...(fields ? { fields } : {}) };
}

/** Companies that count for rankings: players, not bots, and not sandbox or tycoon runs. */
export function players(e: Engine, t: Tracker = tracker(e)): number[] {
  const modes = shared(e).modes;
  return [...e.companies.keys()].filter(id => !t.isBot(id) && modes.get(id) !== "sandbox" && modes.get(id) !== "tycoon");
}

export const companyName = (e: Engine, id: number) => e.companies.get(id)?.name ?? `Company ${id}`;
export const portName = (e: Engine, id: number) => e.map.ports[id]?.name ?? `Port ${id}`;
export const hour = (e: Engine) => e.tick;
export const dayOf = (tick: number) => Math.floor(tick / 24);
export const weekOf = (tick: number) => Math.floor(tick / 168);

/** Owner of a ship, or undefined. */
export const ownerOf = (e: Engine, ship: number) => e.ships.get(ship)?.owner;

/** Multiplicative percentage, clamped so effects can never flip a sign. */
export const pct = (value: number, delta: number) => value * Math.max(0.5, Math.min(1.5, 1 + delta));
