import type { FeatureFactory } from "../types.js";
import { headlines } from "./shared.js";

export const TICKER_SIZE = 12;

/** Idea 110: a global news ticker. Every switched-on world module can add headlines (shared.addNews);
 *  this module collects those already published and sends the latest to every client. */
export const news: FeatureFactory = (e) => {
  const latest = () => headlines(e).filter(h => h.tick <= e.tick).slice(0, TICKER_SIZE);
  return {
    id: "world.news", ideas: [110], title: "News ticker", economy: false,
    world: () => ({ headlines: latest() }),
    cards() {
      const h = latest().slice(0, 5);
      return [{ title: "Latest news", detail: h.length ? h.map(x => `• ${x.text}`).join("\n") : "A quiet day on the water." }];
    },
  };
};
