import { GOODS, type Company, type Engine, type Result, type Ship, type ShipType } from "./engine.js";
import type { FeatureAction, FeatureCard } from "./expansion-cards.js";

export type FleetExpansionCommand = { type: "expansion"; company: number; feature: "fleet"; action: string; [key: string]: unknown };

type Refit = "crane" | "tank" | "insulated";
type Hull = Exclude<ShipType, "pirate">;
type Relocation = { ship: number; port: number };
type Lease = { company: number; balance: number };
type Sponsor = { advance: number; deadline: number; ports: Set<number>; status: "active" | "fulfilled" | "repaid" };
type YardOrder = {
  port: number; hull: Hull; paid: number; supplied: number[]; basis: number[];
  launch: number | null;
};

const YARD_HOURS = 24;
const LEASE_SHARE = 0.3;
const refitLabels: Record<Refit, string> = { crane: "Deck crane", tank: "Long-range fuel tank", insulated: "Insulated hold" };
const hulls: Hull[] = ["coaster", "freighter", "bulker"];
const fail = (error: string): Result => ({ ok: false, error });

export class FleetExpansion {
  private fits = new Map<number, Refit>();
  private service = new Map<number, Map<string, number>>();
  private leases = new Map<number, Lease>();
  private leasedOnce = new Set<number>();
  private yard = new Map<number, YardOrder>();
  private relocations = new Map<number, Relocation>();
  private moved = new Set<number>();
  private sponsors = new Map<number, Sponsor>();

  constructor(private readonly e: Engine) {}

  capacity(s: Ship, base: number): number {
    return this.fits.get(s.id) === "tank" ? Math.max(1, Math.floor(base * 0.85)) : base;
  }

  fuelNeeded(s: Ship, dest: number, base: number): number {
    return this.fits.get(s.id) === "tank" && this.e.dist[s.port][dest] >= 200 ? base * 0.75 : base;
  }

  isInsulated(s: Ship): boolean { return this.fits.get(s.id) === "insulated"; }

  homeActive(c: Company): boolean {
    const move = this.relocations.get(c.id);
    const ship = move && this.e.ships.get(move.ship);
    return !move || ship?.owner !== c.id;
  }

  fee(s: Ship, from: number, to: number, base: number): number {
    const company = this.e.companies.get(s.owner);
    if (company?.home === to && this.homeActive(company)) base *= 0.9;
    if (this.fits.get(s.id) === "crane") base *= 0.75;
    if (this.crossings(s, from, to) >= 3) base *= 0.85;
    return base;
  }

  reservedSlots(c: Company): number { return Number(this.yard.has(c.id)); }

  leased(s: Ship): boolean { return this.leases.get(s.id)?.company === s.owner; }

  leaseCut(s: Ship, gross: number): number {
    const lease = this.leases.get(s.id);
    if (!lease || lease.company !== s.owner || !Number.isFinite(gross) || gross <= 0) return 0;
    const cut = Math.min(lease.balance, gross * LEASE_SHARE);
    lease.balance -= cut;
    if (lease.balance < 0.00001) this.leases.delete(s.id);
    return cut;
  }

  removed(s: Ship) {
    this.leases.delete(s.id);
    this.fits.delete(s.id);
    this.service.delete(s.id);
  }

  arrived(s: Ship, from: number) {
    const records = this.service.get(s.id) ?? new Map<string, number>();
    const route = this.routeKey(from, s.port);
    records.set(route, Math.min(3, (records.get(route) ?? 0) + 1));
    this.service.set(s.id, records);
    const company = this.e.companies.get(s.owner)!;
    const move = this.relocations.get(company.id);
    if (move?.ship === s.id && move.port === s.port) {
      company.home = s.port;
      this.relocations.delete(company.id);
    }
    const sponsor = this.sponsors.get(company.id);
    if (sponsor?.status === "active" && this.e.tick <= sponsor.deadline) {
      sponsor.ports.add(s.port);
      if (sponsor.ports.size >= this.portGoal()) sponsor.status = "fulfilled";
    }
  }

  advance() {
    for (const [id, lease] of this.leases) {
      if (this.e.ships.get(id)?.owner !== lease.company) this.leases.delete(id);
    }
    for (const [id, move] of this.relocations) {
      const ship = this.e.ships.get(move.ship);
      if (ship?.owner !== id || ship.dest !== move.port) this.relocations.delete(id);
    }
    for (const [id, sponsor] of this.sponsors) {
      if (sponsor.status !== "active" || this.e.tick < sponsor.deadline) continue;
      this.e.companies.get(id)!.cash -= sponsor.advance;
      sponsor.status = "repaid";
    }
    for (const [id, order] of this.yard) {
      const c = this.e.companies.get(id)!;
      if (order.launch !== null && this.e.tick >= order.launch && c.ships.length < this.e.rules.company.max_ships) {
        this.e.addExpansionShip(c, order.port, order.hull);
        this.yard.delete(id);
      } else if (this.e.seasonOver) {
        this.releaseYard(c, order);
      }
    }
  }

  worth(company: number): number {
    const order = this.yard.get(company);
    const sponsor = this.sponsors.get(company);
    let worth = (order ? order.paid + order.basis.reduce((total, cost) => total + cost, 0) : 0)
      - (sponsor?.status === "active" ? sponsor.advance : 0);
    for (const [ship, lease] of this.leases) {
      if (lease.company === company && this.e.ships.get(ship)?.owner === company) worth -= lease.balance;
    }
    return worth;
  }

  replayState() {
    return {
      fits: [...this.fits], service: [...this.service].map(([id, routes]) => [id, [...routes]]),
      leases: [...this.leases], leasedOnce: [...this.leasedOnce], yard: [...this.yard],
      relocations: [...this.relocations], moved: [...this.moved],
      sponsors: [...this.sponsors].map(([id, sponsor]) => [id, { ...sponsor, ports: [...sponsor.ports] }]),
    };
  }

  apply(cmd: FleetExpansionCommand): Result {
    const c = this.e.companies.get(cmd.company);
    if (!c) return fail("no such company");
    if (this.e.seasonOver) return fail("the season has ended");
    if (this.e.piracy.lockoutHours(c.id)) return fail("your company is locked out of ports");
    switch (cmd.action) {
      case "lease": return this.takeLease(c, this.ship(c, cmd.ship));
      case "buyOut": return this.buyOut(c, this.ship(c, cmd.ship));
      case "refit": return this.install(c, this.ship(c, cmd.ship), cmd.fit);
      case "orderYard": return this.orderYard(c, cmd.hull, cmd.payment);
      case "supplyYard": return this.supplyYard(c, this.ship(c, cmd.ship));
      case "cancelYard": {
        const order = this.yard.get(c.id);
        if (!order || order.launch !== null) return fail("only an order awaiting materials can be cancelled");
        this.releaseYard(c, order);
        return { ok: true };
      }
      case "sponsor": return this.takeSponsor(c);
      case "moveHome": return this.moveHome(c, this.ship(c, cmd.ship), cmd.port);
      default: return fail("unknown fleet opportunity");
    }
  }

  private ship(c: Company, id: unknown): Ship | undefined {
    if (typeof id !== "number") return undefined;
    const ship = this.e.ships.get(id);
    return ship?.owner === c.id ? ship : undefined;
  }

  private routeKey(a: number, b: number) { return a < b ? `${a}:${b}` : `${b}:${a}`; }
  private crossings(s: Ship, a: number, b: number) { return this.service.get(s.id)?.get(this.routeKey(a, b)) ?? 0; }
  private portGoal() { return Math.min(5, this.e.n); }
  private sponsorDeadline() { return Math.min(42 * 24, this.e.seasonHours); }
  private sponsorAdvance() { return Math.max(1, Math.floor(this.e.rules.company.start_cash * 0.15)); }
  private canSponsor(c: Company) { return !this.sponsors.has(c.id) && this.e.tick + 48 <= this.sponsorDeadline(); }
  private refitPrice(s: Ship) { return Math.max(1, Math.round(this.e.spec(s.type).price * 0.0125)); }
  private leaseAdvance(s: Ship) { return this.e.spec(s.type).price * 0.5; }

  private eligibleLease(c: Company, s: Ship) {
    return s.type !== "pirate" && s.dest === null && s.qty === 0 && c.cash < this.e.rules.company.start_cash * 0.25
      && !this.leasedOnce.has(s.id) && !this.leases.has(s.id) && !this.e.voyageQueues.has(s.id);
  }

  private takeLease(c: Company, s?: Ship): Result {
    if (!s || !this.eligibleLease(c, s)) return fail("choose an empty docked merchant ship while short of cash");
    const advance = this.leaseAdvance(s);
    c.cash += advance;
    this.leases.set(s.id, { company: c.id, balance: advance });
    this.leasedOnce.add(s.id);
    return { ok: true, earned: advance };
  }

  private buyOut(c: Company, s?: Ship): Result {
    const lease = s && this.leases.get(s.id);
    if (!s || !lease || lease.company !== c.id) return fail("this ship has no lease to buy out");
    if (c.cash < lease.balance) return fail("not enough cash for the lease buyout");
    c.cash -= lease.balance;
    this.leases.delete(s.id);
    return { ok: true, spent: lease.balance };
  }

  private install(c: Company, s: Ship | undefined, fit: unknown): Result {
    if (!s || s.type === "pirate" || s.dest !== null || s.port !== c.home || s.qty || !this.homeActive(c))
      return fail("bring an empty merchant ship to your home shipyard");
    if (this.e.voyageQueues.has(s.id)) return fail("cancel the voyage queue before refitting");
    if (fit !== "crane" && fit !== "tank" && fit !== "insulated" && fit !== "none") return fail("choose a valid refit");
    const installed = this.fits.get(s.id) ?? "none";
    if (installed === fit) return fail("this ship already has that setup");
    const price = fit === "none" ? 0 : this.refitPrice(s);
    if (price > 0 && c.cash < price) return fail("not enough cash for this refit");
    c.cash -= price;
    if (fit === "none") this.fits.delete(s.id);
    else this.fits.set(s.id, fit);
    return { ok: true, spent: price };
  }

  private takeSponsor(c: Company): Result {
    if (!this.canSponsor(c)) return fail("there is no sponsor available this late in the season or you have already taken a stake");
    const advance = this.sponsorAdvance();
    c.cash += advance;
    this.sponsors.set(c.id, { advance, deadline: this.sponsorDeadline(), ports: new Set(), status: "active" });
    return { ok: true, earned: advance };
  }

  private moveHome(c: Company, s: Ship | undefined, port: unknown): Result {
    if (this.moved.has(c.id)) return fail("you can relocate headquarters once per season");
    if (!s || s.port !== c.home || s.dest !== null || s.qty || s.type === "pirate" || this.leased(s))
      return fail("choose an empty, owned merchant ship at headquarters");
    if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port >= this.e.n || port === c.home)
      return fail("choose another port for your headquarters");
    const cmd = { type: "sail" as const, company: c.id, ship: s.id, dest: port };
    const quote = this.e.voyageQuote(cmd);
    if (!quote.ok || !("quote" in quote)) return quote;
    if (this.e.tick + quote.quote.hours > this.e.seasonHours) return fail("headquarters would arrive after the season ends");
    const result = this.e.applyLive(cmd);
    if (!result.ok) return result;
    this.relocations.set(c.id, { ship: s.id, port });
    this.moved.add(c.id);
    return { ok: true };
  }

  private yardCost(hull: Hull, materials: boolean) {
    return Math.round(this.e.spec(hull).price * (materials ? 0.68 : 0.93));
  }

  private materials(hull: Hull) {
    const scale = hull === "coaster" ? 1 : hull === "freighter" ? 2 : 4;
    return [0, 0, 25 * scale, 6 * scale];
  }

  private canOrder(c: Company) {
    return !this.yard.has(c.id) && c.ships.length < this.e.rules.company.max_ships && this.homeActive(c)
      && this.e.tick + YARD_HOURS <= this.e.seasonHours
      && c.ships.some(id => {
        const ship = this.e.ships.get(id);
        return ship?.dest === null && ship.port === c.home;
      });
  }

  private orderYard(c: Company, hull: unknown, payment: unknown): Result {
    if (hull !== "coaster" && hull !== "freighter" && hull !== "bulker") return fail("choose a merchant hull");
    if (!this.e.rules.ship_types && hull !== "freighter") return fail("this ship class is unavailable");
    if (payment !== "cash" && payment !== "materials") return fail("choose cash or materials");
    if (!this.canOrder(c)) return fail("the home shipyard needs a docked ship, one free fleet slot, and time to build");
    const paid = this.yardCost(hull, payment === "materials");
    if (c.cash < paid) return fail("not enough cash to place the ship order");
    c.cash -= paid;
    this.yard.set(c.id, { port: c.home, hull, paid, supplied: GOODS.map(() => 0), basis: GOODS.map(() => 0),
      launch: payment === "cash" ? this.e.tick + YARD_HOURS : null });
    return { ok: true, spent: paid };
  }

  private need(order: YardOrder, s?: Ship) {
    if (!s || s.dest !== null || s.port !== order.port || s.good === null || s.qty < 1
      || this.e.maritime.hasLoot(s) || this.e.voyageQueues.has(s.id)) return 0;
    return Math.min(Math.floor(s.qty), this.materials(order.hull)[s.good] - order.supplied[s.good]);
  }

  private supplyYard(c: Company, s?: Ship): Result {
    const order = this.yard.get(c.id);
    if (!order || order.launch !== null || this.e.tick + YARD_HOURS > this.e.seasonHours)
      return fail("there is no material order with time left to build");
    if (!s || s.good === null) return fail("choose a ship delivering materials");
    const quantity = this.need(order, s);
    if (quantity <= 0) return fail("bring the ore or machinery still needed to the shipyard");
    const basis = s.cost * quantity / s.qty;
    order.supplied[s.good] += quantity;
    order.basis[s.good] += basis;
    s.qty -= quantity;
    s.cost = s.qty ? Math.max(0, s.cost - basis) : 0;
    if (!s.qty) s.good = null;
    this.e.maritime.cargoMoved(s, quantity);
    this.e.maritime.dockedCargoChanged(s);
    this.e.recordSpecialSale(s, 0);
    if (this.materials(order.hull).every((qty, g) => order.supplied[g] >= qty)) order.launch = this.e.tick + YARD_HOURS;
    return { ok: true, sold: quantity };
  }

  private releaseYard(c: Company, order: YardOrder) {
    const e = this.e;
    c.cash += order.paid;
    for (const [good, qty] of order.supplied.entries()) {
      if (!qty) continue;
      c.cash += Math.min(e.sellValue(order.port, good, qty), order.basis[good]);
      e.stock[order.port][good] += qty;
    }
    this.yard.delete(c.id);
  }

  private action(label: string, action: string, fields: Record<string, unknown> = {}): FeatureAction {
    return { label, command: { type: "expansion", feature: "fleet", action, ...fields } };
  }

  cards(company: number): FeatureCard[] {
    const c = this.e.companies.get(company);
    if (!c) return [];
    const ships = c.ships.map(id => this.e.ships.get(id)!);
    const docked = ships.filter(s => s.dest === null && s.type !== "pirate");
    const cash = (n: number) => `${Math.ceil(n).toLocaleString("en-GB")} credits`;
    const port = (id: number) => this.e.map.ports[id].name;
    const hour = (tick: number) => `day ${Math.floor(tick / 24) + 1}, ${String(tick % 24).padStart(2, "0")}:00`;
    const cards: FeatureCard[] = [];

    const leaseActions: FeatureAction[] = [];
    const leaseNotes: string[] = [];
    for (const ship of ships) {
      const lease = this.leases.get(ship.id);
      if (lease?.company === company) {
        leaseNotes.push(`Ship ${ship.id} owes ${cash(lease.balance)}.`);
        if (c.cash >= lease.balance) leaseActions.push(this.action(`Buy back ship ${ship.id}`, "buyOut", { ship: ship.id }));
      } else if (this.eligibleLease(c, ship)) {
        leaseActions.push(this.action(`Lease ship ${ship.id} for ${cash(this.leaseAdvance(ship))}`, "lease", { ship: ship.id }));
      }
    }
    cards.push({ title: "One More Voyage", detail: `Sell a docked, empty merchant ship to the lender for cash and keep sailing it. The lender takes 30% of its cargo sale proceeds until the hull is yours again.${leaseNotes.length ? ` ${leaseNotes.join(" ")}` : ""}`,
      actions: leaseActions });

    const homeShips = docked.filter(s => s.port === c.home && !s.qty && !this.e.voyageQueues.has(s.id));
    const refitActions = this.homeActive(c) ? homeShips.map(s => ({ ...this.action(`Refit ship ${s.id}`, "refit", { ship: s.id }), fields: [{ key: "fit", label: `One slot on ship ${s.id}`, options: [
      ...(Object.entries(refitLabels) as [Refit, string][]).filter(([fit]) => this.fits.get(s.id) !== fit)
        .map(([fit, label]) => ({ value: fit, label: `${label} (${cash(this.refitPrice(s))})` })),
      ...(this.fits.has(s.id) ? [{ value: "none", label: "Remove the current refit (free)" }] : []),
    ] }] })) : [];
    const fitted = ships.flatMap(s => { const fit = this.fits.get(s.id); return fit ? [`Ship ${s.id}: ${refitLabels[fit]}`] : []; });
    cards.push({ title: "One-slot refit", detail: `A crane reduces docking fees by 25%. A long-range tank saves 25% fuel on voyages of at least 200 distance at the cost of 15% of the hold. Insulation helps with fresh catch. Refit an empty ship at headquarters.${fitted.length ? ` ${fitted.join(". ")}.` : ""}`,
      actions: refitActions });

    const yard = this.yard.get(c.id);
    if (yard) {
      const needed = this.materials(yard.hull).map((qty, i) => Math.max(0, qty - yard.supplied[i]));
      const waiting = yard.launch === null;
      cards.push({ title: "Build Your Next Ship", detail: waiting
        ? `Your ${yard.hull} at ${port(yard.port)} needs ${needed[2]} ore and ${needed[3]} machinery. Build takes 24 game hours after the materials arrive.`
        : `Your ${yard.hull} launches at ${port(yard.port)} on ${hour(yard.launch!)}.`,
        actions: waiting ? [
          ...docked.filter(s => this.need(yard, s) > 0).map(s => this.action(`Deliver ${this.need(yard, s)} ${GOODS[s.good!]} from ship ${s.id}`, "supplyYard", { ship: s.id })),
          this.action("Cancel order and release materials", "cancelYard"),
        ] : [] });
    } else {
      const available = this.e.rules.ship_types ? hulls : ["freighter" as const];
      cards.push({ title: "Build Your Next Ship", detail: `A 24-hour build is cheaper than buying off the dock. Supply your own ore and machinery to reduce the cash price further. Shipyard orders reserve one fleet slot.`,
        actions: this.canOrder(c) ? available.map(hull => ({ ...this.action(`Order ${hull}`, "orderYard", { hull }), fields: [{ key: "payment", label: "Payment", options: [
          { value: "cash", label: `Cash only (${cash(this.yardCost(hull, false))})` },
          { value: "materials", label: `${cash(this.yardCost(hull, true))} plus ${this.materials(hull)[2]} ore and ${this.materials(hull)[3]} machinery` },
        ] }] })) : [] });
    }

    const sponsorship = this.sponsors.get(company);
    const publicStakes = [...this.sponsors].slice(-8).map(([id, stake]) =>
      `${this.e.companies.get(id)!.name} ${stake.ports.size}/${this.portGoal()} (${stake.status})`);
    cards.push({ title: "Sponsor’s Stake", detail: `${sponsorship ? `Your goal: ${sponsorship.ports.size}/${this.portGoal()} distinct ports reached (${sponsorship.status}).` : `Take ${cash(this.sponsorAdvance())} now. Reach ${this.portGoal()} different ports by the end of day ${Math.ceil(this.sponsorDeadline() / 24)} or repay the advance.`}${publicStakes.length ? `\nPublic stakes: ${publicStakes.join(" · ")}` : ""}`,
      actions: this.canSponsor(c) ? [this.action("Accept the sponsor’s stake", "sponsor")] : [] });

    const routes = ships.flatMap(s => [...(this.service.get(s.id) ?? [])]
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, count]) => {
        const [a, b] = key.split(":").map(Number);
        return `Ship ${s.id} · ${port(a)} ↔ ${port(b)} · ${count}/3`;
      }));
    cards.push({ title: "Old Reliable", detail: `Three completed voyages on the same route earn that hull a 15% docking discount there.${routes.length ? `\n${routes.join("\n")}` : ""}` });

    const move = this.relocations.get(company);
    const destinations = this.e.map.ports.filter(p => p.id !== c.home && Number.isFinite(this.e.dist[c.home][p.id]));
    const moveActions = !this.moved.has(c.id) && destinations.length ? homeShips.filter(s => !this.leased(s)).map(s => ({
      ...this.action(`Relocate aboard ship ${s.id}`, "moveHome", { ship: s.id }), fields: [{ key: "port", label: "New headquarters", options: destinations.map(p => ({ value: p.id, label: p.name })) }],
    })) : [];
    cards.push({ title: "Move your headquarters", detail: move ? `Headquarters is travelling to ${port(move.port)} aboard ship ${move.ship}. Home-port benefits resume when it arrives.`
      : `Your headquarters is at ${port(c.home)}. Docking at home costs 10% less.${this.moved.has(c.id) ? " This season’s relocation has been used." : " You can move once per season aboard an empty merchant ship."}`,
      actions: moveActions });
    return cards;
  }
}
