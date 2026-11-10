// Ideas 32 and 33: name your ships and paint them. Cosmetic only.
import type { FeatureFactory, FeatureModule } from "../types.js";
import { action, fail, OK, ownShip, prune, shipField } from "./shared.js";

export const PAINTS = ["#c0392b", "#e67e22", "#f1c40f", "#27ae60", "#16a085", "#2980b9", "#8e44ad", "#ecf0f1", "#2c3e50", "#7f4f24"] as const;
const PAINT_NAMES = ["Signal red", "Harbour orange", "Buoy yellow", "Kelp green", "Teal", "Navy blue", "Royal purple", "Gull white", "Night", "Teak"];
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "faggot", "rape", "nazi", "hitler", "whore", "slut", "bitch", "http", "www"];
/** Ready-made names for the Opportunities card (the fleet panel also takes typed names). */
export const NAME_IDEAS = ["Sea Lark", "Northern Star", "Saltwind", "Iron Gull", "Lucky Penny", "Morning Tide", "Old Faithful",
  "Harbour Queen", "Steady Hand", "Grey Heron", "Swift Current", "Copper Kettle"];

/** Trims, squeezes spaces and checks a ship name. Returns the clean name or an error. */
export function cleanName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== "string") return { error: "enter a name" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 24) return { error: "names are 2 to 24 characters" };
  if (!/^[A-Za-z0-9 .'\-]+$/.test(name)) return { error: "use letters, digits, spaces, dots, dashes and apostrophes" };
  const flat = name.toLowerCase().replace(/[^a-z]/g, "");
  if (BLOCKED.some(w => flat.includes(w))) return { error: "please choose another name" };
  if (/\d{6,}/.test(name)) return { error: "please choose another name" };
  return { name };
}

export const identity: FeatureFactory = (e) => {
  const names = new Map<number, string>();
  const paints = new Map<number, number>();
  const id = "ships.identity";
  const mod: FeatureModule & { nameOf(ship: number): string | undefined } = {
    id, ideas: [32, 33], title: "Ship names and paint", economy: false,
    nameOf: (ship) => names.get(ship),
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("not your ship");
      if (cmd.action === "rename") {
        const r = cleanName(cmd.name);
        if ("error" in r) return fail(r.error);
        for (const [other, n] of names) if (other !== s.id && e.ships.get(other)?.owner === s.owner && n.toLowerCase() === r.name.toLowerCase())
          return fail("another of your ships has that name");
        names.set(s.id, r.name);
        return OK;
      }
      if (cmd.action === "paint") {
        if (typeof cmd.paint !== "number" || !Number.isInteger(cmd.paint) || cmd.paint < 0 || cmd.paint >= PAINTS.length) return fail("choose a paint colour");
        paints.set(s.id, cmd.paint);
        return OK;
      }
      return fail("unknown action");
    },
    advance() { if (e.tick % 24 === 0) { prune(e, names); prune(e, paints); } },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const ships = c.ships.map(i => e.ships.get(i)!).filter(Boolean);
      if (!ships.length) return [];
      return [{ title: "Name and paint your ships", detail: "Names show on the map and in each ship's logbook. Colours are cosmetic.",
        actions: [
          { ...action(id, "Rename", "rename"), fields: [shipField(e, ships), { key: "name", label: "Name (type your own in the Fleet tab)", options: NAME_IDEAS.map(n => ({ value: n, label: n })) }] },
          { ...action(id, "Paint", "paint"), fields: [shipField(e, ships), { key: "paint", label: "Colour", options: PAINTS.map((_, i) => ({ value: i, label: PAINT_NAMES[i] })) }] },
        ] }];
    },
    world() {
      const out: Record<number, [string | null, string | null]> = {};
      for (const s of e.ships.values()) {
        const n = names.get(s.id), p = paints.get(s.id);
        if (n !== undefined || p !== undefined) out[s.id] = [n ?? null, p === undefined ? null : PAINTS[p]];
      }
      return out;
    },
  };
  return mod;
};
