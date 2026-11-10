import type { FeatureFactory } from "../types.js";
import { auctions, board, community, exclusive, government, latePenalty, milkRun, passengers, relief, rush, storyChains, timed } from "./delivery.js";
import { escortMissions, salvage, smuggling } from "./jobs.js";
import { ambush, bounties, cargoInsurance, convoys, deckGuns, escortHire, newsLedger, pirateZoneModule, ransom } from "./pirates.js";
import {
  blackFlag, blockade, bribes, coastGuard, coastGuardEffects, fakeDistress, hideoutModule, inspections, pardon, patrols, pirateBoss, wanted,
} from "./law.js";
import {
  ghostShip, guild, inspectors, journalists, legends, mayors, mechanics, mechanicsEffects, namedPiratesModule, navy, npcTrafficModule, oldCaptain,
  rivalAi, rivalCompanies, stranger, syndicate, travellingMerchants, tribes, wanderingTrader,
} from "./npcs.js";

/** Module factories for the contracts category (ideas 61-95 and 301-320). Order matters only where one module reads
 *  state another sets in the same hour: convoys and escorts before ambushes, ambushes before cargo insurance. */
export const factories: FeatureFactory[] = [
  // 61-70, 73, 75: delivery contracts
  timed, rush, milkRun, community, relief, government, exclusive, storyChains, board, latePenalty, passengers, auctions,
  // 71, 72, 74: voyage jobs
  escortMissions, smuggling, salvage,
  // 76-82, 84, 93: pirates and protection
  pirateZoneModule, convoys, escortHire, deckGuns, ambush, ransom, cargoInsurance, bounties, newsLedger,
  // 83, 85-92, 94, 95: law
  blackFlag, wanted, patrols, inspections, bribes, hideoutModule, pirateBoss, fakeDistress, coastGuard, coastGuardEffects, pardon, blockade,
  // 301-320: NPCs
  rivalCompanies, guild, syndicate, navy, tribes, wanderingTrader, ghostShip, npcTrafficModule, oldCaptain, rivalAi, namedPiratesModule,
  legends, mayors, journalists, inspectors, mechanics, mechanicsEffects, travellingMerchants, stranger,
];
