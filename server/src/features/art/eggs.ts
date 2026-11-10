// art.eggs and art.cameo: small delights. Shout a word into the fog and something might answer; and a developer's
// cameo ship wanders the lanes saying silly things. Neither touches cargo, money or travel.
import type { FeatureFactory } from "../types.js";
import { content, portName } from "./shared.js";

interface Eggs { eggs: { word: string; text: string }[]; cameo: { name: string; lines: string[] } }
export const SHOUT_MAX = 30;

export const eggs: FeatureFactory = (e) => {
  const E = content<Eggs>("eggs");
  const found = new Map<number, string[]>();
  const last = new Map<number, string>();
  return {
    id: "art.eggs", ideas: [479], title: "Easter eggs", economy: false,
    apply(cmd) {
      if (cmd.action !== "shout") return { ok: false, error: "unknown action" };
      if (!e.companies.has(cmd.company)) return { ok: false, error: "no such company" };
      const w = cmd.word;
      if (typeof w !== "string" || w.length < 1 || w.length > SHOUT_MAX || !/^[a-zA-Z ]+$/.test(w)) return { ok: false, error: `shout up to ${SHOUT_MAX} letters and spaces` };
      const word = w.trim().toLowerCase().replace(/\s+/g, " ");
      const egg = E.eggs.find(x => x.word === word);
      if (!egg) { last.set(cmd.company, "The fog swallows your words."); return { ok: true }; }
      const list = found.get(cmd.company) ?? [];
      if (!list.includes(egg.word)) list.push(egg.word);
      found.set(cmd.company, list);
      last.set(cmd.company, egg.text);
      return { ok: true };
    },
    cards(company) {
      return [{ title: "Shout into the fog", detail: `${last.get(company) ?? "Some words carry further than others."} (Use the fog box in the Sea stories panel.)`, actions: [] }];
    },
    view(company) { return { found: found.get(company)?.length ?? 0, total: E.eggs.length, last: last.get(company) ?? null }; },
  };
};

export const cameo: FeatureFactory = (e) => {
  const E = content<Eggs>("eggs").cameo;
  let at = 0, dest: number | null = null, depart = 0, arrive = 0, line = 0;
  const neighbours = (p: number) => e.map.routes.filter(r => r.a === p || r.b === p).map(r => (r.a === p ? r.b : r.a));
  return {
    id: "art.cameo", ideas: [480], title: "A developer cameo ship", economy: false,
    enable() { at = 0; dest = null; depart = arrive = e.tick; line = 0; },
    advance() {
      if (dest !== null && e.tick >= arrive) { at = dest; dest = null; line = (line + 1) % E.lines.length; depart = e.tick; arrive = e.tick + 3; return; }
      if (dest === null && e.tick >= arrive) {
        const next = neighbours(at);
        if (!next.length) return;
        dest = next[Math.floor(e.features.random() * next.length)];
        depart = e.tick;
        arrive = e.tick + Math.max(4, Math.round(Math.hypot(e.map.ports[dest].x - e.map.ports[at].x, e.map.ports[dest].y - e.map.ports[at].y) / 25));
      }
    },
    world() { return { name: E.name, port: at, dest, departTick: depart, arriveTick: arrive, line: E.lines[line], near: portName(e, dest ?? at) }; },
  };
};
