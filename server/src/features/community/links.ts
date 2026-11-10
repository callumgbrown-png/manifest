// Ideas 177, 178, 181, 182, 193: the Community panel's links (itch.io pay-what-you-want download, tip jar, soundtrack,
// sprite packs, itch.io page, Discord and the rest), read from config/links.json. Payment happens on those sites; a
// buyer gets an unlock code for the matching cosmetic pack (community.codes). Empty links are hidden.
import type { FeatureFactory } from "../types.js";
import { getLinks } from "./content.js";

export const LABELS: Record<string, string> = {
  game: "Play in the browser", discord: "Discord", youtube: "YouTube", tiktok: "TikTok", reddit: "Subreddit", itch: "itch.io page",
  itchPayWhatYouWant: "Download (pay what you want)", tipJar: "Tip jar", supporterPack: "Supporter pack", soundtrack: "Soundtrack",
  spritePacks: "Sprite packs", pressKit: "Press kit", roadmap: "Roadmap voting", wiki: "Wiki",
};

export const linksModule: FeatureFactory = () => ({
  id: "community.links", ideas: [177, 178, 181, 182, 193], title: "Community links", economy: false,
  world() {
    return Object.entries(getLinks()).filter(([k]) => LABELS[k]).map(([k, url]) => ({ key: k, label: LABELS[k], url }));
  },
});
