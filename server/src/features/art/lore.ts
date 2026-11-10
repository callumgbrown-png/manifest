// art.lore and art.relics: the world's story. The founding story is open to everyone; each island's lore page opens
// the first time one of your ships docks there. Docking also turns up collectable relics and messages in bottles.
// Writing lives in config/content/art/lore.json.
import type { FeatureFactory } from "../types.js";
import { BIOMES, biomeOf, content, fill, hash, pick, portName, shipWatcher } from "./shared.js";

interface Lore {
  founding: { title: string; text: string }[];
  biomes: { id: string; name: string; lines: string[] }[];
  relics: { id: string; name: string; text: string }[];
  bottles: string[];
}
export const lore: FeatureFactory = (e) => {
  const L = content<Lore>("lore");
  const watch = shipWatcher(e);
  const visited = new Map<number, Set<number>>();
  const page = (p: number) => {
    const b = L.biomes.find(x => x.id === BIOMES[biomeOf(e, p)]) ?? L.biomes[0];
    return { port: p, name: portName(e, p), biome: b.name, text: fill(pick(b.lines, hash(p, 471)), { port: portName(e, p) }) };
  };
  const mark = (c: number, p: number) => { const s = visited.get(c) ?? new Set<number>(); s.add(p); visited.set(c, s); };
  return {
    id: "art.lore", ideas: [471, 472], title: "Island lore and the founding story", economy: false,
    enable() { watch.reset(); for (const c of e.companies.values()) mark(c.id, c.home); },
    advance() {
      for (const c of e.companies.values()) if (!visited.has(c.id)) mark(c.id, c.home);
      for (const a of watch.step().arrivals) if (e.companies.has(a.owner)) mark(a.owner, a.port);
    },
    cards(company) {
      const n = visited.get(company)?.size ?? 0;
      return [{ title: "The Manifest's story", detail: `${L.founding.length} founding chapters. Island lore found: ${n} of ${e.map.ports.length} harbours. Dock somewhere new to read its page.`, actions: [] }];
    },
    view(company) {
      const seen = [...(visited.get(company) ?? [])].sort((a, b) => a - b);
      return { founding: L.founding, islands: seen.map(page), total: e.map.ports.length };
    },
  };
};

export const RELIC_CHANCE = 0.08;
export const BOTTLE_CHANCE = 0.06;
export const relics: FeatureFactory = (e) => {
  const L = content<Lore>("lore");
  const watch = shipWatcher(e);
  const found = new Map<number, { relic: string; port: number; tick: number }[]>();
  const bottles = new Map<number, { text: string; port: number; tick: number }[]>();
  return {
    id: "art.relics", ideas: [473], title: "Collectable relics and messages in bottles", economy: false,
    enable() { watch.reset(); },
    advance() {
      for (const a of watch.step().arrivals) {
        if (!e.companies.has(a.owner)) continue;
        const have = found.get(a.owner) ?? [];
        const r = e.features.random();
        const left = L.relics.filter(x => !have.some(h => h.relic === x.id));
        if (r < RELIC_CHANCE && left.length) {
          have.push({ relic: left[Math.floor(e.features.random() * left.length)].id, port: a.port, tick: e.tick });
          found.set(a.owner, have);
        } else if (r < RELIC_CHANCE + BOTTLE_CHANCE) {
          const list = bottles.get(a.owner) ?? [];
          list.push({ text: L.bottles[Math.floor(e.features.random() * L.bottles.length)], port: a.port, tick: e.tick });
          bottles.set(a.owner, list.slice(-10));
        }
      }
    },
    cards(company) {
      const n = found.get(company)?.length ?? 0;
      return [{ title: "Relic cabinet", detail: `${n} of ${L.relics.length} relics found. Dock at harbours to turn up more, and the odd message in a bottle.`, actions: [] }];
    },
    view(company) {
      return {
        relics: (found.get(company) ?? []).map(f => ({ ...L.relics.find(x => x.id === f.relic)!, port: portName(e, f.port), tick: f.tick })),
        bottles: (bottles.get(company) ?? []).map(b => ({ ...b, port: portName(e, b.port) })),
        total: L.relics.length,
      };
    },
  };
};
