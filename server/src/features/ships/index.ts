import type { FeatureFactory } from "../types.js";
import { identity } from "./identity.js";
import { wear } from "./wear.js";
import { crew } from "./crew.js";
import { crewEffects } from "./crew-effects.js";
import { incidents } from "./incidents.js";
import { logbook } from "./logbook.js";
import { radar } from "./radar.js";
import { wrecks } from "./wrecks.js";
import { fittings, fittingsEffects } from "./fittings.js";
import { variants, variantsEffects } from "./variants.js";
import { tugs } from "./tugs.js";
import { captains } from "./captains.js";
import { resale } from "./resale.js";
import { insurance, towing } from "./insurance.js";
import { throttle, slipstream, overloading } from "./handling.js";
import { draft, draftEffects } from "./draft.js";
import { age } from "./age.js";

/** Module factories for the ships category (ideas 21-40 and 221-240). */
export const factories: FeatureFactory[] = [
  identity, wear, crew, crewEffects, incidents, logbook, radar, wrecks,
  fittings, fittingsEffects, variants, variantsEffects, tugs, captains, resale,
  insurance, towing, throttle, slipstream, overloading, draft, draftEffects, age,
];
