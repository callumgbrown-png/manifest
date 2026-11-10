// art.scene: the shared clock and sky for every client-side visual effect (features/art-fx.js).
// The server only decides what everyone must see alike: time of day, the calendar season and passing squalls.
// Squalls are purely cosmetic: they change nothing in the economy or travel.
import type { FeatureFactory } from "../types.js";

export interface Squall { id: number; x: number; y: number; r: number; start: number; end: number; strength: 1 | 2 | 3 }
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
const MAX_SQUALLS = 3;

export const scene: FeatureFactory = (e) => {
  let squalls: Squall[] = [];
  let seq = 0;
  /** The world's size factor: archipelago worlds are twice as wide as the original 1000 x 700 map. */
  const K = () => Math.max(1, Math.max(...e.map.ports.map(p => p.x)) / 1000);
  const season = () => Math.min(3, Math.floor((e.tick / Math.max(1, e.seasonHours)) * 4));
  return {
    id: "art.scene",
    ideas: [161, 162, 164, 165, 170, 442, 446, 447, 448, 449, 450, 451, 452, 453, 454, 456, 457, 458],
    title: "Living sea (weather, light and wildlife)",
    economy: false,
    enable() { squalls = []; },
    advance() {
      squalls = squalls.filter(s => s.end > e.tick);
      if (squalls.length >= MAX_SQUALLS || !e.map.routes.length) return;
      // Winter brings more weather; summer less.
      const chance = [0.05, 0.03, 0.07, 0.1][season()];
      if (e.features.random() >= chance) return;
      const route = e.map.routes[Math.floor(e.features.random() * e.map.routes.length)];
      const a = e.map.ports[route.a], b = e.map.ports[route.b], t = 0.3 + e.features.random() * 0.4;
      const strength = (1 + Math.floor(e.features.random() * 3)) as 1 | 2 | 3;
      const hours = 4 + Math.floor(e.features.random() * 7);
      squalls.push({ id: ++seq, x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t),
        r: Math.round((50 + e.features.random() * 70) * K()), start: e.tick, end: e.tick + hours, strength });
    },
    world() {
      const s = season();
      return { hour: e.tick % 24, season: s, seasonName: SEASONS[s], squalls: squalls.map(q => ({ ...q })) };
    },
  };
};
