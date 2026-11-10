// Shared helpers and cross-module state for the contracts category (contracts, pirates and police, NPCs).
// State shared between modules lives in one object per engine (a WeakMap), so a fresh engine (a replay) starts empty.
// It changes only inside module enable/apply/advance calls. Randomness: roll() hashes, never Math.random or the clock.
import { readFileSync } from "node:fs";
import { GOODS, type Engine, type Result, type Ship } from "../../engine.js";
import type { FeatureField } from "../../expansion-cards.js";
import type { Pt } from "../../geo.js";
import { roll } from "../../piracy.js";

export { roll };
export type { Pt };
export const fail = (error: string): Result => ({ ok: false, error });
export const ok: Result = { ok: true };
export const goodName = (g: number | null): string => (g === null ? undefined : (GOODS as readonly string[])[g]) ?? "cargo";

/** An integer in [min, max] (rejects strings, floats, NaN). */
export function whole(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
}
export const day = (e: Engine) => Math.floor(e.tick / 24);
export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `port ${p}`;
export const money = (n: number) => Math.round(n).toLocaleString("en-IE");

/** Reads config/content/contracts/<name>.json; falls back to built-in data if the file is missing or broken. */
export function content<T>(name: string, fallback: T): T {
  try { return JSON.parse(readFileSync(new URL(`../../../../config/content/contracts/${name}.json`, import.meta.url), "utf8")) as T; }
  catch { return fallback; }
}

/** One of the company's ships, docked, not run by a voyage queue. */
export function dockedShip(e: Engine, company: number, id: unknown): Ship | string {
  const s = whole(id, 1, Number.MAX_SAFE_INTEGER) ? e.ships.get(id) : undefined;
  if (!s || s.owner !== company) return "choose one of your ships";
  if (s.dest !== null) return "that ship is at sea";
  if (e.voyageQueues.has(s.id)) return "that ship is run by a voyage queue";
  return s;
}
export function ownShip(e: Engine, company: number, id: unknown): Ship | string {
  const s = whole(id, 1, Number.MAX_SAFE_INTEGER) ? e.ships.get(id) : undefined;
  return s && s.owner === company ? s : "choose one of your ships";
}

/** Take cargo off a ship (delivered to a client, lost or seized). Returns the cargo's cost basis removed. */
export function unload(e: Engine, s: Ship, qty: number, paid = 0): number {
  const q = Math.min(qty, s.qty);
  if (q <= 0) return 0;
  const basis = s.qty > 0 ? s.cost * q / s.qty : 0;
  s.qty -= q; s.cost = Math.max(0, s.cost - basis);
  if (s.qty <= 0) { s.qty = 0; s.cost = 0; s.good = null; }
  e.maritime.cargoMoved(s, q);
  e.maritime.dockedCargoChanged(s);
  e.recordSpecialSale(s, paid);
  return basis;
}

/** Hours a freighter needs between two ports (contract deadlines are quoted for a freighter). */
export const freighterHours = (e: Engine, a: number, b: number) => e.voyageHours(a, b, "freighter");
export const reachable = (e: Engine, a: number, b: number) => a !== b && Number.isFinite(e.dist[a][b]);
export const position = (e: Engine, s: Ship): Pt => e.piracy.position(s);
export const dist = (e: Engine, a: Pt, b: Pt) => e.piracy.geo.dist(a, b);

/** A point a fraction f along the sea lanes from port a to port b. */
export function lanePoint(e: Engine, a: number, b: number, f: number): Pt {
  return e.piracy.geo.at(e.piracy.geo.voyage(a, b), f);
}
/** A deterministic route (pair of connected ports) chosen by hash. */
export function pickRoute(e: Engine, ...salt: number[]): { a: number; b: number } {
  const r = e.map.routes[Math.floor(roll(...salt) * e.map.routes.length)];
  return { a: r.a, b: r.b };
}

/** Ports that produce / consume a good. */
export const producers = (e: Engine, g: number) => e.map.ports.filter(p => p.produces.includes(GOODS[g])).map(p => p.id);
export const consumers = (e: Engine, g: number) => e.map.ports.filter(p => p.consumes.includes(GOODS[g])).map(p => p.id);

/** Remote ports (fewest lanes, then lowest id): hideouts, island tribes. */
export function remotePorts(e: Engine, count: number, skip = 0): number[] {
  const degree = e.map.ports.map(() => 0);
  for (const r of e.map.routes) { degree[r.a]++; degree[r.b]++; }
  return e.map.ports.map(p => p.id).sort((a, b) => degree[a] - degree[b] || roll(0x4849, a) - roll(0x4849, b)).slice(skip, skip + count);
}

export function shipOptions(ships: Ship[]): FeatureField["options"] {
  return ships.map(s => ({ value: s.id, label: `Ship ${s.id} (${s.type}${s.qty > 0 && s.good !== null ? `, ${Math.round(s.qty)} ${goodName(s.good)}` : ", empty"})` }));
}
export function companyShips(e: Engine, company: number): Ship[] {
  return (e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)).filter((s): s is Ship => !!s);
}

// ------------------------------------------------------------ shared state

export const FACTIONS = ["guild", "syndicate", "navy", "tribes"] as const;
export type Faction = (typeof FACTIONS)[number];
export interface NewsItem { id: number; tick: number; kind: string; text: string; port?: number }

export interface Shared {
  /** Contract reputation: +1 per contract finished on time, -1 per failed or abandoned one. */
  rep: Map<number, number>;
  /** Wanted heat from offences seen by these modules (smuggling, inspections, fake distress). Stored with the tick it was
   *  set and read decayed by HEAT_DECAY per hour, so it needs no hourly upkeep. */
  heat: Map<number, { v: number; t: number }>;
  /** Companies flying the black flag (opt-in pirate role) and the tick they last changed it. */
  pirates: Set<number>;
  flagChanged: Map<number, number>;
  /** Faction standing per company, -100 to 100, in FACTIONS order. */
  standing: Map<number, number[]>;
  /** Sea news for the ledger, newest last. */
  news: NewsItem[];
  newsSeq: number;
  /** Ship -> smuggled package aboard (contract id). */
  contraband: Map<number, { contract: number; owner: number }>;
  /** Ship -> deck gun level (1 to 3). */
  guns: Map<number, number>;
  /** Ship -> hired escort for the voyage that departed at departTick. */
  escorts: Map<number, { owner: number; at: number }>;
  /** Ship -> convoy membership for the voyage that departed at departTick. */
  convoys: Map<number, { convoy: number; departTick: number; dest: number }>;
  /** Ship -> tick until which pirates know where it is (fake distress trap). */
  exposed: Map<number, number>;
  /** Company -> tick until which inspectors look the other way (bribe). */
  waived: Map<number, number>;
  /** Titles earned (legends, old captain, stranger), per company. */
  titles: Map<number, string[]>;
  /** Cargo losses at sea, for contracts.cargo-insurance (only filled while that module is on). */
  losses: { ship: number; owner: number; amount: number; kind: string; tick: number }[];
  contractSeq: number;
  /** Named pirate -> day until which it is sunk (bounties claimed). */
  sunk: Map<number, number>;
  /** Ambush and ransom tallies for the ledger. */
  tally: { ambushes: number; repelled: number; cargoLost: number; ransoms: number; ransomPaid: number; bounties: number };
}

const SHARED = new WeakMap<Engine, Shared>();
export function shared(e: Engine): Shared {
  let s = SHARED.get(e);
  if (!s) {
    s = { rep: new Map(), heat: new Map(), losses: [], contractSeq: 0, sunk: new Map(), tally: { ambushes: 0, repelled: 0, cargoLost: 0, ransoms: 0, ransomPaid: 0, bounties: 0 }, pirates: new Set(), flagChanged: new Map(), standing: new Map(), news: [], newsSeq: 0,
      contraband: new Map(), guns: new Map(), escorts: new Map(), convoys: new Map(), exposed: new Map(), waived: new Map(), titles: new Map() };
    SHARED.set(e, s);
  }
  return s;
}

export const repOf = (e: Engine, c: number) => shared(e).rep.get(c) ?? 0;
export function addRep(e: Engine, c: number, by: number) { const s = shared(e); s.rep.set(c, Math.max(-20, Math.min(100, repOf(e, c) + by))); }
export const HEAT_DECAY = 0.5;
export function heatOf(e: Engine, c: number): number {
  const h = shared(e).heat.get(c);
  return h ? Math.max(0, h.v - HEAT_DECAY * (e.tick - h.t)) : 0;
}
export function addHeat(e: Engine, c: number, by: number) {
  const s = shared(e), v = Math.max(0, Math.min(100, heatOf(e, c) + by));
  if (v > 0) s.heat.set(c, { v, t: e.tick }); else s.heat.delete(c);
}
/** Wanted stars 0 to 5 from police notoriety plus module heat. */
export function stars(e: Engine, c: number): number {
  return Math.min(5, Math.floor((e.piracy.notorietyOf(c) + heatOf(e, c)) / 20));
}
export function standingOf(e: Engine, c: number): number[] { return shared(e).standing.get(c) ?? FACTIONS.map(() => 0); }
/** Faction standing changes only while that faction's module (contracts.<faction>) is on. */
export function addStanding(e: Engine, c: number, f: Faction, by: number) {
  if (!e.features.enabled(`contracts.${f}`) || !e.companies.has(c)) return;
  const row = [...standingOf(e, c)], i = FACTIONS.indexOf(f);
  row[i] = Math.max(-100, Math.min(100, row[i] + by));
  shared(e).standing.set(c, row);
}
export function standingTier(v: number): string {
  return v >= 60 ? "Honoured" : v >= 20 ? "Friendly" : v > -20 ? "Neutral" : v > -60 ? "Wary" : "Hostile";
}
export function title(e: Engine, c: number, t: string): boolean {
  const s = shared(e), list = s.titles.get(c) ?? [];
  if (list.includes(t)) return false;
  s.titles.set(c, [...list, t].slice(-12));
  return true;
}

const NEWS_KEPT = 40;
export function news(e: Engine, kind: string, text: string, port?: number) {
  const s = shared(e);
  s.news.push({ id: ++s.newsSeq, tick: e.tick, kind, text: text.slice(0, 200), ...(port !== undefined ? { port } : {}) });
  if (s.news.length > NEWS_KEPT) s.news.splice(0, s.news.length - NEWS_KEPT);
}

/** Per-company short notice list kept by a module (newest last). */
export class Notices {
  private readonly m = new Map<number, { tick: number; text: string }[]>();
  constructor(private readonly keep = 6) {}
  add(e: Engine, company: number, text: string) {
    const list = this.m.get(company) ?? [];
    list.push({ tick: e.tick, text: text.slice(0, 200) });
    this.m.set(company, list.slice(-this.keep));
  }
  of(company: number) { return this.m.get(company) ?? []; }
}

// ------------------------------------------------------------ deterministic world places

/** Pirate zones for a given day: three circles centred on hashed lane points; they move every day. */
export function pirateZones(e: Engine, d = day(e)): { id: number; x: number; y: number; r: number }[] {
  if (!e.map.routes.length) return [];
  return [0, 1, 2].map(z => {
    const { a, b } = pickRoute(e, 0x5a4f4e45, d, z);
    const p = lanePoint(e, a, b, 0.3 + 0.4 * roll(0x5a4f, d, z));
    return { id: z, x: Math.round(p.x), y: Math.round(p.y), r: 70 * (e.map.worldScale ?? 1) };
  });
}
export function inZone(e: Engine, p: Pt): number {
  for (const z of pirateZones(e)) if (Math.hypot(z.x - p.x, z.y - p.y) <= z.r) return z.id;
  return -1;
}
export const hideouts = (e: Engine) => remotePorts(e, 3);
export const tribePorts = (e: Engine) => remotePorts(e, 3, 3);

/** The pirate boss event: appears every fifth day for two days, sailing a hashed voyage. */
export function bossNow(e: Engine, tick = e.tick): { event: number; x: number; y: number; until: number; from: number; to: number } | null {
  const d = Math.floor(tick / 24), event = Math.floor(d / 5);
  if (d % 5 < 2 || d % 5 > 3 || e.n < 2) return null;
  const { a, b } = pickRoute(e, 0x424f5353, event);
  const start = (event * 5 + 2) * 24, f = (tick - start) / 48;
  const p = lanePoint(e, a, b, f);
  return { event, x: p.x, y: p.y, until: start + 48, from: a, to: b };
}
/** The naval blockade: every seventh day, one port, for 36 hours. */
export function blockadeNow(e: Engine, tick = e.tick): { port: number; until: number } | null {
  const week = Math.floor(tick / 168), start = week * 168 + 72;
  if (tick < start || tick >= start + 36 || e.n < 2) return null;
  return { port: Math.floor(roll(0x424c4b44, week) * e.n), until: start + 36 };
}

// ------------------------------------------------------------ cards and voyages

export function act(module: string, label: string, action: string, extra: Record<string, unknown> = {}, fields?: FeatureField[]) {
  return { label, command: { type: "feature", module, action, ...extra }, ...(fields ? { fields } : {}) };
}
export const shipField = (ships: Ship[], label = "Ship"): FeatureField => ({ key: "ship", label, options: shipOptions(ships) });
export const cargoValue = (e: Engine, s: Ship) => s.good === null || s.qty <= 0 ? 0 : s.qty * e.price(s.dest ?? s.port, s.good);

/** Ships that docked during this hour (the engine moves arrivals just before modules advance). */
export function arrivals(e: Engine): Ship[] {
  const out: Ship[] = [];
  for (const s of e.ships.values()) if (s.dest === null && s.arriveTick === e.tick && s.departTick < s.arriveTick) out.push(s);
  return out;
}
/** Watches departures: call each hour; returns ships that put to sea since the last call (once per voyage). */
export class DepartureWatch {
  private readonly seen = new Map<number, number>();   // ship -> departTick already reported
  poll(e: Engine): Ship[] {
    const out: Ship[] = [];
    for (const s of e.ships.values()) {
      if (s.dest === null) continue;
      if (this.seen.get(s.id) !== s.departTick) { this.seen.set(s.id, s.departTick); out.push(s); }
    }
    for (const id of [...this.seen.keys()]) if (!e.ships.has(id)) this.seen.delete(id);
    return out;
  }
}
/** Something bought for a ship's next voyage: live while that voyage is at sea, spent once it docks. */
export interface VoyageBound { owner: number; at: number }
export function voyageLive(e: Engine, ship: number, b: VoyageBound | undefined): boolean {
  const s = e.ships.get(ship);
  return !!b && !!s && s.owner === b.owner && s.dest !== null && s.departTick >= b.at;
}
export function voyageSpent(e: Engine, ship: number, b: VoyageBound): boolean {
  const s = e.ships.get(ship);
  return !s || s.owner !== b.owner || (s.dest === null && s.departTick >= b.at && s.arriveTick > b.at);
}

// ------------------------------------------------------------ delivery contracts

export interface Contract {
  id: number; module: string; label: string;
  from: number; to: number; good: number; qty: number; reward: number;
  posted: number; deadline: number;
  taker?: number; accepted?: number;
}

/** True while late deliveries are allowed at reduced pay (contracts.late-penalty). */
export const lateRules = (e: Engine) => e.features.enabled("contracts.late-penalty");
export const LATE_GRACE = 48;
/** Offers stay on a board this long. */
export const OFFER_HOURS = 24;
/** Pay for a delivery at this tick: full by the deadline; with late penalties, 10% less per 6 hours late (at least 30%). */
export function deliveryPay(e: Engine, c: Pick<Contract, "reward" | "deadline">): number | null {
  if (e.tick <= c.deadline) return c.reward;
  if (!lateRules(e) || e.tick > c.deadline + LATE_GRACE) return null;
  return Math.round(c.reward * Math.max(0.3, 1 - 0.1 * Math.ceil((e.tick - c.deadline) / 6)));
}

/** A market-value reward: what the cargo would fetch at the destination, times a premium. */
export const valueReward = (e: Engine, to: number, good: number, qty: number, premium: number) =>
  Math.round(qty * e.price(to, good) * premium);

/** Open offers, accepted contracts and delivery for one module. Used by every delivery-contract module. */
export class ContractBook {
  offers: Contract[] = [];
  readonly taken = new Map<number, Contract>();
  readonly done = new Map<number, number>();     // company -> contracts completed
  readonly notes = new Notices();
  constructor(private readonly e: Engine, readonly module: string, readonly perCompany = 3) {}

  newId() { return ++shared(this.e).contractSeq; }
  /** A random producer-to-consumer job; null when the map has none. */
  draft(label: string, premium: number, hoursFactor: number, extraHours: number, qtyShare = [0.3, 0.8]): Contract | null {
    const e = this.e, r = () => e.features.random();
    for (let tries = 0; tries < 8; tries++) {
      const good = Math.floor(r() * GOODS.length);
      const from = producers(e, good), to = consumers(e, good);
      if (!from.length || !to.length) continue;
      const a = from[Math.floor(r() * from.length)], b = to[Math.floor(r() * to.length)];
      if (!reachable(e, a, b)) continue;
      const cap = e.spec("freighter").capacity;
      const qty = Math.max(5, Math.round(cap * (qtyShare[0] + (qtyShare[1] - qtyShare[0]) * r())));
      return { id: this.newId(), module: this.module, label, from: a, to: b, good, qty, reward: valueReward(e, b, good, qty, premium),
        posted: e.tick, deadline: e.tick + Math.ceil(freighterHours(e, a, b) * hoursFactor) + extraHours };
    }
    return null;
  }
  mine(company: number) { return [...this.taken.values()].filter(c => c.taker === company); }
  accept(company: number, id: unknown, extra?: (c: Contract) => string | null): Result {
    const c = this.offers.find(o => o.id === id);
    if (!c) return fail("that contract is no longer on offer");
    if (this.mine(company).length >= this.perCompany) return fail(`you can hold at most ${this.perCompany} of these contracts`);
    const why = extra?.(c);
    if (why) return fail(why);
    this.offers = this.offers.filter(o => o !== c);
    c.taker = company; c.accepted = this.e.tick;
    // The clock starts when it is taken: the deadline keeps the same allowance from the moment of acceptance.
    c.deadline += this.e.tick - c.posted;
    this.taken.set(c.id, c);
    return ok;
  }
  /** Deliver an accepted contract with a docked ship at its destination. */
  deliver(company: number, id: unknown, shipId: unknown, payOverride?: number): Result {
    const e = this.e, c = typeof id === "number" ? this.taken.get(id) : undefined;
    if (!c || c.taker !== company) return fail("you hold no such contract");
    const s = ownShip(e, company, shipId);
    if (typeof s === "string") return fail(s);
    if (s.dest !== null || s.port !== c.to) return fail(`the ship must be docked at ${portName(e, c.to)}`);
    if (s.good !== c.good || s.qty < c.qty) return fail(`the ship needs ${c.qty} t of ${goodName(c.good)} aboard`);
    const pay = payOverride ?? deliveryPay(e, c);
    if (pay === null) return fail("that contract has run out of time");
    unload(e, s, c.qty, pay);
    e.companies.get(company)!.cash += pay;
    this.taken.delete(c.id);
    this.done.set(company, (this.done.get(company) ?? 0) + 1);
    addRep(e, company, e.tick <= c.deadline ? 1 : 0);
    addStanding(e, company, "guild", 2);
    this.notes.add(e, company, `${c.label}: delivered ${c.qty} t of ${goodName(c.good)} to ${portName(e, c.to)} for ${money(pay)}${e.tick > c.deadline ? " (late)" : ""}.`);
    return { ok: true, earned: pay };
  }
  /** Drop contracts that ran out of time; returns the failed ones. Late penalties charge 10% of the reward. */
  expire(): Contract[] {
    const e = this.e, failed: Contract[] = [];
    for (const c of [...this.taken.values()]) {
      const last = c.deadline + (lateRules(e) ? LATE_GRACE : 0);
      if (e.tick <= last) continue;
      this.taken.delete(c.id); failed.push(c);
      addRep(e, c.taker!, -1);
      const co = e.companies.get(c.taker!);
      if (co && lateRules(e)) co.cash -= Math.round(c.reward * 0.1);
      this.notes.add(e, c.taker!, `${c.label} to ${portName(e, c.to)} failed: out of time.${lateRules(e) ? ` Penalty ${money(c.reward * 0.1)}.` : ""}`);
    }
    this.offers = this.offers.filter(o => o.posted + OFFER_HOURS > e.tick);
    return failed;
  }
  abandon(company: number, id: unknown): Result {
    const c = typeof id === "number" ? this.taken.get(id) : undefined;
    if (!c || c.taker !== company) return fail("you hold no such contract");
    this.taken.delete(c.id);
    addRep(this.e, company, -1);
    return ok;
  }
  describe(c: Contract) {
    const e = this.e, left = c.deadline - e.tick;
    return `${c.qty} t ${goodName(c.good)}: ${portName(e, c.from)} → ${portName(e, c.to)}, pays ${money(c.reward)}, ${c.taker === undefined ? `${c.deadline - c.posted} h allowed` : left >= 0 ? `${left} h left` : `${-left} h late`}`;
  }
  /** Standard card actions: accept offers, deliver or abandon held contracts. */
  actions(company: number, offers = this.offers) {
    const e = this.e, out: ReturnType<typeof act>[] = [];
    for (const o of offers.slice(0, 5)) out.push(act(this.module, `Accept: ${this.describe(o)}`, "accept", { contract: o.id }));
    for (const c of this.mine(company)) {
      const ships = companyShips(e, company).filter(s => s.dest === null && s.port === c.to && s.good === c.good && s.qty >= c.qty);
      if (ships.length) out.push(act(this.module, `Deliver: ${this.describe(c)}`, "deliver", { contract: c.id }, [shipField(ships)]));
      out.push(act(this.module, `Abandon contract ${c.id} (costs reputation)`, "abandon", { contract: c.id }));
    }
    return out;
  }
  view(company: number) {
    return { offers: this.offers.map(o => ({ ...o })), held: this.mine(company).map(c => ({ ...c })), done: this.done.get(company) ?? 0, notes: this.notes.of(company) };
  }
  /** Shared apply for accept / deliver / abandon. */
  standard(cmd: { company: number; action: string; contract?: unknown; ship?: unknown }): Result | null {
    if (cmd.action === "accept") return this.accept(cmd.company, cmd.contract);
    if (cmd.action === "deliver") return this.deliver(cmd.company, cmd.contract, cmd.ship);
    if (cmd.action === "abandon") return this.abandon(cmd.company, cmd.contract);
    return null;
  }
}

// ------------------------------------------------------------ NPC schedules (pure functions of the map and tick)

const NAMES = ["Morwen", "Tallis", "Brannock", "Isolde", "Corvin", "Petra", "Aldous", "Wren", "Hollis", "Seren", "Marlow", "Ysolde",
  "Fenwick", "Odile", "Garrick", "Liesel", "Barnaby", "Tamsin", "Ewan", "Clio"];
export const npcName = (...salt: number[]) => NAMES[Math.floor(roll(0x4e414d45, ...salt) * NAMES.length)];

/** A port chosen by hash for a period (mayor requests, the old captain, the stranger...). */
export const hashedPort = (e: Engine, ...salt: number[]) => Math.floor(roll(0x504f5254, ...salt) * e.n);

/** An NPC sailing one lane per `hours` (a fresh lane each leg): position, lane and how far along. */
export function npcVoyage(e: Engine, salt: number, hours: number, tick = e.tick) {
  if (!e.map.routes.length) return null;
  const leg = Math.floor(tick / hours), f = (tick % hours) / hours;
  const { a, b } = pickRoute(e, salt, leg);
  const flip = roll(salt, leg, 7) < 0.5;
  const from = flip ? b : a, to = flip ? a : b;
  const p = lanePoint(e, from, to, f);
  return { x: Math.round(p.x), y: Math.round(p.y), from, to, leg, f };
}

export const PIRATE_PERSONAS = [
  { name: "Red Annet", trait: "cruel", line: "takes everything and laughs about it" },
  { name: "Silas Coin", trait: "greedy", line: "will always take a ransom" },
  { name: "Captain Holloway", trait: "honourable", line: "never harms a crew that yields" },
  { name: "The Eel", trait: "cunning", line: "strikes from fog and is gone" },
  { name: "Marigold Vane", trait: "flamboyant", line: "announces every raid in the papers" },
] as const;
/** The named pirates' positions now (each sails its own 30-hour legs). */
export function namedPirates(e: Engine, tick = e.tick) {
  return PIRATE_PERSONAS.map((p, i) => ({ id: i, ...p, at: npcVoyage(e, 0x50495200 + i, 30, tick) }));
}
export const nearPt = (e: Engine, a: Pt, b: Pt, range: number) => Math.hypot(a.x - b.x, a.y - b.y) <= range * (e.map.worldScale ?? 1);

/** Another module of this category, if it is switched on. */
export function peer<T>(e: Engine, id: string): (T & FeatureModuleLike) | undefined {
  return e.features.enabled(id) ? e.features.modules.get(id) as unknown as T & FeatureModuleLike : undefined;
}
type FeatureModuleLike = { id: string };
