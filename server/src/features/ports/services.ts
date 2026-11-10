import type { Engine } from "../../engine.js";
import type { FeatureFactory } from "../types.js";
import { action, dockedPorts, fail, hash, inRange, day, portName, peer, connected } from "./shared.js";

/** 263 a bank (content): statements of cash and net worth over the season, and a savings goal you set yourself. */
export const bank: FeatureFactory = (e) => {
  const id = "ports.bank";
  const goals = new Map<number, number>();
  return {
    id, ideas: [263], title: "Bank", economy: false,
    apply(cmd) {
      if (cmd.action === "setGoal") {
        if (!inRange(cmd.goal, 0, 100_000_000)) return fail("set a goal from 0 to 100,000,000");
        if (cmd.goal === 0) goals.delete(cmd.company); else goals.set(cmd.company, cmd.goal);
        return { ok: true };
      }
      return fail("unknown action");
    },
    cards(company) {
      const c = e.companies.get(company);
      if (!c) return [];
      const log = e.worthLog.get(company) ?? [], worth = Math.round(e.netWorth(c));
      const week = log.length > 7 ? worth - log[log.length - 8] : worth - (log[0] ?? worth);
      const goal = goals.get(company);
      return [{ title: "Bank statement", detail: `Cash ${Math.round(c.cash)}. Net worth ${worth} (${week >= 0 ? "+" : ""}${week} over the last week).${goal ? `\nSavings goal ${goal}: ${Math.min(100, Math.round(worth / goal * 100))}% there.` : ""}`,
        actions: [{ ...action(id, "Set a savings goal", "setGoal"), fields: [{ key: "goal", label: "Net worth goal", min: 0, max: 100_000_000, value: goal ?? Math.round(worth * 2) }] }] }];
    },
    view(company) {
      const c = e.companies.get(company);
      return c ? { goal: goals.get(company) ?? null, history: e.worthLog.get(company) ?? [], worth: Math.round(e.netWorth(c)) } : undefined;
    },
  };
};

export const INTEREST_PER_DAY = 0.002, MAX_DEPOSIT = 50_000;

/** Economy side of 263: deposits earn 0.2% a day; withdraw any time. Deposited money is not cash to spend. */
export const bankEffects: FeatureFactory = (e) => {
  const id = "ports.bank-effects";
  const deposits = new Map<number, number>();
  return {
    id, ideas: [263], title: "Bank deposits", economy: true,
    apply(cmd) {
      const c = e.companies.get(cmd.company)!;
      if (!dockedPorts(e, c.id).length) return fail("you need a ship in port to visit the bank");
      const held = deposits.get(c.id) ?? 0;
      if (cmd.action === "deposit") {
        if (!inRange(cmd.amount, 1, MAX_DEPOSIT - held)) return fail(`deposit 1 to ${Math.max(0, Math.floor(MAX_DEPOSIT - held))}`);
        if (c.cash < cmd.amount) return fail("not enough cash");
        c.cash -= cmd.amount; deposits.set(c.id, held + cmd.amount);
        return { ok: true, spent: cmd.amount };
      }
      if (cmd.action === "withdraw") {
        if (!inRange(cmd.amount, 1, Math.floor(held))) return fail(`withdraw 1 to ${Math.floor(held)}`);
        c.cash += cmd.amount; deposits.set(c.id, held - cmd.amount);
        return { ok: true, earned: cmd.amount };
      }
      return fail("unknown action");
    },
    advance() {
      if (e.tick % 24 !== 0) return;
      for (const [co, amt] of deposits) deposits.set(co, Math.min(MAX_DEPOSIT, amt * (1 + INTEREST_PER_DAY)));
    },
    cards(company) {
      const held = Math.floor(deposits.get(company) ?? 0);
      return [{ title: "Bank deposits", detail: `On deposit: ${held}. Interest ${INTEREST_PER_DAY * 100}% a day, paid at midnight, up to ${MAX_DEPOSIT}.`,
        actions: [
          { ...action(id, "Deposit", "deposit"), fields: [{ key: "amount", label: "Credits", min: 1, max: MAX_DEPOSIT, value: 1000 }] },
          ...(held >= 1 ? [{ ...action(id, "Withdraw", "withdraw"), fields: [{ key: "amount", label: "Credits", min: 1, max: held, value: held }] }] : []),
        ] }];
    },
    view: (company) => ({ deposit: Math.floor(deposits.get(company) ?? 0) }),
  };
};

/** A port's risk rating 0-3: pirate ships docked at or heading for it, plus a little sea-state chance. */
export function riskAt(e: Engine, port: number): number {
  let pirates = 0;
  for (const s of e.ships.values()) if (s.type === "pirate" && (s.dest === port || (s.dest === null && s.port === port))) pirates++;
  return Math.min(3, pirates + (hash(127, port, day(e)) < 0.15 ? 1 : 0));
}
const RISK = ["Low", "Moderate", "High", "Severe"];

/** 264 an insurance office: daily risk ratings for the ports you trade with, and whether cover can be bought
 *  (ships.insurance, when that economy module is on). Information only. */
export const insuranceOffice: FeatureFactory = (e) => ({
  id: "ports.insurance-office", ideas: [264], title: "Insurance office", economy: false,
  cards(company) {
    const ports = dockedPorts(e, company);
    if (!ports.length) return [];
    const near = new Set<number>();
    for (const p of ports) for (const q of connected(e)) if (Number.isFinite(e.dist[p][q])) near.add(q);
    const top = [...near].map(p => ({ p, r: riskAt(e, p) })).filter(x => x.r > 0).sort((a, b) => b.r - a.r || a.p - b.p).slice(0, 6);
    return [{ title: "Insurance office: risk today", detail: `${top.length ? top.map(x => `${portName(e, x.p)}: ${RISK[x.r]}`).join(", ") : "All waters you can reach are rated Low."}\n${peer(e, "ships.insurance") ? "Hull and cargo cover is on sale (Ships)." : "No cover is on sale this season."}` }];
  },
  world: () => ({ risk: e.map.ports.map(p => riskAt(e, p.id)) }),
});
