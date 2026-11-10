// Ideas 173, 174, 179, 180, 501-508: the cosmetic locker. Ship skins, hull patterns, funnels, company flags and
// logos, port banners, crane skins, name plates, wake colours and horn sounds. Free items are owned by everyone;
// others come from unlock codes, seasons, rewards or (if switched on) the credit shop. Cosmetics never change stats.
// Idea 174 builds on the game's company pennant: owning it unlocks the Admiralty flag and funnel.
import type { FeatureFactory } from "../types.js";
import { getCatalogue, SLOTS, type Slot } from "./content.js";
import { action, fail, OK } from "./shared.js";
import { grant, itemData, locker, owns, peek, store } from "./store.js";

const SLOT_NAMES: Record<Slot, string> = { skin: "Ship skin", pattern: "Hull pattern", funnel: "Funnel", flag: "Company flag",
  logo: "Company logo", banner: "Port banner", crane: "Crane skin", plate: "Name plate", wake: "Wake", horn: "Horn", badge: "Badge" };

export const lockerModule: FeatureFactory = (e) => {
  const id = "community.locker";
  const hasPennant = (company: number) => {
    const c = e.companies.get(company);
    return !!c && !!(e.maritime.view(c) as { pennant?: boolean } | undefined)?.pennant;
  };
  const ownedIds = (company: number) => [...getCatalogue().items.values()].filter(it => owns(e, company, it.id)).map(it => it.id);
  return {
    id, ideas: [173, 174, 179, 180, 501, 502, 503, 504, 505, 506, 507, 508], title: "Cosmetic locker", economy: false,
    apply(cmd) {
      if (cmd.action === "equip") {
        if (typeof cmd.slot !== "string" || !(SLOTS as readonly string[]).includes(cmd.slot)) return fail("unknown slot");
        const slot = cmd.slot as Slot;
        if (cmd.item === "none") { delete locker(e, cmd.company).equipped[slot]; return OK; }
        if (typeof cmd.item !== "string") return fail("choose an item");
        const it = getCatalogue().items.get(cmd.item);
        if (!it || it.slot !== slot) return fail("that item does not fit that slot");
        if (!owns(e, cmd.company, it.id)) return fail("you have not unlocked that item");
        locker(e, cmd.company).equipped[slot] = it.id;
        return OK;
      }
      if (cmd.action === "claimPennant") {
        if (!hasPennant(cmd.company)) return fail("buy the company pennant first");
        const fresh = grant(e, cmd.company, "pack.admiralty");
        return fresh.length ? OK : fail("you already have the Admiralty colours");
      }
      return fail("unknown action");
    },
    cards(company) {
      const mine = ownedIds(company), l = peek(e, company), cat = getCatalogue();
      const actions = SLOTS.filter(slot => mine.some(i => cat.items.get(i)!.slot === slot)).map(slot => ({
        ...action(id, `Set ${SLOT_NAMES[slot].toLowerCase()}`, "equip", { slot }),
        fields: [{ key: "item", label: SLOT_NAMES[slot], value: l.equipped[slot] ?? "none",
          options: [{ value: "none", label: "Default" }, ...mine.filter(i => cat.items.get(i)!.slot === slot).map(i => ({ value: i, label: cat.items.get(i)!.name }))] }],
      }));
      const pennant = hasPennant(company) && !l.owned.has("flag.admiralty");
      return [{ title: "Cosmetic locker",
        detail: `Cosmetics change only how your company looks. You own ${mine.length} of ${cat.items.size} items.`
          + (pennant ? "\nYour company pennant entitles you to the Admiralty flag and funnel." : ""),
        actions: [...actions, ...(pennant ? [action(id, "Claim Admiralty colours", "claimPennant")] : [])] }];
    },
    view(company) {
      const l = peek(e, company);
      return { owned: ownedIds(company), equipped: { ...l.equipped }, naming: l.naming, points: l.points };
    },
    world() {
      const out: Record<number, Record<string, unknown>> = {};
      for (const [company, l] of store(e).lockers) {
        if (!e.companies.has(company)) continue;
        const slots = Object.entries(l.equipped).map(([slot, item]) => [slot, itemData(item!)]).filter(([, d]) => d);
        if (slots.length) out[company] = Object.fromEntries(slots);
      }
      return out;
    },
  };
};
