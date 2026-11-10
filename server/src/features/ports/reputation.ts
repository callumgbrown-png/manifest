import { GOODS, type Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { addRep, arrivals, content, crewPerk, portName, shared, tierOf } from "./shared.js";

/** A port's specialisation: its first produced good, else its first consumed good. */
export function specialisation(e: Engine, port: number) {
  const p = e.map.ports[port];
  const good = p.produces[0] ?? p.consumes[0];
  return { good: good ? GOODS.indexOf(good) : -1, label: p.produces[0] ? content.hubs[p.produces[0]] : content.hubs.none };
}

/** 51 per-player port reputation, 52 port specialisations. */
export const reputation: FeatureFactory = (e) => ({
  id: "ports.reputation", ideas: [51, 52], title: "Port standing", economy: false,
  advance() {
    for (const s of arrivals(e)) {
      const p = e.map.ports[s.port], good = s.good === null ? null : GOODS[s.good];
      let points = 1;
      if (good && s.qty > 0 && p.consumes.includes(good)) points += 2;
      if (s.good !== null && s.qty > 0 && specialisation(e, s.port).good === s.good) points += 1;
      if (crewPerk(e, s.id) === "rep") points += 1;
      addRep(e, s.owner, s.port, points);
    }
  },
  cards(company) {
    const top = [...(shared(e).rep.get(company) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return [{ title: "Your standing in ports", detail: top.length
      ? top.map(([p, n]) => `${portName(e, p)}: ${tierOf(n)} (${n})`).join(" | ")
      : "Dock at ports to become known. Deliveries a port needs, and its speciality, count extra." }];
  },
  view(company) {
    return { rep: [...(shared(e).rep.get(company) ?? [])].map(([port, points]) => ({ port, points, tier: tierOf(points) })) };
  },
  world() { return { hubs: e.map.ports.map(p => specialisation(e, p.id).label) }; },
});
