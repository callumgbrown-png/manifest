import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { addNews, calendar, clock, regionOf, regions, slotsBetween, voyagePoly, polyNear } from "./shared.js";
import { ECLIPSE_SPEC, stormDelay, tideNow, visibleWeather, whirlpools } from "./weather-model.js";

/** Weather you can see: storms, hurricanes with a day's warning, fog banks, whirlpools, tides, eclipses,
 *  the time of day and the season. Information and visuals only; storm delays are world.storm-closures. */
export const weather: FeatureFactory = (e) => {
  const id = "world.weather";
  const regionName = (p: { x: number; y: number }) => regions(e)[regionOf(e, p)]?.name ?? "open sea";
  const eclipse = () => slotsBetween(ECLIPSE_SPEC, e.tick, e.tick + 25)[0];
  addNews(e, id, () => {
    const out = visibleWeather(e).filter(w => w.kind !== "fog").map(w => ({ tick: w.warnFrom, kind: "weather",
      text: `${w.kind === "hurricane" ? "Hurricane warning" : "Storm warning"} for ${regionName(w)}: ${clock(w.starts)} to ${clock(w.ends)}.` }));
    const ec = eclipse();
    if (ec) out.push({ tick: Math.max(0, ec.starts - 24), kind: "sky", text: `Eclipse expected ${clock(ec.starts)}. Look up from the bridge.` });
    const tide = tideNow(e).extreme;
    if (tide) out.push({ tick: tide.starts, kind: "sea", text: `Spring tides: extreme highs and lows until ${clock(tide.ends)}.` });
    return out;
  });
  return {
    id, ideas: [97, 99, 101, 102, 103, 254, 333, 334], title: "Weather and sky", economy: false,
    world() {
      const cal = calendar(e), ec = eclipse();
      return {
        ...cal, weather: visibleWeather(e), whirlpools: whirlpools(e), tide: tideNow(e),
        eclipse: ec ? { starts: ec.starts, ends: ec.ends, active: ec.starts <= e.tick } : null,
        closures: e.features.enabled("world.storm-closures"),
      };
    },
    view(company) {
      const c = e.companies.get(company);
      if (!c) return undefined;
      const storms = visibleWeather(e).filter(w => w.kind !== "fog");
      const ships = c.ships.map(sid => e.ships.get(sid)!).filter(s => s.dest !== null).map(s => {
        const track = voyagePoly(e, s.port, s.dest!);
        const hazards = storms.filter(w => w.starts < s.arriveTick && w.ends > e.tick && polyNear(e, track, w, w.r)).map(w => w.id);
        return { ship: s.id, eta: s.arriveTick, hazards };
      });
      return { ships };
    },
    cards(company): FeatureCard[] {
      const cal = calendar(e);
      const lines = visibleWeather(e).map(w => `${w.kind === "hurricane" ? "Hurricane" : w.kind === "storm" ? "Storm" : "Fog bank"} over ${regionName(w)}, ${clock(w.starts)} to ${clock(w.ends)}${w.starts > e.tick ? " (forecast)" : ""}.`);
      const warn = (this.view?.(company) as { ships: { ship: number; hazards: string[] }[] } | undefined)?.ships.filter(s => s.hazards.length) ?? [];
      const detail = [`It is ${cal.seasonName}, ${clock(e.tick)}.`, ...(lines.length ? lines : ["Clear skies across the sea."]),
        ...warn.map(s => `Ship ${s.ship} will cross ${s.hazards.length === 1 ? "a storm" : `${s.hazards.length} storms`} before it docks.`)];
      return [{ title: "Weather report", detail: detail.join("\n") }];
    },
  };
};

/** Idea 96: storms close the lanes they cover; voyages through them wait it out (more travel hours). */
export const stormClosures: FeatureFactory = (e) => ({
  id: "world.storm-closures", ideas: [96], title: "Storm lane closures", economy: true,
  world: () => ({ maxDelay: 12 }),
  adjust: { travelHours: (v, ctx) => v + stormDelay(e, ctx.from, ctx.dest, e.tick, v) },
});
