// 591-599: the far-out ideas, built as light content that never changes prices, money, fuel or travel time:
// submarines and airships (exotic refits), a space-shipping programme, underwater ports, a ghost port, a floating
// city, time rifts, a dragon in fantasy mode and real-time cooperative battles against pirate armadas.
// Rewards are collectibles and titles. The airship/submarine speed, fuel and hold changes are in
// platform.exotic-craft-effects, which is economy: true and ships switched off.
import { GOODS, type Engine, type Ship } from "../../engine.js";
import { fail, int, ok, type PlatformFactory } from "./shared.js";

type RaidShield = { cargoRaidProtection: Map<number, number> };
/** Gives a ship cargo-raid protection until `until` (the engine's own map, as the beginner shield uses). */
function shieldShip(e: Engine, ship: number, until: number) {
  const map = (e.piracy as unknown as RaidShield).cargoRaidProtection;
  if (map instanceof Map) map.set(ship, Math.max(map.get(ship) ?? 0, until));
}
function ownDocked(e: Engine, company: number, ship: unknown): Ship | string {
  const id = int(ship, 1, Number.MAX_SAFE_INTEGER);
  const s = id === null ? undefined : e.ships.get(id);
  if (!s || s.owner !== company) return "not your ship";
  if (s.dest !== null) return "the ship must be in port";
  return s;
}
const neighbours = (e: Engine, p: number) => {
  const out = new Set<number>();
  for (const r of e.map.routes) { if (r.a === p) out.add(r.b); if (r.b === p) out.add(r.a); }
  return [...out].sort((a, b) => a - b);
};
const pick = <T>(e: Engine, list: T[]): T => list[Math.min(list.length - 1, Math.floor(e.features.random() * list.length))];
const portName = (e: Engine, p: number) => e.map.ports[p]?.name ?? `port ${p}`;
/** A company's docked ships at a port. */
const dockedAt = (e: Engine, company: number, port: number) =>
  (e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)!).filter(s => s && s.dest === null && s.port === port);

// ------------------------------------------------------------ 591, 592: submarines and airships

export const EXOTIC_KINDS = ["submarine", "airship"] as const;
export type ExoticKind = typeof EXOTIC_KINDS[number];
export const EXOTIC_REFIT_HOURS = 12;
const EXOTIC = new WeakMap<Engine, Map<number, { kind: ExoticKind; ready: number; port: number }>>();
export function exoticOf(e: Engine, ship: number): ExoticKind | null {
  const r = EXOTIC.get(e)?.get(ship);
  return r && e.tick >= r.ready ? r.kind : null;
}

export const exoticCraft: PlatformFactory = (e) => {
  const refits = new Map<number, { kind: ExoticKind; ready: number; port: number }>();
  EXOTIC.set(e, refits);
  return {
    id: "platform.exotic-craft", ideas: [591, 592], title: "Submarines and airships", economy: false,
    apply(cmd) {
      const s = ownDocked(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (cmd.action === "refit") {
        const kind = EXOTIC_KINDS.find(k => k === cmd.kind);
        if (!kind) return fail("choose submarine or airship");
        if (s.type === "pirate") return fail("pirate ships can't be refitted");
        if (s.port !== e.companies.get(cmd.company)!.home) return fail("refits happen at your home port");
        if (s.qty > 0) return fail("empty the hold first");
        if (refits.get(s.id)?.kind === kind) return fail(`this ship is already a ${kind}`);
        const mine = [...refits].filter(([id, r]) => id !== s.id && r.kind === kind && e.ships.get(id)?.owner === cmd.company).length;
        if (mine >= 2) return fail(`you can have two ${kind}s`);
        refits.set(s.id, { kind, ready: e.tick + EXOTIC_REFIT_HOURS, port: s.port });
        return ok;
      }
      if (cmd.action === "restore") {
        if (!refits.delete(s.id)) return fail("this ship has no exotic refit");
        return ok;
      }
      return fail("unknown action");
    },
    advance() {
      for (const [id, r] of [...refits]) {
        const s = e.ships.get(id);
        if (!s) { refits.delete(id); continue; }
        if (e.tick < r.ready && (s.dest !== null || s.port !== r.port)) { refits.delete(id); continue; }   // left the yard early
        // A submerged submarine can't be boarded for its cargo.
        if (e.tick >= r.ready && r.kind === "submarine" && s.dest !== null) shieldShip(e, id, e.tick + 2);
      }
    },
    cards: (company) => {
      const c = e.companies.get(company);
      const ships = (c?.ships ?? []).map(id => e.ships.get(id)!).filter(s => s && s.dest === null && s.port === c!.home && s.type !== "pirate");
      if (!ships.length) return [];
      return [{ title: "Exotic refits", detail: `Turn a ship into a submarine (can't be raided for cargo at sea, finds underwater ports) or an airship (spots ghost ports and the dragon from the air). ${EXOTIC_REFIT_HOURS} hours in the home yard, no charge.`,
        actions: [{ label: "Refit", command: { type: "feature", module: "platform.exotic-craft", action: "refit" },
          fields: [{ key: "ship", label: "Ship", options: ships.map(s => ({ value: s.id, label: `Ship ${s.id} (${s.type})` })) },
            { key: "kind", label: "Into", options: EXOTIC_KINDS.map(k => ({ value: k, label: k })) }] }] }];
    },
    view: (company) => [...refits].filter(([id]) => e.ships.get(id)?.owner === company)
      .map(([ship, r]) => ({ ship, kind: r.kind, ready: e.tick >= r.ready, hoursLeft: Math.max(0, r.ready - e.tick) })),
    world: () => Object.fromEntries([...refits].filter(([id]) => exoticOf(e, id)).map(([id, r]) => [id, r.kind])),
  };
};

/** 591, 592 (economy): airships fly 25% faster but burn 40% more fuel; submarines lose 20% of their hold. */
export const exoticCraftEffects: PlatformFactory = (e) => ({
  id: "platform.exotic-craft-effects", ideas: [591, 592], title: "Submarine and airship performance", economy: true,
  adjust: {
    travelHours: (v, ctx) => exoticOf(e, ctx.ship) === "airship" ? v * 0.75 : v,
    fuel: (v, ctx) => exoticOf(e, ctx.ship) === "airship" ? v * 1.4 : v,
    capacity: (v, ctx) => exoticOf(e, ctx.ship) === "submarine" ? v * 0.8 : v,
  },
});

// ------------------------------------------------------------ 593: space shipping

/** The spaceport: the best-connected port (most routes, lowest id on a tie). */
export function spaceport(e: Engine): number {
  let best = 0, deg = -1;
  for (let p = 0; p < e.n; p++) { const d = neighbours(e, p).length; if (d > deg) { deg = d; best = p; } }
  return best;
}
/** Evaluated lazily: GOODS is not ready while the engine module is still loading. */
const rocketGoods = () => ["machinery", "ore"].filter(g => (GOODS as readonly string[]).includes(g));

/** Cargo sold at the spaceport (normal market sale) counts toward the current rocket. Each full rocket launches,
 *  and every contributor gets a launch on their record. Sales are unchanged: this only counts them. */
export const spaceShipping: PlatformFactory = (e) => {
  let port = 0, goal = { good: 0, tonnes: 200 }, launches = 0;
  const tally = new Map<number, number>(), record = new Map<number, number>();
  let docked = new Map<number, { owner: number; good: number | null; qty: number }>();
  const newGoal = () => {
    const names = rocketGoods().length ? rocketGoods() : [GOODS[0]];
    goal = { good: GOODS.indexOf(pick(e, names) as never), tonnes: 150 + Math.floor(e.features.random() * 4) * 50 };
    tally.clear();
  };
  const snap = () => { docked = new Map([...e.ships.values()].filter(s => s.dest === null && s.port === port).map(s => [s.id, { owner: s.owner, good: s.good, qty: s.qty }])); };
  const total = () => [...tally.values()].reduce((a, b) => a + b, 0);
  return {
    id: "platform.space-shipping", ideas: [593], title: "Space shipping", economy: false,
    enable() { port = spaceport(e); newGoal(); snap(); },
    advance() {
      for (const [id, was] of docked) {
        const s = e.ships.get(id);
        if (!s || s.dest !== null || s.port !== port || was.good !== goal.good) continue;
        const now = s.good === goal.good ? s.qty : 0;
        if (now < was.qty - 1e-6) tally.set(was.owner, (tally.get(was.owner) ?? 0) + (was.qty - now));
      }
      if (total() >= goal.tonnes) {
        launches++;
        for (const id of tally.keys()) record.set(id, (record.get(id) ?? 0) + 1);
        newGoal();
      }
      snap();
    },
    view: (company) => ({ launches: record.get(company) ?? 0, contributed: Math.round(tally.get(company) ?? 0) }),
    world: () => ({ spaceport: port, name: portName(e, port), good: GOODS[goal.good], need: goal.tonnes, loaded: Math.round(total()), launches }),
  };
};

// ------------------------------------------------------------ 594, 595, 596: underwater port, ghost port, floating city

export const mysteryPlaces: PlatformFactory = (e) => {
  let underwater = 0;
  const divers = new Set<number>();
  let ghost: { port: number; until: number } | null = null;
  let city = { port: 0, since: 0 };
  const lanterns = new Map<number, number>(), stamps = new Map<number, number>();
  const visitedGhost = new Set<string>(), visitedCity = new Set<string>();
  return {
    id: "platform.mystery-places", ideas: [594, 595, 596], title: "Mysterious places", economy: false,
    enable() {
      underwater = Math.floor(e.features.random() * e.n);
      city = { port: Math.floor(e.features.random() * e.n), since: e.tick };
    },
    advance() {
      if (ghost && e.tick >= ghost.until) ghost = null;
      if (!ghost && e.features.random() < 1 / 72) ghost = { port: Math.floor(e.features.random() * e.n), until: e.tick + 12 };
      if (e.tick - city.since >= 24) {
        const next = neighbours(e, city.port);
        city = { port: next.length ? pick(e, next) : city.port, since: e.tick };
      }
    },
    apply(cmd) {
      const s = ownDocked(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (cmd.action === "dive") {
        if (exoticOf(e, s.id) !== "submarine") return fail("only a submarine can dive");
        if (divers.has(cmd.company)) return fail("you have already found the underwater port");
        if (s.port !== underwater) return fail("nothing down here but fish");
        divers.add(cmd.company);
        return ok;
      }
      if (cmd.action === "ghost") {
        if (!ghost || s.port !== ghost.port) return fail("no ghost port here");
        const key = `${cmd.company}:${ghost.until}`;
        if (visitedGhost.has(key)) return fail("you already have this ghost port's lantern");
        visitedGhost.add(key); lanterns.set(cmd.company, (lanterns.get(cmd.company) ?? 0) + 1);
        return ok;
      }
      if (cmd.action === "city") {
        if (s.port !== city.port) return fail("the floating city isn't here");
        const key = `${cmd.company}:${city.since}`;
        if (visitedCity.has(key)) return fail("you already have this stop's stamp");
        visitedCity.add(key); stamps.set(cmd.company, (stamps.get(cmd.company) ?? 0) + 1);
        return ok;
      }
      return fail("unknown action");
    },
    cards: (company) => {
      const out = [];
      const ship = (port: number) => dockedAt(e, company, port)[0];
      if (ghost && ship(ghost.port)) out.push({ title: "A ghost port!", detail: `Lights in the fog off ${portName(e, ghost.port)}. It fades in ${ghost.until - e.tick} hours.`,
        actions: [{ label: "Go ashore", command: { type: "feature", module: "platform.mystery-places", action: "ghost", ship: ship(ghost.port).id } }] });
      if (ship(city.port)) out.push({ title: "The floating city", detail: `The floating city is moored at ${portName(e, city.port)} today. Get your passport stamped.`,
        actions: [{ label: "Visit", command: { type: "feature", module: "platform.mystery-places", action: "city", ship: ship(city.port).id } }] });
      const subs = (e.companies.get(company)?.ships ?? []).map(id => e.ships.get(id)!).filter(s => s && s.dest === null && exoticOf(e, s.id) === "submarine");
      if (subs.length && !divers.has(company)) out.push({ title: "Dive", detail: "Somewhere under one port lies a sunken harbour. Dive with a submarine to look.",
        actions: [{ label: `Dive at ${portName(e, subs[0].port)}`, command: { type: "feature", module: "platform.mystery-places", action: "dive", ship: subs[0].id } }] });
      return out;
    },
    view: (company) => ({ lanterns: lanterns.get(company) ?? 0, stamps: stamps.get(company) ?? 0, underwater: divers.has(company) ? underwater : null }),
    world: () => ({ ghost: ghost ? { port: ghost.port, hoursLeft: ghost.until - e.tick } : null, city: city.port, underwaterFoundBy: divers.size }),
  };
};

// ------------------------------------------------------------ 597: time rifts

export const ERAS = [
  { id: "viking", name: "the Viking age", postcard: "Longships trade amber and furs along the coast." },
  { id: "sail", name: "the age of sail", postcard: "Clippers race home with tea, every sail set." },
  { id: "steam", name: "the age of steam", postcard: "Coal smoke over the docks; the first steamers keep timetables." },
  { id: "future", name: "the year 2300", postcard: "Silent hydrofoils glide past glass warehouses." },
] as const;

export const timeRifts: PlatformFactory = (e) => {
  let rift: { port: number; era: number; until: number } | null = null;
  let nextAt = 48;
  const relics = new Map<number, Set<string>>(), stepped = new Set<string>();
  return {
    id: "platform.time-rifts", ideas: [597], title: "Time rifts", economy: false,
    enable() { nextAt = e.tick + 48 + Math.floor(e.features.random() * 72); },
    advance() {
      if (rift && e.tick >= rift.until) { rift = null; nextAt = e.tick + 72 + Math.floor(e.features.random() * 72); }
      if (!rift && e.tick >= nextAt) rift = { port: Math.floor(e.features.random() * e.n), era: Math.floor(e.features.random() * ERAS.length), until: e.tick + 24 };
    },
    apply(cmd) {
      if (cmd.action !== "step") return fail("unknown action");
      const s = ownDocked(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (!rift || s.port !== rift.port) return fail("there is no rift here");
      const key = `${cmd.company}:${rift.until}`;
      if (stepped.has(key)) return fail("you have already been through this rift");
      stepped.add(key);
      const set = relics.get(cmd.company) ?? new Set();
      set.add(ERAS[rift.era].id); relics.set(cmd.company, set);
      return ok;
    },
    cards: (company) => {
      if (!rift) return [];
      const ship = dockedAt(e, company, rift.port)[0];
      if (!ship) return [];
      return [{ title: "A time rift", detail: `The air shimmers over ${portName(e, rift.port)}: a window to ${ERAS[rift.era].name}. ${ERAS[rift.era].postcard}`,
        actions: [{ label: "Step through", command: { type: "feature", module: "platform.time-rifts", action: "step", ship: ship.id } }] }];
    },
    view: (company) => ({ relics: [...(relics.get(company) ?? [])].sort() }),
    world: () => rift ? { port: rift.port, era: ERAS[rift.era].id, hoursLeft: rift.until - e.tick } : null,
  };
};

// ------------------------------------------------------------ 598: dragon (fantasy mode)

export const DRAGON_FRIEND = 5;
export const dragon: PlatformFactory = (e) => {
  let lair = { port: 0, since: 0 };
  const fantasy = new Set<number>(), friendship = new Map<number, number>(), fed = new Set<string>();
  return {
    id: "platform.dragon", ideas: [598], title: "The dragon (fantasy mode)", economy: false,
    enable() { lair = { port: Math.floor(e.features.random() * e.n), since: e.tick }; },
    advance() {
      if (e.tick - lair.since >= 12) { const n = neighbours(e, lair.port); lair = { port: n.length ? pick(e, n) : lair.port, since: e.tick }; }
      // Pirates keep away from the dragon: docked ships of fantasy-mode players beside it are safe from cargo raids.
      for (const id of fantasy) for (const s of dockedAt(e, id, lair.port)) shieldShip(e, s.id, e.tick + 2);
    },
    apply(cmd) {
      if (cmd.action === "fantasy") {
        if (typeof cmd.on !== "boolean") return fail("say on or off");
        if (cmd.on) fantasy.add(cmd.company); else fantasy.delete(cmd.company);
        return ok;
      }
      if (cmd.action === "befriend") {
        if (!fantasy.has(cmd.company)) return fail("turn on fantasy mode first");
        const s = ownDocked(e, cmd.company, cmd.ship);
        if (typeof s === "string") return fail(s);
        if (s.port !== lair.port) return fail("the dragon isn't here");
        const key = `${cmd.company}:${lair.since}`;
        if (fed.has(key)) return fail("the dragon is dozing; come back after it moves");
        fed.add(key);
        friendship.set(cmd.company, Math.min(DRAGON_FRIEND, (friendship.get(cmd.company) ?? 0) + 1));
        return ok;
      }
      return fail("unknown action");
    },
    cards: (company) => {
      const on = fantasy.has(company);
      const toggle = { label: on ? "Leave fantasy mode" : "Enter fantasy mode", command: { type: "feature", module: "platform.dragon", action: "fantasy", on: !on } };
      const ship = on ? dockedAt(e, company, lair.port)[0] : undefined;
      return [{ title: "Fantasy mode", detail: on ? `A dragon roams the coast; today it sleeps at ${portName(e, lair.port)}. Befriend it ${DRAGON_FRIEND} times to ride it. Pirates won't raid ships docked beside it.`
        : "Turn on fantasy mode to see the dragon that roams these waters. Only you see it.",
        actions: ship ? [toggle, { label: "Befriend the dragon", command: { type: "feature", module: "platform.dragon", action: "befriend", ship: ship.id } }] : [toggle] }];
    },
    view: (company) => fantasy.has(company) ? { on: true, port: lair.port, friendship: friendship.get(company) ?? 0, rider: (friendship.get(company) ?? 0) >= DRAGON_FRIEND } : { on: false },
  };
};

// ------------------------------------------------------------ 599: cooperative fleet battles

export const BATTLE_HOURS = 6;
export const fleetBattles: PlatformFactory = (e) => {
  let armada: { port: number; strength: number; hp: number; until: number; committed: Map<number, Set<number>> } | null = null;
  let nextAt = 24;
  const honours = new Map<number, number>();
  const feed: { tick: number; text: string }[] = [];
  const say = (text: string) => { feed.push({ tick: e.tick, text }); if (feed.length > 12) feed.shift(); };
  const shipPower = (s: Ship) => s.type === "pirate" ? 3 : 1;
  const committedPower = () => {
    if (!armada) return 0;
    let p = 0;
    for (const [company, ships] of armada.committed) for (const id of ships) {
      const s = e.ships.get(id);
      if (s && s.owner === company && s.dest === null && s.port === armada.port) p += shipPower(s);
    }
    return p;
  };
  return {
    id: "platform.fleet-battles", ideas: [599], title: "Fleet battles", economy: false,
    enable() { nextAt = e.tick + 24 + Math.floor(e.features.random() * 24); },
    advance() {
      if (!armada && e.tick >= nextAt) {
        const strength = 3 + Math.floor(e.features.random() * 4);
        armada = { port: Math.floor(e.features.random() * e.n), strength, hp: strength * 4, until: e.tick + BATTLE_HOURS, committed: new Map() };
        say(`A pirate armada of ${strength} ships gathers off ${portName(e, armada.port)}! Bring ships to defend it.`);
        return;
      }
      if (!armada) return;
      // Each hour every committed ship fires; hits land with a 60% chance.
      const power = committedPower();
      let hits = 0;
      for (let i = 0; i < power; i++) if (e.features.random() < 0.6) hits++;
      armada.hp -= hits;
      if (power) say(`Round at ${portName(e, armada.port)}: ${power} guns, ${hits} hits; armada at ${Math.max(0, armada.hp)}.`);
      if (armada.hp <= 0 || e.tick >= armada.until) {
        const won = armada.hp <= 0;
        say(won ? `The armada off ${portName(e, armada.port)} is beaten! Defenders' fleets sail safe for a day.` : `The armada off ${portName(e, armada.port)} slips away into the night.`);
        if (won) for (const [company, ships] of armada.committed) {
          if (![...ships].some(id => e.ships.get(id)?.port === armada!.port)) continue;
          honours.set(company, (honours.get(company) ?? 0) + 1);
          for (const id of e.companies.get(company)?.ships ?? []) shieldShip(e, id, e.tick + 24);
        }
        armada = null;
        nextAt = e.tick + 36 + Math.floor(e.features.random() * 36);
      }
    },
    apply(cmd) {
      if (cmd.action !== "commit" && cmd.action !== "withdraw") return fail("unknown action");
      if (!armada) return fail("there is no battle right now");
      const s = ownDocked(e, cmd.company, cmd.ship);
      if (typeof s === "string") return fail(s);
      if (s.port !== armada.port) return fail("the battle is elsewhere");
      const set = armada.committed.get(cmd.company) ?? new Set<number>();
      if (cmd.action === "withdraw") { if (!set.delete(s.id)) return fail("that ship isn't in the battle"); return ok; }
      if (set.has(s.id)) return fail("that ship is already fighting");
      if (set.size >= 3) return fail("three ships per company");
      set.add(s.id); armada.committed.set(cmd.company, set);
      return ok;
    },
    cards: (company) => {
      if (!armada) return [];
      const ships = dockedAt(e, company, armada.port);
      return [{ title: "Pirate armada!", detail: `${armada.strength} pirate ships off ${portName(e, armada.port)}, ${Math.max(0, armada.hp)} hull left, ${armada.until - e.tick} hours to beat them. Docked ships there can join; ships aren't damaged, and winners' fleets get a day of raid protection.`,
        actions: ships.length ? [{ label: "Join the battle", command: { type: "feature", module: "platform.fleet-battles", action: "commit" },
          fields: [{ key: "ship", label: "Ship", options: ships.map(s => ({ value: s.id, label: `Ship ${s.id}` })) }] }] : [] }];
    },
    view: (company) => ({ honours: honours.get(company) ?? 0, fighting: armada ? [...(armada.committed.get(company) ?? [])] : [] }),
    world: () => ({ armada: armada ? { port: armada.port, hp: armada.hp, strength: armada.strength, hoursLeft: armada.until - e.tick, defenders: armada.committed.size } : null, feed }),
  };
};
