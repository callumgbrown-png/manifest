import type { Engine, Result, Ship } from "../../engine.js";
import { GOODS } from "../../engine.js";
import type { FeatureCommand, FeatureFactory } from "../types.js";

export const fail = (error: string): Result => ({ ok: false, error });
export const OK: Result = { ok: true };

/** An integer in [lo, hi], or null. Client fields are never trusted. */
export function int(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}
/** A finite number in [lo, hi], or null. */
export function num(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}
export function isPort(e: Engine, v: unknown): v is number { return int(v, 0, e.map.ports.length - 1) !== null; }
/** A good by name ("grain") or index, as its index; null if unknown. */
export function goodIndex(v: unknown): number | null {
  if (typeof v === "string") { const g = GOODS.indexOf(v as never); return g >= 0 ? g : null; }
  return int(v, 0, GOODS.length - 1);
}

/** The company's own ship, or an error text. */
export function ownShip(e: Engine, company: number, ship: unknown): Ship | string {
  const id = int(ship, 1, Number.MAX_SAFE_INTEGER);
  const s = id === null ? undefined : e.ships.get(id);
  if (!s || s.owner !== company) return "not your ship";
  return s;
}

/** A module that only carries a switch for client-side features: the client checks ManifestHooks.enabled(id). */
export function clientSwitch(id: string, ideas: number[], title: string, economy = false): FeatureFactory {
  return () => ({ id, ideas, title, economy, world: () => 1 });
}

// ---------------------------------------------------------------- undo journal

/** One reversible step of a ui module (never a trade): the module's restore function puts `before` back. */
export interface UndoEntry { module: string; label: string; before: unknown; tick: number }
type Restore = (company: number, before: unknown) => Result;

/** Per-engine journal shared by the ui modules (state changes only inside apply, so it replays exactly). */
class UndoJournal {
  readonly restorers = new Map<string, Restore>();
  readonly stacks = new Map<number, UndoEntry[]>();
  register(module: string, restore: Restore) { this.restorers.set(module, restore); }
  push(company: number, entry: UndoEntry) {
    const list = this.stacks.get(company) ?? [];
    list.push(entry);
    if (list.length > UNDO_KEPT) list.shift();
    this.stacks.set(company, list);
  }
}
export const UNDO_KEPT = 10;
const journals = new WeakMap<Engine, UndoJournal>();
export function journal(e: Engine): UndoJournal {
  let j = journals.get(e);
  if (!j) { j = new UndoJournal(); journals.set(e, j); }
  return j;
}

/** Record a reversible step only when the undo module is switched on. */
export function remember(e: Engine, cmd: FeatureCommand, label: string, before: unknown) {
  if (e.features.enabled("ui.undo")) journal(e).push(cmd.company, { module: cmd.module, label, before: structuredClone(before), tick: e.tick });
}
