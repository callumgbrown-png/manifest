import type { FeatureFactory } from "../types.js";
import { clientSwitch } from "./common.js";
import { bestTrade, planner } from "./planner.js";
import { autoTrade, quickSell, repeatRoute, savedRoutes } from "./routes.js";
import { alerts, dailySummary, idleShips, ledger, notifications, starterBonus, starterBonusEffects, undo } from "./tracking.js";
import { cargoManifest, dashboard, hints, presets, tutorial, watchlist } from "./guidance.js";

/** Client-only ui features: the server module is just the switch; the code is in public/features/ui.js. */
export const CLIENT_SWITCHES: FeatureFactory[] = [
  clientSwitch("ui.minimap", [150], "Minimap"),
  clientSwitch("ui.themes", [152, 440, 496], "Dark mode, theme packs and colour palettes"),
  clientSwitch("ui.mobile", [153], "Mobile-friendly controls", true),
  clientSwitch("ui.shortcuts", [154], "Keyboard shortcuts"),
  clientSwitch("ui.heatmap", [156], "Price heatmap"),
  clientSwitch("ui.tooltips", [158], "Rich tooltips"),
  clientSwitch("ui.colour-blind", [159], "Colour-blind mode"),
  clientSwitch("ui.languages", [160, 495], "Languages and community language packs"),
  clientSwitch("ui.windows", [422], "Draggable windows"),
  clientSwitch("ui.fleet-table", [428, 431, 432, 434], "Fleet table, sorting, cargo filters and fill bars"),
  clientSwitch("ui.map-nav", [429, 430], "Port search and zoom to fleet"),
  clientSwitch("ui.capture", [437, 438, 439], "Screenshot, photo and streamer modes"),
  clientSwitch("ui.wiki", [484, 500], "Glossary and in-game wiki"),
  clientSwitch("ui.tips", [485], "Loading-screen tips"),
  clientSwitch("ui.accessibility", [488, 489, 490], "Text scaling, reduced motion and screen reader labels"),
  clientSwitch("ui.input", [491, 492], "Controller and touch controls"),
  clientSwitch("ui.pwa", [493], "Installable offline-friendly app"),
  clientSwitch("ui.low-spec", [494], "Low-spec mode"),
  clientSwitch("ui.calm", [497, 498], "Calm mode and session reminders"),
];

/** Module factories for the ui category. */
export const factories: FeatureFactory[] = [
  planner, bestTrade, savedRoutes, repeatRoute, autoTrade, quickSell,
  alerts, notifications, ledger, idleShips, dailySummary, undo, starterBonus, starterBonusEffects,
  cargoManifest, watchlist, dashboard, tutorial, presets, hints,
  ...CLIENT_SWITCHES,
];
