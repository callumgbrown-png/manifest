import type { Engine, Result } from "../engine.js";
import type { FeatureCard } from "../expansion-cards.js";
import type { FeatureCommand, FeatureFactory, FeatureModule, HookContexts, HookName } from "./types.js";
import { FEATURE_FACTORIES } from "./index.js";

const fail = (error: string): Result => ({ ok: false, error });

/** Holds every feature module; only switched-on modules run. The switched-on set is engine state, changed by
 *  the replayed "setFeatures" command, so turning a feature on or off is recorded in the event log. */
export class FeatureRegistry {
  readonly modules = new Map<string, FeatureModule>();
  private readonly on = new Set<string>();
  private seed = 0x9e3779b9;

  constructor(private readonly e: Engine, factories: FeatureFactory[] = FEATURE_FACTORIES) {
    for (const make of factories) {
      const m = make(e);
      if (this.modules.has(m.id)) throw new Error(`duplicate feature module ${m.id}`);
      this.modules.set(m.id, m);
    }
  }

  enabled(id: string): boolean { return this.on.has(id); }
  list(): string[] { return [...this.on].sort(); }
  active(): FeatureModule[] { return [...this.modules.values()].filter(m => this.on.has(m.id)); }

  /** Deterministic pseudo-random number in [0, 1) for modules (replays identically). */
  random(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setEnabled(ids: string[]): Result {
    const unknown = ids.filter(id => !this.modules.has(id));
    if (unknown.length) return fail(`unknown feature ${unknown[0]}`);
    const next = new Set(ids);
    for (const id of next) if (!this.on.has(id)) { this.on.add(id); this.modules.get(id)!.enable?.(); }
    for (const id of [...this.on]) if (!next.has(id)) this.on.delete(id);
    return { ok: true };
  }

  apply(cmd: FeatureCommand): Result {
    const m = this.modules.get(cmd.module);
    if (!m || !this.on.has(m.id) || !m.apply) return fail("that feature is not available");
    return m.apply(cmd);
  }

  advance(): void { for (const m of this.active()) m.advance?.(); }

  adjust<K extends HookName>(hook: K, value: number, ctx: HookContexts[K]): number {
    for (const m of this.active()) {
      const f = m.adjust?.[hook] as ((v: number, c: HookContexts[K]) => number) | undefined;
      if (f) {
        const next = f(value, ctx);
        if (Number.isFinite(next)) value = next;
      }
    }
    return value;
  }

  cards(company: number): Record<string, { title: string; cards: FeatureCard[] }> {
    const out: Record<string, { title: string; cards: FeatureCard[] }> = {};
    for (const m of this.active()) {
      const cards = m.cards?.(company) ?? [];
      if (cards.length) out[m.id] = { title: m.title, cards };
    }
    return out;
  }

  view(company: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const m of this.active()) { const v = m.view?.(company); if (v !== undefined) out[m.id] = v; }
    return out;
  }

  world(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const m of this.active()) { const v = m.world?.(); if (v !== undefined) out[m.id] = v; }
    return out;
  }
}
