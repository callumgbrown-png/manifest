// Manifest game engine: the authoritative rules, independent of networking and storage.
// Every change goes through apply() or tick(), so the whole game can be rebuilt by
// replaying the event log. Nothing here uses randomness or the clock.

export const GOODS = ["grain", "fuel"] as const;
export type Good = (typeof GOODS)[number];
const FUEL = 1;

export interface Rules {
  season: { days: number; hours_per_tick: number };
  commodities: Record<Good, { floor: number; ceiling: number }>;
  markets: {
    target_stock: number;
    max_stock_multiple: number;
    production_per_hour: Record<Good, number>;
    consumption_per_hour: Record<Good, number>;
  };
  fees: { port_fee_per_docking: number; trade_tax_rate: number };
  company: { start_cash: number; start_ships: number; max_ships: number };
  ship: { price: number; capacity: number; speed_per_hour: number; fuel_per_100_distance: number; upkeep_per_day: number };
}

export interface MapData {
  ports: { id: number; name: string; x: number; y: number; produces: Good[]; consumes: Good[] }[];
  routes: { a: number; b: number; distance: number }[];
}

export interface Ship {
  id: number; owner: number; port: number; dest: number | null;
  departTick: number; arriveTick: number;
  good: number | null; qty: number; cost: number;
}
export interface Company { id: number; name: string; cash: number; ships: number[] }
export interface Order { id: number; owner: number; port: number; good: number; qty: number; price: number }

export type Command =
  | { type: "register"; name: string; startPort: number }
  | { type: "sail"; company: number; ship: number; dest: number; buy?: { good: Good; qty: number } }
  | { type: "sell"; company: number; ship: number; order?: number }
  | { type: "buyShip"; company: number; port: number }
  | { type: "scrapShip"; company: number; ship: number }
  | { type: "placeOrder"; company: number; port: number; good: Good; qty: number; price: number }
  | { type: "cancelOrder"; company: number; order: number }
  | { type: "adminSet"; tax?: number; upkeep?: number; portFee?: number };

export type Result = { ok: true; id?: number } | { ok: false; error: string };

export class Engine {
  readonly rules: Rules;
  readonly map: MapData;
  readonly dist: number[][];
  readonly n: number;
  tick = 0;
  stock: number[][];
  companies = new Map<number, Company>();
  ships = new Map<number, Ship>();
  orders = new Map<number, Order>();
  private nextId = 1;
  private prod: number[][];
  private cons: number[][];

  constructor(rules: Rules, map: MapData) {
    this.rules = structuredClone(rules);
    this.map = map;
    this.n = map.ports.length;
    this.dist = shortestPaths(this.n, map.routes);
    const m = rules.markets;
    this.prod = map.ports.map(p => GOODS.map(g => (p.produces.includes(g) ? m.production_per_hour[g] : 0)));
    this.cons = map.ports.map(p => GOODS.map(g => (p.consumes.includes(g) ? m.consumption_per_hour[g] : 0)));
    this.stock = map.ports.map(() => [m.target_stock, m.target_stock]);
  }

  // ------------------------------------------------------------ market maths

  price(port: number, g: number, stock = this.stock[port][g]): number {
    const c = this.rules.commodities[GOODS[g]];
    const frac = Math.min(1, Math.max(0, 1 - stock / (2 * this.rules.markets.target_stock)));
    return c.floor + (c.ceiling - c.floor) * frac;
  }

  /** Cost of buying qty at a port. Missing stock comes at the ceiling price. */
  buyCost(port: number, g: number, qty: number): { cost: number; fromStock: number } {
    const have = Math.min(qty, this.stock[port][g]);
    const mid = this.stock[port][g] - have / 2;
    const cost = have * this.price(port, g, mid) + (qty - have) * this.rules.commodities[GOODS[g]].ceiling;
    return { cost, fromStock: have };
  }

  sellValue(port: number, g: number, qty: number): number {
    return qty * this.price(port, g, this.stock[port][g] + qty / 2);
  }

  voyageHours(from: number, to: number): number {
    return Math.max(1, Math.ceil(this.dist[from][to] / this.rules.ship.speed_per_hour));
  }

  fuelNeeded(from: number, to: number): number {
    return (this.dist[from][to] * this.rules.ship.fuel_per_100_distance) / 100;
  }

  // ------------------------------------------------------------ commands

  apply(cmd: Command): Result {
    switch (cmd.type) {
      case "register": return this.register(cmd.name, cmd.startPort);
      case "sail": return this.sail(cmd);
      case "sell": return this.sell(cmd.company, cmd.ship, cmd.order);
      case "buyShip": return this.buyShip(cmd.company, cmd.port);
      case "scrapShip": return this.scrapShip(cmd.company, cmd.ship);
      case "placeOrder": return this.placeOrder(cmd);
      case "cancelOrder": return this.cancelOrder(cmd.company, cmd.order);
      case "adminSet": return this.adminSet(cmd);
    }
  }

  private register(name: string, startPort: number): Result {
    if (!(startPort >= 0 && startPort < this.n)) return fail("bad start port");
    const id = this.nextId++;
    const c: Company = { id, name, cash: this.rules.company.start_cash, ships: [] };
    this.companies.set(id, c);
    for (let i = 0; i < this.rules.company.start_ships; i++) this.addShip(c, startPort);
    return { ok: true, id };
  }

  private addShip(c: Company, port: number): Ship {
    const s: Ship = { id: this.nextId++, owner: c.id, port, dest: null, departTick: 0, arriveTick: 0, good: null, qty: 0, cost: 0 };
    this.ships.set(s.id, s);
    c.ships.push(s.id);
    return s;
  }

  private ownShip(company: number, shipId: number): { c: Company; s: Ship } | string {
    const c = this.companies.get(company);
    const s = this.ships.get(shipId);
    if (!c || !s || s.owner !== company) return "not your ship";
    return { c, s };
  }

  private sail(cmd: Extract<Command, { type: "sail" }>): Result {
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (s.dest !== null) return fail("ship is at sea");
    if (!(cmd.dest >= 0 && cmd.dest < this.n) || cmd.dest === s.port) return fail("bad destination");
    if (!Number.isFinite(this.dist[s.port][cmd.dest])) return fail("no route");
    const tax = this.rules.fees.trade_tax_rate;

    let cargoCost = 0, g = -1, qty = 0;
    if (cmd.buy) {
      g = GOODS.indexOf(cmd.buy.good);
      qty = Math.floor(cmd.buy.qty);
      if (g < 0 || !(qty > 0)) return fail("bad cargo");
      if (s.qty > 0) return fail("ship already loaded; sell first");
      if (qty > this.rules.ship.capacity) return fail("over capacity");
      if (qty > this.stock[s.port][g]) return fail("not enough stock at this port");
      cargoCost = this.buyCost(s.port, g, qty).cost * (1 + tax);
    }
    // Fuel is bought after the cargo, so a fuel cargo raises the fuel price slightly.
    const fuelQty = this.fuelNeeded(s.port, cmd.dest);
    const stockAfter = g === FUEL ? this.stock[s.port][FUEL] - qty : this.stock[s.port][FUEL];
    const fuelHave = Math.min(fuelQty, Math.max(0, stockAfter));
    const fuelCost = fuelHave * this.price(s.port, FUEL, stockAfter - fuelHave / 2)
      + (fuelQty - fuelHave) * this.rules.commodities.fuel.ceiling;
    if (cargoCost + fuelCost > c.cash) return fail("not enough cash");

    if (cmd.buy) {
      this.stock[s.port][g] -= qty;
      s.good = g; s.qty = qty; s.cost = cargoCost;
    }
    this.stock[s.port][FUEL] = Math.max(0, this.stock[s.port][FUEL] - fuelHave);
    c.cash -= cargoCost + fuelCost;
    s.dest = cmd.dest;
    s.departTick = this.tick;
    s.arriveTick = this.tick + this.voyageHours(s.port, cmd.dest);
    return { ok: true };
  }

  private sell(company: number, shipId: number, orderId?: number): Result {
    const own = this.ownShip(company, shipId);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (s.dest !== null) return fail("ship is at sea");
    if (s.qty <= 0 || s.good === null) return fail("nothing to sell");
    const tax = this.rules.fees.trade_tax_rate;
    if (orderId !== undefined) {
      const o = this.orders.get(orderId);
      if (!o || o.port !== s.port || o.good !== s.good) return fail("order doesn't match this ship");
      if (o.owner === company) return fail("can't fill your own order");
      const fill = Math.min(o.qty, s.qty);
      const gross = fill * o.price;
      c.cash += gross * (1 - tax);
      // The goods are delivered to the buyer, who uses them; they leave the market.
      o.qty -= fill;
      if (o.qty <= 0) this.orders.delete(o.id);
      s.cost *= (s.qty - fill) / s.qty;
      s.qty -= fill;
    } else {
      const gross = this.sellValue(s.port, s.good, s.qty);
      this.stock[s.port][s.good] += s.qty;
      c.cash += gross * (1 - tax);
      s.qty = 0; s.cost = 0;
    }
    if (s.qty === 0) s.good = null;
    return { ok: true };
  }

  private buyShip(company: number, port: number): Result {
    const c = this.companies.get(company);
    if (!c) return fail("no company");
    if (c.ships.length >= this.rules.company.max_ships) return fail("fleet is at its maximum");
    if (c.cash < this.rules.ship.price) return fail("not enough cash");
    const docked = c.ships.some(id => { const s = this.ships.get(id)!; return s.dest === null && s.port === port; });
    if (!docked) return fail("you need a ship docked at that port");
    c.cash -= this.rules.ship.price;
    return { ok: true, id: this.addShip(c, port).id };
  }

  private scrapShip(company: number, shipId: number): Result {
    const own = this.ownShip(company, shipId);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (c.ships.length <= 1) return fail("you must keep one ship");
    if (s.dest !== null || s.qty > 0) return fail("ship must be docked and empty");
    this.removeShip(c, s);
    c.cash += this.rules.ship.price * 0.5;
    return { ok: true };
  }

  private removeShip(c: Company, s: Ship) {
    this.ships.delete(s.id);
    c.ships = c.ships.filter(id => id !== s.id);
  }

  private placeOrder(cmd: Extract<Command, { type: "placeOrder" }>): Result {
    const c = this.companies.get(cmd.company);
    const g = GOODS.indexOf(cmd.good);
    if (!c || g < 0) return fail("bad order");
    if (!(cmd.port >= 0 && cmd.port < this.n)) return fail("bad port");
    const qty = Math.floor(cmd.qty), price = Math.round(cmd.price * 100) / 100;
    const band = this.rules.commodities[cmd.good];
    if (!(qty > 0 && qty <= 1000)) return fail("quantity must be 1 to 1000");
    if (!(price >= band.floor && price <= band.ceiling)) return fail(`price must be between ${band.floor} and ${band.ceiling}`);
    if (qty * price > c.cash) return fail("not enough cash to cover the order");
    c.cash -= qty * price;   // held in escrow until filled or cancelled
    const id = this.nextId++;
    this.orders.set(id, { id, owner: c.id, port: cmd.port, good: g, qty, price });
    return { ok: true, id };
  }

  private cancelOrder(company: number, orderId: number): Result {
    const o = this.orders.get(orderId);
    if (!o || o.owner !== company) return fail("not your order");
    this.companies.get(company)!.cash += o.qty * o.price;
    this.orders.delete(orderId);
    return { ok: true };
  }

  private adminSet(cmd: Extract<Command, { type: "adminSet" }>): Result {
    if (cmd.tax !== undefined) {
      if (!(cmd.tax >= 0 && cmd.tax <= 0.3)) return fail("tax must be 0 to 0.3");
      this.rules.fees.trade_tax_rate = cmd.tax;
    }
    if (cmd.upkeep !== undefined) {
      if (!(cmd.upkeep >= 0)) return fail("bad upkeep");
      this.rules.ship.upkeep_per_day = cmd.upkeep;
    }
    if (cmd.portFee !== undefined) {
      if (!(cmd.portFee >= 0)) return fail("bad port fee");
      this.rules.fees.port_fee_per_docking = cmd.portFee;
    }
    return { ok: true };
  }

  // ------------------------------------------------------------ time

  advance(): void {
    this.tick++;
    const cap = this.rules.markets.target_stock * this.rules.markets.max_stock_multiple;
    for (let p = 0; p < this.n; p++)
      for (let g = 0; g < 2; g++)
        this.stock[p][g] = Math.max(0, Math.min(cap, this.stock[p][g] + this.prod[p][g]) - this.cons[p][g]);

    for (const s of this.ships.values()) {
      if (s.dest !== null && s.arriveTick <= this.tick) {
        s.port = s.dest;
        s.dest = null;
        this.companies.get(s.owner)!.cash -= this.rules.fees.port_fee_per_docking;
      }
    }

    if (this.tick % 24 === 0) {
      for (const c of this.companies.values()) {
        c.cash -= this.rules.ship.upkeep_per_day * Math.max(0, c.ships.length - 1);
        if (c.cash < 0 && c.ships.length > 1) {
          const idle = c.ships.map(id => this.ships.get(id)!).find(s => s.dest === null && s.qty === 0);
          if (idle) { this.removeShip(c, idle); c.cash += this.rules.ship.price * 0.5; }
        }
      }
    }
  }

  // ------------------------------------------------------------ views

  netWorth(c: Company): number {
    let w = c.cash;
    for (const id of c.ships) w += this.rules.ship.price * 0.5 + this.ships.get(id)!.cost;
    for (const o of this.orders.values()) if (o.owner === c.id) w += o.qty * o.price;
    return w;
  }

  /** Cargo and empty ships heading to each port: public information. */
  inbound(): { cargo: number[][]; emptyShips: number[] } {
    const cargo = this.map.ports.map(() => [0, 0]);
    const emptyShips = this.map.ports.map(() => 0);
    for (const s of this.ships.values()) {
      if (s.dest === null) continue;
      if (s.qty > 0 && s.good !== null) cargo[s.dest][s.good] += s.qty;
      else emptyShips[s.dest]++;
    }
    return { cargo, emptyShips };
  }

  metrics() {
    const comps = [...this.companies.values()];
    const worth = comps.map(c => this.netWorth(c)).sort((a, b) => b - a);
    const total = worth.reduce((a, b) => a + Math.max(0, b), 0);
    const k = Math.max(1, Math.floor(worth.length / 100));
    return {
      tick: this.tick,
      day: Math.floor(this.tick / 24) + 1,
      companies: comps.length,
      ships: this.ships.size,
      moneySupply: Math.round(comps.reduce((a, c) => a + c.cash, 0)),
      escrow: Math.round([...this.orders.values()].reduce((a, o) => a + o.qty * o.price, 0)),
      top1pctShare: total > 0 ? worth.slice(0, k).reduce((a, b) => a + Math.max(0, b), 0) / total : 0,
      inDebt: comps.filter(c => c.cash < 0).length,
      tax: this.rules.fees.trade_tax_rate,
      upkeep: this.rules.ship.upkeep_per_day,
      portFee: this.rules.fees.port_fee_per_docking,
    };
  }
}

function fail(error: string): Result { return { ok: false, error }; }

function shortestPaths(n: number, routes: MapData["routes"]): number[][] {
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  for (const r of routes) d[r.a][r.b] = d[r.b][r.a] = r.distance;
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  return d;
}
