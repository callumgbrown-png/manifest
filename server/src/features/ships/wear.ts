// Ideas 34, 35 and 229: hull wear, repairs (quick patches anywhere, full overhauls in a dry dock) and mid-voyage
// breakdowns. A worn hull is slower and thirstier and may break down at sea, which delays its arrival.
import type { Ship } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { action, credits, fail, note, OK, ownShip, peer, prune, shared, shipField, shipName } from "./shared.js";

export const WEAR_PER_HOUR = 0.12, PATCH_TO = 80, DRYDOCK_HOURS = 12;
export const PATCH_RATE = 0.002, DOCK_RATE = 0.0012;   // share of the class price per condition point

export interface WearApi {
  damage(ship: number, points: number, why: string): void;
  condition(ship: number): number;
  brokenDown(ship: number): { delay: number; tick: number } | undefined;
  /** Towing (ships.towing) clears the delay a breakdown added. */
  clearBreakdown(ship: number): number;
}

export const wear: FeatureFactory = (e) => {
  const id = "ships.wear";
  const cond = shared(e).condition;
  const docks = new Map<number, { until: number; paid: number; port: number }>();
  const broken = new Map<number, { delay: number; tick: number; departTick: number }>();
  const get = (ship: number) => cond.get(ship) ?? 100;
  const armoured = (ship: number) => !!peer<{ has(s: number, f: string): boolean }>(e, "ships.fittings")?.has(ship, "armour");
  const covered = (s: Ship) => peer<{ repairShare(ship: number): number }>(e, "ships.insurance")?.repairShare(s.id) ?? 0;
  const pointCost = (s: Ship, rate: number) => e.spec(s.type).price * rate * (1 - covered(s));
  const factor = (ship: number, per: number) => { const c = get(ship); return c >= 60 ? 1 : 1 + (60 - c) / per; };

  const mod: FeatureModule & WearApi = {
    id, ideas: [34, 35, 229], title: "Hull wear and repairs", economy: true,
    damage(ship, points, why) {
      if (!e.ships.has(ship) || !(points > 0)) return;
      const hit = armoured(ship) ? points / 2 : points;
      cond.set(ship, Math.max(0, get(ship) - hit));
      note(e, ship, `Hull damaged by ${why} (condition ${Math.round(get(ship))}).`);
    },
    condition: get,
    brokenDown: (ship) => broken.get(ship),
    clearBreakdown(ship) {
      const b = broken.get(ship), s = e.ships.get(ship);
      if (!b || !s || s.dest === null) return 0;
      const back = Math.min(b.delay, Math.max(0, s.arriveTick - e.tick - 1));
      s.arriveTick -= back;
      broken.delete(ship);
      return back;
    },
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      const c = e.companies.get(cmd.company)!;
      if (s.dest !== null) return fail("the ship must be in port");
      if (docks.has(s.id)) return fail("the ship is already in dry dock");
      const now = get(s.id);
      if (cmd.action === "patch") {
        if (now >= PATCH_TO) return fail(`a patch only brings a hull up to ${PATCH_TO}`);
        const cost = (PATCH_TO - now) * pointCost(s, PATCH_RATE);
        if (c.cash < cost) return fail("not enough cash");
        c.cash -= cost;
        cond.set(s.id, PATCH_TO);
        note(e, s.id, `Patched up at ${e.map.ports[s.port].name} for ${credits(cost)}.`);
        return { ok: true, spent: cost };
      }
      if (cmd.action === "dryDock") {
        if (s.port !== c.home) return fail("dry docks are at your home port");
        if (now >= 100) return fail("the hull is already in perfect condition");
        const cost = (100 - now) * pointCost(s, DOCK_RATE);
        if (c.cash < cost) return fail("not enough cash");
        c.cash -= cost;
        docks.set(s.id, { until: e.tick + DRYDOCK_HOURS, paid: cost, port: s.port });
        note(e, s.id, `Entered dry dock for a ${DRYDOCK_HOURS}-hour overhaul.`);
        return { ok: true, spent: cost };
      }
      return fail("unknown action");
    },
    advance() {
      for (const [ship, d] of docks) {
        const s = e.ships.get(ship);
        if (!s) { docks.delete(ship); continue; }
        if (s.dest !== null || s.port !== d.port) {
          e.companies.get(s.owner)!.cash += d.paid / 2;
          docks.delete(ship);
          note(e, ship, "Left dry dock before the overhaul was finished; half the fee was refunded.");
        } else if (e.tick >= d.until) {
          cond.set(ship, 100);
          docks.delete(ship);
          note(e, ship, "Overhaul finished: the hull is as good as new.");
        }
      }
      for (const s of e.ships.values()) {
        if (s.dest === null) { broken.delete(s.id); continue; }
        cond.set(s.id, Math.max(0, get(s.id) - (armoured(s.id) ? WEAR_PER_HOUR / 2 : WEAR_PER_HOUR)));
        const b = broken.get(s.id);
        if (b && b.departTick === s.departTick) continue;   // one breakdown per voyage
        const p = Math.max(0, 50 - get(s.id)) / 2500;
        if (p <= 0 || e.features.random() >= p) continue;
        const delay = Math.min(4 + Math.floor(e.features.random() * 9), Math.max(0, e.seasonHours - 1 - s.arriveTick));
        if (delay <= 0) continue;
        s.arriveTick += delay;
        broken.set(s.id, { delay, tick: e.tick, departTick: s.departTick });
        note(e, s.id, `Engine breakdown! Drifting while the crew make repairs: ${delay} hours late.`);
      }
      if (e.tick % 24 === 0) prune(e, cond);
    },
    adjust: {
      travelHours: (h, ctx) => Math.max(1, Math.round(h * factor(ctx.ship, 200))),
      fuel: (f, ctx) => f * factor(ctx.ship, 150),
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)!).filter(Boolean);
      const inPort = ships.filter(s => s.dest === null && !docks.has(s.id));
      const lines = ships.map(s => `${shipName(e, s.id)}: condition ${Math.round(get(s.id))}${docks.has(s.id) ? " (in dry dock)" : ""}${broken.has(s.id) ? " (broken down)" : ""}`);
      return [{ title: "Hull wear and repairs",
        detail: `Hulls wear at sea. Below 60 a ship is slower and burns more fuel; below 50 it may break down. A patch (any port) brings a hull to ${PATCH_TO}; a ${DRYDOCK_HOURS}-hour dry-dock overhaul at your home port restores it fully for less per point, if the ship stays put.\n${lines.join("\n")}`,
        actions: inPort.length ? [
          { ...action(id, "Patch the hull", "patch"), fields: [{ ...shipField(e, inPort.filter(s => get(s.id) < PATCH_TO)), label: "Ship" }] },
          { ...action(id, "Dry dock overhaul", "dryDock"), fields: [shipField(e, inPort.filter(s => s.port === c.home && get(s.id) < 100))] },
        ].filter(a => a.fields[0].options.length) : [] }];
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return c.ships.filter(i => e.ships.has(i)).map(i => ({ ship: i, condition: Math.round(get(i) * 10) / 10,
        dryDock: docks.get(i)?.until ?? null, brokenDown: broken.get(i)?.delay ?? 0 }));
    },
  };
  return mod;
};
