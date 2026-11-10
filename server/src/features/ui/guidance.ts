import type { Engine, Ship } from "../../engine.js";
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { OK, fail, goodIndex, isPort, journal, remember } from "./common.js";
import { dockedShips, planRoutes } from "./planner.js";

const round = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------- cargo manifest (155)

export interface ManifestLine {
  ship: number; type: string; at: number; dest: number | null; arriveIn: number; good: string | null; qty: number; capacity: number;
  fill: number; paid: number; valueHere: number | null; bestPort: number | null; bestValue: number | null;
}

/** Idea 155: the cargo manifest. Every ship's hold, what it cost, what it would fetch here and at the best port. */
export const cargoManifest: FeatureFactory = (e) => ({
  id: "ui.cargo-manifest", ideas: [155], title: "Cargo manifest", economy: false,
  view(company) {
    const c = e.companies.get(company);
    if (!c) return null;
    const tax = e.rules.fees.trade_tax_rate;
    const lines: ManifestLine[] = c.ships.map(id => e.ships.get(id)!).filter(Boolean).map((s: Ship) => {
      const capacity = e.expansionCapacity(s), loaded = s.qty > 0 && s.good !== null;
      let bestPort: number | null = null, bestValue: number | null = null;
      if (loaded) for (let p = 0; p < e.map.ports.length; p++) {
        const v = e.sellValue(p, s.good!, s.qty) * (1 - tax);
        if (bestValue === null || v > bestValue) { bestValue = v; bestPort = p; }
      }
      const at = s.dest === null ? s.port : s.dest;
      return { ship: s.id, type: s.type, at: s.port, dest: s.dest, arriveIn: s.dest === null ? 0 : Math.max(0, s.arriveTick - e.tick),
        good: loaded ? GOODS[s.good!] : null, qty: Math.round(s.qty * 100) / 100, capacity,
        fill: capacity > 0 ? Math.min(1, round(s.qty / capacity)) : 0, paid: Math.round(s.cost),
        valueHere: loaded ? Math.round(e.sellValue(at, s.good!, s.qty) * (1 - tax)) : null,
        bestPort, bestValue: bestValue === null ? null : Math.round(bestValue) };
    });
    const totals = { tonnes: round(lines.reduce((a, l) => a + l.qty, 0)), capacity: lines.reduce((a, l) => a + l.capacity, 0),
      paid: lines.reduce((a, l) => a + (l.qty > 0 ? l.paid : 0), 0), value: lines.reduce((a, l) => a + (l.valueHere ?? 0), 0) };
    return { lines, totals };
  },
});

// ---------------------------------------------------------------- watchlist (427)

export interface Watch { port: number; good: string }
const MAX_WATCH = 12, HISTORY = 24;

/** Idea 427: a watchlist of port and good pairs, with the price now and its change over the last day. */
export const watchlist: FeatureFactory = (e) => {
  const lists = new Map<number, Watch[]>();
  const history = new Map<string, number[]>();   // "port:good" -> last HISTORY hourly prices, for watched pairs only
  const key = (w: Watch) => `${w.port}:${GOODS.indexOf(w.good as never)}`;
  journal(e).register("ui.watchlist", (company, before) => { lists.set(company, structuredClone(before as Watch[])); return OK; });
  return {
    id: "ui.watchlist", ideas: [427], title: "Watchlist", economy: false,
    apply(cmd) {
      const list = lists.get(cmd.company) ?? [];
      const g = goodIndex(cmd.good);
      if (!isPort(e, cmd.port)) return fail("choose a port");
      if (g === null) return fail("choose a good");
      const at = list.findIndex(w => w.port === cmd.port && w.good === GOODS[g]);
      if (cmd.action === "watch") {
        if (at >= 0) return fail("already on your watchlist");
        if (list.length >= MAX_WATCH) return fail(`you can watch ${MAX_WATCH} prices; remove one first`);
        remember(e, cmd, "watch a price", list);
        lists.set(cmd.company, [...list, { port: cmd.port, good: GOODS[g] }]);
        return OK;
      }
      if (cmd.action === "unwatch") {
        if (at < 0) return fail("not on your watchlist");
        remember(e, cmd, "stop watching a price", list);
        lists.set(cmd.company, list.filter((_, i) => i !== at));
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      const watched = new Set<string>();
      for (const list of lists.values()) for (const w of list) watched.add(key(w));
      for (const k of [...history.keys()]) if (!watched.has(k)) history.delete(k);
      for (const k of watched) {
        const [p, g] = k.split(":").map(Number);
        const h = history.get(k) ?? [];
        h.push(round(e.price(p, g)));
        if (h.length > HISTORY) h.shift();
        history.set(k, h);
      }
    },
    view(company) {
      return (lists.get(company) ?? []).map(w => {
        const now = round(e.price(w.port, GOODS.indexOf(w.good as never))), h = history.get(key(w)) ?? [];
        return { ...w, now, dayAgo: h[0] ?? null, change: h.length ? round(now - h[0]) : 0, spark: h };
      });
    },
  };
};

// ---------------------------------------------------------------- dashboard (421)

export const WIDGETS = ["cash", "fleet", "cargo", "ledger", "alerts", "watchlist", "planner", "summary", "idle", "hints"] as const;
export const DEFAULT_LAYOUT = ["cash", "fleet", "cargo", "planner", "alerts", "summary"];

/** Idea 421: a customisable dashboard. The chosen widgets and their order are kept on the server, so they follow the
 *  player to any device. The client draws each widget from the matching module's data. */
export const dashboard: FeatureFactory = (e) => {
  const layouts = new Map<number, string[]>();
  journal(e).register("ui.dashboard", (company, before) => {
    if (before === null) layouts.delete(company); else layouts.set(company, structuredClone(before as string[]));
    return OK;
  });
  return {
    id: "ui.dashboard", ideas: [421], title: "Dashboard", economy: false,
    apply(cmd) {
      const before = layouts.get(cmd.company) ?? null;
      if (cmd.action === "reset") { remember(e, cmd, "reset dashboard", before); layouts.delete(cmd.company); return OK; }
      if (cmd.action !== "set") return fail("unknown action");
      if (!Array.isArray(cmd.widgets) || cmd.widgets.length > WIDGETS.length) return fail("choose up to ten widgets");
      const seen = new Set<string>();
      for (const w of cmd.widgets) {
        if (typeof w !== "string" || !(WIDGETS as readonly string[]).includes(w)) return fail("unknown widget");
        if (seen.has(w)) return fail("each widget once");
        seen.add(w);
      }
      remember(e, cmd, "change dashboard", before);
      layouts.set(cmd.company, [...seen]);
      return OK;
    },
    view(company) { return { widgets: layouts.get(company) ?? DEFAULT_LAYOUT, available: WIDGETS }; },
  };
};

// ---------------------------------------------------------------- tutorial and guided first delivery (481, 482)

export const TUTORIAL_STEPS = [
  { id: "load", title: "Load some cargo", text: "Open your home port, pick a good your port makes cheaply and load it onto your ship." },
  { id: "sail", title: "Set sail", text: "Choose a port that needs that good and press Set sail. The voyage takes game hours." },
  { id: "arrive", title: "Arrive", text: "Watch your ship cross the map. It docks by itself when it gets there." },
  { id: "sell", title: "Sell the cargo", text: "Sell your hold at the new port. Selling also happens on arrival if you planned it." },
  { id: "profit", title: "Make a profit", text: "A delivery that earns more than it cost. That's the whole game: do it again, bigger." },
] as const;

/** Ideas 481 + 482: an interactive tutorial that follows what you really do, with a guided first delivery that names
 *  one concrete, affordable voyage (from the route planner's quote) until the first profitable sale. */
export const tutorial: FeatureFactory = (e) => {
  const reached = new Map<number, number>();   // company -> steps done (0..5)
  const skipped = new Set<number>();
  const progress = (company: number): number => {
    const c = e.companies.get(company);
    if (!c) return 0;
    const trips = e.trips.get(company) ?? [];
    const ships = c.ships.map(id => e.ships.get(id)!).filter(Boolean);
    if (trips.some(t => !t.open && t.good !== null && t.earned > t.spent)) return 5;
    if (trips.some(t => !t.open && t.good !== null)) return 4;
    if (trips.some(t => t.arriveTick <= e.tick && t.good !== null)) return 3;
    if (trips.length || ships.some(s => s.dest !== null)) return 2;
    if (ships.some(s => s.qty > 0)) return 1;
    return 0;
  };
  const done = (company: number) => Math.max(reached.get(company) ?? 0, progress(company));
  const suggestion = (company: number) => {
    for (const s of dockedShips(e, company, 3)) {
      const [r] = planRoutes(e, s, 1);
      if (r) return r;
    }
    return null;
  };
  return {
    id: "ui.tutorial", ideas: [481, 482], title: "Tutorial", economy: false,
    apply(cmd) {
      if (cmd.action === "skip") { if (skipped.has(cmd.company)) return fail("already skipped"); skipped.add(cmd.company); return OK; }
      if (cmd.action === "restart") { skipped.delete(cmd.company); reached.set(cmd.company, progress(cmd.company)); return OK; }
      return fail("unknown action");
    },
    advance() {
      for (const c of e.companies.values()) {
        const p = progress(c.id);
        if (p > (reached.get(c.id) ?? 0)) reached.set(c.id, p);
      }
    },
    view(company) {
      const n = done(company);
      return { done: n, total: TUTORIAL_STEPS.length, skipped: skipped.has(company), steps: TUTORIAL_STEPS,
        next: n < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[n] : null,
        guide: n < TUTORIAL_STEPS.length && !skipped.has(company) && n <= 1 ? suggestion(company) : null };
    },
    cards(company) {
      const n = done(company);
      if (skipped.has(company) || n >= TUTORIAL_STEPS.length) return [];
      const step = TUTORIAL_STEPS[n], g = n <= 1 ? suggestion(company) : null;
      const tip = g ? ` Try this: ship ${g.ship} carries ${g.good ? `${g.qty} ${g.good}` : "its cargo"} to ${e.map.ports[g.dest].name}` +
        ` (about ${g.hours} h, estimated profit ${Math.round(g.profit)}).` : "";
      return [{ title: `Tutorial ${n + 1}/${TUTORIAL_STEPS.length}: ${step.title}`, detail: step.text + tip,
        actions: [{ label: "Skip tutorial", command: { type: "feature", module: "ui.tutorial", action: "skip" } }] }];
    },
  };
};

// ---------------------------------------------------------------- difficulty presets (486)

export const PRESETS = {
  guided: { hints: true, planner: true, confirmations: true, tutorial: true, tooltips: "rich" },
  standard: { hints: true, planner: true, confirmations: false, tutorial: false, tooltips: "rich" },
  expert: { hints: false, planner: false, confirmations: false, tutorial: false, tooltips: "plain" },
} as const;
type Preset = keyof typeof PRESETS;

/** Idea 486: difficulty presets for the player's own screen: how much help the interface gives (hints, the route
 *  planner, confirmations, tutorial). Prices, costs and the world's difficulty are untouched. */
export const presets: FeatureFactory = (e) => {
  const chosen = new Map<number, Preset>();
  return {
    id: "ui.presets", ideas: [486], title: "Difficulty presets", economy: false,
    apply(cmd) {
      if (cmd.action !== "set") return fail("unknown action");
      if (typeof cmd.preset !== "string" || !Object.hasOwn(PRESETS, cmd.preset)) return fail("choose guided, standard or expert");
      chosen.set(cmd.company, cmd.preset as Preset);
      return OK;
    },
    view(company) { const p = chosen.get(company) ?? "standard"; return { preset: p, ...PRESETS[p] }; },
    cards(company) {
      const now = chosen.get(company) ?? "standard";
      return [{ title: "Help level", detail: `Now: ${now}. Guided shows every hint and confirmation; expert hides the helpers. Prices are the same for everyone.`,
        actions: (Object.keys(PRESETS) as Preset[]).filter(p => p !== now)
          .map(p => ({ label: p[0].toUpperCase() + p.slice(1), command: { type: "feature", module: "ui.presets", action: "set", preset: p } })) }];
    },
  };
};

// ---------------------------------------------------------------- spoiler-free hints (499)

export interface Hint { key: string; level: number; text: string; more: boolean }

/** Idea 499: spoiler-free hints. Each hint starts as a gentle nudge; asking for more makes it a little more specific,
 *  but it never names a route or a price to copy. */
export const hints: FeatureFactory = (e) => {
  const levels = new Map<string, number>();   // `${company}:${key}` -> 0 | 1
  const raw = (company: number): { key: string; texts: [string, string] }[] => {
    const c = e.companies.get(company);
    if (!c) return [];
    const ships = c.ships.map(id => e.ships.get(id)!).filter(Boolean);
    const out: { key: string; texts: [string, string] }[] = [];
    const idle = ships.find(s => s.dest === null && s.qty === 0 && !e.voyageQueues.has(s.id));
    if (idle) out.push({ key: "idle", texts: ["A ship that sits in port earns nothing.",
      `Ship ${idle.id} has an empty hold. Ports that make a good sell it cheapest.`] });
    const loaded = ships.find(s => s.dest === null && s.qty > 0);
    if (loaded) out.push({ key: "loaded", texts: ["Cargo is worth most where it is needed.",
      `Ship ${loaded.id}'s ${GOODS[loaded.good!]} sells higher in ports that consume it; check the port tooltips.`] });
    if (c.cash < e.spec("coaster").price && ships.length <= 1) out.push({ key: "grow", texts: ["More ships means more deliveries at once.",
      "A coaster is the cheapest ship. Save toward one at your home port."] });
    const trips = (e.trips.get(company) ?? []).filter(t => !t.open && t.good !== null);
    if (trips.length >= 3 && trips.slice(-3).every(t => t.earned <= t.spent)) out.push({ key: "losses", texts: ["Your last few deliveries lost money.",
      "Fuel and port fees add up on long trips with small cargoes. Compare the estimate before you sail."] });
    if (!out.length) out.push({ key: "steady", texts: ["Things are going well. Watch prices change through the day.",
      "Prices recover when no one trades a good for a while; a quiet port can be a good buy."] });
    return out.slice(0, 3);
  };
  return {
    id: "ui.hints", ideas: [499], title: "Hints", economy: false,
    apply(cmd) {
      if (cmd.action !== "more") return fail("unknown action");
      if (typeof cmd.key !== "string" || !raw(cmd.company).some(h => h.key === cmd.key)) return fail("no such hint right now");
      const k = `${cmd.company}:${cmd.key}`;
      if ((levels.get(k) ?? 0) >= 1) return fail("that is the most this hint will say");
      levels.set(k, 1);
      return OK;
    },
    view(company): Hint[] {
      return raw(company).map(h => { const level = levels.get(`${company}:${h.key}`) ?? 0; return { key: h.key, level, text: h.texts[level], more: level < 1 }; });
    },
  };
};
