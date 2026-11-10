// World events that move prices, money, fees or sailing time. Every module here is economy: true and ships switched off.
import type { Engine } from "../../engine.js";
import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { action, addNews, alongside, clock, companyName, fail, GOODS_NAMES, hash, isInt, ownShip, polyNear, portBy, portName, quarterHours,
  regionOf, regions, seaPoint, shipField, slotsBetween, specialDelivery, voyagePoly, type SlotSpec } from "./shared.js";
import { harvestWindow } from "./events.js";

const GRAIN = 0, FUEL = 1, MACHINERY = 3;

// ------------------------------------------------------------ 109, 322, 323, 324, 335 market events

export const SHORTAGE_SPEC: SlotSpec = { period: 200, duration: 48, salt: 1801, chance: 0.5, offset: 24 };
export const BOOM_SPEC: SlotSpec = { period: 300, duration: 72, salt: 1802, chance: 0.5, offset: 120 };
export const STRIKE_SPEC: SlotSpec = { period: 250, duration: 36, salt: 1803, chance: 0.5, offset: 60 };
export const SHORTAGE_STOCK = 0.6, BOOM_STOCK = 1.4, STRIKE_STOCK = 0.5, HARVEST_STOCK = 1.3, SHORTAGE_TAX = 0.15, STRIKE_TAX = 0.1;
export function saleWeek(e: Engine, tick = e.tick) { const starts = quarterHours(e); return { starts, ends: starts + 168, active: tick >= starts && tick < starts + 168 }; }
export function marketEventsAt(e: Engine, tick = e.tick) {
  const one = (spec: SlotSpec) => slotsBetween(spec, tick, tick + 1)[0] ?? null;
  return { shortage: one(SHORTAGE_SPEC), boom: one(BOOM_SPEC), strike: one(STRIKE_SPEC), harvest: harvestWindow(e, tick).active, sale: saleWeek(e, tick).active };
}

/** Ideas 109, 322, 323, 324 and 335: an oil shortage (fuel stocks drain, fuel taxed higher), the harvest festival
 *  (grain floods the farms; grain sells tax-free in the hungry ports), an oil boom (fuel stocks swell), a fuel
 *  strike (stocks halve, fuel taxed higher) and a sale week (no buy tax anywhere). */
export const marketEvents: FeatureFactory = (e) => {
  const id = "world.market-events";
  const scaleStock = (good: number, k: number, ports = e.map.ports.map(p => p.id)) => { for (const p of ports) e.stock[p][good] = Math.max(0, e.stock[p][good] * k); };
  addNews(e, id, () => {
    const now = marketEventsAt(e), out = [];
    if (now.shortage) out.push({ tick: now.shortage.starts, kind: "market", text: `Oil shortage: fuel stocks fall across the sea until ${clock(now.shortage.ends)}.` });
    if (now.boom) out.push({ tick: now.boom.starts, kind: "market", text: "Oil boom! New wells gush and fuel tanks are brimming." });
    if (now.strike) out.push({ tick: now.strike.starts, kind: "market", text: `Refinery workers strike: fuel is scarce until ${clock(now.strike.ends)}.` });
    if (now.sale) out.push({ tick: saleWeek(e).starts, kind: "market", text: "Sale week: no buy tax in any port." });
    return out;
  });
  return {
    id, ideas: [109, 322, 323, 324, 335], title: "Market events", economy: true,
    advance() {
      const now = marketEventsAt(e);
      if (now.shortage?.starts === e.tick) scaleStock(FUEL, SHORTAGE_STOCK);
      if (now.boom?.starts === e.tick) scaleStock(FUEL, BOOM_STOCK);
      if (now.strike?.starts === e.tick) scaleStock(FUEL, STRIKE_STOCK);
      if (harvestWindow(e).starts === e.tick) scaleStock(GRAIN, HARVEST_STOCK, e.map.ports.filter(p => p.produces.includes("grain")).map(p => p.id));
    },
    adjust: {
      tradeTax(v, ctx) {
        const now = marketEventsAt(e);
        if (ctx.side === "buy" && now.sale) return 0;
        if (ctx.side === "sell" && ctx.good === GRAIN && now.harvest && e.map.ports[ctx.port]?.consumes.includes("grain")) return 0;
        if (ctx.side === "buy" && ctx.good === FUEL) return v + (now.shortage ? SHORTAGE_TAX : 0) + (now.strike ? STRIKE_TAX : 0);
        return v;
      },
    },
    world: () => { const n = marketEventsAt(e); return { shortage: !!n.shortage, boom: !!n.boom, strike: !!n.strike, harvest: n.harvest, sale: n.sale }; },
    cards() {
      const n = marketEventsAt(e), lines = [n.shortage && "Oil shortage: fuel taxed higher.", n.boom && "Oil boom: fuel plentiful.", n.strike && "Fuel strike: fuel scarce and taxed higher.",
        n.harvest && "Harvest festival: grain sells tax-free in hungry ports.", n.sale && "Sale week: no buy tax."].filter(Boolean);
      return lines.length ? [{ title: "Market events", detail: lines.join("\n") }] : [];
    },
  };
};

// ------------------------------------------------------------ 330 royal wedding, 337 holiday gifts

export const WEDDING_SPEC: SlotSpec = { period: 400, duration: 96, salt: 1901, chance: 0.7, offset: 150 };
export const WEDDING_TONNES = 300, WEDDING_PREMIUM = 1.5, GIFT_MAX = 20, GIFT_PREMIUM = 1.3, GIFT_BONUS = 150;
export function wedding(e: Engine, tick = e.tick) {
  const s = slotsBetween(WEDDING_SPEC, tick, tick + 1)[0];
  return s ? { index: s.index, port: portBy(e, 1902, s.index), good: hash(1903, s.index) < 0.5 ? MACHINERY : GRAIN, starts: s.starts, ends: s.ends } : null;
}
export function giftWindow(e: Engine, tick = e.tick) { const starts = quarterHours(e) * 3 + 24; return { starts, ends: starts + 96, port: portBy(e, 1904, starts), active: tick >= starts && tick < starts + 96 }; }

/** Ideas 330 and 337: a royal wedding orders 300 t of one good at one port and pays half again over market;
 *  in winter, small holiday gift consignments (up to 20 t) to the gift port pay 30% over market plus a bonus. */
export const megaOrders: FeatureFactory = (e) => {
  const id = "world.mega-orders";
  const filled = new Map<number, number>();     // wedding index -> tonnes delivered
  const gifted = new Set<string>();              // `${company}:${starts}`
  addNews(e, id, () => {
    const w = wedding(e), g = giftWindow(e), out = [];
    if (w) out.push({ tick: w.starts, kind: "market", text: `Royal wedding at ${portName(e, w.port)}: the palace wants ${WEDDING_TONNES} t of ${GOODS_NAMES[w.good]}.` });
    if (g.active) out.push({ tick: g.starts, kind: "market", text: `Holiday gift shipping: small consignments to ${portName(e, g.port)} pay a premium.` });
    return out;
  });
  return {
    id, ideas: [330, 337], title: "Royal wedding and holiday gifts", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!, s = ownShip(e, cmd.company, cmd.ship);
      if (!s || s.dest !== null || s.good === null) return fail("choose one of your docked ships with cargo");
      if (cmd.action === "wedding") {
        const w = wedding(e);
        if (!w || s.port !== w.port || s.good !== w.good) return fail("the palace is not ordering that here");
        const left = WEDDING_TONNES - (filled.get(w.index) ?? 0), qty = Math.min(s.qty, left);
        if (qty < 1) return fail("the palace has all it needs");
        const r = specialDelivery(e, c, s, qty, Math.round(e.sellValue(w.port, w.good, qty) * WEDDING_PREMIUM));
        if (r.ok) filled.set(w.index, (filled.get(w.index) ?? 0) + qty);
        return r;
      }
      if (cmd.action === "gift") {
        const g = giftWindow(e), key = `${cmd.company}:${g.starts}`;
        if (!g.active || s.port !== g.port) return fail("no gifts are wanted here now");
        if (gifted.has(key)) return fail("you have already shipped your holiday gifts");
        if (!isInt(cmd.qty, 1, GIFT_MAX) || cmd.qty > s.qty) return fail(`ship 1 to ${GIFT_MAX} t of gifts`);
        const r = specialDelivery(e, c, s, cmd.qty, Math.round(e.sellValue(s.port, s.good, cmd.qty) * GIFT_PREMIUM) + GIFT_BONUS);
        if (r.ok) gifted.add(key);
        return r;
      }
      return fail("unknown action");
    },
    world: () => { const w = wedding(e), g = giftWindow(e); return { wedding: w ? { ...w, left: WEDDING_TONNES - (filled.get(w.index) ?? 0) } : null, gifts: g.active ? { port: g.port, ends: g.ends } : null }; },
    cards(company): FeatureCard[] {
      const w = wedding(e), g = giftWindow(e), cards: FeatureCard[] = [];
      if (w) {
        const field = shipField(e, company, s => s.dest === null && s.port === w.port && s.good === w.good);
        cards.push({ title: `Royal wedding · ${portName(e, w.port)}`, detail: `The palace pays ${WEDDING_PREMIUM}x market for ${GOODS_NAMES[w.good]}; ${WEDDING_TONNES - (filled.get(w.index) ?? 0)} t still wanted until ${clock(w.ends)}.`,
          actions: field ? [action(id, "Deliver to the palace", "wedding", {}, field)] : [] });
      }
      if (g.active) {
        const field = shipField(e, company, s => s.dest === null && s.port === g.port && s.good !== null);
        cards.push({ title: `Holiday gifts · ${portName(e, g.port)}`, detail: `Up to ${GIFT_MAX} t of any cargo, once per holiday: ${GIFT_PREMIUM}x market plus ${GIFT_BONUS}.`,
          actions: field ? [action(id, "Ship gifts", "gift", {}, [...field, { key: "qty", label: "Tonnes", min: 1, max: GIFT_MAX, value: GIFT_MAX }])] : [] });
      }
      return cards;
    },
  };
};

// ------------------------------------------------------------ 326 pirate king, 331 war between regions

export const WAR_SPEC: SlotSpec = { period: 300, duration: 96, salt: 2001, chance: 0.5, offset: 80 };
export const KING_SPEC: SlotSpec = { period: 350, duration: 96, salt: 2002, chance: 0.5, offset: 200 };
export const WAR_FEE = 1.5, WAR_DELAY = 3, KING_TOLL = 150;
export function war(e: Engine, tick = e.tick) {
  const s = slotsBetween(WAR_SPEC, tick, tick + 1)[0], n = regions(e).length;
  if (!s) return null;
  const a = Math.floor(hash(2003, s.index) * n), b = (a + 1 + Math.floor(hash(2004, s.index) * (n - 1))) % n;
  return { a, b, starts: s.starts, ends: s.ends };
}
export function pirateKing(e: Engine, tick = e.tick) {
  const s = slotsBetween(KING_SPEC, tick, tick + 1)[0];
  return s ? { region: Math.floor(hash(2005, s.index) * regions(e).length), starts: s.starts, ends: s.ends } : null;
}

/** Ideas 326 and 331: a pirate king rises in one sea region and takes a toll from voyages crossing it; two regions go
 *  to war and voyages between them pay half again in port fees and lose hours to blockades. */
export const conflicts: FeatureFactory = (e) => {
  const id = "world.conflicts";
  const atWar = (from: number, dest: number) => {
    const w = war(e); if (!w) return false;
    const ra = regionOf(e, e.map.ports[from]), rb = regionOf(e, e.map.ports[dest]);
    return (ra === w.a && rb === w.b) || (ra === w.b && rb === w.a);
  };
  const crossesKing = (from: number, dest: number) => { const k = pirateKing(e); return !!k && voyagePoly(e, from, dest).points.some(p => regionOf(e, p) === k.region); };
  addNews(e, id, () => {
    const w = war(e), k = pirateKing(e), rs = regions(e), out = [];
    if (w) out.push({ tick: w.starts, kind: "politics", text: `War between ${rs[w.a]?.name} and ${rs[w.b]?.name}. Blockades in force until ${clock(w.ends)}.` });
    if (k) out.push({ tick: k.starts, kind: "politics", text: `A pirate king has risen in ${rs[k.region]?.name} and demands tolls from every passing ship.` });
    return out;
  });
  return {
    id, ideas: [326, 331], title: "Wars and the pirate king", economy: true,
    adjust: {
      portFee: (v, ctx) => (atWar(ctx.from, ctx.dest) ? v * WAR_FEE : v) + (crossesKing(ctx.from, ctx.dest) ? KING_TOLL : 0),
      travelHours: (v, ctx) => atWar(ctx.from, ctx.dest) ? v + WAR_DELAY : v,
    },
    world: () => ({ war: war(e), king: pirateKing(e) }),
    cards() {
      const w = war(e), k = pirateKing(e), rs = regions(e), lines = [];
      if (w) lines.push(`${rs[w.a]?.name} and ${rs[w.b]?.name} are at war: voyages between them pay ${WAR_FEE}x port fees and take ${WAR_DELAY} h longer.`);
      if (k) lines.push(`The pirate king of ${rs[k.region]?.name} takes ${KING_TOLL} from every voyage crossing his waters.`);
      return lines.length ? [{ title: "Troubled waters", detail: lines.join("\n") }] : [];
    },
  };
};

// ------------------------------------------------------------ 339 kraken

export const KRAKEN_SPEC: SlotSpec = { period: 240, duration: 48, salt: 2101, chance: 0.6, offset: 100 };
export const KRAKEN_HP = 100, KRAKEN_PURSE = 3000, KRAKEN_DELAY = 4, KRAKEN_REACH = 50;
/** Idea 339: a world-boss kraken surfaces on a lane. Ships passing it lose hours; captains who come alongside and
 *  fight it share a purse by damage dealt when it sinks. */
export const kraken: FeatureFactory = (e) => {
  const id = "world.kraken";
  const fights = new Map<number, { hp: number; damage: Map<number, number>; lastHit: Map<number, number>; slainBy?: number }>();
  const now = () => { const s = slotsBetween(KRAKEN_SPEC, e.tick, e.tick + 1)[0]; return s ? { index: s.index, ends: s.ends, ...seaPoint(e, 2100 + s.index) } : null; };
  const fight = (i: number) => { let f = fights.get(i); if (!f) { f = { hp: KRAKEN_HP, damage: new Map(), lastHit: new Map() }; fights.set(i, f); } return f; };
  const alive = () => { const k = now(); return k && (fights.get(k.index)?.hp ?? KRAKEN_HP) > 0 ? k : null; };
  addNews(e, id, () => {
    const k = now(); if (!k) return [];
    const f = fights.get(k.index);
    return [{ tick: e.tick - (e.tick % 24), kind: "legend", text: f && f.hp <= 0 ? `The kraken is slain! ${companyName(e, f.slainBy ?? -1)} struck the last blow.` : `The kraken has surfaced in ${regions(e)[regionOf(e, k)]?.name}. All hands!` }];
  });
  return {
    id, ideas: [339], title: "The kraken", economy: true,
    apply(cmd) {
      if (cmd.action !== "fight") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship), k = alive();
      if (!k) return fail("there is no kraken to fight");
      if (!s || !alongside(e, s, k)) return fail("bring a ship alongside the kraken");
      const f = fight(k.index);
      if (f.lastHit.get(s.id) === e.tick) return fail("that crew is still reloading");
      f.lastHit.set(s.id, e.tick);
      const dmg = Math.min(f.hp, 5 + Math.floor(e.features.random() * 10));
      f.hp -= dmg;
      f.damage.set(cmd.company, (f.damage.get(cmd.company) ?? 0) + dmg);
      if (f.hp <= 0) {
        f.slainBy = cmd.company;
        for (const [cid, d] of f.damage) { const c = e.companies.get(cid); if (c) c.cash += Math.round(KRAKEN_PURSE * d / KRAKEN_HP); }
      }
      return { ok: true };
    },
    advance() { const k = now(); for (const i of fights.keys()) if (!k || i < k.index) fights.delete(i); },
    adjust: { travelHours: (v, ctx) => { const k = alive(); return k && polyNear(e, voyagePoly(e, ctx.from, ctx.dest), k, KRAKEN_REACH) ? v + KRAKEN_DELAY : v; } },
    world: () => { const k = now(); return k ? { x: k.x, y: k.y, ends: k.ends, hp: fights.get(k.index)?.hp ?? KRAKEN_HP } : null; },
    view: (company) => { const k = now(); return { damage: k ? fights.get(k.index)?.damage.get(company) ?? 0 : 0 }; },
    cards(company) {
      const k = alive(); if (!k) return [];
      const field = shipField(e, company, s => alongside(e, s, k));
      return [{ title: "The kraken", detail: `${fights.get(k.index)?.hp ?? KRAKEN_HP} of ${KRAKEN_HP} strength left. Voyages passing it take ${KRAKEN_DELAY} h longer. Its slayers share ${KRAKEN_PURSE} by damage dealt.`,
        actions: field ? [action(id, "Fight the kraken", "fight", {}, field)] : [] }];
    },
  };
};

// ------------------------------------------------------------ 340 server-wide cooperative goals

export const GOAL_HOURS = 168, GOAL_TONNES = 500, GOAL_BONUS = 200, GOAL_PER_TONNE = 2;
export const goalOf = (tick: number) => { const week = Math.floor(tick / GOAL_HOURS); return { week, good: week % 4, ends: (week + 1) * GOAL_HOURS }; };
/** Idea 340: each week every company works towards one shared delivery goal. Contributions are bought at market
 *  value; when the goal is met every contributor gets a bonus. */
export const coopGoals: FeatureFactory = (e) => {
  const id = "world.coop-goals";
  let week = -1, total = 0, done = false;
  let given = new Map<number, number>();
  const roll = () => { const g = goalOf(e.tick); if (g.week !== week) { week = g.week; total = 0; done = false; given = new Map(); } return g; };
  addNews(e, id, () => done ? [{ tick: e.tick, kind: "market", text: `Shared goal met: ${GOAL_TONNES} t of ${GOODS_NAMES[goalOf(e.tick).good]} delivered by ${given.size} companies.` }] : []);
  return {
    id, ideas: [340], title: "Shared goals", economy: true,
    apply(cmd) {
      if (cmd.action !== "contribute") return fail("unknown action");
      const g = roll(), c = e.companies.get(cmd.company)!, s = ownShip(e, cmd.company, cmd.ship);
      if (done) return fail("this week's goal is already met");
      if (!s || s.dest !== null || s.good !== g.good) return fail(`dock a ship carrying ${GOODS_NAMES[g.good]}`);
      if (!isInt(cmd.qty, 1, 1e6) || cmd.qty > s.qty) return fail("choose how many tonnes to give");
      const qty = Math.min(cmd.qty, GOAL_TONNES - total);
      const r = specialDelivery(e, c, s, qty, Math.round(e.sellValue(s.port, g.good, qty)));
      if (!r.ok) return r;
      total += qty; given.set(c.id, (given.get(c.id) ?? 0) + qty);
      if (total >= GOAL_TONNES) {
        done = true;
        for (const [cid, t] of given) { const co = e.companies.get(cid); if (co) co.cash += GOAL_BONUS + GOAL_PER_TONNE * t; }
      }
      return r;
    },
    advance() { roll(); },
    world: () => { const g = goalOf(e.tick); return { good: GOODS_NAMES[g.good], tonnes: g.week === week ? total : 0, target: GOAL_TONNES, ends: g.ends, done: g.week === week && done }; },
    view: (company) => ({ given: goalOf(e.tick).week === week ? given.get(company) ?? 0 : 0 }),
    cards(company) {
      const g = goalOf(e.tick), t = g.week === week ? total : 0, field = shipField(e, company, s => s.dest === null && s.good === g.good);
      return [{ title: "Shared goal", detail: `This week: ${GOAL_TONNES} t of ${GOODS_NAMES[g.good]} from all companies together (${t} so far). Contributions sell at market value; when the goal is met every contributor gets ${GOAL_BONUS} plus ${GOAL_PER_TONNE} per tonne.`,
        actions: field && !(g.week === week && done) ? [action(id, "Contribute", "contribute", {}, [...field, { key: "qty", label: "Tonnes", min: 1, max: GOAL_TONNES, value: 50 }])] : [] }];
    },
  };
};
