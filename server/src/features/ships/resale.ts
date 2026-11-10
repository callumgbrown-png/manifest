// Idea 40: a ship resale market between players. List a docked, empty ship for a price; another company buys it
// outright and the ship (and everything the ships modules know about it: name, crew, fittings, logbook) changes
// hands where it lies. Money moves only between the two companies, at a price they set, so no money is made or
// destroyed. The listing lapses if the ship sails, loads cargo or is queued.
import type { Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, credits, fail, note, OK, ownShip, portName, shipField, shipName } from "./shared.js";

interface Listing { ship: number; seller: number; price: number; since: number }
/** Prices are limited to 25%..300% of the new price of the class, so the market can't be used to pass cash around. */
export const MIN_SHARE = 0.25, MAX_SHARE = 3, MAX_LISTINGS = 40;

export const resale: FeatureFactory = (e) => {
  const id = "ships.resale";
  const listings = new Map<number, Listing>();
  const sold = new Map<number, number>();   // company -> ships sold this season
  const valid = (l: Listing): string | undefined => {
    const s = e.ships.get(l.ship);
    if (!s || s.owner !== l.seller) return "the ship is no longer the seller's";
    if (s.dest !== null) return "the ship has sailed";
    if (s.qty > 0) return "the ship has cargo aboard";
    if (e.voyageQueues.has(s.id)) return "the ship has a voyage queue";
    if (e.expansionEnabled && (e.fleetExpansion.leased(s) || e.explorationExpansion.spaceTaken(s))) return "the ship is leased or carrying offshore cargo";
    return undefined;
  };
  const priceRange = (s: Ship) => { const p = e.spec(s.type).price; return [Math.ceil(p * MIN_SHARE), Math.floor(p * MAX_SHARE)] as const; };

  return {
    id, ideas: [40], title: "Second-hand ship market", economy: false,
    apply(cmd) {
      switch (cmd.action) {
        case "list": {
          const s = ownShip(e, cmd.company, cmd.ship);
          if (!s) return fail("not your ship");
          if (s.type === "pirate") return fail("pirate ships cannot be sold on the open market");
          const c = e.companies.get(cmd.company)!;
          if (c.ships.length <= 1) return fail("you must keep one ship");
          if (listings.has(s.id)) return fail("that ship is already listed");
          if (listings.size >= MAX_LISTINGS) return fail("the market is full; try again later");
          const [lo, hi] = priceRange(s);
          if (typeof cmd.price !== "number" || !Number.isInteger(cmd.price) || cmd.price < lo || cmd.price > hi) return fail(`ask between ${credits(lo)} and ${credits(hi)}`);
          const l: Listing = { ship: s.id, seller: cmd.company, price: cmd.price, since: e.tick };
          const why = valid(l);
          if (why) return fail(why);
          listings.set(s.id, l);
          note(e, s.id, `Put up for sale at ${portName(e, s.port)} for ${credits(cmd.price)}.`);
          return OK;
        }
        case "withdraw": {
          const l = typeof cmd.ship === "number" ? listings.get(cmd.ship) : undefined;
          if (!l || l.seller !== cmd.company) return fail("you have no such listing");
          listings.delete(l.ship);
          return OK;
        }
        case "buy": {
          const l = typeof cmd.ship === "number" ? listings.get(cmd.ship) : undefined;
          if (!l) return fail("that ship is no longer for sale");
          if (l.seller === cmd.company) return fail("you cannot buy your own ship");
          const why = valid(l);
          if (why) { listings.delete(l.ship); return fail(`the listing lapsed: ${why}`); }
          const buyer = e.companies.get(cmd.company)!, seller = e.companies.get(l.seller);
          const s = e.ships.get(l.ship)!;
          if (!seller) return fail("the seller has left");
          if (seller.ships.length <= 1) { listings.delete(l.ship); return fail("the seller can no longer part with that ship"); }
          if (buyer.ships.length + (e.expansionEnabled ? e.fleetExpansion.reservedSlots(buyer) : 0) >= e.rules.company.max_ships) return fail("your fleet is at its maximum");
          if (buyer.cash < l.price) return fail("not enough cash");
          // Close the seller's bookkeeping for the ship, then hand it over.
          const trip = e.openTrip(seller.id, s.id);
          if (trip) trip.open = false;
          e.maritime.removeShip(s);
          e.guildFreight.release(s.id);
          seller.ships = seller.ships.filter(i => i !== s.id);
          buyer.ships.push(s.id);
          s.owner = buyer.id;
          s.cost = 0;
          buyer.cash -= l.price;
          seller.cash += l.price;
          listings.delete(l.ship);
          sold.set(seller.id, (sold.get(seller.id) ?? 0) + 1);
          note(e, s.id, `Sold by ${seller.name} to ${buyer.name} for ${credits(l.price)}.`);
          return { ok: true, spent: l.price };
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      for (const l of [...listings.values()]) if (valid(l)) {
        listings.delete(l.ship);
        if (e.ships.has(l.ship)) note(e, l.ship, "The sale listing lapsed.");
      }
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const mine = c.ships.map(i => e.ships.get(i)).filter((s): s is Ship => !!s && s.type !== "pirate" && s.dest === null && s.qty === 0 && !listings.has(s.id));
      const forSale = [...listings.values()].filter(l => l.seller !== company);
      const myListings = [...listings.values()].filter(l => l.seller === company);
      const describe = (l: Listing) => { const s = e.ships.get(l.ship)!; return `${shipName(e, s.id)} (${s.type}) at ${portName(e, s.port)}, ${credits(l.price)} (new: ${credits(e.spec(s.type).price)})`; };
      return [{ title: "Second-hand ship market",
        detail: `Sell a docked, empty ship to another company, or buy one where it lies. Asking prices are 25% to 300% of the new price.`
          + (forSale.length ? `\nFor sale:\n${forSale.map(describe).join("\n")}` : "\nNo ships for sale right now.")
          + (myListings.length ? `\nYour listings:\n${myListings.map(describe).join("\n")}` : ""),
        actions: [
          ...(mine.length && c.ships.length > 1 ? [{ ...action(id, "List a ship for sale", "list"), fields: [shipField(e, mine), { key: "price", label: "Asking price", min: 1, value: e.spec("freighter").price }] }] : []),
          ...forSale.slice(0, 8).map(l => action(id, `Buy ${shipName(e, l.ship)} for ${credits(l.price)}`, "buy", { ship: l.ship })),
          ...myListings.map(l => action(id, `Withdraw ${shipName(e, l.ship)}`, "withdraw", { ship: l.ship })),
        ] }];
    },
    world() { return [...listings.values()].map(l => ({ ship: l.ship, price: l.price, type: e.ships.get(l.ship)?.type, port: e.ships.get(l.ship)?.port })); },
    view(company) { return { sold: sold.get(company) ?? 0 }; },
  };
};
