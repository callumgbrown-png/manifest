import type { Company, Engine, MapData, Result, Ship } from "./engine.js";
import type { FeatureAction, FeatureCard } from "./expansion-cards.js";
import type { Pt } from "./geo.js";

export type ExplorationExpansionCommand = {
  type: "expansion";
  company: number;
  feature: "exploration";
  action: string;
  [key: string]: unknown;
};

type Lane = MapData["routes"][number];
interface Ground {
  id: number;
  lane: Lane;
  position: Pt;
  hint: Pt;
  stock: number;
  public: boolean;
  known: Set<number>;
}
interface Fish {
  kind: "fish";
  owner: number;
  ground: number;
  qty: number;
  cost: number;
  caught: number;
  expires: number;
  ask?: number;
}
interface Samples { kind: "samples"; owner: number; expires: number }
type OffshoreCargo = Fish | Samples;
interface Survey { owner: number; complete: number; ground?: number; storm?: number }
interface Storm { id: number; lane: Lane; port: number; starts: number; ends: number; position: Pt }
interface Bulletin { known: Set<number>; offers: Map<number, number> }

const FISH_STOCK = 36;
const LAB_GRAIN = 8;
const LAB_SUPPLY_PAY = 390;
const LAB_SAMPLE_PAY = 570;
const STORM_PERIOD = 96;
const STORM_HOURS = 8;
const REPORT_HOURS = 24;
const fail = (error: string): Result => ({ ok: false, error });

/** Offshore jobs use their own manifest, while the ordinary ship, voyage and cargo rules stay authoritative. */
export class ExplorationExpansion {
  private enabledAt?: number;
  private grounds: Ground[] = [];
  private lab?: Lane;
  private stormLanes: Lane[] = [];
  private labNext = 0;
  private batch?: { ready: number; expires: number; holder?: number };
  private readonly cargo = new Map<number, OffshoreCargo>();
  private readonly surveys = new Map<number, Survey>();
  private readonly bulletins = new Map<number, Bulletin>();

  constructor(private readonly e: Engine) {}

  activate() {
    this.enabledAt = this.e.tick;
    const routes = this.e.map.routes.filter(r => this.e.piracy.geo.lanePath(r.a, r.b).length === 2)
      .sort((a, b) => b.distance - a.distance || a.a - b.a || a.b - b.b);
    this.grounds = routes.slice(0, 2).map((lane, index) => ({
      id: index + 1, lane, position: this.point(lane, 0.52), hint: this.point(lane, 0.39),
      stock: FISH_STOCK, public: false, known: new Set(),
    }));
    this.lab = routes[2] ?? routes[0];
    this.stormLanes = routes.slice(3, 8);
    if (!this.stormLanes.length) this.stormLanes = routes;
  }

  private point(lane: Lane, fraction = 0.5) {
    const geo = this.e.piracy.geo;
    return geo.at(geo.voyage(lane.a, lane.b), fraction);
  }

  private port(id: number) { return this.e.map.ports[id].name; }
  private laneName(lane: Lane) { return `${this.port(lane.a)}–${this.port(lane.b)}`; }
  private clock(tick: number) { return `day ${Math.floor(tick / 24) + 1}, ${String(tick % 24).padStart(2, "0")}:00`; }

  private alongside(ship: Ship, lane: Lane, position = this.point(lane)) {
    if (ship.dest === null) return false;
    const path = this.e.piracy.geo.lanePath(ship.port, ship.dest);
    const crosses = path.some((port, i) => (port === lane.a && path[i + 1] === lane.b)
      || (port === lane.b && path[i + 1] === lane.a));
    if (!crosses) return false;
    // A fast coaster must have an opportunity to work a site even when a route takes very few hourly ticks.
    const radius = Math.min(lane.distance / 2 + 2, Math.max(55, this.e.spec(ship.type).speed_per_hour * 0.65));
    return this.e.piracy.geo.dist(this.e.piracy.position(ship), position) <= radius;
  }

  private storm(id: number): Storm | undefined {
    if (this.enabledAt === undefined || !this.stormLanes.length || id < 0) return undefined;
    const lane = this.stormLanes[id % this.stormLanes.length];
    const starts = this.enabledAt + 36 + id * STORM_PERIOD;
    return { id, lane, port: id % 2 ? lane.b : lane.a, starts, ends: starts + STORM_HOURS, position: this.point(lane) };
  }

  private currentStorm() {
    if (this.enabledAt === undefined) return undefined;
    const sinceFirstEnd = this.e.tick - (this.enabledAt + 36 + STORM_HOURS);
    const id = Math.max(0, Math.floor(sinceFirstEnd / STORM_PERIOD) + 1);
    const storm = this.storm(id);
    if (!storm || this.e.tick < storm.starts - REPORT_HOURS || storm.starts >= this.e.seasonHours) return undefined;
    return storm;
  }

  weatherDelay(destination: number, baseArrival: number) {
    if (this.enabledAt === undefined) return 0;
    const id = Math.floor((baseArrival - this.enabledAt - 36) / STORM_PERIOD);
    const storm = this.storm(id);
    return storm?.port === destination && baseArrival < storm.ends ? storm.ends - baseArrival : 0;
  }

  private liveCargo(ship: Ship) {
    const held = this.cargo.get(ship.id);
    if (held?.owner !== ship.owner || held.expires < this.e.tick) return undefined;
    return held;
  }

  spaceTaken(ship: Ship) {
    const held = this.liveCargo(ship);
    return held?.kind === "fish" ? held.qty : held?.kind === "samples" ? 5 : 0;
  }

  worth(company: number) {
    let value = 0;
    for (const [id, held] of this.cargo) {
      const ship = this.e.ships.get(id);
      if (held.owner === company && held.kind === "fish" && ship && this.liveCargo(ship)) {
        value += Math.min(held.cost, this.fishValue(held, ship.dest ?? ship.port));
      }
    }
    return value;
  }

  removeShip(ship: Ship) {
    this.cargo.delete(ship.id);
    this.surveys.delete(ship.id);
    if (this.batch?.holder === ship.id) this.batch = undefined;
  }

  private chilled(ship: Ship) { return this.e.fleetExpansion.isInsulated(ship); }

  private fishValue(fish: Fish, port: number) {
    const fresh = Math.max(0, 1 - (this.e.tick - fish.caught) / (fish.expires - fish.caught));
    const premium = this.e.map.ports[port].consumes.includes("grain") ? 5 : 0;
    return Math.round(fish.qty * (8 + premium + fresh * 20));
  }

  private empty(ship: Ship) { return !ship.qty && !this.liveCargo(ship); }
  private openHold(ship: Ship) {
    return this.empty(ship) && !this.e.voyageQueues.has(ship.id);
  }

  private depart(c: Company, ship: Ship, lane: Lane, supplies: boolean): Result {
    if (ship.dest !== null || ship.type !== "coaster" || !this.openHold(ship)) return fail("choose an empty coaster docked on this route");
    if (ship.port !== lane.a && ship.port !== lane.b) return fail("the coaster must be at one of the route's ports");
    const dest = ship.port === lane.a ? lane.b : lane.a;
    return this.e.applyLive({ type: "sail", company: c.id, ship: ship.id, dest,
      ...(supplies ? { buy: { good: "grain" as const, qty: LAB_GRAIN } } : {}) });
  }

  apply(cmd: ExplorationExpansionCommand): Result {
    const c = this.e.companies.get(cmd.company);
    if (!c || this.enabledAt === undefined) return fail("offshore jobs are unavailable");
    if (this.e.piracy.lockoutHours(c.id)) return fail("your company is locked out of ports");
    const ground = this.grounds.find(site => site.id === cmd.ground);
    const storm = this.currentStorm();
    if (cmd.action === "publishGround") {
      if (!ground?.known.has(c.id) || ground.public) return fail("survey this ground first");
      ground.public = true;
      return { ok: true };
    }
    if (cmd.action === "offerForecast" || cmd.action === "buyForecast") {
      if (!storm || cmd.storm !== storm.id || this.e.tick >= storm.starts) return fail("this forecast has expired");
      const bulletin = this.bulletins.get(storm.id);
      if (!bulletin) return fail("no reading is available for this storm");
      if (cmd.action === "offerForecast") {
        const price = cmd.price;
        if (!bulletin.known.has(c.id) || typeof price !== "number" || !Number.isInteger(price) || price < 1 || price > 200)
          return fail("take a reading and set a price between 1 and 200 credits");
        bulletin.offers.set(c.id, price);
        return { ok: true };
      }
      if (typeof cmd.seller !== "number" || bulletin.known.has(c.id)) return fail("you already know this forecast");
      const seller = this.e.companies.get(cmd.seller), price = bulletin.offers.get(cmd.seller);
      if (!seller || price === undefined || cmd.price !== price) return fail("the bulletin offer has changed");
      if (c.cash < price) return fail("not enough cash for the bulletin");
      c.cash -= price;
      seller.cash += price;
      bulletin.known.add(c.id);
      return { ok: true, spent: price };
    }

    const ship = typeof cmd.ship === "number" ? this.e.ships.get(cmd.ship) : undefined;
    if (!ship || ship.owner !== c.id) return fail("not your ship");
    if (cmd.action === "sailGround" && ground) return this.depart(c, ship, ground.lane, false);
    if (cmd.action === "sailStorm" && storm && cmd.storm === storm.id) return this.depart(c, ship, storm.lane, false);
    if (cmd.action === "sailLab" && this.lab) return this.depart(c, ship, this.lab, !this.batch);

    switch (cmd.action) {
      case "surveyGround":
      case "sampleStorm": {
        if (ship.type !== "coaster" || this.surveys.has(ship.id) || this.e.voyageQueues.has(ship.id))
          return fail("choose a coaster without another survey or voyage queue");
        const cost = cmd.action === "sampleStorm" ? 25 : 35;
        if (cmd.action === "sampleStorm") {
          if (!storm || this.e.tick + 1 >= storm.starts || cmd.storm !== storm.id
            || this.bulletins.get(storm.id)?.known.has(c.id) || !this.alongside(ship, storm.lane, storm.position))
            return fail("reach the weather marker before the storm to take readings");
          if (c.cash < cost) return fail("not enough cash for the weather survey");
          this.surveys.set(ship.id, { owner: c.id, complete: this.e.tick + 1, storm: storm.id });
        } else {
          if (!ground || ground.public || ground.known.has(c.id) || !this.alongside(ship, ground.lane, ground.hint))
            return fail("reach the gulls with a coaster to survey an unknown ground");
          if (c.cash < cost) return fail("not enough cash for the fishing survey");
          this.surveys.set(ship.id, { owner: c.id, complete: this.e.tick + 1, ground: ground.id });
        }
        c.cash -= cost;
        return { ok: true, spent: cost };
      }
      case "fish": {
        if (!ground || (!ground.public && !ground.known.has(c.id)) || ship.type !== "coaster"
          || !this.alongside(ship, ground.lane, ground.position) || !this.openHold(ship))
          return fail("reach a surveyed ground in an empty coaster");
        const qty = Math.floor(Math.min(12, ground.stock, this.e.expansionCapacity(ship)));
        if (qty < 1) return fail("the ground needs time to replenish");
        const cost = 15 + 3 * qty;
        if (c.cash < cost) return fail("not enough cash for fishing supplies");
        c.cash -= cost;
        ground.stock -= qty;
        this.cargo.set(ship.id, { kind: "fish", owner: c.id, ground: ground.id, qty, cost, caught: this.e.tick,
          expires: this.e.tick + (this.chilled(ship) ? 36 : 24) });
        return { ok: true, bought: qty, spent: cost };
      }
      case "offerFish": {
        const held = this.liveCargo(ship);
        const price = cmd.price;
        const site = held?.kind === "fish" ? this.grounds.find(g => g.id === held.ground) : undefined;
        if (held?.kind !== "fish" || !site?.public || !this.alongside(ship, site.lane, site.position)
          || typeof price !== "number" || !Number.isInteger(price) || price < 1 || price > 50)
          return fail("publish your ground and quote 1 to 50 credits per unit while alongside");
        held.ask = price;
        return { ok: true };
      }
      case "buyFish": return this.buyFish(c, ship, cmd);
      case "landFish": {
        const held = this.liveCargo(ship);
        if (held?.kind !== "fish" || ship.dest !== null) return fail("dock with fresh fish to sell them");
        const pay = this.fishValue(held, ship.port);
        this.cargo.delete(ship.id);
        c.cash += pay;
        this.e.recordSpecialSale(ship, pay);
        return { ok: true, sold: held.qty, earned: pay };
      }
      case "supplyLab": {
        if (!this.lab || this.batch || this.e.tick < this.labNext || ship.type !== "coaster"
          || !this.alongside(ship, this.lab) || ship.good !== 0 || ship.qty < LAB_GRAIN || this.e.maritime.hasLoot(ship))
          return fail("bring at least eight units of legal grain to the lab on a coaster");
        ship.cost *= (ship.qty - LAB_GRAIN) / ship.qty;
        ship.qty -= LAB_GRAIN;
        if (!ship.qty) ship.good = null;
        this.e.maritime.cargoMoved(ship, LAB_GRAIN);
        this.batch = { ready: this.e.tick + 5, expires: this.e.tick + 29 };
        this.labNext = this.e.tick + 36;
        c.cash += LAB_SUPPLY_PAY;
        this.e.recordSpecialSale(ship, LAB_SUPPLY_PAY);
        return { ok: true, sold: LAB_GRAIN, earned: LAB_SUPPLY_PAY };
      }
      case "collectSamples": {
        const batch = this.batch;
        if (!this.lab || !batch || batch.holder !== undefined || batch.ready > this.e.tick || batch.expires < this.e.tick
          || ship.type !== "coaster" || !this.openHold(ship) || !this.alongside(ship, this.lab)
          || ship.dest !== this.lab.a || ship.arriveTick > batch.expires || ship.arriveTick > this.e.seasonHours
          || this.e.expansionCapacity(ship) < 5) return fail("take an empty coaster past the lab towards the receiving port before the deadline");
        batch.holder = ship.id;
        this.cargo.set(ship.id, { kind: "samples", owner: c.id, expires: batch.expires });
        return { ok: true };
      }
      default: return fail("unknown offshore action");
    }
  }

  private buyFish(c: Company, buyer: Ship, cmd: ExplorationExpansionCommand): Result {
    if (!this.openHold(buyer) || !this.chilled(buyer) || buyer.dest === null) return fail("send an empty insulated ship to the fishing ground");
    const seller = typeof cmd.seller === "number" ? this.e.ships.get(cmd.seller) : undefined;
    const held = seller ? this.liveCargo(seller) : undefined;
    const ground = held?.kind === "fish" ? this.grounds.find(g => g.id === held.ground) : undefined;
    if (!seller || seller.owner === c.id || held?.kind !== "fish" || !ground?.public || held.ask === undefined || cmd.price !== held.ask
      || !this.alongside(buyer, ground.lane, ground.position) || !this.alongside(seller, ground.lane, ground.position)
      || this.e.piracy.geo.dist(this.e.piracy.position(buyer), this.e.piracy.position(seller)) > 65)
      return fail("meet the seller offshore before the offer or catch expires");
    if (held.qty > this.e.expansionCapacity(buyer)) return fail("the buyer's hold is too small");
    const paid = held.qty * held.ask;
    if (c.cash < paid) return fail("not enough cash for this catch");
    const vendor = this.e.companies.get(seller.owner)!;
    c.cash -= paid;
    vendor.cash += paid;
    this.e.recordSpecialSale(seller, paid);
    this.cargo.delete(seller.id);
    this.cargo.set(buyer.id, { ...held, owner: c.id, cost: paid, expires: held.caught + 36, ask: undefined });
    return { ok: true, bought: held.qty, spent: paid };
  }

  arrived(ship: Ship, _from: number) {
    if (this.liveCargo(ship)?.kind !== "samples" || ship.port !== this.lab?.a || this.batch?.holder !== ship.id) return;
    const c = this.e.companies.get(ship.owner)!;
    c.cash += LAB_SAMPLE_PAY;
    this.e.recordSpecialSale(ship, LAB_SAMPLE_PAY);
    this.cargo.delete(ship.id);
    this.batch = undefined;
  }

  advance() {
    if (this.e.tick % 24 === 0) for (const ground of this.grounds) ground.stock = Math.min(FISH_STOCK, ground.stock + 8);
    for (const [id, survey] of this.surveys) {
      if (survey.complete > this.e.tick) continue;
      this.surveys.delete(id);
      if (this.e.ships.get(id)?.owner !== survey.owner) continue;
      if (survey.ground !== undefined) this.grounds.find(g => g.id === survey.ground)?.known.add(survey.owner);
      if (survey.storm !== undefined) {
        const bulletin = this.bulletins.get(survey.storm) ?? { known: new Set<number>(), offers: new Map<number, number>() };
        bulletin.known.add(survey.owner);
        this.bulletins.set(survey.storm, bulletin);
      }
    }
    for (const [id, held] of this.cargo) {
      if (this.e.ships.get(id)?.owner === held.owner && held.expires >= this.e.tick) continue;
      this.cargo.delete(id);
      if (this.batch?.holder === id) this.batch = undefined;
    }
    if (this.batch && this.batch.expires < this.e.tick) this.batch = undefined;
    for (const id of this.bulletins.keys()) {
      if ((this.storm(id)?.ends ?? 0) <= this.e.tick) this.bulletins.delete(id);
    }
  }

  private action(label: string, action: string, fields: Record<string, unknown> = {}): FeatureAction {
    return { label, command: { type: "expansion", feature: "exploration", action, ...fields } };
  }

  cards(company: number): FeatureCard[] {
    const c = this.e.companies.get(company);
    if (!c || this.enabledAt === undefined) return [];
    const ships = c.ships.map(id => this.e.ships.get(id)!);
    const coasters = ships.filter(ship => ship.type === "coaster");
    const cards: FeatureCard[] = [];

    for (const ground of this.grounds) {
      const known = ground.public || ground.known.has(company);
      const actions: FeatureAction[] = [];
      const id = { ground: ground.id };
      if (known && !ground.public) actions.push(this.action("Publish this ground", "publishGround", id));
      for (const ship of coasters) {
        const args = { ...id, ship: ship.id };
        if (ship.dest === null && this.empty(ship) && [ground.lane.a, ground.lane.b].includes(ship.port))
          actions.push(this.action(`Sail coaster ${ship.id} past the ground`, "sailGround", args));
        if (known && ground.stock > 0 && this.openHold(ship) && this.alongside(ship, ground.lane, ground.position))
          actions.push(this.action(`Fish from coaster ${ship.id}`, "fish", args));
        if (!known && !this.surveys.has(ship.id) && this.alongside(ship, ground.lane, ground.hint))
          actions.push(this.action(`Survey from coaster ${ship.id} for 35 credits`, "surveyGround", args));
      }
      for (const ship of ships) {
        const held = this.liveCargo(ship);
        if (held?.kind !== "fish" || held.ground !== ground.id) continue;
        if (ship.dest === null) actions.push(this.action(`Land ${held.qty} fish from ship ${ship.id} for ${this.fishValue(held, ship.port)}`, "landFish", { ship: ship.id }));
        if (ground.public && this.alongside(ship, ground.lane, ground.position)) {
          const offer = this.action(`Post a catch price for ship ${ship.id}`, "offerFish", { ship: ship.id });
          offer.fields = [{ key: "price", label: "Credits per unit", min: 1, max: 50, value: held.ask ?? 18 }];
          actions.push(offer);
        }
      }
      if (ground.public) for (const [sellerId, held] of this.cargo) {
        if (held.kind !== "fish" || held.ground !== ground.id || held.owner === company || held.ask === undefined) continue;
        const seller = this.e.ships.get(sellerId);
        if (!seller || !this.liveCargo(seller) || !this.alongside(seller, ground.lane, ground.position)) continue;
        for (const ship of ships) {
          if (!this.chilled(ship) || !this.openHold(ship) || !this.alongside(ship, ground.lane, ground.position)
            || this.e.piracy.geo.dist(this.e.piracy.position(ship), this.e.piracy.position(seller)) > 65) continue;
          actions.push(this.action(`Buy ${held.qty} fish from ship ${sellerId} for ${held.qty * held.ask}`, "buyFish",
            { ship: ship.id, seller: sellerId, price: held.ask }));
        }
      }
      const holds = ships.flatMap(ship => {
        const held = this.liveCargo(ship);
        return held?.kind === "fish" && held.ground === ground.id
          ? [`Ship ${ship.id} holds ${held.qty} fish until ${this.clock(held.expires)}.`] : [];
      });
      const status = known ? `${ground.stock} units remain. ${ground.public ? "This ground is public." : "Only your company has this location."}`
        : "Send a coaster past the gulls and take a reading. Survey results return one hour later.";
      cards.push({ title: `Follow the Birds · ${this.laneName(ground.lane)}`, detail: [status, ...holds].join("\n"), actions });
    }

    if (this.lab) {
      const lane = this.lab, batch = this.batch;
      const actions: FeatureAction[] = [];
      for (const ship of coasters) {
        const ready = ship.dest === null && this.openHold(ship) && [lane.a, lane.b].includes(ship.port);
        if (ready && !batch && this.e.tick >= this.labNext)
          actions.push(this.action(`Load lab supplies and sail coaster ${ship.id}`, "sailLab", { ship: ship.id }));
        if (ready && batch && batch.holder === undefined && ship.port === lane.b)
          actions.push(this.action(`Sail coaster ${ship.id} to collect samples`, "sailLab", { ship: ship.id }));
        if (!this.alongside(ship, lane)) continue;
        if (!batch && this.e.tick >= this.labNext && ship.good === 0 && ship.qty >= LAB_GRAIN)
          actions.push(this.action(`Deliver ${LAB_GRAIN} grain from ship ${ship.id} for ${LAB_SUPPLY_PAY}`, "supplyLab", { ship: ship.id }));
        if (batch && batch.ready <= this.e.tick && batch.holder === undefined && this.openHold(ship)
          && ship.dest === lane.a && ship.arriveTick <= batch.expires)
          actions.push(this.action(`Collect samples on ship ${ship.id}`, "collectSamples", { ship: ship.id }));
      }
      const detail = batch?.holder !== undefined ? `Ship ${batch.holder} has the samples. They must reach ${this.port(lane.a)} by ${this.clock(batch.expires)}.`
        : batch ? `Samples ready ${this.clock(batch.ready)}. Earn ${LAB_SAMPLE_PAY} for docking at ${this.port(lane.a)} by ${this.clock(batch.expires)}.`
        : this.e.tick < this.labNext ? `The next supply call opens ${this.clock(this.labNext)}.`
        : `Earn ${LAB_SUPPLY_PAY} for bringing ${LAB_GRAIN} grain in a coaster. The lab then prepares a single sample batch.`;
      cards.push({ title: `The Offshore Lab · ${this.laneName(lane)}`, detail, actions });
    }

    const storm = this.currentStorm();
    if (storm) {
      const bulletin = this.bulletins.get(storm.id);
      const known = bulletin?.known.has(company) || this.e.tick >= storm.starts;
      const actions: FeatureAction[] = [];
      if (this.e.tick + 1 < storm.starts) {
        if (known) {
          const offer = this.action("Offer the forecast for sale", "offerForecast", { storm: storm.id });
          offer.fields = [{ key: "price", label: "Bulletin price", min: 1, max: 200, value: bulletin?.offers.get(company) ?? 45 }];
          actions.push(offer);
        } else {
          for (const [seller, price] of bulletin?.offers ?? []) {
            const name = this.e.companies.get(seller)?.name;
            if (name) actions.push(this.action(`Buy ${name}'s forecast for ${price}`, "buyForecast", { storm: storm.id, seller, price }));
          }
          for (const ship of coasters) {
            const args = { storm: storm.id, ship: ship.id };
            if (ship.dest === null && this.openHold(ship) && [storm.lane.a, storm.lane.b].includes(ship.port))
              actions.push(this.action(`Sail weather coaster ${ship.id}`, "sailStorm", args));
            if (!this.surveys.has(ship.id) && this.alongside(ship, storm.lane, storm.position))
              actions.push(this.action(`Take a weather reading on ship ${ship.id} for 25`, "sampleStorm", args));
          }
        }
      }
      const detail = known ? `${this.port(storm.port)} suspends docking from ${this.clock(storm.starts)} until ${this.clock(storm.ends)}. New voyages due inside the closure will dock when it lifts.`
        : `A weather front is building along ${this.laneName(storm.lane)}. Send a coaster to take readings and learn which port will close.`;
      cards.push({ title: "The Weather Ship", detail, actions });
    } else cards.push({ title: "The Weather Ship", detail: "No new weather front to survey right now." });
    return cards;
  }

  markers() {
    const markers = this.grounds.map(ground => ({ id: `fishing-${ground.id}`, ...(ground.public ? ground.position : ground.hint),
      label: ground.public ? "Fishing ground" : "Gulls", expires: this.e.seasonHours }));
    if (this.lab) markers.push({ id: "lab", ...this.point(this.lab), label: "Offshore lab", expires: this.e.seasonHours });
    const storm = this.currentStorm();
    if (storm) markers.push({ id: `storm-${storm.id}`, ...storm.position, label: "Weather front", expires: storm.ends });
    return markers;
  }

  replayState() {
    return {
      enabledAt: this.enabledAt, grounds: this.grounds.map(ground => ({ ...ground, known: [...ground.known] })),
      labNext: this.labNext, batch: this.batch, cargo: [...this.cargo], surveys: [...this.surveys],
      bulletins: [...this.bulletins].map(([id, bulletin]) => [id, [...bulletin.known], [...bulletin.offers]]),
    };
  }
}
