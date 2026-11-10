import type { Engine, Result } from "../engine.js";
import type { FeatureCard } from "../expansion-cards.js";

/** A player action for a feature module. Sent by the client as { type: "feature", module, action, ...fields }. */
export type FeatureCommand = { type: "feature"; company: number; module: string; action: string; [key: string]: unknown };

/** Values the engine lets enabled modules adjust. Each adjuster gets the current value and returns the new one. */
export interface HookContexts {
  fuel: { ship: number; from: number; dest: number };
  travelHours: { ship: number; from: number; dest: number };
  portFee: { ship: number; company: number; from: number; dest: number };
  tradeTax: { port: number; good: number; side: "buy" | "sell" };
  capacity: { ship: number };
  upkeep: { company: number };
}
export type HookName = keyof HookContexts;

/**
 * One feature from IDEAS_600.md (or a small group of closely related ones).
 * Modules must be deterministic: no Date.now(), no Math.random() (use engine-seeded helpers in registry),
 * and all state must change only inside apply() or advance(), so a restart replays the event log exactly.
 */
export interface FeatureModule {
  /** Unique id, "<category>.<name>", e.g. "economy.warehouses". */
  id: string;
  /** IDEAS_600.md numbers this module implements. */
  ideas: number[];
  title: string;
  /** True if it changes prices, money, fuel, tax, fees or travel time. Economy modules ship switched off. */
  economy: boolean;
  /** Called once when the module is switched on (also during replay). */
  enable?(): void;
  apply?(cmd: FeatureCommand): Result;
  /** Called every game hour while enabled. */
  advance?(): void;
  /** Cards for the Features panel (same shape as expansion opportunity cards). */
  cards?(company: number): FeatureCard[];
  /** Extra per-company data sent to that company's client under me.featureData[id]. */
  view?(company: number): unknown;
  /** Public data sent to every client under world.featureData[id]. Keep it small. */
  world?(): unknown;
  adjust?: { [K in HookName]?: (value: number, ctx: HookContexts[K]) => number };
}

export type FeatureFactory = (engine: Engine) => FeatureModule;
