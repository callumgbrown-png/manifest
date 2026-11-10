// Trading desks: bulk discounts (6), black-market ports (9), futures for any good (3), warehouses (4) and an index
// speculation market (204). All move money or prices, so all are economy modules and ship off.
import { GOODS } from "../../engine.js";
import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import {
  action, credits, dockedShips, fail, freeSpace, goodField, isEngineGood, isPort, loadEngineCargo, Notes, ok, ownDocked, pickPorts, portName,
  priceIndex, round2, sellEngineCargoFor, shiftStock, taxRate, unloadEngineCargo, whole,
} from "./util.js";

// ------------------------------------------------------------ 6: bulk-volume discounts

export const BULK_TIERS = [{ qty: 200, off: 0.15 }, { qty: 100, off: 0.1 }, { qty: 50, off: 0.05 }];
const BULK_MIN = 50;
export const bulkDiscount = (qty: number) => BULK_TIERS.find(t => qty >= t.qty)?.off ?? 0;

export const bulkDiscounts: FeatureFactory = (e) => {
  const id = "economy.bulk-discounts";
  const quote = (port: number, g: number, qty: number) =>
    e.buyCost(port, g, qty).cost * (1 + e.tradeRate(port, g, "buy", taxRate(e))) * (1 - bulkDiscount(qty));
  return {
    id, ideas: [6], title: "Bulk buying desk", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      const c = e.companies.get(cmd.company)!;
      const s = ownDocked(e, c.id, cmd.ship);
      if (!s) return fail("choose one of your ships in port");
      if (!isEngineGood(cmd.good)) return fail("choose a good");
      if (s.good !== null && s.good !== cmd.good) return fail("the ship carries a different cargo");
      if (!whole(cmd.qty, BULK_MIN, 100_000)) return fail(`the bulk desk sells lots of ${BULK_MIN} t or more`);
      if (cmd.qty > freeSpace(e, s)) return fail("not enough hold space");
      if (cmd.qty > e.stock[s.port][cmd.good]) return fail("the port doesn't have that much in stock");
      const cost = quote(s.port, cmd.good, cmd.qty);
      if (c.cash < cost) return fail("not enough cash");
      c.cash -= cost;
      shiftStock(e, s.port, cmd.good, -cmd.qty);
      loadEngineCargo(e, s, cmd.good, cmd.qty, cost);
      return { ok: true, bought: cmd.qty, spent: cost };
    },
    cards(company) {
      const ships = dockedShips(e, company).filter(s => freeSpace(e, s) >= BULK_MIN);
      if (!ships.length) return [];
      return [{ title: "Bulk buying desk", detail: `Buy ${BULK_MIN} t or more in one go for 5% off (100 t: 10%, 200 t: 15%).`,
        actions: ships.map(s => action(id, `Bulk buy for #${s.id} at ${portName(e, s.port)}`, "buy", { ship: s.id },
          [goodField(s.good !== null ? [s.good] : undefined), { key: "qty", label: "Tonnes", min: BULK_MIN, max: Math.floor(freeSpace(e, s)), value: Math.floor(freeSpace(e, s)) }])) }];
    },
  };
};

// ------------------------------------------------------------ 9: black-market ports

export const SEIZE_CHANCE = 0.08;
export const blackMarket: FeatureFactory = (e) => {
  const id = "economy.black-market";
  let ports: number[] = [];
  let factors: number[][] = [];
  const reroll = () => { factors = ports.map(() => GOODS.map(() => round2(0.5 + e.features.random() * 1.4))); };
  const notes = new Notes();
  return {
    id, ideas: [9], title: "Black market", economy: true,
    enable() { if (!ports.length) ports = pickPorts(e, "black-market", 3); if (!factors.length) reroll(); },
    advance() { if (e.tick % 24 === 0) reroll(); },
    apply(cmd) {
      if (cmd.action !== "fence") return fail("unknown action");
      const s = ownDocked(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships in port");
      const i = ports.indexOf(s.port);
      if (i < 0) return fail("there is no black market here");
      if (s.good === null || s.qty <= 0) return fail("nothing aboard to sell");
      if (e.features.random() < SEIZE_CHANCE) {
        unloadEngineCargo(e, s, s.qty);
        notes.add(cmd.company, `Customs raided the deal in ${portName(e, s.port)} and seized the cargo.`);
        return { ok: true, earned: 0 };
      }
      const value = s.qty * e.price(s.port, s.good) * factors[i][s.good];
      sellEngineCargoFor(e, s, value);
      return { ok: true, earned: value };
    },
    world() { return { ports, factors }; },
    cards(company) {
      const here = dockedShips(e, company).filter(s => ports.includes(s.port) && s.good !== null);
      const detail = `Back-alley buyers at ${ports.map(p => portName(e, p)).join(", ")} pay odd prices (50% to 190% of the market, new every day), tax-free. ${Math.round(SEIZE_CHANCE * 100)}% of deals are raided by customs.`;
      return [{ title: "Black market", detail: [detail, ...notes.of(company).slice(-2)].join("\n"),
        actions: here.map(s => action(id, `Fence ${GOODS[s.good!]} from #${s.id} (${Math.round(factors[ports.indexOf(s.port)][s.good!] * 100)}% today)`, "fence", { ship: s.id })) }];
    },
  };
};

// ------------------------------------------------------------ 3: futures for every good

interface Future { id: number; company: number; port: number; good: number; qty: number; price: number; margin: number; due: number }
export const FUTURE_MARGIN = 0.2;
export const futures: FeatureFactory = (e) => {
  const id = "economy.futures";
  const open = new Map<number, Future>();
  let seq = 1;
  const notes = new Notes();
  return {
    id, ideas: [3], title: "Futures contracts", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      switch (cmd.action) {
        case "open": {
          if (!isEngineGood(cmd.good)) return fail("choose a good");
          if (!isPort(e, cmd.port)) return fail("choose a port");
          if (!whole(cmd.qty, 10, 5000)) return fail("between 10 and 5000 t");
          if (!whole(cmd.days, 2, 10)) return fail("delivery in 2 to 10 days");
          if ([...open.values()].filter(f => f.company === c.id).length >= 3) return fail("at most three open contracts");
          const due = e.tick + cmd.days * 24;
          if (due > e.seasonHours) return fail("the season ends before delivery");
          const price = round2(e.price(cmd.port, cmd.good)), margin = Math.ceil(price * cmd.qty * FUTURE_MARGIN);
          if (c.cash < margin) return fail("not enough cash for the margin");
          c.cash -= margin;
          const f = { id: seq++, company: c.id, port: cmd.port, good: cmd.good, qty: cmd.qty, price, margin, due };
          open.set(f.id, f);
          return { ok: true, id: f.id, spent: margin };
        }
        case "deliver": {
          const f = typeof cmd.contract === "number" ? open.get(cmd.contract) : undefined;
          if (!f || f.company !== c.id) return fail("no such contract");
          const s = ownDocked(e, c.id, cmd.ship);
          if (!s || s.port !== f.port) return fail(`deliver with a ship in ${portName(e, f.port)}`);
          if (s.good !== f.good || s.qty < f.qty) return fail(`the ship needs ${f.qty} t of ${GOODS[f.good]}`);
          unloadEngineCargo(e, s, f.qty);
          shiftStock(e, f.port, f.good, f.qty);
          const paid = f.qty * f.price + f.margin;
          c.cash += paid;
          open.delete(f.id);
          return { ok: true, earned: paid };
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      for (const f of [...open.values()]) if (e.tick > f.due) { open.delete(f.id); notes.add(f.company, `Futures contract ${f.id} expired undelivered; the ${credits(f.margin)} margin is lost.`); }
    },
    view(company) { return { open: [...open.values()].filter(f => f.company === company), notes: notes.of(company) }; },
    cards(company) {
      const mine = [...open.values()].filter(f => f.company === company);
      const actions = [action(id, "Sell a future", "open", {}, [goodField(), { key: "port", label: "Deliver to", options: e.map.ports.map(p => ({ value: p.id, label: p.name })), value: 0 },
        { key: "qty", label: "Tonnes", min: 10, max: 5000, value: 200 }, { key: "days", label: "Days", min: 2, max: 10, value: 4 }])];
      for (const f of mine) for (const s of dockedShips(e, company)) if (s.port === f.port && s.good === f.good && s.qty >= f.qty)
        actions.push(action(id, `Deliver contract ${f.id} with #${s.id}`, "deliver", { contract: f.id, ship: s.id }));
      const lines = mine.map(f => `#${f.id}: ${f.qty} t ${GOODS[f.good]} to ${portName(e, f.port)} at ${f.price} cr/t by day ${Math.floor(f.due / 24) + 1}`);
      return [{ title: "Futures contracts", detail: [`Lock today's price for a delivery up to 10 days away. ${Math.round(FUTURE_MARGIN * 100)}% margin, returned on delivery and lost if you miss the date.`, ...lines, ...notes.of(company).slice(-2)].join("\n"), actions }];
    },
  };
};

// ------------------------------------------------------------ 4: warehouses

export const RENT_PER_TONNE_HOUR = 0.02;
export const WAREHOUSE_LIMIT = 2000;
interface Stored { qty: number; cost: number }
export const warehouses: FeatureFactory = (e) => {
  const id = "economy.warehouses";
  const lots = new Map<string, Stored>();   // "company:port:good"
  const k = (c: number, p: number, g: number) => `${c}:${p}:${g}`;
  const storedAt = (c: number, p: number) => GOODS.reduce((sum, _, g) => sum + (lots.get(k(c, p, g))?.qty ?? 0), 0);
  return {
    id, ideas: [4], title: "Warehouses", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      const s = ownDocked(e, c.id, cmd.ship);
      if (!s) return fail("choose one of your ships in port");
      switch (cmd.action) {
        case "store": {
          if (s.good === null || s.qty <= 0) return fail("nothing aboard to store");
          if (!whole(cmd.qty, 1, Math.floor(s.qty))) return fail("bad quantity");
          if (storedAt(c.id, s.port) + cmd.qty > WAREHOUSE_LIMIT) return fail(`a warehouse holds ${WAREHOUSE_LIMIT} t`);
          const g = s.good, cost = unloadEngineCargo(e, s, cmd.qty);
          const lot = lots.get(k(c.id, s.port, g)) ?? { qty: 0, cost: 0 };
          lot.qty += cmd.qty; lot.cost += cost;
          lots.set(k(c.id, s.port, g), lot);
          return ok;
        }
        case "withdraw": {
          if (!isEngineGood(cmd.good)) return fail("choose a good");
          const lot = lots.get(k(c.id, s.port, cmd.good));
          if (!lot) return fail("nothing of that stored here");
          if (s.good !== null && s.good !== cmd.good) return fail("the ship carries a different cargo");
          if (!whole(cmd.qty, 1, Math.floor(lot.qty))) return fail("bad quantity");
          if (cmd.qty > freeSpace(e, s)) return fail("not enough hold space");
          const cost = lot.cost * cmd.qty / lot.qty;
          lot.qty -= cmd.qty; lot.cost -= cost;
          if (lot.qty <= 0) lots.delete(k(c.id, s.port, cmd.good));
          loadEngineCargo(e, s, cmd.good, cmd.qty, cost);
          return ok;
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      for (const [key, lot] of lots) {
        const c = e.companies.get(Number(key.split(":")[0]));
        if (c) c.cash -= lot.qty * RENT_PER_TONNE_HOUR;
      }
    },
    view(company) {
      return [...lots].filter(([key]) => key.startsWith(`${company}:`)).map(([key, l]) => { const [, port, good] = key.split(":").map(Number); return { port, good, qty: l.qty, cost: Math.round(l.cost) }; });
    },
    cards(company) {
      const out: FeatureCard[] = [];
      const actions = [];
      for (const s of dockedShips(e, company)) {
        if (s.good !== null && s.qty > 0) actions.push(action(id, `Store ${GOODS[s.good]} from #${s.id}`, "store", { ship: s.id }, [{ key: "qty", label: "Tonnes", min: 1, max: Math.floor(s.qty), value: Math.floor(s.qty) }]));
        for (let g = 0; g < GOODS.length; g++) {
          const lot = lots.get(k(company, s.port, g));
          if (lot && (s.good === null || s.good === g) && freeSpace(e, s) >= 1)
            actions.push(action(id, `Load stored ${GOODS[g]} onto #${s.id}`, "withdraw", { ship: s.id, good: g }, [{ key: "qty", label: "Tonnes", min: 1, max: Math.max(1, Math.floor(Math.min(lot.qty, freeSpace(e, s)))), value: Math.max(1, Math.floor(Math.min(lot.qty, freeSpace(e, s)))) }]));
        }
      }
      const stored = [...lots].filter(([key]) => key.startsWith(`${company}:`)).map(([key, l]) => { const [, p, g] = key.split(":").map(Number); return `${Math.floor(l.qty)} t ${GOODS[g]} in ${portName(e, p)}`; });
      out.push({ title: "Warehouses", detail: [`Store cargo at any port and wait for a better price. Rent ${RENT_PER_TONNE_HOUR} cr per tonne per hour, up to ${WAREHOUSE_LIMIT} t per port.`, ...stored].join("\n"), actions });
      return out;
    },
  };
};

// ------------------------------------------------------------ 204: commodity speculation market

interface Position { id: number; company: number; good: number; side: "long" | "short"; stake: number; entry: number }
export const SPEC_LEVERAGE = 2, SPEC_FEE = 0.01;
export const speculation: FeatureFactory = (e) => {
  const id = "economy.speculation";
  const positions = new Map<number, Position>();
  let seq = 1;
  const value = (p: Position) => {
    const move = priceIndex(e)[p.good] / p.entry - 1;
    return Math.max(0, p.stake * (1 + SPEC_LEVERAGE * (p.side === "long" ? move : -move)));
  };
  return {
    id, ideas: [204], title: "Commodity exchange", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      switch (cmd.action) {
        case "open": {
          if (!isEngineGood(cmd.good)) return fail("choose a good");
          if (cmd.side !== "long" && cmd.side !== "short") return fail("long or short");
          if (!whole(cmd.stake, 100, 50_000)) return fail("stake 100 to 50,000");
          if ([...positions.values()].filter(p => p.company === c.id).length >= 3) return fail("at most three positions");
          const cost = cmd.stake * (1 + SPEC_FEE);
          if (c.cash < cost) return fail("not enough cash");
          c.cash -= cost;
          const p: Position = { id: seq++, company: c.id, good: cmd.good, side: cmd.side, stake: cmd.stake, entry: priceIndex(e)[cmd.good] };
          positions.set(p.id, p);
          return { ok: true, id: p.id, spent: cost };
        }
        case "close": {
          const p = typeof cmd.position === "number" ? positions.get(cmd.position) : undefined;
          if (!p || p.company !== c.id) return fail("no such position");
          const paid = value(p) * (1 - SPEC_FEE);
          c.cash += paid;
          positions.delete(p.id);
          return { ok: true, earned: paid };
        }
        default: return fail("unknown action");
      }
    },
    view(company) { return [...positions.values()].filter(p => p.company === company).map(p => ({ ...p, value: Math.round(value(p)) })); },
    cards(company) {
      const mine = [...positions.values()].filter(p => p.company === company);
      return [{ title: "Commodity exchange",
        detail: [`Bet on the island-wide price index of a good at ${SPEC_LEVERAGE}x: long wins when it rises, short when it falls. ${SPEC_FEE * 100}% fee in and out.`,
          ...mine.map(p => `#${p.id} ${p.side} ${GOODS[p.good]}: staked ${credits(p.stake)}, now worth ${credits(value(p))}`)].join("\n"),
        actions: [action(id, "Open a position", "open", {}, [goodField(), { key: "side", label: "Side", options: [{ value: "long", label: "Long (rise)" }, { value: "short", label: "Short (fall)" }], value: "long" },
          { key: "stake", label: "Stake", min: 100, max: 50_000, value: 1000 }]), ...mine.map(p => action(id, `Close #${p.id}`, "close", { position: p.id }))] }];
    },
  };
};

