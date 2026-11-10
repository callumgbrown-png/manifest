import { GOODS, type Engine } from "../../engine.js";
import type { FeatureAction, FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import {
  GOOD, addRep, clock, connected, crewPerk, day, exhibit, fail, hasResearch, hash, nudgeStock, ownDocked,
  portName, shared, shipOptions, sites, takeCargo, workShip, type Project,
} from "./shared.js";

const NEED = { lighthouse: 30, reclamation: 60, rail: 40, channel: 50 } as const;
const GOOD_FOR = { lighthouse: GOOD.fuel, reclamation: GOOD.ore, rail: GOOD.machinery, channel: GOOD.machinery } as const;
const NAMES = { lighthouse: "Lighthouse", reclamation: "Land reclamation", rail: "Inland rail link", channel: "Shortcut channel" } as const;

function setup(e: Engine) {
  const projects = shared(e).projects;
  if (projects.size) return;
  const add = (kind: Project["kind"], port: number, maxLevel = 1, port2?: number) => {
    const key = `${kind}:${port}${port2 === undefined ? "" : `-${port2}`}`;
    projects.set(key, { key, kind, port, port2, good: GOOD_FOR[kind], need: NEED[kind], left: NEED[kind], level: 0, maxLevel, contributors: new Map() });
  };
  for (const p of sites(e, 11, 0.25)) add("lighthouse", p);
  for (const p of sites(e, 13, 0.3)) add("reclamation", p, 3);
  const producers = connected(e).filter(p => e.map.ports[p].produces.length);
  for (const p of (producers.length ? producers : connected(e)).filter((p, i) => hash(17, p) < 0.4 || i === 0)) add("rail", p);
  const lanes = e.map.routes.filter(r => Number.isFinite(e.dist[r.a][r.b])).sort((x, y) => hash(19, x.a, x.b) - hash(19, y.a, y.b) || x.a - y.a);
  for (const r of lanes.slice(0, 3)) add("channel", Math.min(r.a, r.b), 1, Math.max(r.a, r.b));
}

const done = (p: Project) => p.level >= p.maxLevel;
const at = (p: Project, port: number) => p.port === port || p.port2 === port;
export const reclamationLevel = (e: Engine, port: number) => shared(e).projects.get(`reclamation:${port}`)?.level ?? 0;
export const litLighthouses = (e: Engine) => [...shared(e).projects.values()].filter(p => p.kind === "lighthouse" && done(p)).map(p => p.port);

type Quest = { port: number; need: number; left: number; due: number; helpers: number[] };

/** 50 lighthouses, 56 shortcut channels, 57 inland rail links, 267 lighthouse keeper quests, 274 land reclamation. */
export const projects: FeatureFactory = (e) => {
  let quest: Quest | undefined;
  const newQuest = () => {
    const towers = [...shared(e).projects.values()].filter(p => p.kind === "lighthouse").map(p => p.port);
    if (!towers.length) return;
    const port = towers[Math.floor(hash(23, day(e)) * towers.length)];
    const need = 5 + Math.floor(hash(29, day(e)) * 11);
    quest = { port, need, left: need, due: e.tick + 36, helpers: [] };
  };
  return {
    id: "ports.projects", ideas: [50, 56, 57, 267, 274], title: "Port projects", economy: false,
    enable() { setup(e); if (!quest) newQuest(); },
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "donate") {
        const p = typeof cmd.project === "string" ? shared(e).projects.get(cmd.project) : undefined;
        if (!p || done(p)) return fail("that project is not taking deliveries");
        const s = workShip(e, c.id, cmd.ship);
        if (!s || !at(p, s.port)) return fail("dock one of your ships at the project's port");
        if (s.good !== p.good || s.qty < 1) return fail(`this project needs ${GOODS[p.good]}`);
        const qty = Math.min(s.qty, p.left);
        takeCargo(e, s, qty);
        p.left -= qty;
        p.contributors.set(c.id, (p.contributors.get(c.id) ?? 0) + qty);
        addRep(e, c.id, s.port, Math.ceil(qty / 2));
        if (!p.left) {
          p.level++;
          const where = p.port2 === undefined ? portName(e, p.port) : `${portName(e, p.port)}–${portName(e, p.port2)}`;
          const top = [...p.contributors].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
          exhibit(e, "project", top[0], `${NAMES[p.kind]} at ${where} completed${p.maxLevel > 1 ? ` (level ${p.level})` : ""}`);
          for (const [who] of p.contributors) addRep(e, who, p.port, 10);
          if (!done(p)) { p.left = p.need; p.contributors.clear(); }
        }
        return { ok: true, sold: qty };
      }
      if (cmd.action === "keeper") {
        if (!quest || e.tick >= quest.due || !quest.left) return fail("the keeper needs nothing right now");
        const s = workShip(e, c.id, cmd.ship, quest.port);
        if (!s || s.good !== GOOD.fuel || s.qty < 1) return fail("dock a ship carrying fuel at the keeper's lighthouse");
        const qty = Math.min(s.qty, quest.left);
        takeCargo(e, s, qty);
        quest.left -= qty;
        if (!quest.helpers.includes(c.id)) quest.helpers.push(c.id);
        addRep(e, c.id, quest.port, 2 + qty);
        if (!quest.left) exhibit(e, "keeper", c.id, `${c.name} kept the lamp burning at ${portName(e, quest.port)}`);
        return { ok: true, sold: qty };
      }
      return fail("unknown project action");
    },
    advance() {
      if (e.tick % 24 === 0 || !quest || (quest.left && e.tick >= quest.due)) newQuest();
    },
    cards(company) {
      const cards: FeatureCard[] = [];
      const ports = new Set((e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)!).filter(s => s.dest === null).map(s => s.port));
      for (const p of shared(e).projects.values()) {
        const where = p.port2 === undefined ? portName(e, p.port) : `${portName(e, p.port)}–${portName(e, p.port2)}`;
        const here = [...ports].find(port => at(p, port));
        if (here === undefined) continue;
        const ships = ownDocked(e, company, here).filter(s => s.good === p.good && s.qty > 0);
        const actions: FeatureAction[] = !done(p) && ships.length ? [{ label: `Donate ${GOODS[p.good]}`,
          command: { type: "feature", module: "ports.projects", action: "donate", project: p.key },
          fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] }] : [];
        cards.push({ title: `${NAMES[p.kind]} · ${where}`, actions, detail: done(p) ? "Complete. Thank you, captains."
          : `Needs ${p.left} more ${GOODS[p.good]}${p.maxLevel > 1 ? ` for level ${p.level + 1} of ${p.maxLevel}` : ""}. Donations earn standing here.` });
      }
      if (quest && quest.left && e.tick < quest.due) {
        const ships = ownDocked(e, company, quest.port).filter(s => s.good === GOOD.fuel && s.qty > 0);
        cards.push({ title: `Lighthouse keeper · ${portName(e, quest.port)}`,
          detail: `The keeper needs ${quest.left} fuel for the lamp by ${clock(quest.due)}. Pays in standing and a museum mention.`,
          actions: ships.length ? [{ label: "Deliver lamp fuel", command: { type: "feature", module: "ports.projects", action: "keeper" },
            fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] }] : [] });
      }
      return cards;
    },
    view(company) {
      const own = e.companies.get(company)?.ships ?? [];
      const lookout = own.some(id => crewPerk(e, id) === "lookout");
      return { sightRange: 1 + (lookout ? 0.25 : 0) + (hasResearch(e, company, "signals") ? 0.5 : 0) };
    },
    world() {
      return {
        projects: [...shared(e).projects.values()].map(p => ({ key: p.key, kind: p.kind, port: p.port, port2: p.port2, good: p.good,
          left: p.left, need: p.need, level: p.level, maxLevel: p.maxLevel })),
        lit: litLighthouses(e), sightRadius: 140 * (e.map.worldScale ?? 1),
        keeper: quest && quest.left && e.tick < quest.due ? { port: quest.port, left: quest.left, due: quest.due } : null,
      };
    },
  };
};

/** Economy side of 56 and 57: finished channels shorten their lane, finished rail links add supply. */
export const projectEffects: FeatureFactory = (e) => ({
  id: "ports.project-effects", ideas: [56, 57], title: "Project effects", economy: true,
  enable() { setup(e); },
  advance() {
    for (const p of shared(e).projects.values()) {
      if (p.kind !== "rail" || !done(p)) continue;
      for (const g of e.map.ports[p.port].produces) nudgeStock(e, p.port, GOODS.indexOf(g), 4);
    }
  },
  adjust: {
    travelHours(v, ctx) {
      const a = Math.min(ctx.from, ctx.dest), b = Math.max(ctx.from, ctx.dest);
      const ch = shared(e).projects.get(`channel:${a}-${b}`);
      return ch && done(ch) ? Math.max(1, Math.round(v * 0.85)) : v;
    },
  },
});
