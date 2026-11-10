import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import {
  GOOD, action, addRep, arrivals, content, day, dockedPorts, exhibit, fail, hasResearch, hash, ownDocked, portName,
  shared, shipOptions, sites, takeCargo, workShip,
} from "./shared.js";

/** Forecast index into content.weather for a port and day (calm is likelier than a gale). */
export const weatherAt = (e: Engine, port: number, d: number) => Math.min(content.weather.length - 1, Math.floor(hash(131, port, d) ** 1.6 * content.weather.length));

/** 271 a weather station: a forecast for today and tomorrow at your ports (and the day after with Tide tables). */
export const weatherStation: FeatureFactory = (e) => ({
  id: "ports.weather", ideas: [271], title: "Weather station", economy: false,
  cards(company) {
    const ports = dockedPorts(e, company);
    if (!ports.length) return [];
    const days = hasResearch(e, company, "tides") ? 3 : 2, d0 = day(e);
    return [{ title: "Weather station", detail: ports.map(p => `${portName(e, p)}: ${Array.from({ length: days }, (_, i) => content.weather[weatherAt(e, p, d0 + i)]).join(" / ")}`).join("\n") + "\nToday / tomorrow" + (days > 2 ? " / the day after" : "") }];
  },
  view: (company) => ({ days: hasResearch(e, company, "tides") ? 3 : 2 }),
  world: () => ({ today: e.map.ports.map(p => weatherAt(e, p.id, day(e))), names: content.weather }),
});

export const breakerPorts = (e: Engine) => sites(e, 137, 0.25);

/** 275 a shipbreaking yard: retire a ship at a breaker's yard. It is scrapped at the usual scrap price, and the
 *  yard puts a plaque in the museum and thanks you with standing. */
export const shipbreaking: FeatureFactory = (e) => {
  const id = "ports.shipbreaking";
  const broken = new Map<number, number>();
  return {
    id, ideas: [275], title: "Shipbreaking yard", economy: false,
    apply(cmd) {
      if (cmd.action !== "break") return fail("unknown action");
      const s = workShip(e, cmd.company, cmd.ship);
      if (!s || !breakerPorts(e).includes(s.port)) return fail("choose a ship docked at a breaker's yard");
      const port = s.port, type = s.type, name = e.companies.get(cmd.company)!.name;
      const r = e.apply({ type: "scrapShip", company: cmd.company, ship: s.id });
      if (!r.ok) return r;
      broken.set(cmd.company, (broken.get(cmd.company) ?? 0) + 1);
      addRep(e, cmd.company, port, 5);
      exhibit(e, "breaker", cmd.company, `${name}'s ${type} #${s.id} was broken up at ${portName(e, port)}`);
      return r;
    },
    cards(company) {
      return dockedPorts(e, company).filter(p => breakerPorts(e).includes(p)).map(port => {
        const ships = ownDocked(e, company, port).filter(s => !s.qty);
        return { title: `Breaker's yard · ${portName(e, port)}`, detail: "Retire an empty ship here (usual scrap price). The museum keeps a plaque.",
          actions: ships.length && (e.companies.get(company)?.ships.length ?? 0) > 1 ? [{ ...action(id, "Break up a ship", "break"), fields: [{ key: "ship", label: "Ship", options: shipOptions(ships) }] }] : [] };
      });
    },
    view: (company) => ({ broken: broken.get(company) ?? 0 }),
    world: () => ({ yards: breakerPorts(e) }),
  };
};

export const navalBases = (e: Engine) => sites(e, 139, 0.2);
/** The four ports nearest a base by sea. */
const watched = (e: Engine, base: number) => e.map.ports.map(p => p.id).filter(p => Number.isFinite(e.dist[base][p])).sort((a, b) => e.dist[base][a] - e.dist[base][b] || a - b).slice(0, 5);

/** 277 a naval base: a patrol bulletin of pirate ships in the base's waters, and standing for captains who call in
 *  to report (once a day). */
export const navalBase: FeatureFactory = (e) => {
  const id = "ports.naval-base";
  const reported = new Map<number, number>();
  const bulletin = (base: number) => {
    const area = watched(e, base);
    return [...e.ships.values()].filter(s => s.type === "pirate" && (area.includes(s.port) || (s.dest !== null && area.includes(s.dest))))
      .map(s => s.dest === null ? `pirate #${s.id} in ${portName(e, s.port)}` : `pirate #${s.id} bound for ${portName(e, s.dest)}`);
  };
  return {
    id, ideas: [277], title: "Naval base", economy: false,
    apply(cmd) {
      if (cmd.action !== "report") return fail("unknown action");
      const base = navalBases(e).find(b => ownDocked(e, cmd.company, b).length);
      if (base === undefined) return fail("dock a ship at a naval base");
      if (reported.get(cmd.company) === day(e)) return fail("you reported in today");
      reported.set(cmd.company, day(e));
      addRep(e, cmd.company, base, bulletin(base).length ? 3 : 1);
      return { ok: true };
    },
    cards(company) {
      return navalBases(e).filter(b => ownDocked(e, company, b).length).map(base => {
        const b = bulletin(base);
        return { title: `Naval base · ${portName(e, base)}`, detail: `Patrol bulletin: ${b.length ? b.join("; ") : "no pirates in these waters"}.`,
          actions: reported.get(company) !== day(e) ? [action(id, "Report in to the duty officer", "report")] : [] };
      });
    },
    world: () => ({ bases: navalBases(e) }),
  };
};

export const institutePorts = (e: Engine) => sites(e, 149, 0.25);

/** 278 a research institute: donate cargo for research points (machinery counts double) and unlock topics:
 *  Tide tables (longer forecasts), Signal lamps (see further from lighthouses), Market survey (an extra tavern tip). */
export const research: FeatureFactory = (e) => {
  const id = "ports.research";
  const points = new Map<number, number>();
  return {
    id, ideas: [278], title: "Research institute", economy: false,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (cmd.action === "donate") {
        const s = workShip(e, c.id, cmd.ship);
        if (!s || !institutePorts(e).includes(s.port) || s.good === null || s.qty < 1) return fail("choose a loaded ship docked at an institute");
        const qty = s.qty, worth = s.good === GOOD.machinery ? 2 * qty : qty, port = s.port;
        takeCargo(e, s, qty);
        points.set(c.id, (points.get(c.id) ?? 0) + worth);
        addRep(e, c.id, port, Math.ceil(qty / 4));
        return { ok: true, sold: qty };
      }
      if (cmd.action === "study") {
        const topic = content.research.find(t => t.id === cmd.topic);
        if (!topic) return fail("unknown topic");
        const set = shared(e).research.get(c.id) ?? new Set<string>();
        if (set.has(topic.id)) return fail("already studied");
        if ((points.get(c.id) ?? 0) < topic.points) return fail(`needs ${topic.points} research points`);
        points.set(c.id, points.get(c.id)! - topic.points);
        set.add(topic.id);
        shared(e).research.set(c.id, set);
        exhibit(e, "research", c.id, `${c.name} published ${topic.name}`);
        return { ok: true };
      }
      return fail("unknown action");
    },
    cards(company) {
      const have = shared(e).research.get(company) ?? new Set<string>(), pts = points.get(company) ?? 0;
      const here = dockedPorts(e, company).filter(p => institutePorts(e).includes(p));
      const loaded = here.flatMap(p => ownDocked(e, company, p)).filter(s => s.qty > 0);
      const open = content.research.filter(t => !have.has(t.id));
      return [{ title: "Research institute", detail: `${pts} research points. Institutes: ${institutePorts(e).map(p => portName(e, p)).join(", ")}.\n${content.research.map(t => `${have.has(t.id) ? "✓" : "·"} ${t.name} (${t.points}): ${t.text}`).join("\n")}`,
        actions: [
          ...(loaded.length ? [{ ...action(id, "Donate the cargo", "donate"), fields: [{ key: "ship", label: "Ship", options: shipOptions(loaded) }] }] : []),
          ...open.filter(t => t.points <= pts).map(t => action(id, `Study ${t.name}`, "study", { topic: t.id })),
        ] }];
    },
    view: (company) => ({ points: points.get(company) ?? 0, topics: [...(shared(e).research.get(company) ?? [])].sort() }),
  };
};

/** 279 a museum of player achievements: completed projects, launches, records and other milestones from the port modules. */
export const museum: FeatureFactory = (e) => ({
  id: "ports.museum", ideas: [279], title: "Museum", economy: false,
  cards() {
    const m = shared(e).museum.slice(-8).reverse(), rec = [...shared(e).records];
    return [{ title: "Harbour museum", detail: `${m.length ? m.map(x => `Day ${Math.floor(x.tick / 24) + 1}: ${x.text}`).join("\n") : "The halls are empty. Make history."}${rec.length ? `\nRecords: ${rec.map(([g, r]) => `${g} ${r.score} by ${e.companies.get(r.company)?.name ?? "?"}`).join(", ")}` : ""}` }];
  },
  world: () => ({ exhibits: shared(e).museum.slice(-20), records: Object.fromEntries([...shared(e).records].map(([g, r]) => [g, { score: r.score, company: e.companies.get(r.company)?.name ?? "?" }])) }),
});

export const SKYLINE_STEPS = [0, 50, 150, 400, 900, 2000];

/** 280 a port skyline that grows with prosperity: cargo landed at a port builds it up (slowly fading), level 0-5. */
export const skyline: FeatureFactory = (e) => {
  const prosperity = new Map<number, number>();
  const level = (p: number) => { const v = prosperity.get(p) ?? 0; let l = 0; SKYLINE_STEPS.forEach((t, i) => { if (v >= t) l = i; }); return l; };
  return {
    id: "ports.skyline", ideas: [280], title: "Port skylines", economy: false,
    advance() {
      for (const s of arrivals(e)) if (s.qty > 0) {
        const before = level(s.port);
        prosperity.set(s.port, (prosperity.get(s.port) ?? 0) + s.qty);
        if (level(s.port) > before && level(s.port) >= 3) exhibit(e, "skyline", s.owner, `${portName(e, s.port)}'s skyline grew to level ${level(s.port)} with a delivery from ${e.companies.get(s.owner)?.name}`);
      }
      if (e.tick % 24 === 0) for (const [p, v] of prosperity) prosperity.set(p, Math.floor(v * 0.98));
    },
    cards(company) {
      const ports = dockedPorts(e, company);
      return ports.length ? [{ title: "Skylines", detail: ports.map(p => `${portName(e, p)}: level ${level(p)} of 5`).join(", ") + ". Cargo landed makes a port grow." }] : [];
    },
    world: () => ({ levels: e.map.ports.map(p => level(p.id)) }),
  };
};
