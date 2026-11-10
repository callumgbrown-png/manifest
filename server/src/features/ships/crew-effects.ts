// Ideas 36, 37 and 38 (economy side): what crews do to the ledger. A short-handed or unhappy crew sails slower,
// a full happy crew a little faster, a fuel-saver captain burns less fuel, and every hand draws a daily wage.
// Reads the crew records kept by ships.crew; without that module nothing changes.
import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { CREW_RANGE } from "./crew.js";
import { shared } from "./shared.js";

export const WAGE_PER_HAND = 6;

/** Travel-time multiplier from crew size and morale: 0.92 (full, happy) to 1.25 (minimum crew, miserable). */
export function crewSpeedFactor(e: Engine, ship: number): number {
  const s = e.ships.get(ship), c = shared(e).crew.get(ship);
  if (!s || !c) return 1;
  const [lo, hi] = CREW_RANGE[s.type];
  const manning = (c.size - lo) / Math.max(1, hi - lo);       // 0..1
  return 1 + 0.12 * (1 - manning) - 0.04 + 0.12 * Math.max(0, (50 - c.morale) / 50);
}

export const crewEffects: FeatureFactory = (e) => ({
  id: "ships.crew-effects", ideas: [36, 37, 38], title: "Crew wages and seamanship", economy: true,
  adjust: {
    travelHours: (h, ctx) => e.features.enabled("ships.crew") ? Math.max(1, Math.round(h * crewSpeedFactor(e, ctx.ship))) : h,
    fuel: (f, ctx) => e.features.enabled("ships.crew") && shared(e).crew.get(ctx.ship)?.captain?.trait === "fuel-saver" ? f * 0.9 : f,
    upkeep: (u, ctx) => {
      if (!e.features.enabled("ships.crew")) return u;
      const c = e.companies.get(ctx.company);
      let hands = 0;
      for (const id of c?.ships ?? []) hands += shared(e).crew.get(id)?.size ?? 0;
      return u + hands * WAGE_PER_HAND;
    },
  },
  cards: () => [{ title: "Crew wages and seamanship", detail: `Each hand earns ${WAGE_PER_HAND} credits a day. Short-handed or unhappy crews sail up to 25% slower; a full, cheerful crew is 4% faster. Fuel-saver captains burn 10% less fuel.` }],
});
