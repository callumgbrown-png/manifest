// Protection and balance helpers for new and struggling companies. Everything that changes money, fees or fuel is
// economy: true and ships switched off until Dave approves it.
import type { Engine } from "../../engine.js";
import { ageHours, isHouseBot, median, noteCompanies, round, type PlatformFactory } from "./shared.js";

const NEWBIE_HOURS = 72;
const ownerOf = (e: Engine, ship: number) => e.ships.get(ship)?.owner;

/** The home port and every port one route away: a new company's protected waters. */
export function newbieZone(e: Engine, company: number): number[] {
  const home = e.companies.get(company)?.home;
  if (home === undefined) return [];
  const zone = new Set([home]);
  for (const r of e.map.routes) { if (r.a === home) zone.add(r.b); if (r.b === home) zone.add(r.a); }
  return [...zone].sort((a, b) => a - b);
}

/** 567 (economy): newbie protection zones. For their first 72 hours, companies dock free and burn a quarter less
 *  fuel on voyages that start and end inside their zone. */
export const newbieZones: PlatformFactory = (e) => {
  const isNew = (company: number | undefined) => company !== undefined && ageHours(e, company) < NEWBIE_HOURS
    && !isHouseBot(e.companies.get(company)!);
  const inZone = (company: number, ...ports: number[]) => { const z = newbieZone(e, company); return ports.every(p => z.includes(p)); };
  return {
    id: "platform.newbie-zones", ideas: [567], title: "Newbie waters", economy: true,
    enable() { noteCompanies(e); },
    advance() { noteCompanies(e); },
    adjust: {
      portFee: (v, ctx) => isNew(ctx.company) && inZone(ctx.company, ctx.dest) ? 0 : v,
      fuel: (v, ctx) => { const o = ownerOf(e, ctx.ship); return o !== undefined && isNew(o) && inZone(o, ctx.from, ctx.dest) ? v * 0.75 : v; },
    },
    view: (company) => ({ zone: newbieZone(e, company), hoursLeft: Math.max(0, NEWBIE_HOURS - ageHours(e, company)) }),
  };
};

type RaidShield = { cargoRaidProtection: Map<number, number> };

/** 568: pirate protection for low levels. A company in its first 72 hours, or worth under 1.5x the starting cash,
 *  gets raid protection on every ship (renewed each hour). The engine already never full-raids a company's only ship
 *  and keeps the home port's waters safe; this adds cargo-raid protection, which is what hits beginners. */
export const pirateShield: PlatformFactory = (e) => {
  const low = (id: number) => { const c = e.companies.get(id)!;
    return !isHouseBot(c) && (ageHours(e, id) < NEWBIE_HOURS || e.netWorth(c) < e.rules.company.start_cash * 1.5); };
  const shield = () => {
    noteCompanies(e);
    const map = (e.piracy as unknown as RaidShield).cargoRaidProtection;
    if (!(map instanceof Map)) return;
    for (const c of e.companies.values()) if (low(c.id))
      for (const id of c.ships) map.set(id, Math.max(map.get(id) ?? 0, e.tick + 2));
  };
  return {
    id: "platform.pirate-shield", ideas: [568], title: "Beginner raid protection", economy: false,
    enable: shield,
    advance: shield,
    view: (company) => ({ protected: e.companies.has(company) && low(company) }),
  };
};

/** Median net worth of player companies (house bots left out), refreshed hourly by the balance modules. */
function playerWorths(e: Engine) {
  return new Map([...e.companies.values()].filter(c => !isHouseBot(c)).map(c => [c.id, e.netWorth(c)]));
}

/** 569 (economy): catch-up. Companies under half the median player net worth pay half upkeep and half port fees. */
export const catchUp: PlatformFactory = (e) => {
  let behind = new Set<number>();
  const refresh = () => {
    const w = playerWorths(e), m = median([...w.values()]);
    behind = w.size >= 3 ? new Set([...w].filter(([, v]) => v < m * 0.5).map(([id]) => id)) : new Set();
  };
  return {
    id: "platform.catch-up", ideas: [569], title: "Catch-up help", economy: true,
    enable: refresh, advance: refresh,
    adjust: {
      upkeep: (v, ctx) => behind.has(ctx.company) ? v * 0.5 : v,
      portFee: (v, ctx) => behind.has(ctx.company) ? v * 0.5 : v,
    },
    view: (company) => ({ active: behind.has(company) }),
  };
};

/** 570 (economy): limits on runaway wealth. Above 5x the median player net worth, daily upkeep rises by 0.2% of the
 *  excess (at most 5,000 a day). The money leaves the game; nobody receives it. */
export const wealthLimits: PlatformFactory = (e) => {
  let surcharge = new Map<number, number>();
  const refresh = () => {
    const w = playerWorths(e), m = median([...w.values()]);
    surcharge = new Map();
    if (w.size >= 3 && m > 0) for (const [id, v] of w) if (v > m * 5) surcharge.set(id, Math.min(5000, round((v - m * 5) * 0.002)));
  };
  return {
    id: "platform.wealth-limits", ideas: [570], title: "Wealth limits", economy: true,
    enable: refresh, advance: refresh,
    adjust: { upkeep: (v, ctx) => v + (surcharge.get(ctx.company) ?? 0) },
    view: (company) => ({ surcharge: surcharge.get(company) ?? 0 }),
  };
};
