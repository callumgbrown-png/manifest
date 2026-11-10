// Shared state and helpers for the social modules: the word filter, guilds ("companies" of several players),
// trust scores, the public ledger and ship hand-overs. One store per Engine, changed only inside module
// apply()/advance(), so replays rebuild it exactly.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine, Result, Ship } from "../../engine.js";
import type { FeatureAction } from "../../expansion-cards.js";

export const OK: Result = { ok: true };
export const fail = (error: string): Result => ({ ok: false, error });
export const action = (module: string, label: string, act: string, extra: Record<string, unknown> = {}): FeatureAction =>
  ({ label, command: { type: "feature", module, action: act, ...extra } });
export const day = (e: Engine) => Math.floor(e.tick / 24) + 1;
export const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
export const name = (e: Engine, id: number) => e.companies.get(id)?.name ?? `Company ${id}`;
export const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `Port ${p}`;
export const isPort = (e: Engine, p: unknown): p is number => isInt(p, 0, e.n - 1);
export const isCompany = (e: Engine, c: unknown): c is number => typeof c === "number" && e.companies.has(c);
export const credits = (n: number) => Math.round(n).toLocaleString("en-GB");
export const portOptions = (e: Engine) => e.map.ports.map((p, i) => ({ value: i, label: p.name }));
export const companyOptions = (e: Engine, not: number) => [...e.companies.values()].filter(c => c.id !== not).map(c => ({ value: c.id, label: c.name }));

/** Per-day counter for rate limits (deterministic: game days). */
export class DailyLimit {
  private used = new Map<number, { day: number; n: number }>();
  constructor(private readonly e: Engine, private readonly max: number) {}
  left(company: number) { const u = this.used.get(company); return u && u.day === day(this.e) ? this.max - u.n : this.max; }
  take(company: number): boolean {
    if (this.left(company) <= 0) return false;
    const d = day(this.e), u = this.used.get(company);
    this.used.set(company, { day: d, n: (u?.day === d ? u.n : 0) + 1 });
    return true;
  }
}

// ------------------------------------------------------------ word filter (config/content/social/words.json)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
let words: { whole: Set<string>; prefix: string[] } | null = null;
function loadWords() {
  if (words) return words;
  const file = join(ROOT, "config", "content", "social", "words.json");
  const list: string[] = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")).words ?? []) : [];
  words = { whole: new Set(list.filter(w => !w.endsWith("*")).map(w => w.toLowerCase())), prefix: list.filter(w => w.endsWith("*")).map(w => w.slice(0, -1).toLowerCase()) };
  return words;
}
const unswap = (w: string) => w.toLowerCase().replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s");
const rude = (w: string) => { const { whole, prefix } = loadWords(); const u = unswap(w).replace(/[^a-z]/g, ""); return !!u && (whole.has(u) || prefix.some(p => u.startsWith(p))); };
// Built from a string so the source holds no raw line-separator characters.
const SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");
const CONTACT = /((https?:\/\/|www\.)[^\s]*|[a-z0-9-]+\.(com|net|org|gg|io|xyz|co|uk)\b|@[a-z0-9_]{2,}|\b[\w.+-]+@[\w-]+\.\w+|\d[\d\s().-]{7,}\d)/i;

/** Player text (chat, articles, case statements): trimmed, length-limited, contact details removed, rude words starred. */
export function cleanText(raw: unknown, max: number, min = 1): string | null {
  if (typeof raw !== "string" || raw.length > max * 3) return null;
  let text = raw.normalize("NFKC").replace(/[\x00-\x1f\x7f]/g, " ").replace(SEPARATORS, " ").replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max) return null;
  text = text.replace(new RegExp(CONTACT.source, "gi"), "[removed]");
  return text.replace(/[^\s]+/g, w => rude(w) ? "*".repeat(w.length) : w);
}
/** Names (guilds, papers, lines): 3-24 letters, digits, spaces and ' - . &; refused if rude or contact-like. */
export function cleanLabel(raw: unknown, max = 24, min = 3): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (text.length < min || text.length > max || !/^[A-Za-z0-9 '.&-]+$/.test(text) || CONTACT.test(text)) return null;
  return text.split(/[\s'.&-]+/).some(rude) || rude(text.replace(/[^A-Za-z0-9]/g, "")) ? null : text;
}

// ------------------------------------------------------------ the social store
export type Rank = "member" | "officer" | "leader";
export const RANKS: Rank[] = ["member", "officer", "leader"];
export interface Guild {
  id: number; name: string; tag: string; founded: number;
  members: Map<number, Rank>; invites: Set<number>; open: boolean;
  flag: [string, string]; hq: number | null; hqSince: number;
  xp: number; techs: Set<string>; fame: string[];
}
export interface LedgerEntry { tick: number; kind: string; from: number | null; to: number | null; amount: number; note: string }
export interface SocialStore {
  guilds: Map<number, Guild>; nextGuild: number; memberOf: Map<number, number>;
  /** Trust score inputs per company. */
  trust: Map<number, number>;
  ledger: LedgerEntry[];
  /** Guild treasuries (economy modules only). */
  treasury: Map<number, number>;
  /** rank -> allowed actions (social.roles). */
  permissions: Map<number, Map<string, Rank>>;
}
const stores = new WeakMap<Engine, SocialStore>();
export function social(e: Engine): SocialStore {
  let s = stores.get(e);
  if (!s) stores.set(e, s = { guilds: new Map(), nextGuild: 1, memberOf: new Map(), trust: new Map(), ledger: [], treasury: new Map(), permissions: new Map() });
  return s;
}
export const guildOf = (e: Engine, company: number): Guild | undefined => {
  const g = social(e).memberOf.get(company);
  return g === undefined ? undefined : social(e).guilds.get(g);
};
export const rankOf = (e: Engine, company: number): Rank | undefined => guildOf(e, company)?.members.get(company);
export const atLeast = (r: Rank | undefined, need: Rank) => r !== undefined && RANKS.indexOf(r) >= RANKS.indexOf(need);
export const guildName = (e: Engine, id: number) => { const g = social(e).guilds.get(id); return g ? `${g.name} [${g.tag}]` : "a disbanded guild"; };
/** Live guild members (companies that still exist). */
export const members = (e: Engine, g: Guild) => [...g.members.keys()].filter(c => e.companies.has(c));

/** Trust: starts at 50, kept within 0..100. */
export const trustOf = (e: Engine, company: number) => social(e).trust.get(company) ?? 50;
export function addTrust(e: Engine, company: number, delta: number) {
  social(e).trust.set(company, Math.max(0, Math.min(100, trustOf(e, company) + delta)));
}

export const LEDGER_KEPT = 200;
/** Record a player-to-player money move or public event (social.ledger shows it). */
export function record(e: Engine, kind: string, from: number | null, to: number | null, amount: number, note: string) {
  const l = social(e).ledger;
  l.push({ tick: e.tick, kind, from, to, amount: Math.round(amount), note: note.slice(0, 120) });
  if (l.length > LEDGER_KEPT) l.shift();
}

/** Move a cash amount between two companies (no money is made or lost). */
export function pay(e: Engine, from: number, to: number, amount: number, kind: string, note: string): boolean {
  const a = e.companies.get(from), b = e.companies.get(to);
  if (!a || !b || !(amount >= 0) || a.cash < amount) return false;
  a.cash -= amount; b.cash += amount;
  record(e, kind, from, to, amount, note);
  return true;
}

/** Can this ship change hands right now? Returns a reason if not. */
export function cannotTransfer(e: Engine, s: Ship | undefined, owner: number): string | undefined {
  if (!s || s.owner !== owner) return "not that company's ship";
  if (s.type === "pirate") return "pirate ships can't change hands";
  if (s.dest !== null) return "the ship is at sea";
  if (s.qty > 0) return "the ship has cargo aboard";
  if (e.voyageQueues.has(s.id)) return "the ship has a voyage queue";
  if (e.expansionEnabled && (e.fleetExpansion.leased(s) || e.explorationExpansion.spaceTaken(s))) return "the ship is leased or carrying offshore cargo";
  if ((e.companies.get(owner)?.ships.length ?? 0) <= 1) return "a company must keep one ship";
  return undefined;
}
export function hasRoom(e: Engine, company: number) {
  const c = e.companies.get(company)!;
  return c.ships.length + (e.expansionEnabled ? e.fleetExpansion.reservedSlots(c) : 0) < e.rules.company.max_ships;
}
/** Hand a docked, empty ship to another company (as the ships resale market does). */
export function transferShip(e: Engine, s: Ship, to: number) {
  const from = e.companies.get(s.owner)!, buyer = e.companies.get(to)!;
  const trip = e.openTrip(from.id, s.id);
  if (trip) trip.open = false;
  e.maritime.removeShip(s);
  e.guildFreight.release(s.id);
  from.ships = from.ships.filter(i => i !== s.id);
  buyer.ships.push(s.id);
  s.owner = buyer.id;
  s.cost = 0;
}

/** Deliveries (voyages with cargo) that docked after `since` and by now. */
export function deliveriesSince(e: Engine, company: number, since: number) {
  return (e.trips.get(company) ?? []).filter(t => t.good !== null && t.qty > 0 && t.arriveTick > since && t.arriveTick <= e.tick);
}
export const finishedVoyages = (e: Engine, company: number) => (e.trips.get(company) ?? []).filter(t => !t.open && t.good !== null).length;

/** A simple ballot: one vote per company per ballot. */
export class Ballot<T extends string | number> {
  readonly votes = new Map<number, T>();
  constructor(readonly options: T[], readonly closes: number) {}
  cast(company: number, choice: unknown): string | undefined {
    if (!this.options.includes(choice as T)) return "not one of the choices";
    this.votes.set(company, choice as T);
    return undefined;
  }
  tally(): [T, number][] {
    const counts = new Map<T, number>(this.options.map(o => [o, 0]));
    for (const v of this.votes.values()) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || this.options.indexOf(a[0]) - this.options.indexOf(b[0]));
  }
  winner(): T | undefined { const t = this.tally(); return t.length && t[0][1] > 0 && (t.length < 2 || t[0][1] > t[1][1]) ? t[0][0] : undefined; }
}
