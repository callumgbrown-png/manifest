// Idea 26: tugs that help big ships dock. Each port has a few tugs a day. A company that books tugs gets one for
// each bulker (or a ship carrying more than its rated hold) arriving while a tug is free. A big ship that docks
// without a tug may scrape the quay: the crew lose heart (ships.crew) and the hull takes a knock (ships.wear, if on).
// Booking is free; the limit is how many tugs a port has.
import type { Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, fail, note, OK, peer, portName, shared, shipName, VoyageWatch } from "./shared.js";

export const TUGS_PER_PORT_DAY = 3, SCRAPE_CHANCE = 0.2, SCRAPE_DAMAGE = 6;

export const tugs: FeatureFactory = (e) => {
  const id = "ships.tugs";
  const booking = new Set<number>();                 // companies that book tugs
  const used = new Map<number, number>();            // port -> tugs used today
  const stats = new Map<number, { assisted: number; scrapes: number }>();
  const watch = new VoyageWatch();
  const big = (s: Ship) => s.type === "bulker" || s.qty > e.spec(s.type).capacity;
  const stat = (c: number) => { let s = stats.get(c); if (!s) stats.set(c, s = { assisted: 0, scrapes: 0 }); return s; };
  return {
    id, ideas: [26], title: "Harbour tugs", economy: false,
    apply(cmd) {
      if (cmd.action === "book") { booking.add(cmd.company); return OK; }
      if (cmd.action === "stop") { booking.delete(cmd.company); return OK; }
      return fail("unknown action");
    },
    advance() {
      if (e.tick % 24 === 0) used.clear();
      watch.step(e, {
        arrive: (s) => {
          if (!big(s) || s.type === "pirate") return;
          const free = (used.get(s.port) ?? 0) < TUGS_PER_PORT_DAY;
          if (booking.has(s.owner) && free) {
            used.set(s.port, (used.get(s.port) ?? 0) + 1);
            stat(s.owner).assisted++;
            note(e, s.id, `A tug nudged the ship alongside at ${portName(e, s.port)}.`);
            return;
          }
          if (e.features.random() >= SCRAPE_CHANCE) return;
          stat(s.owner).scrapes++;
          note(e, s.id, `Scraped the quay at ${portName(e, s.port)} docking ${booking.has(s.owner) ? "after the port's tugs were all busy" : "without a tug"}.`);
          const crew = e.features.enabled("ships.crew") ? shared(e).crew.get(s.id) : undefined;
          if (crew) crew.morale = Math.max(0, crew.morale - 5);
          peer<{ damage(ship: number, points: number, why: string): void }>(e, "ships.wear")?.damage(s.id, SCRAPE_DAMAGE, "a scrape against the quay");
        },
      });
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const st = stats.get(company);
      const bigOnes = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type === "bulker").map(s => shipName(e, s.id));
      return [{ title: "Harbour tugs",
        detail: `Bulkers and overloaded ships are hard to bring alongside: without a tug, one docking in five scrapes the quay. Each port has ${TUGS_PER_PORT_DAY} tugs a day, first come first served; booking is free.`
          + `\nYou ${booking.has(company) ? "book tugs for every big ship" : "do not book tugs"}.${bigOnes.length ? ` Big ships: ${bigOnes.join(", ")}.` : ""}`
          + (st ? `\nThis season: ${st.assisted} tug-assisted dockings, ${st.scrapes} scrapes.` : ""),
        actions: [booking.has(company) ? action(id, "Stop booking tugs", "stop") : action(id, "Book tugs for big ships", "book")] }];
    },
    view(company) { return { booking: booking.has(company), ...(stats.get(company) ?? { assisted: 0, scrapes: 0 }) }; },
  };
};
