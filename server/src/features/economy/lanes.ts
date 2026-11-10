// Lane and border economics: tariffs between island groups (8), embargoes (213), a currency per island group (206),
// toll gates on busy lanes (214), dynamic freight rates (201), a backhaul bonus (202), cheaper empty legs (203) and
// new-route subsidies (209). All change fees, fuel or payouts, so all are economy modules and ship off.
import { GOODS, type Trip } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { credits, day, dockedShips, laneKey, laneTraffic, Notes, portName, REGION_NAMES, regions, round2, TripWatcher } from "./util.js";

// ------------------------------------------------------------ 8: tariffs between island groups

export const TARIFF_RATE = 0.05;
export const tariffs: FeatureFactory = (e) => ({
  id: "economy.tariffs", ideas: [8], title: "Island tariffs", economy: true,
  adjust: {
    portFee: (fee, ctx) => {
      const s = e.ships.get(ctx.ship), r = regions(e);
      if (!s || s.qty <= 0 || r[ctx.from] === r[ctx.dest]) return fee;
      return fee + s.cost * TARIFF_RATE;
    },
  },
  world() { return { regions: regions(e), names: REGION_NAMES, rate: TARIFF_RATE }; },
  cards() { return [{ title: "Island tariffs", detail: `Cargo landed in a different island group pays ${TARIFF_RATE * 100}% of its cost as a tariff with the port fee.` }]; },
});

// ------------------------------------------------------------ 213: trade embargoes

export const EMBARGO_FINE = 0.3;
export const embargoes: FeatureFactory = (e) => {
  let current: { a: number; b: number; until: number } | null = null;
  const notes = new Notes();
  const blocked = (from: number, dest: number) => {
    if (!current || e.tick >= current.until) return false;
    const r = regions(e), x = r[from], y = r[dest];
    return (x === current.a && y === current.b) || (x === current.b && y === current.a);
  };
  return {
    id: "economy.embargoes", ideas: [213], title: "Trade embargoes", economy: true,
    set(a: number, b: number, days: number) { current = { a, b, until: e.tick + days * 24 }; },
    advance() {
      if (current && e.tick >= current.until) current = null;
      if (e.tick % (24 * 7) === 1 && !current && e.features.random() < 0.5) {
        const a = Math.floor(e.features.random() * 4), b = (a + 1 + Math.floor(e.features.random() * 3)) % 4;
        current = { a, b, until: e.tick + 24 * 7 };
      }
    },
    adjust: {
      portFee: (fee, ctx) => {
        const s = e.ships.get(ctx.ship);
        if (!s || s.qty <= 0 || !blocked(ctx.from, ctx.dest)) return fee;
        // Arrival (ship already in dest) is when the fine is really charged; leave a note then.
        if (s.dest === null && s.port === ctx.dest) notes.add(s.owner, `Ship #${s.id} ran the embargo into ${portName(e, ctx.dest)} and was fined.`);
        return fee + s.cost * EMBARGO_FINE;
      },
    },
    world() { return current ? { a: current.a, b: current.b, until: current.until, text: `Embargo between ${REGION_NAMES[current.a]} and ${REGION_NAMES[current.b]} until day ${Math.floor(current.until / 24) + 1}` } : {}; },
    cards(company) {
      if (!current && !notes.of(company).length) return [];
      return [{ title: "Trade embargo", detail: [current ? `No cargo may move between the ${REGION_NAMES[current.a]} and the ${REGION_NAMES[current.b]} until day ${Math.floor(current.until / 24) + 1}. Ships that try are fined ${EMBARGO_FINE * 100}% of the cargo's cost.` : "No embargo in force.", ...notes.of(company).slice(-2)].join("\n") }];
    },
  } as ReturnType<FeatureFactory> & { set(a: number, b: number, days: number): void };
};

// ------------------------------------------------------------ 206: currencies per island group

export const CURRENCY_NAMES = ["Nor-mark", "East crown", "Sou-thaler", "Reef dollar"];
export const currencies: FeatureFactory = (e) => {
  const rates = [1, 1, 1, 1];
  return {
    id: "economy.currencies", ideas: [206], title: "Island currencies", economy: true,
    rates,
    advance() {
      if (e.tick % 24 !== 0) return;
      for (let i = 0; i < 4; i++) rates[i] = round2(Math.min(1.25, Math.max(0.8, rates[i] * (1 + (e.features.random() - 0.5) * 0.06) + (1 - rates[i]) * 0.1)));
    },
    adjust: {
      // Changing money costs a fee: selling into a weak currency, or buying with a strong one.
      tradeTax: (tax, ctx) => {
        const rate = rates[regions(e)[ctx.port]];
        if (ctx.side === "sell" && rate < 1) return tax + (1 - rate) * 0.5;
        if (ctx.side === "buy" && rate > 1) return tax + (rate - 1) * 0.5;
        return tax;
      },
    },
    world() { return { names: CURRENCY_NAMES, rates }; },
    cards() { return [{ title: "Island currencies", detail: `Each island group trades in its own money. Selling where the money is weak, or buying where it is strong, costs an exchange fee.\n${CURRENCY_NAMES.map((n, i) => `${n} (${REGION_NAMES[i]}): ${rates[i].toFixed(2)}`).join("\n")}` }]; },
  } as ReturnType<FeatureFactory> & { rates: number[] };
};

// ------------------------------------------------------------ 214: toll gates on busy lanes

export const TOLL = 150;
export const tolls: FeatureFactory = (e) => {
  let gated: string[] = [];
  let collected = 0;
  const refresh = () => {
    gated = [...laneTraffic(e)].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([k]) => k);
  };
  return {
    id: "economy.tolls", ideas: [214], title: "Toll gates", economy: true,
    enable() { refresh(); },
    advance() { if (e.tick % 24 === 0) refresh(); },
    adjust: {
      portFee: (fee, ctx) => {
        if (!gated.includes(laneKey(ctx.from, ctx.dest))) return fee;
        const s = e.ships.get(ctx.ship);
        const toll = TOLL * (s ? e.spec(s.type).capacity / e.spec("freighter").capacity : 1);
        if (s && s.dest === null && s.port === ctx.dest) collected += toll;
        return fee + toll;
      },
    },
    world() { return { lanes: gated, collected: Math.round(collected) }; },
    cards() {
      return [{ title: "Toll gates", detail: gated.length ? `Tolls (${TOLL} cr per freighter-size ship) on the busiest lanes today: ${gated.map(k => k.split("-").map(p => portName(e, Number(p))).join(" to ")).join("; ")}.` : "No lane is busy enough for a toll today." }];
    },
  };
};

// ------------------------------------------------------------ 201: dynamic freight rates per lane

/** Rate 1.3 on an empty lane, falling 0.1 per ship already on it, never below 0.6. A laden arrival is paid (or
 *  charged) qty x distance/100 x (rate - 1) x 0.5 with the port fee. */
export const freightRate = (traffic: number) => Math.max(0.6, 1.3 - 0.1 * traffic);
export const freightRates: FeatureFactory = (e) => ({
  id: "economy.freight-rates", ideas: [201], title: "Freight rates", economy: true,
  adjust: {
    portFee: (fee, ctx) => {
      const s = e.ships.get(ctx.ship);
      if (!s || s.qty <= 0 || !Number.isFinite(e.dist[ctx.from][ctx.dest])) return fee;
      const rate = freightRate(laneTraffic(e).get(laneKey(ctx.from, ctx.dest)) ?? 0);
      return fee - s.qty * e.dist[ctx.from][ctx.dest] / 100 * (rate - 1) * 0.5;
    },
  },
  cards(company) {
    const ships = dockedShips(e, company);
    if (!ships.length) return [];
    const traffic = laneTraffic(e);
    const busiest = [...traffic].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k.split("-").map(p => portName(e, Number(p))).join(" to ")} (${n} ships, rate ${freightRate(n).toFixed(1)})`);
    return [{ title: "Freight rates", detail: `Quiet lanes pay a freight bonus on arrival; crowded lanes cost extra. Empty lane: rate 1.3; each ship already sailing it takes 0.1 off.\n${busiest.length ? `Busiest: ${busiest.join("; ")}` : "Every lane is quiet."}` }];
  },
});

// ------------------------------------------------------------ 202: backhaul bonus

export const BACKHAUL_BONUS = 0.05;
export const backhaul: FeatureFactory = (e) => {
  const watcher = new TripWatcher();
  const lastTrip = new Map<number, Trip>();   // ship -> last finished laden trip
  const paid = new Map<number, number>();
  return {
    id: "economy.backhaul", ideas: [202], title: "Backhaul bonus", economy: true,
    enable() { watcher.prime(e); },
    advance() {
      for (const { company, trip } of watcher.scan(e).closed) {
        if (trip.good === null || trip.qty <= 0) continue;
        const prev = lastTrip.get(trip.ship);
        lastTrip.set(trip.ship, trip);
        if (!prev || prev.to !== trip.from || prev.from !== trip.to || !(trip.earned > 0)) continue;
        const bonus = trip.earned * BACKHAUL_BONUS, c = e.companies.get(company);
        if (!c) continue;
        c.cash += bonus;
        paid.set(company, (paid.get(company) ?? 0) + bonus);
      }
      for (const ship of [...lastTrip.keys()]) if (!e.ships.has(ship)) lastTrip.delete(ship);
    },
    view(company) { return { paid: Math.round(paid.get(company) ?? 0) }; },
    cards(company) { return [{ title: "Backhaul bonus", detail: `Bring a paying cargo back on the lane you just came down and earn ${BACKHAUL_BONUS * 100}% extra on the return sale.\nBonuses so far: ${credits(paid.get(company) ?? 0)}.` }]; },
  };
};

// ------------------------------------------------------------ 203: visible cost of empty legs

export const BALLAST_FUEL = 0.85;
export const emptyLegs: FeatureFactory = (e) => ({
  id: "economy.empty-legs", ideas: [203], title: "Empty legs", economy: true,
  adjust: { fuel: (f, ctx) => (e.ships.get(ctx.ship)?.qty ?? 1) > 0 ? f : f * BALLAST_FUEL },
  view(company) {
    return dockedShips(e, company).map(s => {
      const c = e.companies.get(company)!, fuel = e.fuelNeeded(s.port, c.home, s.type) * BALLAST_FUEL;
      return { ship: s.id, home: c.home, fuel: round2(fuel), cost: Math.round(fuel * e.price(s.port, GOODS.indexOf("fuel"))) };
    });
  },
  cards(company) {
    const c = e.companies.get(company);
    const ships = dockedShips(e, company).filter(s => c && s.port !== c.home);
    if (!c || !ships.length) return [];
    const lines = ships.map(s => {
      const fuel = e.fuelNeeded(s.port, c.home, s.type) * BALLAST_FUEL;
      return `#${s.id}: sailing home empty from ${portName(e, s.port)} burns ${fuel.toFixed(1)} t of fuel (about ${credits(fuel * e.price(s.port, GOODS.indexOf("fuel")))}).`;
    });
    return [{ title: "Empty legs", detail: [`An empty ship rides high and burns ${Math.round((1 - BALLAST_FUEL) * 100)}% less fuel, but it still costs money. Look for a return cargo.`, ...lines].join("\n") }];
  },
});

// ------------------------------------------------------------ 209: subsidies for opening new routes

export const subsidyFor = (distance: number) => Math.min(3000, Math.round(distance * 2));
export const subsidies: FeatureFactory = (e) => {
  const watcher = new TripWatcher();
  const opened = new Map<string, { company: number; day: number }>();
  const notes = new Notes();
  return {
    id: "economy.subsidies", ideas: [209], title: "New-route subsidies", economy: true,
    enable() {
      for (const list of e.trips.values()) for (const t of list) if (!t.open && t.good !== null && t.qty > 0) opened.set(laneKey(t.from, t.to), { company: -1, day: -1 });
      watcher.prime(e);
    },
    advance() {
      for (const { company, trip } of watcher.scan(e).closed) {
        if (trip.good === null || trip.qty <= 0 || trip.from === trip.to) continue;
        const key = laneKey(trip.from, trip.to);
        if (opened.has(key)) continue;
        opened.set(key, { company, day: day(e) });
        const amount = subsidyFor(e.dist[trip.from][trip.to]), c = e.companies.get(company);
        if (!c || !Number.isFinite(amount)) continue;
        c.cash += amount;
        notes.add(company, `Opened the ${portName(e, trip.from)} to ${portName(e, trip.to)} trade: ${credits(amount)} subsidy.`);
      }
    },
    world() { return { opened: opened.size }; },
    cards(company) { return [{ title: "New-route subsidies", detail: [`The first company to deliver a cargo on a lane nobody has traded this season gets a subsidy (2 cr per unit of distance, up to 3,000). ${opened.size} lanes opened so far.`, ...notes.of(company).slice(-3)].join("\n") }]; },
  };
};
