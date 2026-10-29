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
    reference_companies?: number;
    min_scale?: number;
    scale_exponent?: number;
    start_spread?: number;
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
/** A buy order holds cash in escrow; a sell order holds goods at the port. */
export interface Order {
  id: number; owner: number; port: number; good: number; qty: number; price: number;
  side: "buy" | "sell";
  /** Sell orders only: what the seller paid for the goods still listed. */
  cost?: number;
}
const MAX_OPEN_ORDERS = 10;

export type Command =
  | { type: "register"; name: string; startPort: number }
  | { type: "sail"; company: number; ship: number; dest: number; buy?: { good: Good; qty: number } }
  | { type: "sell"; company: number; ship: number; order?: number }
  | { type: "buyShip"; company: number; port: number }
  | { type: "scrapShip"; company: number; ship: number }
  | { type: "placeOrder"; company: number; port: number; good: Good; qty: number; price: number }
  | { type: "placeSell"; company: number; ship: number; qty: number; price: number }
  | { type: "buyFromOrder"; company: number; ship: number; order: number; qty: number }
  | { type: "cancelOrder"; company: number; order: number; ship?: number }
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
  /** Market size multiplier, fixed for the season. */
  readonly scale: number;
  private target: number;
  private prod: number[][];
  private cons: number[][];

  /** expectedCompanies sets the market size for the whole season (see rules.markets). */
  constructor(rules: Rules, map: MapData, expectedCompanies?: number) {
    this.rules = structuredClone(rules);
    this.map = map;
    this.n = map.ports.length;
    this.dist = shortestPaths(this.n, map.routes);
    const m = rules.markets;
    this.scale = m.reference_companies && expectedCompanies
      ? Math.max(m.min_scale ?? 0, (expectedCompanies / m.reference_companies) ** (m.scale_exponent ?? 1)) : 1;
    const k = this.scale;
    this.target = m.target_stock * k;
    this.prod = map.ports.map(p => GOODS.map(g => (p.produces.includes(g) ? m.production_per_hour[g] * k : 0)));
    this.cons = map.ports.map(p => GOODS.map(g => (p.consumes.includes(g) ? m.consumption_per_hour[g] * k : 0)));
    // Seasons open with producers stocked up and consumers short, so trade pays from the first hour.
    const spread = m.start_spread ?? 0;
    this.stock = map.ports.map(p => GOODS.map(g => {
      const makes = p.produces.includes(g), needs = p.consumes.includes(g);
      return this.target * (1 + (makes && !needs ? spread : 0) - (needs && !makes ? spread : 0));
    }));
  }

  // ------------------------------------------------------------ market maths

  price(port: number, g: number, stock = this.stock[port][g]): number {
    const c = this.rules.commodities[GOODS[g]];
    const frac = Math.min(1, Math.max(0, 1 - stock / (2 * this.target)));
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

  get seasonHours(): number { return this.rules.season.days * 24; }
  get seasonOver(): boolean { return this.tick >= this.seasonHours; }

  apply(cmd: Command): Result {
    if (this.seasonOver && cmd.type !== "adminSet") return fail("the season has ended");
    switch (cmd.type) {
      case "register": return this.register(cmd.name, cmd.startPort);
      case "sail": return this.sail(cmd);
      case "sell": return this.sell(cmd.company, cmd.ship, cmd.order);
      case "buyShip": return this.buyShip(cmd.company, cmd.port);
      case "scrapShip": return this.scrapShip(cmd.company, cmd.ship);
      case "placeOrder": return this.placeOrder(cmd);
      case "placeSell": return this.placeSell(cmd);
      case "buyFromOrder": return this.buyFromOrder(cmd);
      case "cancelOrder": return this.cancelOrder(cmd.company, cmd.order, cmd.ship);
      case "adminSet": return this.adminSet(cmd);
    }
  }

  private register(name: string, startPort: number): Result {
    if (!this.isPort(startPort)) return fail("bad start port");
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

  /** Port numbers must be real integers: a string like "5" would sneak through comparisons. */
  private isPort(p: unknown): p is number { return Number.isInteger(p) && (p as number) >= 0 && (p as number) < this.n; }

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
    if (!this.isPort(cmd.dest) || cmd.dest === s.port) return fail("bad destination");
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
    // A company's last ship can always sail: if the cash doesn't cover the fuel, the fuel goes on
    // credit (cash goes negative). The cargo itself must still be paid for. Without this, a company
    // with one empty ship and too little cash for fuel was stuck for the rest of the season.
    const lastShip = c.ships.length === 1;
    if (lastShip ? cargoCost > Math.max(0, c.cash) : cargoCost + fuelCost > c.cash) return fail("not enough cash");

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
      if (!o || o.side !== "buy" || o.port !== s.port || o.good !== s.good) return fail("order doesn't match this ship");
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
    if (!this.isPort(port)) return fail("bad port");
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
    if (!this.isPort(cmd.port)) return fail("bad port");
    const qty = Math.floor(cmd.qty), price = Math.round(cmd.price * 100) / 100;
    const band = this.rules.commodities[cmd.good];
    if (!(qty > 0 && qty <= 1000)) return fail("quantity must be 1 to 1000");
    if (!(price >= band.floor && price <= band.ceiling)) return fail(`price must be between ${band.floor} and ${band.ceiling}`);
    if (qty * price > c.cash) return fail("not enough cash to cover the order");
    if (this.openOrders(c.id) >= MAX_OPEN_ORDERS) return fail(`you can have at most ${MAX_OPEN_ORDERS} open orders`);
    // Fill first from cheaper sell orders already at this port (cheapest first).
    // The goods are delivered to the buyer, who uses them, as with any filled buy order.
    let left = qty;
    const tax = this.rules.fees.trade_tax_rate;
    for (const o of this.matching(cmd.port, g, "sell", c.id).filter(o => o.price <= price)) {
      if (left <= 0) break;
      const fill = Math.min(left, o.qty);
      c.cash -= fill * o.price;
      this.companies.get(o.owner)!.cash += fill * o.price * (1 - tax);
      this.shrink(o, fill);
      left -= fill;
    }
    if (left === 0) return { ok: true };
    c.cash -= left * price;   // held in escrow until filled or cancelled
    const id = this.nextId++;
    this.orders.set(id, { id, owner: c.id, port: cmd.port, good: g, qty: left, price, side: "buy" });
    return { ok: true, id };
  }

  /** List cargo from a docked ship for sale at this port. The ship is then free to sail. */
  private placeSell(cmd: Extract<Command, { type: "placeSell" }>): Result {
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (s.dest !== null) return fail("ship is at sea");
    if (s.qty <= 0 || s.good === null) return fail("nothing to sell");
    const qty = Math.floor(cmd.qty), price = Math.round(cmd.price * 100) / 100;
    if (!(qty > 0 && qty <= s.qty)) return fail("quantity must be between 1 and the cargo on board");
    const band = this.rules.commodities[GOODS[s.good]];
    if (!(price >= band.floor && price <= band.ceiling)) return fail(`price must be between ${band.floor} and ${band.ceiling}`);
    if (this.openOrders(c.id) >= MAX_OPEN_ORDERS) return fail(`you can have at most ${MAX_OPEN_ORDERS} open orders`);
    const g = s.good, tax = this.rules.fees.trade_tax_rate;
    const unitCost = s.cost / s.qty;
    s.qty -= qty; s.cost -= unitCost * qty;
    if (s.qty === 0) { s.good = null; s.cost = 0; }
    // Fill first against higher buy orders at this port (best price first).
    let left = qty;
    for (const o of this.matching(s.port, g, "buy", c.id).filter(o => o.price >= price)) {
      if (left <= 0) break;
      const fill = Math.min(left, o.qty);
      c.cash += fill * o.price * (1 - tax);   // buyer's cash is already in escrow
      this.shrink(o, fill);
      left -= fill;
    }
    if (left === 0) return { ok: true };
    const id = this.nextId++;
    this.orders.set(id, { id, owner: c.id, port: s.port, good: g, qty: left, price, side: "sell", cost: unitCost * left });
    return { ok: true, id };
  }

  /** Buy goods from another player's sell order straight onto a docked ship. */
  private buyFromOrder(cmd: Extract<Command, { type: "buyFromOrder" }>): Result {
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    const o = this.orders.get(cmd.order);
    if (!o || o.side !== "sell") return fail("no such sell order");
    if (o.owner === c.id) return fail("can't buy from your own order");
    if (s.dest !== null || s.port !== o.port) return fail("your ship must be docked at that port");
    if (s.qty > 0 && s.good !== o.good) return fail("ship is carrying a different good");
    const qty = Math.floor(cmd.qty);
    if (!(qty > 0 && qty <= o.qty)) return fail("quantity must be between 1 and the amount listed");
    if (s.qty + qty > this.rules.ship.capacity) return fail("over capacity");
    const pay = qty * o.price;
    if (pay > c.cash) return fail("not enough cash");
    c.cash -= pay;
    this.companies.get(o.owner)!.cash += pay * (1 - this.rules.fees.trade_tax_rate);
    s.good = o.good; s.qty += qty; s.cost += pay;
    this.shrink(o, qty);
    return { ok: true };
  }

  private openOrders(company: number) {
    let n = 0;
    for (const o of this.orders.values()) if (o.owner === company) n++;
    return n;
  }

  /** Other companies' orders on one side at a port, best price first, oldest first on ties. */
  private matching(port: number, good: number, side: "buy" | "sell", notOwner: number): Order[] {
    return [...this.orders.values()]
      .filter(o => o.port === port && o.good === good && o.side === side && o.owner !== notOwner)
      .sort((a, b) => (side === "buy" ? b.price - a.price : a.price - b.price) || a.id - b.id);
  }

  private shrink(o: Order, qty: number) {
    if (o.cost !== undefined) o.cost *= (o.qty - qty) / o.qty;
    o.qty -= qty;
    if (o.qty <= 0) this.orders.delete(o.id);
  }

  private cancelOrder(company: number, orderId: number, shipId?: number): Result {
    const o = this.orders.get(orderId);
    if (!o || o.owner !== company) return fail("not your order");
    if (o.side === "buy") {
      this.companies.get(company)!.cash += o.qty * o.price;
    } else {
      // Unsold goods go back onto one of your ships docked at that port.
      const ships = this.companies.get(company)!.ships.map(id => this.ships.get(id)!)
        .filter(s => s.dest === null && s.port === o.port && (s.qty === 0 || s.good === o.good)
          && s.qty + o.qty <= this.rules.ship.capacity && (shipId === undefined || s.id === shipId));
      const s = ships[0];
      if (!s) return fail("dock a ship with room for the goods at that port to take them back");
      s.good = o.good; s.qty += o.qty; s.cost += o.cost ?? 0;
    }
    this.orders.delete(orderId);
    return { ok: true };
  }

  private adminSet(cmd: Extract<Command, { type: "adminSet" }>): Result {
    // Check everything first so a bad value changes nothing.
    const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
    if (cmd.tax !== undefined && !(num(cmd.tax) && cmd.tax >= 0 && cmd.tax <= 0.3)) return fail("tax must be 0 to 0.3");
    if (cmd.upkeep !== undefined && !(num(cmd.upkeep) && cmd.upkeep >= 0)) return fail("bad upkeep");
    if (cmd.portFee !== undefined && !(num(cmd.portFee) && cmd.portFee >= 0)) return fail("bad port fee");
    if (cmd.tax !== undefined) this.rules.fees.trade_tax_rate = cmd.tax;
    if (cmd.upkeep !== undefined) this.rules.ship.upkeep_per_day = cmd.upkeep;
    if (cmd.portFee !== undefined) this.rules.fees.port_fee_per_docking = cmd.portFee;
    return { ok: true };
  }

  // ------------------------------------------------------------ time

  advance(): void {
    if (this.seasonOver) return;
    this.tick++;
    const cap = this.target * this.rules.markets.max_stock_multiple;
    const k = this.marketScale();
    for (let p = 0; p < this.n; p++)
      for (let g = 0; g < 2; g++)
        this.stock[p][g] = Math.max(0, Math.min(cap, this.stock[p][g] + this.prod[p][g] * k) - this.cons[p][g] * k);

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

  /** Port production and consumption scale with the number of companies. */
  marketScale(): number {
    const m = this.rules.markets;
    if (!m.reference_companies) return 1;
    return Math.max(m.min_scale ?? 0, this.companies.size / m.reference_companies);
  }

  // ------------------------------------------------------------ views

  netWorth(c: Company): number {
    let w = c.cash;
    for (const id of c.ships) w += this.rules.ship.price * 0.5 + this.ships.get(id)!.cost;
    for (const o of this.orders.values())
      if (o.owner === c.id) w += o.side === "buy" ? o.qty * o.price : (o.cost ?? 0);
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
      day: Math.min(this.rules.season.days, Math.floor(this.tick / 24) + 1),
      seasonDays: this.rules.season.days,
      seasonOver: this.seasonOver,
      companies: comps.length,
      ships: this.ships.size,
      moneySupply: Math.round(comps.reduce((a, c) => a + c.cash, 0)),
      escrow: Math.round([...this.orders.values()].filter(o => o.side === "buy").reduce((a, o) => a + o.qty * o.price, 0)),
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
