// Per-world cosmetic state shared by the community modules (locker, shop, referrals, testers, challenges, naming).
// One store per Engine; it changes only inside those modules' apply()/advance(), so replays rebuild it exactly.
import type { Engine } from "../../engine.js";
import { getCatalogue, type Slot } from "./content.js";

export interface Locker {
  /** Unlocked non-free items. Free items are owned by everyone and not stored. */
  owned: Set<string>;
  equipped: Partial<Record<Slot, string>>;
  /** Port-dedication tokens (naming rewards). */
  naming: number;
  /** Tester points from bug-report, playtest and race codes. */
  points: number;
  /** Hashes of codes this company has redeemed. */
  redeemed: Set<string>;
}
export interface CommunityStore {
  lockers: Map<number, Locker>;
  /** Code hash -> redemptions so far. */
  codeUses: Map<string, number>;
  /** Limited item id -> companies that claimed it. */
  limitedClaims: Map<string, number>;
}

const stores = new WeakMap<Engine, CommunityStore>();
const EMPTY: Locker = Object.freeze({ owned: new Set<string>(), equipped: {}, naming: 0, points: 0, redeemed: new Set<string>() }) as Locker;

export function store(e: Engine): CommunityStore {
  let s = stores.get(e);
  if (!s) stores.set(e, s = { lockers: new Map(), codeUses: new Map(), limitedClaims: new Map() });
  return s;
}
/** The company's locker, created on first change. Only call from apply/advance. */
export function locker(e: Engine, company: number): Locker {
  const all = store(e).lockers;
  let l = all.get(company);
  if (!l) all.set(company, l = { owned: new Set(), equipped: {}, naming: 0, points: 0, redeemed: new Set() });
  return l;
}
/** Read-only view of a locker (safe in view()/world()/cards()). */
export function peek(e: Engine, company: number): Locker { return store(e).lockers.get(company) ?? EMPTY; }

export function owns(e: Engine, company: number, item: string): boolean {
  const it = getCatalogue().items.get(item);
  return !!it && (it.source === "free" || peek(e, company).owned.has(item));
}
/** Unlock an item or every item of a pack; returns the ids that were new. */
export function grant(e: Engine, company: number, id: string): string[] {
  const cat = getCatalogue();
  const ids = cat.packs.get(id)?.items ?? (cat.items.has(id) ? [id] : []);
  const l = locker(e, company), fresh: string[] = [];
  for (const it of ids) if (cat.items.get(it)!.source !== "free" && !l.owned.has(it)) { l.owned.add(it); fresh.push(it); }
  return fresh;
}
/** Render data for an item (sent to clients). */
export function itemData(id: string) {
  const it = getCatalogue().items.get(id);
  return it ? { id, slot: it.slot, name: it.name, colors: it.colors, style: it.style } : null;
}
