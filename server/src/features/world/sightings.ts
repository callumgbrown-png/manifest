import type { Pt } from "../../geo.js";
import type { FeatureFactory } from "../types.js";
import { addNews, bounds, companyName, passedNear, quarterHours, round1, seaPoint, shipPos } from "./shared.js";

export const MONSTER_CHANCE = 0.003, GHOSTS = 5, GHOST_HOURS = 72;

/** The Halloween window: the last three days of autumn. */
export function ghostWindow(e: Parameters<FeatureFactory>[0]) {
  const q = quarterHours(e), ends = q * 3, starts = Math.max(0, ends - GHOST_HOURS);
  return { starts, ends, active: e.tick >= starts && e.tick < ends };
}
/** Ghost ships drift slowly around a circle centred on a lane point (pure function of the tick). */
export function ghosts(e: Parameters<FeatureFactory>[0], tick = e.tick): (Pt & { id: number })[] {
  const { w } = bounds(e), r = w * 0.03;
  return Array.from({ length: GHOSTS }, (_, i) => {
    const c = seaPoint(e, 1500 + i), a = tick / 9 + i;
    return { id: i, ...round1({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }) };
  });
}

/** Ideas 104 and 336: rare sea-monster sightings (an easter egg in the ship's log and the news) and a Halloween
 *  ghost fleet whose lanterns you collect by sailing close. Pure fun: nothing here touches money or time. */
export const sightings: FeatureFactory = (e) => {
  const id = "world.sightings";
  const seen: { tick: number; ship: number; company: number; x: number; y: number }[] = [];
  const lanterns = new Map<number, Set<number>>();           // company -> ghost ids met this Halloween
  let lanternYear = -1;
  addNews(e, id, () => [
    ...seen.slice(-3).map(s => ({ tick: s.tick, kind: "legend", text: `The crew of ship ${s.ship} (${companyName(e, s.company)}) swear they saw a sea serpent.` })),
    ...(ghostWindow(e).active ? [{ tick: ghostWindow(e).starts, kind: "legend", text: "A ghost fleet has been seen drifting on the lanes. Sail close to collect their lanterns." }] : []),
  ]);
  return {
    id, ideas: [104, 336], title: "Sea legends", economy: false,
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest === null || s.type === "pirate") continue;
        if (e.features.random() < MONSTER_CHANCE) {
          const p = shipPos(e, s);
          seen.push({ tick: e.tick, ship: s.id, company: s.owner, x: Math.round(p.x), y: Math.round(p.y) });
          if (seen.length > 20) seen.shift();
        }
      }
      const win = ghostWindow(e);
      if (!win.active) return;
      if (lanternYear !== win.starts) { lanterns.clear(); lanternYear = win.starts; }
      const gs = ghosts(e);
      for (const s of e.ships.values()) {
        for (const g of gs) if (passedNear(e, s, g, 40)) {
          const got = lanterns.get(s.owner) ?? new Set<number>();
          got.add(g.id); lanterns.set(s.owner, got);
        }
      }
    },
    world: () => ({ sightings: seen.slice(-5), ghosts: ghostWindow(e).active ? ghosts(e) : [] }),
    view: (company) => ({ lanterns: lanterns.get(company)?.size ?? 0, sightings: seen.filter(s => s.company === company).length }),
    cards(company) {
      const win = ghostWindow(e), mine = seen.filter(s => s.company === company).length;
      const lines = [mine ? `Your crews have reported ${mine} sea-monster sighting${mine > 1 ? "s" : ""}.` : "No sea monsters reported by your crews. Yet."];
      if (win.active) lines.push(`Ghost fleet abroad until hour ${win.ends}. Lanterns collected: ${lanterns.get(company)?.size ?? 0} of ${GHOSTS}.`);
      return [{ title: "Sea legends", detail: lines.join("\n") }];
    },
  };
};
