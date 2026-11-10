import { GOODS, type Engine, type Result, type Ship } from "./engine.js";
import type { FeatureAction, FeatureCard } from "./expansion-cards.js";
import type { Pt } from "./geo.js";

export type PiracyExpansionCommand = {
  type: "expansion";
  company: number;
  feature: "piracy";
  action: string;
  [key: string]: unknown;
};

interface Salvage { position: Pt; good: number; qty: number; ready: number; expires: number }
interface Loot { holder: number; ship: number; victim: number; good: number; qty: number; price?: number }
interface Incident {
  attacker: number;
  victim: number;
  position: Pt;
  tick: number;
  witnesses: Map<number, { owner: number; departTick: number }>;
  reported: boolean;
}

const SALVAGE_HOURS = 12;
const WITNESS_HOURS = 6;
const WITNESS_FEE = 20;
const MAX_CRATE = 8;
const fail = (error: string): Result => ({ ok: false, error });

/** The additional state is rebuilt from the same accepted raids, commands and ticks as the engine. */
export class PiracyExpansion {
  private nextId = 1;
  private readonly crates = new Map<number, { owner: number; qty: number }>();
  private readonly loot = new Map<number, Loot>();
  private readonly salvage = new Map<number, Salvage>();
  private readonly incidents = new Map<number, Incident>();
  private readonly lastReport = new Map<number, number>();
  private changingMarkedCargo = false;

  constructor(private readonly e: Engine) {}

  private get range() { return this.e.rules.pirates?.range ?? 0; }

  private near(s: Ship, pt: Pt, range = this.range) {
    return this.e.piracy.geo.dist(this.e.piracy.position(s), pt) <= range;
  }

  private crateFor(s: Ship) {
    const crate = this.crates.get(s.id);
    return crate?.owner === s.owner && s.dest !== null && s.good !== null
      ? Math.min(crate.qty, Math.floor(s.qty / 4)) : 0;
  }

  private covered(target: Ship) {
    const range = this.e.rules.police?.catch_range;
    if (target.dest === null || range === undefined) return false;
    return this.e.police.ships.some(p => p.dest !== null && this.e.tick < p.arriveTick
      && this.near(target, this.e.piracy.position(p), range));
  }

  raidMultiplier(target: Ship) {
    return (this.covered(target) ? 0.6 : 1) * (this.crateFor(target) ? 0.8 : 1);
  }

  private leaveSalvage(position: Pt, good: number, qty: number) {
    const id = this.nextId++;
    this.salvage.set(id, { position, good, qty, ready: this.e.tick + 1, expires: this.e.tick + SALVAGE_HOURS });
  }

  /** Called when a pirate elects to pursue instead of taking the merchant's deck crate. */
  beginChase(_attacker: Ship, target: Ship) {
    const qty = this.crateFor(target);
    if (!qty || target.good === null) return;
    const good = target.good;
    this.crates.delete(target.id);
    this.unload(target, qty);
    this.leaveSalvage(this.e.piracy.position(target), good, qty);
    this.e.piracy.note(target.owner, "raided", `Ship ${target.id} dropped ${qty} ${GOODS[good]} to gain a head start.`);
  }

  private recordIncident(attacker: Ship, target: Ship) {
    const position = this.e.piracy.position(target);
    const witnesses: Incident["witnesses"] = new Map();
    for (const s of this.e.ships.values()) {
      if (s.dest !== null && s.owner !== attacker.owner && s.owner !== target.owner && s.type !== "pirate"
          && this.near(s, position) && s.arriveTick > this.e.tick + 1) {
        witnesses.set(s.id, { owner: s.owner, departTick: s.departTick });
      }
    }
    if (witnesses.size) this.incidents.set(this.nextId++, {
      attacker: attacker.owner, victim: target.owner, position, tick: this.e.tick, witnesses, reported: false,
    });
    return position;
  }

  onRaid(attacker: Ship, target: Ship, outcome: "lost" | "won" | "captured", good: number | null, qty: number) {
    const position = this.recordIncident(attacker, target);
    if (good === null || qty <= 0 || outcome === "lost") return;
    if (outcome === "captured") {
      let unmarked = qty;
      for (const [id, lot] of this.loot) {
        if (lot.ship !== target.id) continue;
        unmarked -= lot.qty;
        if (lot.victim === attacker.owner) this.loot.delete(id);
        else { lot.holder = attacker.owner; delete lot.price; }
      }
      this.mark(attacker.owner, target.id, target.owner, good, unmarked);
      this.crates.delete(target.id);
      return;
    }
    // A fraction of the same seized cargo breaks free. The hold and salvage never both own it.
    const drifting = qty >= 3 ? Math.floor(qty / 3) : 0;
    if (drifting) {
      this.unload(attacker, drifting, "selected");
      this.leaveSalvage(position, good, drifting);
    }
    this.mark(attacker.owner, attacker.id, target.owner, good, qty - drifting);
  }

  /** Called after capture updates the ship's owner and clears its old maritime records. */
  markCaptured(s: Ship) {
    const qty = [...this.loot.values()].filter(lot => lot.ship === s.id && lot.holder === s.owner)
      .reduce((sum, lot) => sum + lot.qty, 0);
    if (qty) this.e.maritime.markLoot(s, qty);
  }

  private mark(holder: number, ship: number, victim: number, good: number, qty: number) {
    if (qty > 0) this.loot.set(this.nextId++, { holder, ship, victim, good, qty });
  }

  cargoMoved(s: Ship, qty: number) {
    if (this.changingMarkedCargo) return;
    for (const [id, lot] of this.loot) {
      if (lot.ship !== s.id) continue;
      if (lot.holder !== s.owner || lot.good !== s.good || !s.qty) {
        this.loot.delete(id);
        continue;
      }
      const moved = Math.min(lot.qty, qty);
      lot.qty -= moved;
      qty -= moved;
      if (moved) delete lot.price;
      if (!lot.qty) this.loot.delete(id);
    }
  }

  private unload(s: Ship, qty: number, marks: "update" | "selected" | "defer" = "update") {
    const basis = s.cost * qty / s.qty;
    s.qty -= qty;
    s.cost = Math.max(0, s.cost - basis);
    if (!s.qty) { s.good = null; s.cost = 0; }
    if (marks !== "defer") {
      this.changingMarkedCargo = marks === "selected";
      try { this.e.maritime.cargoMoved(s, qty); }
      finally { this.changingMarkedCargo = false; }
    }
    this.e.maritime.dockedCargoChanged(s);
    return basis;
  }

  private load(s: Ship, good: number, qty: number, cost = 0) {
    s.good = good;
    s.qty += qty;
    s.cost += cost;
    this.e.maritime.dockedCargoChanged(s);
    const trip = this.e.openTrip(s.owner, s.id);
    if (trip && cost) {
      trip.spent += cost;
      if (trip.costs) trip.costs.cargo += cost;
      delete trip.estimate;
    }
  }

  private room(s: Ship, good: number, qty: number) {
    return (s.qty === 0 || s.good === good) && s.qty + qty <= this.e.expansionCapacity(s)
      && !this.e.voyageQueues.has(s.id);
  }

  private liveLoot(lot: Loot) {
    const ship = this.e.ships.get(lot.ship);
    return ship?.owner === lot.holder && ship.good === lot.good && ship.qty >= lot.qty ? ship : undefined;
  }

  private rendezvous(a: Ship, b: Ship) {
    return a.dest === null || b.dest === null
      ? a.dest === null && b.dest === null && a.port === b.port
      : this.near(a, this.e.piracy.position(b));
  }

  private witnessCanReport(incident: Incident, ship: Ship) {
    const witness = incident.witnesses.get(ship.id);
    return !incident.reported && incident.attacker !== ship.owner && incident.victim !== ship.owner
      && ship.dest !== null && ship.type !== "pirate" && witness?.owner === ship.owner && witness.departTick === ship.departTick
      && this.e.tick > incident.tick && this.e.tick <= incident.tick + WITNESS_HOURS
      && this.e.tick >= (this.lastReport.get(ship.owner) ?? -24) + 24;
  }

  private takeCrate(ship: Ship, target: Ship | undefined): Result {
    if (ship.type !== "pirate" || ship.dest === null || !target || target.good === null
      || !this.e.piracy.targetsFor(ship, true).some(t => t.ship === target.id)) return fail("that ship cannot be intercepted now");
    if ((this.e.piracy.cooldown.get(ship.id) ?? 0) > this.e.tick) return fail("your ship is lying low after a raid");
    const qty = this.crateFor(target);
    if (!qty || !this.room(ship, target.good, qty)) return fail("there is no deck crate your ship can collect");
    const good = target.good;
    const rules = this.e.rules.pirates!;
    this.crates.delete(target.id);
    this.recordIncident(ship, target);
    // Maritime's normal raid handler removes target marks and registers the newly seized goods.
    const basis = this.unload(target, qty, "defer");
    this.load(ship, good, qty, basis);
    this.e.maritime.raid(ship, target, good, qty, basis, true);
    this.mark(ship.owner, ship.id, target.owner, good, qty);
    this.e.piracy.cooldown.set(ship.id, this.e.tick + rules.cooldown_hours);
    this.e.piracy.addNotoriety(ship.owner, rules.notoriety.per_raid);
    this.e.piracy.note(ship.owner, "raid-won", `You collected the deck crate with ${qty} ${GOODS[good]} and broke off the pursuit.`);
    this.e.piracy.note(target.owner, "raided", `A pirate took your deck crate and let ship ${target.id} go.`);
    return { ok: true, outcome: "won", loot: qty };
  }

  apply(cmd: PiracyExpansionCommand): Result {
    const c = this.e.companies.get(cmd.company);
    if (!c || !this.e.piratesOn) return fail("piracy activities are unavailable");
    if (this.e.piracy.lockoutHours(c.id)) return fail("your company is locked out");
    const ship = typeof cmd.ship === "number" ? this.e.ships.get(cmd.ship) : undefined;
    const id = typeof cmd.id === "number" ? cmd.id : -1;
    if (cmd.action === "offer-ransom") {
      const lot = this.loot.get(id);
      const price = cmd.price;
      if (!lot || lot.holder !== c.id || !this.liveLoot(lot)) return fail("you no longer hold that marked cargo");
      if (typeof price !== "number" || !Number.isSafeInteger(price) || price < 1
          || price > Math.ceil(this.e.rules.commodities[GOODS[lot.good]].ceiling * lot.qty * 2)) return fail("invalid ransom price");
      lot.price = price;
      this.e.piracy.note(lot.victim, "raided", `${c.name} offered to return ${lot.qty} ${GOODS[lot.good]} for ${price}.`);
      return { ok: true };
    }
    if (!ship || ship.owner !== c.id) return fail("choose one of your ships");
    switch (cmd.action) {
      case "arm-crate": {
        const qty = cmd.qty;
        if (ship.dest !== null || ship.type === "pirate") return fail("a merchant sets its deck crate in port");
        if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > MAX_CRATE) return fail("invalid deck crate size");
        if (!qty) this.crates.delete(ship.id);
        else this.crates.set(ship.id, { owner: c.id, qty });
        return { ok: true };
      }
      case "take-crate": return this.takeCrate(ship, this.e.ships.get(id));
      case "collect-salvage": {
        const cargo = this.salvage.get(id);
        if (!cargo || cargo.expires <= this.e.tick) return fail("the salvage has already gone");
        if (this.e.tick < cargo.ready) return fail("wait for the debris to settle before picking it up");
        if (ship.dest === null || !this.near(ship, cargo.position)) return fail("sail into range of the salvage");
        if (!this.room(ship, cargo.good, cargo.qty)) return fail("your hold cannot take the salvage");
        this.salvage.delete(id);
        this.load(ship, cargo.good, cargo.qty);
        return { ok: true, bought: cargo.qty };
      }
      case "report-raid": {
        const incident = this.incidents.get(id);
        if (!incident || !this.witnessCanReport(incident, ship)) return fail("this ship cannot confirm that incident");
        incident.reported = true;
        this.lastReport.set(c.id, this.e.tick);
        c.cash += WITNESS_FEE;
        this.e.piracy.addNotoriety(incident.attacker, 1);
        return { ok: true, earned: WITNESS_FEE };
      }
      case "accept-ransom": {
        const lot = this.loot.get(id), holder = lot && this.liveLoot(lot);
        if (!lot || !holder || lot.victim !== c.id || lot.price === undefined || cmd.price !== lot.price)
          return fail("that offer is no longer available");
        const seller = this.e.companies.get(lot.holder);
        if (!seller || c.cash < lot.price) return fail("not enough cash to pay the ransom");
        if (!this.rendezvous(holder, ship) || !this.room(ship, lot.good, lot.qty)) return fail("meet the carrier with enough matching hold space");
        this.loot.delete(id);
        this.unload(holder, lot.qty, "selected");
        this.load(ship, lot.good, lot.qty, lot.price);
        c.cash -= lot.price;
        seller.cash += lot.price;
        this.e.recordSpecialSale(holder, lot.price);
        return { ok: true, bought: lot.qty, spent: lot.price };
      }
      default: return fail("unknown piracy activity");
    }
  }

  advance() {
    for (const [id, cargo] of this.salvage) if (cargo.expires <= this.e.tick) this.salvage.delete(id);
    for (const [id, lot] of this.loot) if (!this.liveLoot(lot)) this.loot.delete(id);
    for (const [id, crate] of this.crates) if (this.e.ships.get(id)?.owner !== crate.owner) this.crates.delete(id);
    for (const [id, incident] of this.incidents) if (incident.reported || incident.tick + WITNESS_HOURS < this.e.tick) this.incidents.delete(id);
  }

  markers() {
    return [...this.salvage].map(([id, cargo]) => ({ id, ...cargo.position,
      label: `${cargo.qty} ${GOODS[cargo.good]} salvage`, expires: cargo.expires }));
  }

  replayState() {
    return { nextId: this.nextId, crates: [...this.crates], loot: [...this.loot], salvage: [...this.salvage],
      incidents: [...this.incidents].map(([id, i]) => [id, { ...i, witnesses: [...i.witnesses] }]),
      lastReport: [...this.lastReport] };
  }

  cards(company: number): FeatureCard[] {
    const c = this.e.companies.get(company);
    if (!c || !this.e.piratesOn) return [];
    const ships = c.ships.map(id => this.e.ships.get(id)).filter((s): s is Ship => s !== undefined);
    const action = (label: string, name: string, values: Record<string, unknown> = {}): FeatureAction => ({
      label, command: { type: "expansion", feature: "piracy", action: name, ...values },
    });
    const port = (id: number) => this.e.map.ports[id].name;
    const cards: FeatureCard[] = [];
    const patrols = this.e.police.ships.filter(p => p.dest !== null).map(p =>
      `${port(p.port)} → ${port(p.dest!)} for ${Math.max(0, p.arriveTick - this.e.tick)}h`);
    cards.push({ title: "Patrol Window", detail: patrols.length
      ? `Active patrols · ${patrols.join(" · ")}. Sailing within a patrol boat’s range reduces the chance a raid succeeds.`
      : "No police patrols are underway." });
    const crates: FeatureAction[] = [];
    for (const ship of ships) {
      if (ship.dest === null && ship.type !== "pirate") crates.push({
        ...action(`Set deck crate on ship ${ship.id}`, "arm-crate", { ship: ship.id }),
        fields: [{ key: "qty", label: "Tonnes (0 clears)", min: 0, max: MAX_CRATE, value: this.crates.get(ship.id)?.qty ?? 0 }],
      });
      if (ship.dest !== null && ship.type === "pirate" && (this.e.piracy.cooldown.get(ship.id) ?? 0) <= this.e.tick)
        for (const t of this.e.piracy.targetsFor(ship, true)) {
          const target = this.e.ships.get(t.ship);
          if (target && target.good !== null && this.crateFor(target) && this.room(ship, target.good, this.crateFor(target)))
            crates.push(action(`Take ship ${target.id}’s crate with ship ${ship.id}`, "take-crate", { ship: ship.id, id: target.id }));
        }
    }
    cards.push({ title: "Drop the Crate", detail: "Set a deck crate before sailing. It holds at most a quarter of your cargo. A pirate can take the crate and let you go, or chase while you drop it and gain a head start.", actions: crates });
    for (const [id, cargo] of this.salvage) {
      const eligible = this.e.tick < cargo.ready ? []
        : ships.filter(s => s.dest !== null && this.near(s, cargo.position) && this.room(s, cargo.good, cargo.qty));
      cards.push({ title: `Salvage Race · ${this.e.piracy.nearestPort(cargo.position)}`,
        detail: `${cargo.qty} ${GOODS[cargo.good]} drifting for ${cargo.expires - this.e.tick}h. The first ship within range with space can collect it.`,
        actions: eligible.map(s => action(`Collect with ship ${s.id}`, "collect-salvage", { ship: s.id, id })) });
    }
    for (const [id, lot] of this.loot) {
      const holder = this.liveLoot(lot);
      if (!holder) continue;
      if (lot.holder === company) cards.push({ title: "Cargo With a Past", detail: `${lot.qty} ${GOODS[lot.good]} on ship ${lot.ship} belongs to ${this.e.companies.get(lot.victim)?.name ?? "another company"}. Fence it at home or offer it back.`,
        actions: [{ ...action("Offer to return cargo", "offer-ransom", { id }),
          fields: [{ key: "price", label: "Ransom", min: 1, max: Math.ceil(this.e.rules.commodities[GOODS[lot.good]].ceiling * lot.qty * 2), value: lot.price ?? Math.max(1, Math.round(lot.qty * this.e.rules.commodities[GOODS[lot.good]].floor)) }] }] });
      if (lot.victim === company && lot.price !== undefined) cards.push({ title: "Cargo With a Past", detail: `${this.e.companies.get(lot.holder)?.name ?? "A raider"} will return ${lot.qty} ${GOODS[lot.good]} for ${lot.price}. Meet ship ${holder.id} at sea or in port.`,
        actions: ships.filter(s => this.rendezvous(holder, s) && this.room(s, lot.good, lot.qty))
          .map(s => action(`Pay and recover onto ship ${s.id}`, "accept-ransom", { ship: s.id, id, price: lot.price })) });
    }
    for (const [id, incident] of this.incidents) {
      const eligible = ships.filter(s => this.witnessCanReport(incident, s));
      if (eligible.length) cards.push({ title: "Take the Witness", detail: `Confirm the raid near ${this.e.piracy.nearestPort(incident.position)} for ${WITNESS_FEE}. Only the first verified report earns a fee.`,
        actions: eligible.map(s => action(`Report from ship ${s.id}`, "report-raid", { ship: s.id, id })) });
    }
    return cards;
  }
}
