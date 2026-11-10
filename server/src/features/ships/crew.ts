// Ideas 36, 37, 38 and 232: crew size, morale, captains with traits, and mutiny when morale stays low.
// This module keeps the crew records and their stories. What crews do to speed, fuel and wages is in
// ships.crew-effects (an economy module, off until approved).
import type { ShipType } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, fail, int, note, OK, ownShip, prune, shared, shipField, shipName, type Crew, type Trait } from "./shared.js";

export const CREW_RANGE: Record<ShipType, [number, number]> = { coaster: [4, 8], freighter: [8, 16], bulker: [12, 24], pirate: [6, 12] };
export const TRAITS: Trait[] = ["fuel-saver", "lucky", "brave"];
const TRAIT_TEXT: Record<Trait, string> = { "fuel-saver": "Fuel saver", lucky: "Lucky", brave: "Brave" };
const FIRST = ["Ada", "Bram", "Cora", "Dag", "Edda", "Finn", "Greta", "Hal", "Ines", "Jory", "Kit", "Lena", "Moss", "Nell", "Otto", "Pia"];
const LAST = ["Brine", "Hawser", "Keel", "Gale", "Marlin", "Tarr", "Fathom", "Spray", "Anchor", "Driftwood", "Lantern", "Rook"];
const MUTINY_BELOW = 15, MUTINY_AFTER_HOURS = 12;

export const crew: FeatureFactory = (e) => {
  const id = "ships.crew";
  const crews = shared(e).crew;
  const leave = new Map<number, number>();   // ship -> tick shore leave may next be given
  const fresh = (shipId: number): Crew => {
    const [lo, hi] = CREW_RANGE[e.ships.get(shipId)!.type];
    return { size: Math.round((lo + hi) / 2), morale: 70 };
  };
  /** Read without storing (for views). */
  const peek = (shipId: number): Crew => crews.get(shipId) ?? fresh(shipId);
  /** Read for a change (stores the default the first time). */
  const get = (shipId: number): Crew => {
    let c = crews.get(shipId);
    if (!c) crews.set(shipId, c = fresh(shipId));
    return c;
  };
  return {
    id, ideas: [36, 37, 38, 232], title: "Crew and captains", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (s.dest !== null) return fail("the ship must be in port");
      const c = get(s.id);
      switch (cmd.action) {
        case "setCrew": {
          const [lo, hi] = CREW_RANGE[s.type];
          const size = int(cmd.size, lo, hi);
          if (size === undefined) return fail(`crew for a ${s.type} is ${lo} to ${hi}`);
          if (size < c.size) c.morale = Math.max(0, c.morale - 5 * (c.size - size));   // laying off hurts morale
          c.size = size;
          return OK;
        }
        case "hireCaptain": {
          if (c.captain) return fail("this ship already has a captain");
          const r = e.features.random();
          const trait = TRAITS[Math.floor(r * TRAITS.length) % TRAITS.length];
          const name = `${FIRST[Math.floor(e.features.random() * FIRST.length) % FIRST.length]} ${LAST[Math.floor(e.features.random() * LAST.length) % LAST.length]}`;
          c.captain = { name, trait };
          c.morale = Math.min(100, c.morale + 10);
          note(e, s.id, `Captain ${name} (${TRAIT_TEXT[trait]}) took command.`);
          return OK;
        }
        case "dismissCaptain":
          if (!c.captain) return fail("this ship has no captain");
          note(e, s.id, `Captain ${c.captain.name} went ashore.`);
          delete c.captain;
          c.morale = Math.max(0, c.morale - 10);
          return OK;
        case "shoreLeave":
          if ((leave.get(s.id) ?? 0) > e.tick) return fail("the crew had shore leave less than a day ago");
          c.morale = Math.min(100, c.morale + 25);
          leave.set(s.id, e.tick + 24);
          note(e, s.id, "The crew had shore leave.");
          return OK;
        default: return fail("unknown action");
      }
    },
    advance() {
      for (const s of e.ships.values()) {
        const c = get(s.id), [lo] = CREW_RANGE[s.type];
        if (s.dest === null) { c.morale = Math.min(70, c.morale + 1); delete c.lowSince; continue; }
        // At sea: a slow grind, worse when short-handed, eased by a brave captain.
        let loss = 0.25 + (c.size < lo + 1 ? 0.25 : 0);
        if (c.captain?.trait === "brave") loss *= 0.5;
        c.morale = Math.max(0, c.morale - loss);
        if (c.morale >= MUTINY_BELOW) { delete c.lowSince; continue; }
        c.lowSince ??= e.tick;
        if (e.tick - c.lowSince >= MUTINY_AFTER_HOURS && e.features.random() < 0.1) {
          note(e, s.id, c.captain ? `Mutiny! The crew put Captain ${c.captain.name} in a boat and elected a bosun.` : "Mutiny! The crew locked the officers below decks for a day.");
          delete c.captain;
          c.size = lo;
          c.morale = 40;
          delete c.lowSince;
        }
      }
      if (e.tick % 24 === 0) { prune(e, crews); prune(e, leave); }
    },
    cards(company) {
      const co = e.companies.get(company);
      if (!co) return [];
      const inPort = co.ships.map(i => e.ships.get(i)!).filter(s => s && s.dest === null);
      const lines = co.ships.map(i => e.ships.get(i)!).filter(Boolean).map(s => {
        const c = peek(s.id);
        return `${shipName(e, s.id)}: ${c.size} crew, morale ${Math.round(c.morale)}${c.captain ? `, Captain ${c.captain.name} (${TRAIT_TEXT[c.captain.trait]})` : ", no captain"}`;
      });
      return [{ title: "Crew and captains", detail: `Crews lose heart at sea and recover in port. Below ${MUTINY_BELOW} morale for half a day they may mutiny. Captains are Fuel savers, Lucky (fewer mishaps) or Brave (steadier crews).\n${lines.join("\n")}`,
        actions: inPort.length ? [
          { ...action(id, "Set crew size", "setCrew"), fields: [shipField(e, inPort), { key: "size", label: "Crew", min: 4, max: 24, value: 10 }] },
          { ...action(id, "Hire a captain", "hireCaptain"), fields: [shipField(e, inPort)] },
          { ...action(id, "Dismiss the captain", "dismissCaptain"), fields: [shipField(e, inPort)] },
          { ...action(id, "Give shore leave", "shoreLeave"), fields: [shipField(e, inPort)] },
        ] : [] }];
    },
    view(company) {
      const co = e.companies.get(company);
      if (!co) return undefined;
      return co.ships.filter(i => e.ships.has(i)).map(i => ({ ship: i, range: CREW_RANGE[e.ships.get(i)!.type], ...peek(i) }));
    },
  };
};
