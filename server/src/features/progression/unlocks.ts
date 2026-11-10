// Unlock and bonus modules: the tech tree (131) and its bonuses (131, economy), licences (132) and licence fines (132,
// economy), remote islands unlocked late (139), skill points (387), cargo and route mastery (388, 389), veteran perks
// (400), heirlooms (382), a retired captain's legacy (381), prestige resets (140), daily login rewards (133) and
// offline progress (145). Everything that changes money, fuel, fees, capacity, upkeep or travel time is economy: true.
import { GOODS, type Good } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import type { HookContexts } from "../types.js";
import { content, type TechNode } from "./content.js";
import { DAY, fmt, tracker } from "./tracker.js";
import { action, fail, OK, ownerOf, pct, portName, shared } from "./shared.js";

/** Research points: 1 per delivery and 1 per 500 distance sailed. */
export const researchPoints = (deliveries: number, distance: number) => deliveries + Math.floor(distance / 500);

export const techTree: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e), spent = new Map<number, number>();
  const owned = (c: number) => sh.tech.get(c) ?? new Set<string>();
  const points = (c: number) => { const s = t.get(c); return researchPoints(s.deliveries, s.distance) - (spent.get(c) ?? 0); };
  const ready = (c: number, n: TechNode) => !owned(c).has(n.id) && n.requires.every(r => owned(c).has(r));
  return {
    id: "progression.tech-tree", ideas: [131], title: "Tech tree", economy: false,
    advance() { t.update(); },
    apply(cmd) {
      if (cmd.action !== "research") return fail("unknown action");
      const node = typeof cmd.node === "string" ? content().nodes.find(n => n.id === cmd.node) : undefined;
      if (!node) return fail("unknown research");
      if (owned(cmd.company).has(node.id)) return fail("already researched");
      if (!ready(cmd.company, node)) return fail("research the earlier nodes first");
      if (points(cmd.company) < node.cost) return fail(`needs ${node.cost} research points`);
      spent.set(cmd.company, (spent.get(cmd.company) ?? 0) + node.cost);
      const set = new Set(owned(cmd.company)); set.add(node.id); sh.tech.set(cmd.company, set);
      return OK;
    },
    cards(company) {
      const open = content().nodes.filter(n => ready(company, n));
      return [{ title: `Tech tree: ${points(company)} research points`,
        detail: `Researched ${owned(company).size} of ${content().nodes.length}. Points come from deliveries (1 each) and distance (1 per 500). Bonuses apply only if the tech-bonuses economy switch is on.`,
        actions: open.length ? [action("progression.tech-tree", "Research", "research", {}, [{ key: "node", label: "Node", options: open.map(n => ({ value: n.id, label: `${n.name} (${n.cost}): ${n.text}` })) }])] : [] }];
    },
    view(company) {
      return { points: points(company), nodes: content().nodes.map(n => ({ id: n.id, name: n.name, cost: n.cost, requires: n.requires, text: n.text, owned: owned(company).has(n.id), ready: ready(company, n) })) };
    },
  };
};

type Effect = "fuel" | "portFee" | "capacity" | "travelHours" | "upkeep";
/** Sum of tech effects of one kind for a company. */
export function techEffect(sh: ReturnType<typeof shared>, company: number | undefined, kind: Effect): number {
  if (company === undefined) return 0;
  let sum = 0;
  for (const id of sh.tech.get(company) ?? []) sum += content().nodes.find(n => n.id === id)?.effect?.[kind] ?? 0;
  return sum;
}
export const techBonuses: FeatureFactory = (e) => {
  const sh = shared(e);
  const ship = (kind: Effect) => (v: number, ctx: { ship: number }) => pct(v, techEffect(sh, ownerOf(e, ctx.ship), kind));
  return {
    id: "progression.tech-bonuses", ideas: [131], title: "Tech bonuses", economy: true,
    adjust: {
      fuel: ship("fuel"), travelHours: ship("travelHours"), capacity: ship("capacity"),
      portFee: (v, ctx) => pct(v, techEffect(sh, ctx.company, "portFee")),
      upkeep: (v, ctx) => pct(v, techEffect(sh, ctx.company, "upkeep")),
    },
  };
};

/** Licences everyone holds from the start: the starting hull classes and grain. Pirate ships need no licence. */
export const BASE_LICENCES = ["cargo:grain", "ship:coaster", "ship:freighter"];
export function licensed(sh: ReturnType<typeof shared>, company: number, licence: string): boolean {
  if (BASE_LICENCES.includes(licence) || licence === "ship:pirate") return true;
  for (const id of sh.tech.get(company) ?? []) if (content().nodes.find(n => n.id === id)?.licence === licence) return true;
  return false;
}
export const licences: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e), breaches = new Map<number, number>();
  return {
    id: "progression.licences", ideas: [132], title: "Licences", economy: false,
    advance() {
      t.update();
      for (const f of t.finished) {
        if (f.trip.good === null || licensed(sh, f.company, `cargo:${GOODS[f.trip.good]}`)) continue;
        breaches.set(f.company, (breaches.get(f.company) ?? 0) + 1);
      }
    },
    cards(company) {
      const all = content().nodes.filter(n => n.licence);
      const have = [...BASE_LICENCES, ...all.filter(n => licensed(sh, company, n.licence!)).map(n => n.licence!)];
      const c = e.companies.get(company);
      const unlicensedShips = (c?.ships ?? []).map(id => e.ships.get(id)).filter(s => s && !licensed(sh, company, `ship:${s.type}`)).length;
      return [{ title: "Licences",
        detail: `Held: ${[...new Set(have)].join(", ")}. Earn more in the tech tree.${breaches.get(company) ? ` Unlicensed deliveries: ${breaches.get(company)}.` : ""}${unlicensedShips ? ` Ships without a ticket: ${unlicensedShips}.` : ""}` }];
    },
    view(company) {
      return { held: [...BASE_LICENCES, ...content().nodes.filter(n => n.licence && licensed(sh, company, n.licence)).map(n => n.licence!)], breaches: breaches.get(company) ?? 0 };
    },
  };
};

export const LICENCE_FINE_SHARE = 0.05, LICENCE_FINE_MAX = 500;
export const licenceFines: FeatureFactory = (e) => {
  const t = tracker(e), sh = shared(e);
  return {
    id: "progression.licence-fines", ideas: [132], title: "Licence fines", economy: true,
    advance() {
      t.update();
      for (const f of t.finished) {
        if (f.trip.good === null || licensed(sh, f.company, `cargo:${GOODS[f.trip.good]}`)) continue;
        const c = e.companies.get(f.company);
        if (c) c.cash -= Math.min(LICENCE_FINE_MAX, Math.round(f.trip.earned * LICENCE_FINE_SHARE));
      }
    },
    cards() { return [{ title: "Licence fines", detail: `Delivering cargo without its licence is fined ${LICENCE_FINE_SHARE * 100}% of the sale, at most ${LICENCE_FINE_MAX}.` }]; },
  };
};

export const REMOTE_LEVEL = 8, REMOTE_XP = 50;
/** The most remote ports: highest average distance to the rest, the top fifth (at least one). */
export function remotePorts(dist: number[][]): number[] {
  const n = dist.length;
  const avg = dist.map((row, i) => { const d = row.filter((x, j) => j !== i && Number.isFinite(x)); return { i, a: d.length ? d.reduce((s, x) => s + x, 0) / d.length : 0 }; });
  return avg.sort((x, y) => y.a - x.a || x.i - y.i).slice(0, Math.max(1, Math.floor(n / 5))).map(x => x.i).sort((a, b) => a - b);
}
export const remoteIslands: FeatureFactory = (e) => {
  const t = tracker(e), landed = new Map<number, Set<number>>();
  let cached: number[] | undefined;
  const ports = () => (cached ??= remotePorts(e.dist));   // the engine builds distances after its modules
  return {
    id: "progression.remote-islands", ideas: [139], title: "Remote islands", economy: false,
    advance() {
      t.update();
      for (const id of e.companies.keys()) {
        if (t.level(id) < REMOTE_LEVEL) continue;
        const s = t.get(id), set = landed.get(id) ?? new Set<number>();
        for (const p of ports()) if (s.ports.has(p) && !set.has(p)) {
          // Only landfalls after the charts unlock count: check a ship is actually there now.
          const here = (e.companies.get(id)?.ships ?? []).some(sid => { const sh = e.ships.get(sid); return sh && sh.dest === null && sh.port === p; });
          if (here) { set.add(p); t.award(id, REMOTE_XP); }
        }
        if (set.size) landed.set(id, set);
      }
    },
    cards(company) {
      const remote = ports(), open = t.level(company) >= REMOTE_LEVEL, names = remote.map(p => portName(e, p)).join(", ");
      return [{ title: open ? "Remote islands charted" : `Remote islands: level ${REMOTE_LEVEL}`,
        detail: open ? `Your charts now show ${names}. First landfall at each gives ${REMOTE_XP} xp (${landed.get(company)?.size ?? 0} of ${remote.length}).`
          : `${remote.length} far-off ports stay uncharted until captain level ${REMOTE_LEVEL}; landfalls there earn nothing until then.` }];
    },
    view(company) { return { unlocked: t.level(company) >= REMOTE_LEVEL, landed: [...(landed.get(company) ?? [])].sort((a, b) => a - b) }; },
    world() { return { ports: ports(), level: REMOTE_LEVEL }; },
  };
};

export const SKILLS = ["fuel", "fees", "speed", "hold"] as const;
export const SKILL_STEP = 0.01, SKILL_MAX = 5;
export const skillPoints: FeatureFactory = (e) => {
  const t = tracker(e), spent = new Map<number, Record<string, number>>();
  const of = (c: number | undefined) => (c === undefined ? undefined : spent.get(c));
  const free = (c: number) => t.level(c) - 1 - Object.values(spent.get(c) ?? {}).reduce((a, b) => a + b, 0);
  const lvl = (c: number | undefined, k: string) => of(c)?.[k] ?? 0;
  return {
    id: "progression.skill-points", ideas: [387], title: "Skill points", economy: true,
    advance() { t.update(); },
    apply(cmd) {
      if (cmd.action !== "spend") return fail("unknown action");
      const skill = SKILLS.find(s => s === cmd.skill);
      if (!skill) return fail("choose a skill");
      if (free(cmd.company) < 1) return fail("no skill points left (one per level)");
      const cur = { ...(spent.get(cmd.company) ?? {}) };
      if ((cur[skill] ?? 0) >= SKILL_MAX) return fail("that skill is maxed");
      cur[skill] = (cur[skill] ?? 0) + 1;
      spent.set(cmd.company, cur);
      return OK;
    },
    cards(company) {
      return [{ title: `Skill points: ${free(company)} free`, detail: `One point per captain level. Each point: 1% less fuel, port fees or travel time, or 1% more hold space (max ${SKILL_MAX} each). `
        + SKILLS.map(s => `${s} ${lvl(company, s)}`).join(", ") + ".",
        actions: free(company) > 0 ? [action("progression.skill-points", "Spend a point", "spend", {}, [{ key: "skill", label: "Skill", options: SKILLS.map(s => ({ value: s, label: s })) }])] : [] }];
    },
    view(company) { return { free: free(company), spent: spent.get(company) ?? {} }; },
    adjust: {
      fuel: (v, ctx) => pct(v, -SKILL_STEP * lvl(ownerOf(e, ctx.ship), "fuel")),
      portFee: (v, ctx) => pct(v, -SKILL_STEP * lvl(ctx.company, "fees")),
      travelHours: (v, ctx) => pct(v, -SKILL_STEP * lvl(ownerOf(e, ctx.ship), "speed")),
      capacity: (v, ctx) => pct(v, SKILL_STEP * lvl(ownerOf(e, ctx.ship), "hold")),
    },
  };
};

export const MASTERY_TIERS = [500, 2000, 5000], MASTERY_STEP = 0.02;
export const masteryTier = (units: number) => MASTERY_TIERS.filter(x => units >= x).length;
export const cargoMastery: FeatureFactory = (e) => {
  const t = tracker(e);
  return {
    id: "progression.cargo-mastery", ideas: [388], title: "Cargo mastery", economy: true,
    advance() { t.update(); },
    cards(company) {
      const s = t.get(company);
      return [{ title: "Cargo mastery", detail: GOODS.map((g, i) => `${g}: tier ${masteryTier(s.goodUnits[i])}`).join(", ")
        + `. Tiers at ${MASTERY_TIERS.map(fmt).join(", ")} units; each tier cuts port fees ${MASTERY_STEP * 100}% for ships arriving with that cargo.` }];
    },
    view(company) { const s = t.get(company); return GOODS.map((g, i) => ({ good: g, units: s.goodUnits[i], tier: masteryTier(s.goodUnits[i]) })); },
    adjust: {
      portFee(v, ctx) {
        const ship = e.ships.get(ctx.ship);
        if (!ship || ship.good === null || ship.qty <= 0) return v;
        return pct(v, -MASTERY_STEP * masteryTier(t.get(ctx.company).goodUnits[ship.good] ?? 0));
      },
    },
  };
};

export const ROUTE_TIERS = [3, 10, 25], ROUTE_STEP = 0.02;
export const routeMastery: FeatureFactory = (e) => {
  const t = tracker(e);
  const tier = (company: number | undefined, from: number, to: number) => {
    if (company === undefined) return 0;
    const runs = t.get(company).routes.get(`${from}-${to}`) ?? 0;
    return ROUTE_TIERS.filter(x => runs >= x).length;
  };
  return {
    id: "progression.route-mastery", ideas: [389], title: "Route mastery", economy: true,
    advance() { t.update(); },
    cards(company) {
      const top = [...t.get(company).routes].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return [{ title: "Route mastery", detail: `Run a route often to sail it faster: tiers at ${ROUTE_TIERS.join(", ")} deliveries, ${ROUTE_STEP * 100}% quicker each.`
        + (top.length ? ` Your top routes: ${top.map(([r, n]) => { const [a, b] = r.split("-").map(Number); return `${portName(e, a)} to ${portName(e, b)} (${n})`; }).join(", ")}.` : "") }];
    },
    adjust: { travelHours: (v, ctx: HookContexts["travelHours"]) => pct(v, -ROUTE_STEP * tier(ownerOf(e, ctx.ship), ctx.from, ctx.dest)) },
  };
};

export const VETERAN_LEVEL = 15, VETERAN_CUT = 0.03;
export const veteranPerks: FeatureFactory = (e) => {
  const t = tracker(e);
  const vet = (c: number | undefined) => c !== undefined && (t.level(c) >= VETERAN_LEVEL || t.starsOf(c) > 0);
  return {
    id: "progression.veteran-perks", ideas: [400], title: "Veteran perks", economy: true,
    advance() { t.update(); },
    cards(company) { return [{ title: vet(company) ? "Veteran perks active" : "Veteran perks", detail: `Captains of level ${VETERAN_LEVEL}+ (or with a New Game+ star) burn ${VETERAN_CUT * 100}% less fuel and pay ${VETERAN_CUT * 100}% less upkeep.` }]; },
    adjust: {
      fuel: (v, ctx) => (vet(ownerOf(e, ctx.ship)) ? v * (1 - VETERAN_CUT) : v),
      upkeep: (v, ctx) => (vet(ctx.company) ? v * (1 - VETERAN_CUT) : v),
    },
  };
};

export const HEIRLOOMS = [
  { id: "compass", name: "Grandfather's compass", level: 5, effect: "fuel", value: -0.03 },
  { id: "bell", name: "Brass ship's bell", level: 10, effect: "portFee", value: -0.03 },
  { id: "chart", name: "Annotated sea chart", level: 20, effect: "travelHours", value: -0.02 },
  { id: "ledger", name: "Founder's ledger", level: 30, effect: "upkeep", value: -0.03 },
] as const;
export const HEIRLOOM_SLOTS = 2;
export const heirlooms: FeatureFactory = (e) => {
  const t = tracker(e), equipped = new Map<number, string[]>();
  const owned = (c: number) => HEIRLOOMS.filter(h => t.level(c) >= h.level).map(h => h.id as string);
  const bonus = (c: number | undefined, effect: string) => c === undefined ? 0
    : (equipped.get(c) ?? []).reduce((s, id) => s + (HEIRLOOMS.find(h => h.id === id && h.effect === effect)?.value ?? 0), 0);
  return {
    id: "progression.heirlooms", ideas: [382], title: "Heirlooms", economy: true,
    advance() { t.update(); },
    apply(cmd) {
      const item = typeof cmd.item === "string" ? cmd.item : "";
      const list = equipped.get(cmd.company) ?? [];
      if (cmd.action === "unequip") { if (!list.includes(item)) return fail("not equipped"); equipped.set(cmd.company, list.filter(i => i !== item)); return OK; }
      if (cmd.action !== "equip") return fail("unknown action");
      if (!owned(cmd.company).includes(item)) return fail("you have not found that heirloom");
      if (list.includes(item)) return fail("already equipped");
      if (list.length >= HEIRLOOM_SLOTS) return fail(`at most ${HEIRLOOM_SLOTS} heirlooms at once`);
      equipped.set(cmd.company, [...list, item]);
      return OK;
    },
    cards(company) {
      const have = owned(company), on = equipped.get(company) ?? [];
      const id = "progression.heirlooms";
      return [{ title: "Heirlooms", detail: HEIRLOOMS.map(h => `${h.name} (level ${h.level}): ${Math.abs(h.value * 100)}% ${h.effect}${on.includes(h.id) ? " [equipped]" : have.includes(h.id) ? "" : " [locked]"}`).join(". ") + `. Equip up to ${HEIRLOOM_SLOTS}.`,
        actions: [
          ...(have.filter(h => !on.includes(h)).length && on.length < HEIRLOOM_SLOTS ? [action(id, "Equip", "equip", {}, [{ key: "item", label: "Heirloom", options: have.filter(h => !on.includes(h)).map(h => ({ value: h, label: HEIRLOOMS.find(x => x.id === h)!.name })) }])] : []),
          ...on.map(h => action(id, `Put away ${HEIRLOOMS.find(x => x.id === h)!.name}`, "unequip", { item: h })),
        ] }];
    },
    view(company) { return { owned: owned(company), equipped: equipped.get(company) ?? [] }; },
    adjust: {
      fuel: (v, ctx) => pct(v, bonus(ownerOf(e, ctx.ship), "fuel")),
      travelHours: (v, ctx) => pct(v, bonus(ownerOf(e, ctx.ship), "travelHours")),
      portFee: (v, ctx) => pct(v, bonus(ctx.company, "portFee")),
      upkeep: (v, ctx) => pct(v, bonus(ctx.company, "upkeep")),
    },
  };
};

export const LEGACY_STEP_LEVELS = 10, LEGACY_CUT = 0.01, LEGACY_MAX = 5;
export const legacy: FeatureFactory = (e) => {
  const t = tracker(e), retired = new Map<number, number>();
  const count = (c: number | undefined) => (c === undefined ? 0 : retired.get(c) ?? 0);
  return {
    id: "progression.legacy", ideas: [381], title: "Captain's legacy", economy: true,
    advance() { t.update(); },
    apply(cmd) {
      if (cmd.action !== "retire") return fail("unknown action");
      const n = count(cmd.company);
      if (n >= LEGACY_MAX) return fail("your legacy is already complete");
      if (t.level(cmd.company) < LEGACY_STEP_LEVELS * (n + 1)) return fail(`your captain needs level ${LEGACY_STEP_LEVELS * (n + 1)} to retire`);
      retired.set(cmd.company, n + 1);
      return OK;
    },
    cards(company) {
      const n = count(company), need = LEGACY_STEP_LEVELS * (n + 1);
      return [{ title: `Captain's legacy: ${n} retired`, detail: `Each retired captain leaves ${LEGACY_CUT * 100}% lower upkeep and fuel for good (max ${LEGACY_MAX}). Next retirement at level ${need}.`,
        actions: n < LEGACY_MAX && t.level(company) >= need ? [action("progression.legacy", "Retire the captain", "retire")] : [] }];
    },
    view(company) { return { retired: count(company) }; },
    adjust: {
      upkeep: (v, ctx) => pct(v, -LEGACY_CUT * count(ctx.company)),
      fuel: (v, ctx) => pct(v, -LEGACY_CUT * count(ownerOf(e, ctx.ship))),
    },
  };
};

export const PRESTIGE_WORTH = 150_000, PRESTIGE_STEP = 0.03, PRESTIGE_MAX = 5;
export const prestige: FeatureFactory = (e) => {
  const levels = new Map<number, number>();
  const lvl = (c: number | undefined) => (c === undefined ? 0 : levels.get(c) ?? 0);
  return {
    id: "progression.prestige", ideas: [140], title: "Prestige", economy: true,
    apply(cmd) {
      if (cmd.action !== "prestige") return fail("unknown action");
      const c = e.companies.get(cmd.company);
      if (!c) return fail("no company");
      if (lvl(c.id) >= PRESTIGE_MAX) return fail("maximum prestige reached");
      if (e.netWorth(c) < PRESTIGE_WORTH) return fail(`prestige needs ${fmt(PRESTIGE_WORTH)} net worth`);
      c.cash = Math.min(c.cash, e.rules.company.start_cash);   // the reset: cash back to the starting purse
      levels.set(c.id, lvl(c.id) + 1);
      return OK;
    },
    cards(company) {
      const c = e.companies.get(company), n = lvl(company);
      return [{ title: `Prestige ${n}`, detail: `At ${fmt(PRESTIGE_WORTH)} net worth you may reset your cash to the starting ${fmt(e.rules.company.start_cash)} for a permanent ${PRESTIGE_STEP * 100}% larger hold on every ship (max ${PRESTIGE_MAX}). Ships are kept.`,
        actions: c && n < PRESTIGE_MAX && e.netWorth(c) >= PRESTIGE_WORTH ? [action("progression.prestige", "Prestige reset", "prestige")] : [] }];
    },
    view(company) { return { level: lvl(company) }; },
    adjust: { capacity: (v, ctx) => v * (1 + PRESTIGE_STEP * lvl(ownerOf(e, ctx.ship))) },
  };
};

export const LOGIN_BASE = 100, LOGIN_STREAK_STEP = 25, LOGIN_STREAK_MAX = 7;
export const dailyLogin: FeatureFactory = (e) => {
  const last = new Map<number, { day: number; streak: number }>();
  const today = () => Math.floor(e.tick / DAY);
  const reward = (streak: number) => LOGIN_BASE + LOGIN_STREAK_STEP * (Math.min(streak, LOGIN_STREAK_MAX) - 1);
  return {
    id: "progression.daily-login", ideas: [133], title: "Daily reward", economy: true,
    apply(cmd) {
      if (cmd.action !== "claim") return fail("unknown action");
      const c = e.companies.get(cmd.company);
      if (!c) return fail("no company");
      const prev = last.get(c.id), d = today();
      if (prev?.day === d) return fail("already claimed today");
      const streak = prev && prev.day === d - 1 ? prev.streak + 1 : 1;
      last.set(c.id, { day: d, streak });
      c.cash += reward(streak);
      return { ok: true, earned: reward(streak) };
    },
    cards(company) {
      const prev = last.get(company), d = today();
      if (prev?.day === d) return [{ title: "Daily reward claimed", detail: `Streak: ${prev.streak} days. Come back tomorrow.` }];
      const streak = prev && prev.day === d - 1 ? prev.streak + 1 : 1;
      return [{ title: "Daily reward", detail: `Claim ${reward(streak)} credits (day ${streak} of your streak; it grows for ${LOGIN_STREAK_MAX} days).`, actions: [action("progression.daily-login", "Claim", "claim")] }];
    },
    view(company) { return last.get(company) ?? null; },
  };
};

export const AWAY_HOURS = 72, AWAY_BUDGET = 50_000;
export const offlineProgress: FeatureFactory = (e) => {
  const away = new Map<number, number>();   // company -> tick away mode ends
  return {
    id: "progression.offline-progress", ideas: [145], title: "Offline progress", economy: true,
    apply(cmd) {
      if (cmd.action === "back") return away.delete(cmd.company) ? OK : fail("away mode is off");
      if (cmd.action !== "away") return fail("unknown action");
      away.set(cmd.company, e.tick + AWAY_HOURS);
      return OK;
    },
    advance() {
      for (const [company, until] of away) {
        const c = e.companies.get(company);
        if (!c || e.tick >= until) { away.delete(company); continue; }
        const trips = e.trips.get(company) ?? [];
        for (const id of c.ships) {
          const s = e.ships.get(id);
          if (!s || s.type === "pirate" || s.dest !== null || s.qty > 0 || e.voyageQueues.has(id) || e.seasonOver) continue;
          const last = [...trips].reverse().find(tr => tr.ship === id && !tr.open && tr.good !== null && tr.qty > 0 && tr.earned > tr.spent);
          if (!last) continue;
          const good = GOODS[last.good!] as Good;
          const qty = Math.floor(Math.min(last.qty, e.expansionCapacity(s)));
          const leg = s.port === last.from ? { dest: last.to, buy: { good, qty } } : s.port === last.to ? { dest: last.from } : null;
          if (!leg || qty < 1) continue;
          e.apply({ type: "setVoyageQueue", company, ship: id, legs: [{ ...leg, maxSpend: Math.max(0, Math.min(c.cash, AWAY_BUDGET)), minProceeds: 0 }] });
        }
      }
    },
    cards(company) {
      const until = away.get(company);
      return [{ title: until ? `Away mode: ${until - e.tick} h left` : "Offline progress",
        detail: `While you are away (up to ${AWAY_HOURS} h), each docked, empty ship repeats its last profitable run through the voyage queue (normal fees, fuel and prices).`,
        actions: [until ? action("progression.offline-progress", "I'm back", "back") : action("progression.offline-progress", "Go away", "away")] }];
    },
    view(company) { return { until: away.get(company) ?? null }; },
  };
};
