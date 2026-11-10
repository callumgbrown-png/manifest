import type { FeatureFactory } from "../types.js";
import { courtsModule, lawsModule, licencesModule, mayorsModule, newspapersModule, pollsModule } from "./civic.js";
import { alliancesModule, bankModule, communityFundModule, finesModule, guildContractsModule, hireCaptainsModule, lighthouseModule, namingAuctionsModule,
  newsFeedModule, piracyLawsModule, regionalChatModule, rivalriesModule, rolesModule, sharesModule, signalsModule, spectatorModule, taxVotesModule,
  treasuryModule, treatiesModule, warehouseModule, warsModule } from "./economy.js";
import { formationsModule, guildContestsModule, guildPortsModule, hallOfFameModule, hqModule, missionsModule, reputationModule, sharedFleetModule } from "./guild-life.js";
import { guildChatModule, guildsModule, recruitmentModule } from "./guilds.js";
import { auctionsModule, friendsModule, ledgerModule, megaprojectEffectsModule, megaprojectsModule, mentorsModule, shippingLinesModule, tradeWindowModule,
  whistleblowerModule } from "./players.js";

/** Module factories for the social category. */
export const factories: FeatureFactory[] = [
  // on
  guildsModule, guildChatModule, recruitmentModule, hqModule, guildPortsModule, guildContestsModule, missionsModule, formationsModule, sharedFleetModule,
  hallOfFameModule, reputationModule, tradeWindowModule, auctionsModule, friendsModule, mentorsModule, megaprojectsModule, shippingLinesModule,
  ledgerModule, whistleblowerModule, mayorsModule, lawsModule, courtsModule, licencesModule, newspapersModule, pollsModule,
  // off (economy)
  treasuryModule, rolesModule, bankModule, sharesModule, guildContractsModule, warehouseModule, warsModule, alliancesModule, rivalriesModule,
  regionalChatModule, signalsModule, spectatorModule, newsFeedModule, hireCaptainsModule, taxVotesModule, piracyLawsModule, treatiesModule, finesModule,
  lighthouseModule, namingAuctionsModule, communityFundModule, megaprojectEffectsModule,
];
