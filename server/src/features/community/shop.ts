// Economy (off until approved): buy cosmetics and cosmetic packs with in-game credits (ideas 173, 179, 180, 501-508).
// The credits leave the game, which is a money sink, so this ships switched off. Prices are in cosmetics.json.
import type { FeatureFactory } from "../types.js";
import { getCatalogue } from "./content.js";
import { action, fail } from "./shared.js";
import { grant, owns } from "./store.js";

export const shopModule: FeatureFactory = (e) => {
  const id = "community.shop";
  const spent = new Map<number, number>();
  const forSale = () => [
    ...[...getCatalogue().items.values()].filter(i => i.source === "shop").map(i => ({ id: i.id, name: i.name, price: i.price!, items: [i.id] })),
    ...[...getCatalogue().packs.values()].filter(p => p.source === "shop").map(p => ({ id: p.id, name: p.name, price: p.price!, items: p.items })),
  ];
  return {
    id, ideas: [173, 179, 180, 501, 502, 503, 504, 505, 506, 507, 508], title: "Cosmetic shop", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      const offer = typeof cmd.item === "string" ? forSale().find(o => o.id === cmd.item) : undefined;
      if (!offer) return fail("that is not for sale");
      if (offer.items.every(i => owns(e, cmd.company, i))) return fail("you already own that");
      const c = e.companies.get(cmd.company)!;
      if (c.cash < offer.price) return fail("not enough cash");
      c.cash -= offer.price;
      spent.set(c.id, (spent.get(c.id) ?? 0) + offer.price);
      grant(e, c.id, offer.id);
      return { ok: true, spent: offer.price };
    },
    cards(company) {
      const offers = forSale().filter(o => !o.items.every(i => owns(e, company, i)));
      if (!offers.length) return [];
      return [{ title: "Cosmetic shop", detail: "Looks only: nothing here changes how a ship sails or trades.",
        actions: [{ ...action(id, "Buy", "buy"), fields: [{ key: "item", label: "Item", options: offers.map(o => ({ value: o.id, label: `${o.name} (${o.price.toLocaleString("en-GB")})` })) }] }] }];
    },
    view(company) { return { spent: spent.get(company) ?? 0 }; },
  };
};
