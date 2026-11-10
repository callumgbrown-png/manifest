// Pirate threats and protection (ideas 76-82, 84, 93). Zones, ambushes, ransoms, insurance, hired escorts, deck guns,
// bounties and the piracy ledger change money, cargo or travel time, so they are economy modules (off). Player convoys
// (81) only add protection and a convoy log, so they ship on.
// Ambush rolls hash the tick and ship id (roll), so they replay exactly and do not depend on which other modules are on.
import type { Engine, Ship } from "../../engine.js";
import type { FeatureFactory, FeatureModule } from "../types.js";
import {
  act, addStanding, cargoValue, companyShips, day, dockedShip, fail, goodName, inZone, lanePoint, money, namedPirates, nearPt, news,
  Notices, ok, ownShip, peer, pirateZones, portName, position, roll, shared, shipField, standingOf, title, unload, voyageLive, voyageSpent, whole,
} from "./core.js";

// ------------------------------------------------------------ protection, shared by ambush, ransom and bounties

/** The things that make an ambush less likely (chance multiplier) or easier to fight off (repel bonus). */
export function protection(e: Engine, s: Ship) {
  const sh = shared(e);
  const guns = sh.guns.get(s.id) ?? 0;
  const escorted = voyageLive(e, s.id, sh.escorts.get(s.id));
  const convoy = sh.convoys.get(s.id);
  const inConvoy = !!convoy && convoy.departTick === s.departTick && s.dest !== null;
  const exposed = (sh.exposed.get(s.id) ?? 0) > e.tick;
  const navyFriend = e.features.enabled("contracts.navy") && standingOf(e, s.owner)[2] >= 20;
  let mult = 1;
  if (inConvoy) mult *= 0.5;
  if (escorted) mult *= 0.3;
  mult *= 1 - 0.15 * guns;
  if (exposed) mult *= 2;
  if (navyFriend) mult *= 0.8;
  if (sh.pirates.has(s.owner)) mult *= 0.5;
  return { mult, repel: 0.2 + 0.15 * guns + (escorted ? 0.25 : 0) + (inConvoy ? 0.1 : 0), guns, escorted, inConvoy, exposed };
}

/** Record lost cargo (for cargo insurance) and the ledger tally. */
function loseCargo(e: Engine, s: Ship, share: number, kind: string): number {
  const q = Math.floor(s.qty * share);
  if (q <= 0) return 0;
  const good = s.good!;
  const value = q * e.price(s.dest ?? s.port, good);
  unload(e, s, q, 0);
  shared(e).tally.cargoLost += value;
  if (e.features.enabled("contracts.cargo-insurance")) shared(e).losses.push({ ship: s.id, owner: s.owner, amount: value, kind, tick: e.tick });
  return q;
}

/** The fight: true if the crew drives the pirates off. */
export function fight(e: Engine, s: Ship, salt: number): boolean {
  return roll(0x46494748, e.tick, s.id, salt) < Math.min(0.9, protection(e, s).repel);
}

// ------------------------------------------------------------ 76 shifting pirate zones

export const pirateZoneModule: FeatureFactory = (e) => {
  const crosses = (from: number, dest: number) => [0.25, 0.5, 0.75].some(f => inZone(e, lanePoint(e, from, dest, f)) >= 0);
  return {
    id: "contracts.pirate-zones", ideas: [76], title: "Shifting pirate zones", economy: true,
    adjust: { travelHours: (h, ctx) => crosses(ctx.from, ctx.dest) ? Math.ceil(h * 1.1) : h },
    cards(company) {
      const zones = pirateZones(e);
      const atRisk = companyShips(e, company).filter(s => s.dest !== null && inZone(e, position(e, s)) >= 0);
      return [{ title: "Pirate zones", detail: `Three pirate hunting grounds move every day. Voyages whose lane crosses one take 10% longer (crews sail evasively).\nToday: ${zones.map(z => `near ${e.piracy.nearestPort(z)}`).join(", ")}.${atRisk.length ? `\nYour ships inside a zone now: ${atRisk.map(s => s.id).join(", ")}.` : ""}` }];
    },
    world: () => ({ zones: pirateZones(e), tomorrow: pirateZones(e, day(e) + 1) }),
  };
};

// ------------------------------------------------------------ 77 ambushes

export const AMBUSH_BASE = 0.03;
export const ambush: FeatureFactory = (e) => {
  const id = "contracts.ambush";
  const hit = new Map<number, number>();   // ship -> departTick of the voyage already ambushed
  const notes = new Notices();
  const chanceFor = (s: Ship) => {
    const value = cargoValue(e, s);
    let c = AMBUSH_BASE * Math.min(2, Math.max(0.3, value / 3000)) * protection(e, s).mult;
    if (e.features.enabled("contracts.named-pirates") && namedPirates(e).some(p => p.at && nearPt(e, p.at, position(e, s), 60) && !((shared(e).sunk.get(p.id) ?? -1) >= day(e)))) c *= 1.5;
    return c;
  };
  const mod: FeatureModule & { chanceFor(s: Ship): number } = {
    id, ideas: [77], title: "Ambushes", economy: true, chanceFor,
    advance() {
      for (const [ship, dt] of [...hit]) { const s = e.ships.get(ship); if (!s || s.departTick !== dt) hit.delete(ship); }
      for (const s of e.ships.values()) {
        if (s.dest === null || s.type === "pirate" || s.qty <= 0 || s.good === null || hit.get(s.id) === s.departTick) continue;
        if (inZone(e, position(e, s)) < 0) continue;
        if (roll(0x414d4253, e.tick, s.id) >= chanceFor(s)) continue;
        hit.set(s.id, s.departTick);
        shared(e).tally.ambushes++;
        const where = e.piracy.nearestPort(position(e, s));
        const ransom = peer<{ hold(s: Ship): void }>(e, "contracts.ransom");
        if (ransom) { ransom.hold(s); notes.add(e, s.owner, `Pirates stopped ship ${s.id} near ${where} and demand a ransom.`); continue; }
        if (fight(e, s, 1)) { shared(e).tally.repelled++; notes.add(e, s.owner, `Ship ${s.id} fought off an ambush near ${where}.`); continue; }
        const good = s.good;
        const q = loseCargo(e, s, 0.3, "ambush");
        notes.add(e, s.owner, `Pirates ambushed ship ${s.id} near ${where} and took ${q} t of ${goodName(good)}.`);
        news(e, "ambush", `Pirates ambushed a ${s.type} near ${where}.`);
      }
    },
    cards(company) {
      const risky = companyShips(e, company).filter(s => s.dest !== null && s.qty > 0 && s.type !== "pirate");
      return [{ title: "Ambush risk", detail: `Loaded ships crossing a pirate zone may be ambushed once per voyage. Risk grows with cargo value (up to double) and falls with convoys, escorts and deck guns. A beaten crew loses 30% of the cargo.${risky.length ? `\nYour loaded ships at sea: ${risky.map(s => `${s.id} ${(chanceFor(s) * 100).toFixed(1)}%/h in a zone`).join(", ")}.` : ""}`
        + notes.of(company).map(n => `\n• ${n.text}`).join("") }];
    },
    view: (company) => ({ notes: notes.of(company) }),
  };
  return mod;
};

// ------------------------------------------------------------ 78 ransom or fight

interface Hold { ship: number; owner: number; demand: number; until: number }
export const ransom: FeatureFactory = (e) => {
  const id = "contracts.ransom";
  const holds = new Map<number, Hold>();
  const notes = new Notices();
  const fightIt = (h: Hold, s: Ship) => {
    holds.delete(h.ship);
    if (fight(e, s, 2)) { shared(e).tally.repelled++; notes.add(e, h.owner, `Ship ${s.id} fought free of the pirates.`); return "won"; }
    const good = s.good;
    const q = good === null ? 0 : loseCargo(e, s, 0.5, "ransom fight");
    notes.add(e, h.owner, `Ship ${s.id} lost the fight${q ? ` and ${q} t of ${goodName(good!)}` : ""}.`);
    news(e, "ambush", `A crew refused to pay pirates near ${e.piracy.nearestPort(position(e, s))} and lost the fight.`);
    return "lost";
  };
  const mod: FeatureModule & { hold(s: Ship): void } = {
    id, ideas: [78], title: "Ransom or fight", economy: true,
    hold(s) {
      if (holds.has(s.id)) return;
      holds.set(s.id, { ship: s.id, owner: s.owner, demand: Math.round(50 + cargoValue(e, s) * 0.2), until: e.tick + 6 });
    },
    apply(cmd) {
      const h = typeof cmd.ship === "number" ? holds.get(cmd.ship) : undefined;
      if (!h || h.owner !== cmd.company) return fail("that ship is not held by pirates");
      const s = e.ships.get(h.ship)!;
      if (cmd.action === "pay") {
        const c = e.companies.get(cmd.company)!;
        if (c.cash < h.demand) return fail("not enough cash for the ransom");
        c.cash -= h.demand; holds.delete(h.ship);
        shared(e).tally.ransoms++; shared(e).tally.ransomPaid += h.demand;
        notes.add(e, h.owner, `Paid ${money(h.demand)} and ship ${s.id} sailed on.`);
        return ok;
      }
      if (cmd.action === "fight") return { ok: true, outcome: fightIt(h, s) };
      return fail("unknown action");
    },
    advance() {
      for (const h of [...holds.values()]) {
        const s = e.ships.get(h.ship);
        if (!s || s.owner !== h.owner || s.dest === null) { holds.delete(h.ship); continue; }
        // Held: the ship makes no headway this hour.
        s.departTick++; s.arriveTick++;
        if (e.tick >= h.until) fightIt(h, s);
      }
    },
    cards(company) {
      const mine = [...holds.values()].filter(h => h.owner === company);
      return [{ title: "Ransom or fight", detail: `When pirates stop a ship it makes no headway. Pay their demand (20% of the cargo's value plus 50) to sail on, or fight: lose and half the cargo is gone. After 6 hours the crew fights anyway.${mine.length ? "" : "\nNone of your ships is held."}`
          + notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: mine.flatMap(h => [act(id, `Pay ${money(h.demand)} for ship ${h.ship}`, "pay", { ship: h.ship }), act(id, `Fight for ship ${h.ship}`, "fight", { ship: h.ship })]) }];
    },
    view: (company) => ({ holds: [...holds.values()].filter(h => h.owner === company), notes: notes.of(company) }),
  };
  return mod;
};

// ------------------------------------------------------------ 79 cargo insurance

export const cargoInsurance: FeatureFactory = (e) => {
  const id = "contracts.cargo-insurance";
  const policies = new Map<number, { owner: number; at: number; cover: number }>();
  const paid = new Map<number, number>();
  const notes = new Notices();
  return {
    id, ideas: [79], title: "Cargo insurance", economy: true,
    apply(cmd) {
      if (cmd.action !== "insure") return fail("unknown action");
      const s = dockedShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.qty <= 0 || s.good === null) return fail("there is no cargo to insure");
      if (policies.has(s.id)) return fail("that cargo is already insured for its next voyage");
      const value = cargoValue(e, s), premium = Math.round(value * 0.04);
      const c = e.companies.get(cmd.company)!;
      if (c.cash < premium) return fail("not enough cash for the premium");
      c.cash -= premium;
      policies.set(s.id, { owner: cmd.company, at: e.tick, cover: 0.8 });
      return { ok: true, premium };
    },
    advance() {
      for (const loss of shared(e).losses.splice(0)) {
        const p = policies.get(loss.ship);
        if (!p || p.owner !== loss.owner || !voyageLive(e, loss.ship, p)) continue;
        const pay = Math.round(loss.amount * p.cover);
        const c = e.companies.get(loss.owner);
        if (!c) continue;
        c.cash += pay; paid.set(c.id, (paid.get(c.id) ?? 0) + pay);
        notes.add(e, c.id, `Insurers paid ${money(pay)} for cargo lost from ship ${loss.ship} (${loss.kind}).`);
      }
      for (const [ship, p] of [...policies]) if (voyageSpent(e, ship, p)) policies.delete(ship);
    },
    cards(company) {
      const ships = companyShips(e, company).filter(s => s.dest === null && s.qty > 0 && !policies.has(s.id));
      return [{ title: "Cargo insurance", detail: `Insure a loaded ship's cargo for its next voyage: 4% of its value now; 80% of anything pirates take is paid back. Claims paid: ${money(paid.get(company) ?? 0)}.`
          + notes.of(company).map(n => `\n• ${n.text}`).join(""),
        actions: ships.length ? [act(id, "Insure the cargo", "insure", {}, [shipField(ships)])] : [] }];
    },
    view: (company) => ({ insured: [...policies].filter(([, p]) => p.owner === company).map(([s]) => s), paid: paid.get(company) ?? 0 }),
  };
};

// ------------------------------------------------------------ 80 hired escorts

export const escortHire: FeatureFactory = (e) => {
  const id = "contracts.escort-hire";
  const cost = (s: Ship) => Math.round(120 + cargoValue(e, s) * 0.02);
  return {
    id, ideas: [80], title: "Hireable escort ships", economy: true,
    apply(cmd) {
      if (cmd.action !== "hire") return fail("unknown action");
      const s = dockedShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      const sh = shared(e);
      if (sh.escorts.has(s.id)) return fail("an escort is already booked for that ship");
      const c = e.companies.get(cmd.company)!, price = cost(s);
      if (c.cash < price) return fail("not enough cash");
      c.cash -= price;
      sh.escorts.set(s.id, { owner: cmd.company, at: e.tick });
      return { ok: true, cost: price };
    },
    advance() { const sh = shared(e); for (const [ship, b] of [...sh.escorts]) if (voyageSpent(e, ship, b)) sh.escorts.delete(ship); },
    cards(company) {
      const sh = shared(e), ships = companyShips(e, company).filter(s => s.dest === null && !sh.escorts.has(s.id));
      return [{ title: "Hire an escort", detail: `An armed escort sails with one ship for its next voyage: ambushes are 70% less likely and easier to fight off. Price: 120 plus 2% of the cargo's value.${ships[0] ? ` (Ship ${ships[0].id}: ${money(cost(ships[0]))}.)` : ""}`,
        actions: ships.length ? [act(id, "Hire an escort", "hire", {}, [shipField(ships)])] : [] }];
    },
    view: (company) => ({ escorted: [...shared(e).escorts].filter(([, b]) => b.owner === company).map(([s]) => s) }),
  };
};

// ------------------------------------------------------------ 81 player convoys (on)

interface Convoy { id: number; leader: number; port: number; dest: number; formed: number; members: number[]; sailed: boolean }
export const CONVOY_WINDOW = 3;
export const convoys: FeatureFactory = (e) => {
  const id = "contracts.convoys";
  const list = new Map<number, Convoy>();
  let seq = 0;
  const trips = new Map<number, number>();
  const notes = new Notices();
  const memberOf = (ship: number) => [...list.values()].find(c => c.members.includes(ship));
  return {
    id, ideas: [81], title: "Player convoys", economy: false,
    apply(cmd) {
      if (cmd.action === "form" || cmd.action === "join") {
        const s = dockedShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (memberOf(s.id)) return fail("that ship is already in a convoy");
        if (cmd.action === "form") {
          if (!whole(cmd.dest, 0, e.n - 1) || cmd.dest === s.port || !Number.isFinite(e.dist[s.port][cmd.dest])) return fail("choose a destination you can reach");
          const c: Convoy = { id: ++seq, leader: cmd.company, port: s.port, dest: cmd.dest, formed: e.tick, members: [s.id], sailed: false };
          list.set(c.id, c);
          return { ok: true, id: c.id };
        }
        const c = typeof cmd.convoy === "number" ? list.get(cmd.convoy) : undefined;
        if (!c || c.sailed) return fail("that convoy is not forming");
        if (c.port !== s.port) return fail(`the convoy is forming at ${portName(e, c.port)}`);
        if (c.members.length >= 6) return fail("that convoy is full");
        c.members.push(s.id);
        return ok;
      }
      if (cmd.action === "leave") {
        const s = ownShip(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        const c = memberOf(s.id);
        if (!c || c.sailed) return fail("that ship is not waiting in a convoy");
        c.members = c.members.filter(m => m !== s.id);
        if (!c.members.length) list.delete(c.id);
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      const sh = shared(e);
      for (const c of [...list.values()]) {
        const ships = c.members.map(m => e.ships.get(m)).filter((s): s is Ship => !!s);
        const going = ships.filter(s => s.dest === c.dest && s.departTick >= c.formed);
        if (going.length) {
          const first = Math.min(...going.map(s => s.departTick));
          const together = going.filter(s => s.departTick - first <= CONVOY_WINDOW);
          if (together.length >= 2) { c.sailed = true; for (const s of together) sh.convoys.set(s.id, { convoy: c.id, departTick: s.departTick, dest: c.dest }); }
        }
        const atSea = ships.some(s => s.dest !== null && sh.convoys.get(s.id)?.convoy === c.id);
        if (c.sailed && !atSea) {
          const arrived = ships.filter(s => s.dest === null && s.port === c.dest && sh.convoys.get(s.id)?.convoy === c.id);
          for (const owner of new Set(arrived.map(s => s.owner))) {
            trips.set(owner, (trips.get(owner) ?? 0) + 1);
            notes.add(e, owner, `Convoy ${c.id} reached ${portName(e, c.dest)} with ${arrived.length} ships.`);
            addStanding(e, owner, "navy", 1);
          }
          if ((trips.get(c.leader) ?? 0) >= 3) title(e, c.leader, "Convoy Commodore");
          for (const s of ships) if (sh.convoys.get(s.id)?.convoy === c.id) sh.convoys.delete(s.id);
          list.delete(c.id);
        } else if (!c.sailed && e.tick - c.formed > 24) list.delete(c.id);
      }
      for (const [ship, m] of [...sh.convoys]) { const s = e.ships.get(ship); if (!s || (s.dest === null && !list.has(m.convoy))) sh.convoys.delete(ship); }
    },
    cards(company) {
      const docked = companyShips(e, company).filter(s => s.dest === null && !memberOf(s.id));
      const forming = [...list.values()].filter(c => !c.sailed);
      const actions = [];
      if (docked.length) actions.push(act(id, "Form a convoy", "form", {}, [shipField(docked), { key: "dest", label: "Destination", options: e.map.ports.map(p => ({ value: p.id, label: p.name })) }]));
      for (const c of forming.slice(0, 5)) {
        const here = docked.filter(s => s.port === c.port);
        if (here.length) actions.push(act(id, `Join convoy ${c.id} to ${portName(e, c.dest)} (${c.members.length} ships)`, "join", { convoy: c.id }, [shipField(here)]));
      }
      for (const c of forming) for (const m of c.members) if (e.ships.get(m)?.owner === company) actions.push(act(id, `Take ship ${m} out of convoy ${c.id}`, "leave", { ship: m }));
      return [{ title: "Convoys", detail: `Ships of any company that leave the same port for the same destination within ${CONVOY_WINDOW} hours of each other sail as a convoy: pirates find them harder to take. Convoy voyages finished: ${trips.get(company) ?? 0}.`
          + (forming.length ? `\nForming: ${forming.map(c => `#${c.id} ${portName(e, c.port)} → ${portName(e, c.dest)} (${c.members.length})`).join(", ")}` : "")
          + notes.of(company).map(n => `\n• ${n.text}`).join(""), actions }];
    },
    view: (company) => ({ trips: trips.get(company) ?? 0, notes: notes.of(company) }),
    world: () => [...list.values()].map(c => ({ id: c.id, port: c.port, dest: c.dest, ships: c.members.length, sailed: c.sailed })),
  };
};

// ------------------------------------------------------------ 82 deck guns

export const GUN_PRICE = 400;
export const deckGuns: FeatureFactory = (e) => {
  const id = "contracts.deck-guns";
  return {
    id, ideas: [82], title: "Deck-gun upgrades", economy: true,
    apply(cmd) {
      const s = dockedShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      const sh = shared(e), lvl = sh.guns.get(s.id) ?? 0;
      if (cmd.action === "upgrade") {
        if (lvl >= 3) return fail("that ship already carries the heaviest guns");
        const price = GUN_PRICE * (lvl + 1), c = e.companies.get(cmd.company)!;
        if (c.cash < price) return fail("not enough cash");
        c.cash -= price; sh.guns.set(s.id, lvl + 1);
        return { ok: true, level: lvl + 1 };
      }
      if (cmd.action === "remove") { if (!lvl) return fail("no guns to remove"); sh.guns.delete(s.id); return ok; }
      return fail("unknown action");
    },
    advance() { const sh = shared(e); for (const ship of [...sh.guns.keys()]) if (!e.ships.has(ship)) sh.guns.delete(ship); },
    cards(company) {
      const ships = companyShips(e, company).filter(s => s.dest === null);
      return [{ title: "Deck guns", detail: `Each gun level (up to 3) makes ambushes 15% less likely and adds 15% to the chance of fighting pirates off. Level 1 costs ${GUN_PRICE}, level 2 ${GUN_PRICE * 2}, level 3 ${GUN_PRICE * 3}.\nYour guns: ${companyShips(e, company).map(s => `ship ${s.id} L${shared(e).guns.get(s.id) ?? 0}`).join(", ")}.`,
        actions: ships.length ? [act(id, "Upgrade guns", "upgrade", {}, [shipField(ships)]), act(id, "Remove guns", "remove", {}, [shipField(ships)])] : [] }];
    },
    view: (company) => Object.fromEntries(companyShips(e, company).map(s => [s.id, shared(e).guns.get(s.id) ?? 0])),
  };
};

// ------------------------------------------------------------ 84 bounties

export const BOUNTY_RANGE = 60;
export const bounties: FeatureFactory = (e) => {
  const id = "contracts.bounties";
  const tried = new Map<string, number>();   // company:pirate -> day tried
  const claimed = new Map<number, number>();
  const notes = new Notices();
  const value = (i: number) => 400 + 100 * i;
  const live = () => namedPirates(e).filter(p => p.at && !((shared(e).sunk.get(p.id) ?? -1) >= day(e)));
  return {
    id, ideas: [84], title: "Bounties on pirates", economy: true,
    apply(cmd) {
      if (cmd.action !== "hunt") return fail("unknown action");
      if (!whole(cmd.pirate, 0, 99)) return fail("choose a pirate");
      const p = live().find(x => x.id === cmd.pirate);
      if (!p) return fail("that pirate is not at sea");
      const s = ownShip(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.dest === null) return fail("hunt with a ship at sea");
      if (!nearPt(e, position(e, s), p.at!, BOUNTY_RANGE)) return fail(`${p.name} is out of range`);
      const key = `${cmd.company}:${p.id}`;
      if (tried.get(key) === day(e)) return fail("you already tried for that bounty today");
      tried.set(key, day(e));
      const chance = 0.25 + 0.15 * (shared(e).guns.get(s.id) ?? 0) + (voyageLive(e, s.id, shared(e).escorts.get(s.id)) ? 0.15 : 0);
      if (roll(0x424f554e, e.tick, s.id, p.id) >= chance) { notes.add(e, cmd.company, `${p.name} escaped ship ${s.id}.`); return { ok: true, result: "escaped" }; }
      const pay = value(p.id);
      e.companies.get(cmd.company)!.cash += pay;
      claimed.set(cmd.company, (claimed.get(cmd.company) ?? 0) + 1);
      shared(e).sunk.set(p.id, day(e) + 3);
      shared(e).tally.bounties++;
      addStanding(e, cmd.company, "navy", 8);
      notes.add(e, cmd.company, `Ship ${s.id} took ${p.name}: bounty ${money(pay)}.`);
      news(e, "bounty", `${e.companies.get(cmd.company)!.name} brought in ${p.name} for the bounty.`);
      return { ok: true, result: "caught", earned: pay };
    },
    cards(company) {
      const ships = companyShips(e, company).filter(s => s.dest !== null);
      const actions = [];
      for (const p of live()) {
        const near = ships.filter(s => nearPt(e, position(e, s), p.at!, BOUNTY_RANGE));
        if (near.length) actions.push(act(id, `Hunt ${p.name} (${money(value(p.id))})`, "hunt", { pirate: p.id }, [shipField(near)]));
      }
      return [{ title: "Bounties", detail: `The Admiralty pays for named pirates. Bring a ship at sea within range and try once a day; guns and escorts help. A caught pirate stays down for 3 days.\nAt large: ${live().map(p => `${p.name} near ${e.piracy.nearestPort(p.at!)} (${money(value(p.id))})`).join(", ") || "none"}. Your bounties: ${claimed.get(company) ?? 0}.`
        + notes.of(company).map(n => `\n• ${n.text}`).join(""), actions }];
    },
    view: (company) => ({ claimed: claimed.get(company) ?? 0 }),
  };
};

// ------------------------------------------------------------ 93 piracy news ledger

export const newsLedger: FeatureFactory = (e) => ({
  id: "contracts.news-ledger", ideas: [93], title: "Piracy news ledger", economy: true,
  cards: () => {
    const t = shared(e).tally, items = shared(e).news.slice(-8).reverse();
    return [{ title: "Piracy ledger", detail: `Ambushes ${t.ambushes} (fought off ${t.repelled}), cargo lost ${money(t.cargoLost)}, ransoms ${t.ransoms} (${money(t.ransomPaid)}), bounties ${t.bounties}.`
      + items.map(n => `\n• Day ${Math.floor(n.tick / 24) + 1}: ${n.text}`).join("") }];
  },
  world: () => ({ tally: { ...shared(e).tally, cargoLost: Math.round(shared(e).tally.cargoLost) }, news: shared(e).news.slice(-12) }),
});
