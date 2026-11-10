// Production and cargo handling: seasonal grain harvests (17, 288), depleting mines and wells (18), oil output that
// sets the fuel price (215), cargo quality grades (216), company brands (217), manufacturing contracts (218),
// recycling (219) and grain spoilage (5). All change prices, stock or payouts, so all are economy modules and ship off.
import { GOODS, type Engine, type Trip } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { lotOf, takeLot } from "./specialty.js";
import {
  action, credits, dockedShips, lazy, fail, freeSpace, goodField, isEngineGood, isPort, loadEngineCargo, Notes, ok, ownDocked, pickPorts, portName,
  shiftStock, TripWatcher, unloadEngineCargo, whole,
} from "./util.js";

const GRAIN = 0, FUEL = 1, ORE = 2, MACHINERY = 3;
const baseOutput = (e: Engine, g: number) => (e.rules.markets.production_per_hour as Record<string, number>)[GOODS[g]] * e.scale * (e.rules.commodities[GOODS[g]].depth ?? 1);
const producersOf = (e: Engine, g: number) => e.map.ports.filter(p => p.produces.includes(GOODS[g])).map(p => p.id);
const tripKey = (t: Trip) => `${t.ship}:${t.departTick}`;

// ------------------------------------------------------------ 17 + 288: seasonal grain harvests

export const HARVEST_CYCLE_DAYS = 14;
export const harvestPhase = (tick: number) => {
  const d = Math.floor(tick / 24) % HARVEST_CYCLE_DAYS;
  return d < 4 ? "harvest" : d >= 7 ? "lean" : "growing";
};
export const harvests: FeatureFactory = (e) => ({
  id: "economy.harvests", ideas: [17, 288], title: "Grain harvests", economy: true,
  advance() {
    const phase = harvestPhase(e.tick), out = baseOutput(e, GRAIN);
    const shift = phase === "harvest" ? out * 1.0 : phase === "lean" ? -out * 0.5 : 0;
    if (shift) for (const p of producersOf(e, GRAIN)) shiftStock(e, p, GRAIN, shift);
  },
  world() { return { phase: harvestPhase(e.tick), dayOfCycle: Math.floor(e.tick / 24) % HARVEST_CYCLE_DAYS, cycle: HARVEST_CYCLE_DAYS }; },
  cards() {
    const d = Math.floor(e.tick / 24) % HARVEST_CYCLE_DAYS, phase = harvestPhase(e.tick);
    return [{ title: "Grain harvests", detail: `Grain follows a ${HARVEST_CYCLE_DAYS}-day cycle: four days of harvest (farm ports flooded with grain, cheap), three growing days, then seven lean days (farm output halves).\nNow: ${phase}, day ${d + 1} of the cycle.` }];
  },
});

// ------------------------------------------------------------ 18: mines and wells that deplete

export const DEPLETION_PER_HOUR = 0.001, RESERVE_PER_CREDIT = 1 / 20_000, DIVIDEND_PER_TONNE = 0.05;
export const depletion: FeatureFactory = (e) => {
  const id = "economy.depletion";
  let sites: { port: number; good: number }[] = [];
  const reserve = new Map<string, number>();
  const shares = new Map<string, Map<number, number>>();
  const factor = (r: number) => Math.max(0.2, r);
  return {
    id, ideas: [18], title: "Mines and wells", economy: true,
    enable() {
      if (sites.length) return;
      sites = [...producersOf(e, FUEL).map(p => ({ port: p, good: FUEL })), ...producersOf(e, ORE).map(p => ({ port: p, good: ORE }))];
      for (const s of sites) reserve.set(`${s.port}:${s.good}`, 1);
    },
    apply(cmd) {
      if (cmd.action !== "invest") return fail("unknown action");
      const key = typeof cmd.site === "string" ? cmd.site : isPort(e, cmd.port) && isEngineGood(cmd.good) ? `${cmd.port}:${cmd.good}` : "";
      if (!reserve.has(key)) return fail("choose a mine or well");
      if (!whole(cmd.amount, 1000, 50_000)) return fail("invest 1,000 to 50,000");
      const c = e.companies.get(cmd.company)!;
      if (c.cash < cmd.amount) return fail("not enough cash");
      c.cash -= cmd.amount;
      reserve.set(key, Math.min(1, reserve.get(key)! + cmd.amount * RESERVE_PER_CREDIT));
      const m = shares.get(key) ?? new Map<number, number>();
      m.set(c.id, (m.get(c.id) ?? 0) + cmd.amount);
      shares.set(key, m);
      return ok;
    },
    advance() {
      for (const s of sites) {
        const key = `${s.port}:${s.good}`, r = reserve.get(key)!, out = baseOutput(e, s.good);
        reserve.set(key, Math.max(0, r - DEPLETION_PER_HOUR));
        shiftStock(e, s.port, s.good, -out * (1 - factor(r)));   // the lost output
        const holders = shares.get(key);
        if (!holders) continue;
        const total = [...holders.values()].reduce((a, b) => a + b, 0);
        for (const [cid, n] of holders) { const c = e.companies.get(cid); if (c) c.cash += out * factor(r) * DIVIDEND_PER_TONNE * n / total; }
      }
    },
    world() { return { sites: sites.map(s => ({ ...s, reserve: Math.round(reserve.get(`${s.port}:${s.good}`)! * 100) / 100 })) }; },
    cards(company) {
      const low = sites.filter(s => reserve.get(`${s.port}:${s.good}`)! < 0.8);
      const mine = [...shares].filter(([, m]) => m.has(company)).map(([k]) => { const [p, g] = k.split(":").map(Number); return `${GOODS[g]} at ${portName(e, p)}`; });
      return [{ title: "Mines and wells", detail: [`Oil wells and ore mines run down over the season (output falls to a fifth). Investing refills the reserve (20,000 cr fills it completely) and pays a dividend on output.`,
        ...low.slice(0, 6).map(s => `${GOODS[s.good]} at ${portName(e, s.port)}: ${Math.round(reserve.get(`${s.port}:${s.good}`)! * 100)}% left`), mine.length ? `Your stakes: ${mine.join(", ")}.` : ""].filter(Boolean).join("\n"),
        actions: [action(id, "Invest in a site", "invest", {}, [{ key: "site", label: "Site", options: sites.map(s => ({ value: `${s.port}:${s.good}`, label: `${GOODS[s.good]} at ${portName(e, s.port)}` })), value: sites[0] ? `${sites[0].port}:${sites[0].good}` : "" },
          { key: "amount", label: "Credits", min: 1000, max: 50_000, value: 5000 }])] }];
    },
  };
};

// ------------------------------------------------------------ 215: fuel price tied to oil output

export const oilOutput: FeatureFactory = (e) => {
  let level = 1;
  return {
    id: "economy.oil-output", ideas: [215], title: "Oil output", economy: true,
    advance() {
      if (e.tick % (24 * 7) === 1) level = Math.round(Math.min(1.4, Math.max(0.6, level + (e.features.random() - 0.5) * 0.4)) * 100) / 100;
      const out = baseOutput(e, FUEL) * (level - 1);
      for (const p of producersOf(e, FUEL)) shiftStock(e, p, FUEL, out);
    },
    world() { return { level }; },
    cards() { return [{ title: "Oil output", detail: `The oil fields are pumping at ${Math.round(level * 100)}% this week. Fuel, and so every voyage, gets dearer when output is low and cheaper when it is high. Output changes weekly.` }]; },
  };
};

// ------------------------------------------------------------ 216: cargo quality grades

export const GRADE_EFFECT = { A: 0.08, B: 0, C: -0.08 } as const;
type Grade = keyof typeof GRADE_EFFECT;
export const qualityGrades: FeatureFactory = (e) => {
  const watcher = new TripWatcher();
  const grades = new Map<string, Grade>();
  const openGrades = (company: number) => {
    const out: { ship: number; grade: Grade }[] = [];
    for (const t of e.trips.get(company) ?? []) { const g = grades.get(tripKey(t)); if (t.open && g) out.push({ ship: t.ship, grade: g }); }
    return out;
  };
  return {
    id: "economy.quality-grades", ideas: [216], title: "Cargo grades", economy: true,
    enable() { watcher.prime(e); },
    advance() {
      const { opened, closed } = watcher.scan(e);
      for (const { trip } of opened) if (trip.good !== null && trip.qty > 0) {
        const r = e.features.random();
        grades.set(tripKey(trip), r < 0.25 ? "A" : r < 0.75 ? "B" : "C");
      }
      for (const { company, trip } of closed) {
        const g = grades.get(tripKey(trip));
        grades.delete(tripKey(trip));
        const c = e.companies.get(company);
        if (g && c && trip.earned > 0) c.cash += trip.earned * GRADE_EFFECT[g];
      }
    },
    view(company) { return openGrades(company); },
    cards(company) {
      const v = openGrades(company);
      return [{ title: "Cargo grades", detail: [`Every cargo is graded when it sails: A (a quarter of loads) sells for 8% more, C (a quarter) for 8% less.`, ...v.map(x => `Ship #${x.ship}: grade ${x.grade}`)].join("\n") }];
    },
  };
};

// ------------------------------------------------------------ 217: company-branded goods

export const BRAND_FEE = 5000, BRAND_MAX = 0.1, BRAND_FAME_TONNES = 1500;
export const brandedGoods: FeatureFactory = (e) => {
  const id = "economy.branded-goods";
  const watcher = new TripWatcher();
  const brands = new Map<number, { good: number; rep: number }>();
  return {
    id, ideas: [217], title: "Company brands", economy: true,
    enable() { watcher.prime(e); },
    apply(cmd) {
      if (cmd.action !== "register") return fail("unknown action");
      if (!isEngineGood(cmd.good)) return fail("choose a good");
      if (brands.has(cmd.company)) return fail("you already have a brand");
      const c = e.companies.get(cmd.company)!;
      if (c.cash < BRAND_FEE) return fail("not enough cash");
      c.cash -= BRAND_FEE;
      brands.set(c.id, { good: cmd.good, rep: 0 });
      return ok;
    },
    advance() {
      for (const { company, trip } of watcher.scan(e).closed) {
        const b = brands.get(company), c = e.companies.get(company);
        if (!b || !c || trip.good !== b.good || !(trip.earned > 0)) continue;
        c.cash += trip.earned * BRAND_MAX * b.rep;
        b.rep = Math.min(1, b.rep + trip.qty / BRAND_FAME_TONNES);
      }
    },
    view(company) { const b = brands.get(company); return b ? { good: b.good, reputation: Math.round(b.rep * 100) } : null; },
    world() { return { brands: [...brands].map(([c, b]) => ({ company: c, good: b.good })) }; },
    cards(company) {
      const b = brands.get(company);
      if (b) return [{ title: "Your brand", detail: `Your ${GOODS[b.good]} brand is ${Math.round(b.rep * 100)}% known. Sales of ${GOODS[b.good]} earn up to ${BRAND_MAX * 100}% extra as the brand grows (1,500 t delivered for full fame).` }];
      return [{ title: "Company brands", detail: `Register a brand for one good (${credits(BRAND_FEE)}). Every delivery makes it better known, and known brands sell for up to ${BRAND_MAX * 100}% more.`,
        actions: [action(id, "Register a brand", "register", {}, [goodField()])] }];
    },
  };
};

// ------------------------------------------------------------ 218: manufacturing contracts

export const MFG_HOURS = 24, MFG_RATIO = 0.5, MFG_FEE = 3;
interface Job { id: number; company: number; port: number; qty: number; cost: number; ready: number }
export const manufacturing: FeatureFactory = (e) => {
  const id = "economy.manufacturing";
  const factoryList = lazy(() => producersOf(e, MACHINERY));
  const jobs = new Map<number, Job>();
  let seq = 1;
  return {
    id, ideas: [218], title: "Manufacturing contracts", economy: true,
    apply(cmd) {
      const factories = factoryList();
      const c = e.companies.get(cmd.company)!;
      const s = ownDocked(e, c.id, cmd.ship);
      if (!s) return fail("choose one of your ships in port");
      switch (cmd.action) {
        case "commission": {
          if (!factories.includes(s.port)) return fail("there is no factory here");
          if (s.good !== ORE) return fail("bring ore to the factory");
          if (!whole(cmd.qty, 10, Math.floor(s.qty))) return fail("bad quantity");
          if ([...jobs.values()].filter(j => j.company === c.id).length >= 3) return fail("at most three jobs at once");
          const fee = cmd.qty * MFG_FEE;
          if (c.cash < fee) return fail("not enough cash for the fee");
          c.cash -= fee;
          const cost = unloadEngineCargo(e, s, cmd.qty) + fee;
          const job = { id: seq++, company: c.id, port: s.port, qty: cmd.qty * MFG_RATIO, cost, ready: e.tick + MFG_HOURS };
          jobs.set(job.id, job);
          return { ok: true, id: job.id, spent: fee };
        }
        case "collect": {
          const job = typeof cmd.job === "number" ? jobs.get(cmd.job) : undefined;
          if (!job || job.company !== c.id) return fail("no such job");
          if (e.tick < job.ready) return fail("the machinery is not ready yet");
          if (s.port !== job.port) return fail(`collect at ${portName(e, job.port)}`);
          if (s.good !== null && s.good !== MACHINERY) return fail("the ship carries a different cargo");
          if (freeSpace(e, s) < job.qty) return fail("not enough hold space");
          loadEngineCargo(e, s, MACHINERY, job.qty, job.cost);
          jobs.delete(job.id);
          return ok;
        }
        default: return fail("unknown action");
      }
    },
    view(company) { return [...jobs.values()].filter(j => j.company === company); },
    world() { return { factories: factoryList() }; },
    cards(company) {
      const factories = factoryList();
      const actions = [];
      for (const s of dockedShips(e, company)) {
        if (factories.includes(s.port) && s.good === ORE && s.qty >= 10)
          actions.push(action(id, `Commission machinery from #${s.id}'s ore`, "commission", { ship: s.id }, [{ key: "qty", label: "Tonnes of ore", min: 10, max: Math.floor(s.qty), value: Math.floor(s.qty) }]));
        for (const j of jobs.values()) if (j.company === company && j.port === s.port && e.tick >= j.ready) actions.push(action(id, `Collect job ${j.id} onto #${s.id}`, "collect", { ship: s.id, job: j.id }));
      }
      const mine = [...jobs.values()].filter(j => j.company === company).map(j => `Job ${j.id}: ${j.qty} t machinery at ${portName(e, j.port)}${e.tick >= j.ready ? " (ready)" : ` (ready in ${j.ready - e.tick} h)`}`);
      return [{ title: "Manufacturing contracts", detail: [`Bring ore to a factory (${factories.map(p => portName(e, p)).join(", ")}) and pay ${MFG_FEE} cr/t to have it made into machinery (2 t of ore per tonne) in ${MFG_HOURS} hours.`, ...mine].join("\n"), actions }];
    },
  };
};

// ------------------------------------------------------------ 219: recycling

export const RECYCLE_YIELD = 1.2, CAR_SCRAP = 3, RECYCLE_FEE = 1;
export const recycling: FeatureFactory = (e) => {
  const id = "economy.recycling";
  const yardList = lazy(() => pickPorts(e, "recycling", 4));
  return {
    id, ideas: [219], title: "Recycling", economy: true,
    apply(cmd) {
      const yards = yardList();
      if (cmd.action !== "recycle") return fail("unknown action");
      const c = e.companies.get(cmd.company)!;
      const s = ownDocked(e, c.id, cmd.ship);
      if (!s) return fail("choose one of your ships in port");
      if (!yards.includes(s.port)) return fail("there is no recycling yard here");
      const cars = lotOf(e, s.id, "cars")?.qty ?? 0;
      const machinery = s.good === MACHINERY ? s.qty : 0;
      if (!machinery && !cars) return fail("bring machinery or cars to recycle");
      if (!machinery && s.good !== null && s.good !== ORE) return fail("the ship carries a different cargo");
      const ore = machinery * RECYCLE_YIELD + cars * CAR_SCRAP, fee = (machinery + cars) * RECYCLE_FEE;
      if (c.cash < fee) return fail("not enough cash for the fee");
      // Space freed by what goes in: machinery tonnes and the cars' hold space (3 t each).
      if (ore > freeSpace(e, s) + machinery + cars * 3) return fail("not enough hold space for the ore");
      c.cash -= fee;
      const basis = (machinery ? unloadEngineCargo(e, s, machinery) : 0) + (cars ? takeLot(e, s.id, "cars", cars) : 0) + fee;
      loadEngineCargo(e, s, ORE, ore, basis);
      return { ok: true, spent: fee };
    },
    world() { return { yards: yardList() }; },
    cards(company) {
      const yards = yardList();
      const here = dockedShips(e, company).filter(s => yards.includes(s.port) && (s.good === MACHINERY || lotOf(e, s.id, "cars")));
      return [{ title: "Recycling", detail: `Yards at ${yards.map(p => portName(e, p)).join(", ")} break machinery into ore (${RECYCLE_YIELD} t per tonne) and old cars into ${CAR_SCRAP} t of ore each, for ${RECYCLE_FEE} cr per tonne or car.`,
        actions: here.map(s => action(id, `Recycle #${s.id}'s cargo`, "recycle", { ship: s.id })) }];
    },
  };
};

// ------------------------------------------------------------ 5: grain spoilage

export const GRAIN_SPOIL_PER_HOUR = 0.001;
export const spoilage: FeatureFactory = (e) => {
  const lost = new Map<number, number>();
  return {
    id: "economy.spoilage", ideas: [5], title: "Spoilage", economy: true,
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest === null || s.good !== GRAIN || s.qty <= 0) continue;
        const gone = s.qty * GRAIN_SPOIL_PER_HOUR;
        s.cost -= s.cost * GRAIN_SPOIL_PER_HOUR;
        s.qty -= gone;
        lost.set(s.owner, (lost.get(s.owner) ?? 0) + gone);
      }
    },
    view(company) { return { lost: Math.round((lost.get(company) ?? 0) * 10) / 10 }; },
    cards(company) { return [{ title: "Spoilage", detail: `Grain loses ${GRAIN_SPOIL_PER_HOUR * 100}% of its weight every hour at sea (fish, produce and other perishables spoil by their own rules). Lost so far: ${Math.round(lost.get(company) ?? 0)} t.` }]; },
  };
};

