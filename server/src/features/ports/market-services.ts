import { GOODS, type Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, dockedPorts, fail, goodIndex, inRange, integer, isPort, loadCargo, ownDocked, portName, shipOptions, sites, takeCargo, workShip } from "./shared.js";

/** Rent per tonne per day by district. Quayside lots can be loaded at once; outskirts lots need 6 hours' notice. */
export const DISTRICTS = { quayside: { rent: 0.6, notice: 0 }, oldtown: { rent: 0.4, notice: 2 }, outskirts: { rent: 0.2, notice: 6 } } as const;
type District = keyof typeof DISTRICTS;
const isDistrict = (v: unknown): v is District => typeof v === "string" && Object.hasOwn(DISTRICTS, v);
interface Lot { company: number; port: number; good: number; qty: number; cost: number; district: District; since: number }

/** 59 warehouse rent districts: store cargo ashore, paying daily rent that depends on the district. Economy. */
export const warehouses: FeatureFactory = (e) => {
  const id = "ports.warehouses";
  const lots: Lot[] = [];
  return {
    id, ideas: [59], title: "Warehouse districts", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "store") {
        const s = workShip(e, c.id, cmd.ship);
        if (!s || s.good === null || s.qty < 1) return fail("choose a docked ship with cargo");
        if (!isDistrict(cmd.district)) return fail("choose quayside, oldtown or outskirts");
        if (!inRange(cmd.qty, 1, s.qty)) return fail(`store 1 to ${s.qty} t`);
        if (lots.filter(l => l.company === c.id).length >= 6) return fail("you can rent at most six lots");
        const good = s.good, cost = s.cost * cmd.qty / s.qty;
        takeCargo(e, s, cmd.qty);
        const lot = lots.find(l => l.company === c.id && l.port === s.port && l.good === good && l.district === cmd.district);
        if (lot) { lot.qty += cmd.qty; lot.cost += cost; } else lots.push({ company: c.id, port: s.port, good, qty: cmd.qty, cost, district: cmd.district, since: e.tick });
        return { ok: true };
      }
      if (cmd.action === "load") {
        if (!integer(cmd.lot) || !lots[cmd.lot] || lots[cmd.lot].company !== c.id) return fail("not your lot");
        const lot = lots[cmd.lot];
        const s = workShip(e, c.id, cmd.ship, lot.port);
        if (!s || (s.qty > 0 && s.good !== lot.good)) return fail("choose an empty docked ship (or one with the same cargo) at that port");
        if (e.tick - lot.since < DISTRICTS[lot.district].notice) return fail(`the ${lot.district} warehouse needs ${DISTRICTS[lot.district].notice} hours' notice`);
        const qty = Math.min(lot.qty, e.expansionCapacity(s) - s.qty);
        if (qty < 1) return fail("the ship is full");
        const cost = lot.cost * qty / lot.qty;
        loadCargo(e, s, lot.good, qty, cost);
        lot.qty -= qty; lot.cost -= cost;
        if (!lot.qty) lots.splice(cmd.lot, 1);
        return { ok: true };
      }
      return fail("unknown action");
    },
    advance() {
      if (e.tick % 24 !== 0) return;
      for (const l of lots) { const c = e.companies.get(l.company); if (c) c.cash -= l.qty * DISTRICTS[l.district].rent; }
    },
    cards(company) {
      const mine = lots.map((l, i) => ({ l, i })).filter(x => x.l.company === company);
      const cards = dockedPorts(e, company).map(port => {
        const loaded = ownDocked(e, company, port).filter(s => s.qty > 0);
        return { title: `Warehouses · ${portName(e, port)}`,
          detail: `Rent per tonne per day: quayside ${DISTRICTS.quayside.rent}, old town ${DISTRICTS.oldtown.rent}, outskirts ${DISTRICTS.outskirts.rent} (slower to fetch). Paid at midnight.`,
          actions: loaded.length ? [{ ...action(id, "Store cargo", "store"), fields: [{ key: "ship", label: "Ship", options: shipOptions(loaded) },
            { key: "qty", label: "Tonnes", min: 1, max: 999, value: loaded[0].qty },
            { key: "district", label: "District", options: Object.keys(DISTRICTS).map(d => ({ value: d, label: d })) }] }] : [] };
      });
      if (mine.length) cards.push({ title: "Your warehouse lots", detail: mine.map(({ l }) => `${l.qty} t ${GOODS[l.good]} at ${portName(e, l.port)} (${l.district})`).join("\n"),
        actions: mine.flatMap(({ l, i }) => { const ships = ownDocked(e, company, l.port).filter(s => !s.qty || s.good === l.good);
          return ships.length ? [{ ...action(id, `Load ${GOODS[l.good]} at ${portName(e, l.port)}`, "load", { lot: i }), fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] }] : []; }) });
      return cards;
    },
    view: (company) => lots.filter(l => l.company === company).map(l => ({ port: l.port, good: l.good, qty: l.qty, district: l.district })),
  };
};

export const fishPorts = (e: Engine) => sites(e, 61, 0.3);
export const FISHING_HOURS = 6, CATCH_PER_CAPACITY = 0.5;

/** 266 a fish market: an empty ship at a fishing port can spend six hours at the grounds and sell the catch. Economy. */
export const fishMarket: FeatureFactory = (e) => {
  const id = "ports.fish-market";
  const trips = new Map<number, { port: number; due: number }>();
  return {
    id, ideas: [266], title: "Fish market", economy: true,
    apply(cmd) {
      if (cmd.action !== "fish") return fail("unknown action");
      const s = workShip(e, cmd.company, cmd.ship);
      if (!s || s.qty > 0) return fail("choose an empty docked ship");
      if (!fishPorts(e).includes(s.port)) return fail("there is no fish market here");
      if (trips.has(s.id)) return fail("that ship is already fishing");
      trips.set(s.id, { port: s.port, due: e.tick + FISHING_HOURS });
      return { ok: true };
    },
    advance() {
      for (const [sid, t] of trips) {
        const s = e.ships.get(sid);
        if (!s || s.dest !== null || s.port !== t.port || s.qty > 0) { trips.delete(sid); continue; }
        if (t.due > e.tick) continue;
        trips.delete(sid);
        const c = e.companies.get(s.owner);
        if (c) c.cash += Math.round(e.spec(s.type).capacity * CATCH_PER_CAPACITY);
      }
    },
    cards(company) {
      return dockedPorts(e, company).filter(p => fishPorts(e).includes(p)).map(port => {
        const empty = ownDocked(e, company, port).filter(s => !s.qty && !trips.has(s.id));
        return { title: `Fish market · ${portName(e, port)}`, detail: `An empty ship can fish for ${FISHING_HOURS} hours and sell the catch here (about ${CATCH_PER_CAPACITY} credit per tonne of hold). Sailing or loading cancels it.`,
          actions: empty.length ? [{ ...action(id, "Go fishing", "fish"), fields: [{ key: "ship", label: "Ship", options: shipOptions(empty) }] }] : [] };
      });
    },
    view: (company) => [...trips].filter(([s]) => e.ships.get(s)?.owner === company).map(([ship, t]) => ({ ship, due: t.due })),
    world: () => ({ ports: fishPorts(e) }),
  };
};

export const RUMOUR_PRICE = 50;

/** 60 a rumour board: pay for a reliable tip on where a good sells best among ports you can reach. Economy (paid). */
export const rumours: FeatureFactory = (e) => {
  const id = "ports.rumours";
  const bought = new Map<number, { tick: number; text: string }[]>();
  return {
    id, ideas: [60], title: "Rumour board", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      const c = e.companies.get(cmd.company)!;
      if (!isPort(e, cmd.port) || !ownDocked(e, c.id, cmd.port).length) return fail("dock a ship there to read the board");
      const g = goodIndex(cmd.good);
      if (g < 0) return fail("choose a good");
      if (c.cash < RUMOUR_PRICE) return fail("not enough cash");
      const from = cmd.port;
      let best = -1;
      for (let p = 0; p < e.n; p++) if (p !== from && Number.isFinite(e.dist[from][p]) && (best < 0 || e.price(p, g) > e.price(best, g))) best = p;
      if (best < 0) return fail("no port can be reached from here");
      c.cash -= RUMOUR_PRICE;
      const list = bought.get(c.id) ?? [];
      list.push({ tick: e.tick, text: `They say ${GOODS[g]} fetches ${Math.round(e.price(best, g))} at ${portName(e, best)} (heard at ${portName(e, from)}).` });
      bought.set(c.id, list.slice(-8));
      return { ok: true, spent: RUMOUR_PRICE };
    },
    cards(company) {
      const ports = dockedPorts(e, company);
      const heard = bought.get(company) ?? [];
      return ports.length || heard.length ? [{ title: "Rumour board", detail: `A sure tip costs ${RUMOUR_PRICE}.${heard.length ? "\n" + heard.map(h => h.text).join("\n") : ""}`,
        actions: ports.map(port => ({ ...action(id, `Buy a tip at ${portName(e, port)}`, "buy", { port }), fields: [{ key: "good", label: "Good", options: GOODS.map(g => ({ value: g, label: g })) }] })) }] : [];
    },
    view: (company) => bought.get(company) ?? [],
  };
};
