import { GOODS, type Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, addRep, arrivals, connected, content, crewPerk, day, fail, hash, nudgeStock, peer } from "./shared.js";

export interface Festival { port: number; name: string; good: number; day: number }

/** Today's festivals: one or two ports, each with a featured good it wants (the same on every server and replay). */
export function festivalsOn(e: Engine, d = day(e)): Festival[] {
  const ports = connected(e);
  if (!ports.length) return [];
  const count = hash(67, d) < 0.4 ? 2 : 1, out: Festival[] = [];
  for (let i = 0; i < count; i++) {
    const port = ports[Math.floor(hash(71, d, i) * ports.length)];
    if (out.some(f => f.port === port)) continue;
    const wants = e.map.ports[port].consumes;
    const good = wants.length ? GOODS.indexOf(wants[Math.floor(hash(73, d, port) * wants.length)]) : Math.floor(hash(79, d, port) * GOODS.length);
    out.push({ port, good, day: d, name: content.festivals[Math.floor(hash(83, d, port) * content.festivals.length)] });
  }
  return out;
}

/** 53 port festivals: a daily festival calendar; arriving with the featured good earns standing (double with a cook
 *  from the tavern), and captains can join the parade. The demand boost itself is in ports.festival-effects. */
export const festivals: FeatureFactory = (e) => {
  const id = "ports.festivals";
  const paraded = new Map<number, number>();              // company -> last festival day they joined
  const guests = new Map<number, number>();               // company -> festival deliveries
  return {
    id, ideas: [53], title: "Port festivals", economy: false,
    apply(cmd) {
      if (cmd.action !== "parade") return fail("unknown action");
      const f = festivalsOn(e).find(x => (e.companies.get(cmd.company)?.ships ?? []).some(sid => { const s = e.ships.get(sid); return s?.dest === null && s.port === x.port; }));
      if (!f) return fail("dock a ship at a festival port");
      if (paraded.get(cmd.company) === f.day) return fail("you joined today's parade already");
      paraded.set(cmd.company, f.day);
      addRep(e, cmd.company, f.port, 3);
      return { ok: true };
    },
    advance() {
      const today = festivalsOn(e);
      for (const s of arrivals(e)) {
        const f = today.find(x => x.port === s.port);
        if (!f || s.good !== f.good || s.qty < 1) continue;
        addRep(e, s.owner, s.port, crewPerk(e, s.id) === "festival" ? 10 : 5);
        guests.set(s.owner, (guests.get(s.owner) ?? 0) + 1);
      }
    },
    cards(company) {
      const today = festivalsOn(e), tomorrow = festivalsOn(e, day(e) + 1);
      const name = (f: Festival) => `${f.name} at ${e.map.ports[f.port].name} (wants ${GOODS[f.good]})`;
      const docked = today.filter(f => (e.companies.get(company)?.ships ?? []).some(sid => { const s = e.ships.get(sid); return s?.dest === null && s.port === f.port; }));
      return [{ title: "Festival calendar", detail: `Today: ${today.map(name).join("; ") || "none"}.\nTomorrow: ${tomorrow.map(name).join("; ") || "none"}.\nArrive with the featured good for +5 standing.`,
        actions: docked.length && paraded.get(company) !== day(e) ? [action(id, "Join the parade", "parade")] : [] }];
    },
    view: (company) => ({ deliveries: guests.get(company) ?? 0, paradedToday: paraded.get(company) === day(e) }),
    world: () => ({ today: festivalsOn(e), tomorrow: festivalsOn(e, day(e) + 1) }),
  };
};

export const FESTIVAL_DEMAND = 0.03;   // share of the good's target stock eaten each festival hour

/** Economy side of 53: festival crowds eat into the featured good's stock, so its price rises for the day. */
export const festivalEffects: FeatureFactory = (e) => ({
  id: "ports.festival-effects", ideas: [53], title: "Festival demand", economy: true,
  advance() {
    if (!peer(e, "ports.festivals")) return;
    for (const f of festivalsOn(e)) nudgeStock(e, f.port, f.good, -e.targets[f.good] * FESTIVAL_DEMAND);
  },
  cards: () => [{ title: "Festival demand", detail: "Festival crowds buy up the featured good, so it sells for more at festival ports all day." }],
});
