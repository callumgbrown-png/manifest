// Guild activities: HQ and shipyard (341, 342), guild-held ports (115), guild contests (116), missions and the tech
// tree (352, 355), formations (353), shared fleets (112), the hall of fame (360) and reputation (129, 356).
// None of these change prices, fees, fuel or travel time.
import type { Engine, Ship, ShipType } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, addTrust, atLeast, cannotTransfer, day, deliveriesSince, fail, guildName, guildOf, hasRoom, isInt, isPort, members, name, OK,
  portName, portOptions, rankOf, record, social, transferShip, trustOf, type Guild } from "./shared.js";

const GOODS = ["grain", "fuel", "ore", "machinery"];
/** Guild deliveries in the last hour, per guild: [company, trip]. Shared by several modules below. */
function guildDeliveries(e: Engine, since: number) {
  const out = new Map<number, { company: number; to: number; good: number; qty: number }[]>();
  for (const g of social(e).guilds.values()) for (const c of members(e, g))
    for (const t of deliveriesSince(e, c, since)) (out.get(g.id) ?? out.set(g.id, []).get(g.id)!).push({ company: c, to: t.to, good: t.good!, qty: t.qty });
  return out;
}
export function fame(g: Guild, line: string) { g.fame.push(line); if (g.fame.length > 20) g.fame.shift(); }

export const HQ_MOVE_HOURS = 72;
export const hqModule: FeatureFactory = (e) => {
  const id = "social.guild-hq";
  const launched = new Map<number, number>();   // guild -> ships launched at its yard
  return {
    id, ideas: [341, 342], title: "Guild HQ and shipyard", economy: false,
    apply(cmd) {
      const g = guildOf(e, cmd.company);
      if (!g) return fail("join a guild first");
      if (cmd.action === "setHq") {
        if (rankOf(e, cmd.company) !== "leader") return fail("only the leader moves the HQ");
        if (!isPort(e, cmd.port)) return fail("choose a port");
        if (e.tick - g.hqSince < HQ_MOVE_HOURS) return fail(`the HQ can move once every ${HQ_MOVE_HOURS} hours`);
        g.hq = cmd.port; g.hqSince = e.tick;
        fame(g, `Day ${day(e)}: HQ set at ${portName(e, cmd.port)}.`);
        return OK;
      }
      if (cmd.action === "build") {   // the guild yard builds at the normal price, even with no ship of yours docked there
        if (g.hq === null) return fail("your guild has no HQ yet");
        const type = cmd.shipType as ShipType;
        if (!["coaster", "freighter", "bulker"].includes(type) || (type !== "freighter" && !e.rules.ship_types)) return fail("unknown ship class");
        if (!hasRoom(e, cmd.company)) return fail("your fleet is at its maximum");
        const c = e.companies.get(cmd.company)!, price = e.spec(type).price;
        if (c.cash < price) return fail("not enough cash");
        c.cash -= price;
        const s = e.addExpansionShip(c, g.hq, type);
        launched.set(g.id, (launched.get(g.id) ?? 0) + 1);
        return { ok: true, id: s.id, spent: price };
      }
      return fail("unknown action");
    },
    cards(company) {
      const g = guildOf(e, company);
      if (!g) return [];
      const leader = rankOf(e, company) === "leader";
      return [{ title: "Guild HQ", detail: g.hq === null ? "No HQ yet. The leader picks a port; members can then build ships at the guild yard there at the normal price."
        : `HQ: ${portName(e, g.hq)}. The guild yard has launched ${launched.get(g.id) ?? 0} ship(s).`,
        actions: [
          ...(leader ? [{ ...action(id, "Set HQ port", "setHq"), fields: [{ key: "port", label: "Port", options: portOptions(e) }] }] : []),
          ...(g.hq !== null ? [{ ...action(id, "Build at the guild yard", "build"), fields: [{ key: "shipType", label: "Class",
            options: (e.rules.ship_types ? ["coaster", "freighter", "bulker"] : ["freighter"]).map(t => ({ value: t, label: `${t} (${e.spec(t as ShipType).price.toLocaleString("en-GB")})` })) }] }] : []),
        ] }];
    },
    world() { return Object.fromEntries([...social(e).guilds.values()].filter(g => g.hq !== null).map(g => [g.id, { hq: g.hq, launched: launched.get(g.id) ?? 0 }])); },
  };
};

/** Idea 115: a guild holds a port when its members delivered the most there over the last 3 days (at least 300 t). */
export const HOLD_MIN = 300, HOLD_WINDOW = 72;
export const guildPortsModule: FeatureFactory = (e) => {
  let lastScan = 0;
  const log: { tick: number; guild: number; port: number; qty: number }[] = [];
  let holders = new Map<number, number>();   // port -> guild
  return {
    id: "social.guild-ports", ideas: [115], title: "Guild-held ports", economy: false,
    enable() { lastScan = e.tick; },
    advance() {
      for (const [gid, list] of guildDeliveries(e, lastScan)) for (const d of list) log.push({ tick: e.tick, guild: gid, port: d.to, qty: d.qty });
      lastScan = e.tick;
      while (log.length && log[0].tick <= e.tick - HOLD_WINDOW) log.shift();
      if (e.tick % 24 !== 0) return;
      const totals = new Map<number, Map<number, number>>();
      for (const l of log) { const m = totals.get(l.port) ?? totals.set(l.port, new Map()).get(l.port)!; m.set(l.guild, (m.get(l.guild) ?? 0) + l.qty); }
      const next = new Map<number, number>();
      for (const [port, m] of totals) {
        const [best, second] = [...m].filter(([g]) => social(e).guilds.has(g)).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        if (best && best[1] >= HOLD_MIN && (!second || best[1] > second[1])) next.set(port, best[0]);
      }
      for (const [port, gid] of next) if (holders.get(port) !== gid) { const g = social(e).guilds.get(gid)!; fame(g, `Day ${day(e)}: took ${portName(e, port)}.`); g.xp += 10; }
      holders = next;
    },
    world() { return [...holders].map(([port, gid]) => ({ port, guild: gid, name: guildName(e, gid) })); },
  };
};

/** Idea 116: a weekly guild contest. Each week has a theme (tonnes, distinct ports, one good); results go to fame. */
export const CONTESTS = [{ id: "tonnes", name: "Most tonnes delivered" }, { id: "ports", name: "Most different ports served" }, { id: "machinery", name: "Most machinery delivered" }, { id: "grain", name: "Most grain delivered" }];
export const guildContestsModule: FeatureFactory = (e) => {
  let lastScan = 0, week = 0;
  let score = new Map<number, number>(), ports = new Map<number, Set<number>>();
  const results: { week: number; contest: string; winner: string }[] = [];
  const contest = () => CONTESTS[week % CONTESTS.length];
  const points = (gid: number) => contest().id === "ports" ? (ports.get(gid)?.size ?? 0) : (score.get(gid) ?? 0);
  return {
    id: "social.guild-contests", ideas: [116], title: "Guild contests", economy: false,
    enable() { lastScan = e.tick; week = Math.floor(e.tick / 168); },
    advance() {
      const c = contest();
      for (const [gid, list] of guildDeliveries(e, lastScan)) for (const d of list) {
        if (c.id === "tonnes" || GOODS[d.good] === c.id) score.set(gid, (score.get(gid) ?? 0) + d.qty);
        (ports.get(gid) ?? ports.set(gid, new Set()).get(gid)!).add(d.to);
      }
      lastScan = e.tick;
      if (Math.floor(e.tick / 168) !== week) {
        const ranked = [...social(e).guilds.keys()].map(g => [g, points(g)] as const).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        if (ranked.length) {
          const g = social(e).guilds.get(ranked[0][0])!;
          fame(g, `Week ${week + 1}: won "${c.name}".`); g.xp += 25;
          results.push({ week: week + 1, contest: c.name, winner: guildName(e, g.id) });
          if (results.length > 10) results.shift();
        }
        week = Math.floor(e.tick / 168); score = new Map(); ports = new Map();
      }
    },
    world() {
      return { week: week + 1, contest: contest().name, standings: [...social(e).guilds.keys()].map(g => ({ guild: guildName(e, g), points: points(g) }))
        .filter(x => x.points > 0).sort((a, b) => b.points - a.points).slice(0, 8), results };
    },
  };
};

/** Ideas 352, 355: a daily guild mission (deliver a good to a port), guild XP, and a tech tree bought with XP. Techs
 *  unlock guild features only (bigger roster, shared charts, more fame entries, formation signals), never economy. */
export const TECHS: Record<string, { name: string; cost: number; needs?: string; does: string }> = {
  muster: { name: "Muster roll", cost: 40, does: "+4 member places" },
  charts: { name: "Shared charts", cost: 60, does: "see where your guildmates' ships are" },
  signals: { name: "Signal book", cost: 60, does: "formations earn double XP" },
  archives: { name: "Archives", cost: 80, needs: "charts", does: "the hall of fame keeps every season's honours" },
  heraldry: { name: "Heraldry", cost: 100, needs: "muster", does: "a guild banner flies at the HQ" },
};
export const missionsModule: FeatureFactory = (e) => {
  const id = "social.guild-missions";
  let lastScan = 0;
  const missions = new Map<number, { day: number; port: number; good: number; need: number; done: number; finished: boolean }>();
  const missionFor = (g: Guild) => {
    const today = day(e);
    let m = missions.get(g.id);
    if (!m || m.day !== today) {   // deterministic from guild id and day
      const port = (g.id * 7 + today * 13) % e.n, good = (g.id + today) % 4;
      m = { day: today, port, good, need: 100 + 50 * Math.min(4, members(e, g).length), done: 0, finished: false };
      missions.set(g.id, m);
    }
    return m;
  };
  return {
    id, ideas: [352, 355], title: "Guild missions and tech", economy: false,
    enable() { lastScan = e.tick; },
    apply(cmd) {
      if (cmd.action !== "research") return fail("unknown action");
      const g = guildOf(e, cmd.company);
      if (!g || !atLeast(rankOf(e, cmd.company), "officer")) return fail("only guild officers choose research");
      const t = typeof cmd.tech === "string" ? TECHS[cmd.tech] : undefined;
      if (!t) return fail("unknown tech");
      if (g.techs.has(cmd.tech as string)) return fail("already researched");
      if (t.needs && !g.techs.has(t.needs)) return fail(`needs ${TECHS[t.needs].name} first`);
      if (g.xp < t.cost) return fail(`needs ${t.cost} guild XP`);
      g.xp -= t.cost; g.techs.add(cmd.tech as string);
      fame(g, `Day ${day(e)}: researched ${t.name}.`);
      return OK;
    },
    advance() {
      const deliveries = guildDeliveries(e, lastScan);
      lastScan = e.tick;
      for (const g of social(e).guilds.values()) {
        const m = missionFor(g);
        for (const d of deliveries.get(g.id) ?? []) if (!m.finished && d.to === m.port && d.good === m.good) m.done += d.qty;
        if (!m.finished && m.done >= m.need) { m.finished = true; g.xp += 20; fame(g, `Day ${m.day}: mission to ${portName(e, m.port)} complete.`); }
      }
    },
    cards(company) {
      const g = guildOf(e, company);
      if (!g) return [];
      const m = missions.get(g.id);
      const avail = Object.entries(TECHS).filter(([k, t]) => !g.techs.has(k) && (!t.needs || g.techs.has(t.needs)));
      return [{ title: "Guild mission", detail: (m && m.day === day(e) ? `Today: deliver ${m.need} t of ${GOODS[m.good]} to ${portName(e, m.port)} (${Math.min(m.done, m.need)} done)${m.finished ? " ✓" : ""}. Reward: 20 XP.` : "Today's mission is posted on the hour.")
        + `\nGuild XP: ${g.xp}. Researched: ${[...g.techs].map(k => TECHS[k].name).join(", ") || "nothing yet"}.`,
        actions: atLeast(rankOf(e, company), "officer") && avail.length ? [{ ...action(id, "Research", "research"), fields: [{ key: "tech", label: "Tech",
          options: avail.map(([k, t]) => ({ value: k, label: `${t.name} (${t.cost} XP): ${t.does}` })) }] }] : [] }];
    },
    view(company) {
      const g = guildOf(e, company);
      if (!g) return undefined;
      const charts = g.techs.has("charts") ? members(e, g).flatMap(c => e.companies.get(c)!.ships.map(i => e.ships.get(i)!).map(s => ({ ship: s.id, owner: name(e, c), port: s.port, dest: s.dest }))) : null;
      return { mission: missions.get(g.id) ?? null, charts };
    },
  };
};

/** Idea 353: formations. Two or more guildmates' ships leaving the same port for the same port within the same hour
 *  sail as a formation: shown on the map and worth guild XP (double with the Signal book). */
export const formationsModule: FeatureFactory = (e) => {
  const seen = new Set<number>();
  const active: { guild: number; ships: number[]; from: number; to: number; tick: number }[] = [];
  let formed = 0;
  return {
    id: "social.formations", ideas: [353], title: "Fleet formations", economy: false,
    advance() {
      const fresh = [...e.ships.values()].filter(s => s.dest !== null && s.departTick >= e.tick - 1 && !seen.has(s.id) && guildOf(e, s.owner));
      const groups = new Map<string, Ship[]>();
      for (const s of fresh) { const k = `${guildOf(e, s.owner)!.id}:${s.port}:${s.dest}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(s); }
      for (const [k, ships] of groups) {
        if (new Set(ships.map(s => s.owner)).size < 2) continue;
        const [gid, from, to] = k.split(":").map(Number), g = social(e).guilds.get(gid)!;
        ships.forEach(s => seen.add(s.id));
        g.xp += (g.techs.has("signals") ? 2 : 1) * 2 * ships.length;
        active.push({ guild: gid, ships: ships.map(s => s.id), from, to, tick: e.tick });
        formed++;
      }
      for (const id of [...seen]) { const s = e.ships.get(id); if (!s || s.dest === null) seen.delete(id); }
      for (let i = active.length - 1; i >= 0; i--) if (active[i].ships.every(id => e.ships.get(id)?.dest === null || !e.ships.has(id))) active.splice(i, 1);
    },
    world() { return { formed, active: active.map(f => ({ guild: guildName(e, f.guild), ships: f.ships, from: f.from, to: f.to })) }; },
  };
};

/** Idea 112: shared fleets. A member lends a docked, empty ship to a guildmate for 1-72 hours. The ship (and its
 *  upkeep) belongs to the borrower until it is back: it returns the first hour after the loan ends that it is
 *  docked and empty. A late ship costs the borrower trust. */
export const sharedFleetModule: FeatureFactory = (e) => {
  const id = "social.shared-fleets";
  const loans = new Map<number, { lender: number; borrower: number; until: number }>();
  return {
    id, ideas: [112], title: "Shared fleet", economy: false,
    apply(cmd) {
      if (cmd.action !== "lend") return fail("unknown action");
      const g = guildOf(e, cmd.company);
      if (!g) return fail("join a guild first");
      const s = typeof cmd.ship === "number" ? e.ships.get(cmd.ship) : undefined;
      const why = cannotTransfer(e, s, cmd.company);
      if (why) return fail(why);
      if (loans.has(s!.id)) return fail("that ship is already on loan");
      if (typeof cmd.target !== "number" || !g.members.has(cmd.target) || cmd.target === cmd.company || !e.companies.has(cmd.target)) return fail("lend to a guildmate");
      if (!isInt(cmd.hours, 1, 72)) return fail("lend for 1-72 hours");
      if (!hasRoom(e, cmd.target)) return fail("their fleet is full");
      transferShip(e, s!, cmd.target);
      loans.set(s!.id, { lender: cmd.company, borrower: cmd.target, until: e.tick + cmd.hours });
      record(e, "loan", cmd.company, cmd.target, 0, `lent ship ${s!.id} for ${cmd.hours} h`);
      return OK;
    },
    advance() {
      for (const [sid, l] of [...loans]) {
        const s = e.ships.get(sid);
        if (!s || !e.companies.has(l.lender) || s.owner !== l.borrower) { loans.delete(sid); continue; }
        if (e.tick < l.until) continue;
        const ready = s.dest === null && s.qty === 0 && !e.voyageQueues.has(sid) && hasRoom(e, l.lender);
        if (ready) {
          const c = e.companies.get(l.borrower)!;
          if (c.ships.length > 1) { transferShip(e, s, l.lender); loans.delete(sid); continue; }
        }
        if ((e.tick - l.until) % 24 === 23) addTrust(e, l.borrower, -2);
      }
    },
    cards(company) {
      const g = guildOf(e, company), c = e.companies.get(company);
      if (!g || !c) return [];
      const mates = members(e, g).filter(m => m !== company);
      const ships = c.ships.map(i => e.ships.get(i)!).filter(s => !cannotTransfer(e, s, company) && !loans.has(s.id));
      const out = [...loans].filter(([, l]) => l.lender === company || l.borrower === company)
        .map(([sid, l]) => l.lender === company ? `Ship ${sid} lent to ${name(e, l.borrower)} until hour ${l.until}` : `Ship ${sid} borrowed from ${name(e, l.lender)}, due back at hour ${l.until}`);
      return [{ title: "Shared fleet", detail: "Lend a docked, empty ship to a guildmate. They pay its upkeep and keep what it earns until it comes back." + (out.length ? `\n${out.join("\n")}` : ""),
        actions: mates.length && ships.length ? [{ ...action(id, "Lend a ship", "lend"), fields: [
          { key: "ship", label: "Ship", options: ships.map(s => ({ value: s.id, label: `${s.type} ${s.id} at ${portName(e, s.port)}` })) },
          { key: "target", label: "To", options: mates.map(m => ({ value: m, label: name(e, m) })) },
          { key: "hours", label: "Hours", min: 1, max: 72, value: 24 }] }] : [] }];
    },
    world() { return [...loans].map(([ship, l]) => ({ ship, lender: name(e, l.lender), borrower: name(e, l.borrower), until: l.until })); },
  };
};

/** Idea 360: the hall of fame. Guild honours (HQ, ports taken, contests, missions, research) and season records. */
export const hallOfFameModule: FeatureFactory = (e) => {
  const records = new Map<string, { value: number; holder: string }>();
  let lastScan = 0;
  const beat = (key: string, value: number, holder: string) => { const r = records.get(key); if (!r || value > r.value) records.set(key, { value, holder }); };
  return {
    id: "social.hall-of-fame", ideas: [360], title: "Hall of fame", economy: false,
    enable() { lastScan = e.tick; },
    advance() {
      for (const c of e.companies.values()) for (const t of deliveriesSince(e, c.id, lastScan)) beat("Biggest single delivery (t)", t.qty, c.name);
      lastScan = e.tick;
      if (e.tick % 24 === 0) for (const g of social(e).guilds.values()) {
        beat("Biggest guild (members)", members(e, g).length, guildName(e, g.id));
        beat("Most guild XP earned", g.xp + [...g.techs].reduce((a, k) => a + TECHS[k].cost, 0), guildName(e, g.id));
      }
    },
    world() {
      return { records: [...records].map(([what, r]) => ({ what, ...r })),
        guilds: [...social(e).guilds.values()].map(g => ({ guild: guildName(e, g.id), honours: g.fame.slice(g.techs.has("archives") ? -20 : -8) })).filter(x => x.honours.length) };
    },
  };
};

/** Ideas 129, 356: trust and guild reputation. Trust (0-100, start 50) moves with honoured trades, shipping-line
 *  punctuality, court verdicts, late loans and player ratings; a guild's reputation is its members' average trust
 *  plus 1 per 20 XP earned. Ratings: after a trade between two companies (social.ledger), each may rate the other once. */
export const reputationModule: FeatureFactory = (e) => {
  const id = "social.reputation";
  const rated = new Set<string>();
  const partners = (company: number) => {
    const out = new Set<number>();
    for (const l of social(e).ledger) if (l.from !== null && l.to !== null && l.amount > 0 && e.tick - l.tick < 7 * 24) {
      if (l.from === company) out.add(l.to); if (l.to === company) out.add(l.from);
    }
    return [...out].filter(c => e.companies.has(c) && !rated.has(`${company}>${c}`));
  };
  const guildRep = (g: Guild) => { const m = members(e, g); return Math.round(m.reduce((a, c) => a + trustOf(e, c), 0) / Math.max(1, m.length) + g.xp / 20); };
  return {
    id, ideas: [129, 356], title: "Trust and reputation", economy: false,
    apply(cmd) {
      if (cmd.action !== "rate") return fail("unknown action");
      if (typeof cmd.target !== "number" || !partners(cmd.company).includes(cmd.target)) return fail("you can rate a company once after trading with it this week");
      if (cmd.score !== 1 && cmd.score !== -1) return fail("rate +1 or -1");
      rated.add(`${cmd.company}>${cmd.target}`);
      addTrust(e, cmd.target, cmd.score * 2);
      return OK;
    },
    cards(company) {
      const p = partners(company);
      return [{ title: "Trust", detail: `Your trust score is ${trustOf(e, company)} of 100.` + (p.length ? " Rate the companies you traded with this week." : ""),
        actions: p.slice(0, 4).flatMap(c => [action(id, `👍 ${name(e, c)}`, "rate", { target: c, score: 1 }), action(id, `👎 ${name(e, c)}`, "rate", { target: c, score: -1 })]) }];
    },
    view(company) { return { trust: trustOf(e, company) }; },
    world() {
      return { companies: [...e.companies.values()].filter(c => social(e).trust.has(c.id)).map(c => ({ name: c.name, trust: trustOf(e, c.id) })),
        guilds: [...social(e).guilds.values()].map(g => ({ guild: guildName(e, g.id), reputation: guildRep(g) })) };
    },
  };
};
