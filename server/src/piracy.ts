// Pirates: raiding, notoriety, lockouts and the notices players read in the Fleet tab. The rules and numbers are
// in config/rules.json (`pirates`) and docs/PIRATES.md. Nothing here uses the clock or Math.random: every roll is a
// hash of the tick and the ships involved, so replaying the event log gives the same raids, losses and arrests.
import type { Engine, Ship, Result, Company } from "./engine.js";
import { Geo, type Pt } from "./geo.js";

/** A repeatable number in [0, 1) from a few integers. */
export function roll(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}
const SALT_RAID = 0x52414944;

export interface Notice {
  id: number; tick: number;
  kind: "raided" | "captured" | "raid-won" | "raid-lost" | "raid-captured" | "fined" | "locked-out" | "confiscated";
  text: string;
}
export interface Target { ship: number; owner: number; ownerName: string; type: string; good: number | null; qty: number; chance: number; distance: number; cargoOnly?: boolean; convoyPrize?: number }

const fail = (error: string): Result => ({ ok: false, error });
const NOTICES_KEPT = 12;

export class Piracy {
  readonly geo: Geo;
  /** Notoriety per company, 0 to notoriety.max. Rises with every raid, falls with time. */
  readonly notoriety = new Map<number, number>();
  /** The tick a pirate ship may raid again. */
  readonly cooldown = new Map<number, number>();
  /** The tick a company's lockout from sailing ends. */
  readonly lockout = new Map<number, number>();
  readonly notices = new Map<number, Notice[]>();
  private noticeSeq = 0;
  private raids = 0;
  private readonly cargoRaidProtection = new Map<number, number>();

  constructor(private readonly e: Engine) { this.geo = new Geo(e.map); }

  // ------------------------------------------------------------ places

  /** Where a ship is right now: its port if docked, else the fraction of its voyage done along the lanes. */
  position(s: Pick<Ship, "port" | "dest" | "departTick" | "arriveTick">, tick = this.e.tick): Pt {
    if (s.dest === null) return this.e.map.ports[s.port];
    const f = (tick - s.departTick) / Math.max(1, s.arriveTick - s.departTick);
    return this.geo.at(this.geo.voyage(s.port, s.dest), f);
  }

  // ------------------------------------------------------------ notices and notoriety

  note(company: number, kind: Notice["kind"], text: string) {
    const list = this.notices.get(company) ?? [];
    list.push({ id: ++this.noticeSeq, tick: this.e.tick, kind, text });
    this.notices.set(company, list.slice(-NOTICES_KEPT));
  }
  notorietyOf(company: number): number { return this.notoriety.get(company) ?? 0; }
  addNotoriety(company: number, by: number) {
    const max = this.e.rules.pirates!.notoriety.max;
    this.notoriety.set(company, Math.min(max, Math.max(0, this.notorietyOf(company) + by)));
  }
  setNotoriety(company: number, to: number) { this.notoriety.set(company, to); }
  lockoutHours(company: number): number { return Math.max(0, (this.lockout.get(company) ?? 0) - this.e.tick); }

  /** Name of the port nearest a point, for notices ("near Pelbay"). */
  nearestPort(p: Pt): string {
    let best = this.e.map.ports[0], bd = Infinity;
    for (const q of this.e.map.ports) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = q; } }
    return best.name;
  }

  // ------------------------------------------------------------ the fight

  /** The chance a pirate ship beats a target: faster pirates win more, bigger holds (a proxy for size) resist. */
  chance(pirate: Ship, target: Ship): number {
    const R = this.e.rules.pirates!, p = this.e.spec("pirate"), v = this.e.spec(target.type), pirateSpec = this.e.spec(pirate.type);
    const speed = 1 - v.speed_per_hour / pirateSpec.speed_per_hour;
    const size = Math.max(0, v.capacity / p.capacity - 1);
    const chance = Math.min(R.max_chance, Math.max(R.min_chance, R.base_chance + R.speed_weight * speed - R.size_weight * size))
      * (this.e.expansionEnabled ? this.e.piracyExpansion.raidMultiplier(target) : 1);
    if (this.e.maritime.protected(target)) return chance * 0.45;
    return this.e.maritime.convoyPrize(target) ? chance * 0.75 : chance;
  }

  /** Why a target can't be raided, or null if it can. Range is checked from the pirate's position. */
  private whyNot(pirate: Ship, t: Ship, cargoOnly = false): string | null {
    const R = this.e.rules.pirates!;
    if (t.owner === pirate.owner) return "you can't raid your own ship";
    if (t.type === "pirate" && !this.e.maritime.wanted(t.owner))
      return this.e.maritime.enabled ? "only wanted pirate ships can be intercepted" : "pirates don't raid each other";
    if (t.dest === null) return "a ship in port can't be raided";
    const victim = this.e.companies.get(t.owner);
    if (!victim) return "no such ship";
    if (cargoOnly) {
      if (pirate.dest === null) return "your pirate ship must be underway";
      if (victim.ships.length !== 1 && !this.e.maritime.enabled) return "cargo-only raids are for single-ship companies";
      if (t.qty < 4 || t.good === null) return "not enough cargo to raid";
      if (pirate.qty > 0 && pirate.good !== t.good) return "your hold contains another good";
      if (pirate.qty >= this.e.spec(pirate.type).capacity) return "your hold is full";
      if (this.e.tick < (this.cargoRaidProtection.get(t.id) ?? 0)) return "this ship has recent raid protection";
    } else if (victim.ships.length <= 1 && R.protect_only_ship !== false && !this.e.maritime.wanted(t.owner)) {
      return "a company's only ship can't be raided";
    }
    const at = this.position(t), home = this.e.map.ports[victim.home];
    if ((!this.e.expansionEnabled || this.e.fleetExpansion.homeActive(victim)) && this.geo.dist(at, home) <= R.home_safe_radius)
      return "that ship is in the safe waters around its owner's home port";
    const me = this.position(pirate), d = this.geo.dist(at, me);
    if (d > R.range) return `out of range (${Math.round(d)} away, range ${R.range})`;
    return null;
  }

  /** Every ship this pirate could raid right now (cooldown aside), best chance first: the Raid button's list. */
  targetsFor(pirate: Ship, includeCargoOnly = false): Target[] {
    const out: Target[] = [];
    const me = this.position(pirate);
    for (const t of this.e.ships.values()) {
      const cargoOnly = includeCargoOnly && t.type !== "pirate" && (this.e.maritime.enabled
        ? this.e.companies.get(t.owner)?.ships.length === 1 || this.e.maritime.protected(t)
        : this.e.companies.get(t.owner)?.ships.length === 1);
      if (this.whyNot(pirate, t, cargoOnly)) continue;
      const at = this.position(t);
      out.push({ ship: t.id, owner: t.owner, ownerName: this.e.companies.get(t.owner)!.name, type: t.type, good: t.good, qty: Math.round(t.qty),
        chance: Math.round(this.chance(pirate, t) * 100) / 100, distance: Math.round(this.geo.dist(at, me)),
        ...(cargoOnly ? { cargoOnly } : {}), ...(this.e.maritime.convoyPrize(t) ? { convoyPrize: this.e.maritime.convoyPrize(t) } : {}) });
    }
    return out.sort((a, b) => b.chance - a.chance || b.qty - a.qty || a.ship - b.ship);
  }

  raid(cmd: { company: number; ship: number; target: number; cargoOnly?: boolean }): Result {
    const e = this.e;
    if (!e.piratesOn) return fail("there are no pirates in this world");
    const R = e.rules.pirates!;
    const c = e.companies.get(cmd.company), ship = e.ships.get(cmd.ship);
    if (!c || !ship || ship.owner !== c.id) return fail("not your ship");
    if (ship.type !== "pirate") return fail("only a pirate ship can raid");
    const locked = this.lockoutHours(c.id);
    if (locked > 0) return fail(`your company is locked out of ports for ${locked} more hours`);
    const ready = this.cooldown.get(ship.id) ?? 0;
    if (e.tick < ready) return fail(`this ship is lying low for ${ready - e.tick} more hours`);
    const t = e.ships.get(cmd.target);
    if (!t) return fail("no such ship");
    const cargoOnly = cmd.cargoOnly === true || (e.maritime.enabled && t.type !== "pirate"
      && (e.maritime.protected(t) || e.companies.get(t.owner)?.ships.length === 1));
    const why = this.whyNot(ship, t, cargoOnly);
    if (why) return fail(why);

    const victim = e.companies.get(t.owner)!;
    const chance = this.chance(ship, t);
    if (e.expansionEnabled) e.piracyExpansion.beginChase(ship, t);
    const r = roll(SALT_RAID, e.tick, ship.id, t.id, this.raids++);
    this.cooldown.set(ship.id, e.tick + R.cooldown_hours);
    this.addNotoriety(c.id, R.notoriety.per_raid);
    const where = this.nearestPort(this.position(t));
    const goods = ["grain", "fuel", "ore", "machinery"];

    if (r >= chance) {
      c.cash -= R.failed_raid_cost;
      e.maritime.raid(ship, t, null, 0, 0, false);
      if (e.expansionEnabled) e.piracyExpansion.onRaid(ship, t, "lost", null, 0);
      this.note(c.id, "raid-lost", `Your raid on ship ${t.id} (${victim.name}) near ${where} failed; repairs cost ${R.failed_raid_cost}.`);
      this.note(victim.id, "raided", `${c.name} attacked your ship ${t.id} near ${where} and was beaten off.`);
      return { ok: true, outcome: "lost", chance };
    }
    const decisive = (chance - r) / chance;   // 0 = scraped through, 1 = a clean sweep
    if (!cargoOnly && !(e.maritime.enabled && victim.ships.length <= 1)
      && decisive >= R.capture_margin && c.ships.length + (e.expansionEnabled ? e.fleetExpansion.reservedSlots(c) : 0) < e.rules.company.max_ships) {
      const trip = e.openTrip(victim.id, t.id); if (trip) trip.open = false;
      victim.ships = victim.ships.filter(id => id !== t.id);
      e.maritime.raid(ship, t, null, 0, 0, true, true);
      if (e.expansionEnabled) e.piracyExpansion.onRaid(ship, t, "captured", t.good, t.qty);
      e.maritime.captured(t);
      t.owner = c.id; c.ships.push(t.id);
      if (e.expansionEnabled) e.piracyExpansion.markCaptured(t);
      this.note(c.id, "raid-captured", `You captured ship ${t.id} from ${victim.name} near ${where}${t.qty ? ` with ${Math.round(t.qty)} ${goods[t.good!]} aboard` : ""}. It is now in your fleet.`);
      this.note(victim.id, "captured", `${c.name} captured your ship ${t.id} near ${where}${t.qty ? `, with its ${Math.round(t.qty)} ${goods[t.good!]}` : ""}.`);
      return { ok: true, outcome: "captured", chance, loot: Math.round(t.qty) };
    }
    // Won: take what the hold has room for.
    let take = 0, loss = 0;
    const compatible = ship.qty === 0 || ship.good === t.good;
    if (t.qty > 0 && t.good !== null && compatible) {
      take = Math.floor(Math.max(0, Math.min(cargoOnly ? t.qty / 4 : t.qty, e.expansionCapacity(ship) - ship.qty)));
      if (take > 0) {
        if (cargoOnly) this.cargoRaidProtection.set(t.id, e.tick + 24);
        const share = take / t.qty;
        loss = t.cost * share;
        ship.good = t.good; ship.qty += take; ship.cost += t.cost * share;
        t.cost -= t.cost * share; t.qty -= take;
        if (t.qty <= 0) { t.qty = 0; t.cost = 0; t.good = null; }
      }
    }
    e.maritime.raid(ship, t, take ? ship.good : null, take, loss, true);
    if (e.expansionEnabled) e.piracyExpansion.onRaid(ship, t, "won", take ? ship.good : null, take);
    const what = take ? `${take} ${goods[ship.good!]}` : "nothing";
    this.note(c.id, "raid-won", `You raided ship ${t.id} (${victim.name}) near ${where} and took ${what}.`);
    this.note(victim.id, "raided", `${c.name} raided your ship ${t.id} near ${where} and took ${take ? what : "no cargo"}.`);
    return { ok: true, outcome: "won", chance, loot: take };
  }

  // ------------------------------------------------------------ time

  tick() {
    const R = this.e.rules.pirates;
    if (!R || !R.enabled) return;
    for (const [id, n] of this.notoriety) {
      const left = n - R.notoriety.decay_per_hour;
      if (left <= 0) this.notoriety.delete(id); else this.notoriety.set(id, left);
    }
  }
}

export type { Company };
