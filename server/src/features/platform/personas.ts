// 571-576: simulator personas. Each persona is a playing policy with its own goal; sim/personas.ts runs them
// against the house bots to test balance. In the live game the same five styles describe how players actually
// play: the module sorts each company into the persona its behaviour is closest to (aggregate counts are public,
// each company sees only its own style). Nothing here changes money or cargo.
import { GOODS, type Command, type Engine, type Result } from "../../engine.js";
import { runBots } from "../../bots.js";
import { runPirate } from "../../piratebots.js";
import { isHouseBot, noteCompanies, type PlatformFactory } from "./shared.js";

export type PersonaId = "min-maxer" | "explorer" | "pirate" | "social" | "casual";

export interface Persona {
  id: PersonaId; idea: number; goal: string;
  /** Hours between check-ins. */
  every: number;
  /** One decision pass for a company, issuing commands through `commit` (so a simulation's log replays). */
  act(e: Engine, company: number, commit: (c: Command) => Result, memory: Map<string, number>): void;
}

const reachable = (e: Engine, from: number) => Array.from({ length: e.n }, (_, i) => i).filter(i => i !== from && Number.isFinite(e.dist[from][i]));

export const PERSONAS: Persona[] = [
  { id: "min-maxer", idea: 572, goal: "Highest net worth: perfect price knowledge, checks in every hour, takes every profitable trip.", every: 1,
    act: (e, id, commit) => runBots(e, [id], commit, { minProfit: 0, error: 0 }) },
  { id: "explorer", idea: 573, goal: "Visit every port: sails to the port it has seen least, carrying whatever pays on the way.", every: 3,
    act: (e, id, commit, memory) => {
      const c = e.companies.get(id);
      if (!c) return;
      for (const sid of c.ships) {
        const s = e.ships.get(sid);
        if (!s || s.dest !== null || s.type === "pirate") continue;
        memory.set(`visit:${s.port}`, (memory.get(`visit:${s.port}`) ?? 0) + 1);
        if (s.qty > 0) { commit({ type: "sell", company: id, ship: sid }); continue; }
        const options = reachable(e, s.port);
        if (!options.length) continue;
        const dest = options.reduce((best, p) => (memory.get(`visit:${p}`) ?? 0) < (memory.get(`visit:${best}`) ?? 0) ? p : best, options[0]);
        // Carry the good with the best price gap to the destination, if any pays.
        let pick = -1, gap = 0;
        GOODS.forEach((_, g) => { const d = e.price(dest, g) - e.price(s.port, g) * 1.1; if (d > gap && e.stock[s.port][g] >= 10) { gap = d; pick = g; } });
        const qty = pick >= 0 ? Math.floor(Math.min(e.spec(s.type).capacity, e.stock[s.port][pick], (c.cash - 1000) / (e.price(s.port, pick) * 1.2))) : 0;
        commit({ type: "sail", company: id, ship: sid, dest, ...(qty >= 10 ? { buy: { good: GOODS[pick], qty } } : {}) });
      }
    } },
  { id: "pirate", idea: 574, goal: "Profit from raiding: buys a pirate ship as soon as it can and raids worthwhile cargo.", every: 1,
    act: (e, id, commit) => { runPirate(e, id, commit); runBots(e, [id], commit, { minProfit: 200, error: 0.2 }); } },
  { id: "social", idea: 575, goal: "Trade with other players: lists cargo and posts buy orders near market price instead of selling to the port.", every: 4,
    act: (e, id, commit) => {
      const c = e.companies.get(id);
      if (!c) return;
      if (![...e.orders.values()].some(o => o.owner === id && o.side === "buy") && c.cash > 4000) {
        const good = e.map.ports[c.home].consumes[0];
        if (good) commit({ type: "placeOrder", company: id, port: c.home, good, qty: 20, price: Math.min(e.rules.commodities[good].ceiling, e.price(c.home, GOODS.indexOf(good)) * 1.02) });
      }
      for (const sid of c.ships) {
        const s = e.ships.get(sid);
        if (s && s.dest === null && s.qty > 0 && s.good !== null && ![...e.orders.values()].some(o => o.owner === id && o.side === "sell" && o.port === s.port)) {
          const band = e.rules.commodities[GOODS[s.good]];
          commit({ type: "placeSell", company: id, ship: sid, qty: Math.floor(s.qty / 2), price: Math.min(band.ceiling, Math.max(band.floor, e.price(s.port, s.good) * 1.05)) });
        }
      }
      runBots(e, [id], commit, { minProfit: 100, error: 0.15 });
    } },
  { id: "casual", idea: 576, goal: "Plays a little: checks in twice a day and makes rough guesses.", every: 12,
    act: (e, id, commit) => runBots(e, [id], commit, { minProfit: 0, error: 0.4 }) },
];

/** Behaviour counters for the live classifier. */
interface Seen { voyages: number; ports: Set<number>; orders: number; raids: number; activeHours: number; hours: number; profitPerVoyage: number }

/** Scores how closely observed behaviour matches each persona (0-1); exported for tests. */
export function classify(s: Seen, totalPorts: number): { style: PersonaId; scores: Record<PersonaId, number> } {
  const voyages = Math.max(1, s.voyages);
  const scores: Record<PersonaId, number> = {
    "min-maxer": Math.min(1, s.activeHours / Math.max(1, s.hours)) * 0.5 + Math.min(1, Math.max(0, s.profitPerVoyage) / 3000) * 0.5,
    explorer: Math.min(1, s.ports.size / Math.max(1, Math.min(totalPorts, 12))),
    pirate: Math.min(1, s.raids / 3),
    social: Math.min(1, s.orders / voyages),
    casual: 1 - Math.min(1, s.activeHours / Math.max(1, s.hours) * 3),
  };
  const order: PersonaId[] = ["pirate", "social", "explorer", "min-maxer", "casual"];
  const style = order.reduce((best, p) => scores[p] > scores[best] + 1e-9 ? p : best, order[0]);
  for (const k of order) scores[k] = Math.round(scores[k] * 100) / 100;
  return { style, scores };
}

/** 571: persona definitions for the simulator, plus 572-576 as live play styles. */
export const personas: PlatformFactory = (e) => {
  const seen = new Map<number, Seen>();
  let departs = new Map<number, number>(), orderIds = new Set<number>(), cash = new Map<number, number>();
  const of = (id: number) => { let s = seen.get(id); if (!s) seen.set(id, s = { voyages: 0, ports: new Set(), orders: 0, raids: 0, activeHours: 0, hours: 0, profitPerVoyage: 0 }); return s; };
  const snap = () => {
    departs = new Map([...e.ships.values()].map(s => [s.id, s.departTick]));
    orderIds = new Set(e.orders.keys());
    cash = new Map([...e.companies.values()].map(c => [c.id, c.cash]));
  };
  return {
    id: "platform.personas", ideas: [571, 572, 573, 574, 575, 576], title: "Play styles", economy: false,
    enable() { noteCompanies(e); snap(); },
    advance() {
      const active = new Set<number>();
      for (const sh of e.ships.values()) {
        const s = of(sh.owner);
        if (sh.dest === null) s.ports.add(sh.port);
        if (sh.dest !== null && departs.has(sh.id) && departs.get(sh.id) !== sh.departTick) {
          s.voyages++; active.add(sh.owner);
        }
      }
      for (const o of e.orders.values()) if (!orderIds.has(o.id)) { of(o.owner).orders++; active.add(o.owner); }
      for (const c of e.companies.values()) {
        const s = of(c.id);
        s.hours++;
        if (active.has(c.id)) s.activeHours++;
        // Pirate ships owned count as raiding intent; profit per voyage is a smoothed cash gain per voyage started.
        s.raids = Math.max(s.raids, c.ships.filter(id => e.ships.get(id)?.type === "pirate").length * 3);
        const gain = c.cash - (cash.get(c.id) ?? c.cash);
        if (active.has(c.id) || gain > 0) s.profitPerVoyage = s.profitPerVoyage * 0.9 + (gain / Math.max(1, s.voyages)) * 0.1 * Math.min(1, s.voyages);
      }
      snap();
    },
    view: (company) => { const s = seen.get(company); return s ? classify(s, e.n) : null; },
    world: () => {
      const counts: Record<string, number> = {};
      for (const c of e.companies.values()) if (!isHouseBot(c) && seen.has(c.id)) { const k = classify(seen.get(c.id)!, e.n).style; counts[k] = (counts[k] ?? 0) + 1; }
      return { styles: counts };
    },
    admin: () => ({ personas: PERSONAS.map(p => ({ id: p.id, idea: p.idea, goal: p.goal, every: p.every })), simulator: "npx tsx ../sim/personas.ts" }),
  };
};
