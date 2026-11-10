// Small helpers shared by the community modules.
import type { Engine, Result } from "../../engine.js";
import type { FeatureAction } from "../../expansion-cards.js";

export const OK: Result = { ok: true };
export const fail = (error: string): Result => ({ ok: false, error });
export const action = (module: string, label: string, act: string, extra: Record<string, unknown> = {}): FeatureAction =>
  ({ label, command: { type: "feature", module, action: act, ...extra } });

/** Season day, 1-based (one tick is one game hour). */
export const day = (e: Engine) => Math.floor(e.tick / 24) + 1;
export const companyName = (e: Engine, id: number) => e.companies.get(id)?.name ?? `Company ${id}`;
export const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Deliveries (voyages with cargo) that docked after `since` and by now. */
export function deliveriesSince(e: Engine, company: number, since: number) {
  return (e.trips.get(company) ?? []).filter(t => t.good !== null && t.qty > 0 && t.arriveTick > since && t.arriveTick <= e.tick);
}
