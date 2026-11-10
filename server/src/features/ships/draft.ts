// Ideas 225 and 226: draft limits and port dredging.
// Every port has a depth (shallow, medium or deep), fixed by the map. A ship draws water by hull size: coasters suit
// any port, freighters need medium water, bulkers need deep water. ships.draft shows which of your ships are too deep
// for which ports, and lets companies dredge a port deeper by lending a docked ship to the dredging crew for a day
// (yard time, not money; DREDGE_DAYS ship-days per step). What a too-deep ship suffers is in ships.draft-effects,
// an economy module (off until approved): it waits outside for the tide.
import type { Ship } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import { action, fail, hullSize, note, OK, ownShip, portName, shipField, shipName } from "./shared.js";

export const DEPTH_TEXT = ["shallow", "medium", "deep"];
export const DREDGE_DAYS = 3, DREDGE_HOURS = 24, TIDE_WAIT_HOURS = 6;

/** The map's own depth for a port: a stable hash of its position, about 25% shallow, 45% medium, 30% deep. */
export function baseDepth(p: { x: number; y: number }, i: number): number {
  let h = (Math.round(p.x) * 73856093) ^ (Math.round(p.y) * 19349663) ^ (i * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  const r = (h >>> 0) % 100;
  return r < 25 ? 0 : r < 70 ? 1 : 2;
}

export interface DraftApi { depth(port: number): number; tooDeep(ship: number, port: number): boolean }

export const draft: FeatureFactory = (e) => {
  const id = "ships.draft";
  const dredged = new Map<number, number>();                       // port -> depth steps added
  const progress = new Map<number, number>();                     // port -> ship-days towards the next step
  const crews = new Map<number, { port: number; until: number; company: number }>();   // ship -> dredging job
  const depth = (port: number) => Math.min(2, baseDepth(e.map.ports[port], port) + (dredged.get(port) ?? 0));
  const tooDeep = (ship: number, port: number) => { const s = e.ships.get(ship); return !!s && s.type !== "pirate" && hullSize(s.type) > depth(port); };

  const mod: FeatureModule & DraftApi = {
    id, ideas: [225, 226], title: "Draft limits and dredging", economy: false,
    depth, tooDeep,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (cmd.action === "dredge") {
        if (s.dest !== null) return fail("the ship must be in port");
        if (crews.has(s.id)) return fail("the ship is already dredging");
        if (depth(s.port) >= 2) return fail("this port is already deep water");
        crews.set(s.id, { port: s.port, until: e.tick + DREDGE_HOURS, company: cmd.company });
        note(e, s.id, `Lent to the dredging crew at ${portName(e, s.port)} for a day.`);
        return OK;
      }
      if (cmd.action === "stopDredging") {
        if (!crews.delete(s.id)) return fail("the ship is not dredging");
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const [ship, job] of crews) {
        const s = e.ships.get(ship);
        if (!s || s.dest !== null || s.port !== job.port) { crews.delete(ship); if (s) note(e, ship, "Left the dredging work unfinished."); continue; }
        if (e.tick < job.until) continue;
        crews.delete(ship);
        if (depth(job.port) >= 2) continue;
        const done = (progress.get(job.port) ?? 0) + 1;
        if (done >= DREDGE_DAYS) {
          progress.delete(job.port);
          dredged.set(job.port, (dredged.get(job.port) ?? 0) + 1);
          note(e, ship, `Dredging finished: ${portName(e, job.port)} is now ${DEPTH_TEXT[depth(job.port)]} water.`);
        } else {
          progress.set(job.port, done);
          note(e, ship, `A day's dredging done at ${portName(e, job.port)} (${done}/${DREDGE_DAYS} towards the next depth).`);
        }
      }
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type !== "pirate");
      if (!ships.length) return [];
      const lines = ships.filter(s => hullSize(s.type) > 0).map(s => {
        const shallow = e.map.ports.map((_, i) => i).filter(i => tooDeep(s.id, i));
        return `${shipName(e, s.id)} (${s.type}) is too deep for ${shallow.length} port${shallow.length === 1 ? "" : "s"}${shallow.length && shallow.length <= 6 ? `: ${shallow.map(i => portName(e, i)).join(", ")}` : ""}.`;
      });
      const here = ships.filter(s => s.dest === null && !crews.has(s.id) && depth(s.port) < 2);
      const waits = e.features.enabled("ships.draft-effects") ? ` A ship too deep for its destination waits ${TIDE_WAIT_HOURS} hours outside for high tide.` : "";
      return [{ title: "Draft limits and dredging",
        detail: `Ports are shallow, medium or deep. Freighters need medium water and bulkers deep water.${waits} Lend a docked ship to the dredging crew for a day; ${DREDGE_DAYS} ship-days deepen a port one step for everyone.`
          + (lines.length ? `\n${lines.join("\n")}` : ""),
        actions: [
          ...(here.length ? [{ ...action(id, "Lend a ship to the dredgers", "dredge"), fields: [shipField(e, here)] }] : []),
          ...ships.filter(s => crews.has(s.id)).map(s => action(id, `Stop dredging (${shipName(e, s.id)})`, "stopDredging", { ship: s.id })),
        ] }];
    },
    world() { return e.map.ports.map((_, i) => depth(i)); },
  };
  return mod;
};

export const draftEffects: FeatureFactory = (e) => ({
  id: "ships.draft-effects", ideas: [225], title: "Waiting for the tide", economy: true,
  adjust: {
    travelHours: (h, ctx) => {
      const d = e.features.enabled("ships.draft") ? e.features.modules.get("ships.draft") as unknown as DraftApi : undefined;
      return d?.tooDeep(ctx.ship, ctx.dest) ? h + TIDE_WAIT_HOURS : h;
    },
  },
  cards: () => [{ title: "Waiting for the tide", detail: `A ship too deep for its destination waits ${TIDE_WAIT_HOURS} hours outside for high tide.` }],
});
