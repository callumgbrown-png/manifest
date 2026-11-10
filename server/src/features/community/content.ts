// Shared content for the community modules: the cosmetic catalogue, unlock codes, public links and the name filter.
// Files are read once (lazily) from config/; tests can swap them with useContent().
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CONTENT = join(ROOT, "config", "content", "community");

export const SLOTS = ["skin", "pattern", "funnel", "flag", "logo", "banner", "crane", "plate", "wake", "horn", "badge"] as const;
export type Slot = (typeof SLOTS)[number];
export type Source = "free" | "shop" | "code" | "seasonal" | "limited" | "reward" | "pennant";
const SOURCES: Source[] = ["free", "shop", "code", "seasonal", "limited", "reward", "pennant"];

export interface Item {
  id: string; slot: Slot; name: string; colors: string[]; style?: string; source: Source;
  price?: number; days?: [number, number]; limit?: number;
}
export interface Pack { id: string; name: string; items: string[]; source: Source; price?: number }
export interface CodeEntry { label: string; salt: string; hash: string; grants: string[]; uses: number }
export interface Catalogue { items: Map<string, Item>; packs: Map<string, Pack> }

const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z]+\.[a-z0-9-]{1,40}$/;

function readJson(file: string): any {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** Checks and indexes a catalogue; bad entries are dropped (and reported once) rather than crashing the server. */
export function buildCatalogue(raw: any): Catalogue {
  const items = new Map<string, Item>(), packs = new Map<string, Pack>();
  for (const it of Array.isArray(raw?.items) ? raw.items : []) {
    const ok = it && ID.test(it.id) && SLOTS.includes(it.slot) && typeof it.name === "string" && SOURCES.includes(it.source)
      && Array.isArray(it.colors) && it.colors.length > 0 && it.colors.every((c: unknown) => typeof c === "string" && HEX.test(c))
      && (it.source !== "shop" || (Number.isInteger(it.price) && it.price > 0))
      && (!["seasonal", "limited"].includes(it.source) || (Array.isArray(it.days) && it.days.length === 2 && it.days.every(Number.isInteger)))
      && (it.source !== "limited" || (Number.isInteger(it.limit) && it.limit > 0));
    if (!ok || items.has(it.id)) { console.warn(`community: skipped cosmetic ${JSON.stringify(it?.id)}`); continue; }
    items.set(it.id, { id: it.id, slot: it.slot, name: it.name.slice(0, 40), colors: it.colors, style: it.style, source: it.source,
      price: it.price, days: it.days, limit: it.limit });
  }
  for (const p of Array.isArray(raw?.packs) ? raw.packs : []) {
    const ok = p && ID.test(p.id) && typeof p.name === "string" && ["shop", "code", "pennant"].includes(p.source)
      && Array.isArray(p.items) && p.items.length > 0 && p.items.every((id: string) => items.has(id))
      && (p.source !== "shop" || (Number.isInteger(p.price) && p.price > 0));
    if (!ok || packs.has(p.id) || items.has(p.id)) { console.warn(`community: skipped pack ${JSON.stringify(p?.id)}`); continue; }
    packs.set(p.id, { id: p.id, name: p.name.slice(0, 40), items: [...p.items], source: p.source, price: p.price });
  }
  return { items, packs };
}

/** A code grant is "item:<id>", "pack:<id>", "naming:<1-5>" or "points:<1-20>". */
export function validGrant(grant: unknown, cat: Catalogue): boolean {
  if (typeof grant !== "string") return false;
  const [kind, value] = grant.split(":");
  if (kind === "item") return cat.items.has(value);
  if (kind === "pack") return cat.packs.has(value);
  const n = Number(value);
  if (kind === "naming") return Number.isInteger(n) && n >= 1 && n <= 5;
  if (kind === "points") return Number.isInteger(n) && n >= 1 && n <= 20;
  return false;
}

export function buildCodes(raw: any, cat: Catalogue): CodeEntry[] {
  const out: CodeEntry[] = [];
  for (const c of Array.isArray(raw?.codes) ? raw.codes : []) {
    const ok = c && /^[0-9a-f]{16,64}$/.test(c.salt) && /^[0-9a-f]{64}$/.test(c.hash) && Number.isInteger(c.uses) && c.uses >= 1
      && Array.isArray(c.grants) && c.grants.length > 0 && c.grants.every((g: unknown) => validGrant(g, cat));
    if (!ok) { console.warn("community: skipped an unlock code entry with bad fields"); continue; }
    out.push({ label: String(c.label ?? "").slice(0, 40), salt: c.salt, hash: c.hash, grants: [...c.grants], uses: c.uses });
  }
  return out;
}

let catalogue: Catalogue | null = null;
let codes: CodeEntry[] | null = null;
let links: Record<string, string> | null = null;

export function getCatalogue(): Catalogue {
  return catalogue ??= buildCatalogue(readJson(join(CONTENT, "cosmetics.json")));
}
export function getCodes(): CodeEntry[] {
  return codes ??= buildCodes(readJson(join(CONTENT, "codes.json")), getCatalogue());
}
/** Non-empty https links from config/links.json (anything else is ignored). */
export function getLinks(): Record<string, string> {
  if (links) return links;
  const raw = readJson(join(ROOT, "config", "links.json"));
  links = {};
  for (const [k, v] of Object.entries(raw)) if (!k.startsWith("_") && typeof v === "string" && /^https:\/\/[^\s"<>]{3,200}$/.test(v)) links[k] = v;
  return links;
}

/** Tests: replace the loaded content (pass undefined to keep a part). */
export function useContent(next: { cosmetics?: unknown; codes?: unknown; links?: Record<string, string> }) {
  if (next.cosmetics !== undefined) { catalogue = buildCatalogue(next.cosmetics); codes = null; }
  if (next.codes !== undefined) codes = buildCodes(next.codes, getCatalogue());
  if (next.links !== undefined) links = next.links;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** What the browser sends for a code: never the code itself. Must match community.js (codeProof). */
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const codeProof = (code: string) => sha256(`manifest-code-v1:${normaliseCode(code)}`);
export const storedHash = (salt: string, proof: string) => sha256(`${salt}:${proof}`);

// ------------------------------------------------------------ player-written names

const BLOCKED = [
  // Substrings, so keep them specific: short words like "sex" would block Essex.
  "fuck", "shit", "cunt", "bitch", "whore", "slut", "nigg", "faggot", "retard", "rapist", "nazi", "hitler", "kike",
  "chink", "tranny", "pussy", "penis", "vagina", "porn", "suicide", "killyourself",
  "admin", "moderator", "official", "staff", "http", "www", "discordgg", "dotcom",
];
/** Cleans a player-written name: 2-20 letters, digits, spaces and ' - . &; no links, number strings or blocked words. */
export function cleanName(raw: unknown, max = 20): string | null {
  if (typeof raw !== "string" || raw.length > 80) return null;
  const name = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > max || !/^[A-Za-z0-9 '.&-]+$/.test(name)) return null;
  if (/\d{5,}/.test(name.replace(/[ .-]/g, ""))) return null;
  const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (/\.(com|net|org|gg|io|xyz)\b/i.test(name) || BLOCKED.some(w => squashed.includes(w))) return null;
  return name;
}

/** Cleans a short player-written sentence (wiki tips): 8-140 characters, ordinary punctuation, same blocked words,
 *  no links, e-mail addresses or long digit strings (phone numbers). */
export function cleanText(raw: unknown, max = 140): string | null {
  if (typeof raw !== "string" || raw.length > 400) return null;
  const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > max || !/^[A-Za-z0-9 '.,!?:;()&%+\-/]+$/.test(text)) return null;
  if (/\d{6,}/.test(text.replace(/[ .\-()+/]/g, ""))) return null;
  if (/[a-z0-9]\.(com|net|org|gg|io|xyz|co|uk)\b/i.test(text)) return null;
  const squashed = text.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  const words = BLOCKED.filter(w => !["admin", "moderator", "official", "staff"].includes(w));   // fine inside a tip
  return words.some(w => squashed.includes(w)) ? null : text;
}
