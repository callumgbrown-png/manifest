import type { FeatureFactory } from "../types.js";
import { chart, mapTools } from "./chart.js";
import { weather, stormClosures } from "./weather.js";
import { currentsChart, currentsEffects, icebergsModule, reefsModule, highwaysModule } from "./sea-routes.js";
import { news } from "./news.js";
import { sightings } from "./sightings.js";
import { exploration, discoveryBonus } from "./exploration.js";
import { disasters, disasterEffects } from "./disasters.js";
import { waypoints, fogOfWar, seaCharts, buoys, beacons, radarPing, ferries, licences } from "./navigation.js";
import { rescue, regatta, festivals, quarantineModule, quarantineEffects } from "./events.js";
import { marketEvents, megaOrders, conflicts, kraken, coopGoals } from "./economy-events.js";

/** Module factories for the world category (ideas 96-110, 241-260, 321-340). */
export const factories: FeatureFactory[] = [
  // switched on: content, information and visuals
  chart, mapTools, weather, currentsChart, news, sightings, exploration, disasters, waypoints, fogOfWar, buoys,
  rescue, regatta, festivals, quarantineModule,
  // switched off until Dave approves: money, prices, fees or travel time
  stormClosures, currentsEffects, icebergsModule, reefsModule, highwaysModule, marketEvents, megaOrders, conflicts,
  kraken, coopGoals, seaCharts, beacons, radarPing, discoveryBonus, ferries, licences, disasterEffects, quarantineEffects,
];
