// Idea 189: a public stats page. Every 6 game hours the module works out season totals (companies, ships, voyages,
// tonnes delivered, busiest ports, top companies by net worth) and publishes them to every client, including the
// signed-out page /features/community-stats.html. Only company names (already public on the leaderboard) appear.
import type { FeatureFactory } from "../types.js";
import { day, deliveriesSince } from "./shared.js";
import { peek } from "./store.js";

export const STATS_EVERY = 6;

export const statsModule: FeatureFactory = (e) => {
  let tonnes = 0, voyages = 0, lastScan = 0;
  const portCalls = new Map<number, number>();
  let snapshot: unknown = null;
  const refresh = () => {
    const companies = [...e.companies.values()];
    const top = companies.map(c => ({ name: c.name, worth: Math.round(e.netWorth(c)), ships: c.ships.length, badge: peek(e, c.id).equipped.badge ?? null }))
      .sort((a, b) => b.worth - a.worth || a.name.localeCompare(b.name)).slice(0, 10);
    const busiest = [...portCalls].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(([p, n]) => ({ port: e.map.ports[p]?.name ?? `Port ${p}`, calls: n }));
    snapshot = { tick: e.tick, day: day(e), companies: companies.length, ships: [...e.ships.values()].filter(s => s.type !== "pirate").length,
      voyages, tonnes: Math.round(tonnes), busiest, top };
  };
  return {
    id: "community.stats", ideas: [189], title: "Public stats", economy: false,
    enable() { lastScan = e.tick; refresh(); },
    advance() {
      for (const c of e.companies.keys()) for (const t of deliveriesSince(e, c, lastScan)) {
        voyages++; tonnes += t.qty; portCalls.set(t.to, (portCalls.get(t.to) ?? 0) + 1);
      }
      lastScan = e.tick;
      if (e.tick % STATS_EVERY === 0) refresh();
    },
    world() { return snapshot; },
  };
};
