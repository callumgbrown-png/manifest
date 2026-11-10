// Market modules: price history (2) and the price-index ticker (10) are content and ship on. Steeper demand curves
// (1), saturation (7), rumours (205), price caps (210) and market crashes (220) move port stock (the engine's price
// follows stock), so they are economy modules and ship off.
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, bandPosition, day, fail, ok, portName, priceIndex, round2, shiftStock } from "./util.js";

export const HISTORY_DAYS = 14;

// ------------------------------------------------------------ 2: price history

export const priceHistory: FeatureFactory = (e) => {
  const id = "economy.price-history";
  /** days[d][port][good] = price at the start of that day (rounded to cents). */
  const days: number[][][] = [];
  const snap = () => e.map.ports.map((_, p) => GOODS.map((__, g) => round2(e.price(p, g))));
  const watching = new Map<number, number>();
  return {
    id, ideas: [2], title: "Price history", economy: false,
    enable() { if (!days.length) days.push(snap()); },
    advance() { if (e.tick % 24 === 0) { days.push(snap()); if (days.length > HISTORY_DAYS) days.shift(); } },
    apply(cmd) {
      if (cmd.action !== "watch") return fail("unknown action");
      if (!Number.isInteger(cmd.port) || (cmd.port as number) < 0 || (cmd.port as number) >= e.n) return fail("bad port");
      watching.set(cmd.company, cmd.port as number);
      return ok;
    },
    /** History for the port the company watches (default: its home port) plus the ports its ships are at or heading to. */
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      const ports = new Set<number>([watching.get(company) ?? c.home]);
      for (const i of c.ships) { const s = e.ships.get(i); if (s) ports.add(s.dest ?? s.port); }
      const out: Record<number, number[][]> = {};
      for (const p of [...ports].sort((a, b) => a - b)) out[p] = GOODS.map((_, g) => [...days.map(d => d[p][g]), round2(e.price(p, g))]);
      return { watching: watching.get(company) ?? c.home, ports: out };
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const p = watching.get(company) ?? c.home;
      const lines = GOODS.map((g, gi) => {
        const series = [...days.map(d => d[p][gi]), e.price(p, gi)];
        const first = series[0], last = series[series.length - 1];
        const change = first ? Math.round((last / first - 1) * 100) : 0;
        return `${g}: ${round2(last)} cr (${change >= 0 ? "+" : ""}${change}% over ${series.length - 1} days)`;
      });
      return [{ title: `Price history: ${portName(e, p)}`, detail: lines.join("\n"),
        actions: [action(id, "Watch another port", "watch", {}, [{ key: "port", label: "Port", options: e.map.ports.map(pt => ({ value: pt.id, label: pt.name })), value: p }])] }];
    },
  };
};

// ------------------------------------------------------------ 10: commodity price index ticker

export const priceTicker: FeatureFactory = (e) => {
  const id = "economy.price-ticker";
  const past: number[][] = [];   // index at each of the last 24 hours
  return {
    id, ideas: [10], title: "Commodity index", economy: false,
    enable() { if (!past.length) past.push(priceIndex(e)); },
    advance() { past.push(priceIndex(e)); if (past.length > 25) past.shift(); },
    world() {
      const now = priceIndex(e), then = past[0] ?? now;
      const items = GOODS.map((g, i) => ({ good: g, index: round2(now[i]), change: round2(then[i] ? (now[i] / then[i] - 1) * 100 : 0) }));
      const mover = [...items].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
      return { items, headline: mover && Math.abs(mover.change) >= 1 ? `${mover.good} ${mover.change > 0 ? "up" : "down"} ${Math.abs(mover.change).toFixed(1)}% in a day` : "Markets steady" };
    },
  };
};

// ------------------------------------------------------------ 1: steeper supply-and-demand curves

/** Cheap goods get bought up faster by consumers (up to +60% of normal use); dear goods are used less. */
export const DEMAND_ELASTICITY = 0.6;
export const demandCurves: FeatureFactory = (e) => ({
  id: "economy.demand-curves", ideas: [1], title: "Supply and demand", economy: true,
  advance() {
    const base = e.rules.markets.consumption_per_hour as Record<string, number>;
    for (let p = 0; p < e.n; p++) for (let g = 0; g < GOODS.length; g++) {
      if (!e.map.ports[p].consumes.includes(GOODS[g])) continue;
      const use = (base[GOODS[g]] ?? 0) * e.scale * (e.rules.commodities[GOODS[g]].depth ?? 1);
      // band 0 (cheap) -> extra use; band 1 (dear) -> less use (stock given back).
      shiftStock(e, p, g, -use * DEMAND_ELASTICITY * (0.5 - bandPosition(e, p, g)) * 2);
    }
  },
  world() { return { elasticity: DEMAND_ELASTICITY }; },
});

// ------------------------------------------------------------ 7: market saturation

/** A sale that adds more than 10% of target stock in an hour floods the port: half the excess again is added as a
 *  glut (lower price), which drains away at 5% an hour. */
export const saturation: FeatureFactory = (e) => {
  let glut: number[][] = [];
  let last: number[][] = [];
  return {
    id: "economy.saturation", ideas: [7], title: "Market saturation", economy: true,
    enable() { last = e.stock.map(r => [...r]); if (!glut.length) glut = e.map.ports.map(() => GOODS.map(() => 0)); },
    advance() {
      for (let p = 0; p < e.n; p++) for (let g = 0; g < GOODS.length; g++) {
        const drain = glut[p][g] * 0.05;
        glut[p][g] -= drain;
        shiftStock(e, p, g, -drain);
        const jump = e.stock[p][g] - (last[p]?.[g] ?? e.stock[p][g]) - e.targets[g] * 0.1;
        if (jump > 0) { glut[p][g] += jump * 0.5; shiftStock(e, p, g, jump * 0.5); }
      }
      last = e.stock.map(r => [...r]);
    },
    world() {
      const flooded: { port: number; good: number }[] = [];
      for (let p = 0; p < glut.length; p++) for (let g = 0; g < GOODS.length; g++) if (glut[p][g] > e.targets[g] * 0.05) flooded.push({ port: p, good: g });
      return { flooded };
    },
  };
};

// ------------------------------------------------------------ 205: port rumours that may be false

interface Rumour { port: number; good: number; rise: boolean; true: boolean; until: number; day: number }
export const RUMOUR_TRUTH = 0.6;
export const rumours: FeatureFactory = (e) => {
  const list: Rumour[] = [];
  return {
    id: "economy.rumours", ideas: [205], title: "Port rumours", economy: true,
    advance() {
      if (e.tick % 24 === 6) {
        const port = Math.floor(e.features.random() * e.n), good = Math.floor(e.features.random() * GOODS.length);
        list.push({ port, good, rise: e.features.random() < 0.5, true: e.features.random() < RUMOUR_TRUTH, until: e.tick + 36, day: day(e) });
        if (list.length > 5) list.shift();
      }
      // A true rumour comes true over the next day and a half: stock drains (rise) or piles up (fall).
      for (const r of list) if (r.true && e.tick < r.until) shiftStock(e, r.port, r.good, (r.rise ? -1 : 1) * e.targets[r.good] * 0.02);
    },
    world() { return { rumours: list.map(r => ({ port: r.port, good: r.good, rise: r.rise, day: r.day, text: `Word in ${portName(e, r.port)}: ${GOODS[r.good]} is about to ${r.rise ? "jump" : "slump"}.` })) }; },
    cards() {
      return list.length ? [{ title: "Port rumours", detail: `About ${Math.round(RUMOUR_TRUTH * 100)}% of rumours turn out true.\n` + list.slice(-3).map(r => `Day ${r.day + 1}: in ${portName(e, r.port)}, ${GOODS[r.good]} is said to be about to ${r.rise ? "rise" : "fall"}.`).join("\n") }] : [];
    },
  };
};

// ------------------------------------------------------------ 220: rare market crashes

export const CRASH_CHANCE_PER_DAY = 0.02;
export const crashes: FeatureFactory = (e) => {
  let last: { good: number; day: number } | null = null;
  const crash = (good: number) => {
    for (let p = 0; p < e.n; p++) shiftStock(e, p, good, e.targets[good] * 0.6);
    last = { good, day: day(e) };
  };
  return {
    id: "economy.crashes", ideas: [220], title: "Market crashes", economy: true,
    crash,
    advance() { if (e.tick % 24 === 12 && e.features.random() < CRASH_CHANCE_PER_DAY) crash(Math.floor(e.features.random() * GOODS.length)); },
    world() { return last ? { good: last.good, day: last.day, text: `Crash on day ${last.day + 1}: ${GOODS[last.good]} prices collapsed everywhere.` } : {}; },
  } as ReturnType<FeatureFactory> & { crash(good: number): void };
};

// ------------------------------------------------------------ 210: price caps during emergencies

/** When a good's average price climbs into the top 15% of its band, the harbour authority declares an emergency and
 *  releases stock from a reserve at every port above the cap, until the reserve (one target's worth per good) runs out. */
export const CAP_BAND = 0.85;
export const priceCaps: FeatureFactory = (e) => {
  let reserve: number[] = [];
  const emergency = GOODS.map(() => false);
  return {
    id: "economy.price-caps", ideas: [210], title: "Emergency price caps", economy: true,
    enable() { if (!reserve.length) reserve = GOODS.map((_, g) => e.targets[g] * 4); },
    advance() {
      for (let g = 0; g < GOODS.length; g++) {
        let avg = 0;
        for (let p = 0; p < e.n; p++) avg += bandPosition(e, p, g);
        avg /= e.n;
        emergency[g] = avg >= CAP_BAND;
        reserve[g] = Math.min(e.targets[g] * 4, reserve[g] + e.targets[g] * 0.02);   // refills slowly
        for (let p = 0; p < e.n && reserve[g] > 0 && emergency[g]; p++) {
          if (bandPosition(e, p, g) <= CAP_BAND) continue;
          // Stock at which the price sits exactly at the cap.
          const capStock = 2 * e.targets[g] * (1 - CAP_BAND);
          const need = Math.min(reserve[g], Math.max(0, capStock - e.stock[p][g]));
          shiftStock(e, p, g, need);
          reserve[g] -= need;
        }
      }
    },
    world() { return { emergency: GOODS.filter((_, g) => emergency[g]), reserve: reserve.map(r => Math.round(r)) }; },
    cards() {
      const on = GOODS.filter((_, g) => emergency[g]);
      return on.length ? [{ title: "Emergency price caps", detail: `Emergency declared for ${on.join(", ")}: reserves are being released to hold prices down.` }] : [];
    },
  };
};

