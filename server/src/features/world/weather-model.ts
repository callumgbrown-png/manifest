// The weather of a world: a pure function of the map and the tick, so forecasts, closures and replays agree.
import type { Engine } from "../../engine.js";
import type { Pt } from "../../geo.js";
import { calendar, hash, polyNear, seaPoint, slotAt, slotsBetween, voyagePoly, type SlotSpec } from "./shared.js";

export type WeatherKind = "storm" | "hurricane" | "fog";
export interface WeatherSystem { id: string; kind: WeatherKind; x: number; y: number; r: number; starts: number; ends: number; warnFrom: number }

const seasonal = (e: Engine, odds: number[]) => (start: number) => odds[calendar(e, start).season];
const stormSpec = (e: Engine): SlotSpec => ({ period: 30, duration: 10, salt: 101, chance: seasonal(e, [0.35, 0.25, 0.55, 0.7]) });
const fogSpec = (e: Engine): SlotSpec => ({ period: 20, duration: 7, salt: 202, chance: seasonal(e, [0.6, 0.3, 0.6, 0.4]) });
export const TIDE_SPEC: SlotSpec = { period: 168, duration: 24, salt: 303, chance: 1, offset: 60 };
export const ECLIPSE_SPEC: SlotSpec = { period: 480, duration: 3, salt: 404, chance: 0.85, offset: 100 };
/** Hurricanes are announced a day ahead (idea 103); ordinary storms and fog half a day. */
const LEAD = { hurricane: 24, storm: 12, fog: 6 };

function stormOf(e: Engine, index: number): WeatherSystem | undefined {
  const slot = slotAt(stormSpec(e), index);
  if (!slot) return undefined;
  const hurricane = hash(101, index, 11) < (calendar(e, slot.starts).season === 2 ? 0.45 : 0.15);
  const kind = hurricane ? "hurricane" : "storm";
  const length = (hurricane ? 10 : 6) + Math.floor(hash(101, index, 13) * 6);
  const at = seaPoint(e, 1000 + index);
  return { id: `${kind}-${index}`, kind, ...at, r: hurricane ? 80 : 45, starts: slot.starts, ends: slot.starts + length, warnFrom: slot.starts - LEAD[kind] };
}
function fogOf(e: Engine, index: number): WeatherSystem | undefined {
  const slot = slotAt(fogSpec(e), index);
  if (!slot) return undefined;
  const at = seaPoint(e, 5000 + index);
  return { id: `fog-${index}`, kind: "fog", ...at, r: 60, starts: slot.starts, ends: slot.ends, warnFrom: slot.starts - LEAD.fog };
}

/** Every weather system that overlaps [from, to). */
export function weatherBetween(e: Engine, from: number, to: number): WeatherSystem[] {
  const out: WeatherSystem[] = [];
  for (const [spec, make] of [[stormSpec(e), stormOf], [fogSpec(e), fogOf]] as const) {
    const first = Math.max(0, Math.floor((from - 20 - spec.period) / spec.period)), last = Math.floor(to / spec.period);
    for (let i = first; i <= last; i++) { const w = make(e, i); if (w && w.starts < to && w.ends > from) out.push(w); }
  }
  return out.sort((a, b) => a.starts - b.starts || a.id.localeCompare(b.id));
}
/** What players can see now: systems under way and those already forecast. */
export const visibleWeather = (e: Engine, tick = e.tick) => weatherBetween(e, tick, tick + 25).filter(w => w.warnFrom <= tick);

/** Hours a voyage waits out storms on its track (idea 96): the overlap of each storm with the voyage, capped at 12. */
export function stormDelay(e: Engine, from: number, dest: number, depart: number, hours: number): number {
  if (from === dest) return 0;
  const poly = voyagePoly(e, from, dest);
  let delay = 0;
  for (const w of weatherBetween(e, depart, depart + hours)) {
    if (w.kind === "fog" || !polyNear(e, poly, w, w.r)) continue;
    delay += Math.min(w.ends, depart + hours) - Math.max(w.starts, depart);
  }
  return Math.min(12, Math.max(0, delay));
}

export function whirlpools(e: Engine): (Pt & { id: string; r: number })[] {
  return [0, 1, 2].map(i => ({ id: `whirlpool-${i}`, ...seaPoint(e, 300 + i, 0.35, 0.65), r: 18 }));
}
export const tideNow = (e: Engine, tick = e.tick) => {
  const extreme = slotsBetween(TIDE_SPEC, tick, tick + 1)[0];
  const level = Math.sin(tick / 12.4 * 2 * Math.PI) * (extreme ? 1 : 0.5);
  return { level: Math.round(level * 100) / 100, extreme: extreme ? { starts: extreme.starts, ends: extreme.ends } : null };
};
