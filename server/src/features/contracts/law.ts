// Law and lawlessness (ideas 83, 85-92, 94, 95): the black flag, wanted stars, patrols, inspections, bribes, hideouts,
// the pirate boss, fake distress signals, the coast guard, pardons and naval blockades.
// Bribes and the coast guard's fuel top-up move money, so they are economy modules (off); the rest ship on.
import { GOODS, type Engine, type Ship } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import {
  act, addHeat, addRep, addStanding, arrivals, blockadeNow, bossNow, companyShips, day, dist, fail, FACTIONS, heatOf, hideouts, lanePoint,
  money, namedPirates, nearPt, news, Notices, ok, ownShip, peer, pickRoute, pirateZones, portName, position, remotePorts, roll, shared,
  shipField, stars, standingOf, title, type Pt,
} from "./core.js";

const fuelIndex = () => (GOODS as readonly string[]).indexOf("fuel");
const lawNotes = new WeakMap<Engine, Notices>();
/** One notice list for all the law modules (shown on the wanted card). */
export const lawNotices = (e: Engine) => { let n = lawNotes.get(e); if (!n) { n = new Notices(8); lawNotes.set(e, n); } return n; };

// ------------------------------------------------------------ inspections (used by 87 and 95)

export const isHideout = (e: Engine, port: number) => hideouts(e).includes(port);
/** Inspectors' ports today (idea 317); used by inspections when that module is on. */
export const inspectorPorts = (e: Engine, d = day(e)) => [0, 1].map(i => Math.floor(roll(0x494e5350, d, i) * e.n));

/** Search a docked ship: seize any smuggled crate. Returns true if contraband was found. */
export function search(e: Engine, s: Ship, why: string): boolean {
  const sh = shared(e), crate = sh.contraband.get(s.id);
  if (!crate) { addHeat(e, s.owner, -2); lawNotices(e).add(e, s.owner, `${why}: ship ${s.id} searched at ${portName(e, s.port)}, nothing found.`); return false; }
  sh.contraband.delete(s.id);
  addHeat(e, s.owner, 20);
  addStanding(e, s.owner, "navy", -5);
  addStanding(e, s.owner, "syndicate", -3);
  lawNotices(e).add(e, s.owner, `${why}: inspectors found a smuggled crate aboard ship ${s.id} at ${portName(e, s.port)} and seized it.`);
  news(e, "inspection", `Inspectors at ${portName(e, s.port)} seized contraband from a ${s.type}.`, s.port);
  return true;
}
export function inspectionChance(e: Engine, s: Ship): number {
  if (isHideout(e, s.port)) return 0;
  if ((shared(e).waived.get(s.owner) ?? 0) > e.tick) return 0;
  let c = 0.08 + 0.06 * stars(e, s.owner) + (shared(e).contraband.has(s.id) ? 0.05 : 0);
  if (e.features.enabled("contracts.inspectors") && inspectorPorts(e).includes(s.port)) c += 0.3;
  if (e.features.enabled("contracts.syndicate") && standingOf(e, s.owner)[1] >= 60) c *= 0.5;
  return Math.min(0.9, c);
}

// ------------------------------------------------------------ 83 black flag (on)

export const FLAG_COOLDOWN = 24;
export const blackFlag: FeatureFactory = (e) => {
  const id = "contracts.black-flag";
  const infamy = new Map<number, number>();
  return {
    id, ideas: [83], title: "Player-pirate role", economy: false,
    apply(cmd) {
      const sh = shared(e), last = sh.flagChanged.get(cmd.company);
      if (cmd.action !== "raise" && cmd.action !== "lower") return fail("unknown action");
      if (last !== undefined && e.tick - last < FLAG_COOLDOWN) return fail(`you changed your flag ${e.tick - last} h ago; wait ${FLAG_COOLDOWN} h between changes`);
      if (cmd.action === "raise") {
        if (sh.pirates.has(cmd.company)) return fail("you already fly the black flag");
        sh.pirates.add(cmd.company);
        addStanding(e, cmd.company, "navy", -20); addStanding(e, cmd.company, "syndicate", 10);
        news(e, "flag", `${e.companies.get(cmd.company)!.name} has raised the black flag.`);
      } else {
        if (!sh.pirates.has(cmd.company)) return fail("you are not flying the black flag");
        sh.pirates.delete(cmd.company);
      }
      sh.flagChanged.set(cmd.company, e.tick);
      return ok;
    },
    advance() {
      const sh = shared(e);
      for (const s of arrivals(e)) if (sh.pirates.has(s.owner) && !isHideout(e, s.port)) addHeat(e, s.owner, 1);
      if (e.tick % 24 === 0) for (const c of sh.pirates) infamy.set(c, (infamy.get(c) ?? 0) + 1);
    },
    cards(company) {
      const flying = shared(e).pirates.has(company);
      return [{ title: "The black flag", detail: flying
        ? `You fly the black flag. Infamy: ${infamy.get(company) ?? 0}. Hideouts welcome you, the syndicate likes you, the navy does not, and every docking at a lawful port adds wanted heat. Pirates rarely ambush their own.`
        : `Opt in to play a pirate captain: hideouts, false distress signals and the boss's favour open up; the navy turns cold and heat builds as you dock. You can lower the flag again after ${FLAG_COOLDOWN} h.`,
        actions: [flying ? act(id, "Lower the black flag", "lower") : act(id, "Raise the black flag", "raise")] }];
    },
    view: (company) => ({ flying: shared(e).pirates.has(company), infamy: infamy.get(company) ?? 0, changed: shared(e).flagChanged.get(company) ?? null }),
    world: () => ({ pirates: [...shared(e).pirates].map(c => e.companies.get(c)?.name).filter(Boolean) }),
  };
};

// ------------------------------------------------------------ 85 wanted level (on)

export const wanted: FeatureFactory = (e) => {
  const id = "contracts.wanted";
  const last = new Map<number, number>();
  return {
    id, ideas: [85], title: "Wanted level", economy: false,
    advance() {
      for (const c of e.companies.keys()) {
        const now = stars(e, c), was = last.get(c) ?? 0;
        if (now !== was) { last.set(c, now); lawNotices(e).add(e, c, now > was ? `Your wanted level rose to ${"★".repeat(now)}.` : `Your wanted level fell to ${now ? "★".repeat(now) : "none"}.`); }
      }
    },
    cards(company) {
      const n = stars(e, company);
      return [{ title: "Wanted level", detail: `${n ? "★".repeat(n) + "☆".repeat(5 - n) : "Not wanted"} (police notoriety ${Math.round(e.piracy.notorietyOf(company))}, heat ${Math.round(heatOf(e, company))}). Heat comes from smuggling, seized cargo, false signals and black-flag dockings, and cools by half a point an hour. Each star makes inspections likelier.`
        + lawNotices(e).of(company).map(x => `\n• ${x.text}`).join("") }];
    },
    view: (company) => ({ stars: stars(e, company), heat: Math.round(heatOf(e, company) * 10) / 10 }),
    world: () => ({ mostWanted: [...e.companies.values()].map(c => ({ name: c.name, stars: stars(e, c.id) })).filter(x => x.stars > 0).sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name)).slice(0, 5) }),
  };
};

// ------------------------------------------------------------ 86 police patrol routes (on)

export const REPORT_RANGE = 80;
export const patrols: FeatureFactory = (e) => {
  const id = "contracts.patrols";
  const reported = new Map<number, number>();   // reporter -> day of last report
  const loops = () => {
    const busy = remotePorts(e, e.n).reverse();   // most connected first
    return [busy.slice(0, 4), busy.slice(4, 8)].filter(l => l.length >= 2);
  };
  const suspects = (company: number) => {
    const mine = companyShips(e, company).map(s => position(e, s));
    const out = new Map<number, Ship>();
    for (const s of e.ships.values()) {
      if (s.owner === company || s.dest === null || out.has(s.owner)) continue;
      if (s.type !== "pirate" && !shared(e).pirates.has(s.owner)) continue;
      if (mine.some(p => nearPt(e, p, position(e, s), REPORT_RANGE))) out.set(s.owner, s);
    }
    return [...out.values()];
  };
  return {
    id, ideas: [86], title: "Police patrol routes", economy: false,
    apply(cmd) {
      if (cmd.action !== "report") return fail("unknown action");
      if (reported.get(cmd.company) === day(e)) return fail("you have already sent a report today");
      const s = suspects(cmd.company).find(x => x.id === cmd.ship);
      if (!s) return fail("you can't see that ship from any of yours");
      reported.set(cmd.company, day(e));
      addHeat(e, s.owner, 5); addStanding(e, cmd.company, "navy", 2);
      lawNotices(e).add(e, s.owner, `Someone reported your ship ${s.id} to the patrols.`);
      return ok;
    },
    cards(company) {
      const sus = suspects(company);
      return [{ title: "Police patrols", detail: `Patrol loops: ${loops().map(l => l.map(p => portName(e, p)).join(" → ")).join("; ") || "none"}. Police boats at sea: ${e.police.ships.filter(p => p.dest !== null).length}.\nYou may report one pirate ship you can see each day (adds 5 heat to its owner).`,
        actions: sus.length && reported.get(company) !== day(e) ? [act(id, "Report a pirate ship", "report", {}, [{ key: "ship", label: "Ship", options: sus.map(s => ({ value: s.id, label: `Ship ${s.id} (${e.companies.get(s.owner)?.name})` })) }])] : [] }];
    },
    world: () => ({ loops: loops(), police: e.police.ships.map(p => { const at = e.piracy.position(p); return { id: p.id, x: Math.round(at.x), y: Math.round(at.y), dest: p.dest }; }) }),
  };
};

// ------------------------------------------------------------ 87 contraband inspections (on)

export const inspections: FeatureFactory = (e) => {
  const id = "contracts.inspections";
  const counts = new Map<number, { searched: number; found: number }>();
  return {
    id, ideas: [87], title: "Contraband inspections", economy: false,
    advance() {
      const blockade = e.features.enabled("contracts.blockade") ? blockadeNow(e)?.port : undefined;
      for (const s of arrivals(e)) {
        if (s.port === blockade) continue;   // the blockade searches everyone there
        if (roll(0x494e5350, e.tick, s.id) >= inspectionChance(e, s)) continue;
        const c = counts.get(s.owner) ?? { searched: 0, found: 0 };
        c.searched++; if (search(e, s, "Customs inspection")) c.found++;
        counts.set(s.owner, c);
      }
    },
    cards(company) {
      const c = counts.get(company) ?? { searched: 0, found: 0 };
      const ships = companyShips(e, company);
      return [{ title: "Customs inspections", detail: `Customs may search a ship when it docks: 8% plus 6% per wanted star${e.features.enabled("contracts.inspectors") ? ", plus 30% where an inspector is posted" : ""}. Hideouts are never inspected. Smuggled crates are seized.\nYour ships searched: ${c.searched}, crates found: ${c.found}.${ships[0] ? ` Chance for ship ${ships[0].id} at its next port: about ${Math.round(inspectionChance(e, ships[0]) * 100)}%.` : ""}` }];
    },
    view: (company) => counts.get(company) ?? { searched: 0, found: 0 },
  };
};

// ------------------------------------------------------------ 88 bribes (economy)

export const bribes: FeatureFactory = (e) => {
  const id = "contracts.bribes";
  const price = (c: number) => 100 * (1 + stars(e, c));
  return {
    id, ideas: [88], title: "Bribing officers", economy: true,
    apply(cmd) {
      if (cmd.action !== "bribe") return fail("unknown action");
      const sh = shared(e);
      if ((sh.waived.get(cmd.company) ?? 0) > e.tick) return fail("the officers are already looking the other way");
      const c = e.companies.get(cmd.company)!, p = price(cmd.company);
      if (c.cash < p) return fail("not enough cash");
      if (roll(0x42524942, e.tick, cmd.company) < 0.2) { addHeat(e, cmd.company, 10); lawNotices(e).add(e, cmd.company, "An honest officer refused your bribe and reported it."); return { ok: true, result: "refused" }; }
      c.cash -= p; sh.waived.set(cmd.company, e.tick + 48);
      return { ok: true, result: "taken", cost: p };
    },
    cards(company) {
      const until = shared(e).waived.get(company) ?? 0;
      return [{ title: "Bribes", detail: `Pay ${money(price(company))} (100 plus 100 per wanted star) and customs ignore your ships for 48 h. One officer in five refuses and reports you (+10 heat, no money taken).${until > e.tick ? `\nOfficers look away for ${until - e.tick} more hours.` : ""}`,
        actions: until > e.tick ? [] : [act(id, `Offer a bribe (${money(price(company))})`, "bribe")] }];
    },
    view: (company) => ({ waivedUntil: shared(e).waived.get(company) ?? 0 }),
  };
};

// ------------------------------------------------------------ 89 hideouts (on)

export const hideoutModule: FeatureFactory = (e) => ({
  id: "contracts.hideouts", ideas: [89], title: "Pirate hideout islands", economy: false,
  advance() {
    const sh = shared(e), cooled = new Set<number>();
    for (const s of e.ships.values()) if (s.dest === null && sh.pirates.has(s.owner) && isHideout(e, s.port) && !cooled.has(s.owner)) { cooled.add(s.owner); addHeat(e, s.owner, -1.5); }
  },
  cards(company) {
    const boss = bossNow(e);
    const rumours = [
      boss ? `the boss's flagship is near ${e.piracy.nearestPort(boss)}` : "the boss is quiet",
      `hunting grounds tomorrow: ${pirateZones(e, day(e) + 1).map(z => e.piracy.nearestPort(z)).join(", ")}`,
      ...namedPirates(e).filter(p => p.at).slice(0, 2).map(p => `${p.name} was seen near ${e.piracy.nearestPort(p.at!)}`),
    ];
    const here = companyShips(e, company).some(s => s.dest === null && isHideout(e, s.port));
    return [{ title: "Hideouts", detail: `Lawless harbours at ${hideouts(e).map(p => portName(e, p)).join(", ")}: no customs, and black-flag captains docked there cool off three times faster.${here ? `\nTavern rumours: ${rumours.join("; ")}.` : "\nDock a ship there to hear the tavern rumours."}` }];
  },
  world: () => ({ ports: hideouts(e) }),
});

// ------------------------------------------------------------ 90 pirate boss events (on)

export const BOSS_RANGE = 120;
export const pirateBoss: FeatureFactory = (e) => {
  const id = "contracts.pirate-boss";
  const hunters = new Map<number, Map<number, number>>();   // event -> company -> guns brought
  const results: { event: number; defeated: boolean; hunters: number }[] = [];
  let settled = -1;
  return {
    id, ideas: [90], title: "Pirate boss events", economy: false,
    apply(cmd) {
      if (cmd.action !== "join") return fail("unknown action");
      const b = bossNow(e);
      if (!b) return fail("the boss is not at sea");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (!nearPt(e, position(e, s), b, BOSS_RANGE)) return fail("that ship is too far from the boss");
      const list = hunters.get(b.event) ?? new Map<number, number>();
      if (list.has(cmd.company)) return fail("you have already joined this hunt");
      list.set(cmd.company, shared(e).guns.get(s.id) ?? 0);
      hunters.set(b.event, list);
      return ok;
    },
    advance() {
      const was = bossNow(e, e.tick - 1);
      if (!was || bossNow(e) || settled === was.event) return;
      settled = was.event;
      const list = hunters.get(was.event) ?? new Map<number, number>();
      hunters.delete(was.event);
      const guns = [...list.values()].reduce((a, b) => a + b, 0);
      const defeated = list.size > 0 && roll(0x424f5353, was.event) < Math.min(0.9, 0.3 + 0.15 * list.size + 0.05 * guns);
      results.push({ event: was.event, defeated, hunters: list.size });
      if (results.length > 5) results.shift();
      for (const c of list.keys()) {
        if (defeated) { title(e, c, "Boss Breaker"); addStanding(e, c, "navy", 10); addRep(e, c, 1); }
        lawNotices(e).add(e, c, defeated ? "The hunt sank the pirate boss's flagship!" : "The pirate boss slipped away from the hunt.");
      }
      news(e, "boss", defeated ? `The pirate boss's flagship was sunk by ${list.size} captains.` : "The pirate boss escaped again.");
    },
    cards(company) {
      const b = bossNow(e);
      if (!b) return [{ title: "Pirate boss", detail: `Every fifth day the boss's flagship sails for two days. Join the hunt with any ship within range; more hunters and guns give better odds. Hunters who sink it earn the Boss Breaker title.${results.length ? `\nLast hunt: ${results[results.length - 1].defeated ? "sunk" : "escaped"} (${results[results.length - 1].hunters} hunters).` : ""}` }];
      const near = companyShips(e, company).filter(s => nearPt(e, position(e, s), b, BOSS_RANGE));
      const joined = hunters.get(b.event)?.has(company);
      return [{ title: "Pirate boss at sea!", detail: `The flagship is near ${e.piracy.nearestPort(b)}, sailing ${portName(e, b.from)} → ${portName(e, b.to)}, for ${b.until - e.tick} more hours. Hunters: ${hunters.get(b.event)?.size ?? 0}.${joined ? " You have joined the hunt." : ""}`,
        actions: !joined && near.length ? [act(id, "Join the hunt", "join", {}, [shipField(near)])] : [] }];
    },
    world: () => ({ boss: bossNow(e), results }),
  };
};

// ------------------------------------------------------------ 91 fake distress signals (on)

interface Signal { id: number; x: number; y: number; fake: boolean; until: number; by?: number; answered: number[] }
export const SIGNAL_RANGE = 80;
export const fakeDistress: FeatureFactory = (e) => {
  const id = "contracts.fake-distress";
  let signals: Signal[] = [];
  let seq = 0;
  const saves = new Map<number, number>();
  const sent = new Map<number, number>();   // company -> day of last false signal
  const spawn = () => {
    if (!e.map.routes.length) return;
    const { a, b } = pickRoute(e, 0x44495354, e.tick);
    const p = lanePoint(e, a, b, 0.2 + 0.6 * roll(0x44495354, e.tick, 1));
    signals.push({ id: ++seq, x: Math.round(p.x), y: Math.round(p.y), fake: roll(0x44495354, e.tick, 2) < 0.4, until: e.tick + 8, answered: [] });
  };
  const near = (company: number, sig: Pt) => companyShips(e, company).filter(s => nearPt(e, position(e, s), sig, SIGNAL_RANGE));
  return {
    id, ideas: [91], title: "Fake distress signals", economy: false,
    apply(cmd) {
      if (cmd.action === "answer") {
        const sig = signals.find(x => x.id === cmd.signal);
        if (!sig || sig.until <= e.tick) return fail("that signal has gone quiet");
        if (sig.answered.includes(cmd.company)) return fail("you have already answered");
        if (sig.by === cmd.company) return fail("that is your own signal");
        const s = ownShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (!nearPt(e, position(e, s), sig, SIGNAL_RANGE)) return fail("that ship is too far away");
        sig.answered.push(cmd.company);
        if (sig.fake) {
          shared(e).exposed.set(s.id, e.tick + 24);
          if (sig.by !== undefined) addHeat(e, sig.by, 4);
          lawNotices(e).add(e, cmd.company, `It was a trap! Ship ${s.id}'s position is known to pirates for a day.`);
          return { ok: true, result: "trap" };
        }
        const n = (saves.get(cmd.company) ?? 0) + 1;
        saves.set(cmd.company, n); addRep(e, cmd.company, 1); addStanding(e, cmd.company, "navy", 3);
        if (n >= 3) title(e, cmd.company, "Lifesaver");
        news(e, "rescue", `${e.companies.get(cmd.company)!.name} answered a mayday near ${e.piracy.nearestPort(sig)} and saved the crew.`);
        return { ok: true, result: "rescue" };
      }
      if (cmd.action === "broadcast") {
        if (!shared(e).pirates.has(cmd.company)) return fail("only black-flag captains send false signals");
        if (sent.get(cmd.company) === day(e)) return fail("one false signal a day");
        const s = ownShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (s.dest === null) return fail("broadcast from a ship at sea");
        const p = position(e, s);
        sent.set(cmd.company, day(e));
        signals.push({ id: ++seq, x: Math.round(p.x), y: Math.round(p.y), fake: true, until: e.tick + 8, by: cmd.company, answered: [] });
        addHeat(e, cmd.company, 8);
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      signals = signals.filter(x => x.until > e.tick);
      if (e.tick % 12 === 6 && signals.length < 4) spawn();
      const sh = shared(e);
      for (const [ship, until] of [...sh.exposed]) if (until <= e.tick) sh.exposed.delete(ship);
    },
    cards(company) {
      const actions = [];
      for (const sig of signals) {
        if (sig.answered.includes(company) || sig.by === company) continue;
        const ships = near(company, sig);
        if (ships.length) actions.push(act(id, `Answer the mayday near ${e.piracy.nearestPort(sig)}`, "answer", { signal: sig.id }, [shipField(ships)]));
      }
      const atSea = companyShips(e, company).filter(s => s.dest !== null);
      if (shared(e).pirates.has(company) && atSea.length && sent.get(company) !== day(e)) actions.push(act(id, "Send a false mayday", "broadcast", {}, [shipField(atSea)]));
      return [{ title: "Distress signals", detail: `Maydays come over the radio: answer with a ship within range to save a crew (reputation, and the Lifesaver title after three). Some are pirate traps that expose your ship for a day.\nActive: ${signals.length}. Crews saved: ${saves.get(company) ?? 0}.`, actions }];
    },
    view: (company) => ({ saves: saves.get(company) ?? 0 }),
    world: () => ({ signals: signals.map(x => ({ id: x.id, x: x.x, y: x.y, until: x.until })) }),
  };
};

// ------------------------------------------------------------ 92 coast guard (on) and its fuel top-up (economy)

export const coastStations = (e: Engine) => remotePorts(e, e.n).reverse().slice(0, 3);
export function cheapestHop(e: Engine, s: Ship): { port: number; cost: number } | null {
  let best: { port: number; cost: number } | null = null;
  for (let p = 0; p < e.n; p++) {
    if (p === s.port || !Number.isFinite(e.dist[s.port][p])) continue;
    const cost = e.fuelNeeded(s.port, p, s.type) * e.price(s.port, fuelIndex());
    if (!best || cost < best.cost) best = { port: p, cost };
  }
  return best;
}
export const stranded = (e: Engine, s: Ship) => {
  const hop = s.dest === null && s.qty <= 0 ? cheapestHop(e, s) : null;
  return !!hop && e.companies.get(s.owner)!.cash < hop.cost;
};
export const coastGuard: FeatureFactory = (e) => {
  const id = "contracts.coast-guard";
  const calls = new Map<number, number>();   // company -> tick of last call
  const rescues = new Map<number, number>();
  return {
    id, ideas: [92], title: "Coast-guard rescue", economy: false,
    apply(cmd) {
      if (cmd.action !== "call") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (!stranded(e, s)) return fail("that ship is not stranded (it is loaded, at sea, or you can afford fuel)");
      const last = calls.get(cmd.company);
      if (last !== undefined && e.tick - last < 72) return fail(`the coast guard helped you ${e.tick - last} h ago; once every 72 h`);
      calls.set(cmd.company, e.tick);
      const hop = cheapestHop(e, s)!;
      const effects = peer<{ topUp(company: number, cost: number): number }>(e, "contracts.coast-guard-effects");
      const paid = effects ? effects.topUp(cmd.company, hop.cost) : 0;
      rescues.set(cmd.company, (rescues.get(cmd.company) ?? 0) + 1);
      lawNotices(e).add(e, cmd.company, paid > 0
        ? `The coast guard filled ship ${s.id}'s tanks (worth ${money(paid)}): enough to reach ${portName(e, hop.port)}.`
        : `The coast guard logged ship ${s.id} as stranded. Cheapest way out: ${portName(e, hop.port)} for about ${money(hop.cost)} in fuel; nearest station ${portName(e, coastStations(e)[0])}.`);
      return { ok: true, paid };
    },
    cards(company) {
      const stuck = companyShips(e, company).filter(s => stranded(e, s));
      return [{ title: "Coast guard", detail: `Stations at ${coastStations(e).map(p => portName(e, p)).join(", ")}. A ship that is empty, docked and can't afford fuel for even the shortest hop counts as stranded; call the coast guard once every 72 h.${stuck.length ? `\nStranded: ${stuck.map(s => `ship ${s.id} at ${portName(e, s.port)}`).join(", ")}.` : ""} Rescues: ${rescues.get(company) ?? 0}.`,
        actions: stuck.length ? [act(id, "Call the coast guard", "call", {}, [shipField(stuck)])] : [] }];
    },
    view: (company) => ({ rescues: rescues.get(company) ?? 0, lastCall: calls.get(company) ?? null }),
    world: () => ({ stations: coastStations(e) }),
  };
};
export const coastGuardEffects: FeatureFactory = (e) => {
  const mod = {
    id: "contracts.coast-guard-effects", ideas: [92], title: "Coast-guard fuel top-up", economy: true,
    topUp(company: number, cost: number) { const c = e.companies.get(company); if (!c) return 0; const pay = Math.ceil(cost - Math.max(0, c.cash)) + 1; c.cash += pay; return pay; },
    cards: () => [{ title: "Coast-guard fuel", detail: "While this rule is on, a coast-guard call also gives a stranded company just enough cash for fuel to the cheapest neighbouring port." }],
  };
  return mod;
};

// ------------------------------------------------------------ 94 pardons (on)

export const pardon: FeatureFactory = (e) => {
  const id = "contracts.pardon";
  const clean = new Map<number, number>();   // company -> cargo arrivals since the flag came down
  const pardoned = new Map<number, number>();
  const everFlew = new Set<number>();
  const need = (c: number) => {
    const sh = shared(e), why: string[] = [];
    if (sh.pirates.has(c)) why.push("lower the black flag");
    else if (everFlew.has(c) && e.tick - (sh.flagChanged.get(c) ?? 0) < 72) why.push(`keep the flag down ${72 - (e.tick - (sh.flagChanged.get(c) ?? 0))} more hours`);
    if ((clean.get(c) ?? 0) < 3) why.push(`make ${3 - (clean.get(c) ?? 0)} more honest cargo deliveries`);
    if (heatOf(e, c) >= 10) why.push("let your heat cool below 10");
    if (!everFlew.has(c) && e.piracy.notorietyOf(c) <= 0) why.push("you have nothing to be pardoned for");
    const last = pardoned.get(c);
    if (last !== undefined && e.tick - last < 168) why.push("one pardon a week");
    return why;
  };
  return {
    id, ideas: [94], title: "Pardons for reformed pirates", economy: false,
    apply(cmd) {
      if (cmd.action !== "apply") return fail("unknown action");
      const why = need(cmd.company);
      if (why.length) return fail(why[0]);
      e.piracy.setNotoriety(cmd.company, 0);
      shared(e).heat.delete(cmd.company);
      pardoned.set(cmd.company, e.tick); clean.set(cmd.company, 0); everFlew.delete(cmd.company);
      title(e, cmd.company, "Pardoned");
      addStanding(e, cmd.company, "navy", 15);
      news(e, "pardon", `The Admiralty pardoned ${e.companies.get(cmd.company)!.name}.`);
      return ok;
    },
    advance() {
      const sh = shared(e);
      for (const c of sh.pirates) { everFlew.add(c); clean.set(c, 0); }
      for (const s of arrivals(e)) if (!sh.pirates.has(s.owner) && s.qty > 0 && s.type !== "pirate") clean.set(s.owner, (clean.get(s.owner) ?? 0) + 1);
    },
    cards(company) {
      const why = need(company);
      return [{ title: "Royal pardon", detail: `A reformed pirate can ask for a pardon: police notoriety and heat are wiped and the navy warms to you. ${why.length ? `Still needed: ${why.join("; ")}.` : "You qualify now."}`,
        actions: why.length ? [] : [act(id, "Ask for a pardon", "apply")] }];
    },
    view: (company) => ({ clean: clean.get(company) ?? 0, pardoned: pardoned.get(company) ?? null }),
  };
};

// ------------------------------------------------------------ 95 naval blockades (on)

export const blockade: FeatureFactory = (e) => {
  const id = "contracts.blockade";
  return {
    id, ideas: [95], title: "Naval blockade events", economy: false,
    advance() {
      const b = blockadeNow(e);
      if (!b) return;
      if (e.tick === b.until - 36) news(e, "blockade", `The navy has blockaded ${portName(e, b.port)} for 36 hours: every ship will be searched.`, b.port);
      for (const s of arrivals(e)) if (s.port === b.port) search(e, s, "Naval blockade");
    },
    cards(company) {
      const b = blockadeNow(e);
      const next = (Math.floor(e.tick / 168) + (b || e.tick % 168 >= 108 ? 1 : 0)) * 168 + 72;
      return [{ title: "Naval blockade", detail: b
        ? `The navy blockades ${portName(e, b.port)} for ${b.until - e.tick} more hours. Every ship docking there is searched.${companyShips(e, company).some(s => s.dest === b.port) ? " One of your ships is heading there." : ""}`
        : `Once a week the navy blockades one port for 36 hours and searches every arrival. Next blockade in ${next - e.tick} h.` }];
    },
    world: () => ({ blockade: blockadeNow(e) }),
  };
};

