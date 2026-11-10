import type { FeatureFactory } from "../types.js";
import {
  achievementRewards, achievements, captainLevels, collectionBook, hallOfFame, rankLadder, skins, statsDashboard, titlePerks, titles, trophyRoom,
} from "./career.js";
import { challenges, coopCampaign, dailyQuests, dailyRoute, puzzles, seasonTrack, tutorial, weeklyGoals } from "./goals.js";
import { blitz, seasonalLadder, seasons, tournaments, weeklyLeaderboards } from "./competition.js";
import {
  cargoMastery, dailyLogin, heirlooms, legacy, licenceFines, licences, offlineProgress, prestige, remoteIslands, routeMastery, skillPoints,
  techBonuses, techTree, veteranPerks,
} from "./unlocks.js";
import { mapSharing, mods, newGamePlus, runModes, sandboxFunds, worldPresets } from "./modes.js";

/** Module factories for the progression category (ideas 131-145 and 381-420). Run modes come first so a hardcore run
 *  that ends this hour stops progression before the goal modules award anything; rewards that read earned
 *  achievements come after achievements. */
export const factories: FeatureFactory[] = [
  runModes, sandboxFunds, newGamePlus,
  captainLevels, rankLadder, statsDashboard, collectionBook, achievements, achievementRewards, titles, titlePerks, skins, trophyRoom, hallOfFame,
  dailyQuests, weeklyGoals, tutorial, seasonTrack, dailyRoute, puzzles, challenges, coopCampaign,
  weeklyLeaderboards, seasonalLadder, seasons, tournaments, blitz,
  techTree, techBonuses, licences, licenceFines, remoteIslands, skillPoints, cargoMastery, routeMastery, veteranPerks, heirlooms, legacy,
  prestige, dailyLogin, offlineProgress,
  worldPresets, mapSharing, mods,
];
