import type { Engine, Ship } from "../../engine.js";
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";

/** One suggested voyage for a docked ship, with the server's own quote (fuel, fees, tax, hours). */
export interface RouteOption {
  ship: number; from: number; dest: number; good: string | null; qty: number;
  hours: number; cargoCost: number; fuelCost: number; portFee: number; revenue: number; profit: number; perHour: number;
}

const round = (x: number) => Math.round(x * 100) / 100;

/**
 * The best voyages for a docked ship, ranked by profit per hour. A quick estimate ranks every port and good,
 * then the leaders are re-checked with engine.voyageQuote (the same maths the server uses to sail), so the
 * figures match the Dispatch estimate. Read-only: changes nothing.
 */
export function planRoutes(e: Engine, s: Ship, limit = 3): RouteOption[] {
  if (s.dest !== null || e.seasonOver) return [];
  const c = e.companies.get(s.owner);
  if (!c) return [];
  const tax = e.rules.fees.trade_tax_rate, cap = e.expansionCapacity(s);
  const goods = s.qty > 0 && s.good !== null ? [s.good] : GOODS.map((_, g) => g);
  const rough: { dest: number; g: number; qty: number; score: number }[] = [];
  for (const g of goods) {
    const qty = s.qty > 0 ? s.qty
      : Math.floor(Math.min(cap, e.stock[s.port][g], Math.max(0, c.cash) / (e.price(s.port, g) * (1 + tax) * 1.1)));
    if (qty < 1) continue;
    const cost = s.qty > 0 ? e.sellValue(s.port, g, qty) * (1 - tax) : e.buyCost(s.port, g, qty).cost * (1 + tax);
    for (let dest = 0; dest < e.map.ports.length; dest++) {
      if (dest === s.port || !Number.isFinite(e.dist[s.port][dest])) continue;
      const hours = e.voyageHours(s.port, dest, s.type);
      if (e.tick + hours >= e.seasonHours) continue;
      const fuel = e.fuelNeeded(s.port, dest, s.type) * e.price(s.port, 1);
      const profit = e.sellValue(dest, g, qty) * (1 - tax) - cost - fuel - e.rules.fees.port_fee_per_docking;
      if (profit > 0) rough.push({ dest, g, qty, score: profit / hours });
    }
  }
  rough.sort((a, b) => b.score - a.score);
  const out: RouteOption[] = [];
  for (const r of rough.slice(0, limit * 3)) {
    const loaded = s.qty > 0;
    const quoted = e.voyageQuote({ type: "sail", company: c.id, ship: s.id, dest: r.dest,
      ...(loaded ? {} : { buy: { good: GOODS[r.g], qty: r.qty } }) });
    if (!quoted.ok || !("quote" in quoted)) continue;
    const q = quoted.quote;
    // A loaded ship could also sell here now: count that as the cost of carrying the cargo on.
    const profit = loaded ? q.revenue - e.sellValue(s.port, r.g, r.qty) * (1 - tax) - q.fuelCost - q.portFee : q.profit;
    if (profit <= 0 || !q.affordable) continue;
    out.push({ ship: s.id, from: s.port, dest: r.dest, good: loaded ? null : GOODS[r.g], qty: r.qty, hours: q.hours,
      cargoCost: round(q.cargoCost), fuelCost: round(q.fuelCost), portFee: round(q.portFee), revenue: round(q.revenue),
      profit: round(profit), perHour: round(profit / q.hours) });
  }
  return out.sort((a, b) => b.perHour - a.perHour).slice(0, limit);
}

/** Docked ships of a company, at most `max` (keeps the per-update work small). */
export function dockedShips(e: Engine, company: number, max = 6): Ship[] {
  const c = e.companies.get(company);
  if (!c) return [];
  return c.ships.map(id => e.ships.get(id)!).filter(s => s && s.dest === null && !e.voyageQueues.has(s.id)).slice(0, max);
}

/** Ideas 146 + 147: route planner with estimated profit; the client's calculator uses these quotes. */
export const planner: FeatureFactory = (e) => ({
  id: "ui.planner", ideas: [146, 147], title: "Route planner", economy: false,
  view(company) {
    const routes: Record<number, RouteOption[]> = {};
    for (const s of dockedShips(e, company)) routes[s.id] = planRoutes(e, s, 3);
    return { routes };
  },
});

/** Idea 425: the single best trade across your docked ships right now (economy flag: gives players an edge). */
export const bestTrade: FeatureFactory = (e) => ({
  id: "ui.best-trade", ideas: [425], title: "Best trade right now", economy: true,
  view(company) {
    let best: RouteOption | null = null;
    for (const s of dockedShips(e, company)) {
      const [top] = planRoutes(e, s, 1);
      if (top && (!best || top.perHour > best.perHour)) best = top;
    }
    return { best };
  },
});
