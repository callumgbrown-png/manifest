import type { FeatureFactory } from "./types.js";
import { factories as economy } from "./economy/index.js";
import { factories as ships } from "./ships/index.js";
import { factories as ports } from "./ports/index.js";
import { factories as contracts } from "./contracts/index.js";
import { factories as world } from "./world/index.js";
import { factories as social } from "./social/index.js";
import { factories as progression } from "./progression/index.js";
import { factories as ui } from "./ui/index.js";
import { factories as art } from "./art/index.js";
import { factories as community } from "./community/index.js";
import { factories as platform } from "./platform/index.js";

/** Every category folder exports its module factories; add new categories here. */
export const FEATURE_FACTORIES: FeatureFactory[] = [
  ...economy,
  ...ships,
  ...ports,
  ...contracts,
  ...world,
  ...social,
  ...progression,
  ...ui,
  ...art,
  ...community,
  ...platform,
];
