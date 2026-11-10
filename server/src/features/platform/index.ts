import type { FeatureFactory } from "../types.js";
import { activityWatch, anomalies, audit, fairPlay, multiAccount } from "./integrity.js";
import { bugReport, chatSafety, playerReports } from "./moderation.js";
import { catchUp, newbieZones, pirateShield, wealthLimits } from "./protection.js";
import { botReports, churn, economyHealth, routeHeatmap, telemetry } from "./analytics.js";
import { adminConsole, checkpoints, debugOverlay, experiments, selfTestModule } from "./ops.js";
import { personas } from "./personas.js";
import { dragon, exoticCraft, exoticCraftEffects, fleetBattles, mysteryPlaces, spaceShipping, timeRifts } from "./wonders.js";
import { playerContracts } from "./player-contracts.js";

/** Module factories for the platform category (ideas 196-200 and 551-600). */
export const factories: FeatureFactory[] = [
  // integrity and moderation
  audit, anomalies, multiAccount, activityWatch, fairPlay, bugReport, playerReports, chatSafety,
  // protection and balance
  newbieZones, pirateShield, catchUp, wealthLimits,
  // analytics and operations
  economyHealth, churn, routeHeatmap, telemetry, botReports, experiments, checkpoints, selfTestModule, adminConsole, debugOverlay, personas,
  // far-out content
  exoticCraft, exoticCraftEffects, spaceShipping, mysteryPlaces, timeRifts, dragon, fleetBattles, playerContracts,
];
