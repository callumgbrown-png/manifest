import type { Engine } from "../../engine.js";
import { GOODS } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { OK, fail, goodIndex, isPort, journal, num, remember, UNDO_KEPT } from "./common.js";

// ---------------------------------------------------------------- price alerts (426)

export interface PriceAlert { id: number; port: number; good: string; side: "above" | "below"; price: number; fired: number | null }
const MAX_ALERTS = 10;

export const alerts: FeatureFactory = (e) => {
  const byCompany = new Map<number, PriceAlert[]>();
  let seq = 0;
  journal(e).register("ui.alerts", (company, before) => { byCompany.set(company, structuredClone(before as PriceAlert[])); return OK; });
  return {
    id: "ui.alerts", ideas: [426], title: "Price alerts", economy: false,
    apply(cmd) {
      const list = byCompany.get(cmd.company) ?? [];
      if (cmd.action === "add") {
        const g = goodIndex(cmd.good), price = num(cmd.price, 0.01, 100_000);
        if (!isPort(e, cmd.port)) return fail("choose a port");
        if (g === null) return fail("choose a good");
        if (cmd.side !== "above" && cmd.side !== "below") return fail("choose above or below");
        if (price === null) return fail("enter a price");
        if (list.length >= MAX_ALERTS) return fail(`you can have ${MAX_ALERTS} alerts; remove one first`);
        remember(e, cmd, "add price alert", list);
        byCompany.set(cmd.company, [...list, { id: ++seq, port: cmd.port, good: GOODS[g], side: cmd.side, price: Math.round(price * 100) / 100, fired: null }]);
        return { ok: true, id: seq };
      }
      if (cmd.action === "remove") {
        if (!list.some(a => a.id === cmd.id)) return fail("no such alert");
        remember(e, cmd, "remove price alert", list);
        byCompany.set(cmd.company, list.filter(a => a.id !== cmd.id));
        return OK;
      }
      if (cmd.action === "clearFired") {
        if (!list.some(a => a.fired !== null)) return fail("no alerts have gone off");
        remember(e, cmd, "clear fired alerts", list);
        byCompany.set(cmd.company, list.filter(a => a.fired === null));
        return OK;
      }
      return fail("unknown action");
    },
    advance() {
      for (const list of byCompany.values()) for (const a of list) {
        if (a.fired !== null) continue;
        const p = e.price(a.port, GOODS.indexOf(a.good as never));
        if (a.side === "above" ? p >= a.price : p <= a.price) a.fired = e.tick;
      }
    },
    view(company) {
      return (byCompany.get(company) ?? []).map(a => ({ ...a, now: Math.round(e.price(a.port, GOODS.indexOf(a.good as never)) * 100) / 100 }));
    },
  };
};

// ---------------------------------------------------------------- notifications (151)

export interface Notice { id: number; tick: number; kind: "docked" | "fill" | "forcedSale" | "queuePaused"; ship?: number; port?: number; good?: number; qty?: number; amount?: number; text?: string }
const NOTICES_KEPT = 30;

/** Collects events for the in-game notification centre (economy flag per the assignment; changes nothing). */
export const notifications: FeatureFactory = (e) => {
  const notices = new Map<number, Notice[]>();
  const readUpTo = new Map<number, number>();
  const wasAtSea = new Set<number>();
  const pausedSeen = new Map<number, string>();
  let seq = 0, fillSeen = 0, saleSeen = -1;
  const push = (company: number, n: Omit<Notice, "id" | "tick">) => {
    const list = notices.get(company) ?? [];
    list.push({ id: ++seq, tick: e.tick, ...n });
    notices.set(company, list.slice(-NOTICES_KEPT));
  };
  return {
    id: "ui.notifications", ideas: [151], title: "Notifications", economy: true,
    enable() { for (const s of e.ships.values()) if (s.dest !== null) wasAtSea.add(s.id); },
    apply(cmd) {
      if (cmd.action !== "read") return fail("unknown action");
      readUpTo.set(cmd.company, seq);
      return OK;
    },
    advance() {
      for (const s of e.ships.values()) {
        if (s.dest === null && wasAtSea.has(s.id)) push(s.owner, { kind: "docked", ship: s.id, port: s.port, good: s.good ?? undefined, qty: s.qty });
        if (s.dest !== null) wasAtSea.add(s.id); else wasAtSea.delete(s.id);
      }
      for (const [company, fills] of e.orderFills) for (const f of fills) if (f.id > fillSeen) {
        push(company, { kind: "fill", port: f.port, good: f.good, qty: f.qty, amount: Math.round(f.amount) });
      }
      fillSeen = Math.max(fillSeen, ...[...e.orderFills.values()].flat().map(f => f.id));
      for (const [company, sales] of e.forcedSales) for (const f of sales) if (f.tick > saleSeen) {
        push(company, { kind: "forcedSale", ship: f.ship, port: f.port, amount: Math.round(f.paid) });
      }
      saleSeen = Math.max(saleSeen, ...[...e.forcedSales.values()].flat().map(f => f.tick));
      for (const [ship, q] of e.voyageQueues) {
        if (q.paused && pausedSeen.get(ship) !== q.paused) push(q.company, { kind: "queuePaused", ship, text: q.paused.slice(0, 160) });
        if (q.paused) pausedSeen.set(ship, q.paused); else pausedSeen.delete(ship);
      }
    },
    view(company) {
      const list = notices.get(company) ?? [], read = readUpTo.get(company) ?? 0;
      return { notices: list, unread: list.filter(n => n.id > read).length };
    },
  };
};

// ---------------------------------------------------------------- ledger (157, 436)

export interface LedgerRow { tick: number; kind: "trip" | "upkeep" | "forcedSale"; amount: number; ship?: number; from?: number; to?: number; good?: string | null; qty?: number; spent?: number; earned?: number }
const LEDGER_KEPT = 300;

/** A profit-and-loss ledger: every finished trip, each daily upkeep charge and any forced ship sale. */
export const ledger: FeatureFactory = (e) => {
  const rows = new Map<number, LedgerRow[]>();
  const seenTrips = new Map<number, Set<string>>();
  let saleSeen = -1;
  const add = (company: number, row: LedgerRow) => {
    const list = rows.get(company) ?? [];
    list.push(row);
    rows.set(company, list.slice(-LEDGER_KEPT));
  };
  const scanTrips = (record: boolean) => {
    for (const [company, trips] of e.trips) {
      const seen = seenTrips.get(company) ?? new Set<string>();
      const live = new Set<string>();
      for (const t of trips) {
        const key = `${t.ship}:${t.departTick}`;
        live.add(key);
        if (t.open || t.listed || seen.has(key)) continue;
        seen.add(key);
        if (record) add(company, { tick: e.tick, kind: "trip", amount: Math.round(t.earned - t.spent), ship: t.ship, from: t.from, to: t.to,
          good: t.good === null ? null : GOODS[t.good], qty: t.qty, spent: Math.round(t.spent), earned: Math.round(t.earned) });
      }
      for (const k of seen) if (!live.has(k)) seen.delete(k);   // trips that left the engine's short list never come back
      seenTrips.set(company, seen);
    }
  };
  return {
    id: "ui.ledger", ideas: [157, 436], title: "Profit and loss ledger", economy: false,
    enable() { scanTrips(false); },   // the ledger starts when the module is switched on
    advance() {
      scanTrips(true);
      // Upkeep is charged right after the modules run on each day's first hour; record the same figure.
      if (e.tick % 24 === 0) for (const c of e.companies.values()) {
        const due = e.upkeepDue(c);
        if (due > 0) add(c.id, { tick: e.tick, kind: "upkeep", amount: -Math.round(due) });
      }
      for (const [company, sales] of e.forcedSales) for (const f of sales) if (f.tick > saleSeen)
        add(company, { tick: f.tick, kind: "forcedSale", amount: Math.round(f.paid), ship: f.ship, to: f.port });
      saleSeen = Math.max(saleSeen, ...[...e.forcedSales.values()].flat().map(f => f.tick));
    },
    view(company) {
      const list = rows.get(company) ?? [];
      const sum = (k: LedgerRow["kind"]) => list.filter(r => r.kind === k).reduce((a, r) => a + r.amount, 0);
      return { rows: list.slice(-120), totals: { trips: sum("trip"), upkeep: sum("upkeep"), forcedSales: sum("forcedSale"),
        net: list.reduce((a, r) => a + r.amount, 0) }, count: list.length };
    },
  };
};

// ---------------------------------------------------------------- idle ships (433) and daily summary (435)

/** Hours each ship has sat docked and empty with no voyage queue. */
export const idleShips: FeatureFactory = (e) => {
  const since = new Map<number, number>();
  return {
    id: "ui.idle-ships", ideas: [433], title: "Idle-ship warnings", economy: false,
    advance() {
      for (const s of e.ships.values()) {
        const idle = s.dest === null && s.qty === 0 && !e.voyageQueues.has(s.id);
        if (!idle) since.delete(s.id); else if (!since.has(s.id)) since.set(s.id, e.tick);
      }
      for (const id of since.keys()) if (!e.ships.has(id)) since.delete(id);
    },
    view(company) {
      const out: Record<number, number> = {};
      for (const id of e.companies.get(company)?.ships ?? []) if (since.has(id)) out[id] = e.tick - since.get(id)!;
      return out;
    },
  };
};

export interface DaySummary { day: number; cashStart: number; cashEnd: number; worthStart: number; worthEnd: number; trips: number; tripProfit: number }

export const dailySummary: FeatureFactory = (e) => {
  const start = new Map<number, { tick: number; cash: number; worth: number }>();
  const last = new Map<number, DaySummary>();
  const snap = (e2: Engine) => { for (const c of e2.companies.values()) start.set(c.id, { tick: e2.tick, cash: Math.round(c.cash), worth: Math.round(e2.netWorth(c)) }); };
  return {
    id: "ui.daily-summary", ideas: [435], title: "Daily summary", economy: false,
    enable() { snap(e); },
    advance() {
      if (e.tick % 24 !== 0) {
        for (const c of e.companies.values()) if (!start.has(c.id)) start.set(c.id, { tick: e.tick, cash: Math.round(c.cash), worth: Math.round(e.netWorth(c)) });
        return;
      }
      for (const c of e.companies.values()) {
        const s = start.get(c.id);
        if (!s) continue;
        const done = (e.trips.get(c.id) ?? []).filter(t => !t.open && !t.listed && t.arriveTick > s.tick && t.arriveTick <= e.tick);
        last.set(c.id, { day: e.tick / 24, cashStart: s.cash, cashEnd: Math.round(c.cash), worthStart: s.worth, worthEnd: Math.round(e.netWorth(c)),
          trips: done.length, tripProfit: Math.round(done.reduce((a, t) => a + t.earned - t.spent, 0)) });
      }
      snap(e);
    },
    view(company) { return last.get(company) ?? null; },
  };
};

// ---------------------------------------------------------------- undo (487)

/** Undo the last *safe* step: alerts, saved routes and stopping an auto-trade route. Trades, sailing, ship
 *  purchases and orders are never undoable: prices and other players move on, so undo would let a player keep
 *  the trades that paid and take back the ones that didn't. */
export const undo: FeatureFactory = (e) => ({
  id: "ui.undo", ideas: [487], title: "Undo", economy: false,
  apply(cmd) {
    if (cmd.action !== "undo") return fail("unknown action");
    const j = journal(e), list = j.stacks.get(cmd.company) ?? [];
    const entry = list.pop();
    if (!entry) return fail("nothing to undo (trades and voyages can't be undone)");
    if (!e.features.enabled(entry.module)) return fail("that feature is switched off");
    const restore = j.restorers.get(entry.module);
    return restore ? restore(cmd.company, entry.before) : fail("can't undo that");
  },
  view(company) {
    const list = journal(e).stacks.get(company) ?? [];
    return { last: list.at(-1)?.label ?? null, count: list.length, max: UNDO_KEPT };
  },
});

// ---------------------------------------------------------------- starter bonus (483)

export const STARTER_BONUS = 500;

/**
 * Idea 483, content part (on): finishing the guided first delivery (a profitable sale) earns a Founder's pennant
 * flown beside your ships on the map. The cash part is ui.starter-bonus-effects (economy, off): while it is on,
 * claiming the pennant also pays a one-time STARTER_BONUS.
 */
export const starterBonus: FeatureFactory = (e) => {
  const claimed = new Map<number, { tick: number; paid: number }>();
  const eligible = (company: number) => (e.trips.get(company) ?? []).some(t => !t.open && t.good !== null && t.earned > t.spent);
  const paysCash = () => e.features.enabled("ui.starter-bonus-effects");
  return {
    id: "ui.starter-bonus", ideas: [483], title: "Starter bonus", economy: false,
    apply(cmd) {
      if (cmd.action !== "claim") return fail("unknown action");
      if (claimed.has(cmd.company)) return fail("already claimed");
      if (!eligible(cmd.company)) return fail("finish your first profitable delivery first");
      const c = e.companies.get(cmd.company);
      if (!c) return fail("no company");
      const paid = paysCash() ? STARTER_BONUS : 0;
      c.cash += paid;
      claimed.set(cmd.company, { tick: e.tick, paid });
      return { ok: true, paid };
    },
    view(company) {
      return { claimed: claimed.has(company), eligible: eligible(company), cash: paysCash() ? STARTER_BONUS : 0, paid: claimed.get(company)?.paid ?? 0 };
    },
    world() { return { pennants: [...claimed.keys()].sort((a, b) => a - b) }; },
    cards(company) {
      if (claimed.has(company) || !eligible(company)) return [];
      const cash = paysCash() ? ` and a one-time bonus of ${STARTER_BONUS}` : "";
      return [{ title: "Starter bonus", detail: `Your first profitable delivery is done. Claim your Founder's pennant${cash}.`,
        actions: [{ label: "Claim", command: { type: "feature", module: "ui.starter-bonus", action: "claim" } }] }];
    },
  };
};

/** Idea 483, money part: the starter bonus pays cash. Economy, off until approved. */
export const starterBonusEffects: FeatureFactory = () => ({
  id: "ui.starter-bonus-effects", ideas: [483], title: "Starter bonus cash", economy: true,
});
