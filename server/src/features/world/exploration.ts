import type { Engine } from "../../engine.js";
import type { Pt } from "../../geo.js";
import type { FeatureFactory } from "../types.js";
import { emergeTick, newIsland } from "./disasters.js";
import { action, addNews, alongside, companyName, CONTENT, fail, fleet, hash, isInt, ownShip, passedNear, regionOf, regions, seaPoint, shipField } from "./shared.js";

export const WRECKS = 6, ISLANDS = 4, MAP_CHANCE = 0.35, ISLAND_SIGHT = 45;

export const wreckSites = (e: Engine) => Array.from({ length: WRECKS }, (_, i) => ({ id: i, ...seaPoint(e, 700 + i, 0.3, 0.7) }));
export const digSites = (e: Engine) => Array.from({ length: WRECKS }, (_, i) => ({ id: i, ...seaPoint(e, 900 + i, 0.15, 0.85) }));
/** Uncharted islands lie just off a lane: anyone sailing that lane sees them. Positions are never sent until found. */
export const islands = (e: Engine): (Pt & { id: number })[] => Array.from({ length: ISLANDS }, (_, i) => ({ id: i, ...seaPoint(e, 800 + i, 0.2, 0.8) }));
const ISLAND_NAMES = ["Gull Rock", "Mistcay", "Lantern Isle", "Hollow Key", "Saltmarsh Holm", "Driftwood Atoll"];
export const islandName = (i: number) => ISLAND_NAMES[(Math.floor(hash(811) * ISLAND_NAMES.length) + i) % ISLAND_NAMES.length];

/** Ideas 105, 106 and 107: shipwreck sites to explore for relics, treasure maps found in the wrecks that lead to a
 *  dig site with a trophy, and uncharted islands found by sailing close. Collectibles only, no money. */
export const exploration: FeatureFactory = (e) => {
  const id = "world.exploration";
  const relics = new Map<number, { wreck: number; relic: string }[]>();     // company -> finds
  const maps = new Map<number, number[]>();                                  // company -> dig sites it holds a map for
  const trophies = new Map<number, string[]>();
  const found = new Map<number, { company: number; tick: number }>();       // island -> first finder
  const visited = new Map<number, Set<number>>();                           // company -> islands it has seen
  addNews(e, id, () => [...found].map(([i, f]) => ({ tick: f.tick, kind: "discovery", text: `${companyName(e, f.company)} charted an unknown island: ${islandName(i)}.` })));
  return {
    id, ideas: [105, 106, 107], title: "Exploration", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships");
      if (cmd.action === "explore") {
        if (!isInt(cmd.wreck, 0, WRECKS - 1)) return fail("unknown wreck");
        const site = wreckSites(e)[cmd.wreck];
        if (!alongside(e, s, site)) return fail("sail alongside the wreck first");
        const mine = relics.get(cmd.company) ?? [];
        if (mine.some(r => r.wreck === cmd.wreck)) return fail("your divers have already searched this wreck");
        const relic = CONTENT.relics[Math.floor(e.features.random() * CONTENT.relics.length)];
        mine.push({ wreck: cmd.wreck, relic }); relics.set(cmd.company, mine);
        if (e.features.random() < MAP_CHANCE) { const m = maps.get(cmd.company) ?? []; if (!m.includes(cmd.wreck)) m.push(cmd.wreck); maps.set(cmd.company, m); }
        return { ok: true };
      }
      if (cmd.action === "dig") {
        const held = maps.get(cmd.company) ?? [];
        if (!isInt(cmd.map, 0, WRECKS - 1) || !held.includes(cmd.map)) return fail("you hold no such treasure map");
        if (!alongside(e, s, digSites(e)[cmd.map])) return fail("the X on the map is somewhere else");
        maps.set(cmd.company, held.filter(m => m !== cmd.map));
        const t = trophies.get(cmd.company) ?? [];
        t.push(CONTENT.trophies[Math.floor(hash(907, cmd.map, cmd.company) * CONTENT.trophies.length)]);
        trophies.set(cmd.company, t);
        return { ok: true };
      }
      return fail("unknown action");
    },
    advance() {
      const all = islands(e);
      for (const s of e.ships.values()) {
        for (const isl of all) {
          if (!passedNear(e, s, isl, ISLAND_SIGHT)) continue;
          const v = visited.get(s.owner) ?? new Set<number>();
          v.add(isl.id); visited.set(s.owner, v);
          if (!found.has(isl.id)) found.set(isl.id, { company: s.owner, tick: e.tick });
        }
      }
    },
    world() {
      const all = islands(e);
      return {
        wrecks: wreckSites(e),
        islands: [...found].map(([i, f]) => ({ ...all[i], name: islandName(i), by: companyName(e, f.company), tick: f.tick, region: regions(e)[regionOf(e, all[i])]?.name })),
      };
    },
    view(company) {
      const held = maps.get(company) ?? [];
      return { relics: relics.get(company) ?? [], maps: held.map(m => ({ map: m, ...digSites(e)[m] })), trophies: trophies.get(company) ?? [], islands: [...(visited.get(company) ?? [])] };
    },
    cards(company) {
      const field = shipField(e, company, s => s.dest !== null);
      const sites = wreckSites(e), near = fleet(e, company).flatMap(s => sites.filter(w => alongside(e, s, w)).map(w => ({ s, w })));
      const cards = [{ title: "Shipwrecks", detail: `${WRECKS} wrecks are marked on the chart. Sail alongside one and send the divers down. Relics found: ${(relics.get(company) ?? []).length}.`,
        actions: near.slice(0, 3).map(n => action(id, `Dive on wreck ${n.w.id + 1} with ship ${n.s.id}`, "explore", { ship: n.s.id, wreck: n.w.id })) }];
      const held = maps.get(company) ?? [];
      if (held.length) cards.push({ title: "Treasure maps", detail: `You hold ${held.length} map${held.length > 1 ? "s" : ""}. The X is drawn on your chart; bring a ship to it and dig.`,
        actions: field ? held.map(m => action(id, `Dig at X ${m + 1}`, "dig", { map: m }, field)) : [] });
      return cards;
    },
  };
};

export const DISCOVERY_BONUS = 1500;
/** Idea 258 (economy, off): the first company to sight each uncharted island (or the new volcanic island) is paid a bounty by the Admiralty. */
export const discoveryBonus: FeatureFactory = (e) => {
  const paid = new Map<string, number>();   // site -> company
  const sites = () => [...islands(e).map(i => ({ key: `island-${i.id}`, x: i.x, y: i.y })),
    ...(e.tick >= emergeTick(e) ? [{ key: "new-island", ...newIsland(e) }] : [])];
  return {
    id: "world.discovery-bonus", ideas: [258], title: "First-discovery bounty", economy: true,
    advance() {
      for (const site of sites()) {
        if (paid.has(site.key)) continue;
        const s = [...e.ships.values()].find(x => x.type !== "pirate" && passedNear(e, x, site, ISLAND_SIGHT));
        const c = s && e.companies.get(s.owner);
        if (c) { c.cash += DISCOVERY_BONUS; paid.set(site.key, c.id); }
      }
    },
    view: (company) => ({ bounties: [...paid.values()].filter(c => c === company).length }),
    cards: (company) => [{ title: "Admiralty bounty", detail: `The first company to sight an uncharted island is paid ${DISCOVERY_BONUS}. ${sites().length - paid.size} still unclaimed; you have claimed ${[...paid.values()].filter(c => c === company).length}.` }],
  };
};
