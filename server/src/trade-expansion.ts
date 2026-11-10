import { GOODS, type Company, type Engine, type Result, type Ship } from "./engine.js";
import type { FeatureAction, FeatureCard, FeatureField } from "./expansion-cards.js";

export type TradeExpansionCommand = {
  type: "expansion"; company: number; feature: "trade"; action: string; [key: string]: unknown;
};

interface WarehouseLot { owner: number; port: number; good: number; qty: number; cost: number }
interface Line { owner: number; ship: number; from: number; to: number; departs: number; bond: number; made: number }
interface Tender { id: number; from: number; to: number; good: number; qty: number; closes: number; ceiling: number }
interface TenderBid { owner: number; ship: number; amount: number }
interface TenderAuction { tender: Tender; bids: Map<number, TenderBid> }
interface Carriage { owner: number; to: number; good: number; qty: number; pay: number; title: string }
interface CharterQuote { id: number; from: number; to: number; good: number; qty: number; closes: number; fare: number; hours: number }
interface CharterShare { qty: number; cost: number; fare: number }
interface Charter { quote: CharterQuote; shares: Map<number, CharterShare>; arrives?: number }

const LINE_INTERVAL = 84;
const LINE_BOND = 100;
const LINE_MISS = 25;
const RENT_PER_UNIT = 0.12;
const TENDER_PERIOD = 48;
const CHARTER_PERIOD = 72;
const fail = (error: string): Result => ({ ok: false, error });
const ok: Result = { ok: true };

function whole(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function action(label: string, kind: string, command: Record<string, unknown> = {}, fields?: FeatureField[]): FeatureAction {
  return { label, command: { type: "expansion", feature: "trade", action: kind, ...command }, ...(fields ? { fields } : {}) };
}

function units(max: number, value = max): FeatureField[] {
  return [{ key: "qty", label: "Tonnes", min: 1, max, value }];
}

/** Trade experiments use accepted commands and hourly ticks so their state replays with the world. */
export class TradeExpansion {
  private readonly warehouse = new Map<string, WarehouseLot>();
  private readonly lines = new Map<number, Line>();
  private readonly tenders = new Map<number, TenderAuction>();
  private readonly carriages = new Map<number, Carriage>();
  private readonly charters = new Map<number, Charter>();
  private readonly notices = new Map<number, string[]>();

  constructor(private readonly e: Engine) {}

  private notify(owner: number, message: string) {
    this.notices.set(owner, [...(this.notices.get(owner) ?? []), message].slice(-4));
  }

  private port(id: number) { return this.e.map.ports[id].name; }
  private when(tick: number) { return `day ${Math.floor(tick / 24) + 1}, hour ${tick % 24}`; }

  private docked(company: number, id: unknown, port?: number) {
    const s = whole(id, 1, Number.MAX_SAFE_INTEGER) ? this.e.ships.get(id) : undefined;
    return s && s.owner === company && s.dest === null && s.type !== "pirate"
      && !this.e.voyageQueues.has(s.id) && (port === undefined || s.port === port) ? s : undefined;
  }

  private emptyDocked(c: Company) {
    return c.ships.map(id => this.docked(c.id, id)).filter((s): s is Ship => !!s && s.qty === 0);
  }

  private reachable(from: number, dest: unknown): dest is number {
    return whole(dest, 0, this.e.n - 1) && dest !== from && Number.isFinite(this.e.dist[from][dest]);
  }

  private nearby(from: number, rotation: number) {
    const direct = this.e.map.routes.flatMap(r => r.a === from ? [r.b] : r.b === from ? [r.a] : []);
    const ports = [...new Set(direct)].filter(p => this.reachable(from, p)).sort((a, b) => a - b);
    return ports.length > 0 ? ports[rotation % ports.length] : undefined;
  }

  private store(owner: number, port: number, good: number, qty: number, cost: number) {
    const key = `${owner}:${port}:${good}`;
    const lot = this.warehouse.get(key);
    if (lot) { lot.qty += qty; lot.cost += cost; }
    else this.warehouse.set(key, { owner, port, good, qty, cost });
  }

  private take(key: string, lot: WarehouseLot, qty: number) {
    const cost = lot.cost * qty / lot.qty;
    lot.qty -= qty;
    lot.cost -= cost;
    if (lot.qty === 0) this.warehouse.delete(key);
    return cost;
  }

  private handleWarehouse(c: Company, cmd: TradeExpansionCommand): Result {
    const { qty } = cmd;
    if (cmd.action === "warehouseStore") {
      const s = this.docked(c.id, cmd.ship);
      if (!s || s.good === null || !whole(qty, 1, s.qty) || this.e.maritime.hasLoot(s))
        return fail("Choose an owned ship docked with enough lawful cargo.");
      const good = s.good;
      const cost = s.cost * qty / s.qty;
      this.store(c.id, s.port, good, qty, cost);
      s.qty -= qty;
      s.cost -= cost;
      if (s.qty === 0) { s.good = null; s.cost = 0; }
      this.e.maritime.cargoMoved(s, qty);
      this.e.maritime.dockedCargoChanged(s);
      this.e.recordSpecialSale(s, cost);
      return ok;
    }
    const key = typeof cmd.lot === "string" ? cmd.lot : "";
    const lot = this.warehouse.get(key);
    if (!lot || lot.owner !== c.id || !whole(qty, 1, lot.qty)) return fail("That warehouse lot no longer has enough cargo.");
    if (cmd.action === "warehouseSell") {
      const net = this.e.sellValue(lot.port, lot.good, qty) * (1 - this.e.rules.fees.trade_tax_rate);
      this.take(key, lot, qty);
      this.e.stock[lot.port][lot.good] += qty;
      c.cash += net;
      return { ok: true, sold: qty, earned: net };
    }
    const s = this.docked(c.id, cmd.ship, lot.port);
    if (!s || (s.qty > 0 && s.good !== lot.good) || this.e.maritime.hasLoot(s) || s.qty + qty > this.e.expansionCapacity(s))
      return fail("Choose a compatible docked ship with enough spare room.");
    const cost = this.take(key, lot, qty);
    s.good = lot.good;
    s.qty += qty;
    s.cost += cost;
    this.e.recordCargoLoaded(s, cost);
    this.e.maritime.dockedCargoChanged(s);
    return ok;
  }

  private handleLine(c: Company, cmd: TradeExpansionCommand): Result {
    const line = this.lines.get(c.id);
    if (cmd.action === "openLine") {
      const s = this.docked(c.id, cmd.ship);
      if (line || !s || s.qty > 0 || !this.reachable(s.port, cmd.dest)) return fail("Choose an empty docked ship and reachable destination. Each company can run one line.");
      const departs = this.e.tick + 8;
      if (departs + this.e.voyageHours(s.port, cmd.dest, s.type) >= this.e.seasonHours) return fail("The season ends before the first crossing can complete.");
      if (c.cash < LINE_BOND) return fail("The line needs a 100-credit booking bond.");
      c.cash -= LINE_BOND;
      this.lines.set(c.id, { owner: c.id, ship: s.id, from: s.port, to: cmd.dest, departs, bond: LINE_BOND, made: 0 });
      return ok;
    }
    if (!line) return fail("You have no scheduled line.");
    if (cmd.action === "cancelLine") {
      c.cash += Math.max(0, line.bond - LINE_MISS);
      this.lines.delete(c.id);
      return ok;
    }
    const replacement = this.docked(c.id, cmd.ship, line.from);
    if (!replacement || replacement.qty > 0) return fail("Substitute an empty ship at the departure port.");
    line.ship = replacement.id;
    return ok;
  }

  private tender(from: number): Tender | undefined {
    const round = Math.floor(this.e.tick / TENDER_PERIOD);
    const closes = round * TENDER_PERIOD + 18;
    const to = this.nearby(from, round);
    if (to === undefined || this.e.tick >= closes || closes >= this.e.seasonHours) return undefined;
    const ceiling = Math.ceil(160 + this.e.dist[from][to] * 2);
    return { id: round * this.e.n + from, from, to, good: (from + round) % GOODS.length, qty: 20, closes, ceiling };
  }

  private bid(c: Company, cmd: TradeExpansionCommand): Result {
    const s = this.docked(c.id, cmd.ship);
    const tender = s && this.tender(s.port);
    if (!s || s.qty > 0 || !tender || tender.id !== cmd.tender || !whole(cmd.amount, 1, tender.ceiling))
      return fail("Choose an empty ship at the advertised port and a valid bid before closing.");
    if (tender.closes + this.e.voyageHours(tender.from, tender.to, s.type) >= this.e.seasonHours)
      return fail("This ship could not complete the tender before the season ends.");
    let auction = this.tenders.get(tender.id);
    if (!auction) { auction = { tender, bids: new Map() }; this.tenders.set(tender.id, auction); }
    auction.bids.set(c.id, { owner: c.id, ship: s.id, amount: cmd.amount });
    return ok;
  }

  private charterQuote(from: number): CharterQuote | undefined {
    const round = Math.floor(this.e.tick / CHARTER_PERIOD);
    const closes = round * CHARTER_PERIOD + 24;
    const to = this.nearby(from, round + 1);
    if (to === undefined || this.e.tick >= closes) return undefined;
    const hours = this.e.voyageHours(from, to);
    if (closes + hours >= this.e.seasonHours) return undefined;
    const fare = Math.max(1, Math.ceil(this.e.buyCost(from, 1, this.e.fuelNeeded(from, to)).cost / 60));
    return { id: round * this.e.n + from, from, to, good: (from + round + 1) % GOODS.length, qty: 60, closes, fare, hours };
  }

  private booked(charter: Charter | undefined) {
    return charter ? [...charter.shares.values()].reduce((sum, share) => sum + share.qty, 0) : 0;
  }

  private quoteShare(q: CharterQuote, qty: number) {
    const cost = this.e.buyCost(q.from, q.good, qty).cost * (1 + this.e.rules.fees.trade_tax_rate);
    return { qty, cost, fare: qty * q.fare };
  }

  private refundShare(charter: Charter, owner: number, share: CharterShare) {
    this.e.companies.get(owner)!.cash += share.cost + share.fare;
    this.e.stock[charter.quote.from][charter.quote.good] += share.qty;
    charter.shares.delete(owner);
  }

  private handleCharter(c: Company, cmd: TradeExpansionCommand): Result {
    const { charter: id, qty } = cmd;
    if (!whole(id, 0, Number.MAX_SAFE_INTEGER)) return fail("Choose a valid charter.");
    const posted = this.charters.get(id);
    if (cmd.action === "leaveCharter") {
      const share = posted?.shares.get(c.id);
      if (!posted || !share || posted.quote.closes <= this.e.tick) return fail("This charter is no longer open for cancellations.");
      this.refundShare(posted, c.id, share);
      if (posted.shares.size === 0) this.charters.delete(id);
      return ok;
    }
    const from = id % this.e.n;
    const quote = posted?.quote ?? this.charterQuote(from);
    if (!quote || quote.id !== id || quote.closes <= this.e.tick || !c.ships.some(ship => !!this.docked(c.id, ship, from)))
      return fail("You need a ship docked at the charter’s origin while bookings are open.");
    const remaining = Math.min(quote.qty - this.booked(posted), Math.floor(this.e.stock[from][quote.good]));
    if (!whole(qty, 1, remaining)) return fail("There is not enough unbooked space or cargo stock.");
    const share = this.quoteShare(quote, qty);
    if (c.cash < share.cost + share.fare) return fail("Cash does not cover cargo and charter fare.");
    c.cash -= share.cost + share.fare;
    this.e.stock[from][quote.good] -= qty;
    const charter = posted ?? { quote, shares: new Map<number, CharterShare>() };
    const prior = charter.shares.get(c.id);
    if (prior) { prior.qty += share.qty; prior.cost += share.cost; prior.fare += share.fare; }
    else charter.shares.set(c.id, share);
    this.charters.set(id, charter);
    return ok;
  }

  apply(cmd: TradeExpansionCommand): Result {
    const c = this.e.companies.get(cmd.company);
    if (!c || this.e.seasonOver) return fail("No company or the season has ended.");
    if (this.e.piracy.lockoutHours(c.id) > 0) return fail("Your company is locked out of port activities.");
    switch (cmd.action) {
      case "warehouseStore": case "warehouseLoad": case "warehouseSell": return this.handleWarehouse(c, cmd);
      case "openLine": case "cancelLine": case "substituteLine": return this.handleLine(c, cmd);
      case "bidTender": return this.bid(c, cmd);
      case "joinCharter": case "leaveCharter": return this.handleCharter(c, cmd);
      default: return fail("Unknown trade activity.");
    }
  }

  private dispatch(s: Ship, carriage: Carriage) {
    if (s.qty !== 0 || carriage.qty > this.e.expansionCapacity(s) || this.carriages.has(s.id)) return false;
    const cmd = { type: "sail" as const, company: s.owner, ship: s.id, dest: carriage.to };
    const result = this.e.voyageQuote(cmd);
    if (!result.ok || !("quote" in result) || this.e.tick + result.quote.hours >= this.e.seasonHours) return false;
    const c = this.e.companies.get(s.owner)!;
    const q = result.quote;
    if (c.cash < q.fuelCost + q.portFee + q.fleetUpkeep) return false;
    s.good = carriage.good;
    s.qty = carriage.qty;
    const sailed = this.e.applyLive(cmd);
    if (!sailed.ok) { s.good = null; s.qty = 0; return false; }
    this.carriages.set(s.id, carriage);
    const trip = this.e.openTrip(s.owner, s.id);
    if (trip) trip.estimate = { revenue: carriage.pay, profit: carriage.pay - q.fuelCost - q.portFee, tick: this.e.tick };
    return true;
  }

  arrived(s: Ship, _from: number) {
    const cargo = this.carriages.get(s.id);
    if (!cargo) return;
    this.carriages.delete(s.id);
    if (cargo.owner !== s.owner || cargo.to !== s.port) return;
    const qty = s.good === cargo.good ? Math.min(s.qty, cargo.qty) : 0;
    const pay = Math.round(cargo.pay * qty / cargo.qty);
    if (qty > 0) {
      this.e.stock[s.port][cargo.good] += qty;
      s.qty -= qty;
      if (s.qty === 0) { s.good = null; s.cost = 0; }
      this.e.maritime.cargoMoved(s, qty);
      this.e.maritime.dockedCargoChanged(s);
    }
    this.e.companies.get(s.owner)!.cash += pay;
    this.e.recordSpecialSale(s, pay);
    this.notify(s.owner, `${cargo.title} delivered ${qty}/${cargo.qty} tonnes to ${this.port(s.port)} and paid ${pay} credits.`);
  }

  private tickLines() {
    for (const line of this.lines.values()) {
      if (line.departs > this.e.tick) continue;
      const s = this.docked(line.owner, line.ship, line.from);
      const dist = this.e.dist[line.from][line.to];
      const fare = Math.ceil(180 + dist * 2);
      const left = s && this.dispatch(s, { owner: line.owner, to: line.to, good: 0, qty: 15, pay: fare, title: "Scheduled line" });
      if (left) {
        [line.from, line.to] = [line.to, line.from];
        line.made++;
      } else {
        line.bond -= LINE_MISS;
        this.notify(line.owner, `Missed a scheduled departure from ${this.port(line.from)}. ${LINE_MISS} credits compensated customers.`);
        if (line.bond <= 0) this.lines.delete(line.owner);
      }
      line.departs += LINE_INTERVAL;
    }
  }

  private tickTenders() {
    for (const [id, auction] of this.tenders) {
      const t = auction.tender;
      if (t.closes > this.e.tick) continue;
      let winner: TenderBid | undefined;
      const bids = [...auction.bids.values()].sort((a, b) => a.amount - b.amount || a.owner - b.owner);
      for (const bid of bids) {
        const s = this.docked(bid.owner, bid.ship, t.from);
        if (s && this.dispatch(s, { owner: bid.owner, to: t.to, good: t.good, qty: t.qty, pay: bid.amount, title: "Freight tender" })) {
          winner = bid;
          break;
        }
      }
      for (const bid of bids) this.notify(bid.owner, bid === winner
        ? `Ship #${bid.ship} won the freight tender to ${this.port(t.to)} and departed automatically.`
        : `The freight tender from ${this.port(t.from)} closed without awarding your bid.`);
      this.tenders.delete(id);
    }
  }

  private tickCharters() {
    for (const [id, charter] of this.charters) {
      const q = charter.quote;
      if (charter.arrives !== undefined) {
        if (charter.arrives > this.e.tick) continue;
        for (const [owner, share] of charter.shares) {
          this.store(owner, q.to, q.good, share.qty, share.cost + share.fare);
          this.notify(owner, `Your ${share.qty} tonnes of ${GOODS[q.good]} are in the warehouse at ${this.port(q.to)}.`);
        }
        this.charters.delete(id);
      } else if (q.closes <= this.e.tick || this.e.seasonOver) {
        if (!this.e.seasonOver && this.booked(charter) === q.qty) charter.arrives = q.closes + q.hours;
        else {
          for (const [owner, share] of charter.shares) {
            this.refundShare(charter, owner, share);
            this.notify(owner, `The shared charter from ${this.port(q.from)} fell short of funding. Your payment was returned.`);
          }
          this.charters.delete(id);
        }
      }
    }
  }

  advance() {
    for (const [id, cargo] of this.carriages) if (this.e.ships.get(id)?.owner !== cargo.owner) this.carriages.delete(id);
    this.tickCharters();
    if (this.e.tick % 24 === 0) {
      for (const lot of this.warehouse.values()) this.e.companies.get(lot.owner)!.cash -= lot.qty * RENT_PER_UNIT;
    }
    if (this.e.seasonOver) {
      for (const line of this.lines.values()) this.e.companies.get(line.owner)!.cash += line.bond;
      this.lines.clear();
      this.tenders.clear();
      return;
    }
    this.tickLines();
    this.tickTenders();
  }

  worth(owner: number) {
    let assets = this.lines.get(owner)?.bond ?? 0;
    for (const lot of this.warehouse.values()) if (lot.owner === owner) assets += lot.cost;
    for (const charter of this.charters.values()) {
      const share = charter.shares.get(owner);
      if (share) assets += share.cost + share.fare;
    }
    return assets;
  }

  replayState() {
    return { warehouse: [...this.warehouse], lines: [...this.lines],
      tenders: [...this.tenders.values()].map(a => ({ tender: a.tender, bids: [...a.bids] })),
      carriages: [...this.carriages], charters: [...this.charters.values()].map(c => ({ ...c, shares: [...c.shares] })),
      notices: [...this.notices] };
  }

  cards(company: number): FeatureCard[] {
    const c = this.e.companies.get(company);
    if (!c) return [];
    const empty = this.emptyDocked(c);
    const docked = c.ships.map(id => this.docked(c.id, id)).filter((s): s is Ship => !!s);
    const cards: FeatureCard[] = [];
    const line = this.lines.get(company);
    if (line) {
      const replacements = empty.filter(s => s.id !== line.ship && s.port === line.from)
        .map(s => action(`Substitute ship #${s.id}`, "substituteLine", { ship: s.id }));
      cards.push({ title: "Scheduled shipping line", detail: `Ship #${line.ship} from ${this.port(line.from)} to ${this.port(line.to)} at ${this.when(line.departs)}. ${line.made} departures kept. Bond ${line.bond} credits.`,
        actions: [...replacements, action("Close line and compensate bookings", "cancelLine")] });
    } else {
      const actions = empty.flatMap(s => {
        const options = this.e.map.ports.filter(p => this.reachable(s.port, p.id)).map(p => ({ value: p.id, label: p.name }));
        return options.length ? [action(`Open line with ship #${s.id}`, "openLine", { ship: s.id }, [{ key: "dest", label: "Destination", value: options[0].value, options }])] : [];
      });
      cards.push({ title: "Scheduled shipping lines", detail: "Post a 100-credit bond to run two crossings a week. Departures take merchant freight and run automatically if the assigned ship is empty and ready. Missed bookings cost 25 credits.", actions });
    }

    cards.push({ title: "Dockside warehouse", detail: "Unload cargo and use the ship elsewhere. Storage costs 0.12 credits per tonne at the start of each day.",
      actions: docked.filter(s => s.qty >= 1 && s.good !== null && !this.e.maritime.hasLoot(s))
        .map(s => action(`Store from ship #${s.id} at ${this.port(s.port)}`, "warehouseStore", { ship: s.id }, units(Math.floor(s.qty)))) });
    for (const [key, lot] of this.warehouse) {
      if (lot.owner !== company) continue;
      const actions = [action("Sell from warehouse", "warehouseSell", { lot: key }, units(lot.qty))];
      for (const s of docked) {
        if (s.port !== lot.port || (s.qty > 0 && s.good !== lot.good) || this.e.maritime.hasLoot(s)) continue;
        const max = Math.floor(Math.min(lot.qty, this.e.expansionCapacity(s) - s.qty));
        if (max > 0) actions.push(action(`Load ship #${s.id}`, "warehouseLoad", { lot: key, ship: s.id }, units(max)));
      }
      cards.push({ title: `Warehouse at ${this.port(lot.port)}`, detail: `${lot.qty} tonnes of ${GOODS[lot.good]}. Cost basis ${Math.round(lot.cost)} credits.`, actions });
    }

    for (const from of new Set(empty.map(s => s.port))) {
      const t = this.tender(from);
      if (!t) continue;
      const prior = this.tenders.get(t.id)?.bids.get(company);
      const actions = empty.filter(s => s.port === from && this.e.expansionCapacity(s) >= t.qty).map(s =>
        action(`Bid with ship #${s.id}`, "bidTender", { tender: t.id, ship: s.id }, [
          { key: "amount", label: "Delivery fee requested", min: 1, max: t.ceiling, value: prior?.amount ?? Math.floor(t.ceiling * 0.9) },
        ]));
      if (actions.length) cards.push({ title: "Sealed freight tender", detail: `${t.qty} tonnes of merchant-owned ${GOODS[t.good]} from ${this.port(from)} to ${this.port(t.to)}. Lowest eligible bid departs automatically at ${this.when(t.closes)}. Maximum ${t.ceiling} credits.${prior ? ` Your bid is ${prior.amount}.` : ""}`, actions });
    }

    const origins = new Set(docked.map(s => s.port));
    const quotes = [...origins].map(p => this.charterQuote(p)).filter((q): q is CharterQuote => !!q);
    const listed = new Set(quotes.map(q => q.id));
    for (const charter of this.charters.values()) {
      if (charter.shares.has(company) && !listed.has(charter.quote.id)) quotes.push(charter.quote);
    }
    for (const q of quotes) {
      const charter = this.charters.get(q.id);
      const terms = charter?.quote ?? q;
      const own = charter?.shares.get(company);
      const booked = this.booked(charter);
      const max = Math.min(terms.qty - booked, Math.floor(this.e.stock[terms.from][terms.good]));
      const actions: FeatureAction[] = [];
      if (terms.closes > this.e.tick && origins.has(terms.from) && max > 0)
        actions.push(action("Book cargo space", "joinCharter", { charter: terms.id }, units(max, Math.min(20, max))));
      if (terms.closes > this.e.tick && own) actions.push(action("Cancel your booking", "leaveCharter", { charter: terms.id }));
      const timing = charter?.arrives !== undefined ? `Arrives ${this.when(charter.arrives)}.` : `Must fill by ${this.when(terms.closes)} or bookings are refunded.`;
      cards.push({ title: "Shared freighter charter", detail: `${this.port(terms.from)} to ${this.port(terms.to)} with ${GOODS[terms.good]}. ${booked}/${terms.qty} tonnes booked. Cargo is bought at port prices plus ${terms.fare} credits per tonne. ${timing}${own ? ` You own ${own.qty} tonnes.` : ""}`, actions });
    }
    for (const message of this.notices.get(company) ?? []) cards.push({ title: "Trade bulletin", detail: message });
    return cards;
  }
}
