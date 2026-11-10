// Integrity watchers. The engine is already authoritative (clients send intents; prices, balances and positions
// are computed on the server), so these modules observe and audit once per game hour: they never change money or
// cargo. Anything suspicious becomes an admin alert and a review flag (shared.ts); only hard evidence keeps a
// company off the fair-play leaderboard, and nothing here bans or fines anyone automatically.
import { GOODS, type Engine } from "../../engine.js";
import { ageHours, flag, flaggedCompanies, flagsOf, isHouseBot, noteCompanies, round, type PlatformFactory } from "./shared.js";

type Entry = { tick: number; kind: string; company?: number; detail: string };
const pushCapped = <T>(list: T[], item: T, cap: number) => { list.push(item); if (list.length > cap) list.splice(0, list.length - cap); };

/** Checks the whole world against its invariants. Returns one entry per broken rule. Exported for tests. */
export function checkInvariants(e: Engine): Entry[] {
  const out: Entry[] = [];
  const bad = (kind: string, detail: string, company?: number) => out.push({ tick: e.tick, kind, detail, company });
  // 554: prices and stock always inside the configured bands.
  for (let p = 0; p < e.n; p++) GOODS.forEach((good, g) => {
    const band = e.rules.commodities[good], price = e.price(p, g), stock = e.stock[p][g];
    if (!Number.isFinite(stock) || stock < 0) bad("stock", `port ${p} ${good} stock ${stock}`);
    if (!(price >= band.floor - 1e-9 && price <= band.ceiling + 1e-9)) bad("price-band", `port ${p} ${good} price ${round(price)}`);
  });
  for (const o of e.orders.values()) {
    const band = e.rules.commodities[GOODS[o.good]];
    if (!(o.price >= band.floor && o.price <= band.ceiling)) bad("order-price", `order ${o.id} price ${o.price}`, o.owner);
    if (!(o.qty > 0) || !Number.isFinite(o.qty)) bad("order-qty", `order ${o.id} qty ${o.qty}`, o.owner);
    if (!e.companies.has(o.owner)) bad("order-owner", `order ${o.id} has no owner`);
  }
  // 555: state consistency.
  const owners = new Map<number, number>();
  for (const c of e.companies.values()) {
    if (!Number.isFinite(c.cash)) bad("cash", `cash is ${c.cash}`, c.id);
    for (const id of c.ships) {
      if (owners.has(id)) bad("duplicate-ship", `ship ${id} is in two fleets (${owners.get(id)} and ${c.id})`, c.id);
      owners.set(id, c.id);
      if (!e.ships.has(id)) bad("missing-ship", `ship ${id} is listed but does not exist`, c.id);
    }
  }
  for (const s of e.ships.values()) {
    if (owners.get(s.id) !== s.owner) bad("ship-owner", `ship ${s.id} owner ${s.owner} does not list it`, s.owner);
    if (!Number.isFinite(s.qty) || s.qty < -1e-6) bad("cargo", `ship ${s.id} cargo ${s.qty}`, s.owner);
    if (s.qty > e.expansionCapacity(s) + 1e-6 && s.type !== "pirate") bad("over-capacity", `ship ${s.id} carries ${round(s.qty)} over capacity ${e.expansionCapacity(s)}`, s.owner);
    if (s.dest !== null && !(Number.isInteger(s.dest) && s.dest >= 0 && s.dest < e.n)) bad("ship-dest", `ship ${s.id} dest ${s.dest}`, s.owner);
  }
  return out;
}

/** 554, 555, 562: economy audit log (hourly cash movements) and invariant checks on prices and state. */
export const audit: PlatformFactory = (e) => {
  const log: { tick: number; company: number; before: number; after: number }[] = [];
  const violations: Entry[] = [];
  const cash = new Map<number, number>();
  let checks = 0;
  const remember = () => { for (const c of e.companies.values()) cash.set(c.id, c.cash); };
  return {
    id: "platform.audit", ideas: [554, 555, 562], title: "Economy audit", economy: false,
    enable: remember,
    advance() {
      for (const c of e.companies.values()) {
        const before = cash.get(c.id) ?? e.rules.company.start_cash;
        if (Math.abs(c.cash - before) >= 100) pushCapped(log, { tick: e.tick, company: c.id, before: Math.round(before), after: Math.round(c.cash) }, 2000);
      }
      remember();
      checks++;
      for (const v of checkInvariants(e)) pushCapped(violations, v, 500);
    },
    world: () => ({ checks, violations24h: violations.filter(v => e.tick - v.tick < 24).length }),
    view: (company) => ({ entries: log.filter(l => l.company === company).slice(-10) }),
    admin: () => ({ checks, log: log.slice(-200), violations: violations.slice(-100) }),
  };
};

interface ShipSeen { owner: number; port: number; dest: number | null; departTick: number; good: number | null; qty: number; type: string }
const seeShips = (e: Engine) => new Map([...e.ships.values()].map(s => [s.id, { owner: s.owner, port: s.port, dest: s.dest, departTick: s.departTick, good: s.good, qty: s.qty, type: s.type } as ShipSeen]));

/** 563, 564: anomaly alerts (cash jumps, impossible fills, cargo growing at sea) and duplication guards. */
export const anomalies: PlatformFactory = (e) => {
  const alerts: Entry[] = [];
  let worth = new Map<number, number>(), cash = new Map<number, number>(), ships = new Map<number, ShipSeen>();
  const fillsSeen = new Map<number, number>();
  const snap = () => {
    worth = new Map([...e.companies.values()].map(c => [c.id, e.netWorth(c)]));
    cash = new Map([...e.companies.values()].map(c => [c.id, c.cash]));
    ships = seeShips(e);
    for (const [id, list] of e.orderFills) fillsSeen.set(id, list.at(-1)?.id ?? 0);
  };
  const alert = (kind: string, company: number, detail: string, hard = true) => {
    pushCapped(alerts, { tick: e.tick, kind, company, detail }, 300);
    if (hard) flag(e, company, kind, detail);
  };
  return {
    id: "platform.anomaly", ideas: [563, 564], title: "Anomaly alerts", economy: false,
    enable: snap,
    advance() {
      for (const c of e.companies.values()) {
        const before = cash.get(c.id);
        if (before === undefined) continue;
        const jump = c.cash - before, base = Math.max(worth.get(c.id) ?? 0, e.rules.company.start_cash);
        if (jump > Math.max(50_000, base)) alert("cash-jump", c.id, `cash rose ${Math.round(jump)} in one hour (worth was ${Math.round(base)})`);
      }
      for (const [owner, list] of e.orderFills) {
        const seen = fillsSeen.get(owner) ?? 0;
        for (const f of list) if (f.id > seen && f.qty > 0) {
          const band = e.rules.commodities[GOODS[f.good]], unit = f.amount / f.qty;
          // A fill is reported gross or net of tax, so allow the tax below the floor.
          if (unit > band.ceiling + 1e-6 || unit < band.floor * (1 - e.rules.fees.trade_tax_rate) - 1e-6)
            alert("impossible-fill", owner, `fill ${f.id} at ${round(unit)} per tonne, outside ${band.floor}-${band.ceiling}`);
        }
      }
      const fleets = new Map<number, number>();
      for (const c of e.companies.values()) for (const id of c.ships) {
        if (fleets.has(id)) alert("duplicate-ship", c.id, `ship ${id} also belongs to company ${fleets.get(id)}`);
        fleets.set(id, c.id);
      }
      for (const s of e.ships.values()) {
        const before = ships.get(s.id);
        // A voyage in progress never loads cargo (raids only take it away); pirate ships take loot at sea.
        if (before && s.type !== "pirate" && before.dest !== null && s.dest !== null && before.departTick === s.departTick
            && before.owner === s.owner && s.qty > before.qty + 1e-6)
          alert("cargo-grew-at-sea", s.owner, `ship ${s.id} went from ${round(before.qty)} to ${round(s.qty)} tonnes at sea`);
      }
      snap();
    },
    world: () => ({ alerts24h: alerts.filter(a => e.tick - a.tick < 24).length }),
    admin: () => ({ alerts: alerts.slice(-100) }),
  };
};

/**
 * 553: multi-account detection from in-game behaviour only. Each hour it compares order books and ships with the
 * hour before: when an order shrinks and another company's docked ship at that port gains (or loses) exactly that
 * cargo, the two companies traded with each other. Trades priced more than 30% away from the port's market price are
 * "off-market". Three or more off-market trades between the same pair within a week flags both for review.
 * Limits: it samples once an hour, so a listing made and bought within the same hour, or goods bought into a buy
 * order (used up at the port, no ship), is not seen; friends who genuinely trade cheaply look the same as one
 * person with two accounts. It uses no IPs, e-mails or device data, and never punishes on its own.
 */
export const multiAccount: PlatformFactory = (e) => {
  let orders = new Map<number, { owner: number; port: number; good: number; qty: number; price: number; side: string; market: number }>();
  let ships = new Map<number, ShipSeen>();
  const trades: { tick: number; a: number; b: number; offMarket: boolean; gap: number }[] = [];
  const snap = () => {
    orders = new Map([...e.orders.values()].map(o => [o.id, { owner: o.owner, port: o.port, good: o.good, qty: o.qty, price: o.price, side: o.side, market: e.price(o.port, o.good) }]));
    ships = seeShips(e);
  };
  const pairKey = (a: number, b: number) => a < b ? `${a}-${b}` : `${b}-${a}`;
  return {
    id: "platform.multi-account", ideas: [553], title: "Linked-account check", economy: false,
    enable: snap,
    advance() {
      for (const [id, o] of orders) {
        const drop = o.qty - (e.orders.get(id)?.qty ?? 0);
        if (drop <= 0) continue;
        // The counterparty is a docked ship of another company at the port whose cargo of that good changed by `drop`.
        const party = [...e.ships.values()].find(s => {
          const was = ships.get(s.id);
          if (!was || s.owner === o.owner || s.dest !== null || s.port !== o.port) return false;
          const wasQty = was.good === o.good ? was.qty : 0, nowQty = s.good === o.good ? s.qty : 0;
          return Math.abs((o.side === "sell" ? nowQty - wasQty : wasQty - nowQty) - drop) < 1e-6;
        });
        if (!party) continue;
        const gap = Math.abs(o.price - o.market) / Math.max(1e-9, o.market);
        trades.push({ tick: e.tick, a: o.owner, b: party.owner, offMarket: gap > 0.3, gap: round(gap) });
      }
      while (trades.length && e.tick - trades[0].tick > 168) trades.shift();
      const pairs = new Map<string, number>();
      for (const t of trades) if (t.offMarket) pairs.set(pairKey(t.a, t.b), (pairs.get(pairKey(t.a, t.b)) ?? 0) + 1);
      for (const [key, n] of pairs) if (n >= 3) {
        const [a, b] = key.split("-").map(Number);
        flag(e, a, "linked-trading", `${n} off-market trades with company ${b} this week`);
        flag(e, b, "linked-trading", `${n} off-market trades with company ${a} this week`);
      }
      snap();
    },
    admin: () => ({ trades: trades.slice(-100), method: "hourly order-book and cargo comparison; behaviour only" }),
  };
};

/**
 * 551, 552: per-company action rate limits and anti-bot checks. Platform commands are limited per company per game
 * hour (allowAction in shared.ts); the server already limits each connection to 10 commands a second and caps
 * log-in failures and sign-ups. Here each company's observed actions per hour (departures not run by a voyage queue,
 * new orders, new ships) are counted: more than 15 in an hour, or activity in 22 of the last 24 hours (no human
 * sleeps that little), raises a review flag. House bots are skipped; voyage queues are allowed automation.
 */
export const activityWatch: PlatformFactory = (e) => {
  const perHour = new Map<number, number[]>();      // company -> actions in each of the last 24 hours
  let departs = new Map<number, number>(), orderIds = new Set<number>(), fleet = new Map<number, number>();
  const snap = () => {
    departs = new Map([...e.ships.values()].map(s => [s.id, s.departTick]));
    orderIds = new Set(e.orders.keys());
    fleet = new Map([...e.companies.values()].map(c => [c.id, c.ships.length]));
  };
  return {
    id: "platform.activity-watch", ideas: [551, 552], title: "Activity limits", economy: false,
    enable() { snap(); noteCompanies(e); },
    advance() {
      noteCompanies(e);
      const count = new Map<number, number>();
      const add = (id: number, n = 1) => count.set(id, (count.get(id) ?? 0) + n);
      for (const s of e.ships.values())
        if (s.dest !== null && departs.has(s.id) && departs.get(s.id) !== s.departTick && !e.voyageQueues.has(s.id)) add(s.owner);
      for (const o of e.orders.values()) if (!orderIds.has(o.id)) add(o.owner);
      for (const c of e.companies.values()) add(c.id, Math.max(0, c.ships.length - (fleet.get(c.id) ?? c.ships.length)));
      for (const c of e.companies.values()) {
        const list = perHour.get(c.id) ?? [];
        list.push(count.get(c.id) ?? 0);
        if (list.length > 24) list.shift();
        perHour.set(c.id, list);
        if (isHouseBot(c)) continue;
        const now = list.at(-1)!;
        if (now > 15) flag(e, c.id, "action-burst", `${now} actions in one game hour`, 48);
        if (list.length === 24 && list.filter(n => n > 0).length >= 22 && ageHours(e, c.id) >= 24)
          flag(e, c.id, "no-sleep-pattern", "active in 22 or more of the last 24 hours", 48);
      }
      snap();
    },
    view: (company) => ({ actionsLastHour: perHour.get(company)?.at(-1) ?? 0, activeHours24: (perHour.get(company) ?? []).filter(n => n > 0).length }),
    admin: () => ({ busiest: [...perHour].map(([id, l]) => ({ id, active: l.filter(n => n > 0).length, peak: Math.max(0, ...l) }))
      .sort((a, b) => b.active - a.active || b.peak - a.peak).slice(0, 20) }),
  };
};

/** Flags that count as hard evidence and keep a company off the fair-play leaderboard. */
export const PURGE_REASONS = ["cash-jump", "impossible-fill", "duplicate-ship", "cargo-grew-at-sea", "linked-trading"];

/** 565, 566: a leaderboard without flagged companies, and event brackets by company age and net worth. */
export const fairPlay: PlatformFactory = (e) => {
  let brackets = new Map<number, string>();
  let board: { id: number; name: string; worth: number }[] = [];
  let excluded = 0;
  const purged = (id: number) => flagsOf(e, id).some(f => PURGE_REASONS.includes(f.reason));
  const rebuild = () => {
    noteCompanies(e);
    const all = [...e.companies.values()].map(c => ({ id: c.id, name: c.name, worth: Math.round(e.netWorth(c)), bot: isHouseBot(c) }))
      .sort((a, b) => b.worth - a.worth || a.id - b.id);
    excluded = all.filter(c => purged(c.id)).length;
    board = all.filter(c => !purged(c.id)).slice(0, 20).map(({ id, name, worth }) => ({ id, name, worth }));
    // Brackets: everyone in their first three days is a rookie; the rest split into thirds by net worth.
    const veterans = all.filter(c => !c.bot && ageHours(e, c.id) >= 72);
    brackets = new Map();
    for (const c of all) if (!c.bot && ageHours(e, c.id) < 72) brackets.set(c.id, "rookie");
    veterans.forEach((c, i) => brackets.set(c.id, i < veterans.length / 3 ? "gold" : i < (2 * veterans.length) / 3 ? "silver" : "bronze"));
  };
  return {
    id: "platform.fair-play", ideas: [565, 566], title: "Fair play", economy: false,
    enable: rebuild,
    advance: rebuild,
    view: (company) => ({ bracket: brackets.get(company) ?? null, onBoard: !purged(company) }),
    world: () => ({ leaderboard: board, excluded, brackets: [...brackets.values()].reduce<Record<string, number>>((m, b) => (m[b] = (m[b] ?? 0) + 1, m), {}) }),
    admin: () => ({ flagged: flaggedCompanies(e).map(id => ({ id, name: e.companies.get(id)?.name, flags: flagsOf(e, id) })) }),
  };
};
