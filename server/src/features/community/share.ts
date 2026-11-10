// Idea 188: "share my fleet". The server sends the company's own snapshot (fleet, worth, voyages, cosmetics);
// community.js draws it as a PNG card the player can download or copy. Nothing about other players is included.
import type { FeatureFactory } from "../types.js";
import { day } from "./shared.js";
import { itemData, peek } from "./store.js";

export const shareModule: FeatureFactory = (e) => ({
  id: "community.share-fleet", ideas: [188], title: "Share my fleet", economy: false,
  view(company) {
    const c = e.companies.get(company);
    if (!c) return undefined;
    const trips = e.trips.get(company) ?? [];
    const done = trips.filter(t => !t.open);
    const ships = c.ships.map(i => e.ships.get(i)).filter(s => !!s).map(s => ({ type: s!.type, atSea: s!.dest !== null }));
    const look = Object.fromEntries(Object.entries(peek(e, company).equipped).map(([slot, item]) => [slot, itemData(item!)]));
    return {
      name: c.name, day: day(e), seasonDays: Math.ceil(e.seasonHours / 24), home: e.map.ports[c.home]?.name ?? "",
      worth: Math.round(e.netWorth(c)), ships, recentProfit: Math.round(done.reduce((a, t) => a + t.earned - t.spent, 0)),
      recentVoyages: done.length, look,
    };
  },
});
