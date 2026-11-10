// art.mystery, art.rivals and art.legend: story arcs. Rewards are titles and story, never money, so all three are
// content modules. Writing lives in config/content/art/quests.json.
import type { FeatureFactory } from "../types.js";
import { content, fill, hash, portName, shipWatcher } from "./shared.js";

interface Quests {
  mystery: { title: string; intro: string; chapters: string[]; end: string; title_award: string };
  rivals: Record<"spotted" | "chasing" | "overtook" | "holding" | "lost" | "top", string>;
  legend: { ship: string; intro: string; chart: string; ready: string; found: string; title_award: string };
}

/** A port for step `n` of a company's story that isn't `avoid`: deterministic, so replays agree. */
function storyPort(nPorts: number, company: number, salt: number, n: number, avoid: number[]): number {
  let p = hash(company, salt, n) % nPorts;
  for (let i = 0; i < nPorts && avoid.includes(p); i++) p = (p + 1) % nPorts;
  return p;
}

// ------------------------------------------------------------ the lost-cargo mystery (476)
export const mystery: FeatureFactory = (e) => {
  const Q = content<Quests>("quests").mystery;
  const watch = shipWatcher(e);
  const progress = new Map<number, { chapter: number; port: number; done: boolean }>();
  return {
    id: "art.mystery", ideas: [476], title: Q.title, economy: false,
    enable() { watch.reset(); },
    apply(cmd) {
      if (cmd.action !== "start") return { ok: false, error: "unknown mystery action" };
      const c = e.companies.get(cmd.company);
      if (!c) return { ok: false, error: "no such company" };
      if (progress.has(c.id)) return { ok: false, error: "you are already on the case" };
      progress.set(c.id, { chapter: 0, port: storyPort(e.map.ports.length, c.id, 476, 0, [c.home]), done: false });
      return { ok: true };
    },
    advance() {
      for (const a of watch.step().arrivals) {
        const p = progress.get(a.owner);
        if (!p || p.done || a.port !== p.port) continue;
        p.chapter++;
        if (p.chapter >= Q.chapters.length) p.done = true;
        else p.port = storyPort(e.map.ports.length, a.owner, 476, p.chapter, [a.port]);
      }
    },
    cards(company) {
      const p = progress.get(company);
      if (!p) return [{ title: Q.title, detail: Q.intro, actions: [{ label: "Take the case", command: { type: "feature", module: "art.mystery", action: "start" } }] }];
      if (p.done) return [{ title: `${Q.title}: solved`, detail: Q.end, actions: [] }];
      return [{ title: `${Q.title}: chapter ${p.chapter + 1} of ${Q.chapters.length}`, detail: fill(Q.chapters[p.chapter], { port: portName(e, p.port) }), actions: [] }];
    },
    view(company) {
      const p = progress.get(company);
      return p ? { chapter: p.chapter, port: p.port, done: p.done, title: p.done ? Q.title_award : null } : { chapter: -1 };
    },
  };
};

// ------------------------------------------------------------ rival story arcs (477)
export const RIVAL_EVERY = 6;
type Beat = keyof Quests["rivals"];
export const rivals: FeatureFactory = (e) => {
  const Q = content<Quests>("quests").rivals;
  const state = new Map<number, { rival: number; ahead: boolean; beats: { tick: number; beat: Beat; rival: string }[] }>();
  return {
    id: "art.rivals", ideas: [477], title: "Rival story arcs", economy: false,
    enable() { state.clear(); },
    advance() {
      if (e.tick % RIVAL_EVERY !== 0 || e.companies.size < 2) return;
      const ranked = [...e.companies.values()].sort((a, b) => e.netWorth(b) - e.netWorth(a) || a.id - b.id);
      ranked.forEach((c, i) => {
        const top = i === 0;
        const rival = top ? ranked[1] : ranked[i - 1];
        const was = state.get(c.id);
        let beat: Beat | null = null;
        if (!was || was.rival !== rival.id) beat = top ? "top" : "spotted";
        else if (was.ahead && !top) beat = "lost";
        else if (!was.ahead && top) beat = "overtook";
        else if (e.tick % (RIVAL_EVERY * 4) === 0) beat = top ? "holding" : "chasing";
        const beats = was?.beats ?? [];
        if (beat) beats.push({ tick: e.tick, beat, rival: rival.name });
        state.set(c.id, { rival: rival.id, ahead: top, beats: beats.slice(-6) });
      });
    },
    view(company) {
      const s = state.get(company);
      if (!s) return { rival: null, story: [] };
      return { rival: s.rival, ahead: s.ahead, story: s.beats.map(b => ({ tick: b.tick, beat: b.beat, text: fill(Q[b.beat], { rival: b.rival }) })).reverse() };
    },
  };
};

// ------------------------------------------------------------ the legendary ship quest (478)
export const CHART_PIECES = 3;
export const SIGHTING_HOURS = 12;
export const SIGHTING_CHANCE = 0.05;
export const legend: FeatureFactory = (e) => {
  const Q = content<Quests>("quests").legend;
  const watch = shipWatcher(e);
  const hunts = new Map<number, { ports: number[]; have: number[]; found: boolean }>();
  let sighting: { port: number; until: number } | null = null;
  return {
    id: "art.legend", ideas: [478], title: `The ${Q.ship.replace(/^The /, "")}`, economy: false,
    enable() { watch.reset(); sighting = null; },
    apply(cmd) {
      if (cmd.action !== "start") return { ok: false, error: "unknown legend action" };
      const c = e.companies.get(cmd.company);
      if (!c) return { ok: false, error: "no such company" };
      if (hunts.has(c.id)) return { ok: false, error: "you already hold the chart" };
      const ports: number[] = [];
      for (let i = 0; i < CHART_PIECES; i++) ports.push(storyPort(e.map.ports.length, c.id, 478, i, [c.home, ...ports]));
      hunts.set(c.id, { ports, have: [], found: false });
      return { ok: true };
    },
    advance() {
      for (const a of watch.step().arrivals) {
        const h = hunts.get(a.owner);
        if (h && h.ports.includes(a.port) && !h.have.includes(a.port)) h.have.push(a.port);
      }
      if (sighting && sighting.until <= e.tick) sighting = null;
      if (!sighting && e.features.random() < SIGHTING_CHANCE)
        sighting = { port: Math.floor(e.features.random() * e.map.ports.length), until: e.tick + SIGHTING_HOURS };
      if (!sighting) return;
      // Anyone with a whole chart and a ship docked where she haunts sees her.
      for (const [c, h] of hunts) {
        if (h.found || h.have.length < CHART_PIECES) continue;
        const co = e.companies.get(c);
        if (co?.ships.some(id => { const s = e.ships.get(id); return s && s.dest === null && s.port === sighting!.port; })) h.found = true;
      }
    },
    world() { return { sighting: sighting ? { port: sighting.port, hours: sighting.until - e.tick } : null }; },
    cards(company) {
      const h = hunts.get(company);
      if (!h) return [{ title: Q.ship, detail: Q.intro, actions: [{ label: "Seek the chart", command: { type: "feature", module: "art.legend", action: "start" } }] }];
      if (h.found) return [{ title: `${Q.ship}: found`, detail: Q.found, actions: [] }];
      if (h.have.length >= CHART_PIECES) {
        const s = sighting ? ` She was last seen at ${portName(e, sighting.port)}, for ${sighting.until - e.tick} more hours.` : " No sightings yet.";
        return [{ title: `${Q.ship}: the chart is whole`, detail: Q.ready + s, actions: [] }];
      }
      const next = h.ports.filter(p => !h.have.includes(p)).map(p => fill(Q.chart, { port: portName(e, p) })).join(" ");
      return [{ title: `${Q.ship}: ${h.have.length} of ${CHART_PIECES} chart pieces`, detail: next, actions: [] }];
    },
    view(company) {
      const h = hunts.get(company);
      return h ? { ports: h.ports, have: h.have, found: h.found, title: h.found ? Q.title_award : null } : { ports: [] };
    },
  };
};
