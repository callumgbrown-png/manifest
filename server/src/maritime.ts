import type { Company, Engine, Result, Ship } from "./engine.js";

export type MaritimeCommand =
  | { type: "activateMaritimeRules" }
  | { type: "emergencyCredit"; company: number }
  | { type: "emergencyConsignment"; company: number }
  | { type: "insureCargo"; company: number; ship: number }
  | { type: "bookConvoy"; company: number; ship: number }
  | { type: "machineryFuture"; company: number; side: "long" | "short" }
  | { type: "fenceCargo"; company: number; ship: number }
  | { type: "fundBounty"; company: number; target: number }
  | { type: "offerEscort"; company: number; ship: number; dest: number }
  | { type: "acceptEscort"; company: number; ship: number; target: number }
  | { type: "commissionConvoy"; company: number; ship: number }
  | { type: "upgradeHarbor"; company: number; ship: number }
  | { type: "buyPennant"; company: number };

interface Future { side: "long" | "short"; entry: number; settles: number; margin: number }
interface Cover { owner: number; limit: number }
export interface VoyageProtection { insurance?: boolean; convoy?: boolean }
interface Escort { owner: number; from: number; dest: number; expires: number; pay: number; helper?: number; ship?: number }

const fail = (error: string): Result => ({ ok: false, error });

/** Season-scoped state, reconstructed from accepted commands and hourly ticks. */
export class Maritime {
  enabled = false;
  private tariffRate = 0;
  private previousCash?: number;
  private routes = new Map<number, Map<string, number[]>>();
  private arrivalFees = new Map<number, number>();
  private loans = new Map<number, { balance: number; graceUntil: number }>();
  private consignments = new Map<number, { owner: number; qty: number; cost: number; dest: number }>();
  private policies = new Map<number, Cover>();
  private convoys = new Map<number, number>();
  private npcConvoys = new Map<number, number>();
  private escorts = new Map<number, Escort>();
  private futures = new Map<number, Future>();
  private loot = new Map<number, { owner: number; good: number; qty: number }>();
  private bounties = new Map<number, number>();
  private fundedBounties = new Map<number, { owner: number; amount: number }[]>();
  private pennants = new Set<number>();
  private harbors = new Map<number, Set<number>>();
  private salvagePaid = new Set<number>();
  private notices = new Map<number, string[]>();

  constructor(private readonly e: Engine) {}

  private notify(company: number, message: string) {
    this.notices.set(company, [...(this.notices.get(company) ?? []), message].slice(-8));
  }

  private threshold() { return Math.max(500, this.e.rules.company.start_cash * 0.12); }
  private eligible(c: Company) {
    const held = [...this.e.orders.values()].some(o => o.owner === c.id);
    return !this.loans.has(c.id) && c.cash < this.threshold() / 2 && c.cash >= -this.threshold() && !held
      && c.ships.some(id => this.e.ships.get(id)?.type !== "pirate")
      && c.ships.length <= 2 && !this.futures.has(c.id)
      && c.ships.every(id => this.e.ships.get(id)?.qty === 0);
  }

  private machineryIndex() {
    return this.e.stock.reduce((sum, _, port) => sum + this.e.price(port, 3), 0) / this.e.n;
  }

  private consignment(c: Company) {
    const ship = c.ships.map(id => this.e.ships.get(id)!).find(s =>
      s.dest === null && s.type !== "pirate" && !s.qty && !this.e.voyageQueues.has(s.id));
    if (!ship || this.e.piracy.lockoutHours(c.id)) return null;
    const ports = this.e.map.ports.filter(port => port.id !== ship.port && Number.isFinite(this.e.dist[ship.port][port.id]))
      .sort((a, b) => Number(b.consumes.includes("grain")) - Number(a.consumes.includes("grain"))
        || this.e.dist[ship.port][a.id] - this.e.dist[ship.port][b.id]);
    for (const dest of ports) {
      const qty = Math.floor(Math.min(this.e.stock[ship.port][0], 20, this.e.spec(ship.type).capacity));
      if (qty < 5) continue;
      const command = { type: "sail" as const, company: c.id, ship: ship.id, dest: dest.id, buy: { good: "grain" as const, qty } };
      const result = this.e.voyageQuote(command);
      if (!result.ok || !("quote" in result)) continue;
      const q = result.quote;
      if (q.hours + this.e.tick >= this.e.seasonHours) continue;
      const cost = q.cargoCost + q.fuelCost + q.portFee;
      if (cost <= this.threshold()) return { command, cost, qty, port: dest.id };
    }
    return null;
  }

  finishConsignment(s: Ship) {
    const charter = this.consignments.get(s.id);
    if (!charter) return null;
    this.consignments.delete(s.id);
    if (charter.owner !== s.owner || charter.dest !== s.port || s.good !== 0 || !s.qty) return null;
    return { owner: charter.owner, guarantee: (charter.cost + 100) * Math.min(1, s.qty / charter.qty) };
  }

  private routeKey(from: number, to: number) { return from < to ? `${from}:${to}` : `${to}:${from}`; }
  private recent(company: number, from: number, to: number) {
    return (this.routes.get(company)?.get(this.routeKey(from, to)) ?? []).filter(tick => tick > this.e.tick - 48);
  }

  harborLevel(port: number) { return this.harbors.get(port)?.size ?? 0; }

  fee(c: Company, from: number, to: number) {
    const base = this.e.rules.fees.port_fee_per_docking * (1 - this.harborLevel(to) * 0.05);
    if (!this.enabled || c.cash < this.threshold()) return base;
    const fleetFactor = Math.min(3, Math.max(0, c.ships.length - 1) / 2 + Math.max(0, c.cash / (this.threshold() * 10) - 1));
    const repeats = this.recent(c.id, from, to).length;
    return base * (1 + this.tariffRate * fleetFactor + Math.min(0.75, Math.max(0, repeats - 2) * 0.15));
  }

  upkeep(c: Company, base: number) {
    return this.enabled && c.cash >= this.threshold() && c.ships.length >= 3
      ? base * this.tariffRate * Math.min(2, (c.ships.length - 2) / 2) : 0;
  }

  depart(s: Ship, dest: number, fee: number) {
    if (!this.enabled) return;
    this.arrivalFees.set(s.id, fee);
    const companyRoutes = this.routes.get(s.owner) ?? new Map<string, number[]>();
    const key = this.routeKey(s.port, dest);
    companyRoutes.set(key, [...this.recent(s.owner, s.port, dest).slice(-7), this.e.tick]);
    this.routes.set(s.owner, companyRoutes);
  }

  arrive(s: Ship) {
    this.policies.delete(s.id);
    this.convoys.delete(s.id);
    this.npcConvoys.delete(s.id);
    const fee = this.arrivalFees.get(s.id) ?? this.e.rules.fees.port_fee_per_docking;
    this.arrivalFees.delete(s.id);
    return fee;
  }

  protected(s: Ship) {
    if (!this.enabled || s.dest === null) return false;
    const escort = this.escorts.get(s.id);
    const helper = escort?.ship === undefined ? undefined : this.e.ships.get(escort.ship);
    return this.convoys.get(s.id) === s.owner || Boolean(helper && helper.owner === escort?.helper && helper.dest === s.dest);
  }

  wanted(company: number) { return this.enabled && (this.bounties.get(company) ?? 0) > 0; }
  convoyPrize(s: Ship) { return this.npcConvoys.get(s.id) ?? 0; }

  grace(c: Company) { return (this.loans.get(c.id)?.graceUntil ?? 0) > this.e.tick; }

  assets(c: Company) {
    let pledged = 0;
    for (const pledges of this.fundedBounties.values())
      pledged += pledges.filter(p => p.owner === c.id).reduce((sum, p) => sum + p.amount, 0);
    for (const escort of this.escorts.values()) if (escort.owner === c.id) pledged += escort.pay;
    return pledged + (this.futures.get(c.id)?.margin ?? 0) - (this.loans.get(c.id)?.balance ?? 0);
  }

  cargoMoved(s: Ship, qty: number) {
    if (this.e.expansionEnabled) this.e.piracyExpansion.cargoMoved(s, qty);
    const marked = this.loot.get(s.id);
    if (!marked) return;
    marked.qty = Math.max(0, marked.qty - qty);
    if (!marked.qty || !s.qty || marked.good !== s.good) this.loot.delete(s.id);
  }

  dockedCargoChanged(s: Ship) {
    if (s.dest !== null) return;
    this.policies.delete(s.id);
    this.convoys.delete(s.id);
  }

  hasLoot(s: Ship) {
    const marked = this.loot.get(s.id);
    return marked?.owner === s.owner && marked.good === s.good && marked.qty > 0;
  }

  markLoot(ship: Ship, qty: number) {
    if (ship.good === null || qty <= 0) return;
    const prior = this.loot.get(ship.id);
    const alreadyMarked = prior?.owner === ship.owner && prior.good === ship.good ? prior.qty : 0;
    this.loot.set(ship.id, { owner: ship.owner, good: ship.good, qty: Math.min(ship.qty, alreadyMarked + qty) });
  }

  private payClaim(target: Ship, loss: number) {
    const policy = this.policies.get(target.id);
    if (loss <= 0) return;
    const owner = this.e.companies.get(target.owner)!;
    if (policy?.owner !== target.owner) {
      if (owner.ships.length !== 1 || owner.cash >= this.threshold() / 2 || this.salvagePaid.has(owner.id)) return;
      const subsidy = Math.min(100, loss / 4);
      owner.cash += subsidy;
      this.salvagePaid.add(owner.id);
      this.notify(owner.id, `Starter salvage subsidy paid ${Math.round(subsidy)} after an uninsured raid.`);
      return;
    }
    const paid = Math.min(policy.limit, loss * 0.75);
    if (paid <= 0) return;
    policy.limit -= paid;
    owner.cash += paid;
    this.notify(target.owner, `Cargo insurance paid ${Math.round(paid)}.`);
  }

  captured(s: Ship) {
    this.payClaim(s, s.cost);
    this.policies.delete(s.id);
    this.convoys.delete(s.id);
    this.loot.delete(s.id);
    const prize = this.npcConvoys.get(s.id);
    if (prize) this.e.companies.get(s.owner)!.cash += prize;
    this.npcConvoys.delete(s.id);
  }

  removeShip(s: Ship) {
    this.arrivalFees.delete(s.id);
    this.policies.delete(s.id);
    this.convoys.delete(s.id);
    this.loot.delete(s.id);
    this.consignments.delete(s.id);
  }

  raid(attacker: Ship, target: Ship, good: number | null, qty: number, loss: number, won: boolean, captured = false) {
    if (!this.enabled) return;
    const oldBounty = this.bounties.get(target.owner) ?? 0;
    if (won && target.type === "pirate" && oldBounty > 0) {
      const total = oldBounty + (this.fundedBounties.get(target.owner) ?? []).reduce((sum, p) => sum + p.amount, 0);
      this.e.companies.get(attacker.owner)!.cash += total;
      this.bounties.delete(target.owner);
      this.fundedBounties.delete(target.owner);
      this.notify(attacker.owner, `Privateer bounty paid: ${total}.`);
    } else if (target.type !== "pirate") {
      const current = this.bounties.get(attacker.owner) ?? 0;
      this.bounties.set(attacker.owner, Math.min(600, current + (qty > 0 ? 180 : 60)));
    }
    const prize = this.convoyPrize(target);
    if (won && prize && (qty > 0 || captured)) {
      this.npcConvoys.delete(target.id);
      this.e.companies.get(attacker.owner)!.cash += prize;
      this.notify(attacker.owner, `Underworld charter paid ${prize} for intercepting the NPC convoy.`);
    }
    if (qty <= 0 || good === null) return;
    this.cargoMoved(target, qty);
    const previous = this.loot.get(attacker.id);
    this.loot.set(attacker.id, { owner: attacker.owner, good,
      qty: qty + (previous?.owner === attacker.owner && previous.good === good ? previous.qty : 0) });
    this.payClaim(target, loss);
  }

  view(c: Company) {
    if (!this.enabled) return undefined;
    const future = this.futures.get(c.id);
    const credit = this.eligible(c) ? Math.ceil(this.threshold() - c.cash) : 0;
    const charter = credit ? this.consignment(c) : null;
    return {
      tariffRate: this.tariffRate,
      credit,
      consignment: charter ? { port: charter.port, qty: charter.qty } : null,
      loan: this.loans.get(c.id),
      future, futureMargin: this.futureMargin(), machineryIndex: this.machineryIndex(),
      futureAvailable: !future && c.cash >= this.futureMargin() && this.e.tick + 24 <= this.e.seasonHours,
      notices: this.notices.get(c.id) ?? [],
      haven: c.home,
      pennant: this.pennants.has(c.id), pennantPrice: 2 * this.threshold(),
      escorts: [...this.escorts].filter(([, escort]) => escort.helper === undefined).map(([target, escort]) => ({
        target, ...escort, name: this.e.companies.get(escort.owner)!.name,
      })),
      bounties: [...this.bounties].map(([id, amount]) => {
        const pledges = this.fundedBounties.get(id) ?? [];
        return { id, company: this.e.companies.get(id)!.name, amount: amount + pledges.reduce((sum, p) => sum + p.amount, 0),
          canFund: id !== c.id && c.cash >= 200 && !pledges.some(p => p.owner === c.id) };
      }),
      ships: c.ships.map(id => {
        const ship = this.e.ships.get(id)!;
        return { id, insurance: this.policies.has(id), premium: this.premium(ship.cost), convoy: this.convoys.has(id),
          convoyFee: this.convoyFee(ship.cost), stolen: this.hasLoot(ship), fence: this.fenceQuote(ship),
          canUpgrade: ship.dest === null && ship.good === 3 && ship.qty >= 10 && !this.hasLoot(ship)
            && c.cash >= 1000 && this.harborLevel(ship.port) < 3 && !this.harbors.get(ship.port)?.has(c.id)
            && !this.e.voyageQueues.has(ship.id) && !this.e.piracy.lockoutHours(c.id) };
      }),
    };
  }

  private futureMargin() { return Math.ceil(this.threshold() / 2); }
  private premium(cost: number) { return Math.max(10, Math.ceil(cost * 0.06)); }
  private convoyFee(cost: number) { return Math.max(20, Math.ceil(cost * 0.04)); }

  quoteProtection(s: Ship, cargoBasis: number, loaded: boolean, options?: VoyageProtection) {
    const costs = { insurancePremium: 0, convoyFee: 0 };
    if (options === undefined) return costs;
    if (!options || typeof options !== "object" || Array.isArray(options)
      || (options.insurance !== undefined && typeof options.insurance !== "boolean")
      || (options.convoy !== undefined && typeof options.convoy !== "boolean")) return "invalid voyage protection";
    if (!options.insurance && !options.convoy) return costs;
    if (!this.enabled || !this.e.piratesOn || s.type === "pirate" || !loaded)
      return "voyage protection is only available for loaded merchant ships";
    if (options.insurance && this.policies.has(s.id)) return "already insured";
    if (options.convoy && this.convoys.has(s.id)) return "convoy already booked";
    return {
      insurancePremium: options.insurance ? this.premium(cargoBasis) : 0,
      convoyFee: options.convoy ? this.convoyFee(cargoBasis) : 0,
    };
  }

  /** Called after the engine has loaded the cargo and debited a validated voyage quote. */
  attachProtection(s: Ship, insurancePremium: number, convoyFee: number) {
    if (insurancePremium > 0) this.policies.set(s.id, { owner: s.owner, limit: s.cost * 0.75 });
    if (convoyFee > 0) this.convoys.set(s.id, s.owner);
  }

  private fenceQuote(s: Ship) {
    const loot = this.loot.get(s.id);
    if (!loot || loot.owner !== s.owner || (!this.e.expansionEnabled && s.type !== "pirate") || s.dest !== null
      || s.port !== this.e.companies.get(s.owner)?.home || s.good !== loot.good || !s.qty) return null;
    const qty = Math.min(s.qty, loot.qty);
    return { qty, value: this.e.sellValue(s.port, loot.good, qty) * 0.85 };
  }

  apply(cmd: MaritimeCommand): Result {
    if (cmd.type === "activateMaritimeRules") {
      if (this.enabled) return fail("maritime rules already active");
      this.enabled = true;
      return { ok: true };
    }
    if (!this.enabled) return fail("maritime rules are unavailable");
    const c = this.e.companies.get(cmd.company);
    if (!c) return fail("no such company");
    if (cmd.type === "buyPennant") {
      if (this.pennants.has(c.id)) return fail("company already owns a pennant");
      const price = 2 * this.threshold();
      if (c.cash < price) return fail("not enough cash for a company pennant");
      c.cash -= price;
      this.pennants.add(c.id);
      return { ok: true };
    }
    if (cmd.type === "fundBounty") {
      const pledges = this.fundedBounties.get(cmd.target) ?? [];
      if (cmd.target === c.id || !this.wanted(cmd.target) || pledges.some(p => p.owner === c.id))
        return fail("bounty contribution unavailable");
      if (c.cash < 200) return fail("not enough cash to fund the bounty");
      c.cash -= 200;
      this.fundedBounties.set(cmd.target, [...pledges, { owner: c.id, amount: 200 }]);
      return { ok: true };
    }
    if (cmd.type === "emergencyCredit" || cmd.type === "emergencyConsignment") {
      if (!this.eligible(c)) return fail("emergency credit is unavailable");
      const charter = cmd.type === "emergencyConsignment" ? this.consignment(c) : null;
      if (cmd.type === "emergencyConsignment" && !charter) return fail("no emergency consignment is available");
      const balance = Math.ceil(this.threshold() - c.cash);
      c.cash += balance;
      if (charter) {
        const departure = this.e.applyLive(charter.command);
        if (!departure.ok) { c.cash -= balance; return departure; }
        this.consignments.set(charter.command.ship, { owner: c.id, qty: charter.qty, cost: charter.cost, dest: charter.port });
      }
      this.loans.set(c.id, { balance, graceUntil: this.e.tick + 48 });
      return { ok: true };
    }
    if (cmd.type === "machineryFuture") {
      if (cmd.side !== "long" && cmd.side !== "short") return fail("invalid futures side");
      if (this.futures.has(c.id) || this.e.tick + 24 > this.e.seasonHours) return fail("machinery future unavailable");
      const margin = this.futureMargin();
      if (c.cash < margin) return fail("not enough cash for futures margin");
      c.cash -= margin;
      this.futures.set(c.id, { side: cmd.side, entry: this.machineryIndex(), settles: this.e.tick + 24, margin });
      return { ok: true };
    }
    const s = this.e.ships.get(cmd.ship);
    if (!s || s.owner !== c.id) return fail("not your ship");
    if (cmd.type === "upgradeHarbor") {
      const sponsors = this.harbors.get(s.port) ?? new Set<number>();
      if (s.dest !== null || s.good !== 3 || s.qty < 10 || this.hasLoot(s) || sponsors.size >= 3 || sponsors.has(c.id))
        return fail("upgrade requires 10 machinery on a docked ship at a harbor you have not sponsored");
      if (c.cash < 1000) return fail("not enough cash for the harbor project");
      if (this.e.piracy.lockoutHours(c.id) || this.e.voyageQueues.has(s.id)) return fail("this ship cannot sponsor a harbor");
      c.cash -= 1000;
      s.cost *= (s.qty - 10) / s.qty;
      s.qty -= 10;
      if (!s.qty) s.good = null;
      this.e.recordSpecialSale(s, 0);
      sponsors.add(c.id);
      this.harbors.set(s.port, sponsors);
      this.notify(c.id, `Harbor upgrade at ${this.e.map.ports[s.port].name} reduced the base docking fee by 5%.`);
      return { ok: true };
    }
    if (cmd.type === "commissionConvoy") {
      if (!c.name.includes(" · ") || c.ships.length < 2 || s.dest === null || s.departTick !== this.e.tick
        || s.qty < 50 || s.type === "pirate" || c.cash < 3000 || this.npcConvoys.has(s.id))
        return fail("only a loaded NPC fleet can commission a convoy");
      c.cash -= 250;
      this.npcConvoys.set(s.id, 250);
      return { ok: true };
    }
    if (cmd.type === "offerEscort") {
      const pay = 200;
      if (s.type === "pirate" || s.dest !== null || this.escorts.has(s.id) || this.e.voyageQueues.has(s.id))
        return fail("choose a docked merchant without a queue or existing contract");
      if (!Number.isInteger(cmd.dest) || cmd.dest === s.port || !Number.isFinite(this.e.dist[s.port][cmd.dest])
        || this.e.tick + this.e.voyageHours(s.port, cmd.dest, s.type) >= this.e.seasonHours) return fail("invalid escort destination");
      if (c.cash < pay) return fail("not enough cash to fund an escort");
      c.cash -= pay;
      this.escorts.set(s.id, { owner: c.id, from: s.port, dest: cmd.dest, expires: this.e.tick + 12, pay });
      return { ok: true };
    }
    if (cmd.type === "acceptEscort") {
      const contract = this.escorts.get(cmd.target), merchant = this.e.ships.get(cmd.target);
      if (!contract || !merchant || contract.owner === c.id || contract.helper !== undefined
        || merchant.owner !== contract.owner || merchant.dest !== null || merchant.port !== contract.from
        || s.type !== "pirate" || s.qty || s.dest !== null || s.port !== contract.from
        || this.e.voyageQueues.has(s.id) || this.e.voyageQueues.has(merchant.id)) return fail("escort requires an empty pirate boat at the contract port");
      const departure = { type: "sail" as const, company: merchant.owner, ship: merchant.id, dest: contract.dest };
      const quote = this.e.voyageQuote(departure);
      if (!quote.ok || !("quote" in quote) || !quote.quote.affordable || this.e.tick + quote.quote.hours >= this.e.seasonHours)
        return fail("the merchant cannot depart");
      const follow = { type: "sail" as const, company: c.id, ship: s.id, dest: contract.dest };
      const followQuote = this.e.voyageQuote(follow);
      if (!followQuote.ok || !("quote" in followQuote)) return followQuote;
      const maxFuel = this.e.fuelNeeded(s.port, contract.dest, s.type) * this.e.rules.commodities.fuel.ceiling;
      if (c.ships.length > 1 && c.cash < maxFuel) return fail("not enough cash for escort fuel");
      this.e.apply(departure);
      this.e.apply(follow);
      s.arriveTick = merchant.arriveTick;
      const trip = this.e.openTrip(c.id, s.id);
      if (trip) trip.arriveTick = s.arriveTick;
      contract.helper = c.id;
      contract.ship = s.id;
      return { ok: true };
    }
    if (!s.qty || (s.dest !== null && s.departTick !== this.e.tick))
      return fail("book protection before departure or during the first hour underway");
    if (this.e.piracy.lockoutHours(c.id)) return fail("your company is locked out of ports");
    if (cmd.type === "fenceCargo") {
      const quote = this.fenceQuote(s);
      if (!quote) return fail("only stolen cargo at your home haven can be fenced");
      const remaining = s.qty - quote.qty;
      s.cost *= remaining / s.qty;
      s.qty = remaining;
      if (!remaining) s.good = null;
      this.cargoMoved(s, quote.qty);
      const earned = quote.value - (this.e.expansionEnabled ? this.e.fleetExpansion.leaseCut(s, quote.value) : 0);
      c.cash += earned;
      this.e.recordSpecialSale(s, earned);
      return { ok: true, sold: quote.qty, earned };
    }
    if (!this.e.piratesOn || s.type === "pirate") return fail("merchant protection is unavailable");
    if (cmd.type === "insureCargo") {
      if (this.policies.has(s.id)) return fail("already insured");
      const premium = this.premium(s.cost);
      if (c.cash < premium) return fail("not enough cash for insurance");
      c.cash -= premium;
      this.attachProtection(s, premium, 0);
    } else {
      if (this.convoys.has(s.id)) return fail("convoy already booked");
      const fee = this.convoyFee(s.cost);
      if (c.cash < fee) return fail("not enough cash for convoy");
      c.cash -= fee;
      this.attachProtection(s, 0, fee);
    }
    return { ok: true };
  }

  tick() {
    if (!this.enabled) return;
    const e = this.e;
    for (const [ship, escort] of this.escorts) {
      const merchant = e.ships.get(ship);
      if (escort.helper === undefined && !e.seasonOver && escort.expires > e.tick
        && merchant?.owner === escort.owner && merchant.port === escort.from && merchant.dest === null) continue;
      if (escort.helper !== undefined && merchant?.owner === escort.owner && merchant.dest !== null && !e.seasonOver) continue;
      const helper = escort.ship === undefined ? undefined : e.ships.get(escort.ship);
      const completed = escort.helper !== undefined && merchant?.owner === escort.owner && merchant.port === escort.dest
        && merchant.dest === null && helper?.owner === escort.helper && helper.port === escort.dest && helper.dest === null;
      const beneficiary = completed ? escort.helper! : escort.owner;
      e.companies.get(beneficiary)!.cash += escort.pay;
      this.notify(beneficiary, completed ? `Escort completed. Earned ${escort.pay}.` : `Escort deposit refunded: ${escort.pay}.`);
      this.escorts.delete(ship);
    }
    if (e.seasonOver) {
      for (const pledges of this.fundedBounties.values())
        for (const p of pledges) e.companies.get(p.owner)!.cash += p.amount;
      this.fundedBounties.clear();
    }
    for (const [id, f] of this.futures) {
      if (f.settles > e.tick) continue;
      const change = f.entry > 0 ? (this.machineryIndex() / f.entry - 1) * (f.side === "long" ? 1 : -1) : 0;
      const paid = f.margin * (1 + Math.max(-1, Math.min(1, change * 4)));
      e.companies.get(id)!.cash += paid;
      this.futures.delete(id);
      this.notify(id, `Machinery future settled for ${Math.round(paid)} on ${f.margin} margin.`);
    }
    if (e.tick % 24 !== 0) return;
    const liquid = [...e.companies.values()].reduce((sum, c) => sum + Math.max(0, c.cash), 0)
      + [...e.orders.values()].reduce((sum, o) => sum + (o.side === "buy" ? o.qty * o.price : 0), 0)
      + [...this.futures.values()].reduce((sum, f) => sum + f.margin, 0)
      + [...this.escorts.values()].reduce((sum, escort) => sum + escort.pay, 0)
      + [...this.fundedBounties.values()].flat().reduce((sum, pledge) => sum + pledge.amount, 0)
      + [...this.npcConvoys.values()].reduce((sum, prize) => sum + prize, 0)
      - e.companies.size * e.rules.company.start_cash;
    const growth = this.previousCash === undefined ? 0
      : (liquid - this.previousCash) / Math.max(1, this.previousCash + e.companies.size * e.rules.company.start_cash);
    this.previousCash = liquid;
    this.tariffRate = Math.max(0, Math.min(0.4, this.tariffRate + Math.max(-0.04, Math.min(0.04, growth - 0.01))));
    for (const order of e.orders.values()) {
      if (order.side !== "sell") continue;
      const owner = e.companies.get(order.owner)!;
      if (owner.cash >= this.threshold()) owner.cash -= Math.min(order.qty * order.price * this.tariffRate * 0.01, owner.cash - this.threshold());
    }
    for (const ship of e.ships.values()) {
      if (ship.dest !== null || ship.good !== 0 || ship.qty < 10 || e.difficulty !== "easy" || this.tariffRate <= 0.1) continue;
      const spoiled = Math.max(1, Math.floor(ship.qty * 0.01));
      ship.cost *= (ship.qty - spoiled) / ship.qty;
      ship.qty -= spoiled;
      this.cargoMoved(ship, spoiled);
    }
    for (const [id, loan] of this.loans) {
      if (loan.graceUntil > e.tick || loan.balance <= 0) continue;
      const c = e.companies.get(id)!;
      const paid = Math.min(loan.balance, Math.max(0, (c.cash - this.threshold()) * 0.2));
      c.cash -= paid;
      loan.balance -= paid;
    }
  }

  replayState() {
    return {
      enabled: this.enabled, tariffRate: this.tariffRate, previousCash: this.previousCash, routes: this.routes,
      arrivalFees: this.arrivalFees, loans: this.loans, consignments: this.consignments, policies: this.policies,
      convoys: this.convoys, npcConvoys: this.npcConvoys, escorts: this.escorts, futures: this.futures,
      loot: this.loot, bounties: this.bounties, fundedBounties: this.fundedBounties, pennants: this.pennants,
      harbors: this.harbors, salvagePaid: this.salvagePaid, notices: this.notices,
    };
  }
}
