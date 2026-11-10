// Helpers shared by the platform modules: free-text filtering, a deterministic per-company rate limiter,
// a per-engine store of review flags, and small economy measures (Gini, median). No personal data anywhere:
// companies are known only by their in-game id and name.
import { readFileSync } from "node:fs";
import type { Engine, Company } from "../../engine.js";
import type { FeatureModule } from "../types.js";
import { isBot } from "../../bots.js";

/** A platform module may also expose data for the admin console (see admin.ts). Never sent to players. */
export type PlatformModule = FeatureModule & { admin?(): unknown };
export type PlatformFactory = (e: Engine) => PlatformModule;

export const ok = { ok: true as const };
export const fail = (error: string) => ({ ok: false as const, error });

// ------------------------------------------------------------ free text

const FALLBACK_WORDS = ["idiot", "stupid", "moron", "scam", "cheat"];
let blockedWords: string[] = FALLBACK_WORDS;
try {
  const file = new URL("../../../../config/content/platform/chat-filter.json", import.meta.url);
  const data = JSON.parse(readFileSync(file, "utf8")) as { blocked?: unknown };
  if (Array.isArray(data.blocked)) blockedWords = data.blocked.filter((w): w is string => typeof w === "string" && w.length > 1).map(w => w.toLowerCase());
} catch { /* keep the built-in list */ }

/**
 * Cleans player free text: strips control characters, collapses spaces, cuts it to `max` characters,
 * removes anything that looks like contact details (e-mail, links, long digit runs) and masks blocked words.
 * Returns null for text that is not a string or is empty after cleaning.
 */
export function cleanText(raw: unknown, max = 200): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.slice(0, max * 4).replace(/[\u0000-\u001f\u007f-\u009f​-‏ -‮]/g, " ");
  t = t.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[removed]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[removed]")
    .replace(/\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|ru|de|ie|uk|co)\b\S*/gi, "[removed]")
    .replace(/(?:\+?\d[\s-]?){7,}/g, "[removed]");
  for (const w of blockedWords) t = t.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "gi"), m => "*".repeat(m.length));
  t = t.replace(/\s+/g, " ").trim().slice(0, max);
  return t.length ? t : null;
}

// ------------------------------------------------------------ per-engine shared state

interface Shared {
  /** company -> action key -> ticks of recent accepted actions */
  hits: Map<number, Map<string, number[]>>;
  /** company -> reasons it is flagged for review (cleared only by reasons expiring) */
  flags: Map<number, Map<string, { since: number; until: number; detail: string }>>;
  /** first tick a platform module saw each company (company age) */
  firstSeen: Map<number, number>;
}
const SHARED = new WeakMap<Engine, Shared>();
function shared(e: Engine): Shared {
  let s = SHARED.get(e);
  if (!s) SHARED.set(e, s = { hits: new Map(), flags: new Map(), firstSeen: new Map() });
  return s;
}

/**
 * Deterministic per-company limiter for platform commands: at most `max` accepted actions under `key`
 * in the last `hours` game hours. Call only from apply(); it records the hit when it allows one.
 */
export function allowAction(e: Engine, company: number, key: string, max: number, hours: number): boolean {
  const s = shared(e);
  const byKey = s.hits.get(company) ?? new Map<string, number[]>();
  const recent = (byKey.get(key) ?? []).filter(t => e.tick - t < hours);
  if (recent.length >= max) { byKey.set(key, recent); s.hits.set(company, byKey); return false; }
  recent.push(e.tick);
  byKey.set(key, recent);
  s.hits.set(company, byKey);
  return true;
}

/** Flags a company for admin review for `hours` game hours. Flags never punish by themselves. */
export function flag(e: Engine, company: number, reason: string, detail: string, hours = 168) {
  const s = shared(e);
  const m = s.flags.get(company) ?? new Map();
  const old = m.get(reason);
  m.set(reason, { since: old?.since ?? e.tick, until: e.tick + hours, detail: detail.slice(0, 160) });
  s.flags.set(company, m);
}
export function flagsOf(e: Engine, company: number): { reason: string; since: number; until: number; detail: string }[] {
  const m = shared(e).flags.get(company);
  return m ? [...m].filter(([, f]) => f.until > e.tick).map(([reason, f]) => ({ reason, ...f })) : [];
}
export function flaggedCompanies(e: Engine): number[] {
  return [...shared(e).flags.keys()].filter(id => flagsOf(e, id).length > 0).sort((a, b) => a - b);
}

/** Records the first tick a company was seen (call from enable/advance); returns its age in hours. */
export function noteCompanies(e: Engine) {
  const s = shared(e);
  for (const id of e.companies.keys()) if (!s.firstSeen.has(id)) s.firstSeen.set(id, e.tick);
}
export function ageHours(e: Engine, company: number): number {
  const seen = shared(e).firstSeen.get(company);
  return seen === undefined ? 0 : e.tick - seen;
}

// ------------------------------------------------------------ measures

export const isHouseBot = (c: Company) => isBot(c.name);

export function gini(values: number[]): number {
  const v = values.map(x => Math.max(0, x)).sort((a, b) => a - b);
  const n = v.length, sum = v.reduce((a, b) => a + b, 0);
  if (n < 2 || sum <= 0) return 0;
  let weighted = 0;
  v.forEach((x, i) => { weighted += (i + 1) * x; });
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b), m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** Validates an integer field within a range. */
export function int(v: unknown, min: number, max: number): number | null {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : null;
}

/** Deterministic 32-bit hash (FNV-1a) for A/B buckets and stable picks. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
