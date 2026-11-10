// art.flags: a country-style flag for every company. Each company starts with a flag worked out from its id; it can
// pick its own pattern and three colours from a fixed palette (no free text, no uploads).
import type { FeatureFactory } from "../types.js";
import { hash, isInt } from "./shared.js";

export const FLAG_PATTERNS = ["Two bands", "Three bands", "Cross", "Saltire", "Canton", "Diagonal", "Border", "Disc"];
export const FLAG_COLOURS = ["Crimson", "Orange", "Gold", "White", "Black", "Navy", "Sky", "Teal", "Green", "Purple", "Rose", "Grey"];
export type Flag = [number, number, number, number];

/** The flag a company has until it picks one: varied, but two colours never the same. */
export function defaultFlag(company: number): Flag {
  const h = hash(company, 171), n = FLAG_COLOURS.length;
  const c1 = h % n, c2 = (c1 + 1 + ((h >>> 8) % (n - 1))) % n;
  let c3 = (h >>> 16) % n; if (c3 === c1 || c3 === c2) c3 = (c3 + 3) % n;
  return [(h >>> 4) % FLAG_PATTERNS.length, c1, c2, c3];
}

export const flags: FeatureFactory = (e) => {
  const custom = new Map<number, Flag>();
  const opts = (names: string[]) => names.map((label, value) => ({ value, label }));
  return {
    id: "art.flags", ideas: [171], title: "Company flags", economy: false,
    enable() { /* chosen flags persist while the module is off and back on */ },
    apply(cmd) {
      if (cmd.action !== "set") return { ok: false, error: "unknown flag action" };
      if (!e.companies.has(cmd.company)) return { ok: false, error: "no such company" };
      const { pattern, c1, c2, c3 } = cmd;
      if (!isInt(pattern, 0, FLAG_PATTERNS.length - 1)) return { ok: false, error: "choose a flag pattern" };
      for (const c of [c1, c2, c3]) if (!isInt(c, 0, FLAG_COLOURS.length - 1)) return { ok: false, error: "choose flag colours from the list" };
      if (c1 === c2) return { ok: false, error: "the first two colours must differ" };
      custom.set(cmd.company, [pattern, c1 as number, c2 as number, c3 as number]);
      return { ok: true };
    },
    cards(company) {
      const [p, a, b, c] = custom.get(company) ?? defaultFlag(company);
      return [{
        title: "Your house flag",
        detail: `Flown on your ships and your home quay: ${FLAG_PATTERNS[p].toLowerCase()} in ${FLAG_COLOURS[a].toLowerCase()}, ${FLAG_COLOURS[b].toLowerCase()} and ${FLAG_COLOURS[c].toLowerCase()}.`,
        actions: [{
          label: "Raise this flag",
          command: { type: "feature", module: "art.flags", action: "set" },
          fields: [
            { key: "pattern", label: "Pattern", value: p, options: opts(FLAG_PATTERNS) },
            { key: "c1", label: "First colour", value: a, options: opts(FLAG_COLOURS) },
            { key: "c2", label: "Second colour", value: b, options: opts(FLAG_COLOURS) },
            { key: "c3", label: "Emblem colour", value: c, options: opts(FLAG_COLOURS) },
          ],
        }],
      }];
    },
    view(company) { return { flag: custom.get(company) ?? defaultFlag(company) }; },
    /** Only flags players chose; every other company's flag is worked out on the client with the same hash. */
    world() { return { custom: Object.fromEntries(custom) }; },
  };
};
