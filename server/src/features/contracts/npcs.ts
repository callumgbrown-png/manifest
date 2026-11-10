// Non-player characters (ideas 301-320). Schedules (where an NPC is, what it wants) are pure functions of the map and
// the tick, so every client and every replay agrees. Rival shipping companies move market stock, travelling merchants
// sell cargo and mechanics' service deals cut upkeep, so those three are economy modules (off); the rest ship on.
import { GOODS, type Engine, type Ship } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import {
  act, addStanding, arrivals, companyShips, consumers, DepartureWatch, day, FACTIONS, fail, freighterHours, goodName, hashedPort,
  namedPirates, nearPt, news, peer, Notices, npcName, npcVoyage, ok, ownShip, pirateZones, portName, position, producers, roll, shared, shipField,
  standingOf, standingTier, title, tribePorts, unload, whole, type Faction, type Pt,
} from "./core.js";
import { inspectorPorts, isHideout } from "./law.js";

const week = (e: Engine) => Math.floor(e.tick / 168);
const notesText = (n: Notices, c: number) => n.of(c).map(x => `\n• ${x.text}`).join("");

// ------------------------------------------------------------ 301 rival NPC shipping companies (economy)

export const RIVALS = ["Blackwater Lines", "Gull & Daughters", "Orient Bulk Co."];
interface RivalVoyage { rival: number; from: number; to: number; good: number; qty: number; arrive: number }
export const rivalCompanies: FeatureFactory = (e) => {
  const id = "contracts.rival-companies";
  let voyages: RivalVoyage[] = [];
  const moved = RIVALS.map(() => 0);
  return {
    id, ideas: [301], title: "Rival NPC shipping companies", economy: true,
    advance() {
      for (const v of voyages.filter(x => x.arrive <= e.tick)) { e.stock[v.to][v.good] += v.qty; moved[v.rival] += v.qty; }
      voyages = voyages.filter(x => x.arrive > e.tick);
      if (e.tick % 6 !== 0) return;
      RIVALS.forEach((_, r) => {
        if (voyages.some(v => v.rival === r)) return;
        const good = Math.floor(e.features.random() * GOODS.length);
        const from = producers(e, good), to = consumers(e, good);
        if (!from.length || !to.length) return;
        const a = from[Math.floor(e.features.random() * from.length)], b = to[Math.floor(e.features.random() * to.length)];
        if (a === b || !Number.isFinite(e.dist[a][b])) return;
        const qty = Math.min(20, Math.floor(Math.max(0, e.stock[a][good]) / 4));
        if (qty < 1) return;
        e.stock[a][good] -= qty;
        voyages.push({ rival: r, from: a, to: b, good, qty, arrive: e.tick + freighterHours(e, a, b) });
      });
    },
    cards: () => [{ title: "Rival shipping lines", detail: `Three NPC lines buy where goods are made and sell where they are wanted, moving market stock like any captain.\n${RIVALS.map((n, r) => { const v = voyages.find(x => x.rival === r); return `${n}: ${moved[r]} t delivered${v ? `; now carrying ${v.qty} t ${goodName(v.good)} ${portName(e, v.from)} → ${portName(e, v.to)}` : ""}`; }).join("\n")}` }],
    world: () => ({ rivals: RIVALS.map((name, r) => ({ name, moved: moved[r], voyage: voyages.find(x => x.rival === r) ?? null })) }),
  };
};

// ------------------------------------------------------------ 302-305 factions

function factionModule(f: Faction, idea: number, name: string, blurb: string, extra: (e: Engine) => Partial<FeatureModule> & { perks?: (c: number) => string }): FeatureFactory {
  return (e) => {
    const x = extra(e), i = FACTIONS.indexOf(f);
    return {
      id: `contracts.${f}`, ideas: [idea], title: name, economy: false,
      ...x,
      cards(company) {
        const v = standingOf(e, company)[i];
        const base = { title: name, detail: `${blurb}\nYour standing: ${v} (${standingTier(v)}).${x.perks ? `\n${x.perks(company)}` : ""}` };
        const more = x.cards?.(company) ?? [];
        return more.length ? [{ ...base, detail: `${base.detail}${more[0].detail ? `\n${more[0].detail}` : ""}`, actions: more[0].actions }] : [base];
      },
      view(company) { const v = standingOf(e, company)[i]; return { standing: v, tier: standingTier(v), ...(x.view?.(company) as object ?? {}) }; },
    };
  };
}

export const guild = factionModule("guild", 302, "Merchant guild", "The merchant guild rewards reliable carriers: +2 for every contract delivered, +10 for this week's charter.", (e) => {
  const charter = () => { const g = Math.floor(roll(0x4755494c, week(e)) * GOODS.length); const c = consumers(e, g); return { good: g, port: c.length ? c[Math.floor(roll(0x4755494c, week(e), 1) * c.length)] : hashedPort(e, 0x4755, week(e)) }; };
  const met = new Map<number, number>();   // company -> week met
  return {
    advance() {
      const ch = charter();
      for (const s of arrivals(e)) if (s.port === ch.port && s.good === ch.good && s.qty >= 10 && met.get(s.owner) !== week(e)) {
        met.set(s.owner, week(e)); addStanding(e, s.owner, "guild", 10);
        if (standingOf(e, s.owner)[0] >= 60) title(e, s.owner, "Guild Master");
      }
    },
    perks: (c) => { const ch = charter(); return `This week's charter: bring 10 t or more of ${goodName(ch.good)} into ${portName(e, ch.port)}${met.get(c) === week(e) ? " (done)" : ""}. Honoured members are named Guild Master.`; },
    view: (c) => ({ charter: charter(), met: met.get(c) === week(e) }),
  };
});

export const syndicate = factionModule("syndicate", 303, "Smuggler syndicate", "The syndicate likes captains who carry its crates and fly the black flag.", (e) => {
  const respects = new Map<number, number>();
  return {
    apply(cmd) {
      if (cmd.action !== "respects") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest !== null || !isHideout(e, s.port)) return fail("pay your respects at a hideout");
      if (respects.get(cmd.company) === day(e)) return fail("once a day is enough");
      respects.set(cmd.company, day(e)); addStanding(e, cmd.company, "syndicate", 3);
      return ok;
    },
    perks: (c) => {
      const v = standingOf(e, c)[1];
      return v >= 20 ? `Friendly tip: inspectors are at ${inspectorPorts(e).map(p => portName(e, p)).join(" and ")} today.${v >= 60 ? " Honoured: customs search you half as often." : ""}` : "Friendly members hear where the inspectors are; honoured ones are searched half as often.";
    },
    cards: (c) => {
      const ships = companyShips(e, c).filter(s => s.dest === null && isHideout(e, s.port));
      return ships.length && respects.get(c) !== day(e) ? [{ title: "", detail: "", actions: [act("contracts.syndicate", "Pay your respects (+3)", "respects", {}, [shipField(ships)])] }] : [];
    },
  };
});

export const navy = factionModule("navy", 304, "The navy", "The navy values escorts, convoys, reports, rescues and bounties; it despises the black flag.", (e) => {
  const patrolled = new Map<number, number>();
  return {
    apply(cmd) {
      if (cmd.action !== "patrol") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (shared(e).pirates.has(cmd.company)) return fail("the navy won't sail with a black-flag ship");
      const at = position(e, s);
      if (!e.police.ships.some(p => nearPt(e, e.piracy.position(p), at, 80))) return fail("no police boat is near that ship");
      if (patrolled.get(cmd.company) === day(e)) return fail("once a day");
      patrolled.set(cmd.company, day(e)); addStanding(e, cmd.company, "navy", 2);
      return ok;
    },
    advance() { if (e.tick % 24 === 0) for (const c of shared(e).pirates) addStanding(e, c, "navy", -1); },
    perks: (c) => standingOf(e, c)[2] >= 20 ? "Friendly: naval vessels shadow your ships, so ambushes are 20% less likely (when ambushes are on)." : "Friendly captains are shadowed by naval vessels.",
    cards: (c) => {
      const near = companyShips(e, c).filter(s => e.police.ships.some(p => nearPt(e, e.piracy.position(p), position(e, s), 80)));
      return near.length && patrolled.get(c) !== day(e) && !shared(e).pirates.has(c) ? [{ title: "", detail: "", actions: [act("contracts.navy", "Sail with the patrol (+2)", "patrol", {}, [shipField(near)])] }] : [];
    },
  };
});

export const tribes = factionModule("tribes", 305, "Island tribes", "The island tribes trade with no one, but remember every gift.", (e) => {
  const gifted = new Map<number, { day: number; points: number }>();
  return {
    apply(cmd) {
      if (cmd.action !== "gift") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest !== null || !tribePorts(e).includes(s.port)) return fail("dock at a tribal island first");
      if (s.qty < 1 || s.good === null) return fail("the hold is empty");
      if (!whole(cmd.qty, 1, 10)) return fail("give 1 to 10 tonnes");
      const g = gifted.get(cmd.company), today = g?.day === day(e) ? g.points : 0;
      if (today >= 5) return fail("the elders have had enough gifts for today");
      const q = Math.min(cmd.qty, Math.floor(s.qty));
      unload(e, s, q, 0);
      const pts = Math.min(5 - today, Math.ceil(q / 2));
      gifted.set(cmd.company, { day: day(e), points: today + pts });
      addStanding(e, cmd.company, "tribes", pts);
      const v = standingOf(e, cmd.company)[3];
      if (v >= 20) title(e, cmd.company, "Friend of the Islands");
      if (v >= 60) title(e, cmd.company, "Blood-kin of the Tribes");
      return { ok: true, standing: pts };
    },
    perks: () => `Tribal islands: ${tribePorts(e).map(p => portName(e, p)).join(", ")}. Gifts of cargo (up to 10 t, 5 standing a day) win their friendship and titles.`,
    cards: (c) => {
      const ships = companyShips(e, c).filter(s => s.dest === null && tribePorts(e).includes(s.port) && s.qty >= 1);
      return ships.length ? [{ title: "", detail: "", actions: [act("contracts.tribes", "Give a gift", "gift", {}, [shipField(ships), { key: "qty", label: "Tonnes", min: 1, max: 10, value: 4 }])] }] : [];
    },
  };
});

// ------------------------------------------------------------ 306 wandering trader

export const CURIOS = ["a brass astrolabe", "a jar of sea glass", "a carved whale tooth", "a map of nowhere", "a singing shell", "a captain's lost button",
  "a tin of star tea", "a mermaid's comb", "a ship in a bottle", "a storm-glass", "a pearl of no value", "a compass that points home"];
export const traderPort = (e: Engine, d = day(e)) => hashedPort(e, 0x54524144, d);
export const wanderingTrader: FeatureFactory = (e) => {
  const id = "contracts.wandering-trader";
  const curios = new Map<number, number[]>();
  const met = new Map<number, number>();
  const notes = new Notices();
  return {
    id, ideas: [306], title: "The wandering trader", economy: false,
    apply(cmd) {
      if (cmd.action !== "visit") return fail("unknown action");
      const p = traderPort(e);
      if (!companyShips(e, cmd.company).some(s => s.dest === null && s.port === p)) return fail(`the trader is moored at ${portName(e, p)}`);
      if (met.get(cmd.company) === day(e)) return fail("the trader has nothing more for you today");
      met.set(cmd.company, day(e));
      const have = curios.get(cmd.company) ?? [];
      const left = CURIOS.map((_, i) => i).filter(i => !have.includes(i));
      if (left.length) { const pick = left[Math.floor(roll(0x43555249, cmd.company, day(e)) * left.length)]; have.push(pick); curios.set(cmd.company, have); }
      if (have.length >= CURIOS.length) title(e, cmd.company, "Curio Collector");
      const g = Math.floor(roll(0x52554d52, day(e)) * GOODS.length);
      let best = 0; for (let q = 1; q < e.n; q++) if (e.price(q, g) > e.price(best, g)) best = q;
      notes.add(e, cmd.company, `The trader gave you ${CURIOS[have[have.length - 1]]} and whispered: "${goodName(g)} fetches most at ${portName(e, best)} just now."`);
      return ok;
    },
    cards(company) {
      const p = traderPort(e), here = companyShips(e, company).some(s => s.dest === null && s.port === p);
      return [{ title: "The wandering trader", detail: `An old trader moves port each day; today at ${portName(e, p)}, tomorrow ${portName(e, traderPort(e, day(e) + 1))}. Visit with a docked ship for a curio and a market whisper. Curios: ${(curios.get(company) ?? []).length}/${CURIOS.length}.` + notesText(notes, company),
        actions: here && met.get(company) !== day(e) ? [act(id, "Visit the trader", "visit")] : [] }];
    },
    view: (company) => ({ curios: (curios.get(company) ?? []).map(i => CURIOS[i]) }),
    world: () => ({ port: traderPort(e), next: traderPort(e, day(e) + 1) }),
  };
};

// ------------------------------------------------------------ 307 ghost ship

export const ghostNow = (e: Engine, tick = e.tick) => {
  const d = Math.floor(tick / 24), h = tick % 24;
  if (h >= 5 || roll(0x47484f53, d) >= 1 / 3) return null;
  const v = npcVoyage(e, 0x47484f53 + d, 24, d * 24);
  return v ? { from: v.from, to: v.to, ...posAlong(e, v.from, v.to, h / 5), night: d } : null;
};
function posAlong(e: Engine, a: number, b: number, f: number) { const p = e.piracy.geo.at(e.piracy.geo.voyage(a, b), f); return { x: Math.round(p.x), y: Math.round(p.y) }; }
export const ghostShip: FeatureFactory = (e) => {
  const id = "contracts.ghost-ship";
  const lanterns = new Map<number, number>();
  const hailed = new Map<number, number>();
  return {
    id, ideas: [307], title: "The ghost ship", economy: false,
    apply(cmd) {
      if (cmd.action !== "hail") return fail("unknown action");
      const g = ghostNow(e);
      if (!g) return fail("the sea is empty tonight");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (!nearPt(e, position(e, s), g, 60)) return fail("that ship can't see the ghost");
      if (hailed.get(cmd.company) === g.night) return fail("the ghost has already answered you tonight");
      hailed.set(cmd.company, g.night);
      const n = (lanterns.get(cmd.company) ?? 0) + 1;
      lanterns.set(cmd.company, n);
      if (n >= 5) title(e, cmd.company, "Ghost Whisperer");
      if (n === 1) news(e, "ghost", `${e.companies.get(cmd.company)!.name}'s crew swear they spoke with the ghost ship.`);
      return { ok: true, lanterns: n };
    },
    cards(company) {
      const g = ghostNow(e);
      const near = g ? companyShips(e, company).filter(s => nearPt(e, position(e, s), g, 60)) : [];
      return [{ title: "The ghost ship", detail: `Some nights before dawn a ghostly ship sails a lane. Hail it from a ship close by for a spectral lantern; five make you a Ghost Whisperer. Lanterns: ${lanterns.get(company) ?? 0}.${g ? `\nIt is out tonight near ${e.piracy.nearestPort(g)}!` : ""}`,
        actions: g && near.length && hailed.get(company) !== g.night ? [act(id, "Hail the ghost ship", "hail", {}, [shipField(near)])] : [] }];
    },
    view: (company) => ({ lanterns: lanterns.get(company) ?? 0 }),
    world: () => ({ ghost: ghostNow(e) }),
  };
};

// ------------------------------------------------------------ 308-310 NPC ferries, fishermen and cruise liners

export function npcTraffic(e: Engine, tick = e.tick) {
  const ferries = [0, 1].map(i => npcVoyage(e, 0x46455252 + i, 8, tick)).filter(Boolean);
  const liner = npcVoyage(e, 0x4c494e45, 48, tick);
  const fishing = [0, 1, 2, 3].map(i => {
    const port = hashedPort(e, 0x46495348, i, Math.floor(tick / 72)), p = e.map.ports[port];
    const a = (tick / 6 + i) % (Math.PI * 2), r = 18 * (e.map.worldScale ?? 1);
    return { port, x: Math.round(p.x + Math.cos(a) * r), y: Math.round(p.y + Math.sin(a) * r) };
  });
  return { ferries, liner, fishing };
}
export const npcTrafficModule: FeatureFactory = (e) => {
  const id = "contracts.npc-traffic";
  const asked = new Map<number, number>();
  const notes = new Notices();
  return {
    id, ideas: [308, 309, 310], title: "NPC ferries, fishermen and cruise liners", economy: false,
    apply(cmd) {
      if (cmd.action !== "ask") return fail("unknown action");
      const t = npcTraffic(e);
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest !== null || !t.fishing.some(f => f.port === s.port)) return fail("there are no fishing boats off that port");
      if (asked.get(cmd.company) === day(e)) return fail("the fishermen have told you all they know today");
      asked.set(cmd.company, day(e));
      const here = e.map.ports[s.port] as Pt;
      const z = pirateZones(e).sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y))[0];
      notes.add(e, cmd.company, z ? `Fishermen off ${portName(e, s.port)}: "Black sails seen near ${e.piracy.nearestPort(z)}. Steer clear."` : "Fishermen: \"Quiet seas.\"");
      return ok;
    },
    cards(company) {
      const t = npcTraffic(e);
      const ships = companyShips(e, company).filter(s => s.dest === null && t.fishing.some(f => f.port === s.port));
      return [{ title: "Sea traffic", detail: `Ferries ply ${t.ferries.map(f => `${portName(e, f!.from)} ↔ ${portName(e, f!.to)}`).join(" and ")}; the cruise liner is bound for ${t.liner ? portName(e, t.liner.to) : "nowhere"}; fishing fleets work off ${[...new Set(t.fishing.map(f => portName(e, f.port)))].join(", ")}. Fishermen will tell a docked captain where pirates were seen.` + notesText(notes, company),
        actions: ships.length && asked.get(company) !== day(e) ? [act(id, "Ask the fishermen", "ask", {}, [shipField(ships)])] : [] }];
    },
    world: () => npcTraffic(e),
  };
};

// ------------------------------------------------------------ 311 the old captain's quests

export const QUESTS = ["Come and find me", "Bring grain to a hungry port", "Visit three different ports", "Make a voyage of 12 hours or more", "Come back and tell me"];
export const captainPort = (e: Engine) => hashedPort(e, 0x4f4c4443, week(e));
export const oldCaptain: FeatureFactory = (e) => {
  const id = "contracts.old-captain";
  const step = new Map<number, number>();
  const seen = new Map<number, Set<number>>();
  const grainTo = (c: number) => { const cons = consumers(e, 0); return cons.length ? cons[c % cons.length] : 0; };
  const advanceQuest = (c: number) => {
    const n = (step.get(c) ?? 0) + 1;
    step.set(c, n); seen.set(c, new Set());
    if (n >= QUESTS.length) title(e, c, "The Old Captain's Heir");
  };
  return {
    id, ideas: [311], title: "The old captain", economy: false,
    apply(cmd) {
      if (cmd.action !== "talk") return fail("unknown action");
      const n = step.get(cmd.company) ?? 0;
      if (n !== 0 && n !== 4) return fail("the old captain says: \"Do what I asked first.\"");
      if (!companyShips(e, cmd.company).some(s => s.dest === null && s.port === captainPort(e))) return fail(`the old captain drinks at ${portName(e, captainPort(e))} this week`);
      advanceQuest(cmd.company);
      return ok;
    },
    advance() {
      for (const s of arrivals(e)) {
        const n = step.get(s.owner) ?? 0;
        if (n === 1 && s.port === grainTo(s.owner) && s.good === 0 && s.qty >= 10) advanceQuest(s.owner);
        else if (n === 2) { const v = seen.get(s.owner) ?? new Set(); v.add(s.port); seen.set(s.owner, v); if (v.size >= 3) advanceQuest(s.owner); }
        else if (n === 3 && s.arriveTick - s.departTick >= 12) advanceQuest(s.owner);
      }
    },
    cards(company) {
      const n = step.get(company) ?? 0;
      if (n >= QUESTS.length) return [{ title: "The old captain", detail: "You finished the old captain's tales and carry the title The Old Captain's Heir." }];
      const extra = n === 1 ? ` (10 t of grain into ${portName(e, grainTo(company))})` : n === 2 ? ` (${seen.get(company)?.size ?? 0}/3)` : "";
      const here = companyShips(e, company).some(s => s.dest === null && s.port === captainPort(e));
      return [{ title: "The old captain", detail: `A weathered captain at ${portName(e, captainPort(e))} this week has errands for a young skipper. Task ${n + 1} of ${QUESTS.length}: ${QUESTS[n]}${extra}.`,
        actions: (n === 0 || n === 4) && here ? [act(id, "Talk to the old captain", "talk")] : [] }];
    },
    view: (company) => ({ step: step.get(company) ?? 0 }),
    world: () => ({ port: captainPort(e) }),
  };
};

// ------------------------------------------------------------ 312 a rival AI that learns your habits

export const rivalAi: FeatureFactory = (e) => {
  const id = "contracts.rival-ai";
  const routes = new Map<number, Map<string, number>>();
  const sailing = new Map<number, string>();   // ship -> route key of its current voyage
  const score = new Map<number, { won: number; lost: number; skill: number }>();
  const watch = new DepartureWatch();
  const notes = new Notices();
  const favourite = (c: number) => { let best: string | null = null, n = 0; for (const [k, v] of routes.get(c) ?? []) if (v > n || (v === n && best !== null && k < best)) { best = k; n = v; } return n >= 2 ? best : null; };
  return {
    id, ideas: [312], title: "Captain Vex, the rival who learns", economy: false,
    advance() {
      for (const s of watch.poll(e)) {
        const key = `${s.port}-${s.dest}`, m = routes.get(s.owner) ?? new Map<string, number>();
        m.set(key, (m.get(key) ?? 0) + 1); routes.set(s.owner, m); sailing.set(s.id, key);
      }
      for (const s of arrivals(e)) {
        const key = sailing.get(s.id); sailing.delete(s.id);
        if (!key || key !== favourite(s.owner)) continue;
        const [a, b] = key.split("-").map(Number);
        const sc = score.get(s.owner) ?? { won: 0, lost: 0, skill: 1.1 };
        const vex = Math.ceil(freighterHours(e, a, b) * sc.skill), mine = s.arriveTick - s.departTick;
        if (mine <= vex) { sc.won++; sc.skill = Math.max(0.85, sc.skill - 0.02); notes.add(e, s.owner, `You beat Vex on ${portName(e, a)} → ${portName(e, b)} (${mine} h vs ${vex} h). "I'm learning your tricks," he growls.`); }
        else { sc.lost++; notes.add(e, s.owner, `Vex beat you on ${portName(e, a)} → ${portName(e, b)} (${vex} h vs ${mine} h). "Too predictable."`); }
        score.set(s.owner, sc);
      }
      for (const id of [...sailing.keys()]) if (!e.ships.has(id)) sailing.delete(id);
    },
    cards(company) {
      const fav = favourite(company), sc = score.get(company) ?? { won: 0, lost: 0, skill: 1.1 };
      return [{ title: "Captain Vex", detail: `A rival captain studies where you sail most and races you there.${fav ? ` He's watching ${fav.split("-").map(Number).map(p => portName(e, p)).join(" → ")}.` : " He hasn't worked you out yet."} Races won ${sc.won}, lost ${sc.lost}; Vex sails at ${Math.round(100 / sc.skill)}% of a freighter's pace.` + notesText(notes, company) }];
    },
    view: (company) => ({ favourite: favourite(company), ...(score.get(company) ?? { won: 0, lost: 0, skill: 1.1 }) }),
  };
};

// ------------------------------------------------------------ 313 named pirates with personalities

export const namedPiratesModule: FeatureFactory = (e) => {
  const id = "contracts.named-pirates";
  const warned = new Map<string, number>();
  const notes = new Notices();
  const live = () => namedPirates(e).filter(p => p.at && !((shared(e).sunk.get(p.id) ?? -1) >= day(e)));
  return {
    id, ideas: [313], title: "Named pirates", economy: false,
    apply(cmd) {
      if (cmd.action !== "parley") return fail("unknown action");
      if (!shared(e).pirates.has(cmd.company)) return fail("pirates only parley with the black flag");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      const p = live().find(x => x.id === cmd.pirate && nearPt(e, position(e, s), x.at!, 60));
      if (!p) return fail("no named pirate is near that ship");
      const next = namedPirates(e, (p.at!.leg + 1) * 30)[p.id].at;
      notes.add(e, cmd.company, `${p.name} (${p.trait}) shares rum and plans: next bound ${next ? `${portName(e, next.from)} → ${portName(e, next.to)}` : "nowhere"}.`);
      return ok;
    },
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest === null) continue;
        for (const p of live()) {
          const key = `${s.owner}:${p.id}`;
          if (warned.get(key) === day(e) || !nearPt(e, position(e, s), p.at!, 60)) continue;
          warned.set(key, day(e));
          notes.add(e, s.owner, `Lookouts on ship ${s.id} spotted ${p.name}'s sails — they say ${p.name} ${p.line}.`);
        }
      }
    },
    cards(company) {
      const near = companyShips(e, company).flatMap(s => live().filter(p => nearPt(e, position(e, s), p.at!, 60)).map(p => ({ s, p })));
      return [{ title: "Named pirates", detail: live().map(p => `${p.name}, the ${p.trait} (${p.line}): near ${e.piracy.nearestPort(p.at!)}`).join("\n") + notesText(notes, company),
        actions: shared(e).pirates.has(company) ? near.slice(0, 3).map(({ s, p }) => act(id, `Parley with ${p.name} from ship ${s.id}`, "parley", { pirate: p.id, ship: s.id })) : [] }];
    },
    view: (company) => ({ notes: notes.of(company) }),
    world: () => ({ pirates: live().map(p => ({ id: p.id, name: p.name, trait: p.trait, x: p.at!.x, y: p.at!.y })) }),
  };
};

// ------------------------------------------------------------ 314 legendary captains

export const LEGENDS = [
  { name: "Admiral Corwen", title: "Corwen's Equal", goal: "complete 25 voyages", stat: "voyages", need: 25 },
  { name: "Mother Sable", title: "Sable's Wanderer", goal: "dock at 12 different ports", stat: "ports", need: 12 },
  { name: "Old Tom Halyard", title: "Halyard's Heir", goal: "carry 1,000 t of cargo into port", stat: "tonnes", need: 1000 },
] as const;
export const legends: FeatureFactory = (e) => {
  const id = "contracts.legends";
  const stats = new Map<number, { voyages: number; ports: Set<number>; tonnes: number }>();
  const hall: { company: string; legend: string; tick: number }[] = [];
  const need = (l: (typeof LEGENDS)[number]) => Math.min(l.need, l.stat === "ports" ? e.n : Infinity);
  const value = (c: number, l: (typeof LEGENDS)[number]) => { const s = stats.get(c); return !s ? 0 : l.stat === "voyages" ? s.voyages : l.stat === "ports" ? s.ports.size : Math.floor(s.tonnes); };
  return {
    id, ideas: [314], title: "Legendary captains", economy: false,
    advance() {
      for (const s of arrivals(e)) {
        const st = stats.get(s.owner) ?? { voyages: 0, ports: new Set<number>(), tonnes: 0 };
        st.voyages++; st.ports.add(s.port); st.tonnes += s.qty;
        stats.set(s.owner, st);
        for (const l of LEGENDS) if (value(s.owner, l) >= need(l) && title(e, s.owner, l.title)) {
          hall.push({ company: e.companies.get(s.owner)!.name, legend: l.name, tick: e.tick });
          news(e, "legend", `${l.name} raised a glass to ${e.companies.get(s.owner)!.name}: "${l.title}!"`);
        }
      }
    },
    cards: (company) => [{ title: "Legendary captains", detail: `Three living legends each name an equal:\n${LEGENDS.map(l => `${l.name}: ${l.goal} — ${Math.min(value(company, l), need(l))}/${need(l)}`).join("\n")}${hall.length ? `\nHall of legends: ${hall.slice(-5).map(h => `${h.company} (${h.legend})`).join(", ")}` : ""}` }],
    view: (company) => Object.fromEntries(LEGENDS.map(l => [l.stat, value(company, l)])),
    world: () => ({ hall: hall.slice(-10) }),
  };
};

// ------------------------------------------------------------ 315 port mayors

export const mayorWish = (e: Engine, port: number) => Math.floor(roll(0x4d415952, port, week(e)) * GOODS.length);
export const mayors: FeatureFactory = (e) => {
  const id = "contracts.mayors";
  const favour = new Map<string, number>();   // company:port
  const counted = new Map<string, number>();  // ship:port -> day
  return {
    id, ideas: [315], title: "Port mayors", economy: false,
    advance() {
      for (const s of arrivals(e)) {
        if (s.good !== mayorWish(e, s.port) || s.qty < 5) continue;
        const ck = `${s.id}:${s.port}`;
        if (counted.get(ck) === day(e)) continue;
        counted.set(ck, day(e));
        const k = `${s.owner}:${s.port}`, f = (favour.get(k) ?? 0) + 1;
        favour.set(k, f);
        if (f >= 5 && title(e, s.owner, `Freedom of ${portName(e, s.port)}`)) news(e, "mayor", `Mayor ${npcName(s.port)} gave ${e.companies.get(s.owner)!.name} the freedom of ${portName(e, s.port)}.`, s.port);
      }
    },
    cards(company) {
      const ports = [...new Set(companyShips(e, company).map(s => s.dest ?? s.port))];
      return [{ title: "Port mayors", detail: `Every port has a mayor with a wish each week. Bring 5 t or more of it into port (once per ship a day) for favour; 5 favour earns the freedom of the port.\n${ports.map(p => `${portName(e, p)}: Mayor ${npcName(p)} wants ${goodName(mayorWish(e, p))} (your favour ${favour.get(`${company}:${p}`) ?? 0})`).join("\n")}` }];
    },
    view: (company) => Object.fromEntries([...favour].filter(([k]) => k.startsWith(`${company}:`)).map(([k, v]) => [k.split(":")[1], v])),
    world: () => ({ mayors: e.map.ports.map(p => ({ port: p.id, name: npcName(p.id), wish: mayorWish(e, p.id) })) }),
  };
};

// ------------------------------------------------------------ 316 journalists

export const REPORTERS = [{ name: "Ada Quill", paper: "The Harbour Herald" }, { name: "Jonas Pike", paper: "The Tidewater Times" }, { name: "Nell Fairweather", paper: "The Compass Rose" }];
const TONES = { boast: "boasts that no captain alive can match their fleet", humble: "thanks the dockhands and crews who keep their ships afloat", mysterious: "smiles and says only that \"the tide is turning\"" } as const;
export const journalists: FeatureFactory = (e) => {
  const id = "contracts.journalists";
  const interviews = new Map<number, number>();
  const pieces: { tick: number; reporter: number; text: string }[] = [];
  const articles = () => [...shared(e).news.slice(-8).map(n => ({ tick: n.tick, reporter: n.id % REPORTERS.length, text: n.text })), ...pieces]
    .sort((a, b) => a.tick - b.tick).slice(-8);
  return {
    id, ideas: [316], title: "Journalists who write the news", economy: false,
    apply(cmd) {
      if (cmd.action !== "interview") return fail("unknown action");
      if (typeof cmd.tone !== "string" || !Object.hasOwn(TONES, cmd.tone)) return fail("choose a tone");
      if (interviews.get(cmd.company) === day(e)) return fail("one interview a day");
      interviews.set(cmd.company, day(e));
      const r = Math.floor(roll(0x4a4f5552, cmd.company, day(e)) * REPORTERS.length);
      pieces.push({ tick: e.tick, reporter: r, text: `${e.companies.get(cmd.company)!.name} ${TONES[cmd.tone as keyof typeof TONES]}.` });
      if (pieces.length > 8) pieces.shift();
      return ok;
    },
    cards: (company) => [{ title: "The papers", detail: articles().reverse().map(a => `${REPORTERS[a.reporter].paper} (${REPORTERS[a.reporter].name}), day ${Math.floor(a.tick / 24) + 1}: ${a.text}`).join("\n") || "Slow news day.",
      actions: interviews.get(company) === day(e) ? [] : [act(id, "Give an interview", "interview", {}, [{ key: "tone", label: "Tone", options: Object.keys(TONES).map(t => ({ value: t, label: t })) }])] }],
    world: () => ({ articles: articles().map(a => ({ ...a, by: REPORTERS[a.reporter].name, paper: REPORTERS[a.reporter].paper })) }),
  };
};

// ------------------------------------------------------------ 317 inspectors

export const inspectors: FeatureFactory = (e) => ({
  id: "contracts.inspectors", ideas: [317], title: "Inspectors", economy: false,
  cards: () => [{ title: "Customs inspectors", detail: `Two senior inspectors move each day; where they stand, customs searches are far likelier (when inspections are on).\nToday: ${inspectorPorts(e).map((p, i) => `Inspector ${npcName(0x494e, i)} at ${portName(e, p)}`).join(", ")}.\nTomorrow: ${inspectorPorts(e, day(e) + 1).map(p => portName(e, p)).join(", ")}.` }],
  world: () => ({ today: inspectorPorts(e), tomorrow: inspectorPorts(e, day(e) + 1) }),
});

// ------------------------------------------------------------ 318 mechanics (on) and their service deals (economy)

export const mechanicPorts = (e: Engine, d = day(e)) => [0, 1, 2].map(i => hashedPort(e, 0x4d454348, d, i));
export const SERVICE_HOURS = 168;
export const mechanics: FeatureFactory = (e) => {
  const id = "contracts.mechanics";
  const serviced = new Map<number, number>();   // ship -> serviced until
  const voyages = new Map<number, number>();    // ship -> voyages since last checkup
  const watch = new DepartureWatch();
  const notes = new Notices();
  const mod: FeatureModule & { servicedShip(ship: number): boolean } = {
    id, ideas: [318], title: "Mechanics with repair deals", economy: false,
    servicedShip: (ship) => (serviced.get(ship) ?? 0) > e.tick,
    apply(cmd) {
      if (cmd.action !== "checkup") return fail("unknown action");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest !== null || !mechanicPorts(e).includes(s.port)) return fail("no mechanic works at that port today");
      if ((serviced.get(s.id) ?? 0) > e.tick) return fail("that ship was serviced recently");
      const fx = peer<{ fee: number }>(e, "contracts.mechanics-effects");
      if (fx) { const c = e.companies.get(cmd.company)!; if (c.cash < fx.fee) return fail("not enough cash for the service"); c.cash -= fx.fee; }
      const v = voyages.get(s.id) ?? 0;
      serviced.set(s.id, e.tick + SERVICE_HOURS); voyages.set(s.id, 0);
      notes.add(e, cmd.company, `Mechanic ${npcName(0x4d45, s.port)} checked ship ${s.id} after ${v} voyages: ${v > 10 ? "\"She's tired; treat her gently.\"" : v > 4 ? "\"A few loose rivets, all tightened.\"" : "\"Sound as a bell.\""}`);
      return ok;
    },
    advance() {
      for (const s of watch.poll(e)) voyages.set(s.id, (voyages.get(s.id) ?? 0) + 1);
      for (const [ship, until] of [...serviced]) if (until <= e.tick || !e.ships.has(ship)) serviced.delete(ship);
    },
    cards(company) {
      const ships = companyShips(e, company).filter(s => s.dest === null && mechanicPorts(e).includes(s.port) && !mod.servicedShip(s.id));
      return [{ title: "Mechanics", detail: `Travelling mechanics work at ${mechanicPorts(e).map(p => portName(e, p)).join(", ")} today. A checkup gives a ship a Serviced badge for a week and a report on its state.${e.features.enabled("contracts.mechanics-effects") ? " Service deal: 80 per checkup; serviced ships cost 10% less upkeep." : ""}` + notesText(notes, company),
        actions: ships.length ? [act(id, "Book a checkup", "checkup", {}, [shipField(ships)])] : [] }];
    },
    view: (company) => ({ serviced: companyShips(e, company).filter(s => mod.servicedShip(s.id)).map(s => s.id) }),
    world: () => ({ ports: mechanicPorts(e) }),
  };
  return mod;
};
export const mechanicsEffects: FeatureFactory = (e) => ({
  id: "contracts.mechanics-effects", ideas: [318], title: "Mechanics' service deals", economy: true, fee: 80,
  adjust: {
    upkeep: (u, ctx) => {
      const m = peer<{ servicedShip(ship: number): boolean }>(e, "contracts.mechanics"), c = e.companies.get(ctx.company);
      if (!m || !c) return u;
      let cut = 0;
      for (const id of c.ships) { const s = e.ships.get(id); if (s && m.servicedShip(id)) cut += e.spec(s.type).upkeep * 0.1; }
      return Math.max(0, u - cut);
    },
  },
} as FeatureModule);

// ------------------------------------------------------------ 319 travelling merchants (economy)

export const merchantsToday = (e: Engine, d = day(e)) => [0, 1].map(i => ({ id: i, port: hashedPort(e, 0x4d455243, d, i), good: Math.floor(roll(0x4d455243, d, i, 9) * GOODS.length) }));
export const travellingMerchants: FeatureFactory = (e) => {
  const id = "contracts.travelling-merchants";
  const sold = new Map<string, number>();   // day:merchant -> tonnes sold
  const STOCK = 60;
  const left = (m: { id: number }) => STOCK - (sold.get(`${day(e)}:${m.id}`) ?? 0);
  const unitPrice = (m: { port: number; good: number }) => Math.round(e.price(m.port, m.good) * 0.85 * 100) / 100;
  return {
    id, ideas: [319], title: "Travelling merchants", economy: true,
    apply(cmd) {
      if (cmd.action !== "buy") return fail("unknown action");
      if (!whole(cmd.merchant, 0, 1)) return fail("choose a merchant");
      const m = merchantsToday(e)[cmd.merchant];
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest !== null || s.port !== m.port) return fail(`that merchant is at ${portName(e, m.port)}`);
      if (s.qty > 0 && s.good !== m.good) return fail("the hold carries another good");
      if (!whole(cmd.qty, 1, STOCK)) return fail(`buy 1 to ${STOCK} tonnes`);
      const q = Math.min(cmd.qty, left(m), Math.floor(e.expansionCapacity(s) - s.qty));
      if (q < 1) return fail("no room or no stock left");
      const cost = Math.round(q * unitPrice(m) * 100) / 100, c = e.companies.get(cmd.company)!;
      if (c.cash < cost) return fail("not enough cash");
      c.cash -= cost; s.good = m.good; s.qty += q; s.cost += cost;
      e.recordCargoLoaded(s, cost);
      sold.set(`${day(e)}:${m.id}`, STOCK - left(m) + q);
      return { ok: true, qty: q, cost };
    },
    cards(company) {
      const ms = merchantsToday(e);
      const actions = ms.flatMap(m => {
        const ships = companyShips(e, company).filter(s => s.dest === null && s.port === m.port && (s.qty === 0 || s.good === m.good));
        return ships.length && left(m) > 0 ? [act(id, `Buy ${goodName(m.good)} at ${unitPrice(m)}/t`, "buy", { merchant: m.id }, [shipField(ships), { key: "qty", label: "Tonnes", min: 1, max: left(m), value: Math.min(20, left(m)) }])] : [];
      });
      return [{ title: "Travelling merchants", detail: `Two merchants sell from their own stock at 15% under the local price (${STOCK} t each per day).\n${ms.map(m => `${npcName(0x4d52, m.id, day(e))} at ${portName(e, m.port)}: ${goodName(m.good)}, ${left(m)} t left`).join("\n")}`, actions }];
    },
    world: () => ({ merchants: merchantsToday(e) }),
  };
};

// ------------------------------------------------------------ 320 the mystery stranger

export const RIDDLES = [
  { q: "I have a bed but never sleep, a mouth but never eat.", options: ["a river", "a harbour", "a ship"], a: 0 },
  { q: "The more you take, the more you leave behind.", options: ["coins", "footsteps", "anchors"], a: 1 },
  { q: "What runs around a port but never moves?", options: ["a sea wall", "a gull", "the tide"], a: 0 },
  { q: "I am always coming but never arrive.", options: ["the mail ship", "tomorrow", "the storm"], a: 1 },
  { q: "Feed me and I live; give me water and I die.", options: ["a sailor", "fire", "rust"], a: 1 },
];
export const strangerPort = (e: Engine) => hashedPort(e, 0x53545241, Math.floor(e.tick / 72));
export const stranger: FeatureFactory = (e) => {
  const id = "contracts.stranger";
  const solved = new Map<number, number>();
  const tried = new Map<number, number>();   // company -> appearance tried
  const appearance = () => Math.floor(e.tick / 72);
  return {
    id, ideas: [320], title: "The mystery stranger", economy: false,
    apply(cmd) {
      if (cmd.action !== "answer") return fail("unknown action");
      const n = solved.get(cmd.company) ?? 0;
      if (n >= RIDDLES.length) return fail("the stranger has nothing left to ask you");
      if (!companyShips(e, cmd.company).some(s => s.dest === null && s.port === strangerPort(e))) return fail("the stranger is not where your ships are");
      if (tried.get(cmd.company) === appearance()) return fail("the stranger has already heard your answer; come back when they reappear");
      if (!whole(cmd.choice, 0, RIDDLES[n].options.length - 1)) return fail("choose an answer");
      tried.set(cmd.company, appearance());
      if (cmd.choice !== RIDDLES[n].a) return { ok: true, correct: false };
      solved.set(cmd.company, n + 1);
      if (n + 1 >= RIDDLES.length) { title(e, cmd.company, "Keeper of the Stranger's Token"); news(e, "stranger", `A cloaked stranger left ${e.companies.get(cmd.company)!.name} a strange silver token.`); }
      return { ok: true, correct: true };
    },
    cards(company) {
      const n = solved.get(company) ?? 0, here = companyShips(e, company).some(s => s.dest === null && s.port === strangerPort(e));
      if (n >= RIDDLES.length) return [{ title: "The mystery stranger", detail: "You hold the Stranger's Token." }];
      return [{ title: "The mystery stranger", detail: `A cloaked figure is seen at ${portName(e, strangerPort(e))} for ${72 - (e.tick % 72)} more hours. Riddles solved: ${n}/${RIDDLES.length}. One answer per appearance.${here ? `\n"${RIDDLES[n].q}"` : ""}`,
        actions: here && tried.get(company) !== appearance() ? [act(id, "Answer the riddle", "answer", {}, [{ key: "choice", label: "Answer", options: RIDDLES[n].options.map((o, i) => ({ value: i, label: o })) }])] : [] }];
    },
    view: (company) => ({ solved: solved.get(company) ?? 0 }),
    world: () => ({ port: strangerPort(e) }),
  };
};

export type { Ship };
