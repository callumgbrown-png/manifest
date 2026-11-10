// Helpers shared by the world feature modules: deterministic hashing, sea geometry, the game calendar,
// event schedules, sea regions, text filtering and the news registry. Nothing here holds game state.
import { readFileSync } from "node:fs";
import type { Company, Engine, Result, Ship } from "../../engine.js";

/** Same order as GOODS in engine.ts (not imported: engine.ts loads the feature modules, so a value import would be circular). */
export const GOODS_NAMES: readonly string[] = ["grain", "fuel", "ore", "machinery"];
import type { Poly, Pt } from "../../geo.js";

export interface WorldContent { regions: string[]; buoyLabels: string[]; relics: string[]; trophies: string[]; blocklist: string[] }
export const CONTENT: WorldContent = JSON.parse(readFileSync(new URL("../../../../config/content/world/world.json", import.meta.url), "utf8"));

export const fail = (error: string): Result => ({ ok: false, error });
export const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Deterministic hash of integers to [0, 1). */
export function hash(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) { h = Math.imul(h ^ (v | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  return (h >>> 0) / 4294967296;
}

// ------------------------------------------------------------ geometry (radii are in original economy units, like piracy)

export const scale = (e: Engine) => e.piracy.geo.scale;
/** Map size in map units: the terrain's size when the map has one, else the original 1000 x 700 scaled. */
export function bounds(e: Engine): { w: number; h: number } {
  const t = (e.map as { terrain?: { width: number; height: number } }).terrain;
  return t ? { w: t.width, h: t.height } : { w: 1000 * scale(e), h: 700 * scale(e) };
}
export const dist = (e: Engine, a: Pt, b: Pt) => e.piracy.geo.dist(a, b);
export const round1 = (p: Pt) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

/** Distance from p to segment ab, in map units. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** True if a polyline passes within r (economy units) of c. */
export function polyNear(e: Engine, poly: Poly, c: Pt, r: number): boolean {
  const rm = r * scale(e);
  for (let i = 1; i < poly.points.length; i++) if (segDist(c, poly.points[i - 1], poly.points[i]) <= rm) return true;
  return poly.points.length === 1 && Math.hypot(poly.points[0].x - c.x, poly.points[0].y - c.y) <= rm;
}
export const voyagePoly = (e: Engine, from: number, dest: number) => e.piracy.geo.voyage(from, dest);
/** A point on a sea lane chosen by salt (always water: lanes are built on the navigation grid). */
export function seaPoint(e: Engine, salt: number, lo = 0.25, hi = 0.75): Pt {
  const routes = e.map.routes;
  const r = routes[Math.floor(hash(salt, 1) * routes.length)];
  return round1(e.piracy.geo.at(e.piracy.geo.voyage(r.a, r.b), lo + hash(salt, 2) * (hi - lo)));
}
export const shipPos = (e: Engine, s: Ship, tick = e.tick) => e.piracy.position(s, tick);
/** A ship at sea is alongside a site when it is within reach this hour (fast ships get a wider reach, as offshore jobs do). */
export function alongside(e: Engine, s: Ship, site: Pt, r = 40): boolean {
  if (s.dest === null) return false;
  return dist(e, shipPos(e, s), site) <= Math.max(r, e.spec(s.type).speed_per_hour * 0.7);
}
/** True if a ship's track over the last hour passed within r of a point. */
export function passedNear(e: Engine, s: Ship, site: Pt, r: number): boolean {
  if (s.dest === null) return dist(e, e.map.ports[s.port], site) <= r;
  const a = shipPos(e, s, Math.max(s.departTick, e.tick - 1)), b = shipPos(e, s);
  return segDist(site, a, b) / scale(e) <= r;
}
export function ownShip(e: Engine, company: number, ship: unknown): Ship | undefined {
  if (!isInt(ship, 0, 1e9)) return undefined;
  const s = e.ships.get(ship);
  return s && s.owner === company ? s : undefined;
}

// ------------------------------------------------------------ calendar: a season is a game year

export const SEASON_NAMES = ["spring", "summer", "autumn", "winter"] as const;
export function calendar(e: Engine, tick = e.tick) {
  const quarter = Math.max(24, Math.floor(e.seasonHours / 4));
  const season = Math.min(3, Math.floor(tick / quarter));
  return { day: Math.floor(tick / 24) + 1, hour: tick % 24, season, seasonName: SEASON_NAMES[season],
    month: Math.min(11, Math.floor(tick / Math.max(1, e.seasonHours) * 12)), night: tick % 24 >= 20 || tick % 24 < 6 };
}
export const clock = (tick: number) => `day ${Math.floor(tick / 24) + 1}, ${String(tick % 24).padStart(2, "0")}:00`;

// ------------------------------------------------------------ schedules (pure functions of the tick)

export interface SlotSpec { period: number; duration: number; salt: number; chance: number | ((start: number) => number); offset?: number }
export interface Slot { index: number; starts: number; ends: number }
/** The slot of a periodic event with this index, or undefined if it does not happen. */
export function slotAt(spec: SlotSpec, index: number): Slot | undefined {
  if (index < 0) return undefined;
  const base = index * spec.period + (spec.offset ?? 0);
  const starts = base + Math.floor(hash(spec.salt, index, 3) * Math.max(1, spec.period - spec.duration));
  const chance = typeof spec.chance === "function" ? spec.chance(starts) : spec.chance;
  return hash(spec.salt, index, 7) < chance ? { index, starts, ends: starts + spec.duration } : undefined;
}
/** Every slot overlapping [from, to). */
export function slotsBetween(spec: SlotSpec, from: number, to: number): Slot[] {
  const out: Slot[] = [];
  const first = Math.floor((from - (spec.offset ?? 0) - spec.period) / spec.period), last = Math.floor((to - (spec.offset ?? 0)) / spec.period);
  for (let i = Math.max(0, first); i <= last; i++) { const s = slotAt(spec, i); if (s && s.starts < to && s.ends > from) out.push(s); }
  return out;
}
export const activeSlot = (spec: SlotSpec, tick: number) => slotsBetween(spec, tick, tick + 1)[0];
/** The active slot, else the next one starting within `ahead` hours. */
export const currentOrNext = (spec: SlotSpec, tick: number, ahead: number) => slotsBetween(spec, tick, tick + ahead + 1)[0];

// ------------------------------------------------------------ sea regions: a 3 x 2 grid over the map

export function regionOf(e: Engine, p: Pt): number {
  const { w, h } = bounds(e);
  const col = Math.max(0, Math.min(2, Math.floor(p.x / w * 3))), row = Math.max(0, Math.min(1, Math.floor(p.y / h * 2)));
  return row * 3 + col;
}
export function regions(e: Engine) {
  const { w, h } = bounds(e);
  return CONTENT.regions.slice(0, 6).map((name, id) => {
    const ports = e.map.ports.filter(p => regionOf(e, p) === id);
    const cx = ((id % 3) + 0.5) * w / 3, cy = (Math.floor(id / 3) + 0.5) * h / 2;
    return { id, name, x: Math.round(cx), y: Math.round(cy), ports: ports.map(p => p.id) };
  });
}
export const portRegion = (e: Engine, port: number) => regionOf(e, e.map.ports[port]);

// ------------------------------------------------------------ text

/** Player-typed labels: letters, digits and simple punctuation, at most `max` characters, no blocked words. */
export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.normalize("NFKC").replace(/[^A-Za-z0-9 .,'!?-]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  if (!text) return null;
  const lower = text.toLowerCase();
  return CONTENT.blocklist.some(w => lower.includes(w)) ? null : text;
}

// ------------------------------------------------------------ cargo handed over outside the market (economy modules only)

/** Take qty of a ship's legal docked cargo and pay `pay` for it, recording the sale like other special sales. */
export function specialDelivery(e: Engine, c: Company, s: Ship, qty: number, pay: number): Result {
  if (s.dest !== null || s.good === null || qty < 1 || qty > s.qty || e.maritime.hasLoot(s)) return fail("dock with legal cargo to deliver");
  s.cost *= (s.qty - qty) / s.qty;
  s.qty -= qty;
  if (!s.qty) s.good = null;
  e.maritime.cargoMoved(s, qty);
  c.cash += pay;
  e.recordSpecialSale(s, pay);
  return { ok: true, sold: qty, earned: pay };
}

// ------------------------------------------------------------ news: modules register headline providers; world.news shows those switched on

export interface Headline { tick: number; text: string; kind: string }
const providers = new WeakMap<Engine, Map<string, () => Headline[]>>();
export function addNews(e: Engine, module: string, fn: () => Headline[]) {
  const map = providers.get(e) ?? new Map<string, () => Headline[]>();
  map.set(module, fn);
  providers.set(e, map);
}
export function headlines(e: Engine): Headline[] {
  const out: Headline[] = [];
  for (const [id, fn] of providers.get(e) ?? []) if (e.features.enabled(id)) out.push(...fn());
  return out.sort((a, b) => b.tick - a.tick || a.text.localeCompare(b.text));
}

// ------------------------------------------------------------ small helpers for cards and commands

export const portName = (e: Engine, port: number) => e.map.ports[port]?.name ?? `port ${port}`;
export const companyName = (e: Engine, id: number) => e.companies.get(id)?.name ?? "a lost company";
/** A card button that sends { type: "feature", module, action, ...extra }. */
export function action(module: string, label: string, act: string, extra: Record<string, unknown> = {}, fields?: { key: string; label: string; min?: number; max?: number; value?: number | string; options?: { value: number | string; label: string }[] }[]) {
  return { label, command: { type: "feature", module, action: act, ...extra }, ...(fields ? { fields } : {}) };
}
/** Ports that can be sailed to from somewhere (some maps have unreachable islets). */
export function connected(e: Engine): number[] {
  return e.map.ports.map(p => p.id).filter(i => e.dist[i].some((d, j) => j !== i && Number.isFinite(d)));
}
/** A connected port chosen by salt. */
export function portBy(e: Engine, ...salt: number[]): number {
  const ports = connected(e);
  return ports[Math.floor(hash(...salt) * ports.length)] ?? 0;
}
/** Ships of a company, optionally only those at sea. */
export const fleet = (e: Engine, company: number) => (e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)!).filter(Boolean);
/** A field for picking one of the company's ships. */
export function shipField(e: Engine, company: number, filter: (s: Ship) => boolean = () => true) {
  const ships = fleet(e, company).filter(filter);
  return ships.length ? [{ key: "ship", label: "Ship", options: ships.map(s => ({ value: s.id, label: `Ship ${s.id}${s.dest === null ? ` at ${portName(e, s.port)}` : " at sea"}` })), value: ships[0].id }] : undefined;
}
/** Quarter length of the season calendar (hours). */
export const quarterHours = (e: Engine) => Math.max(24, Math.floor(e.seasonHours / 4));
