// Scheduled world events with no money or time effect (their economy halves are in economy-events.ts).
import type { Engine } from "../../engine.js";
import type { FeatureCard } from "../../expansion-cards.js";
import type { FeatureFactory } from "../types.js";
import { action, addNews, alongside, clock, companyName, connected, fail, fleet, GOODS_NAMES, hash, isInt, ownShip, portBy, portName,
  quarterHours, seaPoint, shipField, shipPos, slotsBetween, type SlotSpec } from "./shared.js";

// ------------------------------------------------------------ 251 distress beacons, 328 shipwreck rescue

export const DISTRESS_HOURS = 24, DISTRESS_COOLDOWN = 48;
export const RESCUE_SPEC: SlotSpec = { period: 120, duration: 24, salt: 1401, chance: 0.6, offset: 20 };
export const rescueSite = (e: Engine, index: number) => seaPoint(e, 1400 + index, 0.25, 0.75);

/** Ideas 251 and 328: a ship at sea can raise a distress beacon that other captains answer by coming alongside, and
 *  now and then a stricken vessel's crew waits on the lanes for the first ship to pick them up. Medals, no money. */
export const rescue: FeatureFactory = (e) => {
  const id = "world.rescue";
  const beacons = new Map<number, { company: number; raised: number }>();   // ship -> beacon
  const lastRaised = new Map<number, number>();
  const medals = new Map<number, number>();
  const rescued = new Map<number, { company: number; tick: number }>();     // rescue slot -> rescuer
  const medal = (c: number) => medals.set(c, (medals.get(c) ?? 0) + 1);
  const stricken = () => slotsBetween(RESCUE_SPEC, e.tick, e.tick + 1).filter(s => !rescued.has(s.index)).map(s => ({ index: s.index, ends: s.ends, ...rescueSite(e, s.index) }));
  addNews(e, id, () => [
    ...slotsBetween(RESCUE_SPEC, Math.max(0, e.tick - 48), e.tick + 1).map(s => ({ tick: s.starts, kind: "rescue", text: rescued.has(s.index)
      ? `${companyName(e, rescued.get(s.index)!.company)} picked up the crew of a stricken coaster.` : "Mayday: a coaster is foundering on the lanes. Crew waiting for rescue." })),
  ]);
  return {
    id, ideas: [251, 328], title: "Distress and rescue", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships");
      switch (cmd.action) {
        case "distress": {
          if (s.dest === null) return fail("only a ship at sea can call for help");
          if (beacons.has(s.id)) return fail("that ship's beacon is already flashing");
          if (e.tick - (lastRaised.get(cmd.company) ?? -1e9) < DISTRESS_COOLDOWN) return fail("your last call for help was too recent");
          beacons.set(s.id, { company: cmd.company, raised: e.tick }); lastRaised.set(cmd.company, e.tick);
          return { ok: true };
        }
        case "answer": {
          if (!isInt(cmd.beacon, 0, 1e9) || !beacons.has(cmd.beacon)) return fail("that beacon is not flashing");
          const b = beacons.get(cmd.beacon)!, target = e.ships.get(cmd.beacon);
          if (b.company === cmd.company) return fail("you cannot answer your own beacon");
          if (!target || target.dest === null || !alongside(e, s, shipPos(e, target))) return fail("come alongside the ship in distress first");
          beacons.delete(cmd.beacon); medal(cmd.company);
          return { ok: true };
        }
        case "rescue": {
          const site = stricken().find(x => alongside(e, s, x));
          if (!site) return fail("there is no stricken crew alongside");
          rescued.set(site.index, { company: cmd.company, tick: e.tick }); medal(cmd.company);
          return { ok: true };
        }
      }
      return fail("unknown action");
    },
    advance() {
      for (const [sid, b] of beacons) { const s = e.ships.get(sid); if (!s || s.dest === null || e.tick - b.raised >= DISTRESS_HOURS) beacons.delete(sid); }
    },
    world: () => ({
      beacons: [...beacons].map(([ship, b]) => { const s = e.ships.get(ship)!; const p = shipPos(e, s); return { ship, by: companyName(e, b.company), x: Math.round(p.x), y: Math.round(p.y) }; }),
      stricken: stricken(),
    }),
    view: (company) => ({ medals: medals.get(company) ?? 0 }),
    cards(company): FeatureCard[] {
      const atSea = shipField(e, company, s => s.dest !== null), mine = fleet(e, company);
      const answerable = [...beacons].filter(([sid, b]) => b.company !== company && mine.some(m => alongside(e, m, shipPos(e, e.ships.get(sid)!))));
      const near = stricken().flatMap(st => mine.filter(m => alongside(e, m, st)).map(m => ({ st, m })));
      return [{ title: "Distress and rescue", detail: `Lifeboat medals: ${medals.get(company) ?? 0}. ${beacons.size} beacon${beacons.size === 1 ? "" : "s"} flashing, ${stricken().length} crew${stricken().length === 1 ? "" : "s"} adrift.`,
        actions: [
          ...(atSea ? [action(id, "Raise a distress beacon", "distress", {}, atSea)] : []),
          ...answerable.slice(0, 3).flatMap(([sid]) => { const helper = mine.find(m => alongside(e, m, shipPos(e, e.ships.get(sid)!)))!; return [action(id, `Answer ship ${sid} with ship ${helper.id}`, "answer", { ship: helper.id, beacon: sid })]; }),
          ...near.slice(0, 2).map(n => action(id, `Pick up the crew with ship ${n.m.id}`, "rescue", { ship: n.m.id })),
        ] }];
    },
  };
};

// ------------------------------------------------------------ 321 regatta

export const REGATTA_SPEC: SlotSpec = { period: 168, duration: 72, salt: 1501, chance: 1, offset: 48 };
export const ENTRY_HOURS = 24;
export function regattaCourse(e: Engine, index: number) {
  const ports = connected(e), from = portBy(e, 1502, index);
  const options = ports.filter(p => p !== from && Number.isFinite(e.dist[from][p]));
  return { from, to: options[Math.floor(hash(1503, index) * options.length)] ?? from };
}
/** Idea 321: a weekly regatta between two ports. Enter a ship docked at the start in the day before the gun, sail
 *  it to the finish; the first three home take gold, silver and bronze. Trophies only. */
export const regatta: FeatureFactory = (e) => {
  const id = "world.regatta";
  const races = new Map<number, { entries: Map<number, number>; sailing: Set<number>; finish: { ship: number; company: number; tick: number }[] }>();
  const trophies = new Map<number, number[]>();   // company -> [gold, silver, bronze]
  const race = (i: number) => { let r = races.get(i); if (!r) { r = { entries: new Map(), sailing: new Set(), finish: [] }; races.set(i, r); } return r; };
  /** The race open for entries or under way. */
  const current = () => slotsBetween(REGATTA_SPEC, e.tick, e.tick + ENTRY_HOURS + 1)[0];
  addNews(e, id, () => {
    const out = [];
    for (const [i, r] of races) if (r.finish.length) {
      const s = slotsBetween(REGATTA_SPEC, 0, e.tick + 1).find(x => x.index === i);
      if (s) out.push({ tick: Math.min(e.tick, r.finish[0].tick), kind: "sport", text: `Regatta won by ship ${r.finish[0].ship} of ${companyName(e, r.finish[0].company)}.` });
    }
    const c = current();
    if (c) { const k = regattaCourse(e, c.index); out.push({ tick: Math.max(0, c.starts - ENTRY_HOURS), kind: "sport", text: `Regatta: ${portName(e, k.from)} to ${portName(e, k.to)}, starting ${clock(c.starts)}.` }); }
    return out;
  });
  return {
    id, ideas: [321], title: "Regatta", economy: false,
    apply(cmd) {
      if (cmd.action !== "enter") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s) return fail("choose one of your ships");
      const c = current();
      if (!c || e.tick >= c.starts) return fail("entries are closed");
      const k = regattaCourse(e, c.index);
      if (s.dest !== null || s.port !== k.from) return fail(`dock at ${portName(e, k.from)} to enter`);
      const r = race(c.index);
      if ([...r.entries.values()].includes(cmd.company)) return fail("you have a ship entered already");
      r.entries.set(s.id, cmd.company);
      return { ok: true };
    },
    advance() {
      for (const slot of slotsBetween(REGATTA_SPEC, e.tick, e.tick + 1)) {
        const r = races.get(slot.index); if (!r) continue;
        const k = regattaCourse(e, slot.index);
        for (const [sid, company] of r.entries) {
          const s = e.ships.get(sid);
          if (!s || s.owner !== company || r.finish.some(f => f.ship === sid)) continue;
          if (s.dest !== null && s.port === k.from && s.departTick >= slot.starts) r.sailing.add(sid);
          if (s.dest === null && s.port === k.to && r.sailing.has(sid)) {
            r.finish.push({ ship: sid, company, tick: e.tick });
            const place = r.finish.length - 1;
            if (place < 3) { const t = trophies.get(company) ?? [0, 0, 0]; t[place]++; trophies.set(company, t); }
          } else if (s.dest === null && s.port !== k.from) r.sailing.delete(sid);
        }
      }
      for (const i of races.keys()) if (i < (current()?.index ?? Infinity) - 2) races.delete(i);
    },
    world() {
      const c = current();
      if (!c) return { race: null };
      const k = regattaCourse(e, c.index), r = races.get(c.index);
      return { race: { ...k, starts: c.starts, ends: c.ends, entries: r?.entries.size ?? 0, finish: (r?.finish ?? []).map(f => ({ ship: f.ship, by: companyName(e, f.company), tick: f.tick })) } };
    },
    view: (company) => ({ trophies: trophies.get(company) ?? [0, 0, 0] }),
    cards(company): FeatureCard[] {
      const c = current(), t = trophies.get(company) ?? [0, 0, 0];
      if (!c) return [{ title: "Regatta", detail: `No race this week. Your trophies: ${t[0]} gold, ${t[1]} silver, ${t[2]} bronze.` }];
      const k = regattaCourse(e, c.index), open = e.tick < c.starts;
      const field = open ? shipField(e, company, s => s.dest === null && s.port === k.from) : undefined;
      return [{ title: `Regatta · ${portName(e, k.from)} to ${portName(e, k.to)}`,
        detail: `${open ? `Entries close at ${clock(c.starts)}.` : `Racing until ${clock(c.ends)}.`} Sail your entry from the start after the gun; first three home win. Your trophies: ${t[0]} gold, ${t[1]} silver, ${t[2]} bronze.`,
        actions: field ? [action(id, "Enter the regatta", "enter", {}, field)] : [] }];
    },
  };
};

// ------------------------------------------------------------ 322 harvest festival, 329 trade fair, 338 anniversaries

export const FAIR_SPEC: SlotSpec = { period: 200, duration: 48, salt: 1601, chance: 0.8, offset: 30 };
export const ANNIVERSARY_HOURS = 168, WORLD_ANNIVERSARY = 720;
export function harvestWindow(e: Engine, tick = e.tick) {
  const starts = quarterHours(e) * 2 + 24, ends = starts + 72;
  return { starts, ends, active: tick >= starts && tick < ends };
}
export const fairPort = (e: Engine, index: number) => portBy(e, 1602, index);
const GRAIN = 0;

/** Ideas 322, 329 and 338: the autumn harvest festival (bring a ship with grain to a grain-hungry port for a ribbon),
 *  trade fairs where docked ships exhibit their cargo and the biggest show wins best in show, and anniversaries
 *  for each company every week and for the world every month. Ribbons and badges only. */
export const festivals: FeatureFactory = (e) => {
  const id = "world.festivals";
  const ribbons = new Map<number, number>(), bestInShow = new Map<number, number>(), badges = new Map<number, number>();
  const harvestDone = new Set<string>();                                       // `${company}:${starts}`
  const fairs = new Map<number, Map<number, { good: number; qty: number }>>(); // fair -> company -> best exhibit
  const judged = new Set<number>();
  const joined = new Map<number, number>();                                    // company -> first hour seen
  const add = (m: Map<number, number>, c: number) => m.set(c, (m.get(c) ?? 0) + 1);
  const fair = () => slotsBetween(FAIR_SPEC, e.tick, e.tick + 1)[0];
  const harvestPorts = () => e.map.ports.filter(p => p.consumes.includes("grain")).map(p => p.id);
  addNews(e, id, () => {
    const out = [];
    const h = harvestWindow(e);
    if (h.active) out.push({ tick: h.starts, kind: "festival", text: "Harvest festival! Bring grain to the hungry ports for a ribbon." });
    const f = fair();
    if (f) out.push({ tick: f.starts, kind: "festival", text: `Trade fair at ${portName(e, fairPort(e, f.index))} until ${clock(f.ends)}.` });
    if (e.tick >= WORLD_ANNIVERSARY) { const n = Math.floor(e.tick / WORLD_ANNIVERSARY); out.push({ tick: n * WORLD_ANNIVERSARY, kind: "festival", text: `Manifest celebrates ${n} month${n > 1 ? "s" : ""} of trading. Flags out in every port!` }); }
    for (const [c, since] of joined) { const n = Math.floor((e.tick - since) / ANNIVERSARY_HOURS); if (n >= 1) out.push({ tick: since + n * ANNIVERSARY_HOURS, kind: "festival", text: `${companyName(e, c)} marks ${n} week${n > 1 ? "s" : ""} on the water.` }); }
    return out.sort((a, b) => b.tick - a.tick).slice(0, 6);
  });
  return {
    id, ideas: [322, 329, 338], title: "Festivals and fairs", economy: false,
    apply(cmd) {
      const s = ownShip(e, cmd.company, cmd.ship);
      if (!s || s.dest !== null) return fail("choose one of your docked ships");
      if (cmd.action === "harvest") {
        const h = harvestWindow(e), key = `${cmd.company}:${h.starts}`;
        if (!h.active) return fail("the harvest festival is not on");
        if (!harvestPorts().includes(s.port)) return fail("take the grain to a port that needs it");
        if (s.good !== GRAIN || s.qty < 1) return fail("the ship must carry grain");
        if (harvestDone.has(key)) return fail("you already have this year's harvest ribbon");
        harvestDone.add(key); add(ribbons, cmd.company);
        return { ok: true };
      }
      if (cmd.action === "exhibit") {
        const f = fair();
        if (!f) return fail("there is no fair on");
        if (s.port !== fairPort(e, f.index)) return fail(`the fair is at ${portName(e, fairPort(e, f.index))}`);
        if (s.good === null || s.qty < 1) return fail("bring cargo to exhibit");
        const book = fairs.get(f.index) ?? new Map();
        const prev = book.get(cmd.company);
        if (!prev) add(ribbons, cmd.company);
        if (!prev || s.qty > prev.qty) book.set(cmd.company, { good: s.good, qty: s.qty });
        fairs.set(f.index, book);
        return { ok: true };
      }
      return fail("unknown action");
    },
    advance() {
      for (const c of e.companies.values()) {
        if (!joined.has(c.id)) joined.set(c.id, e.tick);
        if ((e.tick - joined.get(c.id)!) > 0 && (e.tick - joined.get(c.id)!) % ANNIVERSARY_HOURS === 0) add(badges, c.id);
      }
      for (const [i, book] of fairs) {
        const slot = slotsBetween(FAIR_SPEC, 0, e.tick + 1).find(s => s.index === i);
        if (!slot || slot.ends > e.tick || judged.has(i)) continue;
        judged.add(i);
        const best = [...book].sort((a, b) => b[1].qty - a[1].qty || a[0] - b[0])[0];
        if (best) add(bestInShow, best[0]);
        fairs.delete(i);
      }
    },
    world() {
      const f = fair(), h = harvestWindow(e);
      return { harvest: h.active ? { ends: h.ends, ports: harvestPorts() } : null,
        fair: f ? { port: fairPort(e, f.index), ends: f.ends, exhibits: [...(fairs.get(f.index) ?? [])].map(([c, x]) => ({ by: companyName(e, c), good: GOODS_NAMES[x.good], qty: x.qty })) } : null };
    },
    view: (company) => ({ ribbons: ribbons.get(company) ?? 0, bestInShow: bestInShow.get(company) ?? 0, anniversaries: badges.get(company) ?? 0 }),
    cards(company): FeatureCard[] {
      const cards: FeatureCard[] = [];
      const h = harvestWindow(e), f = fair();
      if (h.active) {
        const field = shipField(e, company, s => s.dest === null && s.good === GRAIN && harvestPorts().includes(s.port));
        cards.push({ title: "Harvest festival", detail: `Until ${clock(h.ends)}: dock with grain at ${harvestPorts().map(p => portName(e, p)).join(", ") || "a grain-hungry port"} for a ribbon.`,
          actions: field ? [action(id, "Join the festival", "harvest", {}, field)] : [] });
      }
      if (f) {
        const port = fairPort(e, f.index), field = shipField(e, company, s => s.dest === null && s.port === port && s.good !== null);
        cards.push({ title: `Trade fair · ${portName(e, port)}`, detail: `Exhibit a docked cargo before ${clock(f.ends)}. The biggest exhibit wins best in show.`,
          actions: field ? [action(id, "Exhibit cargo", "exhibit", {}, field)] : [] });
      }
      const v = { r: ribbons.get(company) ?? 0, b: bestInShow.get(company) ?? 0, a: badges.get(company) ?? 0 };
      if (v.r || v.b || v.a) cards.push({ title: "Your rosettes", detail: `${v.r} ribbons, ${v.b} best in show, ${v.a} anniversary badges.` });
      return cards;
    },
  };
};

// ------------------------------------------------------------ 325 quarantine

export const QUARANTINE_SPEC: SlotSpec = { period: 150, duration: 36, salt: 1701, chance: 0.5, offset: 70 };
export const QUARANTINE_DELAY = 4, FLAG_HOURS = 24;
export function quarantine(e: Engine, tick = e.tick) {
  const s = slotsBetween(QUARANTINE_SPEC, tick, tick + 1)[0];
  return s ? { port: portBy(e, 1702, s.index), starts: s.starts, ends: s.ends } : null;
}
/** Idea 325: a port is put under quarantine now and then; ships that dock there fly the yellow flag for a day after. */
export const quarantineModule: FeatureFactory = (e) => {
  const id = "world.quarantine", flags = new Map<number, number>();   // ship -> until
  addNews(e, id, () => { const q = quarantine(e); return q ? [{ tick: q.starts, kind: "health", text: `Fever at ${portName(e, q.port)}: the port is under quarantine until ${clock(q.ends)}.` }] : []; });
  return {
    id, ideas: [325], title: "Quarantine", economy: false,
    advance() {
      for (const [s, until] of flags) if (until <= e.tick || !e.ships.has(s)) flags.delete(s);
      const q = quarantine(e);
      if (q) for (const s of e.ships.values()) if (s.dest === null && s.port === q.port) flags.set(s.id, e.tick + FLAG_HOURS);
    },
    world: () => ({ port: quarantine(e), flagged: [...flags.keys()] }),
    cards: () => {
      const q = quarantine(e);
      return q ? [{ title: "Quarantine", detail: `${portName(e, q.port)} is under quarantine until ${clock(q.ends)}. Ships docking there fly the yellow flag for ${FLAG_HOURS} hours.${e.features.enabled("world.quarantine-effects") ? ` Arrivals wait ${QUARANTINE_DELAY} hours for inspection.` : ""}` }] : [];
    },
  };
};
/** Economy half (off): arrivals at a quarantined port wait for the health inspector. */
export const quarantineEffects: FeatureFactory = (e) => ({
  id: "world.quarantine-effects", ideas: [325], title: "Quarantine: inspection delay", economy: true,
  adjust: { travelHours: (v, ctx) => { const q = quarantine(e, e.tick + v); return q && q.port === ctx.dest ? v + QUARANTINE_DELAY : v; } },
});
