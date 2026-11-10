import type { FeatureFactory } from "../types.js";
import { priceHistory, priceTicker, demandCurves, saturation, rumours, crashes, priceCaps } from "./market.js";
import { bulkDiscounts, blackMarket, futures, warehouses, speculation } from "./trading.js";
import { tariffs, embargoes, currencies, tolls, freightRates, backhaul, emptyLegs, subsidies } from "./lanes.js";
import { cartels, antitrust, wealthTax, moneySinks } from "./policy.js";
import { loans, safetyNet } from "./finance.js";
import { harvests, depletion, oilOutput, qualityGrades, brandedGoods, manufacturing, recycling, spoilage } from "./production.js";
import { chainFactories } from "./chains.js";
import { cargoFactories } from "./cargo.js";

/** Module factories for the economy category (ideas 1-20, 201-220 and 281-300). */
export const factories: FeatureFactory[] = [
  priceHistory, priceTicker, demandCurves, saturation, rumours, crashes, priceCaps,
  bulkDiscounts, blackMarket, futures, warehouses, speculation,
  tariffs, embargoes, currencies, tolls, freightRates, backhaul, emptyLegs, subsidies,
  cartels, antitrust, wealthTax, moneySinks,
  loans, safetyNet,
  harvests, depletion, oilOutput, qualityGrades, brandedGoods, manufacturing, recycling, spoilage,
  ...chainFactories,
  ...cargoFactories,
];
