// Mode modules: run modes per company (sandbox, ironman, hardcore permadeath, tycoon: 396, 398, 406, 409) with the
// sandbox and tycoon funds (396, 409, economy), New Game+ (399), world presets with settings, themes and fixed maps
// (offline single-player, cosy, pirate-only, steamship, futuristic, fantasy, Arctic, Mediterranean: 401, 407, 408,
// 413-417), the map editor and map sharing (418, 419) and data mods (420).
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { content } from "./content.js";
import { DAY, fmt, tracker } from "./tracker.js";
import { action, addTrophy, companyName, fail, OK, shared } from "./shared.js";

export const MODES = {
  standard: "Standard: the normal game.",
  sandbox: "Sandbox: unlimited funds (with the sandbox-funds switch); not ranked.",
  tycoon: "Tycoon sandbox: a large one-time fortune (with the sandbox-funds switch); not ranked.",
  ironman: "Ironman: your mode is locked for the season and your record carries an ironman mark.",
  hardcore: "Hardcore: if your cash goes below zero or you lose every ship, your run ends for good.",
} as const;
export type Mode = keyof typeof MODES;
export const CHOOSE_HOURS = DAY;

export const runModes: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e);
  const modeOf = (c: number) => (sh.modes.get(c) ?? "standard") as Mode;
  const canChoose = (c: number) => !["ironman", "hardcore"].includes(modeOf(c)) && e.tick - t.get(c).founded < CHOOSE_HOURS;
  return {
    id: "progression.run-modes", ideas: [396, 398, 406, 409], title: "Run mode", economy: false,
    advance() {
      t.update();
      for (const [id, mode] of sh.modes) {
        if (mode !== "hardcore" || t.fallen.has(id)) continue;
        const c = e.companies.get(id);
        if (c && (c.cash < 0 || c.ships.length === 0)) { t.fallen.add(id); addTrophy(e, id, `Hardcore run ended at level ${t.level(id)}`); }
      }
    },
    apply(cmd) {
      if (cmd.action !== "choose") return fail("unknown action");
      const mode = typeof cmd.mode === "string" && cmd.mode in MODES ? cmd.mode as Mode : undefined;
      if (!mode) return fail("choose a mode");
      if (!canChoose(cmd.company)) return fail("run modes are chosen in your first day, and ironman or hardcore is final");
      if (t.isBot(cmd.company)) return fail("bots play standard");
      sh.modes.set(cmd.company, mode);
      return OK;
    },
    cards(company) {
      const m = modeOf(company), fallen = t.fallen.has(company);
      return [{ title: `Run mode: ${m}${fallen ? " (run ended)" : ""}`, detail: `${MODES[m]}${canChoose(company) ? ` You can change mode for ${Math.max(0, CHOOSE_HOURS - (e.tick - t.get(company).founded))} more hours.` : ""}`,
        actions: canChoose(company) ? [action("progression.run-modes", "Choose mode", "choose", {}, [{ key: "mode", label: "Mode", value: m, options: Object.entries(MODES).map(([k, v]) => ({ value: k, label: v })) }])] : [] }];
    },
    view(company) { return { mode: modeOf(company), fallen: t.fallen.has(company), canChoose: canChoose(company) }; },
    world() {
      const out: Record<number, string> = {};
      for (const [id, m] of sh.modes) if (m !== "standard") out[id] = t.fallen.has(id) ? `${m}-ended` : m;
      return out;
    },
  };
};

export const SANDBOX_CASH = 1_000_000, TYCOON_CASH = 250_000;
export const sandboxFunds: FeatureFactory = (e) => {
  const sh = shared(e), granted = new Set<number>();
  return {
    id: "progression.sandbox-funds", ideas: [396, 409], title: "Sandbox funds", economy: true,
    advance() {
      for (const [id, mode] of sh.modes) {
        const c = e.companies.get(id);
        if (!c) continue;
        if (mode === "sandbox" && c.cash < SANDBOX_CASH) c.cash = SANDBOX_CASH;
        if (mode === "tycoon" && !granted.has(id)) { granted.add(id); c.cash = Math.max(c.cash, TYCOON_CASH); }
      }
    },
    cards() { return [{ title: "Sandbox funds", detail: `Sandbox companies are topped up to ${fmt(SANDBOX_CASH)} every hour; tycoon companies get ${fmt(TYCOON_CASH)} once.` }]; },
  };
};

export const NGP_MAX = 5, NGP_LEVEL_STEP = 10;
export const newGamePlus: FeatureFactory = (e) => {
  const t = tracker(e);
  const need = (c: number) => NGP_LEVEL_STEP * (t.starsOf(c) + 1);
  const ready = (c: number) => t.tutorialDone.has(c) && t.level(c) >= need(c) && t.starsOf(c) < NGP_MAX;
  return {
    id: "progression.new-game-plus", ideas: [399], title: "New Game+", economy: false,
    advance() { t.update(); },
    apply(cmd) {
      if (cmd.action !== "ascend") return fail("unknown action");
      if (!t.tutorialDone.has(cmd.company)) return fail("finish the tutorial first");
      if (t.starsOf(cmd.company) >= NGP_MAX) return fail("you have every star");
      if (t.level(cmd.company) < need(cmd.company)) return fail(`New Game+ needs captain level ${need(cmd.company)}`);
      t.stars.set(cmd.company, t.starsOf(cmd.company) + 1);
      addTrophy(e, cmd.company, `New Game+ star ${t.starsOf(cmd.company)}`);
      return OK;
    },
    cards(company) {
      const n = t.starsOf(company);
      return [{ title: `New Game+: ${n} star${n === 1 ? "" : "s"}`,
        detail: `Take a star to raise every daily quest and weekly goal target by half again, for bragging rights. Next star at level ${need(company)} (tutorial done: ${t.tutorialDone.has(company) ? "yes" : "no"}).`,
        actions: ready(company) ? [action("progression.new-game-plus", "Take a star", "ascend")] : [] }];
    },
    view(company) { return { stars: t.starsOf(company), nextLevel: need(company) }; },
    world() { const out: Record<number, number> = {}; for (const [id, n] of t.stars) if (n > 0) out[id] = n; return out; },
  };
};

/** The preset this world runs: config/rules.json { "progression": { "worldPreset": "<id>" } }; default "classic". */
export function presetId(rules: unknown): string {
  const id = (rules as { progression?: { worldPreset?: unknown } })?.progression?.worldPreset;
  return typeof id === "string" && content().presets.some(p => p.id === id) ? id : "classic";
}
/** Settings the chosen preset asks for that rules.json does not have (shown as warnings, never changed for you). */
export function presetMismatches(rules: Record<string, any>, wanted: Record<string, unknown> | undefined, path = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(wanted ?? {})) {
    const have = rules?.[k];
    if (v && typeof v === "object") out.push(...presetMismatches(have ?? {}, v as Record<string, unknown>, `${path}${k}.`));
    else if (have !== v) out.push(`${path}${k} should be ${JSON.stringify(v)} (is ${JSON.stringify(have)})`);
  }
  return out;
}
export const worldPresets: FeatureFactory = (e) => {
  const preset = () => content().presets.find(p => p.id === presetId(e.rules))!;
  return {
    id: "progression.world-presets", ideas: [401, 407, 408, 413, 414, 415, 416, 417], title: "World preset", economy: false,
    cards() {
      const p = preset(), warn = presetMismatches(e.rules as unknown as Record<string, any>, p.rules);
      return [{ title: `World: ${p.name}`, detail: `${p.text}${warn.length ? ` Server settings to change: ${warn.join("; ")}.` : ""} Other presets: ${content().presets.filter(x => x.id !== p.id).map(x => x.name).join(", ")} (see docs/features/progression-presets.md).` }];
    },
    world() {
      const p = preset(), theme = p.theme ? content().themes[p.theme] : undefined;
      return { id: p.id, name: p.name, theme: p.theme ?? null, filter: theme?.filter ?? null, labels: theme?.labels ?? {}, map: p.map ?? null };
    },
  };
};

// ---------------------------------------------------------------- maps

export interface SharedMap { name: string; ports: { name: string; x: number; y: number; produces: string[]; consumes: string[] }[]; routes: { a: number; b: number; distance: number }[] }
export const MAP_LIMITS = { minPorts: 4, maxPorts: 60, maxRoutes: 240, width: 4000, height: 3000 };
const safeName = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && /^[\p{L}\p{N} '.,-]+$/u.test(v);
const goodsList = (v: unknown) => Array.isArray(v) && v.length <= GOODS.length && v.every(g => (GOODS as readonly unknown[]).includes(g)) && new Set(v).size === v.length;
const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Checks an untrusted map and returns a clean copy (only known fields), or an error. Every port must be reachable. */
export function validateMap(raw: unknown): { ok: true; map: SharedMap } | { ok: false; error: string } {
  const m = raw as Record<string, unknown>;
  if (!m || typeof m !== "object") return { ok: false, error: "not a map" };
  if (!safeName(m.name, 40)) return { ok: false, error: "give the map a name (letters, numbers, spaces; up to 40)" };
  const ports = m.ports, routes = m.routes;
  if (!Array.isArray(ports) || ports.length < MAP_LIMITS.minPorts || ports.length > MAP_LIMITS.maxPorts) return { ok: false, error: `a map needs ${MAP_LIMITS.minPorts}-${MAP_LIMITS.maxPorts} ports` };
  if (!Array.isArray(routes) || routes.length < ports.length - 1 || routes.length > MAP_LIMITS.maxRoutes) return { ok: false, error: "too few or too many routes" };
  const clean: SharedMap = { name: String(m.name).trim(), ports: [], routes: [] };
  const names = new Set<string>();
  for (const p of ports as Record<string, unknown>[]) {
    if (!p || !safeName(p.name, 24)) return { ok: false, error: "every port needs a short name" };
    if (names.has(String(p.name))) return { ok: false, error: `two ports are called ${p.name}` };
    names.add(String(p.name));
    if (!num(p.x, 0, MAP_LIMITS.width) || !num(p.y, 0, MAP_LIMITS.height)) return { ok: false, error: `${p.name} is off the chart` };
    if (!goodsList(p.produces) || !goodsList(p.consumes)) return { ok: false, error: `${p.name} has unknown goods` };
    clean.ports.push({ name: String(p.name), x: Math.round(Number(p.x) * 10) / 10, y: Math.round(Number(p.y) * 10) / 10, produces: [...p.produces as string[]], consumes: [...p.consumes as string[]] });
  }
  const seen = new Set<string>();
  for (const r of routes as Record<string, unknown>[]) {
    const n = clean.ports.length;
    if (!r || !Number.isInteger(r.a) || !Number.isInteger(r.b) || !num(r.a, 0, n - 1) || !num(r.b, 0, n - 1) || r.a === r.b) return { ok: false, error: "a route joins two different ports" };
    const key = [r.a, r.b].sort().join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    const a = clean.ports[r.a as number], b = clean.ports[r.b as number];
    clean.routes.push({ a: r.a as number, b: r.b as number, distance: Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 10) / 10 });
  }
  const reach = new Set([0]), stack = [0];
  while (stack.length) { const p = stack.pop()!; for (const r of clean.routes) for (const [x, y] of [[r.a, r.b], [r.b, r.a]]) if (x === p && !reach.has(y)) { reach.add(y); stack.push(y); } }
  if (reach.size !== clean.ports.length) return { ok: false, error: "every port must be reachable by sea" };
  if (!GOODS.every(g => clean.ports.some(p => p.produces.includes(g)) && clean.ports.some(p => p.consumes.includes(g)))) return { ok: false, error: "every good needs a producer and a consumer" };
  return { ok: true, map: clean };
}

export const MAPS_PER_COMPANY = 3, MAPS_MAX = 60;
interface Entry { id: number; author: number; map: SharedMap; ratings: Map<number, number>; tick: number }
export const mapSharing: FeatureFactory = (e) => {
  const maps = new Map<number, Entry>(), picked = new Map<number, number>();
  let nextId = 1;
  const rating = (x: Entry) => x.ratings.size ? Math.round([...x.ratings.values()].reduce((a, b) => a + b, 0) / x.ratings.size * 10) / 10 : null;
  return {
    id: "progression.map-sharing", ideas: [418, 419], title: "Map editor and sharing", economy: false,
    apply(cmd) {
      if (cmd.action === "share") {
        const mine = [...maps.values()].filter(x => x.author === cmd.company).length;
        if (mine >= MAPS_PER_COMPANY) return fail(`you can share up to ${MAPS_PER_COMPANY} maps; remove one first`);
        if (maps.size >= MAPS_MAX) return fail("the map gallery is full");
        const v = validateMap(cmd.map);
        if (!v.ok) return fail(v.error);
        const id = nextId++;
        maps.set(id, { id, author: cmd.company, map: v.map, ratings: new Map(), tick: e.tick });
        return { ok: true, id };
      }
      const entry = typeof cmd.map === "number" ? maps.get(cmd.map) : undefined;
      if (!entry) return fail("no such map");
      if (cmd.action === "pick") { picked.set(cmd.company, entry.id); return OK; }
      if (cmd.action === "remove") {
        if (entry.author !== cmd.company) return fail("not your map");
        maps.delete(entry.id);
        return OK;
      }
      if (cmd.action === "rate") {
        if (entry.author === cmd.company) return fail("you cannot rate your own map");
        const stars = cmd.stars;
        if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) return fail("rate 1 to 5 stars");
        entry.ratings.set(cmd.company, stars);
        return OK;
      }
      return fail("unknown action");
    },
    cards(company) {
      const list = [...maps.values()], id = "progression.map-sharing", others = list.filter(x => x.author !== company);
      return [{ title: `Map gallery: ${list.length} maps`,
        detail: "Draw your own archipelago in the map editor (Maps button on the chart), then share it here. Download any shared map as JSON; a server owner can run it with scripts/use-map.ts.",
        actions: [
          ...(list.length ? [action(id, "Download a map", "pick", {}, [{ key: "map", label: "Map", options: list.map(x => ({ value: x.id, label: x.map.name })) }])] : []),
          ...(others.length ? [action(id, "Rate a map", "rate", {}, [
            { key: "map", label: "Map", options: others.map(x => ({ value: x.id, label: `${x.map.name} by ${companyName(e, x.author)}` })) },
            { key: "stars", label: "Stars", min: 1, max: 5, value: 5 }])] : []),
          ...list.filter(x => x.author === company).map(x => action(id, `Remove ${x.map.name}`, "remove", { map: x.id })),
        ] }];
    },
    /** The full map the company picked to download (maps are too big to send everyone every update). */
    view(company) { const x = maps.get(picked.get(company) ?? -1); return { picked: x ? { id: x.id, map: x.map } : null }; },
    world() {
      return [...maps.values()].map(x => ({ id: x.id, name: x.map.name, author: companyName(e, x.author), ports: x.map.ports.length, rating: rating(x), votes: x.ratings.size }));
    },
  };
};

export const mods: FeatureFactory = () => ({
  id: "progression.mods", ideas: [420], title: "Mods", economy: false,
  cards() {
    const list = content().mods;
    return [{ title: `Mods: ${list.length} loaded`, detail: list.length ? `Loaded data mods: ${list.join(", ")}.` : "No data mods loaded. A server owner can add achievements, titles, quests, puzzles, tech and presets by dropping JSON files in config/content/progression/mods/ (see docs/features/progression-modding.md)." }];
  },
  world() {
    const c = content();
    return { mods: c.mods, counts: { achievements: c.achievements.length, titles: c.titles.length, puzzles: c.puzzles.length, nodes: c.nodes.length, presets: c.presets.length } };
  },
});
