// Ideas 221, 222 and 223: how hard you drive a ship. All three change fuel, travel time or what reaches port, so all
// three are economy modules (off until approved).
//   ships.throttle      a per-ship setting: economical (slower, much less fuel), normal, or full ahead (faster, thirsty).
//   ships.slipstream    ships of one company that leave the same port for the same destination in the same hour sail
//                       in each other's wake and burn less fuel.
//   ships.overloading   let a ship load past its rated hold. An overloaded ship at sea may have to jettison the whole
//                       cargo in heavy weather; the loss is recorded for ships.insurance.
import type { Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, fail, note, OK, ownShip, peer, prune, shared, shipField, shipName } from "./shared.js";

export const THROTTLE = {
  eco: { label: "Economical", hours: 1.2, fuel: 0.7 },
  normal: { label: "Normal", hours: 1, fuel: 1 },
  full: { label: "Full ahead", hours: 0.85, fuel: 1.4 },
} as const;
export type Throttle = keyof typeof THROTTLE;

export const throttle: FeatureFactory = (e) => {
  const id = "ships.throttle";
  const settings = new Map<number, Throttle>();
  const of = (ship: number): Throttle => settings.get(ship) ?? "normal";
  return {
    id, ideas: [221], title: "Throttle", economy: true,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (cmd.action !== "set") return fail("unknown action");
      if (typeof cmd.setting !== "string" || !(cmd.setting in THROTTLE)) return fail("choose a throttle setting");
      if (cmd.setting === "normal") settings.delete(s.id); else settings.set(s.id, cmd.setting as Throttle);
      return OK;
    },
    advance() { if (e.tick % 24 === 0) prune(e, settings); },
    adjust: {
      travelHours: (h, ctx) => of(ctx.ship) === "normal" ? h : Math.max(1, Math.round(h * THROTTLE[of(ctx.ship)].hours)),
      fuel: (f, ctx) => f * THROTTLE[of(ctx.ship)].fuel,
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s);
      if (!ships.length) return [];
      return [{ title: "Throttle",
        detail: `Set how hard each ship is driven on its next voyage. Economical: 20% slower, 30% less fuel. Full ahead: 15% faster, 40% more fuel.\n${ships.map(s => `${shipName(e, s.id)}: ${THROTTLE[of(s.id)].label}`).join("\n")}`,
        actions: [{ ...action(id, "Set throttle", "set"), fields: [shipField(e, ships), { key: "setting", label: "Throttle", options: (Object.keys(THROTTLE) as Throttle[]).map(k => ({ value: k, label: THROTTLE[k].label })) }] }] }];
    },
    view(company) {
      const c = e.companies.get(company);
      return c ? c.ships.filter(i => e.ships.has(i)).map(i => ({ ship: i, throttle: of(i) })) : undefined;
    },
  };
};

export const SLIPSTREAM_SAVING = 0.12;
export const slipstream: FeatureFactory = (e) => {
  const saved = new Map<number, number>();   // company -> convoy departures
  return {
    id: "ships.slipstream", ideas: [222], title: "Convoy slipstream", economy: true,
    adjust: {
      // Called while the ship is still docked: look for a company ship that already left the same port for the same
      // destination this hour.
      fuel: (f, ctx) => {
        const me = e.ships.get(ctx.ship);
        if (!me) return f;
        for (const s of e.ships.values()) {
          if (s.id === me.id || s.owner !== me.owner || s.dest !== ctx.dest || s.departTick !== e.tick || s.port !== ctx.from) continue;
          return f * (1 - SLIPSTREAM_SAVING);
        }
        return f;
      },
    },
    advance() {
      const groups = new Map<string, number>();
      for (const s of e.ships.values()) if (s.dest !== null && s.departTick === e.tick - 1) {
        const k = `${s.owner}:${s.port}:${s.dest}`;
        groups.set(k, (groups.get(k) ?? 0) + 1);
      }
      for (const [k, n] of groups) if (n > 1) { const owner = Number(k.split(":")[0]); saved.set(owner, (saved.get(owner) ?? 0) + n - 1); }
    },
    cards: (company) => [{ title: "Convoy slipstream", detail: `Send two or more of your ships from the same port to the same destination in the same hour and every ship after the first burns ${SLIPSTREAM_SAVING * 100}% less fuel.${saved.get(company) ? ` Convoy departures this season: ${saved.get(company)}.` : ""}` }],
  };
};

export const OVERLOAD = 1.2, JETTISON_CHANCE = 0.006;
export const overloading: FeatureFactory = (e) => {
  const id = "ships.overloading";
  const allowed = new Set<number>();
  const over = (s: Ship) => s.qty > e.spec(s.type).capacity + 1e-9;
  return {
    id, ideas: [223], title: "Overloading", economy: true,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (cmd.action === "allow") { allowed.add(s.id); return OK; }
      if (cmd.action === "forbid") {
        if (over(s)) return fail("unload the extra cargo first");
        allowed.delete(s.id);
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest === null || !over(s)) continue;
        let p = JETTISON_CHANCE;
        if (e.features.enabled("ships.crew") && shared(e).crew.get(s.id)?.captain?.trait === "lucky") p /= 2;
        if (e.features.random() >= p) continue;
        const lost = s.cost > 0 ? s.cost : 0;
        shared(e).losses.push({ ship: s.id, owner: s.owner, amount: lost, kind: "jettisoned cargo" });
        note(e, s.id, `Heavy seas! The overloaded ship had to jettison all ${Math.round(s.qty)} t of cargo to stay afloat.`);
        s.qty = 0; s.good = null; s.cost = 0;
        peer<{ damage(ship: number, points: number, why: string): void }>(e, "ships.wear")?.damage(s.id, 10, "heavy seas while overloaded");
      }
      if (e.tick % 24 === 0) prune(e, allowed);
    },
    adjust: { capacity: (cap, ctx) => allowed.has(ctx.ship) ? cap * OVERLOAD : cap },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type !== "pirate");
      if (!ships.length) return [];
      return [{ title: "Overloading",
        detail: `Allow a ship to load up to ${Math.round((OVERLOAD - 1) * 100)}% past its rated hold. An overloaded ship at sea risks having to jettison its whole cargo in heavy weather (about ${(JETTISON_CHANCE * 100).toFixed(1)}% an hour).\n${ships.map(s => `${shipName(e, s.id)}: ${allowed.has(s.id) ? "may overload" : "rated load only"}${over(s) ? " (overloaded now)" : ""}`).join("\n")}`,
        actions: [
          { ...action(id, "Allow overloading", "allow"), fields: [shipField(e, ships.filter(s => !allowed.has(s.id)))] },
          { ...action(id, "Rated load only", "forbid"), fields: [shipField(e, ships.filter(s => allowed.has(s.id)))] },
        ].filter(a => a.fields[0].options.length) }];
    },
  };
};
