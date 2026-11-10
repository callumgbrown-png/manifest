import type { FeatureFactory } from "../types.js";
import { docks } from "./docks.js";
import { cranes, harbourEffects } from "./cranes.js";
import { ownership } from "./ownership.js";
import { fuelStations, shipyards, repairYards } from "./fuel-yards.js";
import { customs, customsQueue } from "./customs.js";
import { projects, projectEffects } from "./projects.js";
import { reputation } from "./reputation.js";
import { festivals, festivalEffects } from "./festivals.js";
import { strikes } from "./strikes.js";
import { airfreight, airfreightEffects } from "./airfreight.js";
import { warehouses, fishMarket, rumours } from "./market-services.js";
import { tavern, stalls, chandlery, cruise } from "./town.js";
import { bank, bankEffects, insuranceOffice } from "./services.js";
import { weatherStation, shipbreaking, navalBase, research, museum, skyline } from "./institutions.js";
import { minigames } from "./minigames.js";

/** Module factories for the ports category (ideas 41-60 and 261-280). */
export const factories: FeatureFactory[] = [
  docks, cranes, harbourEffects, ownership, fuelStations, shipyards, repairYards, customs, customsQueue,
  projects, projectEffects, reputation, festivals, festivalEffects, strikes, airfreight, airfreightEffects,
  warehouses, fishMarket, rumours, tavern, stalls, chandlery, cruise, bank, bankEffects, insuranceOffice,
  weatherStation, shipbreaking, navalBase, research, museum, skyline, minigames,
];
