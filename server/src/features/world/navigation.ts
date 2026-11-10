import type { Engine } from "../../engine.js";
import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { action, bounds, calendar, companyName, CONTENT, dist, fail, fleet, isInt, ownShip, portName, regionOf, regions, round1, shipField, shipPos } from "./shared.js";
import { islands } from "./exploration.js";

// ------------------------------------------------------------ 241 waypoints

export const MAX_WAYPOINTS = 8;
/** Idea 241: a company plots up to eight waypoints on its chart (drawn as a dashed course). Planning aid only. */
export const waypoints: FeatureFactory = (e) => {
  const plots = new Map<number, { x: number; y: number }[]>();
  return {
    id: "world.waypoints", ideas: [241], title: "Waypoints", economy: false,
    apply(cmd) {
      if (cmd.action === "clear") { plots.delete(cmd.company); return { ok: true }; }
      if (cmd.action !== "set") return fail("unknown action");
      const { w, h } = bounds(e);
      if (!Array.isArray(cmd.points) || cmd.points.length < 1 || cmd.points.length > MAX_WAYPOINTS) return fail(`plot 1 to ${MAX_WAYPOINTS} waypoints`);
      const pts: { x: number; y: number }[] = [];
      for (const p of cmd.points as unknown[]) {
        const q = p as { x?: unknown; y?: unknown };
        if (!q || typeof q.x !== "number" || typeof q.y !== "number" || !Number.isFinite(q.x) || !Number.isFinite(q.y)
          || q.x < 0 || q.y < 0 || q.x > w || q.y > h) return fail("waypoints must be on the map");
        pts.push(round1({ x: q.x, y: q.y }));
      }
      plots.set(cmd.company, pts);
      return { ok: true };
    },
    view: (company) => ({ points: plots.get(company) ?? [] }),
    cards: (company) => [{ title: "Waypoints", detail: `Shift-click the chart to drop waypoints (up to ${MAX_WAYPOINTS}); they are saved with your company. ${(plots.get(company) ?? []).length} plotted.`,
      actions: plots.has(company) ? [action("world.waypoints", "Clear waypoints", "clear")] : [] }],
  };
};

// ------------------------------------------------------------ 242 fog of war (243 sea charts reveal it)

export const FOG_COLS = 24, FOG_ROWS = 16;
const fogMaps = new WeakMap<Engine, Map<number, Uint8Array>>();
export function fogOf(e: Engine, company: number): Uint8Array {
  const all = fogMaps.get(e) ?? new Map<number, Uint8Array>();
  fogMaps.set(e, all);
  let f = all.get(company);
  if (!f) { f = new Uint8Array(FOG_COLS * FOG_ROWS); all.set(company, f); }
  return f;
}
function cellOf(e: Engine, p: { x: number; y: number }) {
  const { w, h } = bounds(e);
  return [Math.max(0, Math.min(FOG_COLS - 1, Math.floor(p.x / w * FOG_COLS))), Math.max(0, Math.min(FOG_ROWS - 1, Math.floor(p.y / h * FOG_ROWS)))];
}
function reveal(e: Engine, f: Uint8Array, p: { x: number; y: number }, r = 1) {
  const [cx, cy] = cellOf(e, p);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && y >= 0 && x < FOG_COLS && y < FOG_ROWS) f[y * FOG_COLS + x] = 1;
}
const encode = (f: Uint8Array) => Array.from({ length: FOG_ROWS }, (_, y) => Array.from(f.subarray(y * FOG_COLS, (y + 1) * FOG_COLS)).join(""));
export const seenCount = (f: Uint8Array) => f.reduce((s, v) => s + v, 0);

/** Idea 242: unexplored water is hidden on your chart until one of your ships has been near it. */
export const fogOfWar: FeatureFactory = (e) => ({
  id: "world.fog-of-war", ideas: [242], title: "Fog of war", economy: false,
  advance() {
    for (const c of e.companies.values()) {
      const f = fogOf(e, c.id);
      reveal(e, f, e.map.ports[c.home]);
      for (const s of fleet(e, c.id)) reveal(e, f, s.dest === null ? e.map.ports[s.port] : shipPos(e, s));
    }
  },
  view(company) {
    const f = fogMaps.get(e)?.get(company);
    if (f) return { cols: FOG_COLS, rows: FOG_ROWS, seen: encode(f) };
    const fresh = new Uint8Array(FOG_COLS * FOG_ROWS), c = e.companies.get(company);
    if (c) reveal(e, fresh, e.map.ports[c.home]);
    return { cols: FOG_COLS, rows: FOG_ROWS, seen: encode(fresh) };
  },
  cards(company) {
    const f = fogMaps.get(e)?.get(company);
    return [{ title: "Charted waters", detail: `You have charted ${Math.round((f ? seenCount(f) : 0) / (FOG_COLS * FOG_ROWS) * 100)}% of the sea. Send ships out to lift the fog.` }];
  },
});

export const CHART_PRICE = 1500;
/** Idea 243 (economy, off): buy the chart of a sea region; it lifts the fog there and marks any uncharted island in it. */
export const seaCharts: FeatureFactory = (e) => {
  const id = "world.sea-charts", bought = new Map<number, Set<number>>();
  return {
    id, ideas: [243], title: "Sea charts for sale", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      const rs = regions(e);
      if (!isInt(cmd.region, 0, rs.length - 1)) return fail("unknown sea region");
      const c = e.companies.get(cmd.company)!, have = bought.get(c.id) ?? new Set<number>();
      if (have.has(cmd.region)) return fail("you already own that chart");
      if (c.cash < CHART_PRICE) return fail("not enough cash");
      c.cash -= CHART_PRICE;
      have.add(cmd.region); bought.set(c.id, have);
      const { w, h } = bounds(e), f = fogOf(e, c.id);
      for (let y = 0; y < FOG_ROWS; y++) for (let x = 0; x < FOG_COLS; x++)
        if (regionOf(e, { x: (x + 0.5) * w / FOG_COLS, y: (y + 0.5) * h / FOG_ROWS }) === cmd.region) f[y * FOG_COLS + x] = 1;
      return { ok: true, spent: CHART_PRICE };
    },
    view: (company) => {
      const have = bought.get(company) ?? new Set<number>();
      return { regions: [...have], islands: islands(e).filter(i => have.has(regionOf(e, i))) };
    },
    cards(company) {
      const have = bought.get(company) ?? new Set<number>(), left = regions(e).filter(r => !have.has(r.id));
      return [{ title: "Chart maker", detail: `Admiralty charts cost ${CHART_PRICE} each. A chart lifts the fog over its region and marks any uncharted island.`,
        actions: left.length ? [action(id, "Buy chart", "buy", {}, [{ key: "region", label: "Region", options: left.map(r => ({ value: r.id, label: r.name })), value: left[0].id }])] : [] }];
    },
  };
};

// ------------------------------------------------------------ 248 buoys

export const MAX_BUOYS = 3, BUOY_HOURS = 72;
/** Idea 248: drop a labelled buoy where one of your ships is (three at a time, each lasting three days). */
export const buoys: FeatureFactory = (e) => {
  const id = "world.buoys";
  let list: { id: number; company: number; x: number; y: number; label: string; until: number }[] = [];
  let seq = 1;
  return {
    id, ideas: [248], title: "Buoys", economy: false,
    apply(cmd) {
      if (cmd.action === "remove") {
        const before = list.length;
        list = list.filter(b => !(b.id === cmd.buoy && b.company === cmd.company));
        return before === list.length ? fail("no such buoy of yours") : { ok: true };
      }
      if (cmd.action !== "drop") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships");
      if (!isInt(cmd.label, 0, CONTENT.buoyLabels.length - 1)) return fail("choose a label");
      if (list.filter(b => b.company === cmd.company).length >= MAX_BUOYS) return fail(`you have ${MAX_BUOYS} buoys out already`);
      const p = s.dest === null ? e.map.ports[s.port] : shipPos(e, s);
      list.push({ id: seq++, company: cmd.company, ...round1(p), label: CONTENT.buoyLabels[cmd.label], until: e.tick + BUOY_HOURS });
      return { ok: true };
    },
    advance() { list = list.filter(b => b.until > e.tick); },
    world: () => ({ buoys: list.map(b => ({ id: b.id, x: b.x, y: b.y, label: b.label, by: companyName(e, b.company), until: b.until })) }),
    cards(company) {
      const field = shipField(e, company), mine = list.filter(b => b.company === company);
      const actions = [...(field ? [action(id, "Drop a buoy", "drop", {}, [...field, { key: "label", label: "Label", options: CONTENT.buoyLabels.map((l, i) => ({ value: i, label: l })), value: 0 }])] : []),
        ...mine.map(b => action(id, `Lift buoy "${b.label}"`, "remove", { buoy: b.id }))];
      return [{ title: "Buoys", detail: `Mark the sea for everyone: up to ${MAX_BUOYS} buoys, each lasting ${BUOY_HOURS} hours. ${mine.length} out now.`, actions }];
    },
  };
};

// ------------------------------------------------------------ 244 beacons (economy)

export const BEACON_PRICE = 3000;
/** Idea 244 (economy, off): build a beacon light at a port; ships arriving there by night lose no time feeling their way in (1 hour quicker). */
export const beacons: FeatureFactory = (e) => {
  const id = "world.beacons", lit = new Map<number, number>();   // port -> builder
  return {
    id, ideas: [244], title: "Beacon lights", economy: true,
    apply(cmd) {
      if (cmd.action !== "build") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s || s.dest !== null) return fail("choose one of your docked ships");
      if (lit.has(s.port)) return fail("that port already has a beacon");
      const c = e.companies.get(cmd.company)!;
      if (c.cash < BEACON_PRICE) return fail("not enough cash");
      c.cash -= BEACON_PRICE; lit.set(s.port, c.id);
      return { ok: true, spent: BEACON_PRICE };
    },
    adjust: { travelHours: (v, ctx) => lit.has(ctx.dest) && calendar(e, e.tick + v).night ? Math.max(1, v - 1) : v },
    world: () => ({ beacons: [...lit].map(([port, by]) => ({ port, by: companyName(e, by) })) }),
    cards(company) {
      const field = shipField(e, company, s => s.dest === null && !lit.has(s.port));
      return [{ title: "Beacon lights", detail: `Build a beacon for ${BEACON_PRICE}; every ship arriving there at night docks an hour sooner. ${lit.size} lit.`,
        actions: field ? [action(id, "Build a beacon here", "build", {}, field)] : [] }];
    },
  };
};

// ------------------------------------------------------------ 250 radar ping (economy)

export const PING_PRICE = 100, PING_RANGE = 150;
/** Idea 250 (economy, off): pay for a radar ping from one ship; it lists every vessel within range for six hours. */
export const radarPing: FeatureFactory = (e) => {
  const id = "world.radar-ping", pings = new Map<number, { tick: number; ship: number; contacts: { ship: number; owner: string; pirate: boolean; x: number; y: number }[] }>();
  return {
    id, ideas: [250], title: "Radar ping", economy: true,
    apply(cmd) {
      if (cmd.action !== "ping") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships");
      const c = e.companies.get(cmd.company)!;
      if (c.cash < PING_PRICE) return fail("not enough cash");
      c.cash -= PING_PRICE;
      const at = s.dest === null ? e.map.ports[s.port] : shipPos(e, s);
      const contacts = [...e.ships.values()].filter(o => o.id !== s.id && o.dest !== null).map(o => ({ o, p: shipPos(e, o) }))
        .filter(({ p }) => dist(e, at, p) <= PING_RANGE).slice(0, 20)
        .map(({ o, p }) => ({ ship: o.id, owner: companyName(e, o.owner), pirate: o.type === "pirate", ...round1(p) }));
      pings.set(c.id, { tick: e.tick, ship: s.id, contacts });
      return { ok: true, spent: PING_PRICE };
    },
    advance() { for (const [c, p] of pings) if (e.tick - p.tick >= 6) pings.delete(c); },
    view: (company) => pings.get(company) ?? null,
    cards(company) {
      const field = shipField(e, company), p = pings.get(company);
      return [{ title: "Radar ping", detail: `${PING_PRICE} per ping: every vessel within ${PING_RANGE} miles of the ship, for six hours.${p ? ` Last ping: ${p.contacts.length} contacts.` : ""}`,
        actions: field ? [action(id, "Ping", "ping", {}, field)] : [] }];
    },
  };
};

// ------------------------------------------------------------ 259 ferries (economy)

export const FERRY_FEE = 40;
/** Archipelago pairs: directly joined ports in the same sea region whose lane is in the shortest quarter. */
export function ferryLanes(e: Engine) {
  const sorted = e.map.routes.map(r => r.distance).sort((a, b) => a - b), cut = sorted[Math.floor(sorted.length / 4)] ?? 0;
  return e.map.routes.filter(r => r.distance <= cut && regionOf(e, e.map.ports[r.a]) === regionOf(e, e.map.ports[r.b])).map(r => ({ a: r.a, b: r.b }));
}
const isFerry = (e: Engine, a: number, b: number) => ferryLanes(e).some(f => (f.a === a && f.b === b) || (f.a === b && f.b === a));
/** Idea 259 (economy, off): ferries work the short hops between archipelago islands: a quarter quicker, for a fee. */
export const ferries: FeatureFactory = (e) => ({
  id: "world.ferries", ideas: [259], title: "Archipelago ferries", economy: true,
  adjust: {
    travelHours: (v, ctx) => isFerry(e, ctx.from, ctx.dest) ? Math.max(1, Math.round(v * 0.75)) : v,
    portFee: (v, ctx) => isFerry(e, ctx.from, ctx.dest) ? v + FERRY_FEE : v,
  },
  world: () => ({ lanes: ferryLanes(e) }),
  cards: () => [{ title: "Archipelago ferries", detail: `${ferryLanes(e).length} short island hops have ferry pilots: 25% quicker, ${FERRY_FEE} extra in port fees.` }],
});

// ------------------------------------------------------------ 260 fast-travel licences (economy)

export const LICENCE_PRICE = 2500, LICENCE_HOURS = 168, MAX_LICENCES = 3;
/** Idea 260 (economy, off): a week's fast-travel licence for one lane: 20% quicker for your ships both ways. */
export const licences: FeatureFactory = (e) => {
  const id = "world.licences", held = new Map<number, { a: number; b: number; until: number }[]>();
  const has = (company: number, a: number, b: number) => (held.get(company) ?? []).some(l => l.until > e.tick && ((l.a === a && l.b === b) || (l.a === b && l.b === a)));
  return {
    id, ideas: [260], title: "Fast-travel licences", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      if (!isInt(cmd.route, 0, e.map.routes.length - 1)) return fail("unknown lane");
      const r = e.map.routes[cmd.route], c = e.companies.get(cmd.company)!;
      if (has(c.id, r.a, r.b)) return fail("you already hold that licence");
      const mine = (held.get(c.id) ?? []).filter(l => l.until > e.tick);
      if (mine.length >= MAX_LICENCES) return fail(`at most ${MAX_LICENCES} licences at once`);
      if (c.cash < LICENCE_PRICE) return fail("not enough cash");
      c.cash -= LICENCE_PRICE;
      mine.push({ a: r.a, b: r.b, until: e.tick + LICENCE_HOURS }); held.set(c.id, mine);
      return { ok: true, spent: LICENCE_PRICE };
    },
    advance() { for (const [c, l] of held) held.set(c, l.filter(x => x.until > e.tick)); },
    adjust: { travelHours: (v, ctx) => { const s = e.ships.get(ctx.ship); return s && has(s.owner, ctx.from, ctx.dest) ? Math.max(1, Math.round(v * 0.8)) : v; } },
    view: (company) => held.get(company) ?? [],
    cards(company): FeatureCard[] {
      const docked = fleet(e, company).filter(s => s.dest === null).map(s => s.port);
      const lanes = e.map.routes.map((r, i) => ({ r, i })).filter(({ r }) => docked.includes(r.a) || docked.includes(r.b)).slice(0, 12);
      return [{ title: "Fast-travel licences", detail: `${LICENCE_PRICE} buys a ${LICENCE_HOURS}-hour licence for one lane: your ships sail it 20% quicker. Up to ${MAX_LICENCES}.`,
        actions: lanes.length ? [action(id, "Buy licence", "buy", {}, [{ key: "route", label: "Lane", options: lanes.map(({ r, i }) => ({ value: i, label: `${portName(e, r.a)} – ${portName(e, r.b)}` })), value: lanes[0].i }])] : [] }];
    },
  };
};
