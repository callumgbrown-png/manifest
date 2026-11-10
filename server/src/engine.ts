// Manifest game engine: the authoritative rules, independent of networking and storage.
// Every change goes through apply() or tick(), so the whole game can be rebuilt by
// replaying the event log. Nothing here uses randomness or the clock.

import { Piracy } from "./piracy.js";
import { Police } from "./police.js";
import { Maritime, type MaritimeCommand, type VoyageProtection } from "./maritime.js";
import { GuildFreight, type GuildBackhaulCommand } from "./guild-freight.js";
import { TradeExpansion, type TradeExpansionCommand } from "./trade-expansion.js";
import { PortExpansion, type PortExpansionCommand } from "./port-expansion.js";
import { PiracyExpansion, type PiracyExpansionCommand } from "./piracy-expansion.js";
import { ExplorationExpansion, type ExplorationExpansionCommand } from "./exploration-expansion.js";
import { FleetExpansion, type FleetExpansionCommand } from "./fleet-expansion.js";
import { EXPANSION_SCENARIOS, ScenarioExpansion, type ExpansionScenario, type ScenarioExpansionCommand } from "./scenario-expansion.js";

export const GOODS = ["grain", "fuel", "ore", "machinery"] as const;
export type Good = (typeof GOODS)[number];
const FUEL = 1;
export const SHIP_TYPES = ["coaster", "freighter", "bulker", "pirate"] as const;
export type ShipType = (typeof SHIP_TYPES)[number];
/** What one ship class can do. upkeep is the daily cost at today's difficulty. */
export interface ShipSpec { capacity: number; speed_per_hour: number; fuel_per_100_distance: number; price: number; upkeep: number }

export interface Rules {
  season: { days: number; hours_per_tick: number };
  commodities: Record<Good, { floor: number; ceiling: number; depth?: number }>;
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
  difficulty?: { default: string; presets: Record<string, { tax: number; portFee: number; upkeep: number; botMinProfit?: number; botError?: number }> };
  company: { start_cash: number; start_ships: number; max_ships: number };
  ship: { price: number; capacity: number; speed_per_hour: number; fuel_per_100_distance: number; upkeep_per_day: number };
  /** Classes a company can buy; `ship` is the freighter. Optional so older rule files still load. */
  ship_types?: Record<ShipType, { capacity: number; speed_per_hour: number; fuel_per_100_distance: number; price: number; upkeep: number }>;
  /** Pirates and police (see docs/PIRATES.md). Absent or `enabled: false` means the old game without them. */
  pirates?: PirateRules;
  police?: PoliceRules;
}
export interface PirateRules {
  enabled: boolean; buy_at_home_only: boolean; home_safe_radius: number; range: number; cooldown_hours: number;
  base_chance: number; speed_weight: number; size_weight: number; min_chance: number; max_chance: number;
  capture_margin: number; failed_raid_cost: number; bot_share: number;
  /** A company with only one ship can't be raided (default true). */ protect_only_ship?: boolean;
  notoriety: { per_raid: number; decay_per_hour: number; max: number };
}
export interface PoliceRules {
  per_companies: number; min_ships: number; max_ships: number; speed_per_hour: number; catch_range: number;
  chase_notoriety: number; catch_base: number; catch_per_notoriety: number; catch_max: number;
  fine_below: number; lockout_below: number; fine_per_point: number; lockout_hours: number; notoriety_after_arrest: number;
}

export interface MapData {
  /** Persisted per season: absent on existing worlds, which keep their original economy. */
  industry?: { version: 1; orePerMachinery: number; factories: number[]; mines: number[] };
  /** Linear size of the world vs the original 1000 x 700 map (absent = 1). Lane `distance` is already divided by it. */
  worldScale?: number;
  ports: { id: number; name: string; x: number; y: number; produces: Good[]; consumes: Good[]; coastDirection?: { dx: number; dy: number } }[];
  routes: { a: number; b: number; distance: number; waypoints?: { x:number; y:number }[] }[];
}

export interface Ship {
  id: number; owner: number; port: number; dest: number | null;
  type: ShipType;
  departTick: number; arriveTick: number;
  good: number | null; qty: number; cost: number;
}
/** `home` is the company's permanent home port: where it starts, its safe harbour, and where it buys ships. */
export interface Company { id: number; name: string; cash: number; ships: number[]; home: number }
/** One voyage, for the player's trip log: what it cost (cargo, fuel, port fee) and what the cargo sold for. */
export interface Trip {
  costs?: { cargo: number; fuel: number; portFees: number; protection?: number; dispatch?: number };
  estimate?: { revenue: number; profit: number; tick: number };
  ship: number; from: number; to: number; good: number | null; qty: number;
  spent: number; earned: number; departTick: number; arriveTick: number;
  /** Still running: at sea, or docked with cargo not yet sold. */
  open: boolean;
  /** Some of its cargo is still listed for sale at a port, so the profit isn't final yet: sales from
   *  the listing are added to `earned` as they happen, and the mark goes once it's all sold or taken back. */
  listed?: boolean;
}
const TRIPS_KEPT = 25;
/** A spare ship the engine sold because its company's cash was below zero at the daily upkeep. */
/** Another company filled (part of) one of your orders: for the owner's "your listing sold" note.
 *  `amount` is what a listing paid you after tax, or what a buy order spent from escrow. */
export interface OrderFill { id: number; order: number; side: "buy" | "sell"; port: number; good: number; qty: number; amount: number; left: number; tick: number }
export interface ForcedSale { ship: number; port: number; tick: number; paid: number; cashBefore: number }
/** A buy order holds cash in escrow; a sell order holds goods at the port. */
export interface Order {
  id: number; owner: number; port: number; good: number; qty: number; price: number;
  side: "buy" | "sell";
  /** Sell orders only: what the seller paid for the goods still listed. */
  cost?: number;
  reservation?: { ship: number; company: number; expires: number; parent: number };
}
const MAX_OPEN_ORDERS = 10;
const QUEUE_DISPATCH_FEE = 10;

export interface VoyageLeg {
  dest: number;
  buy?: { good: Good; qty: number };
  maxSpend: number;
  minProceeds: number;
}

interface VoyageQueue {
  company: number;
  legs: VoyageLeg[];
  sale?: { good: number; qty: number; minProceeds: number };
  paused?: string;
}

export type Command = MaritimeCommand | GuildBackhaulCommand | TradeExpansionCommand | PortExpansionCommand | PiracyExpansionCommand | ExplorationExpansionCommand | FleetExpansionCommand
  | ScenarioExpansionCommand
  | { type: "activateExpansion"; scenario?: ExpansionScenario }
  | { type: "debugCredits"; company: number }
  | { type: "register"; name: string; startPort: number }
  | { type: "sail"; company: number; ship: number; dest: number; buy?: { good: Good; qty: number }; protection?: VoyageProtection }
  | { type: "setVoyageQueue"; company: number; ship: number; legs: VoyageLeg[] }
  | { type: "sell"; company: number; ship: number; order?: number }
  | { type: "buyShip"; company: number; port: number; shipType?: ShipType }
  | { type: "scrapShip"; company: number; ship: number }
  | { type: "placeOrder"; company: number; port: number; good: Good; qty: number; price: number }
  | { type: "placeSell"; company: number; ship: number; qty: number; price: number }
  | { type: "buyFromOrder"; company: number; ship: number; order: number; qty: number }
  | { type: "cancelOrder"; company: number; order: number; ship?: number }
  | { type: "reserveBackhaul"; company: number; ship: number; order: number; qty: number }
  | { type: "raid"; company: number; ship: number; target: number; cargoOnly?: boolean }
  | { type: "adminSet"; tax?: number; upkeep?: number; portFee?: number }
  | { type: "setDifficulty"; level: string };

/** sold/earned: on a listing, how much sold at once to buy orders already waiting, and for how much after tax.
 *  bought/spent: on a buy order, how much it bought at once from listings already at the port, and what that cost. */
export type Result = { ok: true; id?: number; sold?: number; earned?: number; bought?: number; spent?: number;
  /** A raid: how it ended, the chance it had, and how much cargo changed hands (the whole ship's cargo if captured). */
  outcome?: "won" | "lost" | "captured"; chance?: number; loot?: number } | { ok: false; error: string };

export class Engine {
  readonly rules: Rules;
  readonly map: MapData;
  readonly dist: number[][];
  readonly n: number;
  tick = 0;
  readonly voyageQueues = new Map<number, VoyageQueue>();
  stock: number[][];
  companies = new Map<number, Company>();
  ships = new Map<number, Ship>();
  orders = new Map<number, Order>();
  /** Recent trips per company, newest last (for the trip log). */
  trips = new Map<number, Trip[]>();
  /** Net worth per company at the start of each game day (for the progress chart). */
  worthLog = new Map<number, number[]>();
  /** Spare ships sold automatically because cash was below zero when upkeep was charged (newest last). */
  forcedSales = new Map<number, ForcedSale[]>();
  /** Recent fills of each company's orders by other companies, newest last. */
  orderFills = new Map<number, OrderFill[]>();
  private fillSeq = 0;
  /** Cargo bought from a sell order onto a ship with no trip running yet: counted in the next trip's cost. */
  private boughtCost = new Map<number, number>();
  /** The trip each resting listing's goods came from, so a later sale (or a cancel) shows in that
   *  trip's profit. Not sent to clients (orders are sent as they are). */
  private listingTrip = new Map<number, Trip>();
  private nextId = 1;
  /** The difficulty preset in force, or "custom" once an admin changes a value by hand. */
  difficulty: string;
  /** Smallest profit a bot trip must clear under the current difficulty. */
  botMinProfit = 0;
  /** How far off a bot's guess of a sale price can be (0.2 = up to 20% either way). */
  botError = 0;
  /** Market size multiplier, fixed for the season. */
  readonly scale: number;
  /** Stock at which a port's price sits mid-band for a good of depth 1 (grain). */
  readonly target: number;
  /** The same per good: target x the good's market depth (sent to clients for honest estimates). */
  readonly targets: number[];
  /** Freighter upkeep the ship_types figures are quoted against (the Normal-difficulty number). */
  private readonly baseUpkeep: number;
  private prod: number[][];
  private cons: number[][];
  /** Raids, notoriety, lockouts and the notices about them (piracy.ts). */
  readonly piracy: Piracy;
  /** Neutral police ships that patrol and chase pirates (police.ts). */
  readonly police: Police;
  readonly maritime = new Maritime(this);
  readonly guildFreight = new GuildFreight(this);
  expansionEnabled = false;
  readonly tradeExpansion = new TradeExpansion(this);
  readonly portExpansion = new PortExpansion(this);
  readonly piracyExpansion = new PiracyExpansion(this);
  readonly explorationExpansion = new ExplorationExpansion(this);
  readonly fleetExpansion = new FleetExpansion(this);
  readonly scenarioExpansion = new ScenarioExpansion(this);

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
    this.targets = GOODS.map(g => this.target * (rules.commodities[g].depth ?? 1));
    this.baseUpkeep = rules.ship_types?.freighter.upkeep ?? rules.ship.upkeep_per_day;
    const depth = (g: Good) => rules.commodities[g].depth ?? 1;
    this.prod = map.ports.map(p => GOODS.map(g => (p.produces.includes(g) ? m.production_per_hour[g] * k * depth(g) : 0)));
    this.cons = map.ports.map(p => GOODS.map(g => (p.consumes.includes(g) ? m.consumption_per_hour[g] * k * depth(g) : 0)));
    if (map.industry?.version === 1) {
      const chain = map.industry;
      // Ore is consumed by actual factory output, never an additional background sink.
      for (const p of chain.factories) this.cons[p][2] = 0;
      const oreSupply = chain.factories.reduce((sum, p) => sum + this.prod[p][3], 0) * chain.orePerMachinery;
      for (const p of chain.mines) this.prod[p][2] = oreSupply / chain.mines.length;
    }
    // Seasons open with producers stocked up and consumers short, so trade pays from the first hour.
    const spread = m.start_spread ?? 0;
    this.difficulty = rules.difficulty?.default ?? "normal";
    this.botError = rules.difficulty?.presets?.[this.difficulty]?.botError ?? 0;
    if (rules.difficulty) this.setDifficulty(this.difficulty);
    this.stock = map.ports.map(p => GOODS.map(g => {
      const makes = p.produces.includes(g), needs = p.consumes.includes(g);
      return this.targets[GOODS.indexOf(g)] * (1 + (makes && !needs ? spread : 0) - (needs && !makes ? spread : 0));
    }));
    this.piracy = new Piracy(this);
    this.police = new Police(this, this.piracy);
  }

  // ------------------------------------------------------------ market maths

  price(port: number, g: number, stock = this.stock[port][g]): number {
    const c = this.rules.commodities[GOODS[g]];
    const frac = Math.min(1, Math.max(0, 1 - stock / (2 * this.targets[g])));
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

  /** Stats of a ship class. The freighter is `rules.ship`, so its upkeep follows the difficulty directly;
   *  the other classes' upkeep is scaled by the same ratio. An unknown type falls back to the freighter. */
  spec(type: ShipType = "freighter"): ShipSpec {
    const r = this.rules, f = r.ship;
    const t = type !== "freighter" && Object.hasOwn(r.ship_types ?? {}, type) ? r.ship_types![type] : undefined;
    if (!t) return { capacity: f.capacity, speed_per_hour: f.speed_per_hour, fuel_per_100_distance: f.fuel_per_100_distance, price: f.price, upkeep: f.upkeep_per_day };
    return { ...t, upkeep: t.upkeep * (f.upkeep_per_day / this.baseUpkeep) };
  }

  voyageHours(from: number, to: number, type: ShipType = "freighter"): number {
    return Math.max(1, Math.ceil(this.dist[from][to] / this.spec(type).speed_per_hour));
  }

  fuelNeeded(from: number, to: number, type: ShipType = "freighter"): number {
    return (this.dist[from][to] * this.spec(type).fuel_per_100_distance) / 100;
  }

  /** What a company pays at each daily upkeep: every ship's upkeep less one freighter's worth, so a
   *  lone freighter or coaster is free (a company's first ship always was) and a lone bulker is not. */
  upkeepDue(c: Company): number {
    let sum = 0;
    for (const id of c.ships) sum += this.spec(this.ships.get(id)!.type).upkeep;
    const base = Math.max(0, sum - this.spec("freighter").upkeep);
    return base + this.maritime.upkeep(c, base);
  }

  // ------------------------------------------------------------ commands

  /** Pirates and police are part of this world. */
  get piratesOn(): boolean { return this.rules.pirates?.enabled === true && !!this.rules.ship_types?.pirate; }

  /** Shared with recovery quotes; fuel is purchased after any fuel cargo. */
  private sailFuel(s: Ship, dest: number, good = -1, qty = 0) {
    const base = this.fuelNeeded(s.port, dest, s.type);
    const needed = this.expansionEnabled ? this.fleetExpansion.fuelNeeded(s, dest, base) : base;
    const stock = this.stock[s.port][FUEL] - (good === FUEL ? qty : 0);
    const have = Math.min(needed, Math.max(0, stock));
    return { have, cost: have * this.price(s.port, FUEL, stock - have / 2)
      + (needed - have) * this.rules.commodities.fuel.ceiling };
  }

  /** Only called for a command already rejected for insufficient cash. */
  cashRequired(cmd: Command): number | null {
    if (!("company" in cmd)) return null;
    const c = this.companies.get(cmd.company);
    if (!c) return null;
    if (cmd.type === "buyShip") return this.spec(cmd.shipType).price;
    if (cmd.type === "placeOrder") return Math.floor(cmd.qty) * (Math.round(cmd.price * 100) / 100);
    if (cmd.type === "buyFromOrder") return Math.floor(cmd.qty) * (this.orders.get(cmd.order)?.price ?? 0);
    if (cmd.type === "sail") {
      const result = this.voyageQuote(cmd);
      return result.ok && "quote" in result ? result.quote.requiredCash : null;
    }
    return null;
  }

  get seasonHours(): number { return this.scenarioExpansion.seasonHours(this.rules.season.days * 24); }
  get seasonOver(): boolean { return this.tick >= this.seasonHours; }

  /** Validate new commands. Historical logs use apply() to preserve their original outcomes. */
  applyLive(cmd: Command): Result {
    if (cmd.type === "sail" || cmd.type === "sell") {
      const queue = this.voyageQueues.get(cmd.ship);
      if (queue?.company === cmd.company && !queue.paused)
        return fail("cancel the voyage queue before taking manual control");
    }
    if (cmd.type === "raid") {
      const ship = this.ships.get(cmd.ship);
      if (ship?.owner === cmd.company && ship.type === "pirate" && ship.dest === null)
        return { ok: false, error: "Your pirate ship must be underway to raid." };
    }
    return this.apply(cmd);
  }

  apply(cmd: Command): Result {
    if (this.seasonOver && cmd.type !== "adminSet" && cmd.type !== "setDifficulty") return fail("the season has ended");
    switch (cmd.type) {
      case "activateExpansion":
        if (this.expansionEnabled) return fail("opportunities are already open");
        if (cmd.scenario && (!EXPANSION_SCENARIOS.includes(cmd.scenario) || (cmd.scenario !== "classic" && (this.tick > 0 || this.companies.size > 0))))
          return fail("choose a valid scenario before the season starts");
        this.expansionEnabled = true;
        this.scenarioExpansion.activate(cmd.scenario ?? "classic");
        this.portExpansion.activate();
        this.explorationExpansion.activate();
        return { ok: true };
      case "expansion":
        if (!this.expansionEnabled) return fail("opportunities are closed");
        if (cmd.feature === "trade") return this.tradeExpansion.apply(cmd);
        if (cmd.feature === "ports") return this.portExpansion.apply(cmd);
        if (cmd.feature === "piracy") return this.piracyExpansion.apply(cmd);
        if (cmd.feature === "exploration") return this.explorationExpansion.apply(cmd);
        if (cmd.feature === "fleet") return this.fleetExpansion.apply(cmd);
        if (cmd.feature === "season") return this.scenarioExpansion.apply(cmd);
        return fail("unknown opportunity");
      case "register": return this.register(cmd.name, cmd.startPort);
      case "debugCredits": {
        const company = this.companies.get(cmd.company);
        if (!company) return fail("no such company");
        company.cash += 100_000;
        return { ok: true };
      }
      case "sail": return this.sail(cmd);
      case "setVoyageQueue": return this.setVoyageQueue(cmd);
      case "sell": return this.sell(cmd.company, cmd.ship, cmd.order);
      case "buyShip": return this.buyShip(cmd.company, cmd.port, cmd.shipType);
      case "scrapShip": return this.scrapShip(cmd.company, cmd.ship);
      case "placeOrder": return this.placeOrder(cmd);
      case "placeSell": return this.placeSell(cmd);
      case "buyFromOrder": return this.buyFromOrder(cmd);
      case "cancelOrder": return this.cancelOrder(cmd.company, cmd.order, cmd.ship);
      case "reserveBackhaul": return this.reserveBackhaul(cmd);
      case "dispatchGuildBackhaul": return this.guildFreight.dispatch(cmd);
      case "raid": return this.piracy.raid(cmd);
      case "adminSet": return this.adminSet(cmd);
      case "setDifficulty": return this.setDifficulty(cmd.level);
      case "activateMaritimeRules":
      case "emergencyCredit":
      case "emergencyConsignment":
      case "insureCargo":
      case "bookConvoy":
      case "machineryFuture":
      case "fundBounty":
      case "offerEscort":
      case "acceptEscort":
      case "commissionConvoy":
      case "upgradeHarbor":
      case "buyPennant":
      case "fenceCargo": return this.maritime.apply(cmd);
    }
  }

  private setVoyageQueue(cmd: Extract<Command, { type: "setVoyageQueue" }>): Result {
    const blocked = this.scenarioExpansion.queueError();
    if (blocked) return fail(blocked);
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    if (!Array.isArray(cmd.legs) || cmd.legs.length > 3) return fail("queue up to three voyage legs");
    if (cmd.legs.length === 0) {
      this.voyageQueues.delete(cmd.ship);
      return { ok: true };
    }
    const { s } = own;
    const old = this.voyageQueues.get(s.id);
    let from = s.dest ?? s.port;
    const legs: VoyageLeg[] = [];
    for (const leg of cmd.legs) {
      if (!leg || !this.isPort(leg.dest) || leg.dest === from || !Number.isFinite(this.dist[from][leg.dest]))
        return fail("choose a reachable destination for each leg");
      if (!Number.isFinite(leg.maxSpend) || leg.maxSpend <= 0 ||
          !Number.isFinite(leg.minProceeds) || leg.minProceeds < 0)
        return fail("enter valid spending and sale limits");
      if (leg.buy && (!GOODS.includes(leg.buy.good) || !Number.isInteger(leg.buy.qty) ||
          leg.buy.qty < 1 || leg.buy.qty > this.expansionCapacity(s)))
        return fail("enter valid cargo for each leg");
      legs.push({
        dest: leg.dest, maxSpend: leg.maxSpend, minProceeds: leg.minProceeds,
        ...(leg.buy ? { buy: { good: leg.buy.good, qty: leg.buy.qty } } : {}),
      });
      from = leg.dest;
    }
    if (s.qty > 0 && (!old?.sale || old.paused)) return fail("sell existing cargo before starting a queue");
    this.voyageQueues.set(s.id, { company: cmd.company, legs, sale: old?.paused ? undefined : old?.sale });
    return { ok: true };
  }

  private runVoyageQueues() {
    for (const [id, plan] of this.voyageQueues) {
      const ship = this.ships.get(id);
      if (!ship || ship.owner !== plan.company) {
        this.voyageQueues.delete(id);
        continue;
      }
      if (this.seasonOver) { plan.paused = "The season has ended."; continue; }
      if (ship.dest !== null || plan.paused || this.piracy.lockoutHours(plan.company) > 0) continue;
      if (plan.sale) {
        const { good, qty, minProceeds } = plan.sale;
        if (ship.good !== good || ship.qty !== qty) {
          plan.paused = "Cargo changed during the voyage. Review the remaining load.";
          continue;
        }
        const net = this.sellValue(ship.port, good, qty) * (1 - this.rules.fees.trade_tax_rate);
        if (net < minProceeds) {
          plan.paused = "The sale quote is below your minimum proceeds.";
          continue;
        }
        const sold = this.sell(plan.company, id);
        if (!sold.ok) { plan.paused = sold.error; continue; }
        delete plan.sale;
      }
      const leg = plan.legs[0];
      if (!leg) { this.voyageQueues.delete(id); continue; }
      if (ship.qty > 0) { plan.paused = "Sell the existing cargo before dispatch."; continue; }
      const command = { type: "sail" as const, company: plan.company, ship: id, dest: leg.dest, buy: leg.buy };
      const result = this.voyageQuote(command);
      if (!result.ok || !("quote" in result)) {
        plan.paused = result.ok ? "No voyage quote." : result.error;
        continue;
      }
      const quote = result.quote;
      const company = this.companies.get(plan.company)!;
      const dispatchFee = this.maritime.enabled ? QUEUE_DISPATCH_FEE : 0;
      const cost = quote.cargoCost + quote.fuelCost + quote.portFee + dispatchFee;
      if (this.tick + quote.hours >= this.seasonHours) { plan.paused = "The voyage cannot finish before the season ends."; continue; }
      if (!quote.affordable || cost + quote.fleetUpkeep > company.cash) {
        plan.paused = "Cash does not cover this leg, its docking fee and scheduled upkeep.";
        continue;
      }
      if (cost > leg.maxSpend) { plan.paused = "The departure quote is above your spending limit."; continue; }
      const sailed = this.sail(command);
      if (!sailed.ok) { plan.paused = sailed.error; continue; }
      if (dispatchFee > 0) {
        company.cash -= dispatchFee;
        const trip = this.openTrip(plan.company, id)!;
        trip.spent += dispatchFee;
        if (trip.costs) trip.costs.dispatch = dispatchFee;
        if (trip.estimate) trip.estimate.profit -= dispatchFee;
      }
      plan.legs.shift();
      if (leg.buy) plan.sale = { good: quote.g, qty: quote.qty, minProceeds: leg.minProceeds };
    }
  }

  /** The ship's trip still running, if any. */
  openTrip(company: number, ship: number) {
    const list = this.trips.get(company);
    for (let i = (list?.length ?? 0) - 1; i >= 0; i--) if (list![i].ship === ship) return list![i].open ? list![i] : undefined;
    return undefined;
  }
  private noteEarned(company: number, ship: number, amount: number, emptied: boolean) {
    const trip = this.openTrip(company, ship);
    if (trip) { trip.earned += amount; if (emptied) trip.open = false; }
  }

  private register(name: string, startPort: number): Result {
    if (!this.isPort(startPort)) return fail("bad start port");
    const id = this.nextId++;
    const c: Company = { id, name, cash: this.rules.company.start_cash, ships: [], home: startPort };
    this.companies.set(id, c);
    if (!this.scenarioExpansion.register(c))
      for (let i = 0; i < this.rules.company.start_ships; i++) this.addShip(c, startPort);
    this.worthLog.set(id, [Math.round(this.netWorth(c))]);
    return { ok: true, id };
  }

  private addShip(c: Company, port: number, type: ShipType = "freighter"): Ship {
    const s: Ship = { id: this.nextId++, owner: c.id, port, type, dest: null, departTick: 0, arriveTick: 0, good: null, qty: 0, cost: 0 };
    this.ships.set(s.id, s);
    c.ships.push(s.id);
    return s;
  }

  addExpansionShip(company: Company, port: number, type: ShipType): Ship {
    return this.addShip(company, port, type);
  }

  expansionCapacity(ship: Ship): number {
    const base = this.spec(ship.type).capacity;
    if (!this.expansionEnabled) return base;
    return Math.max(0, this.fleetExpansion.capacity(ship, base) - this.explorationExpansion.spaceTaken(ship));
  }

  recordCargoLoaded(ship: Ship, cost: number) {
    const trip = this.openTrip(ship.owner, ship.id);
    if (trip) {
      trip.spent += cost;
      trip.qty = ship.qty;
      if (trip.costs) trip.costs.cargo += cost;
      delete trip.estimate;
    } else {
      this.boughtCost.set(ship.id, (this.boughtCost.get(ship.id) ?? 0) + cost);
    }
    this.maritime.dockedCargoChanged(ship);
  }

  /** Port numbers must be real integers: a string like "5" would sneak through comparisons. */
  private isPort(p: unknown): p is number { return Number.isInteger(p) && (p as number) >= 0 && (p as number) < this.n; }

  private ownShip(company: number, shipId: number): { c: Company; s: Ship } | string {
    const c = this.companies.get(company);
    const s = this.ships.get(shipId);
    if (!c || !s || s.owner !== company) return "not your ship";
    return { c, s };
  }

  /** A non-mutating quote using the exact departure validation and purchase maths. */
  voyageQuote(cmd: Extract<Command, { type: "sail" }>) {
    if (this.seasonOver) return fail("the season has ended");
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (s.dest !== null) return fail("ship is at sea");
    const locked = this.piracy.lockoutHours(c.id);
    if (locked > 0) return fail(`your company is locked out of ports for ${locked} more hours`);
    if (!this.isPort(cmd.dest) || cmd.dest === s.port) return fail("bad destination");
    if (!Number.isFinite(this.dist[s.port][cmd.dest])) return fail("no route");
    const blocked = this.portExpansion.destinationError(s, cmd.dest);
    if (blocked) return fail(blocked);
    const tax = this.rules.fees.trade_tax_rate;
    let purchaseRate = tax;

    let cargoCost = 0, g = -1, qty = 0;
    if (cmd.buy) {
      g = GOODS.indexOf(cmd.buy.good);
      qty = Math.floor(cmd.buy.qty);
      if (g < 0 || !(qty > 0)) return fail("bad cargo");
      if (s.qty > 0) return fail("ship already loaded; sell first");
      if (qty > this.expansionCapacity(s)) return fail("over capacity");
      if (qty > this.stock[s.port][g]) return fail("not enough stock at this port");
      purchaseRate = this.portExpansion.tradeTax(s.port, g, "buy", tax);
      cargoCost = this.buyCost(s.port, g, qty).cost * (1 + purchaseRate);
    }
    // Fuel is bought after the cargo, so a fuel cargo raises the fuel price slightly.
    const { have: fuelHave, cost: fuelCost } = this.sailFuel(s, cmd.dest, g, qty);
    // A company's last ship can always sail: if the cash doesn't cover the fuel, the fuel goes on
    // credit (cash goes negative). The cargo itself must still be paid for. Without this, a company
    // with one empty ship and too little cash for fuel was stuck for the rest of the season.
    const baseHours = this.voyageHours(s.port, cmd.dest, s.type);
    const hours = baseHours + (this.expansionEnabled ? this.explorationExpansion.weatherDelay(cmd.dest, this.tick + baseHours) : 0);
    const cargoGood = cmd.buy ? g : s.good, cargoQty = cmd.buy ? qty : s.qty;
    const cargoBasis = cmd.buy ? cargoCost : s.cost;
    const protection = this.maritime.quoteProtection(s, cargoBasis, cargoQty > 0, cmd.protection);
    if (typeof protection === "string") return fail(protection);
    const protectionCost = protection.insurancePremium + protection.convoyFee;
    const lastShip = c.ships.length === 1;
    const requiredCash = cargoCost + protectionCost + (lastShip ? 0 : fuelCost);
    const affordable = requiredCash <= (lastShip ? Math.max(0, c.cash) : c.cash);
    const inbound = [...this.ships.values()].filter(other => other.dest === cmd.dest && other.good === cargoGood && other.arriveTick <= this.tick + hours).reduce((sum, other) => sum + other.qty, 0);
    const gross = cargoGood !== null && cargoGood >= 0 && cargoQty > 0
      ? cargoQty * this.price(cmd.dest, cargoGood, this.stock[cmd.dest][cargoGood] + inbound + cargoQty / 2) : 0;
    const cargoBase = cmd.buy ? cargoCost / (1 + purchaseRate) : 0;
    const ongoing = !cmd.buy && s.qty > 0 ? this.openTrip(c.id, s.id) : undefined;
    const priorCosts = ongoing ? Math.max(0, ongoing.spent - cargoBasis) : 0;
    const priorRevenue = ongoing?.earned ?? 0;
    const maritimeFee = this.maritime.fee(c, s.port, cmd.dest);
    const basePortFee = this.expansionEnabled ? this.fleetExpansion.fee(s, s.port, cmd.dest, maritimeFee) : maritimeFee;
    const portFee = this.portExpansion.quoteFee(s, cmd.dest, this.tick + hours, basePortFee);
    const saleRate = cargoGood === null || cargoGood < 0 ? tax : this.portExpansion.tradeTax(cmd.dest, cargoGood, "sell", tax);
    const days = Math.floor((this.tick + hours) / 24) - Math.floor(this.tick / 24);
    return { ok: true as const, quote: {
      cargoCost, cargoBase, purchaseTax: cargoCost - cargoBase, cargoBasis, priorCosts, priorRevenue,
      fuelCost, fuelHave, g, qty, hours, affordable, requiredCash, ...protection,
      basePortFee, portFee, saleTax: gross * saleRate, revenue: gross * (1 - saleRate),
      profit: gross * (1 - saleRate) + priorRevenue - cargoBasis - priorCosts - fuelCost - portFee - protectionCost,
      fleetUpkeep: this.upkeepDue(c) * days,
      cashAfterDeparture: c.cash - cargoCost - fuelCost - protectionCost,
      inbound, tick: this.tick,
    } };
  }

  private sail(cmd: Extract<Command, { type: "sail" }>): Result {
    const quoted = this.voyageQuote(cmd);
    if (!quoted.ok || !("quote" in quoted)) return quoted;
    const q = quoted.quote;
    if (!q.affordable) return fail("not enough cash");
    const s = this.ships.get(cmd.ship)!, c = this.companies.get(cmd.company)!;
    const { cargoCost, fuelCost, fuelHave, g, qty, insurancePremium, convoyFee } = q;
    const protectionCost = insurancePremium + convoyFee;

    if (cmd.buy) {
      this.stock[s.port][g] -= qty;
      s.good = g; s.qty = qty; s.cost = cargoCost;
    }
    this.stock[s.port][FUEL] = Math.max(0, this.stock[s.port][FUEL] - fuelHave);
    c.cash -= cargoCost + fuelCost + protectionCost;
    this.maritime.attachProtection(s, insurancePremium, convoyFee);
    const arrive = this.tick + q.hours;
    const open = this.openTrip(c.id, s.id);
    if (open && !cmd.buy && s.qty > 0) {
      // Carrying the same cargo on: one trip, now ending at the new port.
      open.spent += fuelCost + protectionCost; open.to = cmd.dest; open.arriveTick = arrive;
      if (open.costs) {
        open.costs.fuel += fuelCost;
        if (protectionCost) open.costs.protection = (open.costs.protection ?? 0) + protectionCost;
        open.estimate = { revenue: q.revenue + open.earned, profit: q.revenue + open.earned - open.spent - q.portFee, tick: this.tick };
      }
    } else {
      if (open) open.open = false;
      const list = this.trips.get(c.id) ?? [];
      const bought = s.qty > 0 && !cmd.buy ? this.boughtCost.get(s.id) ?? 0 : 0;
      this.boughtCost.delete(s.id);
      list.push({ ship: s.id, from: s.port, to: cmd.dest, good: s.qty > 0 ? s.good : null, qty: s.qty,
        costs: { cargo: cargoCost + bought, fuel: fuelCost, portFees: 0, ...(protectionCost ? { protection: protectionCost } : {}) },
        estimate: { revenue: q.revenue, profit: q.profit, tick: this.tick },
        spent: cargoCost + fuelCost + protectionCost + bought, earned: 0, departTick: this.tick, arriveTick: arrive, open: true });
      if (list.length > TRIPS_KEPT) list.shift();
      this.trips.set(c.id, list);
    }
    this.maritime.depart(s, cmd.dest, q.basePortFee);
    s.dest = cmd.dest;
    s.departTick = this.tick;
    s.arriveTick = arrive;
    return { ok: true };
  }

  private sell(company: number, shipId: number, orderId?: number, fixedNet?: number): Result {
    const own = this.ownShip(company, shipId);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (s.dest !== null) return fail("ship is at sea");
    if (this.maritime.hasLoot(s)) return fail("fence stolen cargo at your home port");
    if (s.qty <= 0 || s.good === null) return fail("nothing to sell");
    const tax = this.rules.fees.trade_tax_rate;
    if (orderId !== undefined) {
      const o = this.orders.get(orderId);
      if (!o || o.side !== "buy" || o.port !== s.port || o.good !== s.good) return fail("order doesn't match this ship");
      if (o.owner === company) return fail("can't fill your own order");
      if (o.reservation && (o.reservation.company !== company || o.reservation.ship !== shipId))
        return fail("that return load is reserved by another ship");
      const fill = Math.min(o.qty, s.qty);
      const gross = fill * o.price;
      const net = gross * (1 - tax);
      const paid = net - (this.expansionEnabled ? this.fleetExpansion.leaseCut(s, net) : 0);
      c.cash += paid;
      this.noteEarned(c.id, s.id, paid, s.qty - fill === 0);
      // The goods are delivered to the buyer, who uses them; they leave the market.
      this.noteFill(o, fill, gross);
      o.qty -= fill;
      if (o.qty <= 0) this.orders.delete(o.id);
      s.cost *= (s.qty - fill) / s.qty;
      s.qty -= fill;
      this.maritime.cargoMoved(s, fill);
    } else {
      const net = fixedNet ?? this.sellValue(s.port, s.good, s.qty) * (1 - this.portExpansion.tradeTax(s.port, s.good, "sell", tax));
      this.stock[s.port][s.good] += s.qty;
      const paid = net - (this.expansionEnabled ? this.fleetExpansion.leaseCut(s, net) : 0);
      c.cash += paid;
      this.noteEarned(c.id, s.id, paid, true);
      s.qty = 0; s.cost = 0;
      this.maritime.cargoMoved(s, Infinity);
    }
    if (s.qty === 0) { s.good = null; this.boughtCost.delete(s.id); }
    this.maritime.dockedCargoChanged(s);
    return { ok: true };
  }

  recordSpecialSale(ship: Ship, revenue: number) {
    this.noteEarned(ship.owner, ship.id, revenue, ship.qty === 0);
    if (ship.qty === 0) this.boughtCost.delete(ship.id);
  }

  private buyShip(company: number, port: number, type: unknown = "freighter"): Result {
    const c = this.companies.get(company);
    if (!c) return fail("no company");
    if (!this.isPort(port)) return fail("bad port");
    if (typeof type !== "string" || !(SHIP_TYPES as readonly string[]).includes(type)) return fail("unknown ship class");
    if (type !== "freighter" && !this.rules.ship_types) return fail("unknown ship class");
    if (type === "pirate") {
      if (!this.piratesOn) return fail("there are no pirate ships in this world");
      if (this.rules.pirates!.buy_at_home_only && (port !== c.home || (this.expansionEnabled && !this.fleetExpansion.homeActive(c))))
        return fail("pirate ships are sold only at your home port");
    }
    const price = this.spec(type as ShipType).price;
    if (c.ships.length + (this.expansionEnabled ? this.fleetExpansion.reservedSlots(c) : 0) >= this.rules.company.max_ships)
      return fail("fleet is at its maximum");
    if (c.cash < price) return fail("not enough cash");
    const docked = c.ships.some(id => { const s = this.ships.get(id)!; return s.dest === null && s.port === port; });
    if (!docked) return fail("you need a ship docked at that port");
    c.cash -= price;
    return { ok: true, id: this.addShip(c, port, type as ShipType).id };
  }

  private scrapShip(company: number, shipId: number): Result {
    const own = this.ownShip(company, shipId);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (c.ships.length <= 1) return fail("you must keep one ship");
    if (this.expansionEnabled && this.fleetExpansion.leased(s)) return fail("pay off the ship lease before selling");
    if (this.expansionEnabled && this.explorationExpansion.spaceTaken(s)) return fail("unload the offshore cargo first");
    if (s.dest !== null || s.qty > 0) return fail("ship must be docked and empty");
    this.removeShip(c, s);
    c.cash += this.spec(s.type).price * 0.5;
    return { ok: true };
  }

  removeShip(c: Company, s: Ship) {
    if (this.expansionEnabled) {
      this.explorationExpansion.removeShip(s);
      this.fleetExpansion.removed(s);
    }
    this.maritime.removeShip(s);
    this.guildFreight.release(s.id);
    const trip = this.openTrip(c.id, s.id);
    if (trip) trip.open = false;
    this.voyageQueues.delete(s.id);
    this.ships.delete(s.id);
    this.boughtCost.delete(s.id);
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
    let left = qty, spent = 0;
    const tax = this.rules.fees.trade_tax_rate;
    for (const o of this.matching(cmd.port, g, "sell", c.id).filter(o => o.price <= price)) {
      if (left <= 0) break;
      const fill = Math.min(left, o.qty);
      c.cash -= fill * o.price;
      spent += fill * o.price;
      this.listingSold(o, fill, fill * o.price * (1 - tax));
      this.shrink(o, fill);
      left -= fill;
    }
    const bought = qty - left, now = bought ? { bought, spent: Math.round(spent * 100) / 100 } : {};
    if (left === 0) return { ok: true, ...now };
    c.cash -= left * price;   // held in escrow until filled or cancelled
    const id = this.nextId++;
    this.orders.set(id, { id, owner: c.id, port: cmd.port, good: g, qty: left, price, side: "buy" });
    return { ok: true, id, ...now };
  }

  /** List cargo from a docked ship for sale at this port. The ship is then free to sail. */
  private placeSell(cmd: Extract<Command, { type: "placeSell" }>): Result {
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    if (this.expansionEnabled && this.fleetExpansion.leased(s)) return fail("sell leased-ship cargo directly to repay the lease");
    if (s.dest !== null) return fail("ship is at sea");
    if (this.maritime.hasLoot(s)) return fail("fence stolen cargo at your home port");
    if (s.qty <= 0 || s.good === null) return fail("nothing to sell");
    const qty = Math.floor(cmd.qty), price = Math.round(cmd.price * 100) / 100;
    if (!(qty > 0 && qty <= s.qty)) return fail("quantity must be between 1 and the cargo on board");
    const band = this.rules.commodities[GOODS[s.good]];
    if (!(price >= band.floor && price <= band.ceiling)) return fail(`price must be between ${band.floor} and ${band.ceiling}`);
    if (this.openOrders(c.id) >= MAX_OPEN_ORDERS) return fail(`you can have at most ${MAX_OPEN_ORDERS} open orders`);
    const g = s.good, tax = this.rules.fees.trade_tax_rate;
    const unitCost = s.cost / s.qty;
    s.qty -= qty; s.cost -= unitCost * qty;
    this.maritime.cargoMoved(s, qty);
    this.maritime.dockedCargoChanged(s);
    if (s.qty === 0) { s.good = null; s.cost = 0; this.boughtCost.delete(s.id); }
    const trip = this.openTrip(c.id, s.id);
    if (trip && s.qty === 0) trip.open = false;
    // Fill first against higher buy orders at this port (best price first).
    let left = qty, earned = 0;
    for (const o of this.matching(s.port, g, "buy", c.id).filter(o => o.price >= price)) {
      if (left <= 0) break;
      const fill = Math.min(left, o.qty);
      c.cash += fill * o.price * (1 - tax);   // buyer's cash is already in escrow
      earned += fill * o.price * (1 - tax);
      if (trip) trip.earned += fill * o.price * (1 - tax);
      this.noteFill(o, fill, fill * o.price);
      this.shrink(o, fill);
      left -= fill;
    }
    const sold = qty - left, now = sold ? { sold, earned: Math.round(earned * 100) / 100 } : {};
    if (left === 0) return { ok: true, ...now };
    const id = this.nextId++;
    this.orders.set(id, { id, owner: c.id, port: s.port, good: g, qty: left, price, side: "sell", cost: unitCost * left });
    if (trip) { trip.listed = true; this.listingTrip.set(id, trip); }
    return { ok: true, id, ...now };
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
    if (s.qty + qty > this.expansionCapacity(s)) return fail("over capacity");
    const pay = qty * o.price;
    if (pay > c.cash) return fail("not enough cash");
    c.cash -= pay;
    this.listingSold(o, qty, pay * (1 - this.rules.fees.trade_tax_rate));
    s.good = o.good; s.qty += qty; s.cost += pay;
    this.maritime.dockedCargoChanged(s);
    // The trip log counts what the cargo cost, so its profit matches the change in cash.
    const trip = this.openTrip(c.id, s.id);
    if (trip) { trip.spent += pay; trip.qty += qty; if (trip.costs) trip.costs.cargo += pay; delete trip.estimate; }
    else this.boughtCost.set(s.id, (this.boughtCost.get(s.id) ?? 0) + pay);
    this.shrink(o, qty);
    return { ok: true };
  }

  private openOrders(company: number) {
    let n = 0;
    for (const o of this.orders.values()) if (o.owner === company) n++;
    return n;
  }

  private reserveBackhaul(cmd: Extract<Command, { type: "reserveBackhaul" }>): Result {
    if (!this.maritime.enabled) return fail("funded backhauls are unavailable");
    const own = this.ownShip(cmd.company, cmd.ship);
    if (typeof own === "string") return fail(own);
    const { c, s } = own;
    const order = this.orders.get(cmd.order);
    const last = this.trips.get(c.id)?.slice().reverse().find(trip => trip.ship === s.id);
    if (!order || order.side !== "buy" || order.owner === c.id || order.reservation
      || !last || last.to !== s.port || order.port !== last.from)
      return fail("no funded return order for this ship");
    const qty = Math.floor(cmd.qty);
    if (!(qty > 0 && qty <= order.qty)) return fail("invalid return quantity");
    const departure = { type: "sail" as const, company: c.id, ship: s.id, dest: order.port, buy: { good: GOODS[order.good], qty } };
    const q = this.voyageQuote(departure);
    if (!q.ok || !("quote" in q)) return q;
    if (this.tick + q.quote.hours > this.seasonHours) return fail("the season ends before the ship docks");
    if (qty * order.price * (1 - this.rules.fees.trade_tax_rate) <= q.quote.cargoCost + q.quote.fuelCost + q.quote.portFee)
      return fail("the funded return order does not cover the current voyage costs");
    const sailing = this.applyLive(departure);
    if (!sailing.ok) return sailing;
    const id = this.nextId++;
    this.orders.set(id, { ...order, id, qty,
      reservation: { ship: s.id, company: c.id, expires: s.arriveTick, parent: order.id } });
    this.shrink(order, qty);
    return { ok: true, id };
  }

  /** Other companies' orders on one side at a port, best price first, oldest first on ties. */
  private matching(port: number, good: number, side: "buy" | "sell", notOwner: number): Order[] {
    return [...this.orders.values()]
      .filter(o => o.port === port && o.good === good && o.side === side && o.owner !== notOwner && !o.reservation)
      .sort((a, b) => (side === "buy" ? b.price - a.price : a.price - b.price) || a.id - b.id);
  }

  /** Pay the seller for goods sold from their listing, and count it in the trip they came from. */
  private listingSold(o: Order, qty: number, net: number) {
    this.companies.get(o.owner)!.cash += net;
    const trip = this.listingTrip.get(o.id);
    if (trip) trip.earned += net;
    this.noteFill(o, qty, net);
  }
  /** Record a fill for the order's owner (call before the order shrinks). */
  private noteFill(o: Order, qty: number, amount: number) {
    const list = this.orderFills.get(o.owner) ?? [];
    list.push({ id: ++this.fillSeq, order: o.id, side: o.side, port: o.port, good: o.good, qty, amount, left: o.qty - qty, tick: this.tick });
    this.orderFills.set(o.owner, list.slice(-10));
  }

  private shrink(o: Order, qty: number) {
    if (o.cost !== undefined) o.cost *= (o.qty - qty) / o.qty;
    o.qty -= qty;
    if (o.qty <= 0) this.removeOrder(o.id);
  }

  /** Drop an order; a trip whose listed goods are all sold or taken back loses its "listed" mark. */
  private removeOrder(id: number) {
    this.orders.delete(id);
    const trip = this.listingTrip.get(id);
    this.listingTrip.delete(id);
    if (trip && ![...this.listingTrip.values()].includes(trip)) delete trip.listed;
  }

  private cancelOrder(company: number, orderId: number, shipId?: number): Result {
    const o = this.orders.get(orderId);
    if (!o || o.owner !== company) return fail("not your order");
    if (o.reservation) return fail("a ship is already delivering that funded return load");
    if (o.side === "buy") {
      this.companies.get(company)!.cash += o.qty * o.price;
    } else {
      // Unsold goods go back onto one of your ships docked at that port.
      const ships = this.companies.get(company)!.ships.map(id => this.ships.get(id)!)
        .filter(s => s.dest === null && s.port === o.port && (s.qty === 0 || s.good === o.good)
          && s.qty + o.qty <= this.expansionCapacity(s) && (shipId === undefined || s.id === shipId));
      const s = ships[0];
      if (!s) return fail("dock a ship with room for the goods at that port to take them back");
      s.good = o.good; s.qty += o.qty; s.cost += o.cost ?? 0;
      this.maritime.dockedCargoChanged(s);
      // The goods' cost moves from the trip they were listed from to the ship's next trip.
      const from = this.listingTrip.get(o.id), cost = o.cost ?? 0;
      if (from) { from.spent -= cost; if (from.costs) from.costs.cargo -= cost; delete from.estimate; }
      const now = this.openTrip(company, s.id);
      if (now) { now.spent += cost; if (now.costs) now.costs.cargo += cost; delete now.estimate; }
      else this.boughtCost.set(s.id, (this.boughtCost.get(s.id) ?? 0) + cost);
    }
    this.removeOrder(orderId);
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
    if (cmd.tax !== undefined || cmd.upkeep !== undefined || cmd.portFee !== undefined) this.difficulty = this.matchPreset();
    return { ok: true };
  }

  private setDifficulty(level: string): Result {
    const p = this.rules.difficulty?.presets;
    if (!p || typeof level !== "string" || !Object.hasOwn(p, level)) return fail("unknown difficulty");
    this.rules.fees.trade_tax_rate = p[level].tax;
    this.rules.fees.port_fee_per_docking = p[level].portFee;
    this.rules.ship.upkeep_per_day = p[level].upkeep;
    this.botMinProfit = p[level].botMinProfit ?? 0;
    this.botError = p[level].botError ?? 0;
    this.difficulty = level;
    return { ok: true };
  }

  /** Name of the preset the current values match, if any. */
  private matchPreset(): string {
    const f = this.rules.fees, up = this.rules.ship.upkeep_per_day;
    for (const [name, v] of Object.entries(this.rules.difficulty?.presets ?? {}))
      if (v.tax === f.trade_tax_rate && v.portFee === f.port_fee_per_docking && v.upkeep === up) return name;
    return "custom";
  }

  // ------------------------------------------------------------ time

  advance(): void {
    if (this.seasonOver) return;
    this.tick++;
    const k = this.marketScale();
    for (let p = 0; p < this.n; p++) this.stock[p] = this.marketStep(p, this.stock[p], k);

    for (const s of this.ships.values()) {
      if (s.dest !== null && s.arriveTick <= this.tick) {
        const from = s.port;
        s.port = s.dest;
        s.dest = null;
        const fee = this.portExpansion.arriveFee(s, this.maritime.arrive(s));
        this.companies.get(s.owner)!.cash -= fee;
        const trip = this.openTrip(s.owner, s.id);
        if (trip) { trip.spent += fee; if (trip.costs) trip.costs.portFees += fee; if (s.qty === 0) trip.open = false; }
        const consignment = this.maritime.finishConsignment(s);
        if (consignment) {
          const before = this.companies.get(s.owner)!.cash;
          if (this.sell(consignment.owner, s.id).ok) {
            const topup = Math.max(0, consignment.guarantee - (this.companies.get(s.owner)!.cash - before));
            this.companies.get(s.owner)!.cash += topup;
            if (trip) trip.earned += topup;
          }
        }
        const guildProceeds = this.guildFreight.deliver(s);
        if (guildProceeds !== undefined) this.sell(s.owner, s.id, undefined, guildProceeds);
        if (this.expansionEnabled) {
          this.tradeExpansion.arrived(s, from);
          this.explorationExpansion.arrived(s, from);
          this.fleetExpansion.arrived(s, from);
          this.scenarioExpansion.arrived(s, from);
        }
      }
    }
    for (const o of this.orders.values()) {
      const r = o.reservation;
      if (!r || r.expires > this.tick) continue;
      const ship = this.ships.get(r.ship);
      if (ship?.owner === r.company && ship.dest === null && ship.port === o.port && ship.good === o.good)
        this.sell(r.company, r.ship, o.id);
      if (!this.orders.has(o.id)) continue;
      const parent = this.orders.get(r.parent);
      if (parent) {
        parent.qty += o.qty;
        this.orders.delete(o.id);
      } else delete o.reservation;
    }

    this.piracy.tick();
    this.police.tick();
    this.maritime.tick();
    if (this.expansionEnabled) {
      this.portExpansion.advance();
      this.tradeExpansion.advance();
      this.piracyExpansion.advance();
      this.explorationExpansion.advance();
      this.fleetExpansion.advance();
    }

    if (this.tick % 24 === 0) {
      for (const c of this.companies.values()) {
        const log = this.worthLog.get(c.id);
        if (log) log.push(Math.round(this.netWorth(c)));
        c.cash -= this.upkeepDue(c);
        if (c.cash < 0 && c.ships.length > 1 && !this.maritime.grace(c)) {
          const idle = c.ships.map(id => this.ships.get(id)!).find(s => s.dest === null && s.qty === 0
            && (!this.expansionEnabled || (!this.fleetExpansion.leased(s) && !this.explorationExpansion.spaceTaken(s))));
          if (idle) {
            const cashBefore = c.cash;
            const paid = this.spec(idle.type).price * 0.5;
            this.removeShip(c, idle); c.cash += paid;
            const list = this.forcedSales.get(c.id) ?? [];
            list.push({ ship: idle.id, port: idle.port, tick: this.tick, paid, cashBefore });
            this.forcedSales.set(c.id, list.slice(-10));
          }
        }
      }
    }
    if (this.expansionEnabled) this.scenarioExpansion.advance();
    this.runVoyageQueues();
  }

  /** Port production and consumption scale with the number of companies. */
  marketScale(): number {
    const m = this.rules.markets;
    if (!m.reference_companies) return 1;
    return Math.max(m.min_scale ?? 0, this.companies.size / m.reference_companies);
  }

  // ------------------------------------------------------------ views

  /** Shared by the real hourly tick and read-only forecasts. */
  private marketStep(port: number, stock: number[], scale: number): number[] {
    const chain = this.map.industry;
    const factory = chain?.version === 1 && chain.factories.includes(port);
    const next = stock.map((amount, g) => {
      const production = factory && g === 3 ? 0 : this.prod[port][g] * scale;
      const cap = this.targets[g] * this.rules.markets.max_stock_multiple;
      return Math.max(0, Math.min(cap, amount + production) - this.cons[port][g] * scale);
    });
    if (factory) {
      const room = Math.max(0, this.targets[3] * this.rules.markets.max_stock_multiple - next[3]);
      const output = Math.min(this.prod[port][3] * scale, next[2] / chain.orePerMachinery, room);
      next[2] -= output * chain.orePerMachinery;
      next[3] += output;
    }
    return next;
  }

  marketOutlook(port: number) {
    const hours = Math.max(0, Math.min(6, this.seasonHours - this.tick));
    const scale = this.marketScale();
    const next = this.marketStep(port, this.stock[port], scale);
    let projected = [...this.stock[port]];
    for (let h = 0; h < hours; h++) projected = this.marketStep(port, projected, scale);
    const inbound = GOODS.map((_, g) => [...this.ships.values()].filter(s => s.dest === port && s.good === g && s.arriveTick <= this.tick + hours).reduce((sum, s) => sum + s.qty, 0));
    const chain = this.map.industry;
    return {
      hours,
      goods: GOODS.map((_, g) => ({
        changePerHour: next[g] - this.stock[port][g],
        projectedStock: projected[g], projectedPrice: this.price(port, g, projected[g]),
        inbound: inbound[g], priceIfInboundSold: this.price(port, g, projected[g] + inbound[g]),
      })),
      factory: chain?.version === 1 && chain.factories.includes(port) ? {
        orePerMachinery: chain.orePerMachinery,
        capacityPerHour: this.prod[port][3] * scale,
        outputPerHour: Math.max(0, (this.stock[port][2] - next[2]) / chain.orePerMachinery),
        oreStock: this.stock[port][2],
      } : null,
    };
  }

  netWorth(c: Company): number {
    let w = c.cash + this.maritime.assets(c);
    if (this.expansionEnabled) w += this.tradeExpansion.worth(c.id) + this.portExpansion.worth(c.id)
      + this.explorationExpansion.worth(c.id) + this.fleetExpansion.worth(c.id) + this.scenarioExpansion.worth(c.id);
    for (const id of c.ships) { const s = this.ships.get(id)!; w += this.spec(s.type).price * 0.5 + s.cost; }
    for (const o of this.orders.values())
      if (o.owner === c.id) w += o.side === "buy" ? o.qty * o.price : (o.cost ?? 0);
    return w;
  }

  /** Cargo and empty ships heading to each port: public information. */
  inbound(): { cargo: number[][]; emptyShips: number[] } {
    const cargo = this.map.ports.map(() => GOODS.map(() => 0));
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
      day: Math.min(this.seasonHours / 24, Math.floor(this.tick / 24) + 1),
      seasonDays: this.seasonHours / 24,
      seasonOver: this.seasonOver,
      companies: comps.length,
      ships: this.ships.size,
      moneySupply: Math.round(comps.reduce((a, c) => a + c.cash, 0)),
      escrow: Math.round([...this.orders.values()].filter(o => o.side === "buy").reduce((a, o) => a + o.qty * o.price, 0)),
      top1pctShare: total > 0 ? worth.slice(0, k).reduce((a, b) => a + Math.max(0, b), 0) / total : 0,
      inDebt: comps.filter(c => c.cash < 0).length,
      difficulty: this.difficulty,
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
