// art.news: the Harbour Gazette. Every six hours (one "watch") the server looks at what happened and prints a headline,
// each with a pixel-art illustration key the client draws (features/art.js). Headlines use original templates from
// config/content/art/news.json.
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { content, fill, goodName, hash, pick, portName, shipWatcher } from "./shared.js";

export const WATCH_HOURS = 6;
export const MOVE_PCT = 20;
const KEPT = 8;
type Kind = "spike" | "crash" | "leader" | "raids" | "busy" | "quiet";
export interface Headline { id: number; tick: number; kind: Kind; art: Kind; text: string }

export const news: FeatureFactory = (e) => {
  const T = content<Record<Kind, string[]>>("news");
  const watch = shipWatcher(e);
  let printed: Headline[] = [];
  let seq = 0;
  let base: number[][] = [];          // prices at the start of the watch
  let arrivals: number[] = [];
  let leader = -1;
  let notices = 0;                    // highest piracy notice id counted
  const snapshot = () => e.map.ports.map((_, p) => GOODS.map((_, g) => e.price(p, g)));
  const noticeTop = () => { let top = 0; for (const l of e.piracy.notices.values()) for (const n of l) top = Math.max(top, n.id); return top; };
  const print = (kind: Kind, vars: Record<string, string | number>) => {
    seq++;
    printed.push({ id: seq, tick: e.tick, kind, art: kind, text: fill(pick(T[kind], hash(seq, e.tick)), vars) });
    printed = printed.slice(-KEPT);
  };
  return {
    id: "art.news", ideas: [172, 475], title: "Harbour Gazette headlines with pixel-art illustrations", economy: false,
    enable() { watch.reset(); base = snapshot(); arrivals = e.map.ports.map(() => 0); notices = noticeTop(); leader = -1; },
    advance() {
      for (const a of watch.step().arrivals) if (a.port in arrivals) arrivals[a.port]++;
      if (e.tick % WATCH_HOURS !== 0) return;
      let wrote = 0;
      // Biggest price move.
      let best = { pct: 0, p: -1, g: -1 };
      const now = snapshot();
      now.forEach((row, p) => row.forEach((v, g) => {
        const was = base[p]?.[g];
        if (!was) return;
        const pct = Math.round((v / was - 1) * 100);
        if (Math.abs(pct) > Math.abs(best.pct)) best = { pct, p, g };
      }));
      if (Math.abs(best.pct) >= MOVE_PCT) {
        print(best.pct > 0 ? "spike" : "crash", { good: goodName(best.g).toUpperCase(), port: portName(e, best.p).toUpperCase(), pct: Math.abs(best.pct) });
        wrote++;
      }
      // A new leader by net worth (only once there is a field to lead).
      if (e.companies.size >= 2) {
        const top = [...e.companies.values()].sort((a, b) => e.netWorth(b) - e.netWorth(a) || a.id - b.id)[0];
        if (leader !== -1 && top.id !== leader) { print("leader", { company: top.name.toUpperCase() }); wrote++; }
        leader = top.id;
      }
      // Pirate activity.
      let raids = 0;
      const top = noticeTop();
      for (const l of e.piracy.notices.values()) for (const n of l) if (n.id > notices && (n.kind === "raided" || n.kind === "captured")) raids++;
      notices = top;
      if (raids >= 2) { print("raids", { count: raids }); wrote++; }
      // Busiest harbour.
      const most = arrivals.reduce((b, n, p) => (n > arrivals[b] ? p : b), 0);
      if (arrivals[most] >= 3) { print("busy", { port: portName(e, most).toUpperCase(), count: arrivals[most] }); wrote++; }
      if (!wrote && e.tick % 24 === 0) print("quiet", {});
      base = now; arrivals = arrivals.map(() => 0);
    },
    world() { return { headlines: printed.map(h => ({ ...h })) }; },
  };
};
