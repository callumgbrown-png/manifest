// Ideas 509, 511: seasonal skins (free to claim during their season days) and limited-run skins (free during their
// days, for the first N companies only). Days come from config/content/community/cosmetics.json.
import type { FeatureFactory } from "../types.js";
import { getCatalogue, type Item } from "./content.js";
import { action, day, fail, OK } from "./shared.js";
import { grant, owns, store } from "./store.js";

export const seasonalModule: FeatureFactory = (e) => {
  const id = "community.seasonal";
  const open = (): Item[] => {
    const d = day(e);
    return [...getCatalogue().items.values()].filter(it => (it.source === "seasonal" || it.source === "limited") && it.days && d >= it.days[0] && d <= it.days[1]);
  };
  const left = (it: Item) => it.source === "limited" ? Math.max(0, it.limit! - (store(e).limitedClaims.get(it.id) ?? 0)) : null;
  return {
    id, ideas: [509, 511], title: "Seasonal and limited cosmetics", economy: false,
    apply(cmd) {
      if (cmd.action !== "claim") return fail("unknown action");
      if (typeof cmd.item !== "string") return fail("choose an item");
      const it = open().find(i => i.id === cmd.item);
      if (!it) return fail("that item cannot be claimed today");
      if (owns(e, cmd.company, it.id)) return fail("you already have it");
      if (it.source === "limited") {
        if (left(it) === 0) return fail("all of that limited run has been claimed");
        store(e).limitedClaims.set(it.id, (store(e).limitedClaims.get(it.id) ?? 0) + 1);
      }
      grant(e, cmd.company, it.id);
      return OK;
    },
    cards(company) {
      const items = open().filter(it => !owns(e, company, it.id) && left(it) !== 0);
      if (!items.length) return [];
      return [{ title: "Claim seasonal cosmetics", detail: items.map(it =>
        `${it.name}: free until day ${it.days![1]}${it.source === "limited" ? ` (${left(it)} of ${it.limit} left)` : ""}`).join("\n"),
        actions: items.map(it => action(id, `Claim ${it.name}`, "claim", { item: it.id })) }];
    },
    world() {
      return open().map(it => ({ id: it.id, name: it.name, until: it.days![1], left: left(it) }));
    },
  };
};
