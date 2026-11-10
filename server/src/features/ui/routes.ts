import type { Engine, Result, VoyageLeg } from "../../engine.js";
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { OK, fail, goodIndex, int, isPort, journal, num, ownShip, remember, sub } from "./common.js";

export interface SavedRoute { id: number; from: number; dest: number; good: string | null; qty: number }
const MAX_SAVED = 8;

/** Sail a docked ship from inside a feature command (normal engine rules and costs apply). */
function sailFrom(e: Engine, company: number, ship: number, dest: number, good: string | null, qty: number): Result {
  const s = e.ships.get(ship)!;
  if (s.qty > 0) {
    if (good !== null && GOODS[s.good!] !== good) return fail("this ship carries other cargo; sell it first");
    return sub(e, { type: "sail", company, ship, dest });
  }
  const cap = e.expansionCapacity(s);
  return sub(e, { type: "sail", company, ship, dest,
    ...(good ? { buy: { good: good as (typeof GOODS)[number], qty: Math.min(qty, cap, Math.floor(e.stock[s.port][GOODS.indexOf(good as never)])) } } : {}) });
}

/** Idea 148: saved routes you can re-run on any ship docked at the route's start (economy flag). */
export const savedRoutes: FeatureFactory = (e) => {
  const saved = new Map<number, SavedRoute[]>();
  let seq = 0;
  journal(e).register("ui.saved-routes", (company, before) => {
    saved.set(company, structuredClone(before as SavedRoute[]));
    return OK;
  });
  return {
    id: "ui.saved-routes", ideas: [148], title: "Saved routes", economy: true,
    apply(cmd) {
      const list = saved.get(cmd.company) ?? [];
      if (cmd.action === "save") {
        const from = cmd.from, dest = cmd.dest, qty = int(cmd.qty, 1, 100_000);
        const g = cmd.good === null || cmd.good === "" || cmd.good === undefined ? null : goodIndex(cmd.good);
        if (!isPort(e, from) || !isPort(e, dest) || from === dest || !Number.isFinite(e.dist[from][dest])) return fail("choose two connected ports");
        if (qty === null) return fail("quantity must be 1 or more");
        if (cmd.good && g === null) return fail("unknown good");
        if (list.length >= MAX_SAVED) return fail(`you can save ${MAX_SAVED} routes; delete one first`);
        remember(e, cmd, "save route", list);
        saved.set(cmd.company, [...list, { id: ++seq, from, dest, good: g === null ? null : GOODS[g], qty }]);
        return { ok: true, id: seq };
      }
      if (cmd.action === "delete") {
        if (!list.some(r => r.id === cmd.id)) return fail("no such route");
        remember(e, cmd, "delete route", list);
        saved.set(cmd.company, list.filter(r => r.id !== cmd.id));
        return OK;
      }
      if (cmd.action === "run") {
        const r = list.find(x => x.id === cmd.id);
        if (!r) return fail("no such route");
        const s = ownShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (s.dest !== null || s.port !== r.from) return fail("the ship must be docked at the route's start port");
        return sailFrom(e, cmd.company, s.id, r.dest, r.good, r.qty);
      }
      return fail("unknown action");
    },
    view(company) { return { routes: saved.get(company) ?? [], max: MAX_SAVED }; },
  };
};

/** Idea 424: one click repeats a ship's last voyage from the port it is docked at. */
export const repeatRoute: FeatureFactory = (e) => ({
  id: "ui.repeat-route", ideas: [424], title: "Repeat last route", economy: false,
  apply(cmd) {
    if (cmd.action !== "repeat") return fail("unknown action");
    const s = ownShip(e, cmd.company, cmd.ship);
    if (typeof s === "string") return fail(s);
    if (s.dest !== null) return fail("ship is at sea");
    const last = [...(e.trips.get(cmd.company) ?? [])].reverse().find(t => t.ship === s.id && t.from === s.port);
    if (!last) return fail("this ship has no earlier voyage from this port");
    return sailFrom(e, cmd.company, s.id, last.to, last.good === null ? null : GOODS[last.good], last.qty);
  },
  view(company) {
    const out: Record<number, { dest: number; good: string | null; qty: number }> = {};
    const trips = e.trips.get(company) ?? [];
    for (const id of e.companies.get(company)?.ships ?? []) {
      const s = e.ships.get(id)!;
      if (s.dest !== null) continue;
      const last = [...trips].reverse().find(t => t.ship === id && t.from === s.port);
      if (last) out[id] = { dest: last.to, good: last.good === null ? null : GOODS[last.good], qty: last.qty };
    }
    return out;
  },
});

interface Loop { company: number; legs: VoyageLeg[]; left: number; stopped?: string }
const MAX_LOOPS = 20;

/** Idea 149: auto-trade routes. Extends the voyage queue: a round trip that re-queues itself up to N times. */
export const autoTrade: FeatureFactory = (e) => {
  const loops = new Map<number, Loop>();
  journal(e).register("ui.auto-trade", (company, before) => {
    const b = before as { ship: number; loop: Loop | null };
    if (b.loop) loops.set(b.ship, structuredClone(b.loop)); else loops.delete(b.ship);
    return OK;
  });
  return {
    id: "ui.auto-trade", ideas: [149], title: "Auto-trade routes", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (cmd.action === "stop") {
        const loop = loops.get(s.id);
        if (!loop || loop.company !== cmd.company) return fail("no auto-trade route on this ship");
        remember(e, cmd, "stop auto-trade", { ship: s.id, loop });
        loops.delete(s.id);
        return OK;
      }
      if (cmd.action !== "start") return fail("unknown action");
      const times = int(cmd.loops, 1, MAX_LOOPS);
      if (times === null) return fail(`repeat 1 to ${MAX_LOOPS} times`);
      if (s.dest !== null) return fail("start an auto-trade route while the ship is docked");
      if (!Array.isArray(cmd.legs) || cmd.legs.length < 2 || cmd.legs.length > 3) return fail("a route has 2 or 3 legs");
      const legs: VoyageLeg[] = [];
      for (const raw of cmd.legs as unknown[]) {
        const leg = raw as Record<string, unknown> | null;
        if (!leg || typeof leg !== "object" || !isPort(e, leg.dest)) return fail("choose a port for each leg");
        const maxSpend = num(leg.maxSpend, 1, 10_000_000), minProceeds = num(leg.minProceeds, 0, 10_000_000);
        if (maxSpend === null || minProceeds === null) return fail("enter valid spending and sale limits");
        let buy: VoyageLeg["buy"];
        if (leg.good !== undefined && leg.good !== null && leg.good !== "") {
          const g = goodIndex(leg.good), qty = int(leg.qty, 1, 100_000);
          if (g === null || qty === null) return fail("enter valid cargo for each leg");
          buy = { good: GOODS[g], qty };
        }
        legs.push({ dest: leg.dest, maxSpend, minProceeds, ...(buy ? { buy } : {}) });
      }
      if (legs.at(-1)!.dest !== s.port) return fail("an auto-trade route must end where it starts, so it can repeat");
      const set = sub(e, { type: "setVoyageQueue", company: cmd.company, ship: s.id, legs: structuredClone(legs) });
      if (!set.ok) return set;
      loops.set(s.id, { company: cmd.company, legs, left: times - 1 });
      return OK;
    },
    advance() {
      for (const [id, loop] of loops) {
        const s = e.ships.get(id);
        if (!s || s.owner !== loop.company) { loops.delete(id); continue; }
        if (loop.stopped) continue;
        const queue = e.voyageQueues.get(id);
        if (queue) { if (queue.paused) loop.stopped = queue.paused; continue; }
        if (loop.left <= 0) { loops.delete(id); continue; }
        if (s.dest !== null) continue;
        const set = e.apply({ type: "setVoyageQueue", company: loop.company, ship: id, legs: structuredClone(loop.legs) });
        if (set.ok) loop.left--; else loop.stopped = set.error;
      }
    },
    view(company) {
      return [...loops].filter(([, l]) => l.company === company)
        .map(([ship, l]) => ({ ship, legs: l.legs.map(x => ({ dest: x.dest, good: x.buy?.good ?? null, qty: x.buy?.qty ?? 0 })), left: l.left, stopped: l.stopped ?? null }));
    },
  };
};

/** Idea 423: sell the cargo on every docked ship at the market price in one go (economy flag). */
export const quickSell: FeatureFactory = (e) => ({
  id: "ui.quick-sell", ideas: [423], title: "Quick-sell", economy: true,
  apply(cmd) {
    if (cmd.action !== "sellAll") return fail("unknown action");
    const c = e.companies.get(cmd.company);
    if (!c) return fail("no company");
    const before = c.cash;
    let sold = 0;
    for (const id of [...c.ships]) {
      const s = e.ships.get(id)!;
      if (s.dest !== null || s.qty <= 0 || e.voyageQueues.has(id)) continue;
      if (sub(e, { type: "sell", company: c.id, ship: id }).ok) sold++;
    }
    if (!sold) return fail("no docked ship has cargo to sell");
    return { ok: true, sold, earned: Math.round(c.cash - before) };
  },
});
