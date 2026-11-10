// Analytics: economy health, wealth inequality, churn risk, route heatmaps, aggregate telemetry and the hourly
// AI-readable report. All of it is observation once per game hour: nothing here changes money, cargo or prices.
// Player-facing data is aggregate (no company ids) except a company's own view; per-company detail is admin-only.
import { GOODS, type Engine } from "../../engine.js";
import { gini, isHouseBot, median, noteCompanies, ageHours, round, type PlatformFactory } from "./shared.js";

const pushCapped = <T>(list: T[], item: T, cap: number) => { list.push(item); if (list.length > cap) list.splice(0, list.length - cap); };

export interface HealthSample {
  tick: number; score: number; gini: number; medianWorth: number; moneySupply: number;
  inDebt: number; atBand: number; activeShare: number; companies: number;
}

/** Share of (port, good) prices sitting at their floor or ceiling: a market pinned to its limits is unhealthy. */
export function bandPressure(e: Engine): number {
  let pinned = 0, all = 0;
  for (let p = 0; p < e.n; p++) GOODS.forEach((good, g) => {
    const band = e.rules.commodities[good], price = e.price(p, g), span = Math.max(1e-9, band.ceiling - band.floor);
    all++;
    if (price - band.floor < span * 0.02 || band.ceiling - price < span * 0.02) pinned++;
  });
  return all ? pinned / all : 0;
}

/**
 * Economy health score, 0 (broken) to 100 (healthy), from four parts worth 25 each:
 * equality (1 - Gini of player net worth), solvency (share of companies not in debt), market (share of prices away
 * from their band limits) and activity (share of player companies that did something in the last 24 hours).
 */
export function healthScore(parts: { gini: number; inDebtShare: number; atBand: number; activeShare: number }): number {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return Math.round(25 * clamp(1 - parts.gini) + 25 * clamp(1 - parts.inDebtShare) + 25 * clamp(1 - parts.atBand) + 25 * clamp(parts.activeShare));
}

/** Per-engine record of when each company last did something visible (sailed, traded, ordered, bought a ship). */
const LAST_ACTIVE = new WeakMap<Engine, { last: Map<number, number>; seen: Map<number, string> }>();
function activity(e: Engine) {
  let a = LAST_ACTIVE.get(e);
  if (!a) LAST_ACTIVE.set(e, a = { last: new Map(), seen: new Map() });
  return a;
}
/** Call once per hour from advance(): stamps companies whose fleet, orders or cash changed since last hour. */
function noteActivity(e: Engine) {
  const a = activity(e);   // idempotent within a tick, so several modules may call it
  const ordersBy = new Map<number, number[]>();
  for (const o of e.orders.values()) (ordersBy.get(o.owner) ?? ordersBy.set(o.owner, []).get(o.owner)!).push(o.id * 7 + Math.round(o.qty));
  for (const c of e.companies.values()) {
    // Cash is left out: daily upkeep moves everyone's cash. Fleet moves, cargo sold or bought and orders count.
    const sig = JSON.stringify([c.ships.map(id => { const s = e.ships.get(id); return s ? [s.id, s.dest, s.departTick, Math.round(s.qty)] : 0; }), ordersBy.get(c.id) ?? []]);
    if (a.seen.get(c.id) !== sig) { a.last.set(c.id, e.tick); a.seen.set(c.id, sig); }
  }
}
export function idleHours(e: Engine, company: number): number {
  const t = activity(e).last.get(company);
  return t === undefined ? 0 : e.tick - t;
}

/** 196, 578, 579, 585: economy health score, Gini tracker and the data behind the balance dashboard. */
export const economyHealth: PlatformFactory = (e) => {
  const history: HealthSample[] = [];
  const sample = () => {
    noteCompanies(e); noteActivity(e);
    const players = [...e.companies.values()].filter(c => !isHouseBot(c));
    const all = [...e.companies.values()];
    const worths = players.map(c => e.netWorth(c));
    const g = gini(worths), atBand = bandPressure(e);
    const inDebt = all.filter(c => c.cash < 0).length;
    const activeShare = players.length ? players.filter(c => idleHours(e, c.id) < 24).length / players.length : 1;
    const s: HealthSample = { tick: e.tick, gini: round(g, 3), medianWorth: Math.round(median(worths)),
      moneySupply: Math.round(all.reduce((a, c) => a + c.cash, 0)), inDebt, atBand: round(atBand, 3),
      activeShare: round(activeShare, 3), companies: all.length,
      score: healthScore({ gini: g, inDebtShare: all.length ? inDebt / all.length : 0, atBand, activeShare }) };
    if (history.at(-1)?.tick === e.tick) history.pop();
    pushCapped(history, s, 24 * 14);
  };
  return {
    id: "platform.economy-health", ideas: [196, 578, 579, 585], title: "Economy health", economy: false,
    enable: sample, advance: sample,
    world: () => {
      const last = history.at(-1);
      return last ? { score: last.score, gini: last.gini, medianWorth: last.medianWorth,
        trend: history.filter(h => e.tick - h.tick < 24).map(h => h.score) } : null;
    },
    admin: () => ({ history, report: balanceReport(history) }),
  };
};

/** Plain-text balance report over a health history (also used by sim/personas.ts). */
export function balanceReport(history: HealthSample[]): string[] {
  const real = history.filter(h => h.companies > 0);
  if (!real.length) return ["no samples yet"];
  const first = real[0], last = real.at(-1)!;
  const lines = [
    `Health ${last.score}/100 (was ${first.score} at tick ${first.tick}).`,
    `Wealth inequality (Gini) ${last.gini} (was ${first.gini}); median player worth ${last.medianWorth}.`,
    `Money supply ${last.moneySupply} (${last.moneySupply >= first.moneySupply ? "+" : ""}${last.moneySupply - first.moneySupply}).`,
    `${last.inDebt} of ${last.companies} companies in debt; ${Math.round(last.atBand * 100)}% of prices pinned at a limit; ${Math.round(last.activeShare * 100)}% of players active today.`,
  ];
  if (last.gini > 0.6) lines.push("Warning: wealth is very concentrated (Gini over 0.6).");
  if (last.atBand > 0.3) lines.push("Warning: many prices sit at their floor or ceiling; supply or demand may be mistuned.");
  if (last.inDebt > last.companies * 0.2) lines.push("Warning: over a fifth of companies are in debt.");
  return lines;
}

/** 577: churn prediction. Risk from idle hours and a falling net worth; players see a welcome-back summary. */
export const churn: PlatformFactory = (e) => {
  const worthAt = new Map<number, number[]>();      // company -> net worth at each of the last 48 hours
  const risk = (id: number): "low" | "medium" | "high" => {
    const idle = idleHours(e, id), w = worthAt.get(id) ?? [];
    const falling = w.length >= 24 && w.at(-1)! < w[w.length - 24] * 0.8;
    if (idle >= 48 || (idle >= 24 && falling)) return "high";
    if (idle >= 12 || falling) return "medium";
    return "low";
  };
  const step = () => {
    noteCompanies(e); noteActivity(e);
    for (const c of e.companies.values()) { const l = worthAt.get(c.id) ?? []; pushCapped(l, Math.round(e.netWorth(c)), 48); worthAt.set(c.id, l); }
  };
  return {
    id: "platform.churn", ideas: [577], title: "Welcome back", economy: false,
    enable: step, advance: step,
    view: (company) => {
      const idle = idleHours(e, company), w = worthAt.get(company) ?? [];
      return { idleHours: idle, welcomeBack: idle >= 12 ? { worthThen: w[Math.max(0, w.length - 1 - idle)] ?? null, worthNow: w.at(-1) ?? null } : null };
    },
    world: () => {
      const players = [...e.companies.values()].filter(c => !isHouseBot(c) && ageHours(e, c.id) >= 24);
      return { atRisk: players.filter(c => risk(c.id) === "high").length, players: players.length };
    },
    admin: () => ({ high: [...e.companies.values()].filter(c => !isHouseBot(c) && risk(c.id) !== "low")
      .map(c => ({ id: c.id, name: c.name, risk: risk(c.id), idle: idleHours(e, c.id) })) }),
  };
};

/** 580: route heatmap. Counts departures on each port pair over the last week (aggregate, no company ids). */
export const routeHeatmap: PlatformFactory = (e) => {
  let departs = new Map<number, number>();
  const voyages: { tick: number; a: number; b: number }[] = [];
  const snap = () => { departs = new Map([...e.ships.values()].map(s => [s.id, s.departTick])); };
  return {
    id: "platform.route-heatmap", ideas: [580], title: "Route heatmap", economy: false,
    enable: snap,
    advance() {
      for (const s of e.ships.values())
        if (s.dest !== null && departs.get(s.id) !== s.departTick && s.type !== "pirate") voyages.push({ tick: e.tick, a: s.port, b: s.dest });
      while (voyages.length && e.tick - voyages[0].tick >= 168) voyages.shift();
      snap();
    },
    world: () => {
      const count = new Map<string, number>();
      for (const v of voyages) { const k = v.a < v.b ? `${v.a}-${v.b}` : `${v.b}-${v.a}`; count.set(k, (count.get(k) ?? 0) + 1); }
      return { routes: [...count].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 40)
        .map(([k, n]) => { const [a, b] = k.split("-").map(Number); return { a, b, n }; }) };
    },
  };
};

/** 198: anonymous aggregate telemetry. Hourly totals only: no ids, names or anything that identifies a player. */
export const telemetry: PlatformFactory = (e) => {
  const hours: { tick: number; voyages: number; newOrders: number; newShips: number; companies: number; active: number }[] = [];
  let departs = new Map<number, number>(), orderIds = new Set<number>(), shipCount = 0;
  const snap = () => { departs = new Map([...e.ships.values()].map(s => [s.id, s.departTick])); orderIds = new Set(e.orders.keys()); shipCount = e.ships.size; };
  return {
    id: "platform.telemetry", ideas: [198], title: "Anonymous statistics", economy: false,
    enable: snap,
    advance() {
      noteActivity(e);
      const voyages = [...e.ships.values()].filter(s => s.dest !== null && departs.get(s.id) !== s.departTick).length;
      const newOrders = [...e.orders.keys()].filter(id => !orderIds.has(id)).length;
      const active = [...e.companies.values()].filter(c => idleHours(e, c.id) === 0).length;
      pushCapped(hours, { tick: e.tick, voyages, newOrders, newShips: Math.max(0, e.ships.size - shipCount), companies: e.companies.size, active }, 168);
      snap();
    },
    world: () => {
      const day = hours.filter(h => e.tick - h.tick < 24);
      const sum = (k: "voyages" | "newOrders" | "newShips") => day.reduce((a, h) => a + h[k], 0);
      return { last24h: { voyages: sum("voyages"), orders: sum("newOrders"), ships: sum("newShips"), peakActive: Math.max(0, ...day.map(h => h.active)) } };
    },
    admin: () => ({ hours }),
  };
};

/** One hourly report in a fixed shape that a language model (or a person) can read without the game open. */
export function aiReport(e: Engine) {
  const players = [...e.companies.values()].filter(c => !isHouseBot(c)), bots = [...e.companies.values()].filter(isHouseBot);
  const worth = (cs: typeof players) => cs.length ? Math.round(cs.reduce((a, c) => a + e.netWorth(c), 0) / cs.length) : 0;
  const prices = GOODS.map((good, g) => {
    const list = Array.from({ length: e.n }, (_, p) => e.price(p, g));
    return { good, min: round(Math.min(...list)), max: round(Math.max(...list)), spread: round(Math.max(...list) - Math.min(...list)) };
  });
  const atSea = [...e.ships.values()].filter(s => s.dest !== null).length;
  const g = gini(players.map(c => e.netWorth(c)));
  return {
    format: "manifest-bot-report/1", tick: e.tick, day: Math.floor(e.tick / 24) + 1,
    companies: { players: players.length, houseBots: bots.length, inDebt: [...e.companies.values()].filter(c => c.cash < 0).length },
    averageWorth: { players: worth(players), houseBots: worth(bots) },
    gini: round(g, 3), ships: { total: e.ships.size, atSea },
    widestSpreads: [...prices].sort((a, b) => b.spread - a.spread).slice(0, 3),
    pinnedPrices: round(bandPressure(e), 3),
    summary: `Day ${Math.floor(e.tick / 24) + 1}, hour ${e.tick % 24}: ${players.length} players and ${bots.length} house bots; `
      + `${atSea} of ${e.ships.size} ships at sea; Gini ${round(g, 2)}; players average ${worth(players)} vs bots ${worth(bots)}.`,
  };
}

/** 583: hourly AI-readable bot reports (last 48 kept for the admin console; sim/personas.ts writes them to a file). */
export const botReports: PlatformFactory = (e) => {
  const reports: ReturnType<typeof aiReport>[] = [];
  return {
    id: "platform.bot-reports", ideas: [583], title: "Hourly reports", economy: false,
    advance() { pushCapped(reports, aiReport(e), 48); },
    admin: () => ({ latest: reports.at(-1) ?? aiReport(e), reports }),
  };
};
