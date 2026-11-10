import { GOODS, type Company, type Engine, type Good, type Result, type Ship } from "./engine.js";

export interface GuildBackhaulCommand {
  type: "dispatchGuildBackhaul";
  company: number;
  ship: number;
  dest: number;
  good: Good;
  qty: number;
  maxSpend: number;
  minProceeds: number;
}

interface GuildOffer {
  dest: number;
  good: Good;
  qty: number;
  hours: number;
  cost: number;
  proceeds: number;
}

interface GuildDelivery extends GuildOffer { company: number }

const fail = (error: string): Result => ({ ok: false, error });

/** Deterministic, seasonal clearinghouse for small return cargoes when private buyers offer no viable load. */
export class GuildFreight {
  private deliveries = new Map<number, GuildDelivery>();
  private nextContract = new Map<number, number>();
  private committed = 0;
  private paid = 0;

  constructor(private readonly e: Engine) {}

  private get available() {
    return this.e.rules.company.start_cash * this.e.n - this.committed - this.paid;
  }

  view(c: Company, s: Ship) {
    const delivery = this.deliveries.get(s.id);
    return { offer: this.offer(c, s), delivery: delivery?.company === c.id ? delivery : undefined };
  }

  replayState() {
    return { deliveries: [...this.deliveries], nextContract: [...this.nextContract], committed: this.committed, paid: this.paid };
  }

  private offer(c: Company, s: Ship): GuildOffer | undefined {
    const e = this.e;
    if (!e.maritime.enabled || e.seasonOver || s.owner !== c.id || s.dest !== null || s.qty || s.type === "pirate"
      || e.voyageQueues.has(s.id) || (this.nextContract.get(c.id) ?? 0) > e.tick || this.available <= 0) return undefined;
    const last = e.trips.get(c.id)?.slice().reverse().find(t => t.ship === s.id);
    if (!last || last.to !== s.port || last.from === s.port) return undefined;
    const dest = last.from;
    const hours = e.voyageHours(s.port, dest, s.type);
    if (e.tick + hours >= e.seasonHours) return undefined;

    const tax = e.rules.fees.trade_tax_rate;
    const capacity = e.spec(s.type).capacity;
    const privateBuyers = [...e.orders.values()].filter(o => o.side === "buy" && !o.reservation && o.owner !== c.id && o.port === dest);
    let best: GuildOffer | undefined;
    for (const [index, good] of GOODS.entries()) {
      const hold = Math.floor(Math.min(capacity, e.stock[s.port][index]));
      if (hold < 1) continue;
      // Check the buyer's exact supported quantity so a viable private contract always takes priority.
      for (const buyer of privateBuyers.filter(o => o.good === index)) {
        const qty = Math.min(hold, buyer.qty);
        const result = e.voyageQuote({ type: "sail", company: c.id, ship: s.id, dest, buy: { good, qty } });
        if (!result.ok || !("quote" in result)) continue;
        const q = result.quote;
        const cost = q.cargoCost + q.fuelCost + q.portFee;
        if (cost <= c.cash && qty * buyer.price * (1 - tax) > cost) return undefined;
      }
      const limit = Math.min(30, hold);
      if (limit < 5) continue;
      for (const qty of new Set([limit, Math.floor(limit / 2), 5])) {
        const result = e.voyageQuote({ type: "sail", company: c.id, ship: s.id, dest, buy: { good, qty } });
        if (!result.ok || !("quote" in result)) continue;
        const q = result.quote;
        const cost = Math.ceil(q.cargoCost + q.fuelCost + q.portFee);
        const proceeds = cost + Math.min(50, 10 + qty);
        if (cost > c.cash || proceeds > Math.min(this.available, e.rules.company.start_cash * 0.5)) continue;
        const candidate = { dest, good, qty, hours, cost, proceeds };
        const demanded = e.map.ports[dest].consumes.includes(good);
        const priorDemanded = best && e.map.ports[dest].consumes.includes(best.good);
        if (!best || (demanded && !priorDemanded) || (demanded === priorDemanded && qty > best.qty)) best = candidate;
      }
    }
    return best;
  }

  dispatch(cmd: GuildBackhaulCommand): Result {
    const c = this.e.companies.get(cmd.company), s = this.e.ships.get(cmd.ship);
    if (!c || !s || s.owner !== c.id) return fail("not your ship");
    const offer = this.offer(c, s);
    if (!offer || cmd.dest !== offer.dest || cmd.good !== offer.good || cmd.qty !== offer.qty)
      return fail("that guild return load has changed or is no longer available");
    if (!Number.isFinite(cmd.maxSpend) || !Number.isFinite(cmd.minProceeds)
      || offer.cost > cmd.maxSpend || offer.proceeds < cmd.minProceeds)
      return fail("the guild quote has changed. Review the new price before dispatch");
    const result = this.e.applyLive({ type: "sail", company: c.id, ship: s.id, dest: offer.dest,
      buy: { good: offer.good, qty: offer.qty } });
    if (!result.ok) return result;
    const trip = this.e.openTrip(c.id, s.id);
    if (trip) trip.estimate = { revenue: offer.proceeds, profit: offer.proceeds - offer.cost, tick: this.e.tick };
    this.nextContract.set(c.id, this.e.tick + 24);
    this.deliveries.set(s.id, { ...offer, company: c.id });
    this.committed += offer.proceeds;
    return { ok: true };
  }

  release(ship: number) {
    const delivery = this.deliveries.get(ship);
    if (delivery) this.committed -= delivery.proceeds;
    this.deliveries.delete(ship);
    return delivery;
  }

  deliver(s: Ship) {
    const delivery = this.release(s.id);
    if (!delivery || delivery.company !== s.owner || delivery.dest !== s.port
      || s.dest !== null || s.good !== GOODS.indexOf(delivery.good) || s.qty !== delivery.qty) return undefined;
    this.paid += delivery.proceeds;
    return delivery.proceeds;
  }
}
