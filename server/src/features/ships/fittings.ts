// Ideas 27, 28, 29, 30 and 227: modular upgrade slots. Each hull has a few slots (coaster 2, freighter 3,
// bulker 4) that take fittings: engine, fuel tanks, cargo hold, hull armour, radar, or a hybrid engine.
// Fitting costs yard time, not money: the ship stays docked for FIT_HOURS while the yard works, and sailing
// early cancels the job. What this module does on its own: a bigger hold (capacity), armour (half hull wear and
// fire damage, through ships.wear) and radar range (ships.radar). Speed and fuel effects of engines, tanks and
// hybrids are in ships.fittings-effects, an economy module that is off until approved.
import type { Ship, ShipType } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { action, fail, note, OK, ownShip, prune, shipField, shipName } from "./shared.js";

export const FITTINGS = ["engine", "tank", "hold", "armour", "radar", "hybrid"] as const;
export type Fitting = (typeof FITTINGS)[number];
export const FIT_TEXT: Record<Fitting, string> = {
  engine: "Engine upgrade", tank: "Economy fuel tanks", hold: "Enlarged cargo hold",
  armour: "Hull armour", radar: "Long-range radar", hybrid: "Hybrid engine",
};
export const SLOTS: Record<ShipType, number> = { coaster: 2, freighter: 3, bulker: 4, pirate: 2 };
export const FIT_HOURS = 6;
export const HOLD_BONUS = 1.15;

export interface FittingsApi {
  has(ship: number, fit: Fitting | string): boolean;
  list(ship: number): Fitting[];
}

export const fittings: FeatureFactory = (e) => {
  const id = "ships.fittings";
  const fitted = new Map<number, Fitting[]>();
  const jobs = new Map<number, { fit: Fitting; until: number; port: number }>();
  const list = (ship: number) => fitted.get(ship) ?? [];
  const isFitting = (x: unknown): x is Fitting => typeof x === "string" && (FITTINGS as readonly string[]).includes(x);

  const mod: FeatureModule & FittingsApi = {
    id, ideas: [27, 28, 29, 30, 227], title: "Ship fittings and upgrade slots", economy: false,
    has: (ship, fit) => list(ship).includes(fit as Fitting),
    list,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (s.type === "pirate") return fail("pirate ships are fitted out by their crews");
      const have = list(s.id);
      switch (cmd.action) {
        case "install": {
          if (!isFitting(cmd.fit)) return fail("choose a fitting");
          if (s.dest !== null) return fail("the ship must be in port");
          if (jobs.has(s.id)) return fail("the yard is already working on this ship");
          if (have.includes(cmd.fit)) return fail("that fitting is already installed");
          if (cmd.fit === "hybrid" && have.includes("engine") || cmd.fit === "engine" && have.includes("hybrid"))
            return fail("a ship has one engine: remove the other engine first");
          if (have.length >= SLOTS[s.type]) return fail(`a ${s.type} has ${SLOTS[s.type]} slots; remove a fitting first`);
          jobs.set(s.id, { fit: cmd.fit, until: e.tick + FIT_HOURS, port: s.port });
          note(e, s.id, `The yard started fitting ${FIT_TEXT[cmd.fit].toLowerCase()} (${FIT_HOURS} hours).`);
          return OK;
        }
        case "remove": {
          if (!isFitting(cmd.fit) || !have.includes(cmd.fit)) return fail("that fitting is not installed");
          if (s.dest !== null) return fail("the ship must be in port");
          if (cmd.fit === "hold" && s.qty > e.spec(s.type).capacity) return fail("unload the extra cargo before removing the enlarged hold");
          fitted.set(s.id, have.filter(f => f !== cmd.fit));
          note(e, s.id, `Removed the ${FIT_TEXT[cmd.fit].toLowerCase()}.`);
          return OK;
        }
        case "cancel":
          if (!jobs.delete(s.id)) return fail("the yard is not working on this ship");
          note(e, s.id, "Fitting work was called off.");
          return OK;
        default: return fail("unknown action");
      }
    },
    advance() {
      for (const [ship, job] of jobs) {
        const s = e.ships.get(ship);
        if (!s) { jobs.delete(ship); continue; }
        if (s.dest !== null || s.port !== job.port) {
          jobs.delete(ship);
          note(e, ship, `Sailed before the yard finished; the ${FIT_TEXT[job.fit].toLowerCase()} was not fitted.`);
        } else if (e.tick >= job.until) {
          const have = list(ship);
          if (!have.includes(job.fit) && have.length < SLOTS[s.type]) fitted.set(ship, [...have, job.fit]);
          jobs.delete(ship);
          note(e, ship, `Fitted: ${FIT_TEXT[job.fit].toLowerCase()}.`);
        }
      }
      if (e.tick % 24 === 0) prune(e, fitted);
    },
    adjust: {
      capacity: (cap, ctx) => list(ctx.ship).includes("hold") ? cap * HOLD_BONUS : cap,
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type !== "pirate");
      if (!ships.length) return [];
      const inPort = ships.filter(s => s.dest === null && !jobs.has(s.id));
      const lines = ships.map(s => {
        const job = jobs.get(s.id);
        return `${shipName(e, s.id)} (${list(s.id).length}/${SLOTS[s.type]} slots): ${list(s.id).map(f => FIT_TEXT[f]).join(", ") || "no fittings"}`
          + (job ? `; fitting ${FIT_TEXT[job.fit].toLowerCase()}, ready in ${Math.max(0, job.until - e.tick)} h` : "");
      });
      const effects = e.features.enabled("ships.fittings-effects") ? "" : "\nEngine, tank and hybrid fittings change speed and fuel only when ship performance effects are switched on for this world.";
      const removable = ships.filter(s => s.dest === null && list(s.id).length);
      return [{ title: "Fittings and upgrade slots",
        detail: `Coasters have 2 slots, freighters 3, bulkers 4. Fitting takes ${FIT_HOURS} hours in port and costs nothing; sailing early cancels it. An enlarged hold carries 15% more; armour halves hull wear and fire damage; long-range radar sees pirates further off.${effects}\n${lines.join("\n")}`,
        actions: [
          ...(inPort.length ? [{ ...action(id, "Install a fitting", "install"), fields: [shipField(e, inPort),
            { key: "fit", label: "Fitting", options: FITTINGS.map(f => ({ value: f, label: FIT_TEXT[f] })) }] }] : []),
          ...(removable.length ? [{ ...action(id, "Remove a fitting", "remove"), fields: [shipField(e, removable),
            { key: "fit", label: "Fitting", options: FITTINGS.map(f => ({ value: f, label: FIT_TEXT[f] })) }] }] : []),
          ...ships.filter(s => jobs.has(s.id)).map(s => action(id, `Call off the yard work (${shipName(e, s.id)})`, "cancel", { ship: s.id })),
        ] }];
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return c.ships.filter(i => e.ships.has(i)).map(i => ({ ship: i, slots: SLOTS[e.ships.get(i)!.type], fitted: list(i),
        job: jobs.has(i) ? { fit: jobs.get(i)!.fit, ready: jobs.get(i)!.until } : null }));
    },
  };
  return mod;
};

// Ideas 27, 28 and 237 (economy side): engine upgrades sail 10% faster, economy tanks burn 7% less fuel, and a
// hybrid engine burns 25% less but is 5% slower. Fittings need servicing: a small daily charge per fitting.
export const FIT_SERVICE_PER_DAY = 4, HYBRID_SERVICE_PER_DAY = 10;
export const fittingsEffects: FeatureFactory = (e) => {
  const api = () => e.features.enabled("ships.fittings") ? e.features.modules.get("ships.fittings") as unknown as FittingsApi : undefined;
  return {
    id: "ships.fittings-effects", ideas: [27, 28, 237], title: "Fitting performance", economy: true,
    adjust: {
      travelHours: (h, ctx) => {
        const f = api();
        if (!f) return h;
        const k = f.has(ctx.ship, "engine") ? 0.9 : f.has(ctx.ship, "hybrid") ? 1.05 : 1;
        return k === 1 ? h : Math.max(1, Math.round(h * k));
      },
      fuel: (v, ctx) => {
        const f = api();
        if (!f) return v;
        return v * (f.has(ctx.ship, "tank") ? 0.93 : 1) * (f.has(ctx.ship, "hybrid") ? 0.75 : 1);
      },
      upkeep: (u, ctx) => {
        const f = api(), c = e.companies.get(ctx.company);
        if (!f || !c) return u;
        let extra = 0;
        for (const ship of c.ships) for (const fit of f.list(ship)) extra += fit === "hybrid" ? HYBRID_SERVICE_PER_DAY : FIT_SERVICE_PER_DAY;
        return u + extra;
      },
    },
    cards: () => [{ title: "Fitting performance", detail: `Engine upgrades sail 10% faster. Economy tanks burn 7% less fuel. A hybrid engine burns 25% less fuel and sails 5% slower. Each fitting costs ${FIT_SERVICE_PER_DAY} credits a day to service (hybrids ${HYBRID_SERVICE_PER_DAY}).` }],
  };
};
