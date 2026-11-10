// Idea 234: ghost wrecks. A ship that leaves the game (scrapped, sold off for debt, confiscated, retired) leaves a
// ghostly wreck near where it was last seen for a week. Ships passing close log a sighting. No effect on trade.
import type { FeatureFactory } from "../types.js";
import { note, shipName } from "./shared.js";

export interface Wreck { id: number; name: string; x: number; y: number; until: number; sightings: number }
const WRECK_HOURS = 7 * 24, MAX_WRECKS = 30, SIGHT_RANGE = 30;

export const wrecks: FeatureFactory = (e) => {
  const list: Wreck[] = [];
  const seen = new Map<number, string>();   // ship id -> display name while it exists
  const last = new Map<number, { x: number; y: number }>();
  const sighted = new Set<string>();         // "wreck:ship"
  return {
    id: "ships.wrecks", ideas: [234], title: "Ghost wrecks", economy: false,
    advance() {
      for (const [id, name] of seen) {
        if (e.ships.has(id)) continue;
        const at = last.get(id);
        if (at) {
          const angle = e.features.random() * Math.PI * 2, r = 12 + e.features.random() * 14;
          list.push({ id, name, x: Math.round(at.x + Math.cos(angle) * r), y: Math.round(at.y + Math.sin(angle) * r), until: e.tick + WRECK_HOURS, sightings: 0 });
          if (list.length > MAX_WRECKS) list.shift();
        }
        seen.delete(id); last.delete(id);
      }
      for (const s of e.ships.values()) {
        seen.set(s.id, shipName(e, s.id));
        const p = e.piracy.position(s);
        last.set(s.id, { x: p.x, y: p.y });
      }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].until <= e.tick) list.splice(i, 1);
      for (const w of list) for (const s of e.ships.values()) {
        if (s.dest === null || sighted.has(`${w.id}:${s.id}`)) continue;
        const p = last.get(s.id)!;
        if (Math.hypot(p.x - w.x, p.y - w.y) > SIGHT_RANGE) continue;
        sighted.add(`${w.id}:${s.id}`);
        w.sightings++;
        note(e, s.id, `Lookout sighted the ghostly wreck of the ${w.name}, drifting without a crew.`);
      }
      if (sighted.size > 2000) sighted.clear();
    },
    world() { return list.map(w => ({ id: w.id, name: w.name, x: w.x, y: w.y, until: w.until, sightings: w.sightings })); },
  };
};
