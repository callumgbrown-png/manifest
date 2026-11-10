// Operations: feature flags and A/B tests, state checkpoints (for replays, rollbacks, backups and seed-based
// reproducible worlds), a built-in determinism self-test (the regression check behind the pre-deploy checklist),
// the admin console summary and the debug overlay switch. Nothing here changes money, cargo or prices.
import { readFileSync } from "node:fs";
import { Engine, GOODS } from "../../engine.js";
import { checkInvariants } from "./integrity.js";
import { flaggedCompanies, hash, isHouseBot, type PlatformFactory, type PlatformModule } from "./shared.js";

const pushCapped = <T>(list: T[], item: T, cap: number) => { list.push(item); if (list.length > cap) list.splice(0, list.length - cap); };

// ------------------------------------------------------------ 197, 581: feature flags and A/B tests

export interface Experiment { id: string; variants: string[]; /** percent of companies included, 0-100 */ share: number; note?: string }
const DEFAULT_EXPERIMENTS: Experiment[] = [
  { id: "advice-panel-order", variants: ["profit-first", "time-first"], share: 100, note: "Which order of the best-trips list keeps new players trading?" },
  { id: "welcome-tip", variants: ["none", "short", "long"], share: 50, note: "Does a first-day tip help?" },
];
function loadExperiments(): Experiment[] {
  try {
    const data = JSON.parse(readFileSync(new URL("../../../../config/content/platform/experiments.json", import.meta.url), "utf8")) as { experiments?: unknown };
    if (!Array.isArray(data.experiments)) return DEFAULT_EXPERIMENTS;
    const ok = data.experiments.filter((x): x is Experiment => !!x && typeof x === "object"
      && typeof (x as Experiment).id === "string" && /^[a-z0-9-]{1,40}$/.test((x as Experiment).id)
      && Array.isArray((x as Experiment).variants) && (x as Experiment).variants.length >= 2 && (x as Experiment).variants.every(v => typeof v === "string")
      && Number.isFinite((x as Experiment).share) && (x as Experiment).share >= 0 && (x as Experiment).share <= 100);
    return ok.length ? ok : DEFAULT_EXPERIMENTS;
  } catch { return DEFAULT_EXPERIMENTS; }
}

/** The variant a company sees in an experiment, or null if it is outside the experiment's share. Stable forever. */
export function variantOf(x: Experiment, company: number): string | null {
  const h = hash(`${x.id}:${company}`);
  if (h % 100 >= x.share) return null;
  return x.variants[Math.floor(h / 100) % x.variants.length];
}

export const experiments: PlatformFactory = (e) => {
  const list = loadExperiments();
  return {
    id: "platform.experiments", ideas: [197, 581], title: "Experiments", economy: false,
    // The client reads its variants and the server's switched-on features (feature flags) from here.
    view: (company) => ({ variants: Object.fromEntries(list.map(x => [x.id, variantOf(x, company)])) }),
    world: () => ({ flags: e.features.list() }),
    admin: () => ({
      experiments: list.map(x => {
        const groups = new Map<string, { n: number; worth: number }>();
        for (const c of e.companies.values()) {
          if (isHouseBot(c)) continue;
          const v = variantOf(x, c.id);
          if (!v) continue;
          const g = groups.get(v) ?? { n: 0, worth: 0 };
          g.n++; g.worth += e.netWorth(c);
          groups.set(v, g);
        }
        return { ...x, results: [...groups].map(([variant, g]) => ({ variant, companies: g.n, averageWorth: Math.round(g.worth / g.n) })) };
      }),
    }),
  };
};

// ------------------------------------------------------------ 200, 561, 584, 586, 589: checkpoints
// The digest is what tools/platform/replay.ts, rollback.ts and the simulator's replay files (sim/personas.ts) check.

/** A short fingerprint of the whole world state. Two engines with the same digest at the same tick are the same. */
export function stateDigest(e: Engine): string {
  const parts = [
    e.tick,
    [...e.companies.values()].map(c => [c.id, Math.round(c.cash * 100), c.ships]),
    [...e.ships.values()].map(s => [s.id, s.owner, s.port, s.dest, s.good, Math.round(s.qty * 1000), s.departTick]),
    e.stock.map(row => row.map(x => Math.round(x * 1000))),
    [...e.orders.values()].map(o => [o.id, o.owner, o.port, o.good, Math.round(o.qty * 1000), Math.round(o.price * 100), o.side]),
  ];
  const text = JSON.stringify(parts);
  return (hash(text).toString(16).padStart(8, "0") + hash(text.split("").reverse().join("")).toString(16).padStart(8, "0"));
}

/** The world's seed (random-season maps carry one; the classic map is seed 7, as main.ts reports it). */
export function worldSeed(e: Engine): unknown {
  const m = e.map as unknown as { generation?: { seed?: unknown }; seed?: unknown };
  return m.generation?.seed ?? m.seed ?? 7;
}

export const checkpoints: PlatformFactory = (e) => {
  const list: { tick: number; digest: string }[] = [];
  const take = () => { if (list.at(-1)?.tick !== e.tick) pushCapped(list, { tick: e.tick, digest: stateDigest(e) }, 24 * 14); };
  return {
    id: "platform.checkpoints", ideas: [200, 561, 584, 586, 589], title: "Checkpoints", economy: false,
    enable: take, advance: take,
    world: () => ({ seed: worldSeed(e), latest: list.at(-1) ?? null }),
    admin: () => ({ seed: worldSeed(e), checkpoints: list.slice(-48),
      tools: ["npx tsx ../tools/platform/replay.ts (session replay to a tick)", "npx tsx ../tools/platform/rollback.ts (rollback to a checkpoint)",
        "npx tsx ../tools/platform/backup.ts (save backups)"] }),
  };
};

// ------------------------------------------------------------ 582, 590: determinism self-test

/** Runs a fixed scenario twice in fresh engines built from this world's rules and map and compares them.
 *  Returns the problems found (empty = passed). Exported for the pre-deploy tool and tests. */
export function selfTest(rules: Engine["rules"], map: Engine["map"], hours = 30): string[] {
  const run = () => {
    const x = new Engine(structuredClone(rules), map);
    const a = x.apply({ type: "register", name: "Selftest A", startPort: 0 });
    const b = x.apply({ type: "register", name: "Selftest B", startPort: Math.min(1, x.n - 1) });
    if (!a.ok || !b.ok) return { x, digest: "register failed", trace: [] as string[] };
    const trace: string[] = [];
    for (let h = 0; h < hours; h++) {
      for (const id of [a.id!, b.id!]) {
        const c = x.companies.get(id)!;
        for (const sid of c.ships) {
          const s = x.ships.get(sid)!;
          if (s.dest !== null) continue;
          if (s.qty > 0) { x.apply({ type: "sell", company: id, ship: sid }); continue; }
          const dest = x.dist[s.port].findIndex((d, i) => i !== s.port && Number.isFinite(d));
          const g = (h + id) % GOODS.length;
          const qty = Math.floor(Math.min(20, x.stock[s.port][g]));
          const r = x.apply({ type: "sail", company: id, ship: sid, dest, ...(qty >= 1 ? { buy: { good: GOODS[g], qty } } : {}) });
          trace.push(`${h}:${id}:${r.ok}`);
        }
      }
      x.advance();
    }
    return { x, digest: stateDigest(x), trace };
  };
  const one = run(), two = run(), out: string[] = [];
  if (one.digest !== two.digest) out.push(`replay diverged: ${one.digest} vs ${two.digest}`);
  if (one.trace.join() !== two.trace.join()) out.push("the same commands gave different results");
  for (const v of checkInvariants(one.x)) out.push(`invariant ${v.kind}: ${v.detail}`);
  return out.slice(0, 20);
}

export const selfTestModule: PlatformFactory = (e) => {
  let last: { tick: number; passed: boolean; problems: string[] } | null = null;
  const runIt = () => { const problems = selfTest(e.rules, e.map); last = { tick: e.tick, passed: problems.length === 0, problems }; };
  return {
    id: "platform.self-test", ideas: [582, 590], title: "Self-test", economy: false,
    enable: runIt,
    advance() { if (e.tick % 24 === 0) runIt(); },
    world: () => last ? { tick: last.tick, passed: last.passed } : null,
    admin: () => ({ last, checklist: "docs/platform/predeploy-checklist.md" }),
  };
};

// ------------------------------------------------------------ 588: admin console, 587: debug overlay

/** Admin data from every switched-on module that offers it (served to /api/admin/features with the admin token). */
export function adminData(e: Engine): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of e.features.active() as PlatformModule[]) if (typeof m.admin === "function") out[m.id] = m.admin();
  return out;
}

export const adminConsole: PlatformFactory = (e) => ({
  id: "platform.admin-console", ideas: [588], title: "Admin console", economy: false,
  admin: () => ({
    tick: e.tick, featuresOn: e.features.list().length, featuresTotal: e.features.modules.size,
    flagged: flaggedCompanies(e).length, companies: e.companies.size, ships: e.ships.size,
  }),
});

/** The debug overlay is drawn by public/features/platform.js; the server sends a few numbers to show. */
export const debugOverlay: PlatformFactory = (e) => ({
  id: "platform.debug-overlay", ideas: [587], title: "Debug overlay", economy: false,
  world: () => ({ tick: e.tick, ships: e.ships.size, atSea: [...e.ships.values()].filter(s => s.dest !== null).length,
    orders: e.orders.size, features: e.features.list().length }),
});
