// Idea 39: NPC captains who run routes for you. Give a ship a standing route between the port it is in and one other
// port, with an optional cargo to buy at each end and a spending limit. Whenever the ship is docked and empty, the
// captain queues the next leg through the game's own voyage queue, so every buy, sale, fee and fuel bill is exactly
// what the player would have paid. The captain stops if a leg cannot be queued; the player can stop it any time.
import { GOODS, type Good, type Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, fail, note, OK, ownShip, portName, shipField, shipName } from "./shared.js";

interface Route { a: number; b: number; out: Good | null; back: Good | null; budget: number; legs: number; stopped?: string }
export const MAX_BUDGET = 1_000_000;

export const captains: FeatureFactory = (e) => {
  const id = "ships.captains";
  const routes = new Map<number, Route>();
  const good = (x: unknown): Good | null | undefined => x === "none" || x === undefined || x === null ? null : (GOODS as readonly unknown[]).includes(x) ? x as Good : undefined;
  return {
    id, ideas: [39], title: "Route captains", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (cmd.action === "dismiss") {
        if (!routes.delete(s.id)) return fail("this ship has no route captain");
        note(e, s.id, "The route captain was paid off.");
        return OK;
      }
      if (cmd.action !== "hire") return fail("unknown action");
      if (s.type === "pirate") return fail("route captains will not sail pirate ships");
      if (s.dest !== null) return fail("hire the captain while the ship is in port");
      const dest = cmd.dest;
      if (typeof dest !== "number" || !Number.isInteger(dest) || dest < 0 || dest >= e.map.ports.length || dest === s.port) return fail("choose the other end of the route");
      if (!Number.isFinite(e.dist[s.port][dest])) return fail("that port cannot be reached from here");
      const out = good(cmd.out), back = good(cmd.back);
      if (out === undefined || back === undefined) return fail("choose a cargo or none");
      const budget = cmd.budget;
      if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 1 || budget > MAX_BUDGET) return fail("enter a spending limit per leg");
      routes.set(s.id, { a: s.port, b: dest, out, back, budget, legs: 0 });
      note(e, s.id, `A route captain took over: ${portName(e, s.port)} to ${portName(e, dest)} and back.`);
      return OK;
    },
    advance() {
      for (const [ship, r] of routes) {
        const s = e.ships.get(ship);
        if (!s) { routes.delete(ship); continue; }
        if (r.stopped || s.dest !== null || e.voyageQueues.has(ship) || e.seasonOver) continue;
        if (s.qty > 0) { stop(s, r, "there is unsold cargo aboard"); continue; }
        const dest = s.port === r.a ? r.b : r.a;
        const buyGood = s.port === r.a ? r.out : s.port === r.b ? r.back : null;
        const qty = Math.floor(e.expansionCapacity(s));
        const res = e.apply({ type: "setVoyageQueue", company: s.owner, ship, legs: [{
          dest, maxSpend: r.budget, minProceeds: 0, ...(buyGood && qty >= 1 ? { buy: { good: buyGood, qty } } : {}),
        }] });
        if (!res.ok) { stop(s, r, res.error); continue; }
        r.legs++;
      }
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type !== "pirate");
      if (!ships.length) return [];
      const free = ships.filter(s => s.dest === null && !routes.has(s.id));
      const lines = ships.filter(s => routes.has(s.id)).map(s => {
        const r = routes.get(s.id)!, q = e.voyageQueues.get(s.id);
        return `${shipName(e, s.id)}: ${portName(e, r.a)} (${r.out ?? "ballast"}) to ${portName(e, r.b)} (${r.back ?? "ballast"}), ${r.legs} legs so far`
          + (r.stopped ? `; stopped: ${r.stopped}` : q?.paused ? `; waiting: ${q.paused}` : "");
      });
      const goodOptions = [{ value: "none", label: "No cargo" }, ...GOODS.map(g => ({ value: g, label: g }))];
      return [{ title: "Route captains",
        detail: `A route captain sails a ship back and forth between two ports, buying the cargo you choose at each end and selling it at the other, using the same voyage queue you would. Queue dispatch fees, fuel and port fees are charged as normal.${lines.length ? `\n${lines.join("\n")}` : ""}`,
        actions: [
          ...(free.length ? [{ ...action(id, "Hire a route captain", "hire"), fields: [shipField(e, free),
            { key: "dest", label: "Other end of the route", options: e.map.ports.map((p, i) => ({ value: i, label: p.name })) },
            { key: "out", label: "Cargo from this port", options: goodOptions },
            { key: "back", label: "Cargo on the way back", options: goodOptions },
            { key: "budget", label: "Spending limit per leg", min: 1, max: MAX_BUDGET, value: 2000 }] }] : []),
          ...ships.filter(s => routes.has(s.id)).map(s => action(id, `Pay off the captain (${shipName(e, s.id)})`, "dismiss", { ship: s.id })),
        ] }];
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      return c.ships.filter(i => routes.has(i)).map(i => ({ ship: i, ...routes.get(i)! }));
    },
  };

  function stop(s: Ship, r: Route, why: string) {
    r.stopped = why;
    note(e, s.id, `The route captain stopped: ${why}.`);
  }
};
