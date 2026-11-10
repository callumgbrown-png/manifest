// Ideas 231, 233 and 224: fires on board, stowaways, and cargo balance (stability). No money changes hands:
// a fire hurts the crew's morale (ships.crew) and the hull (ships.wear, if on); a badly balanced ship catches
// fire more easily; stowaways can join the crew or be put ashore.
import type { Engine, Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { CREW_RANGE } from "./crew.js";
import { action, fail, note, OK, ownShip, peer, prune, shared, shipName, VoyageWatch } from "./shared.js";
import { roleOf } from "./variants.js";

export type Stability = "ballast" | "light" | "balanced" | "overloaded";
/** How the cargo sits: an almost empty hold rolls ("light"), more than the rated hold is "overloaded". */
export function stability(e: Engine, s: Ship): Stability {
  if (s.qty <= 0) return "ballast";
  const fill = s.qty / Math.max(1, e.spec(s.type).capacity);
  return fill > 1 ? "overloaded" : fill < 0.35 ? "light" : "balanced";
}
export const FIRE_CHANCE = 0.0015, STOWAWAY_CHANCE = 0.04;

export const incidents: FeatureFactory = (e) => {
  const id = "ships.incidents";
  const watch = new VoyageWatch();
  const stowaways = new Map<number, { found: number; count: number }>();
  const fires = new Map<number, number>();   // company -> fires this season
  const fireChance = (s: Ship) => {
    if (s.good === 0 && s.qty > 0 && roleOf(e, s.id) === "reefer") return 0;   // refrigerated grain cannot catch fire
    let p = FIRE_CHANCE;
    const st = stability(e, s);
    if (st === "light" || st === "overloaded") p *= 2;
    if (s.good === 1 && s.qty > 0) p *= 1.5;   // fuel cargo
    if (e.features.enabled("ships.crew") && shared(e).crew.get(s.id)?.captain?.trait === "lucky") p *= 0.5;
    return p;
  };
  return {
    id, ideas: [231, 233, 224], title: "Fires, stowaways and stability", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      const w = stowaways.get(s.id);
      if (!w) return fail("there are no stowaways aboard");
      if (cmd.action === "signOn") {
        if (!e.features.enabled("ships.crew")) return fail("crew records are not kept in this world");
        const c = shared(e).crew.get(s.id);
        const [, hi] = CREW_RANGE[s.type];
        if (!c) return fail("crew records are not ready yet");
        c.size = Math.min(hi, c.size + w.count);
        c.morale = Math.min(100, c.morale + 5);
        note(e, s.id, `${w.count === 1 ? "The stowaway" : `${w.count} stowaways`} signed on as deckhands.`);
      } else if (cmd.action === "putAshore") {
        if (s.dest !== null) return fail("the ship must be in port");
        note(e, s.id, `Put ${w.count === 1 ? "a stowaway" : `${w.count} stowaways`} ashore at ${e.map.ports[s.port].name}.`);
      } else return fail("unknown action");
      stowaways.delete(s.id);
      return OK;
    },
    advance() {
      watch.step(e, {
        depart: (s) => {
          if (s.type === "pirate" || e.features.random() >= STOWAWAY_CHANCE) return;
          const count = e.features.random() < 0.2 ? 2 : 1;
          stowaways.set(s.id, { found: e.tick, count });
          note(e, s.id, `${count === 1 ? "A stowaway was" : "Two stowaways were"} found hiding in the hold.`);
        },
      });
      for (const s of e.ships.values()) {
        if (s.dest === null) {
          const w = stowaways.get(s.id);
          if (w && e.tick - w.found >= 72) { stowaways.delete(s.id); note(e, s.id, "The stowaways slipped ashore."); }
          continue;
        }
        if (e.features.random() >= fireChance(s)) continue;
        note(e, s.id, `Fire in the ${stability(e, s) === "balanced" ? "engine room" : "shifting cargo"}! The crew put it out.`);
        fires.set(s.owner, (fires.get(s.owner) ?? 0) + 1);
        const crew = e.features.enabled("ships.crew") ? shared(e).crew.get(s.id) : undefined;
        if (crew) crew.morale = Math.max(0, crew.morale - (crew.captain?.trait === "brave" ? 7 : 15));
        const wear = peer<{ damage(ship: number, points: number, why: string): void }>(e, "ships.wear");
        wear?.damage(s.id, 12, "fire");
      }
      if (e.tick % 24 === 0) prune(e, stowaways);
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)!).filter(Boolean);
      const aboard = ships.filter(s => stowaways.has(s.id));
      const balance = ships.map(s => `${shipName(e, s.id)}: ${stability(e, s)}`);
      return [{
        title: "Stability and stowaways",
        detail: `A hold under a third full rolls, and a hold over its rating is overloaded: both double the risk of fire. Fuel cargo burns more easily.\n${balance.join("\n")}${aboard.length ? `\nStowaways aboard: ${aboard.map(s => shipName(e, s.id)).join(", ")}.` : ""}`,
        actions: aboard.flatMap(s => [action(id, `Sign on stowaways (${shipName(e, s.id)})`, "signOn", { ship: s.id }),
          ...(s.dest === null ? [action(id, `Put stowaways ashore (${shipName(e, s.id)})`, "putAshore", { ship: s.id })] : [])]),
      }];
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return { fires: fires.get(company) ?? 0, ships: c.ships.filter(i => e.ships.has(i)).map(i => {
        const s = e.ships.get(i)!;
        return { ship: i, stability: stability(e, s), fireRisk: s.dest === null ? 0 : fireChance(s), stowaways: stowaways.get(i)?.count ?? 0 };
      }) };
    },
  };
};
