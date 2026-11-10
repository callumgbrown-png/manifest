import { GOODS, type Engine, type Result, type Ship } from "./engine.js";
import type { FeatureAction, FeatureCard } from "./expansion-cards.js";

export type PortExpansionCommand = {
  type: "expansion";
  company: number;
  feature: "ports";
  action: string;
  [key: string]: unknown;
};

type Side = "buy" | "sell";
type Policy = "food" | "ore";
type Repair = {
  port: number;
  ends: number;
  ore: number;
  machinery: number;
  contributions: Map<number, number>;
};
type Berth = { id: number; port: number; block: number; owner: number; ask?: number };
type Council = { port: number; opens: number; closes: number; votes: Map<number, Policy>; policy?: Policy };
type MillLease = { owner: number; ends: number };
type MillBatch = { owner: number; ready: number; good: number; qty: number; cost: number };

const fail = (error: string): Result => ({ ok: false, error });
const hoursPerBerth = 12;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

/** Port initiatives are derived solely from the season map and recorded actions. */
export class PortExpansion {
  private enabled = false;
  private repair?: Repair;
  private berthSequence = 0;
  private berths = new Map<number, Berth>();
  private councils = new Map<number, Council>();
  private millPort?: number;
  private lease?: MillLease;
  private batches = new Map<number, MillBatch>();

  constructor(private readonly e: Engine) {}

  activate() {
    if (this.enabled) return;
    this.enabled = true;
    const e = this.e;
    const connected = e.map.ports.filter(p => e.dist[p.id].some((d, other) => other !== p.id && Number.isFinite(d)));
    if (!connected.length) return;
    const remaining = e.seasonHours - e.tick;
    const damaged = connected.find(p => p.consumes.includes("machinery")) ?? connected[0];
    if (remaining >= 48) {
      this.repair = { port: damaged.id, ends: Math.min(e.tick + 96, e.seasonHours - 1),
        ore: 25, machinery: 5, contributions: new Map() };
    }
    const opens = e.tick + Math.floor(remaining / 3);
    const closes = Math.min(e.seasonHours - 1, opens + 72);
    if (closes - opens >= 12) {
      for (const p of connected.slice(0, 3))
        this.councils.set(p.id, { port: p.id, opens, closes, votes: new Map() });
    }
    this.millPort = (connected.find(p => p.produces.includes("machinery") && p.id !== damaged.id)
      ?? connected.find(p => p.id !== damaged.id) ?? damaged).id;
  }

  private repairComplete() {
    return this.repair?.ore === 0 && this.repair.machinery === 0;
  }

  destinationError(ship: Ship, dest: number): string | undefined {
    if (this.repair?.port === dest && ship.type === "bulker" && !this.repairComplete())
      return "The deep-water berth is damaged. Use a smaller ship until the repair is complete.";
    return undefined;
  }

  tradeTax(port: number, good: number, side: Side, base: number) {
    const policy = this.councils.get(port)?.policy;
    if ((policy === "food" && side === "sell" && GOODS[good] === "grain") ||
        (policy === "ore" && side === "buy" && GOODS[good] === "ore")) return base / 2;
    return base;
  }

  private berthAt(port: number, tick: number) {
    if (!this.berths.size) return undefined;
    const block = Math.floor(tick / hoursPerBerth);
    for (const berth of this.berths.values()) {
      if (berth.port === port && berth.block === block) return berth;
    }
    return undefined;
  }

  quoteFee(ship: Ship, dest: number, arrivalTick: number, base: number) {
    return this.berthAt(dest, arrivalTick)?.owner === ship.owner ? 0 : base;
  }

  arriveFee(ship: Ship, base: number) {
    const berth = this.berthAt(ship.port, this.e.tick);
    if (berth?.owner !== ship.owner) return base;
    this.berths.delete(berth.id);
    return 0;
  }

  private consumeCargo(ship: Ship, qty: number, revenue: number) {
    const fraction = qty / ship.qty;
    ship.qty -= qty;
    ship.cost *= 1 - fraction;
    if (!ship.qty) ship.good = null;
    this.e.maritime.cargoMoved(ship, qty);
    this.e.maritime.dockedCargoChanged(ship);
    this.e.recordSpecialSale(ship, revenue);
  }

  private workingShip(company: number, rawShip: unknown, port: number | undefined) {
    if (!integer(rawShip) || port === undefined) return undefined;
    const ship = this.e.ships.get(rawShip);
    if (!ship || ship.owner !== company || ship.dest !== null || ship.port !== port || ship.type === "pirate"
        || this.e.voyageQueues.has(ship.id) || this.e.maritime.hasLoot(ship)) return undefined;
    return ship;
  }

  private votedHere(company: number, port: number) {
    return (this.e.trips.get(company) ?? []).some(t => t.to === port && t.arriveTick > this.e.tick - 168
      && t.arriveTick <= this.e.tick && t.earned > 0);
  }

  private recipe(good: number | null) {
    if (good === GOODS.indexOf("ore"))
      return { output: GOODS.indexOf("machinery"), ratio: Math.max(3, Math.ceil(this.e.map.industry?.orePerMachinery ?? 3)), hours: 8 };
    if (good === GOODS.indexOf("grain")) return { output: GOODS.indexOf("fuel"), ratio: 2, hours: 4 };
    return undefined;
  }

  private get rent() {
    return Math.max(25, Math.round(this.e.rules.company.start_cash * 0.025));
  }

  apply(cmd: PortExpansionCommand): Result {
    const e = this.e, c = e.companies.get(cmd.company);
    if (!this.enabled || e.seasonOver) return fail("port initiatives are closed");
    if (!c) return fail("no such company");
    if (e.piracy.lockoutHours(c.id)) return fail("your company is locked out of ports");
    switch (cmd.action) {
      case "deliverRepair": {
        const project = this.repair;
        if (!project || this.repairComplete() || e.tick >= project.ends) return fail("the repair delivery window has closed");
        const ship = this.workingShip(c.id, cmd.ship, project.port);
        if (!ship || !ship.qty || ship.good === null) return fail("dock an eligible loaded ship at the damaged berth's port");
        const good = GOODS[ship.good];
        if (good !== "ore" && good !== "machinery") return fail("the project needs ore or machinery");
        const qty = Math.min(ship.qty, project[good]);
        if (!qty) return fail("the project already has enough of this cargo");
        const pay = e.sellValue(ship.port, ship.good, qty) * (1 - this.tradeTax(ship.port, ship.good, "sell", e.rules.fees.trade_tax_rate));
        this.consumeCargo(ship, qty, pay);
        c.cash += pay;
        project[good] -= qty;
        project.contributions.set(c.id, (project.contributions.get(c.id) ?? 0) + qty * (good === "machinery" ? 5 : 1));
        if (this.repairComplete()) {
          const pot = Math.round(e.rules.company.start_cash * 0.08);
          const weight = [...project.contributions.values()].reduce((sum, part) => sum + part, 0);
          for (const [owner, part] of project.contributions) {
            const member = e.companies.get(owner);
            if (member) member.cash += pot * part / weight;
          }
        }
        return { ok: true, sold: qty, earned: pay };
      }
      case "reserveBerth": {
        const port = cmd.port, block = cmd.block;
        if (!integer(port) || !e.map.ports[port] || !integer(block)) return fail("choose a port and a valid berth time");
        const current = Math.floor(e.tick / hoursPerBerth), start = block * hoursPerBerth;
        if (block < current || block > current + 2 || start >= e.seasonHours) return fail("reserve a berth within the next two windows");
        if (this.berthAt(port, start)) return fail("that berth is already reserved");
        if ([...this.berths.values()].filter(b => b.owner === c.id).length >= 2) return fail("you can hold at most two berths");
        const cost = Math.max(1, Math.floor(e.rules.fees.port_fee_per_docking / 5));
        if (c.cash < cost) return fail("not enough cash to reserve the berth");
        const id = ++this.berthSequence;
        c.cash -= cost;
        this.berths.set(id, { id, owner: c.id, port, block });
        return { ok: true, id, spent: cost };
      }
      case "listBerth": {
        const berth = integer(cmd.berth) ? this.berths.get(cmd.berth) : undefined;
        if (!berth || berth.owner !== c.id) return fail("that reservation is not yours");
        if (!integer(cmd.price) || cmd.price < 0 || cmd.price > Math.ceil(e.rules.fees.port_fee_per_docking))
          return fail("set a price between zero and the standard docking fee");
        berth.ask = cmd.price;
        return { ok: true };
      }
      case "buyBerth": {
        const berth = integer(cmd.berth) ? this.berths.get(cmd.berth) : undefined;
        if (!berth || berth.owner === c.id || berth.ask === undefined || berth.ask !== cmd.price)
          return fail("that berth listing has changed");
        const seller = e.companies.get(berth.owner);
        if (!seller || c.cash < berth.ask) return fail("not enough cash for that berth");
        if ([...this.berths.values()].filter(b => b.owner === c.id).length >= 2) return fail("you can hold at most two berths");
        const price = berth.ask;
        c.cash -= price;
        seller.cash += price;
        berth.owner = c.id;
        delete berth.ask;
        return { ok: true, spent: price };
      }
      case "voteCouncil": {
        const council = integer(cmd.port) ? this.councils.get(cmd.port) : undefined;
        if (!council || e.tick < council.opens || e.tick >= council.closes) return fail("this council is not voting now");
        if (!this.votedHere(c.id, council.port)) return fail("complete a paid delivery here within the last seven days to vote");
        if (council.votes.has(c.id)) return fail("your company has already cast its vote");
        if (cmd.policy !== "food" && cmd.policy !== "ore") return fail("choose one of the two council policies");
        council.votes.set(c.id, cmd.policy);
        return { ok: true };
      }
      case "leaseMill": {
        if (this.lease || this.batches.has(c.id)) return fail("the mill is already leased or you have a batch awaiting pickup");
        if (e.tick + 9 >= e.seasonHours) return fail("too late in the season to lease the mill");
        const ship = this.workingShip(c.id, cmd.ship, this.millPort);
        if (!ship) return fail("dock an eligible ship at the mill's port first");
        if (c.cash < this.rent) return fail("not enough cash to lease the mill");
        const cost = this.rent;
        c.cash -= cost;
        this.lease = { owner: c.id, ends: Math.min(e.tick + 168, e.seasonHours) };
        return { ok: true, spent: cost };
      }
      case "runMill": {
        if (this.lease?.owner !== c.id || this.batches.has(c.id)) return fail("you need a mill lease and an empty production bay");
        const ship = this.workingShip(c.id, cmd.ship, this.millPort);
        const recipe = ship && this.recipe(ship.good);
        if (!ship || !recipe) return fail("bring grain for fuel or ore for machinery");
        const qty = cmd.qty, ready = e.tick + recipe.hours;
        if (!integer(qty) || qty < 1 || qty > 20 || qty * recipe.ratio > ship.qty)
          return fail("choose a batch of 1–20 units backed by the loaded inputs");
        if (ready >= e.seasonHours || ready > this.lease.ends) return fail("this batch would finish after the lease or season ends");
        const inputs = qty * recipe.ratio, cost = ship.cost * inputs / ship.qty;
        this.consumeCargo(ship, inputs, 0);
        this.batches.set(c.id, { owner: c.id, ready, good: recipe.output, qty, cost });
        return { ok: true };
      }
      case "collectMill": {
        const batch = this.batches.get(c.id);
        const ship = this.workingShip(c.id, cmd.ship, this.millPort);
        if (!batch || batch.ready > e.tick || !ship || ship.qty || batch.qty > e.expansionCapacity(ship))
          return fail("dock an empty ship with room for the finished batch");
        ship.good = batch.good;
        ship.qty = batch.qty;
        ship.cost = batch.cost;
        this.batches.delete(c.id);
        return { ok: true, bought: batch.qty };
      }
      default: return fail("unknown port initiative");
    }
  }

  advance() {
    if (!this.enabled) return;
    const tick = this.e.tick;
    for (const [id, berth] of this.berths) {
      if ((berth.block + 1) * hoursPerBerth <= tick) this.berths.delete(id);
    }
    for (const council of this.councils.values()) {
      if (council.closes !== tick || !council.votes.size) continue;
      const food = [...council.votes.values()].filter(vote => vote === "food").length;
      const ore = council.votes.size - food;
      if (food !== ore) council.policy = food > ore ? "food" : "ore";
    }
    if (this.lease && this.lease.ends <= tick) this.lease = undefined;
  }

  worth(company: number) {
    return this.batches.get(company)?.cost ?? 0;
  }

  replayState() {
    const repair = this.repair;
    return { enabled: this.enabled, berthSequence: this.berthSequence,
      repair: repair && { ...repair, contributions: [...repair.contributions] },
      berths: [...this.berths], councils: [...this.councils.values()].map(c => ({ ...c, votes: [...c.votes] })),
      millPort: this.millPort, lease: this.lease, batches: [...this.batches] };
  }

  cards(company: number): FeatureCard[] {
    if (!this.enabled || !this.e.companies.has(company)) return [];
    const e = this.e, cards: FeatureCard[] = [];
    const clock = (tick: number) => `Day ${Math.floor(tick / 24) + 1}, ${String(tick % 24).padStart(2, "0")}:00`;
    const portName = (id: number) => e.map.ports[id].name;
    const action = (label: string, type: string, args: Record<string, unknown> = {}): FeatureAction =>
      ({ label, command: { type: "expansion", feature: "ports", action: type, ...args } });
    const active = !e.seasonOver && !e.piracy.lockoutHours(company);
    const ownAt = (port: number) => (e.companies.get(company)?.ships ?? [])
      .map(id => this.workingShip(company, id, port)).filter((s): s is Ship => !!s);
    const repair = this.repair;
    if (repair) {
      const complete = this.repairComplete(), expired = e.tick >= repair.ends;
      const detail = complete ? `${portName(repair.port)}'s deep-water berth is open for the season.`
        : expired ? `${portName(repair.port)} missed its repair deadline. Bulkers cannot use the damaged berth.`
        : `${portName(repair.port)} needs ${repair.ore} ore and ${repair.machinery} machinery by ${clock(repair.ends)}. Deliveries earn market pay and a share of the completion bonus. Bulkers cannot dock until repairs finish.`;
      const actions = active && !complete && !expired ? ownAt(repair.port)
        .filter(s => s.qty && (s.good === 2 ? repair.ore > 0 : s.good === 3 && repair.machinery > 0))
        .map(s => action(`Contribute cargo from ship #${s.id}`, "deliverRepair", { ship: s.id })) : [];
      cards.push({ title: "The Last Ship In", detail, actions });
    }
    const current = Math.floor(e.tick / hoursPerBerth);
    const openBlocks = [current, current + 1, current + 2].filter(block => block * hoursPerBerth < e.seasonHours);
    const cost = Math.max(1, Math.floor(e.rules.fees.port_fee_per_docking / 5));
    const berthActions: FeatureAction[] = active && openBlocks.length ? [{
      ...action("Reserve a berth", "reserveBerth"),
      fields: [
        { key: "port", label: "Port", options: e.map.ports.map(p => ({ value: p.id, label: p.name })) },
        { key: "block", label: "Arrival window", options: openBlocks.map(value =>
          ({ value, label: clock(value * hoursPerBerth) })) },
      ],
    }] : [];
    for (const berth of this.berths.values()) {
      if (!active) break;
      const description = `${portName(berth.port)} at ${clock(berth.block * hoursPerBerth)}`;
      if (berth.owner === company) berthActions.push({
        ...action(`List or reprice ${description}`, "listBerth", { berth: berth.id }),
        fields: [{ key: "price", label: "Price", min: 0, max: Math.ceil(e.rules.fees.port_fee_per_docking), value: berth.ask ?? cost }],
      });
      else if (berth.ask !== undefined) berthActions.push(action(`Buy ${description} for ${berth.ask} credits`,
        "buyBerth", { berth: berth.id, price: berth.ask }));
    }
    cards.push({ title: "Berth Reservations", detail: `Reserve a 12-hour arrival window for ${cost} credits. The first ship you dock in that window pays no docking fee. You can list an unused reservation for resale.`, actions: berthActions });

    for (const council of this.councils.values()) {
      const canVote = active && e.tick >= council.opens && e.tick < council.closes &&
        !council.votes.has(company) && this.votedHere(company, council.port);
      const detail = e.tick < council.opens ? `Voting opens ${clock(council.opens)}.`
        : e.tick < council.closes ? `Voting ends ${clock(council.closes)}. A recent paid delivery earns your company one vote. ${council.votes.size} votes cast.`
        : council.policy ? `The council halved the ${council.policy === "food" ? "tax on grain sales" : "tax on ore purchases"} for the rest of the season.`
        : "The council kept existing trade taxes.";
      cards.push({ title: `Port Council · ${portName(council.port)}`, detail, actions: canVote ? [
        action("Cut food import duty", "voteCouncil", { port: council.port, policy: "food" }),
        action("Cut ore export duty", "voteCouncil", { port: council.port, policy: "ore" }),
      ] : [] });
    }
    if (this.millPort !== undefined) {
      const batch = this.batches.get(company);
      const actions: FeatureAction[] = [];
      if (active) for (const ship of ownAt(this.millPort)) {
        if (!this.lease && !batch && e.tick + 9 < e.seasonHours) actions.push(action(`Lease for ${this.rent} credits`, "leaseMill", { ship: ship.id }));
        if (batch && batch.ready <= e.tick && !ship.qty && batch.qty <= e.expansionCapacity(ship))
          actions.push(action(`Load batch onto ship #${ship.id}`, "collectMill", { ship: ship.id }));
        const recipe = this.recipe(ship.good), max = recipe ? Math.min(20, Math.floor(ship.qty / recipe.ratio)) : 0;
        if (this.lease?.owner === company && !batch && recipe && max > 0) actions.push({
          ...action(`Produce ${GOODS[recipe.output]} from ship #${ship.id}`, "runMill", { ship: ship.id }),
          fields: [{ key: "qty", label: `Output units (${recipe.ratio} input each)`, min: 1, max, value: max }],
        });
      }
      const status = batch ? `Your batch of ${batch.qty} ${GOODS[batch.good]} ${batch.ready <= e.tick ? "is ready" : `finishes ${clock(batch.ready)}`}.`
        : this.lease ? `${this.lease.owner === company ? "Your lease" : "Current lease"} expires ${clock(this.lease.ends)}.`
        : "The mill is available to lease.";
      cards.push({ title: `Lease the Mill · ${portName(this.millPort)}`,
        detail: `${status} Convert grain into fuel or ore into machinery, then collect the output for your next voyage.`, actions });
    }
    const arrivals = [...e.ships.values()].filter(s => s.dest !== null).sort((a, b) => a.arriveTick - b.arriveTick || a.id - b.id);
    for (const port of e.map.ports) {
      const inbound = arrivals.filter(s => s.dest === port.id);
      if (!inbound.length) continue;
      const list = inbound.slice(0, 4).map(s => {
        const cargo = s.good === null || !s.qty ? "empty" : `${s.qty < 20 ? "1–19" : s.qty < 50 ? "20–49" : s.qty < 100 ? "50–99" : "100+"} ${GOODS[s.good]}`;
        return `Ship #${s.id} · ${clock(s.arriveTick)} · ${cargo}`;
      });
      cards.push({ title: `Arrival Board · ${port.name}`, detail: list.join(" | ") });
    }
    return cards;
  }
}
