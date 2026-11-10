// Ideas 21, 22, 23, 24, 25 and 238: specialist ship types. The game has three hull classes (coaster, freighter,
// bulker); a refit at your home port turns a hull into a specialist version of its class. Refits cost yard time
// (REFIT_HOURS docked at home), not money.
//   Bulk carrier  (bulker)              hold +10%.
//   Refrigerated  (coaster, freighter)  grain is kept cool: no fires in a grain cargo (ships.incidents).
//   Feeder        (coaster)             short hops: see ships.variants-effects.
//   Heavy-lift    (freighter, bulker)   own cranes for machinery: see ships.variants-effects.
//   Sail          (coaster)             wind power for the early game: see ships.variants-effects.
//   Tanker        (freighter, bulker)   liquid tanks for fuel: see ships.variants-effects.
// The speed, fuel, fee and tank effects are in ships.variants-effects, an economy module that is off until approved.
import type { Ship, ShipType } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { action, fail, note, OK, ownShip, prune, shipField, shipName } from "./shared.js";

export const ROLES = ["bulk", "reefer", "feeder", "heavyLift", "sail", "tanker"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_TEXT: Record<Role, string> = {
  bulk: "Bulk carrier", reefer: "Refrigerated ship", feeder: "Feeder", heavyLift: "Heavy-lift ship", sail: "Sailing coaster", tanker: "Tanker",
};
export const ROLE_HULLS: Record<Role, ShipType[]> = {
  bulk: ["bulker"], reefer: ["coaster", "freighter"], feeder: ["coaster"], heavyLift: ["freighter", "bulker"], sail: ["coaster"], tanker: ["freighter", "bulker"],
};
export const REFIT_HOURS = 12, BULK_HOLD = 1.1;
export const FEEDER_HOP_HOURS = 12;

export interface VariantsApi { role(ship: number): Role | undefined }

/** The specialist role of a ship, only while ships.variants is on. */
export function roleOf(e: { features: { enabled(id: string): boolean; modules: Map<string, unknown> } }, ship: number): Role | undefined {
  return e.features.enabled("ships.variants") ? (e.features.modules.get("ships.variants") as VariantsApi).role(ship) : undefined;
}

export const variants: FeatureFactory = (e) => {
  const id = "ships.variants";
  const roles = new Map<number, Role>();
  const jobs = new Map<number, { role: Role | null; until: number; port: number }>();
  const isRole = (x: unknown): x is Role => typeof x === "string" && (ROLES as readonly string[]).includes(x);

  const mod: FeatureModule & VariantsApi = {
    id, ideas: [22, 23, 24, 25, 238], title: "Specialist ships", economy: false,
    role: (ship) => roles.get(ship),
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "cancel") {
        if (!jobs.delete(s.id)) return fail("there is no refit under way");
        note(e, s.id, "The refit was called off.");
        return OK;
      }
      if (cmd.action !== "refit") return fail("unknown action");
      const role = cmd.role === "none" ? null : cmd.role;
      if (role !== null && !isRole(role)) return fail("choose a ship type");
      if (s.dest !== null || s.port !== c.home) return fail("refits are done at your home port");
      if (s.qty > 0) return fail("empty the hold before a refit");
      if (jobs.has(s.id)) return fail("this ship is already being refitted");
      if ((roles.get(s.id) ?? null) === role) return fail(role ? "the ship is already that type" : "the ship has no specialist refit");
      if (role && !ROLE_HULLS[role].includes(s.type)) return fail(`a ${ROLE_TEXT[role].toLowerCase()} is built from a ${ROLE_HULLS[role].join(" or ")}`);
      jobs.set(s.id, { role, until: e.tick + REFIT_HOURS, port: s.port });
      note(e, s.id, role ? `Refit to a ${ROLE_TEXT[role].toLowerCase()} started (${REFIT_HOURS} hours).` : `Work started to strip out the specialist gear (${REFIT_HOURS} hours).`);
      return OK;
    },
    advance() {
      for (const [ship, job] of jobs) {
        const s = e.ships.get(ship);
        if (!s) { jobs.delete(ship); continue; }
        if (s.dest !== null || s.port !== job.port) {
          jobs.delete(ship);
          note(e, ship, "Sailed before the refit was finished; the ship is unchanged.");
        } else if (e.tick >= job.until) {
          if (job.role) roles.set(ship, job.role); else roles.delete(ship);
          jobs.delete(ship);
          note(e, ship, job.role ? `Refit finished: now a ${ROLE_TEXT[job.role].toLowerCase()}.` : "Refit finished: back to a standard hull.");
        }
      }
      if (e.tick % 24 === 0) prune(e, roles);
    },
    adjust: {
      capacity: (cap, ctx) => roles.get(ctx.ship) === "bulk" ? cap * BULK_HOLD : cap,
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type !== "pirate");
      if (!ships.length) return [];
      const atHome = ships.filter(s => s.dest === null && s.port === c.home && s.qty === 0 && !jobs.has(s.id));
      const effects = e.features.enabled("ships.variants-effects") ? "Feeders are 15% faster on short hops, heavy-lift ships pay a quarter less in port fees with machinery aboard, sailing coasters burn 70% less fuel but sail 35% slower, and tankers can top up a fuel cargo to 30% over the hold rating."
        : "Feeder, heavy-lift, sail and tanker refits change speed, fuel and fees only when specialist ship performance is switched on for this world.";
      const lines = ships.map(s => {
        const r = roles.get(s.id), job = jobs.get(s.id);
        return `${shipName(e, s.id)} (${s.type}): ${r ? ROLE_TEXT[r] : "standard"}${job ? `; refit ready in ${Math.max(0, job.until - e.tick)} h` : ""}`;
      });
      return [{ title: "Specialist ships",
        detail: `Refit a ship at your home port with an empty hold (${REFIT_HOURS} hours, free). Bulk carriers (from bulkers) carry 10% more. Refrigerated ships never have grain fires. ${effects}\n${lines.join("\n")}`,
        actions: [
          ...(atHome.length ? [{ ...action(id, "Refit", "refit"), fields: [shipField(e, atHome),
            { key: "role", label: "Type", options: [...ROLES.map(r => ({ value: r, label: `${ROLE_TEXT[r]} (${ROLE_HULLS[r].join("/")})` })), { value: "none", label: "Standard hull" }] }] }] : []),
          ...ships.filter(s => jobs.has(s.id)).map(s => action(id, `Call off the refit (${shipName(e, s.id)})`, "cancel", { ship: s.id })),
        ] }];
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return c.ships.filter(i => e.ships.has(i)).map(i => ({ ship: i, role: roles.get(i) ?? null, refit: jobs.get(i) ?? null }));
    },
    world() {
      const out: Record<number, Role> = {};
      for (const [ship, r] of roles) if (e.ships.has(ship)) out[ship] = r;
      return out;
    },
  };
  return mod;
};

// Ideas 21, 24, 25 and 238 (economy side).
export const variantsEffects: FeatureFactory = (e) => ({
  id: "ships.variants-effects", ideas: [21, 24, 25, 238], title: "Specialist ship performance", economy: true,
  adjust: {
    travelHours: (h, ctx) => {
      const r = roleOf(e, ctx.ship);
      if (r === "feeder" && h <= FEEDER_HOP_HOURS) return Math.max(1, Math.round(h * 0.85));
      if (r === "sail") return Math.max(1, Math.round(h * 1.35));
      return h;
    },
    fuel: (v, ctx) => roleOf(e, ctx.ship) === "sail" ? v * 0.3 : v,
    portFee: (fee, ctx) => roleOf(e, ctx.ship) === "heavyLift" && e.ships.get(ctx.ship)?.good === 3 ? fee * 0.75 : fee,
    // The extra tanks only take liquids: once fuel is aboard, a tanker can top it up to 30% over the hold rating.
    capacity: (cap, ctx) => {
      const s = e.ships.get(ctx.ship);
      return roleOf(e, ctx.ship) === "tanker" && s && s.good === 1 && s.qty > 0 ? cap * 1.3 : cap;
    },
  },
  cards: () => [{ title: "Specialist ship performance", detail: "Feeders sail short hops (12 hours or less) 15% faster. Heavy-lift ships pay 25% less port fee with machinery aboard. Sailing coasters burn 70% less fuel and sail 35% slower. Tankers can top up a fuel cargo to 30% over the hold rating (load fuel, then buy more)." }],
});
