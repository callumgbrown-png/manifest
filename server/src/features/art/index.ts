import type { FeatureFactory } from "../types.js";
import { scene } from "./scene.js";
import { portlife } from "./portlife.js";
import { flags } from "./flags.js";
import { combat } from "./combat.js";
import { music, sound } from "./audio.js";
import { news } from "./news.js";
import { lore, relics } from "./lore.js";
import { diary, chatter } from "./voices.js";
import { mystery, rivals, legend } from "./quests.js";
import { eggs, cameo } from "./eggs.js";

/** Module factories for the art category (ideas 161-172 and 441-480). Drawing and sound are in public/features/art.js. */
export const factories: FeatureFactory[] = [
  scene, portlife, flags, combat, music, sound, news, lore, relics, diary, chatter, mystery, rivals, legend, eggs, cameo,
];
