// Ideas 235 and 236: ship age, retirement value and refitting old hulls. Economy module (off until approved).
// A ship ages from the hour it first appears. After AGE_FREE_DAYS each day of age adds 1% to fuel (up to 20%).
// Retiring a ship pays a retirement value that starts at 60% of the new price and falls 1% a day to 30% (the normal
// scrap price is 50%, so young ships retire for more and old ones for less). Refitting an old hull at your home port
// makes it new again for 25% of the class price.
import type { Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, credits, fail, note, ownShip, prune, shipField, shipName } from "./shared.js";

export const AGE_FREE_DAYS = 10, MAX_FUEL_PENALTY = 0.2, REFIT_SHARE = 0.25;

export const age: FeatureFactory = (e) => {
  const id = "ships.age";
  const born = new Map<number, number>();
  const days = (ship: number) => Math.max(0, Math.floor((e.tick - (born.get(ship) ?? e.tick)) / 24));
  const penalty = (ship: number) => Math.min(MAX_FUEL_PENALTY, Math.max(0, days(ship) - AGE_FREE_DAYS) * 0.01);
  const retirement = (s: Ship) => e.spec(s.type).price * Math.max(0.3, 0.6 - 0.01 * days(s.id));
  const record = () => { for (const s of e.ships.values()) if (!born.has(s.id)) born.set(s.id, e.tick); };
  return {
    id, ideas: [235, 236], title: "Ship age, retirement and refits", economy: true,
    enable: record,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      const c = e.companies.get(cmd.company)!;
      if (s.dest !== null || s.qty > 0) return fail("the ship must be docked and empty");
      if (cmd.action === "refit") {
        if (s.port !== c.home) return fail("refits are done at your home port");
        if (days(s.id) <= AGE_FREE_DAYS) return fail("the hull is still young");
        const cost = e.spec(s.type).price * REFIT_SHARE;
        if (c.cash < cost) return fail("not enough cash");
        c.cash -= cost;
        born.set(s.id, e.tick);
        note(e, s.id, `Refitted: the old hull is as good as new (${credits(cost)}).`);
        return { ok: true, spent: cost };
      }
      if (cmd.action === "retire") {
        if (c.ships.length <= 1) return fail("you must keep one ship");
        if (e.voyageQueues.has(s.id)) return fail("cancel the voyage queue first");
        if (e.expansionEnabled && (e.fleetExpansion.leased(s) || e.explorationExpansion.spaceTaken(s))) return fail("the ship is leased or carrying offshore cargo");
        const paid = retirement(s);
        e.removeShip(c, s);
        c.cash += paid;
        born.delete(s.id);
        return { ok: true, earned: paid };
      }
      return fail("unknown action");
    },
    advance() { record(); if (e.tick % 24 === 0) prune(e, born); },
    adjust: { fuel: (f, ctx) => f * (1 + penalty(ctx.ship)) },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s);
      if (!ships.length) return [];
      const idle = ships.filter(s => s.dest === null && s.qty === 0);
      return [{ title: "Ship age",
        detail: `After ${AGE_FREE_DAYS} days a hull burns 1% more fuel for every day of age (up to ${MAX_FUEL_PENALTY * 100}%). Retiring pays 60% of the new price for a new ship, falling 1% a day to 30%. A refit at your home port makes an old hull new for ${REFIT_SHARE * 100}% of the class price.\n`
          + ships.map(s => `${shipName(e, s.id)}: ${days(s.id)} days old, +${Math.round(penalty(s.id) * 100)}% fuel, retires for ${credits(retirement(s))}`).join("\n"),
        actions: [
          ...(idle.filter(s => s.port === c.home && days(s.id) > AGE_FREE_DAYS).length ? [{ ...action(id, "Refit an old hull", "refit"), fields: [shipField(e, idle.filter(s => s.port === c.home && days(s.id) > AGE_FREE_DAYS))] }] : []),
          ...(idle.length && ships.length > 1 ? [{ ...action(id, "Retire a ship", "retire"), fields: [shipField(e, idle)] }] : []),
        ] }];
    },
    view(company) {
      const c = e.companies.get(company);
      return c ? c.ships.filter(i => e.ships.has(i)).map(i => ({ ship: i, days: days(i), fuelPenalty: penalty(i), retirement: Math.round(retirement(e.ships.get(i)!)) })) : undefined;
    },
  };
};
