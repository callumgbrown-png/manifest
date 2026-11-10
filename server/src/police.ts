// Police: neutral ships driven by the engine (never by players). They patrol the lanes, head for active pirates and
// catch them by distance and chance; the penalty depends on the pirate company's notoriety. Like everything in the
// engine it uses no clock and no Math.random, only hashes of the tick and ship numbers, so a replay repeats every arrest.
import type { Engine, Ship } from "./engine.js";
import { roll, type Piracy } from "./piracy.js";

const SALT_SPAWN = 0x504f4c31, SALT_PATROL = 0x504f4c32, SALT_CATCH = 0x504f4c33;

export interface PoliceShip { id: number; port: number; dest: number | null; departTick: number; arriveTick: number }

export class Police {
  readonly ships: PoliceShip[] = [];
  private nextId = 1;

  constructor(private readonly e: Engine, private readonly piracy: Piracy) {}

  /** How many police ships the world has now: one per `per_companies` companies, within the limits. */
  target(): number {
    const P = this.e.rules.police;
    if (!P || !this.e.piratesOn) return 0;
    return Math.min(P.max_ships, Math.max(P.min_ships, Math.ceil(this.e.companies.size / P.per_companies)));
  }

  /** Pirate ships the police care about: at sea, and their company's notoriety is at or above the chase level. */
  private wanted(): Ship[] {
    const P = this.e.rules.police!;
    const out: Ship[] = [];
    for (const s of this.e.ships.values())
      if (s.type === "pirate" && s.dest !== null && this.piracy.notorietyOf(s.owner) >= P.chase_notoriety) out.push(s);
    return out.sort((a, b) => this.piracy.notorietyOf(b.owner) - this.piracy.notorietyOf(a.owner) || a.id - b.id);
  }

  private sail(p: PoliceShip, dest: number) {
    const P = this.e.rules.police!;
    if (dest === p.port || !Number.isFinite(this.e.dist[p.port][dest])) return false;
    p.dest = dest; p.departTick = this.e.tick;
    p.arriveTick = this.e.tick + Math.max(1, Math.ceil(this.e.dist[p.port][dest] / P.speed_per_hour));
    return true;
  }

  tick() {
    const e = this.e, P = e.rules.police;
    if (!P || !e.piratesOn) return;
    // Spawn: new police appear at a hash-chosen port, in order, so the same log always gives the same fleet.
    while (this.ships.length < this.target()) {
      const id = this.nextId++;
      this.ships.push({ id, port: Math.floor(roll(SALT_SPAWN, id) * e.n), dest: null, departTick: e.tick, arriveTick: e.tick });
    }
    // Arrivals.
    for (const p of this.ships) if (p.dest !== null && p.arriveTick <= e.tick) { p.port = p.dest; p.dest = null; }

    // Orders for idle ships: spread over the wanted pirates (one each, round robin), else patrol next door.
    const wanted = this.wanted();
    this.ships.forEach((p, i) => {
      if (p.dest !== null) return;
      if (wanted.length) {
        const prey = wanted[i % wanted.length];
        if (this.sail(p, prey.dest!)) return;
      }
      const next: number[] = [];
      for (const r of e.map.routes) { if (r.a === p.port) next.push(r.b); else if (r.b === p.port) next.push(r.a); }
      if (next.length) this.sail(p, next[Math.floor(roll(SALT_PATROL, e.tick, p.id) * next.length)]);
    });

    // Catching: any police ship near a wanted pirate gets a roll; a pirate is arrested at most once an hour.
    const arrested = new Set<number>();
    for (const p of this.ships) {
      const at = this.piracy.position(p);
      for (const s of wanted) {
        if (arrested.has(s.id) || !e.ships.has(s.id) || s.dest === null) continue;
        const to = this.piracy.position(s);
        if (this.piracy.geo.dist(to, at) > P.catch_range) continue;
        const n = this.piracy.notorietyOf(s.owner);
        const chance = Math.min(P.catch_max, P.catch_base + P.catch_per_notoriety * n);
        if (roll(SALT_CATCH, e.tick, p.id, s.id) < chance) { arrested.add(s.id); this.arrest(s, n); }
      }
    }
  }

  /** The penalty, by notoriety: a fine, then a lockout from sailing, then confiscation of the ship. */
  arrest(ship: Ship, notoriety: number) {
    const e = this.e, P = e.rules.police!, c = e.companies.get(ship.owner)!;
    const where = this.piracy.nearestPort(this.piracy.position(ship));
    const n = Math.round(notoriety);
    if (notoriety < P.fine_below) {
      const fine = Math.round(P.fine_per_point * notoriety);
      c.cash -= fine;
      this.piracy.note(c.id, "fined", `The police caught your pirate ship ${ship.id} near ${where} (notoriety ${n}). Fine: ${fine}.`);
    } else if (notoriety < P.lockout_below || c.ships.length <= 1) {
      // (A company's only ship is never confiscated: it is locked out instead.)
      this.piracy.lockout.set(c.id, e.tick + P.lockout_hours);
      this.piracy.note(c.id, "locked-out", `The police caught your pirate ship ${ship.id} near ${where} (notoriety ${n}). Your ships may not leave port for ${P.lockout_hours} hours.`);
    } else {
      e.removeShip(c, ship);
      this.piracy.note(c.id, "confiscated", `The police caught your pirate ship ${ship.id} near ${where} (notoriety ${n}) and confiscated it, with its cargo.`);
    }
    this.piracy.setNotoriety(c.id, P.notoriety_after_arrest);
  }
}
