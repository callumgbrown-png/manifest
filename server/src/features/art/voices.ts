// art.diary and art.chatter: the voices of the sea. A captain's diary writes itself from your ships' comings and
// goings; captains bark a line about what they're doing; and the harbour radio crackles with chatter.
// Writing lives in config/content/art/voices.json.
import type { FeatureFactory } from "../types.js";
import { content, day, fill, goodName, hash, pick, portName, shipWatcher } from "./shared.js";

interface Voices {
  barks: Record<"dockedLoaded" | "dockedEmpty" | "sailingLoaded" | "sailingEmpty" | "night" | "pirate" | "storm", string[]>;
  chatter: string[];
  diary: Record<"depart" | "arrive" | "quiet" | "found", string[]>;
}
export const DIARY_KEPT = 30;

export const diary: FeatureFactory = (e) => {
  const V = content<Voices>("voices");
  const watch = shipWatcher(e);
  const pages = new Map<number, { tick: number; text: string }[]>();
  const lastDay = new Map<number, number>();    // company -> day of the last entry
  const write = (c: number, text: string) => {
    const list = pages.get(c) ?? [];
    list.push({ tick: e.tick, text });
    pages.set(c, list.slice(-DIARY_KEPT));
    lastDay.set(c, day(e.tick));
  };
  return {
    id: "art.diary", ideas: [474], title: "Captain's diary", economy: false,
    enable() { watch.reset(); },
    advance() {
      const step = watch.step();
      const vars = (s: { ship: number; port: number; other: number; good: number | null; qty: number }, dest: number) => ({
        ship: s.ship, day: day(e.tick), hour: String(e.tick % 24).padStart(2, "0"), port: portName(e, s.port), dest: portName(e, dest),
        cargo: s.good !== null && s.qty > 0 ? ` with ${s.qty} t of ${goodName(s.good)}` : "",
      });
      for (const d of step.departures) if (e.companies.has(d.owner)) write(d.owner, fill(pick(V.diary.depart, hash(d.ship, e.tick)), vars(d, d.other)));
      for (const a of step.arrivals) if (e.companies.has(a.owner)) write(a.owner, fill(pick(V.diary.arrive, hash(a.ship, e.tick)), vars(a, a.port)));
      // At the end of a day with no entry, a quiet line.
      if (e.tick % 24 === 23) for (const c of e.companies.keys()) {
        if ((lastDay.get(c) ?? 0) < day(e.tick)) write(c, fill(pick(V.diary.quiet, hash(c, e.tick)), { day: day(e.tick) }));
      }
    },
    view(company) { return { pages: (pages.get(company) ?? []).slice().reverse() }; },
  };
};

export const CHATTER_EVERY = 3;
export const chatter: FeatureFactory = (e) => {
  const V = content<Voices>("voices");
  let radio: { tick: number; text: string }[] = [];
  return {
    id: "art.chatter", ideas: [467, 468], title: "Radio chatter and captain barks", economy: false,
    enable() { radio = []; },
    advance() {
      if (e.tick % CHATTER_EVERY !== 0 || e.features.random() < 0.3) return;
      const ships = [...e.ships.keys()];
      const ship = ships.length ? ships[Math.floor(e.features.random() * ships.length)] : 1;
      const port = Math.floor(e.features.random() * e.map.ports.length);
      const good = Math.floor(e.features.random() * 4);
      const line = V.chatter[Math.floor(e.features.random() * V.chatter.length)];
      radio.push({ tick: e.tick, text: fill(line, { ship, port: portName(e, port), good: goodName(good) }) });
      radio = radio.slice(-6);
    },
    world() { return { radio: radio.map(r => ({ ...r })) }; },
    /** One line per own ship: what its captain says right now. */
    view(company) {
      const c = e.companies.get(company);
      if (!c) return null;
      const hour = e.tick % 24, night = hour >= 21 || hour < 5;
      const barks: Record<number, string> = {};
      for (const id of c.ships) {
        const s = e.ships.get(id);
        if (!s) continue;
        const loaded = s.good !== null && s.qty > 0;
        const set = s.type === "pirate" ? V.barks.pirate : night ? V.barks.night
          : s.dest === null ? (loaded ? V.barks.dockedLoaded : V.barks.dockedEmpty) : (loaded ? V.barks.sailingLoaded : V.barks.sailingEmpty);
        barks[id] = fill(pick(set, hash(id, Math.floor(e.tick / 4))), { good: goodName(s.good), dest: portName(e, s.dest ?? s.port), ship: id });
      }
      return { barks, storm: V.barks.storm };
    },
  };
};
