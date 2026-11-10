import type { Company, Engine, Result, Ship, ShipType } from "./engine.js";
import type { FeatureCard } from "./expansion-cards.js";
import { isBot } from "./bots.js";

export const EXPANSION_SCENARIOS = ["classic", "orders-from-shore", "takeover-day", "opening-auction"] as const;
export type ExpansionScenario = typeof EXPANSION_SCENARIOS[number];
export type ScenarioExpansionCommand = {
  type: "expansion"; company: number; feature: "season"; action: string; [key: string]: unknown;
};

interface StandingOrder { owner: number; minimum: number; fallback: number; diverted: boolean }
interface Bid { lot: number; amount: number }
interface Lot { id: number; type: ShipType; reserve: number }
interface Bill { hour: number; label: string; amount: number }
interface Takeover { nextBill: number; payrollMade?: boolean }

const shortSeason = 7 * 24;
const ok: Result = { ok: true };
const fail = (error: string): Result => ({ ok: false, error });
const credits = (n: number) => Math.round(n).toLocaleString("en-GB");

export class ScenarioExpansion {
  mode: ExpansionScenario = "classic";
  private readonly orders = new Map<number, StandingOrder>();
  private readonly orderResults = new Map<number, { owner: number; message: string }>();
  private readonly takeovers = new Map<number, Takeover>();
  private readonly bids = new Map<number, Bid>();
  private readonly entrants = new Set<number>();
  private readonly awards = new Map<number, string>();
  private auctionHour = 24;
  private lots: Lot[] = [];

  constructor(private readonly e: Engine) {}

  activate(mode: ExpansionScenario): void {
    this.mode = mode;
    if (mode !== "opening-auction") return;
    this.auctionHour = Math.min(24, Math.max(1, this.e.rules.season.days * 24 - 1));
    const cash = this.e.rules.company.start_cash;
    const type: ShipType = this.e.rules.ship_types?.bulker && this.e.spec("bulker").price * 0.5 <= cash ? "bulker" : "freighter";
    this.lots = [
      { id: 1, type: "freighter", reserve: Math.ceil(Math.max(this.e.spec("freighter").price * 0.5, cash * 0.64)) },
      { id: 2, type, reserve: Math.ceil(Math.max(this.e.spec(type).price * 0.5, cash * 0.80)) },
    ];
  }

  seasonHours(classicHours: number): number {
    return this.mode === "orders-from-shore" || this.mode === "takeover-day" ? shortSeason : classicHours;
  }

  queueError(): string | undefined {
    if (this.mode === "orders-from-shore") return "Set a single standing order in Opportunities while the ship is docked.";
  }

  private coaster(): ShipType { return this.e.rules.ship_types?.coaster ? "coaster" : "freighter"; }
  private fallbackPrice(): number {
    return Math.floor(Math.min(this.e.spec(this.coaster()).price * 0.5, this.e.rules.company.start_cash * 0.5));
  }

  private commonHome(): number {
    return this.e.map.ports.find(p => p.produces.length && this.e.dist[p.id].some((d, i) => i !== p.id && Number.isFinite(d)))?.id ?? 0;
  }

  private remotePort(from: number): number {
    return this.e.map.ports.reduce((best, p) => {
      const dist = this.e.dist[from][p.id];
      return Number.isFinite(dist) && dist > this.e.dist[from][best] ? p.id : best;
    }, from);
  }

  register(c: Company): boolean {
    if (this.mode === "classic") return false;
    if (this.mode === "orders-from-shore") {
      c.home = this.commonHome();
      this.e.addExpansionShip(c, c.home, this.coaster());
      if (this.e.rules.company.max_ships > 1) this.e.addExpansionShip(c, c.home, "freighter");
      return true;
    }
    if (this.mode === "takeover-day") {
      c.home = this.commonHome();
      c.cash = Math.round(c.cash * 0.75);
      this.e.addExpansionShip(c, c.home, this.coaster());
      if (this.e.rules.company.max_ships > 1) this.e.addExpansionShip(c, this.remotePort(c.home), "freighter");
      const takeover = { nextBill: 0 };
      this.takeovers.set(c.id, takeover);
      this.payBills(c, takeover);
      return true;
    }
    c.cash -= this.fallbackPrice();
    if (this.e.tick >= this.auctionHour || isBot(c.name)) this.grantFallback(c);
    else this.entrants.add(c.id);
    return true;
  }

  private grantFallback(c: Company) {
    const ship = this.e.addExpansionShip(c, c.home, this.coaster());
    this.awards.set(c.id, `Starter ${ship.type} #${ship.id} purchased for ${credits(this.fallbackPrice())} credits.`);
  }

  private bills(): Bill[] {
    const cash = this.e.rules.company.start_cash;
    return [
      { hour: 48, label: "Inherited yard invoice", amount: Math.round(cash * 0.26) },
      { hour: 96, label: "Dock arrears", amount: Math.round(cash * 0.30) },
      { hour: shortSeason, label: "Crew payroll", amount: Math.round(cash * 0.34) },
    ];
  }

  private payBills(c: Company, takeover: Takeover) {
    const bills = this.bills();
    while (takeover.nextBill < bills.length && bills[takeover.nextBill].hour <= this.e.tick) {
      const bill = bills[takeover.nextBill++];
      c.cash -= bill.amount;
      if (takeover.nextBill === bills.length) takeover.payrollMade = c.cash >= 0;
    }
  }

  apply(cmd: ScenarioExpansionCommand): Result {
    const c = this.e.companies.get(cmd.company);
    if (!c) return fail("no such company");
    if (this.mode === "orders-from-shore") return this.setOrder(c, cmd);
    if (this.mode === "opening-auction") return this.bid(c, cmd);
    return fail("this season has no available scenario action");
  }

  private setOrder(c: Company, cmd: ScenarioExpansionCommand): Result {
    if (cmd.action !== "setOrder" && cmd.action !== "clearOrder") return fail("unknown standing order action");
    const ship = typeof cmd.ship === "number" ? this.e.ships.get(cmd.ship) : undefined;
    if (!ship || ship.owner !== c.id || ship.type === "pirate") return fail("choose one of your merchant ships");
    if (ship.dest !== null) return fail("orders can only be changed while the ship is docked");
    if (cmd.action === "clearOrder") {
      this.orders.delete(ship.id);
      this.orderResults.delete(ship.id);
      return ok;
    }
    const { minimum, fallback } = cmd;
    if (typeof minimum !== "number" || !Number.isFinite(minimum) || minimum < 0 || minimum > 1_000_000)
      return fail("enter a minimum price from 0 to 1,000,000 credits per tonne");
    if (typeof fallback !== "number" || !Number.isInteger(fallback) || fallback < 0 || fallback >= this.e.n
      || !Number.isFinite(this.e.dist[ship.port][fallback])) return fail("choose a reachable fallback port");
    this.orders.set(ship.id, { owner: c.id, minimum, fallback, diverted: false });
    this.orderResults.delete(ship.id);
    return ok;
  }

  private bid(c: Company, cmd: ScenarioExpansionCommand): Result {
    if (this.e.tick >= this.auctionHour || !this.entrants.has(c.id)) return fail("the opening auction is closed to this company");
    const previous = this.bids.get(c.id);
    const additional = previous ? previous.amount - this.fallbackPrice() : 0;
    if (cmd.action === "withdrawBid") {
      if (!previous) return fail("you have no active bid");
      this.bids.delete(c.id);
      c.cash += additional;
      return ok;
    }
    if (cmd.action !== "bid") return fail("unknown auction action");
    const lot = this.lots.find(l => l.id === cmd.lot);
    const { amount } = cmd;
    if (!lot || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < lot.reserve)
      return fail("choose a lot and enter at least its reserve price");
    const needed = amount - this.fallbackPrice() - additional;
    if (needed > 0 && needed > c.cash) return fail("not enough cash for the bid");
    c.cash -= needed;
    this.bids.set(c.id, { lot: lot.id, amount });
    return ok;
  }

  private settleAuction() {
    const winners = new Map<number, Lot>();
    for (const lot of this.lots) {
      const bidders = [...this.bids].filter(([id, bid]) => this.entrants.has(id) && bid.lot === lot.id);
      bidders.sort(([a, aBid], [b, bBid]) => bBid.amount - aBid.amount || a - b);
      if (bidders.length) winners.set(bidders[0][0], lot);
    }
    for (const id of this.entrants) {
      const c = this.e.companies.get(id)!;
      const lot = winners.get(id);
      const bid = this.bids.get(id);
      if (lot && bid) {
        const ship = this.e.addExpansionShip(c, c.home, lot.type);
        this.awards.set(id, `Won ${lot.type} #${ship.id} for ${credits(bid.amount)} credits.`);
      } else {
        if (bid) c.cash += bid.amount - this.fallbackPrice();
        this.grantFallback(c);
      }
    }
    this.entrants.clear();
    this.bids.clear();
  }

  advance(): void {
    if (this.mode === "takeover-day") {
      for (const [id, takeover] of this.takeovers) this.payBills(this.e.companies.get(id)!, takeover);
    }
    if (this.mode === "opening-auction" && this.e.tick >= this.auctionHour && this.entrants.size) this.settleAuction();
  }

  arrived(ship: Ship, _from: number): void {
    if (this.mode !== "orders-from-shore") return;
    const order = this.orders.get(ship.id);
    if (!order) return;
    if (order.owner !== ship.owner) { this.orders.delete(ship.id); return; }
    if (ship.good === null || ship.qty <= 0 || this.e.maritime.hasLoot(ship)) return;
    const stop = (message: string) => {
      this.orders.delete(ship.id);
      this.orderResults.set(ship.id, { owner: ship.owner, message });
    };
    const e = this.e;
    const tax = e.portExpansion.tradeTax(ship.port, ship.good, "sell", e.rules.fees.trade_tax_rate);
    const proceeds = e.sellValue(ship.port, ship.good, ship.qty) * (1 - tax);
    if (order.diverted || proceeds / ship.qty + 1e-8 >= order.minimum) {
      const sold = e.apply({ type: "sell", company: ship.owner, ship: ship.id });
      stop(sold.ok ? `Sold the cargo at ${e.map.ports[ship.port].name} under its standing order.` : `Cargo stayed aboard. ${sold.error}`);
      return;
    }
    if (ship.port === order.fallback) { stop("The price was below your minimum and the ship was already at its fallback port."); return; }
    const sail = { type: "sail" as const, company: ship.owner, ship: ship.id, dest: order.fallback };
    const quote = e.voyageQuote(sail);
    if (!quote.ok || !("quote" in quote) || !quote.quote.affordable || e.tick + quote.quote.hours >= e.seasonHours) {
      stop("The price was below your minimum and the fallback voyage was unavailable or could not finish this season.");
      return;
    }
    const result = e.apply(sail);
    if (!result.ok) { stop(`The fallback voyage could not depart. ${result.error}`); return; }
    order.diverted = true;
  }

  worth(company: number): number {
    const takeover = this.takeovers.get(company);
    if (takeover) return -this.bills().slice(takeover.nextBill).reduce((total, bill) => total + bill.amount, 0);
    return this.entrants.has(company) ? this.bids.get(company)?.amount ?? this.fallbackPrice() : 0;
  }

  cards(company: number): FeatureCard[] {
    const c = this.e.companies.get(company);
    if (!c) return [];
    if (this.mode === "orders-from-shore") return this.orderCards(c);
    if (this.mode === "takeover-day") return this.takeoverCards(c);
    if (this.mode === "opening-auction") return this.auctionCards(c);
    return [{ title: "Classic season", detail: "Orders From Shore, Takeover Day and Opening Auction can be selected when starting a new season in the Admin panel." }];
  }

  private orderCards(c: Company): FeatureCard[] {
    const cards: FeatureCard[] = [{ title: "Orders From Shore", detail: "Seven days. Set one standing order per ship while docked. At the next loaded arrival, the captain sells at your minimum net price or heads for the fallback port and sells on arrival there." }];
    for (const id of c.ships) {
      const s = this.e.ships.get(id);
      if (!s || s.type === "pirate") continue;
      const candidate = this.orders.get(id);
      const order = candidate?.owner === c.id ? candidate : undefined;
      const previous = this.orderResults.get(id);
      const detail = order ? order.diverted ? `Diverting to ${this.e.map.ports[order.fallback].name} to sell.`
        : `Standing order: ${credits(order.minimum)} credits per tonne or divert to ${this.e.map.ports[order.fallback].name}.`
        : previous?.owner === c.id ? previous.message : "No standing order on file.";
      const options = this.e.map.ports.filter(p => Number.isFinite(this.e.dist[s.port][p.id]))
        .map(p => ({ value: p.id, label: p.name }));
      const actions: NonNullable<FeatureCard["actions"]> = [];
      if (s.dest === null && !this.e.seasonOver && options.length) {
        actions.push({ label: order ? "Replace standing order" : "Set standing order",
          command: { type: "expansion", feature: "season", action: "setOrder", ship: id },
          fields: [{ key: "minimum", label: "Minimum net credits per tonne", min: 0, max: 1_000_000, value: order?.minimum ?? 40 },
            { key: "fallback", label: "Fallback port", options, value: order?.fallback ?? options.find(p => p.value !== s.port)?.value }] });
        if (order) actions.push({ label: "Clear standing order", command: { type: "expansion", feature: "season", action: "clearOrder", ship: id } });
      }
      cards.push({ title: `${s.type} #${id}`, detail, actions });
    }
    return cards;
  }

  private takeoverCards(c: Company): FeatureCard[] {
    const takeover = this.takeovers.get(c.id);
    if (!takeover) return [];
    const schedule = this.bills().map((bill, index) => `${bill.label}: ${credits(bill.amount)} credits · hour ${bill.hour}${index < takeover.nextBill ? " · charged" : ""}`);
    const status = takeover.payrollMade === undefined ? "Finish with positive operating cash after the final crew payroll."
      : takeover.payrollMade ? "Payroll covered. Your company made it through the week." : "Cash fell short at the final payroll.";
    return [{ title: "Takeover Day", detail: `${status}\n${schedule.join("\n")}` }];
  }

  private auctionCards(c: Company): FeatureCard[] {
    const award = this.awards.get(c.id);
    if (award) return [{ title: "Opening Auction", detail: award }];
    const bid = this.bids.get(c.id);
    const fallback = this.fallbackPrice();
    const escrow = bid?.amount ?? fallback;
    const max = Math.floor(c.cash + escrow);
    const cards: FeatureCard[] = [{ title: "Opening Auction",
      detail: `Bids close at hour ${this.auctionHour}. Bid on one hull or take the ${credits(fallback)}-credit ${this.coaster()}. ${credits(escrow)} credits are reserved. ${bid ? `Your current bid is ${credits(bid.amount)} credits on lot ${bid.lot}.` : "You have no bid."}`,
      actions: bid ? [{ label: "Withdraw bid", command: { type: "expansion", feature: "season", action: "withdrawBid" } }] : [] }];
    for (const lot of this.lots) cards.push({ title: `Lot ${lot.id} · ${lot.type}`,
      detail: `${this.e.spec(lot.type).capacity} tonnes of hold space. Reserve ${credits(lot.reserve)} credits. Ties go to the lower company ID.`,
      actions: max >= lot.reserve ? [{ label: "Place sealed bid", command: { type: "expansion", feature: "season", action: "bid", lot: lot.id },
        fields: [{ key: "amount", label: "Your bid in credits", min: lot.reserve, max, value: bid?.lot === lot.id ? bid.amount : lot.reserve }] }] : [] });
    return cards;
  }

  replayState() {
    return { mode: this.mode, orders: [...this.orders], orderResults: [...this.orderResults], takeovers: [...this.takeovers],
      bids: [...this.bids], entrants: [...this.entrants], awards: [...this.awards], auctionHour: this.auctionHour, lots: this.lots };
  }
}
