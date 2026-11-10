// Port-bank loans with interest (19) and a bankruptcy restart with a small safety net (20). Both move money, so both
// are economy modules and ship off. (The game already has emergency credit for broke companies; the restart here is a
// last resort for a company that is deep in debt and has no way back.)
import type { FeatureFactory } from "../types.js";
import { action, credits, fail, Notes, whole } from "./util.js";

const ok = () => ({ ok: true as const });

// ------------------------------------------------------------ 19: port-bank loans

export const LOAN_RATE_PER_DAY = 0.005;
export const loans: FeatureFactory = (e) => {
  const id = "economy.loans";
  const balance = new Map<number, number>();
  const limit = (company: number) => {
    const c = e.companies.get(company);
    if (!c) return 0;
    let v = 0;
    for (const i of c.ships) { const s = e.ships.get(i); if (s) v += e.spec(s.type).price * 0.5; }
    return Math.max(1000, Math.floor(v));
  };
  const notes = new Notes();
  return {
    id, ideas: [19], title: "Port bank", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!, owed = balance.get(c.id) ?? 0;
      switch (cmd.action) {
        case "borrow": {
          if (!whole(cmd.amount, 100, 10_000_000)) return fail("borrow at least 100");
          if (owed + cmd.amount > limit(c.id)) return fail(`the bank lends you at most ${credits(limit(c.id))} in all`);
          c.cash += cmd.amount;
          balance.set(c.id, owed + cmd.amount);
          return ok();
        }
        case "repay": {
          if (owed <= 0) return fail("you owe nothing");
          if (!whole(cmd.amount, 1, 10_000_000)) return fail("bad amount");
          const pay = Math.min(cmd.amount, owed);
          if (c.cash < pay) return fail("not enough cash");
          c.cash -= pay;
          if (owed - pay <= 0.005) balance.delete(c.id); else balance.set(c.id, owed - pay);
          return ok();
        }
        default: return fail("unknown action");
      }
    },
    advance() {
      if (e.tick % 24 === 0) for (const [id, owed] of balance) balance.set(id, owed * (1 + LOAN_RATE_PER_DAY));
      if (e.tick === e.seasonHours - 1) for (const [id, owed] of [...balance]) {
        const c = e.companies.get(id);
        if (c) { c.cash -= owed; notes.add(id, `The bank collected ${credits(owed)} at the end of the season.`); }
        balance.delete(id);
      }
      for (const id of [...balance.keys()]) if (!e.companies.has(id)) balance.delete(id);
    },
    view(company) { return { owed: Math.round((balance.get(company) ?? 0) * 100) / 100, limit: limit(company) }; },
    cards(company) {
      const owed = balance.get(company) ?? 0, room = Math.max(0, limit(company) - owed);
      const actions = [];
      if (room >= 100) actions.push(action(id, "Borrow", "borrow", {}, [{ key: "amount", label: "Amount", min: 100, max: Math.floor(room), value: Math.min(5000, Math.floor(room)) }]));
      if (owed > 0) actions.push(action(id, "Repay", "repay", {}, [{ key: "amount", label: "Amount", min: 1, max: Math.ceil(owed), value: Math.ceil(owed) }]));
      return [{ title: "Port bank", detail: [`Borrow against your fleet (up to half its new value). Interest ${LOAN_RATE_PER_DAY * 100}% a day; anything still owed is collected at the end of the season.`,
        `Owed: ${credits(owed)}. Can still borrow: ${credits(room)}.`, ...notes.of(company)].join("\n"), actions }];
    },
  };
};

// ------------------------------------------------------------ 20: bankruptcy restart

export const SAFETY_NET_SHARE = 0.25;
export const safetyNet: FeatureFactory = (e) => {
  const id = "economy.safety-net";
  const used = new Set<number>();
  const eligible = (company: number): string | null => {
    const c = e.companies.get(company);
    if (!c) return "no company";
    if (used.has(company)) return "you have already restarted once this season";
    if (c.cash >= 0) return "only a company in debt can declare bankruptcy";
    if (e.netWorth(c) >= e.rules.company.start_cash * SAFETY_NET_SHARE) return "your company is still worth too much to restart";
    if (c.ships.some(i => e.ships.get(i)?.dest !== null)) return "wait until every ship is in port";
    if ([...e.orders.values()].some(o => o.owner === company)) return "cancel your market orders first";
    if (c.ships.some(i => e.voyageQueues.has(i))) return "clear your voyage plans first";
    return null;
  };
  return {
    id, ideas: [20], title: "Bankruptcy restart", economy: true,
    apply(cmd) {
      if (cmd.action !== "declare") return fail("unknown action");
      const why = eligible(cmd.company);
      if (why) return fail(why);
      const c = e.companies.get(cmd.company)!;
      const [keep, ...rest] = c.ships.map(i => e.ships.get(i)!);
      for (const s of rest) e.removeShip(c, s);
      keep.qty = 0; keep.good = null; keep.cost = 0;
      e.maritime.dockedCargoChanged(keep);
      c.cash = e.rules.company.start_cash * SAFETY_NET_SHARE;
      used.add(c.id);
      return { ok: true };
    },
    view(company) { return { used: used.has(company), eligible: eligible(company) === null }; },
    cards(company) {
      if (eligible(company) !== null) return [];
      return [{ title: "Bankruptcy restart", detail: `Your company is deep in debt. You may declare bankruptcy once a season: your debts are wiped, you keep one empty ship and restart with ${credits(e.rules.company.start_cash * SAFETY_NET_SHARE)}.`,
        actions: [action(id, "Declare bankruptcy", "declare")] }];
    },
  };
};
