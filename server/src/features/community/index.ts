import type { FeatureFactory } from "../types.js";
import { codesModule } from "./codes.js";
import { linksModule } from "./links.js";
import { lockerModule } from "./locker.js";
import { dedicationsModule, namingModule } from "./naming.js";
import { referralsModule } from "./referrals.js";
import { seasonalModule } from "./seasonal.js";
import { shareModule } from "./share.js";
import { shopModule } from "./shop.js";
import { speedrunsModule } from "./speedruns.js";
import { statsModule } from "./stats.js";
import { testersModule } from "./testers.js";
import { wikiModule } from "./wiki.js";

/** Module factories for the community category. */
export const factories: FeatureFactory[] = [
  lockerModule, codesModule, seasonalModule, shopModule, dedicationsModule, namingModule, shareModule, statsModule,
  speedrunsModule, testersModule, referralsModule, wikiModule, linksModule,
];
